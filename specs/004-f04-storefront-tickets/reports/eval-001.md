# Evaluation Report: F04 — Vitrine Pública e Área do Participante ("Meus ingressos")

- **Feature ID**: `F04`
- **Date (ISO-8601)**: `2026-11-25T19:13:30Z`
- **Branch**: `feat/f04-storefront-tickets`
- **Evaluated Commit**: `5bb1fd1169cdb704c5decb79f279ecb961278f8c`
- **Tool**: `Google Antigravity`
- **Model**: `Gemini 4 Hydrogen`
- **Overall Verdict**: `APPROVED`

---

## 1. Environment & Lifecycle Verification

| Step | Command | Result | Evidence |
| --- | --- | --- | --- |
| Gates (`catraca_test`) | `./scripts/gates.sh` | **PASS** (exit `0`) | `tsc --noEmit` clean; Vitest `4 passed (4)`, `27 passed (27)` in `19.15s` |
| Stack Startup | `./scripts/up.sh` | **PASS** (exit `0`) | Migrations + idempotent seed applied; `GET /health` → `HTTP/1.1 200 OK` `{"status":"ok","db":"ok"}` |
| Stack Teardown | `./scripts/down.sh` | **PASS** (exit `0`) | `mba-ia-desafio-catraca-app-1`, `mba-ia-desafio-catraca-db-1`, and `mba-ia-desafio-catraca_default` removed; `docker ps --format '{{.Names}}'` returned empty |

---

## 2. Contract Item Verification (`ITEM-01` .. `ITEM-07`)

### `ITEM-01` — Vitrine pública exibe apenas eventos publicados e reflete publicação imediata (`R02`)
- **Result**: **PASS**
- **Commands Executed**:
  1. Authenticated as `org-a@catraca.local` via `POST /login` (`302` → `/organizer/events`).
  2. Created `Evento Rascunho F04` (`evt_44d38c659ec4`, kept in `draft`, `2026-12-20T19:00`, `Galpao Draft`, capacity `4`, `75,00`) and `Evento Publicado F04` (`evt_a2476199fa31`, `2026-12-21T20:00`, `Teatro Principal`, capacity `5`, `100,00`), then published `evt_a2476199fa31` via `POST /organizer/events/evt_a2476199fa31/publish` (`302` → `/organizer/events/evt_a2476199fa31?published=1`).
  3. Executed unauthenticated `curl -sS -i http://localhost:3000/` (no session cookies).
  4. Published `evt_44d38c659ec4` via `POST /organizer/events/evt_44d38c659ec4/publish` and re-executed `curl -sS http://localhost:3000/`.
- **Observed Evidence**:
  - Step 3 returned `HTTP/1.1 200 OK`; HTML contained `Evento Publicado F04`, `21/12/2026 20:00 (BRT)`, `Teatro Principal`, `R$ 100,00`, `5 vagas disponíveis`, and **0 occurrences** of `Evento Rascunho F04`.
  - Step 4 immediately returned `Evento Rascunho F04`, `Galpao Draft`, `R$ 75,00`, and `4 vagas disponíveis` in `GET /`.

---

### `ITEM-02` — Compra na vitrine por participante recém-cadastrado nasce `pendente` sem bloquear no gateway (`R06`, `R09`)
- **Result**: **PASS**
- **Commands Executed**:
  1. Registered new participant `Novo Participante F04` (`novo.eval.f04@catraca.local` / `PartEval123!`) via `POST /register` (`302` → `/`, `Set-Cookie: catraca_session=...; HttpOnly; SameSite=Lax`).
  2. Organizador A created & published `Evento Item02 F04` (`evt_3c15eff5eb66`, capacity `2`, price `80,00`, `Auditório Item02`, `2026-12-22T21:00`).
  3. Timed `POST /events/evt_3c15eff5eb66/purchase` with `cardNumber=4111111111110003` (30–40s slow gateway card).
  4. Immediately called `GET /my-tickets` (with participant cookie) and `GET /`.
- **Observed Evidence**:
  - `POST /events/evt_3c15eff5eb66/purchase` returned `status=302` (`location: /my-tickets`) in `time_total=0.014742` seconds (< 2s, without blocking on gateway).
  - `GET /my-tickets` immediately rendered: `Evento Item02 F04`, `22/12/2026 21:00 (BRT)`, `Auditório Item02`, `<code>5MDART1K</code>`, `R$ 80,00`, `<span class="badge badge-ticket-pending">pendente</span>`.
  - `GET /` immediately showed `1 vaga disponível` (reduced from `2`).

