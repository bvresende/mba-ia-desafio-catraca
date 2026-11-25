# Implementation Plan: F04 — Vitrine Pública e Área do Participante ("Meus ingressos")

**Branch**: `004-f04-storefront-tickets` | **Date**: 2026-11-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/004-f04-storefront-tickets/spec.md`

## Summary

Implementar a vitrine pública SSR em `GET /`, o fluxo de compra de ingresso pelo participante autenticado em `POST /events/:eventId/purchase` e a página "Meus ingressos" em `GET /my-tickets`. A camada web consome diretamente `requireParticipant` (`F01`), os eventos publicados (`F02`) e o motor transacional `purchaseTicket` + `getEventSeatMetrics` (`F03`), garantindo resposta imediata `pendente`, exibição exata de `Ingressos esgotados` e tradução literal dos cinco status em português.

## Technical Context

**Language/Version**: TypeScript (strict) sobre Node.js 24 LTS

**Primary Dependencies**: Fastify 5 (`@fastify/formbody`, `@fastify/cookie`), Drizzle ORM (`pg`), templates SSR HTML/CSS puros

**Storage**: PostgreSQL 16 (tabelas `events`, `tickets`, `users`, `sessions` em `src/db/schema.ts` já criadas em `F01`)

**Testing**: Vitest (testes de integração SSR via `app.inject()` contra banco isolado `catraca_test`)

**Target Platform**: Linux (container Docker `app` + `db` servindo em `http://localhost:3000`)

**Project Type**: web-service (monólito modular Fastify 5 com SSR HTML + REST API)

**Performance Goals**: Renderização de `GET /` e `GET /my-tickets` em < 150ms; `POST /events/:eventId/purchase` respondendo imediatamente (< 500ms) sem aguardar a conclusão assíncrona do gateway.

**Constraints**: Zero novas migrations necessárias; sem SPA/bundler; mensagens literais obrigatórias (`Ingressos esgotados`, `pendente`, `confirmado`, `recusado`, `cancelado`, `estornado`); isolamento de ingressos por `user_id`; compatibilidade para merge limpo em paralelo com `F05` e `F06` na Wave 4.

**Scale/Scope**: 1 módulo novo (`src/modules/storefront/`), 1 arquivo de views (`src/views/storefront.views.ts`), registro mínimo no bootstrap (`src/app.ts`) e 1 suíte dedicada (`tests/f04.storefront.test.ts`).

## Constitution Check

- **Princípio I (Spec-Driven & Contract-First)**: `spec.md`, `plan.md`, `tasks.md` e `contract.md` presentes e mapeando 100% de `F04-AC1`..`F04-AC4` e `CF-04`..`CF-06`. **PASS**.
- **Princípio II (Strict Rule Fidelity)**: Respeita integralmente `R02`, `R05`, `R06`, `R07`, `R08`, `R09` e grafia exata das mensagens em português. **PASS**.
- **Princípio III (Concurrency & State Safety)**: Delega 100% das compras a `purchaseTicket()` de `F03` (que usa `SELECT ... FOR UPDATE`), sem duplicar lógica de contagem ou inserção de ingressos. **PASS**.
- **Princípio IV (Minimal Harness)**: Testes rodam via `./scripts/gates.sh` no banco `catraca_test` com delays configuráveis do gateway. **PASS**.
- **Princípio V (Independent Evaluation)**: Implementação será avaliada em contexto limpo contra `contract.md`. **PASS**.
- **Princípio VI (Simplicity & SSR)**: HTML puro renderizado no servidor, formulários nativos `<form method="POST">` e CSS leve compartilhado. **PASS**.

## Project Structure

### Documentation (this feature)

```text
specs/004-f04-storefront-tickets/
├── spec.md              # Especificação funcional e regras de negócio
├── plan.md              # Este plano de implementação
├── tasks.md             # Checklist executável de tarefas
├── contract.md          # Contrato verificável com rastreabilidade PRD
└── reports/             # Relatórios imutáveis de avaliação independente (eval-NNN.md)
```

### Source Code (repository root)

```text
src/
├── app.ts                                    # Registra storefrontRoutes (único ponto de integração compartilhado)
├── db/
│   └── schema.ts                             # Reutilizado (events, tickets, users)
├── modules/
│   ├── auth/                                 # Reutilizado (requireParticipant, sessão atual)
│   ├── purchase/                             # Reutilizado (purchaseTicket, getEventSeatMetrics)
│   └── storefront/
│       └── storefront.routes.ts              # GET /, POST /events/:eventId/purchase, GET /my-tickets
└── views/
    ├── layout.ts                             # Reutilizado (layout HTML base + escapeHtml + helpers BRL/data)
    └── storefront.views.ts                   # Renderização SSR da vitrine e de "Meus ingressos"

tests/
└── f04.storefront.test.ts                    # Testes de integração cobrindo F04-AC1..AC4 e CF-04..CF-06
```

**Structure Decision**: Isolar todo o código novo em `src/modules/storefront/storefront.routes.ts`, `src/views/storefront.views.ts` e `tests/f04.storefront.test.ts` minimiza conflitos de merge durante a Wave 4 paralela (em que `F05` trabalha em `src/modules/partner/` e `F06` em `src/modules/checkin/`).

