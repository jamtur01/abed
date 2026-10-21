import { describe, expect, test, mock, beforeEach } from 'bun:test';
import { handleApproveMovie, handleRejectMovie } from '../../../src/discord/actions/approveMovie';
import { _resetDb, getDb, createRequest, getRequestByTmdbId } from '../../../src/db/index';
import type { RadarrClient } from '../../../src/radarr/client';

describe('Discord Approve/Reject Movie', () => {
  let mockInteraction: any;
  let mockRadarrClient: any;
  const approverDiscordIds = ['A123'];

  beforeEach(() => {
    _resetDb();
    getDb(':memory:');

    mockInteraction = {
      channelId: 'C_APPROVAL',
      user: { id: 'A123' },
      customId: 'approve_movie_request_1',
      deferUpdate: mock(),
      reply: mock(),
      followUp: mock(),
      message: { id: 'message1', edit: mock() },
      client: {
        users: {
          fetch: mock().mockResolvedValue({ send: mock() }),
        },
      },
    };

    mockRadarrClient = {
      searchMovies: mock().mockResolvedValue([{ title: 'The Matrix', tmdbId: 123 }]),
      addMovie: mock().mockResolvedValue({ id: 1 }),
    };
  });

  describe('handleApproveMovie', () => {
    test('responds ephemerally when user is not an approver', async () => {
      mockInteraction.user.id = 'NOT_APPROVER';
      await handleApproveMovie(mockInteraction, {
        radarrClient: mockRadarrClient as unknown as RadarrClient,
        approverDiscordIds,
        qualityProfileId: 1,
        rootFolderPath: '/',
      });
      expect(mockInteraction.reply).toHaveBeenCalled();
      const args = mockInteraction.reply.mock.calls[0][0];
      expect(args.content).toInclude('not authorized');
      expect(args.flags).toBe(64);
    });

    test('updates DB status to approved and adds movie on happy path', async () => {
      createRequest({
        movie_title: 'The Matrix',
        tmdb_id: 123,
        year: 1999,
        requester_slack_id: 'U123',
        platform: 'discord',
        approval_channel_id: 'C_APPROVAL',
        slack_message_ts: 'message1',
      });

      await handleApproveMovie(mockInteraction, {
        radarrClient: mockRadarrClient as unknown as RadarrClient,
        approverDiscordIds,
        qualityProfileId: 1,
        rootFolderPath: '/',
      });

      expect(mockInteraction.deferUpdate).toHaveBeenCalled();
      expect(mockRadarrClient.addMovie).toHaveBeenCalled();

      const req = getRequestByTmdbId(123);
      expect(req?.status).toBe('approved');
      expect(req?.approver_slack_id).toBe('A123'); // Still saved under slack_id for schema compat
    });
  });

  describe('handleRejectMovie', () => {
    beforeEach(() => {
      mockInteraction.customId = 'reject_movie_request_1';
    });

    test('updates DB status to rejected on happy path', async () => {
      createRequest({
        movie_title: 'The Matrix',
        tmdb_id: 123,
        year: 1999,
        requester_slack_id: 'U123',
        platform: 'discord',
        approval_channel_id: 'C_APPROVAL',
        slack_message_ts: 'message1',
      });

      await handleRejectMovie(mockInteraction, { approverDiscordIds });

      expect(mockInteraction.deferUpdate).toHaveBeenCalled();

      const req = getRequestByTmdbId(123);
      expect(req?.status).toBe('rejected');
    });
  });
});
