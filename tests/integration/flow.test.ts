import { describe, it, expect, mock, beforeEach } from 'bun:test';

import { registerMovieCommand }       from '../../src/slack/commands/movie';
import { registerSelectMovieAction }  from '../../src/slack/actions/selectMovie';
import { registerApproveMovieAction } from '../../src/slack/actions/approveMovie';
import { registerRejectMovieAction }  from '../../src/slack/actions/rejectMovie';
import { registerTvCommand }          from '../../src/slack/commands/tv';
import { registerSelectTvAction }     from '../../src/slack/actions/selectTv';
import { registerApproveTvAction }    from '../../src/slack/actions/approveTv';
import { registerRejectTvAction }     from '../../src/slack/actions/rejectTv';

import { storeResults, clearResults, getResults, storeTvResults, clearTvResults, getTvResults } from '../../src/core/searchCache';
import { _resetDb, getDb, getRequestByTmdbId, getTvRequestByTvdbId } from '../../src/db/index';
import { ACTION_IDS } from '../../src/slack/messages/index';
import type { RadarrSearchResult } from '../../src/radarr/types';
import type { SonarrSearchResult } from '../../src/sonarr/types';

const APPROVAL_CHANNEL = 'C_APPROVAL';
const REQUESTER_ID     = 'U_REQUESTER';
const APPROVER_ID      = 'U_APPROVER';
const TMDB_ID          = 12345;

const mockMovie: RadarrSearchResult = {
  title:        'The Batman',
  year:         2022,
  tmdbId:       TMDB_ID,
  imdbId:       'tt1877830',
  remotePoster: 'https://example.com/poster.jpg',
  overview:     'Bruce Wayne fights crime.',
  titleSlug:    'the-batman',
  images:       [],
};

function createMockApp() {
  const handlers: Record<string, Function> = {};
  const commands: Record<string, Function> = {};
  return {
    action:     (id: string,  handler: Function) => { handlers[id]  = handler; },
    command:    (cmd: string, handler: Function) => { commands[cmd] = handler; },
    getHandler: (id: string)  => handlers[id],
    getCommand: (cmd: string) => commands[cmd],
  };
}

function createMockClient() {
  return {
    chat: {
      postMessage: mock(async (_: any) => ({ ts: '111.222', ok: true })),
      update:      mock(async (_: any) => ({ ok: true })),
    },
    conversations: {
      join: mock(async (_: any) => ({ ok: true })),
    },
  };
}

function createMockRadarrClient(movieExistsResult = false) {
  return {
    searchMovies: mock(async (_: string) => [mockMovie]),
    addMovie:     mock(async (_: any, __: number, ___: string) => ({
      id: 1, title: 'The Batman', year: 2022, tmdbId: TMDB_ID, monitored: true, status: 'released',
    })),
    movieExists:  mock(async (_: number) => movieExistsResult),
  };
}

function mockCommandPayload(text: string, userId = REQUESTER_ID) {
  return {
    command: { text, user_id: userId },
    ack:     mock(async () => {}),
    respond: mock(async (_: any) => {}),
  };
}

function mockActionPayload(actionId: string, value: string, userId = APPROVER_ID, client = createMockClient()) {
  return {
    body: { channel: { id: APPROVAL_CHANNEL }, message: { ts: '111.222' }, user: { id: userId }, actions: [{ action_id: actionId, value: /^(approve|reject)_/.test(actionId) ? 'request:1' : value }] },
    ack:     mock(async () => {}),
    respond: mock(async (_: any) => {}),
    client,
  };
}

const defaultApproveDeps = {
  approverSlackIds:  [APPROVER_ID],
  approvalChannelId: APPROVAL_CHANNEL,
  qualityProfileId:  1,
  rootFolderPath:    '/movies',
};

const defaultRejectDeps = {
  approverSlackIds:  [APPROVER_ID],
  approvalChannelId: APPROVAL_CHANNEL,
};

async function runSelectMovie(
  app: ReturnType<typeof createMockApp>,
  radarrClient: ReturnType<typeof createMockRadarrClient>,
  client = createMockClient(),
) {
  storeResults(REQUESTER_ID, [mockMovie]);
  registerSelectMovieAction(app as any, { radarrClient: radarrClient as any, approvalChannelId: APPROVAL_CHANNEL });
  const p = mockActionPayload(ACTION_IDS.SELECT_MOVIE, String(TMDB_ID), REQUESTER_ID, client);
  await app.getHandler(ACTION_IDS.SELECT_MOVIE)!({ body: p.body, ack: p.ack, respond: p.respond, client });
}

