import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import {
  getDb,
  _resetDb,
  createRequest,
  updateRequestStatus,
  createTvRequest,
  updateTvRequestStatus,
  getRequest,
  getTvRequest,
} from '../src/db/index';
import { startPoller, stopPoller, _resetPoller } from '../src/poller';
import type { RadarrClient } from '../src/radarr/client';
import type { SonarrClient } from '../src/sonarr/client';
import type { WebClient } from '@slack/web-api';
import type { Client as DiscordClient } from 'discord.js';

const POLL_MS = 50;

function makeSlack() {
  const postMessage = mock(async (_: { channel: string; text: string }) => ({ ts: '111.222', ok: true }));
  const client = { chat: { postMessage } } as unknown as WebClient;
  return { client, postMessage };
}

function makeSlackThrowing() {
  const postMessage = mock(async (_: { channel: string; text: string }): Promise<never> => {
    throw new Error('DMs are disabled');
  });
  const client = { chat: { postMessage } } as unknown as WebClient;
  return { client, postMessage };
}

function makeDiscordUser() {
  const send = mock(async (_: string) => ({}));
  return { send };
}

function makeDiscordUserThrowing() {
  const send = mock(async (_: string): Promise<never> => {
    throw new Error('Cannot send messages to this user');
  });
  return { send };
}

function makeDiscord(user: { send: ReturnType<typeof mock> }) {
  const fetchUser = mock(async (_: string) => user);
  const client = { users: { fetch: fetchUser } } as unknown as DiscordClient;
  return { client, fetchUser };
}

function makeRadarr(hasFile = true) {
  const getMovieByTmdbId = mock(async (_: number) => ({
    title: 'The Batman',
    year: 2022,
    tmdbId: 12345,
    hasFile,
  }));
  const client = { getMovieByTmdbId } as unknown as RadarrClient;
  return { client, getMovieByTmdbId };
}

function makeRadarrNotFound() {
  const getMovieByTmdbId = mock(async (_: number) => null);
  const client = { getMovieByTmdbId } as unknown as RadarrClient;
  return { client, getMovieByTmdbId };
}

function makeSonarr(episodeFileCount = 5) {
  const getSeriesByTvdbId = mock(async (_: number) => ({
    title: 'Breaking Bad',
    year: 2008,
    tvdbId: 81189,
    statistics: { episodeFileCount, episodeCount: 62 },
  }));
  const client = { getSeriesByTvdbId } as unknown as SonarrClient;
  return { client, getSeriesByTvdbId };
}

async function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

beforeEach(() => {
  _resetPoller();
  _resetDb();
  getDb(':memory:');
});

afterEach(() => {
  stopPoller();
});

describe('poller — Slack movie notifications', () => {
  it('sends Slack DM and marks notified when movie is downloaded', async () => {
    const slack = makeSlack();
    const radarr = makeRadarr(true);

    const req = createRequest({
      movie_title: 'The Batman',
      tmdb_id: 12345,
      year: 2022,
      requester_slack_id: 'U_SLACK_USER',
      platform: 'slack',
    });
    updateRequestStatus({ id: req.id, status: 'approved', approver_slack_id: 'U_APPROVER' });

    startPoller({
      slackClient: slack.client,
      discordClient: null,
      radarrClient: radarr.client,
      sonarrClient: null,
      pollIntervalMs: POLL_MS,
    });

    await wait(POLL_MS * 2);

    expect(slack.postMessage).toHaveBeenCalledTimes(1);
    const call = slack.postMessage.mock.calls[0]![0];
    expect(call.channel).toBe('U_SLACK_USER');
    expect(call.text).toBe(':popcorn: *The Batman (2022)* is ready to watch!');

    const updated = getRequest(req.id);
    expect(updated!.downloaded_notified).toBe(1);
  });

  it('does not notify twice when poller fires again after first notification', async () => {
    const slack = makeSlack();
    const radarr = makeRadarr(true);

    const req = createRequest({
      movie_title: 'The Batman',
      tmdb_id: 12345,
      year: 2022,
      requester_slack_id: 'U_SLACK_USER',
      platform: 'slack',
    });
    updateRequestStatus({ id: req.id, status: 'approved', approver_slack_id: 'U_APPROVER' });

    startPoller({
      slackClient: slack.client,
      discordClient: null,
      radarrClient: radarr.client,
      sonarrClient: null,
      pollIntervalMs: POLL_MS,
    });

    await wait(POLL_MS * 4);

    expect(slack.postMessage).toHaveBeenCalledTimes(1);
  });
});

