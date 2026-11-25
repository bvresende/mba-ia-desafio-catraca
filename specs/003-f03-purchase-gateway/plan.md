# Implementation Plan: F03 — Motor de Compras, Concorrência e Gateway Simulado

**Branch**: `feat/f03-purchase-gateway` | **Date**: 2026-11-25 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `/specs/003-f03-purchase-gateway/spec.md`

---

## Summary

Construir o motor transacional de compras (`src/modules/purchases/purchase.service.ts`) com lock pessimista `SELECT ... FOR UPDATE` no PostgreSQL contra overselling (`R07`), o gateway de pagamento simulado assíncrono (`src/modules/purchases/gateway.service.ts`) com resolução dos 5 cenários de cartão (`R08`) e guarda atômica anti-sobrescrita para eventos cancelados (`R11`), a função canônica `getEventSeatMetrics()` (`R05`) e a integração da contagem de vagas ocupadas na validação de edição de lotação de `F02` (`R03`).

---

## Technical Context

- **Language/Version**: TypeScript 5.x (strict) sobre Node.js 24 LTS
- **Primary Dependencies**: Drizzle ORM (`pg`), `node:crypto` (geração criptograficamente segura de códigos e IDs), `src/config/env.ts` e `src/db/*` de `F01`, `src/modules/events/events.service.ts` de `F02`
- **Storage**: PostgreSQL 16 (transações com row-level locking `FOR UPDATE` sobre `events` e constraint `UNIQUE` em `tickets.code`)
- **Testing**: Vitest em `catraca_test` (`tests/f03.purchase-gateway.test.ts`), incluindo testes reais de concorrência (`Promise.all` com 30 chamadas simultâneas)
- **Target Platform**: Linux/macOS em Docker Compose
- **Project Type**: Módulo de domínio/serviço compartilhado
- **Performance Goals**: Retorno de `purchaseTicket()` em < 100ms sem aguardar o gateway; zero deadlocks sob 30 requisições simultâneas
- **Constraints**: Default de latência estritamente aderente ao brief (`2000–5000ms` rápido, `30000–40000ms` lento) com override limpo para testes
- **Scale/Scope**: Motor único consumido por `F04`, `F05`, `F06` e `F07`

---

## Constitution Check

| Princípio | Verificação | Status |
| --- | --- | --- |
| I. Spec-Driven & Contract-First | `spec.md`, `plan.md`, `tasks.md`, `contract.md` alinhados a `F03-AC1`–`F03-AC5`, `CF-02`, `CF-03` | PASS |
| II. Strict Rule Fidelity | Finais `0001`–`0004` + fallback, delays padrão, status exatos e códigos únicos 8 chars | PASS |
| III. Concurrency & State Safety | `SELECT ... FROM events WHERE id = $1 FOR UPDATE` na compra + `UPDATE ... WHERE id = $1 AND status = 'pending' AND EXISTS (... status = 'published')` no callback | PASS |
| IV. Minimal, Self-Contained Harness | Testes unitários, integração e concorrência rodam dentro de `./scripts/gates.sh` em `catraca_test` | PASS |
| V. Independent Evaluation | Contrato cobre execução real de concorrência, gateway, congelamento de preço e integração com `F01`/`F02` | PASS |
| VI. Simplicity & SSR | Sem filas externas (Redis/RabbitMQ); `setTimeout` gerenciado + PostgreSQL transacional atendem com simplicidade máxima | PASS |

---

## Project Structure

### Documentation (this feature)

```text
specs/003-f03-purchase-gateway/
├── spec.md
├── plan.md
├── tasks.md
├── contract.md
└── reports/
```

### Source Code (files added/modified by F03)

```text
src/
├── modules/
│   ├── events/
│   │   └── events.service.ts           # Integra getOccupiedSeatCount() na validação de edição R03
│   └── purchases/
│       ├── gateway.service.ts          # Resolução de cartões, delays configuráveis, agendamento e callback atômico
│       └── purchase.service.ts         # purchaseTicket(), getEventSeatMetrics(), getOccupiedSeatCount(), erros tipados
└── server.ts                           # Limpeza de timers pendentes no shutdown gracioso
tests/
└── f03.purchase-gateway.test.ts        # Testes de domínio, concorrência 30x5, gateway, R03/R05/R07/R08/R09/R11, CF-02/CF-03
```

**Structure Decision**: Manter `gateway.service.ts` desacoplado de `purchase.service.ts` para permitir testes unitários determinísticos das regras de decisão/atraso de cartão e testes integrados reais de callback assíncrono no PostgreSQL.

---

## Detailed Design

### 1. Gateway Simulado (`src/modules/purchases/gateway.service.ts`)

- `resolveSimulatedGatewayDecision(cardNumber: string, config = getGatewayTimingConfig())`:
  - Verifica os 4 últimos dígitos (`cardNumber.slice(-4)`):
    - `'0001'` → `{ outcome: 'confirmed', minMs: fastMinMs, maxMs: fastMaxMs }`
    - `'0002'` → `{ outcome: 'declined', minMs: fastMinMs, maxMs: fastMaxMs }`
    - `'0003'` → `{ outcome: 'confirmed', minMs: slowMinMs, maxMs: slowMaxMs }`
    - `'0004'` → `{ outcome: 'declined', minMs: slowMinMs, maxMs: slowMaxMs }`
    - demais → `{ outcome: 'declined', minMs: fastMinMs, maxMs: fastMaxMs }`
  - Calcula atraso inteiro aleatório uniforme em `[minMs, maxMs]`.
