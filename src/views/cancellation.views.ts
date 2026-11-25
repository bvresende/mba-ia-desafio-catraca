import type { Event } from '../db/schema.js';
import { escapeHtml } from './layout.js';

export function renderEventCancellationSection(event: Event): string {
  if (event.status === 'cancelled') {
    return `
      <section class="card" style="margin-top:1rem;" data-slot="cancel" id="event-cancel">
        <h2>Cancelamento do Evento</h2>
        <p style="margin:0 0 0.5rem;">
          <span class="badge badge-cancelled">Evento cancelado</span>
        </p>
        <p class="muted" style="margin:0;">
          Evento cancelado — cancelamento irreversível. Novas vendas estão bloqueadas, ingressos confirmados foram estornados e ingressos pendentes foram cancelados.
        </p>
      </section>
    `;
  }

  if (event.status === 'draft') {
    return `
      <section class="card" style="margin-top:1rem;" data-slot="cancel" id="event-cancel">
        <h2>Cancelamento do Evento</h2>
        <p class="muted" style="margin:0;">
          O cancelamento está disponível apenas para eventos publicados.
        </p>
      </section>
    `;
  }

  return `
    <section class="card" style="margin-top:1rem;" data-slot="cancel" id="event-cancel">
      <h2>Cancelar evento</h2>
      <p class="muted">
        Atenção: o cancelamento é irreversível. Ao cancelar este evento, todas as vendas serão bloqueadas imediatamente, todos os ingressos confirmados serão estornados e todos os ingressos pendentes serão cancelados.
      </p>
      <form method="post" action="/organizer/events/${escapeHtml(event.id)}/cancel">
        <div class="actions">
          <button type="submit" class="btn btn-danger">Cancelar evento</button>
        </div>
      </form>
    </section>
  `;
}
