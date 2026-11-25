# Feature Specification: F01 — Fundação, Harness, Autenticação e Seed

**Feature Branch**: `feat/f01-foundation-auth`  
**Created**: 2026-11-25  
**Status**: Approved for Implementation  
**PRD Reference**: `docs/PRD.md` (`F01`, `F01-AC1`–`F01-AC5`, `R13`)  
**Wave**: Wave 1 (Sequencial — Feature Raiz)

---

## Contexto e Escopo

A feature `F01` estabelece toda a fundação executável do **Catraca**: ambiente conteinerizado via Docker Compose (`app` + `db`), scripts obrigatórios de harness (`./scripts/up.sh`, `./scripts/down.sh`, `./scripts/gates.sh`), schema completo no PostgreSQL 16 via Drizzle ORM (`users`, `sessions`, `events`, `tickets`), migrations automatizadas, seed idempotente, layout HTML base em SSR, cadastro/login/logout de usuários por cookie de sessão `HttpOnly` e middlewares de autorização (`requireOrganizer` e `requireParticipant`).

- **Consumes**: Nenhuma (feature raiz).
- **Provides**: Infraestrutura Docker, harness (`up`/`down`/`gates`), `/health`, schema PostgreSQL completo + banco isolado de testes `catraca_test`, seed idempotente (Organizador A, Organizador B, Participante e chave `PARTNER_API_KEY`), autenticação de participante e organizador, layout SSR e guardas de autorização.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Subida, Derrubada e Qualidade Reprodutível via Harness (Priority: P1)

Como avaliador ou desenvolvedor em um clone limpo do repositório, quero subir toda a aplicação e banco com `./scripts/up.sh`, executar validações e testes isolados com `./scripts/gates.sh` e derrubar completamente o ambiente com `./scripts/down.sh`, sem precisar instalar dependências no host ou executar etapas manuais extras.

**Why this priority**: Sem um harness 100% determinístico e autossuficiente, nenhuma feature subsequente pode ser validada de forma confiável no ambiente do avaliador.

**Independent Test**: Executar `./scripts/up.sh`, validar `GET http://localhost:3000/health` retornando `200`, executar `./scripts/gates.sh` confirmando exit code `0` sem sujar o banco principal, executar `./scripts/down.sh` confirmando porta `3000` livre e `docker ps` vazio para o projeto, e subir novamente com `./scripts/up.sh` verificando idempotência da seed.

**Acceptance Scenarios**:

1. **Given** um clone limpo sem containers rodando e sem `node_modules` no host, **When** executo `./scripts/up.sh`, **Then** o Docker Compose constrói e sobe `db` (PostgreSQL 16) e `app` (Node 24 + Fastify 5), aplica as migrations, executa a seed idempotente e aguarda `GET http://localhost:3000/health` responder `200` com `{"status":"ok","db":"ok"}`.
2. **Given** o ambiente em execução, **When** executo `./scripts/down.sh`, **Then** todos os containers e redes do projeto são removidos, nenhum container do projeto aparece em `docker ps` e a porta `3000` deixa de responder.
3. **Given** que o ambiente já foi subido e derrubado anteriormente, **When** executo `./scripts/up.sh` novamente (ou executo a seed repetidas vezes), **Then** a subida conclui sem erros de chave única e os usuários da seed não são duplicados.
4. **Given** o repositório na branch atual, **When** executo `./scripts/gates.sh`, **Then** o script executa `tsc --noEmit` (typecheck strict) e a suíte Vitest dentro de Docker contra o banco isolado `catraca_test`, preservando intactos os dados da seed no banco `catraca` e retornando código `0`.

---

### User Story 2 - Cadastro de Participante e Login/Logout por Sessão (Priority: P1)

Como visitante, quero criar minha conta de participante informando nome, e-mail e senha, fazer login e logout, e como organizador provisionado via seed, quero fazer login e logout na plataforma usando minhas credenciais pré-cadastradas.

**Why this priority**: A identidade autenticada de participantes e organizadores é pré-requisito para a gestão de eventos (`F02`), compras na vitrine (`F04`), check-in/painel (`F06`) e cancelamento (`F07`).

**Independent Test**: Criar conta de participante via `POST /register`, confirmar sessão ativa, fazer `POST /logout`, fazer `POST /login` com o participante criado e também com `org-a@catraca.local` / `OrgA1234!` e `org-b@catraca.local` / `OrgB1234!`.

**Acceptance Scenarios**:

