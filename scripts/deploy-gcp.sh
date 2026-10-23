#!/usr/bin/env bash
# Baut den aktuellen Git-Stand (HEAD) als Container und bringt ihn auf
# Google Cloud Run (Dienst rpg-katalog, Region us-east1). Die Geheimnisse
# (DATABASE_URL, SESSION_SECRET, ADMIN_API_KEY) liegen im Secret Manager und
# bleiben beim Deploy unverändert am Dienst hängen.
#
# Anmeldung: Umgebungsvariable GCP_SA_KEY mit dem JSON-Schlüssel des
# Dienstkontos claude-deploy – roh oder Base64-kodiert (Base64 übersteht
# Eingabefelder, die Klammern und Anführungszeichen verändern) – oder vorher
# selbst `gcloud auth login`.
set -euo pipefail

PROJECT=${GCP_PROJECT:-symbolic-cinema-403817}
REGION=us-east1
SERVICE=rpg-katalog
IMAGE_BASE=$REGION-docker.pkg.dev/$PROJECT/katalog/rpg-katalog

cd "$(dirname "$0")/.."
command -v gcloud >/dev/null || { echo "gcloud fehlt (Google Cloud SDK)."; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "Es gibt ungespeicherte Änderungen – bitte erst committen."; exit 1; }

# In Cloud-Sitzungen setzt die Umgebung ein fremdes Zugriffstoken, das
# gcloud sonst vorzieht – für unsere Aufrufe ausblenden.
gc() { env -u CLOUDSDK_AUTH_ACCESS_TOKEN gcloud "$@"; }

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
if [ -n "${GCP_SA_KEY:-}" ]; then
  case $GCP_SA_KEY in
    '{'*) printf '%s' "$GCP_SA_KEY" > "$tmp/key.json" ;;
    *) printf '%s' "$GCP_SA_KEY" | base64 -d > "$tmp/key.json" ;;
  esac
  gc auth activate-service-account --key-file="$tmp/key.json" >/dev/null
fi
gc config set project "$PROJECT" >/dev/null

rev=$(git rev-parse --short HEAD)
image=$IMAGE_BASE:$rev
echo "Baue $(git log --oneline -1) …"
mkdir "$tmp/src"
git archive HEAD | tar -x -C "$tmp/src"

# Ohne Viewer-Rechte kann gcloud die Build-Logs nicht streamen, deshalb
# asynchron starten und den Status abfragen.
build=$(gc builds submit "$tmp/src" --pack "image=$image" --region "$REGION" --async --format='value(id)')
while :; do
  status=$(gc builds describe "$build" --region "$REGION" --format='value(status)')
  case $status in QUEUED|WORKING) sleep 10 ;; *) break ;; esac
done
[ "$status" = SUCCESS ] || { echo "Build $build fehlgeschlagen ($status)."; exit 1; }

gc run deploy "$SERVICE" --image "$image" --region "$REGION"
