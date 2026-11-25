# Feature Specification: F04 — Vitrine Pública e Área do Participante ("Meus ingressos")

**Feature Branch**: `004-f04-storefront-tickets`

**Created**: 2026-11-25

**Status**: Draft

**Wave**: Wave 4 (Paralela com `F05` e `F06`)

**Consumes**: `F01` (sessão/autenticação de participante, layout SSR), `F02` (eventos publicados e não cancelados), `F03` (`purchaseTicket`, `getEventSeatMetrics`, gateway assíncrono)

**Input**: PRD `docs/PRD.md` — Feature `F04`, regras `R02`, `R05`, `R06`, `R07`, `R08`, `R09` e critérios `F04-AC1`..`F04-AC4`, `CF-04`..`CF-06`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Vitrine pública de eventos publicados (Priority: P1)

Como visitante (deslogado) ou usuário autenticado, quero acessar a vitrine pública em `/` para visualizar apenas os eventos publicados e não cancelados, com nome, data/hora, local, preço em reais e quantidade de vagas disponíveis.

**Why this priority**: É a porta de entrada pública do produto (`$WEB`) e pré-requisito para a descoberta e compra de ingressos.

**Independent Test**: Criar um evento em rascunho (`draft`) e outro publicado (`published`) via `F02`, acessar `GET /` sem cookies de sessão e confirmar que apenas o evento publicado aparece com nome, data/hora formatada, local, preço em `R$` e vagas disponíveis corretas.

**Acceptance Scenarios**:

1. **Given** existe um evento `draft` e um evento `published` no banco, **When** um visitante não autenticado acessa `GET /`, **Then** a resposta retorna `200 OK` exibindo apenas o evento `published` com nome, data/hora formatada, local, preço em `R$` e vagas disponíveis; o evento `draft` não aparece no HTML.
2. **Given** um evento `published` possui `availableSeats > 0`, **When** um visitante deslogado acessa `GET /`, **Then** o cartão do evento exibe um convite/link para entrar ou criar conta de participante para comprar.
3. **Given** um evento `published` possui `availableSeats === 0` (por ingressos `pending` e/ou `confirmed`), **When** qualquer usuário acessa `GET /`, **Then** a vitrine exibe literalmente o texto `Ingressos esgotados` para esse evento e não exibe botão de compra ativo.
4. **Given** um evento foi publicado em `F02`, **When** a vitrine `GET /` é recarregada, **Then** o evento passa a aparecer imediatamente com os dados atualizados.

---

### User Story 2 - Compra de ingresso na vitrine por participante autenticado (Priority: P1)

Como participante autenticado, quero comprar 1 ingresso em um evento publicado diretamente na vitrine informando um número de cartão de 16 dígitos, recebendo resposta imediata com o ingresso em status `pendente` enquanto o gateway processa de forma assíncrona.

**Why this priority**: Conecta a interface do comprador ao motor transacional concorrente de `F03`, entregando o fluxo central de venda direta do Catraca.

**Independent Test**: Autenticar como participante (`participante@catraca.local`), submeter `POST /events/:eventId/purchase` com cartão `4111111111110001`, verificar resposta imediata (sem bloquear esperando os 2–5s do gateway), redução imediata de `availableSeats` e redirecionamento para `/my-tickets` exibindo o ingresso como `pendente`.

**Acceptance Scenarios**:

1. **Given** um participante autenticado visualiza um evento `published` com vagas disponíveis em `GET /`, **When** submete `POST /events/:eventId/purchase` com `cardNumber` de 16 dígitos válido (ex.: `4111111111110001`), **Then** o servidor chama `purchaseTicket` com `channel: 'storefront'`, cria o ingresso `pending` vinculando `userId` e `buyerEmail` do participante, responde imediatamente com redirecionamento para `/my-tickets` e reduz `availableSeats` em 1.
2. **Given** um evento está esgotado (`availableSeats === 0`, inclusive por ingressos `pending`), **When** um participante submete `POST /events/:eventId/purchase` (ex.: em corrida de acesso simultâneo), **Then** o sistema não cria ingresso e exibe literalmente a mensagem `Ingressos esgotados`.
3. **Given** um visitante não autenticado ou um organizador tenta enviar `POST /events/:eventId/purchase`, **When** a requisição chega ao servidor, **Then** o middleware `requireParticipant` bloqueia a operação (redirecionamento para `/login` ou `403`) sem criar ingresso.
4. **Given** um participante envia cartão inválido (menos/mais de 16 dígitos ou não numérico) em `POST /events/:eventId/purchase`, **When** o servidor valida a entrada, **Then** nenhum ingresso é criado e a página retorna feedback de erro claro para o usuário.

