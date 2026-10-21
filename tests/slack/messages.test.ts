import { describe, it, expect } from 'bun:test';
import {
  buildSearchResultsMessage,
  buildApprovalRequestMessage,
  buildApprovedMessage,
  buildRejectedMessage,
  buildTvSearchResultsMessage,
  buildTvApprovalRequestMessage,
  buildTvApprovedMessage,
  buildTvRejectedMessage,
  buildMyRequestsMessage,
  buildQueueMessage,
  ACTION_IDS,
} from '../../src/slack/messages/index';
import type { RadarrSearchResult } from '../../src/radarr/types';
import type { SonarrSearchResult } from '../../src/sonarr/types';
import type { MyRequestItem, QueueItem } from '../../src/slack/messages/index';

const mockMovie: RadarrSearchResult = {
  title: 'The Batman',
  year: 2022,
  tmdbId: 12345,
  titleSlug: 'the-batman',
  images: [],
  imdbId: 'tt1877830',
  remotePoster: 'https://example.com/poster.jpg',
  overview: 'When a sadistic serial killer begins murdering key political figures in Gotham...',
};

describe('buildSearchResultsMessage', () => {
  it('returns no-results message when empty array', () => {
    const blocks = buildSearchResultsMessage([]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: 'section' });
  });

  it('returns section + actions blocks per result', () => {
    const blocks = buildSearchResultsMessage([mockMovie]);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.type).toBe('section');
    expect(blocks[1]!.type).toBe('actions');
  });

  it('each result has a Request button with tmdbId value', () => {
    const blocks = buildSearchResultsMessage([mockMovie]);
    const actionsBlock = blocks[1] as any;
    expect(actionsBlock.elements[0].type).toBe('button');
    expect(actionsBlock.elements[0].action_id).toBe(ACTION_IDS.SELECT_MOVIE);
    expect(actionsBlock.elements[0].value).toBe('12345');
  });

  it('shows poster as section accessory when available', () => {
    const blocks = buildSearchResultsMessage([mockMovie]);
    const section = blocks[0] as any;
    expect(section.accessory).toBeDefined();
    expect(section.accessory.type).toBe('image');
    expect(section.accessory.image_url).toBe('https://example.com/poster.jpg');
  });

  it('omits accessory when no poster available', () => {
    const noPosterMovie = { ...mockMovie, remotePoster: undefined, images: [] };
    const blocks = buildSearchResultsMessage([noPosterMovie]);
    const section = blocks[0] as any;
    expect(section.accessory).toBeUndefined();
  });

  it('includes title and year in section text', () => {
    const blocks = buildSearchResultsMessage([mockMovie]);
    const section = blocks[0] as any;
    expect(section.text.text).toContain('The Batman');
    expect(section.text.text).toContain('2022');
  });

  it('truncates overview to 300 chars', () => {
    const longOverview = 'A'.repeat(400);
    const longMovie = { ...mockMovie, overview: longOverview };
    const blocks = buildSearchResultsMessage([longMovie]);
    const section = blocks[0] as any;
    expect(section.text.text).toContain('A'.repeat(300) + '...');
    expect(section.text.text).not.toContain('A'.repeat(301));
  });

  it('limits results to 5 movies', () => {
    const manyMovies = Array.from({ length: 30 }, (_, i) => ({
      ...mockMovie,
      tmdbId: i + 1,
      title: `Movie ${i + 1}`,
    }));
    const blocks = buildSearchResultsMessage(manyMovies);
    const actionBlocks = blocks.filter(b => b.type === 'actions');
    expect(actionBlocks).toHaveLength(5);
  });

  it('shows context header when more results than displayed', () => {
    const manyMovies = Array.from({ length: 10 }, (_, i) => ({
      ...mockMovie,
      tmdbId: i + 1,
      title: `Movie ${i + 1}`,
    }));
    const blocks = buildSearchResultsMessage(manyMovies);
    expect(blocks[0]!.type).toBe('context');
    expect((blocks[0] as any).elements[0].text).toContain('Showing 5 of 10');
  });

  it('does not show context header when 5 or fewer results', () => {
    const blocks = buildSearchResultsMessage([mockMovie]);
    expect(blocks[0]!.type).toBe('section');
  });
});

