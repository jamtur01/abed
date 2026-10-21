import { approveTvRequest } from '../../core/approval';
import type { App } from '@slack/bolt';
import type { SonarrClient } from '../../sonarr/client';
import { buildTvApprovedMessage, ACTION_IDS } from '../messages/index';
import { getTvRequest } from '../../db/index';
import { createLogger } from '../../logger';

const log = createLogger('approve-tv');

type ApproveTvDeps = {
  sonarrClient: SonarrClient;
  approverSlackIds: string[];
  approvalChannelId: string;
  qualityProfileId: number;
  rootFolderPath: string;
};

export function registerApproveTvAction(app: App, deps: ApproveTvDeps): void {
  app.action(ACTION_IDS.APPROVE_TV, async ({ body, ack, client, respond }) => {
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
        text: ':no_entry: You are not authorized to approve TV show requests.',
      });
      return;
    }

    try {
      const request = Number.isSafeInteger(requestId) ? getTvRequest(requestId) : null;
      if (!request || request.platform !== 'slack'
        || request.approval_channel_id !== deps.approvalChannelId
        || (body as any).channel?.id !== request.approval_channel_id
        || !request.slack_message_ts
        || (body as any).message?.ts !== request.slack_message_ts) {
        await respond({
          response_type: 'ephemeral',
          replace_original: false,
          text: ':x: Could not find the TV show request.',
        });
        return;
      }

      if (!await approveTvRequest(request, approverId, deps)) return;

      log.info('TV show approved', { approver: approverId, show: `${request.show_title} (${request.year})`, requestId });

      if (request.slack_message_ts) {
        await client.chat.update({
          channel: deps.approvalChannelId,
          ts: request.slack_message_ts,
          blocks: buildTvApprovedMessage(
            { title: request.show_title, year: request.year },
            request.requester_slack_id,
            approverId,
          ),
          text: `Approved: ${request.show_title}`,
        });
      }

      await client.chat.postMessage({
        channel: request.requester_slack_id,
        text: `:white_check_mark: Your request for *${request.show_title} (${request.year})* has been approved by <@${approverId}>! Sonarr is on it.`,
      });
    } catch (error) {
      log.error('Error in approveTv action', { user: approverId, requestId, error: error instanceof Error ? error.message : String(error) });
      await respond({
        response_type: 'ephemeral',
        replace_original: false,
        text: ':x: Failed to approve the TV show. Check the request status. Uncertain submissions are reconciled without resending.',
      });
    }
  });
}
