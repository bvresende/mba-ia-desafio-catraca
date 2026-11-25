import type { AuthUser } from '../modules/auth/auth.service.js';

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export interface LayoutOptions {
  readonly title: string;
  readonly currentUser: AuthUser | null;
  readonly bodyHtml: string;
}

const BASE_CSS = `
:root {
  --bg: #f6f7fb;
  --surface: #ffffff;
  --text: #141923;
  --muted: #5a6478;
  --border: #dce1eb;
  --primary: #1f4fd6;
  --primary-hover: #173da9;
  --danger: #c62828;
  --danger-bg: #fdecea;
  --success: #1b7f4b;
  --success-bg: #eaf7f0;
  --warn: #a66200;
  --warn-bg: #fff5e5;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.5;
}
header.topbar {
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  padding: 0.85rem 1.5rem;
}
.topbar-inner {
  max-width: 1040px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  flex-wrap: wrap;
}
.brand {
  font-weight: 800;
  font-size: 1.25rem;
  color: var(--primary);
  text-decoration: none;
  letter-spacing: -0.02em;
}
nav.nav-links {
  display: flex;
  align-items: center;
  gap: 1rem;
  flex-wrap: wrap;
}
nav.nav-links a {
  color: var(--text);
  text-decoration: none;
  font-weight: 500;
}
nav.nav-links a:hover {
  color: var(--primary);
}
.user-pill {
  font-size: 0.875rem;
  color: var(--muted);
  background: var(--bg);
  border: 1px solid var(--border);
  padding: 0.25rem 0.65rem;
  border-radius: 999px;
}
main.container {
  max-width: 1040px;
  margin: 2rem auto;
  padding: 0 1.5rem 3rem;
}
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 1.5rem;
  box-shadow: 0 1px 2px rgba(20, 25, 35, 0.04);
}
.card-narrow {
  max-width: 460px;
  margin: 0 auto;
}
h1, h2, h3 { margin-top: 0; }
.muted { color: var(--muted); }
.field { margin-bottom: 1rem; }
.field label {
  display: block;
  font-weight: 600;
  margin-bottom: 0.35rem;
  font-size: 0.92rem;
}
.field input, .field select, .field textarea {
  width: 100%;
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 1rem;
  background: #fff;
}
.btn {
  display: inline-block;
  padding: 0.6rem 1.1rem;
  border-radius: 6px;
  border: 1px solid transparent;
  background: var(--primary);
  color: #fff;
  font-weight: 600;
  font-size: 0.95rem;
  cursor: pointer;
  text-decoration: none;
}
.btn:hover { background: var(--primary-hover); }
.btn-secondary {
  background: var(--surface);
  color: var(--text);
  border-color: var(--border);
}
.btn-secondary:hover { background: var(--bg); }
.btn-danger {
  background: var(--danger);
  color: #fff;
}
.btn-link {
  background: transparent;
  color: var(--danger);
  border: none;
  padding: 0.25rem 0.5rem;
  font-weight: 600;
  cursor: pointer;
  font-size: 0.92rem;
}
.alert {
  padding: 0.75rem 1rem;
  border-radius: 6px;
  margin-bottom: 1rem;
  font-size: 0.95rem;
}
.alert-error {
  background: var(--danger-bg);
  color: var(--danger);
  border: 1px solid #f5c2c0;
}
.alert-success {
  background: var(--success-bg);
  color: var(--success);
  border: 1px solid #b8e2cb;
}
.actions {
  display: flex;
  gap: 0.75rem;
  flex-wrap: wrap;
  margin-top: 1rem;
}
table {
  width: 100%;
  border-collapse: collapse;
}
th, td {
  text-align: left;
  padding: 0.7rem 0.75rem;
  border-bottom: 1px solid var(--border);
}
th {
  font-size: 0.85rem;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
`;

function renderNav(currentUser: AuthUser | null): string {
  if (!currentUser) {
    return `
      <a href="/">Eventos</a>
      <a href="/login">Entrar</a>
      <a href="/register" class="btn">Criar conta</a>
    `;
  }

  const roleLinks =
    currentUser.role === 'organizer'
      ? `<a href="/organizer/events">Área do Organizador</a>`
      : `<a href="/tickets">Meus ingressos</a>`;

  const roleLabel =
    currentUser.role === 'organizer' ? 'Organizador' : 'Participante';

  return `
    <a href="/">Eventos</a>
    ${roleLinks}
    <span class="user-pill">${escapeHtml(currentUser.name)} (${roleLabel})</span>
    <form method="post" action="/logout" style="display:inline;margin:0;">
      <button type="submit" class="btn-link">Sair</button>
    </form>
  `;
}

export function renderLayout(options: LayoutOptions): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(options.title)} — Catraca</title>
  <style>${BASE_CSS}</style>
</head>
<body>
  <header class="topbar">
    <div class="topbar-inner">
      <a href="/" class="brand">Catraca</a>
      <nav class="nav-links" aria-label="Navegação principal">
        ${renderNav(options.currentUser)}
      </nav>
    </div>
  </header>
  <main class="container">
    ${options.bodyHtml}
  </main>
</body>
</html>`;
}
