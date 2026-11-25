import type { Event } from '../db/schema.js';
import type { CheckInResult } from '../modules/checkin/checkin.service.js';
import type { EventDashboardMetrics } from '../modules/checkin/dashboard.service.js';
import { escapeHtml } from './layout.js';

export function renderEventDashboardSection(
  metrics: EventDashboardMetrics,
): string {
  return `
    <section class="card" style="margin-top:1rem;" data-slot="dashboard" id="event-dashboard">
      <h2>Painel de Vendas e Operação</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:0.75rem;margin-top:0.75rem;">
        <div style="padding:0.85rem;border:1px solid var(--border);border-radius:8px;background:var(--bg);" data-metric="confirmed">
          <div class="muted" style="font-size:0.85rem;">Confirmados</div>
          <div style="font-size:1.4rem;font-weight:700;margin-top:0.2rem;">${metrics.confirmedCount}</div>
        </div>
        <div style="padding:0.85rem;border:1px solid var(--border);border-radius:8px;background:var(--bg);" data-metric="pending">
          <div class="muted" style="font-size:0.85rem;">Pendentes</div>
          <div style="font-size:1.4rem;font-weight:700;margin-top:0.2rem;">${metrics.pendingCount}</div>
        </div>
        <div style="padding:0.85rem;border:1px solid var(--border);border-radius:8px;background:var(--bg);" data-metric="checked-in">
          <div class="muted" style="font-size:0.85rem;">Check-ins</div>
          <div style="font-size:1.4rem;font-weight:700;margin-top:0.2rem;">${metrics.checkedInCount}</div>
        </div>
        <div style="padding:0.85rem;border:1px solid var(--border);border-radius:8px;background:var(--bg);" data-metric="available-seats">
          <div class="muted" style="font-size:0.85rem;">Vagas disponíveis</div>
          <div style="font-size:1.4rem;font-weight:700;margin-top:0.2rem;">${metrics.availableSeats}</div>
        </div>
        <div style="padding:0.85rem;border:1px solid var(--border);border-radius:8px;background:var(--bg);" data-metric="revenue">
          <div class="muted" style="font-size:0.85rem;">Receita</div>
          <div style="font-size:1.4rem;font-weight:700;margin-top:0.2rem;">${escapeHtml(metrics.revenueFormatted)}</div>
        </div>
        <div style="padding:0.85rem;border:1px solid var(--border);border-radius:8px;background:var(--bg);" data-metric="refunded">
          <div class="muted" style="font-size:0.85rem;">Estornados</div>
          <div style="font-size:1.4rem;font-weight:700;margin-top:0.2rem;">${metrics.refundedCount}</div>
        </div>
      </div>
    </section>
  `;
}

export function renderEventCheckinSection(
  event: Event,
  checkinResult?: CheckInResult,
  submittedCode?: string,
): string {
  let bannerHtml = '';
  if (checkinResult) {
    const alertClass = checkinResult.ok ? 'alert-success' : 'alert-error';
    bannerHtml = `<div class="alert ${alertClass}" role="status" data-checkin-result="true">${escapeHtml(checkinResult.message)}</div>`;
  } else if (event.status === 'cancelled') {
    bannerHtml = `<div class="alert alert-error" role="status" data-checkin-result="true">Evento cancelado</div>`;
  }

  const formHtml =
    event.status === 'cancelled'
      ? ''
      : `
        <form method="post" action="/organizer/events/${escapeHtml(event.id)}/checkin">
          <div class="field">
            <label for="checkin-code">Código do ingresso</label>
            <input
              id="checkin-code"
              name="code"
              type="text"
              placeholder="Ex.: AB12CD34"
              autocomplete="off"
              value="${escapeHtml(checkinResult?.ok ? '' : (submittedCode ?? ''))}"
              required
            >
          </div>
          <div class="actions">
            <button type="submit" class="btn">Validar check-in</button>
          </div>
        </form>
      `;

  return `
    <section class="card" style="margin-top:1rem;" data-slot="checkin" id="event-checkin">
      <h2>Check-in na Portaria</h2>
      ${bannerHtml}
      ${formHtml}
    </section>
  `;
}
