import type { Block, ImageElement } from './types';
import type { RadarrSearchResult } from '../../radarr/types';
import type { SonarrSearchResult } from '../../sonarr/types';
import { getMoviePosterUrl, getTvPosterUrl } from '../../core/helpers/posterUrl';

export const ACTION_IDS = {
  SELECT_MOVIE: 'select_movie',
  APPROVE_MOVIE: 'approve_movie',
  REJECT_MOVIE: 'reject_movie',
  SELECT_TV: 'select_tv',
  APPROVE_TV: 'approve_tv',
  REJECT_TV: 'reject_tv',
} as const;

export const BLOCK_IDS = {
  MOVIE_SELECT_ACTIONS: 'movie_select_actions',
  APPROVAL_ACTIONS: 'approval_actions',
  TV_SELECT_ACTIONS: 'tv_select_actions',
  TV_APPROVAL_ACTIONS: 'tv_approval_actions',
} as const;

export function buildSearchResultsMessage(movies: RadarrSearchResult[]): Block[] {
  if (movies.length === 0) {
    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: ':mag: No movies found. Try a different search term.',
        },
      },
    ];
  }

  const capped = movies.slice(0, 5);
  const blocks: Block[] = [];

  if (movies.length > 5) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `:clapper: Showing 5 of ${movies.length} results` }],
    });
  }

  for (const movie of capped) {
    const posterUrl = getMoviePosterUrl(movie);
    const overview = movie.overview
      ? movie.overview.length > 300
        ? `${movie.overview.slice(0, 300)}...`
        : movie.overview
      : '';
    const text = overview
      ? `*${movie.title} (${movie.year})*\n${overview}`
      : `*${movie.title} (${movie.year})*`;

    const section: Block = {
      type: 'section',
      text: { type: 'mrkdwn', text },
      ...(posterUrl ? {
        accessory: {
          type: 'image',
          image_url: posterUrl,
          alt_text: `${movie.title} poster`,
        } satisfies ImageElement,
      } : {}),
    };
    blocks.push(section);

    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Request', emoji: true },
          action_id: ACTION_IDS.SELECT_MOVIE,
          value: String(movie.tmdbId),
        },
      ],
    });
  }

  return blocks;
}

export function buildApprovalRequestMessage(
  movie: { title: string; year: number; overview?: string; posterUrl?: string | null; tmdbId: number },
  requesterSlackId: string,
  requestId: number,
): Block[] {
  const blocks: Block[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:film_frames: *Movie Request*\n*${movie.title} (${movie.year})*\nRequested by: <@${requesterSlackId}>`,
      },
    },
  ];

  if (movie.overview) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `_${movie.overview.slice(0, 300)}${movie.overview.length > 300 ? '...' : ''}_`,
      },
    });
  }

  if (movie.posterUrl) {
    blocks.push({
      type: 'image',
      image_url: movie.posterUrl,
      alt_text: `${movie.title} poster`,
    });
  }

  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'actions',
    block_id: BLOCK_IDS.APPROVAL_ACTIONS,
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: ':white_check_mark: Approve', emoji: true },
        action_id: ACTION_IDS.APPROVE_MOVIE,
        value: `request:${requestId}`,
        style: 'primary',
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: ':x: Reject', emoji: true },
        action_id: ACTION_IDS.REJECT_MOVIE,
        value: `request:${requestId}`,
        style: 'danger',
      },
    ],
  });

  return blocks;
}

export function buildApprovedMessage(
  movie: { title: string; year: number },
  requesterSlackId: string,
  approverSlackId: string,
): Block[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:white_check_mark: *${movie.title} (${movie.year})* has been *approved* by <@${approverSlackId}>!\nRequested by: <@${requesterSlackId}>\n\nRadarr is now searching for this movie. You'll be notified when it's available.`,
      },
    },
  ];
}

export function buildRejectedMessage(
  movie: { title: string; year: number },
  requesterSlackId: string,
  approverSlackId: string,
  reason?: string,
): Block[] {
  const text = reason
    ? `:x: *${movie.title} (${movie.year})* has been *rejected* by <@${approverSlackId}>.\nRequested by: <@${requesterSlackId}>\nReason: ${reason}`
    : `:x: *${movie.title} (${movie.year})* has been *rejected* by <@${approverSlackId}>.\nRequested by: <@${requesterSlackId}>`;

  return [
    {
      type: 'section',
      text: { type: 'mrkdwn', text },
    },
  ];
}

export function buildTvSearchResultsMessage(shows: SonarrSearchResult[]): Block[] {
  if (shows.length === 0) {
    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: ':mag: No TV shows found. Try a different search term.',
        },
      },
    ];
  }

  const capped = shows.slice(0, 5);
  const blocks: Block[] = [];

  if (shows.length > 5) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `:tv: Showing 5 of ${shows.length} results` }],
    });
  }

  for (const show of capped) {
    const posterUrl = getTvPosterUrl(show);
    const seasonCount = show.seasons.filter((s) => s.seasonNumber > 0).length;
    const network = show.network ?? 'Unknown Network';
    const overview = show.overview
      ? show.overview.length > 300
        ? `${show.overview.slice(0, 300)}...`
        : show.overview
      : '';
    const meta = `${network} · ${seasonCount} season${seasonCount !== 1 ? 's' : ''}`;
    const text = overview
      ? `*${show.title} (${show.year})*\n${meta}\n${overview}`
      : `*${show.title} (${show.year})*\n${meta}`;

    const section: Block = {
      type: 'section',
      text: { type: 'mrkdwn', text },
      ...(posterUrl ? {
        accessory: {
          type: 'image',
          image_url: posterUrl,
          alt_text: `${show.title} poster`,
        } satisfies ImageElement,
      } : {}),
    };
    blocks.push(section);

    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Request', emoji: true },
          action_id: ACTION_IDS.SELECT_TV,
          value: String(show.tvdbId),
        },
      ],
    });
  }

  return blocks;
}

