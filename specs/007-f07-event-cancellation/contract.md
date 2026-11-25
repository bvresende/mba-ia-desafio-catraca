# Evaluation Contract: F07 — Cancelamento Irreversível de Eventos e Estorno/Cancelamento

**Feature ID**: `F07`  
**Branch**: `007-f07-event-cancellation`  
**Wave**: Wave 5 (Final)  
**PRD Reference**: `docs/PRD.md` (`F07-AC1`..`F07-AC5`, `CF-12`..`CF-16`, `R02`, `R05`, `R10`, `R11`, `R12`, `R13`)

---

## 1. Pré-requisitos de Ambiente

1. Repositório na branch/commit sob avaliação com `F01`–`F06` integrados.
2. Ambiente local iniciado via `./scripts/up.sh` com `$WEB` = `$API` = `http://localhost:3000` respondendo `200` em `/health` e gateway simulado nos atrasos padrão (`0001`/`0002`: 2–5s; `0003`/`0004`: 30–40s).
3. Credenciais da seed:
   - Organizador A: `org-a@catraca.local` / `OrgA1234!`
   - Organizador B: `org-b@catraca.local` / `OrgB1234!`
   - Participante (seed): `participante@catraca.local` / `Part1234!`
   - Chave de Parceiro (`X-Api-Key`): `catraca-partner-dev-key-2026`
4. Gates executáveis via `./scripts/gates.sh` contra `catraca_test`.

---

## 2. Itens Verificáveis

### `ITEM-01` — Cancelamento irreversível pelo organizador proprietário e bloqueio de edição/republicação (`R11`, `R13`)
- **Ação / Comando**:
  1. Como Organizador A, criar e publicar `Evento Cancelamento F07` (lotação `10`, preço `R$ 100,00`).
  2. Tentar cancelar via `POST http://localhost:3000/organizer/events/<eventId>/cancel` como visitante, como Participante e como Organizador B.
  3. Acionar `POST http://localhost:3000/organizer/events/<eventId>/cancel` autenticado como Organizador A.
  4. Após o cancelamento, verificar `GET /organizer/events/<eventId>` e tentar enviar `POST /organizer/events/<eventId>/edit` e `POST /organizer/events/<eventId>/publish` como Organizador A.
- **Critério de Aprovação**:
  - Tentativas de visitante, Participante e Organizador B são bloqueadas (`403`/`404`/redirect) e o evento continua `published`.
  - Cancelamento pelo Organizador A sucede imediatamente e altera `events.status` para `'cancelled'`.
  - Na página `/organizer/events/<eventId>`, edição e publicação estão desabilitadas/ocultas; tentativas diretas via POST de editar ou republicar são rejeitadas e o evento permanece `cancelled`.

### `ITEM-02` — Estorno de `confirmed` e cancelamento de `pending` em <= 10s para vitrine e API (`R11`)
- **Ação / Comando**:
  1. Em um evento publicado de lotação `10` e preço `R$ 100,00`:
     - Comprar 1 ingresso pela **vitrine** (`participante@catraca.local`) com cartão `0001` e aguardar confirmação (`confirmed`).
     - Comprar 1 ingresso pela **API de parceiros** com cartão `0001`, aguardar confirmação (`confirmed`) e realizar **check-in** (`Entrada liberada`, `checked_in = true`).
     - Comprar 1 ingresso pela **vitrine** com cartão lento `0003` (fica `pending`).
     - Comprar 1 ingresso pela **API de parceiros** com cartão lento `0004` (fica `pending`).
  2. Executar `POST /organizer/events/<eventId>/cancel` como Organizador A e medir o tempo até a conclusão (<= 10s).
  3. Consultar imediatamente (dentro dos 10s) `GET /my-tickets` (como Participante) e `GET /api/partner/tickets/<id>` (para todos os 4 ingressos).
- **Critério de Aprovação**:
  - Em <= 10 segundos (tipicamente < 1s):
    - Os 2 ingressos previamente `confirmed` (vitrine sem check-in e API com check-in) estão `refunded` na API e `estornado` em `/my-tickets`.
    - Os 2 ingressos previamente `pending` (vitrine `0003` e API `0004`) estão `cancelled` na API e `cancelado` em `/my-tickets`.

### `ITEM-03` — Proteção contra resposta tardia do gateway lento (`0003` e `0004` após 45s) (`R11`)
- **Ação / Comando**:
  1. A partir dos 2 ingressos `pending` com cartões `0003` (aprovação em 30–40s) e `0004` (recusa em 30–40s) cancelados no `ITEM-02`, aguardar **45 segundos** após a criação dessas compras no runtime padrão (garantindo que os callbacks assíncronos do gateway tenham disparado).
  2. Consultar novamente `GET /api/partner/tickets/<ticket0003>`, `GET /api/partner/tickets/<ticket0004>` e `GET /my-tickets`.
