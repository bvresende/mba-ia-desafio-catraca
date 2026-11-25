import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { buildApp } from '../src/app.js';
import { db } from '../src/db/client.js';
import { events, tickets, users } from '../src/db/schema.js';
import {
  CHECKIN_MESSAGES,
  performCheckIn,
} from '../src/modules/checkin/checkin.service.js';
import {
  formatCurrencyBRL,
  getEventDashboardMetrics,
} from '../src/modules/checkin/dashboard.service.js';
import {
  createEvent,
  publishEvent,
  updateEvent,
} from '../src/modules/events/events.service.js';
import {
  cancelPendingTimers,
  waitForPendingGatewayJobs,
} from '../src/modules/purchases/gateway.service.js';
import { purchaseTicket } from '../src/modules/purchases/purchase.service.js';
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
  process.env['GATEWAY_SLOW_MIN_MS'] = '2000';
  process.env['GATEWAY_SLOW_MAX_MS'] = '3000';
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

describe('F06 — Check-in e Painel do Organizador', () => {
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

  it('F06-AC1 & CF-10: renders dashboard with 6 metrics and check-in form on /organizer/events/:eventId', async () => {
    const orgAId = await getUserIdByEmail('org-a@catraca.local');
    const orgACookie = await loginAs(app, 'org-a@catraca.local', 'OrgA1234!');

    const event = await createEvent(orgAId, {
      name: 'Evento Checkin F06',
      startsAt: FUTURE_STARTS_AT,
      location: 'Auditório Central',
      capacity: 10,
      price: '100,00',
    });
    await publishEvent(orgAId, event.id);

    const res = await app.inject({
      method: 'GET',
      url: `/organizer/events/${event.id}`,
      headers: { cookie: orgACookie },
    });

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Confirmados');
    expect(res.body).toContain('Pendentes');
    expect(res.body).toContain('Check-ins');
    expect(res.body).toContain('Vagas disponíveis');
    expect(res.body).toContain('Receita');
    expect(res.body).toContain('Estornados');

    expect(extractMetricValue(res.body, 'confirmed')).toBe('0');
    expect(extractMetricValue(res.body, 'pending')).toBe('0');
    expect(extractMetricValue(res.body, 'checked-in')).toBe('0');
    expect(extractMetricValue(res.body, 'available-seats')).toBe('10');
    expect(extractMetricValue(res.body, 'revenue')).toBe('R$ 0,00');
    expect(extractMetricValue(res.body, 'refunded')).toBe('0');

    expect(res.body).toContain(`action="/organizer/events/${event.id}/checkin"`);
    expect(res.body).toContain('name="code"');
  });

  it('F06-AC2 & CF-11: enforces strict R10 precedence order and literal messages, including cancelled events and concurrency', async () => {
    const orgAId = await getUserIdByEmail('org-a@catraca.local');
    const orgACookie = await loginAs(app, 'org-a@catraca.local', 'OrgA1234!');

    const eventA = await createEvent(orgAId, {
      name: 'Evento A Checkin',
      startsAt: FUTURE_STARTS_AT,
      location: 'Sala A',
      capacity: 10,
      price: '100,00',
    });
    await publishEvent(orgAId, eventA.id);

    const eventB = await createEvent(orgAId, {
      name: 'Evento B Checkin',
      startsAt: FUTURE_STARTS_AT,
      location: 'Sala B',
      capacity: 10,
      price: '100,00',
    });
    await publishEvent(orgAId, eventB.id);

    const confirmedA1 = await purchaseTicket({
      eventId: eventA.id,
      buyerEmail: 'a1@example.com',
      cardNumber: '4111111111110001',
      channel: 'storefront',
    });
    const confirmedA2 = await purchaseTicket({
      eventId: eventA.id,
      buyerEmail: 'a2@example.com',
      cardNumber: '4111111111110001',
      channel: 'partner_api',
    });
    const declinedA = await purchaseTicket({
      eventId: eventA.id,
      buyerEmail: 'declined@example.com',
      cardNumber: '4111111111110002',
      channel: 'storefront',
    });
    const confirmedB = await purchaseTicket({
      eventId: eventB.id,
      buyerEmail: 'b1@example.com',
      cardNumber: '4111111111110001',
      channel: 'storefront',
    });

    await waitForPendingGatewayJobs();

    // Pending ticket (slow card 0003) kept in pending state while fast checks run
    const pendingA = await purchaseTicket({
      eventId: eventA.id,
      buyerEmail: 'pending@example.com',
      cardNumber: '4111111111110003',
      channel: 'storefront',
    });

    // Extra tickets in cancelled and refunded status
    const cancelledTicketId = 'tkt_f06_cancelled';
    const refundedTicketId = 'tkt_f06_refunded';
    await db.insert(tickets).values([
      {
        id: cancelledTicketId,
        eventId: eventA.id,
        userId: null,
        buyerEmail: 'c@example.com',
        code: 'CANC0001',
        priceCents: 10000,
        status: 'cancelled',
        checkedIn: false,
        checkedInAt: null,
        channel: 'storefront',
      },
      {
        id: refundedTicketId,
        eventId: eventA.id,
        userId: null,
        buyerEmail: 'r@example.com',
        code: 'REFU0001',
        priceCents: 10000,
        status: 'refunded',
        checkedIn: false,
        checkedInAt: null,
        channel: 'partner_api',
      },
    ]);

    const submitCheckIn = async (eventId: string, code: string) =>
      app.inject({
        method: 'POST',
        url: `/organizer/events/${eventId}/checkin`,
        headers: { cookie: orgACookie },
        payload: { code },
      });

    // 1a. Empty / non-existent code -> Ingresso inválido para este evento
    const emptyRes = await submitCheckIn(eventA.id, '   ');
    expect(emptyRes.statusCode).toBe(200);
    expect(emptyRes.body).toContain(CHECKIN_MESSAGES.INVALID_TICKET);

    const missingRes = await submitCheckIn(eventA.id, 'INEXISTE');
    expect(missingRes.statusCode).toBe(200);
    expect(missingRes.body).toContain(CHECKIN_MESSAGES.INVALID_TICKET);

    // 1b. Code belonging to another event -> Ingresso inválido para este evento
    const otherEventRes = await submitCheckIn(eventA.id, confirmedB.code);
    expect(otherEventRes.statusCode).toBe(200);
    expect(otherEventRes.body).toContain(CHECKIN_MESSAGES.INVALID_TICKET);

    // 3. Non-confirmed tickets (pending, declined, cancelled, refunded) -> Ingresso não confirmado
    for (const nonConfirmedCode of [
      pendingA.code,
      declinedA.code,
      'CANC0001',
      'REFU0001',
    ]) {
      const res = await submitCheckIn(eventA.id, nonConfirmedCode);
      expect(res.statusCode).toBe(200);
      expect(res.body).toContain(CHECKIN_MESSAGES.NOT_CONFIRMED);
    }

    // 5. First check-in of confirmed ticket (case-insensitive & trimmed) -> Entrada liberada
    const firstAllowed = await submitCheckIn(
      eventA.id,
      `  ${confirmedA1.code.toLowerCase()}  `,
    );
    expect(firstAllowed.statusCode).toBe(200);
    expect(firstAllowed.body).toContain(CHECKIN_MESSAGES.ALLOWED);

    // 4. Second check-in of already checked-in ticket -> Ingresso já utilizado
    const secondUsed = await submitCheckIn(eventA.id, confirmedA1.code);
    expect(secondUsed.statusCode).toBe(200);
    expect(secondUsed.body).toContain(CHECKIN_MESSAGES.ALREADY_USED);

    // Concurrent double check-in on confirmedA2 -> 1 allowed, 1 already used
    const [race1, race2] = await Promise.all([
      performCheckIn(orgAId, eventA.id, confirmedA2.code),
      performCheckIn(orgAId, eventA.id, confirmedA2.code),
    ]);
    const raceMessages = [race1.message, race2.message].sort();
    expect(raceMessages).toEqual(
      [CHECKIN_MESSAGES.ALLOWED, CHECKIN_MESSAGES.ALREADY_USED].sort(),
    );

    // 2. Cancelled event precedence:
    // Priority 1 (other event code) still beats Priority 2 (cancelled event),
    // while Priority 2 (cancelled event) beats Priority 3/4 (not confirmed / already used)!
    await db
      .update(events)
      .set({ status: 'cancelled' })
      .where(eq(events.id, eventA.id));

    const cancelledOtherEventRes = await submitCheckIn(eventA.id, confirmedB.code);
    expect(cancelledOtherEventRes.statusCode).toBe(200);
    expect(cancelledOtherEventRes.body).toContain(CHECKIN_MESSAGES.INVALID_TICKET);

    for (const codeInEventA of [confirmedA1.code, pendingA.code, 'REFU0001']) {
      const cancelledEventRes = await submitCheckIn(eventA.id, codeInEventA);
      expect(cancelledEventRes.statusCode).toBe(200);
      expect(cancelledEventRes.body).toContain(CHECKIN_MESSAGES.EVENT_CANCELLED);
    }

    cancelPendingTimers();
  });

  it('F06-AC3: check-in keeps ticket status as confirmed, sets checked_in=true and checked_in_at, and updates counts', async () => {
    const orgAId = await getUserIdByEmail('org-a@catraca.local');
    const orgACookie = await loginAs(app, 'org-a@catraca.local', 'OrgA1234!');

    const event = await createEvent(orgAId, {
      name: 'Evento Preserva Status',
      startsAt: FUTURE_STARTS_AT,
      location: 'Teatro Municipal',
      capacity: 5,
      price: '80,00',
    });
    await publishEvent(orgAId, event.id);

    const ticket = await purchaseTicket({
      eventId: event.id,
      buyerEmail: 'part@example.com',
      cardNumber: '4111111111110001',
      channel: 'storefront',
    });
    await waitForPendingGatewayJobs();

    const beforePage = await app.inject({
      method: 'GET',
      url: `/organizer/events/${event.id}`,
      headers: { cookie: orgACookie },
    });
    expect(extractMetricValue(beforePage.body, 'confirmed')).toBe('1');
    expect(extractMetricValue(beforePage.body, 'checked-in')).toBe('0');

    const [beforeRow] = await db
      .select()
      .from(tickets)
      .where(eq(tickets.id, ticket.id));
    expect(beforeRow?.status).toBe('confirmed');
    expect(beforeRow?.checkedIn).toBe(false);
    expect(beforeRow?.checkedInAt).toBeNull();

    const checkinRes = await app.inject({
      method: 'POST',
      url: `/organizer/events/${event.id}/checkin`,
      headers: { cookie: orgACookie },
      payload: { code: ticket.code },
    });
    expect(checkinRes.statusCode).toBe(200);
    expect(checkinRes.body).toContain(CHECKIN_MESSAGES.ALLOWED);
    expect(extractMetricValue(checkinRes.body, 'confirmed')).toBe('1');
    expect(extractMetricValue(checkinRes.body, 'checked-in')).toBe('1');

    const [afterRow] = await db
      .select()
      .from(tickets)
      .where(eq(tickets.id, ticket.id));
    expect(afterRow?.status).toBe('confirmed');
    expect(afterRow?.checkedIn).toBe(true);
    expect(afterRow?.checkedInAt).toBeInstanceOf(Date);
  });

  it('F06-AC4 & F06-AC5 & CF-11: consolidates storefront + partner_api channels and calculates revenue from frozen price_cents', async () => {
    const orgAId = await getUserIdByEmail('org-a@catraca.local');
    const orgACookie = await loginAs(app, 'org-a@catraca.local', 'OrgA1234!');

    const event = await createEvent(orgAId, {
      name: 'Evento Receita Consolidada',
      startsAt: FUTURE_STARTS_AT,
      location: 'Arena Sul',
      capacity: 10,
      price: '100,00',
    });
    await publishEvent(orgAId, event.id);

    // 2 confirmed tickets at R$ 100,00 (1 storefront + 1 partner_api)
    const tStore = await purchaseTicket({
      eventId: event.id,
      buyerEmail: 'store@example.com',
      cardNumber: '4111111111110001',
      channel: 'storefront',
    });
    await purchaseTicket({
      eventId: event.id,
      buyerEmail: 'partner@example.com',
      cardNumber: '4111111111110001',
      channel: 'partner_api',
    });
    await waitForPendingGatewayJobs();

    // Change price to R$ 150,00
    await updateEvent(orgAId, event.id, { price: '150,00' });

    // 1 confirmed at R$ 150,00 + 1 declined at R$ 150,00
    await purchaseTicket({
      eventId: event.id,
      buyerEmail: 'late@example.com',
      cardNumber: '4111111111110001',
      channel: 'partner_api',
    });
    await purchaseTicket({
      eventId: event.id,
      buyerEmail: 'declined@example.com',
      cardNumber: '4111111111110002',
      channel: 'storefront',
    });
    await waitForPendingGatewayJobs();

    // 1 pending at R$ 150,00 (slow card 0003)
    await purchaseTicket({
      eventId: event.id,
      buyerEmail: 'pending@example.com',
      cardNumber: '4111111111110003',
      channel: 'storefront',
    });

    // 1 cancelled ticket must not affect confirmed/pending/revenue/refunded/seats
    await db.insert(tickets).values({
      id: 'tkt_f06_ignored_cancelled',
      eventId: event.id,
      userId: null,
      buyerEmail: 'ignored@example.com',
      code: 'IGNR0001',
      priceCents: 15000,
      status: 'cancelled',
      checkedIn: false,
      checkedInAt: null,
      channel: 'storefront',
    });

    // Check in 1 confirmed ticket
    const checkinResult = await performCheckIn(orgAId, event.id, tStore.code);
    expect(checkinResult.ok).toBe(true);

    const metrics = await getEventDashboardMetrics(event.id);
    expect(metrics).toEqual({
      eventId: event.id,
      eventStatus: 'published',
      capacity: 10,
      confirmedCount: 3,
      pendingCount: 1,
      checkedInCount: 1,
      availableSeats: 6,
      revenueCents: 35000,
      revenueFormatted: 'R$ 350,00',
      refundedCount: 0,
    });

    const pageRes = await app.inject({
      method: 'GET',
      url: `/organizer/events/${event.id}`,
      headers: { cookie: orgACookie },
    });
    expect(pageRes.statusCode).toBe(200);
    expect(extractMetricValue(pageRes.body, 'confirmed')).toBe('3');
    expect(extractMetricValue(pageRes.body, 'pending')).toBe('1');
    expect(extractMetricValue(pageRes.body, 'checked-in')).toBe('1');
    expect(extractMetricValue(pageRes.body, 'available-seats')).toBe('6');
    expect(extractMetricValue(pageRes.body, 'revenue')).toBe('R$ 350,00');
    expect(extractMetricValue(pageRes.body, 'refunded')).toBe('0');

    // Verify BRL formatting with thousands separator and refunded metrics behavior
    expect(formatCurrencyBRL(125050)).toBe('R$ 1.250,50');
    await db.insert(tickets).values({
      id: 'tkt_f06_refunded_metric',
      eventId: event.id,
      userId: null,
      buyerEmail: 'refund@example.com',
      code: 'RFND0002',
      priceCents: 10000,
      status: 'refunded',
      checkedIn: false,
      checkedInAt: null,
      channel: 'partner_api',
    });
    const withRefund = await getEventDashboardMetrics(event.id);
    expect(withRefund?.refundedCount).toBe(1);
    expect(withRefund?.revenueCents).toBe(35000);
    expect(withRefund?.availableSeats).toBe(6);

    cancelPendingTimers();
  });

  it('F06-AC6, CF-09 & CF-10 (R13): blocks visitor, participant, and Organizador B from dashboard and check-in', async () => {
    const orgAId = await getUserIdByEmail('org-a@catraca.local');
    const eventA = await createEvent(orgAId, {
      name: 'Evento Privado A',
      startsAt: FUTURE_STARTS_AT,
      location: 'Sala VIP A',
      capacity: 10,
      price: '120,00',
    });
    await publishEvent(orgAId, eventA.id);

    const ticketA = await purchaseTicket({
      eventId: eventA.id,
      buyerEmail: 'vip@example.com',
      cardNumber: '4111111111110001',
      channel: 'storefront',
    });
    await waitForPendingGatewayJobs();

    const partCookie = await loginAs(
      app,
      'participante@catraca.local',
      'Part1234!',
    );
    const orgBCookie = await loginAs(app, 'org-b@catraca.local', 'OrgB1234!');

    // 1. Visitor (unauthenticated)
    const visitorGet = await app.inject({
      method: 'GET',
      url: `/organizer/events/${eventA.id}`,
    });
    expect(visitorGet.statusCode).toBe(302);
    expect(visitorGet.headers.location).toBe('/login');

    const visitorPost = await app.inject({
      method: 'POST',
      url: `/organizer/events/${eventA.id}/checkin`,
      payload: { code: ticketA.code },
    });
    expect(visitorPost.statusCode).toBe(302);
    expect(visitorPost.headers.location).toBe('/login');

    // 2. Participant
    const partGet = await app.inject({
      method: 'GET',
      url: `/organizer/events/${eventA.id}`,
      headers: { cookie: partCookie },
    });
    expect(partGet.statusCode).toBe(403);
    expect(partGet.body).not.toContain('Evento Privado A');
    expect(partGet.body).not.toContain('R$ 120,00');

    const partPost = await app.inject({
      method: 'POST',
      url: `/organizer/events/${eventA.id}/checkin`,
      headers: { cookie: partCookie },
      payload: { code: ticketA.code },
    });
    expect(partPost.statusCode).toBe(403);
    expect(partPost.body).not.toContain(CHECKIN_MESSAGES.ALLOWED);

    // 3. Organizador B
    const orgBGet = await app.inject({
      method: 'GET',
      url: `/organizer/events/${eventA.id}`,
      headers: { cookie: orgBCookie },
    });
    expect(orgBGet.statusCode).toBe(403);
    expect(orgBGet.body).not.toContain('Evento Privado A');
    expect(orgBGet.body).not.toContain('R$ 120,00');

    const orgBPost = await app.inject({
      method: 'POST',
      url: `/organizer/events/${eventA.id}/checkin`,
      headers: { cookie: orgBCookie },
      payload: { code: ticketA.code },
    });
    expect(orgBPost.statusCode).toBe(403);
    expect(orgBPost.body).not.toContain(CHECKIN_MESSAGES.ALLOWED);

    // 4. Non-existent event as Organizador A -> 404
    const orgACookie = await loginAs(app, 'org-a@catraca.local', 'OrgA1234!');
    const notFoundPost = await app.inject({
      method: 'POST',
      url: '/organizer/events/evt_inexistente/checkin',
      headers: { cookie: orgACookie },
      payload: { code: ticketA.code },
    });
    expect(notFoundPost.statusCode).toBe(404);

    // Confirm ticketA was never checked in
    const [ticketRow] = await db
      .select()
      .from(tickets)
      .where(eq(tickets.id, ticketA.id));
    expect(ticketRow?.checkedIn).toBe(false);
    expect(ticketRow?.checkedInAt).toBeNull();
  });
});
