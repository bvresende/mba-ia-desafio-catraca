# Evaluation Report: F07 — Cancelamento Irreversível de Eventos e Estorno/Cancelamento

## Metadata

| Field | Value |
| --- | --- |
| **Feature ID** | `F07` |
| **Report ID** | `eval-001` |
| **Date (ISO-8601)** | `2026-11-25T19:32:10Z` |
| **Branch** | `feat/f07-event-cancellation` |
| **Evaluated Commit** | `99abb655ab60058aaacd790602b57e533a3e6494` |
| **Tool** | `Google Antigravity` |
| **Model** | `Gemini 4 Hydrogen` |
| **Overall Verdict** | `APPROVED` |

---

## Summary

All 6 contract verification items (`ITEM-01` through `ITEM-06`) and all PRD criteria (`F07-AC1`..`F07-AC5`, `CF-12`..`CF-16`, `R02`, `R05`, `R10`, `R11`, `R12`, `R13`) were executed against both the automated gate suite (`./scripts/gates.sh`) and the live Docker Compose environment (`./scripts/up.sh`) with default simulated gateway timings (`0001`: 2–5s; `0003`/`0004`: 30–40s). Every check passed with 0 failures.

---

## Item-by-Item Verification Evidence

### `ITEM-01` — Cancelamento irreversível pelo organizador proprietário e bloqueio de edição/republicação (`R11`, `R13`)
- **Status**: `PASS`
- **Commands & Observed Output**:
  1. Logged in as Organizador A (`org-a@catraca.local`) and created + published `Evento Cancelamento F07` (`evt_e11e1e8e9b33`, capacity `10`, price `R$ 100,00`, `2027-06-15T20:00`):
     - `POST /organizer/events` -> `HTTP 302`, `Location: /organizer/events/evt_e11e1e8e9b33`
     - `POST /organizer/events/evt_e11e1e8e9b33/publish` -> `HTTP 302`, `Location: /organizer/events/evt_e11e1e8e9b33?published=1`
  2. Unauthorized cancellation attempts on `POST /organizer/events/evt_e11e1e8e9b33/cancel`:
     - Visitor (unauthenticated): `HTTP 302` -> `http://localhost:3000/login`
     - Participant (`participante@catraca.local`): `HTTP 403`
     - Organizador B (`org-b@catraca.local`): `HTTP 403`
     - Confirmed via `GET /api/partner/events`: event remained published (`"id":"evt_e11e1e8e9b33","name":"Evento Cancelamento F07","startsAt":"2027-06-15T23:00:00.000Z","priceCents":10000,"availableSeats":10`).
  3. Owner cancellation as Organizador A:
     - `POST /organizer/events/evt_e11e1e8e9b33/cancel` -> `HTTP 303`, `Location: /organizer/events/evt_e11e1e8e9b33?cancelled=1`
     - PostgreSQL `events` table row: `id = evt_e11e1e8e9b33`, `status = cancelled`.
  4. Post-cancel management page and direct edit/publish attempts:
     - `GET /organizer/events/evt_e11e1e8e9b33`: status badge `cancelado`, edit section renders `"Este evento está encerrado e não aceita novas alterações ou publicação."` (no edit/publish forms), cancel section renders `"Evento cancelado — cancelamento irreversível. Novas vendas estão bloqueadas, ingressos confirmados foram estornados e ingressos pendentes foram cancelados."`
     - `POST /organizer/events/evt_e11e1e8e9b33/edit` -> `HTTP 409`, alert `"Eventos cancelados não podem ser editados."`
     - `POST /organizer/events/evt_e11e1e8e9b33/publish` -> `HTTP 409`, alert `"Eventos cancelados não podem ser publicados."`

