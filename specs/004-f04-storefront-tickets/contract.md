# Evaluation Contract: F04 — Vitrine Pública e Área do Participante ("Meus ingressos")

**Feature ID**: `F04`  
**Branch**: `004-f04-storefront-tickets`  
**Wave**: Wave 4 (Paralela)  
**PRD Reference**: `docs/PRD.md` (`F04-AC1`..`F04-AC4`, `CF-04`..`CF-06`, `R02`, `R05`, `R06`, `R07`, `R08`, `R09`)

---

## 1. Pré-requisitos de Ambiente

1. Repositório na branch/commit sob avaliação com `F01`, `F02` e `F03` integrados.
2. Ambiente local iniciado via `./scripts/up.sh` com `http://localhost:3000/health` respondendo `200`.
3. Credenciais da seed disponíveis:
   - Organizador A: `org-a@catraca.local` / `OrgA1234!`
   - Participante (seed): `participante@catraca.local` / `Part1234!`
4. Gateway simulado em modo padrão no runtime (`0001`: aprova em 2–5s; `0002`: recusa em 2–5s; `0003`: aprova em 30–40s).
5. Gates executáveis via `./scripts/gates.sh` contra o banco isolado `catraca_test`.

---

## 2. Itens Verificáveis

### `ITEM-01` — Vitrine pública exibe apenas eventos publicados e reflete publicação imediata (`R02`)
- **Ação / Comando**:
  1. Autenticar como Organizador A (`org-a@catraca.local`) e criar um evento `Evento Rascunho F04` (mantido em `draft`) e um evento `Evento Publicado F04` (publicado via `F02`, lotação 5, preço `R$ 100,00`, data futura).
  2. Executar `curl -sS -i http://localhost:3000/` **sem cookies de sessão** (visitante deslogado).
  3. Publicar o `Evento Rascunho F04` em `F02` e repetir `curl -sS http://localhost:3000/`.
- **Critério de Aprovação**:
  - Na etapa 2, HTTP `200`, o HTML contém `Evento Publicado F04`, local, data/hora formatada, preço (`R$ 100,00`) e vagas disponíveis (`5`), e **NÃO** contém `Evento Rascunho F04`.
  - Na etapa 3, logo após a publicação, `Evento Rascunho F04` passa a aparecer em `GET /` com seus dados corretos.

### `ITEM-02` — Compra na vitrine por participante recém-cadastrado nasce `pendente` sem bloquear no gateway (`R06`, `R09`)
- **Ação / Comando**:
  1. Cadastrar um novo participante pela rota de cadastro de `F01` (ou autenticar com novo participante) e obter seu cookie de sessão.
  2. Criar/publicar um evento de lotação `2` e preço `R$ 80,00`.
  3. Medir o tempo e enviar `POST http://localhost:3000/events/<eventId>/purchase` com o cookie do participante e `cardNumber=4111111111110003` (cartão lento de 30–40s) ou `4111111111110001`.
  4. Seguir imediatamente para `GET http://localhost:3000/my-tickets` e também consultar `GET http://localhost:3000/`.
- **Critério de Aprovação**:
  - O `POST` responde imediatamente (em < 2s, sem aguardar o gateway) com redirecionamento para `/my-tickets` (ou `200/303` sem erro).
  - Em `GET /my-tickets`, o ingresso aparece imediatamente com nome do evento, status literal `pendente` e código único alfanumérico não vazio.
  - Em `GET /`, a contagem de vagas disponíveis do evento já reduziu de `2` para `1`.

### `ITEM-03` — Evento sem vagas (inclusive por ingressos `pending`) exibe literalmente `Ingressos esgotados` (`R05`, `R07`)
- **Ação / Comando**:
  1. Criar e publicar um evento de lotação `1`.
  2. Como participante autenticado, comprar 1 ingresso usando cartão lento `4111111111110003` (fica `pending` por 30–40s).
  3. Imediatamente (enquanto o ingresso ainda está `pending`), consultar `GET http://localhost:3000/` (deslogado e logado).
  4. Tentar enviar um segundo `POST http://localhost:3000/events/<eventId>/purchase` autenticado com cartão `4111111111110001`.
