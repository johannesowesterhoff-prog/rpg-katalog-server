// RPG-Katalog -- Express-Server gegen die bestehende Neon-Datenbank.
import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

import { pool } from './src/db.js';
import {
  hasPassword, setPassword, checkPassword, issueToken, verifyToken,
  setSessionCookie, clearSessionCookie, attachAdminFlag, requireAdmin,
  loginRateLimit, csrfGuard,
  checkArchivePassword, setArchivePassword, hasArchivePassword,
  setArchiveCookie, clearArchiveCookie, requireArchiveAccess,
  hasArchiveAccess,
} from './src/auth.js';
import {
  listGames, getFacets, getGameBySlug, getGameById, getArchiveSlug, getMasterData, getWahlomatData, getStats, getPlaySessionLog,
  getDashboard, createGame, updateGame, setGameStatus,
  deleteGame, findDuplicates, masterConfig, createMasterEntry, renameMasterEntry,
  deleteMasterEntry, getAuditLog,
  listPlaySessions, getGameLookup, createPlaySession, updatePlaySession, deletePlaySession,
} from './src/catalog.js';
import { stagingPreview, getImportRun, commitImport } from './src/importer.js';
import { createGroup, getGroup, saveMember, removeMember } from './src/wahlomatGroups.js';
import {
  getCoverImage, getCoverMeta, setCoverFromUrl, setCoverFromUpload, updateCoverSettings, deleteCover,
  trimStoredCovers,
} from './src/covers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT) || 8140;
const NODE_ENV = process.env.NODE_ENV || 'development';

const app = express();
app.set('trust proxy', true); // korrekte req.ip hinter einem Proxy/Load-Balancer
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));

// ---------------------------------------------------------------- CORS
// Fix aus der Sicherheitsprüfung: NICHT jede Origin spiegeln. Erlaubt sind
// nur die eigene Origin (wird dynamisch aus dem Request-Host abgeleitet)
// plus optional konfigurierte zusätzliche Origins (z.B. eine
// *.pplx.app-Vorschau-URL) aus ALLOWED_ORIGINS.
const extraOrigins = new Set((process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean));

function isAllowedOrigin(origin, req) {
  if (!origin) return false;
  if (extraOrigins.has(origin)) return true;
  try {
    const o = new URL(origin);
    const selfHost = req.headers.host;
    if (o.host === selfHost) return true;
  } catch { /* ignore */ }
  return false;
}

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin, req)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

// -------------------------------------------------- Security-Response-Header
// WARN-Fix aus der Sicherheitsprüfung: Tiefenverteidigung ohne externe
// Helmet-Abhängigkeit.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  // Skripte/Verbindungen nur von hier; Inline-Styles bleiben erlaubt (style=""
  // wird im Frontend viel genutzt); Schriften von Fontshare; data:/blob: für
  // Favicon und Cover-Vorschau. Nach Entfernen des Fremdskripts aus index.html
  // gibt es kein Inline-JavaScript mehr.
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'", "script-src 'self'", "connect-src 'self'",
    "style-src 'self' 'unsafe-inline' https://api.fontshare.com", "font-src 'self' https://cdn.fontshare.com",
    "img-src 'self' data: blob:", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
  ].join('; '));
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  next();
});

// CSRF-Schutz (Origin-Allowlist) für alle mutierenden Methoden.
const allOrigins = { has: (o) => isAllowedOrigin(o, { headers: { host: null } }) || extraOrigins.has(o) };
app.use((req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  return csrfGuard({ has: (o) => isAllowedOrigin(o, req) })(req, res, next);
});

