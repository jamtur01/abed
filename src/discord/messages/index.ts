import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import type { RadarrSearchResult } from '../../radarr/types';
import type { SonarrSearchResult } from '../../sonarr/types';
import type { MovieRequest, TvRequest } from '../../db/types';
import { getMoviePosterUrl, getTvPosterUrl } from '../../core/helpers/posterUrl';

// ============================================================================
// MOVIE MESSAGES
// ============================================================================

export function buildApprovalRequestEmbed(movie: RadarrSearchResult, requesterDiscordId: string, requestId: number) {
  const embed = new EmbedBuilder()
    .setColor('#ffcc00')
    .setTitle(`Movie Request: ${movie.title} (${movie.year})`)
    .setDescription(`Requested by <@${requesterDiscordId}>`)
    .addFields(
      { name: 'TMDB ID', value: movie.tmdbId.toString(), inline: true },
      { name: 'Status', value: 'Pending Approval ⏳', inline: true }
    );

  if (movie.overview) {
    embed.addFields({ name: 'Overview', value: movie.overview.substring(0, 1024) });
  }

  if (movie.remotePoster) {
    embed.setThumbnail(movie.remotePoster);
  }

  const approveBtn = new ButtonBuilder()
    .setCustomId(`approve_movie_request_${requestId}`)
    .setLabel('Approve')
    .setStyle(ButtonStyle.Success);

  const rejectBtn = new ButtonBuilder()
    .setCustomId(`reject_movie_request_${requestId}`)
    .setLabel('Reject')
    .setStyle(ButtonStyle.Danger);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(approveBtn, rejectBtn);

  return {
    embeds: [embed],
    components: [row],
  };
}

export function buildApprovedEmbed(movie: MovieRequest, approverDiscordId: string) {
  const embed = new EmbedBuilder()
    .setColor('#00ff00')
    .setTitle(`Movie Request: ${movie.movie_title} (${movie.year})`)
    .setDescription(`Requested by <@${movie.requester_slack_id}>`)
    .addFields(
      { name: 'TMDB ID', value: movie.tmdb_id.toString(), inline: true },
      { name: 'Status', value: `Approved by <@${approverDiscordId}> ✅`, inline: true }
    );

  if (movie.poster_url) embed.setThumbnail(movie.poster_url);

  return { embeds: [embed], components: [] };
}

export function buildRejectedEmbed(movie: MovieRequest, approverDiscordId: string) {
  const embed = new EmbedBuilder()
    .setColor('#ff0000')
    .setTitle(`Movie Request: ${movie.movie_title} (${movie.year})`)
    .setDescription(`Requested by <@${movie.requester_slack_id}>`)
    .addFields(
      { name: 'TMDB ID', value: movie.tmdb_id.toString(), inline: true },
      { name: 'Status', value: `Rejected by <@${approverDiscordId}> ❌`, inline: true }
    );

  if (movie.poster_url) embed.setThumbnail(movie.poster_url);

  return { embeds: [embed], components: [] };
}

// ============================================================================
// TV MESSAGES
// ============================================================================

export function buildTvApprovalRequestEmbed(show: SonarrSearchResult, requesterDiscordId: string, requestId: number) {
  const embed = new EmbedBuilder()
    .setColor('#ffcc00')
    .setTitle(`TV Request: ${show.title} (${show.year})`)
    .setDescription(`Requested by <@${requesterDiscordId}>`)
    .addFields(
      { name: 'Network', value: show.network || 'Unknown', inline: true },
      { name: 'Seasons', value: (show.seasons?.length || 0).toString(), inline: true },
      { name: 'TVDB ID', value: show.tvdbId.toString(), inline: true },
      { name: 'Status', value: 'Pending Approval ⏳', inline: true }
    );

  if (show.overview) {
    embed.addFields({ name: 'Overview', value: show.overview.substring(0, 1024) });
  }

  const poster = show.images?.find((img) => img.coverType === 'poster')?.remoteUrl;
  if (poster) {
    embed.setThumbnail(poster);
  }

  const approveBtn = new ButtonBuilder()
    .setCustomId(`approve_tv_request_${requestId}`)
    .setLabel('Approve')
    .setStyle(ButtonStyle.Success);

  const rejectBtn = new ButtonBuilder()
    .setCustomId(`reject_tv_request_${requestId}`)
    .setLabel('Reject')
    .setStyle(ButtonStyle.Danger);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(approveBtn, rejectBtn);

  return {
    embeds: [embed],
    components: [row],
  };
}

