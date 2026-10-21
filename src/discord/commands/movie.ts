import { ChatInputCommandInteraction, SlashCommandBuilder, MessageFlags } from 'discord.js';
import type { RadarrClient } from '../../radarr/client';
import { storeResults } from '../../core/searchCache';
import { buildMovieCarouselPage } from '../messages/index';
import { createLogger } from '../../logger';

const log = createLogger('discord-movie-cmd');

export const movieCommandDef = new SlashCommandBuilder()
  .setName('movie')
  .setDescription('Search and request a movie from Radarr')
  .addStringOption((option) =>
    option.setName('title').setDescription('The title or IMDB URL of the movie').setRequired(true),
  );

export async function executeMovieCommand(
  interaction: ChatInputCommandInteraction,
  deps: { radarrClient: RadarrClient },
) {
  const query = interaction.options.getString('title', true).trim();
  const userId = interaction.user.id;

  log.info('/movie command', { user: userId, query });

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // For Discord, we will just use the standard search for now.
  // IMDB detection can be added identically to Slack later, but abstracting Radarr API is first
  try {
    const results = await deps.radarrClient.searchMovies(query);

    if (results.length === 0) {
      log.warn('No results', { user: userId, query });
      await interaction.editReply({
        content: `🤔 No results found for **${query}**. Try a different title.`,
      });
      return;
    }

    const capped = results.slice(0, 25);
    storeResults(`discord_${userId}`, capped);

    log.info('Search complete', { user: userId, query, results: results.length });

    const messagePayload = buildMovieCarouselPage(capped, 0);
    await interaction.editReply({
      content: `Search results for: **${query}**`,
      ...messagePayload,
    });
  } catch (error) {
    log.error('Error in /movie command', {
      user: userId,
      error: error instanceof Error ? error.message : String(error),
    });
    await interaction.editReply({
      content: '❌ Failed to search for movies. Please try again.',
    });
  }
}