function asyncRoute(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// ----------------------------------------------------------- Öffentliche API
app.get('/api/games', attachAdminFlag, asyncRoute(async (req, res) => {
  res.json(await listGames(req.query, req.isAdmin));
}));

app.get('/api/facets', attachAdminFlag, asyncRoute(async (req, res) => {
  res.json(await getFacets(req.query, req.isAdmin));
}));

app.get('/api/games/:slug', attachAdminFlag, asyncRoute(async (req, res) => {
  const data = await getGameBySlug(req.params.slug, req.isAdmin);
  if (!data) return res.status(404).json({ error: 'Eintrag nicht gefunden.' });
  res.json(data);
}));

// Deep-Link ins private "Schwarze Regal" (separate PDF-Datenbank, siehe
// handoff_archive_link.md) -- archive_slug ist absichtlich NICHT Teil der
// öffentlichen /api/games/:slug-Antwort (s. getGameBySlug/gameDetailCte),
// sondern nur über diese eigens abgesicherte Route erreichbar.
app.get('/api/games/:slug/archive-link', requireArchiveAccess, asyncRoute(async (req, res) => {
  const archiveSlug = await getArchiveSlug(req.params.slug);
  if (archiveSlug === undefined) return res.status(404).json({ error: 'Eintrag nicht gefunden.' });
  res.json({ archive_slug: archiveSlug || null });
}));

// Coverbild eines Spiels. Mit ?v=<version> (so verlinken Karte und
// Detailseite) darf der Browser das Bild dauerhaft zwischenspeichern.
app.get('/api/games/:slug/cover', attachAdminFlag, asyncRoute(async (req, res) => {
  const img = await getCoverImage(req.params.slug, req.isAdmin);
  if (!img) return res.status(404).json({ error: 'Kein Coverbild vorhanden.' });
  res.setHeader('Content-Type', img.mime);
  res.setHeader('Cache-Control', req.query.v ? 'public, max-age=31536000, immutable' : 'public, max-age=300');
  res.end(img.data);
}));

app.get('/api/wahlomat.json', asyncRoute(async (_req, res) => {
  res.json(await getWahlomatData());
}));

// Wahlomat-Gruppen: öffentlich, daher mit einfachem Limit je IP gegen
// Massenanlage (Anlegen von Gruppen) bzw. Dauerfeuer (Einträge).
function simpleRateLimit(max, windowMs, message) {
  const hits = new Map();
  return (req, res, next) => {
    const ip = req.ip || 'unknown';
    const now = Date.now();
    const e = hits.get(ip);
    if (!e || now - e.start > windowMs) { hits.set(ip, { n: 1, start: now }); return next(); }
    e.n += 1;
    if (e.n > max) return res.status(429).json({ error: message });
    if (hits.size > 5000) hits.clear();
    next();
  };
}
const groupCreateLimit = simpleRateLimit(20, 60 * 60 * 1000, 'Zu viele neue Gruppen – bitte später noch einmal versuchen.');
const groupWriteLimit = simpleRateLimit(120, 10 * 60 * 1000, 'Zu viele Änderungen – bitte kurz warten.');
app.post('/api/wahlomat/groups', groupCreateLimit, asyncRoute(async (req, res) => {
  res.status(201).json(await createGroup(req.body));
}));
app.get('/api/wahlomat/groups/:id', asyncRoute(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(await getGroup(req.params.id));
}));
app.post('/api/wahlomat/groups/:id/members', groupWriteLimit, asyncRoute(async (req, res) => {
  res.json(await saveMember(req.params.id, req.body));
}));
app.delete('/api/wahlomat/groups/:id/members/:memberId', groupWriteLimit, asyncRoute(async (req, res) => {
  res.json(await removeMember(req.params.id, req.params.memberId, req.body));
}));

app.get('/api/stats.json', asyncRoute(async (_req, res) => {
  res.json(await getStats());
}));

app.get('/api/play-sessions.json', asyncRoute(async (_req, res) => {
  res.json(await getPlaySessionLog());
}));

app.get('/api/master-data', asyncRoute(async (_req, res) => {
  res.json(await getMasterData());
}));

// ----------------------------------------------------------------- Auth
app.get('/api/admin/setup-state', asyncRoute(async (_req, res) => {
  res.json({ needsSetup: !(await hasPassword()) });
}));

