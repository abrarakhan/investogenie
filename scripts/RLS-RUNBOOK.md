# PostgreSQL RLS runbook

Run commands from the InvestoGenie repository root. None of the audit commands print credentials.

## Local verification

```bash
export DATABASE_URL="postgresql://localhost:5432/investogenie"
npm run security:rls:audit
npm run security:rls:test
npm run security:rls:verify
```

`security:rls:audit` is read-only. `security:rls:test` creates two temporary test users and removes them. `security:rls:verify` checks the complete required production schema and policies.

To apply migration 0089 to a local database for the first time:

```bash
createuser --no-login --no-superuser --no-createdb --no-createrole --no-inherit investogenie_web 2>/dev/null || true
psql "$DATABASE_URL" -c "grant investogenie_web to current_user"
node scripts/apply-migration.mjs db/migrations/0089_tenant_row_level_security.sql
```

The local PostgreSQL account must be allowed to create roles. If it is not, run the `createuser` and `grant` commands as the local PostgreSQL administrator.

## Production pre-deploy check

Do not paste the production database URL into chat. SSH to the Lightsail host and run:

```bash
cd /opt/investogenie/app
set -a
source /etc/investogenie/investogenie.env
set +a
npm run security:rls:audit
npm run security:rls:verify
```

Normal deployment provisions the restricted role, applies migration 0089, and runs the schema verifier:

```bash
sudo bash /opt/investogenie/app/deploy/lightsail/deploy-release.sh
```

After deployment:

```bash
cd /opt/investogenie/app
set -a
source /etc/investogenie/investogenie.env
set +a
npm run security:rls:audit
sudo systemctl --no-pager --full status investogenie investogenie-breeze
sudo journalctl -u investogenie --since "15 minutes ago" --no-pager
```

## Expected result

The commands must exit `0` and report:

- `investogenie_web` is `NOLOGIN`, `NOSUPERUSER`, and `NOBYPASSRLS`;
- every direct `user_id` table except the two documented authentication bootstrap tables has RLS and a web-role policy;
- adaptive-allocation child rows and nullable/global forward-test rows have dedicated policies;
- the two-user tests deny cross-tenant reads and forged writes;
- production schema verification passes.

Do not deploy if any command exits non-zero.