export function buildTvApprovedEmbed(show: TvRequest, approverDiscordId: string) {
  const embed = new EmbedBuilder()
    .setColor('#00ff00')
    .setTitle(`TV Request: ${show.show_title} (${show.year})`)
    .setDescription(`Requested by <@${show.requester_slack_id}>`)
    .addFields(
      { name: 'TVDB ID', value: show.tvdb_id.toString(), inline: true },
      { name: 'Status', value: `Approved by <@${approverDiscordId}> ✅`, inline: true }
    );

  if (show.poster_url) embed.setThumbnail(show.poster_url);

  return { embeds: [embed], components: [] };
}

export function buildTvRejectedEmbed(show: TvRequest, approverDiscordId: string) {
  const embed = new EmbedBuilder()
    .setColor('#ff0000')
    .setTitle(`TV Request: ${show.show_title} (${show.year})`)
    .setDescription(`Requested by <@${show.requester_slack_id}>`)
    .addFields(
      { name: 'TVDB ID', value: show.tvdb_id.toString(), inline: true },
      { name: 'Status', value: `Rejected by <@${approverDiscordId}> ❌`, inline: true }
    );

  if (show.poster_url) embed.setThumbnail(show.poster_url);

  return { embeds: [embed], components: [] };
}

// ============================================================================
// CAROUSEL MESSAGES
// ============================================================================

export function buildMovieCarouselPage(
  results: RadarrSearchResult[],
  currentIndex: number
): { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] } {
  if (results.length === 0) {
    return {
      embeds: [
        new EmbedBuilder()
          .setColor('#ffcc00')
          .setDescription('No results found. Try a different title.'),
      ],
      components: [],
    };
  }

  const movie = results[currentIndex]!;

  const embed = new EmbedBuilder()
    .setColor('#0099ff')
    .setTitle(`${movie.title} (${movie.year})`)
    .setDescription(movie.overview?.substring(0, 1024) ?? 'No overview available.')
    .addFields(
      { name: 'Studio', value: movie.studio ?? 'Unknown', inline: true },
      { name: 'TMDB ID', value: movie.tmdbId.toString(), inline: true }
    )
    .setFooter({ text: `Result ${currentIndex + 1} of ${results.length}` });

  const posterUrl = getMoviePosterUrl(movie);
  if (posterUrl !== null) {
    embed.setThumbnail(posterUrl);
  }

  const prevBtn = new ButtonBuilder()
    .setCustomId(`movie_prev_${currentIndex}`)
    .setLabel('◀ Previous')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(currentIndex === 0);

  const nextBtn = new ButtonBuilder()
    .setCustomId(`movie_next_${currentIndex}`)
    .setLabel('Next ▶')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(currentIndex === results.length - 1);

  const selectBtn = new ButtonBuilder()
    .setCustomId(`movie_request_${currentIndex}`)
    .setLabel('Request This')
    .setStyle(ButtonStyle.Success);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(prevBtn, nextBtn, selectBtn);

  return { embeds: [embed], components: [row] };
}

