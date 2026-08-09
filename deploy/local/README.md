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

## Always-on personal service

Install InvestoGenie as a macOS login service when this Mac is the personal
server:

```bash
npm run service:install
```

The installer builds the production application and registers
`com.investogenie.app` with `launchd`. It starts after login, restarts after an
unexpected failure, binds the application to `127.0.0.1:3000`, and keeps all
existing quote, history, fundamentals, AMFI and email schedules in the main
application process. PostgreSQL remains managed by Homebrew.

Useful commands:

```bash
npm run service:logs
launchctl print gui/$(id -u)/com.investogenie.app
npm run service:uninstall
```

Run `npm run service:install` again after pulling application changes. This
rebuilds the production bundle and restarts the service. Logs are written to
the ignored `logs/` directory.

### Private access with Tailscale

For personal remote access, install Tailscale on this Mac and the devices that
should open InvestoGenie. Double-click `Install Tailscale.command` and approve
the macOS administrator/network-extension prompts. Once both devices are signed
in to the same tailnet, enable Tailscale Serve and open the private HTTPS URL it
reports:

```text
https://<mac-name>.<tailnet-name>.ts.net
```

No router port forwarding or public PostgreSQL port is required. Both the app
backend and PostgreSQL remain bound locally; Tailscale Serve is the private
HTTPS entry point. Tailscale does not provide a fixed public outbound IP for
broker API allowlisting.

The service uses `caffeinate` to prevent idle system sleep while the Mac is
connected to AC power. Closing a laptop lid, logging out, or losing power can
still stop scheduled updates.

### Local password recovery

Double-click `Reset InvestoGenie Password.command` on the host Mac to reset an
existing account. The helper requires physical access to the Mac, hides the new
password while it is entered, and updates only the password hash. It does not
delete or move portfolio data. No unauthenticated password-reset endpoint is
exposed over Tailscale.

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
