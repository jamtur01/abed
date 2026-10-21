import type { App } from '@slack/bolt';
import { getAllRequests, getAllTvRequests } from '../../db/index';
import { buildQueueMessage } from '../messages/index';
import type { QueueItem } from '../messages/index';
import type { RequestStatus } from '../../db/types';
import { createLogger } from '../../logger';

const VALID_STATUSES: RequestStatus[] = [
  'pending',
  'submitting',
  'uncertain',
  'approved',
  'rejected',
  'already_exists',
  'failed',
];

const log = createLogger('queue-cmd');

export function registerQueueCommand(app: App): void {
  app.command('/queue', async ({ command, ack, respond }) => {
    await ack();

    const userId = command.user_id;
    const filterText = command.text.trim().toLowerCase();
    log.info('/queue command', { user: userId, filter: filterText || '(none)' });

    let statusFilter: RequestStatus | undefined;
    if (filterText) {
      if (!VALID_STATUSES.includes(filterText as RequestStatus)) {
        await respond({
          response_type: 'ephemeral',
          text: `:x: Unknown status *${filterText}*. Valid options: ${VALID_STATUSES.join(', ')}`,
        });
        return;
      }
      statusFilter = filterText as RequestStatus;
    }

    try {
      const movieRequests = getAllRequests(statusFilter);
      const tvRequests = getAllTvRequests(statusFilter);

      const items: QueueItem[] = [
        ...movieRequests.map((r) => ({
          type: 'movie' as const,
          title: r.movie_title,
          year: r.year,
          status: r.status,
          createdAt: r.created_at,
          requesterId: r.requester_slack_id,
        })),
        ...tvRequests.map((r) => ({
          type: 'tv' as const,
          title: r.show_title,
          year: r.year,
          status: r.status,
          createdAt: r.created_at,
          requesterId: r.requester_slack_id,
        })),
      ];

      items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

      const limited = items.slice(0, 25);

      const blocks = buildQueueMessage(limited, statusFilter);

      await respond({
        response_type: 'ephemeral',
        blocks,
        text: 'Request queue',
      });
    } catch (error) {
      log.error('Error in /queue command', {
        user: userId,
        error: error instanceof Error ? error.message : String(error),
      });
      await respond({
        response_type: 'ephemeral',
        text: ':x: Failed to retrieve the request queue. Please try again.',
      });
    }
  });
}
