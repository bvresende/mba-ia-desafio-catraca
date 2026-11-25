import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/client.js';
import { events, tickets, type TicketStatus } from '../src/db/schema.js';
import { createEvent, publishEvent } from '../src/modules/events/events.service.js';
import {
  cancelPendingTimers,
  waitForPendingGatewayJobs,
} from '../src/modules/purchases/gateway.service.js';
import { TICKET_STATUS_PT } from '../src/views/storefront.views.js';
import {
  resetTestDb,
  setupTestDb,
  teardownTestDb,
} from './helpers/test-db.js';

const ORIGINAL_GATEWAY_ENV = {
  GATEWAY_FAST_MIN_MS: process.env['GATEWAY_FAST_MIN_MS'],
  GATEWAY_FAST_MAX_MS: process.env['GATEWAY_FAST_MAX_MS'],
  GATEWAY_SLOW_MIN_MS: process.env['GATEWAY_SLOW_MIN_MS'],
  GATEWAY_SLOW_MAX_MS: process.env['GATEWAY_SLOW_MAX_MS'],
};

function restoreGatewayEnv(): void {
  for (const [key, value] of Object.entries(ORIGINAL_GATEWAY_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function setFastTestGatewayEnv(): void {
  process.env['GATEWAY_FAST_MIN_MS'] = '25';
  process.env['GATEWAY_FAST_MAX_MS'] = '50';
  process.env['GATEWAY_SLOW_MIN_MS'] = '220';
  process.env['GATEWAY_SLOW_MAX_MS'] = '300';
}

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

async function registerParticipantAndLogin(
  app: FastifyInstance,
  name: string,
  email: string,
  password: string,
): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/register',
    payload: { name, email, password },
  });
  expect(res.statusCode).toBe(302);
  return extractCookiePair(res.headers['set-cookie']);
}

