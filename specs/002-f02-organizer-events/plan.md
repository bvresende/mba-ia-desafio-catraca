# Implementation Plan: F02 — Gestão de Eventos pelo Organizador

**Branch**: `feat/f02-organizer-events` | **Date**: 2026-11-25 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `/specs/002-f02-organizer-events/spec.md`

---

## Summary

Implementar o módulo de gestão de eventos do organizador (`src/modules/events/` e `src/views/organizer.views.ts`) sobre a fundação de `F01`, cobrindo criação em rascunho, validação estrita de data futura, lotação e preço (`R01`), publicação (`R02`), edição segura quanto a lotação ocupada e preço congelado (`R03`), página de gestão dedicada `/organizer/events/:eventId` com slots extensíveis (`R04`) e isolamento completo por `owner_id` e perfil (`R13`, `CF-01`).

---

## Technical Context

- **Language/Version**: TypeScript 5.x (strict) sobre Node.js 24 LTS
- **Primary Dependencies**: Fastify 5, Drizzle ORM (`pg`), módulos de `F01` (`src/db/*`, `src/modules/auth/*`, `src/views/layout.ts`)
- **Storage**: PostgreSQL 16 (tabelas `events` e leitura em `tickets` já migradas por `F01`)
- **Testing**: Vitest em `catraca_test` (`tests/f02.events.test.ts`), executado via `./scripts/gates.sh`
- **Target Platform**: Linux/macOS em Docker Compose (`http://localhost:3000`)
- **Project Type**: Módulo SSR integrado ao monólito Fastify
- **Performance Goals**: Operações CRUD SSR < 100ms
- **Constraints**: Sem JS complexo no cliente; HTML SSR limpo e semântico com mensagens de erro claras e escape XSS obrigatório
- **Scale/Scope**: Rotas `/organizer/events*` e contrato de extensibilidade para `F06` e `F07`

---

## Constitution Check

| Princípio | Verificação | Status |
| --- | --- | --- |
| I. Spec-Driven & Contract-First | Artefatos completos (`spec.md`, `plan.md`, `tasks.md`, `contract.md`) com rastreabilidade de `F02-AC1`–`F02-AC7` e `CF-01` | PASS |
| II. Strict Rule Fidelity | Implementa `R01`, `R02`, `R03`, `R04`, `R13` sem desvios | PASS |
| III. Concurrency & State Safety | Validação de lotação mínima usa contagem no banco dentro de transação na edição (com lock da linha do evento `FOR UPDATE` para consistência com compras futuras) | PASS |
| IV. Minimal, Self-Contained Harness | Testes rodam via `./scripts/gates.sh` no banco isolado `catraca_test` | PASS |
| V. Independent Evaluation | Contrato testável via HTTP (`curl`) e banco, sem contexto compartilhado | PASS |
| VI. Simplicity & SSR | Views puras em `src/views/organizer.views.ts` com slots opcionais para `F06` e `F07` | PASS |

---

## Project Structure

### Documentation (this feature)

```text
specs/002-f02-organizer-events/
├── spec.md
├── plan.md
├── tasks.md
├── contract.md
└── reports/
```

### Source Code (files added/modified by F02)

```text
src/
├── modules/
│   └── events/
│       ├── events.service.ts    # Validações R01/R02/R03, CRUD isolado por owner_id, contagem de ocupação
│       └── events.routes.ts     # Rotas SSR /organizer/events* + registro opcional de extensões F06/F07
├── views/
│   └── organizer.views.ts       # Listagem, criação e página de gestão com slots extensíveis
└── app.ts                       # Registro de eventsRoutes (e redirecionamento /organizer -> /organizer/events)
tests/
└── f02.events.test.ts           # Testes integrados cobrindo F02-AC1..AC7 e CF-01
```

**Structure Decision**: Separar regras de negócio em `events.service.ts`, HTTP/SSR em `events.routes.ts` e marcação HTML em `organizer.views.ts`. Para facilitar a evolução paralela na Wave 4 (`F06`) e Wave 5 (`F07`), `renderOrganizerEventManagePage()` aceita um objeto `sections?: { dashboardHtml?: string; checkinHtml?: string; cancelHtml?: string }` e `events.routes.ts` permite injetar/compor loaders de seções extras sem duplicar rotas ou autenticação.

---

## Detailed Design

### 1. Validação e Parsing (`src/modules/events/events.service.ts`)

