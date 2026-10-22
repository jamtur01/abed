# PROJECT KNOWLEDGE BASE

**Generated:** 2026-03-27

## OVERVIEW

Slack and Discord bot for movie and TV show requests with approval workflow. Users run `/movie <title>` or `/tv <title>` → select from dropdown → approval posted to channel → approver Approve/Reject → Radarr (movies) or Sonarr (TV) adds the title. A download poller notifies requesters via Slack DM when media is ready. Built on `@slack/bolt` v4 (Socket Mode), `discord.js` v14, Bun runtime, SQLite via `bun:sqlite`. Either platform (or both) can run simultaneously. Sonarr is optional.

## STRUCTURE

```
abed/
├── src/
│   ├── index.ts                     # Entry point: config → healthchecks → DB init → Slack/Discord start → poller start + graceful shutdown
│   ├── logger.ts                    # Structured logger: createLogger(prefix), log levels via LOG_LEVEL env, secret redaction via _setSecrets()
│   ├── poller.ts                    # Download status poller: 15min interval, checks Radarr/Sonarr for completed downloads → DMs requester via Slack or Discord
│   ├── config/
│   │   └── index.ts                 # Env var parser — singleton with _resetConfig() for tests. Sections: slack | null, discord | null, radarr, sonarr | null
│   ├── core/
│   │   ├── searchCache.ts           # Shared in-memory search cache (movie + TV) — Map<userId, results> with 5min TTL, used by both Slack and Discord
│   │   └── helpers/
│   │       └── submitForApproval.ts # Shared Slack helper: submitMovieForApproval + submitTvForApproval — exists check → DB insert → post approval msg → auto-join channel
│   ├── db/
│   │   ├── index.ts                 # SQLite CRUD — singleton with _resetDb(). Tables: requests + tv_requests. Migrations for downloaded_notified and platform columns
│   │   └── types.ts                 # MovieRequest, TvRequest, Create/Update inputs, RequestStatus, Platform
│   ├── radarr/
│   │   ├── client.ts                # RadarrClient class — fetch wrapper for /api/v3/* (search, add, exists, getByTmdbId, quality profiles, root folders)
│   │   └── types.ts                 # RadarrSearchResult, RadarrMovie, AddMoviePayload, RadarrQualityProfile, RadarrRootFolder
│   ├── sonarr/
│   │   ├── client.ts                # SonarrClient class — fetch wrapper for /api/v3/* (searchSeries, addSeries, seriesExists, getSeriesByTvdbId, quality profiles, root folders)
│   │   └── types.ts                 # SonarrSearchResult, SonarrSeries, AddSeriesPayload, SonarrQualityProfile, SonarrRootFolder
│   ├── slack/
│   │   ├── index.ts                 # createSlackApp() — wires all Slack handlers (movie + TV + myrequests + queue) to App instance
│   │   ├── commands/
│   │   │   ├── movie.ts             # /movie command — search Radarr + cache + respond with dropdown
│   │   │   ├── tv.ts                # /tv command — search Sonarr + cache + respond with dropdown (shows "not configured" if Sonarr is null)
│   │   │   ├── myrequests.ts        # /myrequests command — query both movie + TV requests, optional status filter
│   │   │   └── queue.ts             # /queue command — server-wide request queue, optional status filter
│   │   ├── actions/
│   │   │   ├── selectMovie.ts       # Dropdown selection → uses submitMovieForApproval helper
│   │   │   ├── approveMovie.ts      # Approve button → auth check → re-search Radarr → addMovie → update msg → DM requester
│   │   │   ├── rejectMovie.ts       # Reject button → auth check → update DB → update msg → DM requester
│   │   │   ├── selectTv.ts          # TV dropdown selection → uses submitTvForApproval helper
│   │   │   ├── approveTv.ts         # TV approve button → auth check → re-search Sonarr → addSeries → update msg → DM requester
│   │   │   └── rejectTv.ts          # TV reject button → auth check → update DB → update msg → DM requester
│   │   └── messages/
│   │       ├── index.ts             # Block Kit message builders for movies + TV. Exports ACTION_IDS, BLOCK_IDS, buildMyRequestsMessage
│   │       └── types.ts             # Slack Block Kit type subset (Block, TextObject, ButtonElement, etc.) — DO NOT use @slack/types
│   └── discord/
│       ├── index.ts                 # createDiscordApp() — creates Client, registers slash commands via REST on clientReady, routes interactionCreate to handlers
│       ├── commands/
│       │   ├── movie.ts             # Discord /movie — SlashCommandBuilder def + executeMovieCommand handler
│       │   ├── tv.ts                # Discord /tv — SlashCommandBuilder def + executeTvCommand handler
│       │   ├── myrequests.ts        # Discord /myrequests — SlashCommandBuilder def + executeMyRequestsCommand handler
│       │   └── queue.ts             # Discord /queue — SlashCommandBuilder def + executeQueueCommand handler
│       ├── actions/
│       │   ├── select.ts            # handleSelectMovie + handleSelectTv — select menu interaction handlers
│       │   ├── approveMovie.ts      # handleApproveMovie + handleRejectMovie — button interaction handlers for movies
│       │   └── approveTv.ts         # handleApproveTv + handleRejectTv — button interaction handlers for TV
│       └── messages/
│           └── index.ts             # Discord embed + component builders using discord.js EmbedBuilder/ButtonBuilder/StringSelectMenuBuilder
├── tests/                           # Mirrors src/ — bun:test with mock() helpers
│   ├── config.test.ts
│   ├── logger.test.ts
│   ├── poller.test.ts
│   ├── db/index.test.ts
│   ├── radarr/client.test.ts
│   ├── sonarr/client.test.ts
│   ├── core/helpers/submitForApproval.test.ts
│   ├── slack/
│   │   ├── messages.test.ts
│   │   ├── commands/{movie,tv,myrequests,queue}.test.ts
│   │   └── actions/{selectMovie,approveMovie,rejectMovie,selectTv,approveTv,rejectTv}.test.ts
│   ├── discord/
│   │   ├── messages.test.ts
│   │   ├── commands/{movie,tv,myrequests,queue}.test.ts
│   │   └── actions/{select,approveMovie,approveTv}.test.ts
│   └── integration/flow.test.ts     # Full flow: command → select → approve/reject (Slack)
├── data/                            # SQLite DB files (gitignored)
├── Dockerfile                       # Multi-stage: oven/bun:1 builder → oven/bun:1-alpine runtime, PUID/PGID support via entrypoint, healthcheck
├── docker-entrypoint.sh             # Adjusts UID/GID to PUID/PGID env vars, runs as non-root via su-exec
└── docker-compose.yml               # Single service on external "media" network, mounts ./data:/app/data
```

