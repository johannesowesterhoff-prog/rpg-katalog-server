# RPG-Katalog – Hinweise für Claude

Antworte auf Deutsch. Claude darf Pull Requests selbst mergen (seit 24.10.2026),
sobald sie fertig und geprüft sind. Ein Merge auf `main` geht automatisch live –
danach den Deploy-Lauf in GitHub Actions abwarten und die Live-Seite prüfen.

## Betrieb (Stand 23.10.2026)

- **Live:** Google Cloud Run, Dienst `rpg-katalog`, Region `us-east1`,
  Projekt `symbolic-cinema-403817` („My First Project“), seit 23.10.2026
  vollständiges (kostenpflichtiges) Konto statt Testzeitraum.
  URL: https://rpg-katalog-666839148899.us-east1.run.app
- **Deployen:** `bash scripts/deploy-gcp.sh` (baut HEAD per Cloud Build als
  Image nach `us-east1-docker.pkg.dev/symbolic-cinema-403817/katalog/rpg-katalog:<commit>`
  und deployt es). Braucht die Umgebungsvariable `GCP_SA_KEY` (JSON-Schlüssel
  des Dienstkontos `claude-deploy@symbolic-cinema-403817.iam.gserviceaccount.com`;
  in der Claude-Umgebung Base64-kodiert, weil das Eingabefeld rohes JSON zerlegt).
  In Cloud-Sitzungen gcloud immer mit `env -u CLOUDSDK_AUTH_ACCESS_TOKEN` aufrufen,
  sonst greift ein fremdes Token. Nach dem Deploy prüfen: `/api/games` liefert 200
  und `public/*`-Dateien live sind identisch mit `git show HEAD:public/<datei>`.
- **Geheimnisse:** im Secret Manager als `katalog-database-url`,
  `katalog-session-secret`, `katalog-admin-api-key`. Werte nie in den Chat oder
  ins Repo schreiben. Den Admin-API-Schlüssel liest Johannes in Cloud Shell mit
  `gcloud secrets versions access latest --secret=katalog-admin-api-key`.
- **Datenbank:** Neon, Projekt `round-brook-04699149`, Branch `main`
  (`br-odd-cherry-ax1tfiq4`), Schema `katalog`. Die App verbindet sich als
  `neondb_owner` (Passwort am 23.10.2026 nach dem Railway-Vorfall neu gesetzt).
- **Admin-Login:** Passwort steht gehasht in `katalog.app_settings`, unabhängig
  vom Hosting.
- **Railway** ist Geschichte: Nach dem Sicherheitsvorfall im Oktober 2026
  waren Deploys dort pausiert; das Konto ist seit 23.10.2026 gelöscht.
- **GitHub Actions:** `.github/workflows/deploy.yml` deployt nach jedem Merge
  auf `main` per `scripts/deploy-gcp.sh` auf Google. Braucht das
  Repository-Secret `GCP_SA_KEY`.

## Bewusst nicht gewollt

- Wahlomat: keine No-Gos, kein Sprachfilter, keine Spielfokus-Tag-Zuordnung,
  kein automatisches Neuladen der Gruppenansicht.