describe('buildApprovalRequestMessage', () => {
  it('includes title, year, and requester mention', () => {
    const blocks = buildApprovalRequestMessage(
      { title: 'The Batman', year: 2022, tmdbId: 12345, posterUrl: null },
      'U_REQUESTER',
      42,
    );
    const firstBlock = blocks[0] as any;
    expect(firstBlock.text.text).toContain('The Batman');
    expect(firstBlock.text.text).toContain('2022');
    expect(firstBlock.text.text).toContain('<@U_REQUESTER>');
  });

  it('includes approve and reject buttons', () => {
    const blocks = buildApprovalRequestMessage(
      { title: 'The Batman', year: 2022, tmdbId: 12345, posterUrl: null },
      'U_REQUESTER',
      42,
    );
    const actionsBlock = blocks.find((b) => b.type === 'actions') as any;
    expect(actionsBlock).toBeDefined();
    expect(actionsBlock.elements[0].action_id).toBe(ACTION_IDS.APPROVE_MOVIE);
    expect(actionsBlock.elements[1].action_id).toBe(ACTION_IDS.REJECT_MOVIE);
  });

  it('approve button has style primary and reject has danger', () => {
    const blocks = buildApprovalRequestMessage(
      { title: 'The Batman', year: 2022, tmdbId: 12345, posterUrl: null },
      'U_REQUESTER',
      42,
    );
    const actionsBlock = blocks.find((b) => b.type === 'actions') as any;
    expect(actionsBlock.elements[0].style).toBe('primary');
    expect(actionsBlock.elements[1].style).toBe('danger');
  });
});

describe('buildApprovedMessage', () => {
  it('includes approved text with approver mention', () => {
    const blocks = buildApprovedMessage({ title: 'The Batman', year: 2022 }, 'U_REQ', 'U_APP');
    const firstBlock = blocks[0] as any;
    expect(firstBlock.text.text).toContain('approved');
    expect(firstBlock.text.text).toContain('<@U_APP>');
    expect(firstBlock.text.text).toContain('<@U_REQ>');
  });
});

describe('buildRejectedMessage', () => {
  it('includes rejected text without reason', () => {
    const blocks = buildRejectedMessage({ title: 'The Batman', year: 2022 }, 'U_REQ', 'U_APP');
    const firstBlock = blocks[0] as any;
    expect(firstBlock.text.text).toContain('rejected');
    expect(firstBlock.text.text).not.toContain('Reason:');
  });

  it('includes reason when provided', () => {
    const blocks = buildRejectedMessage({ title: 'The Batman', year: 2022 }, 'U_REQ', 'U_APP', 'Already on Plex');
    const firstBlock = blocks[0] as any;
    expect(firstBlock.text.text).toContain('Reason: Already on Plex');
  });
});

const mockShow: SonarrSearchResult = {
  title: 'Breaking Bad',
  year: 2008,
  tvdbId: 81189,
  titleSlug: 'breaking-bad',
  overview: 'A high school chemistry teacher diagnosed with lung cancer...',
  network: 'AMC',
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
    { coverType: 'fanart', remoteUrl: 'https://example.com/bb-fanart.jpg' },
  ],
};

