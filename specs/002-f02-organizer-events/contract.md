# Contract: F02 — Gestão de Eventos pelo Organizador

**Feature**: `F02` — Gestão de Eventos pelo Organizador  
**Branch**: `feat/f02-organizer-events`  
**PRD Reference**: `docs/PRD.md` (`F02-AC1`–`F02-AC7`, `CF-01`, `R01`, `R02`, `R03`, `R04`, `R13`)  
**Evaluation Policy**: Este contrato deve ser verificado por um avaliador independente em contexto limpo, gravando o resultado em `specs/002-f02-organizer-events/reports/eval-NNN.md`.

---

## 1. Pré-requisitos de Ambiente

- Aplicação em execução via `./scripts/up.sh` respondendo `200` em `http://localhost:3000/health`.
- Credenciais da seed (`F01`):
  - Organizador A: `org-a@catraca.local` / `OrgA1234!`
  - Organizador B: `org-b@catraca.local` / `OrgB1234!`
  - Participante: `participante@catraca.local` / `Part1234!`
- Acesso ao container `db` (`docker compose exec -T db psql -U catraca -d catraca ...`) apenas para verificação de persistência e simulação controlada de ingressos existentes no teste de `R03` (antes da entrega de `F03`).

---

## 2. Itens Verificáveis

### `ITEM-01` — Gates e testes automatizados passando integralmente
- **Comando / Ação**:
  ```bash
  ./scripts/gates.sh
  ```
- **Critério de Aprovação**:
  - Exit code `0`, sem erros de TypeScript e com todos os testes de `F01` e `F02` passando contra `catraca_test`.

### `ITEM-02` — Autenticação da seed (`F01`) operando `F02` e bloqueio de visitante/participante (`CF-01`, `R13`)
- **Comando / Ação**:
  1. Sem cookie: `GET http://localhost:3000/organizer/events` e `POST http://localhost:3000/organizer/events`.
  2. Com cookie de participante (`participante@catraca.local` / `Part1234!`): `GET http://localhost:3000/organizer/events` e `POST http://localhost:3000/organizer/events`.
  3. Com cookie de Organizador A (`org-a@catraca.local` / `OrgA1234!`): `GET http://localhost:3000/organizer/events`.
- **Critério de Aprovação**:
  - Visitante recebe `302` (para `/login`) ou `403` sem dados administrativos.
  - Participante recebe `403` sem dados administrativos.
  - Organizador A recebe `200` com a página de listagem de eventos.

### `ITEM-03` — Criação de evento válido em rascunho e rejeição de entradas inválidas (`R01`, `R02`)
- **Comando / Ação**:
  Como Organizador A:
  1. Enviar `POST /organizer/events` com `capacity=0` e preço válido → verificar status `400`.
  2. Enviar `POST /organizer/events` com `price=0` (e `price=-10`) e lotação válida → verificar status `400`.
  3. Enviar `POST /organizer/events` com `name=""` ou `location=""` → verificar status `400`.
  4. Enviar `POST /organizer/events` com `name=Festival Catraca A`, data futura (`2028-05-10T20:00:00-03:00`), `location=Auditório Principal`, `capacity=10`, `price=100.00`.
  5. Consultar `events` no PostgreSQL pelo nome `"Festival Catraca A"`.
- **Critério de Aprovação**:
  - Todas as 3 tentativas inválidas retornam `400` e não criam registro no banco.
  - A criação válida redireciona para `/organizer/events/<eventId>` e persiste no banco `status = 'draft'`, `capacity = 10`, `price_cents = 10000`, `owner_id` correspondente ao Organizador A.

### `ITEM-04` — Rejeição de data/hora no passado na criação e na edição (`R01`)
- **Comando / Ação**:
  Como Organizador A:
  1. `POST /organizer/events` com `startsAt=2020-01-01T10:00:00-03:00` (passado) e demais campos válidos.
  2. `POST /organizer/events/<eventId>/edit` (no evento criado no `ITEM-03`) com `startsAt=2020-01-01T10:00:00-03:00`.
- **Critério de Aprovação**:
  - Ambas as requisições são rejeitadas com HTTP `400` e mensagem de validação.
  - Nenhum evento com data no passado é criado e o evento existente preserva sua data futura original no PostgreSQL.

