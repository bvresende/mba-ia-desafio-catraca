# Contract: F01 — Fundação, Harness, Autenticação e Seed

**Feature**: `F01` — Fundação, Harness, Autenticação e Seed  
**Branch**: `feat/f01-foundation-auth`  
**PRD Reference**: `docs/PRD.md` (`F01-AC1`–`F01-AC5`, `R13`)  
**Evaluation Policy**: Este contrato deve ser verificado por um avaliador independente em contexto limpo, gravando o resultado em `specs/001-f01-foundation-auth/reports/eval-NNN.md`.

---

## 1. Pré-requisitos de Ambiente

- Linux ou macOS com Docker (`docker compose`), Bash e `curl` disponíveis.
- Porta `3000` livre antes do início da avaliação.
- Repositório no commit a ser avaliado, sem necessidade de executar `npm install` no host.
- Credenciais da seed (modo padrão):
  - Organizador A: `org-a@catraca.local` / `OrgA1234!`
  - Organizador B: `org-b@catraca.local` / `OrgB1234!`
  - Participante seed: `participante@catraca.local` / `Part1234!`

---

## 2. Itens Verificáveis

### `ITEM-01` — Subida limpa via `./scripts/up.sh` e `/health` retornando `200`
- **Comando / Ação**:
  ```bash
  ./scripts/down.sh >/dev/null 2>&1 || true
  ./scripts/up.sh
  curl -i -s http://localhost:3000/health
  ```
- **Critério de Aprovação**:
  - `./scripts/up.sh` conclui com exit code `0` sem exigir passos manuais extras.
  - `GET http://localhost:3000/health` retorna HTTP `200` com JSON indicando saúde da aplicação e do banco (ex.: `{"status":"ok","db":"ok"}`).

### `ITEM-02` — Derrubada limpa via `./scripts/down.sh`
- **Comando / Ação**:
  ```bash
  ./scripts/down.sh
  docker compose ps -q
  curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/health || echo "CONNECTION_REFUSED"
  ```
- **Critério de Aprovação**:
  - `./scripts/down.sh` conclui com exit code `0`.
  - `docker compose ps -q` não retorna nenhum container em execução do projeto.
  - A porta `3000` não responde (conexão recusada).

### `ITEM-03` — Re-subida e idempotência da seed
- **Comando / Ação**:
  ```bash
  ./scripts/up.sh
  docker compose exec -T app npm run db:seed
  docker compose exec -T db psql -U catraca -d catraca -t -A -c "SELECT email, role, COUNT(*) FROM users WHERE email IN ('org-a@catraca.local','org-b@catraca.local','participante@catraca.local') GROUP BY email, role ORDER BY email;"
  ```
- **Critério de Aprovação**:
  - `./scripts/up.sh` e a reexecução explícita de `npm run db:seed` concluem com exit code `0` (sem erros de constraint única).
  - A consulta ao PostgreSQL retorna exatamente 3 linhas com contagem `1` cada:
    - `org-a@catraca.local|organizer|1`
    - `org-b@catraca.local|organizer|1`
    - `participante@catraca.local|participant|1`

### `ITEM-04` — Execução de `./scripts/gates.sh` contra banco isolado `catraca_test`
- **Comando / Ação**:
  ```bash
  ./scripts/gates.sh
  docker compose exec -T db psql -U catraca -d catraca -t -A -c "SELECT COUNT(*) FROM users WHERE email IN ('org-a@catraca.local','org-b@catraca.local','participante@catraca.local');"
  ```
- **Critério de Aprovação**:
  - `./scripts/gates.sh` executa `tsc --noEmit` e toda a suíte Vitest dentro de Docker contra `catraca_test` e finaliza com exit code `0` (sem exigir `npm install` no host).
  - Os 3 usuários da seed permanecem intactos no banco principal `catraca` (contagem `3`).

### `ITEM-05` — Schema completo das 4 tabelas provisionado no PostgreSQL
- **Comando / Ação**:
  ```bash
  docker compose exec -T db psql -U catraca -d catraca -t -A -c "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('users','sessions','events','tickets') ORDER BY table_name;"
  ```
- **Critério de Aprovação**:
  - Retorna exatamente as 4 tabelas: `events`, `sessions`, `tickets`, `users`.

### `ITEM-06` — Cadastro, login e logout de participante; impossibilidade de auto-cadastro de organizador
- **Comando / Ação**:
  1. Enviar `POST http://localhost:3000/register` com `name=Maria Teste`, `email=maria.f01@catraca.local`, `password=Senha123!`, `role=organizer` (tentando escalar privilégio), salvando cookie em jar.
  2. Verificar no banco que `maria.f01@catraca.local` foi criada com `role = 'participant'` (e nunca `organizer`).
  3. Reenviar `POST /register` com o mesmo e-mail e verificar rejeição (`400`, sem duplicar usuário).
  4. Executar `POST http://localhost:3000/logout` com o cookie da participante e verificar invalidação da sessão.
  5. Executar `POST http://localhost:3000/login` com `email=maria.f01@catraca.local` e senha errada (`401`) e depois com a senha correta (`302` + cookie `HttpOnly` `catraca_session`).
- **Critério de Aprovação**:
  - Visitante cria conta de participante, faz logout e login com sucesso.
  - Tentativa de enviar `role=organizer` resulta em usuário com `role = 'participant'`.
  - Cookie de sessão possui atributo `HttpOnly`.

### `ITEM-07` — Login dos organizadores da seed (`Organizador A` e `Organizador B`)
- **Comando / Ação**:
  1. `POST http://localhost:3000/login` com `email=org-a@catraca.local` e `password=OrgA1234!`, salvando cookie em `org_a.cookies`, seguido de `GET http://localhost:3000/organizer` usando `org_a.cookies`.
  2. `POST http://localhost:3000/login` com `email=org-b@catraca.local` e `password=OrgB1234!`, salvando cookie em `org_b.cookies`, seguido de `GET http://localhost:3000/organizer` usando `org_b.cookies`.
- **Critério de Aprovação**:
  - Ambos os logins autenticam com sucesso (cookie `HttpOnly` emitido) e conseguem acessar `GET /organizer` (HTTP `200` ou `302` para rota interna autorizada do organizador).

### `ITEM-08` — Bloqueio de acesso a `/organizer/*` para visitante e participante (`R13`)
- **Comando / Ação**:
  1. Sem cookie (visitante): `curl -i -s http://localhost:3000/organizer` e `curl -i -s http://localhost:3000/organizer/events`.
  2. Com cookie de participante autenticado (`participante@catraca.local` / `Part1234!`): `curl -i -s -b part.cookies http://localhost:3000/organizer` e `curl -i -s -b part.cookies http://localhost:3000/organizer/events`.
- **Critério de Aprovação**:
  - Visitante recebe `302` (redirecionamento para `/login`) ou `403`, sem expor dados da área de organizador.
  - Participante autenticado recebe `403`, sem expor dados da área de organizador.

---

## 3. Matriz de Rastreabilidade (PRD → Contrato)

| Critério PRD | Regras | Itens do Contrato que Comprovam |
| --- | --- | --- |
| `F01-AC1` | — | `ITEM-01`, `ITEM-05` |
| `F01-AC2` | — | `ITEM-02`, `ITEM-03` |
| `F01-AC3` | — | `ITEM-04` |
| `F01-AC4` | — | `ITEM-03`, `ITEM-06`, `ITEM-07` |
| `F01-AC5` | `R13` | `ITEM-08` |
