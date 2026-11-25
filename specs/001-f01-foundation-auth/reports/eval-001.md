# Relatório de Avaliação Independente — `F01` (`eval-001`)

- **Data (ISO-8601):** `2026-11-25T15:49:57-03:00`
- **Feature:** `F01` — Fundação, Harness, Autenticação e Seed
- **Branch:** `feat/f01-foundation-auth`
- **Evaluated Commit:** `8d58fc9b247c879bf71553d6faf851a52b33b521`
- **Tool:** `Google Antigravity`
- **Model:** `Gemini 4 Hydrogen`
- **Verdict:** `APPROVED`

---

## 1. Resumo dos Itens do Contrato (`specs/001-f01-foundation-auth/contract.md`)

| Item | Descrição | Status | Evidência Principal |
| --- | --- | --- | --- |
| `ITEM-01` | Subida limpa via `./scripts/up.sh` e `/health` retornando `200` | PASS | Exit code `0`; `GET /health` -> `200 OK` `{"status":"ok","db":"ok"}` |
| `ITEM-02` | Derrubada limpa via `./scripts/down.sh` | PASS | Exit code `0`; `docker compose ps -q` vazio; porta `3000` -> `000` (`CONNECTION_REFUSED`) |
| `ITEM-03` | Re-subida e idempotência da seed | PASS | `./scripts/up.sh` e `npm run db:seed` exit `0`; 3 linhas com contagem `1` cada |
| `ITEM-04` | Execução de `./scripts/gates.sh` contra banco isolado `catraca_test` | PASS | `tsc --noEmit` + Vitest (`1` arquivo, `8/8` testes) exit `0`; seed no banco `catraca` intacta (`3`) |
| `ITEM-05` | Schema completo das 4 tabelas provisionado no PostgreSQL | PASS | `information_schema.tables` retornou exatamente `events`, `sessions`, `tickets`, `users` |
| `ITEM-06` | Cadastro, login e logout de participante; impossibilidade de auto-cadastro de organizador | PASS | `role=organizer` ignorado (`participant` no DB); duplicado `400`; logout invalida sessão (`0` no DB); senha errada `401`; login válido `302` + cookie `HttpOnly` `catraca_session` |
| `ITEM-07` | Login dos organizadores da seed (`Organizador A` e `Organizador B`) | PASS | Ambos retornam `302` com cookie `HttpOnly` e acessam `/organizer` (`302` -> `/organizer/events` -> `200 OK`) |
| `ITEM-08` | Bloqueio de acesso a `/organizer/*` para visitante e participante (`R13`) | PASS | Visitante recebe `302` (`location: /login`); participante recebe `403 Forbidden` em `/organizer` e `/organizer/events` sem expor dados |

---

## 2. Rastreabilidade PRD → Contrato (`docs/PRD.md`)

Verificado que todos os critérios `F01-AC*` em `docs/PRD.md` estão mapeados na Seção 3 de `specs/001-f01-foundation-auth/contract.md` e foram aprovados nesta avaliação:

| Critério PRD | Regras | Itens do Contrato | Resultado |
| --- | --- | --- | --- |
| `F01-AC1` | — | `ITEM-01`, `ITEM-05` | PASS |
| `F01-AC2` | — | `ITEM-02`, `ITEM-03` | PASS |
| `F01-AC3` | — | `ITEM-04` | PASS |
| `F01-AC4` | — | `ITEM-03`, `ITEM-06`, `ITEM-07` | PASS |
| `F01-AC5` | `R13` | `ITEM-08` | PASS |

---

## 3. Evidências Detalhadas por Item

### `ITEM-01` — Subida limpa via `./scripts/up.sh` e `/health` retornando `200`
- **Comandos executados:**
  ```bash
  ./scripts/down.sh >/dev/null 2>&1 || true && ./scripts/up.sh && curl -i -s http://localhost:3000/health
  ```
- **Resultado observado:**
  - Exit code `0`.
  - Containers `mba-ia-desafio-catraca-db-1` (Healthy) e `mba-ia-desafio-catraca-app-1` (Started) subiram, `db:migrate` e `db:seed` executaram sem erros, e `[up] Catraca is up and healthy at http://localhost:3000`.
  - Resposta HTTP de `GET http://localhost:3000/health`:
    ```http
    HTTP/1.1 200 OK
    content-type: application/json; charset=utf-8
    content-length: 25

    {"status":"ok","db":"ok"}
    ```

