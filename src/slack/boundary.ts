import type { App } from "@slack/bolt";

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
      if (ack) await ack();
      return;
    }
    await next();
  });
}
