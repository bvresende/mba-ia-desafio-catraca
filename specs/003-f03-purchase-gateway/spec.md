# Feature Specification: F03 — Motor de Compras, Concorrência e Gateway Simulado

**Feature Branch**: `feat/f03-purchase-gateway`  
**Created**: 2026-11-25  
**Status**: Approved for Implementation  
**PRD Reference**: `docs/PRD.md` (`F03`, `F03-AC1`–`F03-AC5`, `CF-02`, `CF-03`, `R02`, `R03`, `R05`, `R06`, `R07`, `R08`, `R09`, `R11`)  
**Wave**: Wave 3 (Sequencial — depende de `F01` e `F02`)

---

## Contexto e Escopo

A feature `F03` implementa o núcleo transacional de vendas de ingressos do **Catraca** — compartilhado futuramente pela vitrine web (`F04`) e pela API de parceiros (`F05`) — juntamente com o gateway de pagamento simulado assíncrono e o cálculo canônico de métricas de vagas (`R05`).

- **Consumes**:
  - `F01`: conexão PostgreSQL/Drizzle (`src/db/client.ts`), tabelas `users` e `tickets` (`src/db/schema.ts`), variáveis de ambiente (`src/config/env.ts`).
  - `F02`: tabela/entidade `events` (status `published`/`draft`/`cancelled`, `capacity`, `price_cents`) e validação de redução de lotação na edição de eventos (`R03`).
- **Provides**:
  - `src/modules/purchases/purchase.service.ts`: `purchaseTicket()`, `getEventSeatMetrics()`, `getOccupiedSeatCount()`, erros de domínio (`InvalidPurchaseRequestError`, `EventNotAvailableError`, `SoldOutError`), gerador de código único alfanumérico de 8 caracteres.
  - `src/modules/purchases/gateway.service.ts`: gateway simulado assíncrono (`0001`–`0004` + fallback), atrasos oficiais configuráveis por ambiente e callback atômico blindado contra sobrescrita de eventos cancelados (`R11`).
  - Integração da contagem canônica de vagas ocupadas no `updateEvent` de `F02` (`src/modules/events/events.service.ts`).

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Compra Transacional Imediata em Status `pending` e Métricas de Vagas (R05, R06, R09, CF-02, CF-03) (Priority: P1)

Como canal de venda (vitrine `F04` ou API `F05`), quero chamar `purchaseTicket()` para reservar imediatamente 1 ingresso em status `pending` sem aguardar o gateway, congelando o preço vigente do evento (`R03`), gerando um código único de 8 caracteres (`R09`) e contabilizando a vaga ocupada no cálculo de `getEventSeatMetrics()` (`R05`).

**Why this priority**: É a espinha dorsal financeira e de estoque de todo o sistema; tanto a vitrine quanto a API de parceiros dependem integralmente dessa operação.

**Independent Test**: Chamar `purchaseTicket()` contra um evento em `draft` (rejeitado com `event_not_available`), publicar o evento via `F02`, chamar `purchaseTicket()` com `userId` de participante de `F01` e cartão válido, confirmar resposta imediata em `pending`, persistência em `tickets` com `price_cents` congelado e `code` único de 8 caracteres, e confirmar que `getEventSeatMetrics()` decrementa `available`.

**Acceptance Scenarios**:

1. **Given** um evento em rascunho (`draft`) ou cancelado (`cancelled`) ou inexistente, **When** `purchaseTicket()` é chamado com cartão válido, **Then** falha com erro de domínio `event_not_available` sem criar ingresso (`CF-03`, `R02`).
2. **Given** um evento publicado com `capacity = 5` e `price_cents = 10000`, **When** `purchaseTicket({ eventId, buyerEmail, cardNumber: '4111111111110001', userId, channel: 'storefront' })` é chamado, **Then** retorna imediatamente (sem esperar os 2–5s do gateway) um ingresso com `status = 'pending'`, `priceCents = 10000`, `code` de 8 caracteres alfanuméricos maiúsculos e `user_id` vinculado no PostgreSQL (`F03-AC1`, `F03-AC5`, `CF-02`).
3. **Given** esse ingresso em `pending`, **When** `getEventSeatMetrics(eventId)` é consultado, **Then** retorna `{ capacity: 5, occupied: 1, available: 4 }` (`R05`).
4. **Given** um ingresso já criado com `price_cents = 10000`, **When** o organizador altera o preço do evento em `F02` para `15000` e ocorre nova compra, **Then** o primeiro ingresso mantém `price_cents = 10000` e o segundo grava `price_cents = 15000` (`F03-AC4`, `R03`).
5. **Given** 3 ingressos ocupando vaga (`pending` ou `confirmed`), **When** o organizador tenta editar a lotação do evento em `F02` para `2`, **Then** a edição é bloqueada pela regra `R03` integrada a `F03` (`CF-03`).

