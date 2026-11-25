import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { env } from '../../config/env.js';
import { listPublishedEvents } from '../events/events.service.js';
import { isValidCardNumber } from '../purchases/gateway.service.js';
import {
  EventNotAvailableError,
  getEventSeatMetricsMap,
  getTicketById,
  InvalidPurchaseRequestError,
  purchaseTicket,
  SoldOutError,
} from '../purchases/purchase.service.js';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface ValidPartnerPurchaseBody {
  readonly buyerEmail: string;
  readonly cardNumber: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidPartnerApiKey(
  headerValue: string | string[] | undefined,
): boolean {
  if (typeof headerValue !== 'string' || headerValue.length === 0) {
    return false;
  }

  const expected = env.PARTNER_API_KEY;
  if (expected.length === 0) {
    return false;
  }

  const providedBuffer = Buffer.from(headerValue, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(providedBuffer, expectedBuffer);
}

function parsePartnerPurchaseBody(
  body: unknown,
): ValidPartnerPurchaseBody | null {
  if (!isPlainObject(body)) {
    return null;
  }

  const rawEmail = body['buyerEmail'];
  const rawCardNumber = body['cardNumber'];

  if (typeof rawEmail !== 'string') {
    return null;
  }
  const buyerEmail = rawEmail.trim();
  if (buyerEmail.length === 0 || !EMAIL_PATTERN.test(buyerEmail)) {
    return null;
  }

  if (typeof rawCardNumber !== 'string' || !isValidCardNumber(rawCardNumber)) {
    return null;
  }

  return {
    buyerEmail,
    cardNumber: rawCardNumber,
  };
}

export async function partnerRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (request, reply) => {
    if (!isValidPartnerApiKey(request.headers['x-api-key'])) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
  });

  app.setErrorHandler((error, request, reply) => {
    const err = error as { code?: unknown; statusCode?: unknown };
    const code = typeof err.code === 'string' ? err.code : '';
    const statusCode = typeof err.statusCode === 'number' ? err.statusCode : 500;

    if (
      code.startsWith('FST_ERR_CTP_') ||
      statusCode === 400 ||
      statusCode === 415
    ) {
      return reply.code(422).send({ error: 'invalid_request' });
    }

    request.log.error(error);
    return reply.code(500).send({ error: 'internal_server_error' });
  });

  app.get('/events', async (_request, reply) => {
    const publishedEvents = await listPublishedEvents();
    const metricsMap = await getEventSeatMetricsMap(
      publishedEvents.map((event) => event.id),
    );

    const payload = publishedEvents.map((event) => {
      const metrics = metricsMap.get(event.id);
      return {
        id: event.id,
        name: event.name,
        startsAt: event.startsAt.toISOString(),
        priceCents: event.priceCents,
        availableSeats: metrics ? metrics.available : event.capacity,
      };
    });

    return reply.code(200).send(payload);
  });

  app.post<{ Params: { eventId: string } }>(
    '/events/:eventId/purchases',
    async (request, reply) => {
      const parsedBody = parsePartnerPurchaseBody(request.body);
      if (!parsedBody) {
        return reply.code(422).send({ error: 'invalid_request' });
      }

      const eventId =
        typeof request.params.eventId === 'string'
          ? request.params.eventId.trim()
          : '';
      if (eventId.length === 0) {
        return reply.code(404).send({ error: 'event_not_available' });
      }

      try {
        const ticket = await purchaseTicket({
          eventId,
          buyerEmail: parsedBody.buyerEmail,
          cardNumber: parsedBody.cardNumber,
          userId: null,
          channel: 'partner_api',
        });

        return reply.code(202).send({
          ticketId: ticket.id,
          code: ticket.code,
          status: ticket.status,
        });
      } catch (err) {
        if (err instanceof InvalidPurchaseRequestError) {
          return reply.code(422).send({ error: 'invalid_request' });
        }
        if (err instanceof EventNotAvailableError) {
          return reply.code(404).send({ error: 'event_not_available' });
        }
        if (err instanceof SoldOutError) {
          return reply.code(409).send({ error: 'sold_out' });
        }
        throw err;
      }
    },
  );

  app.get<{ Params: { ticketId: string } }>(
    '/tickets/:ticketId',
    async (request, reply) => {
      const ticketId =
        typeof request.params.ticketId === 'string'
          ? request.params.ticketId.trim()
          : '';
      if (ticketId.length === 0) {
        return reply.code(404).send({ error: 'ticket_not_found' });
      }

      const ticket = await getTicketById(ticketId);
      if (!ticket) {
        return reply.code(404).send({ error: 'ticket_not_found' });
      }

      return reply.code(200).send({
        ticketId: ticket.id,
        code: ticket.code,
        eventId: ticket.eventId,
        status: ticket.status,
        checkedIn: ticket.checkedIn,
      });
    },
  );
}
