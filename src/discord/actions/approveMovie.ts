import { approveMovieRequest, transition } from '../../core/approval';
import { ButtonInteraction, MessageFlags } from 'discord.js';
import type { RadarrClient } from '../../radarr/client';
import { getRequest } from '../../db/index';
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
  },
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
  if (
    !request ||
    request.platform !== 'discord' ||
    !request.approval_channel_id ||
    interaction.channelId !== request.approval_channel_id ||
    !request.slack_message_ts ||
    interaction.message.id !== request.slack_message_ts
  ) {
    log.warn('Request not found in DB', { requestId });
    await interaction.reply({
      content: '❌ Request not found in database.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const tmdbId = request.tmdb_id;
  await interaction.deferUpdate();
  try {
    if (
      !(await approveMovieRequest(request, userId, { ...deps, radarrClient: deps.radarrClient! }))
    )
      return;
    const updatedRequest = getRequest(request.id)!;

    log.info('Movie added to Radarr', { tmdbId });

    const newMsg = buildApprovedEmbed(updatedRequest, userId);
    await interaction.message.edit({ ...newMsg });

    // DM requester
    try {
      const requester = await interaction.client.users.fetch(request.requester_slack_id);
      await requester.send(
        `✅ Your request for **${request.movie_title}** has been approved and added to Radarr!`,
      );
    } catch (e) {
      log.warn('Failed to DM requester', {
        requesterId: request.requester_slack_id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  } catch (error) {
    log.error('Failed to approve movie', {
      tmdbId,
      error: error instanceof Error ? error.message : String(error),
    });
    // Can't edit reply cleanly here if we deferred update, so just log it or followup
    await interaction.followUp({
      content: `❌ Failed to add movie to Radarr: ${error instanceof Error ? error.message : 'Unknown error'}`,
      flags: MessageFlags.Ephemeral,
    });
  }
}

export async function handleRejectMovie(
  interaction: ButtonInteraction,
  deps: { approverDiscordIds: string[] },
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
  if (
    !request ||
    request.platform !== 'discord' ||
    !request.approval_channel_id ||
    interaction.channelId !== request.approval_channel_id ||
    !request.slack_message_ts ||
    interaction.message.id !== request.slack_message_ts
  ) {
    log.warn('Request not found in DB', { requestId });
    await interaction.reply({
      content: '❌ Request not found in database.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const tmdbId = request.tmdb_id;
  await interaction.deferUpdate();
  try {
    if (!transition('movie', request.id, 'pending', 'rejected', userId)) return;
    const updatedRequest = getRequest(request.id)!;

    const newMsg = buildRejectedEmbed(updatedRequest, userId);
    await interaction.message.edit({ ...newMsg });

    // DM requester
    try {
      const requester = await interaction.client.users.fetch(request.requester_slack_id);
      await requester.send(`❌ Your request for **${request.movie_title}** was rejected.`);
    } catch (e) {
      log.warn('Failed to DM requester', {
        requesterId: request.requester_slack_id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  } catch (error) {
    log.error('Failed to reject movie', {
      tmdbId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
