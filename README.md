# Catraca

Plataforma web e API de venda e operação de ingressos para eventos construída com **Spec-Driven Development (GitHub Spec Kit + Google Antigravity)**, atendendo integralmente às regras `R01`–`R13` e ao contrato fixo da API de parceiros.

---

## Como rodar

### Pré-requisitos
- Linux ou macOS (ou Windows via WSL2)
- **Docker** e **Docker Compose** (plugin `docker compose`)
- **Git**

> Não é necessário executar `npm install` no host: todas as dependências, migrations, seed, typecheck e suíte de testes rodam dentro dos containers Docker.

### Comandos do Harness

Execute a partir da raiz do repositório:

| Ação | Comando | O que faz |
| --- | --- | --- |
| **Subir tudo** | `./scripts/up.sh` | Constrói e sobe os containers (`db` PostgreSQL 16 + `app` Fastify/Node 24), aplica migrations, executa a seed idempotente e aguarda `GET /health` responder `200`. Funciona em um clone limpo sem nenhum passo extra. |
| **Derrubar tudo** | `./scripts/down.sh` | Encerra e remove todos os containers e redes do projeto, liberando todas as portas abertas pela subida. |
| **Rodar gates** | `./scripts/gates.sh` | Executa `tsc --noEmit`, build e toda a suíte Vitest (unitários, integração e concorrência) dentro de Docker contra o banco isolado `catraca_test`, sem poluir os dados da seed. |

Aliases equivalentes (caso Node/npm esteja instalado no host): `npm run up`, `npm run down`, `npm run gates`.

---

## Endereços

- **Produto Web (`$WEB`):** `http://localhost:3000`
- **API de Parceiros (`$API`):** `http://localhost:3000` (rotas em `/api/partner/*`)
- **Healthcheck:** `http://localhost:3000/health`

---

## Credenciais (Seed & Modo Simulado)

A seed é idempotente e pode ser reexecutada sem erros; no modo padrão, o sistema opera com o **gateway de pagamento simulado**, sem nenhuma chave externa real.

### Contas da Seed
- **Organizador A:** `org-a@catraca.local` / `OrgA1234!`
- **Organizador B:** `org-b@catraca.local` / `OrgB1234!`
- **Participante (seed):** `participante@catraca.local` / `Part1234!`

### Chave da API de Parceiros (`X-Api-Key`)
- **`$KEY`:** `catraca-partner-dev-key-2026`

### Cartões do Gateway Simulado (16 dígitos)
- Final `0001`: aprovado entre **2 e 5 segundos**
- Final `0002`: recusado entre **2 e 5 segundos**
- Final `0003`: aprovado entre **30 e 40 segundos**
- Final `0004`: recusado entre **30 e 40 segundos**
- Qualquer outro final (com 16 dígitos): recusado entre **2 e 5 segundos**

---

## Mapa dos Artefatos

### Documentação Raiz e Governança
- **PRD Completo:** [`docs/PRD.md`](docs/PRD.md)
- **Porta de Entrada dos Agentes:** [`AGENTS.md`](AGENTS.md) (referenciado por [`GEMINI.md`](GEMINI.md))
- **Constituição (Spec Kit):** [`.specify/memory/constitution.md`](.specify/memory/constitution.md)
- **Estado do Projeto:** [`project-state.json`](project-state.json)

### Features, Specs, Planos, Contratos e Relatórios

