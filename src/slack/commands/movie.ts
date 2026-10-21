import { SubmissionDenied } from '../../core/submission';
import type { App } from '@slack/bolt';
import type { RadarrClient } from '../../radarr/client';
import { buildSearchResultsMessage } from '../messages/index';
import { storeResults } from '../../core/searchCache';
import { submitMovieForApproval } from '../../core/helpers/submitForApproval';
import { createLogger } from '../../logger';

type MovieCommandDeps = {
  radarrClient: RadarrClient;
  approvalChannelId: string;
};

const IMDB_REGEX = /^(?:https?:\/\/(?:www\.)?imdb\.com\/title\/)?(tt\d{7,8})\/?.*$/i;

const log = createLogger('movie-cmd');

export function registerMovieCommand(app: App, deps: MovieCommandDeps): void {
  app.command('/movie', async ({ command, ack, respond, client }) => {
    await ack();

    const query = command.text.trim();
    log.info('/movie command', { user: command.user_id, query });
    if (!query) {
      await respond({
        response_type: 'ephemeral',
        text: 'Please provide a movie title. Usage: `/movie <title>`',
      });
      return;
    }

    const imdbMatch = query.match(IMDB_REGEX);

    if (imdbMatch) {
      const imdbId = imdbMatch[1] as string;
      log.info('IMDB link detected', { user: command.user_id, imdbId });
      try {
        const results = await deps.radarrClient.searchMovies(`imdb:${imdbId}`);

        if (results.length === 0) {
          log.warn('IMDB movie not found', { user: command.user_id, imdbId });
          await respond({
            response_type: 'ephemeral',
            text: `:thinking_face: Could not find a movie with IMDB ID ${imdbId}. Please check the link and try again.`,
          });
          return;
        }

        const movie = results[0]!;
        const result = await submitMovieForApproval({
          movie,
          userId: command.user_id,
          client,
          radarrClient: deps.radarrClient,
          approvalChannelId: deps.approvalChannelId,
        });

        if (result.alreadyExists) {
          await respond({
            response_type: 'ephemeral',
            text: `:information_source: *${movie.title} (${movie.year})* is already in the library!`,
          });
          return;
        }

        if (!result.success) {
          throw new Error(result.error ?? 'Unknown error');
        }

        await respond({
          response_type: 'ephemeral',
          text: `:white_check_mark: Your request for *${movie.title} (${movie.year})* has been submitted for approval!`,
        });
      } catch (error) {
        log.error('Error in /movie command (IMDB path)', { user: command.user_id, error: error instanceof Error ? error.message : String(error) });
        await respond({
          response_type: 'ephemeral',
          text: error instanceof SubmissionDenied ? error.message : ':x: Failed to process IMDB link. Please try again.',
        });
      }
      return;
    }

    try {
      await respond({
        response_type: 'ephemeral',
        text: `:mag: Searching for *${query}*...`,
      });

      const results = await deps.radarrClient.searchMovies(query);

      if (results.length === 0) {
        log.warn('No results', { user: command.user_id, query });
        await respond({
          response_type: 'ephemeral',
          text: `:thinking_face: No results found for *${query}*. Try a different title.`,
        });
        return;
      }

      storeResults(command.user_id, results.slice(0, 5));

      log.info('Search complete', { user: command.user_id, query, results: results.length });

      await respond({
        response_type: 'ephemeral',
        blocks: buildSearchResultsMessage(results),
        text: `Search results for: ${query}`,
      });
    } catch (error) {
      log.error('Error in /movie command', { user: command.user_id, error: error instanceof Error ? error.message : String(error) });
      await respond({
        response_type: 'ephemeral',
        text: error instanceof SubmissionDenied ? error.message : ':x: Failed to search for movies. Please try again.',
      });
    }
  });
}
