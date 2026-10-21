import { getDb } from '../db/index';
import type { MovieRequest, TvRequest, RequestStatus } from '../db/types';
import type { RadarrClient } from '../radarr/client';
import type { SonarrClient } from '../sonarr/client';

type Kind = 'movie' | 'tv';
const table = (kind: Kind) => (kind === 'movie' ? 'requests' : 'tv_requests');

/** Persist a decision only if this event still owns the expected state. */
export function transition(
  kind: Kind,
  id: number,
  from: RequestStatus,
  to: RequestStatus,
  actor: string,
): boolean {
  return (
    getDb()
      .query(`UPDATE ${table(kind)} SET status=?, approver_slack_id=?,
    updated_at=datetime('now') WHERE id=? AND status=?`)
      .run(to, actor, id, from).changes === 1
  );
}

/** Claim before network I/O. An uncertain write can only be reconciled, never replayed. */
async function settleApproval<T>(options: {
  kind: Kind;
  request: MovieRequest | TvRequest;
  actor: string;
  lookup: () => Promise<T | undefined>;
  add: (data: T) => Promise<unknown>;
  exists: () => Promise<boolean>;
}): Promise<boolean> {
  const { kind, request, actor } = options;
  if (!['pending', 'uncertain'].includes(request.status)) return false;
  if (!transition(kind, request.id, request.status, 'submitting', actor)) return false;
  let writeStarted = request.status === 'uncertain';
  try {
    if (writeStarted) {
      if (!(await options.exists())) {
        throw new Error('Submission remains uncertain. Check Arr before any manual retry.');
      }
    } else {
      const data = await options.lookup();
      if (!data) throw new Error('Could not find the exact requested title in Arr.');
      writeStarted = true;
      await options.add(data);
    }
    if (!transition(kind, request.id, 'submitting', 'approved', actor)) {
      throw new Error('Approval state changed unexpectedly; check Arr and the request database.');
    }
    return true;
  } catch (error) {
    transition(kind, request.id, 'submitting', writeStarted ? 'uncertain' : 'pending', actor);
    throw error;
  }
}

export function approveMovieRequest(
  request: MovieRequest,
  actor: string,
  deps: {
    radarrClient: RadarrClient;
    qualityProfileId: number;
    rootFolderPath: string;
  },
): Promise<boolean> {
  return settleApproval({
    kind: 'movie',
    request,
    actor,
    lookup: async () =>
      (await deps.radarrClient.searchMovies(`tmdb:${request.tmdb_id}`)).find(
        (movie) => movie.tmdbId === request.tmdb_id,
      ),
    add: (movie) => deps.radarrClient.addMovie(movie, deps.qualityProfileId, deps.rootFolderPath),
    exists: async () =>
      (await deps.radarrClient.getMovieByTmdbId(request.tmdb_id))?.tmdbId === request.tmdb_id,
  });
}

export function approveTvRequest(
  request: TvRequest,
  actor: string,
  deps: {
    sonarrClient: SonarrClient;
    qualityProfileId: number;
    rootFolderPath: string;
  },
): Promise<boolean> {
  return settleApproval({
    kind: 'tv',
    request,
    actor,
    lookup: async () =>
      (await deps.sonarrClient.searchSeries(`tvdb:${request.tvdb_id}`)).find(
        (show) => show.tvdbId === request.tvdb_id,
      ),
    add: (show) => deps.sonarrClient.addSeries(show, deps.qualityProfileId, deps.rootFolderPath),
    exists: async () =>
      (await deps.sonarrClient.getSeriesByTvdbId(request.tvdb_id))?.tvdbId === request.tvdb_id,
  });
}
