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
} from './src/auth.js';
import {
  listGames, getFacets, getGameBySlug, getGameById, getMasterData,
  getDashboard, getFluffQueue, setFluff, createGame, updateGame, setGameStatus,
  deleteGame, findDuplicates, masterConfig, createMasterEntry, renameMasterEntry,
  deleteMasterEntry, getAuditLog,
} from './src/catalog.js';
import { stagingPreview, getImportRun, commitImport } from './src/importer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT) || 8140;
const NODE_ENV = process.env.NODE_ENV || 'development';

const app = express();
app.set('trust proxy', true); // korrekte req.ip hinter einem Proxy/Load-Balancer
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
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
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
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  next();
});

// CSRF-Schutz (Origin-Allowlist) für alle mutierenden Methoden.
const allOrigins = { has: (o) => isAllowedOrigin(o, { headers: { host: null } }) || extraOrigins.has(o) };
app.use((req, res, next) => {
  if (!['POST', 'PATCH', 'DELETE'].includes(req.method)) return next();
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
  res.json({ isAdmin: !!req.isAdmin, dbMode: 'postgres' });
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

// ------------------------------------------------------------- Admin-API
app.get('/api/admin/dashboard', requireAdmin, asyncRoute(async (_req, res) => res.json(await getDashboard())));
app.get('/api/admin/fluff-queue', requireAdmin, asyncRoute(async (_req, res) => res.json({ games: await getFluffQueue() })));
app.patch('/api/admin/games/:id/fluff', requireAdmin, asyncRoute(async (req, res) => {
  res.json(await setFluff(req.params.id, req.body?.fluff, 'admin'));
}));
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

// -------------------------------------------------------- Fehlerbehandlung
app.use('/api', (err, req, res, _next) => {
  // eslint-disable-next-line no-console
  console.error(err);
  const status = err.status || 500;
  const body = { error: err.message || 'Serverfehler.' };
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
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// SSR-Meta für einzelne Spiel-Detailseiten (Open-Graph-Tags für Social-Previews).
app.get('/spiele/:slug', asyncRoute(async (req, res) => {
  const data = await getGameBySlug(req.params.slug, false);
  if (!data) return res.status(404).type('html').send(INDEX_HTML);
  const g = data.game;
  const meta = `
    <meta property="og:title" content="${esc(g.title)}">
    <meta property="og:description" content="${esc(g.short_description)}">
    <title>${esc(g.title)} – RPG-Katalog</title>`;
  res.type('html').send(INDEX_HTML.replace('<!--SSR_META-->', meta));
}));

// Alle übrigen Adminbereich-/App-Routen liefern die SPA-Shell aus.
app.get(['/admin', '/admin/*splat', '/spiele'], (_req, res) => {
  res.type('html').send(INDEX_HTML);
});
app.get('/', (_req, res) => res.type('html').send(INDEX_HTML));

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`RPG-Katalog-Server läuft auf http://localhost:${PORT} (${NODE_ENV})`);
});