| Feature | Wave | Pasta | Spec / Plano / Tasks / Contrato | Relatório Mais Recente | PR |
| --- | --- | --- | --- | --- | --- |
| `F01` Fundação, Harness, Auth & Seed | Wave 1 | [`specs/001-f01-foundation-auth/`](specs/001-f01-foundation-auth/) | [`spec.md`](specs/001-f01-foundation-auth/spec.md) · [`plan.md`](specs/001-f01-foundation-auth/plan.md) · [`tasks.md`](specs/001-f01-foundation-auth/tasks.md) · [`contract.md`](specs/001-f01-foundation-auth/contract.md) | [`eval-001.md`](specs/001-f01-foundation-auth/reports/eval-001.md) (`APPROVED`) | [#1](https://github.com/bvresende/mba-ia-desafio-catraca/pull/1) |
| `F02` Gestão de Eventos | Wave 2 | [`specs/002-f02-organizer-events/`](specs/002-f02-organizer-events/) | [`spec.md`](specs/002-f02-organizer-events/spec.md) · [`plan.md`](specs/002-f02-organizer-events/plan.md) · [`tasks.md`](specs/002-f02-organizer-events/tasks.md) · [`contract.md`](specs/002-f02-organizer-events/contract.md) | [`eval-001.md`](specs/002-f02-organizer-events/reports/eval-001.md) (`APPROVED`) | [#2](https://github.com/bvresende/mba-ia-desafio-catraca/pull/2) |
| `F03` Motor de Compras & Gateway | Wave 3 | [`specs/003-f03-purchase-gateway/`](specs/003-f03-purchase-gateway/) | [`spec.md`](specs/003-f03-purchase-gateway/spec.md) · [`plan.md`](specs/003-f03-purchase-gateway/plan.md) · [`tasks.md`](specs/003-f03-purchase-gateway/tasks.md) · [`contract.md`](specs/003-f03-purchase-gateway/contract.md) | [`eval-001.md`](specs/003-f03-purchase-gateway/reports/eval-001.md) (`APPROVED`) | [#3](https://github.com/bvresende/mba-ia-desafio-catraca/pull/3) |
| `F04` Vitrine & Meus Ingressos | **Wave 4 (Paralela)** | [`specs/004-f04-storefront-tickets/`](specs/004-f04-storefront-tickets/) | [`spec.md`](specs/004-f04-storefront-tickets/spec.md) · [`plan.md`](specs/004-f04-storefront-tickets/plan.md) · [`tasks.md`](specs/004-f04-storefront-tickets/tasks.md) · [`contract.md`](specs/004-f04-storefront-tickets/contract.md) | [`eval-001.md`](specs/004-f04-storefront-tickets/reports/eval-001.md) (`APPROVED`) | [#4](https://github.com/bvresende/mba-ia-desafio-catraca/pull/4) |
| `F05` API de Parceiros | **Wave 4 (Paralela)** | [`specs/005-f05-partner-api/`](specs/005-f05-partner-api/) | [`spec.md`](specs/005-f05-partner-api/spec.md) · [`plan.md`](specs/005-f05-partner-api/plan.md) · [`tasks.md`](specs/005-f05-partner-api/tasks.md) · [`contract.md`](specs/005-f05-partner-api/contract.md) | [`eval-001.md`](specs/005-f05-partner-api/reports/eval-001.md) (`APPROVED`) | [#5](https://github.com/bvresende/mba-ia-desafio-catraca/pull/5) |
| `F06` Check-in & Painel | **Wave 4 (Paralela)** | [`specs/006-f06-checkin-dashboard/`](specs/006-f06-checkin-dashboard/) | [`spec.md`](specs/006-f06-checkin-dashboard/spec.md) · [`plan.md`](specs/006-f06-checkin-dashboard/plan.md) · [`tasks.md`](specs/006-f06-checkin-dashboard/tasks.md) · [`contract.md`](specs/006-f06-checkin-dashboard/contract.md) | [`eval-001.md`](specs/006-f06-checkin-dashboard/reports/eval-001.md) (`APPROVED`) | [#6](https://github.com/bvresende/mba-ia-desafio-catraca/pull/6) |
| `F07` Cancelamento & Estorno | Wave 5 | [`specs/007-f07-event-cancellation/`](specs/007-f07-event-cancellation/) | [`spec.md`](specs/007-f07-event-cancellation/spec.md) · [`plan.md`](specs/007-f07-event-cancellation/plan.md) · [`tasks.md`](specs/007-f07-event-cancellation/tasks.md) · [`contract.md`](specs/007-f07-event-cancellation/contract.md) | [`eval-001.md`](specs/007-f07-event-cancellation/reports/eval-001.md) (`APPROVED`) | [#7](https://github.com/bvresende/mba-ia-desafio-catraca/pull/7) |

### PRs da Wave Paralela (Wave 4)
Implementados simultaneamente em `git worktree`s isoladas com commits intercalados e integrados à `main` via PRs:
- **F04 (Vitrine Pública & Meus Ingressos):** https://github.com/bvresende/mba-ia-desafio-catraca/pull/4
- **F05 (API de Parceiros):** https://github.com/bvresende/mba-ia-desafio-catraca/pull/5
- **F06 (Check-in & Painel do Organizador):** https://github.com/bvresende/mba-ia-desafio-catraca/pull/6

---

## Decisões Técnicas

### 1. Stack e por quê
- **Node.js 24 LTS + TypeScript (strict) + Fastify 5 + SSR HTML/CSS + PostgreSQL 16 + Drizzle ORM + Vitest + Docker Compose.**
- Servir a interface web (SSR) e a API de parceiros no mesmo processo Fastify na porta `3000` elimina CORS, reduz o número de containers (`db` + `app`), simplifica o harness de subida/derrubada e mantém cada módulo pequeno o suficiente para caber com folga na janela de contexto dos agentes.
- Drizzle ORM sobre `pg` oferece tipagem estrita de ponta a ponta com controle direto sobre SQL transacional e bloqueios pessimistas no PostgreSQL.

### 2. Garantia de `R07` sob concorrência
- Toda compra (`purchaseTicket` em [`src/modules/purchases/purchase.service.ts`](src/modules/purchases/purchase.service.ts)), seja pela vitrine ou pela API de parceiros, abre uma transação ACID no PostgreSQL e adquire um **lock pessimista por linha no evento** (`SELECT ... FROM events WHERE id = $1 FOR UPDATE`).
- Com o lock retido até o `COMMIT`, a transação verifica `status === 'published'`, contabiliza as vagas ocupadas (`COUNT(*) WHERE status IN ('pending', 'confirmed')`) e, se `occupied < capacity`, insere o novo ingresso `pending` com `price_cents` congelado do evento naquele instante (`R03`, `R06`).
- Requisições simultâneas sobre o mesmo evento são serializadas pelo PostgreSQL no nível da linha do evento, tornando impossível ultrapassar `capacity` mesmo sob rajadas concorrentes (validado com 30 requisições paralelas contra lotação 5 em testes automatizados e no fluxo ao vivo).

### 3. Resposta assíncrona do gateway e proteção contra callbacks tardios (`R08`, `R11`)
- Após o `COMMIT` da compra `pending`, `scheduleGatewayProcessing` ([`src/modules/purchases/gateway.service.ts`](src/modules/purchases/gateway.service.ts)) agenda um timer assíncrono em memória com o atraso correspondente ao final do cartão (`2–5s` ou `30–40s`; configurável via variáveis `GATEWAY_*_MS` apenas em testes automatizados). A requisição HTTP de compra responde imediatamente (`302` na vitrine / `202` na API) sem aguardar o gateway (`R06`).
- O cancelamento de evento (`cancelEvent` em [`src/modules/cancellation/cancellation.service.ts`](src/modules/cancellation/cancellation.service.ts)) também adquire `SELECT ... FOR UPDATE` no evento e executa em uma única transação imediata (`< 100ms`, bem abaixo do limite de 10s): marca o evento como `cancelled`, converte `confirmed` → `refunded` e converte `pending` → `cancelled`.
- Quando um callback tardio do gateway (ex.: cartão `0003`/`0004`, 30–40s) dispara após o cancelamento, a atualização no banco usa a guarda atômica:
  ```sql
  UPDATE tickets
  SET status = $newStatus, updated_at = NOW()
  WHERE id = $ticketId
    AND status = 'pending'
    AND EXISTS (SELECT 1 FROM events WHERE id = tickets.event_id AND status = 'published')
  ```
  Como o ingresso já está `cancelled` e o evento não está mais `published`, a resposta tardia é descartada sem alterar nenhum registro.

### 4. Isolamento entre Implementador e Avaliador
- Cada feature foi implementada por um subagent dedicado em janela de contexto própria e limpa, sem acesso às avaliações posteriores.
- Após o término de cada implementação e passagem pelos gates, um subagent avaliador independente (`independent-evaluator`, em contexto zerado e instruído a ler apenas `AGENTS.md`, `contract.md` e `docs/PRD.md`) executou testes reais contra `./scripts/up.sh`, `./scripts/gates.sh`, `./scripts/down.sh`, `curl` e PostgreSQL, gerando um novo relatório imutável `reports/eval-NNN.md` por rodada (commitado isoladamente e nunca editado depois).
