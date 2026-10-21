import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { submitMovieForApproval } from '../../../src/core/helpers/submitForApproval';
import { _resetDb, getDb, getRequestByTmdbId } from '../../../src/db/index';
import { _setLoggerOutput } from '../../../src/logger';

const mockMovie = {
  title: 'The Batman',
  year: 2022,
  tmdbId: 12345,
  imdbId: 'tt1877830',
  remotePoster: 'https://example.com/poster.jpg',
  overview: 'Bruce Wayne fights crime.',
  titleSlug: 'the-batman',
  images: [],
};

function createMockClient(postMessageImpl?: (_: any) => Promise<any>) {
  return {
    chat: {
      postMessage: mock(postMessageImpl ?? (async (_: any) => ({ ts: '111.222', ok: true }))),
    },
    conversations: {
      join: mock(async (_: any) => ({ ok: true })),
    },
  };
}

function createMockRadarrClient(exists = false) {
  return {
    movieExists: mock(async (_: number) => exists),
  };
}

describe('submitMovieForApproval', () => {
  beforeEach(() => {
    _setLoggerOutput({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} });
    _resetDb();
    getDb(':memory:');
  });

  it('returns { success: true } and creates DB record on happy path', async () => {
    const client = createMockClient();
    const radarrClient = createMockRadarrClient(false);

    const result = await submitMovieForApproval({
      movie: mockMovie,
      userId: 'U_TEST',
      client,
      radarrClient: radarrClient as any,
      approvalChannelId: 'C_APPROVAL',
    });

    expect(result).toEqual({ success: true });
    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'C_APPROVAL' }),
    );
    const dbRecord = getRequestByTmdbId(12345);
    expect(dbRecord).not.toBeNull();
    expect(dbRecord!.movie_title).toBe('The Batman');
    expect(dbRecord!.imdb_id).toBe('tt1877830');
    expect(dbRecord!.slack_message_ts).toBe('111.222');
  });

  it('returns { success: false, alreadyExists: true } when movie already in library', async () => {
    const client = createMockClient();
    const radarrClient = createMockRadarrClient(true);

    const result = await submitMovieForApproval({
      movie: mockMovie,
      userId: 'U_TEST',
      client,
      radarrClient: radarrClient as any,
      approvalChannelId: 'C_APPROVAL',
    });

    expect(result).toEqual({ success: false, alreadyExists: true });
    expect(client.chat.postMessage).not.toHaveBeenCalled();
    expect(getRequestByTmdbId(12345)).toBeNull();
  });

  it('joins channel and retries postMessage on not_in_channel error', async () => {
    let callCount = 0;
    const client = createMockClient(async (_: any) => {
      callCount++;
      if (callCount === 1) {
        const err: any = new Error('not_in_channel');
        err.data = { error: 'not_in_channel' };
        throw err;
      }
      return { ts: '222.333', ok: true };
    });
    const radarrClient = createMockRadarrClient(false);

    const result = await submitMovieForApproval({
      movie: mockMovie,
      userId: 'U_TEST',
      client,
      radarrClient: radarrClient as any,
      approvalChannelId: 'C_APPROVAL',
    });

    expect(result).toEqual({ success: true });
    expect(client.conversations.join).toHaveBeenCalledWith({ channel: 'C_APPROVAL' });
    expect(client.chat.postMessage).toHaveBeenCalledTimes(2);
  });

  it('throws on unexpected postMessage error (caller handles it)', async () => {
    const client = createMockClient(async (_: any) => {
      throw new Error('channel_not_found');
    });
    const radarrClient = createMockRadarrClient(false);

    await expect(
      submitMovieForApproval({
        movie: mockMovie,
        userId: 'U_TEST',
        client,
        radarrClient: radarrClient as any,
        approvalChannelId: 'C_APPROVAL',
      }),
    ).rejects.toThrow('channel_not_found');
  });
  it('posts one approval for concurrent repeated submissions and blocks later API work', async () => {
    const client = createMockClient();
    const radarrClient = createMockRadarrClient();
    const params = {
      movie: mockMovie,
      userId: 'U_TEST',
      client,
      radarrClient: radarrClient as any,
      approvalChannelId: 'C_APPROVAL',
    };
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => submitMovieForApproval(params)),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(client.chat.postMessage).toHaveBeenCalledTimes(1);
    const calls = radarrClient.movieExists.mock.calls.length;
    await expect(submitMovieForApproval(params)).rejects.toThrow('active request');
    expect(radarrClient.movieExists).toHaveBeenCalledTimes(calls);
  });
});
