# Feature Specification: F05 — API de Parceiros (Contrato Fixo)

**Feature Branch**: `005-f05-partner-api`

**Created**: 2026-11-25

**Status**: Draft

**Wave**: Wave 4 (Paralela com `F04` e `F06`)

**Consumes**: `F02` (eventos publicados e não cancelados), `F03` (`purchaseTicket`, `getEventSeatMetrics`, consulta de ingressos, gateway assíncrono)

**Input**: PRD `docs/PRD.md` — Feature `F05`, contrato fixo da API de parceiros, regras `R02`, `R05`, `R06`, `R07`, `R08` e critérios `F05-AC1`..`F05-AC6`, `CF-07`..`CF-08`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Autenticação por chave de parceiro (`X-Api-Key`) (Priority: P1)

Como parceiro externo integrando com o Catraca, preciso autenticar todas as requisições à API de parceiros enviando o cabeçalho `X-Api-Key`, garantindo que qualquer chamada sem chave ou com chave inválida seja rejeitada imediatamente com `401 {"error":"unauthorized"}`.

**Why this priority**: É a primeira barreira obrigatória do contrato fixo (`401` antes de qualquer outra validação em todas as 3 rotas).

**Independent Test**: Chamar `GET /api/partner/events`, `POST /api/partner/events/:eventId/purchases` (inclusive com body inválido) e `GET /api/partner/tickets/:ticketId` sem `X-Api-Key` e com chave incorreta, verificando `401` e exatamente `{"error":"unauthorized"}` em todos os casos.

**Acceptance Scenarios**:

1. **Given** o servidor está configurado com `PARTNER_API_KEY=catraca-partner-dev-key-2026`, **When** um cliente chama qualquer uma das 3 rotas `/api/partner/*` sem o cabeçalho `X-Api-Key`, **Then** a API responde `401 Unauthorized` com corpo JSON exato `{"error":"unauthorized"}`.
2. **Given** um cliente envia `X-Api-Key: chave-errada` em `POST /api/partner/events/inexistente/purchases` com body vazio/inválido, **When** a requisição é processada, **Then** a API responde `401` com `{"error":"unauthorized"}` (prioridade absoluta sobre `422` e `404`).

---

### User Story 2 - Listagem de eventos à venda (`GET /api/partner/events`) (Priority: P1)

Como parceiro externo, quero consultar `GET /api/partner/events` para obter a lista de eventos atualmente à venda (publicados e não cancelados) com identificador, nome, data/hora de início, preço em centavos e vagas disponíveis reais.

**Why this priority**: Permite que sistemas parceiros descubram os eventos abertos e sua disponibilidade conforme `R02` e `R05`.

**Independent Test**: Criar eventos em `draft`, `published` (com ingressos `pending`, `confirmed` e `declined`) e `cancelled`, chamar `GET /api/partner/events` com `X-Api-Key` válido e verificar que apenas os eventos `published` constam no array JSON com `id`, `name`, `startsAt`, `priceCents` e `availableSeats` corretos.

**Acceptance Scenarios**:

1. **Given** existem eventos em `draft`, `published` e `cancelled`, **When** o parceiro chama `GET /api/partner/events` com `X-Api-Key` válido, **Then** recebe `200 OK` com array JSON contendo exclusivamente eventos `published`, cada item possuindo os campos `id`, `name`, `startsAt` (ISO-8601), `priceCents` (inteiro) e `availableSeats` (inteiro >= 0).
2. **Given** um evento `draft` criado em `F02` é publicado, **When** o parceiro chama `GET /api/partner/events` antes e depois da publicação, **Then** o evento fica ausente enquanto `draft` e aparece imediatamente após publicado com `priceCents` e `availableSeats` iguais à lotação inicial.
3. **Given** um evento publicado de lotação 5 tem 1 ingresso `confirmed`, 1 ingresso `pending` e 1 ingresso `declined`, **When** o parceiro chama `GET /api/partner/events`, **Then** `availableSeats` retornado é `3`.

---

### User Story 3 - Compra de ingresso via API de parceiros com ordem estrita de validação e proteção contra concorrência (Priority: P1)

Como parceiro externo, quero comprar 1 ingresso via `POST /api/partner/events/:eventId/purchases` informando `buyerEmail` e `cardNumber`, recebendo `202` imediato com status `pending` ou os códigos de erro exatos do contrato fixo (`422`, `404`, `409`), com garantia absoluta contra overselling sob carga concorrente.

**Why this priority**: É o núcleo transacional do contrato externo avaliado por testes automatizados de validação e estresse concorrente (`30` chamadas paralelas em lotação `5`).

**Independent Test**: Validar cada erro na ordem exata (`401` → `422` → `404` → `409`), realizar compra válida verificando `202 {"ticketId","code","status":"pending"}` e disparar 30 requisições paralelas em 2 rodadas independentes contra eventos de lotação 5 confirmando 5×`202` e 25×`409` em cada rodada.

