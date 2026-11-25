import { Pool } from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { env } from '../config/env.js';
import * as schema from './schema.js';

export type Database = NodePgDatabase<typeof schema>;

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
});

export const db: Database = drizzle(pool, { schema });

export async function closeDb(): Promise<void> {
  await pool.end();
}
