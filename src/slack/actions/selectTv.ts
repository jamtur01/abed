import { SubmissionDenied } from '../../core/submission';
import type { App } from '@slack/bolt';
import type { SonarrClient } from '../../sonarr/client';
import { getTvResults, clearTvResults } from '../../core/searchCache';
import { ACTION_IDS } from '../messages/index';
import { submitTvForApproval } from '../../core/helpers/submitForApproval';
import { createLogger } from '../../logger';

const log = createLogger('select-tv');

type SelectTvDeps = {
  sonarrClient: SonarrClient;
  approvalChannelId: string;
};

export function registerSelectTvAction(app: App, deps: SelectTvDeps): void {
  app.action(ACTION_IDS.SELECT_TV, async ({ body, ack, client, respond }) => {
    await ack();

    const action = (body as any).actions[0];
    const tvdbId = parseInt(action.value, 10);
    const userId = body.user.id;

    try {
      const cachedResults = getTvResults(userId);
      if (!cachedResults) {
        log.warn('Cache miss', { user: userId });
        await respond({
          response_type: 'ephemeral',
          replace_original: false,
          text: ':x: Your search session has expired. Please run `/tv` again.',
        });
        return;
      }

      const show = cachedResults.find((s) => s.tvdbId === tvdbId);
      if (!show) {
        await respond({
          response_type: 'ephemeral',
          replace_original: false,
          text: ':x: Could not find that TV show. Please search again.',
        });
        return;
      }

      log.info('TV show selected', { user: userId, show: `${show.title} (${show.year})`, tvdbId });

      const result = await submitTvForApproval({
        show,
        userId,
        client,
        sonarrClient: deps.sonarrClient,
        approvalChannelId: deps.approvalChannelId,
      });

      if (result.alreadyExists) {
        await respond({
          response_type: 'ephemeral',
          replace_original: false,
          text: `:information_source: *${show.title} (${show.year})* is already in the library!`,
        });
        return;
      }

      if (!result.success) {
        throw new Error(result.error ?? 'Unknown error');
      }

      clearTvResults(userId);

      await respond({
        response_type: 'ephemeral',
        replace_original: false,
        text: `:white_check_mark: Your request for *${show.title} (${show.year})* has been submitted for approval!`,
      });
    } catch (error) {
      (error instanceof SubmissionDenied ? log.info : log.error)('Error in selectTv action', {
        user: userId,
        error: error instanceof Error ? error.message : String(error),
      });
      await respond({
        response_type: 'ephemeral',
        replace_original: false,
        text:
          error instanceof SubmissionDenied
            ? error.message
            : ':x: Something went wrong. Check /queue before retrying.',
      });
    }
  });
}
