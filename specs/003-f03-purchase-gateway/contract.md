# Contract: F03 — Motor de Compras, Concorrência e Gateway Simulado

**Feature**: `F03` — Motor de Compras, Concorrência e Gateway Simulado  
**Branch**: `feat/f03-purchase-gateway`  
**PRD Reference**: `docs/PRD.md` (`F03-AC1`–`F03-AC5`, `CF-02`, `CF-03`, `R02`, `R03`, `R05`, `R06`, `R07`, `R08`, `R09`, `R11`)  
**Evaluation Policy**: Este contrato deve ser verificado por um avaliador independente em contexto limpo, gravando o resultado em `specs/003-f03-purchase-gateway/reports/eval-NNN.md`.

---

## 1. Pré-requisitos de Ambiente

- Aplicação e banco PostgreSQL 16 operacionais via `./scripts/up.sh` (ou execução via `./scripts/gates.sh` contra `catraca_test`).
- Features `F01` e `F02` presentes na branch.
- `docker-compose.yml` configurado com os tempos oficiais do gateway simulado (ou usando os defaults oficiais de `src/config/env.ts`: `2000–5000ms` rápido e `30000–40000ms` lento).

---

## 2. Itens Verificáveis

### `ITEM-01` — Gates e suíte completa (`F01` + `F02` + `F03`) passando em `catraca_test`
- **Comando / Ação**:
  ```bash
  ./scripts/gates.sh
  ```
- **Critério de Aprovação**:
  - Exit code `0`, typecheck strict limpo e 100% dos testes de `tests/f01.foundation.test.ts`, `tests/f02.events.test.ts` e `tests/f03.purchase-gateway.test.ts` aprovados no banco isolado `catraca_test`.

### `ITEM-02` — Compra imediata em `pending`, persistência com `user_id` de `F01` e métricas `R05` (`F03-AC1`, `CF-02`)
- **Comando / Ação**:
  Executar via suíte `tests/f03.purchase-gateway.test.ts` ou script TS dentro do container `app` contra `catraca_test`:
  1. Publicar evento com `capacity = 5`, `price_cents = 10000`.
  2. Chamar `purchaseTicket({ eventId, buyerEmail: 'participante@catraca.local', cardNumber: '4111111111110001', userId: 'usr_part_seed', channel: 'storefront' })` medindo o tempo de retorno.
  3. Consultar `getEventSeatMetrics(eventId)` imediatamente após o retorno e verificar a linha gravada em `tickets`.
  4. Verificar também `getEventSeatMetrics(eventId)` para um evento com `status = 'cancelled'`.
- **Critério de Aprovação**:
  - `purchaseTicket()` retorna imediatamente (< 500ms, sem aguardar os 2–5s do gateway) com `status: 'pending'`.
  - Registro persistido em `tickets` possui `user_id = 'usr_part_seed'`, `status = 'pending'`, `checked_in = false`, `channel = 'storefront'`.
  - `getEventSeatMetrics()` retorna `{ capacity: 5, occupied: 1, available: 4 }`; para evento `cancelled`, retorna `available: 0`.

### `ITEM-03` — Concorrência estrita 30 × 5 sem overselling usando `SELECT ... FOR UPDATE` (`F03-AC2`, `R07`)
- **Comando / Ação**:
  1. Inspecionar `src/modules/purchases/purchase.service.ts` confirmando uso explícito de `SELECT ... FROM events WHERE id = ... FOR UPDATE` dentro de transação antes de contar vagas e inserir ingresso.
  2. Executar em `catraca_test` (via `tests/f03.purchase-gateway.test.ts` e/ou script de stress no container `app`) 3 rodadas independentes de `30` chamadas simultâneas (`Promise.all`) a `purchaseTicket()` sobre eventos novos com `capacity = 5`.
- **Critério de Aprovação**:
  - Em **todas** as rodadas: exatamente `5` chamadas criam ingresso `pending`, exatamente `25` falham com erro `sold_out` (`SoldOutError`), e o PostgreSQL registra exatamente `5` ingressos para o evento (`occupied = 5`, `available = 0`).

### `ITEM-04` — Validação de cartão de 16 dígitos e regras completas do gateway simulado (`F03-AC3`, `R08`)
- **Comando / Ação**:
  1. Verificar defaults em `src/config/env.ts` / `docker-compose.yml`: rápido `2000–5000ms` e lento `30000–40000ms`.
  2. Chamar `purchaseTicket()` com cartões inválidos (`"1234"`, `"123456789012345a"`, `"12345678901234567"`, `""`) e confirmar erro `invalid_request` sem nenhuma inserção na tabela `tickets`.
  3. Executar os 5 finais de cartão válidos:
     - `...0001` → transita para `confirmed` (faixa rápida)
     - `...0002` → transita para `declined` (faixa rápida) e libera a vaga em `getEventSeatMetrics()`, permitindo nova compra em evento de lotação `1`
     - `...0003` → transita para `confirmed` (faixa lenta)
     - `...0004` → transita para `declined` (faixa lenta)
     - `...9999` (qualquer outro final de 16 dígitos) → transita para `declined` (faixa rápida)
  4. Executar verificação real em runtime padrão (`docker compose exec -T app ...` sem encurtar delays) com cartão final `0001` confirmando transição real entre 2s e 5s.