## WHERE TO LOOK

| Task | Location | Notes |
|------|----------|-------|
| Add new Slack slash command | `src/slack/commands/` + register in `src/slack/index.ts` | Follow `/movie` or `/tv` pattern: `registerXxxCommand(app, deps)` |
| Add new Slack button/select action | `src/slack/actions/` + register in `src/slack/index.ts` | Follow approve/reject/select pattern |
| Add new Discord slash command | `src/discord/commands/` + register in `src/discord/index.ts` | Export `xxxCommandDef` (SlashCommandBuilder) + `executeXxxCommand`. Add to `commands[]` and `interactionCreate` routing |
| Add new Discord button/select action | `src/discord/actions/` + route in `src/discord/index.ts` | Add handler function, wire via `interaction.customId` prefix in `interactionCreate` |
| Change Slack approval message UI | `src/slack/messages/index.ts` | Block Kit builders. Types in `src/slack/messages/types.ts` |
| Change Discord approval message UI | `src/discord/messages/index.ts` | Uses discord.js EmbedBuilder, ButtonBuilder, StringSelectMenuBuilder |
| Add new Slack Block Kit element | `src/slack/messages/types.ts` | Custom type subset — DO NOT use @slack/types |
| Add Radarr API call | `src/radarr/client.ts` + `src/radarr/types.ts` | Uses private `request<T>()` helper |
| Add Sonarr API call | `src/sonarr/client.ts` + `src/sonarr/types.ts` | Same `request<T>()` pattern as Radarr |
| Add DB column/table | `src/db/index.ts` (schema + migrations) + `src/db/types.ts` | Use `ALTER TABLE` migration function pattern for existing tables |
| Add env var | `src/config/index.ts` + `.env.example` | Use `required()` helper. Platform sections are all-or-none |
| Add a new platform | Create `src/<platform>/` with `commands/`, `actions/`, `messages/` + hook into `src/index.ts` | Follow Slack/Discord patterns. Add startup + shutdown. Update `Platform` type in `src/db/types.ts` |
| Change logging behavior | `src/logger.ts` | `createLogger(prefix)`, secret redaction, level via `LOG_LEVEL` env |
| Change download notifications | `src/poller.ts` | Polls Radarr/Sonarr on 15min interval, DMs via Slack or Discord when downloaded |
| Understand data flow | `tests/integration/flow.test.ts` | Shows full Slack command → approval cycle |
| Understand shared Slack approval logic | `src/core/helpers/submitForApproval.ts` | Used by Slack select handlers. Discord handles approval posting directly in action handlers |

