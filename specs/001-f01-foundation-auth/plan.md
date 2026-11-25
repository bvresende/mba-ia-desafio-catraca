# Implementation Plan: F01 — Fundação, Harness, Autenticação e Seed

**Branch**: `feat/f01-foundation-auth` | **Date**: 2026-11-25 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `/specs/001-f01-foundation-auth/spec.md`

---

## Summary

Construir a base completa do projeto **Catraca** em TypeScript strict + Node.js 24 LTS + Fastify 5 + PostgreSQL 16 + Drizzle ORM, entregando infraestrutura Docker Compose (`db` + `app`), scripts de harness (`up.sh`, `down.sh`, `gates.sh`), schema SQL/Drizzle das 4 tabelas centrais (`users`, `sessions`, `events`, `tickets`), migrations e seed idempotente, autenticação baseada em sessão (`HttpOnly` cookie), layout HTML SSR e middlewares de controle de acesso (`R13`), validados por suíte Vitest em banco isolado `catraca_test`.

---

## Technical Context

- **Language/Version**: TypeScript 5.x (strict mode) sobre Node.js 24 LTS (ESM `"type": "module"`)
- **Primary Dependencies**: `fastify` (v5), `@fastify/cookie`, `@fastify/formbody`, `drizzle-orm`, `pg`, `tsx` (execução TS de scripts/server em dev/test)
- **Storage**: PostgreSQL 16 (`catraca` para runtime; `catraca_test` para `./scripts/gates.sh`)
- **Testing**: Vitest (`tests/f01.foundation.test.ts` + helper `tests/helpers/test-db.ts`)
- **Target Platform**: Linux/macOS via Docker Compose (porta única `http://localhost:3000`)
- **Project Type**: Single monolith web service (SSR HTML/CSS + REST API + PostgreSQL)
- **Performance Goals**: `/health` < 50ms; subida completa via `./scripts/up.sh` < 60s em build quente
- **Constraints**: Zero `npm install` exigido no host; nenhuma dependência externa paga ou chave real; senha hasheada com `node:crypto` (`scrypt`)
- **Scale/Scope**: Base arquitetural compartilhada por todas as 7 features (`F01`–`F07`)

---

## Constitution Check

| Princípio | Verificação | Status |
| --- | --- | --- |
| I. Spec-Driven & Contract-First | `spec.md`, `plan.md`, `tasks.md` e `contract.md` criados antes do código | PASS |
| II. Strict Rule Fidelity | Provisiona schema exato para status de ingresso (`pending`/`confirmed`/`declined`/`cancelled`/`refunded`), `checked_in`, `price_cents` e isolamento `R13` | PASS |
| III. Concurrency & State Safety | Schema já inclui constraints (`UNIQUE (code)`, FKs, tipos `integer` para `price_cents` e `capacity`) prontos para `F03` e `F07` | PASS |
| IV. Minimal, Self-Contained Harness | `up.sh`, `down.sh` e `gates.sh` executam integralmente via Docker sem pré-requisitos no host | PASS |
| V. Independent Evaluation | Contrato `contract.md` permite auditoria independente com evidências reproduzíveis | PASS |
| VI. Simplicity & SSR | Fastify 5 com templates TypeScript puros (`src/views/*.ts`) sem bundler SPA | PASS |

---

## Project Structure

### Documentation (this feature)

```text
specs/001-f01-foundation-auth/
├── spec.md
├── plan.md
├── tasks.md
├── contract.md
└── reports/             # Criado pelo avaliador independente (eval-001.md, ...)
```

### Source Code (repository root)

```text
package.json
tsconfig.json
vitest.config.ts
Dockerfile
docker-compose.yml
scripts/
├── up.sh
├── down.sh
└── gates.sh
src/
├── config/
│   └── env.ts
├── db/
│   ├── client.ts
│   ├── schema.ts
│   ├── migrate.ts
│   └── seed.ts
├── modules/
│   └── auth/
│       ├── password.ts
│       ├── auth.service.ts
│       ├── auth.middleware.ts
│       └── auth.routes.ts
├── views/
│   ├── layout.ts
│   └── auth.views.ts
├── app.ts
└── server.ts
tests/
├── helpers/
│   └── test-db.ts
└── f01.foundation.test.ts
```

**Structure Decision**: Monólito modular em `src/` organizado por domínio (`src/modules/<domain>`), banco centralizado em `src/db/` e views SSR puras em `src/views/`. Essa estrutura permite que `F04`, `F05` e `F06` sejam desenvolvidas em paralelo na Wave 4 em arquivos distintos com conflito mínimo em `src/app.ts`.

---

## Detailed Design

### 1. Configuração de Ambiente (`src/config/env.ts`)

