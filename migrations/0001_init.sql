-- smplmark v1 initial schema.
-- Hierarchy: account (1)->(N) benchmark (1)->(N) target (1)->(N) run (1)->(N) sample.
-- SQLite/D1 types only. Timestamps are INTEGER epoch-ms UTC. UUIDs are TEXT. JSON bags are TEXT.
-- FOREIGN KEY clauses document intent; D1 does not enforce them by default and the app layer
-- validates parent existence on write, so insert order is the only practical constraint.

CREATE TABLE account (
  id         TEXT    PRIMARY KEY,
  key        TEXT    NOT NULL,
  name       TEXT    NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX account_key ON account (key);

CREATE TABLE benchmark (
  id            TEXT    PRIMARY KEY,
  account_id    TEXT    NOT NULL REFERENCES account (id),
  key           TEXT    NOT NULL,
  name          TEXT    NOT NULL,
  description   TEXT,
  visibility    TEXT    NOT NULL DEFAULT 'private'
                        CHECK (visibility IN ('published', 'private')),
  sample_schema TEXT    NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE UNIQUE INDEX benchmark_account_key ON benchmark (account_id, key);

CREATE TABLE target (
  id           TEXT    PRIMARY KEY,
  benchmark_id TEXT    NOT NULL REFERENCES benchmark (id),
  key          TEXT    NOT NULL,
  name         TEXT    NOT NULL,
  details      TEXT,
  -- Hash of the ingest secret. Nullable (bulk-only targets have none). Never surfaced on the wire.
  secret_hash  TEXT,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE UNIQUE INDEX target_benchmark_key ON target (benchmark_id, key);
-- Partial unique index: O(1) ingest-auth lookup, allows many bulk-only targets with NULL secret.
CREATE UNIQUE INDEX target_secret_hash ON target (secret_hash) WHERE secret_hash IS NOT NULL;

CREATE TABLE run (
  id         TEXT    PRIMARY KEY,
  target_id  TEXT    NOT NULL REFERENCES target (id),
  key        TEXT    NOT NULL,
  name       TEXT,
  details    TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX run_target_key ON run (target_id, key);

CREATE TABLE sample (
  -- INTEGER PRIMARY KEY is a rowid alias: database-assigned, returned as last_row_id on insert.
  id         INTEGER PRIMARY KEY,
  run_id     TEXT    NOT NULL REFERENCES run (id),
  created_at INTEGER NOT NULL,
  metrics    TEXT,
  meta       TEXT,
  -- From CF-Connecting-IP. Write-only in v1: captured on ingest, never surfaced.
  client_ip  TEXT
);
-- Load-bearing: serves the chart/range query and keeps run-scoped range reads off a full scan.
CREATE INDEX sample_run_created ON sample (run_id, created_at);
