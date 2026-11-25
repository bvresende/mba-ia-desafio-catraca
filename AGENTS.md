# AGENTS.md — Catraca

Porta de entrada para qualquer agente que trabalhe neste repositório. Leia este arquivo antes de editar código, rodar comandos ou avaliar features.

## 1. Visão Geral do Projeto

**Catraca** é uma plataforma de venda e operação de ingressos para eventos construída em modo Spec-Driven Development (GitHub Spec Kit + Antigravity), atendendo às regras `R01`–`R13` do brief e ao contrato fixo da API de parceiros.

- **Stack:** Node.js 24 LTS, TypeScript (strict), Fastify 5, SSR HTML + CSS, PostgreSQL 16, Drizzle ORM, Vitest, Docker Compose.
- **Endereços locais:**
  - `$WEB` = `http://localhost:3000`
  - `$API` = `http://localhost:3000`

## 2. Comandos do Harness (Obrigatórios)

Execute sempre a partir da raiz do repositório:

| Ação | Comando | Descrição |
| --- | --- | --- |
| **Subir tudo** | `./scripts/up.sh` | Constrói e sobe os containers (`db` + `app`), aplica migrations, executa a seed idempotente e aguarda `/health` responder `200`. Funciona a partir de um clone limpo sem passos extras. |
| **Derrubar tudo** | `./scripts/down.sh` | Encerra e remove todos os containers e redes do projeto. Após rodar, nenhuma porta do produto responde e `docker ps` não lista containers do projeto. |
| **Rodar gates** | `./scripts/gates.sh` | Executa typecheck (`tsc --noEmit`), checagem de código e toda a suíte de testes automatizados (unitários, integração e concorrência) dentro de Docker contra o banco isolado `catraca_test`, sem poluir os dados da seed e sem exigir `npm install` no host. |

Aliases equivalentes (caso Node/npm esteja disponível): `npm run up`, `npm run down`, `npm run gates`.

## 3. Credenciais da Seed (Modo Padrão / Simulado)

A seed é idempotente e cria sempre:

- **Organizador A:** `org-a@catraca.local` / `OrgA1234!`
- **Organizador B:** `org-b@catraca.local` / `OrgB1234!`
- **Participante (seed):** `participante@catraca.local` / `Part1234!`
- **Chave de Parceiro (`X-Api-Key`):** `catraca-partner-dev-key-2026`

O modo padrão usa o **gateway de pagamento simulado** sem nenhuma chave externa real:
- Cartão de 16 dígitos final `0001`: aprovado em 2–5s
- Final `0002`: recusado em 2–5s
- Final `0003`: aprovado em 30–40s
- Final `0004`: recusado em 30–40s
- Qualquer outro final (com 16 dígitos): recusado em 2–5s

## 4. Mapa de Artefatos

| Artefato | Caminho |
| --- | --- |
| Constituição (Spec Kit) | `.specify/memory/constitution.md` |
| PRD completo (features, grafo, waves, R01–R13) | `docs/PRD.md` |
| Estado do projeto (memória entre sessões) | `project-state.json` |
| Feature `F01` (Fundação, Harness, Auth & Seed) | `specs/001-f01-foundation-auth/` |
| Feature `F02` (Gestão de Eventos do Organizador) | `specs/002-f02-organizer-events/` |
| Feature `F03` (Motor de Compras, Concorrência & Gateway) | `specs/003-f03-purchase-gateway/` |
| Feature `F04` (Vitrine Pública & Meus Ingressos) | `specs/004-f04-storefront-tickets/` |
| Feature `F05` (API de Parceiros — contrato fixo) | `specs/005-f05-partner-api/` |
| Feature `F06` (Check-in & Painel do Organizador) | `specs/006-f06-checkin-dashboard/` |
| Feature `F07` (Cancelamento Irreversível & Estorno) | `specs/007-f07-event-cancellation/` |
| Agente Avaliador Independente | `.agents/agents/evaluator.md` |
| Skills do GitHub Spec Kit | `.agents/skills/speckit-*/SKILL.md` |

Cada pasta de feature em `specs/<id>-<slug>/` contém:
- `spec.md` — especificação funcional e decisões técnicas
- `plan.md` — plano de implementação em etapas
- `tasks.md` — checklist executável de tarefas
- `contract.md` — contrato verificável mapeado aos critérios do PRD
- `reports/eval-NNN.md` — relatórios imutáveis de avaliação independente

## 5. Regras de Trabalho para Agentes

1. **Contexto limpo por papel:** implementadores lêem `AGENTS.md`, `project-state.json` e a pasta da feature atual.
2. **Avaliação independente obrigatória:** quem implementou a feature **não** pode avaliá-la. O avaliador roda em sessão/subagent com contexto vazio contra `contract.md` e grava um arquivo **novo** em `reports/eval-NNN.md`.
3. **Relatórios são imutáveis:** **nunca** edite um relatório de avaliação depois de commitado. Após correções, crie o próximo sequencial (`eval-002.md`, etc.).
4. **Concorrência (R07) e Cancelamento (R11):** respeite estritamente o lock pessimista `SELECT ... FOR UPDATE` no evento durante a compra e a guarda condicional `WHERE id = $1 AND status = 'pending'` na resposta do gateway.
5. **Mensagens literais obrigatórias:** preserve exatamente a grafia de:
   - Status na UI: `pendente`, `confirmado`, `recusado`, `cancelado`, `estornado`
   - Status na API: `pending`, `confirmed`, `declined`, `cancelled`, `refunded`
   - Esgotado na UI: `Ingressos esgotados` | na API: `{"error":"sold_out"}` (`409`)
   - Check-in (R10, ordem exata):
     1. `Ingresso inválido para este evento`
     2. `Evento cancelado`
     3. `Ingresso não confirmado`
     4. `Ingresso já utilizado`
     5. `Entrada liberada`
   - Erros da API de parceiros: `401 {"error":"unauthorized"}`, `422 {"error":"invalid_request"}`, `404 {"error":"event_not_available"}`, `409 {"error":"sold_out"}`, `404 {"error":"ticket_not_found"}`.
6. **Antes de concluir uma feature:** rode `./scripts/gates.sh` e confirme que todos os testes passam.
