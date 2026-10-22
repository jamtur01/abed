import { fetch } from 'bun';
import { expect, test } from 'bun:test';
import { startHealthServer } from '../src/health';

test('readiness follows connection state, fails closed and exposes no error details', async () => {
  let connected = false;
  let databaseFailed = false;
  const server = startHealthServer(() => {
    if (databaseFailed) throw new Error('private database detail');
    return connected;
  }, 0);
  const url = `http://127.0.0.1:${server.port}/healthz`;
  try {
    for (const state of [false, true, false, true]) {
      connected = state;
      expect((await fetch(url)).status).toBe(state ? 200 : 503);
    }
    databaseFailed = true;
    const response = await fetch(url);
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('');
    expect((await fetch(url.replace('/healthz', '/'))).status).toBe(404);
    expect((await fetch(url, { method: 'POST' })).status).toBe(404);
  } finally {
    await server.stop(true);
  }
});
