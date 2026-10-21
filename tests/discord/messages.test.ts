import { describe, expect, test } from 'bun:test';
import {
  buildApprovalRequestEmbed,
  buildApprovedEmbed,
  buildRejectedEmbed,
  buildTvApprovalRequestEmbed,
  buildTvApprovedEmbed,
  buildTvRejectedEmbed,
  buildMyRequestsEmbed,
  buildQueueEmbed,
  buildMovieCarouselPage,
  buildTvCarouselPage,
} from '../../src/discord/messages/index';

import type { RadarrSearchResult } from '../../src/radarr/types';
import type { SonarrSearchResult } from '../../src/sonarr/types';
import type { MovieRequest, TvRequest } from '../../src/db/types';

describe('Discord Message Builders', () => {
  describe('Movie Messages', () => {
    test('buildApprovalRequestEmbed > includes title, year, requester, and buttons', () => {
      const movie: RadarrSearchResult = { title: 'The Matrix', year: 1999, tmdbId: 123, remotePoster: 'http://img.com/a.jpg', overview: 'A great movie.', titleSlug: 'the-matrix', images: [] };
      const msg = buildApprovalRequestEmbed(movie, 'U123', 42);
      
      const embed = msg.embeds[0]!.data;
      expect(embed.title).toBe('Movie Request: The Matrix (1999)');
      expect(embed.description).toInclude('<@U123>');
      expect(embed.thumbnail?.url).toBe('http://img.com/a.jpg');
      expect(embed.fields?.[0]!.value).toBe('123'); // TMDB ID
      
      const row = msg.components[0]!.toJSON();
      expect(row.components.length).toBe(2);
      expect(row.components[0]!.type).toBe(2); // Button
      expect((row.components[0] as { custom_id: string }).custom_id).toBe('approve_movie_request_42');
      expect((row.components[1] as { custom_id: string }).custom_id).toBe('reject_movie_request_42');
    });

    test('buildApprovedEmbed > formats correctly', () => {
      const req: MovieRequest = { id: 1, movie_title: 'The Matrix', year: 1999, tmdb_id: 123, requester_slack_id: 'U123', status: 'approved', created_at: '', updated_at: '', poster_url: null, imdb_id: null, approver_slack_id: null, slack_message_ts: null, downloaded_notified: 0, approval_channel_id: null, platform: 'discord' };
      const msg = buildApprovedEmbed(req, 'A123');
      const embed = msg.embeds[0]!.data;
      
      expect(embed.title).toBe('Movie Request: The Matrix (1999)');
      expect(embed.fields?.[1]!.value).toInclude('Approved by <@A123>');
    });

    test('buildRejectedEmbed > formats correctly', () => {
      const req: MovieRequest = { id: 1, movie_title: 'The Matrix', year: 1999, tmdb_id: 123, requester_slack_id: 'U123', status: 'rejected', created_at: '', updated_at: '', poster_url: null, imdb_id: null, approver_slack_id: null, slack_message_ts: null, downloaded_notified: 0, approval_channel_id: null, platform: 'discord' };
      const msg = buildRejectedEmbed(req, 'A123');
      const embed = msg.embeds[0]!.data;
      
      expect(embed.title).toBe('Movie Request: The Matrix (1999)');
      expect(embed.fields?.[1]!.value).toInclude('Rejected by <@A123>');
    });
  });

  describe('TV Messages', () => {
    test('buildTvApprovalRequestEmbed > includes buttons', () => {
      const show: SonarrSearchResult = { title: 'Breaking Bad', year: 2008, tvdbId: 456, titleSlug: 'bb', seasons: [], images: [] };
      const msg = buildTvApprovalRequestEmbed(show, 'U123', 42);
      
      const row = msg.components[0]!.toJSON();
      expect((row.components[0] as { custom_id: string }).custom_id).toBe('approve_tv_request_42');
      expect((row.components[1] as { custom_id: string }).custom_id).toBe('reject_tv_request_42');
    });

    test('buildTvApprovedEmbed > formats correctly', () => {
      const req: TvRequest = { id: 1, show_title: 'Breaking Bad', year: 2008, tvdb_id: 456, requester_slack_id: 'U123', status: 'approved', created_at: '', updated_at: '', poster_url: null, approver_slack_id: null, slack_message_ts: null, downloaded_notified: 0, approval_channel_id: null, platform: 'discord' };
      const msg = buildTvApprovedEmbed(req, 'A123');
      expect(msg.embeds[0]!.data.fields?.[1]!.value).toInclude('Approved by <@A123>');
    });

    test('buildTvRejectedEmbed > formats correctly', () => {
      const req: TvRequest = { id: 1, show_title: 'Breaking Bad', year: 2008, tvdb_id: 456, requester_slack_id: 'U123', status: 'rejected', created_at: '', updated_at: '', poster_url: null, approver_slack_id: null, slack_message_ts: null, downloaded_notified: 0, approval_channel_id: null, platform: 'discord' };
      const msg = buildTvRejectedEmbed(req, 'A123');
      expect(msg.embeds[0]!.data.fields?.[1]!.value).toInclude('Rejected by <@A123>');
    });
  });

  describe('My Requests Message', () => {
    test('buildMyRequestsEmbed > returns empty state', () => {
      const msg = buildMyRequestsEmbed([]);
      expect(msg.embeds[0]!.data.description).toInclude('no requests matching');
    });

    test('buildMyRequestsEmbed > formats list of mixed requests', () => {
      const reqs: (MovieRequest | TvRequest)[] = [
        { id: 1, movie_title: 'The Matrix', year: 1999, tmdb_id: 123, requester_slack_id: 'U123', status: 'pending', created_at: '2023-01-01', updated_at: '', poster_url: null, imdb_id: null, approver_slack_id: null, slack_message_ts: null, downloaded_notified: 0, approval_channel_id: null, platform: 'discord' },
        { id: 2, show_title: 'Breaking Bad', year: 2008, tvdb_id: 456, requester_slack_id: 'U123', status: 'approved', created_at: '2023-01-02', updated_at: '', poster_url: null, approver_slack_id: null, slack_message_ts: null, downloaded_notified: 0, approval_channel_id: null, platform: 'discord' },
      ];
      
      const msg = buildMyRequestsEmbed(reqs);
      const embed = msg.embeds[0]!.data;
      
      expect(embed.title).toBe('Your Requests (2)');
      expect(embed.fields?.length).toBe(2);
      expect(embed.fields?.[0]!.name).toInclude('🎬 The Matrix (1999)');
      expect(embed.fields?.[0]!.value).toInclude('⏳ pending');
      expect(embed.fields?.[1]!.name).toInclude('📺 Breaking Bad (2008)');
      expect(embed.fields?.[1]!.value).toInclude('✅ approved');
    });
  });

  describe('buildMovieCarouselPage', () => {
    const mockMovie: RadarrSearchResult = {
      title: 'The Matrix',
      year: 1999,
      tmdbId: 603,
      titleSlug: 'the-matrix',
      images: [],
      overview: 'A computer hacker learns about the true nature of reality.',
      remotePoster: 'https://example.com/matrix.jpg',
      studio: 'Warner Bros',
    };

    test('no results → returns no-results embed with empty components', () => {
      const result = buildMovieCarouselPage([], 0);
      expect(result.embeds.length).toBe(1);
      expect(result.embeds[0]!.data.description).toInclude('No results found');
      expect(result.components.length).toBe(0);
    });

    test('single result → embed has title/year, both Prev and Next disabled, Select enabled', () => {
      const result = buildMovieCarouselPage([mockMovie], 0);
      const embed = result.embeds[0]!.data;
      expect(embed.title).toBe('The Matrix (1999)');
      expect(result.components.length).toBe(1);
      const row = result.components[0]!.toJSON();
      const prev = row.components[0] as { disabled?: boolean };
      const next = row.components[1] as { disabled?: boolean };
      const select = row.components[2] as { disabled?: boolean };
      expect(prev.disabled).toBe(true);
      expect(next.disabled).toBe(true);
      expect(select.disabled).toBeFalsy();
    });

    test('multiple results, index 0 → Prev disabled, Next enabled, footer "Result 1 of N"', () => {
      const results = [mockMovie, { ...mockMovie, title: 'The Matrix Reloaded', tmdbId: 604 }];
      const result = buildMovieCarouselPage(results, 0);
      const embed = result.embeds[0]!.data;
      expect(embed.footer?.text).toBe('Result 1 of 2');
      const row = result.components[0]!.toJSON();
      const prev = row.components[0] as { disabled?: boolean };
      const next = row.components[1] as { disabled?: boolean };
      expect(prev.disabled).toBe(true);
      expect(next.disabled).toBe(false);
    });

    test('multiple results, last index → Prev enabled, Next disabled, footer "Result N of N"', () => {
      const results = [mockMovie, { ...mockMovie, title: 'The Matrix Reloaded', tmdbId: 604 }];
      const result = buildMovieCarouselPage(results, 1);
      const embed = result.embeds[0]!.data;
      expect(embed.footer?.text).toBe('Result 2 of 2');
      const row = result.components[0]!.toJSON();
      const prev = row.components[0] as { disabled?: boolean };
      const next = row.components[1] as { disabled?: boolean };
      expect(prev.disabled).toBe(false);
      expect(next.disabled).toBe(true);
    });

    test('middle index → both Prev and Next enabled', () => {
      const results = [
        mockMovie,
        { ...mockMovie, title: 'The Matrix Reloaded', tmdbId: 604 },
        { ...mockMovie, title: 'The Matrix Revolutions', tmdbId: 605 },
      ];
      const result = buildMovieCarouselPage(results, 1);
      const row = result.components[0]!.toJSON();
      const prev = row.components[0] as { disabled?: boolean };
      const next = row.components[1] as { disabled?: boolean };
      expect(prev.disabled).toBe(false);
      expect(next.disabled).toBe(false);
    });

    test('movie with poster → embed has thumbnail', () => {
      const result = buildMovieCarouselPage([mockMovie], 0);
      expect(result.embeds[0]!.data.thumbnail?.url).toBe('https://example.com/matrix.jpg');
    });

    test('movie without poster → embed has no thumbnail', () => {
      const noPoster: RadarrSearchResult = { ...mockMovie, remotePoster: undefined };
      const result = buildMovieCarouselPage([noPoster], 0);
      expect(result.embeds[0]!.data.thumbnail).toBeUndefined();
    });

    test('overview truncated to 1024 chars', () => {
      const longOverview = 'x'.repeat(2000);
      const movie: RadarrSearchResult = { ...mockMovie, overview: longOverview };
      const result = buildMovieCarouselPage([movie], 0);
      expect(result.embeds[0]!.data.description?.length).toBe(1024);
    });

    test('button customIds use movie_ prefix with index', () => {
      const results = [mockMovie, { ...mockMovie, title: 'Sequel', tmdbId: 604 }];
      const result = buildMovieCarouselPage(results, 1);
      const row = result.components[0]!.toJSON();
      expect((row.components[0] as { custom_id: string }).custom_id).toBe('movie_prev_1');
      expect((row.components[1] as { custom_id: string }).custom_id).toBe('movie_next_1');
      expect((row.components[2] as { custom_id: string }).custom_id).toBe('movie_request_1');
    });
  });

  describe('buildTvCarouselPage', () => {
    const mockShow: SonarrSearchResult = {
      title: 'Breaking Bad',
      year: 2008,
      tvdbId: 81189,
      titleSlug: 'breaking-bad',
      network: 'AMC',
      overview: 'A chemistry teacher turned drug lord.',
      seasons: [
        { seasonNumber: 0, monitored: false },
        { seasonNumber: 1, monitored: true },
        { seasonNumber: 2, monitored: true },
        { seasonNumber: 3, monitored: true },
      ],
      images: [],
    };

    test('single result → correct fields (Network, Seasons, TVDB ID)', () => {
      const result = buildTvCarouselPage([mockShow], 0);
      const embed = result.embeds[0]!.data;
      expect(embed.title).toBe('Breaking Bad (2008)');
      const fields = embed.fields!;
      expect(fields[0]!.name).toBe('Network');
      expect(fields[0]!.value).toBe('AMC');
      expect(fields[1]!.name).toBe('Seasons');
      expect(fields[1]!.value).toBe('3');
      expect(fields[2]!.name).toBe('TVDB ID');
      expect(fields[2]!.value).toBe('81189');
    });

    test('TV with poster image → embed has thumbnail', () => {
      const showWithPoster: SonarrSearchResult = {
        ...mockShow,
        images: [{ coverType: 'poster', remoteUrl: 'https://example.com/bb.jpg' }],
      };
      const result = buildTvCarouselPage([showWithPoster], 0);
      expect(result.embeds[0]!.data.thumbnail?.url).toBe('https://example.com/bb.jpg');
    });

    test('TV without poster → no thumbnail', () => {
      const result = buildTvCarouselPage([mockShow], 0);
      expect(result.embeds[0]!.data.thumbnail).toBeUndefined();
    });

    test('seasons count excludes specials (seasonNumber 0)', () => {
      const result = buildTvCarouselPage([mockShow], 0);
      const fields = result.embeds[0]!.data.fields!;
      expect(fields[1]!.value).toBe('3');
    });

    test('button customIds use tv_ prefix', () => {
      const results = [mockShow, { ...mockShow, title: 'Better Call Saul', tvdbId: 99999 }];
      const result = buildTvCarouselPage(results, 1);
      const row = result.components[0]!.toJSON();
      expect((row.components[0] as { custom_id: string }).custom_id).toBe('tv_prev_1');
      expect((row.components[1] as { custom_id: string }).custom_id).toBe('tv_next_1');
      expect((row.components[2] as { custom_id: string }).custom_id).toBe('tv_request_1');
    });

    test('no results → returns no-results embed with empty components', () => {
      const result = buildTvCarouselPage([], 0);
      expect(result.embeds[0]!.data.description).toInclude('No results found');
      expect(result.components.length).toBe(0);
    });
  });
});

