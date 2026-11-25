# Evaluation Report: F03 — Motor de Compras, Concorrência e Gateway Simulado

- **Feature**: `F03` — Motor de Compras, Concorrência e Gateway Simulado
- **Contract**: `specs/003-f03-purchase-gateway/contract.md`
- **PRD Reference**: `docs/PRD.md` (`F03-AC1`–`F03-AC5`, `CF-02`, `CF-03`, `R02`, `R03`, `R05`, `R06`, `R07`, `R08`, `R09`, `R11`)
- **Date (ISO-8601)**: `2026-11-25T19:04:28Z`
- **Branch**: `feat/f03-purchase-gateway`
- **Evaluated Commit**: `bceb5f092bbffcbb3e089ecf657eb5a7b7af1ffa`
- **Tool**: `Google Antigravity`
- **Model**: `Gemini 4 Hydrogen`
- **Verdict**: `APPROVED`

---

## Summary

| Item | Status | Summary |
| --- | --- | --- |
| `ITEM-01` | PASS | `./scripts/gates.sh` exited `0`; `tsc --noEmit` clean; `3/3` test files and `21/21` tests passed against `catraca_test`. |
| `ITEM-02` | PASS | `purchaseTicket()` returned in `14ms` with `status: 'pending'`, `userId: 'usr_part_seed'`, `checkedIn: false`, `channel: 'storefront'`; `getEventSeatMetrics()` returned `{ capacity: 5, occupied: 1, available: 4 }` (and `available: 0` for `cancelled`). |
| `ITEM-03` | PASS | Inspected `SELECT ... FOR UPDATE` inside `db.transaction` in `purchase.service.ts`; 3 rounds of 30 concurrent purchases (`capacity = 5`) yielded exactly `5` created and `25` `SoldOutError` (`sold_out`) per round. |
| `ITEM-04` | PASS | Verified `env.ts`, `docker-compose.yml`, and container env (`2000`/`5000`/`30000`/`40000`); invalid cards rejected pre-transaction; all 5 endings (`0001`–`0004` + fallback) verified; real runtime `0001` settled `confirmed` in `4428ms`. |
| `ITEM-05` | PASS | Inspected atomic guard in `gateway.service.ts` (`WHERE id = $1 AND status = 'pending' AND EXISTS (... status = 'published')`); late `0003` callback never overwrote `cancelled` ticket/event. |
| `ITEM-06` | PASS | Draft/missing/cancelled events rejected (`EventNotAvailableError`); capacity reduction below `2` occupied seats rejected (`EventValidationError`); price frozen at `10000` on existing tickets and `15000` on new purchase. |
| `ITEM-07` | PASS | PostgreSQL `pg_constraint` confirmed `tickets_code_key|u|UNIQUE (code)`; all issued codes matched `/^[A-Z0-9]{8}$/` with 100% uniqueness. |

---

## Detailed Evidence

### `ITEM-01` — Gates e suíte completa (`F01` + `F02` + `F03`) passando em `catraca_test`
- **Verdict**: `PASS`
- **Command Run**:
  ```bash
  ./scripts/gates.sh
  ```
- **Observed Output**:
  - Exit code: `0`
  - Migrations: `[migrate] Database migrations applied successfully.` against `postgres://catraca:catraca@db:5432/catraca_test`
  - Typecheck: `npm run typecheck` (`tsc --noEmit`) passed with zero errors
  - Vitest (`vitest run`):
    - `tests/f03.purchase-gateway.test.ts` — `7` passed (`5340ms`)
    - `tests/f02.events.test.ts` — `6` passed (`2726ms`)
    - `tests/f01.foundation.test.ts` — `8` passed (`3753ms`)
    - Total: `Test Files 3 passed (3)`, `Tests 21 passed (21)` in `14.14s`

---

### `ITEM-02` — Compra imediata em `pending`, persistência com `user_id` de `F01` e métricas `R05` (`F03-AC1`, `CF-02`)
- **Verdict**: `PASS`
- **Commands / Checks**:
  1. Vitest test `F03-AC1 & CF-02 (R05, R06, R09): purchases immediately in pending, links optional userId, and computes seat metrics` in `tests/f03.purchase-gateway.test.ts` passed (`814ms`).
  2. Real runtime execution via `docker compose exec -T -e DATABASE_URL="postgres://catraca:catraca@db:5432/catraca_test" app npx tsx -` (against `catraca_test` after `./scripts/up.sh`):
     - Created and published event (`capacity: 5`, `price: '100,00'`) as `usr_org_a`
     - Called `purchaseTicket({ eventId, buyerEmail: 'participante@catraca.local', cardNumber: '4111111111110001', userId: 'usr_part_seed', channel: 'storefront' })`