---

### User Story 3 - Acompanhamento em "Meus ingressos" (Priority: P1)

Como participante autenticado, quero acessar a página "Meus ingressos" (`/my-tickets`) para visualizar todos os ingressos que comprei, com nome do evento, status em português e código único alfanumérico, acompanhando a evolução do pagamento ao recarregar a página.

**Why this priority**: Garante rastreabilidade do pagamento assíncrono (`R08`) e entrega o código único necessário para o check-in (`R09`).

**Independent Test**: Comprar ingressos com cartões `0001` e `0002`, acessar `GET /my-tickets` imediatamente (`pendente`) e novamente após 5s, validando a transição para `confirmado` (para `0001`) e `recusado` (para `0002`, com vaga liberada na vitrine) e a exibição do código único de cada ingresso.

**Acceptance Scenarios**:

1. **Given** um participante comprou um ingresso com cartão final `0001`, **When** acessa `GET /my-tickets` imediatamente, **Then** vê o nome do evento, o status literal `pendente` e o código único do ingresso.
2. **Given** passaram-se até 5 segundos após compra com cartão final `0001`, **When** o participante recarrega `GET /my-tickets`, **Then** o status exibido é literalmente `confirmado` e o mesmo código único permanece visível.
3. **Given** um participante comprou com cartão final `0002` e o gateway recusou após 2–5s, **When** recarrega `GET /my-tickets` e `GET /`, **Then** o ingresso exibe status literal `recusado` e a vaga correspondente volta a ficar disponível na vitrine.
4. **Given** existem ingressos comprados por dois participantes diferentes, **When** o Participante 1 acessa `GET /my-tickets`, **Then** ele visualiza exclusivamente os próprios ingressos (`user_id = seu id`), nunca os do Participante 2.
5. **Given** existem ingressos nos cinco estados possíveis do domínio, **When** renderizados em `GET /my-tickets`, **Then** os rótulos exibidos são exatamente: `pendente` (`pending`), `confirmado` (`confirmed`), `recusado` (`declined`), `cancelado` (`cancelled`) e `estornado` (`refunded`).

---

### Edge Cases

