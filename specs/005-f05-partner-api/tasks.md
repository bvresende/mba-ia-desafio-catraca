---
description: "Checklist de tarefas executáveis para implementação da Feature F05 (API de Parceiros — Contrato Fixo)"
---

# Tasks: F05 — API de Parceiros (Contrato Fixo)

**Input**: Design documents from `/specs/005-f05-partner-api/`

**Prerequisites**: `spec.md`, `plan.md`, `contract.md`, e features `F01`, `F02`, `F03` concluídas em `main`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Pode rodar em paralelo (arquivos independentes)
- **[Story]**: User story correspondente (`US1`, `US2`, `US3`, `US4`)

---

## Phase 1: Setup e Hook de Autenticação (User Story 1 — Priority: P1)

**Goal**: Proteger todo o prefixo `/api/partner/*` com validação prévia de `X-Api-Key` retornando `401 {"error":"unauthorized"}`.

- [x] T001 Verificar exportações de `env.PARTNER_API_KEY`, `purchaseTicket`, `getEventSeatMetrics` e tipos de erro de domínio em `src/modules/purchase/`.
- [x] T002 [US1] Criar `src/modules/partner/partner.routes.ts` com plugin Fastify, hook `onRequest` validando `X-Api-Key === env.PARTNER_API_KEY` (retornando `401 {"error":"unauthorized"}`) e `setErrorHandler` escopado convertendo erros de JSON malformado em `422 {"error":"invalid_request"}`.
- [x] T003 [US1] Registrar `partnerRoutes` em `src/app.ts` com `{ prefix: '/api/partner' }`.

**Checkpoint**: Qualquer chamada a `/api/partner/*` sem `X-Api-Key` válido retorna `401 {"error":"unauthorized"}`.

---

## Phase 2: Listagem de Eventos (User Story 2 — Priority: P1)

**Goal**: Implementar `GET /api/partner/events` retornando apenas eventos publicados com `id`, `name`, `startsAt`, `priceCents`, `availableSeats`.

- [x] T004 [US2] Implementar `GET /events` em `src/modules/partner/partner.routes.ts` consultando apenas eventos com `status = 'published'` ordenados por `starts_at ASC`, calculando `availableSeats` via `getEventSeatMetrics()` e serializando `startsAt` em ISO-8601.

**Checkpoint**: `GET /api/partner/events` retorna lista conforme `R02` e `R05`.

---

## Phase 3: Compra de Ingresso e Ordem Estrita de Validação (User Story 3 — Priority: P1)

**Goal**: Implementar `POST /api/partner/events/:eventId/purchases` respeitando estritamente `401` → `422` → `404` → `409` → `202` e lock concorrente de `F03`.

- [x] T005 [US3] Implementar validadores puros em `src/modules/partner/partner.routes.ts` para `buyerEmail` (formato de e-mail válido), `cardNumber` (`typeof === 'string'` e `/^\d{16}$/`) e formato UUID de parâmetros de rota.
- [x] T006 [US3] Implementar `POST /events/:eventId/purchases` em `src/modules/partner/partner.routes.ts` aplicando validação `422 {"error":"invalid_request"}` antes de consultar o evento, mapeando UUID inválido/inexistente/`draft`/`cancelled` para `404 {"error":"event_not_available"}`, `sold_out` para `409 {"error":"sold_out"}` e sucesso de `purchaseTicket({ ..., channel: 'partner_api', userId: null })` para `202 {"ticketId","code","status":"pending"}`.

**Checkpoint**: Compras via API seguem ordem exata do contrato e usam `SELECT ... FOR UPDATE` via `F03`.

---

## Phase 4: Consulta de Ingresso de Qualquer Canal (User Story 4 — Priority: P1)

**Goal**: Implementar `GET /api/partner/tickets/:ticketId` retornando status e `checkedIn` para ingressos de qualquer canal ou `404 {"error":"ticket_not_found"}`.

- [x] T007 [US4] Implementar `GET /tickets/:ticketId` em `src/modules/partner/partner.routes.ts` validando UUID, buscando na tabela `tickets` sem filtro de canal, retornando `200 {"ticketId","code","eventId","status","checkedIn"}` ou `404 {"error":"ticket_not_found"}`.

**Checkpoint**: Todas as 3 rotas do contrato fixo implementadas.

---

## Phase 5: Testes de Contrato, Gateway e Concorrência

**Purpose**: Validar todos os critérios `F05-AC1`..`F05-AC6` e `CF-07`..`CF-08`, incluindo o teste de estresse concorrente.

- [x] T008 Escrever `tests/f05.partner-api.test.ts` cobrindo:
  - `401 {"error":"unauthorized"}` nas 3 rotas (ausente/inválida, inclusive precedendo `422`/`404`) (`F05-AC1`);
  - `GET /api/partner/events` ocultando `draft`/`cancelled`, refletindo publicação de `F02` e `availableSeats` correto (`F05-AC2`, `CF-07`);
  - Ordem de validação `422` → `404` → `409` → `202` em `POST /api/partner/events/:eventId/purchases` (`F05-AC3`, `F05-AC4`, `CF-07`);
  - Teste de concorrência com **30 requisições simultâneas** em evento de lotação `5`, repetido em **pelo menos 2 rodadas independentes**, verificando exatamente `5 × 202` e `25 × 409 {"error":"sold_out"}` por rodada (`F05-AC5`, `CF-08`);
  - `GET /api/partner/tickets/:ticketId` refletindo `pending` → `confirmed`/`declined` (com liberação de vaga em `0002`), funcionando para ingresso da vitrine (`storefront`) e retornando `404 {"error":"ticket_not_found"}` para ID inexistente (`F05-AC6`, `CF-08`).
- [x] T009 Executar `./scripts/gates.sh` e confirmar exit code `0` em typecheck e todos os testes.
- [ ] T010 Executar smoke test HTTP com `curl` contra `./scripts/up.sh` validando cabeçalho `X-Api-Key`, payloads e status codes literais.

---

## Dependencies & Execution Order

- **Phase 1** bloqueia Phases 2, 3 e 4.
- **T004**, **T005/T006** e **T007** operam no mesmo arquivo `src/modules/partner/partner.routes.ts` e são executados em sequência lógica.
- **Phase 5** valida o contrato completo via `./scripts/gates.sh` antes da avaliação independente.