1. **Given** um visitante não autenticado, **When** acessa `GET /register` e submete `POST /register` com nome, e-mail válido único e senha (`>= 6` caracteres), **Then** o usuário é persistido em `users` com `role = 'participant'` e senha hasheada (`scrypt`), uma sessão é gravada em `sessions`, o cookie `catraca_session` (`HttpOnly`, `SameSite=Lax`, `Path=/`) é enviado e o usuário é redirecionado autenticado.
2. **Given** um visitante tentando enviar `role=organizer` no payload de `POST /register` ou buscando auto-cadastro de organizador, **When** a requisição é processada, **Then** o campo `role` enviado pelo cliente é ignorado (a conta criada é sempre `participant`) e não existe nenhuma rota pública para criação de organizadores.
3. **Given** um e-mail já cadastrado, **When** tenta registrar novamente em `POST /register`, **Then** o sistema rejeita com status `400` e mensagem amigável em português sem criar duplicata.
4. **Given** um usuário existente (participante cadastrado, participante seed `participante@catraca.local`, Organizador A `org-a@catraca.local` ou Organizador B `org-b@catraca.local`), **When** submete `POST /login` com e-mail e senha corretos, **Then** recebe cookie `catraca_session` válido; com senha incorreta ou e-mail inexistente, recebe `401` com mensagem de credenciais inválidas.
5. **Given** um usuário autenticado, **When** submete `POST /logout`, **Then** a sessão é removida da tabela `sessions`, o cookie é expirado e requisições autenticadas subsequentes não reconhecem mais o usuário.

---

### User Story 3 - Proteção de Rotas de Organizador (R13) (Priority: P1)

Como administrador de segurança do Catraca, quero garantir que nenhum visitante anônimo nem participante autenticado consiga acessar qualquer rota sob `/organizer/*`, impedindo qualquer vazamento de dados de organizadores.

**Why this priority**: Atende diretamente à regra `R13` e cria o middleware `requireOrganizer` reutilizado por `F02`, `F06` e `F07`.

**Independent Test**: Requisitar `GET /organizer` e `GET /organizer/events` sem cookie, com cookie de participante e com cookie de Organizador A, verificando bloqueio para os dois primeiros e acesso autorizado apenas para o organizador.

**Acceptance Scenarios**:

1. **Given** um visitante sem sessão, **When** tenta acessar qualquer rota `/organizer` ou `/organizer/*`, **Then** recebe redirecionamento `302` para `/login` (ou `403` sem corpo de dados do organizador) sem expor nenhum dado administrativo.
2. **Given** um participante autenticado (`role = 'participant'`), **When** tenta acessar qualquer rota `/organizer` ou `/organizer/*`, **Then** recebe `403 Forbidden` com mensagem de acesso negado e sem expor nenhum dado de eventos ou painel.
3. **Given** um organizador autenticado (`role = 'organizer'`), **When** acessa `/organizer`, **Then** o middleware `requireOrganizer` libera a requisição e injeta `request.currentUser`.

---

### Edge Cases

- **Cookie manipulado ou sessão expirada**: Cookie com ID inexistente ou com `expires_at < NOW()` é tratado como visitante anônimo e limpo sem lançar erro `500`.
- **Normalização de e-mail**: E-mails com espaços nas pontas ou letras maiúsculas (ex.: `Org-A@Catraca.Local`) são normalizados com `trim().toLowerCase()` tanto no cadastro quanto no login.
- **Execução concorrente ou repetida da seed**: `src/db/seed.ts` usa `INSERT ... ON CONFLICT (email) DO NOTHING` (ou upsert seguro mantendo a senha da seed) para garantir idempotência total.
- **Banco de testes `catraca_test`**: Se `catraca_test` ainda não existir quando `./scripts/gates.sh` rodar, o script cria o banco automaticamente, aplica migrations e isola completamente a execução dos dados do banco `catraca`.
- **Variáveis do gateway**: `src/config/env.ts` já carrega com defaults oficiais `PARTNER_API_KEY`, `GATEWAY_FAST_MIN_MS=2000`, `GATEWAY_FAST_MAX_MS=5000`, `GATEWAY_SLOW_MIN_MS=30000`, `GATEWAY_SLOW_MAX_MS=40000`, usados por `F03` e `F05`.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: O sistema DEVE subir via `./scripts/up.sh` usando Docker Compose (`db` PostgreSQL 16 + `app` Node.js 24 LTS na porta `3000`), aplicar migrations, executar a seed idempotente e aguardar `/health` retornar HTTP `200`.
- **FR-002**: O sistema DEVE encerrar completamente via `./scripts/down.sh` (`docker compose down --remove-orphans`), liberando a porta `3000` e não deixando containers do projeto ativos.
- **FR-003**: O sistema DEVE disponibilizar `./scripts/gates.sh` que executa typecheck (`tsc --noEmit`) e suíte Vitest dentro de Docker contra o banco isolado `catraca_test`, sem exigir `npm install` no host e sem alterar o banco principal `catraca`.
- **FR-004**: O endpoint `GET /health` DEVE verificar conectividade real com o PostgreSQL (`SELECT 1`) e retornar `200 {"status":"ok","db":"ok"}` quando saudável (ou `503` se o banco estiver indisponível).
- **FR-005**: O schema Drizzle (`src/db/schema.ts`) e as migrations SQL DEVEM provisionar desde `F01` as 4 tabelas centrais do Catraca: `users`, `sessions`, `events` e `tickets`, com chaves primárias textuais prefixadas (`usr_`, `evt_`, `tkt_`), chaves estrangeiras e restrições `UNIQUE` (`users.email`, `tickets.code`).
- **FR-006**: A seed (`src/db/seed.ts`) DEVE ser idempotente e criar sempre:
  - Organizador A: `org-a@catraca.local` / `OrgA1234!` (`role = 'organizer'`)
  - Organizador B: `org-b@catraca.local` / `OrgB1234!` (`role = 'organizer'`)
  - Participante seed: `participante@catraca.local` / `Part1234!` (`role = 'participant'`)
