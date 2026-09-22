# InvestoGenie Deployment Targets

InvestoGenie supports local development/fallback and AWS production from the same Git revision.

| Target | Command | Configuration | Database | Purpose |
| --- | --- | --- | --- | --- |
| macOS local | `Launch InvestoGenie.command` or `npm run dev` | `.env.local` | Mac-local PostgreSQL | Development, manual research, local testing |
| macOS production rehearsal | `npm run build && npm start` | `.env.local` | Mac-local PostgreSQL | Verify the production build locally |
| macOS personal server | `npm run service:install` | `.env.local` | Mac-local PostgreSQL | Always-on private access through Tailscale |
| AWS Lightsail | systemd `investogenie.service` | `/etc/investogenie/investogenie.env` | VM-local PostgreSQL | Active always-on production and scheduled ingestion |
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

Application code is shared; environment files, databases, service management,
and operational limits remain target-specific.