describe('buildTvSearchResultsMessage', () => {
  it('returns no-results message when empty array', () => {
    const blocks = buildTvSearchResultsMessage([]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ type: 'section' });
  });

  it('returns section + actions blocks per result', () => {
    const blocks = buildTvSearchResultsMessage([mockShow]);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]!.type).toBe('section');
    expect(blocks[1]!.type).toBe('actions');
  });

  it('each result has a Request button with tvdbId value', () => {
    const blocks = buildTvSearchResultsMessage([mockShow]);
    const actionsBlock = blocks[1] as any;
    expect(actionsBlock.elements[0].type).toBe('button');
    expect(actionsBlock.elements[0].action_id).toBe(ACTION_IDS.SELECT_TV);
    expect(actionsBlock.elements[0].value).toBe('81189');
  });

  it('shows poster as section accessory when available', () => {
    const blocks = buildTvSearchResultsMessage([mockShow]);
    const section = blocks[0] as any;
    expect(section.accessory).toBeDefined();
    expect(section.accessory.type).toBe('image');
    expect(section.accessory.image_url).toBe('https://example.com/bb-poster.jpg');
  });

  it('omits accessory when no poster available', () => {
    const noPosterShow = { ...mockShow, images: [] };
    const blocks = buildTvSearchResultsMessage([noPosterShow]);
    const section = blocks[0] as any;
    expect(section.accessory).toBeUndefined();
  });

  it('includes title, year, network, and season count in section text', () => {
    const blocks = buildTvSearchResultsMessage([mockShow]);
    const section = blocks[0] as any;
    expect(section.text.text).toContain('Breaking Bad');
    expect(section.text.text).toContain('2008');
    expect(section.text.text).toContain('AMC');
    expect(section.text.text).toContain('5 seasons');
  });

  it('excludes specials (season 0) from season count', () => {
    const blocks = buildTvSearchResultsMessage([mockShow]);
    const section = blocks[0] as any;
    expect(section.text.text).toContain('5 seasons');
  });

  it('shows singular "season" for single-season shows', () => {
    const singleSeason = { ...mockShow, seasons: [{ seasonNumber: 1, monitored: true }] };
    const blocks = buildTvSearchResultsMessage([singleSeason]);
    const section = blocks[0] as any;
    expect(section.text.text).toContain('1 season');
    expect(section.text.text).not.toContain('1 seasons');
  });

  it('truncates overview to 300 chars', () => {
    const longOverview = 'A'.repeat(400);
    const longShow = { ...mockShow, overview: longOverview };
    const blocks = buildTvSearchResultsMessage([longShow]);
    const section = blocks[0] as any;
    expect(section.text.text).toContain('A'.repeat(300) + '...');
    expect(section.text.text).not.toContain('A'.repeat(301));
  });

  it('limits results to 5 shows', () => {
    const manyShows = Array.from({ length: 30 }, (_, i) => ({
      ...mockShow,
      tvdbId: i + 1,
      title: `Show ${i + 1}`,
    }));
    const blocks = buildTvSearchResultsMessage(manyShows);
    const actionBlocks = blocks.filter(b => b.type === 'actions');
    expect(actionBlocks).toHaveLength(5);
  });

  it('shows context header when more results than displayed', () => {
    const manyShows = Array.from({ length: 10 }, (_, i) => ({
      ...mockShow,
      tvdbId: i + 1,
      title: `Show ${i + 1}`,
    }));
    const blocks = buildTvSearchResultsMessage(manyShows);
    expect(blocks[0]!.type).toBe('context');
    expect((blocks[0] as any).elements[0].text).toContain('Showing 5 of 10');
  });

  it('does not show context header when 5 or fewer results', () => {
    const blocks = buildTvSearchResultsMessage([mockShow]);
    expect(blocks[0]!.type).toBe('section');
  });
});

describe('buildTvApprovalRequestMessage', () => {
  it('includes title, year, and requester mention', () => {
    const blocks = buildTvApprovalRequestMessage(
      { title: 'Breaking Bad', year: 2008, tvdbId: 81189, posterUrl: null, seasonCount: 5 },
      'U_REQUESTER',
      42,
    );
    const firstBlock = blocks[0] as any;
    expect(firstBlock.text.text).toContain('Breaking Bad');
    expect(firstBlock.text.text).toContain('2008');
    expect(firstBlock.text.text).toContain('<@U_REQUESTER>');
  });

  it('includes network and season count', () => {
    const blocks = buildTvApprovalRequestMessage(
      { title: 'Breaking Bad', year: 2008, tvdbId: 81189, posterUrl: null, network: 'AMC', seasonCount: 5 },
      'U_REQUESTER',
      42,
    );
    const firstBlock = blocks[0] as any;
    expect(firstBlock.text.text).toContain('Network: AMC');
    expect(firstBlock.text.text).toContain('Seasons: 5');
  });

  it('has approve and reject buttons with correct action IDs and styles', () => {
    const blocks = buildTvApprovalRequestMessage(
      { title: 'Breaking Bad', year: 2008, tvdbId: 81189, posterUrl: null, seasonCount: 5 },
      'U_REQUESTER',
      42,
    );
    const actionsBlock = blocks.find((b) => b.type === 'actions') as any;
    expect(actionsBlock).toBeDefined();
    expect(actionsBlock.elements[0].action_id).toBe(ACTION_IDS.APPROVE_TV);
    expect(actionsBlock.elements[1].action_id).toBe(ACTION_IDS.REJECT_TV);
    expect(actionsBlock.elements[0].style).toBe('primary');
    expect(actionsBlock.elements[1].style).toBe('danger');
  });
});

