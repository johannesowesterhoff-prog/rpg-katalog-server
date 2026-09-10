// CSV/JSON-Import mit zweistufigem Ablauf: erst Staging + Vorschau
// (POST /api/admin/import), dann Übernahme (POST /api/admin/import/:id/commit).
//
// Hinweis zur Rekonstruktion: Das exakte CSV-Altformat des Original-Imports
// lag nicht vor (nur der beschreibende Button-Text "CSV herunterladen
// (Altformat + Spalte 'fluff')" aus admin.js). Dieses Modul unterstützt
// deshalb zwei Formate:
//   - JSON: das vollständige Exportformat (schema_version 2.0), wie es
//     auch /api/admin/export.json erzeugt -- damit ist Roundtrip
//     Export -> Import verlustfrei möglich.
//   - CSV: ein flaches, dokumentiertes Format (Semikolon-getrennt, Kopfzeile
//     s.u.) für den Massen-Import/die Pflege in Excel. Mehrfachwerte
//     (Verlage/Genres/Fokus/Kampagne) werden Pipe-getrennt ("Wert 1|Wert 2").
import { pool, withTransaction } from './db.js';
import { slugify, validateGamePayload, findDuplicates, logAudit, httpError } from './catalog.js';

export const CSV_COLUMNS = [
  'title', 'original_title', 'language', 'system_family', 'edition', 'release_year',
  'short_description', 'long_description', 'crunch', 'narrative', 'fluff', 'status',
  'publishers', 'genre_setting', 'play_focus', 'campaign_type',
];

