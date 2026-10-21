import { describe, expect, test, mock, beforeEach } from 'bun:test';
import { handleApproveTv, handleRejectTv } from '../../../src/discord/actions/approveTv';
import { _resetDb, getDb, createTvRequest, getTvRequestByTvdbId } from '../../../src/db/index';
import type { SonarrClient } from '../../../src/sonarr/client';

describe('Discord Approve/Reject TV', () => {
  let mockInteraction: any;
  let mockSonarrClient: any;
  const approverDiscordIds = ['A123'];

  beforeEach(() => {
    _resetDb();
    getDb(':memory:');

    mockInteraction = {
      channelId: 'C_APPROVAL',
      user: { id: 'A123' },
      customId: 'approve_tv_request_1',
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

    mockSonarrClient = {
      searchSeries: mock().mockResolvedValue([{ title: 'Breaking Bad', tvdbId: 456 }]),
      addSeries: mock().mockResolvedValue({ id: 1 }),
    };
  });

  describe('handleApproveTv', () => {
    test('responds ephemerally when user is not an approver', async () => {
      mockInteraction.user.id = 'NOT_APPROVER';
      await handleApproveTv(mockInteraction, {
        sonarrClient: mockSonarrClient as unknown as SonarrClient,
        approverDiscordIds,
        qualityProfileId: 1,
        rootFolderPath: '/',
      });
      expect(mockInteraction.reply).toHaveBeenCalled();
      const args = mockInteraction.reply.mock.calls[0][0];
      expect(args.content).toInclude('not authorized');
      expect(args.flags).toBe(64);
    });

    test('updates DB status to approved and adds show on happy path', async () => {
      createTvRequest({
        show_title: 'Breaking Bad',
        tvdb_id: 456,
        year: 2008,
        requester_slack_id: 'U123',
        platform: 'discord',
        approval_channel_id: 'C_APPROVAL',
        slack_message_ts: 'message1',
      });

      await handleApproveTv(mockInteraction, {
        sonarrClient: mockSonarrClient as unknown as SonarrClient,
        approverDiscordIds,
        qualityProfileId: 1,
        rootFolderPath: '/',
      });

      expect(mockInteraction.deferUpdate).toHaveBeenCalled();
      expect(mockSonarrClient.addSeries).toHaveBeenCalled();

      const req = getTvRequestByTvdbId(456);
      expect(req?.status).toBe('approved');
      expect(req?.approver_slack_id).toBe('A123'); // Still saved under slack_id for schema compat
    });
  });

  describe('handleRejectTv', () => {
    beforeEach(() => {
      mockInteraction.customId = 'reject_tv_request_1';
    });

    test('updates DB status to rejected on happy path', async () => {
      createTvRequest({
        show_title: 'Breaking Bad',
        tvdb_id: 456,
        year: 2008,
        requester_slack_id: 'U123',
        platform: 'discord',
        approval_channel_id: 'C_APPROVAL',
        slack_message_ts: 'message1',
      });

      await handleRejectTv(mockInteraction, { approverDiscordIds });

      expect(mockInteraction.deferUpdate).toHaveBeenCalled();

      const req = getTvRequestByTvdbId(456);
      expect(req?.status).toBe('rejected');
    });
  });
});
