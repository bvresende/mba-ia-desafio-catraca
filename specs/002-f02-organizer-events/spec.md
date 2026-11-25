# Feature Specification: F02 — Gestão de Eventos pelo Organizador

**Feature Branch**: `feat/f02-organizer-events`  
**Created**: 2026-11-25  
**Status**: Approved for Implementation  
**PRD Reference**: `docs/PRD.md` (`F02`, `F02-AC1`–`F02-AC7`, `CF-01`, `R01`, `R02`, `R03`, `R04`, `R13`)  
**Wave**: Wave 2 (Sequencial — depende de `F01`)

---

## Contexto e Escopo

A feature `F02` implementa o fluxo completo de gestão de eventos na área do organizador do **Catraca**: listagem isolada dos próprios eventos (`/organizer/events`), criação em rascunho (`/organizer/events/new`, `POST /organizer/events`), página de gestão em URL própria (`/organizer/events/:eventId`), edição com validação de data futura, proteção de lotação mínima contra vagas ocupadas e atualização de preço vigente apenas para novas compras (`POST /organizer/events/:eventId/edit`), além da publicação (`POST /organizer/events/:eventId/publish`).

- **Consumes**:
  - `F01`: conexão PostgreSQL/Drizzle (`src/db/client.ts`), tabela `events` e `tickets` (`src/db/schema.ts`), sessão de usuário, middleware `requireOrganizer` (`src/modules/auth/auth.middleware.ts`) e layout base SSR (`src/views/layout.ts`).
- **Provides**:
  - Serviço `src/modules/events/events.service.ts` (criação, listagem por organizador, busca com verificação de propriedade, edição com validações `R01`/`R03`, publicação `R02`, contagem de vagas ocupadas).
  - Rotas SSR `src/modules/events/events.routes.ts` e views `src/views/organizer.views.ts`.
  - Página de gestão dedicada `/organizer/events/:eventId` (`R04`) com slots extensíveis limpos para que `F06` (painel e check-in) e `F07` (cancelamento irreversível) se integrem sem reescrever o layout.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Criação de Evento em Rascunho com Validações R01 e R02 (Priority: P1)

Como organizador autenticado, quero criar um novo evento informando nome, data/hora de início no futuro, local, lotação máxima (`>= 1`) e preço em reais (`> 0`), nascendo sempre em rascunho (`draft`), para poder revisá-lo antes de abrir as vendas.

**Why this priority**: É o ponto de entrada do ciclo de vida de qualquer evento no Catraca e estabelece as invariantes `R01` e `R02`.

**Independent Test**: Autenticar como Organizador A (`org-a@catraca.local`), submeter entradas inválidas (data no passado, lotação `0`, preço `0` ou negativo, campos vazios) verificando rejeição `400`, e submeter dados válidos verificando criação com `status = 'draft'` e redirecionamento para `/organizer/events/:eventId`.

**Acceptance Scenarios**:

1. **Given** Organizador A autenticado em `/organizer/events/new`, **When** envia `POST /organizer/events` com nome `"Show Catraca"`, data/hora futura (ex.: `+7 dias`), local `"Arena Central"`, lotação `100` e preço `R$ 120,50` (`120.50` / `12050` centavos), **Then** o evento é salvo em `events` com `owner_id = usr_org_a`, `status = 'draft'`, `price_cents = 12050`, e a resposta redireciona para `/organizer/events/:eventId`.
2. **Given** Organizador A submetendo `POST /organizer/events`, **When** informa data/hora no passado (ex.: ontem), **Then** o sistema rejeita com status `400`, não persiste o evento e renderiza mensagem clara de erro no formulário (`R01`).
3. **Given** Organizador A submetendo `POST /organizer/events`, **When** informa lotação `< 1` (ex.: `0` ou `-5`), lotação não inteira (ex.: `1.5`), preço `<= 0` (ex.: `0` ou `-10`), ou nome/local vazios, **Then** o sistema rejeita com status `400` e não persiste o evento (`R01`).

---

### User Story 2 - Página de Gestão Dedicada, Edição (R01, R03) e Publicação (R02, R04) (Priority: P1)

Como organizador proprietário, quero acessar a página de gestão em URL própria `/organizer/events/:eventId` para editar nome, data futura, local, lotação e preço do evento — com garantia de não reduzir lotação abaixo das vagas ocupadas e de não alterar o preço de ingressos já emitidos — e publicá-lo quando estiver pronto.

**Why this priority**: Garante a existência da URL própria de operação (`R04`) e as regras críticas de mutabilidade de eventos (`R01`, `R02`, `R03`).

**Independent Test**: Abrir `/organizer/events/:eventId`, publicar o evento (`draft` → `published`), editar com data passada (rejeitado), reduzir lotação abaixo do número de ingressos `pending + confirmed` (rejeitado), aumentar lotação (aceito) e alterar preço verificando que `events.price_cents` muda enquanto `tickets.price_cents` existentes permanecem inalterados.

