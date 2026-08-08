# InvestoGenie on Oracle Cloud Always Free

This deployment runs Next.js, PostgreSQL, Nginx, and the existing Node/Python
scheduler on one Ubuntu Ampere A1 VM. PostgreSQL and port 3000 remain private;
only SSH, HTTP, and HTTPS are exposed.

## 1. Create the OCI resources

Use the tenancy home region and create one `VM.Standard.A1.Flex` instance:

- Ubuntu 24.04 aarch64 image
- 2 OCPUs and 12 GB RAM
- 100 GB boot volume
- public subnet and public IPv4 address
- SSH key authentication

Reserve a public IP and assign it to the VM. This is required if a market-data
provider allowlists a fixed source IP. In the subnet security list, allow:

- TCP 22 from your own public IP/CIDR
- TCP 80 from `0.0.0.0/0`
- TCP 443 from `0.0.0.0/0`

Do not expose PostgreSQL 5432 or Next.js 3000.

## 2. Publish the application revision

The VM clones `https://github.com/abrarakhan/investogenie.git`. Commit and push
the exact revision to deploy before bootstrapping the VM. Never commit
`.env.local`, database dumps, CAS PDFs, API keys, or passwords.

## 3. Bootstrap Ubuntu

Copy this directory to the VM if the deployment files are not pushed yet, then:

```bash
ssh ubuntu@YOUR_RESERVED_IP
sudo DOMAIN=investogenie.example.com \
  REPO_URL=https://github.com/abrarakhan/investogenie.git \
  bash deploy/oracle/bootstrap-ubuntu.sh
```

The script stores generated database and application secrets in the root-owned
environment file. Edit it before starting the service:

```bash
sudoedit /etc/investogenie/investogenie.env
```

When restoring the local database, copy the exact local
`CREDENTIAL_ENCRYPTION_KEY`; otherwise existing encrypted SMTP/API credentials
cannot be decrypted. Set `NEXT_PUBLIC_APP_URL` to the final HTTPS URL.

## 4. Transfer the current database

On the Mac:

```bash
cd /Users/abrarahmedkhan/Projects/investogenie
pg_dump --format=custom --compress=6 --no-owner --no-acl \
  --file="$HOME/Desktop/investogenie.dump" investogenie
scp "$HOME/Desktop/investogenie.dump" ubuntu@YOUR_RESERVED_IP:/tmp/
```

On the VM, before the first application start:

```bash
sudo systemctl stop investogenie 2>/dev/null || true
sudo -u postgres dropdb --if-exists investogenie
sudo -u postgres createdb --owner=investogenie investogenie
sudo -u postgres pg_restore --no-owner --no-acl \
  --role=investogenie --dbname=investogenie /tmp/investogenie.dump
rm /tmp/investogenie.dump
```

The custom dump includes all existing migrations and market data.

## 5. Build, start, and enable HTTPS

```bash
sudo -u investogenie bash -lc \
  'set -a; source /etc/investogenie/investogenie.env; set +a; cd /opt/investogenie/app && npm run build'
sudo systemctl enable --now investogenie
sudo journalctl -u investogenie -f
```

Point the domain's `A` record at the reserved IP. Once DNS resolves:

```bash
sudo certbot --nginx -d investogenie.example.com
sudo sed -i 's|NEXT_PUBLIC_APP_URL=http:|NEXT_PUBLIC_APP_URL=https:|' \
  /etc/investogenie/investogenie.env
sudo systemctl restart investogenie
```

Verify:

```bash
curl -I https://investogenie.example.com/login
sudo systemctl status investogenie postgresql nginx
sudo journalctl -u investogenie --since '30 minutes ago' --no-pager
```

## 6. Releases and backups

Deploy a pushed `main` revision:

```bash
sudo bash /opt/investogenie/app/deploy/oracle/deploy-release.sh
```

Install the local PostgreSQL backup job:

```bash
sudo install -m 0755 /opt/investogenie/app/deploy/oracle/backup-postgres.sh \
  /usr/local/sbin/investogenie-backup
echo '20 2 * * * root /usr/local/sbin/investogenie-backup' | \
  sudo tee /etc/cron.d/investogenie-backup
```

The local seven-day rotation protects against bad deployments but not VM or
volume loss. Also schedule OCI block-volume backups or copy encrypted dumps to
off-instance storage.

## Operating notes

- The production service intentionally uses `npm start`, not `npm run dev`.
- The wrapper runs the existing startup, quote, OHLCV, fundamentals, macro,
  AMFI, backfill, and digest schedules in the same service.
- Conservative worker limits are set for a 2-OCPU VM. Raise them only after
  checking `top`, `free -h`, PostgreSQL activity, and provider throttling.
- A reserved public IP is persistent and can be reassigned to a replacement VM.
- Keep port 5432 private. Use an SSH tunnel for database tools:

```bash
ssh -N -L 5433:127.0.0.1:5432 ubuntu@YOUR_RESERVED_IP
```

Then connect the desktop database tool to `127.0.0.1:5433`.
