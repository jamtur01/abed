import { startHealthServer } from './health';
import { getConfig } from './config/index';
import { RadarrClient } from './radarr/client';
import { SonarrClient } from './sonarr/client';
import { createSlackApp } from './slack/index';
import { getDb } from './db/index';
import { startPoller, stopPoller } from './poller';
import { createLogger, _setSecrets } from './logger';

const log = createLogger('app');

async function main(): Promise<void> {
  let config;
  try {
    config = getConfig();
  } catch (error) {
    log.error(`❌ Configuration error: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }

  const radarrClient = new RadarrClient(config.radarr.url, config.radarr.apiKey);

  _setSecrets(
    [
      config.radarr.apiKey,
      config.sonarr?.apiKey,
      config.slack?.botToken,
      config.slack?.appToken,
      config.discord?.botToken,
    ].filter((s): s is string => !!s),
  );

  log.info('🔍 Checking Radarr connection...');
  try {
    const profiles = await radarrClient.getQualityProfiles();
    log.info(
      `✅ Radarr connected. Quality profiles: ${profiles.map((p) => `${p.name} (${p.id})`).join(', ')}`,
    );
    const folders = await radarrClient.getRootFolders();
    log.info(`📁 Root folders: ${folders.map((f) => f.path).join(', ')}`);
  } catch (error) {
    log.warn(`⚠️  Could not connect to Radarr: ${error instanceof Error ? error.message : error}`);
    log.warn('   Bot will start anyway. Radarr features will fail until connection is restored.');
  }

  let sonarrConfig: {
    sonarrClient: SonarrClient;
    qualityProfileId: number;
    rootFolderPath: string;
  } | null = null;
  if (config.sonarr) {
    const sonarrClient = new SonarrClient(config.sonarr.url, config.sonarr.apiKey);

    log.info('🔍 Checking Sonarr connection...');
    try {
      const profiles = await sonarrClient.getQualityProfiles();
      log.info(
        `✅ Sonarr connected. Quality profiles: ${profiles.map((p) => `${p.name} (${p.id})`).join(', ')}`,
      );
      const folders = await sonarrClient.getRootFolders();
      log.info(`📁 Root folders: ${folders.map((f) => f.path).join(', ')}`);
    } catch (error) {
      log.warn(
        `⚠️  Could not connect to Sonarr: ${error instanceof Error ? error.message : error}`,
      );
      log.warn('   Bot will start anyway. Sonarr features will fail until connection is restored.');
    }

    sonarrConfig = {
      sonarrClient,
      qualityProfileId: config.sonarr.qualityProfileId,
      rootFolderPath: config.sonarr.rootFolderPath,
    };
  } else {
    log.info('ℹ️  Sonarr not configured. TV show requests will be disabled.');
  }

  log.info('🗄️  Initializing database...');
  getDb();
  log.info('✅ Database ready.');

  let slackApp: ReturnType<typeof createSlackApp>['app'] | null = null;
  let slackConnected: (() => boolean) | null = null;
  let discordApp: any = null; // Will type properly when initializing

  if (config.slack) {
    const slack = createSlackApp(
      {
        requestChannelId: config.slack.requestChannelId,
        botToken: config.slack.botToken,
        appToken: config.slack.appToken,
        approvalChannelId: config.slack.approvalChannelId,
        approverSlackIds: config.slack.approverSlackIds,
        qualityProfileId: config.radarr.qualityProfileId,
        rootFolderPath: config.radarr.rootFolderPath,
        sonarr: sonarrConfig,
      },
      radarrClient,
    );

    slackApp = slack.app;
    slackConnected = slack.isConnected;
    await slackApp.start();
    log.info('💬 Slack bot started successfully.');
  } else {
    log.info('ℹ️  Slack credentials not provided. Slack bot will not start.');
  }

  if (config.discord) {
    // TODO: Initialize Discord bot here
    log.info('🎮 Discord credentials provided. Starting Discord bot...');
    const { createDiscordApp } = await import('./discord/index');
    discordApp = await createDiscordApp(
      {
        botToken: config.discord.botToken,
        clientId: config.discord.clientId,
        guildId: config.discord.guildId,
        requestChannelId: config.discord.requestChannelId,
        approvalChannelId: config.discord.approvalChannelId,
        approverDiscordIds: config.discord.approverDiscordIds,
        qualityProfileId: config.radarr.qualityProfileId,
        rootFolderPath: config.radarr.rootFolderPath,
        sonarr: sonarrConfig,
      },
      radarrClient,
    );

    await discordApp.login(config.discord.botToken);
    log.info('🎮 Discord bot started successfully.');
  } else {
    log.info('ℹ️  Discord credentials not provided. Discord bot will not start.');
  }

  startPoller({
    slackClient: slackApp?.client ?? null,
    discordClient: discordApp ?? null,
    radarrClient,
    sonarrClient: sonarrConfig?.sonarrClient ?? null,
  });

  const health = startHealthServer(() => {
    getDb().query('SELECT 1').get();
    return (slackConnected?.() ?? true) && (discordApp?.isReady() ?? true);
  });

  log.info('⚡️ Movie Bot is running!');
  if (config.slack) {
    log.info(`   Slack Request channel: ${config.slack.requestChannelId}`);
    log.info(`   Slack Approval channel: ${config.slack.approvalChannelId}`);
    log.info(`   Slack Approvers: ${config.slack.approverSlackIds.join(', ')}`);
  }
  if (config.discord) {
    log.info(`   Discord Request channel: ${config.discord.requestChannelId}`);
    log.info(`   Discord Approval channel: ${config.discord.approvalChannelId}`);
    log.info(`   Discord Approvers: ${config.discord.approverDiscordIds.join(', ')}`);
  }
  log.info(`   Sonarr: ${config.sonarr ? 'enabled' : 'disabled'}`);

  const shutdown = async (signal: string): Promise<void> => {
    log.info(`\n${signal} received. Shutting down gracefully...`);
    await health.stop();
    stopPoller();
    if (slackApp) await slackApp.stop();
    if (discordApp) await discordApp.destroy();
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((error) => {
  log.error(`Fatal error: ${error}`);
  process.exit(1);
});