**Acceptance Scenarios**:

1. **Given** `X-Api-Key` válido, **When** o parceiro envia `POST /api/partner/events/evento-inexistente/purchases` com payload inválido (campo ausente, e-mail inválido ou `cardNumber` diferente de 16 dígitos numéricos), **Then** a API responde `422` com `{"error":"invalid_request"}` (validado antes de consultar a disponibilidade do evento).
2. **Given** `X-Api-Key` válido e payload válido (`buyerEmail` e `cardNumber` com 16 dígitos), **When** o `eventId` não existe, está em `draft` ou está `cancelled`, **Then** a API responde `404` com `{"error":"event_not_available"}`.
3. **Given** um evento publicado está com `availableSeats === 0` (inclusive quando a última vaga está ocupada por um ingresso `pending`), **When** o parceiro envia payload válido, **Then** a API responde `409` com `{"error":"sold_out"}`.
4. **Given** um evento publicado possui vaga disponível e payload válido, **When** o parceiro envia `POST /api/partner/events/:eventId/purchases`, **Then** a API responde imediatamente `202 Accepted` com `{"ticketId","code","status":"pending"}` (sem aguardar o gateway), grava `channel: 'partner_api'`, `user_id: null` e `price_cents` congelado do evento.
5. **Given** um evento novo publicado de lotação `5`, **When** 30 requisições válidas simultâneas são disparadas contra `POST /api/partner/events/:eventId/purchases` (repetido em pelo menos 2 rodadas com eventos distintos), **Then** exatamente 5 respostas retornam `202` e exatamente 25 retornam `409 {"error":"sold_out"}` em cada rodada.

---

### User Story 4 - Consulta de status de ingresso de qualquer canal (`GET /api/partner/tickets/:ticketId`) (Priority: P1)

Como parceiro externo, quero consultar `GET /api/partner/tickets/:ticketId` para acompanhar o status de pagamento (`pending`, `confirmed`, `declined`, `cancelled`, `refunded`) e o booleano `checkedIn` de qualquer ingresso (comprado pela API ou pela vitrine).

**Why this priority**: Fecha o ciclo assíncrono do parceiro (`R08`) e permite auditoria unificada de ingressos independentemente do canal de compra.

**Independent Test**: Consultar um ingresso criado via API logo após a compra (`pending`, `checkedIn: false`), novamente após o gateway (`confirmed` ou `declined`), consultar um ingresso criado via vitrine (`storefront`) e consultar um `ticketId` inexistente (`404 {"error":"ticket_not_found"}`).

**Acceptance Scenarios**:

1. **Given** um ingresso recém-comprado pela API com cartão `0001`, **When** o parceiro consulta `GET /api/partner/tickets/:ticketId` imediatamente e depois após 5s, **Then** recebe `200` com `{"ticketId","code","eventId","status":"pending","checkedIn":false}` inicialmente e `status: "confirmed"` após aprovação do gateway.
2. **Given** um ingresso foi comprado na vitrine (`channel: 'storefront'`), **When** o parceiro consulta `GET /api/partner/tickets/:ticketId` com `X-Api-Key` válido, **Then** recebe `200` com `{"ticketId","code","eventId","status","checkedIn"}`.
3. **Given** um `ticketId` inexistente (ou UUID malformado), **When** o parceiro consulta `GET /api/partner/tickets/:ticketId`, **Then** recebe `404` com `{"error":"ticket_not_found"}`.

---

### Edge Cases

