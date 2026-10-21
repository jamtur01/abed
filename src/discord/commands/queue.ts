import { ChatInputCommandInteraction, SlashCommandBuilder, MessageFlags } from 'discord.js';
import { getAllRequests, getAllTvRequests } from '../../db/index';
import type { RequestStatus } from '../../db/types';
import { buildQueueEmbed } from '../messages/index';
import { createLogger } from '../../logger';

const log = createLogger('discord-queue-cmd');

export const queueCommandDef = new SlashCommandBuilder()
  .setName('queue')
  .setDescription('View the server request queue')
  .addStringOption(option =>
    option.setName('status')
      .setDescription('Filter by request status')
      .setRequired(false)
      .addChoices(
        { name: 'Pending', value: 'pending' },
        { name: 'Approved', value: 'approved' },
        { name: 'Rejected', value: 'rejected' },
        { name: 'Already Exists', value: 'already_exists' },
        { name: 'Failed', value: 'failed' }
      )
  );

export async function executeQueueCommand(interaction: ChatInputCommandInteraction) {
  const userId = interaction.user.id;
  const statusFilter = interaction.options.getString('status') as RequestStatus | null;

  log.info('/queue command', { user: userId, statusFilter });

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const movieRequests = getAllRequests(statusFilter ?? undefined, 'discord');
    const tvRequests = getAllTvRequests(statusFilter ?? undefined, 'discord');

    const allRequests = [...movieRequests, ...tvRequests].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );

    const topRequests = allRequests.slice(0, 25);

    const messagePayload = buildQueueEmbed(topRequests, statusFilter ?? undefined);

    await interaction.editReply({
      ...messagePayload,
    });
  } catch (error) {
    log.error('Error fetching queue', { user: userId, error });
    await interaction.editReply({
      content: '❌ Failed to fetch the request queue. Please try again later.',
    });
  }
}
