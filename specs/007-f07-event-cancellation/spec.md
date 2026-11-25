# Feature Specification: F07 — Cancelamento Irreversível de Eventos e Estorno/Cancelamento

**Feature Branch**: `007-f07-event-cancellation`

**Created**: 2026-11-25

**Status**: Draft

**Wave**: Wave 5 (Sequencial, após merge de `F04`, `F05` e `F06`)

**Consumes**: `F02` (página de gestão, bloqueio de edição/republicação, ownership `R13`), `F03` (transição de ingressos e guard do gateway tardio), `F04` (vitrine pública e "Meus ingressos"), `F05` (API de parceiros), `F06` (check-in e painel do organizador)

**Input**: PRD `docs/PRD.md` — Feature `F07`, regras `R02`, `R05`, `R10`, `R11`, `R12`, `R13` e critérios `F07-AC1`..`F07-AC5`, `CF-12`..`CF-16`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Cancelamento irreversível de evento publicado pelo organizador proprietário (Priority: P1)

Como organizador proprietário de um evento publicado, quero acionar o cancelamento definitivo do evento em sua página de gestão (`/organizer/events/:eventId`), tornando o evento irreversivelmente `cancelled`, impedindo qualquer edição ou republicação posterior e transicionando imediatamente todos os ingressos `confirmed` para `refunded` e `pending` para `cancelled`.

**Why this priority**: É a operação central de `R11` e precisa ser atômica, rápida (< 10 segundos) e protegida por `R13` (somente o proprietário).

**Independent Test**: Publicar um evento pelo Organizador A com ingressos `confirmed` (vitrine + API, incluindo ingresso com check-in já feito) e `pending`, acionar `POST /organizer/events/:eventId/cancel`, confirmar que o evento vira `cancelled`, todos os `confirmed` viram `refunded` e todos os `pending` viram `cancelled` em < 10s, e que edição/republicação são bloqueadas.

**Acceptance Scenarios**:

1. **Given** o Organizador A possui um evento `published`, **When** envia `POST /organizer/events/:eventId/cancel`, **Then** dentro de uma única transação PostgreSQL com lock `SELECT ... FOR UPDATE`, o evento passa a `status = 'cancelled'`, todos os ingressos `confirmed` do evento passam a `refunded` e todos os ingressos `pending` passam a `cancelled` em menos de 10 segundos.
2. **Given** um evento está `cancelled`, **When** o Organizador A acessa `/organizer/events/:eventId` ou tenta enviar requisições diretas de edição (`POST /organizer/events/:eventId/edit`) ou publicação (`POST /organizer/events/:eventId/publish`), **Then** a interface exibe o evento como cancelado com edição/republicação desabilitadas e o servidor rejeita qualquer tentativa de edição ou republicação.
3. **Given** um evento pertence ao Organizador A, **When** visitante, participante ou Organizador B tenta enviar `POST /organizer/events/:eventId/cancel`, **Then** a requisição é bloqueada (`403`/`404`/redirect) e o evento permanece inalterado (`published`).
4. **Given** um evento ainda está em rascunho (`draft`) ou já está `cancelled`, **When** o organizador envia `POST /organizer/events/:eventId/cancel`, **Then** o sistema não altera estado nem quebra, rejeitando cancelamento de rascunho e preservando o estado `cancelled`.

---

### User Story 2 - Proteção contra respostas tardias do gateway de pagamento (`0003` e `0004`) (Priority: P1)

Como plataforma financeira consistente, preciso garantir que, quando um evento é cancelado enquanto existem ingressos `pending` aguardando o gateway lento (cartões final `0003` ou `0004`, 30–40 segundos), esses ingressos passem imediatamente para `cancelled` (em <= 10s) e **permaneçam `cancelled`** mesmo depois de a resposta tardia do gateway chegar (após 45 segundos).

**Why this priority**: Corridas com callbacks assíncronos tardios são o erro mais clássico em cancelamento; `R11` exige explicitamente que o status `cancelled` nunca seja sobrescrito por `confirmed` ou `declined`.

**Independent Test**: Comprar 2 ingressos em evento publicado usando cartões `0003` (aprovação lenta) e `0004` (recusa lenta), cancelar o evento imediatamente, verificar em <= 10s que ambos estão `cancelled`, aguardar além de 45s (ou após o término dos timers do gateway em teste) e confirmar que ambos permanecem `cancelled` no banco, em `/my-tickets` e em `GET /api/partner/tickets/:ticketId`.

**Acceptance Scenarios**:

