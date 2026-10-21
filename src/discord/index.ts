import { consumeRequestBudget } from '../core/submission';
import { Client, GatewayIntentBits, REST, Routes, MessageFlags } from 'discord.js';
import type { Interaction } from 'discord.js';
import type { RadarrClient } from '../radarr/client';
import type { SonarrClient } from '../sonarr/client';
import { createLogger } from '../logger';

// Commands
import { executeMovieCommand, movieCommandDef } from './commands/movie';
import { executeTvCommand, tvCommandDef } from './commands/tv';
import { executeMyRequestsCommand, myRequestsCommandDef } from './commands/myrequests';
import { executeQueueCommand, queueCommandDef } from './commands/queue';

// Actions
import { handleApproveMovie, handleRejectMovie } from './actions/approveMovie';
import { handleApproveTv, handleRejectTv } from './actions/approveTv';
import { handleMovieCarouselNav, handleTvCarouselNav, handleMovieCarouselRequest, handleTvCarouselRequest } from './actions/navigate';

const log = createLogger('discord');

export type DiscordAppDeps = {
  botToken: string;
  clientId: string;
  guildId: string;
  requestChannelId: string;
  approvalChannelId: string;
  approverDiscordIds: string[];
  qualityProfileId: number;
  rootFolderPath: string;
  sonarr: {
    sonarrClient: SonarrClient;
    qualityProfileId: number;
    rootFolderPath: string;
  } | null;
};

export async function createDiscordApp(deps: DiscordAppDeps, radarrClient: RadarrClient): Promise<Client> {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
  });

  const commands = [movieCommandDef, myRequestsCommandDef, queueCommandDef];
  if (deps.sonarr) {
    commands.push(tvCommandDef);
  }

  const rest = new REST({ version: '10' }).setToken(deps.botToken);

  client.once('clientReady', async () => {
    log.info(`Discord bot ready! Logged in as ${client.user?.tag}`);

    try {
      log.info('Started refreshing application (/) commands.');
      
      // If guildId is provided, register guild-specific commands (instant)
      // Otherwise, register global commands (takes up to 1 hour to cache on Discord's end)
      if (deps.guildId) {
        await rest.put(
          Routes.applicationGuildCommands(deps.clientId, deps.guildId) as any,
          { body: commands }
        );
        log.info(`Successfully reloaded guild (/) commands for guild ${deps.guildId}`);
      } else {
        await rest.put(
          Routes.applicationCommands(deps.clientId) as any,
          { body: commands }
        );
        log.info('Successfully reloaded global (/) commands.');
      }
    } catch (error) {
      log.error('Error refreshing Discord commands:', { error });
    }
  });

  client.on('interactionCreate', async (interaction: Interaction) => {
    try {
      const approval = interaction.isButton() && /^(approve|reject)_/.test(interaction.customId);
      const channel = approval ? deps.approvalChannelId : deps.requestChannelId;
      if (interaction.channelId !== channel || interaction.guildId !== deps.guildId) {
        if (interaction.isRepliable()) await interaction.reply({
          content: 'Use the configured request or approval channel for this action.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (!approval && (!interaction.isChatInputCommand()
        || ['movie', 'tv'].includes(interaction.commandName))
        && !consumeRequestBudget('discord', interaction.user.id)) {
        if (interaction.isRepliable()) await interaction.reply({
          content: 'Too many requests. Wait a minute before trying again.', flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;

        if (commandName === 'movie') {
          await executeMovieCommand(interaction, { radarrClient });
        } else if (commandName === 'tv') {
          await executeTvCommand(interaction, { sonarr: deps.sonarr });
        } else if (commandName === 'myrequests') {
          await executeMyRequestsCommand(interaction);
        } else if (commandName === 'queue') {
          await executeQueueCommand(interaction);
        }
      } else if (interaction.isButton()) {
        if (interaction.customId.startsWith('movie_prev_') || interaction.customId.startsWith('movie_next_')) {
          await handleMovieCarouselNav(interaction);
        } else if (interaction.customId.startsWith('tv_prev_') || interaction.customId.startsWith('tv_next_')) {
          await handleTvCarouselNav(interaction);
        } else if (interaction.customId.startsWith('movie_request_')) {
          await handleMovieCarouselRequest(interaction, {
            radarrClient,
            approvalChannelId: deps.approvalChannelId,
          });
        } else if (interaction.customId.startsWith('tv_request_')) {
          await handleTvCarouselRequest(interaction, {
            sonarrClient: deps.sonarr?.sonarrClient,
            approvalChannelId: deps.approvalChannelId,
          });
        } else if (interaction.customId.startsWith('approve_movie_')) {
          await handleApproveMovie(interaction, {
            radarrClient,
            approverDiscordIds: deps.approverDiscordIds,
            qualityProfileId: deps.qualityProfileId,
            rootFolderPath: deps.rootFolderPath,
          });
        } else if (interaction.customId.startsWith('reject_movie_')) {
          await handleRejectMovie(interaction, {
            approverDiscordIds: deps.approverDiscordIds,
          });
        } else if (interaction.customId.startsWith('approve_tv_')) {
          await handleApproveTv(interaction, {
            sonarrClient: deps.sonarr?.sonarrClient,
            approverDiscordIds: deps.approverDiscordIds,
            qualityProfileId: deps.sonarr?.qualityProfileId ?? 0,
            rootFolderPath: deps.sonarr?.rootFolderPath ?? '',
          });
        } else if (interaction.customId.startsWith('reject_tv_')) {
          await handleRejectTv(interaction, {
            approverDiscordIds: deps.approverDiscordIds,
          });
        }
      }
    } catch (error) {
      log.error(`Error handling interaction: ${error}`);
      
      // Ensure we always reply or edit reply if something failed
      const payload = {
        content: 'There was an error while executing this command!',
        ephemeral: true,
      };

      if (interaction.isRepliable()) {
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(payload).catch(() => {});
        } else {
          await interaction.reply(payload).catch(() => {});
        }
      }
    }
  });

  return client;
}
