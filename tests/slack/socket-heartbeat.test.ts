import { expect, it } from 'bun:test';
import { EventEmitter } from 'node:events';
import { SlackWebSocket } from '@slack/socket-mode/dist/src/SlackWebSocket';

it('keeps the native Slack websocket alive through ping/pong heartbeats on Bun', async () => {
  let pings = 0;
  const errors: unknown[] = [];
  const server = Bun.serve({
    port: 0,
    fetch(request, listener) {
      if (listener.upgrade(request)) return;
      return new Response('Websocket upgrade required', { status: 400 });
    },
    websocket: {
      message() {},
      ping() {
        pings++;
      },
    },
  });
  const client = new EventEmitter();
  client.on('error', (error) => errors.push(error));
  const socket = new SlackWebSocket({
    url: `ws://127.0.0.1:${server.port}`,
    client: client as any,
    logger: {
      debug() {},
      info() {},
      warn(error: unknown) {
        errors.push(error);
      },
      error(error: unknown) {
        errors.push(error);
      },
    } as any,
    pingInterval: 50,
    clientPingTimeoutMS: 500,
    serverPingTimeoutMS: 2000,
  });
  try {
    socket.connect();
    const deadline = Date.now() + 1500;
    while (pings < 3 && errors.length === 0 && Date.now() < deadline) {
      await Bun.sleep(20);
    }
    expect(errors).toEqual([]);
    expect(pings).toBeGreaterThanOrEqual(3);
    expect(socket.isActive()).toBe(true);
  } finally {
    socket.disconnect();
    server.stop(true);
  }
});
