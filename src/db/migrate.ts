import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { closeDb, pool } from './client.js';

const MIGRATION_001_ID = '001_initial_schema';

const MIGRATION_001_SQL = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  id TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('participant', 'organizer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  location TEXT NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  user_id TEXT REFERENCES users(id),
  buyer_email TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'declined', 'cancelled', 'refunded')),
  checked_in BOOLEAN NOT NULL DEFAULT FALSE,
  checked_in_at TIMESTAMPTZ,
  channel TEXT NOT NULL CHECK (channel IN ('storefront', 'partner_api')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions (user_id);
CREATE INDEX IF NOT EXISTS events_owner_id_idx ON events (owner_id);
CREATE INDEX IF NOT EXISTS events_status_idx ON events (status);
CREATE INDEX IF NOT EXISTS tickets_event_id_status_idx ON tickets (event_id, status);
CREATE INDEX IF NOT EXISTS tickets_user_id_idx ON tickets (user_id);
`;

export async function runMigrations(targetPool: Pool = pool): Promise<void> {
  const client = await targetPool.connect();
  try {
    await client.query('BEGIN');
    await client.query(MIGRATION_001_SQL);
    await client.query(
      'INSERT INTO schema_migrations (id) VALUES ($1) ON CONFLICT (id) DO NOTHING',
      [MIGRATION_001_ID],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

const isDirectExecution =
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? '');

if (isDirectExecution) {
  runMigrations()
    .then(async () => {
      console.log('[migrate] Database migrations applied successfully.');
      await closeDb();
    })
    .catch(async (err) => {
      console.error('[migrate] Failed to run migrations:', err);
      await closeDb();
      process.exit(1);
    });
}
