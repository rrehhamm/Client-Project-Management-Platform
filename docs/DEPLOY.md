# Deploying to one Linux VM

This guide installs one copy of the platform for one company (one workspace per installation, D-39) on a single Linux server with Docker Compose. It does not depend on any particular provider. Names such as Hetzner, Brevo and Cloudflare R2 appear only as examples.

The steps were rehearsed end to end on a local machine (see [Rehearsal](#rehearsal)). The smoke test on a real server is still pending (release checklist step 7).

**What runs:**
- Caddy: the only part reachable from the internet (ports 80/443). It gets HTTPS certificates automatically.
- The API, PostgreSQL 16 and ClamAV (virus scanning).
- File storage: either MinIO on the same VM, or an external S3-compatible service.

Everything is defined in [`docker-compose.prod.yml`](../docker-compose.prod.yml).

## 1. What you need

| Item | Requirements | Example |
|---|---|---|
| A Linux VM | Any provider or your own hardware; Ubuntu 24.04 LTS or similar with Docker. **4 GB RAM minimum** (ClamAV alone uses 1–1.5 GB), 2 vCPU, disk for the database and backups (plus files, if stored on the VM). | Hetzner Cloud CX32 |
| A domain name | One DNS A/AAAA record for the app (`app.example.com`). With bundled storage, a second one for files (`files.example.com`). Both point at the VM. | any registrar or DNS host |
| An SMTP account | Any provider that offers SMTP with a username and password. Used for invitations, password resets and notifications. | Brevo |
| File storage | **Bundled** (MinIO on the VM, nothing extra to buy) or **external**: any S3-compatible service with a private bucket and an access key limited to it. | Cloudflare R2 |
| Open ports | 80 and 443 (TCP), 443 (UDP for HTTP/3). Limit SSH to your own IP addresses. | — |

## 2. Prepare the server

```sh
# Docker Engine and the Compose plugin
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"   # log out and in again

# A firewall that allows only SSH and the web
sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443 && sudo ufw enable
```

## 3. Get the code and settings

Copy the release you were given (a git checkout of tag `v0.4.0-mvp` or the release archive) to the server, then:

```sh
cd cpm
cp deploy/.env.production.example .env.production
chmod 600 .env.production
```

Fill in `.env.production`:

- **Domain:** `APP_DOMAIN` and `ACME_EMAIL` (certificate notices).
- **Database and secrets:** `POSTGRES_PASSWORD`, plus the three secrets `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` and `CSRF_SECRET`. Generate each with `openssl rand -base64 48`; all must be different.
- **Email:** the `SMTP_*` values and `MAIL_FROM` from your SMTP provider.
- **Storage:** choose one option.
  - **Bundled (Option A, the default):**
    - Set `FILES_DOMAIN` and `MINIO_ROOT_PASSWORD` (at least 8 characters).
    - Keep `STORAGE=bundled` and `COMPOSE_PROFILES=bundled-storage`.
  - **External (Option B):**
    - Create a private bucket and an access key that can only read and write that bucket.
    - Switch the Option A lines off and fill in Option B: `STORAGE=external`, an empty `COMPOSE_PROFILES`, `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `FILES_ORIGIN`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`.
    - Example for Cloudflare R2: endpoint `https://<account-id>.r2.cloudflarestorage.com`, region `auto`.

The API refuses to start in production in any of these cases. That is intended.
- A secret is a placeholder, or the three secrets match.
- `BCRYPT_COST` is below 12.
- The scanner is anything other than ClamAV.
- `DEV_MARK_FILES_CLEAN` is on.

## 4. Start

```sh
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
docker compose -f docker-compose.prod.yml --env-file .env.production ps
```

On every start:
- The API applies pending database migrations and creates the storage bucket if it is missing. With external storage, create the bucket yourself if the key may not.
- Caddy requests certificates as soon as DNS points at the server.

ClamAV needs a few minutes on its first start to load its signature database. Until then, new uploads show **Scanning** and cannot be downloaded (D-30).

Check it:

```sh
curl -I http://app.example.com               # permanent redirect to https
curl https://app.example.com/api/v1/health   # {"status":"ok"}
```

## 5. Create the first Owner

Run this once, on the empty database:

```sh
docker compose -f docker-compose.prod.yml --env-file .env.production exec api \
  node scripts/create-owner.js --email owner@company.com --name "Full Name" \
  --workspace "Company name" --timezone Europe/Berlin --currency EUR
```

What the script does:
- Creates the workspace and the Owner.
- Prints a one-time link, valid 7 days, where the Owner chooses a password, and also emails it. No password is ever typed on the command line.
- Refuses to run if the database already has users.

Everyone else is invited from **Team** in the app. After signing in, set the logo, time zone, week start and date format under **Settings**.

## 6. Backups

[`deploy/backup.sh`](../deploy/backup.sh) writes the following to `backups/<UTC time>/` and keeps 14 days:
- A PostgreSQL dump.
- With bundled storage, a copy of every stored file.
- Checksums of both.

Run it nightly:

```sh
crontab -e
# 02:30 UTC every night
30 2 * * * cd /home/USER/cpm && BACKUP_DIR=/home/USER/cpm/backups ./deploy/backup.sh >> backups/backup.log 2>&1
```

**Copy the backups off the server**, to another provider or region, for example:

```sh
rsync -a --delete backups/ backup-host:/srv/cpm-backups/
```

Disk snapshots of the VM are a good extra layer, not a replacement.

**External storage:** the files live with the provider, so the script backs up the database only. Turn on the provider's object versioning or replication for the bucket.

To restore (this replaces all current data; the app is offline while it runs):

```sh
./deploy/restore.sh backups/20261101T023000Z
```

What the restore does:
- Checks the checksums and asks you to type `RESTORE`.
- Restores the database and, with bundled storage, the files.
- Starts the app again.

Try a restore on a scratch VM every few months, so you know it works.

## 7. Updating to a new release

```sh
./deploy/backup.sh
# replace the code with the new release (git checkout of the new tag, or the new archive)
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

Health checks: `GET /api/v1/health` (process up) and `GET /api/v1/health/ready` (database, storage and email reachable). Point an uptime monitor at both.

## Security notes

- Only Caddy publishes ports. The database, ClamAV and bundled MinIO are reachable only inside the Docker network.
- HTTPS everywhere with HSTS, plus CSP, `X-Frame-Options: DENY` and `nosniff` (NFR-SEC-01/05). Plain HTTP gets a permanent redirect: Caddy sends 308, the method-preserving form of 301.
- File downloads use signed links valid for 10 minutes (FR-FILE-04). The bucket is private, so unsigned or altered links get 403. The content-security policy allows images and previews only from `FILES_ORIGIN`.
- Keep `.env.production` readable only by the deploying user (`chmod 600`). Never commit it; it is git-ignored.

## Rehearsal

On 2026-11-01 the whole stack ran on a development machine with bundled storage, `APP_DOMAIN=localhost` and `FILES_DOMAIN=files.localhost` (Caddy's local certificates):

1. Both images built. The API started in production mode and passed its configuration checks.
2. HTTP redirected to HTTPS, and HSTS, CSP, `X-Frame-Options` and `nosniff` were present.
3. `create-owner.js` created the Owner and the set-password link worked. A second run was refused.
4. A PDF uploaded over HTTPS was scanned by the real ClamAV (Clean) and downloaded through a signed link on the files host. A tampered link and an unsigned request both got 403.
5. After `backup.sh` ran, every volume was destroyed. `restore.sh` brought back the database and the file: the Owner signed in again and the file downloaded at the same size.

Since then, external storage was added. Its Compose settings and Caddy configuration are validated, but it has not yet run against a real provider.

Not done yet: the smoke test on a real server (release checklist step 7), which waits until a host is chosen (D-39).