### `ITEM-02` — Estorno de `confirmed` e cancelamento de `pending` em <= 10s para vitrine e API (`R11`)
- **Status**: `PASS`
- **Commands & Observed Output**:
  1. Created and published `Evento E2E F07` (`evt_8fa4f948d66d`, capacity `10`, price `R$ 100,00`, `2027-07-20T20:00`, location `Arena Catraca`).
  2. Purchased 4 tickets:
     - `T1` (storefront `0001`): `id=tkt_c53c763d0d40`, `code=RRCQFEKO` -> confirmed within `5.0s` (`"status":"confirmed"`).
     - `T2` (Partner API `0001`): `HTTP 202`, `id=tkt_1c2bd61600de`, `code=O633KZQJ` -> confirmed within `5.0s`, then checked in via `POST /organizer/events/evt_8fa4f948d66d/checkin` (`code=O633KZQJ`) -> `HTTP 200`, result `'Entrada liberada'`, `GET /api/partner/tickets/tkt_1c2bd61600de` -> `{"ticketId":"tkt_1c2bd61600de","code":"O633KZQJ","eventId":"evt_8fa4f948d66d","status":"confirmed","checkedIn":true}`.
     - `T3` (storefront `0003`, slow 30–40s): `id=tkt_b1edcf5a9557`, `code=LAOK02VD`, `status=pending`.
     - `T4` (Partner API `0004`, slow 30–40s): `HTTP 202`, `{"ticketId":"tkt_50879470c7db","code":"BPEHTMS9","status":"pending"}`.
  3. Executed `POST /organizer/events/evt_8fa4f948d66d/cancel` as Organizador A `0.20s` after slow purchases started:
     - `HTTP 303`, elapsed time: **`0.015s`** (<= 10s).
  4. Immediate post-cancellation checks (< 1s):
     - `GET /api/partner/tickets/tkt_c53c763d0d40` (`T1`): `HTTP 200`, `{"ticketId":"tkt_c53c763d0d40","code":"RRCQFEKO","eventId":"evt_8fa4f948d66d","status":"refunded","checkedIn":false}`
     - `GET /api/partner/tickets/tkt_1c2bd61600de` (`T2`): `HTTP 200`, `{"ticketId":"tkt_1c2bd61600de","code":"O633KZQJ","eventId":"evt_8fa4f948d66d","status":"refunded","checkedIn":true}`
     - `GET /api/partner/tickets/tkt_b1edcf5a9557` (`T3`): `HTTP 200`, `{"ticketId":"tkt_b1edcf5a9557","code":"LAOK02VD","eventId":"evt_8fa4f948d66d","status":"cancelled","checkedIn":false}`
     - `GET /api/partner/tickets/tkt_50879470c7db` (`T4`): `HTTP 200`, `{"ticketId":"tkt_50879470c7db","code":"BPEHTMS9","eventId":"evt_8fa4f948d66d","status":"cancelled","checkedIn":false}`
     - `GET /my-tickets` (Participant): `RRCQFEKO` (`T1`) displays `estornado`; `LAOK02VD` (`T3`) displays `cancelado`.

### `ITEM-03` — Proteção contra resposta tardia do gateway lento (`0003` e `0004` após 45s) (`R11`)
- **Status**: `PASS`
- **Commands & Observed Output**:
  - Waited until **`56.39s`** after `T3` (`0003`) and `T4` (`0004`) were created (exceeding the 30–40s gateway callback window and the 45s requirement).
  - `GET /api/partner/tickets/tkt_b1edcf5a9557` (`T3`, card `0003`): `HTTP 200`, `{"ticketId":"tkt_b1edcf5a9557","code":"LAOK02VD","eventId":"evt_8fa4f948d66d","status":"cancelled","checkedIn":false}`
  - `GET /api/partner/tickets/tkt_50879470c7db` (`T4`, card `0004`): `HTTP 200`, `{"ticketId":"tkt_50879470c7db","code":"BPEHTMS9","eventId":"evt_8fa4f948d66d","status":"cancelled","checkedIn":false}`
  - `GET /my-tickets`: `LAOK02VD` (`T3`) remains `cancelado`, `RRCQFEKO` (`T1`) remains `estornado`.
  - PostgreSQL `tickets` query for `evt_8fa4f948d66d`:
    - `tkt_c53c763d0d40 | RRCQFEKO | storefront | refunded | f`
    - `tkt_1c2bd61600de | O633KZQJ | partner_api | refunded | t`
    - `tkt_b1edcf5a9557 | LAOK02VD | storefront | cancelled | f`
    - `tkt_50879470c7db | BPEHTMS9 | partner_api | cancelled | f`

### `ITEM-04` — Efeito na Vitrine (`F04`) e na API de Parceiros (`F05`) pós-cancelamento (`R02`, `R11`)
- **Status**: `PASS`
- **Commands & Observed Output**:
  - `GET /`: `evt_8fa4f948d66d` / `Evento E2E F07` absent (`False`).
  - `GET /api/partner/events` (with `X-Api-Key: catraca-partner-dev-key-2026`): `evt_8fa4f948d66d` absent (`False`).
  - `POST /api/partner/events/evt_8fa4f948d66d/purchases` (valid payload `{"buyerEmail":"late@example.com","cardNumber":"4111111111110001"}`): `HTTP 404`, exact body `{"error":"event_not_available"}`.
  - `GET /my-tickets`: literally displays `estornado` (`RRCQFEKO`) and `cancelado` (`LAOK02VD`).
  - `GET /api/partner/tickets/:ticketId`: returns `"status":"refunded"` (`tkt_c53c763d0d40`, `tkt_1c2bd61600de`) and `"status":"cancelled"` (`tkt_b1edcf5a9557`, `tkt_50879470c7db`).

