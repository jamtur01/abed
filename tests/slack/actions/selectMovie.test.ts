import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { registerSelectMovieAction } from '../../../src/slack/actions/selectMovie';
import { storeResults, clearResults } from '../../../src/core/searchCache';
import { _resetDb, getDb, getRequestByTmdbId } from '../../../src/db/index';
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

function mockActionPayload(tmdbIdStr: string, userId = 'U_TEST') {
  return {
    body: {
      user: { id: userId },
      actions: [{ action_id: ACTION_IDS.SELECT_MOVIE, value: tmdbIdStr }],
    },
    ack: mock(async () => {}),
    respond: mock(async (_: any) => {}),
    client: {
      chat: {
        postMessage: mock(async (_: any) => ({ ts: '111.222', ok: true })),
        update: mock(async (_: any) => ({ ok: true })),
      },
    },
  };
}

const mockMovie = {
  title: 'The Batman',
  year: 2022,
  tmdbId: 12345,
  imdbId: 'tt1877830',
  remotePoster: 'https://example.com/poster.jpg',
  overview: 'Bruce Wayne fights crime.',
  titleSlug: 'the-batman',
  images: [],
};

function createMockRadarrClient(exists = false) {
  return {
    movieExists: mock(async (_: number) => exists),
    searchMovies: mock(async (_: string) => [mockMovie]),
    addMovie: mock(async (_: any, __: number, ___: string) => ({
      id: 1,
      title: 'The Batman',
      year: 2022,
      tmdbId: 12345,
      monitored: true,
      status: 'released',
    })),
  };
}

describe('selectMovie action', () => {
  let app: ReturnType<typeof createMockApp>;
  let radarrClient: ReturnType<typeof createMockRadarrClient>;

  beforeEach(() => {
    _setLoggerOutput({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} });
    _resetDb();
    getDb(':memory:');
    app = createMockApp();
    radarrClient = createMockRadarrClient(false);
    clearResults('U_TEST');
    clearResults('U_CACHED');
  });

  it('calls ack() immediately', async () => {
    storeResults('U_TEST', [mockMovie]);
    registerSelectMovieAction(app as any, {
      radarrClient: radarrClient as any,
      approvalChannelId: 'C_APPROVAL',
    });
    const { body, ack, respond, client } = mockActionPayload('12345');
    await app.getHandler(ACTION_IDS.SELECT_MOVIE)!({ body, ack, respond, client });
    expect(ack).toHaveBeenCalledTimes(1);
  });

  it('responds ephemerally when cache is expired/missing', async () => {
    registerSelectMovieAction(app as any, {
      radarrClient: radarrClient as any,
      approvalChannelId: 'C_APPROVAL',
    });
    const { body, ack, respond, client } = mockActionPayload('12345');
    await app.getHandler(ACTION_IDS.SELECT_MOVIE)!({ body, ack, respond, client });

    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('expired') }),
    );
    expect(client.chat.postMessage).not.toHaveBeenCalled();
  });

  it('responds ephemerally when movie already in library', async () => {
    const existingClient = createMockRadarrClient(true);
    storeResults('U_TEST', [mockMovie]);
    registerSelectMovieAction(app as any, {
      radarrClient: existingClient as any,
      approvalChannelId: 'C_APPROVAL',
    });
    const { body, ack, respond, client } = mockActionPayload('12345');
    await app.getHandler(ACTION_IDS.SELECT_MOVIE)!({ body, ack, respond, client });

    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('already in the library') }),
    );
    expect(client.chat.postMessage).not.toHaveBeenCalled();
  });

  it('posts approval message to approval channel on happy path', async () => {
    storeResults('U_TEST', [mockMovie]);
    registerSelectMovieAction(app as any, {
      radarrClient: radarrClient as any,
      approvalChannelId: 'C_APPROVAL',
    });
    const { body, ack, respond, client } = mockActionPayload('12345');
    await app.getHandler(ACTION_IDS.SELECT_MOVIE)!({ body, ack, respond, client });

    expect(client.chat.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'C_APPROVAL' }),
    );
  });

  it('stores DB request and message ts on happy path', async () => {
    storeResults('U_TEST', [mockMovie]);
    registerSelectMovieAction(app as any, {
      radarrClient: radarrClient as any,
      approvalChannelId: 'C_APPROVAL',
    });
    const { body, ack, respond, client } = mockActionPayload('12345');
    await app.getHandler(ACTION_IDS.SELECT_MOVIE)!({ body, ack, respond, client });

    const dbRequest = getRequestByTmdbId(12345);
    expect(dbRequest).not.toBeNull();
    expect(dbRequest!.movie_title).toBe('The Batman');
    expect(dbRequest!.slack_message_ts).toBe('111.222');
  });

  it('clears search cache after successful request', async () => {
    storeResults('U_TEST', [mockMovie]);
    registerSelectMovieAction(app as any, {
      radarrClient: radarrClient as any,
      approvalChannelId: 'C_APPROVAL',
    });
    const { body, ack, respond, client } = mockActionPayload('12345');
    await app.getHandler(ACTION_IDS.SELECT_MOVIE)!({ body, ack, respond, client });

    const { getResults } = await import('../../../src/core/searchCache');
    expect(getResults('U_TEST')).toBeNull();
  });

  it('responds with confirmation after successful request', async () => {
    storeResults('U_TEST', [mockMovie]);
    registerSelectMovieAction(app as any, {
      radarrClient: radarrClient as any,
      approvalChannelId: 'C_APPROVAL',
    });
    const { body, ack, respond, client } = mockActionPayload('12345');
    await app.getHandler(ACTION_IDS.SELECT_MOVIE)!({ body, ack, respond, client });

    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('submitted for approval') }),
    );
  });
});