describe('buildTvApprovedMessage', () => {
  it('includes approved text with approver mention', () => {
    const blocks = buildTvApprovedMessage({ title: 'Breaking Bad', year: 2008 }, 'U_REQ', 'U_APP');
    const firstBlock = blocks[0] as any;
    expect(firstBlock.text.text).toContain('approved');
    expect(firstBlock.text.text).toContain('<@U_APP>');
    expect(firstBlock.text.text).toContain('<@U_REQ>');
  });

  it('mentions Sonarr', () => {
    const blocks = buildTvApprovedMessage({ title: 'Breaking Bad', year: 2008 }, 'U_REQ', 'U_APP');
    const firstBlock = blocks[0] as any;
    expect(firstBlock.text.text).toContain('Sonarr');
  });
});

describe('buildTvRejectedMessage', () => {
  it('includes rejected text without reason', () => {
    const blocks = buildTvRejectedMessage({ title: 'Breaking Bad', year: 2008 }, 'U_REQ', 'U_APP');
    const firstBlock = blocks[0] as any;
    expect(firstBlock.text.text).toContain('rejected');
    expect(firstBlock.text.text).not.toContain('Reason:');
  });

  it('includes reason when provided', () => {
    const blocks = buildTvRejectedMessage({ title: 'Breaking Bad', year: 2008 }, 'U_REQ', 'U_APP', 'Already watched');
    const firstBlock = blocks[0] as any;
    expect(firstBlock.text.text).toContain('Reason: Already watched');
  });
});

describe('buildMyRequestsMessage', () => {
  it('returns no-requests message when empty array', () => {
    const blocks = buildMyRequestsMessage([]);
    expect(blocks).toHaveLength(1);
    expect((blocks[0] as any).text.text).toContain("haven't made any requests");
  });

  it('returns header + divider + item blocks for requests', () => {
    const requests: MyRequestItem[] = [
      { type: 'movie', title: 'The Batman', year: 2022, status: 'approved', createdAt: '2024-01-15T10:30:00' },
    ];
    const blocks = buildMyRequestsMessage(requests);
    expect(blocks).toHaveLength(3); // header + divider + 1 item
    expect(blocks[0]!.type).toBe('section');
    expect(blocks[1]!.type).toBe('divider');
    expect(blocks[2]!.type).toBe('section');
  });

  it('shows movie emoji for movie requests', () => {
    const blocks = buildMyRequestsMessage([
      { type: 'movie', title: 'Dune', year: 2021, status: 'pending', createdAt: '2024-01-15T10:30:00' },
    ]);
    const itemBlock = blocks[2] as any;
    expect(itemBlock.text.text).toContain(':clapper:');
  });

  it('shows TV emoji for tv requests', () => {
    const blocks = buildMyRequestsMessage([
      { type: 'tv', title: 'Breaking Bad', year: 2008, status: 'approved', createdAt: '2024-01-15T10:30:00' },
    ]);
    const itemBlock = blocks[2] as any;
    expect(itemBlock.text.text).toContain(':tv:');
  });

  it('renders all 5 status types with correct emoji', () => {
    const statuses = [
      { status: 'pending', emoji: '⏳', label: 'Pending' },
      { status: 'approved', emoji: '✅', label: 'Approved' },
      { status: 'rejected', emoji: '❌', label: 'Rejected' },
      { status: 'already_exists', emoji: 'ℹ️', label: 'Already in library' },
      { status: 'failed', emoji: '⚠️', label: 'Failed' },
    ];

    for (const { status, emoji, label } of statuses) {
      const blocks = buildMyRequestsMessage([
        { type: 'movie', title: 'Test', year: 2024, status, createdAt: '2024-01-15T10:30:00' },
      ]);
      const itemBlock = blocks[2] as any;
      expect(itemBlock.text.text).toContain(emoji);
      expect(itemBlock.text.text).toContain(label);
    }
  });

  it('includes title, year, and date in item text', () => {
    const blocks = buildMyRequestsMessage([
      { type: 'movie', title: 'Inception', year: 2010, status: 'approved', createdAt: '2024-03-20T14:00:00' },
    ]);
    const itemBlock = blocks[2] as any;
    expect(itemBlock.text.text).toContain('Inception');
    expect(itemBlock.text.text).toContain('2010');
    expect(itemBlock.text.text).toContain('2024-03-20');
  });

  it('shows correct count in header', () => {
    const requests: MyRequestItem[] = [
      { type: 'movie', title: 'Movie 1', year: 2020, status: 'pending', createdAt: '2024-01-01T00:00:00' },
      { type: 'tv', title: 'Show 1', year: 2021, status: 'approved', createdAt: '2024-01-02T00:00:00' },
      { type: 'movie', title: 'Movie 2', year: 2022, status: 'rejected', createdAt: '2024-01-03T00:00:00' },
    ];
    const blocks = buildMyRequestsMessage(requests);
    expect((blocks[0] as any).text.text).toContain('(3)');
  });

  it('renders mixed movie and TV requests', () => {
    const requests: MyRequestItem[] = [
      { type: 'tv', title: 'Breaking Bad', year: 2008, status: 'approved', createdAt: '2024-01-02T00:00:00' },
      { type: 'movie', title: 'The Batman', year: 2022, status: 'pending', createdAt: '2024-01-01T00:00:00' },
    ];
    const blocks = buildMyRequestsMessage(requests);
    expect(blocks).toHaveLength(4); // header + divider + 2 items
    expect((blocks[2] as any).text.text).toContain(':tv:');
    expect((blocks[3] as any).text.text).toContain(':clapper:');
  });
});

