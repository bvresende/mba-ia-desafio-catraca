import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { events, tickets } from '../../db/schema.js';
import { getOrganizerEventOrThrow } from '../events/events.service.js';

export const CHECKIN_MESSAGES = {
  INVALID_TICKET: 'Ingresso inválido para este evento',
  EVENT_CANCELLED: 'Evento cancelado',
  NOT_CONFIRMED: 'Ingresso não confirmado',
  ALREADY_USED: 'Ingresso já utilizado',
  ALLOWED: 'Entrada liberada',
} as const;

export type CheckInMessage =
  (typeof CHECKIN_MESSAGES)[keyof typeof CHECKIN_MESSAGES];

export interface CheckInResult {
  readonly ok: boolean;
  readonly message: CheckInMessage;
  readonly ticketId?: string;
}

/**
 * Validates ownership (R13) and executes ticket check-in following the
 * strict R10 precedence order:
 * 1. Code missing, not found, or belongs to another event -> `Ingresso inválido para este evento`
 * 2. Event is cancelled -> `Evento cancelado`
 * 3. Ticket status is not `confirmed` -> `Ingresso não confirmado`
 * 4. Ticket already checked in -> `Ingresso já utilizado`
 * 5. Atomic update sets `checked_in = true` (leaving `status = 'confirmed'`) -> `Entrada liberada`
 */
export async function performCheckIn(
  ownerId: string,
  eventId: string,
  rawCode: string,
): Promise<CheckInResult> {
  const event = await getOrganizerEventOrThrow(eventId, ownerId);

  const code = typeof rawCode === 'string' ? rawCode.trim().toUpperCase() : '';
  if (code.length === 0) {
    return {
      ok: false,
      message: CHECKIN_MESSAGES.INVALID_TICKET,
    };
  }

  const [ticket] = await db
    .select()
    .from(tickets)
    .where(eq(tickets.code, code))
    .limit(1);

  if (!ticket || ticket.eventId !== event.id) {
    return {
      ok: false,
      message: CHECKIN_MESSAGES.INVALID_TICKET,
    };
  }

  if (event.status === 'cancelled') {
    return {
      ok: false,
      message: CHECKIN_MESSAGES.EVENT_CANCELLED,
    };
  }

  if (ticket.status !== 'confirmed') {
    return {
      ok: false,
      message: CHECKIN_MESSAGES.NOT_CONFIRMED,
    };
  }

  if (ticket.checkedIn) {
    return {
      ok: false,
      message: CHECKIN_MESSAGES.ALREADY_USED,
    };
  }

  const [updated] = await db
    .update(tickets)
    .set({
      checkedIn: true,
      checkedInAt: sql`NOW()`,
      updatedAt: sql`NOW()`,
    })
    .where(
      and(
        eq(tickets.id, ticket.id),
        eq(tickets.eventId, event.id),
        eq(tickets.status, 'confirmed'),
        eq(tickets.checkedIn, false),
      ),
    )
    .returning({ id: tickets.id });

  if (updated) {
    return {
      ok: true,
      message: CHECKIN_MESSAGES.ALLOWED,
      ticketId: updated.id,
    };
  }

  // Re-evaluate state if a concurrent request or cancellation won the race.
  const [[freshEvent], [freshTicket]] = await Promise.all([
    db
      .select({ status: events.status })
      .from(events)
      .where(eq(events.id, event.id))
      .limit(1),
    db
      .select({ eventId: tickets.eventId, status: tickets.status, checkedIn: tickets.checkedIn })
      .from(tickets)
      .where(eq(tickets.id, ticket.id))
      .limit(1),
  ]);

  if (!freshTicket || freshTicket.eventId !== event.id) {
    return {
      ok: false,
      message: CHECKIN_MESSAGES.INVALID_TICKET,
    };
  }

  if (freshEvent?.status === 'cancelled') {
    return {
      ok: false,
      message: CHECKIN_MESSAGES.EVENT_CANCELLED,
    };
  }

  if (freshTicket.status !== 'confirmed') {
    return {
      ok: false,
      message: CHECKIN_MESSAGES.NOT_CONFIRMED,
    };
  }

  return {
    ok: false,
    message: CHECKIN_MESSAGES.ALREADY_USED,
  };
}
