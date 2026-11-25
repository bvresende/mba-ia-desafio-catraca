import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { env } from '../../config/env.js';
import { db, type Database } from '../../db/client.js';
import { sessions, users, type UserRole } from '../../db/schema.js';
import { hashPassword, verifyPassword } from './password.js';

export interface AuthUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: UserRole;
}

export type RegisterResult =
  | { readonly ok: true; readonly user: AuthUser }
  | { readonly ok: false; readonly error: string };

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isPgUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== 'object') {
    return false;
  }
  const record = err as { code?: unknown; cause?: { code?: unknown } };
  return record.code === '23505' || record.cause?.code === '23505';
}

export async function registerParticipant(
  input: {
    readonly name: string;
    readonly email: string;
    readonly password: string;
  },
  targetDb: Database = db,
): Promise<RegisterResult> {
  const name = input.name.trim();
  const email = normalizeEmail(input.email);
  const password = input.password;

  if (name.length < 2) {
    return { ok: false, error: 'Informe um nome válido.' };
  }
  if (!EMAIL_REGEX.test(email)) {
    return { ok: false, error: 'Informe um e-mail válido.' };
  }
  if (password.length < 6) {
    return { ok: false, error: 'A senha deve ter pelo menos 6 caracteres.' };
  }

  const existing = await targetDb
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existing.length > 0) {
    return { ok: false, error: 'Este e-mail já está cadastrado.' };
  }

  const id = `usr_${crypto.randomBytes(8).toString('hex')}`;
  const passwordHash = hashPassword(password);

  try {
    await targetDb.insert(users).values({
      id,
      name,
      email,
      passwordHash,
      role: 'participant',
    });
  } catch (err) {
    if (isPgUniqueViolation(err)) {
      return { ok: false, error: 'Este e-mail já está cadastrado.' };
    }
    throw err;
  }

  return {
    ok: true,
    user: {
      id,
      name,
      email,
      role: 'participant',
    },
  };
}

export async function authenticateUser(
  input: { readonly email: string; readonly password: string },
  targetDb: Database = db,
): Promise<AuthUser | null> {
  const email = normalizeEmail(input.email);
  if (!email || !input.password) {
    return null;
  }

  const rows = await targetDb
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      passwordHash: users.passwordHash,
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  const user = rows[0];
  if (!user) {
    return null;
  }

  if (!verifyPassword(input.password, user.passwordHash)) {
    return null;
  }

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };
}

export async function createSession(
  userId: string,
  targetDb: Database = db,
): Promise<{ readonly id: string; readonly expiresAt: Date }> {
  const id = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(
    Date.now() + env.SESSION_TTL_HOURS * 60 * 60 * 1000,
  );

  await targetDb.insert(sessions).values({
    id,
    userId,
    expiresAt,
  });

  return { id, expiresAt };
}

export async function getSessionUser(
  sessionId: string,
  targetDb: Database = db,
): Promise<AuthUser | null> {
  if (!sessionId) {
    return null;
  }

  const rows = await targetDb
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      userId: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.id, sessionId))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return null;
  }

  if (row.expiresAt.getTime() <= Date.now()) {
    await targetDb.delete(sessions).where(eq(sessions.id, sessionId));
    return null;
  }

  return {
    id: row.userId,
    name: row.name,
    email: row.email,
    role: row.role,
  };
}

export async function deleteSession(
  sessionId: string,
  targetDb: Database = db,
): Promise<void> {
  if (!sessionId) {
    return;
  }
  await targetDb.delete(sessions).where(eq(sessions.id, sessionId));
}
