import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Event } from '../../db/schema.js';
import { requireOrganizer } from '../auth/auth.middleware.js';
import {
  renderOrganizerAccessErrorPage,
  renderOrganizerEventManagePage,
  renderOrganizerEventsListPage,
  renderOrganizerNewEventPage,
  type EventFormValues,
  type OrganizerEventManageSections,
} from '../../views/organizer.views.js';
import {
  createEvent,
  EventForbiddenError,
  EventNotFoundError,
  EventStateError,
  EventValidationError,
  getOccupiedSeatCount,
  getOrganizerEventOrThrow,
  listOrganizerEvents,
  publishEvent,
  updateEvent,
} from './events.service.js';

export type OrganizerEventSectionLoader = (
  event: Event,
  context: {
    readonly occupiedSeats: number;
    readonly request: FastifyRequest;
  },
) => Promise<OrganizerEventManageSections> | OrganizerEventManageSections;

export interface EventsRoutesOptions {
  readonly sectionLoaders?: readonly OrganizerEventSectionLoader[];
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function extractFormValues(body: Record<string, unknown>): EventFormValues {
  return {
    name: typeof body['name'] === 'string' ? body['name'] : undefined,
    startsAt:
      typeof body['startsAt'] === 'string' ? body['startsAt'] : undefined,
    location:
      typeof body['location'] === 'string' ? body['location'] : undefined,
    capacity:
      typeof body['capacity'] === 'string' ? body['capacity'] : undefined,
    price: typeof body['price'] === 'string' ? body['price'] : undefined,
  };
}

async function resolveSections(
  loaders: readonly OrganizerEventSectionLoader[],
  event: Event,
  occupiedSeats: number,
  request: FastifyRequest,
): Promise<OrganizerEventManageSections> {
  if (loaders.length === 0) {
    return {};
  }

  let dashboardHtml: string | undefined;
  let checkinHtml: string | undefined;
  let cancelHtml: string | undefined;

  for (const loader of loaders) {
    const partial = await loader(event, { occupiedSeats, request });
    if (partial.dashboardHtml !== undefined) {
      dashboardHtml = partial.dashboardHtml;
    }
    if (partial.checkinHtml !== undefined) {
      checkinHtml = partial.checkinHtml;
    }
    if (partial.cancelHtml !== undefined) {
      cancelHtml = partial.cancelHtml;
    }
  }

  return { dashboardHtml, checkinHtml, cancelHtml };
}

function handleOwnershipError(
  error: unknown,
  request: FastifyRequest,
  reply: FastifyReply,
): boolean {
  const user = request.currentUser!;
  if (error instanceof EventNotFoundError) {
    reply
      .code(404)
      .type('text/html; charset=utf-8')
      .send(
        renderOrganizerAccessErrorPage(
          user,
          'Evento não encontrado',
          'O evento solicitado não foi encontrado.',
        ),
      );
    return true;
  }

  if (error instanceof EventForbiddenError) {
    reply
      .code(403)
      .type('text/html; charset=utf-8')
      .send(
        renderOrganizerAccessErrorPage(
          user,
          'Acesso negado',
          'Você não tem permissão para acessar este evento.',
        ),
      );
    return true;
  }

  return false;
}

export async function eventsRoutes(
  app: FastifyInstance,
  options: EventsRoutesOptions = {},
): Promise<void> {
  const sectionLoaders = options.sectionLoaders ?? [];

  app.get(
    '/organizer/events',
    { preHandler: requireOrganizer },
    async (request, reply) => {
      const organizer = request.currentUser!;
      const eventsList = await listOrganizerEvents(organizer.id);

      return reply
        .type('text/html; charset=utf-8')
        .send(renderOrganizerEventsListPage(organizer, eventsList));
    },
  );

  app.get(
    '/organizer/events/new',
    { preHandler: requireOrganizer },
    async (request, reply) => {
      const organizer = request.currentUser!;
      return reply
        .type('text/html; charset=utf-8')
        .send(renderOrganizerNewEventPage(organizer));
    },
  );

  app.post(
    '/organizer/events',
    { preHandler: requireOrganizer },
    async (request, reply) => {
      const organizer = request.currentUser!;
      const body = (request.body ?? {}) as Record<string, unknown>;

      try {
        const created = await createEvent(organizer.id, {
          name: body['name'],
          startsAt: body['startsAt'],
          location: body['location'],
          capacity: body['capacity'],
          price: body['price'],
        });

        return reply.redirect(`/organizer/events/${created.id}`);
      } catch (err) {
        if (err instanceof EventValidationError) {
          return reply
            .code(400)
            .type('text/html; charset=utf-8')
            .send(
              renderOrganizerNewEventPage(
                organizer,
                {
                  name: asString(body['name']),
                  startsAt: asString(body['startsAt']),
                  location: asString(body['location']),
                  capacity: asString(body['capacity']),
                  price: asString(body['price']),
                },
                err.message,
              ),
            );
        }
        throw err;
      }
    },
  );

  app.get<{ Params: { eventId: string } }>(
    '/organizer/events/:eventId',
    { preHandler: requireOrganizer },
    async (request, reply) => {
      const organizer = request.currentUser!;
      const { eventId } = request.params;
      const query = (request.query ?? {}) as Record<string, unknown>;

      try {
        const event = await getOrganizerEventOrThrow(eventId, organizer.id);
        const occupiedSeats = await getOccupiedSeatCount(event.id);
        const sections = await resolveSections(
          sectionLoaders,
          event,
          occupiedSeats,
          request,
        );

        let successMessage: string | undefined;
        if (query['published'] === '1') {
          successMessage = 'Evento publicado com sucesso.';
        } else if (query['saved'] === '1') {
          successMessage = 'Alterações salvas com sucesso.';
        }

        return reply
          .type('text/html; charset=utf-8')
          .send(
            renderOrganizerEventManagePage(organizer, event, {
              occupiedSeats,
              successMessage,
              sections,
            }),
          );
      } catch (err) {
        if (handleOwnershipError(err, request, reply)) {
          return;
        }
        throw err;
      }
    },
  );

  app.post<{ Params: { eventId: string } }>(
    '/organizer/events/:eventId/edit',
    { preHandler: requireOrganizer },
    async (request, reply) => {
      const organizer = request.currentUser!;
      const { eventId } = request.params;
      const body = (request.body ?? {}) as Record<string, unknown>;

      try {
        await updateEvent(organizer.id, eventId, {
          name: body['name'],
          startsAt: body['startsAt'],
          location: body['location'],
          capacity: body['capacity'],
          price: body['price'],
        });

        return reply.redirect(`/organizer/events/${eventId}?saved=1`);
      } catch (err) {
        if (handleOwnershipError(err, request, reply)) {
          return;
        }

        if (
          err instanceof EventValidationError ||
          err instanceof EventStateError
        ) {
          const event = await getOrganizerEventOrThrow(eventId, organizer.id);
          const occupiedSeats = await getOccupiedSeatCount(event.id);
          const sections = await resolveSections(
            sectionLoaders,
            event,
            occupiedSeats,
            request,
          );
          const statusCode = err instanceof EventStateError ? 409 : 400;

          return reply
            .code(statusCode)
            .type('text/html; charset=utf-8')
            .send(
              renderOrganizerEventManagePage(organizer, event, {
                occupiedSeats,
                error: err.message,
                formValues: extractFormValues(body),
                sections,
              }),
            );
        }

        throw err;
      }
    },
  );

  app.post<{ Params: { eventId: string } }>(
    '/organizer/events/:eventId/publish',
    { preHandler: requireOrganizer },
    async (request, reply) => {
      const organizer = request.currentUser!;
      const { eventId } = request.params;

      try {
        await publishEvent(organizer.id, eventId);
        return reply.redirect(`/organizer/events/${eventId}?published=1`);
      } catch (err) {
        if (handleOwnershipError(err, request, reply)) {
          return;
        }

        if (err instanceof EventStateError) {
          const event = await getOrganizerEventOrThrow(eventId, organizer.id);
          const occupiedSeats = await getOccupiedSeatCount(event.id);
          const sections = await resolveSections(
            sectionLoaders,
            event,
            occupiedSeats,
            request,
          );

          return reply
            .code(409)
            .type('text/html; charset=utf-8')
            .send(
              renderOrganizerEventManagePage(organizer, event, {
                occupiedSeats,
                error: err.message,
                sections,
              }),
            );
        }

        throw err;
      }
    },
  );
}
