import { Database } from 'bun:sqlite';
import type {
  MovieRequest,
  CreateRequestInput,
  UpdateRequestStatusInput,
  TvRequest,
  CreateTvRequestInput,
  UpdateTvRequestStatusInput,
  RequestStatus,
  Platform,
} from './types';

const DB_PATH = process.env.DB_PATH ?? './data/requests.db';

let _db: Database | null = null;

export function getDb(path?: string): Database {
  if (!_db) {
    _db = new Database(path ?? DB_PATH, { create: true });
    initSchema(_db);
  }
  return _db;
}

export function _resetDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

function initSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      movie_title TEXT NOT NULL,
      tmdb_id INTEGER NOT NULL,
      imdb_id TEXT,
      year INTEGER NOT NULL,
      poster_url TEXT,
      requester_slack_id TEXT NOT NULL,
      approver_slack_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      slack_message_ts TEXT,
      downloaded_notified INTEGER NOT NULL DEFAULT 0,
      platform TEXT NOT NULL DEFAULT 'slack',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_requests_tmdb_id ON requests(tmdb_id);
    CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
    CREATE INDEX IF NOT EXISTS idx_requests_requester ON requests(requester_slack_id);

    CREATE TABLE IF NOT EXISTS tv_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      show_title TEXT NOT NULL,
      tvdb_id INTEGER NOT NULL,
      year INTEGER NOT NULL,
      poster_url TEXT,
      requester_slack_id TEXT NOT NULL,
      approver_slack_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      slack_message_ts TEXT,
      downloaded_notified INTEGER NOT NULL DEFAULT 0,
      platform TEXT NOT NULL DEFAULT 'slack',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_tv_requests_tvdb_id ON tv_requests(tvdb_id);
    CREATE INDEX IF NOT EXISTS idx_tv_requests_status ON tv_requests(status);
    CREATE INDEX IF NOT EXISTS idx_tv_requests_requester ON tv_requests(requester_slack_id);
  `);

  migrateDownloadedNotified(db);
  migratePlatform(db);
}

function migratePlatform(db: Database): void {
  const columns = db.prepare<{ name: string }, []>(`PRAGMA table_info('requests')`).all();
  const hasColumn = columns.some((c) => c.name === 'platform');
  if (!hasColumn) {
    db.exec(`ALTER TABLE requests ADD COLUMN platform TEXT NOT NULL DEFAULT 'slack'`);
  }

  const tvColumns = db.prepare<{ name: string }, []>(`PRAGMA table_info('tv_requests')`).all();
  const tvHasColumn = tvColumns.some((c) => c.name === 'platform');
  if (!tvHasColumn) {
    db.exec(`ALTER TABLE tv_requests ADD COLUMN platform TEXT NOT NULL DEFAULT 'slack'`);
  }
}

function migrateDownloadedNotified(db: Database): void {
  const columns = db.prepare<{ name: string }, []>(`PRAGMA table_info('requests')`).all();
  const hasColumn = columns.some(c => c.name === 'downloaded_notified');
  if (!hasColumn) {
    db.exec(`ALTER TABLE requests ADD COLUMN downloaded_notified INTEGER NOT NULL DEFAULT 0`);
  }

  const tvColumns = db.prepare<{ name: string }, []>(`PRAGMA table_info('tv_requests')`).all();
  const tvHasColumn = tvColumns.some(c => c.name === 'downloaded_notified');
  if (!tvHasColumn) {
    db.exec(`ALTER TABLE tv_requests ADD COLUMN downloaded_notified INTEGER NOT NULL DEFAULT 0`);
  }
}

export function getApprovedUnnotifiedRequests(): MovieRequest[] {
  const db = getDb();
  return db.prepare<MovieRequest, []>(
    `SELECT * FROM requests WHERE status = 'approved' AND downloaded_notified = 0`,
  ).all();
}

export function getApprovedUnnotifiedTvRequests(): TvRequest[] {
  const db = getDb();
  return db.prepare<TvRequest, []>(
    `SELECT * FROM tv_requests WHERE status = 'approved' AND downloaded_notified = 0`,
  ).all();
}

export function markDownloadNotified(id: number): void {
  const db = getDb();
  db.prepare(`UPDATE requests SET downloaded_notified = 1, updated_at = datetime('now') WHERE id = ?`).run(id);
}

export function markTvDownloadNotified(id: number): void {
  const db = getDb();
  db.prepare(`UPDATE tv_requests SET downloaded_notified = 1, updated_at = datetime('now') WHERE id = ?`).run(id);
}

export function createRequest(input: CreateRequestInput): MovieRequest {
  const db = getDb();
  const stmt = db.prepare<MovieRequest, [string, number, string | null, number, string | null, string, string | null, string]>(`
    INSERT INTO requests (movie_title, tmdb_id, imdb_id, year, poster_url, requester_slack_id, slack_message_ts, platform)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `);
  const result = stmt.get(
    input.movie_title,
    input.tmdb_id,
    input.imdb_id ?? null,
    input.year,
    input.poster_url ?? null,
    input.requester_slack_id,
    input.slack_message_ts ?? null,
    input.platform ?? 'slack'
  );
  if (!result) throw new Error('Failed to create request');
  return result;
}

export function getRequest(id: number): MovieRequest | null {
  const db = getDb();
  return db.prepare<MovieRequest, [number]>('SELECT * FROM requests WHERE id = ?').get(id) ?? null;
}

export function getRequestByTmdbId(tmdbId: number): MovieRequest | null {
  const db = getDb();
  return (
    db
      .prepare<MovieRequest, [number]>(
        'SELECT * FROM requests WHERE tmdb_id = ? ORDER BY id DESC LIMIT 1',
      )
      .get(tmdbId) ?? null
  );
}

export function getRequestsByUserId(userId: string, status?: RequestStatus, platform: Platform = 'slack'): MovieRequest[] {
  const filters = ['platform = ? AND requester_slack_id = ?'];
  const values: string[] = [platform, userId];
  if (status) { filters.push('status = ?'); values.push(status); }
  return getDb().query<MovieRequest, string[]>(
    `SELECT * FROM requests WHERE ${filters.join(' AND ')} ORDER BY created_at DESC LIMIT 15`,
  ).all(...values);
}

export function getAllRequests(status?: RequestStatus, platform: Platform = 'slack'): MovieRequest[] {
  const filters = ['platform = ?'];
  const values: string[] = [platform];
  if (status) { filters.push('status = ?'); values.push(status); }
  return getDb().query<MovieRequest, string[]>(
    `SELECT * FROM requests WHERE ${filters.join(' AND ')} ORDER BY created_at DESC LIMIT 25`,
  ).all(...values);
}

export function updateRequestStatus(input: UpdateRequestStatusInput): MovieRequest {
  const db = getDb();
  const setClauses = ['status = ?', "updated_at = datetime('now')"];
  const values: (string | number | null)[] = [input.status];

  if (input.approver_slack_id !== undefined) {
    setClauses.push('approver_slack_id = ?');
    values.push(input.approver_slack_id);
  }
  if (input.slack_message_ts !== undefined) {
    setClauses.push('slack_message_ts = ?');
    values.push(input.slack_message_ts);
  }
  values.push(input.id);

  const sql = `UPDATE requests SET ${setClauses.join(', ')} WHERE id = ? RETURNING *`;
  const result = db.query<MovieRequest, (string | number | null)[]>(sql).get(...values);

  if (!result) throw new Error(`Request ${input.id} not found`);
  return result;
}

export function createTvRequest(input: CreateTvRequestInput): TvRequest {
  const db = getDb();
  const stmt = db.prepare<TvRequest, [string, number, number, string | null, string, string | null, string]>(`
    INSERT INTO tv_requests (show_title, tvdb_id, year, poster_url, requester_slack_id, slack_message_ts, platform)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    RETURNING *
  `);
  const result = stmt.get(
    input.show_title,
    input.tvdb_id,
    input.year,
    input.poster_url ?? null,
    input.requester_slack_id,
    input.slack_message_ts ?? null,
    input.platform ?? 'slack'
  );
  if (!result) throw new Error('Failed to create TV request');
  return result;
}

export function getTvRequest(id: number): TvRequest | null {
  const db = getDb();
  return db.prepare<TvRequest, [number]>('SELECT * FROM tv_requests WHERE id = ?').get(id) ?? null;
}

export function getTvRequestByTvdbId(tvdbId: number): TvRequest | null {
  const db = getDb();
  return (
    db
      .prepare<TvRequest, [number]>(
        'SELECT * FROM tv_requests WHERE tvdb_id = ? ORDER BY id DESC LIMIT 1',
      )
      .get(tvdbId) ?? null
  );
}

export function getTvRequestsByUserId(userId: string, status?: RequestStatus, platform: Platform = 'slack'): TvRequest[] {
  const filters = ['platform = ? AND requester_slack_id = ?'];
  const values: string[] = [platform, userId];
  if (status) { filters.push('status = ?'); values.push(status); }
  return getDb().query<TvRequest, string[]>(
    `SELECT * FROM tv_requests WHERE ${filters.join(' AND ')} ORDER BY created_at DESC LIMIT 15`,
  ).all(...values);
}

export function getAllTvRequests(status?: RequestStatus, platform: Platform = 'slack'): TvRequest[] {
  const filters = ['platform = ?'];
  const values: string[] = [platform];
  if (status) { filters.push('status = ?'); values.push(status); }
  return getDb().query<TvRequest, string[]>(
    `SELECT * FROM tv_requests WHERE ${filters.join(' AND ')} ORDER BY created_at DESC LIMIT 25`,
  ).all(...values);
}

export function updateTvRequestStatus(input: UpdateTvRequestStatusInput): TvRequest {
  const db = getDb();
  const setClauses = ['status = ?', "updated_at = datetime('now')"];
  const values: (string | number | null)[] = [input.status];

  if (input.approver_slack_id !== undefined) {
    setClauses.push('approver_slack_id = ?');
    values.push(input.approver_slack_id);
  }
  if (input.slack_message_ts !== undefined) {
    setClauses.push('slack_message_ts = ?');
    values.push(input.slack_message_ts);
  }
  values.push(input.id);

  const sql = `UPDATE tv_requests SET ${setClauses.join(', ')} WHERE id = ? RETURNING *`;
  const result = db.query<TvRequest, (string | number | null)[]>(sql).get(...values);

  if (!result) throw new Error(`TV request ${input.id} not found`);
  return result;
}