- **FR-007**: O módulo de autenticação DEVE oferecer cadastro de participante (`GET/POST /register`) exigindo nome, e-mail válido e senha (mínimo 6 caracteres), sempre atribuindo `role = 'participant'`, nunca permitindo cadastro de organizador via UI/HTTP.
- **FR-008**: O módulo de autenticação DEVE oferecer login (`GET/POST /login`) e logout (`POST /logout`) usando hash seguro de senha (`crypto.scrypt` com salt aleatório por usuário e comparação em tempo constante via `timingSafeEqual`) e sessões persistidas em `sessions` com cookie `HttpOnly` (`catraca_session`).
- **FR-009**: O sistema DEVE exportar os middlewares `attachSession`, `requireAuth`, `requireParticipant` e `requireOrganizer`, bloqueando visitantes e participantes em qualquer rota `/organizer/*` (`R13`).
- **FR-010**: O sistema DEVE fornecer layout SSR base (`src/views/layout.ts`) com navegação contextual por perfil (visitante, participante, organizador), CSS limpo embutido/servido estaticamente e helper de escape HTML (`escapeHtml`) contra XSS.

### Key Entities

- **`users`**: `id` (`usr_...` text PK), `name` (text not null), `email` (text unique not null), `password_hash` (text not null), `role` (`'participant' | 'organizer'`, text not null), `created_at` (timestamptz default now).
- **`sessions`**: `id` (text PK, token aleatório 32 bytes hex), `user_id` (text FK → `users.id` ON DELETE CASCADE), `expires_at` (timestamptz not null), `created_at` (timestamptz default now).
- **`events`**: `id` (`evt_...` text PK), `owner_id` (text FK → `users.id`), `name` (text not null), `starts_at` (timestamptz not null), `location` (text not null), `capacity` (integer not null), `price_cents` (integer not null), `status` (`'draft' | 'published' | 'cancelled'`, text not null default `'draft'`), `created_at` (timestamptz), `updated_at` (timestamptz).
- **`tickets`**: `id` (`tkt_...` text PK), `event_id` (text FK → `events.id`), `user_id` (text nullable FK → `users.id`), `buyer_email` (text not null), `code` (text unique not null, 8 chars alfanumérico maiúsculo), `price_cents` (integer not null), `status` (`'pending' | 'confirmed' | 'declined' | 'cancelled' | 'refunded'`, text not null), `checked_in` (boolean not null default false), `checked_in_at` (timestamptz nullable), `channel` (`'storefront' | 'partner_api'`, text not null), `created_at` (timestamptz), `updated_at` (timestamptz).

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001** (`F01-AC1`): Em clone limpo, `./scripts/up.sh` finaliza com exit code `0` e `GET http://localhost:3000/health` retorna `200`.
- **SC-002** (`F01-AC2`): `./scripts/down.sh` encerra todos os containers do projeto e libera a porta `3000`; novo `./scripts/up.sh` conclui com exit code `0` mantendo exatamente 1 registro de cada usuário da seed.
- **SC-003** (`F01-AC3`): `./scripts/gates.sh` executa typecheck e testes Vitest em Docker sobre `catraca_test` retornando exit code `0`, sem alterar registros do banco `catraca`.
- **SC-004** (`F01-AC4`): Fluxo completo de cadastro de participante, login, logout e login de Organizador A e Organizador B funciona ponta a ponta; tentativa de registrar organizador pela interface/POST é impossível.
- **SC-005** (`F01-AC5`, `R13`): Visitante sem sessão e participante autenticado são bloqueados (`302 /login` ou `403`) em rotas `/organizer/*` sem exposição de nenhum dado restrito.

---

## Assumptions

- O ambiente do avaliador possui Docker com Docker Compose (`docker compose`), Bash e `curl`.
- Não há necessidade de envio real de e-mails, recuperação de senha ou verificação de e-mail (fora de escopo no PRD).
- Em `F01`, a rota `GET /` exibe uma página inicial SSR simples (que será evoluída em `F04` para a vitrine completa) e `GET /organizer` exibe uma página inicial da área do organizador protegida por `requireOrganizer` (que em `F02` redireciona/integra com `/organizer/events`).
