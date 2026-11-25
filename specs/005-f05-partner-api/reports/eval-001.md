# Evaluation Report: F05 — API de Parceiros (Contrato Fixo)

- **Feature ID:** `F05`
- **Branch:** `feat/f05-partner-api`
- **Evaluated Commit:** `82b2c5832a447aa9b656bfa15e159535f18a4bce`
- **Evaluation Date (ISO-8601):** `2026-11-25T16:16:59-03:00`
- **Tool:** `Google Antigravity`
- **Model:** `Gemini 4 Hydrogen`
- **Verdict:** `APPROVED`

---

## 1. Summary

All 7 verifiable items (`ITEM-01` through `ITEM-07`) in `specs/005-f05-partner-api/contract.md` and the corresponding PRD criteria (`F05-AC1`..`F05-AC6`, `CF-07`, `CF-08`, `R02`, `R05`..`R08`) passed 100% under real execution via `./scripts/gates.sh`, live HTTP requests against `./scripts/up.sh` (`http://localhost:3000`), PostgreSQL verification, and clean teardown via `./scripts/down.sh`.

| Item | Description | Result |
| --- | --- | --- |
| `ITEM-01` | `X-Api-Key` enforcement on all 3 partner routes (`401 {"error":"unauthorized"}`) | PASS |
| `ITEM-02` | `GET /api/partner/events` lists published events only with exact fields and `availableSeats` | PASS |
| `ITEM-03` | Strict validation order on `POST /api/partner/events/:eventId/purchases` (`422` → `404` → `409` → `202`) | PASS |
| `ITEM-04` | `409 {"error":"sold_out"}` accounting for `pending` tickets | PASS |
| `ITEM-05` | Concurrency burst: 30 simultaneous requests on capacity-5 event (2 automated + 2 live rounds) | PASS |
| `ITEM-06` | `GET /api/partner/tickets/:ticketId` for API, storefront, and missing tickets (`404`) | PASS |
| `ITEM-07` | `./scripts/gates.sh` (`tsc --noEmit` + full Vitest suite against `catraca_test`) | PASS |

---

## 2. Detailed Item Evidence

### `ITEM-01` — `X-Api-Key` authentication required on all 3 routes (`401 {"error":"unauthorized"}`)
- **Result:** PASS
- **Commands & Observed Output (against live server `http://localhost:3000`):**
  - `GET /api/partner/events` (no `X-Api-Key`) → HTTP `401`, body `{"error":"unauthorized"}`
  - `GET /api/partner/events` (`X-Api-Key: invalida`) → HTTP `401`, body `{"error":"unauthorized"}`
  - `POST /api/partner/events/inexistente/purchases` with `{}` (no `X-Api-Key`) → HTTP `401`, body `{"error":"unauthorized"}`
  - `POST /api/partner/events/inexistente/purchases` with `{}` (`X-Api-Key: invalida`) → HTTP `401`, body `{"error":"unauthorized"}`
  - `POST /api/partner/events/inexistente/purchases` with valid payload (no `X-Api-Key`) → HTTP `401`, body `{"error":"unauthorized"}`
  - `POST /api/partner/events/inexistente/purchases` with valid payload (`X-Api-Key: invalida`) → HTTP `401`, body `{"error":"unauthorized"}`
  - `GET /api/partner/tickets/00000000-0000-0000-0000-000000000000` (no `X-Api-Key`) → HTTP `401`, body `{"error":"unauthorized"}`
  - `GET /api/partner/tickets/00000000-0000-0000-0000-000000000000` (`X-Api-Key: invalida`) → HTTP `401`, body `{"error":"unauthorized"}`

### `ITEM-02` — `GET /api/partner/events` lists only published events with exact fields and `availableSeats` (`R02`, `R05`)
- **Result:** PASS
- **Actions & Observed Output:**
  1. Logged in as Organizador A (`org-a@catraca.local`) via `POST /login` (HTTP `302` -> `/organizer/events`).
  2. Created `Evento Rascunho API` (`evt_0b29c5bacace`, `startsAt=2027-06-15T20:00`, capacity `10`, price `85,00` = `8500`) left in `draft`, and `Evento Publicado API` (`evt_98677b7480be`, `startsAt=2027-06-20T20:00`, capacity `5`, price `120,00` = `12000`), published via `POST /organizer/events/evt_98677b7480be/publish`.
  3. `curl -s -H "X-Api-Key: catraca-partner-dev-key-2026" http://localhost:3000/api/partner/events`:
     - HTTP `200`
     - `evt_0b29c5bacace` (draft) absent (`Contains draft? false`).
     - `evt_98677b7480be` present with exact keys `["id","name","startsAt","priceCents","availableSeats"]`:
       `{"id":"evt_98677b7480be","name":"Evento Publicado API","startsAt":"2027-06-20T23:00:00.000Z","priceCents":12000,"availableSeats":5}`
  4. Published `evt_0b29c5bacace` via `POST /organizer/events/evt_0b29c5bacace/publish` and repeated `GET /api/partner/events`:
     - HTTP `200`, `evt_0b29c5bacace` immediately appeared as:
       `{"id":"evt_0b29c5bacace","name":"Evento Rascunho API","startsAt":"2027-06-15T23:00:00.000Z","priceCents":8500,"availableSeats":10}`