- **Critério de Aprovação**:
  - Em `GET /`, o evento exibe literalmente a string `Ingressos esgotados` (e não apresenta botão ativo de compra).
  - O segundo `POST` não cria novo ingresso no banco e a resposta exibida ao usuário contém literalmente `Ingressos esgotados`.

### `ITEM-04` — Evolução assíncrona em "Meus ingressos": `0001` → `confirmado` e `0002` → `recusado` com liberação de vaga (`R05`, `R08`, `R09`)
- **Ação / Comando**:
  1. Criar e publicar um evento de lotação `1`.
  2. Como participante autenticado, comprar com cartão `4111111111110002` (recusado em 2–5s). Confirmar que imediatamente fica `pendente` em `/my-tickets` e `Ingressos esgotados` em `/`.
  3. Aguardar 6 segundos e recarregar `GET /my-tickets` e `GET /`.
  4. Comprar novamente no mesmo evento usando cartão `4111111111110001` (aprovado em 2–5s), aguardar 6 segundos e recarregar `GET /my-tickets`.
- **Critério de Aprovação**:
  - Após 6s da compra `0002`: `/my-tickets` exibe status literal `recusado` com o código único do ingresso e `GET /` volta a exibir `1` vaga disponível (não mais `Ingressos esgotados`).
  - Após 6s da compra `0001`: `/my-tickets` exibe status literal `confirmado` com o código único do novo ingresso.

### `ITEM-05` — Isolamento de participantes em `/my-tickets` e bloqueio de acesso indevido (`F01 → F04`)
- **Ação / Comando**:
  1. Autenticar como Participante A (`participante@catraca.local`) e comprar ingresso no Evento X.
  2. Cadastrar/autenticar um Participante B distinto e acessar `GET http://localhost:3000/my-tickets`.
  3. Tentar acessar `GET http://localhost:3000/my-tickets` e `POST http://localhost:3000/events/<eventId>/purchase` sem login (visitante) e com cookie de Organizador A.
- **Critério de Aprovação**:
  - Participante B não vê nenhum ingresso ou código pertencente ao Participante A em `/my-tickets`.
  - Visitante e Organizador A são bloqueados (redirecionamento para `/login` ou `403`) sem criar ingresso nem expor ingressos de terceiros.

### `ITEM-06` — Tradução literal dos cinco status em português na UI (`pendente`, `confirmado`, `recusado`, `cancelado`, `estornado`)
- **Ação / Comando**:
  - Inspecionar o mapeamento de status em `src/views/storefront.views.ts` e executar a suíte automatizada `tests/f04.storefront.test.ts` cobrindo os 5 estados (`pending`, `confirmed`, `declined`, `cancelled`, `refunded`).
- **Critério de Aprovação**:
  - Todos os 5 estados renderizam exatamente os termos literais `pendente`, `confirmado`, `recusado`, `cancelado`, `estornado` em `/my-tickets`.

### `ITEM-07` — Gates e suíte automatizada passando integralmente
- **Ação / Comando**:
  - Executar `./scripts/gates.sh` na raiz do repositório.
- **Critério de Aprovação**:
  - Comando termina com exit code `0`, incluindo typecheck (`tsc --noEmit`) e todos os testes de `tests/f04.storefront.test.ts` (além dos testes de `F01`–`F03`) sem falhas.

---

## 3. Matriz de Rastreabilidade (PRD → Contrato)

| Critério PRD | Regras | Coberto por Item(ns) do Contrato |
| --- | --- | --- |
| `F04-AC1` | `R02` | `ITEM-01`, `ITEM-07` |
| `F04-AC2` | `R06` | `ITEM-02`, `ITEM-07` |
| `F04-AC3` | `R07` | `ITEM-03`, `ITEM-07` |
| `F04-AC4` | `R08`, `R09` | `ITEM-02`, `ITEM-04`, `ITEM-06`, `ITEM-07` |
| `CF-04` (`F01 → F04`) | `R09` | `ITEM-02`, `ITEM-05`, `ITEM-07` |
| `CF-05` (`F02 → F04`) | `R02` | `ITEM-01`, `ITEM-07` |
| `CF-06` (`F03 → F04`) | `R05`, `R06`, `R07`, `R08` | `ITEM-02`, `ITEM-03`, `ITEM-04`, `ITEM-07` |