describe('End-to-end movie-request flow', () => {
  let app:          ReturnType<typeof createMockApp>;
  let radarrClient: ReturnType<typeof createMockRadarrClient>;

  beforeEach(() => {
    _resetDb();
    getDb(':memory:');
    clearResults(REQUESTER_ID);
    app          = createMockApp();
    radarrClient = createMockRadarrClient(false);
  });

  it('Step 1: /movie command searches Radarr, caches results, responds with blocks', async () => {
    registerMovieCommand(app as any, { radarrClient: radarrClient as any, approvalChannelId: APPROVAL_CHANNEL });
    const { command, ack, respond } = mockCommandPayload('The Batman', REQUESTER_ID);
    await app.getCommand('/movie')!({ command, ack, respond });

    expect(ack).toHaveBeenCalledTimes(1);
    expect(radarrClient.searchMovies).toHaveBeenCalledWith('The Batman');

    const cached = getResults(REQUESTER_ID);
    expect(cached).not.toBeNull();
    expect(cached?.[0]?.tmdbId).toBe(TMDB_ID);

    const respondCalls = (respond as ReturnType<typeof mock>).mock.calls;
    expect(respondCalls.length).toBeGreaterThanOrEqual(2);
    const lastRespondArg = (respondCalls[respondCalls.length - 1] ?? [])[0] as any;
    expect(lastRespondArg).toHaveProperty('blocks');
  });

  it('Step 2: selectMovie posts approval message and creates pending DB record', async () => {
    storeResults(REQUESTER_ID, [mockMovie]);
    registerSelectMovieAction(app as any, { radarrClient: radarrClient as any, approvalChannelId: APPROVAL_CHANNEL });

    const client = createMockClient();
    const { body, ack, respond } = mockActionPayload(ACTION_IDS.SELECT_MOVIE, String(TMDB_ID), REQUESTER_ID, client);
    await app.getHandler(ACTION_IDS.SELECT_MOVIE)!({ body, ack, respond, client });

    expect(ack).toHaveBeenCalledTimes(1);
    expect(radarrClient.movieExists).toHaveBeenCalledWith(TMDB_ID);
    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channel: APPROVAL_CHANNEL }),
    );

    const dbRequest = getRequestByTmdbId(TMDB_ID);
    expect(dbRequest).not.toBeNull();
    expect(dbRequest!.movie_title).toBe('The Batman');
    expect(dbRequest!.requester_slack_id).toBe(REQUESTER_ID);
    expect(dbRequest!.slack_message_ts).toBe('111.222');
    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('submitted for approval') }),
    );
  });

  it("Step 3 (approve): addMovie called, DB approved, requester DM'd", async () => {
    await runSelectMovie(app, radarrClient);
    registerApproveMovieAction(app as any, { ...defaultApproveDeps, radarrClient: radarrClient as any });

    const approveClient = createMockClient();
    const p = mockActionPayload(ACTION_IDS.APPROVE_MOVIE, String(TMDB_ID), APPROVER_ID, approveClient);
    await app.getHandler(ACTION_IDS.APPROVE_MOVIE)!({ body: p.body, ack: p.ack, respond: p.respond, client: approveClient });

    expect(radarrClient.addMovie).toHaveBeenCalledTimes(1);
    expect(radarrClient.addMovie).toHaveBeenCalledWith(
      expect.objectContaining({ tmdbId: TMDB_ID }),
      defaultApproveDeps.qualityProfileId,
      defaultApproveDeps.rootFolderPath,
    );

    const dbRequest = getRequestByTmdbId(TMDB_ID);
    expect(dbRequest!.status).toBe('approved');
    expect(dbRequest!.approver_slack_id).toBe(APPROVER_ID);
    expect(approveClient.chat.update).toHaveBeenCalledWith(
      expect.objectContaining({ channel: APPROVAL_CHANNEL, ts: '111.222' }),
    );
    expect(approveClient.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channel: REQUESTER_ID, text: expect.stringContaining('approved') }),
    );
  });

  it("Step 4 (reject): DB rejected, requester DM'd, addMovie NOT called", async () => {
    await runSelectMovie(app, radarrClient);
    registerRejectMovieAction(app as any, defaultRejectDeps);

    const rejectClient = createMockClient();
    const p = mockActionPayload(ACTION_IDS.REJECT_MOVIE, String(TMDB_ID), APPROVER_ID, rejectClient);
    await app.getHandler(ACTION_IDS.REJECT_MOVIE)!({ body: p.body, ack: p.ack, respond: p.respond, client: rejectClient });

    expect(radarrClient.addMovie).not.toHaveBeenCalled();

    const dbRequest = getRequestByTmdbId(TMDB_ID);
    expect(dbRequest!.status).toBe('rejected');
    expect(dbRequest!.approver_slack_id).toBe(APPROVER_ID);
    expect(rejectClient.chat.update).toHaveBeenCalledWith(
      expect.objectContaining({ channel: APPROVAL_CHANNEL, ts: '111.222' }),
    );
    expect(rejectClient.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channel: REQUESTER_ID, text: expect.stringContaining('rejected') }),
    );
  });

  it('Race-condition guard: second Approve after first calls addMovie only once', async () => {
    await runSelectMovie(app, radarrClient);
    registerApproveMovieAction(app as any, { ...defaultApproveDeps, radarrClient: radarrClient as any });

    const handler = app.getHandler(ACTION_IDS.APPROVE_MOVIE)!;

    const firstClient = createMockClient();
    const first = mockActionPayload(ACTION_IDS.APPROVE_MOVIE, String(TMDB_ID), APPROVER_ID, firstClient);
    await handler({ body: first.body, ack: first.ack, respond: first.respond, client: firstClient });

    const secondClient = createMockClient();
    const second = mockActionPayload(ACTION_IDS.APPROVE_MOVIE, String(TMDB_ID), APPROVER_ID, secondClient);
    await handler({ body: second.body, ack: second.ack, respond: second.respond, client: secondClient });

    expect(radarrClient.addMovie).toHaveBeenCalledTimes(1);
    expect(secondClient.chat.postMessage).not.toHaveBeenCalled();
  });
});