- **Critério de Aprovação**:
  - Passados 45 segundos, tanto o ingresso de cartão `0003` quanto o de cartão `0004` **permanecem `cancelled`** (`cancelado` na UI) — nenhum deles virou `confirmed` nem `declined`.

### `ITEM-04` — Efeito na Vitrine (`F04`) e na API de Parceiros (`F05`) pós-cancelamento (`R02`, `R11`)
- **Ação / Comando**:
  1. Com o evento do `ITEM-02` já cancelado:
     - Consultar `GET http://localhost:3000/` (vitrine pública).
     - Consultar `GET http://localhost:3000/my-tickets` (Participante).
     - Consultar `GET http://localhost:3000/api/partner/events` (com `X-Api-Key`).
     - Enviar `POST http://localhost:3000/api/partner/events/<eventId>/purchases` com `X-Api-Key` e payload válido (`buyerEmail` + cartão 16 dígitos).
     - Consultar `GET http://localhost:3000/api/partner/tickets/<ticketConfirmedId>` e `GET http://localhost:3000/api/partner/tickets/<ticketPendingId>`.
- **Critério de Aprovação**:
  - O evento cancelado **não aparece** em `GET /` nem em `GET /api/partner/events`.
  - `POST /api/partner/events/<eventId>/purchases` retorna HTTP `404` com corpo exato `{"error":"event_not_available"}`.
  - `GET /my-tickets` exibe literalmente `estornado` e `cancelado`; `GET /api/partner/tickets/:ticketId` retorna `status: "refunded"` e `status: "cancelled"`.

### `ITEM-05` — Efeito no Check-in e no Painel do Organizador (`F06`) pós-cancelamento (`R05`, `R10`, `R11`, `R12`)
- **Ação / Comando**:
  1. Com o evento do `ITEM-02` já cancelado (que tinha 2 ingressos `confirmed` — sendo 1 com check-in, 1 da vitrine e 1 da API — além de 2 `pending`), acessar `GET http://localhost:3000/organizer/events/<eventId>` como Organizador A.
  2. Enviar `POST http://localhost:3000/organizer/events/<eventId>/checkin` com o código de um dos ingressos deste evento cancelado.
  3. Enviar `POST http://localhost:3000/organizer/events/<eventId>/checkin` com código inexistente (`NAOEXISTE`).
- **Critério de Aprovação**:
  - Na página `/organizer/events/<eventId>`:
    - Edição está desabilitada/bloqueada.
    - Área de check-in exibe literalmente `Evento cancelado` (e o POST com código válido do evento retorna exatamente `Evento cancelado`; o POST com código inexistente retorna `Ingresso inválido para este evento` respeitando prioridade 1 de `R10`).
    - Painel exibe exatamente:
      - `Confirmados`: `0`
      - `Pendentes`: `0`
      - `Check-ins`: `0`
      - `Vagas disponíveis`: `0`
      - `Receita`: `R$ 0,00`
      - `Estornados`: `2` (total de ingressos anteriormente confirmados, vitrine + API, incluindo o que havia feito check-in).

### `ITEM-06` — Gates e suíte automatizada completa (`F01`–`F07`) passando integralmente
- **Ação / Comando**:
  - Executar `./scripts/gates.sh` na raiz do repositório.
- **Critério de Aprovação**:
  - Comando termina com exit code `0`, com typecheck e todas as suítes (`F01`–`F07`, incluindo `tests/f07.cancellation.test.ts`) passando sem falhas.

---

## 3. Matriz de Rastreabilidade (PRD → Contrato)

| Critério PRD | Regras | Coberto por Item(ns) do Contrato |
| --- | --- | --- |
| `F07-AC1` | `R11` | `ITEM-01`, `ITEM-06` |
| `F07-AC2` | `R11` | `ITEM-02`, `ITEM-06` |
| `F07-AC3` | `R11` | `ITEM-03`, `ITEM-06` |
| `F07-AC4` | `R10`, `R11` | `ITEM-01`, `ITEM-05`, `ITEM-06` |
| `F07-AC5` | `R05`, `R11`, `R12` | `ITEM-05`, `ITEM-06` |
| `CF-12` (`F02 → F07`) | `R11` | `ITEM-01`, `ITEM-06` |
| `CF-13` (`F03 → F07`) | `R11` | `ITEM-02`, `ITEM-03`, `ITEM-06` |
| `CF-14` (`F04 → F07`) | `R02`, `R11` | `ITEM-02`, `ITEM-04`, `ITEM-06` |
| `CF-15` (`F05 → F07`) | `R02`, `R11` | `ITEM-02`, `ITEM-04`, `ITEM-06` |
| `CF-16` (`F06 → F07`) | `R05`, `R10`, `R11`, `R12` | `ITEM-05`, `ITEM-06` |
