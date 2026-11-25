# Implementation Plan: F05 — API de Parceiros (Contrato Fixo)

**Branch**: `005-f05-partner-api` | **Date**: 2026-11-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-f05-partner-api/spec.md`

## Summary

Implementar o plugin Fastify isolado de rotas REST da API de parceiros (`/api/partner/*`) em `src/modules/partner/partner.routes.ts`, atendendo com fidelidade absoluta ao contrato fixo de autenticação (`X-Api-Key`), listagem de eventos (`GET /api/partner/events`), compra concorrente assíncrona (`POST /api/partner/events/:eventId/purchases`) com ordem estrita de validação (`401` → `422` → `404` → `409` → `202`) e consulta de ingresso de qualquer canal (`GET /api/partner/tickets/:ticketId`), acompanhado de suíte automatizada de contrato e concorrência (30 paralelas × 2 rodadas em lotação 5).

## Technical Context

**Language/Version**: TypeScript (strict) sobre Node.js 24 LTS

**Primary Dependencies**: Fastify 5, Drizzle ORM (`pg`), `crypto.timingSafeEqual` (Node built-in) para comparação de API key

**Storage**: PostgreSQL 16 (tabelas `events` e `tickets` em `src/db/schema.ts`)

**Testing**: Vitest (`tests/f05.partner-api.test.ts` rodando contra `catraca_test`, incluindo teste de concorrência com 30 chamadas paralelas em >= 2 rodadas)

**Target Platform**: Linux (container Docker `app` + `db` servindo `$API = http://localhost:3000`)

**Project Type**: web-service (REST JSON API montada no mesmo servidor Fastify 5 do SSR)

**Performance Goals**: `POST /api/partner/events/:eventId/purchases` respondendo `202` em < 300ms (sem aguardar gateway); 30 requisições simultâneas concluindo sem deadlock ou erro `500`.

**Constraints**: Zero desvios nos nomes de campos JSON, códigos HTTP ou strings de erro; `422` validado antes de consulta ao banco; UUID inválido tratado como `404` (nunca `500`); isolamento total de arquivos para merge limpo na Wave 4 paralela.

**Scale/Scope**: 1 módulo novo (`src/modules/partner/partner.routes.ts`), registro de 1 linha em `src/app.ts` e 1 suíte de testes (`tests/f05.partner-api.test.ts`).

## Constitution Check

- **Princípio I (Spec-Driven & Contract-First)**: Artefatos completos em `specs/005-f05-partner-api/` mapeando `F05-AC1`..`F05-AC6` e `CF-07`..`CF-08`. **PASS**.
- **Princípio II (Strict Rule Fidelity)**: Ordem `401` → `422` → `404` → `409` e payloads exatos codificados explicitamente sem fallback para `400` do Fastify. **PASS**.
- **Princípio III (Concurrency & State Safety)**: Delega integralmente a `purchaseTicket()` de `F03` com lock pessimista `SELECT ... FOR UPDATE` e testa 30 chamadas paralelas em pelo menos 2 rodadas. **PASS**.
- **Princípio IV (Minimal Harness)**: Testes integrados em `./scripts/gates.sh` contra `catraca_test`. **PASS**.
- **Princípio V (Independent Evaluation)**: Será auditado em contexto limpo contra `contract.md`. **PASS**.
- **Princípio VI (Simplicity)**: Plugin Fastify enxuto com validação explícita de entrada e mapeamento direto de erros de domínio. **PASS**.

## Project Structure

### Documentation (this feature)

```text
specs/005-f05-partner-api/
├── spec.md              # Especificação do contrato fixo da API de parceiros
├── plan.md              # Este plano de implementação
├── tasks.md             # Checklist executável de tarefas
├── contract.md          # Contrato verificável com rastreabilidade PRD
└── reports/             # Relatórios imutáveis de avaliação independente (eval-NNN.md)
```

### Source Code (repository root)

```text
src/
├── app.ts                                # Registra partnerRoutes com prefixo '/api/partner'
├── config/
│   └── env.ts                            # Reutilizado (PARTNER_API_KEY)
├── db/
│   └── schema.ts                         # Reutilizado (events, tickets)
└── modules/
    ├── purchase/                         # Reutilizado (purchaseTicket, getEventSeatMetrics)
    └── partner/
        └── partner.routes.ts             # Hook X-Api-Key + 3 endpoints do contrato fixo

tests/
└── f05.partner-api.test.ts               # Testes de contrato, validação, gateway e concorrência (30x2)
```

**Structure Decision**: Encapsular toda a API de parceiros em um único plugin Fastify (`src/modules/partner/partner.routes.ts`) registrado com prefixo `/api/partner` evita qualquer colisão de rotas ou hooks com `F04` (storefront) e `F06` (check-in/dashboard) durante a Wave 4 paralela.

## Design Details

### 1. Hook de Autenticação (`onRequest` no plugin `/api/partner`)
- Executa em `onRequest` (antes mesmo do parsing de JSON ou validação de body) para garantir que `401 {"error":"unauthorized"}` vença sempre, inclusive se o body for inválido ou malformado.
- Compara `request.headers['x-api-key']` (exigindo string não vazia) com `env.PARTNER_API_KEY`.
- Falha: `return reply.code(401).send({ error: 'unauthorized' })`.

### 2. Erro de JSON malformado no escopo `/api/partner`
- Definir `fastify.setErrorHandler` escopado ao plugin `/api/partner`: se o Fastify lançar erro de sintaxe JSON no body (`FST_ERR_CTP_INVALID_JSON_BODY` ou status `400` de parsing), responder `422 {"error":"invalid_request"}` em vez de `400`, mantendo aderência estrita ao contrato.

### 3. Endpoints
- **`GET /api/partner/events`**:
  - Busca eventos com `status = 'published'` ordenados por `starts_at ASC`.
  - Para cada evento, calcula `availableSeats` usando `getEventSeatMetrics(event.id)`.
  - Retorna `200` com:
    ```ts
    events.map((e) => ({
      id: e.id,
      name: e.name,
      startsAt: e.startsAt.toISOString(),
      priceCents: e.priceCents,
      availableSeats: metrics.availableSeats,
    }))
    ```
- **`POST /api/partner/events/:eventId/purchases`**:
  - **Passo 1 (`401`)**: já garantido pelo hook `onRequest`.
  - **Passo 2 (`422`)**: validar `request.body` manualmente antes de qualquer consulta ao banco:
    - Body deve ser objeto não nulo.
    - `buyerEmail`: `typeof buyerEmail === 'string'` e corresponde a regex pragmática de e-mail válido (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`) após `.trim()`.
    - `cardNumber`: `typeof cardNumber === 'string'` e corresponde estritamente a `/^\d{16}$/`.
    - Se qualquer verificação falhar → `return reply.code(422).send({ error: 'invalid_request' })`.
  - **Passo 3 (`404`)**: verificar se `eventId` tem formato UUID válido (`/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i`); se não tiver → `return reply.code(404).send({ error: 'event_not_available' })`.
  - **Passos 3–5 (`404` / `409` / `202`)**: invocar `purchaseTicket({ eventId, channel: 'partner_api', userId: null, buyerEmail: buyerEmail.trim(), cardNumber })`:
    - Erro de domínio `event_not_available` (não encontrado, `draft`, `cancelled`) → `404 {"error":"event_not_available"}`.
    - Erro de domínio `sold_out` → `409 {"error":"sold_out"}`.
    - Erro de domínio `invalid_request` → `422 {"error":"invalid_request"}`.
    - Sucesso → `202 {"ticketId": ticket.id, "code": ticket.code, "status": "pending"}`.
- **`GET /api/partner/tickets/:ticketId`**:
  - Validar formato UUID de `ticketId`; se inválido → `404 {"error":"ticket_not_found"}`.
  - Consultar `tickets` por `id = ticketId` (sem filtrar por `channel`!).
  - Se não encontrado → `404 {"error":"ticket_not_found"}`.
  - Retornar `200` com:
    ```json
    {
      "ticketId": "...",
      "code": "...",
      "eventId": "...",
      "status": "pending",
      "checkedIn": false
    }
    ```

### 4. Estratégia de Testes (`tests/f05.partner-api.test.ts`)
- Suíte completa usando `app.inject()` (e/ou HTTP real sobre porta efêmera para concorrência real sobre o pool do PostgreSQL):
  1. `401 {"error":"unauthorized"}` nas 3 rotas (ausente e inválida, inclusive precedendo `422` e `404`).
  2. `GET /api/partner/events` filtrando `draft`/`cancelled`, retornando exatamente os 5 campos e refletindo publicação em `F02` e `availableSeats` de `R05`.
  3. Ordem de erros `422` → `404` → `409` em `POST /api/partner/events/:eventId/purchases` (incluindo `422` em `eventId` inexistente, `404` em `draft`/`cancelled`/inexistente, `409` quando vagas ocupadas por `pending`).
  4. **Teste de concorrência (2 rodadas independentes)**: para cada rodada, cria e publica evento novo com `capacity = 5`, dispara `Promise.all` com 30 chamadas paralelas válidas a `POST /api/partner/events/:eventId/purchases`, confirma exatamente `5 × 202` e `25 × 409 {"error":"sold_out"}`, e verifica exatamente 5 registros na tabela `tickets` para aquele evento.
  5. `GET /api/partner/tickets/:ticketId`: consulta ingresso da API antes (`pending`) e após gateway (`0001` → `confirmed`, `0002` → `declined` liberando vaga em `GET /api/partner/events`), consulta ingresso criado via `storefront`, e verifica `404 {"error":"ticket_not_found"}`.

## Complexity Tracking

Nenhuma violação à Constituição identificada. Validação manual enxuta evita surpresas com o formato padrão de erros `400` do Fastify e garante aderência literal ao contrato fixo.
