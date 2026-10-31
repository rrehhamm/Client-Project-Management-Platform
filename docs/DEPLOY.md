# Deploying to one Linux VM

This guide puts the platform on a single Linux server with Docker Compose. Caddy gets HTTPS certificates automatically. The steps were rehearsed end to end on a local machine (see [Rehearsal](#rehearsal)); the smoke test on a real server is still pending (release checklist step 7, D-29).

**What runs:** Caddy (the only thing reachable from the internet, ports 80/443), the API, PostgreSQL 16, MinIO (file storage) and ClamAV (virus scanning). Everything is defined in [`docker-compose.prod.yml`](../docker-compose.prod.yml).

## 1. What you need

| Item | Notes |
|---|---|
| A Linux VM | Ubuntu 24.04 LTS or similar. **4 GB RAM minimum** (ClamAV alone uses 1–1.5 GB), 2 vCPU, disk for files plus backups (the default quota is 50 GB, OD-07). |
| Two DNS names | For example `app.example.com` (the app) and `files.example.com` (signed download links). Both need A/AAAA records pointing at the VM. |
| An SMTP account | Any provider (Postmark, SES, Mailgun, your own server). Invitations, password resets and notifications are sent through it. |
| Open ports | 80 and 443 (TCP), 443 (UDP for HTTP/3). Keep SSH limited to your IPs. |

## 2. Prepare the server

```sh
# Docker Engine and the Compose plugin (official repository)
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"   # log out and in again

# A firewall that allows only SSH and the web
sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443 && sudo ufw enable
```

## 3. Get the code and settings

```sh
git clone https://github.com/rrehhamm/Client-Project-Management-Platform.git cpm
cd cpm
git checkout v0.4.0-mvp            # the release you are installing
cp deploy/.env.production.example .env.production
chmod 600 .env.production
```

Fill in every value in `.env.production`:

- `APP_DOMAIN`, `FILES_DOMAIN`, `ACME_EMAIL`.
- `POSTGRES_PASSWORD`, `MINIO_ROOT_PASSWORD`, and the three secrets `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `CSRF_SECRET`. Generate each with `openssl rand -base64 48`; all must be different.
- The `SMTP_*` values and `MAIL_FROM` from your email provider.

The API refuses to start in production if a secret is a placeholder, if the three secrets match, if `BCRYPT_COST` is below 12, if a scanner other than ClamAV is set, or if `DEV_MARK_FILES_CLEAN` is on. That is intended.

## 4. Start

```sh
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.production ps
```

On every start the API applies pending database migrations and creates the storage bucket if needed. Caddy requests certificates as soon as DNS points at the server. ClamAV needs a few minutes on its first start to load its signature database; until then, new uploads show **Scanning** and cannot be downloaded (D-30).

Check it:

```sh
curl -I http://app.example.com          # 308 redirect to https
curl https://app.example.com/api/v1/health   # {"status":"ok"}
```

## 5. Create the first Owner

Run this once, on the empty database:

```sh
docker compose -f docker-compose.prod.yml --env-file .env.production exec api \
  node scripts/create-owner.js --email you@agency.com --name "Your Name" \
  --workspace "Agency name" --timezone Asia/Amman --currency JOD
```

It creates the workspace and the Owner and prints a one-time link (valid 7 days) where the Owner chooses a password; it also emails the link. No password is ever typed on the command line. It refuses to run if the database already has users. Everyone else is invited from **Team** in the app.

Then sign in and set the workspace name, logo, time zone, week start and date format under **Settings**.

## 6. Backups

[`deploy/backup.sh`](../deploy/backup.sh) writes a PostgreSQL dump and a copy of every stored file to `backups/<UTC time>/`, with checksums, and keeps 14 days. Run it nightly:

```sh
crontab -e
# 02:30 UTC every night
30 2 * * * cd /home/USER/cpm && BACKUP_DIR=/home/USER/cpm/backups ./deploy/backup.sh >> backups/backup.log 2>&1
```

**Copy the backups off the server** (another region or provider). Disk-level snapshots of the VM are a good extra layer, not a replacement. For example:

```sh
rsync -a --delete backups/ backup-host:/srv/cpm-backups/
```

To restore (this replaces all current data; the app is offline while it runs):

```sh
./deploy/restore.sh backups/20261101T023000Z
```

It checks the checksums, asks you to type `RESTORE`, restores the database and the files, and starts the app again. Try a restore on a scratch VM every few months, so you know it works.

## 7. Updating to a new release

```sh
./deploy/backup.sh
git fetch --tags && git checkout v0.X.Y
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

Migrations run automatically when the API starts. Read the release notes first: some releases need extra steps.

## 8. Day-to-day

| Task | Command |
|---|---|
| Logs | `docker compose -f docker-compose.prod.yml --env-file .env.production logs -f api` |
| Restart the app | `... restart api web` |
| Database shell | `... exec postgres psql -U cpm -d cpm` |
| Storage use | **Settings → File storage** in the app |

Health: `GET /api/v1/health` (process up) and `GET /api/v1/health/ready` (database, storage and email reachable). Point an uptime monitor at both.

## Security notes

- Only Caddy publishes ports; the database, MinIO and ClamAV are reachable only inside the Docker network.
- HTTPS everywhere with HSTS, plus CSP, `X-Frame-Options: DENY` and `nosniff` (NFR-SEC-01/05). Plain HTTP gets a permanent redirect (Caddy sends 308, the method-preserving form of 301).
- File downloads use signed links valid for 10 minutes on `FILES_DOMAIN` (FR-FILE-04). The storage itself is private: unsigned or altered links get 403.
- Keep `.env.production` readable only by the deploying user (`chmod 600`) and out of git (it is ignored).

## Rehearsal

On 2026-11-01 the whole stack was run on a development machine with `APP_DOMAIN=localhost` and `FILES_DOMAIN=files.localhost` (Caddy's local certificates):

1. Both images built; the API started in production mode and passed the configuration checks.
2. HTTP redirected to HTTPS; HSTS, CSP, `X-Frame-Options` and `nosniff` were present.
3. `create-owner.js` created the Owner; the set-password link worked; a second run was refused.
4. A PDF uploaded over HTTPS was scanned by the real ClamAV (Clean) and downloaded through a signed link on the files host. A tampered link and an unsigned request both got 403.
5. `backup.sh` ran; every volume was destroyed; `restore.sh` brought back the database and the file. The Owner signed in again and the file downloaded with the same size.

Not yet done: the smoke test on the real server (step 7 of the release checklist), after the host, domain and email provider are chosen.
