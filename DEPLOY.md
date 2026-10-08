# Deploying

The app runs as five Docker containers behind the server's own nginx:

```
browser ──https──▶ nginx on the server (TLS, the domain)
                     └─▶ 127.0.0.1:8080  web        static app + passes /api and /socket.io on
                                          backend    Node API, live updates
                                          etf-scraper  fetches fund data from etf.com
                                          postgres   accounts and lists (volume: pgdata)
                                          redis      caches (volume: redisdata)
```

Only `web` is published, and only on localhost. Everything else talks on Docker's private
network. Secrets live in `.env` on the server, never in the image or the repo.

## 1. Check that etf.com answers from the server

Fund holdings come from etf.com, which sits behind Cloudflare; it sometimes blocks
data-centre addresses. From any directory on the server:

```bash
curl -fsSL https://raw.githubusercontent.com/<you>/etf-portfolio-analyzer/main/deploy/check-etf-com.py \
  | docker run --rm -i python:3.12-slim sh -c "pip install -q curl_cffi && python -"
```

(or, after cloning in step 3, `... < deploy/check-etf-com.py`). `PASS` means you are good. On
`FAIL` the app still runs, but falls back to Alpha Vantage, which only knows US-listed
holdings, so international funds look nearly empty.

## 2. DNS

Add an `A` record for the subdomain (for example `etf.markcirineo.com`) pointing at the
server's IPv4 address, and an `AAAA` record for its IPv6 address if it has one.

## 3. Get the code and configure it

```bash
sudo mkdir -p /opt/etf-portfolio-analyzer && sudo chown $USER /opt/etf-portfolio-analyzer
git clone https://github.com/<you>/etf-portfolio-analyzer.git /opt/etf-portfolio-analyzer
cd /opt/etf-portfolio-analyzer
cp .env.example .env
nano .env
```

Fill in the Finnhub and Alpha Vantage keys, and generate the two secrets with
`openssl rand -hex 32`. If port 8080 is taken on the server, change `WEB_PORT`.

## 4. Start it

```bash
docker compose up -d --build
docker compose ps                 # all five "Up", postgres and redis "healthy"
curl -I http://127.0.0.1:8080     # 200
```

The first build takes a few minutes. The database tables are created when the backend
starts.

## 5. Put nginx in front

```bash
sudo cp deploy/nginx-site.conf /etc/nginx/sites-available/etf
sudo nano /etc/nginx/sites-available/etf     # server_name, and the port if you changed WEB_PORT
sudo ln -s /etc/nginx/sites-available/etf /etc/nginx/sites-enabled/etf
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d etf.markcirineo.com
```

If `nginx -t` reports that `$connection_upgrade` is already defined, another site defines
the same map: delete the `map` block at the bottom of this file. Certbot adds the HTTPS
block and the redirect from http.

Open the site, sign up, and add your accounts. The first analysis is slow while fund data,
the sector map and the ticker list download; after that it's cached.

## Day to day

| Task                      | Command                                                    |
| ------------------------- | ---------------------------------------------------------- |
| Update to the latest code | `git pull && docker compose up -d --build`                 |
| Logs                      | `docker compose logs -f backend` (or `etf-scraper`, `web`) |
| Restart everything        | `docker compose restart`                                   |
| Stop                      | `docker compose down` (data stays in the volumes)          |

### Backups

`deploy/backup.sh` writes a compressed database dump to `backups/` and keeps 14 days. Run it
nightly from cron (`crontab -e`):

```
15 3 * * * cd /opt/etf-portfolio-analyzer && ./deploy/backup.sh >> backups/backup.log 2>&1
```

Copy `backups/` off the server now and then; a dump on the same disk doesn't survive the
disk. To restore one:

```bash
gunzip -c backups/etf-YYYY-MM-DD.sql.gz | docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" "$POSTGRES_DB"'
```

Redis holds only caches; losing it means a slow first load, nothing more.

### Moving an existing local database over

Optional; signing up and re-entering your accounts works too. On the machine with the data:

```bash
pg_dump --no-owner --no-privileges -U <user> <database> | gzip > etf-local.sql.gz
scp etf-local.sql.gz <server>:/opt/etf-portfolio-analyzer/
```

Then on the server, before signing up there, restore it with the command above.
