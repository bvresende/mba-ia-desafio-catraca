# Catraca Constitution

## Core Principles

### I. Spec-Driven & Contract-First Delivery
Every feature (`F01`–`F07`) MUST be grounded in `docs/PRD.md` and have its own directory under `specs/<id>-<slug>/` containing `spec.md`, `plan.md`, `tasks.md`, and `contract.md` before implementation begins. Every PRD acceptance criterion (feature-level and cross-feature) MUST map to at least one verifiable item in a contract.

### II. Strict Rule Fidelity (R01–R13 & Fixed Partner API)
Domain rules `R01` through `R13`, ticket statuses (`pending`, `confirmed`, `declined`, `cancelled`, `refunded`), `checkedIn` independence, simulated payment gateway card endings (`0001`–`0004` + fallback), and the exact Partner API HTTP status codes, validation order (`401` → `422` → `404` → `409`), and JSON payloads are NON-NEGOTIABLE.

### III. Concurrency & State Safety by Construction
- **R07 (Seat Capacity under Concurrency):** Every purchase MUST execute inside a PostgreSQL transaction acquiring a row-level pessimistic lock (`SELECT ... FROM events WHERE id = $1 FOR UPDATE`) before validating event availability, counting occupied seats (`pending` + `confirmed`), and inserting the new `pending` ticket with `price_cents` frozen from the event at purchase time.
- **R11 (Cancellation Irreversibility & Late Gateway Protection):** Event cancellation transitions `confirmed` → `refunded` and `pending` → `cancelled` atomically. Gateway callback updates MUST be guarded (`WHERE id = $1 AND status = 'pending'` and checking the event is not cancelled) so late gateway responses (30–40s) NEVER alter cancelled/refunded tickets.

### IV. Minimal, Self-Contained Harness
The evaluator environment only guarantees Linux/macOS, Docker, Git, and Node.js LTS. Therefore:
- `./scripts/up.sh` MUST build and start the full stack via Docker Compose, run migrations, run the idempotent seed, and block until healthy on `http://localhost:3000` with zero prior steps from a clean clone.
- `./scripts/down.sh` MUST stop and remove all project containers so zero ports remain bound and `docker ps` shows no project containers.
- `./scripts/gates.sh` MUST run typechecking, linting/checks, and automated tests (including concurrency tests) cleanly inside Docker against an isolated test database (`catraca_test`), passing on `main` without requiring host `npm install` or mutating seeded runtime data.

### V. Independent Evaluation & Immutable Reports
Whoever implements a feature NEVER evaluates it. Each feature is evaluated against its `contract.md` by an independent agent in a fresh, empty context. Every evaluation run creates a NEW immutable report (`specs/<feature>/reports/eval-NNN.md`) containing date, evaluated commit hash, tool and model used, and per-item verdicts with concrete evidence. Committed reports MUST NEVER be modified afterward; fixes trigger a brand-new report (`eval-002.md`, etc.).

### VI. Simplicity & Server-Side Rendering
Prefer simple, readable, modular TypeScript without unnecessary abstractions. The web UI uses pure SSR HTML rendered by Fastify with clean CSS; no SPA bundler, no WebSockets, and no real payment keys are required.

## Technical Constraints

- **Runtime & Stack:** Node.js 24 LTS, TypeScript (strict), Fastify 5, PostgreSQL 16, Drizzle ORM, Vitest.
- **Single Public Endpoint:** Both `$WEB` and `$API` are served at `http://localhost:3000`.
- **Simulated Gateway Default Mode:** Default runtime strictly honors brief latencies (`0001`/`0002`/other: 2–5s; `0003`/`0004`: 30–40s). Automated tests may configure `GATEWAY_FAST_MIN_MS`, `GATEWAY_FAST_MAX_MS`, `GATEWAY_SLOW_MIN_MS`, `GATEWAY_SLOW_MAX_MS` to avoid waiting 40s in CI/gates, while `docker-compose.yml` uses the exact default delays.
- **Seed Idempotency:** Running the seed repeatedly MUST succeed without duplicating users or failing on unique constraints.

## Development Workflow & Quality Gates

1. Waves execute in topological order (`Wave 1` → `Wave 2` → `Wave 3` → `Wave 4 [parallel]` → `Wave 5`).
2. Wave 4 (`F04`, `F05`, `F06`) MUST be developed in parallel across isolated branches/worktrees and merged via GitHub PRs with overlapping commit timelines.
3. `project-state.json` MUST be updated after each feature completes evaluation and merge, reflecting true status and latest report path.
4. No feature is marked `done` until its latest immutable evaluation report approves 100% of contract items and `./scripts/gates.sh` passes.

## Governance

This constitution supersedes ad-hoc choices. All specs, plans, implementations, and independent evaluations MUST verify compliance with these principles and with `AGENTS.md`.

**Version**: 1.0.0 | **Ratified**: 2026-11-25 | **Last Amended**: 2026-11-25
