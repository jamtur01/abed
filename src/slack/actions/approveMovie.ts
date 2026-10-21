import { approveMovieRequest } from '../../core/approval';
import type { App } from '@slack/bolt';
import type { RadarrClient } from '../../radarr/client';
import { buildApprovedMessage, ACTION_IDS } from '../messages/index';
import { getRequest } from '../../db/index';
import { createLogger } from '../../logger';

const log = createLogger('approve');

type ApproveMovieDeps = {
  radarrClient: RadarrClient;
  approverSlackIds: string[];
  approvalChannelId: string;
  qualityProfileId: number;
  rootFolderPath: string;
};

export function registerApproveMovieAction(app: App, deps: ApproveMovieDeps): void {
  app.action(ACTION_IDS.APPROVE_MOVIE, async ({ body, ack, client, respond }) => {
    await ack();

    const action = (body as any).actions[0];
    const requestId = /^request:[1-9]\d*$/.test(action.value)
      ? Number(action.value.slice(8)) : NaN;
    const approverId = body.user.id;

    if (!deps.approverSlackIds.includes(approverId)) {
      log.warn('Unauthorized approval attempt', { user: approverId, requestId });
      await respond({
        response_type: 'ephemeral',
        replace_original: false,
        text: ':no_entry: You are not authorized to approve movie requests.',
      });
      return;
    }

    try {
      const request = Number.isSafeInteger(requestId) ? getRequest(requestId) : null;
      if (!request || request.platform !== 'slack'
        || request.approval_channel_id !== deps.approvalChannelId
        || (body as any).channel?.id !== request.approval_channel_id
        || !request.slack_message_ts
        || (body as any).message?.ts !== request.slack_message_ts) {
        await respond({
          response_type: 'ephemeral',
          replace_original: false,
          text: ':x: Could not find the movie request.',
        });
        return;
      }

      if (!await approveMovieRequest(request, approverId, deps)) return;

      log.info('Movie approved', { approver: approverId, movie: `${request.movie_title} (${request.year})`, requestId });

      if (request.slack_message_ts) {
        await client.chat.update({
          channel: deps.approvalChannelId,
          ts: request.slack_message_ts,
          blocks: buildApprovedMessage(
            { title: request.movie_title, year: request.year },
            request.requester_slack_id,
            approverId,
          ),
          text: `Approved: ${request.movie_title}`,
        });
      }

      await client.chat.postMessage({
        channel: request.requester_slack_id,
        text: `:white_check_mark: Your request for *${request.movie_title} (${request.year})* has been approved by <@${approverId}>! Radarr is on it.`,
      });
    } catch (error) {
      log.error('Error in approveMovie action', { user: approverId, requestId, error: error instanceof Error ? error.message : String(error) });
      await respond({
        response_type: 'ephemeral',
        replace_original: false,
        text: ':x: Failed to approve the movie. Check the request status. Uncertain submissions are reconciled without resending.',
      });
    }
  });
}
