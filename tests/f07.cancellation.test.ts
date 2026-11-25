import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { env } from '../src/config/env.js';
import { db } from '../src/db/client.js';
import { events, tickets, users } from '../src/db/schema.js';
import { cancelEvent } from '../src/modules/cancellation/cancellation.service.js';
import {
  CHECKIN_MESSAGES,
  performCheckIn,
} from '../src/modules/checkin/checkin.service.js';
import { getEventDashboardMetrics } from '../src/modules/checkin/dashboard.service.js';
import {
  createEvent,
  getEventById,
  publishEvent,
} from '../src/modules/events/events.service.js';
import {
  applyGatewayOutcome,
  cancelPendingTimers,
  waitForPendingGatewayJobs,
} from '../src/modules/purchases/gateway.service.js';
import {
  EventNotAvailableError,
  purchaseTicket,
} from '../src/modules/purchases/purchase.service.js';
import {
  resetTestDb,
  setupTestDb,
  teardownTestDb,
} from './helpers/test-db.js';

const FUTURE_STARTS_AT = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

const ORIGINAL_GATEWAY_ENV = {
  GATEWAY_FAST_MIN_MS: process.env['GATEWAY_FAST_MIN_MS'],
  GATEWAY_FAST_MAX_MS: process.env['GATEWAY_FAST_MAX_MS'],
  GATEWAY_SLOW_MIN_MS: process.env['GATEWAY_SLOW_MIN_MS'],
  GATEWAY_SLOW_MAX_MS: process.env['GATEWAY_SLOW_MAX_MS'],
};

function setFastTestGatewayEnv(): void {
  process.env['GATEWAY_FAST_MIN_MS'] = '20';
  process.env['GATEWAY_FAST_MAX_MS'] = '40';
  process.env['GATEWAY_SLOW_MIN_MS'] = '250';
  process.env['GATEWAY_SLOW_MAX_MS'] = '350';
}

