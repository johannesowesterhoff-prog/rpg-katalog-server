// Coverbilder pro Spiel (Tabelle katalog.game_covers).
//
// Ein Cover wird entweder per URL übernommen oder hochgeladen. In beiden
// Fällen speichern wir eine verkleinerte WebP-Kopie in der Datenbank --
// Render (Free) hat keinen dauerhaften Speicher, und reine Links auf fremde
// Seiten brechen mit der Zeit weg oder werden per Hotlink-Schutz blockiert.
//
// Ist nur source_url gesetzt (data IS NULL, z. B. per SQL vorbefüllt), wird
// das Bild beim ersten Abruf nachgeladen und dann dauerhaft gespeichert.
import dns from 'node:dns/promises';
import net from 'node:net';
import sharp from 'sharp';
import { pool } from './db.js';
import { logAudit } from './catalog.js';

const MAX_BYTES = 12 * 1024 * 1024;
const MAX_EDGE = 800;
const FETCH_TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 4;
export const COVER_FITS = ['auto', 'cover', 'contain'];

class CoverError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7));
  return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe80');
}

async function assertPublicUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new CoverError('Die Bild-Adresse ist keine gültige URL.'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new CoverError('Nur http- und https-Adressen sind erlaubt.');
  const addrs = await dns.lookup(url.hostname, { all: true }).catch(() => []);
  if (!addrs.length) throw new CoverError('Der Server der Bild-Adresse wurde nicht gefunden.');
  if (addrs.some((a) => isPrivateAddress(a.address))) throw new CoverError('Diese Adresse ist nicht erlaubt.');
  return url;
}

// Lädt ein Bild von einer öffentlichen Adresse. Weiterleitungen werden von
// Hand verfolgt, damit auch jedes Weiterleitungsziel geprüft wird.
export async function fetchImage(rawUrl) {
  let url = await assertPublicUrl(rawUrl);
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    let res;
    try {
      res = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; rpg-katalog/1.0; +https://rpg-katalog-live.onrender.com)', Accept: 'image/*,*/*;q=0.5' },
      });
    } catch {
      throw new CoverError('Das Bild konnte nicht geladen werden (Zeitüberschreitung oder Verbindungsfehler).', 502);
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = await assertPublicUrl(new URL(res.headers.get('location'), url).href);
      continue;
    }
    if (!res.ok) throw new CoverError(`Das Bild konnte nicht geladen werden (HTTP ${res.status}).`, 502);
    const len = Number(res.headers.get('content-length') || 0);
    if (len > MAX_BYTES) throw new CoverError('Das Bild ist größer als 12 MB.');
    const chunks = [];
    let total = 0;
    for await (const chunk of res.body) {
      total += chunk.length;
      if (total > MAX_BYTES) throw new CoverError('Das Bild ist größer als 12 MB.');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  throw new CoverError('Zu viele Weiterleitungen.', 502);
}

export async function processImage(buffer) {
  try {
    const { data, info } = await sharp(buffer, { limitInputPixels: 60_000_000 })
      .rotate()
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height, mime: 'image/webp' };
  } catch {
    throw new CoverError('Die Datei ist kein lesbares Bild (erlaubt: JPG, PNG, WebP, GIF, AVIF).');
  }
}

async function storeImage(gameId, img, sourceUrl) {
  await pool.query(
    `INSERT INTO katalog.game_covers (game_id, source_url, mime, width, height, data, fetch_error, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NULL, now())
     ON CONFLICT (game_id) DO UPDATE SET source_url = EXCLUDED.source_url, mime = EXCLUDED.mime,
       width = EXCLUDED.width, height = EXCLUDED.height, data = EXCLUDED.data, fetch_error = NULL, updated_at = now()`,
    [gameId, sourceUrl, img.mime, img.width, img.height, img.data],
  );
}

async function assertGame(gameId) {
  const r = await pool.query('SELECT id FROM katalog.games WHERE id = $1', [gameId]);
  if (!r.rowCount) throw new CoverError('Eintrag nicht gefunden.', 404);
}

