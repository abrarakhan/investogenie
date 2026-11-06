<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# InvestoGenie Agent Instructions

## Start Here

InvestoGenie is an actively deployed personal market terminal for Indian and US markets.

Do not rediscover the repository from scratch.

Use these references according to the task:

- `ARCHITECTURE.md` — system architecture, repository boundaries, calculation boundaries, database domains, deployment, and verification.
- `CAPABILITIES.md` — currently implemented product functionality.
- `STATUS.md` — current repository/product state, recent changes, known issues, and remaining work.

For a normal focused coding task, do NOT read all three files completely.

Start with `ARCHITECTURE.md` when architectural context is required.
Use `CAPABILITIES.md` only when existing product behavior/capability is relevant.
Use `STATUS.md` only when current progress, recent fixes, deployment state, or known issues are relevant.

Prefer current source code over documentation when they disagree.

## Context Efficiency

Keep exploration narrow.

- Read files directly related to the requested task first.
- Search for specific symbols/routes/functions instead of scanning directories broadly.
- Do not repeatedly read large documentation files during one task.
- Do not inspect `.claude/` unless explicitly requested.
- Do not inspect `.next/`.
- Do not broadly inspect `node_modules/`.
- For Next.js behavior, read only the relevant documentation under `node_modules/next/dist/docs/` as required by the Next.js rules above.
- Ignore historical AI context/conversation files unless explicitly requested.
- Use `git status` and targeted `git diff` to understand existing changes.

Expand exploration only when the current evidence is insufficient.

## Repository Boundaries

Use `ARCHITECTURE.md` as the authoritative repository map rather than rediscovering directory structure.

Important boundaries include:

- `app/` — Next.js pages, routes, server actions
- `components/` — web presentation
- `lib/analytics/` — signal, ranking, risk, and strategy calculations
- `lib/news/` — news ingestion/evidence/classification
- `lib/cas/` — CAS parsing/import
- `lib/funds/` — fund identity/mapping
- `lib/breeze/` — ICICI Breeze integration and reconciliation
- `pipelines/` — Python data synchronization
- `workers/` — broker/market workers
- `scripts/` — scheduler, sync, migration, deployment utilities
- `db/migrations/` — ordered PostgreSQL migrations
- `mobile/` — isolated React Native/Expo Android/iOS client
- `deploy/` — deployment tooling

## Architecture Rules

- Next.js/TypeScript serves the web application and server APIs.
- PostgreSQL is the system of record.
- Do not introduce Supabase.
- Trading calculations and ranking are server-authoritative.
- Mobile and web clients must consume server-produced trading results rather than independently reimplementing calculations.
- Preserve existing user scoping and parameterized-query patterns.
- Do not introduce a new framework, ORM, database, state-management system, or major dependency without explicit approval.

## Protected Financial Logic

Treat the calculation/ranking layer as high-impact code.

This includes the protected modules documented in `ARCHITECTURE.md`, especially:

- `lib/analytics/`
- `lib/strongSwing.ts`
- `lib/swingTradeProjection.ts`
- `lib/swingTradeLedger.ts`
- `lib/newsSwing.ts`

Unless the user explicitly requests a strategy/calculation change:

- do not change formulas;
- do not change thresholds;
- do not change candidate ranking;
- do not change entry/target/stop/trailing-stop logic;
- do not change confirmation/execution gates;
- do not allow News & AI to create a technical setup;
- do not silently alter risk or probability assumptions.

For intentional financial-logic changes, inspect the relevant implementation and tests first and add/update tests.

## Development Workflow

For each task:

1. Understand the requested outcome.
2. Check `git status`.
3. Inspect only relevant source and documentation.
4. For non-trivial work, form a short implementation plan.
5. Make the smallest coherent change.
6. Preserve existing architecture and conventions.
7. Add/update focused tests when behavior changes.
8. Run the cheapest relevant validation first.
9. Review the targeted diff.
10. Report what changed and what was actually validated.

Avoid unrelated refactoring.

## Validation

Choose validation proportional to the change.

Prefer:
1. targeted tests/typecheck for the affected area;
2. broader tests when shared behavior changes;
3. full validation for substantial/release-critical work.

Repository-wide verification gates are documented in `ARCHITECTURE.md`.

Do not automatically run every expensive validation command for trivial changes.

Never claim that a test, lint, build, deployment, migration, or command succeeded unless it was actually executed successfully.

## Database Safety

- Inspect relevant schema/migrations before database changes.
- Follow existing ordered migration conventions.
- Preserve `user_id` scoping for user-owned data.
- Use parameterized queries.
- Never destructively alter production data/schema without explicit approval.
- Never silently rewrite existing migrations that may already be deployed.

## Secrets and Security

Never expose, print, commit, or hard-code:

- API keys
- passwords
- tokens
- SMTP credentials
- broker credentials
- encryption keys
- production environment secrets

Preserve the project's existing credential encryption and authentication boundaries.

## Git Safety

Existing user work must be preserved.

- Never discard unrelated changes.
- Ignore unrelated `.claude` changes unless explicitly requested.
- Never use `git reset --hard`.
- Never use `git clean` to remove user files.
- Never force-push.
- Do not modify unrelated files merely to make the tree clean.
- Review relevant `git diff` before completion.
- Commit only when requested or when the user has explicitly delegated commits for the task.
- Push only when explicitly requested or clearly included in the user's requested workflow.

## Deployment Safety

AWS Lightsail is the active production environment.

Do not deploy merely because a coding task is complete.

Deploy only when explicitly requested or clearly included in the requested task.

Before production deployment:
- verify the intended revision;
- run appropriate release validation;
- apply migrations deliberately;
- preserve production secrets/data;
- restart only the intended services;
- inspect deployment/service health after restart.

Do not provision or switch to Oracle Cloud unless explicitly requested.

## Mobile Safety

`mobile/` is an isolated Android/iOS client.

Do not move server-authoritative trading calculations into the mobile application.

Use the existing versioned mobile API boundary.

Do not use Expo cloud build/update services unless explicitly requested. The chosen distribution path is local native Gradle/Xcode builds.

## Communication

Keep responses concise and execution-focused.

At completion report:
- what changed;
- important files changed;
- validation actually run;
- remaining risks or follow-up.

Do not provide long explanations of unchanged repository areas.