export function buildTvCarouselPage(
  results: SonarrSearchResult[],
  currentIndex: number
): { embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] } {
  if (results.length === 0) {
    return {
      embeds: [
        new EmbedBuilder()
          .setColor('#ffcc00')
          .setDescription('No results found. Try a different title.'),
      ],
      components: [],
    };
  }

  const show = results[currentIndex]!;
  const seasonCount = show.seasons.filter((s) => s.seasonNumber > 0).length;

  const embed = new EmbedBuilder()
    .setColor('#0099ff')
    .setTitle(`${show.title} (${show.year})`)
    .setDescription(show.overview?.substring(0, 1024) ?? 'No overview available.')
    .addFields(
      { name: 'Network', value: show.network ?? 'Unknown', inline: true },
      { name: 'Seasons', value: seasonCount.toString(), inline: true },
      { name: 'TVDB ID', value: show.tvdbId.toString(), inline: true }
    )
    .setFooter({ text: `Result ${currentIndex + 1} of ${results.length}` });

  const posterUrl = getTvPosterUrl(show);
  if (posterUrl !== null) {
    embed.setThumbnail(posterUrl);
  }

  const prevBtn = new ButtonBuilder()
    .setCustomId(`tv_prev_${currentIndex}`)
    .setLabel('◀ Previous')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(currentIndex === 0);

  const nextBtn = new ButtonBuilder()
    .setCustomId(`tv_next_${currentIndex}`)
    .setLabel('Next ▶')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(currentIndex === results.length - 1);

  const selectBtn = new ButtonBuilder()
    .setCustomId(`tv_request_${currentIndex}`)
    .setLabel('Request This')
    .setStyle(ButtonStyle.Success);

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(prevBtn, nextBtn, selectBtn);

  return { embeds: [embed], components: [row] };
}

// ============================================================================
// MY REQUESTS
// ============================================================================

export function buildMyRequestsEmbed(requests: (MovieRequest | TvRequest)[]) {
  if (requests.length === 0) {
    return {
      embeds: [
        new EmbedBuilder()
          .setColor('#cccccc')
          .setDescription('You have no requests matching that status.'),
      ],
    };
  }

  const embed = new EmbedBuilder()
    .setColor('#0099ff')
    .setTitle(`Your Requests (${requests.length})`)
    .setDescription('Here are your most recent requests:');

  requests.forEach((req) => {
    const isMovie = 'movie_title' in req;
    const title = isMovie ? req.movie_title : req.show_title;
    const icon = isMovie ? '🎬' : '📺';
    
    let statusIcon = '⏳';
    if (req.status === 'approved') statusIcon = '✅';
    if (req.status === 'rejected') statusIcon = '❌';
    if (req.status === 'already_exists') statusIcon = '📚';
    if (req.status === 'failed') statusIcon = '⚠️';

    embed.addFields({
      name: `${icon} ${title} (${req.year})`,
      value: `Status: ${statusIcon} ${req.status}\nDate: ${new Date(req.created_at).toLocaleDateString()}`,
      inline: false,
    });
  });

  return { embeds: [embed] };
}

export function buildQueueEmbed(requests: (MovieRequest | TvRequest)[], statusFilter?: string) {
  if (requests.length === 0) {
    const filterNote = statusFilter ? ` with status **${statusFilter}**` : '';
    return {
      embeds: [
        new EmbedBuilder()
          .setColor('#cccccc')
          .setDescription(`No requests found${filterNote}.`),
      ],
    };
  }

  const filterNote = statusFilter ? ` — ${statusFilter}` : '';
  const embed = new EmbedBuilder()
    .setColor('#0099ff')
    .setTitle(`Request Queue${filterNote} (${requests.length})`)
    .setDescription('Most recent requests across the server:');

  requests.forEach((req) => {
    const isMovie = 'movie_title' in req;
    const title = isMovie ? req.movie_title : req.show_title;
    const icon = isMovie ? '🎬' : '📺';

    let statusIcon = '⏳';
    if (req.status === 'approved') statusIcon = '✅';
    if (req.status === 'rejected') statusIcon = '❌';
    if (req.status === 'already_exists') statusIcon = '📚';
    if (req.status === 'failed') statusIcon = '⚠️';

    embed.addFields({
      name: `${icon} ${title} (${req.year})`,
      value: `Status: ${statusIcon} ${req.status}\nRequested by: <@${req.requester_slack_id}>\nDate: ${new Date(req.created_at).toLocaleDateString()}`,
      inline: false,
    });
  });

  return { embeds: [embed] };
}
