import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeDb, db, type Database } from './client.js';
import { users, type UserRole } from './schema.js';
import { hashPassword } from '../modules/auth/password.js';

export interface SeedUserSpec {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly password: string;
  readonly role: UserRole;
}

export const SEED_USERS: readonly SeedUserSpec[] = [
  {
    id: 'usr_org_a',
    name: 'Organizador A',
    email: 'org-a@catraca.local',
    password: 'OrgA1234!',
    role: 'organizer',
  },
  {
    id: 'usr_org_b',
    name: 'Organizador B',
    email: 'org-b@catraca.local',
    password: 'OrgB1234!',
    role: 'organizer',
  },
  {
    id: 'usr_part_seed',
    name: 'Participante Catraca',
    email: 'participante@catraca.local',
    password: 'Part1234!',
    role: 'participant',
  },
] as const;

export async function runSeed(targetDb: Database = db): Promise<void> {
  for (const seedUser of SEED_USERS) {
    await targetDb
      .insert(users)
      .values({
        id: seedUser.id,
        name: seedUser.name,
        email: seedUser.email.trim().toLowerCase(),
        passwordHash: hashPassword(seedUser.password),
        role: seedUser.role,
      })
      .onConflictDoNothing();
  }
}

const isDirectExecution =
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? '');

if (isDirectExecution) {
  runSeed()
    .then(async () => {
      console.log('[seed] Idempotent seed completed.');
      await closeDb();
    })
    .catch(async (err) => {
      console.error('[seed] Failed to run seed:', err);
      await closeDb();
      process.exit(1);
    });
}
