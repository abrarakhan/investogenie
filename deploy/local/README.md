# Local macOS deployment

Local mode is the development and data-workstation deployment. It uses the
Mac's PostgreSQL instance and `.env.local`; it does not read Oracle production
secrets or connect to the cloud database.

## First setup

Install Node.js 20+, Python 3, and PostgreSQL. Then:

```bash
cd /Users/abrarahmedkhan/Projects/investogenie
cp .env.example .env.local
openssl rand -hex 32
```

Put separate generated values into `SESSION_SECRET`, `CRON_SECRET`, and
`CREDENTIAL_ENCRYPTION_KEY`. Preserve the credential key when restoring an
existing database containing encrypted credentials.

Create/start PostgreSQL and install dependencies:

```bash
brew services start postgresql@16
createdb investogenie 2>/dev/null || true
npm install
python3 -m venv .venv
.venv/bin/pip install -r pipelines/requirements.txt
npm run deploy:check:local
```

For an existing machine, use the one-click `Launch InvestoGenie.command` file.
It starts PostgreSQL when possible, prepares dependencies, launches the app and
opens `http://localhost:3000`.

## Local run modes

Development with hot reload and all background schedules:

```bash
npm run dev
```

Production-mode rehearsal on the Mac:

```bash
npm run build
npm start
```

Both modes load `.env.local`. Stop with `Ctrl+C`.

## Relationship to Oracle

- Local and Oracle use separate PostgreSQL databases.
- Never expose Oracle port 5432 or point routine local development directly at it.
- Move data using `pg_dump`/`pg_restore` over SSH when a snapshot is needed.
- Do not run local and Oracle schedulers against the same database.
- Once Oracle is production, treat its database as authoritative and take a
  backup before replacing it with a local snapshot.
