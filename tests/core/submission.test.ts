import { beforeEach, expect, it } from "bun:test";
import { _resetDb, getDb } from "../../src/db/index";
import {
  reserveMovieRequest,
  reserveTvRequest,
  assertCanSubmit,
  consumeRequestBudget,
} from "../../src/core/submission";

beforeEach(() => {
  _resetDb();
  getDb(":memory:");
});
const movie = { movie_title: "Fixture", tmdb_id: 1, year: 2020, requester_slack_id: "USER" };

it("reserves an active title once and refuses duplicates from other users", () => {
  reserveMovieRequest(movie);
  expect(() => reserveMovieRequest({ ...movie, requester_slack_id: "OTHER" })).toThrow(
    "active request",
  );
  for (const status of ["submitting", "uncertain"]) {
    getDb().run("UPDATE requests SET status=?", [status]);
    expect(() => reserveMovieRequest(movie)).toThrow("active request");
  }
  getDb().run("UPDATE requests SET status='rejected'");
  expect(reserveMovieRequest(movie).id).toBe(2);
});

it("limits combined movie and TV submissions before API work and reservation", () => {
  for (let id = 1; id <= 5; id++) {
    reserveMovieRequest({ ...movie, tmdb_id: id });
    reserveTvRequest({
      show_title: "Fixture",
      tvdb_id: id,
      year: 2020,
      requester_slack_id: "USER",
    });
  }
  expect(() => assertCanSubmit("movie", "slack", "USER", 99)).toThrow("10 titles");
  expect(() => reserveMovieRequest({ ...movie, tmdb_id: 99 })).toThrow("10 titles");
  expect(reserveMovieRequest({ ...movie, tmdb_id: 99, requester_slack_id: "OTHER" })).toBeTruthy();
  getDb().run("UPDATE requests SET created_at=datetime('now','-2 hours')");
  expect(reserveMovieRequest({ ...movie, tmdb_id: 100 })).toBeTruthy();
});

it("bounds search traffic per platform/user and expires old budget rows", () => {
  for (let i = 0; i < 20; i++) expect(consumeRequestBudget("slack", "USER")).toBe(true);
  expect(consumeRequestBudget("slack", "USER")).toBe(false);
  expect(consumeRequestBudget("discord", "USER")).toBe(true);
  expect(consumeRequestBudget("slack", "OTHER")).toBe(true);
  getDb().run("UPDATE request_rate_limits SET minute=minute-1");
  expect(consumeRequestBudget("slack", "USER")).toBe(true);
});
