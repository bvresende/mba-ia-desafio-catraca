# Feature Specification: F06 — Check-in e Painel do Organizador

**Feature Branch**: `006-f06-checkin-dashboard`

**Created**: 2026-11-25

**Status**: Draft

**Wave**: Wave 4 (Paralela com `F04` e `F05`)

**Consumes**: `F01` (`requireOrganizer`, isolamento de sessão), `F02` (página de gestão `/organizer/events/:eventId` e ownership `owner_id`), `F03` (tabela `tickets` unificada de vitrine + API, `price_cents` congelado, `code`, `status`, `checked_in`, `getEventSeatMetrics`)

**Input**: PRD `docs/PRD.md` — Feature `F06`, regras `R03`, `R04`, `R05`, `R10`, `R12`, `R13` e critérios `F06-AC1`..`F06-AC6`, `CF-09`..`CF-11`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Painel numérico consolidado na página de gestão do evento (Priority: P1)

Como organizador proprietário do evento, quero visualizar na página de gestão do meu evento (`/organizer/events/:eventId`) um painel com os 6 indicadores numéricos obrigatórios consolidando vendas da vitrine e da API de parceiros, incluindo receita calculada pelo preço vigente no momento de cada compra confirmada.

**Why this priority**: Fornece visibilidade operacional e financeira completa (`R12`) e comprova a unificação entre canais (`storefront` e `partner_api`) e o congelamento de preço (`R03`).

**Independent Test**: Criar e publicar um evento com preço `R$ 100,00`, registrar 2 compras confirmadas (ex.: 1 vitrine + 1 API), alterar o preço para `R$ 150,00`, registrar mais 1 compra confirmada e 1 compra pendente, fazer check-in de 1 confirmado, e verificar em `GET /organizer/events/:eventId` os 6 indicadores exatos: `Confirmados: 3`, `Pendentes: 1`, `Check-ins: 1`, `Vagas disponíveis` conforme R05, `Receita: R$ 350,00` e `Estornados: 0`.

**Acceptance Scenarios**:

1. **Given** um evento possui compras confirmadas e pendentes vindas tanto da vitrine (`storefront`) quanto da API (`partner_api`), **When** o organizador proprietário acessa `GET /organizer/events/:eventId`, **Then** o painel exibe os 6 indicadores: **Confirmados** (incluindo os que já fizeram check-in), **Pendentes**, **Check-ins**, **Vagas disponíveis** (`R05`), **Receita** (em `R$`) e **Estornados**.
2. **Given** um evento vendeu 2 ingressos confirmados a `R$ 100,00`, teve seu preço alterado para `R$ 150,00` e vendeu mais 1 ingresso confirmado a `R$ 150,00`, **When** o organizador acessa o painel em `/organizer/events/:eventId`, **Then** a **Receita** exibida é exatamente `R$ 350,00` (soma de `price_cents` congelado dos ingressos `confirmed`).
3. **Given** um evento teve ingressos recusados (`declined`) ou cancelados (`cancelled`), **When** o painel é calculado, **Then** ingressos `declined` e `cancelled` não entram em Confirmados, Pendentes, Check-ins, Receita nem Estornados, e não reduzem Vagas disponíveis.

---

### User Story 2 - Operação de check-in com ordem estrita de prioridade (`R10`) (Priority: P1)

Como organizador proprietário do evento, quero informar o código do ingresso na página de gestão (`/organizer/events/:eventId`) e submeter `POST /organizer/events/:eventId/checkin`, recebendo exatamente a mensagem literal correspondente à primeira regra aplicável de `R10`, sem alterar o status `confirmed` do ingresso ao liberar a entrada.

**Why this priority**: O check-in com as 5 mensagens literais em ordem exata de precedência e independência do atributo `checkedIn` é uma regra crítica avaliada diretamente pelo contrato.

**Independent Test**: Submeter contra `POST /organizer/events/:eventId/checkin` códigos para todos os 5 casos (código inexistente, código de outro evento, evento cancelado com código válido do evento, ingresso `pending`/`declined`/`refunded`/`cancelled`, ingresso `confirmed` novo, e o mesmo ingresso novamente), conferindo a mensagem exata e a manutenção de `status = 'confirmed'` com `checked_in = true`.

**Acceptance Scenarios**:

