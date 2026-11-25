# Relatório de Avaliação Independente — Feature F02 (`eval-001`)

- **Data (ISO-8601):** `2026-11-25T18:57:45Z`
- **Feature:** `F02` — Gestão de Eventos pelo Organizador
- **Branch:** `feat/f02-organizer-events`
- **Commit avaliado:** `bdc5ecedbe9404246ed0e2046eb368479935af72`
- **Ferramenta:** `Google Antigravity`
- **Modelo:** `Gemini 4 Hydrogen`
- **Contrato verificado:** `specs/002-f02-organizer-events/contract.md`
- **Referência PRD:** `docs/PRD.md` (`F02-AC1`–`F02-AC7`, `CF-01`, `R01`, `R02`, `R03`, `R04`, `R13`)
- **Veredicto Geral:** **`APPROVED`**

---

## Resumo por Item

| Item | Descrição | Status |
| --- | --- | --- |
| `ITEM-01` | Gates e testes automatizados (`./scripts/gates.sh`) | **PASS** |
| `ITEM-02` | Autenticação da seed (`F01`) operando `F02` e bloqueio de visitante/participante (`CF-01`, `R13`) | **PASS** |
| `ITEM-03` | Criação de evento válido em rascunho e rejeição de entradas inválidas (`R01`, `R02`) | **PASS** |
| `ITEM-04` | Rejeição de data/hora no passado na criação e na edição (`R01`) | **PASS** |
| `ITEM-05` | Página de gestão em URL própria e publicação do evento (`R02`, `R04`) | **PASS** |
| `ITEM-06` | Proteção de lotação mínima contra vagas ocupadas e aumento de lotação (`R03`) | **PASS** |
| `ITEM-07` | Alteração de preço preserva `price_cents` de ingressos já existentes (`R03`) | **PASS** |
| `ITEM-08` | Isolamento estrito entre Organizador A e Organizador B (`R13`) | **PASS** |

---

## Evidências Detalhadas

### `ITEM-01` — Gates e testes automatizados passando integralmente
- **Comando executado:** `./scripts/gates.sh`
- **Resultado:** Exit code `0`.
  - Migrations aplicadas em `catraca_test`: `[migrate] Database migrations applied successfully.`
  - Typecheck (`tsc --noEmit`): concluído sem erros.
  - Suíte Vitest v3.2.7: `Test Files  2 passed (2)`, `Tests  14 passed (14)` em `8.24s`:
    - `tests/f02.events.test.ts`: **6/6 passed** (`3103ms`)
    - `tests/f01.foundation.test.ts`: **8/8 passed** (`3537ms`)
  - Container temporário removido ao final (`[gates] Tearing down temporary database container...`).

---

### `ITEM-02` — Autenticação da seed (`F01`) operando `F02` e bloqueio de visitante/participante (`CF-01`, `R13`)
- **Setup:** `./scripts/up.sh` executado com sucesso (`[up] Catraca is up and healthy at http://localhost:3000`); `GET http://localhost:3000/health` retornou `200 OK` com `{"status":"ok","db":"ok"}`.
- **Ações e resultados observados:**
  1. **Visitante (sem cookie):**
     - `GET http://localhost:3000/organizer/events` → `HTTP/1.1 302 Found`, `location: /login`, `content-length: 0`.
     - `POST http://localhost:3000/organizer/events` (`-d "name=Test"`) → `HTTP/1.1 302 Found`, `location: /login`, `content-length: 0`.
  2. **Participante (`participante@catraca.local` / `Part1234!`):**
     - Login `POST /login` → `302 Found` (`location: /`), cookie `HttpOnly; SameSite=Lax`.
     - `GET http://localhost:3000/organizer/events` → `HTTP/1.1 403 Forbidden`, HTML exibindo `<h1>Acesso negado</h1>` e `<div class="alert alert-error" role="alert">Acesso restrito a organizadores.</div>` sem nenhum dado administrativo.
     - `POST http://localhost:3000/organizer/events` → `HTTP/1.1 403 Forbidden`, mesmo corpo de acesso negado sem dados administrativos.
  3. **Organizador A (`org-a@catraca.local` / `OrgA1234!`):**
     - Login `POST /login` → `302 Found` (`location: /organizer/events`).
     - `GET http://localhost:3000/organizer/events` → `HTTP/1.1 200 OK`, HTML com `<h1>Área do Organizador</h1>`, `Eventos de Organizador A` e link `/organizer/events/new`.

---