**Acceptance Scenarios**:

1. **Given** um evento em rascunho pertencente ao Organizador A, **When** acessa `GET /organizer/events/:eventId`, **Then** a página exibe dados atuais, status `rascunho`, formulário de edição, botão para publicar (`POST /organizer/events/:eventId/publish`) e áreas/slots estruturados para painel/check-in/cancelamento (`R04`).
2. **Given** o evento em rascunho, **When** Organizador A submete `POST /organizer/events/:eventId/publish`, **Then** `events.status` passa para `published` e a página reflete o status `publicado` (`R02`).
3. **Given** um evento editável, **When** Organizador A envia `POST /organizer/events/:eventId/edit` com data/hora no passado, **Then** a edição é rejeitada (`400`) e o evento mantém a data anterior (`R01`).
4. **Given** um evento com `3` ingressos ocupando vaga (`status IN ('pending', 'confirmed')`) e lotação `5`, **When** Organizador A tenta editar a lotação para `2`, **Then** o sistema rejeita (`400`/`409`) informando que a lotação não pode ser menor que as vagas já ocupadas (`R03`); quando edita a lotação para `10`, a alteração é aceita.
5. **Given** um evento com ingresso já existente salvo com `price_cents = 10000`, **When** Organizador A altera o preço do evento para `R$ 150,00` (`15000`), **Then** `events.price_cents` passa a `15000` e o registro pré-existente na tabela `tickets` mantém `price_cents = 10000` (`R03`).
6. **Given** um evento com `status = 'cancelled'`, **When** Organizador A tenta editar (`POST .../edit`) ou publicar (`POST .../publish`), **Then** o sistema bloqueia a operação (`400`/`409`) preservando `status = 'cancelled'` (preparando compatibilidade total com `F07` / `R11`).

---

### User Story 3 - Isolamento Estrito Entre Organizadores e Perfis (R13, CF-01) (Priority: P1)

Como plataforma multi-organizador, quero garantir que cada organizador veja e opere apenas os próprios eventos (`owner_id`), e que visitantes e participantes da camada de autenticação (`F01`) não consigam acessar nenhuma rota de `F02`.

**Why this priority**: Atende integralmente a `R13` e à aresta cross-feature `CF-01` (`F01 → F02`).

**Independent Test**: Organizador A cria evento `E_A`; Organizador B acessa `GET /organizer/events` (não vê `E_A`), tenta acessar `GET /organizer/events/E_A`, `POST /organizer/events/E_A/edit` e `POST /organizer/events/E_A/publish` (todos bloqueados com `403` ou `404` sem nenhum dado de `E_A`); visitante e participante tentam `GET /organizer/events` e `POST /organizer/events` (bloqueados).

**Acceptance Scenarios**:

1. **Given** Organizador A autenticado via seed de `F01`, **When** acessa `/organizer/events` e cria o evento `"Evento Exclusivo A"`, **Then** vê `"Evento Exclusivo A"` na listagem.
2. **Given** Organizador B autenticado via seed de `F01`, **When** acessa `GET /organizer/events`, **Then** `"Evento Exclusivo A"` **não** aparece na resposta HTML.
3. **Given** Organizador B tentando acesso direto à URL `/organizer/events/:idDeA` (GET, edit ou publish), **Then** recebe `403` (ou `404`) com página genérica que **não contém** o nome, local, preço, lotação nem qualquer dado do evento do Organizador A (`R13`).
4. **Given** visitante não autenticado ou participante autenticado (`F01`), **When** tenta acessar `/organizer/events`, `/organizer/events/new` ou `/organizer/events/:eventId`, **Then** é bloqueado pelo middleware `requireOrganizer` (`302 /login` ou `403`) sem exposição de dados (`CF-01`, `R13`).

---

### Edge Cases

