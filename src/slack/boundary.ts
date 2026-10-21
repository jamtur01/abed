import { consumeRequestBudget } from '../core/submission';
import type { App, SlackCommandMiddlewareArgs } from '@slack/bolt';

/** Reject commands and actions outside their configured channel before any handler runs. */
export function registerChannelBoundary(
  app: App,
  config: {
    requestChannelId: string;
    approvalChannelId: string;
  },
): void {
  app.use(async ({ body, ack, next }) => {
    const payload = body as {
      channel_id?: string;
      channel?: { id: string };
      actions?: { action_id: string }[];
    };
    const channel = payload.channel_id ?? payload.channel?.id;
    const approval = payload.actions?.some((a) => /^(approve|reject)_/.test(a.action_id));
    if (channel !== (approval ? config.approvalChannelId : config.requestChannelId)) {
      if (ack)
        await (ack as SlackCommandMiddlewareArgs['ack'])(
          'command' in body
            ? {
                response_type: 'ephemeral',
                text: 'Use the configured channel and wait a minute if you reached the request limit.',
              }
            : undefined,
        );
      return;
    }
    const request = body as { command?: string; user_id?: string; user?: { id: string } };
    const user = request.user_id ?? request.user?.id;
    if (
      !approval &&
      user &&
      (!request.command || ['/movie', '/tv'].includes(request.command)) &&
      !consumeRequestBudget('slack', user)
    ) {
      if (ack)
        await (ack as SlackCommandMiddlewareArgs['ack'])(
          'command' in body
            ? {
                response_type: 'ephemeral',
                text: 'Use the configured channel and wait a minute if you reached the request limit.',
              }
            : undefined,
        );
      return;
    }
    await next();
  });
}
