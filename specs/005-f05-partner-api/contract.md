# Evaluation Contract: F05 — API de Parceiros (Contrato Fixo)

**Feature ID**: `F05`  
**Branch**: `005-f05-partner-api`  
**Wave**: Wave 4 (Paralela)  
**PRD Reference**: `docs/PRD.md` (`F05-AC1`..`F05-AC6`, `CF-07`..`CF-08`, `R02`, `R05`, `R06`, `R07`, `R08`)

---

## 1. Pré-requisitos de Ambiente

1. Repositório na branch/commit sob avaliação com `F01`, `F02` e `F03` integrados.
2. Ambiente local iniciado via `./scripts/up.sh` com `$API = http://localhost:3000` respondendo `200` em `/health`.
3. Credenciais da seed:
   - Organizador A: `org-a@catraca.local` / `OrgA1234!`
   - Chave de Parceiro (`X-Api-Key`): `catraca-partner-dev-key-2026`
4. Gates executáveis via `./scripts/gates.sh` rodando toda a suíte (incluindo o teste de concorrência de 30 requisições paralelas) contra `catraca_test`.

---

## 2. Itens Verificáveis

### `ITEM-01` — Autenticação `X-Api-Key` obrigatória nas 3 rotas (`401 {"error":"unauthorized"}`)
- **Ação / Comando**:
  - Executar chamadas `curl` sem `X-Api-Key` e com `X-Api-Key: invalida` em:
    1. `GET http://localhost:3000/api/partner/events`
    2. `POST http://localhost:3000/api/partner/events/inexistente/purchases` (inclusive com body `{}` inválido)
    3. `GET http://localhost:3000/api/partner/tickets/00000000-0000-0000-0000-000000000000`
- **Critério de Aprovação**:
  - Todas as 6 chamadas retornam HTTP `401` e corpo JSON exato `{"error":"unauthorized"}` (prioridade absoluta sobre `422` e `404`).

### `ITEM-02` — `GET /api/partner/events` lista apenas eventos publicados com campos exatos e `availableSeats` (`R02`, `R05`)
- **Ação / Comando**:
  1. Como Organizador A (`F02`), criar `Evento Rascunho API` (manter em `draft`) e `Evento Publicado API` (publicar, lotação `5`, preço `R$ 120,00` = `12000`).
  2. Executar `curl -sS -H "X-Api-Key: catraca-partner-dev-key-2026" http://localhost:3000/api/partner/events`.
  3. Publicar `Evento Rascunho API` em `F02` e repetir o `GET`.
- **Critério de Aprovação**:
  - HTTP `200`, array JSON contendo inicialmente apenas `Evento Publicado API` (sem `Evento Rascunho API`) com campos `id`, `name`, `startsAt` (ISO-8601), `priceCents: 12000`, `availableSeats: 5`.
  - Após publicação, `Evento Rascunho API` aparece imediatamente na listagem com `priceCents` e `availableSeats` corretos.

### `ITEM-03` — Ordem estrita de validação em `POST /api/partner/events/:eventId/purchases` (`422` → `404` → `409` → `202`)
- **Ação / Comando**:
  - Com `X-Api-Key: catraca-partner-dev-key-2026`:
    1. Enviar `POST /api/partner/events/00000000-0000-0000-0000-000000000000/purchases` com: (a) body `{}` (campos faltando), (b) `{"buyerEmail":"email-invalido","cardNumber":"4111111111110001"}`, (c) `{"buyerEmail":"a@b.com","cardNumber":"1234"}` (menos de 16 dígitos).
    2. Enviar payload válido `{"buyerEmail":"parceiro@teste.com","cardNumber":"4111111111110001"}` para: (a) `eventId` inexistente, (b) `eventId` em `draft`, (c) `eventId` malformado (`nao-e-uuid`).
    3. Enviar payload válido para evento `published` com vaga disponível.
- **Critério de Aprovação**:
  - Todos os casos de (1) retornam HTTP `422` com `{"error":"invalid_request"}` (mesmo sendo `eventId` inexistente, provando precedência de `422` sobre `404`).
  - Todos os casos de (2) retornam HTTP `404` com `{"error":"event_not_available"}`.
  - Caso (3) retorna imediatamente (< 2s) HTTP `202` com `{"ticketId":"...","code":"...","status":"pending"}`.

