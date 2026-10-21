import { ButtonInteraction, MessageFlags } from 'discord.js';
import type { SonarrClient } from '../../sonarr/client';
import { getTvRequest, updateTvRequestStatus } from '../../db/index';
import { buildTvApprovedEmbed, buildTvRejectedEmbed } from '../messages/index';
import { createLogger } from '../../logger';

const log = createLogger('discord-approve-tv');

export async function handleApproveTv(
  interaction: ButtonInteraction,
  deps: {
    sonarrClient?: SonarrClient | null;
    approverDiscordIds: string[];
    qualityProfileId: number;
    rootFolderPath: string;
  }
) {
  const userId = interaction.user.id;
  const value = interaction.customId.replace('approve_tv_request_', '');
  const requestId = /^[1-9]\d*$/.test(value) ? Number(value) : NaN;

  log.info('Approve TV clicked', { user: userId, requestId });

  if (!deps.sonarrClient) {
    await interaction.reply({
      content: '❌ Sonarr is not configured.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!deps.approverDiscordIds.includes(userId)) {
    log.warn('Unauthorized approve attempt', { user: userId });
    await interaction.reply({
      content: '❌ You are not authorized to approve requests.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const request = Number.isSafeInteger(requestId) ? getTvRequest(requestId) : null;
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

  const tvdbId = request.tvdb_id;
  if (request.status !== 'pending') {
    log.info('Request already processed', { tvdbId, status: request.status });
    await interaction.deferUpdate();
    return;
  }

  await interaction.deferUpdate();

  try {
    const results = await deps.sonarrClient.searchSeries(`tvdb:${tvdbId}`);
    if (results.length === 0) {
      throw new Error(`Show with TVDB ID ${tvdbId} no longer found in Sonarr search`);
    }

    const show = results[0]!;
    await deps.sonarrClient.addSeries(
      show,
      deps.qualityProfileId,
      deps.rootFolderPath,
    );

    const updatedRequest = updateTvRequestStatus({
      id: request.id,
      status: 'approved',
      approver_slack_id: userId,
      slack_message_ts: request.slack_message_ts ?? undefined,
    });

    log.info('Show added to Sonarr', { tvdbId });

    const newMsg = buildTvApprovedEmbed(updatedRequest, userId);
    await interaction.message.edit({ ...newMsg });

    // DM requester
    try {
      const requester = await interaction.client.users.fetch(request.requester_slack_id);
      await requester.send(`✅ Your request for **${request.show_title}** has been approved and added to Sonarr!`);
    } catch (e) {
      log.warn('Failed to DM requester', { requesterId: request.requester_slack_id });
    }
  } catch (error) {
    log.error('Failed to approve TV show', { tvdbId, error: error instanceof Error ? error.message : String(error) });
    await interaction.followUp({
      content: `❌ Failed to add show to Sonarr: ${error instanceof Error ? error.message : 'Unknown error'}`,
      flags: MessageFlags.Ephemeral,
    });
  }
}

export async function handleRejectTv(
  interaction: ButtonInteraction,
  deps: { approverDiscordIds: string[] }
) {
  const userId = interaction.user.id;
  const value = interaction.customId.replace('reject_tv_request_', '');
  const requestId = /^[1-9]\d*$/.test(value) ? Number(value) : NaN;

  log.info('Reject TV clicked', { user: userId, requestId });

  if (!deps.approverDiscordIds.includes(userId)) {
    log.warn('Unauthorized reject attempt', { user: userId });
    await interaction.reply({
      content: '❌ You are not authorized to reject requests.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const request = Number.isSafeInteger(requestId) ? getTvRequest(requestId) : null;
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

  const tvdbId = request.tvdb_id;
  if (request.status !== 'pending') {
    log.info('Request already processed', { tvdbId, status: request.status });
    await interaction.deferUpdate();
    return;
  }

  await interaction.deferUpdate();

  try {
    const updatedRequest = updateTvRequestStatus({
      id: request.id,
      status: 'rejected',
      approver_slack_id: userId,
      slack_message_ts: request.slack_message_ts ?? undefined,
    });

    const newMsg = buildTvRejectedEmbed(updatedRequest, userId);
    await interaction.message.edit({ ...newMsg });

    // DM requester
    try {
      const requester = await interaction.client.users.fetch(request.requester_slack_id);
      await requester.send(`❌ Your request for **${request.show_title}** was rejected.`);
    } catch (e) {
      log.warn('Failed to DM requester', { requesterId: request.requester_slack_id });
    }
  } catch (error) {
    log.error('Failed to reject TV show', { tvdbId, error: error instanceof Error ? error.message : String(error) });
  }
}
