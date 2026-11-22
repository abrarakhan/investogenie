# Operations module

- Owns ingestion schedules, provider workers, backfills, data health, schema migrations, backups and deployment.
- Paths: `scripts/`, `pipelines/`, `workers/`, `deploy/`, `db/migrations/`.
- Web entries: `/data/health`, `/admin/sync`; shared controls require admin authorization.
- Never print or commit secrets. Production uses external environment configuration.
- Data failures must remain distinguishable from strategy risk decisions.
- US 10-Q/10-K statement values are sourced authoritatively from SEC EDGAR
  Company Facts by `pipelines/sec_edgar_fundamentals.py`. Yahoo fundamentals
  are supplemental/fallback only and cannot overwrite stored SEC statement rows.
- One-time operator catch-up: `npm run sync:us-fundamentals`; pass arguments
  after `--`, for example `-- --symbols AAPL,MSFT` or `-- --limit 500`.
- Mobile target: secure responsive-web deep links initially, not bundled admin tooling.
- Focused checks depend on the changed job/provider plus schema verification and service health.
