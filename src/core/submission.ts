import { createRequest, createTvRequest, getDb } from "../db/index";
import type { CreateRequestInput, CreateTvRequestInput, Platform } from "../db/types";

export class SubmissionDenied extends Error {}

/** Check before API work, then repeat under the write lock when reserving the row. */
export function assertCanSubmit(
  kind: "movie" | "tv",
  platform: Platform,
  user: string,
  mediaId: number,
): void {
  const table = kind === "movie" ? "requests" : "tv_requests";
  const column = kind === "movie" ? "tmdb_id" : "tvdb_id";
  if (
    getDb()
      .query(`SELECT id FROM ${table} WHERE platform=? AND ${column}=?
    AND status IN ('pending','submitting','uncertain') LIMIT 1`)
      .get(platform, mediaId)
  ) {
    throw new SubmissionDenied("This title already has an active request. Check /queue.");
  }
  const count =
    getDb()
      .query<{ total: number }, [string, string]>(`SELECT count(*) AS total FROM (
    SELECT requester_slack_id, platform, created_at FROM requests UNION ALL
    SELECT requester_slack_id, platform, created_at FROM tv_requests
  ) WHERE platform=? AND requester_slack_id=? AND created_at >= datetime('now','-1 hour')`)
      .get(platform, user)?.total ?? 0;
  if (count >= 10) throw new SubmissionDenied("Request limit reached: 10 titles per hour.");
}

export function reserveMovieRequest(input: CreateRequestInput) {
  return getDb()
    .transaction(() => {
      assertCanSubmit("movie", input.platform ?? "slack", input.requester_slack_id, input.tmdb_id);
      return createRequest(input);
    })
    .immediate();
}

export function reserveTvRequest(input: CreateTvRequestInput) {
  return getDb()
    .transaction(() => {
      assertCanSubmit("tv", input.platform ?? "slack", input.requester_slack_id, input.tvdb_id);
      return createTvRequest(input);
    })
    .immediate();
}

/** Fixed-minute budget shared by searches and selections, persisted across restart. */
export function consumeRequestBudget(platform: Platform, user: string): boolean {
  const minute = Math.floor(Date.now() / 60_000);
  const db = getDb();
  db.query("DELETE FROM request_rate_limits WHERE minute < ?").run(minute);
  return (
    db
      .query(`INSERT INTO request_rate_limits(platform,user_id,minute,count)
    VALUES(?,?,?,1) ON CONFLICT(platform,user_id) DO UPDATE SET count=count+1
    WHERE count < 20 RETURNING count`)
      .get(platform, user, minute) !== null
  );
}
