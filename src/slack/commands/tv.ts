import type { App } from '@slack/bolt';
import type { SonarrClient } from '../../sonarr/client';
import { buildTvSearchResultsMessage } from '../messages/index';
import { storeTvResults } from '../../core/searchCache';
import { createLogger } from '../../logger';

type TvCommandDeps = {
  sonarrClient: SonarrClient;
  approvalChannelId: string;
};

const log = createLogger('tv-cmd');

export function registerTvCommand(app: App, deps: TvCommandDeps | null): void {
  app.command('/tv', async ({ command, ack, respond }) => {
    await ack();

    if (!deps) {
      await respond({
        response_type: 'ephemeral',
        text: ':x: TV show requests are not configured. Please contact an administrator.',
      });
      return;
    }

    const query = command.text.trim();
    log.info('/tv command', { user: command.user_id, query });
    if (!query) {
      await respond({
        response_type: 'ephemeral',
        text: 'Please provide a TV show title. Usage: `/tv <title>`',
      });
      return;
    }

    try {
      await respond({
        response_type: 'ephemeral',
        text: `:mag: Searching for *${query}*...`,
      });

      const results = await deps.sonarrClient.searchSeries(query);

      if (results.length === 0) {
        log.warn('No results', { user: command.user_id, query });
        await respond({
          response_type: 'ephemeral',
          text: `:thinking_face: No results found for *${query}*. Try a different title.`,
        });
        return;
      }

      storeTvResults(command.user_id, results.slice(0, 5));

      log.info('Search complete', { user: command.user_id, query, results: results.length });

      await respond({
        response_type: 'ephemeral',
        blocks: buildTvSearchResultsMessage(results),
        text: `Search results for: ${query}`,
      });
    } catch (error) {
      log.error('Error in /tv command', {
        user: command.user_id,
        error: error instanceof Error ? error.message : String(error),
      });
      await respond({
        response_type: 'ephemeral',
        text: ':x: Failed to search for TV shows. Please try again.',
      });
    }
  });
}