---

### User Story 2 - Proteção Estrita Contra Overselling sob Concorrência (R07) (Priority: P1)

Como plataforma de venda de ingressos sob alta demanda, quero que o motor de compras utilize lock pessimista no PostgreSQL (`SELECT ... FROM events WHERE id = $1 FOR UPDATE`) para que jamais sejam emitidos mais ingressos do que a lotação do evento, mesmo sob 30 compras simultâneas.

**Why this priority**: A regra `R07` é um dos requisitos mais rigorosos do brief e será testada com cargas paralelas repetidas na API de parceiros (`F05`).

**Independent Test**: Criar evento publicado com lotação `5`, disparar `Promise.all` com `30` chamadas simultâneas a `purchaseTicket()` (repetindo em múltiplas rodadas), verificar exatamente `5` sucessos (`pending`) e `25` erros `sold_out`, e confirmar `COUNT(*) = 5` na tabela `tickets`.

**Acceptance Scenarios**:

1. **Given** um evento publicado com `capacity = 5` já contendo `5` ingressos em `pending` (ou combinação de `pending` + `confirmed` somando `5`), **When** nova chamada `purchaseTicket()` é feita, **Then** falha com `SoldOutError` (`sold_out`) e nenhum 6º ingresso é inserido (`F03-AC2`, `R07`).
2. **Given** um evento publicado novo com `capacity = 5`, **When** `30` chamadas simultâneas a `purchaseTicket()` são disparadas em paralelo, **Then** exatamente `5` retornam ingresso `pending` e exatamente `25` falham com `sold_out`, com `occupied = 5` e `available = 0` no banco (`F03-AC2`, `R07`).

---

### User Story 3 - Gateway de Pagamento Simulado Assíncrono e Guarda Contra Cancelamento (R08, R11) (Priority: P1)

Como sistema de pagamentos simulado, quero validar cartões de 16 dígitos antes da transação, processar cada final de cartão (`0001`–`0004` + fallback) de forma assíncrona nos intervalos corretos, liberar a vaga em caso de recusa (`declined`) e garantir atomicamente que callbacks tardios nunca alterem ingressos de eventos cancelados.

**Why this priority**: Implementa integralmente `R08` e constrói a defesa estrutural indispensável para `R11` (`F07`).

**Independent Test**: Testar cartão inválido (rejeitado antes de criar ingresso), testar todos os 5 finais de cartão (`0001`, `0002`, `0003`, `0004`, `9999`) verificando status final, faixas de atraso configuradas e liberação de vaga em `declined`, e simular um evento marcado como `cancelled` / ingresso `cancelled` antes da chegada do callback tardio de `0003` comprovando que o ingresso permanece `cancelled`.

**Acceptance Scenarios**:

