import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { registerTvCommand } from '../../../src/slack/commands/tv';
import { getTvResults } from '../../../src/core/searchCache';
import { _setLoggerOutput } from '../../../src/logger';

function createMockApp() {
  const handlers: Record<string, Function> = {};
  return {
    command: (name: string, handler: Function) => {
      handlers[name] = handler;
    },
    getHandler: (name: string) => handlers[name],
  };
}

function createMockSonarrClient(searchResults: any[] = []) {
  return {
    searchSeries: mock(async (_query: string) => searchResults),
  };
}

function mockCommandPayload(text: string, userId = 'U_TEST') {
  return {
    command: {
      text,
      user_id: userId,
      command: '/tv',
    },
    ack: mock(async () => {}),
    respond: mock(async (_payload: any) => {}),
  };
}

const mockShowResults = [
  {
    title: 'Breaking Bad',
    year: 2008,
    tvdbId: 81189,
    titleSlug: 'breaking-bad',
    seasons: [{ seasonNumber: 1, monitored: true }],
    images: [],
  },
  {
    title: 'Bad Boys',
    year: 2014,
    tvdbId: 99999,
    titleSlug: 'bad-boys',
    seasons: [{ seasonNumber: 1, monitored: true }],
    images: [],
  },
];

describe('/tv command', () => {
  let app: ReturnType<typeof createMockApp>;
  let sonarrClient: ReturnType<typeof createMockSonarrClient>;

  beforeEach(() => {
    _setLoggerOutput({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} });
    app = createMockApp();
    sonarrClient = createMockSonarrClient(mockShowResults);
    registerTvCommand(app as any, {
      sonarrClient: sonarrClient as any,
      approvalChannelId: 'C_APPROVAL',
    });
  });

  it('calls ack() immediately', async () => {
    const { command, ack, respond } = mockCommandPayload('breaking bad');
    const handler = app.getHandler('/tv');
    await handler!({ command, ack, respond });
    expect(ack).toHaveBeenCalledTimes(1);
  });

  it('responds with error message when no query text', async () => {
    const { command, ack, respond } = mockCommandPayload('  ');
    const handler = app.getHandler('/tv');
    await handler!({ command, ack, respond });

    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('Usage:') }),
    );
    expect(sonarrClient.searchSeries).not.toHaveBeenCalled();
  });

  it('searches Sonarr with the query text', async () => {
    const { command, ack, respond } = mockCommandPayload('breaking bad');
    const handler = app.getHandler('/tv');
    await handler!({ command, ack, respond });

    expect(sonarrClient.searchSeries).toHaveBeenCalledWith('breaking bad');
  });

  it('stores search results in TV cache keyed by userId', async () => {
    const { command, ack, respond } = mockCommandPayload('breaking bad', 'U_TESTER');
    const handler = app.getHandler('/tv');
    await handler!({ command, ack, respond });

    const cached = getTvResults('U_TESTER');
    expect(cached).not.toBeNull();
    expect(cached![0]!.title).toBe('Breaking Bad');
  });

  it('responds with blocks containing search results', async () => {
    const { command, ack, respond } = mockCommandPayload('breaking bad');
    const handler = app.getHandler('/tv');
    await handler!({ command, ack, respond });

    const respondCalls = (respond as any).mock.calls;
    const lastCall = respondCalls[respondCalls.length - 1][0];
    expect(lastCall.blocks).toBeDefined();
    expect(lastCall.blocks.length).toBeGreaterThan(0);
  });

  it('responds with no-results message when Sonarr returns empty', async () => {
    const emptyClient = createMockSonarrClient([]);
    registerTvCommand(app as any, {
      sonarrClient: emptyClient as any,
      approvalChannelId: 'C_APPROVAL',
    });

    const { command, ack, respond } = mockCommandPayload('xyznotatvshow');
    const handler = app.getHandler('/tv');
    await handler!({ command, ack, respond });

    const respondCalls = (respond as any).mock.calls;
    const lastCall = respondCalls[respondCalls.length - 1][0];
    expect(lastCall.text).toContain('No results found');
  });

  it('responds with error message on Sonarr failure', async () => {
    const failingClient = {
      searchSeries: mock(async () => {
        throw new Error('Connection refused');
      }),
    };
    registerTvCommand(app as any, {
      sonarrClient: failingClient as any,
      approvalChannelId: 'C_APPROVAL',
    });

    const { command, ack, respond } = mockCommandPayload('breaking bad');
    const handler = app.getHandler('/tv');
    await handler!({ command, ack, respond });

    const respondCalls = (respond as any).mock.calls;
    const lastCall = respondCalls[respondCalls.length - 1][0];
    expect(lastCall.text).toContain('Failed to search');
  });

  it('responds with not-configured message when deps is null', async () => {
    registerTvCommand(app as any, null);

    const { command, ack, respond } = mockCommandPayload('breaking bad');
    const handler = app.getHandler('/tv');
    await handler!({ command, ack, respond });

    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('not configured') }),
    );
  });
});
