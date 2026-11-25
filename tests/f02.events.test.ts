import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/client.js';
import { events, tickets } from '../src/db/schema.js';
import {
  getEventById,
  getOccupiedSeatCount,
  getOrganizerEventById,
  listPublishedEvents,
} from '../src/modules/events/events.service.js';
import {
  resetTestDb,
  setupTestDb,
  teardownTestDb,
} from './helpers/test-db.js';

function extractCookiePair(setCookieHeader: string | string[] | undefined): string {
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

  return found.split(';')[0] ?? '';
}

async function loginAs(
  app: FastifyInstance,
  email: string,
  password: string,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/login',
    payload: { email, password },
  });
  expect(res.statusCode).toBe(302);
  return extractCookiePair(res.headers['set-cookie']);
}

describe('F02 — Gestão de Eventos pelo Organizador', () => {
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

  it('CF-01 & R13: blocks visitors and participants from all /organizer/events* routes', async () => {
    const routes: Array<{ method: 'GET' | 'POST'; url: string }> = [
      { method: 'GET', url: '/organizer/events' },
      { method: 'GET', url: '/organizer/events/new' },
      { method: 'POST', url: '/organizer/events' },
      { method: 'GET', url: '/organizer/events/evt_dummy' },
      { method: 'POST', url: '/organizer/events/evt_dummy/edit' },
      { method: 'POST', url: '/organizer/events/evt_dummy/publish' },
    ];

    for (const route of routes) {
      const visitorRes = await app.inject({
        method: route.method,
        url: route.url,
      });
      expect(visitorRes.statusCode).toBe(302);
      expect(visitorRes.headers.location).toBe('/login');
    }

    const partCookie = await loginAs(
      app,
      'participante@catraca.local',
      'Part1234!',
    );

    for (const route of routes) {
      const partRes = await app.inject({
        method: route.method,
        url: route.url,
        headers: { cookie: partCookie },
      });
      expect(partRes.statusCode).toBe(403);
      expect(partRes.body).toContain('Acesso negado');
    }
  });

  it('F02-AC1 & F02-AC2 (R01, R02): creates draft event with valid input and rejects invalid inputs', async () => {
    const orgACookie = await loginAs(app, 'org-a@catraca.local', 'OrgA1234!');

    const newFormRes = await app.inject({
      method: 'GET',
      url: '/organizer/events/new',
      headers: { cookie: orgACookie },
    });
    expect(newFormRes.statusCode).toBe(200);
    expect(newFormRes.body).toContain('Criar novo evento');

    const invalidPayloads = [
      {
        name: 'Evento Passado ISO',
        startsAt: '2020-01-01T10:00:00-03:00',
        location: 'Auditório',
        capacity: '10',
        price: '100.00',
      },
      {
        name: 'Evento Passado Naive',
        startsAt: '2020-05-10T18:00',
        location: 'Auditório',
        capacity: '10',
        price: '100,00',
      },
      {
        name: 'Data Inexistente',
        startsAt: '2028-02-30T18:00',
        location: 'Auditório',
        capacity: '10',
        price: '100,00',
      },
      {
        name: 'Lotação Zero',
        startsAt: '2028-05-10T20:00',
        location: 'Auditório',
        capacity: '0',
        price: '100,00',
      },
      {
        name: 'Lotação Decimal',
        startsAt: '2028-05-10T20:00',
        location: 'Auditório',
        capacity: '1.5',
        price: '100,00',
      },
      {
        name: 'Preço Zero',
        startsAt: '2028-05-10T20:00',
        location: 'Auditório',
        capacity: '10',
        price: '0',
      },
      {
        name: 'Preço Negativo',
        startsAt: '2028-05-10T20:00',
        location: 'Auditório',
        capacity: '10',
        price: '-10',
      },
      {
        name: '   ',
        startsAt: '2028-05-10T20:00',
        location: 'Auditório',
        capacity: '10',
        price: '100,00',
      },
      {
        name: 'Sem Local',
        startsAt: '2028-05-10T20:00',
        location: '',
        capacity: '10',
        price: '100,00',
      },
    ];

    for (const payload of invalidPayloads) {
      const badRes = await app.inject({
        method: 'POST',
        url: '/organizer/events',
        headers: { cookie: orgACookie },
        payload,
      });
      expect(badRes.statusCode).toBe(400);
    }

    expect(await db.select().from(events)).toHaveLength(0);

    const createRes = await app.inject({
      method: 'POST',
      url: '/organizer/events',
      headers: { cookie: orgACookie },
      payload: {
        name: 'Show Catraca 2028',
        startsAt: '2028-06-15T20:00',
        location: 'Arena Central',
        capacity: '100',
        price: '120,50',
      },
    });

    expect(createRes.statusCode).toBe(302);
    const location = createRes.headers.location as string;
    expect(location).toMatch(/^\/organizer\/events\/evt_[a-f0-9]+$/);

    const eventId = location.split('/').pop()!;
    const [created] = await db
      .select()
      .from(events)
      .where(eq(events.id, eventId));

    expect(created).toBeDefined();
    expect(created?.ownerId).toBe('usr_org_a');
    expect(created?.status).toBe('draft');
    expect(created?.capacity).toBe(100);
    expect(created?.priceCents).toBe(12050);
    expect(created?.startsAt.toISOString()).toBe('2028-06-15T23:00:00.000Z');
  });

  it('F02-AC3 & F02-AC6 (R02, R04): manages event on dedicated URL and publishes draft -> published', async () => {
    const orgACookie = await loginAs(app, 'org-a@catraca.local', 'OrgA1234!');

    const createRes = await app.inject({
      method: 'POST',
      url: '/organizer/events',
      headers: { cookie: orgACookie },
      payload: {
        name: 'Conferência Tech',
        startsAt: '2028-07-20T19:00:00-03:00',
        location: 'Centro de Convenções',
        capacity: '50',
        price: '100.00',
      },
    });
    const eventUrl = createRes.headers.location as string;
    const eventId = eventUrl.split('/').pop()!;

    const manageDraftRes = await app.inject({
      method: 'GET',
      url: eventUrl,
      headers: { cookie: orgACookie },
    });
    expect(manageDraftRes.statusCode).toBe(200);
    expect(manageDraftRes.body).toContain('Conferência Tech');
    expect(manageDraftRes.body).toContain('rascunho');
    expect(manageDraftRes.body).toContain(`/organizer/events/${eventId}/publish`);
    expect(manageDraftRes.body).toContain(`/organizer/events/${eventId}/edit`);
    expect(manageDraftRes.body).toContain('data-slot="dashboard"');
    expect(manageDraftRes.body).toContain('data-slot="checkin"');
    expect(manageDraftRes.body).toContain('data-slot="cancel"');

    // Not in published list yet
    expect(await listPublishedEvents()).toHaveLength(0);

    // Publish
    const publishRes = await app.inject({
      method: 'POST',
      url: `${eventUrl}/publish`,
      headers: { cookie: orgACookie },
    });
    expect(publishRes.statusCode).toBe(302);
    expect(publishRes.headers.location).toBe(`${eventUrl}?published=1`);

    const [publishedEvent] = await db
      .select()
      .from(events)
      .where(eq(events.id, eventId));
    expect(publishedEvent?.status).toBe('published');

    const publishedList = await listPublishedEvents();
    expect(publishedList).toHaveLength(1);
    expect(publishedList[0]?.id).toBe(eventId);

    const managePublishedRes = await app.inject({
      method: 'GET',
      url: `${eventUrl}?published=1`,
      headers: { cookie: orgACookie },
    });
    expect(managePublishedRes.statusCode).toBe(200);
    expect(managePublishedRes.body).toContain('publicado');
    expect(managePublishedRes.body).toContain('Evento publicado com sucesso.');
    expect(managePublishedRes.body).not.toContain('Publicar evento');

    // Idempotent second publish
    const publishAgainRes = await app.inject({
      method: 'POST',
      url: `${eventUrl}/publish`,
      headers: { cookie: orgACookie },
    });
    expect(publishAgainRes.statusCode).toBe(302);
  });

  it('F02-AC2, F02-AC4 & F02-AC5 (R01, R03): protects occupied capacity, rejects past edit, and preserves issued ticket price', async () => {
    const orgACookie = await loginAs(app, 'org-a@catraca.local', 'OrgA1234!');

    const createRes = await app.inject({
      method: 'POST',
      url: '/organizer/events',
      headers: { cookie: orgACookie },
      payload: {
        name: 'Festival Catraca',
        startsAt: '2028-08-10T20:00:00-03:00',
        location: 'Auditório Principal',
        capacity: '10',
        price: '100.00',
      },
    });
    const eventUrl = createRes.headers.location as string;
    const eventId = eventUrl.split('/').pop()!;

    // Reject past date on edit
    const pastEditRes = await app.inject({
      method: 'POST',
      url: `${eventUrl}/edit`,
      headers: { cookie: orgACookie },
      payload: {
        name: 'Festival Catraca',
        startsAt: '2020-01-01T10:00:00-03:00',
        location: 'Auditório Principal',
        capacity: '10',
        price: '100.00',
      },
    });
    expect(pastEditRes.statusCode).toBe(400);
    expect(pastEditRes.body).toContain('futuro');

    const eventAfterPastAttempt = await getEventById(eventId);
    expect(eventAfterPastAttempt?.startsAt.toISOString()).toBe(
      '2028-08-10T23:00:00.000Z',
    );

    // Seed 3 occupied tickets (2 confirmed + 1 pending) and 3 non-occupying tickets (declined/cancelled/refunded)
    await db.insert(tickets).values([
      {
        id: 'tkt_1',
        eventId,
        userId: 'usr_part_seed',
        buyerEmail: 'participante@catraca.local',
        code: 'CODE0001',
        priceCents: 10000,
        status: 'confirmed',
        channel: 'storefront',
      },
      {
        id: 'tkt_2',
        eventId,
        userId: 'usr_part_seed',
        buyerEmail: 'participante@catraca.local',
        code: 'CODE0002',
        priceCents: 10000,
        status: 'confirmed',
        channel: 'storefront',
      },
      {
        id: 'tkt_3',
        eventId,
        userId: 'usr_part_seed',
        buyerEmail: 'participante@catraca.local',
        code: 'CODE0003',
        priceCents: 10000,
        status: 'pending',
        channel: 'partner_api',
      },
      {
        id: 'tkt_4',
        eventId,
        userId: 'usr_part_seed',
        buyerEmail: 'participante@catraca.local',
        code: 'CODE0004',
        priceCents: 10000,
        status: 'declined',
        channel: 'storefront',
      },
      {
        id: 'tkt_5',
        eventId,
        userId: 'usr_part_seed',
        buyerEmail: 'participante@catraca.local',
        code: 'CODE0005',
        priceCents: 10000,
        status: 'cancelled',
        channel: 'storefront',
      },
      {
        id: 'tkt_6',
        eventId,
        userId: 'usr_part_seed',
        buyerEmail: 'participante@catraca.local',
        code: 'CODE0006',
        priceCents: 10000,
        status: 'refunded',
        channel: 'storefront',
      },
    ]);

    expect(await getOccupiedSeatCount(eventId)).toBe(3);

    // Reject capacity < 3
    const reduceTooLowRes = await app.inject({
      method: 'POST',
      url: `${eventUrl}/edit`,
      headers: { cookie: orgACookie },
      payload: {
        name: 'Festival Catraca',
        startsAt: '2028-08-10T20:00',
        location: 'Auditório Principal',
        capacity: '2',
        price: '100,00',
      },
    });
    expect(reduceTooLowRes.statusCode).toBe(400);
    expect(reduceTooLowRes.body).toContain('vagas já ocupadas (3)');

    const unchangedEvent = await getEventById(eventId);
    expect(unchangedEvent?.capacity).toBe(10);

    // Accept capacity == 3
    const reduceExactRes = await app.inject({
      method: 'POST',
      url: `${eventUrl}/edit`,
      headers: { cookie: orgACookie },
      payload: {
        name: 'Festival Catraca',
        startsAt: '2028-08-10T20:00',
        location: 'Auditório Principal',
        capacity: '3',
        price: '100,00',
      },
    });
    expect(reduceExactRes.statusCode).toBe(302);
    expect((await getEventById(eventId))?.capacity).toBe(3);

    // Increase capacity to 15 and change price to 150,00
    const updatePriceAndCapRes = await app.inject({
      method: 'POST',
      url: `${eventUrl}/edit`,
      headers: { cookie: orgACookie },
      payload: {
        name: 'Festival Catraca Atualizado',
        startsAt: '2028-08-10T21:00',
        location: 'Auditório Principal',
        capacity: '15',
        price: '150,00',
      },
    });
    expect(updatePriceAndCapRes.statusCode).toBe(302);

    const updatedEvent = await getEventById(eventId);
    expect(updatedEvent?.name).toBe('Festival Catraca Atualizado');
    expect(updatedEvent?.capacity).toBe(15);
    expect(updatedEvent?.priceCents).toBe(15000);

    // Existing tickets keep original priceCents = 10000 (R03)
    const existingTickets = await db
      .select()
      .from(tickets)
      .where(eq(tickets.eventId, eventId));
    expect(existingTickets).toHaveLength(6);
    for (const t of existingTickets) {
      expect(t.priceCents).toBe(10000);
    }
  });

  it('R11 readiness: blocks edit and publish on cancelled events', async () => {
    const orgACookie = await loginAs(app, 'org-a@catraca.local', 'OrgA1234!');

    const createRes = await app.inject({
      method: 'POST',
      url: '/organizer/events',
      headers: { cookie: orgACookie },
      payload: {
        name: 'Evento Para Cancelar',
        startsAt: '2028-09-01T20:00:00-03:00',
        location: 'Palco Sul',
        capacity: '20',
        price: '80.00',
      },
    });
    const eventUrl = createRes.headers.location as string;
    const eventId = eventUrl.split('/').pop()!;

    await db
      .update(events)
      .set({ status: 'cancelled' })
      .where(eq(events.id, eventId));

    const editRes = await app.inject({
      method: 'POST',
      url: `${eventUrl}/edit`,
      headers: { cookie: orgACookie },
      payload: {
        name: 'Tentativa Alteração',
        startsAt: '2028-09-02T20:00:00-03:00',
        location: 'Palco Norte',
        capacity: '30',
        price: '90.00',
      },
    });
    expect(editRes.statusCode).toBe(409);

    const publishRes = await app.inject({
      method: 'POST',
      url: `${eventUrl}/publish`,
      headers: { cookie: orgACookie },
    });
    expect(publishRes.statusCode).toBe(409);

    const eventInDb = await getEventById(eventId);
    expect(eventInDb?.status).toBe('cancelled');
    expect(eventInDb?.name).toBe('Evento Para Cancelar');
  });

  it('F02-AC7 & R13: enforces strict isolation between Organizador A and Organizador B without leaking event data', async () => {
    const orgACookie = await loginAs(app, 'org-a@catraca.local', 'OrgA1234!');
    const orgBCookie = await loginAs(app, 'org-b@catraca.local', 'OrgB1234!');

    const createRes = await app.inject({
      method: 'POST',
      url: '/organizer/events',
      headers: { cookie: orgACookie },
      payload: {
        name: 'Evento Exclusivo A',
        startsAt: '2028-10-12T20:00:00-03:00',
        location: 'Teatro Secreto A',
        capacity: '40',
        price: '200.00',
      },
    });
    const eventUrl = createRes.headers.location as string;
    const eventId = eventUrl.split('/').pop()!;

    // Service-level isolation check
    expect(await getOrganizerEventById('usr_org_a', eventId)).not.toBeNull();
    expect(await getOrganizerEventById('usr_org_b', eventId)).toBeNull();

    // Organizador A sees it in list
    const listARes = await app.inject({
      method: 'GET',
      url: '/organizer/events',
      headers: { cookie: orgACookie },
    });
    expect(listARes.statusCode).toBe(200);
    expect(listARes.body).toContain('Evento Exclusivo A');

    // Organizador B does NOT see it in list
    const listBRes = await app.inject({
      method: 'GET',
      url: '/organizer/events',
      headers: { cookie: orgBCookie },
    });
    expect(listBRes.statusCode).toBe(200);
    expect(listBRes.body).not.toContain('Evento Exclusivo A');
    expect(listBRes.body).not.toContain('Teatro Secreto A');
    expect(listBRes.body).not.toContain(eventId);

    // Organizador B blocked on GET, edit, publish with zero data leak
    const getBRes = await app.inject({
      method: 'GET',
      url: eventUrl,
      headers: { cookie: orgBCookie },
    });
    expect(getBRes.statusCode).toBe(403);
    expect(getBRes.body).not.toContain('Evento Exclusivo A');
    expect(getBRes.body).not.toContain('Teatro Secreto A');
    expect(getBRes.body).not.toContain(eventId);

    const editBRes = await app.inject({
      method: 'POST',
      url: `${eventUrl}/edit`,
      headers: { cookie: orgBCookie },
      payload: {
        name: 'Hijacked',
        startsAt: '2028-10-12T20:00:00-03:00',
        location: 'Hijacked',
        capacity: '1',
        price: '1.00',
      },
    });
    expect(editBRes.statusCode).toBe(403);
    expect(editBRes.body).not.toContain('Evento Exclusivo A');
    expect(editBRes.body).not.toContain('Teatro Secreto A');

    const publishBRes = await app.inject({
      method: 'POST',
      url: `${eventUrl}/publish`,
      headers: { cookie: orgBCookie },
    });
    expect(publishBRes.statusCode).toBe(403);
    expect(publishBRes.body).not.toContain('Evento Exclusivo A');

    // Nonexistent event returns 404
    const notFoundRes = await app.inject({
      method: 'GET',
      url: '/organizer/events/evt_doesnotexist',
      headers: { cookie: orgBCookie },
    });
    expect(notFoundRes.statusCode).toBe(404);

    // Event A remains untouched in DB
    const eventInDb = await getEventById(eventId);
    expect(eventInDb?.name).toBe('Evento Exclusivo A');
    expect(eventInDb?.status).toBe('draft');
  });
});