function parseCsv(content) {
  // Einfacher, aber korrekter CSV-Parser (Semikolon, Anführungszeichen mit "").
  const rows = [];
  let row = [], field = '', inQuotes = false;
  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (inQuotes) {
      if (c === '"') {
        if (content[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ';') pushField();
    else if (c === '\n') { if (field !== '' || row.length) pushRow(); }
    else if (c === '\r') { /* ignore */ }
    else field += c;
  }
  if (field !== '' || row.length) pushRow();
  return rows;
}

function splitMulti(v) {
  return String(v || '').split('|').map((s) => s.trim()).filter(Boolean);
}

/** Normalisiert eine rohe Import-Zeile (CSV-Objekt oder JSON-Spiel) auf die
 *  interne payload-Form, wie sie auch createGame/updateGame erwarten. */
function normalizeRow(raw, format) {
  if (format === 'json') {
    return {
      title: raw.title, original_title: raw.original_title, language: raw.language,
      system_family: raw.system_family, edition: raw.edition, release_year: raw.release_year,
      short_description: raw.short_description, long_description: raw.long_description,
      crunch: raw.crunch, narrative: raw.narrative, fluff: raw.fluff,
      status: raw.status || 'draft', editorial_note: raw.editorial_note,
      publishers: (raw.publishers || []).map((p) => (typeof p === 'string' ? p : p.name)),
      genre_setting: raw.genre_setting || [], play_focus: raw.play_focus || [], campaign_type: raw.campaign_type || [],
      products: (raw.products || []).map((p) => ({
        title: p.title, product_type: p.product_type, binding: p.binding, edition: p.edition,
        language: p.language, isbn: p.isbn,
      })),
    };
  }
  return {
    title: raw.title, original_title: raw.original_title || null, language: raw.language || 'de',
    system_family: raw.system_family, edition: raw.edition || null,
    release_year: raw.release_year ? Number(raw.release_year) : null,
    short_description: raw.short_description, long_description: raw.long_description || null,
    crunch: raw.crunch || null, narrative: raw.narrative || null, fluff: raw.fluff || null,
    status: raw.status || 'draft',
    publishers: splitMulti(raw.publishers), genre_setting: splitMulti(raw.genre_setting),
    play_focus: splitMulti(raw.play_focus), campaign_type: splitMulti(raw.campaign_type),
    products: [],
  };
}

function rowIssues(payload, rowNumber) {
  const issues = [];
  const add = (severity, code, field, value, message) => issues.push({ row_number: rowNumber, severity, code, field, value: value == null ? null : String(value), message });

  if (!payload.title || !String(payload.title).trim()) add('error', 'missing_required_value', 'title', payload.title, 'Titel fehlt.');
  if (!payload.short_description || !String(payload.short_description).trim()) add('error', 'missing_required_value', 'short_description', payload.short_description, 'Kurzbeschreibung fehlt.');
  if (!payload.system_family || !String(payload.system_family).trim()) add('error', 'missing_required_value', 'system_family', payload.system_family, 'Systemfamilie fehlt.');
  if (!payload.publishers?.length) add('error', 'missing_required_value', 'publishers', '', 'Mindestens ein Verlag fehlt.');
  if (!payload.genre_setting?.length) add('error', 'missing_required_value', 'genre_setting', '', 'Mindestens ein Genre/Setting fehlt.');

  for (const key of ['crunch', 'narrative', 'fluff']) {
    const raw = payload[key];
    if (raw === null || raw === undefined || raw === '') continue;
    const n = Number(String(raw).replace(',', '.'));
    if (!Number.isFinite(n)) { add('error', 'invalid_numeric', key, raw, `${key} ist keine Zahl.`); continue; }
    if (n < 1 || n > 5 || Math.round(n * 2) !== n * 2) add('error', 'invalid_scale_step', key, raw, `${key} muss zwischen 1 und 5 in 0,5er-Schritten liegen.`);
    payload[key] = n;
  }
  if (payload.release_year) {
    const y = Number(payload.release_year);
    if (!Number.isInteger(y) || y < 1970 || y > 2100) add('warning', 'invalid_numeric', 'release_year', payload.release_year, 'Erscheinungsjahr wirkt unplausibel.');
  }
  for (const list of [payload.publishers, payload.genre_setting, payload.play_focus, payload.campaign_type]) {
    const seen = new Set();
    for (const v of list || []) {
      const key = v.toLowerCase();
      if (seen.has(key)) add('warning', 'duplicate_value_in_row', null, v, `„${v}" ist in dieser Zeile doppelt angegeben.`);
      seen.add(key);
      if (!v) add('warning', 'empty_split_value', null, v, 'Leerer Wert nach dem Trennen gefunden.');
    }
  }
  return issues;
}

export async function stagingPreview({ filename, format, content }, actor) {
  if (!['csv', 'json'].includes(format)) throw httpError(400, 'Unbekanntes Importformat.');

  let rawRows = [];
  if (format === 'json') {
    let data;
    try { data = JSON.parse(content); } catch { throw httpError(400, 'Ungültiges JSON.'); }
    rawRows = Array.isArray(data) ? data : (data.games || []);
  } else {
    const table = parseCsv(content);
    if (!table.length) throw httpError(400, 'Leere CSV-Datei.');
    const header = table[0].map((h) => h.trim());
    rawRows = table.slice(1).filter((r) => r.some((c) => c !== '')).map((r) => {
      const obj = {};
      header.forEach((h, i) => { obj[h] = r[i]; });
      return obj;
    });
  }

  return withTransaction(async (client) => {
    const runR = await client.query(
      `INSERT INTO import_runs (source_name, source_format, rows_total) VALUES ($1,$2,$3) RETURNING id`,
      [filename, format, rawRows.length],
    );
    const runId = runR.rows[0].id;

    const preview = [];
    let rowsOk = 0, rowsFailed = 0;
    const allIssues = [];

    for (let i = 0; i < rawRows.length; i++) {
      const rowNumber = i + 1;
      await client.query(
        'INSERT INTO staging_games_raw (import_run_id, row_number, raw) VALUES ($1,$2,$3)',
        [runId, rowNumber, JSON.stringify(rawRows[i])],
      );
      const payload = normalizeRow(rawRows[i], format);
      const issues = rowIssues(payload, rowNumber);

      let possibleDup = [];
      if (payload.title && payload.short_description) {
        possibleDup = await findDuplicates({ title: payload.title, language: payload.language, edition: payload.edition });
        if (possibleDup.length) {
          issues.push({
            row_number: rowNumber, severity: possibleDup.some((d) => d.exact) ? 'warning' : 'info',
            code: 'possible_duplicate_game', field: 'title', value: payload.title,
            message: `Ähnlicher Eintrag existiert bereits: ${possibleDup.map((d) => d.title).join(', ')}`,
          });
        }
      }

      const hasError = issues.some((iss) => iss.severity === 'error');
      if (hasError) rowsFailed++; else rowsOk++;
      for (const iss of issues) {
        allIssues.push(iss);
        await client.query(
          `INSERT INTO import_issues (import_run_id, row_number, severity, code, field, value, message)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [runId, iss.row_number, iss.severity, iss.code, iss.field, iss.value, iss.message],
        );
      }
      preview.push({
        rowNumber, mode: 'insert', title: payload.title || '(ohne Titel)', language: payload.language || 'de',
        system_family: payload.system_family || '', crunch: payload.crunch, narrative: payload.narrative, fluff: payload.fluff,
        products: (payload.products || []).length, hasError, payload,
      });
    }

    await client.query('UPDATE import_runs SET rows_ok=$1, rows_failed=$2, finished_at=now() WHERE id=$3', [rowsOk, rowsFailed, runId]);
    await logAudit(client, { actor, action: 'import', entity: 'import_runs', entityId: runId, diff: { filename, rowsOk, rowsFailed } });

    return { runId, filename, rowsTotal: rawRows.length, rowsOk, rowsFailed, issues: allIssues, preview };
  });
}

export async function getImportRun(runId) {
  const run = await pool.query('SELECT * FROM import_runs WHERE id=$1', [runId]);
  if (!run.rowCount) throw httpError(404, 'Importlauf nicht gefunden.');
  const issues = await pool.query('SELECT * FROM import_issues WHERE import_run_id=$1 ORDER BY row_number', [runId]);
  const staged = await pool.query('SELECT * FROM staging_games_raw WHERE import_run_id=$1 ORDER BY row_number', [runId]);
  return { run: run.rows[0], issues: issues.rows, staged: staged.rows };
}

export async function commitImport(runId, actor) {
  // createGame kapselt eigene Transaktionen -- hier daher außerhalb einer
  // umgebenden Transaktion sequenziell aufgerufen, Zeilen mit Fehlern
  // werden übersprungen.
  const { createGame } = await import('./catalog.js');
  const run = await pool.query('SELECT * FROM import_runs WHERE id=$1', [runId]);
  if (!run.rowCount) throw httpError(404, 'Importlauf nicht gefunden.');
  if (run.rows[0].committed) throw httpError(409, 'Dieser Importlauf wurde bereits übernommen.');

  const staged = await pool.query('SELECT * FROM staging_games_raw WHERE import_run_id=$1 ORDER BY row_number', [runId]);
  const errorRows = new Set((await pool.query(
    `SELECT DISTINCT row_number FROM import_issues WHERE import_run_id=$1 AND severity='error'`, [runId],
  )).rows.map((r) => r.row_number));

  let inserted = 0, updated = 0;
  for (const row of staged.rows) {
    if (errorRows.has(row.row_number)) continue;
    const format = run.rows[0].source_format;
    const payload = normalizeRow(row.raw, format);
    const errors = validateGamePayload(payload, { forPublish: payload.status === 'published' });
    if (errors.length) continue;
    try {
      await createGame({ ...payload, confirmDuplicate: true }, actor);
      inserted++;
    } catch {
      // Zeile konnte nicht übernommen werden (z.B. Constraint-Verletzung) -- überspringen.
    }
  }

  await pool.query('UPDATE import_runs SET committed=true WHERE id=$1', [runId]);
  await logAudit(pool, { actor, action: 'import', entity: 'import_runs', entityId: runId, diff: { committed: true, inserted, updated } });
  return { inserted, updated };
}