### `ITEM-03` — Strict validation order on `POST /api/partner/events/:eventId/purchases` (`422` → `404` → `409` → `202`)
- **Result:** PASS
- **Actions & Observed Output (`X-Api-Key: catraca-partner-dev-key-2026`):**
  1. Invalid payloads against nonexistent `00000000-0000-0000-0000-000000000000`:
     - `{}` → HTTP `422`, `{"error":"invalid_request"}`
     - `{"buyerEmail":"email-invalido","cardNumber":"4111111111110001"}` → HTTP `422`, `{"error":"invalid_request"}`
     - `{"buyerEmail":"a@b.com","cardNumber":"1234"}` → HTTP `422`, `{"error":"invalid_request"}`
  2. Valid payload `{"buyerEmail":"parceiro@teste.com","cardNumber":"4111111111110001"}` against unavailable events:
     - Nonexistent `00000000-0000-0000-0000-000000000000` → HTTP `404`, `{"error":"event_not_available"}`
     - Draft event `evt_fc91685ae1c8` → HTTP `404`, `{"error":"event_not_available"}`
     - Malformed `nao-e-uuid` → HTTP `404`, `{"error":"event_not_available"}`
  3. Valid payload against published `evt_98677b7480be` (`availableSeats: 5`):
     - HTTP `202` in `0.013799s` (< 2s), body `{"ticketId":"tkt_eba20bf61cc2","code":"URELYOQ5","status":"pending"}`.

### `ITEM-04` — Sold out (`409 {"error":"sold_out"}`) counting `pending` tickets (`R05`, `R07`)
- **Result:** PASS
- **Actions & Observed Output:**
  1. Created and published capacity-1 event `evt_507a4e1a8020` (`Evento Lotacao 1 Item04`).
  2. First `POST /api/partner/events/evt_507a4e1a8020/purchases` with slow card `4111111111110003`:
     - HTTP `202`, body `{"ticketId":"tkt_e33c26c97cc0","code":"6D0AMP90","status":"pending"}`.
  3. Immediate second `POST /api/partner/events/evt_507a4e1a8020/purchases` while first ticket remained `pending`:
     - HTTP `409`, body `{"error":"sold_out"}`.
  4. `GET /api/partner/events` showed:
     - `{"id":"evt_507a4e1a8020","name":"Evento Lotacao 1 Item04","startsAt":"2027-07-05T23:00:00.000Z","priceCents":10000,"availableSeats":0}`

### `ITEM-05` — Concurrency under load: 30 simultaneous requests on capacity-5 event (2+ rounds) (`R07`)
- **Result:** PASS
- **Automated Suite (`./scripts/gates.sh`):**
  - `tests/f05.partner-api.test.ts` passed (`F05-AC5 & CF-08 (R07): prevents overselling under 30 concurrent HTTP POST requests for capacity 5 across 2 independent rounds`, 722ms).
- **Live Runtime Burst (`seq 30 | xargs -P 30` against `http://localhost:3000`):**
  - **Round 1 (`evt_f1b13e0181bb`, capacity 5):**
    - Status distribution: `5` × `202`, `25` × `409` `{"error":"sold_out"}`, `0` other/500 errors.
    - `GET /api/partner/events`: `availableSeats: 0`.
    - PostgreSQL `SELECT event_id, status, channel, COUNT(*) FROM tickets WHERE event_id = 'evt_f1b13e0181bb' ...`: strictly `5` rows (`confirmed`, `partner_api`).
  - **Round 2 (`evt_aa036c7e7f36`, capacity 5):**
    - Status distribution: `5` × `202`, `25` × `409` `{"error":"sold_out"}`, `0` other/500 errors.
    - `GET /api/partner/events`: `availableSeats: 0`.
    - PostgreSQL `SELECT event_id, status, channel, COUNT(*) FROM tickets WHERE event_id = 'evt_aa036c7e7f36' ...`: strictly `5` rows (`confirmed`, `partner_api`).

