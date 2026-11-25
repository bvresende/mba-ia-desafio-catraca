---
description: "Checklist de tarefas executáveis para implementação da Feature F06 (Check-in e Painel do Organizador)"
---

# Tasks: F06 — Check-in e Painel do Organizador

**Input**: Design documents from `/specs/006-f06-checkin-dashboard/`

**Prerequisites**: `spec.md`, `plan.md`, `contract.md`, e features `F01`, `F02`, `F03` concluídas em `main`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Pode rodar em paralelo (arquivos independentes)
- **[Story]**: User story correspondente (`US1`, `US2`, `US3`)

---

## Phase 1: Setup e Serviços de Domínio

**Purpose**: Construir os serviços puros de métricas do painel e lógica de check-in desacoplados da camada HTTP.

- [x] T001 Verificar rotas e views existentes de `/organizer/events/:eventId` em `src/modules/events/` e `src/views/organizer.views.ts`, além de `requireOrganizer` em `src/modules/auth/`.
- [x] T002 [P] [US1] Implementar `getEventDashboardMetrics(eventId)` em `src/modules/checkin/dashboard.service.ts` agregando `confirmed`, `pending`, `checkedIn` (`status = 'confirmed' AND checked_in = true`), `availableSeats` (`R05`, `0` se cancelado), `revenueCents` (soma de `price_cents` dos `confirmed`) e `refunded` sobre todos os canais (`storefront` + `partner_api`).
- [x] T003 [P] [US2] Implementar `performCheckin(eventId, organizerId, rawCode)` em `src/modules/checkin/checkin.service.ts` validando ownership (`R13`), normalizando código e aplicando estritamente a ordem `R10` (`Ingresso inválido para este evento` → `Evento cancelado` → `Ingresso não confirmado` → `Ingresso já utilizado` → update atômico `WHERE id = $1 AND checked_in = false AND status = 'confirmed'` → `Entrada liberada`).

**Checkpoint**: Serviços de painel e check-in prontos e testáveis independentemente.

---

## Phase 2: Integração de Rotas e UI SSR na Página de Gestão (US1, US2, US3)

**Goal**: Exibir o painel de 6 indicadores e o formulário de check-in em `/organizer/events/:eventId` e expor `POST /organizer/events/:eventId/checkin` sob proteção `R13`.

- [x] T004 [US1] Atualizar `GET /organizer/events/:eventId` e `src/views/organizer.views.ts` para carregar `getEventDashboardMetrics(event.id)` e renderizar os 6 indicadores rotulados (`Confirmados`, `Pendentes`, `Check-ins`, `Vagas disponíveis`, `Receita` formatada em BRL com espaço regular ex.: `R$ 350,00`, `Estornados`) além do formulário de check-in (`POST /organizer/events/:eventId/checkin`).
- [x] T005 [US2] Implementar `src/modules/checkin/checkin.routes.ts` com rota `POST /organizer/events/:eventId/checkin` protegida por `requireOrganizer` (`US3`), invocando `performCheckin`, tratando erro de ownership (`403`/`404`) sem vazamento e renderizando a página de gestão com a mensagem literal retornada e o painel atualizado.
- [x] T006 [US2] Registrar `checkinRoutes` em `src/app.ts`.

**Checkpoint**: Página `/organizer/events/:eventId` hospeda painel consolidado e operação de check-in sob isolamento `R13`.

---

## Phase 3: Testes Automatizados e Validação Final

**Purpose**: Cobrir integralmente `F06-AC1`..`F06-AC6` e `CF-09`..`CF-11` e validar nos gates.

- [x] T007 Escrever `tests/f06.checkin-dashboard.test.ts` cobrindo:
  - Renderização dos 6 indicadores e formulário de check-in na página de gestão (`F06-AC1`, `CF-10`);
  - Todas as 5 mensagens literais de `R10` em ordem estrita, incluindo código inexistente, código de outro evento (inclusive quando evento alvo está cancelado), evento cancelado com código válido, ingressos `pending`/`declined`/`cancelled`/`refunded`, entrada liberada e reutilização/concorrência (`F06-AC2`, `CF-11`);
  - Preservação de `status = 'confirmed'` após check-in e atualização correta de `Confirmados` vs `Check-ins` (`F06-AC3`);
  - Consolidação de vendas `storefront` + `partner_api` nos 6 indicadores (`F06-AC4`, `CF-11`);
  - Receita com mudança de preço (`2 × R$ 100,00 + 1 × R$ 150,00 = R$ 350,00`) (`F06-AC5`, `CF-11`);
  - Bloqueio de visitante, participante (`CF-09`) e Organizador B (`F06-AC6`, `CF-10`) no painel e no check-in.
- [x] T008 Executar `./scripts/gates.sh` e confirmar exit code `0` em typecheck e todos os testes.
- [ ] T009 Executar smoke test manual contra `./scripts/up.sh` validando painel, check-in e bloqueio entre Organizador A e Organizador B.

---

## Dependencies & Execution Order

- **T002** e **T003** podem ser implementados em paralelo em arquivos independentes dentro de `src/modules/checkin/`.
- **T004** e **T005** dependem de **T002** e **T003**.
- **T007–T009** executam após **T006**, antes da avaliação independente contra `contract.md`.
