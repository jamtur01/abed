import { describe, expect, it } from 'bun:test';
import { RadarrClient } from '../src/radarr/client';
import { SonarrClient } from '../src/sonarr/client';

for (const Client of [RadarrClient, SonarrClient]) {
  describe(Client.name, () => {
    it('rejects unsafe configured URLs', () => {
      for (const url of [
        'ftp://host',
        'http://user:pass@host',
        'http://host?key=x',
        'http://host#fragment',
        'invalid',
      ]) {
        expect(() => new Client(url, 'dummy')).toThrow();
      }
    });

    it('aborts an Arr endpoint that never returns headers', async () => {
      const server = Bun.serve({
        port: 0,
        idleTimeout: 0,
        fetch: () => new Promise<Response>(() => {}),
      });
      const start = Date.now();
      try {
        await expect(new Client(server.url.toString(), 'dummy').getRootFolders()).rejects.toThrow();
        expect(Date.now() - start).toBeLessThan(19_000);
      } finally {
        server.stop(true);
      }
    }, 20_000);

    it('never forwards a key to a redirect target', async () => {
      let calls = 0;
      const target = Bun.serve({
        port: 0,
        fetch: () => {
          calls++;
          return Response.json([]);
        },
      });
      const source = Bun.serve({
        port: 0,
        fetch: () => Response.redirect(target.url.toString(), 302),
      });
      try {
        await expect(new Client(source.url.toString(), 'dummy').getRootFolders()).rejects.toThrow();
        expect(calls).toBe(0);
      } finally {
        source.stop(true);
        target.stop(true);
      }
    });
  });
}
