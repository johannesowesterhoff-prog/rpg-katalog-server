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
  // Setzt das Schema bereits beim Verbindungsaufbau (nicht erst per
  // nachträglichem "SET search_path"-Query, das durch einen Timing-Fehler
  // eine Race Condition verursachen konnte -- Abfragen liefen dann teils
  // gegen den falschen search_path und schlugen mit "relation ... does not
  // exist" fehl).
  options: '-c search_path=katalog,public',
});

// Wichtiger Fix aus der Sicherheitsprüfung: Ohne diesen Handler wirft eine
// getrennte Leerlaufverbindung ein unbehandeltes "error"-Event auf dem Pool
// und bringt den gesamten Serverprozess zum Absturz (Node beendet den
// Prozess bei unbehandelten "error"-Events auf EventEmittern).
pool.on('error', (err) => {
  // eslint-disable-next-line no-console
  console.error('[db] Unerwarteter Fehler auf einer Leerlaufverbindung:', err);
});

// Setzt den search_path zusätzlich für jede neue Verbindung im Pool (doppelt
// hält besser) -- die eigentliche, race-freie Absicherung ist aber die
// "options"-Startparameter oben in der Pool-Konfiguration.
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
