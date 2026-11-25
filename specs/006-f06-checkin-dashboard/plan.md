# Implementation Plan: F06 — Check-in e Painel do Organizador

**Branch**: `006-f06-checkin-dashboard` | **Date**: 2026-11-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/006-f06-checkin-dashboard/spec.md`

## Summary

Implementar o serviço de métricas do painel (`src/modules/checkin/dashboard.service.ts`), o serviço transacional/atômico de check-in com precedência estrita `R10` (`src/modules/checkin/checkin.service.ts`) e a rota `POST /organizer/events/:eventId/checkin` (`src/modules/checkin/checkin.routes.ts`), integrando o painel de 6 indicadores e o formulário de check-in diretamente na página de gestão do evento (`/organizer/events/:eventId`) criada em `F02`.

## Technical Context

**Language/Version**: TypeScript (strict) sobre Node.js 24 LTS

**Primary Dependencies**: Fastify 5, Drizzle ORM (`pg`), SSR HTML/CSS templates

**Storage**: PostgreSQL 16 (tabelas `events` e `tickets` em `src/db/schema.ts`)

**Testing**: Vitest (`tests/f06.checkin-dashboard.test.ts` contra banco isolado `catraca_test`)

**Target Platform**: Linux (container Docker `app` + `db` servindo em `http://localhost:3000`)

**Project Type**: web-service (monólito modular Fastify 5 com SSR HTML)

**Performance Goals**: Agregação do painel em uma única consulta SQL agregada (< 50ms); operação de check-in atômica (< 50ms).

**Constraints**: Zero novas migrations; preservação estrita das 5 mensagens literais de `R10` em ordem exata; update atômico impedindo duplo check-in; isolamento estrito por `owner_id` (`R13`); conflito mínimo no merge paralelo da Wave 4 com `F04` e `F05`.

**Scale/Scope**: 1 módulo novo (`src/modules/checkin/` com 3 arquivos), integração pontual na página `/organizer/events/:eventId` e 1 suíte dedicada (`tests/f06.checkin-dashboard.test.ts`).

## Constitution Check

- **Princípio I (Spec-Driven & Contract-First)**: `spec.md`, `plan.md`, `tasks.md` e `contract.md` cobrindo 100% de `F06-AC1`..`F06-AC6` e `CF-09`..`CF-11`. **PASS**.
- **Princípio II (Strict Rule Fidelity)**: Ordem de prioridade `R10`, independência de `checkedIn`, os 6 indicadores de `R12` e congelamento de preço `R03` atendidos literalmente. **PASS**.
- **Princípio III (Concurrency & State Safety)**: Update condicional atômico `WHERE id = $1 AND checked_in = false AND status = 'confirmed'` previne race condition em duplo check-in simultâneo. **PASS**.
- **Princípio IV (Minimal Harness)**: Testes executados em `./scripts/gates.sh` contra `catraca_test`. **PASS**.
- **Princípio V (Independent Evaluation)**: Será avaliado em contexto limpo contra `contract.md`. **PASS**.
- **Princípio VI (Simplicity & SSR)**: HTML puro renderizado no servidor com formulário `<form method="POST">` simples. **PASS**.

## Project Structure

### Documentation (this feature)

```text
specs/006-f06-checkin-dashboard/
├── spec.md              # Especificação funcional de check-in e painel
├── plan.md              # Este plano de implementação
├── tasks.md             # Checklist executável de tarefas
├── contract.md          # Contrato verificável com rastreabilidade PRD
└── reports/             # Relatórios imutáveis de avaliação independente (eval-NNN.md)
```

### Source Code (repository root)

```text
src/
├── app.ts                                   # Registra checkinRoutes
├── modules/
│   ├── auth/                                # Reutilizado (requireOrganizer)
│   ├── events/                              # Reutilizado (busca/ownership de evento, GET /organizer/events/:eventId)
│   ├── purchase/                            # Reutilizado (getEventSeatMetrics / R05)
│   └── checkin/
│       ├── dashboard.service.ts             # getEventDashboardMetrics(eventId) — 6 indicadores R12
│       ├── checkin.service.ts               # performCheckin(eventId, organizerId, code) — ordem estrita R10
│       └── checkin.routes.ts                # POST /organizer/events/:eventId/checkin
└── views/
    └── organizer.views.ts                   # Renderização da seção Painel (6 indicadores) + Formulário de Check-in na página /organizer/events/:eventId

tests/
└── f06.checkin-dashboard.test.ts            # Testes unitários/integração de F06-AC1..AC6 e CF-09..CF-11
```

**Structure Decision**: Todo o domínio novo vive em `src/modules/checkin/` (sem tocar em `storefront` nem `partner`), facilitando o merge paralelo da Wave 4. A integração com a página `/organizer/events/:eventId` injeta os dados de `getEventDashboardMetrics()` e o resultado do check-in na renderização da view do organizador.

## Design Details

### 1. Serviço de Painel (`src/modules/checkin/dashboard.service.ts`)
- Função `getEventDashboardMetrics(eventId: string)`:
  - Consulta o evento (`capacity`, `status`) e executa agregação SQL única em `tickets WHERE event_id = $1` (sem filtrar `channel`, unificando `storefront` + `partner_api`):
    - `confirmed`: `COUNT(*) FILTER (WHERE status = 'confirmed')`
    - `pending`: `COUNT(*) FILTER (WHERE status = 'pending')`
    - `checkedIn`: `COUNT(*) FILTER (WHERE status = 'confirmed' AND checked_in = true)`
    - `revenueCents`: `COALESCE(SUM(price_cents) FILTER (WHERE status = 'confirmed'), 0)`
    - `refunded`: `COUNT(*) FILTER (WHERE status = 'refunded')`
  - Calcula `availableSeats`:
    - Se `event.status === 'cancelled'` → `0`
    - Caso contrário → `Math.max(0, event.capacity - (confirmed + pending))` (consistente com `getEventSeatMetrics` / `R05`).
