# Operations module

- Owns ingestion schedules, provider workers, backfills, data health, schema migrations, backups and deployment.
- Production is a two-vCPU host, so scheduled Python work and request rendering compete for the
  same CPUs. A recurring job that cannot finish inside its own cap does not merely fail: it
  restarts and starves page renders, whose engine batches are then killed in turn. On 17 Nov
  2026 this made `/terminal/in/strong-swing` unrenderable through the session, seen as nginx 499s
  and `ERR_CONNECTION_ABORTED` in the browser, with no crash, restart or OOM to show for it.
  When adding or retuning a recurring job, check its interval exceeds its real runtime.
- Request-path engine batches are capped by `PYTHON_ENGINE_TIMEOUT_MS` (default 90s, raised from
  30s). nginx allows 300s upstream, so the cap, not the proxy, is the binding limit.
- Paths: `scripts/`, `pipelines/`, `workers/`, `deploy/`, `db/migrations/`.
- Web entries: `/data/health`, `/admin/sync`; shared controls require admin authorization.
- Never print or commit secrets. Production uses external environment configuration.
- Data failures must remain distinguishable from strategy risk decisions.
- Mobile target: secure responsive-web deep links initially, not bundled admin tooling.
- Focused checks depend on the changed job/provider plus schema verification and service health.