describe('IMDB movie-request flow', () => {
  let app:          ReturnType<typeof createMockApp>;
  let radarrClient: ReturnType<typeof createMockRadarrClient>;

  beforeEach(() => {
    _resetDb();
    getDb(':memory:');
    clearResults(REQUESTER_ID);
    app          = createMockApp();
    radarrClient = createMockRadarrClient(false);
  });

  it('IMDB bare ID → approval posted, DB record has imdb_id set', async () => {
    radarrClient.searchMovies = mock(async (_: string) => [mockMovie]);
    registerMovieCommand(app as any, { radarrClient: radarrClient as any, approvalChannelId: APPROVAL_CHANNEL });

    const client = createMockClient();
    const { command, ack, respond } = mockCommandPayload('tt1877830', REQUESTER_ID);
    await app.getCommand('/movie')!({ command, ack, respond, client });

    expect(radarrClient.searchMovies).toHaveBeenCalledWith('imdb:tt1877830');
    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channel: APPROVAL_CHANNEL }),
    );
    const dbRecord = getRequestByTmdbId(TMDB_ID);
    expect(dbRecord).not.toBeNull();
    expect(dbRecord!.imdb_id).toBe('tt1877830');
    expect(dbRecord!.requester_slack_id).toBe(REQUESTER_ID);
    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('submitted for approval') }),
    );
  });

  it('IMDB flow → approve works end-to-end', async () => {
    radarrClient.searchMovies = mock(async (_: string) => [mockMovie]);
    registerMovieCommand(app as any, { radarrClient: radarrClient as any, approvalChannelId: APPROVAL_CHANNEL });
    registerApproveMovieAction(app as any, { ...defaultApproveDeps, radarrClient: radarrClient as any });

    const submitClient = createMockClient();
    const { command, ack, respond } = mockCommandPayload('tt1877830', REQUESTER_ID);
    await app.getCommand('/movie')!({ command, ack, respond, client: submitClient });

    const approveClient = createMockClient();
    const p = mockActionPayload(ACTION_IDS.APPROVE_MOVIE, String(TMDB_ID), APPROVER_ID, approveClient);
    await app.getHandler(ACTION_IDS.APPROVE_MOVIE)!({ body: p.body, ack: p.ack, respond: p.respond, client: approveClient });

    expect(radarrClient.addMovie).toHaveBeenCalledTimes(1);
    const dbRecord = getRequestByTmdbId(TMDB_ID);
    expect(dbRecord!.status).toBe('approved');
    expect(dbRecord!.imdb_id).toBe('tt1877830');
  });
});