### `ITEM-03` — Criação de evento válido em rascunho e rejeição de entradas inválidas (`R01`, `R02`)
- **Ações e resultados observados (como Organizador A):**
  1. `POST /organizer/events` com `capacity=0`, `price=100.00` → `HTTP_CODE=400`, mensagem `<div class="alert alert-error" role="alert">A lotação deve ser um número inteiro maior ou igual a 1.</div>`.
  2. `POST /organizer/events` com `price=0`, `capacity=10` → `HTTP_CODE=400`, mensagem `<div class="alert alert-error" role="alert">O preço deve ser maior que zero (ex.: 100,00).</div>`.
     `POST /organizer/events` com `price=-10`, `capacity=10` → `HTTP_CODE=400`, mensagem `<div class="alert alert-error" role="alert">Informe um preço válido em reais maior que zero (ex.: 100,00).</div>`.
  3. `POST /organizer/events` com `name=""` → `HTTP_CODE=400`, mensagem `<div class="alert alert-error" role="alert">Nome do evento é obrigatório.</div>`.
     `POST /organizer/events` com `location=""` → `HTTP_CODE=400`, mensagem `<div class="alert alert-error" role="alert">Local do evento é obrigatório.</div>`.
  - Verificação no PostgreSQL antes da criação válida (`SELECT count(*) FROM events;`): `count = 0`.
  4. `POST /organizer/events` válido (`name=Festival Catraca A`, `startsAt=2028-05-10T20:00:00-03:00`, `location=Auditório Principal`, `capacity=10`, `price=100.00`) → `HTTP/1.1 302 Found`, `location: /organizer/events/evt_eb85081d9cec`.
  5. Consulta PostgreSQL após criação:
     ```
             id        |        name        | status | capacity | price_cents |     starts_utc      |      location       |     owner_email
     ------------------+--------------------+--------+----------+-------------+---------------------+---------------------+---------------------
      evt_eb85081d9cec | Festival Catraca A | draft  |       10 |       10000 | 2028-05-10 23:00:00 | Auditório Principal | org-a@catraca.local
     ```

---

### `ITEM-04` — Rejeição de data/hora no passado na criação e na edição (`R01`)
- **Ações e resultados observados (como Organizador A):**
  1. `POST /organizer/events` com `startsAt=2020-01-01T10:00:00-03:00` → `HTTP_CODE=400`, mensagem `<div class="alert alert-error" role="alert">A data e hora de início devem estar no futuro.</div>`.
  2. `POST /organizer/events/evt_eb85081d9cec/edit` com `startsAt=2020-01-01T10:00:00-03:00` → `HTTP_CODE=400`, mensagem `<div class="alert alert-error" role="alert">A data e hora de início devem estar no futuro.</div>`.
- **Verificação no PostgreSQL:**
  ```
          id        |        name        | status |     starts_utc
  ------------------+--------------------+--------+---------------------
   evt_eb85081d9cec | Festival Catraca A | draft  | 2028-05-10 23:00:00
  ```
  Nenhum evento com data no passado foi criado e o evento existente preservou sua data futura original (`2028-05-10 23:00:00` UTC).

---

### `ITEM-05` — Página de gestão em URL própria e publicação do evento (`R02`, `R04`)
- **Ações e resultados observados (como Organizador A):**
  1. `GET /organizer/events/evt_eb85081d9cec` (evento em `draft`) → `HTTP_CODE=200`. HTML exibe título `Festival Catraca A`, status `<span class="badge badge-draft">rascunho</span>`, formulário de publicação (`action="/organizer/events/evt_eb85081d9cec/publish"` com botão `Publicar evento`), formulário de edição (`action="/organizer/events/evt_eb85081d9cec/edit"`) e seções estruturais da página de gestão (`#event-overview`, `#event-edit`, `#event-dashboard-slot`, `#event-checkin-slot`, `#event-cancel-slot`).
  2. `POST /organizer/events/evt_eb85081d9cec/publish` → `HTTP/1.1 302 Found`, `location: /organizer/events/evt_eb85081d9cec?published=1`.
  3. `GET /organizer/events/evt_eb85081d9cec` após publicação → `HTTP_CODE=200`, exibe `<span class="badge badge-published">publicado</span>`.
  - Consulta PostgreSQL:
    ```
            id        |        name        |  status
    ------------------+--------------------+-----------
     evt_eb85081d9cec | Festival Catraca A | published
    ```

---

