#!/usr/bin/env bash
# Lädt den aktuellen Stand von main auf Railway hoch (Dienst RPG_Katalog,
# Umgebung production). Railway ist nicht mit GitHub verbunden, deshalb geht
# ein Merge nicht automatisch live – nach jedem Merge einmal ausführen.
#
# Anmeldung: entweder vorher einmal `railway login` oder die Umgebungsvariable
# RAILWAY_API_TOKEN (Konto-Token aus Railway → Account Settings → Tokens).
set -euo pipefail

PROJECT=13b23b21-1386-4ccc-b00b-f1db1a5c2588
ENVIRONMENT=ea880c05-ccf5-4ff8-aeeb-2c8f661aff6f
SERVICE=c620bd45-4cd0-49d2-8a80-56939c75a7f3

cd "$(dirname "$0")/.."

command -v railway >/dev/null || { echo "Railway-CLI fehlt: npm i -g @railway/cli"; exit 1; }

branch=$(git rev-parse --abbrev-ref HEAD)
[ "$branch" = main ] || { echo "Bitte erst auf main wechseln (aktuell: $branch)."; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "Es gibt ungespeicherte Änderungen – bitte erst committen oder verwerfen."; exit 1; }

git pull --ff-only origin main
echo "Deploye $(git log --oneline -1) …"

railway up --ci --project "$PROJECT" --environment "$ENVIRONMENT" --service "$SERVICE"