## CONVENTIONS

- **Singleton + reset pattern**: Config, DB, and Poller use module-level singletons with exported `_reset*()` functions for test isolation. Always call reset in `beforeEach`.
- **Slack handler registration**: Each Slack handler is a `register*()` function taking `(app, deps)`. Dependencies are explicit typed objects, not global imports.
- **Discord handler pattern**: Commands export a `xxxCommandDef` (SlashCommandBuilder) and an `executeXxxCommand` function. Actions export `handleXxx` functions. All are wired centrally in `src/discord/index.ts` via `interactionCreate` event routing by `commandName` or `customId` prefix. There are no `register*()` functions for Discord — it uses a central dispatcher pattern.
- **Dependency injection via deps object**: Both Slack and Discord handlers receive typed deps (clients, channel IDs, approver IDs) — no direct env access outside `config/`.
- **API client pattern**: RadarrClient and SonarrClient follow the same class structure with a private `request<T>()` helper for HTTP calls, logging, and error handling. Sonarr uses lowercase API paths (`/qualityprofile`, `/rootfolder`) unlike Radarr (`/qualityProfile`, `/rootFolder`).
- **Shared search cache**: `src/core/searchCache.ts` is shared across both platforms. Separate `Map`s for movies and TV, both with 5min TTL. Slack keys by raw `userId`, Discord keys by `discord_${userId}` prefix to avoid collisions.
- **Shared core helpers**: `src/core/helpers/submitForApproval.ts` centralizes the Slack approval flow (exists check → DB insert → post message → auto-join channel). Discord handles this logic inline in its action handlers.
- **Structured logging**: All modules use `createLogger('prefix')` from `src/logger.ts`. Supports `debug`, `info`, `warn`, `error` levels controlled by `LOG_LEVEL` env. Secrets are auto-redacted from output.
- **DB column naming legacy**: `requester_slack_id`, `approver_slack_id`, and `slack_message_ts` columns hold Discord user/message IDs too — names kept for schema backwards compatibility. Comments in `src/db/types.ts` document this.
- **`(body as any).actions[0]`**: Bolt v4 typing gaps — Slack action payloads are cast. Don't try to fix this, it's intentional.
- **`Routes.applicationGuildCommands(...) as any`**: discord.js REST API typing workaround in `src/discord/index.ts`. Intentional.
- **Tests use `mock()` from `bun:test`**: No jest, no vitest. Mock functions via `mock()`, mock fetch by assigning `globalThis.fetch`.
- **Tests use in-memory SQLite**: `getDb(':memory:')` in `beforeEach` after `_resetDb()`.
- **No barrel exports at action/command level**: Only `messages/` and `db/` have `index.ts` barrels. Import actions/commands directly by file.

## ANTI-PATTERNS (THIS PROJECT)

- **DO NOT** access `process.env` outside `src/config/index.ts` (exceptions: `DB_PATH` in `src/db/index.ts`, `LOG_LEVEL` in `src/logger.ts`)
- **DO NOT** use `@slack/types` for Block Kit — use local `src/slack/messages/types.ts` subset
- **DO NOT** store full movie/show data in Slack action values — Slack has 150-char limit. Selections use `tmdbId`/`tvdbId` from the user cache; approval buttons use immutable request IDs and validate message/channel/platform
- **DO NOT** add global `fetch` mocks — each test assigns `globalThis.fetch` locally
- **DO NOT** import RadarrClient or SonarrClient directly in action handlers — receive via deps injection
- **DO NOT** rename `requester_slack_id`, `approver_slack_id`, or `slack_message_ts` DB columns — they are reused for Discord IDs for schema backwards compatibility
- **DO NOT** use discord.js `interaction.reply()` for long-running operations — use `.deferUpdate()` then `.followUp()` or `.message.edit()`
- **DO NOT** forget the `discord_` prefix when using the search cache from Discord handlers — omitting it will collide with Slack user keys