### `ITEM-02` — Derrubada limpa via `./scripts/down.sh`
- **Comandos executados:**
  ```bash
  ./scripts/down.sh
  docker compose ps -q
  curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/health || echo "CONNECTION_REFUSED"
  ```
- **Resultado observado:**
  - `./scripts/down.sh` concluiu com exit code `0`, removendo `mba-ia-desafio-catraca-app-1`, `mba-ia-desafio-catraca-db-1` e a rede `mba-ia-desafio-catraca_default`.
  - `docker compose ps -q` retornou saída vazia.
  - `curl` retornou código `000` e imprimiu `CONNECTION_REFUSED`.

### `ITEM-03` — Re-subida e idempotência da seed
- **Comandos executados:**
  ```bash
  ./scripts/up.sh
  docker compose exec -T app npm run db:seed
  docker compose exec -T db psql -U catraca -d catraca -t -A -c "SELECT email, role, COUNT(*) FROM users WHERE email IN ('org-a@catraca.local','org-b@catraca.local','participante@catraca.local') GROUP BY email, role ORDER BY email;"
  ```
- **Resultado observado:**
  - `./scripts/up.sh` e `npm run db:seed` concluíram com exit code `0` (`[seed] Idempotent seed completed.`).
  - Saída exata da query PostgreSQL:
    ```text
    org-a@catraca.local|organizer|1
    org-b@catraca.local|organizer|1
    participante@catraca.local|participant|1
    ```

### `ITEM-04` — Execução de `./scripts/gates.sh` contra banco isolado `catraca_test`
- **Comandos executados:**
  ```bash
  ./scripts/gates.sh
  docker compose exec -T db psql -U catraca -d catraca -t -A -c "SELECT COUNT(*) FROM users WHERE email IN ('org-a@catraca.local','org-b@catraca.local','participante@catraca.local');"
  ```
- **Resultado observado:**
  - `./scripts/gates.sh` concluiu com exit code `0` (`[gates] All gates passed.`), executando migrations em `catraca_test`, `tsc --noEmit` e `vitest run` dentro do container Docker:
    ```text
    ✓ tests/f01.foundation.test.ts (8 tests) 3667ms
      ✓ F01 — Fundação, Harness, Autenticação e Seed > GET /health returns 200 with ok status and db connectivity  386ms
      ✓ F01 — Fundação, Harness, Autenticação e Seed > provisions all 4 core tables in PostgreSQL  364ms
      ✓ F01 — Fundação, Harness, Autenticação e Seed > runs seed idempotently without duplicating seed users  571ms
      ✓ F01 — Fundação, Harness, Autenticação e Seed > registers a participant, ignores client-supplied role=organizer, and rejects duplicate emails  516ms
      ✓ F01 — Fundação, Harness, Autenticação e Seed > authenticates seeded Organizador A and Organizador B and grants access to /organizer/*  466ms
      ✓ F01 — Fundação, Harness, Autenticação e Seed > enforces R13: blocks visitors and participants from /organizer and /organizer/*  475ms
      ✓ F01 — Fundação, Harness, Autenticação e Seed > handles manipulated or expired session cookies gracefully without 500  380ms
      ✓ F01 — Fundação, Harness, Autenticação e Seed > escapes HTML special characters in escapeHtml helper  409ms
    Test Files  1 passed (1)
         Tests  8 passed (8)
    ```
  - Contagem dos 3 usuários da seed no banco principal `catraca` permaneceu intacta: `3`.

### `ITEM-05` — Schema completo das 4 tabelas provisionado no PostgreSQL
- **Comando executado:**
  ```bash
  docker compose exec -T db psql -U catraca -d catraca -t -A -c "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('users','sessions','events','tickets') ORDER BY table_name;"
  ```
- **Resultado observado:**
  ```text
  events
  sessions
  tickets
  users
  ```