### `ITEM-04` — Esgotamento (`409 {"error":"sold_out"}`) considerando ingressos `pending` (`R05`, `R07`)
- **Ação / Comando**:
  1. Criar e publicar evento com lotação `1`.
  2. Comprar 1 ingresso via `POST /api/partner/events/<id>/purchases` com cartão lento `4111111111110003` (fica `pending` por 30–40s).
  3. Imediatamente (enquanto o primeiro ingresso ainda está `pending`), enviar segunda chamada `POST /api/partner/events/<id>/purchases` com payload válido.
  4. Consultar `GET /api/partner/events` para o evento.
- **Critério de Aprovação**:
  - Primeira chamada retorna `202` com `status: "pending"`.
  - Segunda chamada retorna HTTP `409` com corpo exato `{"error":"sold_out"}`.
  - `GET /api/partner/events` mostra `availableSeats: 0` para esse evento.

### `ITEM-05` — Concorrência sob carga: 30 requisições simultâneas em evento de lotação 5 (mínimo 2 rodadas) (`R07`)
- **Ação / Comando**:
  1. Executar o teste automatizado de concorrência em `tests/f05.partner-api.test.ts` via `./scripts/gates.sh` (que dispara 30 requisições paralelas em >= 2 rodadas independentes contra eventos novos de lotação 5).
  2. (Adicional em runtime) Criar/publicar evento de lotação 5 no ambiente rodando em `http://localhost:3000` e disparar 30 `curl` simultâneos (`xargs -P 30` ou script Node `Promise.all`) contra `POST /api/partner/events/<id>/purchases`, coletando todos os status HTTP.
- **Critério de Aprovação**:
  - Em todas as rodadas (automatizadas e em runtime), exatamente **5** requisições respondem `202` e exatamente **25** respondem `409` com `{"error":"sold_out"}` (zero erros `500`, zero overselling no banco).

### `ITEM-06` — `GET /api/partner/tickets/:ticketId` para ingressos da API, da vitrine e inexistentes (`R08`)
- **Ação / Comando**:
  1. Comprar via API com cartão `0001` e consultar `GET /api/partner/tickets/<id1>` imediatamente e novamente após 6s.
  2. Comprar via API com cartão `0002` em evento de lotação 1, aguardar 6s, consultar `GET /api/partner/tickets/<id2>` e `GET /api/partner/events`.
  3. Obter o `ticketId` de um ingresso criado pelo canal `storefront` (vitrine / `purchaseTicket` com `channel: 'storefront'`) e consultar `GET /api/partner/tickets/<idStorefront>`.
  4. Consultar `GET /api/partner/tickets/00000000-0000-0000-0000-000000000000`.
- **Critério de Aprovação**:
  - Caso (1): `200` com `{"ticketId","code","eventId","status":"pending","checkedIn":false}` inicialmente e `status: "confirmed"` após 6s.
  - Caso (2): `200` com `status: "declined"` após 6s e `availableSeats` volta para `1` em `GET /api/partner/events`.
  - Caso (3): `200` com `{"ticketId","code","eventId","status","checkedIn"}` comprovando leitura de qualquer canal.
  - Caso (4): `404` com corpo exato `{"error":"ticket_not_found"}`.

### `ITEM-07` — Gates e suíte automatizada passando integralmente
- **Ação / Comando**:
  - Executar `./scripts/gates.sh` na raiz do repositório.
- **Critério de Aprovação**:
  - Comando termina com exit code `0`, com typecheck e todos os testes de `tests/f05.partner-api.test.ts` (incluindo concorrência em >= 2 rodadas) passando sem falhas.

---

## 3. Matriz de Rastreabilidade (PRD → Contrato)

| Critério PRD | Regras | Coberto por Item(ns) do Contrato |
| --- | --- | --- |
| `F05-AC1` | — | `ITEM-01`, `ITEM-07` |
| `F05-AC2` | `R02`, `R05` | `ITEM-02`, `ITEM-07` |
| `F05-AC3` | `R06` | `ITEM-03`, `ITEM-07` |
| `F05-AC4` | `R07` | `ITEM-04`, `ITEM-07` |
| `F05-AC5` | `R07` | `ITEM-05`, `ITEM-07` |
| `F05-AC6` | `R08` | `ITEM-06`, `ITEM-07` |
| `CF-07` (`F02 → F05`) | `R02` | `ITEM-02`, `ITEM-03`, `ITEM-07` |
| `CF-08` (`F03 → F05`) | `R05`, `R06`, `R07`, `R08` | `ITEM-03`, `ITEM-04`, `ITEM-05`, `ITEM-06`, `ITEM-07` |
