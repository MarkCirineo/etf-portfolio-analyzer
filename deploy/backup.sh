#!/bin/sh
# Nightly database backup, kept for 14 days. Run from the repo directory, e.g. from cron:
#   15 3 * * * cd /opt/etf-portfolio-analyzer && ./deploy/backup.sh >> backups/backup.log 2>&1
set -eu

mkdir -p backups
file="backups/etf-$(date +%Y-%m-%d).sql.gz"

docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > "$file"
find backups -name 'etf-*.sql.gz' -mtime +14 -delete

echo "$(date -Is) wrote $file"
