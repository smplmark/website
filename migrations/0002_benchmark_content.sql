-- Data-driven benchmark pages need richer content, surfaced from the DB (never hard-coded in the UI).
-- benchmark: an `about` overview and a `methodology` writeup (description stays the short tagline).
-- account (the publisher): a `description` and a `url`.
-- Per-metric descriptions live inside the existing sample_schema JSON (no column needed).

ALTER TABLE benchmark ADD COLUMN about TEXT;
ALTER TABLE benchmark ADD COLUMN methodology TEXT;

ALTER TABLE account ADD COLUMN description TEXT;
ALTER TABLE account ADD COLUMN url TEXT;
