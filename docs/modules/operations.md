# Operations module

- Owns ingestion schedules, provider workers, backfills, data health, schema migrations, backups and deployment.
- Paths: `scripts/`, `pipelines/`, `workers/`, `deploy/`, `db/migrations/`.
- Web entries: `/data/health`, `/admin/sync`; shared controls require admin authorization.
- Never print or commit secrets. Production uses external environment configuration.
- Data failures must remain distinguishable from strategy risk decisions.
- Mobile target: secure responsive-web deep links initially, not bundled admin tooling.
- Focused checks depend on the changed job/provider plus schema verification and service health.