---

### `ITEM-03` — Evento sem vagas (inclusive por ingressos `pending`) exibe literalmente `Ingressos esgotados` (`R05`, `R07`)
- **Result**: **PASS**
- **Commands Executed**:
  1. Organizador A created & published `Evento Lotação Um F04` (`evt_e30f7a8eb656`, capacity `1`, price `90,00`).
  2. Authenticated participant purchased 1 ticket with slow card `4111111111110003`.
  3. Immediately (while ticket was `pending`), fetched `GET /` both unauthenticated and authenticated.
  4. Sent second `POST /events/evt_e30f7a8eb656/purchase` authenticated with `4111111111110001` and queried PostgreSQL `tickets` count for `evt_e30f7a8eb656`.
- **Observed Evidence**:
  - Both unauthenticated and authenticated `GET /` showed `0 vagas disponíveis` and `<span class="badge badge-sold-out">Ingressos esgotados</span>`, with no active purchase form rendered for `evt_e30f7a8eb656`.
  - Second `POST` returned `status=409` with `<div class="alert alert-error" role="alert">Ingressos esgotados</div>`.
  - DB query `SELECT count(*) FROM tickets WHERE event_id = 'evt_e30f7a8eb656';` returned `1`.

---

### `ITEM-04` — Evolução assíncrona em "Meus ingressos": `0001` → `confirmado` e `0002` → `recusado` com liberação de vaga (`R05`, `R08`, `R09`)
- **Result**: **PASS**
- **Commands Executed**:
  1. Organizador A created & published `Evento Gateway F04` (`evt_ed5c0a264409`, capacity `1`, price `110,00`, `Arena Gateway`, `2026-12-24T20:00`).
  2. Participant purchased with `4111111111110002` (`302` → `/my-tickets`); checked `GET /my-tickets` and `GET /` immediately.
  3. Waited > 5s (`~15s` elapsed), reloaded `GET /my-tickets` and `GET /`.
  4. Purchased again on `evt_ed5c0a264409` with `4111111111110001` (`302` → `/my-tickets`), waited 6s, reloaded `GET /my-tickets`, and inspected DB rows for `evt_ed5c0a264409`.
- **Observed Evidence**:
  - Immediately after `0002` purchase: `/my-tickets` showed `<code>F35426WJ</code>` with `<span class="badge badge-ticket-pending">pendente</span>`; `GET /` showed `0 vagas disponíveis` and `Ingressos esgotados`.
  - After gateway rejection (`0002`): `/my-tickets` showed `<code>F35426WJ</code>` with `<span class="badge badge-ticket-declined">recusado</span>`; `GET /` returned to `1 vaga disponível` (without `Ingressos esgotados`).
  - After `0001` purchase + 6s: `/my-tickets` showed `<code>3LOLDKG2</code>` with `<span class="badge badge-ticket-confirmed">confirmado</span>` alongside `F35426WJ` (`recusado`).
  - DB check confirmed both rows: `tkt_7b4a7b544036 | F35426WJ | declined | 11000 | storefront` and `tkt_3e428fd8af3d | 3LOLDKG2 | confirmed | 11000 | storefront`.

---

### `ITEM-05` — Isolamento de participantes em `/my-tickets` e bloqueio de acesso indevido (`F01 → F04`)
- **Result**: **PASS**
- **Commands Executed**:
  1. Logged in as seeded Participante A (`participante@catraca.local` / `Part1234!`) and purchased 1 ticket on `Evento Isolamento F04` (`evt_c9aaebec872c`) with `4111111111110001` (code `ZLEA6P59`).
  2. Registered distinct Participante B (`partb.eval.f04@catraca.local`) and requested `GET /my-tickets`.
  3. Requested `GET /my-tickets` and `POST /events/evt_c9aaebec872c/purchase` without cookies (visitor) and with Organizador A's cookie (`org-a@catraca.local`), then checked DB ticket count for `evt_c9aaebec872c`.
- **Observed Evidence**:
  - Participante B's `GET /my-tickets` contained `Você ainda não possui ingressos` and **0 occurrences** of `ZLEA6P59` and `Evento Isolamento F04`.
  - Visitor `GET /my-tickets` → `HTTP/1.1 302 Found` (`location: /login`); visitor `POST /events/evt_c9aaebec872c/purchase` → `HTTP/1.1 302 Found` (`location: /login`).
  - Organizador A `GET /my-tickets` → `HTTP/1.1 403 Forbidden`; Organizador A `POST /events/evt_c9aaebec872c/purchase` → `HTTP/1.1 403 Forbidden`.
  - DB `SELECT count(*) FROM tickets WHERE event_id = 'evt_c9aaebec872c';` remained `1`.