describe('buildQueueMessage', () => {
  it('returns no-requests block when empty array', () => {
    const blocks = buildQueueMessage([]);
    expect(blocks).toHaveLength(1);
    expect((blocks[0] as any).text.text).toContain('No requests found');
  });

  it('includes statusFilter in empty-state message when provided', () => {
    const blocks = buildQueueMessage([], 'pending');
    expect((blocks[0] as any).text.text).toContain('pending');
  });

  it('returns header + divider + item blocks for requests', () => {
    const items: QueueItem[] = [
      { type: 'movie', title: 'The Batman', year: 2022, status: 'approved', createdAt: '2024-01-15T10:30:00', requesterId: 'U123' },
    ];
    const blocks = buildQueueMessage(items);
    expect(blocks).toHaveLength(3);
    expect(blocks[0]!.type).toBe('section');
    expect(blocks[1]!.type).toBe('divider');
    expect(blocks[2]!.type).toBe('section');
  });

  it('items include requester mention', () => {
    const items: QueueItem[] = [
      { type: 'movie', title: 'Dune', year: 2021, status: 'pending', createdAt: '2024-01-15T10:30:00', requesterId: 'U_REQ_123' },
    ];
    const blocks = buildQueueMessage(items);
    const itemBlock = blocks[2] as any;
    expect(itemBlock.text.text).toContain('<@U_REQ_123>');
  });

  it('shows movie emoji for movie items', () => {
    const items: QueueItem[] = [
      { type: 'movie', title: 'Inception', year: 2010, status: 'pending', createdAt: '2024-01-15T10:30:00', requesterId: 'U1' },
    ];
    const blocks = buildQueueMessage(items);
    const itemBlock = blocks[2] as any;
    expect(itemBlock.text.text).toContain(':clapper:');
  });

  it('shows TV emoji for tv items', () => {
    const items: QueueItem[] = [
      { type: 'tv', title: 'Breaking Bad', year: 2008, status: 'pending', createdAt: '2024-01-15T10:30:00', requesterId: 'U1' },
    ];
    const blocks = buildQueueMessage(items);
    const itemBlock = blocks[2] as any;
    expect(itemBlock.text.text).toContain(':tv:');
  });

  it('shows statusFilter in header when provided', () => {
    const items: QueueItem[] = [
      { type: 'movie', title: 'Dune', year: 2021, status: 'pending', createdAt: '2024-01-15T10:30:00', requesterId: 'U1' },
    ];
    const blocks = buildQueueMessage(items, 'pending');
    const header = blocks[0] as any;
    expect(header.text.text).toContain('pending');
  });

  it('shows correct count in header', () => {
    const items: QueueItem[] = [
      { type: 'movie', title: 'Movie 1', year: 2020, status: 'pending', createdAt: '2024-01-01T00:00:00', requesterId: 'U1' },
      { type: 'tv', title: 'Show 1', year: 2021, status: 'approved', createdAt: '2024-01-02T00:00:00', requesterId: 'U2' },
    ];
    const blocks = buildQueueMessage(items);
    expect((blocks[0] as any).text.text).toContain('(2)');
  });
});
