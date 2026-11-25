# Implementation Plan: F07 — Cancelamento Irreversível de Eventos e Estorno/Cancelamento

**Branch**: `007-f07-event-cancellation` | **Date**: 2026-11-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/007-f07-event-cancellation/spec.md`

## Summary

Implementar o módulo de cancelamento irreversível de eventos (`src/modules/cancellation/cancellation.service.ts` e `src/modules/cancellation/cancellation.routes.ts`) expondo `POST /organizer/events/:eventId/cancel` sob proteção de propriedade (`R13`), executando em transação PostgreSQL única com lock pessimista `SELECT ... FOR UPDATE` para transicionar `events.status = 'cancelled'`, ingressos `confirmed` → `refunded` e ingressos `pending` → `cancelled`. Integrar o botão de cancelamento e o estado bloqueado na página `/organizer/events/:eventId`, revisar/confirmar os guards de `F02`–`F06` e validar ponta a ponta (incluindo resposta tardia de gateway `0003`/`0004`) em `tests/f07.cancellation.test.ts`.

## Technical Context

**Language/Version**: TypeScript (strict) sobre Node.js 24 LTS

**Primary Dependencies**: Fastify 5, Drizzle ORM (`pg`), SSR HTML/CSS templates

**Storage**: PostgreSQL 16 (tabelas `events` e `tickets` em `src/db/schema.ts`, usando `SELECT ... FOR UPDATE`)

**Testing**: Vitest (`tests/f07.cancellation.test.ts` contra `catraca_test` cobrindo toda a integração `F02`–`F07` e race condition com gateway lento)

**Target Platform**: Linux (container Docker `app` + `db` servindo em `http://localhost:3000`)

**Project Type**: web-service (monólito modular Fastify 5 com SSR HTML + REST API)

**Performance Goals**: Cancelamento completo (evento + estorno/cancelamento em massa de ingressos) em < 200ms (teto de `R11`: <= 10 segundos).

**Constraints**: Zero novas migrations; lock pessimista alinhado ao mesmo row lock de `F03` (`events` row `FOR UPDATE`) prevenindo corrida entre compra e cancelamento; irreversibilidade absoluta (edição e republicação bloqueadas); proteção definitiva contra callbacks tardios (`0003`/`0004`).

**Scale/Scope**: 1 módulo novo (`src/modules/cancellation/`), ajuste pontual na view `/organizer/events/:eventId` e revisão de guards em `F02`/`F03`/`F06`, mais 1 suíte integrada ponta a ponta (`tests/f07.cancellation.test.ts`).

## Constitution Check

- **Princípio I (Spec-Driven & Contract-First)**: `spec.md`, `plan.md`, `tasks.md` e `contract.md` cobrindo 100% de `F07-AC1`..`F07-AC5` e `CF-12`..`CF-16`. **PASS**.
- **Princípio II (Strict Rule Fidelity)**: Transições exatas (`confirmed` → `refunded`, `pending` → `cancelled`), irreversibilidade, mensagens literais e painel zerado (`R05`, `R10`, `R11`, `R12`, `R13`). **PASS**.
- **Princípio III (Concurrency & State Safety)**: Lock pessimista `SELECT ... FROM events WHERE id = $1 FOR UPDATE` serializa compra vs cancelamento, e guard `WHERE id = $1 AND status = 'pending'` no callback do gateway protege contra respostas tardias de 30–40s. **PASS**.
- **Princípio IV (Minimal Harness)**: Suíte completa executada via `./scripts/gates.sh` contra `catraca_test`. **PASS**.
- **Princípio V (Independent Evaluation)**: Será avaliada em contexto limpo contra `contract.md`, incluindo teste real de 45s contra o runtime Docker com cartões `0003`/`0004`. **PASS**.
- **Princípio VI (Simplicity & SSR)**: Ação POST simples em SSR HTML sem filas externas nem jobs distribuídos desnecessários. **PASS**.

## Project Structure

### Documentation (this feature)

```text
specs/007-f07-event-cancellation/
├── spec.md              # Especificação funcional do cancelamento irreversível
├── plan.md              # Este plano de implementação
├── tasks.md             # Checklist executável de tarefas
├── contract.md          # Contrato verificável com rastreabilidade PRD (F07-AC1..AC5 + CF-12..CF-16)
└── reports/             # Relatórios imutáveis de avaliação independente (eval-NNN.md)
```

### Source Code (repository root)

```text
src/
├── app.ts                                        # Registra cancellationRoutes
├── modules/
│   ├── events/                                   # Revisão: garante bloqueio de edição/republicação quando status === 'cancelled'
│   ├── purchase/                                 # Revisão: garante guard no callback do gateway contra eventos cancelados
│   ├── checkin/                                  # Revisão: garante check-in 'Evento cancelado' e painel zerado + Estornados
│   └── cancellation/
│       ├── cancellation.service.ts               # cancelEvent(eventId, organizerId) com transação + SELECT FOR UPDATE
│       └── cancellation.routes.ts                # POST /organizer/events/:eventId/cancel
└── views/
    └── organizer.views.ts                        # Botão cancelar (published) + estado bloqueado/Evento cancelado (cancelled)

tests/
└── f07.cancellation.test.ts                      # Testes E2E integrando F02, F03, F04, F05, F06 e F07
```

**Structure Decision**: Centralizar a transação atômica em `src/modules/cancellation/` mantém a responsabilidade limpa e permite verificar explicitamente todas as integrações com `F02`–`F06` na Wave 5.

## Design Details

