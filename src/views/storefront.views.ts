import type { TicketStatus } from '../db/schema.js';
import type { AuthUser } from '../modules/auth/auth.service.js';
import { escapeHtml, renderLayout } from './layout.js';

export const TICKET_STATUS_PT: Record<TicketStatus, string> = {
  pending: 'pendente',
  confirmed: 'confirmado',
  declined: 'recusado',
  cancelled: 'cancelado',
  refunded: 'estornado',
};

export function formatTicketStatusPt(status: TicketStatus): string {
  return TICKET_STATUS_PT[status];
}

const SAO_PAULO_OFFSET_MS = 3 * 60 * 60 * 1000;

export function formatPriceBrl(priceCents: number): string {
  return `R$ ${(priceCents / 100).toFixed(2).replace('.', ',')}`;
}

export function formatDateTimeBr(date: Date): string {
  const shifted = new Date(date.getTime() - SAO_PAULO_OFFSET_MS);
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const year = shifted.getUTCFullYear();
  const hours = String(shifted.getUTCHours()).padStart(2, '0');
  const minutes = String(shifted.getUTCMinutes()).padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${minutes} (BRT)`;
}

export interface StorefrontEventItem {
  readonly id: string;
  readonly name: string;
  readonly startsAt: Date;
  readonly location: string;
  readonly priceCents: number;
  readonly capacity: number;
  readonly availableSeats: number;
}

export interface StorefrontPageOptions {
  readonly currentUser: AuthUser | null;
  readonly events: readonly StorefrontEventItem[];
  readonly errorMessage?: string;
  readonly infoMessage?: string;
  readonly errorEventId?: string;
}

export interface ParticipantTicketItem {
  readonly id: string;
  readonly eventId: string;
  readonly eventName: string;
  readonly eventStartsAt: Date;
  readonly eventLocation: string;
  readonly code: string;
  readonly priceCents: number;
  readonly status: TicketStatus;
  readonly createdAt: Date;
}

export interface MyTicketsPageOptions {
  readonly currentUser: AuthUser;
  readonly tickets: readonly ParticipantTicketItem[];
}

function renderEventActionBlock(
  event: StorefrontEventItem,
  currentUser: AuthUser | null,
): string {
  if (event.availableSeats <= 0) {
    return `
      <div class="event-sold-out">
        <span class="badge badge-sold-out">Ingressos esgotados</span>
      </div>
    `;
  }

  if (currentUser?.role === 'participant') {
    const inputId = `card-${escapeHtml(event.id)}`;
    return `
      <form method="post" action="/events/${escapeHtml(event.id)}/purchase" class="purchase-form">
        <div class="field" style="margin-bottom:0.75rem;">
          <label for="${inputId}">Número do cartão (16 dígitos)</label>
          <input
            id="${inputId}"
            name="cardNumber"
            type="text"
            inputmode="numeric"
            pattern="\\d{16}"
            minlength="16"
            maxlength="16"
            placeholder="4111111111110001"
            required
          >
        </div>
        <button type="submit" class="btn">Comprar ingresso</button>
      </form>
    `;
  }

  if (!currentUser) {
    return `
      <div class="actions">
        <a href="/login" class="btn">Entrar para comprar</a>
        <a href="/register" class="btn btn-secondary">Criar conta</a>
      </div>
    `;
  }

  return `<p class="muted" style="margin:0.75rem 0 0;">Entre com uma conta de participante para comprar ingressos.</p>`;
}

export function renderStorefrontPage(options: StorefrontPageOptions): string {
  const errorHtml = options.errorMessage
    ? `<div class="alert alert-error" role="alert">${escapeHtml(options.errorMessage)}</div>`
    : '';

  const infoHtml = options.infoMessage
    ? `<div class="alert alert-success" role="status">${escapeHtml(options.infoMessage)}</div>`
    : '';

  const eventsHtml =
    options.events.length === 0
      ? `
        <section class="card">
          <p class="muted" style="margin:0;">Nenhum evento publicado disponível no momento.</p>
        </section>
      `
      : `
        <div class="events-grid">
          ${options.events
            .map((evt) => {
              const seatsLabel =
                evt.availableSeats <= 0
                  ? '0 vagas disponíveis'
                  : `${evt.availableSeats} ${evt.availableSeats === 1 ? 'vaga disponível' : 'vagas disponíveis'}`;
              const cardHighlight =
                options.errorEventId === evt.id ? ' event-card-error' : '';

              return `
                <article class="card event-card${cardHighlight}" id="event-${escapeHtml(evt.id)}">
                  <div class="event-card-header">
                    <h2>${escapeHtml(evt.name)}</h2>
                    <span class="event-price">${escapeHtml(formatPriceBrl(evt.priceCents))}</span>
                  </div>
                  <dl class="event-meta">
                    <div>
                      <dt>Data e hora</dt>
                      <dd>${escapeHtml(formatDateTimeBr(evt.startsAt))}</dd>
                    </div>
                    <div>
                      <dt>Local</dt>
                      <dd>${escapeHtml(evt.location)}</dd>
                    </div>
                    <div>
                      <dt>Disponibilidade</dt>
                      <dd>${escapeHtml(seatsLabel)}</dd>
                    </div>
                  </dl>
                  ${renderEventActionBlock(evt, options.currentUser)}
                </article>
              `;
            })
            .join('')}
        </div>
      `;

  return renderLayout({
    title: 'Eventos',
    currentUser: options.currentUser,
    bodyHtml: `
      <section style="margin-bottom:1.25rem;">
        <h1 style="margin-bottom:0.25rem;">Eventos disponíveis</h1>
        <p class="muted" style="margin:0;">Confira os eventos publicados e garanta seu ingresso.</p>
      </section>
      ${errorHtml}
      ${infoHtml}
      ${eventsHtml}
    `,
  });
}

export function renderMyTicketsPage(options: MyTicketsPageOptions): string {
  const contentHtml =
    options.tickets.length === 0
      ? `
        <p class="muted">Você ainda não possui ingressos comprados.</p>
        <div class="actions">
          <a href="/" class="btn">Explorar eventos</a>
        </div>
      `
      : `
        <table>
          <thead>
            <tr>
              <th>Evento</th>
              <th>Data/Hora</th>
              <th>Local</th>
              <th>Código único</th>
              <th>Valor</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${options.tickets
              .map((ticket) => {
                const statusPt = formatTicketStatusPt(ticket.status);
                return `
                  <tr>
                    <td><strong>${escapeHtml(ticket.eventName)}</strong></td>
                    <td>${escapeHtml(formatDateTimeBr(ticket.eventStartsAt))}</td>
                    <td>${escapeHtml(ticket.eventLocation)}</td>
                    <td><code>${escapeHtml(ticket.code)}</code></td>
                    <td>${escapeHtml(formatPriceBrl(ticket.priceCents))}</td>
                    <td><span class="badge badge-ticket-${escapeHtml(ticket.status)}">${escapeHtml(statusPt)}</span></td>
                  </tr>
                `;
              })
              .join('')}
          </tbody>
        </table>
      `;

  return renderLayout({
    title: 'Meus ingressos',
    currentUser: options.currentUser,
    bodyHtml: `
      <section class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap;margin-bottom:1rem;">
          <div>
            <h1 style="margin-bottom:0.25rem;">Meus ingressos</h1>
            <p class="muted" style="margin:0;">Acompanhe o status e o código único dos seus ingressos.</p>
          </div>
          <a href="/" class="btn btn-secondary">Ver eventos</a>
        </div>
        ${contentHtml}
      </section>
    `,
  });
}
