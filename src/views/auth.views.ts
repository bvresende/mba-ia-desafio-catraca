import type { AuthUser } from '../modules/auth/auth.service.js';
import { escapeHtml, renderLayout } from './layout.js';

export function renderHomePage(currentUser: AuthUser | null): string {
  const actionsHtml = !currentUser
    ? `
      <div class="actions">
        <a href="/register" class="btn">Criar conta de participante</a>
        <a href="/login" class="btn btn-secondary">Entrar</a>
      </div>
    `
    : currentUser.role === 'organizer'
      ? `
        <div class="actions">
          <a href="/organizer/events" class="btn">Ir para Área do Organizador</a>
        </div>
      `
      : `
        <div class="actions">
          <a href="/tickets" class="btn">Meus ingressos</a>
        </div>
      `;

  return renderLayout({
    title: 'Eventos',
    currentUser,
    bodyHtml: `
      <section class="card">
        <h1>Catraca — Ingressos para Eventos</h1>
        <p class="muted">
          Plataforma de venda e operação de ingressos para eventos.
        </p>
        ${actionsHtml}
      </section>
    `,
  });
}

export interface RegisterViewOptions {
  readonly error?: string;
  readonly name?: string;
  readonly email?: string;
}

export function renderRegisterPage(options: RegisterViewOptions = {}): string {
  const errorHtml = options.error
    ? `<div class="alert alert-error" role="alert">${escapeHtml(options.error)}</div>`
    : '';

  return renderLayout({
    title: 'Criar conta',
    currentUser: null,
    bodyHtml: `
      <section class="card card-narrow">
        <h1>Criar conta de participante</h1>
        <p class="muted">Cadastre-se para comprar e gerenciar seus ingressos.</p>
        ${errorHtml}
        <form method="post" action="/register">
          <div class="field">
            <label for="name">Nome completo</label>
            <input id="name" name="name" type="text" required value="${escapeHtml(options.name ?? '')}">
          </div>
          <div class="field">
            <label for="email">E-mail</label>
            <input id="email" name="email" type="email" required value="${escapeHtml(options.email ?? '')}">
          </div>
          <div class="field">
            <label for="password">Senha (mínimo 6 caracteres)</label>
            <input id="password" name="password" type="password" minlength="6" required>
          </div>
          <button type="submit" class="btn">Cadastrar</button>
        </form>
        <p class="muted" style="margin-top:1rem;">
          Já possui conta? <a href="/login">Entrar</a>
        </p>
      </section>
    `,
  });
}

export interface LoginViewOptions {
  readonly error?: string;
  readonly email?: string;
}

export function renderLoginPage(options: LoginViewOptions = {}): string {
  const errorHtml = options.error
    ? `<div class="alert alert-error" role="alert">${escapeHtml(options.error)}</div>`
    : '';

  return renderLayout({
    title: 'Entrar',
    currentUser: null,
    bodyHtml: `
      <section class="card card-narrow">
        <h1>Entrar no Catraca</h1>
        <p class="muted">Acesse com sua conta de participante ou organizador.</p>
        ${errorHtml}
        <form method="post" action="/login">
          <div class="field">
            <label for="email">E-mail</label>
            <input id="email" name="email" type="email" required value="${escapeHtml(options.email ?? '')}">
          </div>
          <div class="field">
            <label for="password">Senha</label>
            <input id="password" name="password" type="password" required>
          </div>
          <button type="submit" class="btn">Entrar</button>
        </form>
        <p class="muted" style="margin-top:1rem;">
          Ainda não tem conta? <a href="/register">Criar conta de participante</a>
        </p>
      </section>
    `,
  });
}

export function renderForbiddenPage(
  currentUser: AuthUser | null,
  message = 'Você não tem permissão para acessar esta área.',
): string {
  return renderLayout({
    title: 'Acesso negado',
    currentUser,
    bodyHtml: `
      <section class="card card-narrow">
        <h1>Acesso negado</h1>
        <div class="alert alert-error" role="alert">${escapeHtml(message)}</div>
        <div class="actions">
          <a href="/" class="btn btn-secondary">Voltar ao início</a>
        </div>
      </section>
    `,
  });
}

export function renderOrganizerPlaceholderPage(currentUser: AuthUser): string {
  return renderLayout({
    title: 'Área do Organizador',
    currentUser,
    bodyHtml: `
      <section class="card">
        <h1>Área do Organizador</h1>
        <p>Bem-vindo, <strong>${escapeHtml(currentUser.name)}</strong> (${escapeHtml(currentUser.email)}).</p>
        <p class="muted">A gestão completa de eventos será disponibilizada na próxima etapa.</p>
      </section>
    `,
  });
}