describe('F04 — Vitrine Pública e Meus Ingressos', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    await setupTestDb();
    app = buildApp();
    await app.ready();
  });

  beforeEach(async () => {
    cancelPendingTimers();
    setFastTestGatewayEnv();
    await resetTestDb({ seed: true });
  });

  afterEach(() => {
    cancelPendingTimers();
    restoreGatewayEnv();
  });

  afterAll(async () => {
    cancelPendingTimers();
    restoreGatewayEnv();
    await app.close();
    await teardownTestDb();
  });

  it('F04-AC1 & CF-05 (R02, R05): public storefront lists only published events ordered by startsAt, escapes HTML, and reflects immediate publication', async () => {
    const laterDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const soonerDate = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);

    const draftEvt = await createEvent('usr_org_a', {
      name: 'Evento Rascunho F04',
      startsAt: soonerDate,
      location: 'Sala Secreta',
      capacity: 10,
      price: '50,00',
    });

    const pubLater = await createEvent('usr_org_a', {
      name: 'Festival Posterior <VIP>',
      startsAt: laterDate,
      location: 'Arena & Palco',
      capacity: 12,
      price: '150,00',
    });
    await publishEvent('usr_org_a', pubLater.id);

    const pubSooner = await createEvent('usr_org_a', {
      name: 'Evento Publicado F04',
      startsAt: soonerDate,
      location: 'Teatro Central',
      capacity: 5,
      price: '100,00',
    });
    await publishEvent('usr_org_a', pubSooner.id);

    const cancelledEvt = await createEvent('usr_org_a', {
      name: 'Evento Cancelado F04',
      startsAt: soonerDate,
      location: 'Galpão X',
      capacity: 8,
      price: '70,00',
    });
    await db
      .update(events)
      .set({ status: 'cancelled' })
      .where(eq(events.id, cancelledEvt.id));

    // Visitor (unauthenticated) hits GET /
    const res1 = await app.inject({ method: 'GET', url: '/' });
    expect(res1.statusCode).toBe(200);
    expect(res1.body).toContain('Evento Publicado F04');
    expect(res1.body).toContain('Teatro Central');
    expect(res1.body).toContain('R$ 100,00');
    expect(res1.body).toContain('5 vagas disponíveis');
    expect(res1.body).toContain('Festival Posterior &lt;VIP&gt;');
    expect(res1.body).toContain('Arena &amp; Palco');
    expect(res1.body).toContain('R$ 150,00');
    expect(res1.body).not.toContain('Festival Posterior <VIP>');
    expect(res1.body).not.toContain('Evento Rascunho F04');
    expect(res1.body).not.toContain('Evento Cancelado F04');
    expect(res1.body).toContain('/login');
    expect(res1.body).toContain('/register');

    // Ordered by startsAt ascending (sooner before later)
    expect(res1.body.indexOf('Evento Publicado F04')).toBeLessThan(
      res1.body.indexOf('Festival Posterior &lt;VIP&gt;'),
    );

    // Publish the draft event and confirm immediate visibility on GET /
    await publishEvent('usr_org_a', draftEvt.id);
    const res2 = await app.inject({ method: 'GET', url: '/' });
    expect(res2.statusCode).toBe(200);
    expect(res2.body).toContain('Evento Rascunho F04');
    expect(res2.body).toContain('R$ 50,00');
  });

  it('F04-AC2 & CF-04 & CF-06 (R06, R09): newly registered participant purchases ticket immediately as pendente without blocking on gateway', async () => {
    const evt = await createEvent('usr_org_a', {
      name: 'Show Compra Imediata',
      startsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      location: 'Auditório Paulista',
      capacity: 2,
      price: '80,00',
    });
    await publishEvent('usr_org_a', evt.id);

    const partCookie = await registerParticipantAndLogin(
      app,
      'Ana Participante',
      'ana.f04@catraca.local',
      'Senha123!',
    );

    // Storefront renders purchase form and /my-tickets nav link for participant
    const homeRes = await app.inject({
      method: 'GET',
      url: '/',
      headers: { cookie: partCookie },
    });
    expect(homeRes.statusCode).toBe(200);
    expect(homeRes.body).toContain('href="/my-tickets"');
    expect(homeRes.body).toContain(`action="/events/${evt.id}/purchase"`);
    expect(homeRes.body).toContain('name="cardNumber"');

    // Purchase with slow card 0003 (220-300ms in test env) must return immediately
    const startedAt = Date.now();
    const purchaseRes = await app.inject({
      method: 'POST',
      url: `/events/${evt.id}/purchase`,
      headers: { cookie: partCookie },
      payload: { cardNumber: '4111111111110003' },
    });
    const elapsedMs = Date.now() - startedAt;

    expect(purchaseRes.statusCode).toBe(302);
    expect(purchaseRes.headers.location).toBe('/my-tickets');
    expect(elapsedMs).toBeLessThan(200);

    // Immediately appears in /my-tickets as pendente with unique code
    const myTicketsRes = await app.inject({
      method: 'GET',
      url: '/my-tickets',
      headers: { cookie: partCookie },
    });
    expect(myTicketsRes.statusCode).toBe(200);
    expect(myTicketsRes.body).toContain('Show Compra Imediata');
    expect(myTicketsRes.body).toContain('pendente');

    const [createdTicket] = await db
      .select()
      .from(tickets)
      .where(eq(tickets.eventId, evt.id));
    expect(createdTicket).toBeDefined();
    expect(createdTicket?.status).toBe('pending');
    expect(createdTicket?.channel).toBe('storefront');
    expect(myTicketsRes.body).toContain(createdTicket!.code);

    // Available seats on GET / reduced immediately from 2 to 1
    const homeAfter = await app.inject({ method: 'GET', url: '/' });
    expect(homeAfter.statusCode).toBe(200);
    expect(homeAfter.body).toContain('1 vaga disponível');

    await waitForPendingGatewayJobs();
  });

  it('F04-AC3 & CF-06 (R05, R07): sold-out event (including pending tickets) renders Ingressos esgotados and blocks oversell', async () => {
    const evt = await createEvent('usr_org_a', {
      name: 'Evento Lotação Um',
      startsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      location: 'Sala Única',
      capacity: 1,
      price: '120,00',
    });
    await publishEvent('usr_org_a', evt.id);

    const p1Cookie = await loginAs(app, 'participante@catraca.local', 'Part1234!');
    const p2Cookie = await registerParticipantAndLogin(
      app,
      'Carlos Concorrente',
      'carlos.f04@catraca.local',
      'Senha123!',
    );

    // Two concurrent requests for capacity 1 using slow card 0003
    const [r1, r2] = await Promise.all([
      app.inject({
        method: 'POST',
        url: `/events/${evt.id}/purchase`,
        headers: { cookie: p1Cookie },
        payload: { cardNumber: '4111111111110003' },
      }),
      app.inject({
        method: 'POST',
        url: `/events/${evt.id}/purchase`,
        headers: { cookie: p2Cookie },
        payload: { cardNumber: '4111111111110003' },
      }),
    ]);

    const statuses = [r1.statusCode, r2.statusCode].sort((a, b) => a - b);
    expect(statuses).toEqual([302, 409]);

    const failedRes = r1.statusCode === 409 ? r1 : r2;
    expect(failedRes.body).toContain('Ingressos esgotados');

    // While ticket is still pending, GET / shows Ingressos esgotados and omits purchase form
    const visitorHome = await app.inject({ method: 'GET', url: '/' });
    expect(visitorHome.statusCode).toBe(200);
    expect(visitorHome.body).toContain('Ingressos esgotados');
    expect(visitorHome.body).not.toContain(`action="/events/${evt.id}/purchase"`);

    const loggedHome = await app.inject({
      method: 'GET',
      url: '/',
      headers: { cookie: p2Cookie },
    });
    expect(loggedHome.statusCode).toBe(200);
    expect(loggedHome.body).toContain('Ingressos esgotados');
    expect(loggedHome.body).not.toContain(`action="/events/${evt.id}/purchase"`);

    await waitForPendingGatewayJobs();

    // After confirmation, still Ingressos esgotados
    const homeConfirmed = await app.inject({ method: 'GET', url: '/' });
    expect(homeConfirmed.body).toContain('Ingressos esgotados');

    const storedTickets = await db
      .select()
      .from(tickets)
      .where(eq(tickets.eventId, evt.id));
    expect(storedTickets).toHaveLength(1);
    expect(storedTickets[0]?.status).toBe('confirmed');
  });

  it('F04-AC4 & CF-06 (R08, R09): tracks 0002 -> recusado (frees seat) and 0001 -> confirmado in /my-tickets with unique code', async () => {
    const evt = await createEvent('usr_org_a', {
      name: 'Evento Gateway Vitrine',
      startsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      location: 'Teatro Municipal',
      capacity: 1,
      price: '95,00',
    });
    await publishEvent('usr_org_a', evt.id);

    const partCookie = await loginAs(
      app,
      'participante@catraca.local',
      'Part1234!',
    );

    // 1. Purchase with declined card 0002
    const declinedPurchase = await app.inject({
      method: 'POST',
      url: `/events/${evt.id}/purchase`,
      headers: { cookie: partCookie },
      payload: { cardNumber: '4111111111110002' },
    });
    expect(declinedPurchase.statusCode).toBe(302);
    expect(declinedPurchase.headers.location).toBe('/my-tickets');

    // Immediately: pendente in /my-tickets and Ingressos esgotados on /
    const ticketsWhilePending = await app.inject({
      method: 'GET',
      url: '/my-tickets',
      headers: { cookie: partCookie },
    });
    expect(ticketsWhilePending.body).toContain('pendente');

    const homeWhilePending = await app.inject({ method: 'GET', url: '/' });
    expect(homeWhilePending.body).toContain('Ingressos esgotados');

    await waitForPendingGatewayJobs();

    // After gateway rejects 0002: recusado in /my-tickets and 1 vaga disponível on /
    const ticketsAfterDecline = await app.inject({
      method: 'GET',
      url: '/my-tickets',
      headers: { cookie: partCookie },
    });
    expect(ticketsAfterDecline.body).toContain('recusado');

    const homeAfterDecline = await app.inject({ method: 'GET', url: '/' });
    expect(homeAfterDecline.body).not.toContain('Ingressos esgotados');
    expect(homeAfterDecline.body).toContain('1 vaga disponível');

    // 2. Purchase freed seat with approved card 0001
    const approvedPurchase = await app.inject({
      method: 'POST',
      url: `/events/${evt.id}/purchase`,
      headers: { cookie: partCookie },
      payload: { cardNumber: '4111111111110001' },
    });
    expect(approvedPurchase.statusCode).toBe(302);

    await waitForPendingGatewayJobs();

    const ticketsAfterConfirm = await app.inject({
      method: 'GET',
      url: '/my-tickets',
      headers: { cookie: partCookie },
    });
    expect(ticketsAfterConfirm.body).toContain('confirmado');
    expect(ticketsAfterConfirm.body).toContain('recusado');

    const allTickets = await db
      .select()
      .from(tickets)
      .where(eq(tickets.eventId, evt.id));
    expect(allTickets).toHaveLength(2);
    for (const t of allTickets) {
      expect(ticketsAfterConfirm.body).toContain(t.code);
    }
  });

  it('CF-04 (R09) & validation: enforces participant isolation, auth guards, and input/event error handling', async () => {
    const draft = await createEvent('usr_org_a', {
      name: 'Evento Rascunho Privado',
      startsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      location: 'Sala D',
      capacity: 5,
      price: '40,00',
    });
    const pub = await createEvent('usr_org_a', {
      name: 'Evento Isolamento',
      startsAt: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000),
      location: 'Sala P',
      capacity: 5,
      price: '60,00',
    });
    await publishEvent('usr_org_a', pub.id);

    // Unauthenticated visitor blocked from POST purchase and GET /my-tickets
    const visitorPurchase = await app.inject({
      method: 'POST',
      url: `/events/${pub.id}/purchase`,
      payload: { cardNumber: '4111111111110001' },
    });
    expect(visitorPurchase.statusCode).toBe(302);
    expect(visitorPurchase.headers.location).toBe('/login');

    const visitorTickets = await app.inject({
      method: 'GET',
      url: '/my-tickets',
    });
    expect(visitorTickets.statusCode).toBe(302);
    expect(visitorTickets.headers.location).toBe('/login');

    // Organizer blocked with 403
    const orgCookie = await loginAs(app, 'org-a@catraca.local', 'OrgA1234!');
    const orgPurchase = await app.inject({
      method: 'POST',
      url: `/events/${pub.id}/purchase`,
      headers: { cookie: orgCookie },
      payload: { cardNumber: '4111111111110001' },
    });
    expect(orgPurchase.statusCode).toBe(403);

    const orgTickets = await app.inject({
      method: 'GET',
      url: '/my-tickets',
      headers: { cookie: orgCookie },
    });
    expect(orgTickets.statusCode).toBe(403);

    // Participant A buys a ticket
    const partACookie = await loginAs(
      app,
      'participante@catraca.local',
      'Part1234!',
    );

    // Invalid card returns 400 without creating a ticket
    const badCardRes = await app.inject({
      method: 'POST',
      url: `/events/${pub.id}/purchase`,
      headers: { cookie: partACookie },
      payload: { cardNumber: '1234' },
    });
    expect(badCardRes.statusCode).toBe(400);
    expect(badCardRes.body).toContain('16 dígitos');

    // Draft / missing event returns 404 without creating a ticket
    const draftPurchaseRes = await app.inject({
      method: 'POST',
      url: `/events/${draft.id}/purchase`,
      headers: { cookie: partACookie },
      payload: { cardNumber: '4111111111110001' },
    });
    expect(draftPurchaseRes.statusCode).toBe(404);

    const missingPurchaseRes = await app.inject({
      method: 'POST',
      url: '/events/evt_inexistente/purchase',
      headers: { cookie: partACookie },
      payload: { cardNumber: '4111111111110001' },
    });
    expect(missingPurchaseRes.statusCode).toBe(404);

    const validPurchaseRes = await app.inject({
      method: 'POST',
      url: `/events/${pub.id}/purchase`,
      headers: { cookie: partACookie },
      payload: { cardNumber: '4111111111110001' },
    });
    expect(validPurchaseRes.statusCode).toBe(302);
    await waitForPendingGatewayJobs();

    const [partATicket] = await db
      .select()
      .from(tickets)
      .where(eq(tickets.eventId, pub.id));
    expect(partATicket).toBeDefined();

    // Participant B sees empty state and never sees Participant A's ticket/code
    const partBCookie = await registerParticipantAndLogin(
      app,
      'Beatriz Outra',
      'beatriz.f04@catraca.local',
      'Senha123!',
    );
    const partBTicketsRes = await app.inject({
      method: 'GET',
      url: '/my-tickets',
      headers: { cookie: partBCookie },
    });
    expect(partBTicketsRes.statusCode).toBe(200);
    expect(partBTicketsRes.body).toContain('Você ainda não possui ingressos');
    expect(partBTicketsRes.body).not.toContain(partATicket!.code);
    expect(partBTicketsRes.body).not.toContain('Evento Isolamento');
  });

  it('renders all 5 literal Portuguese ticket statuses in /my-tickets', async () => {
    expect(TICKET_STATUS_PT).toEqual({
      pending: 'pendente',
      confirmed: 'confirmado',
      declined: 'recusado',
      cancelled: 'cancelado',
      refunded: 'estornado',
    });

    const evt = await createEvent('usr_org_a', {
      name: 'Evento Cinco Status',
      startsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      location: 'Centro de Eventos',
      capacity: 20,
      price: '50,00',
    });
    await publishEvent('usr_org_a', evt.id);

    const statuses: TicketStatus[] = [
      'pending',
      'confirmed',
      'declined',
      'cancelled',
      'refunded',
    ];

    await db.insert(tickets).values(
      statuses.map((status, idx) => ({
        id: `tkt_status_${idx}`,
        eventId: evt.id,
        userId: 'usr_part_seed',
        buyerEmail: 'participante@catraca.local',
        code: `STAT000${idx}`,
        priceCents: 5000,
        status,
        checkedIn: false,
        checkedInAt: null,
        channel: 'storefront' as const,
      })),
    );

    const partCookie = await loginAs(
      app,
      'participante@catraca.local',
      'Part1234!',
    );
    const res = await app.inject({
      method: 'GET',
      url: '/my-tickets',
      headers: { cookie: partCookie },
    });
    expect(res.statusCode).toBe(200);
    for (const status of statuses) {
      expect(res.body).toContain(TICKET_STATUS_PT[status]);
    }
    for (let idx = 0; idx < statuses.length; idx += 1) {
      expect(res.body).toContain(`STAT000${idx}`);
    }
  });
});
