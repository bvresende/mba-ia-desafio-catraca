---
description: "Checklist de tarefas executáveis para implementação da Feature F07 (Cancelamento Irreversível e Estorno)"
---

# Tasks: F07 — Cancelamento Irreversível de Eventos e Estorno/Cancelamento

**Input**: Design documents from `/specs/007-f07-event-cancellation/`

**Prerequisites**: `spec.md`, `plan.md`, `contract.md`, e todas as features `F01`–`F06` concluídas e mescladas em `main`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Pode rodar em paralelo (arquivos independentes)
- **[Story]**: User story correspondente (`US1`, `US2`, `US3`)

---

## Phase 1: Setup e Auditoria dos Guards Existentes

**Purpose**: Confirmar alinhamento de `F02`, `F03`, `F04`, `F05` e `F06` com o estado `cancelled`.

- [ ] T001 Inspecionar `src/modules/events/` (bloqueio de edição/republicação em `cancelled`), `src/modules/purchase/` (guard condicional do callback do gateway contra `cancelled`) e `src/modules/checkin/` (métricas e `Evento cancelado` para eventos cancelados).
- [ ] T002 Ajustar, se necessário, qualquer ponto em `F02`/`F03`/`F06` para garantir que: edição/republicação rejeitam `cancelled`, callback tardio de gateway nunca altera `cancelled`, `availableSeats` retorna `0` e `Check-ins` conta `status = 'confirmed' AND checked_in = true`.

---

## Phase 2: Serviço Transacional e Rota de Cancelamento (User Story 1 — Priority: P1)

**Goal**: Implementar o cancelamento irreversível atômico sob `SELECT ... FOR UPDATE` e `R13`.

- [ ] T003 [US1] Implementar `cancelEvent(eventId, organizerId)` em `src/modules/cancellation/cancellation.service.ts` abrindo transação PostgreSQL com `SELECT ... FROM events WHERE id = $1 FOR UPDATE`, validando ownership (`R13`) e `status === 'published'`, atualizando `events.status = 'cancelled'`, `tickets` `confirmed` → `refunded` e `tickets` `pending` → `cancelled`.
- [ ] T004 [US1] Implementar `POST /organizer/events/:eventId/cancel` em `src/modules/cancellation/cancellation.routes.ts` protegida por `requireOrganizer`, invocando `cancelEvent`, bloqueando não-proprietários (`403`/`404`) e redirecionando (`303`) para `/organizer/events/:eventId` em sucesso.
- [ ] T005 [US1] Registrar `cancellationRoutes` em `src/app.ts`.

**Checkpoint**: Endpoint `POST /organizer/events/:eventId/cancel` operacional e transacional.

---

## Phase 3: Interface de Gestão de Evento Cancelado (User Stories 1 & 3 — Priority: P1)

**Goal**: Exibir o botão de cancelar em eventos publicados e bloquear edição/publicação + exibir `Evento cancelado` no check-in quando o evento estiver cancelado.

- [ ] T006 [US1] Atualizar `src/views/organizer.views.ts` na página `/organizer/events/:eventId` para:
  - Exibir ação de cancelamento (`POST /organizer/events/:eventId/cancel`) apenas quando `event.status === 'published'`;
  - Quando `event.status === 'cancelled'`, desabilitar/ocultar edição e publicação, destacar estado cancelado e exibir literalmente `Evento cancelado` na área de check-in;
  - Exibir os 6 indicadores do painel refletindo `Confirmados: 0`, `Pendentes: 0`, `Check-ins: 0`, `Vagas disponíveis: 0`, `Receita: R$ 0,00` e `Estornados`.

**Checkpoint**: UI do organizador reflete completamente a irreversibilidade e o impacto no painel/check-in.

---

## Phase 4: Testes End-to-End Integrados e Validação Final (US1, US2, US3)

**Purpose**: Cobrir todos os critérios `F07-AC1`..`F07-AC5` e `CF-12`..`CF-16`, incluindo callback tardio do gateway lento.

- [ ] T007 [US2] Escrever `tests/f07.cancellation.test.ts` cobrindo:
  - Cancelamento irreversível pelo Organizador A, bloqueio de Organizador B/participante/visitante e bloqueio de edição/republicação pós-cancelamento (`F07-AC1`, `CF-12`);
  - Transição imediata (< 10s) de `confirmed` (com e sem check-in, vitrine + API) → `refunded`, `pending` → `cancelled` e preservação de `declined` (`F07-AC2`, `CF-13`);
  - Proteção contra callback tardio de gateway com cartões `0003` (aprovação lenta) e `0004` (recusa lenta): ingressos passam a `cancelled` imediatamente e permanecem `cancelled` depois que o gateway conclui (`F07-AC3`, `CF-13`);
  - Desaparecimento do evento na vitrine `GET /` e exibição literal de `estornado`/`cancelado` em `GET /my-tickets` (`CF-14`);
  - Desaparecimento em `GET /api/partner/events`, resposta `404 {"error":"event_not_available"}` em `POST /api/partner/events/:id/purchases` e status `refunded`/`cancelled` em `GET /api/partner/tickets/:id` (`CF-15`);
  - Página `/organizer/events/:id` com edição bloqueada, check-in exibindo `Evento cancelado` (e prioridade 1 preservada para código de outro evento) e painel exibindo `Confirmados: 0`, `Pendentes: 0`, `Check-ins: 0`, `Vagas disponíveis: 0`, `Receita: R$ 0,00` e `Estornados` exato (`F07-AC4`, `F07-AC5`, `CF-16`);
  - Corrida concorrente entre `purchaseTicket` e `cancelEvent` sem inconsistência de estado.
- [ ] T008 Executar `./scripts/gates.sh` e confirmar exit code `0` em typecheck e em toda a suíte `F01`–`F07`.
- [ ] T009 Executar smoke test real contra `./scripts/up.sh` com cartão `0003` aguardando 45s após o cancelamento para confirmar comportamento real de produção antes da avaliação independente.

---

## Dependencies & Execution Order

- **Phase 1** prepara e confirma todos os pontos de integração `F02`–`F06`.
- **Phase 2** (`T003` → `T004` → `T005`) implementa o core transacional e a rota.
- **Phase 3** (`T006`) atualiza a interface de gestão.
- **Phase 4** (`T007` → `T008` → `T009`) fecha a validação E2E completa antes da avaliação independente contra `contract.md`.