### `ITEM-05` — Página de gestão em URL própria e publicação do evento (`R02`, `R04`)
- **Comando / Ação**:
  Como Organizador A:
  1. Acessar `GET /organizer/events/<eventId>` (evento em `draft`).
  2. Enviar `POST /organizer/events/<eventId>/publish`.
  3. Reacessar `GET /organizer/events/<eventId>` e verificar status no PostgreSQL.
- **Critério de Aprovação**:
  - `GET /organizer/events/<eventId>` retorna `200`, exibe os dados do evento, formulário de edição, botão/formulário de publicação e estrutura da página de gestão dedicada.
  - Após `POST .../publish`, `events.status` no banco é `'published'` e a página exibe o status publicado.

### `ITEM-06` — Proteção de lotação mínima contra vagas ocupadas e aumento de lotação (`R03`)
- **Comando / Ação**:
  1. Para o evento `<eventId>` (lotação `10`), inserir 3 ingressos ocupando vaga (`2 confirmed` + `1 pending`) e 1 ingresso `declined` (que não ocupa vaga) na tabela `tickets` (ou via teste integrado).
  2. Como Organizador A, enviar `POST /organizer/events/<eventId>/edit` tentando reduzir `capacity` para `2`.
  3. Como Organizador A, enviar `POST /organizer/events/<eventId>/edit` alterando `capacity` para `3` (igual às ocupadas) e depois para `15` (aumento).
- **Critério de Aprovação**:
  - Redução para `2` é rejeitada (`400`/`409`) mantendo `capacity = 10` no banco.
  - Edição para `3` e para `15` é aceita e refletida no PostgreSQL (`capacity = 15`).

### `ITEM-07` — Alteração de preço preserva `price_cents` de ingressos já existentes (`R03`)
- **Comando / Ação**:
  1. Verificar que os ingressos pré-existentes do evento `<eventId>` têm `price_cents = 10000`.
  2. Como Organizador A, enviar `POST /organizer/events/<eventId>/edit` alterando `price` para `150.00` (mantendo data futura e lotação válida).
  3. Consultar no PostgreSQL `events.price_cents` e `tickets.price_cents` dos ingressos existentes.
- **Critério de Aprovação**:
  - `events.price_cents` passa a `15000`.
  - Todos os registros já existentes em `tickets` mantêm `price_cents = 10000` inalterado.

### `ITEM-08` — Isolamento estrito entre Organizador A e Organizador B (`R13`)
- **Comando / Ação**:
  Autenticar como Organizador B (`org-b@catraca.local` / `OrgB1234!`):
  1. `GET http://localhost:3000/organizer/events`
  2. `GET http://localhost:3000/organizer/events/<eventIdDeA>`
  3. `POST http://localhost:3000/organizer/events/<eventIdDeA>/edit` (tentando alterar nome/preço)
  4. `POST http://localhost:3000/organizer/events/<eventIdDeA>/publish`
- **Critério de Aprovação**:
  - Em (1), o HTML retornado **não contém** `"Festival Catraca A"` nem `<eventIdDeA>`.
  - Em (2), (3) e (4), a resposta retorna `403` ou `404` e o corpo da resposta **não contém** `"Festival Catraca A"`, `"Auditório Principal"` nem nenhum dado do evento do Organizador A.
  - O evento no banco permanece intacto sem alterações feitas por Organizador B.

---

## 3. Matriz de Rastreabilidade (PRD → Contrato)

| Critério PRD | Regras | Itens do Contrato que Comprovam |
| --- | --- | --- |
| `F02-AC1` | `R01` | `ITEM-01`, `ITEM-03` |
| `F02-AC2` | `R01` | `ITEM-01`, `ITEM-04` |
| `F02-AC3` | `R02` | `ITEM-01`, `ITEM-03`, `ITEM-05` |
| `F02-AC4` | `R03` | `ITEM-01`, `ITEM-06` |
| `F02-AC5` | `R03` | `ITEM-01`, `ITEM-07` |
| `F02-AC6` | `R04` | `ITEM-01`, `ITEM-05` |
| `F02-AC7` | `R13` | `ITEM-01`, `ITEM-08` |
| `CF-01` (`F01 → F02`) | `R13` | `ITEM-01`, `ITEM-02` |