export function buildTvApprovalRequestMessage(
  show: { title: string; year: number; overview?: string; posterUrl?: string | null; tvdbId: number; network?: string; seasonCount: number },
  requesterSlackId: string,
  requestId: number,
): Block[] {
  let headerText = `:tv: *TV Show Request*\n*${show.title} (${show.year})*`;
  if (show.network) {
    headerText += `\nNetwork: ${show.network}`;
  }
  headerText += `\nSeasons: ${show.seasonCount}`;
  headerText += `\nRequested by: <@${requesterSlackId}>`;

  const blocks: Block[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: headerText,
      },
    },
  ];

  if (show.overview) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `_${show.overview.slice(0, 300)}${show.overview.length > 300 ? '...' : ''}_`,
      },
    });
  }

  if (show.posterUrl) {
    blocks.push({
      type: 'image',
      image_url: show.posterUrl,
      alt_text: `${show.title} poster`,
    });
  }

  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'actions',
    block_id: BLOCK_IDS.TV_APPROVAL_ACTIONS,
    elements: [
      {
        type: 'button',
        text: { type: 'plain_text', text: ':white_check_mark: Approve', emoji: true },
        action_id: ACTION_IDS.APPROVE_TV,
        value: `request:${requestId}`,
        style: 'primary',
      },
      {
        type: 'button',
        text: { type: 'plain_text', text: ':x: Reject', emoji: true },
        action_id: ACTION_IDS.REJECT_TV,
        value: `request:${requestId}`,
        style: 'danger',
      },
    ],
  });

  return blocks;
}

export function buildTvApprovedMessage(
  show: { title: string; year: number },
  requesterSlackId: string,
  approverSlackId: string,
): Block[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:white_check_mark: *${show.title} (${show.year})* has been *approved* by <@${approverSlackId}>!\nRequested by: <@${requesterSlackId}>\n\nSonarr is now searching for this show. You'll be notified when it's available.`,
      },
    },
  ];
}

export function buildTvRejectedMessage(
  show: { title: string; year: number },
  requesterSlackId: string,
  approverSlackId: string,
  reason?: string,
): Block[] {
  const text = reason
    ? `:x: *${show.title} (${show.year})* has been *rejected* by <@${approverSlackId}>.\nRequested by: <@${requesterSlackId}>\nReason: ${reason}`
    : `:x: *${show.title} (${show.year})* has been *rejected* by <@${approverSlackId}>.\nRequested by: <@${requesterSlackId}>`;

  return [
    {
      type: 'section',
      text: { type: 'mrkdwn', text },
    },
  ];
}

export type MyRequestItem = {
  type: 'movie' | 'tv';
  title: string;
  year: number;
  status: string;
  createdAt: string;
};

export type QueueItem = {
  type: 'movie' | 'tv';
  title: string;
  year: number;
  status: string;
  createdAt: string;
  requesterId: string;
};

const STATUS_EMOJI: Record<string, string> = {
  pending: '⏳',
  approved: '✅',
  rejected: '❌',
  already_exists: 'ℹ️',
  failed: '⚠️',
};

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  already_exists: 'Already in library',
  failed: 'Failed',
};

export function buildMyRequestsMessage(requests: MyRequestItem[]): Block[] {
  if (requests.length === 0) {
    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: ":popcorn: You haven't made any requests yet. Use `/movie` or `/tv` to request something!",
        },
      },
    ];
  }

  const header: Block = {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `:popcorn: *Your Requests* (${requests.length})`,
    },
  };

  const divider: Block = { type: 'divider' };

  const items: Block[] = requests.map((req) => {
    const typeEmoji = req.type === 'movie' ? ':clapper:' : ':tv:';
    const statusEmoji = STATUS_EMOJI[req.status] ?? '❓';
    const statusLabel = STATUS_LABEL[req.status] ?? req.status;
    const date = req.createdAt.split('T')[0] ?? req.createdAt;

    return {
      type: 'section' as const,
      text: {
        type: 'mrkdwn' as const,
        text: `${typeEmoji} *${req.title}* (${req.year})\n${statusEmoji} ${statusLabel} · ${date}`,
      },
    };
  });

  return [header, divider, ...items];
}

export function buildQueueMessage(requests: QueueItem[], statusFilter?: string): Block[] {
  if (requests.length === 0) {
    const filterNote = statusFilter ? ` with status *${statusFilter}*` : '';
    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:clipboard: No requests found${filterNote}.`,
        },
      },
    ];
  }

  const filterNote = statusFilter ? ` — ${statusFilter}` : '';
  const header: Block = {
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `:clipboard: *Request Queue${filterNote}* (${requests.length})`,
    },
  };

  const divider: Block = { type: 'divider' };

  const items: Block[] = requests.map((req) => {
    const typeEmoji = req.type === 'movie' ? ':clapper:' : ':tv:';
    const statusEmoji = STATUS_EMOJI[req.status] ?? '❓';
    const statusLabel = STATUS_LABEL[req.status] ?? req.status;
    const date = req.createdAt.split('T')[0] ?? req.createdAt;

    return {
      type: 'section' as const,
      text: {
        type: 'mrkdwn' as const,
        text: `${typeEmoji} *${req.title}* (${req.year})\n${statusEmoji} ${statusLabel} · ${date} · Requested by <@${req.requesterId}>`,
      },
    };
  });

  return [header, divider, ...items];
}