1. **Given** um número de cartão com menos ou mais de 16 dígitos, letras ou vazio (ou `buyerEmail` inválido), **When** `purchaseTicket()` é chamado, **Then** falha imediatamente antes de abrir transação no banco com `InvalidPurchaseRequestError` (`invalid_request`) e nenhum ingresso é criado (`F03-AC3`, `R08`).
2. **Given** cartão de 16 dígitos válido, **When** `purchaseTicket()` conclui o commit do ingresso `pending`, **Then** o gateway simulado agenda o processamento assíncrono conforme o final:
   - final `0001`: atualiza para `confirmed` após atraso em `[GATEWAY_FAST_MIN_MS, GATEWAY_FAST_MAX_MS]` (padrão 2000–5000ms);
   - final `0002`: atualiza para `declined` após atraso em `[GATEWAY_FAST_MIN_MS, GATEWAY_FAST_MAX_MS]` (padrão 2000–5000ms), liberando a vaga imediatamente em `getEventSeatMetrics()`;
   - final `0003`: atualiza para `confirmed` após atraso em `[GATEWAY_SLOW_MIN_MS, GATEWAY_SLOW_MAX_MS]` (padrão 30000–40000ms);
   - final `0004`: atualiza para `declined` após atraso em `[GATEWAY_SLOW_MIN_MS, GATEWAY_SLOW_MAX_MS]` (padrão 30000–40000ms);
   - qualquer outro final de 16 dígitos (ex.: `9999`): atualiza para `declined` após atraso em `[GATEWAY_FAST_MIN_MS, GATEWAY_FAST_MAX_MS]` (padrão 2000–5000ms) (`F03-AC3`, `R08`).
3. **Given** um ingresso `pending` aguardando callback lento (`0003`), **When** o ingresso passa para `cancelled` e o evento para `cancelled` antes do callback disparar, **Then** quando o callback tardio executa o `UPDATE` com guarda condicional, `0` linhas são afetadas e o ingresso **permanece `cancelled`** (`R11`).

---

### Edge Cases

- **Evento cancelado em `getEventSeatMetrics(eventId)`**: Conforme `R05`, quando `event.status === 'cancelled'`, `getEventSeatMetrics()` DEVE retornar `available: 0`, independentemente de `capacity - occupied`.
- **Colisão de código único (`tickets.code`)**: A geração de código de 8 caracteres maiúsculos `[A-Z0-9]` (usando `crypto.randomBytes`) realiza retry controlado em caso improvável de violação de `UNIQUE` (`23505` no PostgreSQL) para a coluna `code`.
- **Vaga liberada após recusa (`0002` / `0004` / fallback)**: Em um evento de lotação `1`, após compra com `0002` ir para `declined`, `occupied` volta a `0`, `available` volta a `1` e uma nova compra é aceita normalmente (`R08`).
- **Limpeza de timers no shutdown e em testes**: O `gateway.service.ts` mantém registro de timers ativos (`Set<NodeJS.Timeout>`) com funções `clearPendingGatewayTimers()` e `waitForPendingGatewayCallbacks()` para evitar handles abertos no encerramento do servidor ou contaminação entre testes Vitest.
- **Formato de entrada de cartão**: `cardNumber` deve ser exatamente 16 dígitos numéricos (`/^\d{16}$/`), sem aceitar espaços extras, letras ou dígitos a menos/mais.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `purchaseTicket(input)` DEVE aceitar `{ eventId, buyerEmail, cardNumber, userId?, channel }` (com `channel: 'storefront' | 'partner_api'`) e validar `buyerEmail` (formato válido) e `cardNumber` (`/^\d{16}$/`) **antes** de abrir transação no PostgreSQL, lançando `InvalidPurchaseRequestError` se inválido (`R08`).
- **FR-002**: Dentro de uma transação PostgreSQL, `purchaseTicket()` DEVE executar `SELECT * FROM events WHERE id = $1 FOR UPDATE`, verificar que o evento existe e tem `status === 'published'` (lançando `EventNotAvailableError` caso contrário), contar ingressos com `status IN ('pending', 'confirmed')` e lançar `SoldOutError` se `occupied >= event.capacity` (`R02`, `R05`, `R07`).
- **FR-003**: Havendo vaga, `purchaseTicket()` DEVE inserir exatamente 1 registro em `tickets` com `id = 'tkt_' + <random>`, `status = 'pending'`, `price_cents = event.price_cents` (congelado), `code` único alfanumérico de 8 caracteres maiúsculos, `checked_in = false`, `channel`, `buyer_email` normalizado e `user_id` opcional (`null` quando via parceiro), commitar a transação e retornar imediatamente sem aguardar o gateway (`R03`, `R06`, `R09`, `CF-02`).
- **FR-004**: Após o commit bem-sucedido, `purchaseTicket()` DEVE agendar o processamento no gateway simulado (`scheduleSimulatedPayment`), respeitando as regras exatas de resultado e latência para finais `0001`, `0002`, `0003`, `0004` e fallback (`R08`), usando `GATEWAY_FAST_MIN_MS` (default `2000`), `GATEWAY_FAST_MAX_MS` (default `5000`), `GATEWAY_SLOW_MIN_MS` (default `30000`) e `GATEWAY_SLOW_MAX_MS` (default `40000`).
- **FR-005**: O callback do gateway DEVE executar atualização atômica estritamente condicionada:
  ```sql
  UPDATE tickets
  SET status = $newStatus, updated_at = NOW()
  WHERE id = $ticketId
    AND status = 'pending'
    AND EXISTS (
      SELECT 1 FROM events
      WHERE id = tickets.event_id AND status = 'published'
    )
  ```
  garantindo que respostas tardias jamais sobrescrevam ingressos de eventos cancelados (`R11`).
