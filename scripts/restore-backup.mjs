// Spielt ein Backup (backup.json aus /api/admin/backup.json) zurück in die
// Datenbank. Normalerweise über scripts/restore-backup.sh aufgerufen, das die
// verschlüsselte Datei entschlüsselt und DATABASE_URL besorgt.
//
// Aufruf: DATABASE_URL=… node scripts/restore-backup.mjs backup.json [--probe] [--ja]
//   --probe  alles einspielen und prüfen, dann zurückrollen: nichts ändert sich
//   --ja     ohne Rückfrage (für Tests)
//
// Ablauf: Vergleich anzeigen → Rückfrage → aktuellen Stand als Datei sichern →
// in EINER Transaktion alle Tabellen leeren und aus dem Backup füllen
// (Original-IDs, Reihenfolge nach Fremdschlüsseln) → Zähler zurücksetzen →
// Zeilenzahlen prüfen → festschreiben. Bei jedem Fehler bleibt alles beim Alten.
import fs from 'node:fs';
import readline from 'node:readline';
import pg from 'pg';
import { backupSelect } from '../src/backupTables.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const probe = args.includes('--probe');
const yes = args.includes('--ja');
if (!file || !process.env.DATABASE_URL) {
  console.error('Aufruf: DATABASE_URL=… node scripts/restore-backup.mjs backup.json [--probe] [--ja]');
  process.exit(1);
}

const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
if (!backup.meta || !Array.isArray(backup.games)) {
  console.error('Das sieht nicht nach einem RPG-Katalog-Backup aus (meta/games fehlen).');
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const q = (sql, params) => client.query(sql, params);

try {
  const dbTables = (await q(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'katalog' AND table_type = 'BASE TABLE'`)).rows.map((r) => r.table_name);
  const tables = Object.keys(backup).filter((k) => Array.isArray(backup[k]) && dbTables.includes(k));
  const unknown = Object.keys(backup).filter((k) => Array.isArray(backup[k]) && !dbTables.includes(k));
  const notInBackup = dbTables.filter((t) => !tables.includes(t));

  // Übersicht: jetzt in der Datenbank → im Backup
  console.log(`Backup vom ${backup.meta.erstellt}`);
  for (const t of tables) {
    const now = (await q(`SELECT count(*)::int AS n FROM katalog.${t}`)).rows[0].n;
    console.log(`  ${t.padEnd(24)} ${String(now).padStart(5)} → ${String(backup[t].length).padStart(5)}${now !== backup[t].length ? '  ←' : ''}`);
  }
  if (unknown.length) console.log(`Im Backup, aber nicht (mehr) in der Datenbank – wird übersprungen: ${unknown.join(', ')}`);
  if (notInBackup.length) console.log(`In der Datenbank, aber nicht im Backup – bleibt unangetastet: ${notInBackup.join(', ')}`);

  if (!probe && !yes) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise((resolve) => rl.question('\nAlle Daten durch das Backup ersetzen? Zum Bestätigen WIEDERHERSTELLEN eintippen: ', resolve));
    rl.close();
    if (answer.trim() !== 'WIEDERHERSTELLEN') { console.log('Abgebrochen – nichts geändert.'); process.exit(0); }
  }

  // Sicherheitsnetz: aktuellen Stand als Datei sichern (gleiches Format wie das Backup).
  if (!probe) {
    const now = (await q(backupSelect(dbTables))).rows[0].data;
    const name = `vor-wiederherstellung-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    fs.writeFileSync(name, JSON.stringify({ meta: { erstellt: new Date().toISOString(), schema: 'katalog', hinweis: 'Stand direkt vor einer Wiederherstellung' }, ...now }));
    console.log(`\nAktueller Stand gesichert: ${name} (unverschlüsselt – nach Gebrauch löschen)`);
  }

  // Reihenfolge: Tabellen erst nach denen füllen, auf die sie verweisen.
  const fks = (await q(`SELECT c.relname AS t, r.relname AS ref FROM pg_constraint k
    JOIN pg_class c ON c.oid = k.conrelid JOIN pg_class r ON r.oid = k.confrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'katalog' AND k.contype = 'f' AND c.oid <> r.oid`)).rows;
  const order = [];
  const visit = (t, seen = new Set()) => {
    if (order.includes(t) || seen.has(t)) return;
    seen.add(t);
    fks.filter((f) => f.t === t && tables.includes(f.ref)).forEach((f) => visit(f.ref, seen));
    order.push(t);
  };
  tables.forEach((t) => visit(t));

  const cols = (await q(`SELECT table_name, column_name, is_generated, identity_generation FROM information_schema.columns WHERE table_schema = 'katalog'`)).rows;

  await q('BEGIN');
  await q(`TRUNCATE ${tables.map((t) => `katalog.${t}`).join(', ')}`);
  for (const t of order) {
    const rows = backup[t];
    if (!rows.length) continue;
    const present = new Set(rows.flatMap((r) => Object.keys(r)));
    const tc = cols.filter((c) => c.table_name === t && c.is_generated === 'NEVER' && present.has(c.column_name));
    const list = tc.map((c) => `"${c.column_name}"`).join(', ');
    const override = tc.some((c) => c.identity_generation === 'ALWAYS') ? ' OVERRIDING SYSTEM VALUE' : '';
    await q(`INSERT INTO katalog.${t} (${list})${override} SELECT ${list} FROM jsonb_populate_recordset(NULL::katalog.${t}, $1::jsonb)`, [JSON.stringify(rows)]);
  }
  // Zähler (IDs) hinter den höchsten eingespielten Wert setzen.
  for (const c of cols.filter((x) => tables.includes(x.table_name))) {
    const seq = (await q('SELECT pg_get_serial_sequence($1, $2) AS s', [`katalog.${c.table_name}`, c.column_name])).rows[0].s;
    if (seq) await q(`SELECT setval($1, coalesce((SELECT max("${c.column_name}") FROM katalog.${c.table_name}), 1), (SELECT count(*) > 0 FROM katalog.${c.table_name}))`, [seq]);
  }
  // Gegenprobe: jede Tabelle hat genau so viele Zeilen wie im Backup.
  for (const t of tables) {
    const n = (await q(`SELECT count(*)::int AS n FROM katalog.${t}`)).rows[0].n;
    if (n !== backup[t].length) throw new Error(`${t}: ${n} Zeilen statt ${backup[t].length}`);
  }

  if (probe) {
    await q('ROLLBACK');
    console.log('\nProbelauf erfolgreich: Das Backup lässt sich vollständig einspielen. Nichts wurde geändert.');
  } else {
    await q('COMMIT');
    await q(`INSERT INTO katalog.audit_log (actor, action, entity, entity_id, diff) VALUES ('wiederherstellung', 'restore', 'database', NULL, $1)`,
      [JSON.stringify({ backup_vom: backup.meta.erstellt, tabellen: tables.length })]);
    console.log('\nWiederhergestellt. Die Website zeigt den Stand sofort (Cover ohne Daten werden beim ersten Aufruf neu geladen).');
  }
} catch (e) {
  await q('ROLLBACK').catch(() => {});
  console.error(`\nFehler – nichts wurde geändert: ${e.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
