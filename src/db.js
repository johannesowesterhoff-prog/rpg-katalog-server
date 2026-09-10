// Datenbankverbindung. Nutzt einen einzigen pg-Pool gegen die bestehende
// Neon-Datenbank (Schema "katalog", Rolle katalog_app: darf ausschließlich
// in diesem Schema lesen/schreiben).
import pg from 'pg';

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL ist nicht gesetzt (siehe .env.example).');
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Hinweis: Neons gepoolter Connection-String (Hostname mit "-pooler")
  // unterstützt keine "options"-Startparameter wie search_path -- daher
  // wird hier bewusst NICHT über den search_path gearbeitet. Stattdessen
  // qualifiziert jede Abfrage im Code ihre Tabellen explizit mit
  // "katalog." -- das funktioniert zuverlässig unabhängig vom Pooling.
});

// Wichtiger Fix aus der Sicherheitsprüfung: Ohne diesen Handler wirft eine
// getrennte Leerlaufverbindung ein unbehandeltes "error"-Event auf dem Pool
// und bringt den gesamten Serverprozess zum Absturz (Node beendet den
// Prozess bei unbehandelten "error"-Events auf EventEmittern).
pool.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('[db] Unerwarteter Fehler auf einer Leerlaufverbindung:', err);
});

// Best-effort-Zusatz für den unwahrscheinlichen Fall künftiger unqualifizierter
// Abfragen -- die eigentliche Absicherung ist die explizite "katalog."-
// Qualifizierung in jeder SQL-Abfrage im Code (s.o.).
pool.on('connect', (client) => {
  client.query('SET search_path TO katalog, public').catch(() => {});
});

export async function query(text, params) {
  return pool.query(text, params);
}

/** Führt eine Funktion innerhalb einer Transaktion aus (COMMIT/ROLLBACK automatisch). */
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