- **Critério de Aprovação**:
  - Cartões inválidos são rejeitados antes de criar ingresso.
  - Todos os 5 finais atingem exatamente o status esperado, `declined` libera vaga imediatamente e a execução com delays padrão aprova `0001` dentro de 2–5s.

### `ITEM-05` — Guarda atômica do callback contra sobrescrita em evento cancelado (`R11`)
- **Comando / Ação**:
  1. Inspecionar `src/modules/purchases/gateway.service.ts` confirmando que o `UPDATE` do callback filtra por `WHERE id = ... AND status = 'pending'` e verifica que o evento está `published`.
  2. Em teste integrado em `catraca_test`: iniciar compra com cartão lento `0003` (ingresso `pending`), atualizar no banco o evento para `cancelled` e o ingresso para `cancelled` antes da expiração do timer do gateway, aguardar o callback do gateway executar e consultar `tickets.status`.
- **Critério de Aprovação**:
  - Após o disparo do callback tardio de aprovação (`0003`), o ingresso **permanece `cancelled`** (jamais volta para `confirmed`).

### `ITEM-06` — Integração `F02 → F03`: recusa em `draft`, congelamento de preço e bloqueio de redução de lotação (`F03-AC4`, `CF-03`, `R02`, `R03`)
- **Comando / Ação**:
  Em teste integrado contra `catraca_test`:
  1. Criar evento em rascunho via `createEvent()` (`F02`) com `capacity = 5`, `priceCents = 10000`.
  2. Chamar `purchaseTicket()` enquanto `status = 'draft'` → deve falhar com `event_not_available`.
  3. Publicar evento via `publishEvent()` (`F02`) e realizar 2 compras via `purchaseTicket()` (ambas gravam `price_cents = 10000`).
  4. Tentar reduzir lotação para `1` via `updateEvent()` (`F02`) → deve falhar (`R03`).
  5. Editar preço do evento para `15000` via `updateEvent()` (`F02`) e realizar 1 nova compra via `purchaseTicket()`.
  6. Consultar `tickets.price_cents` no PostgreSQL.
- **Critério de Aprovação**:
  - Compra em `draft` falha com `event_not_available`.
  - Redução de lotação abaixo das 2 vagas ocupadas falha em `updateEvent()`.
  - Os 2 primeiros ingressos mantêm `price_cents = 10000` e o 3º grava `price_cents = 15000`.

### `ITEM-07` — Código único alfanumérico de 8 caracteres com restrição `UNIQUE` no banco (`F03-AC5`, `R09`)
- **Comando / Ação**:
  1. Verificar constraint `UNIQUE` na coluna `tickets.code` no PostgreSQL:
     ```bash
     docker compose exec -T db psql -U catraca -d catraca -t -A -c "SELECT conname, contype FROM pg_constraint WHERE conrelid = 'tickets'::regclass AND contype = 'u';"
     ```
  2. Emitir múltiplos ingressos via `purchaseTicket()` e validar que 100% dos códigos casam com `/^[A-Z0-9]{8}$/` e são distintos entre si.
- **Critério de Aprovação**:
  - Existe constraint `UNIQUE` no PostgreSQL sobre `tickets.code`.
  - Todos os ingressos emitidos possuem código único no formato `/^[A-Z0-9]{8}$/`.

---

## 3. Matriz de Rastreabilidade (PRD → Contrato)

| Critério PRD | Regras | Itens do Contrato que Comprovam |
| --- | --- | --- |
| `F03-AC1` | `R05`, `R06` | `ITEM-01`, `ITEM-02` |
| `F03-AC2` | `R07` | `ITEM-01`, `ITEM-03` |
| `F03-AC3` | `R08` | `ITEM-01`, `ITEM-04`, `ITEM-05` |
| `F03-AC4` | `R03` | `ITEM-01`, `ITEM-06` |
| `F03-AC5` | `R09` | `ITEM-01`, `ITEM-07` |
| `CF-02` (`F01 → F03`) | `R06`, `R09` | `ITEM-01`, `ITEM-02`, `ITEM-07` |
| `CF-03` (`F02 → F03`) | `R02`, `R03` | `ITEM-01`, `ITEM-06` |
