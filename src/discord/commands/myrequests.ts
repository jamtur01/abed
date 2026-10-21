import { ChatInputCommandInteraction, SlashCommandBuilder, MessageFlags } from 'discord.js';
import { getRequestsByUserId, getTvRequestsByUserId } from '../../db/index';
import type { RequestStatus } from '../../db/types';
import { buildMyRequestsEmbed } from '../messages/index';
import { createLogger } from '../../logger';

const log = createLogger('discord-myrequests-cmd');

export const myRequestsCommandDef = new SlashCommandBuilder()
  .setName('myrequests')
  .setDescription('View your movie and TV show requests')
  .addStringOption((option) =>
    option
      .setName('status')
      .setDescription('Filter by request status')
      .setRequired(false)
      .addChoices(
        { name: 'Pending', value: 'pending' },
        { name: 'Approved', value: 'approved' },
        { name: 'Rejected', value: 'rejected' },
        { name: 'Already Exists', value: 'already_exists' },
        { name: 'Failed', value: 'failed' },
      ),
  );

export async function executeMyRequestsCommand(interaction: ChatInputCommandInteraction) {
  const userId = interaction.user.id;
  const statusFilter = interaction.options.getString('status') as RequestStatus | null;

  log.info('/myrequests command', { user: userId, statusFilter });

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const movieRequests = getRequestsByUserId(userId, statusFilter ?? undefined, 'discord');
    const tvRequests = getTvRequestsByUserId(userId, statusFilter ?? undefined, 'discord');

    const allRequests = [...movieRequests, ...tvRequests].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    );

    const topRequests = allRequests.slice(0, 15);

    const messagePayload = buildMyRequestsEmbed(topRequests);

    await interaction.editReply({
      ...messagePayload,
    });
  } catch (error) {
    log.error('Error fetching requests', { user: userId, error });
    await interaction.editReply({
      content: '❌ Failed to fetch your requests. Please try again later.',
    });
  }
}