1. **Given** o organizador informa um código inexistente ou um código válido pertencente a **outro** evento, **When** submete `POST /organizer/events/:eventId/checkin`, **Then** o sistema exibe exatamente `Ingresso inválido para este evento` (mesmo que o evento atual esteja cancelado).
2. **Given** o evento está com status `cancelled` e o organizador submete um código que pertence a este evento, **When** o check-in é avaliado, **Then** o sistema exibe exatamente `Evento cancelado` (precedência 2, antes de avaliar status `refunded`/`cancelled` do ingresso).
3. **Given** o evento não está cancelado e o código pertence a um ingresso do evento com status `pending`, `declined`, `cancelled` ou `refunded`, **When** o check-in é submetido, **Then** o sistema exibe exatamente `Ingresso não confirmado` e mantém `checked_in = false`.
4. **Given** o código pertence a um ingresso `confirmed` deste evento com `checked_in = false`, **When** o check-in é submetido pela primeira vez, **Then** o sistema marca `checked_in = true` (e `checked_in_at = NOW()`), mantém `status = 'confirmed'`, exibe exatamente `Entrada liberada`, mantém `Confirmados` inalterado e incrementa `Check-ins` em 1.
5. **Given** o mesmo código de ingresso `confirmed` já possui `checked_in = true`, **When** o check-in é submetido uma segunda vez, **Then** o sistema exibe exatamente `Ingresso já utilizado` e não incrementa `Check-ins`.

---

### User Story 3 - Isolamento estrito por organizador proprietário (`R13`) (Priority: P1)

Como plataforma multi-organizador, preciso garantir que apenas o organizador proprietário (`owner_id`) consiga visualizar o painel e executar check-in em `/organizer/events/:eventId`, bloqueando visitantes, participantes e outros organizadores (Organizador B acessando evento do Organizador A).

**Why this priority**: Violação de `R13` (vazamento de métricas ou operação por terceiros) é falha crítica de segurança e autorização.

**Independent Test**: Tentar acessar `GET /organizer/events/:eventId` e `POST /organizer/events/:eventId/checkin` como visitante, como participante e como Organizador B para um evento criado pelo Organizador A; confirmar bloqueio (`403`/`404`/redirect) sem expor métricas nem alterar `checked_in`.

**Acceptance Scenarios**:

1. **Given** um evento pertence ao Organizador A, **When** um visitante não autenticado ou um participante autenticado acessa `GET /organizer/events/:eventId` ou `POST /organizer/events/:eventId/checkin`, **Then** o middleware `requireOrganizer` de `F01` bloqueia o acesso sem expor dados do painel nem executar check-in.
2. **Given** um evento pertence ao Organizador A com um ingresso confirmado, **When** o Organizador B envia `GET /organizer/events/:eventId` ou `POST /organizer/events/:eventId/checkin` com o código válido do evento de A, **Then** o sistema bloqueia com `403`/`404` sem exibir métricas nem marcar `checked_in = true` no banco.

---

### Edge Cases

- **Normalização de entrada do código**: espaços extras nas pontas ou letras minúsculas digitadas pelo operador (`" ab12cd34 "`) devem ser normalizadas (`trim().toUpperCase()`) antes da busca pelo `code`.
- **Check-in concorrente (duplo clique simultâneo)**: duas requisições simultâneas com o mesmo código válido usam update atômico `WHERE id = $1 AND checked_in = false AND status = 'confirmed'`; exatamente uma recebe `Entrada liberada` e a outra recebe `Ingresso já utilizado`.
- **Código vazio submetido no formulário**: tratado como código inexistente → retorna `Ingresso inválido para este evento`.
- **Ordem entre prioridade 1 e prioridade 2 em evento cancelado**:
  - Código inexistente ou de **outro** evento submetido contra evento cancelado → prioridade 1 → `Ingresso inválido para este evento`.
  - Código pertencente **a este** evento cancelado → prioridade 2 → `Evento cancelado` (não `Ingresso não confirmado`).
