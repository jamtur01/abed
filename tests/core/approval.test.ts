import { unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { approveMovieRequest, approveTvRequest, transition } from '../../src/core/approval';
import {
  _resetDb,
  getDb,
  createRequest,
  createTvRequest,
  getRequest,
  getTvRequest,
} from '../../src/db/index';

beforeEach(() => {
  _resetDb();
  getDb(':memory:');
});
for (const kind of ['movie', 'tv'] as const) {
  describe(`${kind} approval ownership`, () => {
    function setup() {
      const request =
        kind === 'movie'
          ? createRequest({
              movie_title: 'Fixture',
              tmdb_id: 123,
              year: 2020,
              requester_slack_id: 'USER',
            })
          : createTvRequest({
              show_title: 'Fixture',
              tvdb_id: 123,
              year: 2020,
              requester_slack_id: 'USER',
            });
      const data = { tmdbId: 123, tvdbId: 123 };
      const add = mock(async () => data);
      const lookup = mock(async () => [data]);
      const exists = mock(async (): Promise<any> => null);
      const client = {
        searchMovies: lookup,
        searchSeries: lookup,
        addMovie: add,
        addSeries: add,
        getMovieByTmdbId: exists,
        getSeriesByTvdbId: exists,
      };
      const read = () => (kind === 'movie' ? getRequest(request.id) : getTvRequest(request.id))!;
      const approve = () =>
        kind === 'movie'
          ? approveMovieRequest(read() as any, 'APPROVER', {
              radarrClient: client as any,
              qualityProfileId: 1,
              rootFolderPath: '/',
            })
          : approveTvRequest(read() as any, 'APPROVER', {
              sonarrClient: client as any,
              qualityProfileId: 1,
              rootFolderPath: '/',
            });
      return { request, data, add, lookup, exists, read, approve };
    }

    it('claims before awaiting and rejection cannot overwrite the winner', async () => {
      const s = setup();
      let release!: () => void;
      s.lookup.mockImplementation(async () => {
        await new Promise<void>((r) => {
          release = r;
        });
        return [s.data];
      });
      const first = s.approve();
      expect(s.read().status).toBe('submitting');
      expect(await s.approve()).toBe(false);
      expect(transition(kind, s.request.id, 'pending', 'rejected', 'OTHER')).toBe(false);
      release();
      expect(await first).toBe(true);
      expect(s.add).toHaveBeenCalledTimes(1);
      expect(s.read().status).toBe('approved');
    });

    it('never writes after rejection and retries only pre-write failures', async () => {
      const s = setup();
      s.lookup.mockRejectedValueOnce(new Error('lookup unavailable'));
      await expect(s.approve()).rejects.toThrow();
      expect(s.read().status).toBe('pending');
      expect(s.add).not.toHaveBeenCalled();
      expect(transition(kind, s.request.id, 'pending', 'rejected', 'OTHER')).toBe(true);
      expect(await s.approve()).toBe(false);
      expect(s.add).not.toHaveBeenCalled();
    });

    it('retains uncertain writes and only reconciles exact Arr identity', async () => {
      const s = setup();
      s.add.mockRejectedValueOnce(new Error('connection lost after submission'));
      await expect(s.approve()).rejects.toThrow();
      expect(s.read().status).toBe('uncertain');
      await expect(s.approve()).rejects.toThrow('uncertain');
      s.exists.mockResolvedValueOnce({ tmdbId: 999, tvdbId: 999 });
      await expect(s.approve()).rejects.toThrow('uncertain');
      s.exists.mockResolvedValueOnce(s.data);
      expect(await s.approve()).toBe(true);
      expect(s.add).toHaveBeenCalledTimes(1);
      expect(s.read().status).toBe('approved');
    });
  });
}

it('recovers interrupted writes and message posts after reopening the database', () => {
  _resetDb();
  const path = join(tmpdir(), `abed-${crypto.randomUUID()}.db`);
  try {
    getDb(path);
    const input = { movie_title: 'Fixture', tmdb_id: 1, year: 2020, requester_slack_id: 'USER' };
    const unbound = createRequest(input);
    const bound = createRequest({
      ...input,
      tmdb_id: 2,
      approval_channel_id: 'CHANNEL',
      slack_message_ts: 'message',
    });
    const submitting = createRequest({ ...input, tmdb_id: 3 });
    transition('movie', submitting.id, 'pending', 'submitting', 'APPROVER');
    _resetDb();
    getDb(path);
    expect(getRequest(unbound.id)?.status).toBe('failed');
    expect(getRequest(bound.id)?.status).toBe('pending');
    expect(getRequest(submitting.id)?.status).toBe('uncertain');
  } finally {
    _resetDb();
    unlinkSync(path);
  }
});