describe('poller — Discord movie notifications', () => {
  it('fetches Discord user, sends DM, and marks notified when movie is downloaded', async () => {
    const discordUser = makeDiscordUser();
    const discord = makeDiscord(discordUser);
    const radarr = makeRadarr(true);

    const req = createRequest({
      movie_title: 'The Batman',
      tmdb_id: 12345,
      year: 2022,
      requester_slack_id: 'DISCORD_USER_123',
      platform: 'discord',
    });
    updateRequestStatus({ id: req.id, status: 'approved', approver_slack_id: 'DISCORD_APPROVER' });

    startPoller({
      slackClient: null,
      discordClient: discord.client,
      radarrClient: radarr.client,
      sonarrClient: null,
      pollIntervalMs: POLL_MS,
    });

    await wait(POLL_MS * 2);

    expect(discord.fetchUser).toHaveBeenCalledWith('DISCORD_USER_123');
    expect(discordUser.send).toHaveBeenCalledTimes(1);
    expect(discordUser.send.mock.calls[0]![0]).toBe('🍿 **The Batman (2022)** is ready to watch!');

    const updated = getRequest(req.id);
    expect(updated!.downloaded_notified).toBe(1);
  });
});

describe('poller — Slack TV notifications', () => {
  it('sends Slack DM and marks notified when TV series has episodes', async () => {
    const slack = makeSlack();
    const radarr = makeRadarr(false);
    const sonarr = makeSonarr(5);

    const req = createTvRequest({
      show_title: 'Breaking Bad',
      tvdb_id: 81189,
      year: 2008,
      requester_slack_id: 'U_SLACK_USER',
      platform: 'slack',
    });
    updateTvRequestStatus({ id: req.id, status: 'approved', approver_slack_id: 'U_APPROVER' });

    startPoller({
      slackClient: slack.client,
      discordClient: null,
      radarrClient: radarr.client,
      sonarrClient: sonarr.client,
      pollIntervalMs: POLL_MS,
    });

    await wait(POLL_MS * 2);

    expect(slack.postMessage).toHaveBeenCalledTimes(1);
    const call = slack.postMessage.mock.calls[0]![0];
    expect(call.channel).toBe('U_SLACK_USER');
    expect(call.text).toBe(':tv: *Breaking Bad (2008)* has started downloading! (5/62 episodes available)');

    const updated = getTvRequest(req.id);
    expect(updated!.downloaded_notified).toBe(1);
  });
});

describe('poller — Discord TV notifications', () => {
  it('fetches Discord user, sends TV DM, and marks notified when episodes are available', async () => {
    const discordUser = makeDiscordUser();
    const discord = makeDiscord(discordUser);
    const radarr = makeRadarr(false);
    const sonarr = makeSonarr(5);

    const req = createTvRequest({
      show_title: 'Breaking Bad',
      tvdb_id: 81189,
      year: 2008,
      requester_slack_id: 'DISCORD_USER_456',
      platform: 'discord',
    });
    updateTvRequestStatus({ id: req.id, status: 'approved', approver_slack_id: 'DISCORD_APPROVER' });

    startPoller({
      slackClient: null,
      discordClient: discord.client,
      radarrClient: radarr.client,
      sonarrClient: sonarr.client,
      pollIntervalMs: POLL_MS,
    });

    await wait(POLL_MS * 2);

    expect(discord.fetchUser).toHaveBeenCalledWith('DISCORD_USER_456');
    expect(discordUser.send).toHaveBeenCalledTimes(1);
    expect(discordUser.send.mock.calls[0]![0]).toBe(
      '📺 **Breaking Bad (2008)** has started downloading! (5/62 episodes available)',
    );

    const updated = getTvRequest(req.id);
    expect(updated!.downloaded_notified).toBe(1);
  });
});