// --- TV Show Integration Tests ---

const TVDB_ID = 81189;

const mockShow: SonarrSearchResult = {
  title:     'Breaking Bad',
  year:      2008,
  tvdbId:    TVDB_ID,
  titleSlug: 'breaking-bad',
  overview:  'A high school chemistry teacher diagnosed with lung cancer.',
  network:   'AMC',
  seasons: [
    { seasonNumber: 0, monitored: false },
    { seasonNumber: 1, monitored: true },
    { seasonNumber: 2, monitored: true },
    { seasonNumber: 3, monitored: true },
    { seasonNumber: 4, monitored: true },
    { seasonNumber: 5, monitored: true },
  ],
  images: [
    { coverType: 'poster', remoteUrl: 'https://example.com/bb-poster.jpg' },
  ],
};

function createMockSonarrClient(seriesExistsResult = false) {
  return {
    searchSeries:  mock(async (_: string) => [mockShow]),
    addSeries:     mock(async (_: any, __: number, ___: string) => ({
      id: 1, title: 'Breaking Bad', year: 2008, tvdbId: TVDB_ID, monitored: true, status: 'ended',
    })),
    seriesExists:  mock(async (_: number) => seriesExistsResult),
  };
}

const defaultTvApproveDeps = {
  approverSlackIds:  [APPROVER_ID],
  approvalChannelId: APPROVAL_CHANNEL,
  qualityProfileId:  1,
  rootFolderPath:    '/tv',
};

const defaultTvRejectDeps = {
  approverSlackIds:  [APPROVER_ID],
  approvalChannelId: APPROVAL_CHANNEL,
};

async function runSelectTv(
  app: ReturnType<typeof createMockApp>,
  sonarrClient: ReturnType<typeof createMockSonarrClient>,
  client = createMockClient(),
) {
  storeTvResults(REQUESTER_ID, [mockShow]);
  registerSelectTvAction(app as any, { sonarrClient: sonarrClient as any, approvalChannelId: APPROVAL_CHANNEL });
  const p = mockActionPayload(ACTION_IDS.SELECT_TV, String(TVDB_ID), REQUESTER_ID, client);
  await app.getHandler(ACTION_IDS.SELECT_TV)!({ body: p.body, ack: p.ack, respond: p.respond, client });
}