1. **Given** um ingresso foi comprado com cartão `0003` (aprovação em 30–40s) e está `pending`, **When** o organizador cancela o evento antes da resposta do gateway, **Then** o ingresso muda para `cancelled` em <= 10s e, passados 45s (após o callback tardio tentar aprovar), seu status **permanece `cancelled`** (nunca vira `confirmed`).
2. **Given** um ingresso foi comprado com cartão `0004` (recusa em 30–40s) e está `pending`, **When** o organizador cancela o evento antes da resposta do gateway, **Then** o ingresso muda para `cancelled` em <= 10s e, após a resposta tardia do gateway, **permanece `cancelled`** (nunca vira `declined`).

---

### User Story 3 - Propagação completa do cancelamento para Vitrine (`F04`), API de Parceiros (`F05`), Check-in e Painel (`F06`) (Priority: P1)

Como usuário de qualquer canal do Catraca (participante, parceiro externo ou organizador), quero que o cancelamento de um evento reflita imediatamente e de forma consistente em todas as superfícies do sistema.

**Why this priority**: Integra e valida ponta a ponta todas as 5 arestas que convergem em `F07` (`CF-12` a `CF-16`).

**Independent Test**: Em um evento com ingressos comprados pela vitrine e pela API (incluindo confirmados com check-in, confirmados sem check-in, pendentes e recusados), cancelar o evento e verificar: vitrine `GET /`, `/my-tickets`, `GET /api/partner/events`, `POST /api/partner/events/:id/purchases`, `GET /api/partner/tickets/:id`, check-in e painel em `/organizer/events/:id`.

**Acceptance Scenarios**:

1. **Given** um evento foi cancelado via `F07`, **When** qualquer usuário consulta a vitrine `GET /` ou um participante acessa `/my-tickets`, **Then** o evento não aparece mais na vitrine (`GET /`), e em `/my-tickets` os ingressos previamente confirmados aparecem como `estornado` e os previamente pendentes como `cancelado`.
2. **Given** um evento foi cancelado via `F07`, **When** o parceiro consulta `GET /api/partner/events`, tenta comprar via `POST /api/partner/events/:eventId/purchases` e consulta `GET /api/partner/tickets/:ticketId`, **Then** o evento desaparece da listagem, a tentativa de compra retorna `404 {"error":"event_not_available"}` e os ingressos retornam `status: "refunded"` ou `status: "cancelled"`.
3. **Given** um evento foi cancelado via `F07`, **When** o organizador acessa `/organizer/events/:eventId` ou submete um código válido deste evento em `POST /organizer/events/:eventId/checkin`, **Then** o check-in exibe exatamente `Evento cancelado` e o painel exibe `Confirmados: 0`, `Pendentes: 0`, `Check-ins: 0`, `Vagas disponíveis: 0`, `Receita: R$ 0,00` e `Estornados` igual ao total de ingressos anteriormente confirmados (vitrine + API, incluindo os que haviam feito check-in).

---

### Edge Cases

- **Corrida entre compra simultânea e cancelamento**: como tanto `purchaseTicket()` (`F03`) quanto `cancelEvent()` (`F07`) adquirem `SELECT ... FROM events WHERE id = $1 FOR UPDATE`, as duas transações serializam no PostgreSQL:
  - Se a compra commitar antes do cancelamento, o novo ingresso `pending` será imediatamente incluído no `UPDATE ... SET status = 'cancelled'` do cancelamento.
  - Se o cancelamento commitar antes da compra, `purchaseTicket()` enxergará `events.status === 'cancelled'` e rejeitará a compra (`event_not_available` / `404`).
- **Ingresso já `declined` antes do cancelamento**: ingressos previamente recusados pelo gateway permanecem `declined` (`recusado`) — não viram `cancelled` nem `refunded` e não entram em `Estornados`.
- **Ingresso `confirmed` com `checked_in = true` antes do cancelamento**: passa para `status = 'refunded'` (estornado); no painel, como `Check-ins` conta `status = 'confirmed' AND checked_in = true`, `Check-ins` passa a `0` e o ingresso é contabilizado em `Estornados` (atendendo integralmente `F07-AC5`).
- **Código inexistente ou de outro evento enviado no check-in de evento cancelado**: continua respeitando a prioridade 1 de `R10` (`Ingresso inválido para este evento`); código pertencente ao evento cancelado exibe prioridade 2 (`Evento cancelado`), e a própria seção de check-in da UI do evento cancelado exibe `Evento cancelado`.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** *(R11, R13)*: `POST /organizer/events/:eventId/cancel` MUST exigir autenticação de organizador (`requireOrganizer`) e verificar que `event.owner_id === request.user.id`, bloqueando visitantes, participantes e outros organizadores sem alterar estado.
- **FR-002** *(R11)*: O cancelamento MUST aceitar apenas eventos com `status = 'published'` e executar atomicamente dentro de uma única transação PostgreSQL:
  1. `SELECT * FROM events WHERE id = $1 FOR UPDATE`
  2. `UPDATE events SET status = 'cancelled', updated_at = NOW() WHERE id = $1`
  3. `UPDATE tickets SET status = 'refunded', updated_at = NOW() WHERE event_id = $1 AND status = 'confirmed'`
  4. `UPDATE tickets SET status = 'cancelled', updated_at = NOW() WHERE event_id = $1 AND status = 'pending'`
  5. Commit imediato (tempo total << 10 segundos).
