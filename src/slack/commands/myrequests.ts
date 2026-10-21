import type { App } from '@slack/bolt';
import { getRequestsByUserId, getTvRequestsByUserId } from '../../db/index';
import { buildMyRequestsMessage } from '../messages/index';
import type { MyRequestItem } from '../messages/index';
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

const log = createLogger('myrequests-cmd');

export function registerMyRequestsCommand(app: App): void {
  app.command('/myrequests', async ({ command, ack, respond }) => {
    await ack();

    const userId = command.user_id;
    const filterText = command.text.trim().toLowerCase();
    log.info('/myrequests command', { user: userId, filter: filterText || '(none)' });

    // Validate status filter if provided
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
      const movieRequests = getRequestsByUserId(userId, statusFilter);
      const tvRequests = getTvRequestsByUserId(userId, statusFilter);

      // Normalize to common shape
      const items: MyRequestItem[] = [
        ...movieRequests.map((r) => ({
          type: 'movie' as const,
          title: r.movie_title,
          year: r.year,
          status: r.status,
          createdAt: r.created_at,
        })),
        ...tvRequests.map((r) => ({
          type: 'tv' as const,
          title: r.show_title,
          year: r.year,
          status: r.status,
          createdAt: r.created_at,
        })),
      ];

      // Sort by createdAt descending (newest first)
      items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

      // Limit to 15 total
      const limited = items.slice(0, 15);

      const blocks = buildMyRequestsMessage(limited);

      await respond({
        response_type: 'ephemeral',
        blocks,
        text: 'Your requests',
      });
    } catch (error) {
      log.error('Error in /myrequests command', {
        user: userId,
        error: error instanceof Error ? error.message : String(error),
      });
      await respond({
        response_type: 'ephemeral',
        text: ':x: Failed to retrieve your requests. Please try again.',
      });
    }
  });
}
