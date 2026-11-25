import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db, pool } from '../src/db/client.js';
import { sessions, users } from '../src/db/schema.js';
import { runSeed } from '../src/db/seed.js';
import { escapeHtml } from '../src/views/layout.js';
import {
  resetTestDb,
  setupTestDb,
  teardownTestDb,
} from './helpers/test-db.js';

function extractSessionCookie(setCookieHeader: string | string[] | undefined): {
  rawHeader: string;
  cookiePair: string;
  sessionId: string;
} {
  const headers = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : setCookieHeader
      ? [setCookieHeader]
      : [];

  const found = headers.find((header) =>
    header.startsWith('catraca_session='),
  );
  if (!found) {
    throw new Error(`Expected catraca_session cookie, got: ${JSON.stringify(headers)}`);
  }

  const cookiePair = found.split(';')[0] ?? '';
  const sessionId = cookiePair.slice('catraca_session='.length);
  return { rawHeader: found, cookiePair, sessionId };
}

describe('F01 — Fundação, Harness, Autenticação e Seed', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    await setupTestDb();
    app = buildApp();
    await app.ready();
  });

  beforeEach(async () => {
    await resetTestDb({ seed: true });
  });

  afterAll(async () => {
    await app.close();
    await teardownTestDb();
  });

  it('GET /health returns 200 with ok status and db connectivity', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', db: 'ok' });
  });

  it('provisions all 4 core tables in PostgreSQL', async () => {
    const result = await pool.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('users', 'sessions', 'events', 'tickets')
       ORDER BY table_name`,
    );
    expect(result.rows.map((r) => r.table_name)).toEqual([
      'events',
      'sessions',
      'tickets',
      'users',
    ]);
  });

  it('runs seed idempotently without duplicating seed users', async () => {
    await runSeed();
    await runSeed();

    const allUsers = await db
      .select({ email: users.email, role: users.role })
      .from(users);

    const sorted = allUsers
      .map((u) => `${u.email}|${u.role}`)
      .sort();

    expect(sorted).toEqual([
      'org-a@catraca.local|organizer',
      'org-b@catraca.local|organizer',
      'participante@catraca.local|participant',
    ]);
  });

  it('registers a participant, ignores client-supplied role=organizer, and rejects duplicate emails', async () => {
    const registerRes = await app.inject({
      method: 'POST',
      url: '/register',
      payload: {
        name: 'Maria Teste',
        email: '  Maria.F01@Catraca.Local  ',
        password: 'Senha123!',
        role: 'organizer',
      },
    });

    expect(registerRes.statusCode).toBe(302);
    expect(registerRes.headers.location).toBe('/');

    const { rawHeader, cookiePair } = extractSessionCookie(
      registerRes.headers['set-cookie'],
    );
    expect(rawHeader.toLowerCase()).toContain('httponly');

    const [created] = await db
      .select()
      .from(users)
      .where(eq(users.email, 'maria.f01@catraca.local'));

    expect(created).toBeDefined();
    expect(created?.role).toBe('participant');
    expect(created?.passwordHash).not.toBe('Senha123!');

    // Duplicate registration should fail with 400
    const dupRes = await app.inject({
      method: 'POST',
      url: '/register',
      payload: {
        name: 'Maria Duplicada',
        email: 'maria.f01@catraca.local',
        password: 'OutraSenha123!',
      },
    });
    expect(dupRes.statusCode).toBe(400);
    expect(dupRes.body).toContain('já está cadastrado');

    // Logout invalidates the session in DB
    const logoutRes = await app.inject({
      method: 'POST',
      url: '/logout',
      headers: { cookie: cookiePair },
    });
    expect(logoutRes.statusCode).toBe(302);

    const remainingSessions = await db.select().from(sessions);
    expect(remainingSessions).toHaveLength(0);

    // Login with wrong password returns 401
    const badLoginRes = await app.inject({
      method: 'POST',
      url: '/login',
      payload: {
        email: 'maria.f01@catraca.local',
        password: 'WrongPassword!',
      },
    });
    expect(badLoginRes.statusCode).toBe(401);

    // Login with correct password works and sets HttpOnly cookie
    const loginRes = await app.inject({
      method: 'POST',
      url: '/login',
      payload: {
        email: 'MARIA.F01@CATRACA.LOCAL',
        password: 'Senha123!',
      },
    });
    expect(loginRes.statusCode).toBe(302);
    expect(loginRes.headers.location).toBe('/');
    const loginCookie = extractSessionCookie(loginRes.headers['set-cookie']);
    expect(loginCookie.rawHeader.toLowerCase()).toContain('httponly');
  });

  it('authenticates seeded Organizador A and Organizador B and grants access to /organizer/*', async () => {
    for (const creds of [
      { email: 'org-a@catraca.local', password: 'OrgA1234!', name: 'Organizador A' },
      { email: 'org-b@catraca.local', password: 'OrgB1234!', name: 'Organizador B' },
    ]) {
      const loginRes = await app.inject({
        method: 'POST',
        url: '/login',
        payload: { email: creds.email, password: creds.password },
      });

      expect(loginRes.statusCode).toBe(302);
      expect(loginRes.headers.location).toBe('/organizer/events');

      const { rawHeader, cookiePair } = extractSessionCookie(
        loginRes.headers['set-cookie'],
      );
      expect(rawHeader.toLowerCase()).toContain('httponly');

      const orgRootRes = await app.inject({
        method: 'GET',
        url: '/organizer',
        headers: { cookie: cookiePair },
      });
      expect(orgRootRes.statusCode).toBe(302);
      expect(orgRootRes.headers.location).toBe('/organizer/events');

      const orgEventsRes = await app.inject({
        method: 'GET',
        url: '/organizer/events',
        headers: { cookie: cookiePair },
      });
      expect(orgEventsRes.statusCode).toBe(200);
      expect(orgEventsRes.body).toContain(creds.name);
    }
  });

  it('enforces R13: blocks visitors and participants from /organizer and /organizer/*', async () => {
    // Visitor without cookie
    for (const path of ['/organizer', '/organizer/events', '/organizer/any-subroute']) {
      const res = await app.inject({ method: 'GET', url: path });
      expect(res.statusCode).toBe(302);
      expect(res.headers.location).toBe('/login');
      expect(res.body).not.toContain('Organizador A');
    }

    // Authenticated participant
    const partLogin = await app.inject({
      method: 'POST',
      url: '/login',
      payload: {
        email: 'participante@catraca.local',
        password: 'Part1234!',
      },
    });
    expect(partLogin.statusCode).toBe(302);
    const { cookiePair } = extractSessionCookie(partLogin.headers['set-cookie']);

    for (const path of ['/organizer', '/organizer/events', '/organizer/any-subroute']) {
      const res = await app.inject({
        method: 'GET',
        url: path,
        headers: { cookie: cookiePair },
      });
      expect(res.statusCode).toBe(403);
      expect(res.body).toContain('Acesso negado');
      expect(res.body).not.toContain('Organizador A');
    }
  });

  it('handles manipulated or expired session cookies gracefully without 500', async () => {
    const forgedRes = await app.inject({
      method: 'GET',
      url: '/',
      headers: { cookie: 'catraca_session=invalid_nonexistent_token' },
    });
    expect(forgedRes.statusCode).toBe(200);

    await db.insert(sessions).values({
      id: 'expired_token_123456',
      userId: 'usr_part_seed',
      expiresAt: new Date(Date.now() - 60_000),
    });

    const expiredRes = await app.inject({
      method: 'GET',
      url: '/organizer/events',
      headers: { cookie: 'catraca_session=expired_token_123456' },
    });
    expect(expiredRes.statusCode).toBe(302);
    expect(expiredRes.headers.location).toBe('/login');
  });

  it('escapes HTML special characters in escapeHtml helper', () => {
    expect(escapeHtml(`<script>alert("x'&")</script>`)).toBe(
      '&lt;script&gt;alert(&quot;x&#39;&amp;&quot;)&lt;/script&gt;',
    );
  });
});
