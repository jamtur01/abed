/** Serve local readiness without credentials, outbound requests or application data. */
export function startHealthServer(isReady: () => boolean, port = 3000) {
  return Bun.serve({
    hostname: '127.0.0.1',
    port,
    fetch(request) {
      if (request.method !== 'GET' || new URL(request.url).pathname !== '/healthz') {
        return new Response(null, { status: 404 });
      }
      try {
        return new Response(null, { status: isReady() ? 200 : 503 });
      } catch {
        // Database errors must report unhealthy without exposing private details.
        return new Response(null, { status: 503 });
      }
    },
  });
}
