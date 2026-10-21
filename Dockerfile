# Build stage
FROM oven/bun:1.4.3@sha256:c017a211c49a21adc0e49dda7b60ac8112887c3d9465e01427f434ed107c830e AS builder
WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production --ignore-scripts

COPY src/ ./src/
COPY tsconfig.json ./

# Runtime stage
FROM oven/bun:1.4.3-alpine@sha256:3cab0e73b1e5f6d4431a03ef7d66e5dc139a41979dccb5672fedcd778df2aeed AS runtime
WORKDIR /app

LABEL org.opencontainers.image.source="https://github.com/jamtur01/abed"
LABEL org.opencontainers.image.description="Slack bot for movie/TV requests with Radarr/Sonarr approval workflow"
LABEL org.opencontainers.image.licenses="MIT"

RUN apk upgrade --no-cache zlib && apk add --no-cache su-exec && \
    addgroup -g 1001 -S abed && \
    adduser -u 1001 -G abed -S -D -H -h /app abed && \
    mkdir -p /app/data && chown abed:abed /app/data

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/tsconfig.json ./tsconfig.json

COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD pgrep -f "bun run" || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["bun", "run", "src/index.ts"]
