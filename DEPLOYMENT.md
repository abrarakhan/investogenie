# InvestoGenie Deployment Targets

InvestoGenie supports two first-class targets from the same Git revision.

| Target | Command | Configuration | Database | Purpose |
| --- | --- | --- | --- | --- |
| macOS local | `Launch InvestoGenie.command` or `npm run dev` | `.env.local` | Mac-local PostgreSQL | Development, manual research, local testing |
| macOS production rehearsal | `npm run build && npm start` | `.env.local` | Mac-local PostgreSQL | Verify the production build locally |
| Oracle Cloud | systemd `investogenie.service` | `/etc/investogenie/investogenie.env` | VM-local PostgreSQL | Always-on production and scheduled ingestion |

Detailed instructions:

- Local: [`deploy/local/README.md`](deploy/local/README.md)
- Oracle: [`deploy/oracle/README.md`](deploy/oracle/README.md)

## Configuration isolation

The repository contains examples only. Real secrets remain outside Git:

- Local secrets: `.env.local`
- Oracle secrets: `/etc/investogenie/investogenie.env`

`CREDENTIAL_ENCRYPTION_KEY` is part of the data-encryption boundary. Preserve
it when transferring a database that contains encrypted API or SMTP credentials.
Local and Oracle may use different session/cron secrets, but restored encrypted
credentials require the original credential-encryption key.

## Promotion workflow

1. Develop and test locally.
2. Run `npm test`, `npm run lint`, `npm run build`, and
   `npm run deploy:check:local`.
3. Commit and push the tested revision.
4. On Oracle, run `sudo deploy/oracle/deploy-release.sh`.
5. Run `npm run deploy:check:oracle` with the production environment loaded.
6. Verify HTTPS, Data Health, scheduler logs, and a fresh PostgreSQL backup.

Application code is shared; environment files, databases, service management,
and operational limits remain target-specific.