### `ITEM-06` — Proteção de lotação mínima contra vagas ocupadas e aumento de lotação (`R03`)
- **Ações e resultados observados:**
  1. Inseridos na tabela `tickets` para `evt_eb85081d9cec` (`capacity = 10`):
     - `tkt_eval_01` (`confirmed`, `price_cents = 10000`)
     - `tkt_eval_02` (`confirmed`, `price_cents = 10000`)
     - `tkt_eval_03` (`pending`, `price_cents = 10000`)
     - `tkt_eval_04` (`declined`, `price_cents = 10000`)
     Total de vagas ocupadas = `3` (`2 confirmed + 1 pending`; `declined` não ocupa vaga).
  2. Como Organizador A, `POST /organizer/events/evt_eb85081d9cec/edit` com `capacity=2` → `HTTP_CODE=400`, mensagem `<div class="alert alert-error" role="alert">A lotação não pode ser menor que as vagas já ocupadas (3).</div>`.
     - PostgreSQL permaneceu com `capacity = 10`.
  3. Como Organizador A, `POST /organizer/events/evt_eb85081d9cec/edit` com `capacity=3` → `HTTP_CODE=302` (`location: /organizer/events/evt_eb85081d9cec?saved=1`), PostgreSQL atualizado para `capacity = 3`.
     Em seguida, `POST /organizer/events/evt_eb85081d9cec/edit` com `capacity=15` → `HTTP_CODE=302` (`location: /organizer/events/evt_eb85081d9cec?saved=1`), PostgreSQL atualizado para `capacity = 15`.

---

### `ITEM-07` — Alteração de preço preserva `price_cents` de ingressos já existentes (`R03`)
- **Ações e resultados observados:**
  1. Ingressos existentes confirmados com `price_cents = 10000`.
  2. Como Organizador A, `POST /organizer/events/evt_eb85081d9cec/edit` alterando `price=150.00` (mantendo `startsAt=2028-05-10T20:00` e `capacity=15`) → `HTTP_CODE=302` (`location: /organizer/events/evt_eb85081d9cec?saved=1`).
  3. Consulta PostgreSQL:
     - Tabela `events`: `id = evt_eb85081d9cec`, `capacity = 15`, `price_cents = 15000`.
     - Tabela `tickets`: todos os 4 registros (`tkt_eval_01`..`tkt_eval_04`) mantiveram `price_cents = 10000` inalterado.

---

### `ITEM-08` — Isolamento estrito entre Organizador A e Organizador B (`R13`)
- **Ações e resultados observados (autenticado como Organizador B — `org-b@catraca.local` / `OrgB1234!`):**
  - Login `POST /login` → `302 Found` (`location: /organizer/events`).
  1. `GET http://localhost:3000/organizer/events` → `HTTP_CODE=200`. HTML exibe `Eventos de Organizador B` e `Você ainda não criou nenhum evento.`; **não contém** `"Festival Catraca A"`, `evt_eb85081d9cec` nem `"Auditório Principal"`.
  2. `GET http://localhost:3000/organizer/events/evt_eb85081d9cec` → `HTTP_CODE=403`, HTML exibe `<h1>Acesso negado</h1>` e `Você não tem permissão para acessar este evento.`, com **zero** dados do evento de A.
  3. `POST http://localhost:3000/organizer/events/evt_eb85081d9cec/edit` (tentando alterar nome/preço/lotação) → `HTTP_CODE=403`, `<h1>Acesso negado</h1>`, sem vazar dados do evento de A.
  4. `POST http://localhost:3000/organizer/events/evt_eb85081d9cec/publish` → `HTTP_CODE=403`, `<h1>Acesso negado</h1>`, sem vazar dados do evento de A.
  5. Verificação de integridade no PostgreSQL após tentativas de B:
     ```
             id        |        name        |  status   | capacity | price_cents |      location       |     owner_email
     ------------------+--------------------+-----------+----------+-------------+---------------------+---------------------
      evt_eb85081d9cec | Festival Catraca A | published |       15 |       15000 | Auditório Principal | org-a@catraca.local
     ```

---

## Encerramento do Ambiente

- Executado `./scripts/down.sh` ao final da verificação:
  - Containers `mba-ia-desafio-catraca-app-1` e `mba-ia-desafio-catraca-db-1` e rede `mba-ia-desafio-catraca_default` removidos.
  - `docker ps --filter "name=catraca"` retornou vazio e `http://localhost:3000/health` sem resposta (`PORT_3000_CLOSED`).