### `ITEM-06` — Cadastro, login e logout de participante; impossibilidade de auto-cadastro de organizador
- **Comandos executados e resultados:**
  1. `GET http://localhost:3000/register` exibe apenas campos `name`, `email` e `password` (sem seletor de perfil/organizador).
  2. `POST http://localhost:3000/register` com `name=Maria Teste`, `email=maria.f01@catraca.local`, `password=Senha123!`, `role=organizer`:
     - Retornou `HTTP/1.1 302 Found` (`location: /`) e cookie `catraca_session=...; Path=/; HttpOnly; SameSite=Lax`.
     - Consulta no banco (`SELECT email, name, role FROM users WHERE email = 'maria.f01@catraca.local';`) retornou: `maria.f01@catraca.local|Maria Teste|participant`.
  3. Reenvio de `POST /register` com o mesmo e-mail (`maria.f01@catraca.local`):
     - Retornou `HTTP/1.1 400 Bad Request` (`content-type: text/html; charset=utf-8`).
     - Contagem no banco para `maria.f01@catraca.local` permaneceu `1`.
  4. `POST http://localhost:3000/logout` com o cookie da participante:
     - Retornou `HTTP/1.1 302 Found` (`location: /`) limpando `catraca_session=; Max-Age=0`.
     - Sessões no banco para `maria.f01@catraca.local` caíram de `1` para `0`; requisição subsequente com o cookie antigo em `GET /` exibiu link `Entrar` (não autenticada).
  5. `POST http://localhost:3000/login` com senha errada (`WrongPassword!`):
     - Retornou `HTTP/1.1 401 Unauthorized`.
  6. `POST http://localhost:3000/login` com senha correta (`Senha123!`):
     - Retornou `HTTP/1.1 302 Found` (`location: /`) e emitiu cookie `catraca_session` com atributo `HttpOnly` (`#HttpOnly_localhost ... catraca_session`).

### `ITEM-07` — Login dos organizadores da seed (`Organizador A` e `Organizador B`)
- **Comandos executados e resultados:**
  1. `POST http://localhost:3000/login` com `email=org-a@catraca.local&password=OrgA1234!`:
     - Retornou `HTTP/1.1 302 Found`, `location: /organizer/events`, `set-cookie: catraca_session=...; Path=/; HttpOnly; SameSite=Lax`.
     - `GET http://localhost:3000/organizer` com `org_a.cookies` retornou `HTTP/1.1 302 Found` (`location: /organizer/events`); `GET http://localhost:3000/organizer/events` retornou `HTTP/1.1 200 OK` (`<title>Área do Organizador — Catraca</title>`).
  2. `POST http://localhost:3000/login` com `email=org-b@catraca.local&password=OrgB1234!`:
     - Retornou `HTTP/1.1 302 Found`, `location: /organizer/events`, `set-cookie: catraca_session=...; Path=/; HttpOnly; SameSite=Lax`.
     - `GET http://localhost:3000/organizer` com `org_b.cookies` retornou `HTTP/1.1 302 Found` (`location: /organizer/events`); `GET http://localhost:3000/organizer/events` retornou `HTTP/1.1 200 OK` (`<title>Área do Organizador — Catraca</title>`).

### `ITEM-08` — Bloqueio de acesso a `/organizer/*` para visitante e participante (`R13`)
- **Comandos executados e resultados:**
  1. Visitante (sem cookie):
     - `GET http://localhost:3000/organizer` -> `HTTP/1.1 302 Found`, `location: /login`, `content-length: 0`.
     - `GET http://localhost:3000/organizer/events` -> `HTTP/1.1 302 Found`, `location: /login`, `content-length: 0`.
  2. Participante autenticado (`participante@catraca.local` / `Part1234!`, login `302` com cookie `HttpOnly`):
     - `GET http://localhost:3000/organizer` -> `HTTP/1.1 403 Forbidden`.
     - `GET http://localhost:3000/organizer/events` -> `HTTP/1.1 403 Forbidden`, página `<title>Acesso negado — Catraca</title>` com mensagem `Acesso restrito a organizadores.` e nenhum dado da área de organizador exposto.

---

## 4. Limpeza Pós-Avaliação

- Cookies temporários removidos e `./scripts/down.sh` executado ao término da avaliação (`docker compose ps -q` vazio, ambiente limpo).