### `ITEM-05` — Efeito no Check-in e no Painel do Organizador (`F06`) pós-cancelamento (`R05`, `R10`, `R11`, `R12`)
- **Status**: `PASS`
- **Commands & Observed Output**:
  - `GET /organizer/events/evt_8fa4f948d66d` as Organizador A:
    - Edit section disabled/blocked: `"Este evento está encerrado e não aceita novas alterações ou publicação."`
    - Check-in slot displays literally: `<div class="alert alert-error" role="status" data-checkin-result="true">Evento cancelado</div>`
    - Dashboard metrics:
      - `Confirmados`: `0`
      - `Pendentes`: `0`
      - `Check-ins`: `0`
      - `Vagas disponíveis`: `0`
      - `Receita`: `R$ 0,00`
      - `Estornados`: `2`
  - `POST /organizer/events/evt_8fa4f948d66d/checkin`:
    - With `O633KZQJ` (T2, previously checked-in) -> `HTTP 200`, `Evento cancelado`
    - With `RRCQFEKO` (T1, not checked-in) -> `HTTP 200`, `Evento cancelado`
    - With `NAOEXISTE` (non-existent code) -> `HTTP 200`, `Ingresso inválido para este evento` (R10 priority 1 preserved)

### `ITEM-06` — Gates e suíte automatizada completa (`F01`–`F07`) passando integralmente
- **Status**: `PASS`
- **Commands & Observed Output**:
  - Ran `./scripts/gates.sh` against isolated `catraca_test` database:
    - Migrations (`tsx src/db/migrate.ts`): `[migrate] Database migrations applied successfully.`
    - Typecheck (`tsc --noEmit`): passed with 0 errors.
    - Vitest (`vitest run`): **7 passed (7)** test files, **40 passed (40)** tests, Duration `30.21s`, exit code `0`:
      - `tests/f07.cancellation.test.ts` (3 tests)
      - `tests/f06.checkin-dashboard.test.ts` (5 tests)
      - `tests/f05.partner-api.test.ts` (5 tests)
      - `tests/f03.purchase-gateway.test.ts` (7 tests)
      - `tests/f04.storefront.test.ts` (6 tests)
      - `tests/f02.events.test.ts` (6 tests)
      - `tests/f01.foundation.test.ts` (8 tests)
  - Ran `./scripts/down.sh` after live evaluation: all Catraca containers and networks removed (`docker ps --filter "name=catraca"` returned empty).

---

## PRD Traceability Matrix (`F07-AC1`..`F07-AC5`, `CF-12`..`CF-16`)

| PRD Criterion | Rules | Verified By | Result |
| --- | --- | --- | --- |
| `F07-AC1` | `R11` | `ITEM-01`, `ITEM-06` | `PASS` |
| `F07-AC2` | `R11` | `ITEM-02`, `ITEM-06` | `PASS` |
| `F07-AC3` | `R11` | `ITEM-03`, `ITEM-06` | `PASS` |
| `F07-AC4` | `R10`, `R11` | `ITEM-01`, `ITEM-05`, `ITEM-06` | `PASS` |
| `F07-AC5` | `R05`, `R11`, `R12` | `ITEM-05`, `ITEM-06` | `PASS` |
| `CF-12` (`F02 → F07`) | `R11` | `ITEM-01`, `ITEM-06` | `PASS` |
| `CF-13` (`F03 → F07`) | `R11` | `ITEM-02`, `ITEM-03`, `ITEM-06` | `PASS` |
| `CF-14` (`F04 → F07`) | `R02`, `R11` | `ITEM-02`, `ITEM-04`, `ITEM-06` | `PASS` |
| `CF-15` (`F05 → F07`) | `R02`, `R11` | `ITEM-02`, `ITEM-04`, `ITEM-06` | `PASS` |
| `CF-16` (`F06 → F07`) | `R05`, `R10`, `R11`, `R12` | `ITEM-05`, `ITEM-06` | `PASS` |
