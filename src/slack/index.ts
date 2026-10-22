import { registerChannelBoundary } from './boundary';
import { App, SocketModeReceiver } from '@slack/bolt';
import type { RadarrClient } from '../radarr/client';
import type { SonarrClient } from '../sonarr/client';
import { registerMovieCommand } from './commands/movie';
import { registerSelectMovieAction } from './actions/selectMovie';
import { registerApproveMovieAction } from './actions/approveMovie';
import { registerRejectMovieAction } from './actions/rejectMovie';
import { registerTvCommand } from './commands/tv';
import { registerSelectTvAction } from './actions/selectTv';
import { registerApproveTvAction } from './actions/approveTv';
import { registerRejectTvAction } from './actions/rejectTv';
import { registerMyRequestsCommand } from './commands/myrequests';
import { registerQueueCommand } from './commands/queue';

export function createSlackApp(
  config: {
    requestChannelId: string;
    botToken: string;
    appToken: string;
    approvalChannelId: string;
    approverSlackIds: string[];
    qualityProfileId: number;
    rootFolderPath: string;
    sonarr: {
      sonarrClient: SonarrClient;
      qualityProfileId: number;
      rootFolderPath: string;
    } | null;
  },
  radarrClient: RadarrClient,
): { app: App; isConnected: () => boolean } {
  const receiver = new SocketModeReceiver({ appToken: config.appToken });
  const app = new App({
    token: config.botToken,
    receiver,
  });

  registerChannelBoundary(app, config);

  registerMovieCommand(app, { radarrClient, approvalChannelId: config.approvalChannelId });
  registerSelectMovieAction(app, { radarrClient, approvalChannelId: config.approvalChannelId });
  registerApproveMovieAction(app, {
    radarrClient,
    approverSlackIds: config.approverSlackIds,
    approvalChannelId: config.approvalChannelId,
    qualityProfileId: config.qualityProfileId,
    rootFolderPath: config.rootFolderPath,
  });
  registerRejectMovieAction(app, {
    approverSlackIds: config.approverSlackIds,
    approvalChannelId: config.approvalChannelId,
  });

  // TV show handlers — always register /tv command (shows "not configured" if sonarr is null)
  registerTvCommand(
    app,
    config.sonarr
      ? {
          sonarrClient: config.sonarr.sonarrClient,
          approvalChannelId: config.approvalChannelId,
        }
      : null,
  );

  if (config.sonarr) {
    registerSelectTvAction(app, {
      sonarrClient: config.sonarr.sonarrClient,
      approvalChannelId: config.approvalChannelId,
    });
    registerApproveTvAction(app, {
      sonarrClient: config.sonarr.sonarrClient,
      approverSlackIds: config.approverSlackIds,
      approvalChannelId: config.approvalChannelId,
      qualityProfileId: config.sonarr.qualityProfileId,
      rootFolderPath: config.sonarr.rootFolderPath,
    });
    registerRejectTvAction(app, {
      approverSlackIds: config.approverSlackIds,
      approvalChannelId: config.approvalChannelId,
    });
  }

  registerMyRequestsCommand(app);
  registerQueueCommand(app);

  return { app, isConnected: () => receiver.client.websocket?.isActive() === true };
}
