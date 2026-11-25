---
description: "Checklist executável de tarefas para F03 — Motor de Compras, Concorrência e Gateway Simulado"
---

# Tasks: F03 — Motor de Compras, Concorrência e Gateway Simulado

**Input**: Design documents from `/specs/003-f03-purchase-gateway/`  
**Prerequisites**: `F01` e `F02` aprovadas e mescladas, `spec.md`, `plan.md`, `contract.md`  
**Branch**: `feat/f03-purchase-gateway`

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Pode ser executado em paralelo (arquivos distintos, sem dependências)
- **[Story]**: História de usuário associada (`US1`, `US2`, `US3`)

---

## Phase 1: Gateway de Pagamento Simulado (`gateway.service.ts`)

**Purpose**: Implementar resolução de finais de cartão (`0001`–`0004` + fallback), temporização configurável e callback atômico protegido contra cancelamento (`R08`, `R11`).

- [x] T001 [US3] Criar `src/modules/purchases/gateway.service.ts` com `getGatewayTimingConfig()` lendo `GATEWAY_FAST_MIN_MS` (2000), `GATEWAY_FAST_MAX_MS` (5000), `GATEWAY_SLOW_MIN_MS` (30000), `GATEWAY_SLOW_MAX_MS` (40000) e `resolveSimulatedGatewayDecision(cardNumber, config)` para finais `0001`, `0002`, `0003`, `0004` e fallback.
- [x] T002 [US3] Implementar `applyGatewayOutcome(ticketId, outcome)` em `src/modules/purchases/gateway.service.ts` usando atualização SQL atômica:
  `UPDATE tickets SET status = $newStatus, updated_at = NOW() WHERE id = $ticketId AND status = 'pending' AND EXISTS (SELECT 1 FROM events WHERE id = tickets.event_id AND status = 'published')`.
- [x] T003 [US3] Implementar `scheduleSimulatedPayment(ticketId, cardNumber)` com rastreamento de timers e promessas pendentes, mais `clearPendingGatewayTimers()` e `waitForPendingGatewayCallbacks()`, e integrar limpeza no shutdown de `src/server.ts`.

---

## Phase 2: Motor Transacional de Compras e Métricas de Vagas (`purchase.service.ts`)

**Purpose**: Implementar `purchaseTicket()` com lock `FOR UPDATE`, geração de código único, congelamento de preço e `getEventSeatMetrics()`.

- [x] T004 [US1] Criar `src/modules/purchases/purchase.service.ts` com erros de domínio (`InvalidPurchaseRequestError`, `EventNotAvailableError`, `SoldOutError`), validação pré-transação (`buyerEmail` válido e `cardNumber` `/^\d{16}$/`) e gerador de código único alfanumérico de 8 caracteres maiúsculos (`[A-Z0-9]{8}`).
- [x] T005 [US1] Implementar `getOccupiedSeatCount(eventId, executor?)` (`status IN ('pending', 'confirmed')`) e `getEventSeatMetrics(eventId, executor?)` retornando `{ capacity, occupied, available }` com `available = 0` quando `event.status === 'cancelled'` (`R05`).
- [x] T006 [US2] Implementar `purchaseTicket({ eventId, buyerEmail, cardNumber, userId?, channel })` em `src/modules/purchases/purchase.service.ts`:
  - valida cartão e e-mail antes da transação;
  - abre transação PostgreSQL com `SELECT ... FROM events WHERE id = $1 FOR UPDATE`;
  - valida `status === 'published'`;
  - valida `occupied < capacity` (lançando `SoldOutError` se esgotado);
  - insere ingresso `pending` com `price_cents` congelado e `code` único (retry em colisão `23505`);
  - após commit, agenda `scheduleSimulatedPayment()` e retorna imediatamente.
- [x] T007 [US1] Exportar helpers de leitura `getTicketById(ticketId)` e `listTicketsByUserId(userId)` em `src/modules/purchases/purchase.service.ts` para consumo de `F04` e `F05`.

---

## Phase 3: Integração com `F02` (R03)

**Purpose**: Unificar o cálculo de vagas ocupadas na validação de edição de lotação do evento (`CF-03`, `R03`).

- [x] T008 [US1] Atualizar `src/modules/events/events.service.ts` para usar `getOccupiedSeatCount(eventId, tx)` de `src/modules/purchases/purchase.service.ts` ao validar redução de `capacity` em `updateEvent()`.

---

## Phase 4: Suíte de Testes Automatizados e Concorrência

**Purpose**: Validar integralmente `F03-AC1`–`F03-AC5`, `CF-02` e `CF-03`, incluindo testes reais de concorrência no PostgreSQL.

- [x] T009 [US1] Criar `tests/f03.purchase-gateway.test.ts` cobrindo:
  - `CF-02` / `F03-AC1` / `F03-AC5`: criação imediata de ingresso `pending` com `user_id` de participante de `F01` (e também com `user_id = null` para `partner_api`), código único 8 chars maiúsculos e restrição `UNIQUE` no banco, atualização correta de `getEventSeatMetrics()` (incluindo `available = 0` para evento `cancelled`);
  - `CF-03` / `F03-AC4`: recusa de compra em evento `draft` de `F02`, aceitação após `publishEvent()`, congelamento de `price_cents` mesmo após `updateEvent()` mudar o preço do evento, e bloqueio em `updateEvent()` ao tentar reduzir `capacity` abaixo de vagas ocupadas criadas por `purchaseTicket()`;
  - `F03-AC2` (`R07`): teste de concorrência real com `30` chamadas simultâneas (`Promise.all`) para evento de lotação `5` (em múltiplas rodadas), validando exatamente `5` sucessos e `25` erros `SoldOutError` (`sold_out`);
  - `F03-AC3` (`R08` + guarda `R11`): validação prévia de cartão inválido sem inserir ingresso; verificação dos valores padrão de timing (`2000–5000ms` e `30000–40000ms`); execução assíncrona real dos 5 cenários (`0001`→`confirmed`, `0002`→`declined` liberando vaga para nova compra, `0003`→`confirmed`, `0004`→`declined`, `9999`→`declined`); e prova de que callback tardio de `0003` não sobrescreve ingresso já `cancelled` em evento `cancelled`.
- [x] T010 [US2] Executar `./scripts/gates.sh` e confirmar que typecheck e todas as suítes (`F01`, `F02`, `F03`) passam com exit code `0`.