### `ITEM-06` — `GET /api/partner/tickets/:ticketId` for API, storefront, and nonexistent tickets (`R08`)
- **Result:** PASS
- **Actions & Observed Output:**
  1. Purchased via API with card `4111111111110001` on `evt_2075a2bddd5e` → `202` (`tkt_d8bdecea3713`, `EQVU8M2R`):
     - Immediate `GET /api/partner/tickets/tkt_d8bdecea3713`: HTTP `200`, `{"ticketId":"tkt_d8bdecea3713","code":"EQVU8M2R","eventId":"evt_2075a2bddd5e","status":"pending","checkedIn":false}`
     - After 6s `GET /api/partner/tickets/tkt_d8bdecea3713`: HTTP `200`, `{"ticketId":"tkt_d8bdecea3713","code":"EQVU8M2R","eventId":"evt_2075a2bddd5e","status":"confirmed","checkedIn":false}`
  2. Created/published capacity-1 event `evt_34aa48ef5187` and purchased via API with card `4111111111110002` → `202` (`tkt_88af0dbaafa6`, `I1T0NHRW`):
     - Immediate `GET /api/partner/events`: `availableSeats: 0`
     - After 6s `GET /api/partner/tickets/tkt_88af0dbaafa6`: HTTP `200`, `{"ticketId":"tkt_88af0dbaafa6","code":"I1T0NHRW","eventId":"evt_34aa48ef5187","status":"declined","checkedIn":false}`
     - After 6s `GET /api/partner/events`: `availableSeats: 1` (seat released).
  3. Storefront channel ticket verified in PostgreSQL (`id = tkt_eval_01`, `channel = storefront`, `event_id = evt_eb85081d9cec`, `code = EVAL0001`, `status = confirmed`, `checked_in = f`):
     - `GET /api/partner/tickets/tkt_eval_01`: HTTP `200`, `{"ticketId":"tkt_eval_01","code":"EVAL0001","eventId":"evt_eb85081d9cec","status":"confirmed","checkedIn":false}`.
  4. Nonexistent ticket queries:
     - `GET /api/partner/tickets/00000000-0000-0000-0000-000000000000` → HTTP `404`, `{"error":"ticket_not_found"}`
     - `GET /api/partner/tickets/nao-existe` → HTTP `404`, `{"error":"ticket_not_found"}`

### `ITEM-07` — Gates and full automated test suite passing
- **Result:** PASS
- **Command:** `./scripts/gates.sh`
- **Observed Output:**
  - Exit code `0`
  - `db:migrate`: `[migrate] Database migrations applied successfully.`
  - `tsc --noEmit`: passed with 0 errors.
  - `vitest run`: `Test Files  4 passed (4)`, `Tests  26 passed (26)` in `18.14s`:
    - `tests/f05.partner-api.test.ts` (`5 tests`, `3174ms`) — all passed
    - `tests/f03.purchase-gateway.test.ts` (`7 tests`, `5241ms`) — all passed
    - `tests/f02.events.test.ts` (`6 tests`, `2807ms`) — all passed
    - `tests/f01.foundation.test.ts` (`8 tests`, `3744ms`) — all passed
- **Environment Cleanup:**
  - Executed `./scripts/down.sh` after live testing; `docker ps --filter "name=catraca"` returned 0 running containers.

---

## 3. PRD Traceability Matrix

| PRD Criterion | Rules | Contract Items | Status |
| --- | --- | --- | --- |
| `F05-AC1` | — | `ITEM-01`, `ITEM-07` | PASS |
| `F05-AC2` | `R02`, `R05` | `ITEM-02`, `ITEM-07` | PASS |
| `F05-AC3` | `R06` | `ITEM-03`, `ITEM-07` | PASS |
| `F05-AC4` | `R07` | `ITEM-04`, `ITEM-07` | PASS |
| `F05-AC5` | `R07` | `ITEM-05`, `ITEM-07` | PASS |
| `F05-AC6` | `R08` | `ITEM-06`, `ITEM-07` | PASS |
| `CF-07` (`F02 → F05`) | `R02` | `ITEM-02`, `ITEM-03`, `ITEM-07` | PASS |
| `CF-08` (`F03 → F05`) | `R05`, `R06`, `R07`, `R08` | `ITEM-03`, `ITEM-04`, `ITEM-05`, `ITEM-06`, `ITEM-07` | PASS |
