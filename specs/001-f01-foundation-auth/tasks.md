---
description: "Checklist executável de tarefas para F01 — Fundação, Harness, Autenticação e Seed"
---

# Tasks: F01 — Fundação, Harness, Autenticação e Seed

**Input**: Design documents from `/specs/001-f01-foundation-auth/`  
**Prerequisites**: `spec.md`, `plan.md`, `contract.md`  
**Branch**: `feat/f01-foundation-auth`

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Pode ser executado em paralelo (arquivos distintos, sem dependências)
- **[Story]**: História de usuário associada (`US1`, `US2`, `US3`)

---

## Phase 1: Setup do Projeto e Docker

**Purpose**: Inicializar configuração Node.js 24, TypeScript strict, Vitest e containers Docker.

- [ ] T001 [US1] Criar `package.json` com dependências (`fastify`, `@fastify/cookie`, `@fastify/formbody`, `drizzle-orm`, `pg`, `typescript`, `tsx`, `vitest`, `@types/node`, `@types/pg`) e scripts (`build`, `start`, `typecheck`, `test`, `db:migrate`, `db:seed`, `up`, `down`, `gates`).
- [ ] T002 [P] [US1] Criar `tsconfig.json` (strict mode, `NodeNext`, `noEmit` compatível com typecheck) e `vitest.config.ts`.
- [ ] T003 [P] [US1] Criar `Dockerfile` baseado em `node:24-alpine` instalando dependências e preparando execução da aplicação e testes.
- [ ] T004 [US1] Criar `docker-compose.yml` com serviços `db` (`postgres:16-alpine` com healthcheck) e `app` (porta `3000:3000`, `depends_on` com `service_healthy`, variáveis padrão incluindo `PARTNER_API_KEY` e atrasos oficiais do gateway).

---

## Phase 2: Fundação de Banco de Dados, Migrations e Seed

**Purpose**: Provisionar configuração, cliente PostgreSQL/Drizzle, schema completo das 4 tabelas, migrations e seed idempotente.

- [ ] T005 [US1] Implementar `src/config/env.ts` com parsing tipado das variáveis de ambiente e defaults oficiais.
- [ ] T006 [US1] Implementar `src/db/schema.ts` com as tabelas `users`, `sessions`, `events` e `tickets` (colunas, FKs, constraints `UNIQUE` e tipos TypeScript exportados).
- [ ] T007 [US1] Implementar `src/db/client.ts` exportando `pool`, instância `db` (Drizzle) e função `closeDb()`.
- [ ] T008 [US1] Implementar `src/db/migrate.ts` com criação idempotente das tabelas e índices no PostgreSQL (executável via CLI `npm run db:migrate` e exportando `runMigrations()`).
- [ ] T009 [US1] Implementar `src/modules/auth/password.ts` com `hashPassword()` (`scrypt` + salt aleatório) e `verifyPassword()` (`timingSafeEqual`).
- [ ] T010 [US1] Implementar `src/db/seed.ts` idempotente criando Organizador A (`org-a@catraca.local` / `OrgA1234!`), Organizador B (`org-b@catraca.local` / `OrgB1234!`) e Participante (`participante@catraca.local` / `Part1234!`), exportando `runSeed()`.

---

## Phase 3: User Story 2 e 3 — Autenticação, Views SSR e Controle de Acesso (R13)

**Purpose**: Entregar cadastro de participante, login/logout por cookie de sessão e proteção de rotas `/organizer/*`.

- [ ] T011 [P] [US2] Implementar `src/views/layout.ts` com layout HTML base SSR, CSS limpo, barra de navegação contextual por perfil e utilitário `escapeHtml()`.
- [ ] T012 [P] [US2] Implementar `src/views/auth.views.ts` com páginas SSR de cadastro (`/register`), login (`/login`), página inicial base (`/`) e página de acesso negado (`403`).
- [ ] T013 [US2] Implementar `src/modules/auth/auth.service.ts` (`registerParticipant`, `authenticateUser`, `createSession`, `getSessionUser`, `deleteSession`), forçando sempre `role = 'participant'` no cadastro e normalizando e-mails.
- [ ] T014 [US3] Implementar `src/modules/auth/auth.middleware.ts` com `attachSession`, `requireAuth`, `requireParticipant` e `requireOrganizer` (bloqueando visitantes com `302 /login` e participantes com `403` sem expor dados).
- [ ] T015 [US2] Implementar `src/modules/auth/auth.routes.ts` com `GET/POST /register`, `GET/POST /login`, `POST /logout` e rota protegida `GET /organizer` (com `requireOrganizer`) + guarda para rotas sob `/organizer/*`.
- [ ] T016 [US1] Implementar `src/app.ts` (`buildApp()` com Fastify 5, cookies, formbody, `attachSession`, `GET /health` checando PostgreSQL e registro de rotas) e `src/server.ts` com shutdown gracioso.

---

## Phase 4: Scripts de Harness e Suíte de Testes Automatizados

**Purpose**: Garantir operação autossuficiente (`up.sh`, `down.sh`, `gates.sh`) e cobertura automatizada de todos os critérios `F01-AC1`–`F01-AC5`.

- [ ] T017 [P] [US1] Criar e dar permissão de execução (`chmod +x`) em `scripts/up.sh`, `scripts/down.sh` e `scripts/gates.sh` (criando/migrando `catraca_test` isoladamente sem tocar no banco `catraca`).
- [ ] T018 [US1] Implementar `tests/helpers/test-db.ts` com utilitários de migração, limpeza segura de tabelas (`TRUNCATE ... CASCADE`) e seed para testes isolados em `catraca_test`.
- [ ] T019 [US2] Implementar `tests/f01.foundation.test.ts` cobrindo:
  - `/health` retornando `200 {"status":"ok","db":"ok"}`;
  - idempotência da seed (execução dupla sem duplicar usuários);
  - cadastro de participante (incluindo tentativa maliciosa com `role=organizer` sendo ignorada e rejeição de e-mail duplicado);
  - login/logout de participante e de Organizador A e B;
  - bloqueio `R13` de visitante e participante em `/organizer` e `/organizer/*`, e liberação para organizador.

---

## Phase 5: Validação Final de F01

- [ ] T020 [US1] Executar `./scripts/up.sh`, validar `GET http://localhost:3000/health`, rodar `./scripts/gates.sh` confirmando exit code `0`, rodar `./scripts/down.sh` confirmando ausência de containers e porta `3000` livre, e subir novamente com `./scripts/up.sh` confirmando idempotência.
