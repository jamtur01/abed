import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { registerRejectTvAction } from '../../../src/slack/actions/rejectTv';
import { _resetDb, getDb, createTvRequest, getTvRequestByTvdbId, updateTvRequestStatus } from '../../../src/db/index';
import { ACTION_IDS } from '../../../src/slack/messages/index';
import { _setLoggerOutput } from '../../../src/logger';

function createMockApp() {
  const handlers: Record<string, Function> = {};
  return {
    action: (id: string, handler: Function) => { handlers[id] = handler; },
    getHandler: (id: string) => handlers[id],
  };
}

function mockActionPayload(tvdbIdStr: string, userId = 'U_APPROVER') {
  return {
    body: {
      channel: { id: 'C_APPROVAL' }, message: { ts: '111.222' },
      user: { id: userId },
      actions: [{ action_id: ACTION_IDS.REJECT_TV, value: 'request:1' }],
    },
    ack: mock(async () => {}),
    respond: mock(async (_: any) => {}),
    client: {
      chat: {
        postMessage: mock(async (_: any) => ({ ts: '555.666', ok: true })),
        update: mock(async (_: any) => ({ ok: true })),
      },
    },
  };
}

const defaultDeps = {
  approverSlackIds: ['U_APPROVER'],
  approvalChannelId: 'C_APPROVAL',
};

function seedPendingTvRequest(slackMessageTs = '111.222') {
  const req = createTvRequest({
    show_title: 'Breaking Bad',
    tvdb_id: 81189,
    year: 2008,
    poster_url: null,
    approval_channel_id: 'C_APPROVAL',
    requester_slack_id: 'U_REQUESTER',
  });
  updateTvRequestStatus({ id: req.id, status: 'pending', slack_message_ts: slackMessageTs });
  return getTvRequestByTvdbId(81189)!;
}

describe('rejectTv action', () => {
  let app: ReturnType<typeof createMockApp>;

  beforeEach(() => {
    _setLoggerOutput({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} });
    _resetDb();
    getDb(':memory:');
    app = createMockApp();
  });

  it('calls ack() immediately', async () => {
    seedPendingTvRequest();
    registerRejectTvAction(app as any, defaultDeps);
    const { body, ack, respond, client } = mockActionPayload('81189');
    await app.getHandler(ACTION_IDS.REJECT_TV)!({ body, ack, respond, client });
    expect(ack).toHaveBeenCalledTimes(1);
  });

  it('responds ephemerally when user is not an approver', async () => {
    registerRejectTvAction(app as any, defaultDeps);
    const { body, ack, respond, client } = mockActionPayload('81189', 'U_UNAUTHORIZED');
    await app.getHandler(ACTION_IDS.REJECT_TV)!({ body, ack, respond, client });

    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('not authorized') })
    );
    expect(client.chat.postMessage).not.toHaveBeenCalled();
  });

  it('silently returns (race condition guard) when request is already processed', async () => {
    const req = createTvRequest({
      show_title: 'Breaking Bad',
      tvdb_id: 81189,
      year: 2008,
      poster_url: null,
      approval_channel_id: 'C_APPROVAL',
    requester_slack_id: 'U_REQUESTER',
    });
    updateTvRequestStatus({ id: req.id, status: 'rejected', approver_slack_id: 'U_OTHER_APPROVER' });

    registerRejectTvAction(app as any, defaultDeps);
    const { body, ack, respond, client } = mockActionPayload('81189');
    await app.getHandler(ACTION_IDS.REJECT_TV)!({ body, ack, respond, client });

    expect(client.chat.postMessage).not.toHaveBeenCalled();
    expect(client.chat.update).not.toHaveBeenCalled();
  });

  it('updates DB status to rejected on happy path', async () => {
    seedPendingTvRequest();
    registerRejectTvAction(app as any, defaultDeps);
    const { body, ack, respond, client } = mockActionPayload('81189');
    await app.getHandler(ACTION_IDS.REJECT_TV)!({ body, ack, respond, client });

    const updated = getTvRequestByTvdbId(81189);
    expect(updated!.status).toBe('rejected');
    expect(updated!.approver_slack_id).toBe('U_APPROVER');
  });

  it('updates approval message in Slack on happy path', async () => {
    seedPendingTvRequest('111.222');
    registerRejectTvAction(app as any, defaultDeps);
    const { body, ack, respond, client } = mockActionPayload('81189');
    await app.getHandler(ACTION_IDS.REJECT_TV)!({ body, ack, respond, client });

    expect(client.chat.update).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'C_APPROVAL', ts: '111.222' })
    );
  });

  it('DMs the requester on happy path', async () => {
    seedPendingTvRequest();
    registerRejectTvAction(app as any, defaultDeps);
    const { body, ack, respond, client } = mockActionPayload('81189');
    await app.getHandler(ACTION_IDS.REJECT_TV)!({ body, ack, respond, client });

    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'U_REQUESTER', text: expect.stringContaining('rejected') })
    );
  });
});
