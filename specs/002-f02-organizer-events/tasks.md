---
description: "Checklist executável de tarefas para F02 — Gestão de Eventos pelo Organizador"
---

# Tasks: F02 — Gestão de Eventos pelo Organizador

**Input**: Design documents from `/specs/002-f02-organizer-events/`  
**Prerequisites**: `F01` aprovada e mesclada, `spec.md`, `plan.md`, `contract.md`  
**Branch**: `feat/f02-organizer-events`

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Pode ser executado em paralelo (arquivos distintos, sem dependências)
- **[Story]**: História de usuário associada (`US1`, `US2`, `US3`)

---

## Phase 1: Serviço de Domínio de Eventos (`events.service.ts`)

**Purpose**: Implementar validações `R01`–`R03`, isolamento por `owner_id` (`R13`) e persistência transacional.

- [x] T001 [US1] Criar `src/modules/events/events.service.ts` com tipos de erro de domínio (`EventValidationError`, `EventNotFoundError`, `EventForbiddenError`, `EventStateError`) e parsers validados (`parsePriceToCents`, `parseFutureStartsAt`, `parseCapacity`).
- [x] T002 [US1] Implementar `createEvent(ownerId, input)` e `listOrganizerEvents(ownerId)` em `src/modules/events/events.service.ts`, garantindo status inicial `draft` e filtro estrito por `owner_id`.
- [x] T003 [US2] Implementar `getOrganizerEventOrThrow(eventId, ownerId)`, `countOccupiedSeats(eventId, executor)`, `updateEvent(ownerId, eventId, input)` (com lock `FOR UPDATE` na linha do evento, validação de data futura `R01`, bloqueio de redução de lotação abaixo de `pending + confirmed` `R03`, bloqueio se `cancelled`, atualização de `price_cents` sem tocar em `tickets`) e `publishEvent(ownerId, eventId)` (`R02`).
- [x] T004 [US2] Exportar helpers de leitura `getEventById(eventId)` e `listPublishedEvents()` em `src/modules/events/events.service.ts` para consumo de `F03`, `F04` e `F05`.

---

## Phase 2: Views SSR e Rotas do Organizador

**Purpose**: Entregar interface SSR completa da área do organizador com página de gestão em URL própria e slots extensíveis para `F06` e `F07`.

- [x] T005 [P] [US1] Criar `src/views/organizer.views.ts` com:
  - `renderOrganizerEventsListPage(user, events)` (`/organizer/events`);
  - `renderOrganizerNewEventPage(user, values?, error?)` (`/organizer/events/new`);
  - `renderOrganizerEventManagePage(user, event, options)` (`/organizer/events/:eventId`), exibindo dados, status, formulário de edição, ação de publicação quando `draft`, e slots opcionais (`dashboardHtml`, `checkinHtml`, `cancelHtml`) para `F06` e `F07`;
  - helper de formatação `formatPriceBRL(priceCents)` e `formatDateTimeLocal(date)`.
- [x] T006 [US2] Criar `src/modules/events/events.routes.ts` protegendo todas as rotas com `requireOrganizer`:
  - `GET /organizer/events`
  - `GET /organizer/events/new`
  - `POST /organizer/events`
  - `GET /organizer/events/:eventId`
  - `POST /organizer/events/:eventId/edit`
  - `POST /organizer/events/:eventId/publish`
  garantindo respostas `403`/`404` sem nenhum vazamento de dados quando outro organizador acessa evento alheio (`R13`).
- [x] T007 [US3] Registrar `eventsRoutes` em `src/app.ts` e atualizar `GET /organizer` para redirecionar organizadores autenticados para `/organizer/events`, preservando `requireOrganizer`.

---

## Phase 3: Suíte de Testes Automatizados e Validação

**Purpose**: Cobrir integralmente `F02-AC1`–`F02-AC7` e `CF-01` em `catraca_test`.

- [x] T008 [US1] Criar `tests/f02.events.test.ts` testando:
  - `CF-01` / `R13`: sessão de Organizador A (seed `F01`) acessa `/organizer/events` e cria evento; visitante e participante de `F01` são bloqueados;
  - `F02-AC1` / `F02-AC2`: criação válida nasce em `draft`; data passada, lotação `< 1`, preço `<= 0` e campos vazios são rejeitados na criação e data passada é rejeitada na edição;
  - `F02-AC3`: publicação muda status de `draft` para `published`;
  - `F02-AC4`: com ingressos `pending` e `confirmed` no banco, reduzir lotação abaixo da soma falha, ingressos `declined` não bloqueiam, aumentar lotação funciona;
  - `F02-AC5`: editar preço atualiza `events.price_cents` sem modificar `tickets.price_cents` já existente;
  - `F02-AC6`: página `/organizer/events/:eventId` renderiza edição, publicação e estrutura operacional;
  - `F02-AC7` / `R13`: Organizador B não vê evento de A em `/organizer/events` e recebe `403`/`404` sem nome nem dados do evento em `GET`, `POST .../edit` e `POST .../publish`.
- [x] T009 [US2] Executar `./scripts/gates.sh` e confirmar que `typecheck`, `tests/f01.foundation.test.ts` e `tests/f02.events.test.ts` passam 100% com exit code `0`.
