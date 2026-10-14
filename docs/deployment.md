# Deploying Disco Controller

Disco Controller is one Node.js process with a SQLite file. It is designed to
run on a Raspberry Pi 5 at the office, reached from the internet through a
Cloudflare Tunnel, with the database streamed to Backblaze B2 by Litestream.
Running costs are the Pi's electricity and a few cents of B2 storage.

```
Customers / staff ──https──▶ Cloudflare ──tunnel──▶ cloudflared ─▶ app :3000 ─▶ disco.db
Square webhooks  ──https──▶                                         │
                                                         Litestream ─▶ Backblaze B2
```

Pick **one** way to run the app: [natively with systemd](#option-a-native-with-systemd)
(simplest on a Pi) or [Docker Compose](#option-b-docker-compose). Everything
else (tunnel, Square, email, backups) is the same.

## 1. Prepare the Pi

- Raspberry Pi 5 (4 GB is plenty) with an **NVMe or USB SSD**. Keep the database
  off the SD card: SQLite writes wear SD cards out and are much slower.
- Raspberry Pi OS Lite (64-bit, Bookworm or later). Enable SSH and set the time
  zone (`sudo raspi-config` → Localisation).
- Mount the SSD and put the data directory on it, e.g. `/var/lib/disco-controller`
  on the SSD (or symlink it there).
- Keep the OS patched: `sudo apt update && sudo apt full-upgrade`, and consider
  `unattended-upgrades`.

## 2. Configure

Copy `.env.example` and fill it in. At minimum:

| Variable                        | Value                                                                         |
| ------------------------------- | ----------------------------------------------------------------------------- |
| `APP_SECRET`                    | `openssl rand -base64 48`. Keep a copy in your password manager.              |
| `PUBLIC_BASE_URL`               | The tunnel hostname, e.g. `https://app.undercoverdanceparty.com`              |
| `INITIAL_ADMIN_PASSWORD`        | Password for `kali` on first start (or leave blank and set it in the browser) |
| `SMTP_URL`, `MAIL_FROM`         | See [Email](#5-email)                                                         |
| `LITESTREAM_*`, `DISCO_DB_PATH` | See [Backups](#6-backups-with-litestream-and-backblaze-b2)                    |

`APP_SECRET` encrypts the saved Square token. If it changes, reconnect Square in
Settings → Square. The app refuses to start in production with a short or
missing secret.

## Option A: native with systemd

```bash
# Node.js 24 LTS and build tools (for native modules if no prebuilt binary exists)
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt install -y nodejs git build-essential python3
sudo npm install -g pnpm@12

# App user and code
sudo useradd --system --home /opt/disco-controller --shell /usr/sbin/nologin disco
sudo git clone <your repo URL> /opt/disco-controller
sudo chown -R disco:disco /opt/disco-controller
cd /opt/disco-controller
sudo -u disco pnpm install --frozen-lockfile
sudo -u disco pnpm build

# Configuration (readable by root and the service only)
sudo cp .env.example /etc/disco-controller.env
sudo chmod 640 /etc/disco-controller.env && sudo chown root:disco /etc/disco-controller.env
sudo nano /etc/disco-controller.env   # set HOST=127.0.0.1 so only the tunnel can reach it

# Service
sudo cp deploy/disco-controller.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now disco-controller
systemctl status disco-controller
curl http://127.0.0.1:3000/api/health   # {"status":"ok"}
```

The unit stores the database at `/var/lib/disco-controller/disco.db` and runs
migrations automatically on start.

**Updating:**

```bash
cd /opt/disco-controller
sudo -u disco git pull
sudo -u disco pnpm install --frozen-lockfile && sudo -u disco pnpm build
sudo systemctl restart disco-controller
```

## Option B: Docker Compose

Install Docker (`curl -fsSL https://get.docker.com | sh`), then from the repo:

```bash
cp .env.example .env    # edit it; DATABASE_PATH is set to /data/disco.db by Compose
docker compose up -d --build
docker compose ps       # app should become "healthy"
```

The database lives in `./data` next to the Compose file. The Compose file also
runs a `litestream` container for backups. To build the image on a faster
machine instead of the Pi:

```bash
docker buildx build --platform linux/arm64 -t disco-controller:latest --load .
```

**Updating:** `git pull && docker compose up -d --build`.

## 3. Cloudflare Tunnel

The tunnel gives the Pi a public HTTPS hostname with no open router ports and no
static IP. It needs a (free) Cloudflare account with your domain on it.

```bash
# On the Pi (arm64 package)
curl -L -o cloudflared.deb \
  https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64.deb
sudo dpkg -i cloudflared.deb

cloudflared tunnel login                         # opens a browser link to authorize
cloudflared tunnel create disco-controller       # note the tunnel ID
cloudflared tunnel route dns disco-controller app.undercoverdanceparty.com
```

Create `/etc/cloudflared/config.yml`:

```yaml
tunnel: <tunnel ID>
credentials-file: /etc/cloudflared/<tunnel ID>.json
ingress:
  - hostname: app.undercoverdanceparty.com
    service: http://127.0.0.1:3000
  - service: http_status:404
```

Copy the credentials JSON from `~/.cloudflared/` to `/etc/cloudflared/`, then
`sudo cloudflared service install && sudo systemctl enable --now cloudflared`.
Set `PUBLIC_BASE_URL` to the same hostname and restart the app.

Optional: put **Cloudflare Access** in front of everything except the public
paths (`/q/*`, `/request/*`, `/api/public/*`, `/api/webhooks/*`, and static
assets) for an extra sign-in layer for staff.

## 4. Square

1. In the [Square Developer Dashboard](https://developer.squareup.com/apps),
   create an application. Under **Credentials**, copy the access token
   (Sandbox to test, Production for real money).
2. In Disco Controller, open **Settings → Square**, choose the environment, paste
   the token, click **Find locations**, pick the location, and **Connect Square**.
   The token is checked against Square before it is saved, then stored
   encrypted with `APP_SECRET`.
3. Copy the **webhook URL** shown on that tab. It looks like
   `https://app.undercoverdanceparty.com/api/webhooks/square/undercover-dance-party`.
4. In the Developer Dashboard → **Webhooks → Subscriptions**, add a subscription
   (in the same environment) with that URL and the events `invoice.payment_made`,
   `invoice.updated`, and `payment.updated`.
5. Copy the subscription's **signature key** into Settings → Square → Webhook
   signature key and save. Requests without a valid signature are rejected.
6. Use **Send test event** in the Dashboard; the app log should show it accepted.

Even without webhooks, open invoices are re-checked every
`SQUARE_RECONCILE_MINUTES` (default 15), so a missed notification only delays a
payment showing up.

## 5. Email

Quote, confirmation, and notification emails go out over SMTP. Any provider
works; for low volume, a free tier is enough (e.g. Brevo, Mailgun, or SMTP2GO),
or Google Workspace SMTP relay.

```
SMTP_URL=smtps://USERNAME:PASSWORD@smtp.example.com:465
MAIL_FROM="Undercover Dance Party <bookings@undercoverdanceparty.com>"
```

URL-encode special characters in the password. Add the provider's SPF/DKIM DNS
records for your domain so emails are not marked as spam. Without `SMTP_URL`,
emails are written to the log instead of sent.

## 6. Backups with Litestream and Backblaze B2

Litestream streams every database change to B2 within seconds, so a dead SSD or
stolen Pi loses at most a few seconds of data.

1. In Backblaze B2, create a **private** bucket (e.g. `udp-disco-backups`) and set
   its lifecycle to "Keep only the last version of the file".
2. Create an **application key** limited to that bucket. Note the `keyID`,
   `applicationKey`, and the bucket's S3 endpoint (e.g.
   `s3.us-west-004.backblazeb2.com`).
3. Fill in `.env` / `/etc/disco-controller.env`:

   ```
   DISCO_DB_PATH=/var/lib/disco-controller/disco.db   # /data/disco.db with Docker
   LITESTREAM_BUCKET=udp-disco-backups
   LITESTREAM_ENDPOINT=s3.us-west-004.backblazeb2.com
   LITESTREAM_ACCESS_KEY_ID=<keyID>
   LITESTREAM_SECRET_ACCESS_KEY=<applicationKey>
   ```

**Docker:** the `litestream` service in `docker-compose.yml` already runs it.

**Native:**

```bash
curl -L -o litestream.deb \
  https://github.com/benbjohnson/litestream/releases/download/v0.5.17/litestream-0.5.17-linux-arm64.deb
sudo dpkg -i litestream.deb
sudo cp deploy/litestream.yml /etc/litestream.yml
# Litestream's service reads /etc/default/litestream for its environment
sudo grep -E '^(DISCO_DB_PATH|LITESTREAM_)' /etc/disco-controller.env | sudo tee /etc/default/litestream
sudo chmod 600 /etc/default/litestream
sudo systemctl enable --now litestream
journalctl -u litestream -f      # look for "replicating" with no errors
```

Litestream must be able to read and write the database directory: run it as
root (the default) or add it to the `disco` group.

### Restore

Use this to move to a new Pi or recover from a failure. The app must **not** be
running against the target path while restoring.

```bash
# 1. Install the app (Option A or B) and Litestream, and copy the same
#    configuration, including APP_SECRET and the LITESTREAM_* values.
# 2. Stop the app so it does not create an empty database.
sudo systemctl stop disco-controller          # or: docker compose stop app

# 3. Restore the latest copy to the configured path (it must not already exist).
sudo mv /var/lib/disco-controller/disco.db{,.old} 2>/dev/null || true
sudo rm -f /var/lib/disco-controller/disco.db-{wal,shm}
sudo bash -c 'set -a; . /etc/default/litestream;
  litestream restore -config /etc/litestream.yml /var/lib/disco-controller/disco.db'
sudo chown disco:disco /var/lib/disco-controller/disco.db

#    Point-in-time instead of latest: add  -timestamp 2025-06-01T03:00:00Z

# 4. Start the app and replication again.
sudo systemctl start disco-controller litestream
```

With Docker, run the restore in a one-off container:

```bash
docker compose stop app litestream
mv data/disco.db data/disco.db.old; rm -f data/disco.db-wal data/disco.db-shm
docker compose run --rm litestream restore /data/disco.db
docker compose up -d
```

Sign in and check recent bookings and payments. Because `APP_SECRET` is the same,
the Square connection keeps working; if it is not, reconnect Square in Settings.

**Test the restore** on a spare machine every few months. A backup you have never
restored is only a hope.

## 7. Operations checklist

- Health: `GET /api/health` returns `{"status":"ok"}`. Point a free uptime
  monitor (e.g. UptimeRobot, Healthchecks.io) at `https://<host>/api/health`.
- Logs: `journalctl -u disco-controller -f` or `docker compose logs -f app`.
- Disk: `df -h` on the SSD now and then; the database grows slowly.
- Keep `.env` and `APP_SECRET` in your password manager; they are not in backups.
