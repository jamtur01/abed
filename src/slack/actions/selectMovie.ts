import { SubmissionDenied } from '../../core/submission';
import type { App } from '@slack/bolt';
import type { RadarrClient } from '../../radarr/client';
import { getResults, clearResults } from '../../core/searchCache';
import { ACTION_IDS } from '../messages/index';
import { submitMovieForApproval } from '../../core/helpers/submitForApproval';
import { createLogger } from '../../logger';

const log = createLogger('select');

type SelectMovieDeps = {
  radarrClient: RadarrClient;
  approvalChannelId: string;
};

export function registerSelectMovieAction(app: App, deps: SelectMovieDeps): void {
  app.action(ACTION_IDS.SELECT_MOVIE, async ({ body, ack, client, respond }) => {
    await ack();

    const action = (body as any).actions[0];
    const tmdbId = parseInt(action.value, 10);
    const userId = body.user.id;

    try {
      const cachedResults = getResults(userId);
      if (!cachedResults) {
        log.warn('Cache miss', { user: userId });
        await respond({
          response_type: 'ephemeral',
          replace_original: false,
          text: ':x: Your search session has expired. Please run `/movie` again.',
        });
        return;
      }

      const movie = cachedResults.find(m => m.tmdbId === tmdbId);
      if (!movie) {
        await respond({
          response_type: 'ephemeral',
          replace_original: false,
          text: ':x: Could not find that movie. Please search again.',
        });
        return;
      }

      log.info('Movie selected', { user: userId, movie: `${movie.title} (${movie.year})`, tmdbId });

      const result = await submitMovieForApproval({
        movie,
        userId,
        client,
        radarrClient: deps.radarrClient,
        approvalChannelId: deps.approvalChannelId,
      });

      if (result.alreadyExists) {
        await respond({
          response_type: 'ephemeral',
          replace_original: false,
          text: `:information_source: *${movie.title} (${movie.year})* is already in the library!`,
        });
        return;
      }

      if (!result.success) {
        throw new Error(result.error ?? 'Unknown error');
      }

      clearResults(userId);

      await respond({
        response_type: 'ephemeral',
        replace_original: false,
        text: `:white_check_mark: Your request for *${movie.title} (${movie.year})* has been submitted for approval!`,
      });
    } catch (error) {
      log.error('Error in selectMovie action', { user: userId, error: error instanceof Error ? error.message : String(error) });
      await respond({
        response_type: 'ephemeral',
        replace_original: false,
        text: ':x: Something went wrong. Please try again.',
      });
    }
  });
}