function restoreGatewayEnv(): void {
  for (const [key, value] of Object.entries(ORIGINAL_GATEWAY_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function extractCookiePair(
  setCookieHeader: string | string[] | undefined,
): string {
  const headers = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : setCookieHeader
      ? [setCookieHeader]
      : [];

  const found = headers.find((header) =>
    header.startsWith('catraca_session='),
  );
  if (!found) {
    throw new Error(
      `Expected catraca_session cookie, got: ${JSON.stringify(headers)}`,
    );
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

async function getUserIdByEmail(email: string): Promise<string> {
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (!user) {
    throw new Error(`Seed user not found: ${email}`);
  }
  return user.id;
}

function extractMetricValue(html: string, metricKey: string): string {
  const pattern = new RegExp(
    `data-metric="${metricKey}"[\\s\\S]*?<div[^>]*>[^<]*<\\/div>\\s*<div[^>]*>([^<]+)<\\/div>`,
  );
  const match = pattern.exec(html);
  if (!match?.[1]) {
    throw new Error(`Could not find metric "${metricKey}" in HTML.`);
  }
  return match[1].trim();
}

describe('F07 — Cancelamento Irreversível de Eventos e Estorno/Cancelamento', () => {
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
    await app.close();
    await teardownTestDb();
  });

  it('F07-AC1, CF-12 & R13: enforces ownership, rejects draft/re-cancel, cancels irreversibly, and blocks edit/publish', async () => {
    const orgAId = await getUserIdByEmail('org-a@catraca.local');
    const orgACookie = await loginAs(app, 'org-a@catraca.local', 'OrgA1234!');
    const orgBCookie = await loginAs(app, 'org-b@catraca.local', 'OrgB1234!');
    const partCookie = await loginAs(
      app,
      'participante@catraca.local',
      'Part1234!',
    );

    const draftEvent = await createEvent(orgAId, {
      name: 'Evento Rascunho F07',
      startsAt: FUTURE_STARTS_AT,
      location: 'Sala Rascunho',
      capacity: 10,
      price: '100,00',
    });

    // Draft page does not expose the cancel form and POST /cancel is rejected (409)
    const draftPage = await app.inject({
      method: 'GET',
      url: `/organizer/events/${draftEvent.id}`,
      headers: { cookie: orgACookie },
    });
    expect(draftPage.statusCode).toBe(200);
    expect(draftPage.body).not.toContain(
      `action="/organizer/events/${draftEvent.id}/cancel"`,
    );

    const cancelDraftRes = await app.inject({
      method: 'POST',
      url: `/organizer/events/${draftEvent.id}/cancel`,
      headers: { cookie: orgACookie },
    });
    expect(cancelDraftRes.statusCode).toBe(409);
    expect((await getEventById(draftEvent.id))?.status).toBe('draft');

    // Publish event
    await publishEvent(orgAId, draftEvent.id);

    // Published page exposes the cancel form
    const publishedPage = await app.inject({
      method: 'GET',
      url: `/organizer/events/${draftEvent.id}`,
      headers: { cookie: orgACookie },
    });
    expect(publishedPage.statusCode).toBe(200);
    expect(publishedPage.body).toContain(
      `action="/organizer/events/${draftEvent.id}/cancel"`,
    );
    expect(publishedPage.body).toContain('Cancelar evento');

    // R13: Visitor, Participant, and Organizador B are blocked without changing state
    const visitorCancel = await app.inject({
      method: 'POST',
      url: `/organizer/events/${draftEvent.id}/cancel`,
    });
    expect(visitorCancel.statusCode).toBe(302);
    expect(visitorCancel.headers.location).toBe('/login');

    const partCancel = await app.inject({
      method: 'POST',
      url: `/organizer/events/${draftEvent.id}/cancel`,
      headers: { cookie: partCookie },
    });
    expect(partCancel.statusCode).toBe(403);
    expect(partCancel.body).not.toContain('Evento Rascunho F07');

    const orgBCancel = await app.inject({
      method: 'POST',
      url: `/organizer/events/${draftEvent.id}/cancel`,
      headers: { cookie: orgBCookie },
    });
    expect(orgBCancel.statusCode).toBe(403);
    expect(orgBCancel.body).not.toContain('Evento Rascunho F07');

    const notFoundCancel = await app.inject({
      method: 'POST',
      url: '/organizer/events/evt_inexistente/cancel',
      headers: { cookie: orgACookie },
    });
    expect(notFoundCancel.statusCode).toBe(404);

    expect((await getEventById(draftEvent.id))?.status).toBe('published');

    // Owner Organizador A cancels event
    const cancelRes = await app.inject({
      method: 'POST',
      url: `/organizer/events/${draftEvent.id}/cancel`,
      headers: { cookie: orgACookie },
    });
    expect(cancelRes.statusCode).toBe(303);
    expect(cancelRes.headers.location).toBe(
      `/organizer/events/${draftEvent.id}?cancelled=1`,
    );

    expect((await getEventById(draftEvent.id))?.status).toBe('cancelled');

    // Manage page reflects irreversible cancellation and hides edit/publish/cancel forms
    const cancelledPage = await app.inject({
      method: 'GET',
      url: `/organizer/events/${draftEvent.id}?cancelled=1`,
      headers: { cookie: orgACookie },
    });
    expect(cancelledPage.statusCode).toBe(200);
    expect(cancelledPage.body).toContain('Evento cancelado');
    expect(cancelledPage.body).not.toContain(
      `action="/organizer/events/${draftEvent.id}/edit"`,
    );
    expect(cancelledPage.body).not.toContain(
      `action="/organizer/events/${draftEvent.id}/publish"`,
    );
    expect(cancelledPage.body).not.toContain(
      `action="/organizer/events/${draftEvent.id}/cancel"`,
    );

    // Direct POST attempts to edit, publish, or re-cancel are rejected (409)
    const editAfterCancel = await app.inject({
      method: 'POST',
      url: `/organizer/events/${draftEvent.id}/edit`,
      headers: { cookie: orgACookie },
      payload: {
        name: 'Nome Alterado',
        startsAt: '2029-01-01T20:00:00-03:00',
        location: 'Novo Local',
        capacity: '20',
        price: '150,00',
      },
    });
    expect(editAfterCancel.statusCode).toBe(409);

    const publishAfterCancel = await app.inject({
      method: 'POST',
      url: `/organizer/events/${draftEvent.id}/publish`,
      headers: { cookie: orgACookie },
    });
    expect(publishAfterCancel.statusCode).toBe(409);

    const recancelRes = await app.inject({
      method: 'POST',
      url: `/organizer/events/${draftEvent.id}/cancel`,
      headers: { cookie: orgACookie },
    });
    expect(recancelRes.statusCode).toBe(409);

    const persisted = await getEventById(draftEvent.id);
    expect(persisted?.status).toBe('cancelled');
    expect(persisted?.name).toBe('Evento Rascunho F07');
  });

  it('F07-AC2..AC5 & CF-13..CF-16: transitions tickets (<10s), blocks late 0003/0004 callbacks, updates storefront/partner/checkin/dashboard', async () => {
    const orgAId = await getUserIdByEmail('org-a@catraca.local');
    const partId = await getUserIdByEmail('participante@catraca.local');
    const orgACookie = await loginAs(app, 'org-a@catraca.local', 'OrgA1234!');
    const partCookie = await loginAs(
      app,
      'participante@catraca.local',
      'Part1234!',
    );

    const event = await createEvent(orgAId, {
      name: 'Evento Cancelamento F07',
      startsAt: FUTURE_STARTS_AT,
      location: 'Arena Catraca',
      capacity: 10,
      price: '100,00',
    });
    await publishEvent(orgAId, event.id);

    const otherEvent = await createEvent(orgAId, {
      name: 'Evento Ativo F07',
      startsAt: FUTURE_STARTS_AT,
      location: 'Auditório B',
      capacity: 10,
      price: '50,00',
    });
    await publishEvent(orgAId, otherEvent.id);

    // 1. Storefront confirmed (fast 0001) + Storefront declined (fast 0002)
    const storeConfirmed = await purchaseTicket({
      eventId: event.id,
      buyerEmail: 'participante@catraca.local',
      cardNumber: '4111111111110001',
      userId: partId,
      channel: 'storefront',
    });
    const storeDeclined = await purchaseTicket({
      eventId: event.id,
      buyerEmail: 'participante@catraca.local',
      cardNumber: '4111111111110002',
      userId: partId,
      channel: 'storefront',
    });

    // 2. Partner API confirmed (fast 0001) -> then checked in!
    const partnerCreateRes = await app.inject({
      method: 'POST',
      url: `/api/partner/events/${event.id}/purchases`,
      headers: { 'x-api-key': env.PARTNER_API_KEY },
      payload: {
        buyerEmail: 'partner-confirmed@example.com',
        cardNumber: '4111111111110001',
      },
    });
    expect(partnerCreateRes.statusCode).toBe(202);
    const partnerConfirmed = partnerCreateRes.json() as {
      ticketId: string;
      code: string;
      status: string;
    };

    // Wait only for the fast tickets (0001/0002)
    await waitForPendingGatewayJobs();

    // Perform check-in on the partner confirmed ticket
    const preCancelCheckin = await performCheckIn(
      orgAId,
      event.id,
      partnerConfirmed.code,
    );
    expect(preCancelCheckin).toEqual({
      ok: true,
      message: CHECKIN_MESSAGES.ALLOWED,
      ticketId: partnerConfirmed.ticketId,
    });

    // 3. Slow pending tickets: storefront 0003 (slow approve) & partner API 0004 (slow decline)
    const storePending0003 = await purchaseTicket({
      eventId: event.id,
      buyerEmail: 'participante@catraca.local',
      cardNumber: '4111111111110003',
      userId: partId,
      channel: 'storefront',
    });
    const partnerPendingRes = await app.inject({
      method: 'POST',
      url: `/api/partner/events/${event.id}/purchases`,
      headers: { 'x-api-key': env.PARTNER_API_KEY },
      payload: {
        buyerEmail: 'partner-slow@example.com',
        cardNumber: '4111111111110004',
      },
    });
    expect(partnerPendingRes.statusCode).toBe(202);
    const partnerPending0004 = partnerPendingRes.json() as {
      ticketId: string;
      code: string;
      status: string;
    };
    expect(partnerPending0004.status).toBe('pending');

    // Verify pre-cancellation dashboard metrics
    const preMetrics = await getEventDashboardMetrics(event.id);
    expect(preMetrics).toMatchObject({
      confirmedCount: 2,
      pendingCount: 2,
      checkedInCount: 1,
      availableSeats: 6,
      revenueCents: 20000,
      refundedCount: 0,
    });

    // Cancel event and verify execution completes well under 10 seconds
    const startedAtMs = Date.now();
    const cancelRes = await app.inject({
      method: 'POST',
      url: `/organizer/events/${event.id}/cancel`,
      headers: { cookie: orgACookie },
    });
    const elapsedMs = Date.now() - startedAtMs;
    expect(cancelRes.statusCode).toBe(303);
    expect(elapsedMs).toBeLessThan(10_000);

    // Immediate ticket state assertions
    const [
      immediateStoreConf,
      immediatePartnerConf,
      immediateDeclined,
      immediate0003,
      immediate0004,
    ] = await Promise.all([
      db.select().from(tickets).where(eq(tickets.id, storeConfirmed.id)),
      db
        .select()
        .from(tickets)
        .where(eq(tickets.id, partnerConfirmed.ticketId)),
      db.select().from(tickets).where(eq(tickets.id, storeDeclined.id)),
      db.select().from(tickets).where(eq(tickets.id, storePending0003.id)),
      db
        .select()
        .from(tickets)
        .where(eq(tickets.id, partnerPending0004.ticketId)),
    ]);

    expect(immediateStoreConf[0]?.status).toBe('refunded');
    expect(immediatePartnerConf[0]?.status).toBe('refunded');
    expect(immediatePartnerConf[0]?.checkedIn).toBe(true);
    expect(immediateDeclined[0]?.status).toBe('declined');
    expect(immediate0003[0]?.status).toBe('cancelled');
    expect(immediate0004[0]?.status).toBe('cancelled');

    // F07-AC3 & CF-13: Wait for slow gateway timers (0003 & 0004) to fire and finish
    await waitForPendingGatewayJobs();
    // Explicitly test direct late applyGatewayOutcome calls too
    expect(await applyGatewayOutcome(storePending0003.id, 'confirmed')).toBe(
      false,
    );
    expect(
      await applyGatewayOutcome(partnerPending0004.ticketId, 'declined'),
    ).toBe(false);

    const [after0003, after0004] = await Promise.all([
      db.select().from(tickets).where(eq(tickets.id, storePending0003.id)),
      db
        .select()
        .from(tickets)
        .where(eq(tickets.id, partnerPending0004.ticketId)),
    ]);
    expect(after0003[0]?.status).toBe('cancelled');
    expect(after0004[0]?.status).toBe('cancelled');

    // CF-14: Storefront hides cancelled event, rejects purchase, and /my-tickets shows estornado/cancelado
    const storefrontRes = await app.inject({
      method: 'GET',
      url: '/',
    });
    expect(storefrontRes.statusCode).toBe(200);
    expect(storefrontRes.body).not.toContain('Evento Cancelamento F07');
    expect(storefrontRes.body).toContain('Evento Ativo F07');

    const storefrontPurchaseAttempt = await app.inject({
      method: 'POST',
      url: `/events/${event.id}/purchase`,
      headers: { cookie: partCookie },
      payload: { cardNumber: '4111111111110001' },
    });
    expect(storefrontPurchaseAttempt.statusCode).toBe(404);
    expect(storefrontPurchaseAttempt.body).toContain(
      'Evento não disponível para compra.',
    );

    const myTicketsRes = await app.inject({
      method: 'GET',
      url: '/my-tickets',
      headers: { cookie: partCookie },
    });
    expect(myTicketsRes.statusCode).toBe(200);
    expect(myTicketsRes.body).toContain(storeConfirmed.code);
    expect(myTicketsRes.body).toContain('estornado');
    expect(myTicketsRes.body).toContain(storePending0003.code);
    expect(myTicketsRes.body).toContain('cancelado');
    expect(myTicketsRes.body).toContain(storeDeclined.code);
    expect(myTicketsRes.body).toContain('recusado');

    // CF-15: Partner API removes event from listing, rejects purchases with 404 event_not_available, returns refunded/cancelled
    const partnerEventsRes = await app.inject({
      method: 'GET',
      url: '/api/partner/events',
      headers: { 'x-api-key': env.PARTNER_API_KEY },
    });
    expect(partnerEventsRes.statusCode).toBe(200);
    const partnerEvents = partnerEventsRes.json() as Array<{ id: string }>;
    expect(partnerEvents.some((e) => e.id === event.id)).toBe(false);
    expect(partnerEvents.some((e) => e.id === otherEvent.id)).toBe(true);

    const partnerPurchaseAfterCancel = await app.inject({
      method: 'POST',
      url: `/api/partner/events/${event.id}/purchases`,
      headers: { 'x-api-key': env.PARTNER_API_KEY },
      payload: {
        buyerEmail: 'late@example.com',
        cardNumber: '4111111111110001',
      },
    });
    expect(partnerPurchaseAfterCancel.statusCode).toBe(404);
    expect(partnerPurchaseAfterCancel.json()).toEqual({
      error: 'event_not_available',
    });

    const partnerConfirmedGet = await app.inject({
      method: 'GET',
      url: `/api/partner/tickets/${partnerConfirmed.ticketId}`,
      headers: { 'x-api-key': env.PARTNER_API_KEY },
    });
    expect(partnerConfirmedGet.statusCode).toBe(200);
    expect(partnerConfirmedGet.json()).toMatchObject({
      ticketId: partnerConfirmed.ticketId,
      status: 'refunded',
      checkedIn: true,
    });

    const partnerPendingGet = await app.inject({
      method: 'GET',
      url: `/api/partner/tickets/${partnerPending0004.ticketId}`,
      headers: { 'x-api-key': env.PARTNER_API_KEY },
    });
    expect(partnerPendingGet.statusCode).toBe(200);
    expect(partnerPendingGet.json()).toMatchObject({
      ticketId: partnerPending0004.ticketId,
      status: 'cancelled',
      checkedIn: false,
    });

    // F07-AC4, F07-AC5 & CF-16: Check-in & Organizer Dashboard on /organizer/events/:eventId
    const manageRes = await app.inject({
      method: 'GET',
      url: `/organizer/events/${event.id}`,
      headers: { cookie: orgACookie },
    });
    expect(manageRes.statusCode).toBe(200);
    expect(manageRes.body).toContain('Evento cancelado');
    expect(manageRes.body).not.toContain(
      `action="/organizer/events/${event.id}/edit"`,
    );
    expect(manageRes.body).not.toContain(
      `action="/organizer/events/${event.id}/checkin"`,
    );

    expect(extractMetricValue(manageRes.body, 'confirmed')).toBe('0');
    expect(extractMetricValue(manageRes.body, 'pending')).toBe('0');
    expect(extractMetricValue(manageRes.body, 'checked-in')).toBe('0');
    expect(extractMetricValue(manageRes.body, 'available-seats')).toBe('0');
    expect(extractMetricValue(manageRes.body, 'revenue')).toBe('R$ 0,00');
    expect(extractMetricValue(manageRes.body, 'refunded')).toBe('2');

    // Direct POST to check-in on cancelled event:
    // - valid ticket from this event -> Evento cancelado (Priority 2)
    // - unknown code -> Ingresso inválido para este evento (Priority 1)
    const checkinValidTicketRes = await app.inject({
      method: 'POST',
      url: `/organizer/events/${event.id}/checkin`,
      headers: { cookie: orgACookie },
      payload: { code: storeConfirmed.code },
    });
    expect(checkinValidTicketRes.statusCode).toBe(200);
    expect(checkinValidTicketRes.body).toContain(
      CHECKIN_MESSAGES.EVENT_CANCELLED,
    );

    const checkinUnknownCodeRes = await app.inject({
      method: 'POST',
      url: `/organizer/events/${event.id}/checkin`,
      headers: { cookie: orgACookie },
      payload: { code: 'NAOEXISTE' },
    });
    expect(checkinUnknownCodeRes.statusCode).toBe(200);
    expect(checkinUnknownCodeRes.body).toContain(
      CHECKIN_MESSAGES.INVALID_TICKET,
    );
  });

  it('R07 & R11: serializes concurrent purchaseTicket and cancelEvent via SELECT FOR UPDATE without orphan pending/confirmed tickets', async () => {
    const orgAId = await getUserIdByEmail('org-a@catraca.local');
    const event = await createEvent(orgAId, {
      name: 'Evento Corrida F07',
      startsAt: FUTURE_STARTS_AT,
      location: 'Salão Principal',
      capacity: 10,
      price: '90,00',
    });
    await publishEvent(orgAId, event.id);

    const [cancelOutcome, purchaseOutcome] = await Promise.allSettled([
      cancelEvent(orgAId, event.id),
      purchaseTicket({
        eventId: event.id,
        buyerEmail: 'race@example.com',
        cardNumber: '4111111111110001',
        channel: 'partner_api',
      }),
    ]);

    expect(cancelOutcome.status).toBe('fulfilled');

    if (purchaseOutcome.status === 'fulfilled') {
      // Purchase committed before cancelEvent -> cancelEvent must have transitioned it to cancelled
      await waitForPendingGatewayJobs();
      const [ticketRow] = await db
        .select()
        .from(tickets)
        .where(eq(tickets.id, purchaseOutcome.value.id));
      expect(ticketRow?.status).toBe('cancelled');
    } else {
      // Cancel committed before purchaseTicket -> purchaseTicket must reject as event_not_available
      expect(purchaseOutcome.reason).toBeInstanceOf(EventNotAvailableError);
    }

    const updatedEvent = await getEventById(event.id);
    expect(updatedEvent?.status).toBe('cancelled');

    const eventTickets = await db
      .select()
      .from(tickets)
      .where(eq(tickets.eventId, event.id));
    for (const ticket of eventTickets) {
      expect(['cancelled', 'refunded', 'declined']).toContain(ticket.status);
    }
  });
});
