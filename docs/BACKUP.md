# Backup

Jeden Sonntag (02:17 UTC) holt GitHub Actions den vollständigen Datenexport
von der Live-Seite (`/api/admin/backup.json`), verschlüsselt ihn und legt ihn
im Branch [`backups`](../../tree/backups/backups) ab. Jede Woche kommt eine
neue Datei dazu, alte bleiben erhalten. Von Hand starten:
GitHub → Actions → „Backup“ → „Run workflow“.

**Enthalten:** alle Tabellen im Schema `katalog` – Spiele, Tags, Produkte,
Verlage, Spielabende, Wahlomat-Gruppen, Einstellungen, Änderungsprotokoll –
und die selbst hochgeladenen Cover. **Nicht enthalten:** Cover mit
Quell-Adresse (sie werden beim ersten Aufruf neu geladen) und der berechnete
Suchindex (entsteht beim Einspielen von selbst).

## Entschlüsseln

Datei aus dem Branch `backups` herunterladen, dann im Terminal (Mac, Linux
oder Windows mit Git Bash):

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -in rpg-katalog-2026-11-01.json.gz.enc | gunzip > backup.json
```

openssl fragt nach dem Passwort (`BACKUP_PASSWORT`). Ohne dieses Passwort
lässt sich kein Backup öffnen – es gibt keine Hintertür.

## Wiederherstellen

In der [Google Cloud Shell](https://console.cloud.google.com/?cloudshell=true)
(Projekt „My First Project“):

1. Backup-Datei aus dem Branch `backups` herunterladen und in der Cloud Shell
   über **⋮ → Hochladen** hochladen (landet im Home-Verzeichnis).
2. Einmalig das Repository holen:
   ```bash
   git clone https://github.com/johannesowesterhoff-prog/rpg-katalog-server.git
   cd rpg-katalog-server
   ```
3. Erst testen – spielt alles ein, prüft es und rollt dann zurück, nichts ändert sich:
   ```bash
   bash scripts/restore-backup.sh ~/rpg-katalog-2026-11-01.json.gz.enc --probe
   ```
4. Dann wirklich einspielen:
   ```bash
   bash scripts/restore-backup.sh ~/rpg-katalog-2026-11-01.json.gz.enc
   ```
   Das Skript fragt nach dem `BACKUP_PASSWORT`, zeigt je Tabelle „jetzt → Backup“
   und verlangt zur Bestätigung die Eingabe `WIEDERHERSTELLEN`.

**Sicherheitsnetz:** Vor dem Überschreiben speichert das Skript den aktuellen
Stand als `vor-wiederherstellung-<Zeit>.json` (unverschlüsselt – nach Gebrauch
löschen). Eingespielt wird in einer einzigen Transaktion: Schlägt irgendetwas
fehl, bleibt die Datenbank unverändert. Die Original-IDs bleiben erhalten,
neue Einträge bekommen danach die nächste freie Nummer.

Getestet am 01.11.2026 mit dem vollständigen Live-Datenstand gegen eine
Kopie der Datenbank: alle 18 Tabellen nach dem Einspielen identisch, Suche,
Cover und neue Einträge funktionieren.

## Einrichtung

GitHub → Settings → Secrets and variables → Actions:

- `ADMIN_API_KEY`: der Admin-API-Schlüssel der Live-Seite
  (Cloud Shell: `gcloud secrets versions access latest --secret=katalog-admin-api-key`)
- `BACKUP_PASSWORT`: selbst gewählt, mindestens 12 Zeichen, sicher aufbewahren