describe('End-to-end TV-show-request flow', () => {
  let app:          ReturnType<typeof createMockApp>;
  let sonarrClient: ReturnType<typeof createMockSonarrClient>;

  beforeEach(() => {
    _resetDb();
    getDb(':memory:');
    clearTvResults(REQUESTER_ID);
    app          = createMockApp();
    sonarrClient = createMockSonarrClient(false);
  });

  it('Step 1: /tv command searches Sonarr, caches results, responds with blocks', async () => {
    registerTvCommand(app as any, { sonarrClient: sonarrClient as any, approvalChannelId: APPROVAL_CHANNEL });
    const { command, ack, respond } = mockCommandPayload('Breaking Bad', REQUESTER_ID);
    await app.getCommand('/tv')!({ command, ack, respond });

    expect(ack).toHaveBeenCalledTimes(1);
    expect(sonarrClient.searchSeries).toHaveBeenCalledWith('Breaking Bad');

    const cached = getTvResults(REQUESTER_ID);
    expect(cached).not.toBeNull();
    expect(cached?.[0]?.tvdbId).toBe(TVDB_ID);

    const respondCalls = (respond as ReturnType<typeof mock>).mock.calls;
    expect(respondCalls.length).toBeGreaterThanOrEqual(2);
    const lastRespondArg = (respondCalls[respondCalls.length - 1] ?? [])[0] as any;
    expect(lastRespondArg).toHaveProperty('blocks');
  });

  it('Step 2: selectTv posts approval message and creates pending DB record', async () => {
    storeTvResults(REQUESTER_ID, [mockShow]);
    registerSelectTvAction(app as any, { sonarrClient: sonarrClient as any, approvalChannelId: APPROVAL_CHANNEL });

    const client = createMockClient();
    const { body, ack, respond } = mockActionPayload(ACTION_IDS.SELECT_TV, String(TVDB_ID), REQUESTER_ID, client);
    await app.getHandler(ACTION_IDS.SELECT_TV)!({ body, ack, respond, client });

    expect(ack).toHaveBeenCalledTimes(1);
    expect(sonarrClient.seriesExists).toHaveBeenCalledWith(TVDB_ID);
    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channel: APPROVAL_CHANNEL }),
    );

    const dbRequest = getTvRequestByTvdbId(TVDB_ID);
    expect(dbRequest).not.toBeNull();
    expect(dbRequest!.show_title).toBe('Breaking Bad');
    expect(dbRequest!.requester_slack_id).toBe(REQUESTER_ID);
    expect(dbRequest!.slack_message_ts).toBe('111.222');
    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('submitted for approval') }),
    );
  });

  it("Step 3 (approve): addSeries called, DB approved, requester DM'd", async () => {
    await runSelectTv(app, sonarrClient);
    registerApproveTvAction(app as any, { ...defaultTvApproveDeps, sonarrClient: sonarrClient as any });

    const approveClient = createMockClient();
    const p = mockActionPayload(ACTION_IDS.APPROVE_TV, String(TVDB_ID), APPROVER_ID, approveClient);
    await app.getHandler(ACTION_IDS.APPROVE_TV)!({ body: p.body, ack: p.ack, respond: p.respond, client: approveClient });

    expect(sonarrClient.addSeries).toHaveBeenCalledTimes(1);
    expect(sonarrClient.addSeries).toHaveBeenCalledWith(
      expect.objectContaining({ tvdbId: TVDB_ID }),
      defaultTvApproveDeps.qualityProfileId,
      defaultTvApproveDeps.rootFolderPath,
    );

    const dbRequest = getTvRequestByTvdbId(TVDB_ID);
    expect(dbRequest!.status).toBe('approved');
    expect(dbRequest!.approver_slack_id).toBe(APPROVER_ID);
    expect(approveClient.chat.update).toHaveBeenCalledWith(
      expect.objectContaining({ channel: APPROVAL_CHANNEL, ts: '111.222' }),
    );
    expect(approveClient.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channel: REQUESTER_ID, text: expect.stringContaining('approved') }),
    );
  });

  it("Step 4 (reject): DB rejected, requester DM'd, addSeries NOT called", async () => {
    await runSelectTv(app, sonarrClient);
    registerRejectTvAction(app as any, defaultTvRejectDeps);

    const rejectClient = createMockClient();
    const p = mockActionPayload(ACTION_IDS.REJECT_TV, String(TVDB_ID), APPROVER_ID, rejectClient);
    await app.getHandler(ACTION_IDS.REJECT_TV)!({ body: p.body, ack: p.ack, respond: p.respond, client: rejectClient });

    expect(sonarrClient.addSeries).not.toHaveBeenCalled();

    const dbRequest = getTvRequestByTvdbId(TVDB_ID);
    expect(dbRequest!.status).toBe('rejected');
    expect(dbRequest!.approver_slack_id).toBe(APPROVER_ID);
    expect(rejectClient.chat.update).toHaveBeenCalledWith(
      expect.objectContaining({ channel: APPROVAL_CHANNEL, ts: '111.222' }),
    );
    expect(rejectClient.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channel: REQUESTER_ID, text: expect.stringContaining('rejected') }),
    );
  });

  it('Race-condition guard: second Approve after first calls addSeries only once', async () => {
    await runSelectTv(app, sonarrClient);
    registerApproveTvAction(app as any, { ...defaultTvApproveDeps, sonarrClient: sonarrClient as any });

    const handler = app.getHandler(ACTION_IDS.APPROVE_TV)!;

    const firstClient = createMockClient();
    const first = mockActionPayload(ACTION_IDS.APPROVE_TV, String(TVDB_ID), APPROVER_ID, firstClient);
    await handler({ body: first.body, ack: first.ack, respond: first.respond, client: firstClient });

    const secondClient = createMockClient();
    const second = mockActionPayload(ACTION_IDS.APPROVE_TV, String(TVDB_ID), APPROVER_ID, secondClient);
    await handler({ body: second.body, ack: second.ack, respond: second.respond, client: secondClient });

    expect(sonarrClient.addSeries).toHaveBeenCalledTimes(1);
    expect(secondClient.chat.postMessage).not.toHaveBeenCalled();
  });

  it('/tv responds with not-configured when sonarr deps are null', async () => {
    registerTvCommand(app as any, null);
    const { command, ack, respond } = mockCommandPayload('Breaking Bad', REQUESTER_ID);
    await app.getCommand('/tv')!({ command, ack, respond });

    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('not configured') }),
    );
  });
});
