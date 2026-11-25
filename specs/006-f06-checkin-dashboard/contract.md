# Evaluation Contract: F06 — Check-in e Painel do Organizador

**Feature ID**: `F06`  
**Branch**: `006-f06-checkin-dashboard`  
**Wave**: Wave 4 (Paralela)  
**PRD Reference**: `docs/PRD.md` (`F06-AC1`..`F06-AC6`, `CF-09`..`CF-11`, `R03`, `R04`, `R05`, `R10`, `R12`, `R13`)

---

## 1. Pré-requisitos de Ambiente

1. Repositório na branch/commit sob avaliação com `F01`, `F02` e `F03` integrados.
2. Ambiente local iniciado via `./scripts/up.sh` com `http://localhost:3000/health` respondendo `200`.
3. Credenciais da seed:
   - Organizador A: `org-a@catraca.local` / `OrgA1234!`
   - Organizador B: `org-b@catraca.local` / `OrgB1234!`
   - Participante (seed): `participante@catraca.local` / `Part1234!`
4. Gates executáveis via `./scripts/gates.sh` contra `catraca_test`.

---

## 2. Itens Verificáveis

### `ITEM-01` — Página de gestão (`/organizer/events/:eventId`) inclui painel numérico e formulário de check-in (`R04`)
- **Ação / Comando**:
  1. Autenticar como Organizador A, criar e publicar um evento `Evento Checkin F06` (lotação `10`, preço `R$ 100,00`).
  2. Executar `GET http://localhost:3000/organizer/events/<eventId>` com o cookie de Organizador A.
- **Critério de Aprovação**:
  - HTTP `200`, HTML contém seção de painel com os 6 rótulos (`Confirmados`, `Pendentes`, `Check-ins`, `Vagas disponíveis`, `Receita`, `Estornados`) com valores iniciais `0`, `0`, `0`, `10`, `R$ 0,00`, `0` e contém formulário de check-in apontando para `/organizer/events/<eventId>/checkin`.

### `ITEM-02` — Check-in obedece estritamente à ordem de prioridade `R10` e exibe as 5 mensagens literais
- **Ação / Comando**:
  - Com o Organizador A autenticado, validar via `POST http://localhost:3000/organizer/events/<eventIdA>/checkin` (e via testes automatizados cobrindo também evento cancelado):
    1. Código inexistente (`INEXISTE`) → verificar mensagem.
    2. Código de ingresso válido pertencente a **outro evento** (`eventIdB`) → verificar mensagem.
    3. Ingresso do próprio `eventIdA` ainda `pending` (cartão `0003`) e ingresso `declined` (cartão `0002`) → verificar mensagem.
    4. Ingresso do próprio `eventIdA` com status `confirmed` (cartão `0001` após confirmação) na **1ª tentativa** → verificar mensagem.
    5. Mesmo ingresso `confirmed` na **2ª tentativa** → verificar mensagem.
    6. Em evento `cancelled` (via teste de integração/DB), submeter código válido pertencente a esse evento → verificar prioridade 2 (`Evento cancelado`) antes de `Ingresso não confirmado`, e submeter código de outro evento → verificar prioridade 1 (`Ingresso inválido para este evento`).
- **Critério de Aprovação**:
  - (1) e (2): exibe exatamente `Ingresso inválido para este evento`.
  - (3): exibe exatamente `Ingresso não confirmado`.
  - (4): exibe exatamente `Entrada liberada`.
  - (5): exibe exatamente `Ingresso já utilizado`.
  - (6): exibe exatamente `Evento cancelado` para código do evento cancelado e `Ingresso inválido para este evento` para código de outro evento.

### `ITEM-03` — Check-in não altera `status` (`confirmed`), apenas marca `checkedIn = true` e atualiza indicadores (`R10`, `R12`)
- **Ação / Comando**:
  1. Antes do check-in de um ingresso `confirmed`, conferir no painel e no banco (`tickets.status`, `tickets.checked_in`): `Confirmados = 1`, `Check-ins = 0`, `status = 'confirmed'`, `checked_in = false`.
  2. Executar check-in (`POST /organizer/events/<eventId>/checkin`) e reconsultar painel e banco.
