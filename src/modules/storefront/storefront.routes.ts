import type { FastifyInstance } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import { db } from '../../db/client.js';
import { events, tickets } from '../../db/schema.js';
import {
  renderMyTicketsPage,
  renderStorefrontPage,
  type ParticipantTicketItem,
  type StorefrontEventItem,
} from '../../views/storefront.views.js';
import { requireParticipant } from '../auth/auth.middleware.js';
import { listPublishedEvents } from '../events/events.service.js';
import {
  EventNotAvailableError,
  getEventSeatMetricsMap,
  InvalidPurchaseRequestError,
  purchaseTicket,
  SoldOutError,
} from '../purchases/purchase.service.js';

async function loadStorefrontEvents(): Promise<StorefrontEventItem[]> {
  const publishedEvents = await listPublishedEvents();
  const metricsMap = await getEventSeatMetricsMap(
    publishedEvents.map((evt) => evt.id),
  );

  return publishedEvents.map((evt) => ({
    id: evt.id,
    name: evt.name,
    startsAt: evt.startsAt,
    location: evt.location,
    priceCents: evt.priceCents,
    capacity: evt.capacity,
    availableSeats: metricsMap.get(evt.id)?.available ?? 0,
  }));
}

function resolveQueryErrorMessage(errorParam: unknown): string | undefined {
  if (errorParam === 'sold_out') {
    return 'Ingressos esgotados';
  }
  if (errorParam === 'invalid_request') {
    return 'Número de cartão inválido. Informe exatamente 16 dígitos numéricos.';
  }
  if (errorParam === 'event_not_available') {
    return 'Evento não disponível para compra.';
  }
  return undefined;
}

export async function storefrontRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', async (request, reply) => {
    const query = (request.query ?? {}) as Record<string, unknown>;
    const eventsList = await loadStorefrontEvents();
    const errorMessage = resolveQueryErrorMessage(query['error']);

    return reply
      .code(200)
      .type('text/html; charset=utf-8')
      .send(
        renderStorefrontPage({
          currentUser: request.currentUser,
          events: eventsList,
          errorMessage,
        }),
      );
  });

  app.post<{ Params: { eventId: string } }>(
    '/events/:eventId/purchase',
    { preHandler: requireParticipant },
    async (request, reply) => {
      const user = request.currentUser!;
      const { eventId } = request.params;
      const body = (request.body ?? {}) as Record<string, unknown>;
      const rawCardNumber = body['cardNumber'];
      const cardNumber =
        typeof rawCardNumber === 'string' ? rawCardNumber.trim() : '';

      try {
        await purchaseTicket({
          eventId,
          buyerEmail: user.email,
          cardNumber,
          userId: user.id,
          channel: 'storefront',
        });

        return reply.redirect('/my-tickets');
      } catch (err) {
        if (err instanceof SoldOutError) {
          const eventsList = await loadStorefrontEvents();
          return reply
            .code(409)
            .type('text/html; charset=utf-8')
            .send(
              renderStorefrontPage({
                currentUser: user,
                events: eventsList,
                errorMessage: 'Ingressos esgotados',
                errorEventId: eventId,
              }),
            );
        }

        if (err instanceof InvalidPurchaseRequestError) {
          const eventsList = await loadStorefrontEvents();
          return reply
            .code(400)
            .type('text/html; charset=utf-8')
            .send(
              renderStorefrontPage({
                currentUser: user,
                events: eventsList,
                errorMessage: err.message,
                errorEventId: eventId,
              }),
            );
        }

        if (err instanceof EventNotAvailableError) {
          const eventsList = await loadStorefrontEvents();
          return reply
            .code(404)
            .type('text/html; charset=utf-8')
            .send(
              renderStorefrontPage({
                currentUser: user,
                events: eventsList,
                errorMessage: 'Evento não disponível para compra.',
                errorEventId: eventId,
              }),
            );
        }

        throw err;
      }
    },
  );

  app.get(
    '/my-tickets',
    { preHandler: requireParticipant },
    async (request, reply) => {
      const user = request.currentUser!;

      const rows: ParticipantTicketItem[] = await db
        .select({
          id: tickets.id,
          eventId: tickets.eventId,
          eventName: events.name,
          eventStartsAt: events.startsAt,
          eventLocation: events.location,
          code: tickets.code,
          priceCents: tickets.priceCents,
          status: tickets.status,
          createdAt: tickets.createdAt,
        })
        .from(tickets)
        .innerJoin(events, eq(tickets.eventId, events.id))
        .where(eq(tickets.userId, user.id))
        .orderBy(desc(tickets.createdAt));

      return reply
        .code(200)
        .type('text/html; charset=utf-8')
        .send(
          renderMyTicketsPage({
            currentUser: user,
            tickets: rows,
          }),
        );
    },
  );
}