- **FR-003** *(R11)*: O cancelamento MUST ser estritamente irreversível: tanto a UI em `/organizer/events/:eventId` quanto os handlers de edição e publicação de `F02` MUST bloquear edição e republicação de eventos com `status = 'cancelled'`.
- **FR-004** *(R11)*: A guarda atômica de callback do gateway em `F03` (`WHERE id = $1 AND status = 'pending'` verificando ainda que o evento não está `cancelled`) MUST garantir que respostas tardias de cartões `0003` e `0004` (30–40s) jamais alterem ingressos já marcados como `cancelled`.
- **FR-005** *(R02, R11)*: Após o cancelamento, o evento MUST desaparecer de `GET /` (`F04`) e `GET /api/partner/events` (`F05`), novas compras na vitrine e em `POST /api/partner/events/:eventId/purchases` MUST ser recusadas (na API com `404 {"error":"event_not_available"}`), e os ingressos MUST refletir `estornado`/`cancelado` em `GET /my-tickets` e `refunded`/`cancelled` em `GET /api/partner/tickets/:ticketId`.
- **FR-006** *(R05, R10, R11, R12)*: Na página de gestão `/organizer/events/:eventId` de um evento cancelado, a seção de check-in MUST exibir `Evento cancelado` (e qualquer `POST /organizer/events/:eventId/checkin` com código válido do evento retorna `Evento cancelado`), a edição MUST estar desabilitada/bloqueada, e o painel MUST exibir `Confirmados: 0`, `Pendentes: 0`, `Check-ins: 0`, `Vagas disponíveis: 0`, `Receita: R$ 0,00` e `Estornados` igual ao total de ingressos anteriormente confirmados (vitrine + API, incluindo os com check-in prévio).

### Key Entities

- **CancellationResult**: `{ eventId: string, refundedCount: number, cancelledPendingCount: number }`
- **Event Status Transition**: `published` → `cancelled` (estado terminal irreversível).
- **Ticket Bulk Transition**: `confirmed` → `refunded`; `pending` → `cancelled`; `declined` permanece `declined`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `POST /organizer/events/:eventId/cancel` conclui a transição do evento e de todos os seus ingressos `confirmed` e `pending` em menos de 1 segundo (muito abaixo do teto de 10 segundos exigido em `R11`).
- **SC-002**: 100% dos ingressos `pending` criados com cartões lentos (`0003` e `0004`) tornam-se `cancelled` em <= 10s após cancelamento e permanecem `cancelled` após > 45s (depois da resposta tardia do gateway).
- **SC-003**: 100% das tentativas de editar ou republicar um evento cancelado são bloqueadas, tanto na interface quanto em requisições POST diretas.
- **SC-004**: Vitrine (`F04`), "Meus ingressos" (`F04`), API de Parceiros (`F05`), Check-in (`F06`) e Painel (`F06`) refletem o estado cancelado com exatidão literal (`estornado`, `cancelado`, `refunded`, `cancelled`, `404 {"error":"event_not_available"}`, `Evento cancelado`, `Vagas disponíveis: 0`, `Confirmados: 0`, `Pendentes: 0`, `Check-ins: 0`, `Receita: R$ 0,00` e `Estornados` exato).

## Assumptions

- Todas as features `F01`–`F06` já foram implementadas, avaliadas e mescladas em `main` antes do início da Wave 5.
- O gateway simulado de `F03` já implementa a guarda condicional `WHERE id = $1 AND status = 'pending'` (verificada e reforçada, se necessário, nos testes de `F07`).
- O botão de cancelar evento aparece na página de gestão `/organizer/events/:eventId` exclusivamente para eventos com `status = 'published'`.