- **Observed Output**:
  ```json
  {"phase":"immediate","purchaseReturnMs":14,"ticketId":"tkt_9d02c7943321","status":"pending","userId":"usr_part_seed","checkedIn":false,"channel":"storefront","code":"1OZ5GPC6","priceCents":10000,"metricsImmediately":{"capacity":5,"occupied":1,"available":4}}
  ```
  - `purchaseReturnMs`: `14` ms (`< 500ms`)
  - Cancelled event seat metrics verified in `tests/f03.purchase-gateway.test.ts` (lines 212–221): `getEventSeatMetrics()` returned `{ capacity: 10, occupied: 0, available: 0 }`.

---

### `ITEM-03` — Concorrência estrita 30 × 5 sem overselling usando `SELECT ... FOR UPDATE` (`F03-AC2`, `R07`)
- **Verdict**: `PASS`
- **Code Inspection** (`src/modules/purchases/purchase.service.ts`, lines 270–289):
  - Opens `db.transaction(async (tx) => { ... })`
  - Executes pessimistic row lock on the target event:
    ```ts
    const [lockedEvent] = await tx
      .select({
        id: events.id,
        capacity: events.capacity,
        priceCents: events.priceCents,
        status: events.status,
      })
      .from(events)
      .where(eq(events.id, validated.eventId))
      .for('update');
    ```
  - Checks `lockedEvent.status !== 'published'` (`EventNotAvailableError`), then queries `getOccupiedSeatCount(lockedEvent.id, tx)` (`status IN ('pending', 'confirmed')`), throwing `SoldOutError` (`code = 'sold_out'`) when `occupied >= lockedEvent.capacity` before inserting the new `pending` ticket.
- **Test Execution**:
  - `F03-AC2 (R07): prevents overselling across 3 rounds of 30 concurrent purchases for capacity 5` in `tests/f03.purchase-gateway.test.ts` passed (`931ms`): in all 3 independent rounds (`Promise.allSettled` with 30 concurrent calls), `fulfilled` length was `5`, `rejected` length was `25` (all `SoldOutError` with `code === 'sold_out'`), `occupied === 5`, `available === 0`, and DB row count in `tickets` was `5`.

---

### `ITEM-04` — Validação de cartão de 16 dígitos e regras completas do gateway simulado (`F03-AC3`, `R08`)
- **Verdict**: `PASS`
- **Environment & Configuration Inspection**:
  - `src/config/env.ts` (lines 48–51, 77–88): defaults `GATEWAY_FAST_MIN_MS = 2000`, `GATEWAY_FAST_MAX_MS = 5000`, `GATEWAY_SLOW_MIN_MS = 30000`, `GATEWAY_SLOW_MAX_MS = 40000`.
  - `docker-compose.yml` (lines 30–33) and live `app` container `printenv | grep GATEWAY | sort`:
    ```text
    GATEWAY_FAST_MAX_MS=5000
    GATEWAY_FAST_MIN_MS=2000
    GATEWAY_SLOW_MAX_MS=40000
    GATEWAY_SLOW_MIN_MS=30000
    ```
- **Test Execution**:
  - `validates default gateway timing values in env.ts and card resolution rules (R08)` (`431ms`) and `F03-AC3 (R08): rejects invalid cards/emails pre-transaction and processes all 5 card endings asynchronously` (`1079ms`) in `tests/f03.purchase-gateway.test.ts` passed:
    - Invalid cards (`"1234"`, `"123456789012345a"`, `"12345678901234567"`, `"4111 1111 1111 0001"`, `""`) and invalid emails rejected with `InvalidPurchaseRequestError` (`invalid_request`) with `0` tickets inserted.
    - All 5 endings verified: `0001` → `confirmed` (fast), `0002` → `declined` (fast; freed seat on `capacity = 1` allowing subsequent `0001` purchase to succeed), `0003` → `confirmed` (slow), `0004` → `declined` (slow), `9999` → `declined` (fast).
- **Real Runtime Delay Verification** (default delays `2000–5000ms` inside `app` container, `0001`):
  ```json
  {"phase":"immediate","purchaseReturnMs":14,"ticketId":"tkt_9d02c7943321","status":"pending","userId":"usr_part_seed","checkedIn":false,"channel":"storefront","code":"1OZ5GPC6","priceCents":10000,"metricsImmediately":{"capacity":5,"occupied":1,"available":4}}
  {"phase":"at_1000ms","status":"pending"}
  {"phase":"settled","totalElapsedMs":4428,"status":"confirmed","metricsAfter":{"capacity":5,"occupied":1,"available":4}}
  ```
  - Ticket remained `pending` at `1000ms` and transitioned to `confirmed` at `4428ms` (within `2000–5000ms`).

---