app.post('/api/admin/setup', asyncRoute(async (req, res) => {
  if (await hasPassword()) return res.status(409).json({ error: 'Es ist bereits ein Passwort gesetzt. Bitte anmelden.' });
  const { password } = req.body || {};
  if (!password || String(password).length < 10) return res.status(400).json({ error: 'Passwort muss mindestens 10 Zeichen haben.' });
  await setPassword(password);
  const token = issueToken();
  setSessionCookie(res, token);
  res.json({ token });
}));

app.post('/api/admin/login', loginRateLimit, asyncRoute(async (req, res) => {
  const { password } = req.body || {};
  const ok = password && await checkPassword(password);
  if (!ok) return res.status(401).json({ error: 'Passwort ist falsch.' });
  const token = issueToken();
  setSessionCookie(res, token);
  res.json({ token });
}));

app.post('/api/admin/logout', (req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get('/api/admin/session', attachAdminFlag, (req, res) => {
  res.json({ isAdmin: !!req.isAdmin, hasArchiveAccess: hasArchiveAccess(req), dbMode: 'postgres' });
});

app.post('/api/admin/password', requireAdmin, asyncRoute(async (req, res) => {
  const { current, password } = req.body || {};
  if (!(await checkPassword(current || ''))) return res.status(401).json({ error: 'Bisheriges Passwort ist falsch.' });
  if (!password || String(password).length < 10) return res.status(400).json({ error: 'Neues Passwort muss mindestens 10 Zeichen haben.' });
  await setPassword(password);
  const token = issueToken();
  setSessionCookie(res, token);
  res.json({ token });
}));

// ------------------------------------------------ Archiv-Login ("Schwarzes Regal")
// Eigenständiger, vom Admin-Login komplett unabhängiger Lesezugriff (siehe
// handoff_archive_link.md). Nur ein Admin darf das Archiv-Passwort setzen
// (unten), aber jeder, der es kennt, darf danach nur lesen -- keinerlei
// Schreibrechte auf den Katalog.
app.get('/api/admin/archive-password/state', requireAdmin, asyncRoute(async (_req, res) => {
  res.json({ isSet: await hasArchivePassword() });
}));

app.post('/api/admin/archive-password', requireAdmin, asyncRoute(async (req, res) => {
  const { password } = req.body || {};
  if (!password || String(password).length < 10) return res.status(400).json({ error: 'Passwort muss mindestens 10 Zeichen haben.' });
  await setArchivePassword(password);
  res.json({ ok: true });
}));

app.post('/api/archive/login', loginRateLimit, asyncRoute(async (req, res) => {
  const { password } = req.body || {};
  const ok = password && await checkArchivePassword(password);
  if (!ok) return res.status(401).json({ error: 'Passwort ist falsch.' });
  const token = issueToken('archive');
  setArchiveCookie(res, token);
  res.json({ token });
}));

app.post('/api/archive/logout', (req, res) => {
  clearArchiveCookie(res);
  res.json({ ok: true });
});

// ------------------------------------------------------------- Admin-API
app.get('/api/admin/dashboard', requireAdmin, asyncRoute(async (_req, res) => res.json(await getDashboard())));
app.get('/api/admin/games/:id', requireAdmin, asyncRoute(async (req, res) => {
  const g = await getGameById(req.params.id);
  if (!g) return res.status(404).json({ error: 'Eintrag nicht gefunden.' });
  res.json({ game: g });
}));
app.get('/api/admin/duplicates', requireAdmin, asyncRoute(async (req, res) => {
  const { title, language, edition, excludeId } = req.query;
  res.json({ duplicates: await findDuplicates({ title, language, edition, excludeId }) });
}));

app.post('/api/games', requireAdmin, asyncRoute(async (req, res) => {
  try {
    const r = await createGame(req.body || {}, 'admin');
    res.status(201).json(r);
  } catch (err) { throw err; }
}));
app.patch('/api/games/:id', requireAdmin, asyncRoute(async (req, res) => {
  res.json(await updateGame(req.params.id, req.body || {}, 'admin'));
}));
app.patch('/api/games/:id/status', requireAdmin, asyncRoute(async (req, res) => {
  res.json(await setGameStatus(req.params.id, req.body?.status, 'admin'));
}));
app.delete('/api/games/:id', requireAdmin, asyncRoute(async (req, res) => {
  res.json(await deleteGame(req.params.id, req.query.force === '1', 'admin'));
}));

app.post('/api/admin/master-data/:kind', requireAdmin, asyncRoute(async (req, res) => {
  masterConfig(req.params.kind);
  res.status(201).json(await createMasterEntry(req.params.kind, req.body?.name, req.body?.tagKind, 'admin'));
}));
app.patch('/api/admin/master-data/:kind/:id', requireAdmin, asyncRoute(async (req, res) => {
  res.json(await renameMasterEntry(req.params.kind, req.params.id, req.body?.name, 'admin'));
}));
app.delete('/api/admin/master-data/:kind/:id', requireAdmin, asyncRoute(async (req, res) => {
  await deleteMasterEntry(req.params.kind, req.params.id, 'admin');
  res.json({ ok: true });
}));

app.post('/api/admin/import', requireAdmin, asyncRoute(async (req, res) => {
  res.json(await stagingPreview(req.body || {}, 'admin'));
}));
app.get('/api/admin/import/:runId', requireAdmin, asyncRoute(async (req, res) => {
  res.json(await getImportRun(req.params.runId));
}));
app.post('/api/admin/import/:runId/commit', requireAdmin, asyncRoute(async (req, res) => {
  res.json(await commitImport(req.params.runId, 'admin'));
}));

app.get('/api/admin/export.json', requireAdmin, asyncRoute(async (_req, res) => {
  const games = await pool.query(`
    SELECT g.*, l.code AS language, sf.name AS system_family
    FROM katalog.games g JOIN katalog.languages l ON l.id=g.language_id JOIN katalog.system_families sf ON sf.id=g.system_family_id
    ORDER BY g.title`);
  const full = [];
  for (const g of games.rows) {
    const [publishers, tags, products] = await Promise.all([
      pool.query(`SELECT p.name, gp.is_primary FROM katalog.game_publishers gp JOIN katalog.publishers p ON p.id=gp.publisher_id WHERE gp.game_id=$1`, [g.id]),
      pool.query(`SELECT t.kind, t.name FROM katalog.game_tags gt JOIN katalog.tags t ON t.id=gt.tag_id WHERE gt.game_id=$1`, [g.id]),
      pool.query(`SELECT pr.title, pt.name AS product_type, pr.binding, pr.edition, l.code AS language, pr.isbn, pr.sort_order
        FROM katalog.products pr JOIN katalog.product_types pt ON pt.id=pr.product_type_id LEFT JOIN katalog.languages l ON l.id=pr.language_id
        WHERE pr.game_id=$1 ORDER BY pr.sort_order`, [g.id]),
    ]);
    full.push({
      slug: g.slug, title: g.title, original_title: g.original_title, sort_title: g.sort_title,
      language: g.language, system_family: g.system_family, edition: g.edition, release_year: g.release_year,
      short_description: g.short_description, long_description: g.long_description,
      crunch: g.crunch, narrative: g.narrative, fluff: g.fluff, status: g.status, editorial_note: g.editorial_note,
      wahlomat_profile: g.wahlomat_profile,
      publishers: publishers.rows,
      genre_setting_top: tags.rows.filter((t) => t.kind === 'genre_setting_top').map((t) => t.name),
      genre_setting: tags.rows.filter((t) => t.kind === 'genre_setting').map((t) => t.name),
      play_focus: tags.rows.filter((t) => t.kind === 'play_focus').map((t) => t.name),
      campaign_type: tags.rows.filter((t) => t.kind === 'campaign_type').map((t) => t.name),
      tone_theme_top: tags.rows.filter((t) => t.kind === 'tone_theme_top').map((t) => t.name),
      tone_theme: tags.rows.filter((t) => t.kind === 'tone_theme').map((t) => t.name),
      products: products.rows,
    });
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="rpg-katalog-export.json"');
  res.send(JSON.stringify({ schema_version: '2.0', exported_at: new Date().toISOString(), games: full }, null, 2));
}));

app.get('/api/admin/export.csv', requireAdmin, asyncRoute(async (_req, res) => {
  const games = await pool.query(`
    SELECT g.*, l.code AS language, sf.name AS system_family
    FROM katalog.games g JOIN katalog.languages l ON l.id=g.language_id JOIN katalog.system_families sf ON sf.id=g.system_family_id
    ORDER BY g.title`);
  const header = ['title', 'original_title', 'language', 'system_family', 'edition', 'release_year',
    'short_description', 'long_description', 'crunch', 'narrative', 'fluff', 'status',
    'publishers', 'genre_setting_top', 'genre_setting', 'play_focus', 'campaign_type', 'tone_theme_top', 'tone_theme'];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [header.join(';')];
  for (const g of games.rows) {
    const [publishers, tags] = await Promise.all([
      pool.query(`SELECT p.name FROM katalog.game_publishers gp JOIN katalog.publishers p ON p.id=gp.publisher_id WHERE gp.game_id=$1 ORDER BY gp.is_primary DESC`, [g.id]),
      pool.query(`SELECT t.kind, t.name FROM katalog.game_tags gt JOIN katalog.tags t ON t.id=gt.tag_id WHERE gt.game_id=$1`, [g.id]),
    ]);
    const row = [
      g.title, g.original_title, g.language, g.system_family, g.edition, g.release_year,
      g.short_description, g.long_description, g.crunch, g.narrative, g.fluff, g.status,
      publishers.rows.map((p) => p.name).join('|'),
      tags.rows.filter((t) => t.kind === 'genre_setting_top').map((t) => t.name).join('|'),
      tags.rows.filter((t) => t.kind === 'genre_setting').map((t) => t.name).join('|'),
      tags.rows.filter((t) => t.kind === 'play_focus').map((t) => t.name).join('|'),
      tags.rows.filter((t) => t.kind === 'campaign_type').map((t) => t.name).join('|'),
      tags.rows.filter((t) => t.kind === 'tone_theme_top').map((t) => t.name).join('|'),
      tags.rows.filter((t) => t.kind === 'tone_theme').map((t) => t.name).join('|'),
    ];
    lines.push(row.map(esc).join(';'));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="rpg-katalog-export.csv"');
  res.send(lines.join('\r\n'));
}));

app.get('/api/admin/audit', requireAdmin, asyncRoute(async (req, res) => {
  res.json({ entries: await getAuditLog(Number(req.query.limit) || 120) });
}));

app.get('/api/admin/play-sessions', requireAdmin, asyncRoute(async (_req, res) => {
  res.json({ sessions: await listPlaySessions() });
}));
// CSV-Export aller Spielabende für Excel/Google Sheets: Semikolon als
// Trenner und UTF-8-BOM, damit Excel Umlaute richtig liest. Enthält auch
// Mitspieler:innen und Rolle (nur für Admins).
app.get('/api/admin/play-sessions.csv', requireAdmin, asyncRoute(async (_req, res) => {
  const sessions = await listPlaySessions();
  const label = {
    role: { spielleiter: 'Spielleiter:in', spieler: 'Spieler:in' },
    play_mode: { 'am-tisch': 'Am Tisch', online: 'Online' },
    campaign_status: { laufend: 'laufend', abgeschlossen: 'abgeschlossen' },
    campaign_kind: { 'one-shot': 'One-Shot (Two-Shot)', 'few-shot': 'Few-Shot', kampagne: 'Kampagne', 'epische-kampagne': 'Epische Kampagne', 'sandbox-szenarien': 'Sandbox-Szenarien' },
  };
  const header = ['Datum', 'Spiel', 'Im Katalog', 'Kampagne', 'Kampagnenart', 'Kampagnenstatus', 'Session-Nr.',
    'Spielform', 'Rolle', 'Mitspieler:innen', 'Notiz', 'Zusammenfassung', 'Aushang'];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = [header.join(';')];
  for (const s of sessions) {
    lines.push([
      s.played_on, s.game_title || s.external_title, s.game_id ? 'ja' : 'nein', s.campaign,
      label.campaign_kind[s.campaign_kind], label.campaign_status[s.campaign_status], s.session_number,
      label.play_mode[s.play_mode], label.role[s.role], s.participants, s.note, s.summary_url, s.campaign_announcement_url,
    ].map(esc).join(';'));
  }
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="rpg-katalog-spielabende.csv"');
  res.send('\uFEFF' + lines.join('\r\n'));
}));
app.get('/api/admin/games-lookup', requireAdmin, asyncRoute(async (_req, res) => {
  res.json({ games: await getGameLookup() });
}));
app.post('/api/admin/play-sessions', requireAdmin, asyncRoute(async (req, res) => {
  res.status(201).json(await createPlaySession(req.body || {}, 'admin'));
}));
app.patch('/api/admin/play-sessions/:id', requireAdmin, asyncRoute(async (req, res) => {
  res.json(await updatePlaySession(req.params.id, req.body || {}, 'admin'));
}));
app.get('/api/admin/games/:id/cover', requireAdmin, asyncRoute(async (req, res) => {
  res.json({ cover: await getCoverMeta(req.params.id) });
}));
app.post('/api/admin/games/:id/cover', requireAdmin, asyncRoute(async (req, res) => {
  res.json({ cover: await setCoverFromUrl(req.params.id, req.body?.url, 'admin') });
}));
// Upload: Bilddatei direkt als Request-Body (Content-Type image/*) --
// umgeht das 2-MB-Limit des globalen JSON-Parsers.
app.put('/api/admin/games/:id/cover', requireAdmin, express.raw({ type: ['image/*', 'application/octet-stream'], limit: '13mb' }), asyncRoute(async (req, res) => {
  res.json({ cover: await setCoverFromUpload(req.params.id, Buffer.isBuffer(req.body) ? req.body : null, 'admin') });
}));
app.patch('/api/admin/games/:id/cover', requireAdmin, asyncRoute(async (req, res) => {
  res.json({ cover: await updateCoverSettings(req.params.id, req.body || {}, 'admin') });
}));
app.delete('/api/admin/games/:id/cover', requireAdmin, asyncRoute(async (req, res) => {
  await deleteCover(req.params.id, 'admin');
  res.json({ cover: null });
}));
app.post('/api/admin/covers/trim', requireAdmin, asyncRoute(async (_req, res) => {
  res.json(await trimStoredCovers('admin'));
}));

app.delete('/api/admin/play-sessions/:id', requireAdmin, asyncRoute(async (req, res) => {
  await deletePlaySession(req.params.id, 'admin');
  res.json({ ok: true });
}));

// -------------------------------------------------------- Fehlerbehandlung
app.use('/api', (err, req, res, _next) => {
  // eslint-disable-next-line no-console
  console.error(err);
  const status = err.status || 500;
  const body = { error: err.type === 'entity.too.large' ? 'Die Datei ist zu groß.' : (err.message || 'Serverfehler.') };
  if (err.errors) body.errors = err.errors;
  if (err.duplicates) { body.duplicates = err.duplicates; body.blocking = !!err.blocking; }
  res.status(status).json(body);
});

// ------------------------------------------------------- robots / sitemap
app.get('/robots.txt', (_req, res) => {
  res.type('text/plain').send('User-agent: *\nDisallow: /admin\nDisallow: /api/admin\n');
});

app.get('/sitemap.xml', asyncRoute(async (req, res) => {
  const r = await pool.query(`SELECT slug, updated_at FROM katalog.games WHERE status='published' ORDER BY slug`);
  const base = `${req.protocol}://${req.headers.host}`;
  const urls = r.rows.map((g) => `<url><loc>${base}/spiele/${g.slug}</loc><lastmod>${g.updated_at.toISOString().slice(0, 10)}</lastmod></url>`).join('');
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`);
}));

// --------------------------------------------------------- Statische Dateien
app.use(express.static(PUBLIC_DIR, { index: false }));

const INDEX_HTML = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
// Für die Spiel-Detailseiten ohne die statischen Titel-/Beschreibungs-Tags:
// Vorher kamen og:title und <title> doppelt vor, und Link-Vorschauen zeigten
// "RPG-Katalog" statt des Spieltitels.
const INDEX_HTML_SSR = INDEX_HTML
  .replace(/<title>[\s\S]*?<\/title>\s*/, '')
  .replace(/<meta name="description"[^>]*>\s*/, '')
  .replace(/<meta property="og:(?:title|description)"[^>]*>\s*/g, '');
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Absolute URLs für Link-Vorschauen (WhatsApp, Signal, Discord usw. brauchen
// sie absolut). Spielseiten mit Cover nehmen das Cover, sonst das Standardbild.
const previewMeta = (base, url, image) => `
    <meta property="og:site_name" content="RPG-Katalog">
    <meta property="og:locale" content="de_DE">
    <meta property="og:url" content="${esc(url)}">
    <meta property="og:image" content="${esc(image || `${base}/og-image.png`)}">${image ? '' : `
    <meta property="og:image:width" content="1200">
    <meta property="og:image:height" content="630">
    <meta property="og:image:alt" content="RPG-Katalog – Rollenspiel-Sammlung mit Einordnung nach Crunch, Narrativ und Fluff">`}
    <meta name="twitter:card" content="summary_large_image">`;
const sendIndex = (req, res) => {
  const base = `${req.protocol}://${req.headers.host}`;
  res.type('html').send(INDEX_HTML.replace('<!--SSR_META-->', previewMeta(base, `${base}/`)));
};

// SSR-Meta für einzelne Spiel-Detailseiten (Open-Graph-Tags für Social-Previews).
app.get('/spiele/:slug', asyncRoute(async (req, res) => {
  const data = await getGameBySlug(req.params.slug, false);
  if (!data) return sendIndex(req, res.status(404));
  const g = data.game;
  const base = `${req.protocol}://${req.headers.host}`;
  const meta = `
    <title>${esc(g.title)} – RPG-Katalog</title>
    <meta name="description" content="${esc(g.short_description)}">
    <meta property="og:title" content="${esc(g.title)}">
    <meta property="og:description" content="${esc(g.short_description)}">
    ${previewMeta(base, `${base}/spiele/${g.slug}`, g.cover ? `${base}/api/games/${g.slug}/cover?v=${g.cover.v}` : null)}`;
  res.type('html').send(INDEX_HTML_SSR.replace('<!--SSR_META-->', meta));
}));

// Alle übrigen Adminbereich-/App-Routen liefern die SPA-Shell aus.
app.get(['/admin', '/admin/*splat', '/spiele'], sendIndex);
app.get('/', sendIndex);

// Letzter Fehlerfänger für Seitenrouten: knappe HTML-Seite statt Express-
// Standardseite, nichts aus der Fehlermeldung nach außen.
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  // eslint-disable-next-line no-console
  console.error(err);
  res.status(err.status || 500).type('html').send('<!doctype html><html lang="de"><meta charset="utf-8"><title>Fehler – RPG-Katalog</title><body style="font-family:system-ui;padding:2rem"><h1>Da ist etwas schiefgelaufen.</h1><p><a href="/">Zurück zum Katalog</a></p></body></html>');
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`RPG-Katalog-Server läuft auf http://localhost:${PORT} (${NODE_ENV})`);
});