describe('poller — missing client handling', () => {
  it('does not mark notified when Discord request has no discordClient', async () => {
    const radarr = makeRadarr(true);

    const req = createRequest({
      movie_title: 'The Batman',
      tmdb_id: 12345,
      year: 2022,
      requester_slack_id: 'DISCORD_USER_123',
      platform: 'discord',
    });
    updateRequestStatus({ id: req.id, status: 'approved', approver_slack_id: 'DISCORD_APPROVER' });

    startPoller({
      slackClient: null,
      discordClient: null,
      radarrClient: radarr.client,
      sonarrClient: null,
      pollIntervalMs: POLL_MS,
    });

    await wait(POLL_MS * 2);

    const updated = getRequest(req.id);
    expect(updated!.downloaded_notified).toBe(0);
  });

  it('does not mark notified when Slack request has no slackClient', async () => {
    const discordUser = makeDiscordUser();
    const discord = makeDiscord(discordUser);
    const radarr = makeRadarr(true);

    const req = createRequest({
      movie_title: 'The Batman',
      tmdb_id: 12345,
      year: 2022,
      requester_slack_id: 'U_SLACK_USER',
      platform: 'slack',
    });
    updateRequestStatus({ id: req.id, status: 'approved', approver_slack_id: 'U_APPROVER' });

    startPoller({
      slackClient: null,
      discordClient: discord.client,
      radarrClient: radarr.client,
      sonarrClient: null,
      pollIntervalMs: POLL_MS,
    });

    await wait(POLL_MS * 2);

    const updated = getRequest(req.id);
    expect(updated!.downloaded_notified).toBe(0);
  });
});

describe('poller — send failure handling', () => {
  it('does not mark notified when Slack postMessage throws', async () => {
    const slack = makeSlackThrowing();
    const radarr = makeRadarr(true);

    const req = createRequest({
      movie_title: 'The Batman',
      tmdb_id: 12345,
      year: 2022,
      requester_slack_id: 'U_SLACK_USER',
      platform: 'slack',
    });
    updateRequestStatus({ id: req.id, status: 'approved', approver_slack_id: 'U_APPROVER' });

    startPoller({
      slackClient: slack.client,
      discordClient: null,
      radarrClient: radarr.client,
      sonarrClient: null,
      pollIntervalMs: POLL_MS,
    });

    await wait(POLL_MS * 2);

    const updated = getRequest(req.id);
    expect(updated!.downloaded_notified).toBe(0);
  });

  it('does not mark notified when Discord user.send throws', async () => {
    const discordUser = makeDiscordUserThrowing();
    const discord = makeDiscord(discordUser);
    const radarr = makeRadarr(true);

    const req = createRequest({
      movie_title: 'The Batman',
      tmdb_id: 12345,
      year: 2022,
      requester_slack_id: 'DISCORD_USER_123',
      platform: 'discord',
    });
    updateRequestStatus({ id: req.id, status: 'approved', approver_slack_id: 'DISCORD_APPROVER' });

    startPoller({
      slackClient: null,
      discordClient: discord.client,
      radarrClient: radarr.client,
      sonarrClient: null,
      pollIntervalMs: POLL_MS,
    });

    await wait(POLL_MS * 2);

    const updated = getRequest(req.id);
    expect(updated!.downloaded_notified).toBe(0);
  });
});