### `ITEM-05` — Guarda atômica do callback contra sobrescrita em evento cancelado (`R11`)
- **Verdict**: `PASS`
- **Code Inspection** (`src/modules/purchases/gateway.service.ts`, lines 127–147):
  ```ts
  export async function applyGatewayOutcome(
    ticketId: string,
    outcome: GatewayOutcome,
  ): Promise<boolean> {
    const updatedRows = await db
      .update(tickets)
      .set({
        status: outcome,
        updatedAt: sql`NOW()`,
      })
      .where(
        and(
          eq(tickets.id, ticketId),
          eq(tickets.status, 'pending'),
          sql`EXISTS (SELECT 1 FROM ${events} WHERE ${events.id} = ${tickets.eventId} AND ${events.status} = 'published')`,
        ),
      )
      .returning({ id: tickets.id });

    return updatedRows.length > 0;
  }
  ```
- **Test Execution**:
  - `R11: atomic gateway guard never overwrites cancelled ticket or cancelled event on late callback` in `tests/f03.purchase-gateway.test.ts` passed (`828ms`):
    - Slow approval card `0003` purchase (`pending`) followed by updating event and ticket to `cancelled` before callback execution; after `waitForPendingGatewayJobs()`, ticket status remained `cancelled`.
    - Direct call `applyGatewayOutcome(pendingTicket.id, 'confirmed')` on a `cancelled` event returned `false` and left ticket status unchanged (`pending`).

---

### `ITEM-06` — Integração `F02 → F03`: recusa em `draft`, congelamento de preço e bloqueio de redução de lotação (`F03-AC4`, `CF-03`, `R02`, `R03`)
- **Verdict**: `PASS`
- **Code Inspection**:
  - `src/modules/purchases/purchase.service.ts` (lines 282–284, 303): rejects non-published (`draft`/`cancelled`) events with `EventNotAvailableError` (`event_not_available`) and snapshots `priceCents: lockedEvent.priceCents`.
  - `src/modules/events/events.service.ts` (lines 429–434): inside `updateEvent()` transaction with `.for('update')`, computes `occupiedSeats = await getOccupiedSeatCount(eventId, tx)` and throws `EventValidationError` if `capacity < occupiedSeats`.
- **Test Execution**:
  - `F03-AC4 & CF-03 (R02, R03): rejects draft/missing/cancelled events, freezes price, and blocks capacity reduction below occupied` in `tests/f03.purchase-gateway.test.ts` passed (`575ms`):
    - `draft` event purchase rejected with `EventNotAvailableError`.
    - After `publishEvent()`, 2 purchases recorded `priceCents = 10000`.
    - `updateEvent(..., { capacity: 1 })` rejected with `EventValidationError`.
    - `updateEvent(..., { price: '150,00' })` followed by 3rd purchase recorded `priceCents = 15000` on ticket 3 while tickets 1 and 2 remained `10000` in PostgreSQL.

---

### `ITEM-07` — Código único alfanumérico de 8 caracteres com restrição `UNIQUE` no banco (`F03-AC5`, `R09`)
- **Verdict**: `PASS`
- **Commands & Output**:
  1. PostgreSQL `UNIQUE` constraint verification after `./scripts/up.sh`:
     ```bash
     docker compose exec -T db psql -U catraca -d catraca -t -A -c "SELECT conname, contype, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'tickets'::regclass AND contype = 'u';"
     ```
     Output:
     ```text
     tickets_code_key|u|UNIQUE (code)
     ```
  2. Vitest test `F03-AC5 (R09): enforces UNIQUE constraint on tickets.code and generates unique 8-char uppercase alphanumeric codes` in `tests/f03.purchase-gateway.test.ts` passed (`650ms`), issuing 20 concurrent tickets all matching `/^[A-Z0-9]{8}$/` with `new Set(codes).size === 20`.
  3. Runtime check also issued code `1OZ5GPC6` matching `/^[A-Z0-9]{8}$/`.

---

## Environment Lifecycle Verification

- `./scripts/up.sh` succeeded; `GET http://localhost:3000/health` returned `HTTP 200` with `{"status":"ok","db":"ok"}`.
- `./scripts/down.sh` succeeded; `docker ps` listed no running containers and `http://localhost:3000/health` returned connection closed (`000`).

---

## Traceability Matrix (PRD → Contract → Verdict)

| Critério PRD | Regras | Itens do Contrato | Status |
| --- | --- | --- | --- |
| `F03-AC1` | `R05`, `R06` | `ITEM-01`, `ITEM-02` | `PASS` |
| `F03-AC2` | `R07` | `ITEM-01`, `ITEM-03` | `PASS` |
| `F03-AC3` | `R08` | `ITEM-01`, `ITEM-04`, `ITEM-05` | `PASS` |
| `F03-AC4` | `R03` | `ITEM-01`, `ITEM-06` | `PASS` |
| `F03-AC5` | `R09` | `ITEM-01`, `ITEM-07` | `PASS` |
| `CF-02` (`F01 → F03`) | `R06`, `R09` | `ITEM-01`, `ITEM-02`, `ITEM-07` | `PASS` |
| `CF-03` (`F02 → F03`) | `R02`, `R03` | `ITEM-01`, `ITEM-06` | `PASS` |
