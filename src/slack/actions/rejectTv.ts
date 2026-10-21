import { transition } from '../../core/approval';
import type { App } from '@slack/bolt';
import { buildTvRejectedMessage, ACTION_IDS } from '../messages/index';
import { getTvRequest } from '../../db/index';
import { createLogger } from '../../logger';

const log = createLogger('reject-tv');

type RejectTvDeps = {
  approverSlackIds: string[];
  approvalChannelId: string;
};

export function registerRejectTvAction(app: App, deps: RejectTvDeps): void {
  app.action(ACTION_IDS.REJECT_TV, async ({ body, ack, client, respond }) => {
    await ack();

    const action = (body as any).actions[0];
    const requestId = /^request:[1-9]\d*$/.test(action.value) ? Number(action.value.slice(8)) : NaN;
    const approverId = body.user.id;

    if (!deps.approverSlackIds.includes(approverId)) {
      log.warn('Unauthorized rejection attempt', { user: approverId, requestId });
      await respond({
        response_type: 'ephemeral',
        replace_original: false,
        text: ':no_entry: You are not authorized to reject TV show requests.',
      });
      return;
    }

    try {
      const request = Number.isSafeInteger(requestId) ? getTvRequest(requestId) : null;
      if (
        !request ||
        request.platform !== 'slack' ||
        request.approval_channel_id !== deps.approvalChannelId ||
        (body as any).channel?.id !== request.approval_channel_id ||
        !request.slack_message_ts ||
        (body as any).message?.ts !== request.slack_message_ts
      ) {
        await respond({
          response_type: 'ephemeral',
          replace_original: false,
          text: ':x: Could not find the TV show request.',
        });
        return;
      }

      if (!transition('tv', request.id, 'pending', 'rejected', approverId)) return;

      log.info('TV show rejected', {
        approver: approverId,
        show: `${request.show_title} (${request.year})`,
        requestId,
      });

      if (request.slack_message_ts) {
        await client.chat.update({
          channel: deps.approvalChannelId,
          ts: request.slack_message_ts,
          blocks: buildTvRejectedMessage(
            { title: request.show_title, year: request.year },
            request.requester_slack_id,
            approverId,
          ),
          text: `Rejected: ${request.show_title}`,
        });
      }

      await client.chat.postMessage({
        channel: request.requester_slack_id,
        text: `:x: Your request for *${request.show_title} (${request.year})* has been rejected by <@${approverId}>.`,
      });
    } catch (error) {
      log.error('Error in rejectTv action', {
        user: approverId,
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });
      await respond({
        response_type: 'ephemeral',
        replace_original: false,
        text: ':x: Failed to reject the TV show. Please try again.',
      });
    }
  });
}