- **FR-006**: `getEventSeatMetrics(eventId)` DEVE retornar `{ capacity, occupied, available }`, onde `occupied = COUNT(status IN ('pending', 'confirmed'))` e `available = event.status === 'cancelled' ? 0 : Math.max(0, capacity - occupied)` (`R05`).
- **FR-007**: `src/modules/events/events.service.ts` (`F02`) DEVE reutilizar a função compartilhada de contagem de vagas ocupadas de `F03` (ou manter alinhamento direto dentro da transação `FOR UPDATE` de `updateEvent`) para bloquear redução de lotação abaixo de `occupied` (`R03`, `CF-03`).

### Key Entities

- **`tickets`** (tabela provisionada em `F01`): criada e atualizada por `F03`, com `code` (`UNIQUE`), `price_cents` congelado no momento da compra, `status` (`pending` → `confirmed | declined`), `user_id` (opcional, vinculando participante de `F01`) e `channel` (`storefront | partner_api`).
- **`events`** (gerenciada em `F02`): bloqueada via `FOR UPDATE` em `purchaseTicket()` e lida para `status`, `capacity` e `price_cents`.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001** (`F03-AC1`, `CF-02`, `R05`, `R06`): `purchaseTicket()` retorna imediatamente em `pending` (< 100ms), persiste o ingresso no PostgreSQL com `user_id` opcional e decrementa `available` em `getEventSeatMetrics()`.
- **SC-002** (`F03-AC2`, `R07`): Sob 30 chamadas concorrentes simultâneas para evento de lotação 5 (em múltiplas rodadas), exatamente 5 ingressos são criados e exatamente 25 falham com `sold_out`, zero overselling.
- **SC-003** (`F03-AC3`, `R08`): Validação prévia rejeita cartões fora do padrão de 16 dígitos sem criar ingresso; finais `0001`–`0004` + fallback produzem exatamente os status e faixas de atraso especificados, com `declined` liberando a vaga; guarda condicional protege contra sobrescrita em evento cancelado (`R11`).
- **SC-004** (`F03-AC4`, `CF-03`, `R02`, `R03`): Compras em evento `draft` são recusadas; após publicação em `F02`, `price_cents` é congelado na compra e alterações futuras de preço não afetam ingressos antigos; redução de lotação em `F02` abaixo das vagas ocupadas por `F03` é bloqueada.
- **SC-005** (`F03-AC5`, `R09`): 100% dos ingressos recebem código alfanumérico maiúsculo de 8 caracteres garantido por restrição `UNIQUE` no PostgreSQL.

---

## Assumptions

- Em runtime padrão (`docker-compose.yml`), as variáveis `GATEWAY_*_MS` usam exatamente os valores do brief (`2000`/`5000`/`30000`/`40000`). Apenas testes automatizados podem encurtá-las via override explícito de ambiente/config para manter `./scripts/gates.sh` rápido, enquanto testes unitários/de configuração verificam também os valores padrão exatos do brief.
- `F03` é uma feature puramente de serviço/domínio (sem rotas HTTP próprias); suas funções são consumidas por `F04` (vitrine), `F05` (API de parceiros), `F06` (painel) e `F07` (cancelamento).
