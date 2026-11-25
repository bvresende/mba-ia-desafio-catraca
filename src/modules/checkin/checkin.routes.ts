import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { renderEventCancellationSection } from '../../views/cancellation.views.js';
import {
  renderEventCheckinSection,
  renderEventDashboardSection,
} from '../../views/checkin.views.js';
import {
  renderOrganizerAccessErrorPage,
  renderOrganizerEventManagePage,
} from '../../views/organizer.views.js';
import { requireOrganizer } from '../auth/auth.middleware.js';
import type { OrganizerEventSectionLoader } from '../events/events.routes.js';
import {
  EventForbiddenError,
  EventNotFoundError,
  getOrganizerEventOrThrow,
} from '../events/events.service.js';
import { performCheckIn } from './checkin.service.js';
import { getEventDashboardMetrics } from './dashboard.service.js';

export const checkinSectionLoader: OrganizerEventSectionLoader = async (
  event,
) => {
  const metrics = await getEventDashboardMetrics(event.id);
  return {
    dashboardHtml: metrics ? renderEventDashboardSection(metrics) : undefined,
    checkinHtml: renderEventCheckinSection(event),
  };
};

function handleCheckinOwnershipError(
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

export async function checkinRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { eventId: string } }>(
    '/organizer/events/:eventId/checkin',
    { preHandler: requireOrganizer },
    async (request, reply) => {
      const organizer = request.currentUser!;
      const { eventId } = request.params;
      const body = (request.body ?? {}) as Record<string, unknown>;
      const rawCode = typeof body['code'] === 'string' ? body['code'] : '';

      try {
        const result = await performCheckIn(organizer.id, eventId, rawCode);
        const event = await getOrganizerEventOrThrow(eventId, organizer.id);
        const metrics = await getEventDashboardMetrics(event.id);

        const occupiedSeats = metrics
          ? metrics.confirmedCount + metrics.pendingCount
          : 0;

        return reply
          .code(200)
          .type('text/html; charset=utf-8')
          .send(
            renderOrganizerEventManagePage(organizer, event, {
              occupiedSeats,
              sections: {
                dashboardHtml: metrics
                  ? renderEventDashboardSection(metrics)
                  : undefined,
                checkinHtml: renderEventCheckinSection(event, result, rawCode),
                cancelHtml: renderEventCancellationSection(event),
              },
            }),
          );
      } catch (err) {
        if (handleCheckinOwnershipError(err, request, reply)) {
          return;
        }
        throw err;
      }
    },
  );
}