### 1. Serviço Transacional (`src/modules/cancellation/cancellation.service.ts`)
- Função `cancelEvent(eventId: string, organizerId: string)`:
  - Valida formato UUID de `eventId`.
  - Abre `db.transaction(async (tx) => { ... })`:
    1. Executa lock pessimista na linha do evento:
       ```sql
       SELECT id, owner_id, status FROM events WHERE id = $1 FOR UPDATE
       ```
    2. Se não existir ou `event.owner_id !== organizerId` → lança erro de acesso negado/não encontrado (`403`/`404`, `R13`).
    3. Se `event.status !== 'published'` → lança erro de domínio (`event_not_cancellable`: rascunhos não publicados ou eventos já cancelados não são transicionados novamente).
    4. Atualiza o evento:
       ```sql
       UPDATE events SET status = 'cancelled', updated_at = NOW() WHERE id = $1
       ```
    5. Estorna todos os ingressos confirmados (incluindo os que já fizeram check-in):
       ```sql
       UPDATE tickets SET status = 'refunded', updated_at = NOW()
       WHERE event_id = $1 AND status = 'confirmed'
       ```
    6. Cancela todos os ingressos pendentes:
       ```sql
       UPDATE tickets SET status = 'cancelled', updated_at = NOW()
       WHERE event_id = $1 AND status = 'pending'
       ```
    7. Retorna `{ eventId, refundedCount, cancelledPendingCount }`.

### 2. Rota HTTP (`src/modules/cancellation/cancellation.routes.ts`)
- `POST /organizer/events/:eventId/cancel`:
  - Protegida por `requireOrganizer`.
  - Chama `cancelEvent(eventId, request.user.id)`.
  - Sucesso → redireciona (`303 See Other`) para `/organizer/events/${eventId}?cancelled=1`.
  - Erro de ownership/inexistente → `403`/`404` sem vazar dados do evento.
  - Erro `event_not_cancellable` → `409` ou redirecionamento com mensagem clara preservando o estado atual.

### 3. Integração na View e Verificação Cross-Feature (`F02`–`F06`)
- **`src/views/organizer.views.ts`**:
  - Quando `event.status === 'published'`: exibir seção/botão `Cancelar evento` (`<form method="POST" action="/organizer/events/${event.id}/cancel">`).
  - Quando `event.status === 'cancelled'`:
    - Exibir badge/aviso `Evento cancelado`.
    - Ocultar/desabilitar formulário de edição e botão de publicação (e o botão de cancelar).
    - Na seção de check-in, exibir `Evento cancelado` (mantendo o endpoint `POST /organizer/events/:eventId/checkin` respondendo `Evento cancelado` para códigos válidos do evento e `Ingresso inválido para este evento` para códigos inexistentes/de outros eventos).
- **Verificação de `F02`**: confirmar que `POST /organizer/events/:eventId/edit` e `POST /organizer/events/:eventId/publish` recusam eventos com `status === 'cancelled'` (`409`/`422`).
- **Verificação de `F03`**: confirmar que o callback assíncrono do gateway atualiza apenas com guarda atômica (`WHERE id = $1 AND status = 'pending'` e verificando `events.status = 'published'`), de modo que timers pendentes de `0003` e `0004` nunca alteram um ingresso já marcado como `cancelled`.
- **Verificação de `F04`, `F05`, `F06`**: confirmar que `GET /`, `GET /my-tickets`, `GET /api/partner/events`, `POST /api/partner/events/:id/purchases`, `GET /api/partner/tickets/:id`, `POST /organizer/events/:id/checkin` e `getEventDashboardMetrics()` já reagem automaticamente ao novo estado `cancelled`/`refunded`/`cancelled`.

### 4. Estratégia de Testes (`tests/f07.cancellation.test.ts`)
- Criar cenário completo com um evento `published` de lotação `10`, preço `R$ 100,00`, contendo:
  - 1 ingresso vitrine `confirmed` sem check-in;
  - 1 ingresso API `confirmed` **com check-in** (`checked_in = true`);
  - 1 ingresso vitrine `pending` (cartão lento `0003`, aprovação tardia);
  - 1 ingresso API `pending` (cartão lento `0004`, recusa tardia);
  - 1 ingresso `declined` (cartão `0002`).
- Validar:
  1. Bloqueio de cancelamento por visitante, participante e Organizador B (`R13`).
  2. Cancelamento pelo Organizador A transiciona em < 1s: evento → `cancelled`, os 2 `confirmed` → `refunded`, os 2 `pending` → `cancelled`, o `declined` → permanece `declined` (`F07-AC1`, `F07-AC2`, `CF-13`).
  3. Após aguardar além do delay lento do gateway (`GATEWAY_SLOW_MAX_MS + margem`), os 2 ingressos de `0003` e `0004` **permanecem `cancelled`** (`F07-AC3`, `CF-13`).
  4. Tentativas de editar e republicar o evento em `F02` são rejeitadas (`F07-AC1`, `CF-12`).
  5. Evento desaparece de `GET /` (`F04`) e `/my-tickets` exibe `estornado` e `cancelado` (`CF-14`).
  6. Evento desaparece de `GET /api/partner/events`, `POST /api/partner/events/:id/purchases` retorna `404 {"error":"event_not_available"}` e `GET /api/partner/tickets/:id` retorna `refunded` e `cancelled` (`CF-15`).
  7. Na página `/organizer/events/:id`, edição está desabilitada, check-in exibe `Evento cancelado` e painel exibe `Confirmados: 0`, `Pendentes: 0`, `Check-ins: 0`, `Vagas disponíveis: 0`, `Receita: R$ 0,00` e `Estornados: 2` (`F07-AC4`, `F07-AC5`, `CF-16`).

## Complexity Tracking

Nenhuma violação à Constituição identificada. A reutilização do mesmo row lock `SELECT ... FROM events WHERE id = $1 FOR UPDATE` entre `F03` e `F07` elimina integralmente a condição de corrida entre compra concorrente e cancelamento.
