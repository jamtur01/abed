import {
  reserveMovieRequest,
  reserveTvRequest,
  assertCanSubmit,
  postApproval,
} from '../submission';
import type { RadarrSearchResult } from '../../radarr/types';
import type { RadarrClient } from '../../radarr/client';
import type { SonarrSearchResult } from '../../sonarr/types';
import type { SonarrClient } from '../../sonarr/client';
import {
  buildApprovalRequestMessage,
  buildTvApprovalRequestMessage,
} from '../../slack/messages/index';
import { getMoviePosterUrl, getTvPosterUrl } from './posterUrl';
import { createLogger } from '../../logger';

const log = createLogger('submit');

type SubmitForApprovalParams = {
  movie: RadarrSearchResult;
  userId: string;
  client: {
    chat: { postMessage: (args: any) => Promise<any> };
    conversations: { join: (args: any) => Promise<any> };
  };
  radarrClient: RadarrClient;
  approvalChannelId: string;
};

type SubmitForApprovalResult = {
  success: boolean;
  alreadyExists?: boolean;
  error?: string;
};

export async function submitMovieForApproval(
  params: SubmitForApprovalParams,
): Promise<SubmitForApprovalResult> {
  const { movie, userId, client, radarrClient, approvalChannelId } = params;

  assertCanSubmit('movie', 'slack', userId, movie.tmdbId);
  const exists = await radarrClient.movieExists(movie.tmdbId);
  if (exists) {
    log.info('Already in Radarr', {
      user: userId,
      movie: `${movie.title} (${movie.year})`,
      tmdbId: movie.tmdbId,
    });
    return { success: false, alreadyExists: true };
  }

  const request = reserveMovieRequest({
    movie_title: movie.title,
    tmdb_id: movie.tmdbId,
    imdb_id: movie.imdbId,
    year: movie.year,
    poster_url: getMoviePosterUrl(movie),
    requester_slack_id: userId,
    approval_channel_id: approvalChannelId,
  });

  const postApprovalMessage = () =>
    client.chat.postMessage({
      channel: approvalChannelId,
      blocks: buildApprovalRequestMessage(
        {
          title: movie.title,
          year: movie.year,
          tmdbId: movie.tmdbId,
          posterUrl: getMoviePosterUrl(movie),
          overview: movie.overview,
        },
        userId,
        request.id,
      ),
      text: `Movie request: ${movie.title} (${movie.year})`,
    });

  await postApproval('movie', request.id, async () => {
    let result;
    try {
      result = await postApprovalMessage();
    } catch (postError: any) {
      if (postError?.data?.error === 'not_in_channel') {
        log.warn('Auto-joining approval channel', { channel: approvalChannelId });
        await client.conversations.join({ channel: approvalChannelId });
        result = await postApprovalMessage();
      } else {
        log.error('Error submitting for approval', {
          user: userId,
          tmdbId: movie.tmdbId,
          error: postError instanceof Error ? postError.message : String(postError),
        });
        throw postError;
      }
    }

    return result.ts as string;
  });

  log.info('Approval posted', {
    movie: `${movie.title} (${movie.year})`,
    tmdbId: movie.tmdbId,
    requestId: request.id,
  });

  return { success: true };
}

type SubmitTvForApprovalParams = {
  show: SonarrSearchResult;
  userId: string;
  client: {
    chat: { postMessage: (args: any) => Promise<any> };
    conversations: { join: (args: any) => Promise<any> };
  };
  sonarrClient: SonarrClient;
  approvalChannelId: string;
};

export async function submitTvForApproval(
  params: SubmitTvForApprovalParams,
): Promise<SubmitForApprovalResult> {
  const { show, userId, client, sonarrClient, approvalChannelId } = params;

  assertCanSubmit('tv', 'slack', userId, show.tvdbId);
  const exists = await sonarrClient.seriesExists(show.tvdbId);
  if (exists) {
    log.info('Already in Sonarr', {
      user: userId,
      show: `${show.title} (${show.year})`,
      tvdbId: show.tvdbId,
    });
    return { success: false, alreadyExists: true };
  }

  const posterUrl = getTvPosterUrl(show);

  const request = reserveTvRequest({
    show_title: show.title,
    tvdb_id: show.tvdbId,
    year: show.year,
    poster_url: posterUrl,
    requester_slack_id: userId,
    approval_channel_id: approvalChannelId,
  });

  const seasonCount = show.seasons.filter((s) => s.seasonNumber > 0).length;

  const postApprovalMessage = () =>
    client.chat.postMessage({
      channel: approvalChannelId,
      blocks: buildTvApprovalRequestMessage(
        {
          title: show.title,
          year: show.year,
          tvdbId: show.tvdbId,
          posterUrl,
          overview: show.overview,
          network: show.network,
          seasonCount,
        },
        userId,
        request.id,
      ),
      text: `TV show request: ${show.title} (${show.year})`,
    });

  await postApproval('tv', request.id, async () => {
    let result;
    try {
      result = await postApprovalMessage();
    } catch (postError: any) {
      if (postError?.data?.error === 'not_in_channel') {
        log.warn('Auto-joining approval channel', { channel: approvalChannelId });
        await client.conversations.join({ channel: approvalChannelId });
        result = await postApprovalMessage();
      } else {
        log.error('Error submitting for approval', {
          user: userId,
          tvdbId: show.tvdbId,
          error: postError instanceof Error ? postError.message : String(postError),
        });
        throw postError;
      }
    }

    return result.ts as string;
  });

  log.info('Approval posted', {
    show: `${show.title} (${show.year})`,
    tvdbId: show.tvdbId,
    requestId: request.id,
  });

  return { success: true };
}