- `applyGatewayOutcome(ticketId: string, outcome: 'confirmed' | 'declined')`:
  - Executa SQL atômico com guarda dupla (`R11`):
    ```sql
    UPDATE tickets
    SET status = $1, updated_at = NOW()
    WHERE id = $2
      AND status = 'pending'
      AND EXISTS (
        SELECT 1 FROM events
        WHERE id = tickets.event_id AND status = 'published'
      )
    RETURNING id, status
    ```
  - Retorna `true` se atualizou a linha ou `false` se foi ignorado (ex.: evento cancelado / ingresso já `cancelled`).
- `scheduleSimulatedPayment(ticketId: string, cardNumber: string, options?)`:
  - Registra o timer em um `Set<NodeJS.Timeout>` e uma promessa rastreada em um `Set<Promise<void>>`, removendo ao finalizar.
  - Captura erros de banco no callback com log estruturado (nunca gerando `unhandledRejection`).
- Helpers de ciclo de vida: `clearPendingGatewayTimers()` e `waitForPendingGatewayCallbacks()` (usados no shutdown do `server.ts` e no `afterEach` dos testes).

### 2. Motor de Compras (`src/modules/purchases/purchase.service.ts`)

- Erros de domínio exportados (prontos para mapeamento direto em `F04` e `F05`):
  - `InvalidPurchaseRequestError` (`code = 'invalid_request'`)
  - `EventNotAvailableError` (`code = 'event_not_available'`)
  - `SoldOutError` (`code = 'sold_out'`)
- Validação pré-transação (`validatePurchaseInput`):
  - `buyerEmail`: string não vazia em formato de e-mail válido (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`), normalizada (`trim().toLowerCase()`).
  - `cardNumber`: string exata de 16 dígitos numéricos (`/^\d{16}$/`).
  - `eventId`: string não vazia.
  - `channel`: `'storefront' | 'partner_api'`.
- Geração de código (`generateTicketCode()`):
  - Alfabeto `ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789` (36 chars), 8 caracteres sorteados via `crypto.randomBytes`, gerando `36^8 ≈ 2.8 × 10^12` combinações. Retry automático (até 5 vezes) caso PostgreSQL retorne `23505` em `tickets_code_key`.
- `purchaseTicket(input)`:
  1. Chama `validatePurchaseInput(input)` **antes** de abrir transação (zero uso de conexão em requisições inválidas).
  2. Abre transação `db.transaction(async (tx) => { ... })`:
     - `const eventRows = await tx.execute(sql`SELECT id, capacity, price_cents, status FROM events WHERE id = ${eventId} FOR UPDATE`)`
     - Se ausente ou `status !== 'published'` → lança `EventNotAvailableError`.
     - `const occupied = await getOccupiedSeatCount(eventId, tx)` (`COUNT(*) WHERE event_id = $1 AND status IN ('pending', 'confirmed')`).
     - Se `occupied >= capacity` → lança `SoldOutError`.
     - Insere em `tickets` com `id = 'tkt_' + ...`, `event_id`, `user_id: input.userId ?? null`, `buyer_email`, `code`, `price_cents: event.price_cents`, `status: 'pending'`, `checked_in: false`, `channel`.
     - Retorna `{ ticketId, code, eventId, status: 'pending', priceCents, buyerEmail, userId, channel }`.
  3. **Somente após o commit da transação**, chama `scheduleSimulatedPayment(result.ticketId, input.cardNumber)`.
  4. Retorna imediatamente `result`.
- `getOccupiedSeatCount(eventId: string, executor = db)`:
  - `SELECT COUNT(*)::int AS count FROM tickets WHERE event_id = $1 AND status IN ('pending', 'confirmed')`.
- `getEventSeatMetrics(eventId: string, executor = db)`:
  - Busca `capacity` e `status` do evento + `occupied = getOccupiedSeatCount(eventId, executor)`.
  - Se evento não existe, retorna `null`.
  - Calcula `available = event.status === 'cancelled' ? 0 : Math.max(0, event.capacity - occupied)` (`R05`).
  - Retorna `{ capacity: event.capacity, occupied, available }`.
- `getTicketById(ticketId: string)` e `listUserTickets(userId: string)`: helpers de leitura prontos para `F04` e `F05`.

### 3. Integração com `F02` (`src/modules/events/events.service.ts`)

- `updateEvent()` em `src/modules/events/events.service.ts` importa `getOccupiedSeatCount` de `src/modules/purchases/purchase.service.ts`, garantindo fonte única de verdade para a regra `R03` (bloqueio de redução de lotação abaixo de `pending + confirmed`).

---

## Complexity Tracking

Nenhuma violação da Constituição. O lock pessimista `SELECT ... FOR UPDATE` sobre a linha do evento serializa apenas compras do mesmo evento, oferecendo simplicidade máxima e garantia matemática contra overselling no PostgreSQL 16.