- **Critério de Aprovação**:
  - No banco: `tickets.status` permanece `'confirmed'` e `tickets.checked_in` muda para `true` (com `checked_in_at` preenchido).
  - No painel: `Confirmados` continua `1` (não diminui) e `Check-ins` passa para `1`.

### `ITEM-04` — Painel consolida vendas de múltiplos canais (`storefront` + `partner_api`) e calcula receita por preço histórico (`R03`, `R05`, `R12`)
- **Ação / Comando**:
  1. Criar e publicar evento de lotação `10` e preço `R$ 100,00` (`10000` centavos).
  2. Registrar 2 ingressos confirmados a `R$ 100,00` (1 com `channel = 'storefront'` e 1 com `channel = 'partner_api'`).
  3. Editar o evento via `F02` alterando o preço para `R$ 150,00` (`15000` centavos).
  4. Registrar mais 1 ingresso confirmado a `R$ 150,00` e 1 ingresso `pending` (cartão lento `0003`) e 1 ingresso `declined` (cartão `0002`).
  5. Fazer check-in de 1 dos ingressos confirmados.
  6. Consultar `GET /organizer/events/<eventId>` (e verificar em `tests/f06.checkin-dashboard.test.ts`).
- **Critério de Aprovação**:
  - Painel exibe exatamente:
    - `Confirmados`: `3`
    - `Pendentes`: `1`
    - `Check-ins`: `1`
    - `Vagas disponíveis`: `6` (`10 - (3 + 1)`)
    - `Receita`: `R$ 350,00` (`2 × R$ 100,00 + 1 × R$ 150,00`)
    - `Estornados`: `0`

### `ITEM-05` — Bloqueio de visitante, participante e Organizador B no painel e no check-in (`R13`)
- **Ação / Comando**:
  1. Com um evento do Organizador A contendo um ingresso confirmado (código `CODE_A`):
  2. Tentar `GET /organizer/events/<eventIdA>` e `POST /organizer/events/<eventIdA>/checkin` com `code=CODE_A`:
     - (a) sem cookie (visitante)
     - (b) com cookie do Participante (`participante@catraca.local`)
     - (c) com cookie do Organizador B (`org-b@catraca.local`)
  3. Verificar o estado de `checked_in` do ingresso `CODE_A` após as 3 tentativas.
- **Critério de Aprovação**:
  - Todas as 6 chamadas são bloqueadas (`403`, `404` ou redirecionamento para `/login` sem expor nome, métricas ou receita do evento de A).
  - `checked_in` do ingresso `CODE_A` permanece `false`.

### `ITEM-06` — Gates e suíte automatizada passando integralmente
- **Ação / Comando**:
  - Executar `./scripts/gates.sh` na raiz do repositório.
- **Critério de Aprovação**:
  - Comando termina com exit code `0`, incluindo typecheck e todos os testes de `tests/f06.checkin-dashboard.test.ts` (além das suítes anteriores) sem falhas.

---

## 3. Matriz de Rastreabilidade (PRD → Contrato)

| Critério PRD | Regras | Coberto por Item(ns) do Contrato |
| --- | --- | --- |
| `F06-AC1` | `R04` | `ITEM-01`, `ITEM-06` |
| `F06-AC2` | `R10` | `ITEM-02`, `ITEM-06` |
| `F06-AC3` | `R10` | `ITEM-03`, `ITEM-06` |
| `F06-AC4` | `R05`, `R12` | `ITEM-01`, `ITEM-04`, `ITEM-06` |
| `F06-AC5` | `R03`, `R12` | `ITEM-04`, `ITEM-06` |
| `F06-AC6` | `R13` | `ITEM-05`, `ITEM-06` |
| `CF-09` (`F01 → F06`) | `R13` | `ITEM-05`, `ITEM-06` |
| `CF-10` (`F02 → F06`) | `R04`, `R13` | `ITEM-01`, `ITEM-05`, `ITEM-06` |
| `CF-11` (`F03 → F06`) | `R03`, `R05`, `R10`, `R12` | `ITEM-02`, `ITEM-03`, `ITEM-04`, `ITEM-06` |
