import type { FastifyInstance } from 'fastify';
import { renderEventCancellationSection } from '../../views/cancellation.views.js';
import {
  renderEventCheckinSection,
  renderEventDashboardSection,
} from '../../views/checkin.views.js';
import { renderOrganizerEventManagePage } from '../../views/organizer.views.js';
import { requireOrganizer } from '../auth/auth.middleware.js';
import { getEventDashboardMetrics } from '../checkin/dashboard.service.js';
import {
  handleOrganizerOwnershipError,
  type OrganizerEventSectionLoader,
} from '../events/events.routes.js';
import {
  EventStateError,
  getOccupiedSeatCount,
  getOrganizerEventOrThrow,
} from '../events/events.service.js';
import { cancelEvent } from './cancellation.service.js';

export const cancellationSectionLoader: OrganizerEventSectionLoader = (
  event,
) => ({
  cancelHtml: renderEventCancellationSection(event),
});

export async function cancellationRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { eventId: string } }>(
    '/organizer/events/:eventId/cancel',
    { preHandler: requireOrganizer },
    async (request, reply) => {
      const organizer = request.currentUser!;
      const { eventId } = request.params;

      try {
        await cancelEvent(organizer.id, eventId);
        return reply.redirect(`/organizer/events/${eventId}?cancelled=1`, 303);
      } catch (err) {
        if (handleOrganizerOwnershipError(err, request, reply)) {
          return;
        }

        if (err instanceof EventStateError) {
          const event = await getOrganizerEventOrThrow(eventId, organizer.id);
          const [occupiedSeats, metrics] = await Promise.all([
            getOccupiedSeatCount(event.id),
            getEventDashboardMetrics(event.id),
          ]);

          return reply
            .code(409)
            .type('text/html; charset=utf-8')
            .send(
              renderOrganizerEventManagePage(organizer, event, {
                occupiedSeats,
                error: err.message,
                sections: {
                  dashboardHtml: metrics
                    ? renderEventDashboardSection(metrics)
                    : undefined,
                  checkinHtml: renderEventCheckinSection(event),
                  cancelHtml: renderEventCancellationSection(event),
                },
              }),
            );
        }

        throw err;
      }
    },
  );
}