---

### `ITEM-06` — Tradução literal dos cinco status em português na UI (`pendente`, `confirmado`, `recusado`, `cancelado`, `estornado`)
- **Result**: **PASS**
- **Evidence**:
  - Inspected `src/views/storefront.views.ts` (lines 5–15):
    `TICKET_STATUS_PT: Record<TicketStatus, string>` maps `{ pending: 'pendente', confirmed: 'confirmado', declined: 'recusado', cancelled: 'cancelado', refunded: 'estornado' }`, rendered in `renderMyTicketsPage` via `formatTicketStatusPt(ticket.status)`.
  - Executed `tests/f04.storefront.test.ts` (inside `./scripts/gates.sh`): test `"renders all 5 literal Portuguese ticket statuses in /my-tickets"` passed in `490ms`, asserting `TICKET_STATUS_PT` and verifying all 5 Portuguese labels plus codes `STAT0000`–`STAT0004` in `GET /my-tickets`.

---

### `ITEM-07` — Gates e suíte automatizada passando integralmente
- **Result**: **PASS**
- **Command Executed**: `./scripts/gates.sh`
- **Observed Evidence**:
  - Ran `tsc --noEmit` with 0 errors.
  - Vitest `v3.2.7` ran against isolated `catraca_test` database and exited `0`:
    - `tests/f01.foundation.test.ts`: `8/8` passed (`3960ms`)
    - `tests/f02.events.test.ts`: `6/6` passed (`2855ms`)
    - `tests/f03.purchase-gateway.test.ts`: `7/7` passed (`5155ms`)
    - `tests/f04.storefront.test.ts`: `6/6` passed (`4064ms`)
    - Total: `Test Files 4 passed (4)`, `Tests 27 passed (27)`, Duration `19.15s`.

---

## 3. PRD Traceability Matrix

| Critério PRD | Regras | Contrato | Veredicto | Evidência Principal |
| --- | --- | --- | --- | --- |
| `F04-AC1` | `R02` | `ITEM-01`, `ITEM-07` | **PASS** | `GET /` exibe publicados (`Evento Publicado F04`), oculta `draft` (`Evento Rascunho F04`) e reflete publicação imediata; Vitest `F04-AC1` |
| `F04-AC2` | `R06` | `ITEM-02`, `ITEM-07` | **PASS** | `POST /events/:id/purchase` com `0003` respondeu `302` em `0.015s`, exibiu `pendente` + `5MDART1K` em `/my-tickets` e reduziu vagas (`2`→`1`) |
| `F04-AC3` | `R07` | `ITEM-03`, `ITEM-07` | **PASS** | Evento lotado por ticket `pending` exibiu `Ingressos esgotados` em `/` e rejeitou 2ª compra com `409` (`Ingressos esgotados`), mantendo `1` ticket no DB |
| `F04-AC4` | `R08`, `R09` | `ITEM-02`, `ITEM-04`, `ITEM-06`, `ITEM-07` | **PASS** | `/my-tickets` mapeia os 5 status literais PT-BR; `0002` transitou para `recusado` liberando vaga; `0001` transitou para `confirmado` com código único |
| `CF-04` (`F01 → F04`) | `R09` | `ITEM-02`, `ITEM-05`, `ITEM-07` | **PASS** | Participante recém-cadastrado comprou na vitrine; Participante B não vê ingressos de A; visitante (`302 /login`) e Organizador (`403`) bloqueados |
| `CF-05` (`F02 → F04`) | `R02` | `ITEM-01`, `ITEM-07` | **PASS** | Rascunho criado em `F02` ausente de `/`; após `POST /organizer/events/:id/publish`, apareceu imediatamente com nome, data/hora, local e preço corretos |
| `CF-06` (`F03 → F04`) | `R05`, `R06`, `R07`, `R08` | `ITEM-02`, `ITEM-03`, `ITEM-04`, `ITEM-07` | **PASS** | Motor `F03` reservou vaga em `pendente`, bloqueou overselling (`409`), confirmou `0001` (`confirmado`) e liberou vaga em `0002` (`recusado`) |