- **Corrida de último ingresso na vitrine**: dois participantes abrem `GET /` quando resta 1 vaga e submetem `POST /events/:eventId/purchase` ao mesmo tempo. O primeiro obtém `pending` e redireciona para `/my-tickets`; o segundo recebe erro `sold_out` de `F03` e vê exatamente `Ingressos esgotados`.
- **Evento em rascunho ou cancelado enviado por POST direto**: se um participante forjar `POST /events/:eventId/purchase` para um `eventId` inexistente, `draft` ou `cancelled`, o sistema rejeita sem criar ingresso e exibe mensagem de evento indisponível.
- **Vaga bloqueada por ingresso `pending` lento (`0003`/`0004`)**: em evento de lotação 1, logo após compra com cartão `0003`, a vitrine exibe `Ingressos esgotados` mesmo antes da confirmação; se a compra for com `0004` e recusada, a vaga volta a aparecer disponível.
- **Participante sem ingressos**: `GET /my-tickets` retorna `200 OK` com estado vazio amigável e link para a vitrine `/`.
- **Escape HTML (XSS)**: nomes e locais de eventos contendo caracteres especiais (`<`, `>`, `&`, `"`) devem ser escapados na renderização SSR.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001** *(R02)*: `GET /` MUST ser acessível a visitantes não autenticados e usuários autenticados, listando exclusivamente eventos com `status = 'published'` (nunca `draft` nem `cancelled`), ordenados por `starts_at` ascendente.
- **FR-002** *(R05)*: Para cada evento na vitrine, o sistema MUST calcular `availableSeats` via `getEventSeatMetrics(eventId)` de `F03` (`max(0, capacity - (pending + confirmed))`) e exibir nome, data/hora formatada, local, preço formatado em reais (ex.: `R$ 100,00`) e vagas disponíveis.
- **FR-003** *(R07)*: Quando `availableSeats === 0` em um evento na vitrine, o HTML MUST exibir literalmente o texto `Ingressos esgotados` no card do evento no lugar da ação de compra.
- **FR-004** *(R06)*: Para participante autenticado em evento com `availableSeats > 0`, a vitrine MUST apresentar formulário HTML (`POST /events/:eventId/purchase`) solicitando o número do cartão de 16 dígitos (`cardNumber`) para compra de exatamente 1 ingresso por submissão.
- **FR-005** *(R06, R07)*: `POST /events/:eventId/purchase` MUST exigir autenticação de participante (`requireParticipant`), invocar `purchaseTicket` de `F03` com `channel: 'storefront'`, `userId`, `buyerEmail` da sessão e `cardNumber` informado, responder imediatamente sem aguardar o gateway e redirecionar (`303 See Other`) para `/my-tickets` em caso de sucesso.
- **FR-006** *(R07)*: Quando `purchaseTicket` retornar erro `sold_out` em `POST /events/:eventId/purchase`, o sistema MUST exibir literalmente `Ingressos esgotados` (renderizando a vitrine com alerta de erro ou redirecionando com flash/query tratado na vitrine).
- **FR-007** *(R08, R09)*: `GET /my-tickets` MUST exigir autenticação de participante (`requireParticipant`) e listar exclusivamente os ingressos cujo `user_id` pertence ao participante autenticado, exibindo nome do evento, código único (`code`) e status em português usando o mapeamento literal obrigatório: `pending` → `pendente`, `confirmed` → `confirmado`, `declined` → `recusado`, `cancelled` → `cancelado`, `refunded` → `estornado`.
- **FR-008**: A navegação do layout SSR MUST disponibilizar links claros para Vitrine (`/`), Meus ingressos (`/my-tickets`, quando participante logado), Login/Cadastro (quando visitante) e Logout (quando autenticado).

### Key Entities

- **Event (Vitrine)**: Projeção somente leitura de `events` filtrada por `status = 'published'`, enriquecida com `availableSeats` vindo de `F03`.
- **Ticket (Meus ingressos)**: Projeção de `tickets` filtrada por `user_id = currentUser.id` combinada com `events.name`, exibindo `code`, `status` (traduzido para português), `price_cents` e data de criação.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% dos eventos exibidos em `GET /` possuem `status = 'published'`; nenhum evento `draft` ou `cancelled` aparece na vitrine.
- **SC-002**: `POST /events/:eventId/purchase` responde em menos de 1 segundo (sem aguardar o atraso de 2–5s ou 30–40s do gateway simulado) e já contabiliza a vaga ocupada.
- **SC-003**: Em evento com `availableSeats === 0` (por ingressos `pending` ou `confirmed`), tanto a renderização de `GET /` quanto uma tentativa direta em `POST /events/:eventId/purchase` apresentam literalmente a string `Ingressos esgotados`.
- **SC-004**: Em `GET /my-tickets`, um ingresso comprado com cartão `0001` nasce como `pendente` e exibe `confirmado` ao recarregar em até 5 segundos, exibindo o código único alfanumérico e isolando estritamente os ingressos por participante.

## Assumptions

- O cadastro, login e logout de participantes (`F01`), a criação e publicação de eventos (`F02`) e o motor transacional `purchaseTicket` + `getEventSeatMetrics` + gateway simulado (`F03`) já estão implementados e disponíveis na branch base (`main`).
- Não há atualização via WebSockets/SSE; recarregar `GET /my-tickets` ou `GET /` é o mecanismo previsto pelo PRD para observar mudanças assíncronas de status.
- O formato monetário segue o padrão brasileiro (`R$ 100,00`) baseado em `price_cents` inteiro, e o formato de data/hora usa padrão legível em português (`dd/MM/yyyy HH:mm`, fuso `-03:00`).
