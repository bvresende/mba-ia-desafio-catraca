import { env } from '../../src/config/env.js';
import { closeDb, pool } from '../../src/db/client.js';
import { runMigrations } from '../../src/db/migrate.js';
import { runSeed } from '../../src/db/seed.js';

function assertTestDatabase(): void {
  const dbUrl = env.DATABASE_URL;
  if (!dbUrl.includes('test')) {
    throw new Error(
      `Refusing to run destructive test helpers against non-test DATABASE_URL: ${dbUrl}`,
    );
  }
}

export async function setupTestDb(): Promise<void> {
  assertTestDatabase();
  await runMigrations();
}

export async function resetTestDb(options?: { readonly seed?: boolean }): Promise<void> {
  assertTestDatabase();
  await pool.query(
    'TRUNCATE TABLE tickets, events, sessions, users RESTART IDENTITY CASCADE',
  );
  if (options?.seed !== false) {
    await runSeed();
  }
}

export async function teardownTestDb(): Promise<void> {
  await closeDb();
}
