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
import { events, tickets } from '../src/db/schema.js';
import { createEvent, publishEvent } from '../src/modules/events/events.service.js';
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

const FUTURE_STARTS_AT_1 = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
const FUTURE_STARTS_AT_2 = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

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
  process.env['GATEWAY_FAST_MIN_MS'] = '40';
  process.env['GATEWAY_FAST_MAX_MS'] = '80';
  process.env['GATEWAY_SLOW_MIN_MS'] = '300';
  process.env['GATEWAY_SLOW_MAX_MS'] = '400';
}

describe('F05 — API de Parceiros (Contrato Fixo)', () => {
  let app: FastifyInstance;
  let baseUrl = '';

  beforeAll(async () => {
    await setupTestDb();
    app = buildApp();
    baseUrl = await app.listen({ port: 0, host: '127.0.0.1' });
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

  it('F05-AC1: rejects missing, empty, or invalid X-Api-Key with 401 {"error":"unauthorized"} on all 3 routes before 422/404', async () => {
    const cases: Array<{
      method: 'GET' | 'POST';
      url: string;
      headers?: Record<string, string>;
      payload?: string;
    }> = [
      { method: 'GET', url: '/api/partner/events' },
      {
        method: 'GET',
        url: '/api/partner/events',
        headers: { 'X-Api-Key': '' },
      },
      {
        method: 'GET',
        url: '/api/partner/events',
        headers: { 'X-Api-Key': 'wrong-key' },
      },
      {
        method: 'POST',
        url: '/api/partner/events/inexistente/purchases',
        headers: { 'content-type': 'application/json' },
        payload: '{}',
      },
      {
        method: 'POST',
        url: '/api/partner/events/inexistente/purchases',
        headers: {
          'X-Api-Key': 'invalida',
          'content-type': 'application/json',
        },
        payload: '{bad-json',
      },
      {
        method: 'GET',
        url: '/api/partner/tickets/00000000-0000-0000-0000-000000000000',
      },
      {
        method: 'GET',
        url: '/api/partner/tickets/tkt_inexistente',
        headers: { 'x-api-key': 'chave-errada' },
      },
    ];

    for (const testCase of cases) {
      const res = await app.inject({
        method: testCase.method,
        url: testCase.url,
        headers: testCase.headers,
        payload: testCase.payload,
      });

      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: 'unauthorized' });
    }
  });

  it('F05-AC2 & CF-07 (R02, R05): lists only published events with exact contract fields and real-time availableSeats', async () => {
    const draftEvent = await createEvent('usr_org_a', {
      name: 'Evento Rascunho API',
      startsAt: FUTURE_STARTS_AT_2,
      location: 'Sala B',
      capacity: 10,
      price: '80,00',
    });

    const publishedRaw = await createEvent('usr_org_a', {
      name: 'Evento Publicado API',
      startsAt: FUTURE_STARTS_AT_1,
      location: 'Teatro Principal',
      capacity: 5,
      price: '120,00',
    });
    const publishedEvent = await publishEvent('usr_org_a', publishedRaw.id);

    const cancelledRaw = await createEvent('usr_org_a', {
      name: 'Evento Cancelado API',
      startsAt: FUTURE_STARTS_AT_1,
      location: 'Arena C',
      capacity: 20,
      price: '50,00',
    });
    await db
      .update(events)
      .set({ status: 'cancelled' })
      .where(eq(events.id, cancelledRaw.id));

    await db.insert(tickets).values([
      {
        id: 'tkt_f05_conf',
        eventId: publishedEvent.id,
        userId: null,
        buyerEmail: 'a@test.com',
        code: 'CONF0001',
        priceCents: 12000,
        status: 'confirmed',
        checkedIn: false,
        channel: 'partner_api',
      },
      {
        id: 'tkt_f05_pend',
        eventId: publishedEvent.id,
        userId: null,
        buyerEmail: 'b@test.com',
        code: 'PEND0001',
        priceCents: 12000,
        status: 'pending',
        checkedIn: false,
        channel: 'storefront',
      },
      {
        id: 'tkt_f05_decl',
        eventId: publishedEvent.id,
        userId: null,
        buyerEmail: 'c@test.com',
        code: 'DECL0001',
        priceCents: 12000,
        status: 'declined',
        checkedIn: false,
        channel: 'partner_api',
      },
    ]);

    const resBefore = await app.inject({
      method: 'GET',
      url: '/api/partner/events',
      headers: { 'X-Api-Key': env.PARTNER_API_KEY },
    });

    expect(resBefore.statusCode).toBe(200);
    const listBefore = resBefore.json() as Array<Record<string, unknown>>;
    expect(listBefore).toHaveLength(1);
    expect(listBefore[0]).toEqual({
      id: publishedEvent.id,
      name: 'Evento Publicado API',
      startsAt: publishedEvent.startsAt.toISOString(),
      priceCents: 12000,
      availableSeats: 3,
    });
    expect(Object.keys(listBefore[0] ?? {})).toEqual([
      'id',
      'name',
      'startsAt',
      'priceCents',
      'availableSeats',
    ]);

    await publishEvent('usr_org_a', draftEvent.id);

    const resAfter = await app.inject({
      method: 'GET',
      url: '/api/partner/events',
      headers: { 'x-api-key': env.PARTNER_API_KEY },
    });

    expect(resAfter.statusCode).toBe(200);
    const listAfter = resAfter.json() as Array<{ id: string; availableSeats: number; priceCents: number }>;
    expect(listAfter.map((item) => item.id)).toEqual([
      publishedEvent.id,
      draftEvent.id,
    ]);
    expect(listAfter[1]?.priceCents).toBe(8000);
    expect(listAfter[1]?.availableSeats).toBe(10);
  });

  it('F05-AC3 & CF-07 (R06): enforces strict validation order 422 -> 404 -> 409 -> 202 on POST /api/partner/events/:eventId/purchases', async () => {
    const draftEvent = await createEvent('usr_org_a', {
      name: 'Evento Draft Compra',
      startsAt: FUTURE_STARTS_AT_1,
      location: 'Sala 1',
      capacity: 5,
      price: '90,00',
    });

    const cancelledRaw = await createEvent('usr_org_a', {
      name: 'Evento Cancelado Compra',
      startsAt: FUTURE_STARTS_AT_1,
      location: 'Sala 2',
      capacity: 5,
      price: '90,00',
    });
    await db
      .update(events)
      .set({ status: 'cancelled' })
      .where(eq(events.id, cancelledRaw.id));

    const publishedRaw = await createEvent('usr_org_a', {
      name: 'Evento Lotacao 1',
      startsAt: FUTURE_STARTS_AT_1,
      location: 'Sala 3',
      capacity: 1,
      price: '150,00',
    });
    const publishedEvent = await publishEvent('usr_org_a', publishedRaw.id);

    // 422 must beat 404 even on nonexistent/malformed eventId
    const invalidPayloads: Array<{
      headers?: Record<string, string>;
      payload?: string | Record<string, unknown> | unknown[];
    }> = [
      { payload: {} },
      { payload: { buyerEmail: 'email-invalido', cardNumber: '4111111111110001' } },
      { payload: { buyerEmail: 'ok@test.com', cardNumber: '1234' } },
      { payload: { buyerEmail: 'ok@test.com', cardNumber: '4111-1111-1111-0001' } },
      { payload: { buyerEmail: 'ok@test.com', cardNumber: '411111111111000a' } },
      { payload: { buyerEmail: 'ok@test.com', cardNumber: 4111111111110001 } },
      { payload: [] },
      {
        headers: { 'content-type': 'application/json' },
        payload: '{malformed-json',
      },
      {
        headers: { 'content-type': 'application/json' },
        payload: '',
      },
    ];

    for (const invalidCase of invalidPayloads) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/partner/events/evento-inexistente/purchases',
        headers: {
          'X-Api-Key': env.PARTNER_API_KEY,
          ...invalidCase.headers,
        },
        payload: invalidCase.payload,
      });

      expect(res.statusCode).toBe(422);
      expect(res.json()).toEqual({ error: 'invalid_request' });
    }

    // 404 for nonexistent, malformed, draft, or cancelled event with valid body
    const unavailableIds = [
      '00000000-0000-0000-0000-000000000000',
      'nao-e-uuid',
      draftEvent.id,
      cancelledRaw.id,
    ];

    for (const eventId of unavailableIds) {
      const res = await app.inject({
        method: 'POST',
        url: `/api/partner/events/${eventId}/purchases`,
        headers: { 'X-Api-Key': env.PARTNER_API_KEY },
        payload: {
          buyerEmail: 'parceiro@teste.com',
          cardNumber: '4111111111110001',
        },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'event_not_available' });
    }

    // 202 immediate response using slow card 0003 (keeps ticket pending)
    const startedAt = Date.now();
    const okRes = await app.inject({
      method: 'POST',
      url: `/api/partner/events/${publishedEvent.id}/purchases`,
      headers: { 'X-Api-Key': env.PARTNER_API_KEY },
      payload: {
        buyerEmail: 'Parceiro@Teste.com',
        cardNumber: '4111111111110003',
      },
    });
    const elapsedMs = Date.now() - startedAt;

    expect(okRes.statusCode).toBe(202);
    expect(elapsedMs).toBeLessThan(250);
    const createdBody = okRes.json() as {
      ticketId: string;
      code: string;
      status: string;
    };
    expect(createdBody).toEqual({
      ticketId: expect.any(String),
      code: expect.stringMatching(/^[A-Z0-9]{8}$/),
      status: 'pending',
    });

    const [stored] = await db
      .select()
      .from(tickets)
      .where(eq(tickets.id, createdBody.ticketId));
    expect(stored?.channel).toBe('partner_api');
    expect(stored?.userId).toBeNull();
    expect(stored?.priceCents).toBe(15000);
    expect(stored?.buyerEmail).toBe('parceiro@teste.com');

    // F05-AC4: 409 sold_out while seat is occupied by pending ticket
    const soldOutRes = await app.inject({
      method: 'POST',
      url: `/api/partner/events/${publishedEvent.id}/purchases`,
      headers: { 'X-Api-Key': env.PARTNER_API_KEY },
      payload: {
        buyerEmail: 'segundo@teste.com',
        cardNumber: '4111111111110001',
      },
    });
    expect(soldOutRes.statusCode).toBe(409);
    expect(soldOutRes.json()).toEqual({ error: 'sold_out' });

    const eventsRes = await app.inject({
      method: 'GET',
      url: '/api/partner/events',
      headers: { 'X-Api-Key': env.PARTNER_API_KEY },
    });
    expect(eventsRes.statusCode).toBe(200);
    expect(eventsRes.json()).toEqual([
      {
        id: publishedEvent.id,
        name: 'Evento Lotacao 1',
        startsAt: publishedEvent.startsAt.toISOString(),
        priceCents: 15000,
        availableSeats: 0,
      },
    ]);

    await waitForPendingGatewayJobs();
  });

  it('F05-AC5 & CF-08 (R07): prevents overselling under 30 concurrent HTTP POST requests for capacity 5 across 2 independent rounds', async () => {
    for (let round = 1; round <= 2; round += 1) {
      const draft = await createEvent('usr_org_a', {
        name: `Evento Concorrencia API Rodada ${round}`,
        startsAt: FUTURE_STARTS_AT_1,
        location: 'Auditório HTTP',
        capacity: 5,
        price: '100,00',
      });
      const published = await publishEvent('usr_org_a', draft.id);

      const responses = await Promise.all(
        Array.from({ length: 30 }, async (_, idx) => {
          const response = await fetch(
            `${baseUrl}/api/partner/events/${published.id}/purchases`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Api-Key': env.PARTNER_API_KEY,
              },
              body: JSON.stringify({
                buyerEmail: `round${round}-buyer${idx}@teste.com`,
                cardNumber: '4111111111110001',
              }),
            },
          );
          const json = (await response.json()) as Record<string, unknown>;
          return { status: response.status, body: json };
        }),
      );

      const accepted = responses.filter((r) => r.status === 202);
      const soldOut = responses.filter((r) => r.status === 409);
      const others = responses.filter((r) => r.status !== 202 && r.status !== 409);

      expect(others).toEqual([]);
      expect(accepted).toHaveLength(5);
      expect(soldOut).toHaveLength(25);

      for (const ok of accepted) {
        expect(ok.body).toEqual({
          ticketId: expect.any(String),
          code: expect.stringMatching(/^[A-Z0-9]{8}$/),
          status: 'pending',
        });
      }

      for (const rejected of soldOut) {
        expect(rejected.body).toEqual({ error: 'sold_out' });
      }

      const persistedTickets = await db
        .select()
        .from(tickets)
        .where(eq(tickets.eventId, published.id));
      expect(persistedTickets).toHaveLength(5);
      expect(persistedTickets.every((t) => t.channel === 'partner_api')).toBe(true);

      const eventsRes = await fetch(`${baseUrl}/api/partner/events`, {
        headers: { 'X-Api-Key': env.PARTNER_API_KEY },
      });
      expect(eventsRes.status).toBe(200);
      const listed = (await eventsRes.json()) as Array<{
        id: string;
        availableSeats: number;
      }>;
      const entry = listed.find((item) => item.id === published.id);
      expect(entry?.availableSeats).toBe(0);

      await waitForPendingGatewayJobs();
    }
  });

  it('F05-AC6 & CF-08 (R08): GET /api/partner/tickets/:ticketId tracks gateway outcome, releases declined seat, reads storefront tickets, and returns 404 when missing', async () => {
    const draft = await createEvent('usr_org_a', {
      name: 'Evento Consulta Ticket',
      startsAt: FUTURE_STARTS_AT_1,
      location: 'Palco Central',
      capacity: 1,
      price: '75,00',
    });
    const event = await publishEvent('usr_org_a', draft.id);

    // 1. Declined card 0002 frees seat after gateway callback
    const declinedPurchaseRes = await app.inject({
      method: 'POST',
      url: `/api/partner/events/${event.id}/purchases`,
      headers: { 'X-Api-Key': env.PARTNER_API_KEY },
      payload: {
        buyerEmail: 'recusado@teste.com',
        cardNumber: '4111111111110002',
      },
    });
    expect(declinedPurchaseRes.statusCode).toBe(202);
    const declinedCreated = declinedPurchaseRes.json() as {
      ticketId: string;
      code: string;
      status: string;
    };

    const initialPoll = await app.inject({
      method: 'GET',
      url: `/api/partner/tickets/${declinedCreated.ticketId}`,
      headers: { 'X-Api-Key': env.PARTNER_API_KEY },
    });
    expect(initialPoll.statusCode).toBe(200);
    expect(initialPoll.json()).toEqual({
      ticketId: declinedCreated.ticketId,
      code: declinedCreated.code,
      eventId: event.id,
      status: 'pending',
      checkedIn: false,
    });

    await waitForPendingGatewayJobs();

    const afterDeclinePoll = await app.inject({
      method: 'GET',
      url: `/api/partner/tickets/${declinedCreated.ticketId}`,
      headers: { 'X-Api-Key': env.PARTNER_API_KEY },
    });
    expect(afterDeclinePoll.statusCode).toBe(200);
    expect(afterDeclinePoll.json()).toEqual({
      ticketId: declinedCreated.ticketId,
      code: declinedCreated.code,
      eventId: event.id,
      status: 'declined',
      checkedIn: false,
    });

    const eventsAfterDecline = await app.inject({
      method: 'GET',
      url: '/api/partner/events',
      headers: { 'X-Api-Key': env.PARTNER_API_KEY },
    });
    expect(eventsAfterDecline.json()).toEqual([
      {
        id: event.id,
        name: 'Evento Consulta Ticket',
        startsAt: event.startsAt.toISOString(),
        priceCents: 7500,
        availableSeats: 1,
      },
    ]);

    // 2. Approved card 0001 transitions pending -> confirmed
    const approvedPurchaseRes = await app.inject({
      method: 'POST',
      url: `/api/partner/events/${event.id}/purchases`,
      headers: { 'X-Api-Key': env.PARTNER_API_KEY },
      payload: {
        buyerEmail: 'aprovado@teste.com',
        cardNumber: '4111111111110001',
      },
    });
    expect(approvedPurchaseRes.statusCode).toBe(202);
    const approvedCreated = approvedPurchaseRes.json() as {
      ticketId: string;
      code: string;
    };

    await waitForPendingGatewayJobs();

    const afterApprovePoll = await app.inject({
      method: 'GET',
      url: `/api/partner/tickets/${approvedCreated.ticketId}`,
      headers: { 'X-Api-Key': env.PARTNER_API_KEY },
    });
    expect(afterApprovePoll.statusCode).toBe(200);
    expect(afterApprovePoll.json()).toEqual({
      ticketId: approvedCreated.ticketId,
      code: approvedCreated.code,
      eventId: event.id,
      status: 'confirmed',
      checkedIn: false,
    });

    // 3. Ticket purchased via storefront channel is also visible via Partner API
    const storefrontDraft = await createEvent('usr_org_a', {
      name: 'Evento Vitrine',
      startsAt: FUTURE_STARTS_AT_2,
      location: 'Sala Vitrine',
      capacity: 3,
      price: '60,00',
    });
    const storefrontEvent = await publishEvent('usr_org_a', storefrontDraft.id);
    const storefrontTicket = await purchaseTicket({
      eventId: storefrontEvent.id,
      buyerEmail: 'participante@catraca.local',
      cardNumber: '4111111111110001',
      userId: 'usr_part_seed',
      channel: 'storefront',
    });
    await waitForPendingGatewayJobs();

    const storefrontLookup = await app.inject({
      method: 'GET',
      url: `/api/partner/tickets/${storefrontTicket.id}`,
      headers: { 'X-Api-Key': env.PARTNER_API_KEY },
    });
    expect(storefrontLookup.statusCode).toBe(200);
    expect(storefrontLookup.json()).toEqual({
      ticketId: storefrontTicket.id,
      code: storefrontTicket.code,
      eventId: storefrontEvent.id,
      status: 'confirmed',
      checkedIn: false,
    });

    // 4. Nonexistent and malformed ticketId return 404 ticket_not_found
    for (const missingId of [
      '00000000-0000-0000-0000-000000000000',
      'tkt_inexistente',
      'nao-e-uuid',
    ]) {
      const missingRes = await app.inject({
        method: 'GET',
        url: `/api/partner/tickets/${missingId}`,
        headers: { 'X-Api-Key': env.PARTNER_API_KEY },
      });
      expect(missingRes.statusCode).toBe(404);
      expect(missingRes.json()).toEqual({ error: 'ticket_not_found' });
    }
  });
});