## COMMANDS

```bash
bun run dev          # Dev mode with auto-reload (bun --watch src/index.ts)
bun run start        # Production: bun run src/index.ts
bun test             # All tests (bun:test)
bun run typecheck    # tsc --noEmit (strict mode, noUncheckedIndexedAccess)

# Docker
docker compose up -d              # Start on "media" network
docker compose logs -f abed       # Tail logs
```

## NOTES

- **Dual-platform support**: Either Slack, Discord, or both can run simultaneously. Config detects which platform(s) have credentials and starts only those. At least one platform must be configured or startup fails.
- **Sonarr is optional**: All four `SONARR_*` vars must be set together or not at all (all-or-none validation). If absent, `/tv` responds with "not configured" and TV handlers are not registered (Slack) or gracefully reject (Discord).
- **Startup order**: Config → Radarr client + healthcheck → Sonarr client + healthcheck (if configured) → DB init → Slack start (if configured) → Discord start (if configured) → Poller start → ready.
- **Slack uses Socket Mode** — no HTTP server, no public URL needed. Works behind NAT.
- **Discord uses Gateway + REST** — slash commands registered via REST API on `clientReady` event. Guild-specific commands (instant) if `DISCORD_GUILD_ID` is set, otherwise global commands (up to 1 hour to propagate).
- **Discord dynamic import**: `src/discord/index.ts` is imported via `await import(...)` in `src/index.ts` to avoid loading discord.js when Discord is not configured.
- **Both Radarr and Sonarr connections are non-blocking** — bot starts even if either is down; API calls will fail at request time with logged warnings.
- **not_in_channel auto-join** (Slack only): `submitForApproval` catches Slack's `not_in_channel` error and auto-joins the approval channel before retrying. Discord fetches the channel directly and has no equivalent auto-join.
- **Approval ownership**: `src/core/approval.ts` atomically claims pending rows before API work.
  Failed/interrupted writes stay uncertain and can only be reconciled through exact Arr identity;
  never reset them to pending or blindly retry writes. SQLite uses synchronous FULL.
- **Submission limits**: `src/core/submission.ts` reserves rows under an immediate transaction,
  rejecting active title/platform duplicates and more than ten user submissions/hour across media.
  Both platform boundaries limit searches/selections to twenty/user/fixed minute in SQLite.
- **Message binding**: Approval handlers require immutable request IDs, platform, stored channel
  and message identity. Old buttons are invalid. Failed/unbound message posts become failed;
  startup preserves bound pending requests and marks interrupted writes uncertain.
- **Channel boundaries**: Slack global middleware and Discord dispatcher restrict commands and
  selections to request channels, approvals to approval channels; Discord also checks guild.
  Queue/user history queries filter platform before applying limits.
- **Download poller**: `src/poller.ts` runs on a 15-minute interval. Checks Radarr for `hasFile` on approved movies and Sonarr for `episodeFileCount > 0` on approved TV shows. Sends DM notification via Slack or Discord (based on `request.platform`) and marks `downloaded_notified = 1`.
- **`DB_PATH` default**: `./data/requests.db` locally, overridden to `/app/data/requests.db` via docker-compose env.
- **Migration pattern**: Schema uses `CREATE TABLE IF NOT EXISTS` for initial setup. Additive column changes use manual migration functions (`migrateDownloadedNotified`, `migratePlatform`) that check `PRAGMA table_info` before `ALTER TABLE`. Destructive schema changes require manual DB handling.
- **PUID/PGID support**: `docker-entrypoint.sh` adjusts the `abed` user's UID/GID to match `PUID`/`PGID` env vars (defaults to 1001:1001). Handles conflicts with existing UIDs/GIDs on the system.
- **Docker healthcheck**: loopback `/healthz` checks the event loop, SQLite query and configured Slack/Discord connection state every 30s, with 120s startup grace. Arr and full command delivery remain separate functional checks.
- **Secret redaction**: `src/logger.ts` redacts configured secrets (API keys, tokens) from all log output. Secrets are set once at startup via `_setSecrets()`.
- **Graceful shutdown**: SIGTERM/SIGINT triggers `stopPoller()` → `slackApp.stop()` → `discordApp.destroy()` → `process.exit(0)`.
- **tsconfig strict**: `strict: true` + `noUncheckedIndexedAccess: true` + `verbatimModuleSyntax: true`. All imports must use explicit `type` keyword for type-only imports.
