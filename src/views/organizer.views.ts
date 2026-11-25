import type { Event, EventStatus } from '../db/schema.js';
import type { AuthUser } from '../modules/auth/auth.service.js';
import type { OrganizerEventSummary } from '../modules/events/events.service.js';
import { escapeHtml, renderLayout } from './layout.js';

export interface EventFormValues {
  readonly name?: string;
  readonly startsAt?: string;
  readonly location?: string;
  readonly capacity?: string;
  readonly price?: string;
}

export interface OrganizerEventManageSections {
  readonly dashboardHtml?: string;
  readonly checkinHtml?: string;
  readonly cancelHtml?: string;
}

export interface OrganizerEventManageOptions {
  readonly occupiedSeats: number;
  readonly error?: string;
  readonly successMessage?: string;
  readonly formValues?: EventFormValues;
  readonly sections?: OrganizerEventManageSections;
}

const SAO_PAULO_OFFSET_MS = 3 * 60 * 60 * 1000;

export function formatPriceBRL(priceCents: number): string {
  return `R$ ${(priceCents / 100).toFixed(2).replace('.', ',')}`;
}

export function formatPriceInput(priceCents: number): string {
  return (priceCents / 100).toFixed(2).replace('.', ',');
}

export function formatDateTimeLocal(date: Date): string {
  const shifted = new Date(date.getTime() - SAO_PAULO_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  const hours = String(shifted.getUTCHours()).padStart(2, '0');
  const minutes = String(shifted.getUTCMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

export function formatDateTimeDisplay(date: Date): string {
  const shifted = new Date(date.getTime() - SAO_PAULO_OFFSET_MS);
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const year = shifted.getUTCFullYear();
  const hours = String(shifted.getUTCHours()).padStart(2, '0');
  const minutes = String(shifted.getUTCMinutes()).padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${minutes} (BRT)`;
}

export function formatEventStatusLabel(status: EventStatus): string {
  switch (status) {
    case 'draft':
      return 'rascunho';
    case 'published':
      return 'publicado';
    case 'cancelled':
      return 'cancelado';
  }
}

function renderStatusBadge(status: EventStatus): string {
  const label = formatEventStatusLabel(status);
  return `<span class="badge badge-${status}">${label}</span>`;
}

export function renderOrganizerEventsListPage(
  user: AuthUser,
  eventsList: readonly OrganizerEventSummary[],
): string {
  const contentHtml =
    eventsList.length === 0
      ? `
        <p class="muted">Você ainda não criou nenhum evento.</p>
        <div class="actions">
          <a href="/organizer/events/new" class="btn">Criar primeiro evento</a>
        </div>
      `
      : `
        <table>
          <thead>
            <tr>
              <th>Evento</th>
              <th>Data/Hora</th>
              <th>Local</th>
              <th>Ocupação</th>
              <th>Preço</th>
              <th>Status</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            ${eventsList
              .map(
                (evt) => `
              <tr>
                <td><a href="/organizer/events/${escapeHtml(evt.id)}"><strong>${escapeHtml(evt.name)}</strong></a></td>
                <td>${escapeHtml(formatDateTimeDisplay(evt.startsAt))}</td>
                <td>${escapeHtml(evt.location)}</td>
                <td>${evt.occupiedSeats} / ${evt.capacity}</td>
                <td>${escapeHtml(formatPriceBRL(evt.priceCents))}</td>
                <td>${renderStatusBadge(evt.status)}</td>
                <td><a href="/organizer/events/${escapeHtml(evt.id)}" class="btn btn-secondary">Gerenciar</a></td>
              </tr>`,
              )
              .join('')}
          </tbody>
        </table>
      `;

  return renderLayout({
    title: 'Meus Eventos',
    currentUser: user,
    bodyHtml: `
      <section class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap;margin-bottom:1rem;">
          <div>
            <h1 style="margin-bottom:0.25rem;">Área do Organizador</h1>
            <p class="muted" style="margin:0;">Eventos de ${escapeHtml(user.name)}</p>
          </div>
          <a href="/organizer/events/new" class="btn">+ Novo evento</a>
        </div>
        ${contentHtml}
      </section>
    `,
  });
}

export function renderOrganizerNewEventPage(
  user: AuthUser,
  values: EventFormValues = {},
  error?: string,
): string {
  const errorHtml = error
    ? `<div class="alert alert-error" role="alert">${escapeHtml(error)}</div>`
    : '';

  return renderLayout({
    title: 'Novo Evento',
    currentUser: user,
    bodyHtml: `
      <section class="card card-narrow" style="max-width:600px;">
        <p style="margin-top:0;"><a href="/organizer/events">&larr; Voltar para meus eventos</a></p>
        <h1>Criar novo evento</h1>
        <p class="muted">O evento será criado em rascunho até que você o publique.</p>
        ${errorHtml}
        <form method="post" action="/organizer/events">
          <div class="field">
            <label for="name">Nome do evento</label>
            <input id="name" name="name" type="text" required value="${escapeHtml(values.name ?? '')}">
          </div>
          <div class="field">
            <label for="startsAt">Data e hora de início (horário de Brasília)</label>
            <input id="startsAt" name="startsAt" type="datetime-local" required value="${escapeHtml(values.startsAt ?? '')}">
          </div>
          <div class="field">
            <label for="location">Local</label>
            <input id="location" name="location" type="text" required value="${escapeHtml(values.location ?? '')}">
          </div>
          <div class="field">
            <label for="capacity">Lotação máxima</label>
            <input id="capacity" name="capacity" type="number" min="1" step="1" required value="${escapeHtml(values.capacity ?? '')}">
          </div>
          <div class="field">
            <label for="price">Preço do ingresso (R$)</label>
            <input id="price" name="price" type="text" inputmode="decimal" placeholder="120,50" required value="${escapeHtml(values.price ?? '')}">
          </div>
          <div class="actions">
            <button type="submit" class="btn">Criar rascunho</button>
            <a href="/organizer/events" class="btn btn-secondary">Cancelar</a>
          </div>
        </form>
      </section>
    `,
  });
}

export function renderOrganizerEventManagePage(
  user: AuthUser,
  event: Event,
  options: OrganizerEventManageOptions,
): string {
  const errorHtml = options.error
    ? `<div class="alert alert-error" role="alert">${escapeHtml(options.error)}</div>`
    : '';
  const successHtml = options.successMessage
    ? `<div class="alert alert-success" role="status">${escapeHtml(options.successMessage)}</div>`
    : '';

  const formValues: Required<EventFormValues> = {
    name: options.formValues?.name ?? event.name,
    startsAt:
      options.formValues?.startsAt ?? formatDateTimeLocal(event.startsAt),
    location: options.formValues?.location ?? event.location,
    capacity: options.formValues?.capacity ?? String(event.capacity),
    price: options.formValues?.price ?? formatPriceInput(event.priceCents),
  };

  const publishBlock =
    event.status === 'draft'
      ? `
        <form method="post" action="/organizer/events/${escapeHtml(event.id)}/publish" style="margin:0;">
          <button type="submit" class="btn">Publicar evento</button>
        </form>
      `
      : '';

  const editSectionHtml =
    event.status === 'cancelled'
      ? `
        <section class="card" id="event-edit" style="margin-top:1rem;">
          <h2>Editar evento</h2>
          <p class="muted">Este evento está encerrado e não aceita novas alterações ou publicação.</p>
        </section>
      `
      : `
        <section class="card" id="event-edit" style="margin-top:1rem;">
          <h2>Editar evento</h2>
          <form method="post" action="/organizer/events/${escapeHtml(event.id)}/edit">
            <div class="field">
              <label for="name">Nome do evento</label>
              <input id="name" name="name" type="text" required value="${escapeHtml(formValues.name)}">
            </div>
            <div class="field">
              <label for="startsAt">Data e hora de início (horário de Brasília)</label>
              <input id="startsAt" name="startsAt" type="datetime-local" required value="${escapeHtml(formValues.startsAt)}">
            </div>
            <div class="field">
              <label for="location">Local</label>
              <input id="location" name="location" type="text" required value="${escapeHtml(formValues.location)}">
            </div>
            <div class="field">
              <label for="capacity">Lotação máxima (vagas ocupadas atualmente: ${options.occupiedSeats})</label>
              <input id="capacity" name="capacity" type="number" min="1" step="1" required value="${escapeHtml(formValues.capacity)}">
            </div>
            <div class="field">
              <label for="price">Preço vigente do ingresso (R$)</label>
              <input id="price" name="price" type="text" inputmode="decimal" required value="${escapeHtml(formValues.price)}">
              <small class="muted">Alterar o preço aplica-se apenas às próximas compras; ingressos já emitidos preservam o valor original.</small>
            </div>
            <div class="actions">
              <button type="submit" class="btn">Salvar alterações</button>
            </div>
          </form>
        </section>
      `;

  const dashboardSlotHtml =
    options.sections?.dashboardHtml ??
    `
      <section class="card" style="margin-top:1rem;" data-slot="dashboard">
        <h2>Painel de Vendas e Operação</h2>
        <p class="muted">Vagas ocupadas: ${options.occupiedSeats} de ${event.capacity}.</p>
      </section>
    `;

  const checkinSlotHtml =
    options.sections?.checkinHtml ??
    `
      <section class="card" style="margin-top:1rem;" data-slot="checkin">
        <h2>Check-in na Portaria</h2>
        <p class="muted">Área reservada para validação de ingressos do evento.</p>
      </section>
    `;

  const cancelSlotHtml =
    options.sections?.cancelHtml ??
    (event.status !== 'cancelled'
      ? `
        <section class="card" style="margin-top:1rem;" data-slot="cancel">
          <h2>Encerramento do Evento</h2>
          <p class="muted">Área reservada para ações de encerramento irreversível do evento.</p>
        </section>
      `
      : '');

  return renderLayout({
    title: `Gerenciar: ${event.name}`,
    currentUser: user,
    bodyHtml: `
      <section class="card" id="event-overview">
        <p style="margin-top:0;"><a href="/organizer/events">&larr; Voltar para meus eventos</a></p>
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;flex-wrap:wrap;">
          <div>
            <h1 style="margin-bottom:0.35rem;">${escapeHtml(event.name)}</h1>
            <p class="muted" style="margin:0;">
              ID: <code>${escapeHtml(event.id)}</code> &middot;
              Status: ${renderStatusBadge(event.status)}
            </p>
          </div>
          ${publishBlock}
        </div>
        <div style="margin-top:1rem;display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:0.75rem;">
          <div><strong>Data/Hora:</strong><br>${escapeHtml(formatDateTimeDisplay(event.startsAt))}</div>
          <div><strong>Local:</strong><br>${escapeHtml(event.location)}</div>
          <div><strong>Lotação:</strong><br>${options.occupiedSeats} / ${event.capacity} vagas ocupadas</div>
          <div><strong>Preço vigente:</strong><br>${escapeHtml(formatPriceBRL(event.priceCents))}</div>
        </div>
      </section>

      <div style="margin-top:1rem;">
        ${errorHtml}
        ${successHtml}
      </div>

      ${editSectionHtml}

      <div id="event-dashboard-slot">${dashboardSlotHtml}</div>
      <div id="event-checkin-slot">${checkinSlotHtml}</div>
      <div id="event-cancel-slot">${cancelSlotHtml}</div>
    `,
  });
}

export function renderOrganizerAccessErrorPage(
  user: AuthUser,
  title: string,
  message: string,
): string {
  return renderLayout({
    title,
    currentUser: user,
    bodyHtml: `
      <section class="card card-narrow">
        <h1>${escapeHtml(title)}</h1>
        <div class="alert alert-error" role="alert">${escapeHtml(message)}</div>
        <div class="actions">
          <a href="/organizer/events" class="btn btn-secondary">Voltar para meus eventos</a>
        </div>
      </section>
    `,
  });
}
