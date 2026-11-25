---
description: "Checklist de tarefas executáveis para implementação da Feature F04 (Vitrine Pública e Meus Ingressos)"
---

# Tasks: F04 — Vitrine Pública e Área do Participante ("Meus ingressos")

**Input**: Design documents from `/specs/004-f04-storefront-tickets/`

**Prerequisites**: `spec.md`, `plan.md`, `contract.md`, e features `F01`, `F02`, `F03` concluídas em `main`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Pode rodar em paralelo (arquivos independentes)
- **[Story]**: User story correspondente (`US1`, `US2`, `US3`)

---

## Phase 1: Setup e Preparação

**Purpose**: Garantir ambiente e contratos de integração com `F01`, `F02` e `F03`.

- [ ] T001 Verificar assinaturas exportadas de `requireParticipant` (`src/modules/auth/`), `purchaseTicket` e `getEventSeatMetrics` (`src/modules/purchase/`), e layout SSR (`src/views/layout.ts`).
- [ ] T002 Criar estrutura do módulo `src/modules/storefront/` e definir tipos de view-model para vitrine e ingressos do participante.

---

## Phase 2: User Story 1 — Vitrine Pública de Eventos Publicados (Priority: P1)

**Goal**: Exibir em `GET /` apenas eventos `published` com nome, data/hora, local, preço em R$, vagas disponíveis e rótulo literal `Ingressos esgotados` quando `availableSeats === 0`.

**Independent Test**: Acessar `GET /` deslogado e logado verificando visibilidade exclusiva de eventos `published` e exibição correta de disponibilidade e `Ingressos esgotados`.

- [ ] T003 [P] [US1] Implementar `renderStorefrontPage` e helpers de formatação (`formatPriceBrl`, `formatDateTimeBr`, `TICKET_STATUS_PT`) em `src/views/storefront.views.ts`, garantindo escape HTML e texto literal `Ingressos esgotados` quando `availableSeats === 0`.
- [ ] T004 [US1] Implementar rota `GET /` em `src/modules/storefront/storefront.routes.ts` consultando apenas eventos com `status = 'published'` ordenados por `starts_at ASC` e enriquecendo cada item com `getEventSeatMetrics(event.id)`.
- [ ] T005 [US1] Registrar `storefrontRoutes` em `src/app.ts` garantindo que `/` seja servido sem conflito com as rotas de `F01`–`F03`.

**Checkpoint**: Vitrine pública acessível em `http://localhost:3000/` listando apenas eventos publicados com vagas reais.

---

## Phase 3: User Story 2 — Compra na Vitrine pelo Participante (Priority: P1)

**Goal**: Permitir que participante autenticado compre 1 ingresso via `POST /events/:eventId/purchase` com cartão de 16 dígitos, retornando imediatamente com vaga ocupada e exibindo `Ingressos esgotados` quando sem vaga.

**Independent Test**: Submeter `POST /events/:eventId/purchase` autenticado como participante para evento com 1 vaga e para evento esgotado, validando redirecionamento imediato e mensagem `Ingressos esgotados`.

- [ ] T006 [US2] Adicionar formulário de compra (`POST /events/:eventId/purchase` com input `cardNumber` de 16 dígitos) nos cards disponíveis para participante autenticado em `src/views/storefront.views.ts`, e prompt de login/cadastro para visitantes.
- [ ] T007 [US2] Implementar rota `POST /events/:eventId/purchase` em `src/modules/storefront/storefront.routes.ts` protegida por `requireParticipant`, invocando `purchaseTicket` com `channel: 'storefront'`, redirecionando `303` para `/my-tickets` em sucesso e exibindo literalmente `Ingressos esgotados` (status `409`) quando ocorrer `sold_out`.
- [ ] T008 [US2] Tratar erros de cartão inválido (`422`) e evento indisponível (`404`) em `POST /events/:eventId/purchase` com feedback claro na vitrine sem criar ingresso.

**Checkpoint**: Fluxo completo de compra na vitrine integrado ao motor `F03`.

---

## Phase 4: User Story 3 — Página "Meus ingressos" (Priority: P1)

**Goal**: Listar em `GET /my-tickets` apenas os ingressos do participante logado com nome do evento, status literal em português e código único.

**Independent Test**: Comprar com cartões `0001` e `0002`, acessar `GET /my-tickets` antes e após a resposta do gateway e confirmar os rótulos `pendente`, `confirmado`, `recusado`, o código único e o isolamento entre participantes.

- [ ] T009 [P] [US3] Implementar `renderMyTicketsPage` em `src/views/storefront.views.ts` exibindo nome do evento, status literal em português (`pendente`, `confirmado`, `recusado`, `cancelado`, `estornado`) e código único do ingresso (`code`).
- [ ] T010 [US3] Implementar rota `GET /my-tickets` em `src/modules/storefront/storefront.routes.ts` protegida por `requireParticipant`, consultando exclusivamente ingressos de `tickets.user_id = request.user.id` com join em `events`.
- [ ] T011 [US3] Garantir link visível para "Meus ingressos" (`/my-tickets`) na navegação do layout quando autenticado como participante.

**Checkpoint**: Participante visualiza e acompanha o ciclo completo dos próprios ingressos.

---

## Phase 5: Testes Automatizados e Validação Final

**Purpose**: Cobrir todos os critérios `F04-AC1`..`F04-AC4` e `CF-04`..`CF-06` na suíte automatizada e validar gates.

- [ ] T012 Escrever testes de integração em `tests/f04.storefront.test.ts` cobrindo: visibilidade exclusiva de publicados (`F04-AC1`, `CF-05`), compra imediata e isolamento de participante (`F04-AC2`, `CF-04`), esgotamento por `pending`/`confirmed` exibindo `Ingressos esgotados` (`F04-AC3`, `CF-06`), transição assíncrona `0001` → `confirmado` e `0002` → `recusado` com liberação de vaga e exibição do código único e dos 5 rótulos em português (`F04-AC4`, `CF-06`).
- [ ] T013 Executar `./scripts/gates.sh` e confirmar que typecheck, checagens e toda a suíte de testes passam com código `0`.
- [ ] T014 Executar smoke test manual contra `./scripts/up.sh` verificando `GET /`, cadastro/login de participante, compra e `GET /my-tickets`.

---

## Dependencies & Execution Order

- **Phase 1** bloqueia Phases 2, 3 e 4.
- **Phase 2 (US1)** habilita a base de views e rotas usada por **Phase 3 (US2)** e **Phase 4 (US3)**.
- **T003** e **T009** podem ser elaborados juntos em `src/views/storefront.views.ts`.
- **Phase 5** executa após todas as rotas e views implementadas; somente após `./scripts/gates.sh` passar a feature segue para avaliação independente contra `contract.md`.