- `parsePriceToCents(raw: string | number)`:
  - Aceita número ou string com ponto ou vírgula decimal (ex.: `"120.50"`, `"120,50"`, `"100"`), remove espaços e prefixo opcional `"R$"`.
  - Valida formato numérico com no máximo 2 casas decimais e converte em inteiro (`cents > 0`). Caso inválido, retorna erro de validação claro.
- `parseFutureStartsAt(raw: string, now = new Date())`:
  - Aceita ISO-8601 com offset/Z ou `YYYY-MM-DDTHH:mm` (anexando `-03:00` quando sem offset).
  - Valida data válida e `date.getTime() > now.getTime()` (`R01`).
- `parseCapacity(raw: string | number)`:
  - Valida inteiro estrito `>= 1` (`R01`).
- Erros de domínio tipados (`EventValidationError`, `EventNotFoundError`, `EventForbiddenError`, `EventStateError`) para mapeamento limpo nas rotas HTTP.

### 2. Operações do Serviço (`src/modules/events/events.service.ts`)

- `listOrganizerEvents(ownerId: string)`: retorna eventos filtrados por `WHERE owner_id = ownerId`, ordenados por `created_at DESC`, com contagem de vagas ocupadas para exibição informativa.
- `getOrganizerEventOrThrow(eventId: string, ownerId: string)`: busca o evento; se não existir lança `EventNotFoundError` (`404`), se `event.ownerId !== ownerId` lança `EventForbiddenError` (`403` — tratado sem vazar nenhum dado do evento).
- `countOccupiedSeats(eventId: string, executor = db)`: executa `SELECT COUNT(*)::int FROM tickets WHERE event_id = $1 AND status IN ('pending', 'confirmed')`.
- `createEvent(ownerId, input)`: valida `R01`, gera `id = 'evt_' + randomUUID().replace(/-/g, '').slice(0, 12)`, insere com `status = 'draft'` (`R02`).
- `updateEvent(ownerId, eventId, input)`: dentro de transação PostgreSQL, faz `SELECT ... FROM events WHERE id = $1 FOR UPDATE`, valida `owner_id` (`R13`), rejeita se `status === 'cancelled'` (`R11`), valida `R01` (incluindo data futura), calcula `occupied = countOccupiedSeats(eventId, tx)`, rejeita se `capacity < occupied` (`R03`), e atualiza `name`, `starts_at`, `location`, `capacity`, `price_cents`, `updated_at` (jamais alterando `tickets.price_cents`).
- `publishEvent(ownerId, eventId)`: valida `owner_id`, rejeita se `status === 'cancelled'`, atualiza `status = 'published'` e `updated_at = NOW()`.
- `listPublishedEvents()` e `getEventById(eventId)`: helpers de leitura limpa reutilizáveis por `F03`, `F04` e `F05`.

### 3. Rotas SSR (`src/modules/events/events.routes.ts`)

Todas as rotas executam com `preHandler: requireOrganizer`:
- `GET /organizer/events`: renderiza lista dos eventos do organizador logado.
- `GET /organizer/events/new`: renderiza formulário de criação.
- `POST /organizer/events`: cria evento em rascunho; em sucesso `302 /organizer/events/:eventId`; em erro de validação `400` re-renderizando formulário com dados preenchidos e mensagem de erro.
- `GET /organizer/events/:eventId`: verifica `owner_id`; se não for proprietário ou inexistente retorna `403`/`404` genérico sem nenhum dado do evento; em sucesso `200` renderizando página de gestão com:
  - cabeçalho (nome, status em português `rascunho`/`publicado`/`cancelado`, URL própria);
  - botão de publicação (`POST /organizer/events/:eventId/publish`) quando `status === 'draft'`;
  - formulário de edição (`POST /organizer/events/:eventId/edit`) habilitado quando `status !== 'cancelled'`;
  - slots opcionais `dashboardHtml`, `checkinHtml`, `cancelHtml` (resolvidos via registry opcional para plug-in limpo de `F06` e `F07`).
- `POST /organizer/events/:eventId/edit`: processa edição; em sucesso `302 /organizer/events/:eventId?saved=1`; em erro de validação/lotação `400` re-renderizando a página com mensagem de erro; em violação de propriedade `403`/`404`.
- `POST /organizer/events/:eventId/publish`: publica evento; em sucesso `302 /organizer/events/:eventId?published=1`; em violação de propriedade `403`/`404`; se cancelado `409`.

---

## Complexity Tracking

Nenhuma violação da Constituição. O mecanismo de slots opcionais em `organizer.views.ts` é uma simples interface de parâmetros de função TypeScript (sem framework ou abstração pesada), garantindo zero atrito para `F06` e `F07`.