- **UUID malformado em `:eventId` ou `:ticketId`**: nunca deve gerar erro `500` do PostgreSQL. Em `POST /api/partner/events/nao-e-uuid/purchases` com payload válido, retorna `404 {"error":"event_not_available"}`; com payload inválido, retorna `422 {"error":"invalid_request"}`. Em `GET /api/partner/tickets/nao-e-uuid`, retorna `404 {"error":"ticket_not_found"}`.
- **Body ausente, não-JSON ou com tipos incorretos**: `cardNumber` enviado como número JSON em vez de string, ou com espaços/hífens (`"4111-1111-1111-0001"`), ou 15/17 dígitos, ou `buyerEmail` sem `@`/domínio válido → sempre `422 {"error":"invalid_request"}` (nunca `400` padrão do Fastify se for erro de validação de schema).
- **Cabeçalho `X-Api-Key` case-insensitive em HTTP**: Fastify normaliza headers para lowercase (`request.headers['x-api-key']`), garantindo compatibilidade com `X-Api-Key` ou `x-api-key`.
- **Compra recusada pelo gateway (`0002` ou outro final)**: após a recusa, `GET /api/partner/tickets/:ticketId` retorna `status: "declined"` e `GET /api/partner/events` volta a contabilizar a vaga liberada em `availableSeats`.
- **Concorrência mista (API + Vitrine)**: como ambos chamam `purchaseTicket()` de `F03` com `SELECT ... FOR UPDATE`, a soma total nunca ultrapassa `capacity`.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Todas as rotas sob `/api/partner/*` MUST executar um hook de autenticação prévio validando `request.headers['x-api-key'] === env.PARTNER_API_KEY`; caso ausente, vazio ou incorreto, MUST responder imediatamente `401` com `{"error":"unauthorized"}`.
- **FR-002** *(R02, R05)*: `GET /api/partner/events` MUST responder `200` com array JSON contendo apenas eventos com `status = 'published'`, onde cada objeto possui exatamente os campos: `id` (string), `name` (string), `startsAt` (string ISO-8601), `priceCents` (number inteiro), `availableSeats` (number inteiro calculado por `R05`).
- **FR-003** *(R06, R07)*: `POST /api/partner/events/:eventId/purchases` MUST aplicar validações na ordem **estrita e imutável**:
  1. `401 {"error":"unauthorized"}` (autenticação `X-Api-Key`)
  2. `422 {"error":"invalid_request"}` (payload ausente/malformado, `buyerEmail` ausente ou inválido, ou `cardNumber` ausente ou não string que satisfaça `/^\d{16}$/`)
  3. `404 {"error":"event_not_available"}` (`eventId` inválido/inexistente, ou evento com status `draft` ou `cancelled`)
  4. `409 {"error":"sold_out"}` (`availableSeats === 0` sob lock transacional)
  5. `202 {"ticketId","code","status":"pending"}` (sucesso imediato, sem aguardar gateway).
- **FR-004** *(R07)*: `POST /api/partner/events/:eventId/purchases` MUST delegar a criação do ingresso a `purchaseTicket()` de `F03` com `channel: 'partner_api'`, `userId: null`, garantindo lock pessimista `SELECT ... FOR UPDATE` e zero overselling sob 30 requisições paralelas.
- **FR-005** *(R08)*: `GET /api/partner/tickets/:ticketId` MUST responder `200` com `{"ticketId","code","eventId","status","checkedIn"}` para qualquer ingresso existente (independentemente de `channel` ser `'storefront'` ou `'partner_api'`), ou `404 {"error":"ticket_not_found"}` quando inexistente ou ID inválido.
- **FR-006**: A API de parceiros MUST sempre responder `Content-Type: application/json; charset=utf-8` e nunca vazar stack traces ou erros `500` para entradas malformadas conhecidas.

### Key Entities

- **PartnerEventDTO**: `{ id: string, name: string, startsAt: string, priceCents: number, availableSeats: number }`
- **PartnerPurchaseRequest**: `{ buyerEmail: string, cardNumber: string }`
- **PartnerPurchaseResponse (`202`)**: `{ ticketId: string, code: string, status: 'pending' }`
- **PartnerTicketResponse (`200`)**: `{ ticketId: string, code: string, eventId: string, status: 'pending' | 'confirmed' | 'declined' | 'cancelled' | 'refunded', checkedIn: boolean }`
- **PartnerErrorResponse**: `{ error: 'unauthorized' | 'invalid_request' | 'event_not_available' | 'sold_out' | 'ticket_not_found' }`

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% das chamadas sem `X-Api-Key` ou com chave incorreta retornam `401 {"error":"unauthorized"}`, mesmo com payload inválido ou ID inexistente.
- **SC-002**: 100% dos cenários de validação de `POST /api/partner/events/:eventId/purchases` obedecem à ordem `401` → `422` → `404` → `409` → `202` com os payloads JSON exatos.
- **SC-003**: Em pelo menos 2 rodadas automatizadas independentes de 30 requisições paralelas contra eventos de lotação 5, cada rodada resulta em exatamente `5 × 202` e `25 × 409 {"error":"sold_out"}`, com exatamente 5 ingressos persistidos no banco por evento.
- **SC-004**: `GET /api/partner/tickets/:ticketId` retorna `200` com status atualizado (`confirmed`/`declined`) após processamento do gateway tanto para ingressos da API quanto para ingressos da vitrine, e `404 {"error":"ticket_not_found"}` para IDs ausentes.

## Assumptions

- `env.PARTNER_API_KEY` já é carregado e validado na configuração de ambiente criada em `F01`, com valor padrão `catraca-partner-dev-key-2026` no ambiente Docker local.
- `purchaseTicket()`, `getEventSeatMetrics()` e o gateway simulado de `F03` estão disponíveis e encapsulam a transação PostgreSQL com `SELECT ... FOR UPDATE`.
- A validação de `POST /api/partner/events/:eventId/purchases` é executada manualmente no handler (ou via validador dedicado após o hook de auth) em vez de depender do erro `400` padrão do JSON Schema do Fastify, para garantir retorno exato `422 {"error":"invalid_request"}`.