describe('buildQueueEmbed', () => {
  const movieReq: MovieRequest = {
    id: 1,
    movie_title: 'Inception',
    year: 2010,
    tmdb_id: 27205,
    requester_slack_id: 'U_MOVIE',
    status: 'pending',
    created_at: '2024-01-01T00:00:00',
    updated_at: '',
    poster_url: null,
    imdb_id: null,
    approver_slack_id: null,
    slack_message_ts: null,
    downloaded_notified: 0,
    approval_channel_id: null, platform: 'discord',
  };

  const tvReq: TvRequest = {
    id: 2,
    show_title: 'Breaking Bad',
    year: 2008,
    tvdb_id: 81189,
    requester_slack_id: 'U_TV',
    status: 'approved',
    created_at: '2024-01-02T00:00:00',
    updated_at: '',
    poster_url: null,
    approver_slack_id: null,
    slack_message_ts: null,
    downloaded_notified: 0,
    approval_channel_id: null, platform: 'discord',
  };

  test('returns no-requests-found embed when empty array', () => {
    const result = buildQueueEmbed([]);
    expect(result.embeds[0]!.data.description).toInclude('No requests found');
  });

  test('includes statusFilter in empty-state description when provided', () => {
    const result = buildQueueEmbed([], 'pending');
    expect(result.embeds[0]!.data.description).toInclude('pending');
  });

  test('returns embed with fields for each request', () => {
    const result = buildQueueEmbed([movieReq]);
    expect(result.embeds[0]!.data.fields?.length).toBe(1);
  });

  test('fields include requester mention', () => {
    const result = buildQueueEmbed([movieReq]);
    const fieldValue = result.embeds[0]!.data.fields![0]!.value;
    expect(fieldValue).toInclude('<@U_MOVIE>');
  });

  test('shows statusFilter in title when provided', () => {
    const result = buildQueueEmbed([movieReq], 'pending');
    expect(result.embeds[0]!.data.title).toInclude('pending');
  });

  test('includes both movie and TV request fields', () => {
    const result = buildQueueEmbed([movieReq, tvReq]);
    const fieldNames = result.embeds[0]!.data.fields!.map((f) => f.name).join('\n');
    expect(fieldNames).toInclude('Inception');
    expect(fieldNames).toInclude('Breaking Bad');
    expect(result.embeds[0]!.data.fields?.length).toBe(2);
  });

  test('movie fields use 🎬 icon', () => {
    const result = buildQueueEmbed([movieReq]);
    expect(result.embeds[0]!.data.fields![0]!.name).toInclude('🎬');
  });

  test('TV fields use 📺 icon', () => {
    const result = buildQueueEmbed([tvReq]);
    expect(result.embeds[0]!.data.fields![0]!.name).toInclude('📺');
  });
});
