# InvestoGenie Deployment Targets

_Source reviewed 25 October 2026 against main revision `42eea8f`; live hosts were not inspected._

InvestoGenie supports local development/fallback and AWS production from the same Git revision.

| Target | Command | Configuration | Database | Purpose |
| --- | --- | --- | --- | --- |
| macOS local | `Launch InvestoGenie.command` or `npm run dev` | `.env.local` | Mac-local PostgreSQL | Development, manual research, local testing |
| macOS production rehearsal | `npm run build && npm start` | `.env.local` | Mac-local PostgreSQL | Verify the production build locally |
| macOS personal server | `npm run service:install` | `.env.local` | Mac-local PostgreSQL | Always-on private access through Tailscale |
| AWS Lightsail | systemd `investogenie.service` | `/etc/investogenie/investogenie.env` | VM-local PostgreSQL | Packaged production web service and scheduled ingestion |
| Oracle-compatible Ubuntu | systemd `investogenie.service` | `/etc/investogenie/investogenie.env` | VM-local PostgreSQL | Alternate deployment package |

Detailed instructions:

- Local: [`deploy/local/README.md`](deploy/local/README.md)
- AWS/Ubuntu production package: [`deploy/oracle/README.md`](deploy/oracle/README.md)

## Configuration isolation

The repository contains examples only. Real secrets remain outside Git:

- Local secrets: `.env.local`
- AWS/Ubuntu secrets: `/etc/investogenie/investogenie.env`

`CREDENTIAL_ENCRYPTION_KEY` is part of the data-encryption boundary. Preserve
it when transferring a database that contains encrypted API or SMTP credentials.
Local and Oracle may use different session/cron secrets, but restored encrypted
credentials require the original credential-encryption key.

## Promotion workflow

1. Develop and test locally.
2. Run `npm test`, `npm run lint`, `npm run build`, and
   `npm run deploy:check:local`.
3. Commit and push the tested revision.
4. On AWS/Ubuntu, run `sudo deploy/oracle/deploy-release.sh`.
5. Run `npm run deploy:check:oracle` with the production environment loaded (the command name is
   retained for compatibility).
6. Verify HTTPS, Data Health, scheduler logs, and a fresh PostgreSQL backup.

The release script installs locked build dependencies, rejects high-severity production dependency
findings, builds the app, applies replay-safe migrations from `0033_breeze_credentials.sql` through `0057_gmail_connection_health.sql`,
verifies required broker, news, mobile, allocation, ML, corporate-calendar, Armed/pending/execution-plan relations and calendar/Gmail columns, prunes development
dependencies, and restarts both application services.

Application code is shared; environment files, databases, service management,
and operational limits remain target-specific.

## Migration and release limits

The release script assumes migrations 0001–0032 already exist. For a new database, apply all migration files in filename order before release; `npm run dev` does not provide a general migration runner.

The script performs `npm ci --include=dev`, a production dependency audit, build and pruning before Python dependency installation and migrations. It does not run `npm test` or lint; run those before promotion. Check that the selected Node runtime supports the flags used by the package scripts.

A successful source review cannot establish which revision or migrations are installed. Verify the actual host, database and services after deployment.
