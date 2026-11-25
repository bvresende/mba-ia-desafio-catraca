import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { events, tickets, type Event } from '../../db/schema.js';
import {
  EventForbiddenError,
  EventNotFoundError,
  EventStateError,
} from '../events/events.service.js';

export interface CancellationSummary {
  readonly event: Event;
  readonly refundedCount: number;
  readonly cancelledCount: number;
}

/**
 * Irreversibly cancels a published event inside a single PostgreSQL
 * transaction (`R11`), acquiring `SELECT ... FOR UPDATE` on the event row
 * (serializing with `purchaseTicket`), transitioning `confirmed` tickets to
 * `refunded` and `pending` tickets to `cancelled` while leaving `declined`
 * and `checked_in` flags untouched.
 */
export async function cancelEvent(
  ownerId: string,
  eventId: string,
): Promise<CancellationSummary> {
  return db.transaction(async (tx) => {
    const [lockedEvent] = await tx
      .select()
      .from(events)
      .where(eq(events.id, eventId))
      .for('update');

    if (!lockedEvent) {
      throw new EventNotFoundError();
    }

    if (lockedEvent.ownerId !== ownerId) {
      throw new EventForbiddenError();
    }

    if (lockedEvent.status === 'cancelled') {
      throw new EventStateError('Este evento já foi cancelado.');
    }

    if (lockedEvent.status !== 'published') {
      throw new EventStateError(
        'Apenas eventos publicados podem ser cancelados.',
      );
    }

    const [updatedEvent] = await tx
      .update(events)
      .set({
        status: 'cancelled',
        updatedAt: sql`NOW()`,
      })
      .where(eq(events.id, lockedEvent.id))
      .returning();

    if (!updatedEvent) {
      throw new Error('Falha ao cancelar evento no banco de dados.');
    }

    const refundedRows = await tx
      .update(tickets)
      .set({
        status: 'refunded',
        updatedAt: sql`NOW()`,
      })
      .where(
        and(
          eq(tickets.eventId, lockedEvent.id),
          eq(tickets.status, 'confirmed'),
        ),
      )
      .returning({ id: tickets.id });

    const cancelledRows = await tx
      .update(tickets)
      .set({
        status: 'cancelled',
        updatedAt: sql`NOW()`,
      })
      .where(
        and(
          eq(tickets.eventId, lockedEvent.id),
          eq(tickets.status, 'pending'),
        ),
      )
      .returning({ id: tickets.id });

    return {
      event: updatedEvent,
      refundedCount: refundedRows.length,
      cancelledCount: cancelledRows.length,
    };
  });
}
