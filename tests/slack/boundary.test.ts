import { beforeEach, expect, it, mock } from "bun:test";
import { registerChannelBoundary } from "../../src/slack/boundary";
import {
  _resetDb,
  getDb,
  createRequest,
  getAllRequests,
  getRequestsByUserId,
  createTvRequest,
  getAllTvRequests,
  getTvRequestsByUserId,
} from "../../src/db/index";

beforeEach(() => {
  _resetDb();
  getDb(":memory:");
});

it("rejects outside commands and actions before invoking handlers", async () => {
  let handler: any;
  registerChannelBoundary(
    {
      use: (fn: any) => {
        handler = fn;
      },
    } as any,
    { requestChannelId: "REQUEST", approvalChannelId: "APPROVAL" },
  );
  for (const [body, allowed] of [
    [{ channel_id: "OTHER" }, false],
    [{ channel_id: "REQUEST" }, true],
    [{ channel: { id: "OTHER" }, actions: [{ action_id: "select_movie" }] }, false],
    [{ channel: { id: "REQUEST" }, actions: [{ action_id: "select_movie" }] }, true],
    [{ channel: { id: "REQUEST" }, actions: [{ action_id: "approve_movie" }] }, false],
    [{ channel: { id: "APPROVAL" }, actions: [{ action_id: "approve_movie" }] }, true],
    [{ channel: { id: "APPROVAL" }, actions: [{ action_id: "reject_tv" }] }, true],
    [{}, false],
  ] as const) {
    const next = mock(async () => {}),
      ack = mock(async () => {});
    await handler({ body, ack, next });
    expect(next).toHaveBeenCalledTimes(allowed ? 1 : 0);
    expect(ack).toHaveBeenCalledTimes(allowed ? 0 : 1);
  }
});

it("keeps both platform histories separate before applying limits", () => {
  for (const platform of ["slack", "discord"] as const) {
    createRequest({
      movie_title: platform,
      tmdb_id: 1,
      year: 2020,
      requester_slack_id: "same-user",
      platform,
    });
    createTvRequest({
      show_title: platform,
      tvdb_id: 1,
      year: 2020,
      requester_slack_id: "same-user",
      platform,
    });
  }
  for (const platform of ["slack", "discord"] as const) {
    for (const rows of [
      getAllRequests(undefined, platform),
      getAllTvRequests(undefined, platform),
      getRequestsByUserId("same-user", undefined, platform),
      getTvRequestsByUserId("same-user", undefined, platform),
    ]) {
      expect(rows).toHaveLength(1);
      expect(rows[0]?.platform).toBe(platform);
    }
  }
});