- **Painel em evento cancelado (preparação para `F07`)**: quando `event.status === 'cancelled'`, `availableSeats` deve ser `0`, e como `Check-ins` contabiliza `status = 'confirmed' AND checked_in = true`, ao cancelar o evento (quando `confirmed` vira `refunded`), `Confirmados`, `Pendentes`, `Check-ins` e `Receita` refletem automaticamente `0` (`R$ 0,00`) e `Estornados` reflete o total de `refunded`.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** *(R04, R12)*: A página de gestão do evento (`GET /organizer/events/:eventId`) MUST renderizar o painel numérico contendo exatamente os 6 indicadores consolidados (vitrine + API):
  - **Confirmados**: contagem de ingressos do evento com `status = 'confirmed'` (incluindo os com `checked_in = true`)
  - **Pendentes**: contagem de ingressos do evento com `status = 'pending'`
  - **Check-ins**: contagem de ingressos do evento com `status = 'confirmed' AND checked_in = true`
  - **Vagas disponíveis**: `0` se `event.status === 'cancelled'`; caso contrário `Math.max(0, event.capacity - (confirmed + pending))` (`R05`)
  - **Receita**: soma de `tickets.price_cents` dos ingressos do evento com `status = 'confirmed'`, formatada em reais (`R$ 0,00`, `R$ 350,00`, etc.) (`R03`, `R12`)
  - **Estornados**: contagem de ingressos do evento com `status = 'refunded'`
- **FR-002** *(R04, R10)*: A página de gestão do evento (`/organizer/events/:eventId`) MUST incluir o formulário de check-in por código apontando para `POST /organizer/events/:eventId/checkin`.
- **FR-003** *(R10)*: `POST /organizer/events/:eventId/checkin` MUST avaliar as regras na ordem **estrita e imutável** e retornar/exibir exatamente as mensagens literais:
  1. Código não encontrado no banco ou pertencente a outro `event_id` → `Ingresso inválido para este evento`
  2. Evento com `status = 'cancelled'` → `Evento cancelado`
  3. Ingresso com `status !== 'confirmed'` (`pending`, `declined`, `cancelled`, `refunded`) → `Ingresso não confirmado`
  4. Ingresso com `checked_in === true` → `Ingresso já utilizado`
  5. Caso contrário, executar update atômico `UPDATE tickets SET checked_in = true, checked_in_at = NOW(), updated_at = NOW() WHERE id = $1 AND checked_in = false AND status = 'confirmed' RETURNING id` → `Entrada liberada` (mantendo `status = 'confirmed'`).
- **FR-004** *(R10)*: O check-in NUNCA pode alterar `tickets.status`; apenas altera `checked_in` para `true` e grava `checked_in_at`.
- **FR-005** *(R13)*: Tanto `GET /organizer/events/:eventId` quanto `POST /organizer/events/:eventId/checkin` MUST exigir autenticação de organizador (`requireOrganizer`) e validar que `event.owner_id === request.user.id`, bloqueando qualquer outro perfil ou organizador sem expor métricas ou alterar ingressos.
- **FR-006** *(R12)*: Os cálculos do painel MUST unificar todos os registros da tabela `tickets` do evento sem filtrar por `channel` (`storefront` e `partner_api` somados).

### Key Entities

- **EventDashboardMetrics**: `{ confirmed: number, pending: number, checkedIn: number, availableSeats: number, revenueCents: number, refunded: number }`
- **CheckinResult**: `{ ok: boolean, message: 'Ingresso inválido para este evento' | 'Evento cancelado' | 'Ingresso não confirmado' | 'Ingresso já utilizado' | 'Entrada liberada', ticketId?: string }`

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Todos os 5 ramos de `R10` produzem as mensagens literais exatas na ordem de prioridade correta, inclusive nos casos de fronteira (código de outro evento vs evento cancelado; ingresso já utilizado; duplo clique simultâneo).
- **SC-002**: Após check-in de ingresso confirmado, `status` permanece `confirmed` (verificável no banco e na API), `checked_in` torna-se `true`, `Confirmados` mantém-se igual e `Check-ins` incrementa em `+1`.
- **SC-003**: O painel soma com 100% de precisão vendas mistas (vitrine + API) e preserva a receita histórica após alteração de preço (`2 × R$ 100,00 + 1 × R$ 150,00 = R$ 350,00`).
- **SC-004**: Visitante, participante e Organizador B recebem bloqueio total (`403`/`404`/redirect) no painel e no endpoint de check-in de evento do Organizador A, sem vazamento de dados nem mutação de estado.

## Assumptions

- A rota e view base de `/organizer/events/:eventId` já foram estruturadas em `F02` com um espaço/gancho claro para inclusão do painel numérico e do formulário de check-in.
- A verificação de `owner_id` e o middleware `requireOrganizer` de `F01`/`F02` são reutilizados diretamente.
- O formato brasileiro de moeda usa prefixo `R$ `, separador de milhar `.` quando aplicável e decimal `,` com 2 casas (ex.: `R$ 0,00`, `R$ 350,00`).
