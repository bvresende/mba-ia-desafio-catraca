import { eq, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { events, tickets, type EventStatus } from '../../db/schema.js';
import type { DbExecutor } from '../purchases/purchase.service.js';

export interface EventDashboardMetrics {
  readonly eventId: string;
  readonly eventStatus: EventStatus;
  readonly capacity: number;
  readonly confirmedCount: number;
  readonly pendingCount: number;
  readonly checkedInCount: number;
  readonly availableSeats: number;
  readonly revenueCents: number;
  readonly revenueFormatted: string;
  readonly refundedCount: number;
}

/**
 * Formats integer cents in BRL using a regular ASCII space after `R$`
 * (e.g. `R$ 0,00`, `R$ 350,00`, `R$ 1.250,50`) to avoid ICU NBSP differences.
 */
export function formatCurrencyBRL(cents: number): string {
  const safeCents = Number.isFinite(cents) ? Math.trunc(cents) : 0;
  const negative = safeCents < 0;
  const abs = Math.abs(safeCents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, '0');
  const wholeFormatted = whole
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}R$ ${wholeFormatted},${frac}`;
}

/**
 * Aggregates consolidated dashboard metrics (R03, R05, R12) across all
 * purchase channels (`storefront` and `partner_api`) for a single event.
 */
export async function getEventDashboardMetrics(
  eventId: string,
  executor: DbExecutor = db,
): Promise<EventDashboardMetrics | null> {
  const [event] = await executor
    .select({
      id: events.id,
      capacity: events.capacity,
      status: events.status,
    })
    .from(events)
    .where(eq(events.id, eventId))
    .limit(1);

  if (!event) {
    return null;
  }

  const [agg] = await executor
    .select({
      confirmedCount: sql<number>`count(*) filter (where ${tickets.status} = 'confirmed')::int`,
      pendingCount: sql<number>`count(*) filter (where ${tickets.status} = 'pending')::int`,
      checkedInCount: sql<number>`count(*) filter (where ${tickets.status} = 'confirmed' and ${tickets.checkedIn} = true)::int`,
      revenueCents: sql<string>`coalesce(sum(${tickets.priceCents}) filter (where ${tickets.status} = 'confirmed'), 0)::bigint`,
      refundedCount: sql<number>`count(*) filter (where ${tickets.status} = 'refunded')::int`,
    })
    .from(tickets)
    .where(eq(tickets.eventId, event.id));

  const confirmedCount = Number(agg?.confirmedCount ?? 0);
  const pendingCount = Number(agg?.pendingCount ?? 0);
  const checkedInCount = Number(agg?.checkedInCount ?? 0);
  const revenueCents = Number(agg?.revenueCents ?? 0);
  const refundedCount = Number(agg?.refundedCount ?? 0);

  const availableSeats =
    event.status === 'cancelled'
      ? 0
      : Math.max(0, event.capacity - (confirmedCount + pendingCount));

  return {
    eventId: event.id,
    eventStatus: event.status,
    capacity: event.capacity,
    confirmedCount,
    pendingCount,
    checkedInCount,
    availableSeats,
    revenueCents,
    revenueFormatted: formatCurrencyBRL(revenueCents),
    refundedCount,
  };
}