Variáveis carregadas com valores padrão seguros para desenvolvimento local:
- `PORT`: `3000`
- `HOST`: `0.0.0.0`
- `DATABASE_URL`: `postgres://catraca:catraca@db:5432/catraca`
- `PARTNER_API_KEY`: `catraca-partner-dev-key-2026`
- `SESSION_COOKIE_NAME`: `catraca_session`
- `SESSION_TTL_HOURS`: `24`
- `GATEWAY_FAST_MIN_MS`: `2000`
- `GATEWAY_FAST_MAX_MS`: `5000`
- `GATEWAY_SLOW_MIN_MS`: `30000`
- `GATEWAY_SLOW_MAX_MS`: `40000`

### 2. Schema e Migrations (`src/db/schema.ts`, `src/db/migrate.ts`)

- `src/db/schema.ts` define `users`, `sessions`, `events` e `tickets` com `drizzle-orm/pg-core`, exportando tipos inferidos (`User`, `Session`, `Event`, `Ticket`, `TicketStatus`, `EventStatus`, `UserRole`, `TicketChannel`).
- `src/db/migrate.ts` aplica SQL idempotente (`CREATE TABLE IF NOT EXISTS`, índices `events_owner_id_idx`, `events_status_idx`, `tickets_event_id_status_idx`, `tickets_user_id_idx`, `sessions_user_id_idx`) dentro de uma tabela de controle `schema_migrations`, garantindo execução segura tanto no `./scripts/up.sh` quanto em `catraca_test`.

### 3. Seed Idempotente (`src/db/seed.ts`)

Insere (ou ignora se já existir pelo `email`) com IDs determinísticos:
- `usr_org_a`: Organizador A (`org-a@catraca.local` / `OrgA1234!`, `role = 'organizer'`)
- `usr_org_b`: Organizador B (`org-b@catraca.local` / `OrgB1234!`, `role = 'organizer'`)
- `usr_part_seed`: Participante Seed (`participante@catraca.local` / `Part1234!`, `role = 'participant'`)

### 4. Autenticação e Autorização (`src/modules/auth/*`)

- `password.ts`: `hashPassword(plain)` usando `crypto.scryptSync` com salt aleatório de 16 bytes (`saltHex:hashHex`); `verifyPassword(plain, stored)` usando `crypto.timingSafeEqual`.
- `auth.service.ts`: `registerParticipant({ name, email, password })`, `authenticateUser({ email, password })`, `createSession(userId)`, `getSessionUser(sessionId)`, `deleteSession(sessionId)`.
- `auth.middleware.ts`:
  - `attachSession`: hook global `onRequest` que lê `request.cookies[SESSION_COOKIE_NAME]` e popula `request.currentUser` (`null` se inválido/expirado).
  - `requireParticipant`: se `!request.currentUser`, redireciona `302 /login`; se `role !== 'participant'`, retorna `403`.
  - `requireOrganizer`: se `!request.currentUser`, redireciona `302 /login` (ou `403` se cliente espera não-HTML); se `role !== 'organizer'`, retorna `403` com HTML de acesso negado sem vazar qualquer dado (`R13`).
- `auth.routes.ts`: `GET/POST /register`, `GET/POST /login`, `POST /logout`, além de uma rota base protegida `GET /organizer` (com `preHandler: requireOrganizer`) que exibe o portal do organizador (em `F02` redireciona para `/organizer/events`).

### 5. App Factory (`src/app.ts`) e Server (`src/server.ts`)

- `buildApp()` instancia Fastify 5, registra `@fastify/cookie` e `@fastify/formbody`, registra `attachSession`, expõe `GET /health` (testa `SELECT 1` no PostgreSQL), rota `GET /` inicial, rotas de auth e hook de erro padrão.
- `src/server.ts` invoca `buildApp()`, escuta em `0.0.0.0:3000` e trata `SIGINT`/`SIGTERM` fechando Fastify e pool do PostgreSQL.

### 6. Scripts de Harness (`scripts/*.sh`)

- `scripts/up.sh`: `set -euo pipefail`, `docker compose up -d --build`, aguarda Postgres saudável, roda `docker compose exec -T app npm run db:migrate`, roda `docker compose exec -T app npm run db:seed`, faz polling em `http://localhost:3000/health` até receber `200` (timeout 60s).
- `scripts/down.sh`: `set -euo pipefail`, `docker compose down --remove-orphans`.
- `scripts/gates.sh`: `set -euo pipefail`, garante `db` em execução (subindo via compose se necessário e preservando o estado anterior ou usando `docker compose run --rm`), garante existência do banco `catraca_test` no Postgres, executa `docker compose run --rm -e DATABASE_URL=postgres://catraca:catraca@db:5432/catraca_test app sh -c "npm run typecheck && npm run test"` e retorna o exit code exato. Se `db` não estava rodando antes de `gates.sh`, encerra apenas o que subiu ou mantém comportamento limpo documentado — para não interferir no `./scripts/up.sh` em execução, `gates.sh` verifica se `db` já está rodando antes e só derruba ao final se tiver sido ele quem subiu.

---

## Complexity Tracking

Nenhuma violação da Constituição detectada. Todas as decisões priorizam simplicidade, SQL explícito/Drizzle e zero dependência de tooling no host.
