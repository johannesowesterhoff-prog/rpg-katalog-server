# Backup

Jeden Sonntag (02:17 UTC) holt GitHub Actions den vollständigen Datenexport
von der Live-Seite (`/api/admin/backup.json`), verschlüsselt ihn und legt ihn
im Branch [`backups`](../../tree/backups/backups) ab. Jede Woche kommt eine
neue Datei dazu, alte bleiben erhalten. Von Hand starten:
GitHub → Actions → „Backup“ → „Run workflow“.

**Enthalten:** alle Tabellen im Schema `katalog` – Spiele, Tags, Produkte,
Verlage, Spielabende, Wahlomat-Gruppen, Einstellungen, Änderungsprotokoll.
**Nicht enthalten:** die Cover-Bilder selbst (nur ihre Quell-Adressen; sie
werden beim ersten Aufruf neu geladen) und der berechnete Suchindex.

## Entschlüsseln

Datei aus dem Branch `backups` herunterladen, dann im Terminal (Mac, Linux
oder Windows mit Git Bash):

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -in rpg-katalog-2026-11-01.json.gz.enc | gunzip > backup.json
```

openssl fragt nach dem Passwort (`BACKUP_PASSWORT`). Ohne dieses Passwort
lässt sich kein Backup öffnen – es gibt keine Hintertür.

## Wiederherstellen

`backup.json` enthält je Tabelle eine Liste von Zeilen (`games`, `tags`,
`products`, `play_sessions` …). Bei Datenverlust einzelne Einträge daraus
zurückschreiben oder Claude bitten, die Tabellen aus der Datei
wiederherzustellen.

## Einrichtung

GitHub → Settings → Secrets and variables → Actions:

- `ADMIN_API_KEY`: der Admin-API-Schlüssel der Live-Seite
  (Cloud Shell: `gcloud secrets versions access latest --secret=katalog-admin-api-key`)
- `BACKUP_PASSWORT`: selbst gewählt, mindestens 12 Zeichen, sicher aufbewahren
