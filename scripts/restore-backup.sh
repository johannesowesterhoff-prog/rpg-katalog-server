#!/usr/bin/env bash
# Spielt ein Backup aus dem Branch „backups“ zurück in die Live-Datenbank.
# Gedacht für die Google Cloud Shell (gcloud, Node und openssl sind dort da):
#
#   git clone https://github.com/johannesowesterhoff-prog/rpg-katalog-server.git
#   cd rpg-katalog-server
#   bash scripts/restore-backup.sh ~/rpg-katalog-2026-11-01.json.gz.enc            # einspielen
#   bash scripts/restore-backup.sh ~/rpg-katalog-2026-11-01.json.gz.enc --probe    # nur testen
#
# Fragt nach dem BACKUP_PASSWORT, holt DATABASE_URL aus dem Secret Manager
# (oder nimmt eine gesetzte Umgebungsvariable) und ruft restore-backup.mjs auf.
set -euo pipefail

file=${1:?Aufruf: bash scripts/restore-backup.sh <backup-datei> [--probe]}
shift
cd "$(dirname "$0")/.."

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
case $file in
  *.enc)
    echo "Entschlüssele $file …"
    openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -in "$file" | gunzip > "$tmp/backup.json" ;;
  *.gz) gunzip -c "$file" > "$tmp/backup.json" ;;
  *) cp "$file" "$tmp/backup.json" ;;
esac

if [ -z "${DATABASE_URL:-}" ]; then
  DATABASE_URL=$(gcloud secrets versions access latest --secret=katalog-database-url --project=symbolic-cinema-403817)
  export DATABASE_URL
fi
[ -d node_modules/pg ] || npm ci --omit=dev --no-audit --no-fund --silent

node scripts/restore-backup.mjs "$tmp/backup.json" "$@"
