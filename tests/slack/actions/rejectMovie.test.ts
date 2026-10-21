import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { registerRejectMovieAction } from '../../../src/slack/actions/rejectMovie';
import {
  _resetDb,
  getDb,
  createRequest,
  getRequestByTmdbId,
  updateRequestStatus,
} from '../../../src/db/index';
import { ACTION_IDS } from '../../../src/slack/messages/index';
import { _setLoggerOutput } from '../../../src/logger';

function createMockApp() {
  const handlers: Record<string, Function> = {};
  return {
    action: (id: string, handler: Function) => {
      handlers[id] = handler;
    },
    getHandler: (id: string) => handlers[id],
  };
}

function mockActionPayload(tmdbIdStr: string, userId = 'U_APPROVER') {
  return {
    body: {
      channel: { id: 'C_APPROVAL' },
      message: { ts: '111.222' },
      user: { id: userId },
      actions: [{ action_id: ACTION_IDS.REJECT_MOVIE, value: 'request:1' }],
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

function seedPendingRequest(slackMessageTs = '111.222') {
  const req = createRequest({
    movie_title: 'The Batman',
    tmdb_id: 12345,
    imdb_id: 'tt1877830',
    year: 2022,
    poster_url: null,
    approval_channel_id: 'C_APPROVAL',
    requester_slack_id: 'U_REQUESTER',
  });
  updateRequestStatus({ id: req.id, status: 'pending', slack_message_ts: slackMessageTs });
  return getRequestByTmdbId(12345)!;
}

describe('rejectMovie action', () => {
  let app: ReturnType<typeof createMockApp>;

  beforeEach(() => {
    _setLoggerOutput({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} });
    _resetDb();
    getDb(':memory:');
    app = createMockApp();
  });

  it('calls ack() immediately', async () => {
    seedPendingRequest();
    registerRejectMovieAction(app as any, defaultDeps);
    const { body, ack, respond, client } = mockActionPayload('12345');
    await app.getHandler(ACTION_IDS.REJECT_MOVIE)!({ body, ack, respond, client });
    expect(ack).toHaveBeenCalledTimes(1);
  });

  it('responds ephemerally when user is not an approver', async () => {
    registerRejectMovieAction(app as any, defaultDeps);
    const { body, ack, respond, client } = mockActionPayload('12345', 'U_UNAUTHORIZED');
    await app.getHandler(ACTION_IDS.REJECT_MOVIE)!({ body, ack, respond, client });

    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('not authorized') }),
    );
    expect(client.chat.postMessage).not.toHaveBeenCalled();
  });

  it('silently returns (race condition guard) when request is already processed', async () => {
    const req = createRequest({
      movie_title: 'The Batman',
      tmdb_id: 12345,
      imdb_id: null,
      year: 2022,
      poster_url: null,
      approval_channel_id: 'C_APPROVAL',
      requester_slack_id: 'U_REQUESTER',
    });
    updateRequestStatus({ id: req.id, status: 'rejected', approver_slack_id: 'U_OTHER_APPROVER' });

    registerRejectMovieAction(app as any, defaultDeps);
    const { body, ack, respond, client } = mockActionPayload('12345');
    await app.getHandler(ACTION_IDS.REJECT_MOVIE)!({ body, ack, respond, client });

    expect(client.chat.postMessage).not.toHaveBeenCalled();
    expect(client.chat.update).not.toHaveBeenCalled();
  });

  it('updates DB status to rejected on happy path', async () => {
    seedPendingRequest();
    registerRejectMovieAction(app as any, defaultDeps);
    const { body, ack, respond, client } = mockActionPayload('12345');
    await app.getHandler(ACTION_IDS.REJECT_MOVIE)!({ body, ack, respond, client });

    const updated = getRequestByTmdbId(12345);
    expect(updated!.status).toBe('rejected');
    expect(updated!.approver_slack_id).toBe('U_APPROVER');
  });

  it('updates approval message in Slack on happy path', async () => {
    seedPendingRequest('111.222');
    registerRejectMovieAction(app as any, defaultDeps);
    const { body, ack, respond, client } = mockActionPayload('12345');
    await app.getHandler(ACTION_IDS.REJECT_MOVIE)!({ body, ack, respond, client });

    expect(client.chat.update).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'C_APPROVAL', ts: '111.222' }),
    );
  });

  it('DMs the requester on happy path', async () => {
    seedPendingRequest();
    registerRejectMovieAction(app as any, defaultDeps);
    const { body, ack, respond, client } = mockActionPayload('12345');
    await app.getHandler(ACTION_IDS.REJECT_MOVIE)!({ body, ack, respond, client });

    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'U_REQUESTER',
        text: expect.stringContaining('rejected'),
      }),
    );
  });
});
