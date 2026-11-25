import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { env } from '../src/config/env.js';
import { db, pool } from '../src/db/client.js';
import { events, tickets } from '../src/db/schema.js';
import {
  createEvent,
  EventValidationError,
  publishEvent,
  updateEvent,
} from '../src/modules/events/events.service.js';
import {
  applyGatewayOutcome,
  cancelPendingTimers,
  getGatewayTimingConfig,
  isValidCardNumber,
  resolveGatewayBehavior,
  waitForPendingGatewayJobs,
} from '../src/modules/purchases/gateway.service.js';
import {
  EventNotAvailableError,
  generateTicketCode,
  getEventSeatMetrics,
  getEventSeatMetricsMap,
  getOccupiedSeatCount,
  getTicketById,
  InvalidPurchaseInputError,
  InvalidPurchaseRequestError,
  listTicketsByUser,
  purchaseTicket,
  SoldOutError,
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

describe('F03 — Motor de Compras, Concorrência e Gateway Simulado', () => {
  beforeAll(async () => {
    await setupTestDb();
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
    await teardownTestDb();
  });

  it('validates default gateway timing values in env.ts and card resolution rules (R08)', () => {
    delete process.env['GATEWAY_FAST_MIN_MS'];
    delete process.env['GATEWAY_FAST_MAX_MS'];
    delete process.env['GATEWAY_SLOW_MIN_MS'];
    delete process.env['GATEWAY_SLOW_MAX_MS'];

    expect(env.GATEWAY_FAST_MIN_MS).toBe(2000);
    expect(env.GATEWAY_FAST_MAX_MS).toBe(5000);
    expect(env.GATEWAY_SLOW_MIN_MS).toBe(30000);
    expect(env.GATEWAY_SLOW_MAX_MS).toBe(40000);

    const defaults = getGatewayTimingConfig();
    expect(defaults).toEqual({
      fastMinMs: 2000,
      fastMaxMs: 5000,
      slowMinMs: 30000,
      slowMaxMs: 40000,
    });

    expect(isValidCardNumber('4111111111110001')).toBe(true);
    expect(isValidCardNumber('1234')).toBe(false);
    expect(isValidCardNumber('411111111111000a')).toBe(false);
    expect(isValidCardNumber('41111111111100012')).toBe(false);
    expect(isValidCardNumber('4111 1111 1111 0001')).toBe(false);
    expect(isValidCardNumber('')).toBe(false);

    expect(resolveGatewayBehavior('4111111111110001', defaults)).toEqual({
      outcome: 'confirmed',
      tier: 'fast',
      minMs: 2000,
      maxMs: 5000,
    });
    expect(resolveGatewayBehavior('4111111111110002', defaults)).toEqual({
      outcome: 'declined',
      tier: 'fast',
      minMs: 2000,
      maxMs: 5000,
    });
    expect(resolveGatewayBehavior('4111111111110003', defaults)).toEqual({
      outcome: 'confirmed',
      tier: 'slow',
      minMs: 30000,
      maxMs: 40000,
    });
    expect(resolveGatewayBehavior('4111111111110004', defaults)).toEqual({
      outcome: 'declined',
      tier: 'slow',
      minMs: 30000,
      maxMs: 40000,
    });
    expect(resolveGatewayBehavior('4111111111119999', defaults)).toEqual({
      outcome: 'declined',
      tier: 'fast',
      minMs: 2000,
      maxMs: 5000,
    });
  });

  it('F03-AC1 & CF-02 (R05, R06, R09): purchases immediately in pending, links optional userId, and computes seat metrics', async () => {
    const draft = await createEvent('usr_org_a', {
      name: 'Show F03 Immediate',
      startsAt: FUTURE_STARTS_AT,
      location: 'Teatro Central',
      capacity: 5,
      price: '100,00',
    });
    const published = await publishEvent('usr_org_a', draft.id);

    const startedAt = Date.now();
    const ticket = await purchaseTicket({
      eventId: published.id,
      buyerEmail: 'Participante@Catraca.local ',
      cardNumber: '4111111111110003',
      userId: 'usr_part_seed',
      channel: 'storefront',
    });
    const elapsedMs = Date.now() - startedAt;

    // Must return immediately without awaiting the slow (300-400ms in test) gateway.
    expect(elapsedMs).toBeLessThan(250);
    expect(ticket.id).toMatch(/^tkt_[a-f0-9]+$/);
    expect(ticket.ticketId).toBe(ticket.id);
    expect(ticket.status).toBe('pending');
    expect(ticket.priceCents).toBe(10000);
    expect(ticket.userId).toBe('usr_part_seed');
    expect(ticket.buyerEmail).toBe('participante@catraca.local');
    expect(ticket.checkedIn).toBe(false);
    expect(ticket.channel).toBe('storefront');
    expect(ticket.code).toMatch(/^[A-Z0-9]{8}$/);

    const metricsAfterOne = await getEventSeatMetrics(published.id);
    expect(metricsAfterOne).toEqual({
      capacity: 5,
      occupied: 1,
      available: 4,
    });

    const partnerTicket = await purchaseTicket({
      eventId: published.id,
      buyerEmail: 'parceiro@cliente.com',
      cardNumber: '4111111111110001',
      channel: 'partner_api',
    });
    expect(partnerTicket.userId).toBeNull();
    expect(partnerTicket.channel).toBe('partner_api');

    const stored = await getTicketById(ticket.id);
    expect(stored?.id).toBe(ticket.id);
    expect(stored?.userId).toBe('usr_part_seed');

    const userTickets = await listTicketsByUser('usr_part_seed');
    expect(userTickets).toHaveLength(1);
    expect(userTickets[0]?.id).toBe(ticket.id);

    // Non-existent event returns null metrics
    expect(await getEventSeatMetrics('evt_does_not_exist')).toBeNull();

    // Cancelled event must report available = 0 even with free capacity (R05)
    const cancelledDraft = await createEvent('usr_org_a', {
      name: 'Evento Cancelado Métricas',
      startsAt: FUTURE_STARTS_AT,
      location: 'Sala B',
      capacity: 10,
      price: '50,00',
    });
    await db
      .update(events)
      .set({ status: 'cancelled' })
      .where(eq(events.id, cancelledDraft.id));

    expect(await getEventSeatMetrics(cancelledDraft.id)).toEqual({
      capacity: 10,
      occupied: 0,
      available: 0,
    });

    const metricsMap = await getEventSeatMetricsMap([
      published.id,
      cancelledDraft.id,
      'evt_missing',
    ]);
    expect(metricsMap.get(published.id)).toEqual({
      capacity: 5,
      occupied: 2,
      available: 3,
    });
    expect(metricsMap.get(cancelledDraft.id)).toEqual({
      capacity: 10,
      occupied: 0,
      available: 0,
    });
    expect(metricsMap.has('evt_missing')).toBe(false);

    await waitForPendingGatewayJobs();
  });

  it('F03-AC4 & CF-03 (R02, R03): rejects draft/missing/cancelled events, freezes price, and blocks capacity reduction below occupied', async () => {
    await expect(
      purchaseTicket({
        eventId: 'evt_missing',
        buyerEmail: 'a@b.com',
        cardNumber: '4111111111110001',
        channel: 'storefront',
      }),
    ).rejects.toBeInstanceOf(EventNotAvailableError);

    const draft = await createEvent('usr_org_a', {
      name: 'Workshop CF03',
      startsAt: FUTURE_STARTS_AT,
      location: 'Auditório Principal',
      capacity: 5,
      price: '100,00',
    });

    await expect(
      purchaseTicket({
        eventId: draft.id,
        buyerEmail: 'a@b.com',
        cardNumber: '4111111111110001',
        channel: 'storefront',
      }),
    ).rejects.toBeInstanceOf(EventNotAvailableError);

    await publishEvent('usr_org_a', draft.id);

    const t1 = await purchaseTicket({
      eventId: draft.id,
      buyerEmail: 'buyer1@catraca.local',
      cardNumber: '4111111111110001',
      channel: 'storefront',
    });
    const t2 = await purchaseTicket({
      eventId: draft.id,
      buyerEmail: 'buyer2@catraca.local',
      cardNumber: '4111111111110001',
      channel: 'partner_api',
    });

    expect(t1.priceCents).toBe(10000);
    expect(t2.priceCents).toBe(10000);

    // Cannot reduce capacity below 2 occupied seats (R03)
    await expect(
      updateEvent('usr_org_a', draft.id, { capacity: 1 }),
    ).rejects.toBeInstanceOf(EventValidationError);

    // Update price to 150,00 -> old tickets keep 10000, new ticket gets 15000
    await updateEvent('usr_org_a', draft.id, { price: '150,00' });

    const t3 = await purchaseTicket({
      eventId: draft.id,
      buyerEmail: 'buyer3@catraca.local',
      cardNumber: '4111111111110001',
      channel: 'storefront',
    });
    expect(t3.priceCents).toBe(15000);

    await waitForPendingGatewayJobs();

    const dbT1 = await getTicketById(t1.id);
    const dbT2 = await getTicketById(t2.id);
    const dbT3 = await getTicketById(t3.id);
    expect(dbT1?.priceCents).toBe(10000);
    expect(dbT2?.priceCents).toBe(10000);
    expect(dbT3?.priceCents).toBe(15000);

    // Cancelled event rejects purchases
    await db
      .update(events)
      .set({ status: 'cancelled' })
      .where(eq(events.id, draft.id));

    await expect(
      purchaseTicket({
        eventId: draft.id,
        buyerEmail: 'buyer4@catraca.local',
        cardNumber: '4111111111110001',
        channel: 'storefront',
      }),
    ).rejects.toBeInstanceOf(EventNotAvailableError);
  });

  it('F03-AC2 (R07): prevents overselling across 3 rounds of 30 concurrent purchases for capacity 5', async () => {
    for (let round = 1; round <= 3; round += 1) {
      const draft = await createEvent('usr_org_a', {
        name: `Concorrência Rodada ${round}`,
        startsAt: FUTURE_STARTS_AT,
        location: 'Arena Catraca',
        capacity: 5,
        price: '80,00',
      });
      const published = await publishEvent('usr_org_a', draft.id);

      const requests = Array.from({ length: 30 }, (_, idx) =>
        purchaseTicket({
          eventId: published.id,
          buyerEmail: `r${round}_u${idx}@catraca.local`,
          cardNumber: '4111111111110001',
          channel: idx % 2 === 0 ? 'storefront' : 'partner_api',
        }),
      );

      const results = await Promise.allSettled(requests);
      const fulfilled = results.filter((r) => r.status === 'fulfilled');
      const rejected = results.filter((r) => r.status === 'rejected');

      expect(fulfilled).toHaveLength(5);
      expect(rejected).toHaveLength(25);

      for (const failure of rejected) {
        expect(failure.reason).toBeInstanceOf(SoldOutError);
        expect((failure.reason as SoldOutError).code).toBe('sold_out');
      }

      const occupied = await getOccupiedSeatCount(published.id);
      expect(occupied).toBe(5);
      expect(await getEventSeatMetrics(published.id)).toEqual({
        capacity: 5,
        occupied: 5,
        available: 0,
      });

      const [countRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(tickets)
        .where(eq(tickets.eventId, published.id));
      expect(countRow?.count).toBe(5);

      await waitForPendingGatewayJobs();
    }
  });

  it('F03-AC3 (R08): rejects invalid cards/emails pre-transaction and processes all 5 card endings asynchronously', async () => {
    const draft = await createEvent('usr_org_a', {
      name: 'Gateway Scenarios',
      startsAt: FUTURE_STARTS_AT,
      location: 'Palco A',
      capacity: 10,
      price: '120,00',
    });
    const published = await publishEvent('usr_org_a', draft.id);

    const invalidInputs = [
      { cardNumber: '1234', buyerEmail: 'ok@catraca.local' },
      { cardNumber: '123456789012345a', buyerEmail: 'ok@catraca.local' },
      { cardNumber: '12345678901234567', buyerEmail: 'ok@catraca.local' },
      { cardNumber: '4111 1111 1111 0001', buyerEmail: 'ok@catraca.local' },
      { cardNumber: '', buyerEmail: 'ok@catraca.local' },
      { cardNumber: '4111111111110001', buyerEmail: 'invalid-email' },
      { cardNumber: '4111111111110001', buyerEmail: '' },
    ];

    for (const bad of invalidInputs) {
      await expect(
        purchaseTicket({
          eventId: published.id,
          buyerEmail: bad.buyerEmail,
          cardNumber: bad.cardNumber,
          channel: 'storefront',
        }),
      ).rejects.toBeInstanceOf(InvalidPurchaseRequestError);
      await expect(
        purchaseTicket({
          eventId: published.id,
          buyerEmail: bad.buyerEmail,
          cardNumber: bad.cardNumber,
          channel: 'storefront',
        }),
      ).rejects.toBeInstanceOf(InvalidPurchaseInputError);
    }

    expect(await getOccupiedSeatCount(published.id)).toBe(0);

    // Test all 5 card endings
    const t0001 = await purchaseTicket({
      eventId: published.id,
      buyerEmail: 'c1@catraca.local',
      cardNumber: '4111111111110001',
      channel: 'storefront',
    });
    const t0002 = await purchaseTicket({
      eventId: published.id,
      buyerEmail: 'c2@catraca.local',
      cardNumber: '4111111111110002',
      channel: 'storefront',
    });
    const t0003 = await purchaseTicket({
      eventId: published.id,
      buyerEmail: 'c3@catraca.local',
      cardNumber: '4111111111110003',
      channel: 'storefront',
    });
    const t0004 = await purchaseTicket({
      eventId: published.id,
      buyerEmail: 'c4@catraca.local',
      cardNumber: '4111111111110004',
      channel: 'storefront',
    });
    const t9999 = await purchaseTicket({
      eventId: published.id,
      buyerEmail: 'c5@catraca.local',
      cardNumber: '4111111111119999',
      channel: 'partner_api',
    });

    await waitForPendingGatewayJobs();

    expect((await getTicketById(t0001.id))?.status).toBe('confirmed');
    expect((await getTicketById(t0002.id))?.status).toBe('declined');
    expect((await getTicketById(t0003.id))?.status).toBe('confirmed');
    expect((await getTicketById(t0004.id))?.status).toBe('declined');
    expect((await getTicketById(t9999.id))?.status).toBe('declined');

    // Only the 2 confirmed tickets remain occupying seats
    expect(await getEventSeatMetrics(published.id)).toEqual({
      capacity: 10,
      occupied: 2,
      available: 8,
    });

    // Verify declined frees seat on capacity = 1 event
    const singleDraft = await createEvent('usr_org_a', {
      name: 'Lotação 1 Liberação',
      startsAt: FUTURE_STARTS_AT,
      location: 'Cabine',
      capacity: 1,
      price: '50,00',
    });
    const single = await publishEvent('usr_org_a', singleDraft.id);

    const declinedFirst = await purchaseTicket({
      eventId: single.id,
      buyerEmail: 'first@catraca.local',
      cardNumber: '4111111111110002',
      channel: 'storefront',
    });
    expect(declinedFirst.status).toBe('pending');
    expect(await getEventSeatMetrics(single.id)).toEqual({
      capacity: 1,
      occupied: 1,
      available: 0,
    });

    await expect(
      purchaseTicket({
        eventId: single.id,
        buyerEmail: 'blocked@catraca.local',
        cardNumber: '4111111111110001',
        channel: 'storefront',
      }),
    ).rejects.toBeInstanceOf(SoldOutError);

    await waitForPendingGatewayJobs();
    expect((await getTicketById(declinedFirst.id))?.status).toBe('declined');
    expect(await getEventSeatMetrics(single.id)).toEqual({
      capacity: 1,
      occupied: 0,
      available: 1,
    });

    const secondSuccess = await purchaseTicket({
      eventId: single.id,
      buyerEmail: 'second@catraca.local',
      cardNumber: '4111111111110001',
      channel: 'storefront',
    });
    await waitForPendingGatewayJobs();
    expect((await getTicketById(secondSuccess.id))?.status).toBe('confirmed');
  });

  it('R11: atomic gateway guard never overwrites cancelled ticket or cancelled event on late callback', async () => {
    const draft = await createEvent('usr_org_a', {
      name: 'Evento Cancelamento Tardio',
      startsAt: FUTURE_STARTS_AT,
      location: 'Auditório',
      capacity: 5,
      price: '90,00',
    });
    const published = await publishEvent('usr_org_a', draft.id);

    // Purchase with slow approval card 0003 (300-400ms in test env)
    const slowTicket = await purchaseTicket({
      eventId: published.id,
      buyerEmail: 'slow@catraca.local',
      cardNumber: '4111111111110003',
      channel: 'storefront',
    });
    expect(slowTicket.status).toBe('pending');

    // Cancel event and ticket before the slow gateway callback fires
    await db
      .update(events)
      .set({ status: 'cancelled' })
      .where(eq(events.id, published.id));
    await db
      .update(tickets)
      .set({ status: 'cancelled' })
      .where(eq(tickets.id, slowTicket.id));

    await waitForPendingGatewayJobs();

    const afterCallback = await getTicketById(slowTicket.id);
    expect(afterCallback?.status).toBe('cancelled');

    // Also verify applyGatewayOutcome rejects a pending ticket if its event is cancelled
    const draft2 = await createEvent('usr_org_a', {
      name: 'Evento Cancelado Pending',
      startsAt: FUTURE_STARTS_AT,
      location: 'Sala 2',
      capacity: 5,
      price: '90,00',
    });
    const pub2 = await publishEvent('usr_org_a', draft2.id);
    const pendingTicket = await purchaseTicket({
      eventId: pub2.id,
      buyerEmail: 'pending@catraca.local',
      cardNumber: '4111111111110003',
      channel: 'partner_api',
    });
    cancelPendingTimers();

    await db
      .update(events)
      .set({ status: 'cancelled' })
      .where(eq(events.id, pub2.id));

    const applied = await applyGatewayOutcome(pendingTicket.id, 'confirmed');
    expect(applied).toBe(false);
    expect((await getTicketById(pendingTicket.id))?.status).toBe('pending');
  });

  it('F03-AC5 (R09): enforces UNIQUE constraint on tickets.code and generates unique 8-char uppercase alphanumeric codes', async () => {
    const constraintResult = await pool.query<{ conname: string; contype: string }>(
      `SELECT conname, contype
       FROM pg_constraint
       WHERE conrelid = 'tickets'::regclass AND contype = 'u'`,
    );
    expect(constraintResult.rows.length).toBeGreaterThanOrEqual(1);

    for (let i = 0; i < 20; i += 1) {
      expect(generateTicketCode()).toMatch(/^[A-Z0-9]{8}$/);
    }

    const draft = await createEvent('usr_org_a', {
      name: 'Códigos Únicos',
      startsAt: FUTURE_STARTS_AT,
      location: 'Arena',
      capacity: 30,
      price: '60,00',
    });
    const published = await publishEvent('usr_org_a', draft.id);

    const issued = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        purchaseTicket({
          eventId: published.id,
          buyerEmail: `code${i}@catraca.local`,
          cardNumber: '4111111111110001',
          channel: 'storefront',
        }),
      ),
    );

    const codes = issued.map((t) => t.code);
    for (const code of codes) {
      expect(code).toMatch(/^[A-Z0-9]{8}$/);
    }
    expect(new Set(codes).size).toBe(20);

    await waitForPendingGatewayJobs();
  });
});