describe('poller — Radarr/Sonarr state handling', () => {
  it('skips gracefully when movie not found in Radarr', async () => {
    const slack = makeSlack();
    const radarr = makeRadarrNotFound();

    const req = createRequest({
      movie_title: 'The Batman',
      tmdb_id: 12345,
      year: 2022,
      requester_slack_id: 'U_SLACK_USER',
      platform: 'slack',
    });
    updateRequestStatus({ id: req.id, status: 'approved', approver_slack_id: 'U_APPROVER' });

    startPoller({
      slackClient: slack.client,
      discordClient: null,
      radarrClient: radarr.client,
      sonarrClient: null,
      pollIntervalMs: POLL_MS,
    });

    await wait(POLL_MS * 2);

    expect(slack.postMessage).not.toHaveBeenCalled();
    const updated = getRequest(req.id);
    expect(updated!.downloaded_notified).toBe(0);
  });

  it('skips gracefully when movie not yet downloaded (hasFile=false)', async () => {
    const slack = makeSlack();
    const radarr = makeRadarr(false);

    const req = createRequest({
      movie_title: 'The Batman',
      tmdb_id: 12345,
      year: 2022,
      requester_slack_id: 'U_SLACK_USER',
      platform: 'slack',
    });
    updateRequestStatus({ id: req.id, status: 'approved', approver_slack_id: 'U_APPROVER' });

    startPoller({
      slackClient: slack.client,
      discordClient: null,
      radarrClient: radarr.client,
      sonarrClient: null,
      pollIntervalMs: POLL_MS,
    });

    await wait(POLL_MS * 2);

    expect(slack.postMessage).not.toHaveBeenCalled();
    const updated = getRequest(req.id);
    expect(updated!.downloaded_notified).toBe(0);
  });

  it('skips gracefully when TV series has no episodes yet (episodeFileCount=0)', async () => {
    const slack = makeSlack();
    const radarr = makeRadarr(false);
    const sonarr = makeSonarr(0);

    const req = createTvRequest({
      show_title: 'Breaking Bad',
      tvdb_id: 81189,
      year: 2008,
      requester_slack_id: 'U_SLACK_USER',
      platform: 'slack',
    });
    updateTvRequestStatus({ id: req.id, status: 'approved', approver_slack_id: 'U_APPROVER' });

    startPoller({
      slackClient: slack.client,
      discordClient: null,
      radarrClient: radarr.client,
      sonarrClient: sonarr.client,
      pollIntervalMs: POLL_MS,
    });

    await wait(POLL_MS * 2);

    expect(slack.postMessage).not.toHaveBeenCalled();
    const updated = getTvRequest(req.id);
    expect(updated!.downloaded_notified).toBe(0);
  });

  it('skips TV polls entirely when sonarrClient is null', async () => {
    const slack = makeSlack();
    const radarr = makeRadarr(false);

    const tvReq = createTvRequest({
      show_title: 'Breaking Bad',
      tvdb_id: 81189,
      year: 2008,
      requester_slack_id: 'U_SLACK_USER',
      platform: 'slack',
    });
    updateTvRequestStatus({ id: tvReq.id, status: 'approved', approver_slack_id: 'U_APPROVER' });

    startPoller({
      slackClient: slack.client,
      discordClient: null,
      radarrClient: radarr.client,
      sonarrClient: null,
      pollIntervalMs: POLL_MS,
    });

    await wait(POLL_MS * 2);

    const updated = getTvRequest(tvReq.id);
    expect(updated!.downloaded_notified).toBe(0);
  });
});

describe('poller — lifecycle', () => {
  it('prevents duplicate starts', async () => {
    const slack = makeSlack();
    const radarr = makeRadarr(false);
    const duplicate = makeRadarr(false);

    const deps = {
      slackClient: slack.client,
      discordClient: null,
      radarrClient: radarr.client,
      sonarrClient: null,
      pollIntervalMs: POLL_MS,
    };

    startPoller(deps);
    startPoller({ ...deps, radarrClient: duplicate.client });
    startPoller({ ...deps, radarrClient: duplicate.client });

    const req = createRequest({
      movie_title: 'The Batman',
      tmdb_id: 12345,
      year: 2022,
      requester_slack_id: 'U_SLACK_USER',
      platform: 'slack',
    });
    updateRequestStatus({ id: req.id, status: 'approved', approver_slack_id: 'U_APPROVER' });

    await wait(POLL_MS * 2);

    expect(radarr.getMovieByTmdbId).toHaveBeenCalled();
    expect(duplicate.getMovieByTmdbId).not.toHaveBeenCalled();
  });

  it('stopPoller clears the timer and halts polling', async () => {
    const slack = makeSlack();
    const radarr = makeRadarr(true);

    const req = createRequest({
      movie_title: 'The Batman',
      tmdb_id: 12345,
      year: 2022,
      requester_slack_id: 'U_SLACK_USER',
      platform: 'slack',
    });
    updateRequestStatus({ id: req.id, status: 'approved', approver_slack_id: 'U_APPROVER' });

    startPoller({
      slackClient: slack.client,
      discordClient: null,
      radarrClient: radarr.client,
      sonarrClient: null,
      pollIntervalMs: POLL_MS,
    });

    stopPoller();

    await wait(POLL_MS * 3);

    expect(slack.postMessage).not.toHaveBeenCalled();
  });
});
