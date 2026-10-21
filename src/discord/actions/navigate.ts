import { MessageFlags, TextChannel } from 'discord.js';
import type { ButtonInteraction } from 'discord.js';
import type { RadarrClient } from '../../radarr/client';
import type { SonarrClient } from '../../sonarr/client';
import { getResults, clearResults, getTvResults, clearTvResults } from '../../core/searchCache';
import { createRequest, createTvRequest, updateRequestStatus, updateTvRequestStatus } from '../../db/index';
import { buildMovieCarouselPage, buildTvCarouselPage, buildApprovalRequestEmbed, buildTvApprovalRequestEmbed } from '../messages/index';
import { getMoviePosterUrl, getTvPosterUrl } from '../../core/helpers/posterUrl';
import { createLogger } from '../../logger';

const log = createLogger('discord-carousel');

export async function handleMovieCarouselNav(interaction: ButtonInteraction): Promise<void> {
  const parts = interaction.customId.split('_');
  const direction = parts[1];
  const currentIndex = parseInt(parts[2] ?? '0', 10);

  if (!Number.isInteger(currentIndex)) {
    await interaction.deferUpdate();
    return;
  }

  const userId = interaction.user.id;
  const results = getResults(`discord_${userId}`);

  if (!results) {
    log.warn('Movie carousel cache expired', { user: userId });
    await interaction.deferUpdate();
    await interaction.followUp({
      content: '⏳ Search results expired. Please run `/movie` again.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const targetIndex = direction === 'prev' ? currentIndex - 1 : currentIndex + 1;

  if (targetIndex < 0 || targetIndex >= results.length) {
    await interaction.deferUpdate();
    return;
  }

  const page = buildMovieCarouselPage(results, targetIndex);
  await interaction.update({ embeds: [...page.embeds], components: [...page.components] });
}

export async function handleTvCarouselNav(interaction: ButtonInteraction): Promise<void> {
  const parts = interaction.customId.split('_');
  const direction = parts[1];
  const currentIndex = parseInt(parts[2] ?? '0', 10);

  if (!Number.isInteger(currentIndex)) {
    await interaction.deferUpdate();
    return;
  }

  const userId = interaction.user.id;
  const results = getTvResults(`discord_${userId}`);

  if (!results) {
    log.warn('TV carousel cache expired', { user: userId });
    await interaction.deferUpdate();
    await interaction.followUp({
      content: '⏳ Search results expired. Please run `/tv` again.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const targetIndex = direction === 'prev' ? currentIndex - 1 : currentIndex + 1;

  if (targetIndex < 0 || targetIndex >= results.length) {
    await interaction.deferUpdate();
    return;
  }

  const page = buildTvCarouselPage(results, targetIndex);
  await interaction.update({ embeds: [...page.embeds], components: [...page.components] });
}

export async function handleMovieCarouselRequest(
  interaction: ButtonInteraction,
  deps: { radarrClient: RadarrClient; approvalChannelId: string }
): Promise<void> {
  const parts = interaction.customId.split('_');
  const index = parseInt(parts[2] ?? '0', 10);

  if (!Number.isInteger(index)) {
    await interaction.deferUpdate();
    return;
  }

  const userId = interaction.user.id;

  const results = getResults(`discord_${userId}`);

  if (!results) {
    log.warn('Movie carousel cache expired on request', { user: userId });
    await interaction.deferUpdate();
    await interaction.followUp({
      content: '⏳ Search results expired. Please run `/movie` again.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const movie = results[index];
  if (!movie) {
    log.warn('Movie not found at carousel index', { user: userId, index });
    await interaction.deferUpdate();
    await interaction.followUp({
      content: '❌ Could not find that movie. Please try again.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferUpdate();

  try {
    const isDuplicate = await deps.radarrClient.movieExists(movie.tmdbId);
    if (isDuplicate) {
      log.info('Movie already exists', { user: userId, tmdbId: movie.tmdbId });

      await interaction.followUp({
        content: `ℹ️ **${movie.title} (${movie.year})** is already in the library!`,
        flags: MessageFlags.Ephemeral,
      });
      clearResults(`discord_${userId}`);
      return;
    }

    const approvalChannel = await interaction.client.channels.fetch(deps.approvalChannelId) as TextChannel;
    if (!approvalChannel) {
      throw new Error('Approval channel not found or bot lacks access');
    }

    const request = createRequest({
      movie_title: movie.title,
      tmdb_id: movie.tmdbId,
      imdb_id: movie.imdbId,
      year: movie.year,
      poster_url: getMoviePosterUrl(movie),
      requester_slack_id: userId,
      approval_channel_id: deps.approvalChannelId,
      platform: 'discord',
    });

    const approvalMsg = buildApprovalRequestEmbed(movie, userId, request.id);
    const sentMsg = await approvalChannel.send({ ...approvalMsg });
    updateRequestStatus({ id: request.id, status: 'pending', slack_message_ts: sentMsg.id });

    log.info('Movie carousel approval request posted', { user: userId, tmdbId: movie.tmdbId, messageId: sentMsg.id });

    clearResults(`discord_${userId}`);

    await interaction.followUp({
      content: `✅ Your request for **${movie.title} (${movie.year})** has been submitted for approval!`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    log.error('Failed to process movie carousel request', { user: userId, error: error instanceof Error ? error.message : String(error) });
    await interaction.followUp({
      content: '❌ Something went wrong. Please try again.',
      flags: MessageFlags.Ephemeral,
    });
  }
}

export async function handleTvCarouselRequest(
  interaction: ButtonInteraction,
  deps: { sonarrClient?: SonarrClient | null; approvalChannelId: string }
): Promise<void> {
  if (!deps.sonarrClient) {
    await interaction.deferUpdate();
    return;
  }

  const parts = interaction.customId.split('_');
  const index = parseInt(parts[2] ?? '0', 10);

  if (!Number.isInteger(index)) {
    await interaction.deferUpdate();
    return;
  }

  const userId = interaction.user.id;

  const results = getTvResults(`discord_${userId}`);

  if (!results) {
    log.warn('TV carousel cache expired on request', { user: userId });
    await interaction.deferUpdate();
    await interaction.followUp({
      content: '⏳ Search results expired. Please run `/tv` again.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const show = results[index];
  if (!show) {
    log.warn('Show not found at carousel index', { user: userId, index });
    await interaction.deferUpdate();
    await interaction.followUp({
      content: '❌ Could not find that show. Please try again.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferUpdate();

  try {
    const isDuplicate = await deps.sonarrClient.seriesExists(show.tvdbId);
    if (isDuplicate) {
      log.info('Show already exists', { user: userId, tvdbId: show.tvdbId });
      await interaction.followUp({
        content: `ℹ️ **${show.title} (${show.year})** is already in the library!`,
        flags: MessageFlags.Ephemeral,
      });
      clearTvResults(`discord_${userId}`);
      return;
    }

    const approvalChannel = await interaction.client.channels.fetch(deps.approvalChannelId) as TextChannel;
    if (!approvalChannel) {
      throw new Error('Approval channel not found or bot lacks access');
    }

    const request = createTvRequest({
      show_title: show.title,
      tvdb_id: show.tvdbId,
      year: show.year,
      poster_url: getTvPosterUrl(show),
      requester_slack_id: userId,
      approval_channel_id: deps.approvalChannelId,
      platform: 'discord',
    });

    const approvalMsg = buildTvApprovalRequestEmbed(show, userId, request.id);
    const sentMsg = await approvalChannel.send({ ...approvalMsg });
    updateTvRequestStatus({ id: request.id, status: 'pending', slack_message_ts: sentMsg.id });

    log.info('TV carousel approval request posted', { user: userId, tvdbId: show.tvdbId, messageId: sentMsg.id });

    clearTvResults(`discord_${userId}`);

    await interaction.followUp({
      content: `✅ Your request for **${show.title} (${show.year})** has been submitted for approval!`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    log.error('Failed to process TV carousel request', { user: userId, error: error instanceof Error ? error.message : String(error) });
    await interaction.followUp({
      content: '❌ Something went wrong. Please try again.',
      flags: MessageFlags.Ephemeral,
    });
  }
}
