# RPG-Katalog – Server (Weiterentwicklung ohne Perplexity)

Dieses Paket enthält das komplette, lauffähige Projekt: Frontend
(`public/`) + neu geschriebenes Express-Backend (`server.js`, `src/`), das
gegen deine **bestehende Neon-Datenbank** (Schema `katalog`) läuft. Es
werden keine Tabellen angelegt oder verändert – dein aktueller
Datenbestand bleibt unangetastet.

## Voraussetzungen

- Node.js 20 oder neuer
- Deine Neon-`DATABASE_URL` (Connection-String mit Rolle, die Lese-/
  Schreibrechte auf das Schema `katalog` hat)

## Einrichtung

```bash
npm install
cp .env.example .env
```

Trag in `.env` ein:

```
DATABASE_URL=postgresql://USER:PASSWORD@HOST/DATABASE?sslmode=require
SESSION_SECRET=<langer Zufallswert>
```

Ein zufälliges `SESSION_SECRET` erzeugst du z. B. mit:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## Starten

```bash
npm start
```

Der Server läuft dann unter **http://localhost:8140**.

## Admin-Login

Falls in `app_settings` noch kein Passwort hinterlegt ist, fragt
`GET /api/admin/setup-state` das ab und die Login-Seite bietet dir beim
ersten Aufruf automatisch die Einrichtung eines Passworts an
(mindestens 10 Zeichen). Ist schon ein Passwort gesetzt (z. B. aus dem
Perplexity-Projekt übernommen), meldest du dich damit normal an – **außer**
das Passwort wurde dort anders gespeichert als hier angenommen (siehe
"Bekannte Unsicherheiten" unten).

## Was neu geschrieben wurde – und was bekannt unsicher ist

Der ursprüngliche `server.js`-Quellcode aus dem Perplexity-Projekt lag uns
nie vor (nur seine Beschreibung aus einer Sicherheitsprüfung + das
vollständige, per SQL ausgelesene Datenbankschema). Dieser Server ist
daher ein **funktionaler Nachbau**, kein Byte-für-Byte-Duplikat. Er wurde
exakt gegen dein reales Schema (Tabellen, Constraints, Enums, Views,
Trigger) gebaut und gegen das Frontend-Verhalten abgeglichen. Zwei Punkte,
die du im Hinterkopf behalten solltest:

1. **Admin-Passwort:** Falls dein bisheriges Passwort im Perplexity-Server
   anders gehasht/gespeichert wurde als hier (`scrypt`, `salt:hash` in
   `app_settings.admin_password`), wird die vorhandene DB-Zeile nicht
   erkannt und du müsstest ggf. das Setup neu durchlaufen (d. h. den
   alten Wert in `app_settings` löschen oder überschreiben lassen).
2. **CSV-Importformat:** Das exakte CSV-Altformat kannte niemand mehr
   genau – das hier enthaltene Format ist dokumentiert (siehe
   `src/importer.js`, `CSV_COLUMNS`) und funktional, aber ggf. nicht
   identisch mit dem, was frühere Exporte erzeugt haben. JSON-Import/
   -Export ist dagegen 1:1 rückspielbar (`schema_version: "2.0"`, wie in
   deinem hochgeladenen Datenexport).

Alles andere – Katalogsuche, Facetten, Skalen, Adminbereich, Produkte,
Stammdaten, Duplikaterkennung, Audit-Log, Veröffentlichungslogik – ist
exakt gegen dein Schema (Constraints, Enums, Indizes) implementiert.

## Bereits behobener kleiner Fehler

`schirm` und `trifold` (gültige Werte von `katalog.product_binding`)
fehlten im Frontend-Label-Mapping (`public/js/detail.js`,
`public/js/admin.js`) – das ist in diesem Paket bereits korrigiert.
