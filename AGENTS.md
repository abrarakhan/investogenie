<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Repository guide

Reviewed 25 October 2026 against main revision `42eea8f`.

- Read `README.md` and `ARCHITECTURE.md` for routes, data flow and calculation boundaries.
- Web routes/actions are in `app/`; analytics are in `lib/analytics/`; Python jobs are in `pipelines/` and `workers/`.
- Keep financial calculations on the server. Mobile consumes `/api/v1/mobile/*`.
- Preserve server-held execution-plan validation, per-user ownership and pending-fill transaction checks when changing ledger flows.
- Match documentation to `package.json`, actual route files and deployment scripts. Repository review alone cannot establish deployed revision, live data counts or successful runtime checks.
- Relevant checks are `npm test`, `npm run lint`, `npm run build`; mobile has `typecheck` and `validate:release` scripts.
