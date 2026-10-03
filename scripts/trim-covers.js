// Einmalige Nachbearbeitung: schneidet bei bereits gespeicherten Covern die
// einfarbigen Ränder ab (siehe trimBorders in src/covers.js). Neue Cover
// werden beim Speichern automatisch so bearbeitet.
//
//   node scripts/trim-covers.js          # nur anzeigen, was sich ändern würde
//   node scripts/trim-covers.js --write  # Änderungen speichern
import 'dotenv/config';
import { pool } from '../src/db.js';
import { processImage } from '../src/covers.js';

const write = process.argv.includes('--write');
const { rows } = await pool.query(
  `SELECT gc.game_id, g.slug, gc.width, gc.height, gc.data
   FROM katalog.game_covers gc JOIN katalog.games g ON g.id = gc.game_id
   WHERE gc.data IS NOT NULL ORDER BY g.slug`,
);

let changed = 0;
for (const r of rows) {
  const img = await processImage(r.data);
  if (img.width === r.width && img.height === r.height) continue;
  changed++;
  console.log(`${r.slug}: ${r.width}x${r.height} -> ${img.width}x${img.height}`);
  if (write) {
    await pool.query(
      `UPDATE katalog.game_covers SET data = $2, width = $3, height = $4, mime = $5, updated_at = now()
       WHERE game_id = $1`,
      [r.game_id, img.data, img.width, img.height, img.mime],
    );
  }
}
console.log(`${changed} von ${rows.length} Covern ${write ? 'zugeschnitten' : 'würden zugeschnitten'}.`);
await pool.end();
