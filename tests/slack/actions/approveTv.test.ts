import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { registerApproveTvAction } from '../../../src/slack/actions/approveTv';
import {
  _resetDb,
  getDb,
  createTvRequest,
  getTvRequestByTvdbId,
  updateTvRequestStatus,
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

function mockActionPayload(tvdbIdStr: string, userId = 'U_APPROVER') {
  return {
    body: {
      channel: { id: 'C_APPROVAL' },
      message: { ts: '111.222' },
      user: { id: userId },
      actions: [{ action_id: ACTION_IDS.APPROVE_TV, value: 'request:1' }],
    },
    ack: mock(async () => {}),
    respond: mock(async (_: any) => {}),
    client: {
      chat: {
        postMessage: mock(async (_: any) => ({ ts: '333.444', ok: true })),
        update: mock(async (_: any) => ({ ok: true })),
      },
    },
  };
}

const mockShowData = {
  title: 'Breaking Bad',
  year: 2008,
  tvdbId: 81189,
  titleSlug: 'breaking-bad',
  overview: 'A high school chemistry teacher diagnosed with lung cancer.',
  network: 'AMC',
  seasons: [
    { seasonNumber: 0, monitored: false },
    { seasonNumber: 1, monitored: true },
  ],
  images: [{ coverType: 'poster', remoteUrl: 'https://example.com/poster.jpg' }],
};

function createMockSonarrClient() {
  return {
    searchSeries: mock(async (_: string) => [mockShowData]),
    addSeries: mock(async (_: any, __: number, ___: string) => ({
      id: 1,
      title: 'Breaking Bad',
      year: 2008,
      tvdbId: 81189,
      monitored: true,
      status: 'ended',
    })),
    seriesExists: mock(async (_: number) => false),
  };
}

const defaultDeps = {
  approverSlackIds: ['U_APPROVER'],
  approvalChannelId: 'C_APPROVAL',
  qualityProfileId: 1,
  rootFolderPath: '/tv',
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

describe('approveTv action', () => {
  let app: ReturnType<typeof createMockApp>;
  let sonarrClient: ReturnType<typeof createMockSonarrClient>;

  beforeEach(() => {
    _setLoggerOutput({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} });
    _resetDb();
    getDb(':memory:');
    app = createMockApp();
    sonarrClient = createMockSonarrClient();
  });

  it('calls ack() immediately', async () => {
    seedPendingTvRequest();
    registerApproveTvAction(app as any, { ...defaultDeps, sonarrClient: sonarrClient as any });
    const { body, ack, respond, client } = mockActionPayload('81189');
    await app.getHandler(ACTION_IDS.APPROVE_TV)!({ body, ack, respond, client });
    expect(ack).toHaveBeenCalledTimes(1);
  });

  it('responds ephemerally when user is not an approver', async () => {
    registerApproveTvAction(app as any, { ...defaultDeps, sonarrClient: sonarrClient as any });
    const { body, ack, respond, client } = mockActionPayload('81189', 'U_UNAUTHORIZED');
    await app.getHandler(ACTION_IDS.APPROVE_TV)!({ body, ack, respond, client });

    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('not authorized') }),
    );
    expect(sonarrClient.addSeries).not.toHaveBeenCalled();
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
    updateTvRequestStatus({
      id: req.id,
      status: 'approved',
      approver_slack_id: 'U_OTHER_APPROVER',
    });

    registerApproveTvAction(app as any, { ...defaultDeps, sonarrClient: sonarrClient as any });
    const { body, ack, respond, client } = mockActionPayload('81189');
    await app.getHandler(ACTION_IDS.APPROVE_TV)!({ body, ack, respond, client });

    expect(sonarrClient.addSeries).not.toHaveBeenCalled();
    expect(client.chat.postMessage).not.toHaveBeenCalled();
  });

  it('calls sonarr.addSeries with show data on happy path', async () => {
    seedPendingTvRequest();
    registerApproveTvAction(app as any, { ...defaultDeps, sonarrClient: sonarrClient as any });
    const { body, ack, respond, client } = mockActionPayload('81189');
    await app.getHandler(ACTION_IDS.APPROVE_TV)!({ body, ack, respond, client });

    expect(sonarrClient.addSeries).toHaveBeenCalledWith(
      expect.objectContaining({ tvdbId: 81189 }),
      defaultDeps.qualityProfileId,
      defaultDeps.rootFolderPath,
    );
  });

  it('updates DB status to approved on happy path', async () => {
    seedPendingTvRequest();
    registerApproveTvAction(app as any, { ...defaultDeps, sonarrClient: sonarrClient as any });
    const { body, ack, respond, client } = mockActionPayload('81189');
    await app.getHandler(ACTION_IDS.APPROVE_TV)!({ body, ack, respond, client });

    const updated = getTvRequestByTvdbId(81189);
    expect(updated!.status).toBe('approved');
    expect(updated!.approver_slack_id).toBe('U_APPROVER');
  });

  it('updates approval message in Slack on happy path', async () => {
    seedPendingTvRequest('111.222');
    registerApproveTvAction(app as any, { ...defaultDeps, sonarrClient: sonarrClient as any });
    const { body, ack, respond, client } = mockActionPayload('81189');
    await app.getHandler(ACTION_IDS.APPROVE_TV)!({ body, ack, respond, client });

    expect(client.chat.update).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'C_APPROVAL', ts: '111.222' }),
    );
  });

  it('DMs the requester on happy path', async () => {
    seedPendingTvRequest();
    registerApproveTvAction(app as any, { ...defaultDeps, sonarrClient: sonarrClient as any });
    const { body, ack, respond, client } = mockActionPayload('81189');
    await app.getHandler(ACTION_IDS.APPROVE_TV)!({ body, ack, respond, client });

    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'U_REQUESTER',
        text: expect.stringContaining('approved'),
      }),
    );
  });
});
