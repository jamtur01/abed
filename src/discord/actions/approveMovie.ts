import { ButtonInteraction, MessageFlags } from 'discord.js';
import type { RadarrClient } from '../../radarr/client';
import { getRequest, updateRequestStatus } from '../../db/index';
import { buildApprovedEmbed, buildRejectedEmbed } from '../messages/index';
import { createLogger } from '../../logger';

const log = createLogger('discord-approve-movie');

export async function handleApproveMovie(
  interaction: ButtonInteraction,
  deps: {
    radarrClient: RadarrClient;
    approverDiscordIds: string[];
    qualityProfileId: number;
    rootFolderPath: string;
  }
) {
  const userId = interaction.user.id;
  const value = interaction.customId.replace('approve_movie_request_', '');
  const requestId = /^[1-9]\d*$/.test(value) ? Number(value) : NaN;

  log.info('Approve movie clicked', { user: userId, requestId });

  if (!deps.approverDiscordIds.includes(userId)) {
    log.warn('Unauthorized approve attempt', { user: userId });
    await interaction.reply({
      content: '❌ You are not authorized to approve requests.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const request = Number.isSafeInteger(requestId) ? getRequest(requestId) : null;
  if (!request || request.platform !== 'discord'
    || !request.approval_channel_id || interaction.channelId !== request.approval_channel_id
    || !request.slack_message_ts || interaction.message.id !== request.slack_message_ts) {
    log.warn('Request not found in DB', { requestId });
    await interaction.reply({
      content: '❌ Request not found in database.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Race condition guard
  const tmdbId = request.tmdb_id;
  if (request.status !== 'pending') {
    log.info('Request already processed', { tmdbId, status: request.status });
    // Still acknowledge the interaction silently
    await interaction.deferUpdate();
    return;
  }

  // Acknowledge before doing API work
  await interaction.deferUpdate();

  try {
    const results = await deps.radarrClient.searchMovies(`tmdb:${tmdbId}`);
    if (results.length === 0) {
      throw new Error(`Movie with TMDB ID ${tmdbId} no longer found in Radarr search`);
    }

    const movie = results[0]!;
    await deps.radarrClient.addMovie(
      movie,
      deps.qualityProfileId,
      deps.rootFolderPath,
    );

      const updatedRequest = updateRequestStatus({
      id: request.id,
      status: 'approved',
      approver_slack_id: userId, // field name remains slack_id for schema compat
      slack_message_ts: request.slack_message_ts ?? undefined,
    });

    log.info('Movie added to Radarr', { tmdbId });

    const newMsg = buildApprovedEmbed(updatedRequest, userId);
    await interaction.message.edit({ ...newMsg });

    // DM requester
    try {
      const requester = await interaction.client.users.fetch(request.requester_slack_id);
      await requester.send(`✅ Your request for **${request.movie_title}** has been approved and added to Radarr!`);
    } catch (e) {
      log.warn('Failed to DM requester', { requesterId: request.requester_slack_id });
    }
  } catch (error) {
    log.error('Failed to approve movie', { tmdbId, error: error instanceof Error ? error.message : String(error) });
    // Can't edit reply cleanly here if we deferred update, so just log it or followup
    await interaction.followUp({
      content: `❌ Failed to add movie to Radarr: ${error instanceof Error ? error.message : 'Unknown error'}`,
      flags: MessageFlags.Ephemeral,
    });
  }
}

export async function handleRejectMovie(
  interaction: ButtonInteraction,
  deps: { approverDiscordIds: string[] }
) {
  const userId = interaction.user.id;
  const value = interaction.customId.replace('reject_movie_request_', '');
  const requestId = /^[1-9]\d*$/.test(value) ? Number(value) : NaN;

  log.info('Reject movie clicked', { user: userId, requestId });

  if (!deps.approverDiscordIds.includes(userId)) {
    log.warn('Unauthorized reject attempt', { user: userId });
    await interaction.reply({
      content: '❌ You are not authorized to reject requests.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const request = Number.isSafeInteger(requestId) ? getRequest(requestId) : null;
  if (!request || request.platform !== 'discord'
    || !request.approval_channel_id || interaction.channelId !== request.approval_channel_id
    || !request.slack_message_ts || interaction.message.id !== request.slack_message_ts) {
    log.warn('Request not found in DB', { requestId });
    await interaction.reply({
      content: '❌ Request not found in database.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const tmdbId = request.tmdb_id;
  if (request.status !== 'pending') {
    log.info('Request already processed', { tmdbId, status: request.status });
    await interaction.deferUpdate();
    return;
  }

  await interaction.deferUpdate();

  try {
    const updatedRequest = updateRequestStatus({
      id: request.id,
      status: 'rejected',
      approver_slack_id: userId,
      slack_message_ts: request.slack_message_ts ?? undefined,
    });

    const newMsg = buildRejectedEmbed(updatedRequest, userId);
    await interaction.message.edit({ ...newMsg });

    // DM requester
    try {
      const requester = await interaction.client.users.fetch(request.requester_slack_id);
      await requester.send(`❌ Your request for **${request.movie_title}** was rejected.`);
    } catch (e) {
      log.warn('Failed to DM requester', { requesterId: request.requester_slack_id });
    }
  } catch (error) {
    log.error('Failed to reject movie', { tmdbId, error: error instanceof Error ? error.message : String(error) });
  }
}