- Formatação de receita na UI: `formatCurrencyBrl(revenueCents)` garantindo saída exata como `R$ 0,00`, `R$ 350,00` (usando espaço normal `\u0020` entre `R$` e o valor, evitando `\u00a0` de `Intl.NumberFormat` que pode confundir asserções literais em testes!).

### 2. Serviço de Check-in (`src/modules/checkin/checkin.service.ts`)
- Constantes literais exportadas:
  - `CHECKIN_MESSAGES = { INVALID_TICKET: 'Ingresso inválido para este evento', EVENT_CANCELLED: 'Evento cancelado', NOT_CONFIRMED: 'Ingresso não confirmado', ALREADY_USED: 'Ingresso já utilizado', ALLOWED: 'Entrada liberada' }`
- Função `performCheckin(eventId: string, organizerId: string, rawCode: string)`:
  1. Validar UUID de `eventId` e carregar evento; verificar `event.ownerId === organizerId` (se não encontrado ou outro dono → lança `EventAccessDeniedError` / `NotFoundError` → HTTP `403`/`404`, `R13`).
  2. Normalizar código: `const code = (rawCode ?? '').trim().toUpperCase()`.
  3. **Prioridade 1 (`R10.1`)**: Se `!code`, retornar `{ ok: false, message: 'Ingresso inválido para este evento' }`. Buscar ingresso por `code` (`SELECT * FROM tickets WHERE code = $1`). Se não existir OU `ticket.eventId !== event.id`, retornar `{ ok: false, message: 'Ingresso inválido para este evento' }`.
  4. **Prioridade 2 (`R10.2`)**: Se `event.status === 'cancelled'`, retornar `{ ok: false, message: 'Evento cancelado' }`.
  5. **Prioridade 3 (`R10.3`)**: Se `ticket.status !== 'confirmed'`, retornar `{ ok: false, message: 'Ingresso não confirmado' }`.
  6. **Prioridade 4 (`R10.4`)**: Se `ticket.checkedIn === true`, retornar `{ ok: false, message: 'Ingresso já utilizado' }`.
  7. **Prioridade 5 (`R10.5`)**: Executar update atômico:
     ```sql
     UPDATE tickets
     SET checked_in = true, checked_in_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND checked_in = false AND status = 'confirmed'
     RETURNING id
     ```
     - Se 1 linha atualizada → retornar `{ ok: true, message: 'Entrada liberada', ticketId: ticket.id }`.
     - Se 0 linhas (condição de corrida no exato instante): recarregar ticket + evento e retornar a mensagem aplicável (`Evento cancelado`, `Ingresso não confirmado` ou `Ingresso já utilizado`).

### 3. Rota e View (`src/modules/checkin/checkin.routes.ts` + `src/views/organizer.views.ts`)
- **`GET /organizer/events/:eventId`** (atualizado a partir de `F02`):
  - Carrega `metrics = await getEventDashboardMetrics(event.id)` e renderiza:
    - Painel com os 6 indicadores claramente rotulados: `Confirmados`, `Pendentes`, `Check-ins`, `Vagas disponíveis`, `Receita`, `Estornados`.
    - Seção de Check-in: quando `event.status === 'cancelled'`, exibe aviso `Evento cancelado` (e pode manter ou omitir o form conforme `F07`, sendo que `POST /checkin` também retorna `Evento cancelado` para códigos válidos do evento); quando ativo, exibe `<form method="POST" action="/organizer/events/${event.id}/checkin">` com `<input name="code" required />` e botão `Validar check-in`.
- **`POST /organizer/events/:eventId/checkin`**:
  - Protegida por `requireOrganizer`.
  - Chama `performCheckin(eventId, request.user.id, body.code)`.
  - Se erro de ownership/acesso → `403`/`404` sem expor dados do evento.
  - Caso contrário, recarrega `metrics` atualizadas e renderiza a página `/organizer/events/:eventId` com banner destacado exibindo exatamente `result.message` (e status HTTP `200`).

### 4. Estratégia de Testes (`tests/f06.checkin-dashboard.test.ts`)
- Cobrir:
  1. Presença do painel (6 indicadores) e formulário de check-in em `GET /organizer/events/:eventId` (`F06-AC1`, `CF-10`).
  2. Todos os 5 casos de `R10` na ordem estrita (incluindo código de outro evento, evento cancelado com código válido vs código de outro evento, `pending`, `declined`, `cancelled`, `refunded`, `confirmed` primeira vez → `Entrada liberada`, segunda vez → `Ingresso já utilizado`, e duplo check-in paralelo) (`F06-AC2`, `CF-11`).
  3. Independência de `checkedIn`: `status` permanece `'confirmed'` no banco após check-in; `Confirmados` não diminui e `Check-ins` aumenta (`F06-AC3`).
  4. Consolidação vitrine (`storefront`) + API (`partner_api`) nos 6 indicadores (`F06-AC4`, `CF-11`).
  5. Cálculo de receita com alteração de preço no meio das vendas: `2 × R$ 100,00 + 1 × R$ 150,00 = R$ 350,00` (`F06-AC5`, `CF-11`).
  6. Isolamento `R13`: visitante, participante (`CF-09`) e Organizador B (`F06-AC6`, `CF-10`) bloqueados tanto no `GET` do painel quanto no `POST /checkin`.

## Complexity Tracking

Nenhuma violação à Constituição identificada. A formatação manual de BRL com espaço regular (`R$ 350,00`) evita diferenças de caractere NBSP (`\u00a0`) entre ambientes Node/ICU.