export async function getCoverMeta(gameId) {
  const r = await pool.query(
    `SELECT source_url, width, height, fit, focus_y, fetch_error, data IS NOT NULL AS stored,
            extract(epoch from updated_at)::bigint AS v
     FROM katalog.game_covers WHERE game_id = $1`, [gameId],
  );
  return r.rows[0] || null;
}

export async function setCoverFromUrl(gameId, url, actor) {
  await assertGame(gameId);
  const img = await processImage(await fetchImage(String(url || '').trim()));
  await storeImage(gameId, img, String(url).trim());
  await logAudit(pool, { actor, action: 'update', entity: 'game_covers', entityId: gameId, diff: { source_url: url } });
  return getCoverMeta(gameId);
}

export async function setCoverFromUpload(gameId, buffer, actor) {
  await assertGame(gameId);
  if (!buffer?.length) throw new CoverError('Es wurde keine Bilddatei übermittelt.');
  if (buffer.length > MAX_BYTES) throw new CoverError('Das Bild ist größer als 12 MB.');
  const img = await processImage(buffer);
  await storeImage(gameId, img, null);
  await logAudit(pool, { actor, action: 'update', entity: 'game_covers', entityId: gameId, diff: { upload: true } });
  return getCoverMeta(gameId);
}

export async function updateCoverSettings(gameId, { fit, focus_y: focusY }, actor) {
  if (fit !== undefined && !COVER_FITS.includes(fit)) throw new CoverError('Unbekannte Darstellung.');
  const y = focusY === undefined ? undefined : Math.round(Number(focusY));
  if (y !== undefined && !(y >= 0 && y <= 100)) throw new CoverError('Der Bildausschnitt muss zwischen 0 und 100 liegen.');
  const r = await pool.query(
    `UPDATE katalog.game_covers SET fit = COALESCE($2, fit), focus_y = COALESCE($3, focus_y), updated_at = now()
     WHERE game_id = $1`, [gameId, fit ?? null, y ?? null],
  );
  if (!r.rowCount) throw new CoverError('Für diesen Eintrag ist noch kein Cover hinterlegt.', 404);
  await logAudit(pool, { actor, action: 'update', entity: 'game_covers', entityId: gameId, diff: { fit, focus_y: y } });
  return getCoverMeta(gameId);
}

export async function deleteCover(gameId, actor) {
  await pool.query('DELETE FROM katalog.game_covers WHERE game_id = $1', [gameId]);
  await logAudit(pool, { actor, action: 'delete', entity: 'game_covers', entityId: gameId, diff: null });
}

// Laufende Nachlade-Vorgänge, damit parallele Aufrufe dasselbe Bild nicht
// mehrfach holen.
const pending = new Map();

async function fillFromSource(gameId, sourceUrl) {
  if (pending.has(gameId)) return pending.get(gameId);
  const job = (async () => {
    try {
      const img = await processImage(await fetchImage(sourceUrl));
      await storeImage(gameId, img, sourceUrl);
      return img;
    } catch (e) {
      await pool.query('UPDATE katalog.game_covers SET fetch_error = $2 WHERE game_id = $1', [gameId, e.message]);
      return null;
    } finally {
      pending.delete(gameId);
    }
  })();
  pending.set(gameId, job);
  return job;
}

/** Bilddaten für die öffentliche Auslieferung (nur veröffentlichte Spiele, außer für Admins). */
export async function getCoverImage(slug, isAdmin) {
  const r = await pool.query(
    `SELECT g.id, g.status, gc.source_url, gc.mime, gc.data, gc.fetch_error,
            extract(epoch from gc.updated_at)::bigint AS v
     FROM katalog.games g JOIN katalog.game_covers gc ON gc.game_id = g.id
     WHERE g.slug = $1`, [slug],
  );
  const row = r.rows[0];
  if (!row || (row.status !== 'published' && !isAdmin)) return null;
  if (row.data) return { data: row.data, mime: row.mime, v: row.v };
  if (!row.source_url || row.fetch_error) return null;
  const img = await fillFromSource(row.id, row.source_url);
  return img ? { data: img.data, mime: img.mime, v: row.v } : null;
}

export { CoverError };