## Design Details

### 1. Mapeamento de Status e Formatação (`src/views/storefront.views.ts`)
- Criar dicionário tipado `TICKET_STATUS_PT: Record<TicketStatus, string>`:
  - `pending`: `'pendente'`
  - `confirmed`: `'confirmado'`
  - `declined`: `'recusado'`
  - `cancelled`: `'cancelado'`
  - `refunded`: `'estornado'`
- Helper de moeda BRL (`formatPriceBrl(cents)` → `R$ 100,00`) e data/hora (`formatDateTimeBr(date)`).
- Todo texto dinâmico (`event.name`, `event.location`, mensagens) escapado com `escapeHtml()`.

### 2. Rotas da Vitrine e Participante (`src/modules/storefront/storefront.routes.ts`)
- **`GET /`**:
  - Busca eventos com `status = 'published'` ordenados por `starts_at ASC`.
  - Para cada evento, obtém `availableSeats` via `getEventSeatMetrics(event.id)` (ou consulta agregada consistente com `R05`).
  - Lê eventual mensagem de erro/sucesso da query string (ex.: `?error=sold_out`, `?error=invalid_card`, `?error=event_not_available`) para exibir banner claro (para `sold_out`, contém literalmente `Ingressos esgotados`).
  - Renderiza `renderStorefrontPage({ user, events, errorMessage, infoMessage })`.
  - Para cada card:
    - Se `availableSeats === 0`: renderiza badge/texto `Ingressos esgotados` e omite o formulário de compra.
    - Se `availableSeats > 0` e `user?.role === 'participant'`: renderiza `<form method="POST" action="/events/${event.id}/purchase">` com `<input name="cardNumber" required pattern="\d{16}" maxlength="16" ...>` e botão `Comprar ingresso`.
    - Se `availableSeats > 0` e visitante deslogado: renderiza link `Entrar para comprar` (`/login`) e `Criar conta` (`/register`).
- **`POST /events/:eventId/purchase`**:
  - Protegida por `requireParticipant`.
  - Chama `purchaseTicket({ eventId, channel: 'storefront', userId: request.user.id, buyerEmail: request.user.email, cardNumber })`.
  - Sucesso → `reply.redirect('/my-tickets?purchased=1', 303)`.
  - Erro `sold_out` → renderiza a vitrine (`409` ou redireciona para `/?error=sold_out` com `303`) garantindo que a resposta/página exiba literalmente `Ingressos esgotados`. Preferência: renderizar a vitrine diretamente com status `409` contendo `Ingressos esgotados` (e também suportar `/?error=sold_out`), de modo que tanto testes HTTP diretos no POST quanto navegadores vejam o texto exato imediatamente.
  - Erro `invalid_request` (cartão inválido) → renderiza vitrine com status `422` e mensagem de cartão inválido.
  - Erro `event_not_available` → renderiza vitrine com status `404` e mensagem de evento indisponível.
- **`GET /my-tickets`**:
  - Protegida por `requireParticipant`.
  - Consulta `tickets` com `INNER JOIN events ON tickets.event_id = events.id` filtrando `WHERE tickets.user_id = request.user.id ORDER BY tickets.created_at DESC`.
  - Renderiza `renderMyTicketsPage({ user, tickets, justPurchased })` exibindo para cada ingresso: nome do evento, status em português (`pendente`, `confirmado`, `recusado`, `cancelado`, `estornado`), código único (`code`) e preço pago.

### 3. Estratégia de Testes (`tests/f04.storefront.test.ts`)
- Executar contra `catraca_test` com delays rápidos do gateway (`GATEWAY_FAST_MIN_MS=20`, `GATEWAY_FAST_MAX_MS=50`, `GATEWAY_SLOW_MIN_MS=150`, `GATEWAY_SLOW_MAX_MS=250`).
- Cobrir:
  1. Vitrine pública deslogada exibe apenas `published` (oculta `draft` e `cancelled`), refletindo publicação imediata de `F02` (`F04-AC1`, `CF-05`).
  2. Participante cadastrado/autenticado via `F01` compra na vitrine, recebe resposta imediata, vaga diminui e ingresso nasce `pendente` em `/my-tickets` (`F04-AC2`, `CF-04`, `CF-06`).
  3. Esgotamento por `pending` e `confirmed` exibe `Ingressos esgotados` na vitrine e na resposta de tentativa extra (`F04-AC3`, `CF-06`).
  4. Cartão `0001` transita para `confirmado`, cartão `0002` transita para `recusado` e libera a vaga na vitrine, e código único é exibido em `/my-tickets` (`F04-AC4`, `CF-06`).
  5. Isolamento entre dois participantes em `/my-tickets` (`CF-04`) e bloqueio de visitante/organizador em `POST /events/:eventId/purchase` e `GET /my-tickets`.
  6. Mapeamento dos 5 status em português (`pendente`, `confirmado`, `recusado`, `cancelado`, `estornado`).

## Complexity Tracking

Nenhuma violação à Constituição identificada. A implementação reutiliza integralmente os módulos de `F01`, `F02` e `F03` sem abstrações extras.