- **Ingressos recusados/cancelados/estornados não bloqueiam redução de lotação**: Somente ingressos com `status IN ('pending', 'confirmed')` contam como vagas ocupadas (`R05`, `R03`). Se um evento de lotação `5` tem `2` ingressos `confirmed` e `3` ingressos `declined`, reduzir a lotação para `2` é permitido, mas para `1` é rejeitado.
- **Formato de preço brasileiro e decimal**: O parser de preço no formulário aceita tanto `"100.50"` quanto `"100,50"` (e inteiros `"100"`), convertendo de forma exata para centavos inteiros (`Math.round` sem erro de ponto flutuante) e rejeitando strings não numéricas, `NaN`, `Infinity` ou `<= 0`.
- **Formato de data/hora (`datetime-local` e ISO-8601)**: O formulário aceita valores de `<input type="datetime-local">` (interpretados no fuso padrão `-03:00` quando sem offset) e strings ISO-8601 completas com offset/UTC (ex.: `2027-06-15T20:00:00-03:00` ou `2027-06-15T23:00:00Z`), validando `startsAt.getTime() > Date.now()`.
- **Publicar evento já publicado**: Ação idempotente (mantém `published` e redireciona para `/organizer/events/:eventId`), nunca reverte para `draft`.
- **ID inexistente em `/organizer/events/:eventId`**: Retorna `404` sem diferenciar entre evento inexistente e evento de outro organizador (ou `403`/`404` sem dados do evento).

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Todas as rotas `/organizer/events*` DEVEM usar o middleware `requireOrganizer` de `F01`, bloqueando visitantes e participantes (`R13`, `CF-01`).
- **FR-002**: `GET /organizer/events` DEVE listar exclusivamente eventos cujo `owner_id` seja igual ao `currentUser.id`, ordenados por data de criação descendente (ou início), com link direto para `/organizer/events/:eventId` e botão para criar novo evento (`/organizer/events/new`).
- **FR-003**: `POST /organizer/events` DEVE validar: `name` não vazio, `location` não vazio, `startsAt` válida e estritamente no futuro (`> now`), `capacity` inteiro `>= 1` e `priceCents` inteiro `> 0`; em caso de sucesso, DEVE criar o registro com `id = evt_<random>`, `owner_id = currentUser.id` e `status = 'draft'` (`R01`, `R02`).
- **FR-004**: `GET /organizer/events/:eventId` DEVE verificar que o evento existe e pertence ao `currentUser.id` (`owner_id === currentUser.id`); caso contrário, DEVE responder `403` ou `404` sem incluir nenhum dado do evento no HTML (`R13`).
- **FR-005**: `GET /organizer/events/:eventId` DEVE renderizar a página de gestão em URL própria (`R04`) contendo dados do evento, status atual, formulário de edição, ação de publicação (quando `draft`) e suporte a seções opcionais extensíveis (`dashboardHtml?`, `checkinHtml?`, `cancelHtml?`) para `F06` e `F07`.
- **FR-006**: `POST /organizer/events/:eventId/edit` DEVE validar propriedade (`owner_id`), rejeitar edição se `status === 'cancelled'`, aplicar todas as validações de `R01` (incluindo data futura), consultar vagas ocupadas (`COUNT(*) WHERE event_id = $1 AND status IN ('pending', 'confirmed')`) e rejeitar se `newCapacity < occupiedSeats` (`R03`), e atualizar `price_cents` somente na tabela `events` sem modificar `tickets.price_cents` (`R03`).
- **FR-007**: `POST /organizer/events/:eventId/publish` DEVE validar propriedade (`owner_id`), rejeitar se `status === 'cancelled'` e atualizar `status = 'published'` e `updated_at = NOW()` (`R02`).
- **FR-008**: A rota `GET /organizer` de `F01` DEVE redirecionar organizadores autenticados diretamente para `/organizer/events`.

### Key Entities

- **`events`** (tabela provisionada em `F01`): `id`, `owner_id`, `name`, `starts_at`, `location`, `capacity`, `price_cents`, `status` (`draft | published | cancelled`), `created_at`, `updated_at`.
- **`tickets`** (consultada em modo leitura em `F02` para cálculo de vagas ocupadas `status IN ('pending', 'confirmed')` na validação de redução de lotação `R03`).

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001** (`F02-AC1`, `F02-AC2`, `R01`): Criação e edição rejeitam 100% das entradas com data no passado, lotação `< 1`, preço `<= 0` ou campos obrigatórios vazios, e aceitam eventos válidos.
- **SC-002** (`F02-AC3`, `R02`): Eventos criados nascem sempre com `status = 'draft'` e passam para `published` via ação de publicação do proprietário.
- **SC-003** (`F02-AC4`, `F02-AC5`, `R03`): Redução de lotação abaixo de `pending + confirmed` é rejeitada; aumento de lotação é aceito; alteração de preço muda apenas `events.price_cents` preservando `tickets.price_cents` já gravados.
- **SC-004** (`F02-AC6`, `R04`): Cada evento é gerenciado em URL própria `/organizer/events/:eventId` com seções estruturadas para edição, publicação e extensão para `F06`/`F07`.
- **SC-005** (`F02-AC7`, `CF-01`, `R13`): Organizador B não vê eventos do Organizador A na listagem nem em acesso direto (`GET`/edit/publish), e visitantes/participantes de `F01` são bloqueados em todas as rotas de `F02`.

---

## Assumptions

- `F02` valida redução de lotação consultando diretamente `tickets` (`status IN ('pending', 'confirmed')`); na Wave 3 (`F03`), essa consulta será unificada com o helper canônico `getOccupiedSeatCount()` / `getEventSeatMetrics()` de `F03` sem alterar o comportamento externo.
- Inputs de data sem timezone explícito vindos de `<input type="datetime-local">` são interpretados no offset padrão `-03:00` (conforme PRD seção 7).
