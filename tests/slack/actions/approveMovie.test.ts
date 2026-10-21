import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { registerApproveMovieAction } from '../../../src/slack/actions/approveMovie';
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
      actions: [{ action_id: ACTION_IDS.APPROVE_MOVIE, value: 'request:1' }],
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

const mockMovieData = {
  title: 'The Batman',
  year: 2022,
  tmdbId: 12345,
  imdbId: 'tt1877830',
  remotePoster: 'https://example.com/poster.jpg',
  overview: 'Bruce Wayne fights crime.',
  titleSlug: 'the-batman',
  images: [],
};

function createMockRadarrClient() {
  return {
    searchMovies: mock(async (_: string) => [mockMovieData]),
    addMovie: mock(async (_: any, __: number, ___: string) => ({
      id: 1,
      title: 'The Batman',
      year: 2022,
      tmdbId: 12345,
      monitored: true,
      status: 'released',
    })),
    movieExists: mock(async (_: number) => false),
  };
}

const defaultDeps = {
  approverSlackIds: ['U_APPROVER'],
  approvalChannelId: 'C_APPROVAL',
  qualityProfileId: 1,
  rootFolderPath: '/movies',
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

describe('approveMovie action', () => {
  let app: ReturnType<typeof createMockApp>;
  let radarrClient: ReturnType<typeof createMockRadarrClient>;

  beforeEach(() => {
    _setLoggerOutput({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} });
    _resetDb();
    getDb(':memory:');
    app = createMockApp();
    radarrClient = createMockRadarrClient();
  });

  it('calls ack() immediately', async () => {
    seedPendingRequest();
    registerApproveMovieAction(app as any, { ...defaultDeps, radarrClient: radarrClient as any });
    const { body, ack, respond, client } = mockActionPayload('12345');
    await app.getHandler(ACTION_IDS.APPROVE_MOVIE)!({ body, ack, respond, client });
    expect(ack).toHaveBeenCalledTimes(1);
  });

  it('responds ephemerally when user is not an approver', async () => {
    registerApproveMovieAction(app as any, { ...defaultDeps, radarrClient: radarrClient as any });
    const { body, ack, respond, client } = mockActionPayload('12345', 'U_UNAUTHORIZED');
    await app.getHandler(ACTION_IDS.APPROVE_MOVIE)!({ body, ack, respond, client });

    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('not authorized') }),
    );
    expect(radarrClient.addMovie).not.toHaveBeenCalled();
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
    updateRequestStatus({ id: req.id, status: 'approved', approver_slack_id: 'U_OTHER_APPROVER' });

    registerApproveMovieAction(app as any, { ...defaultDeps, radarrClient: radarrClient as any });
    const { body, ack, respond, client } = mockActionPayload('12345');
    await app.getHandler(ACTION_IDS.APPROVE_MOVIE)!({ body, ack, respond, client });

    expect(radarrClient.addMovie).not.toHaveBeenCalled();
    expect(client.chat.postMessage).not.toHaveBeenCalled();
  });

  it('calls radarr.addMovie with movie data on happy path', async () => {
    seedPendingRequest();
    registerApproveMovieAction(app as any, { ...defaultDeps, radarrClient: radarrClient as any });
    const { body, ack, respond, client } = mockActionPayload('12345');
    await app.getHandler(ACTION_IDS.APPROVE_MOVIE)!({ body, ack, respond, client });

    expect(radarrClient.addMovie).toHaveBeenCalledWith(
      expect.objectContaining({ tmdbId: 12345 }),
      defaultDeps.qualityProfileId,
      defaultDeps.rootFolderPath,
    );
  });

  it('updates DB status to approved on happy path', async () => {
    seedPendingRequest();
    registerApproveMovieAction(app as any, { ...defaultDeps, radarrClient: radarrClient as any });
    const { body, ack, respond, client } = mockActionPayload('12345');
    await app.getHandler(ACTION_IDS.APPROVE_MOVIE)!({ body, ack, respond, client });

    const updated = getRequestByTmdbId(12345);
    expect(updated!.status).toBe('approved');
    expect(updated!.approver_slack_id).toBe('U_APPROVER');
  });

  it('updates approval message in Slack on happy path', async () => {
    seedPendingRequest('111.222');
    registerApproveMovieAction(app as any, { ...defaultDeps, radarrClient: radarrClient as any });
    const { body, ack, respond, client } = mockActionPayload('12345');
    await app.getHandler(ACTION_IDS.APPROVE_MOVIE)!({ body, ack, respond, client });

    expect(client.chat.update).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'C_APPROVAL', ts: '111.222' }),
    );
  });

  it('DMs the requester on happy path', async () => {
    seedPendingRequest();
    registerApproveMovieAction(app as any, { ...defaultDeps, radarrClient: radarrClient as any });
    const { body, ack, respond, client } = mockActionPayload('12345');
    await app.getHandler(ACTION_IDS.APPROVE_MOVIE)!({ body, ack, respond, client });

    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'U_REQUESTER',
        text: expect.stringContaining('approved'),
      }),
    );
  });
  it('rejects mismatched channel, message, platform and legacy button values', async () => {
    const request = seedPendingRequest();
    registerApproveMovieAction(app as any, { ...defaultDeps, radarrClient: radarrClient as any });
    for (const change of [
      (p: any) => {
        p.body.channel.id = 'OTHER';
      },
      (p: any) => {
        p.body.message.ts = 'other.message';
      },
      (p: any) => {
        p.body.actions[0].value = '12345';
      },
      () => {
        getDb().run("UPDATE requests SET platform='discord' WHERE id=?", [request.id]);
      },
    ]) {
      const payload = mockActionPayload('12345');
      change(payload);
      await app.getHandler(ACTION_IDS.APPROVE_MOVIE)!(payload);
      expect(radarrClient.addMovie).not.toHaveBeenCalled();
    }
  });

  it('does not let an old button decide a later request for the same title', async () => {
    const first = seedPendingRequest();
    updateRequestStatus({ id: first.id, status: 'rejected' });
    const second = seedPendingRequest('later.message');
    registerApproveMovieAction(app as any, { ...defaultDeps, radarrClient: radarrClient as any });
    await app.getHandler(ACTION_IDS.APPROVE_MOVIE)!(mockActionPayload('12345'));
    expect(getRequestByTmdbId(12345)?.id).toBe(second.id);
    expect(getRequestByTmdbId(12345)?.status).toBe('pending');
    expect(radarrClient.addMovie).not.toHaveBeenCalled();
  });
});
