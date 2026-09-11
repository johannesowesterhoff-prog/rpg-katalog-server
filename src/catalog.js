// Katalog-Queries: öffentliche Suche/Facetten/Detail sowie administrative
// CRUD-Operationen auf Spielen, Produkten und Stammdaten.
import { pool, withTransaction } from './db.js';
import { parseFilters, buildWhere, gameDetailCte, CARD_COLUMNS, SORTS, PAGE_SIZE } from './filters.js';

// ------------------------------------------------------------- Hilfsfunktionen
export function slugify(text) {
  return String(text)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // Akzente entfernen
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
}

function toScale(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function uniqueSlug(client, baseSlug, excludeId = null) {
  let slug = baseSlug || 'eintrag';
  let n = 2;
  for (;;) {
    const r = await client.query(
      excludeId
        ? 'SELECT 1 FROM katalog.games WHERE slug = $1 AND id <> $2'
        : 'SELECT 1 FROM katalog.games WHERE slug = $1',
      excludeId ? [slug, excludeId] : [slug],
    );
    if (!r.rowCount) return slug;
    slug = `${baseSlug}-${n++}`;
  }
}

/** Sucht (per Name, case-insensitive) oder legt einen Stammdaten-Datensatz an. */
async function resolveOrCreate(client, table, name) {
  const trimmed = String(name).trim();
  const r = await client.query(`SELECT id FROM katalog.${table} WHERE lower(name) = lower($1)`, [trimmed]);
  if (r.rowCount) return r.rows[0].id;
  const slug = slugify(trimmed);
  const ins = await client.query(
    `INSERT INTO katalog.${table} (name, slug) VALUES ($1, $2) ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug RETURNING id`,
    [trimmed, slug || `wert-${Date.now()}`],
  );
  return ins.rows[0].id;
}

async function resolveOrCreateTag(client, kind, name) {
  const trimmed = String(name).trim();
  const r = await client.query('SELECT id FROM katalog.tags WHERE kind = $1 AND lower(name) = lower($2)', [kind, trimmed]);
  if (r.rowCount) return r.rows[0].id;
  const slug = slugify(trimmed);
  const ins = await client.query(
    `INSERT INTO katalog.tags (kind, name, slug) VALUES ($1, $2, $3)
     ON CONFLICT (kind, slug) DO UPDATE SET slug = EXCLUDED.slug RETURNING id`,
    [kind, trimmed, slug || `tag-${Date.now()}`],
  );
  return ins.rows[0].id;
}

async function languageIdByCode(client, code) {
  const r = await client.query('SELECT id FROM katalog.languages WHERE code = $1', [code]);
  if (!r.rowCount) throw httpError(400, `Unbekannter Sprachcode „${code}".`);
  return r.rows[0].id;
}

function httpError(status, message, extra = {}) {
  const e = new Error(message);
  e.status = status;
  Object.assign(e, extra);
  return e;
}

const SEARCH_VECTOR_EXPR = `
  setweight(to_tsvector('german', coalesce($TITLE,'')), 'A') ||
  setweight(to_tsvector('german', coalesce($ORIG,'')), 'B') ||
  setweight(to_tsvector('german', coalesce($SHORT,'')), 'C') ||
  setweight(to_tsvector('german', coalesce($LONG,'')), 'D')
`;

// -------------------------------------------------------------- Validierung
export function validateGamePayload(payload, { forPublish }) {
  const errors = [];
  const push = (field, message) => errors.push({ field, message });

  const title = (payload.title || '').trim();
  if (title.length < 2 || title.length > 200) push('title', 'Titel muss 2–200 Zeichen lang sein.');

  const desc = (payload.short_description || '').trim();
  if (desc.length < 10 || desc.length > 400) push('short_description', 'Kurzbeschreibung muss 10–400 Zeichen lang sein.');

  if (!payload.system_family || !String(payload.system_family).trim()) push('system_family', 'Systemfamilie ist Pflicht.');
  if (!Array.isArray(payload.publishers) || !payload.publishers.length) push('publishers', 'Mindestens ein Verlag ist Pflicht.');
  if (!Array.isArray(payload.genre_setting) || !payload.genre_setting.length) push('genre_setting', 'Mindestens ein Genre/Setting ist Pflicht.');

  for (const key of ['crunch', 'narrative', 'fluff']) {
    const v = toScale(payload[key]);
    if (v !== null && (v < 1 || v > 5 || Math.round(v * 2) !== v * 2)) {
      push(key, `${key} muss zwischen 1 und 5 in 0,5er-Schritten liegen.`);
    }
  }
  if (payload.release_year) {
    const y = Number(payload.release_year);
    if (!Number.isInteger(y) || y < 1970 || y > 2100) push('release_year', 'Erscheinungsjahr muss zwischen 1970 und 2100 liegen.');
  }
  const status = payload.status || 'draft';
  if (!['draft', 'published', 'archived'].includes(status)) push('status', 'Ungültiger Status.');
  if (status === 'published' && (toScale(payload.crunch) === null || toScale(payload.narrative) === null)) {
    push('status', 'Zum Veröffentlichen müssen Crunch und Narrativ gesetzt sein.');
  }
  for (const prod of payload.products || []) {
    if (prod.title && prod.title.trim().length > 200) push('products', `Produkttitel „${prod.title}" ist zu lang.`);
    if (prod.isbn && !/^[0-9Xx-]{10,17}$/.test(prod.isbn)) push('products', `ISBN „${prod.isbn}" hat ein ungültiges Format.`);
  }
  return errors;
}

// -------------------------------------------------------------- Duplikate
export async function findDuplicates({ title, language, edition, excludeId }) {
  if (!title) return [];
  const norm = title.trim().toLowerCase();
  const editionNorm = (edition || '').trim().toLowerCase();
  const params = [norm, language || 'de', editionNorm];
  let sql = `
    SELECT g.title, g.slug, l.code AS language_code, g.edition,
      (lower(btrim(g.title)) = $1 AND coalesce(lower(btrim(g.edition)),'') = $3) AS exact,
      similarity(lower(katalog.imm_unaccent(g.title)), lower(katalog.imm_unaccent($1))) AS sim
    FROM katalog.games g JOIN katalog.languages l ON l.id = g.language_id
    WHERE l.code = $2
      AND (
        (lower(btrim(g.title)) = $1 AND coalesce(lower(btrim(g.edition)),'') = $3)
        OR similarity(lower(katalog.imm_unaccent(g.title)), lower(katalog.imm_unaccent($1))) > 0.4
      )`;
  if (excludeId) { params.push(excludeId); sql += ` AND g.id <> $${params.length}`; }
  sql += ' ORDER BY exact DESC, sim DESC LIMIT 8';
  const r = await pool.query(sql, params);
  return r.rows;
}

// ------------------------------------------------------------ Audit-Log
export async function logAudit(client, { actor = 'admin', action, entity, entityId, diff }) {
  await client.query(
    `INSERT INTO katalog.audit_log (actor, action, entity, entity_id, diff) VALUES ($1,$2,$3,$4,$5)`,
    [actor, action, entity, entityId ? String(entityId) : null, diff ? JSON.stringify(diff) : null],
  );
}

export async function getAuditLog(limit = 120) {
  const r = await pool.query(
    `SELECT a.*, g.title FROM katalog.audit_log a
     LEFT JOIN katalog.games g ON a.entity = 'games' AND a.entity_id = g.id::text
     ORDER BY a.created_at DESC LIMIT $1`,
    [limit],
  );
  return r.rows;
}

// --------------------------------------------------------- Wahlomat
// Liefert alle veröffentlichten Spiele mit genau den Feldern, die der
// RPG-Wahlomat für sein automatisches Profil (Genre/Ton/Fokus-Tags,
// Crunch/Narrativ/Fluff) braucht -- ohne Paginierung, da der Wahlomat immer
// mit der vollständigen Sammlung rechnet.
export async function getWahlomatData() {
  const cte = gameDetailCte(false);
  const sql = `WITH ${cte}
    SELECT slug, title, language_code AS language, system_family,
      genre_setting_top, genre_setting, play_focus, tone_theme_top, tone_theme,
      crunch, narrative, fluff
    FROM gd WHERE status = 'published' ORDER BY title`;
  const r = await pool.query(sql);
  return { games: r.rows };
}

// --------------------------------------------------------- Öffentliche API
export async function listGames(query, isAdmin) {
  const f = parseFilters(query, isAdmin);
  const { whereSql, params } = buildWhere(f, isAdmin);
  const cte = gameDetailCte(isAdmin);
  const offset = (f.page - 1) * PAGE_SIZE;

  const countSql = `WITH ${cte} SELECT count(*)::int AS total FROM gd ${whereSql}`;
  const totalR = await pool.query(countSql, params);
  const total = totalR.rows[0].total;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const listSql = `WITH ${cte}
    SELECT ${CARD_COLUMNS} FROM gd ${whereSql}
    ORDER BY ${SORTS[f.sort]}
    LIMIT ${PAGE_SIZE} OFFSET ${offset}`;
  const listR = await pool.query(listSql, params);

  return { games: listR.rows, total, page: f.page, pages, pageSize: PAGE_SIZE };
}

async function facetCounts(cte, whereSql, params, { column, isArray }) {
  const notNull = `gd.${column} IS NOT NULL`;
  const combinedWhere = whereSql ? `${whereSql} AND ${notNull}` : `WHERE ${notNull}`;
  const fromExpr = isArray ? `gd, unnest(gd.${column}) AS value` : `gd`;
  const valueExpr = isArray ? 'value' : `gd.${column} AS value`;
  const sql = `WITH ${cte}
    SELECT ${valueExpr}, count(*)::int AS count
    FROM ${fromExpr}
    ${combinedWhere}
    GROUP BY value ORDER BY count DESC, value`;
  const r = await pool.query(sql, params);
  return r.rows;
}

export async function getFacets(query, isAdmin) {
  const f = parseFilters(query, isAdmin);
  const cte = gameDetailCte(isAdmin);

  const dims = [
    ['languages', 'language_code', false],
    ['publishers', 'primary_publisher', false],
    ['systemFamilies', 'system_family', false],
    ['genresTop', 'genre_setting_top', true],
    ['genres', 'genre_setting', true],
    ['focus', 'play_focus', true],
    ['campaigns', 'campaign_type', true],
    ['toneThemesTop', 'tone_theme_top', true],
    ['toneThemes', 'tone_theme', true],
  ];
  const out = {};
  for (const [key, column] of dims) {
    // Zähle jede Facette unter allen Filtern AUSSER dem eigenen Feld, damit
    // Nutzer:innen sehen, wie viele Treffer eine weitere Auswahl brächte.
    const fCopy = { ...f };
    if (column === 'language_code') fCopy.language = [];
    if (column === 'primary_publisher') fCopy.publisher = [];
    if (column === 'system_family') fCopy.systemFamily = [];
    if (column === 'genre_setting_top') fCopy.genreTop = [];
    if (column === 'genre_setting') fCopy.genre = [];
    if (column === 'play_focus') fCopy.focus = [];
    if (column === 'campaign_type') fCopy.campaign = [];
    if (column === 'tone_theme_top') fCopy.toneTop = [];
    if (column === 'tone_theme') fCopy.tone = [];
    const { whereSql, params } = buildWhere(fCopy, isAdmin, { excludeScales: false });
    const rows = await facetCounts(cte, whereSql, params, { column, isArray: dims.find((d) => d[1] === column)[2] });
    out[key] = rows.map((r) => ({ value: r.value, label: r.value, count: r.count }));
  }

  const { whereSql, params } = buildWhere(f, isAdmin);
  const summarySql = `WITH ${cte}
    SELECT count(*) FILTER (WHERE gd.product_count > 0)::int AS with_products
    FROM gd ${whereSql}`;
  const summaryR = await pool.query(summarySql, params);
  out.summary = summaryR.rows[0];

  return out;
}

export async function getGameBySlug(slug, isAdmin) {
  const cte = gameDetailCte(isAdmin);
  const r = await pool.query(`WITH ${cte} SELECT * FROM gd WHERE slug = $1`, [slug]);
  if (!r.rowCount) return null;
  const g = r.rows[0];
  if (g.status !== 'published' && !isAdmin) return null;

  const [publishers, products] = await Promise.all([
    pool.query(
      `SELECT p.name, gp.is_primary FROM katalog.game_publishers gp JOIN katalog.publishers p ON p.id = gp.publisher_id
       WHERE gp.game_id = $1 ORDER BY gp.is_primary DESC, p.name`, [g.id],
    ),
    pool.query(
      `SELECT pr.title, pt.name AS product_type, pr.binding, pr.edition, pr.language_id, l.code AS language, pr.isbn
       FROM katalog.products pr JOIN katalog.product_types pt ON pt.id = pr.product_type_id
       LEFT JOIN katalog.languages l ON l.id = pr.language_id
       WHERE pr.game_id = $1 ORDER BY pr.sort_order, pr.title`, [g.id],
    ),
  ]);
  g.publishers = publishers.rows;
  g.products = products.rows;
  delete g.search_vector;

  const similarR = await pool.query(`WITH ${cte}
    SELECT ${CARD_COLUMNS} FROM gd
    WHERE gd.id <> $1 AND gd.status = 'published' AND gd.system_family = $2
    ORDER BY gd.title LIMIT 4`, [g.id, g.system_family]);

  return { game: g, similar: similarR.rows };
}

export async function getGameById(id) {
  const cte = gameDetailCte(true);
  const r = await pool.query(`WITH ${cte} SELECT * FROM gd WHERE id = $1`, [id]);
  if (!r.rowCount) return null;
  const g = r.rows[0];
  const [publishers, products] = await Promise.all([
    pool.query(
      `SELECT p.name, gp.is_primary FROM katalog.game_publishers gp JOIN katalog.publishers p ON p.id = gp.publisher_id
       WHERE gp.game_id = $1 ORDER BY gp.is_primary DESC, p.name`, [g.id],
    ),
    pool.query(
      `SELECT pr.id, pr.title, pt.name AS product_type, pr.binding, pr.edition, l.code AS language, pr.isbn
       FROM katalog.products pr JOIN katalog.product_types pt ON pt.id = pr.product_type_id
       LEFT JOIN katalog.languages l ON l.id = pr.language_id
       WHERE pr.game_id = $1 ORDER BY pr.sort_order, pr.title`, [g.id],
    ),
  ]);
  g.publishers = publishers.rows;
  g.products = products.rows;
  delete g.search_vector;
  return g;
}

export async function getMasterData() {
  const [languages, publishers, systemFamilies, productTypes, tags] = await Promise.all([
    pool.query('SELECT code, label_de FROM katalog.languages ORDER BY sort_order, label_de'),
    pool.query(`SELECT p.id, p.name, count(gp.game_id)::int AS usage_count
      FROM katalog.publishers p LEFT JOIN katalog.game_publishers gp ON gp.publisher_id = p.id
      GROUP BY p.id ORDER BY p.name`),
    pool.query(`SELECT sf.id, sf.name, count(g.id)::int AS usage_count
      FROM katalog.system_families sf LEFT JOIN katalog.games g ON g.system_family_id = sf.id
      GROUP BY sf.id ORDER BY sf.name`),
    pool.query(`SELECT pt.id, pt.name, count(pr.id)::int AS usage_count
      FROM katalog.product_types pt LEFT JOIN katalog.products pr ON pr.product_type_id = pt.id
      GROUP BY pt.id ORDER BY pt.sort_order, pt.name`),
    pool.query(`SELECT t.id, t.kind, t.name, count(gt.game_id)::int AS usage_count
      FROM katalog.tags t LEFT JOIN katalog.game_tags gt ON gt.tag_id = t.id
      GROUP BY t.id ORDER BY t.kind, t.sort_order, t.name`),
  ]);
  return {
    languages: languages.rows,
    publishers: publishers.rows,
    systemFamilies: systemFamilies.rows,
    productTypes: productTypes.rows,
    tags: tags.rows,
  };
}

export async function getDashboard() {
  const [counts, productCount, audit] = await Promise.all([
    pool.query(`SELECT
      count(*) FILTER (WHERE status = 'published')::int AS published,
      count(*) FILTER (WHERE status = 'draft')::int AS draft,
      count(*) FILTER (WHERE status = 'archived')::int AS archived,
      count(*) FILTER (WHERE fluff IS NULL AND status <> 'archived')::int AS without_fluff
      FROM katalog.games`),
    pool.query('SELECT count(*)::int AS n FROM katalog.products'),
    getAuditLog(20),
  ]);
  return { counts: counts.rows[0], productCount: productCount.rows[0].n, audit };
}

export async function getFluffQueue() {
  const cte = gameDetailCte(true);
  const r = await pool.query(`WITH ${cte}
    SELECT id, slug, title, language_code, system_family, short_description,
      crunch, narrative, fluff, primary_publisher
    FROM gd WHERE fluff IS NULL AND status <> 'archived'
    ORDER BY updated_at DESC`);
  return r.rows;
}

export async function setFluff(id, fluff, actor) {
  const v = toScale(fluff);
  if (v !== null && (v < 1 || v > 5 || Math.round(v * 2) !== v * 2)) {
    throw httpError(400, 'Fluff muss zwischen 1 und 5 in 0,5er-Schritten liegen.');
  }
  const r = await pool.query('UPDATE katalog.games SET fluff = $1 WHERE id = $2 RETURNING id, title', [v, id]);
  if (!r.rowCount) throw httpError(404, 'Eintrag nicht gefunden.');
  await logAudit(pool, { actor, action: 'update', entity: 'games', entityId: id, diff: { fluff: v } });
  return r.rows[0];
}

// --------------------------------------------------------- Anlegen/Ändern
async function upsertRelations(client, gameId, payload) {
  await client.query('DELETE FROM katalog.game_publishers WHERE game_id = $1', [gameId]);
  const publisherNames = payload.publishers || [];
  for (let i = 0; i < publisherNames.length; i++) {
    const publisherId = await resolveOrCreate(client, 'publishers', publisherNames[i]);
    await client.query(
      'INSERT INTO katalog.game_publishers (game_id, publisher_id, is_primary) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
      [gameId, publisherId, i === 0],
    );
  }

  await client.query('DELETE FROM katalog.game_tags WHERE game_id = $1', [gameId]);
  const tagGroups = [
    ['genre_setting_top', payload.genre_setting_top],
    ['genre_setting', payload.genre_setting],
    ['play_focus', payload.play_focus],
    ['campaign_type', payload.campaign_type],
    ['tone_theme_top', payload.tone_theme_top],
    ['tone_theme', payload.tone_theme],
  ];
  for (const [kind, names] of tagGroups) {
    for (const name of names || []) {
      const tagId = await resolveOrCreateTag(client, kind, name);
      await client.query('INSERT INTO katalog.game_tags (game_id, tag_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [gameId, tagId]);
    }
  }

  await client.query('DELETE FROM katalog.products WHERE game_id = $1', [gameId]);
  let sortOrder = 10;
  for (const prod of payload.products || []) {
    if (!prod.title || !prod.title.trim()) continue;
    const typeR = await client.query('SELECT id FROM katalog.product_types WHERE lower(name) = lower($1)', [prod.product_type]);
    if (!typeR.rowCount) throw httpError(400, `Unbekannter Produkttyp „${prod.product_type}".`);
    const langId = prod.language ? await languageIdByCode(client, prod.language) : null;
    await client.query(
      `INSERT INTO katalog.products (game_id, product_type_id, title, binding, edition, language_id, isbn, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [gameId, typeR.rows[0].id, prod.title.trim(), prod.binding || null, prod.edition || null, langId, prod.isbn || null, sortOrder],
    );
    sortOrder += 10;
  }
}

export async function createGame(payload, actor) {
  const errors = validateGamePayload(payload, { forPublish: payload.status === 'published' });
  if (errors.length) throw httpError(422, 'Bitte die markierten Felder prüfen.', { errors });

  if (!payload.confirmDuplicate) {
    const dupes = await findDuplicates({ title: payload.title, language: payload.language, edition: payload.edition });
    if (dupes.length) {
      const exact = dupes.some((d) => d.exact);
      throw httpError(409, exact ? 'Ein identischer Eintrag existiert bereits.' : 'Mögliche Dublette gefunden.', {
        duplicates: dupes, blocking: exact,
      });
    }
  }

  return withTransaction(async (client) => {
    const languageId = await languageIdByCode(client, payload.language || 'de');
    const systemFamilyId = await resolveOrCreate(client, 'system_families', payload.system_family);
    const baseSlug = slugify(payload.title) || 'eintrag';
    const slug = await uniqueSlug(client, baseSlug);

    const ins = await client.query(
      `INSERT INTO katalog.games (
        slug, title, original_title, sort_title, language_id, system_family_id, edition, release_year,
        short_description, long_description, crunch, narrative, fluff, status, editorial_note,
        search_vector, published_at
      ) VALUES (
        $1,$2,$3,$2,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
        ${SEARCH_VECTOR_EXPR.replaceAll('$TITLE', '$2').replaceAll('$ORIG', '$3').replaceAll('$SHORT', '$8').replaceAll('$LONG', '$9')},
        CASE WHEN $13 = 'published' THEN now() ELSE NULL END
      ) RETURNING id, slug`,
      [
        slug, payload.title.trim(), payload.original_title || null, languageId, systemFamilyId,
        payload.edition || null, payload.release_year || null, payload.short_description.trim(),
        payload.long_description || null, toScale(payload.crunch), toScale(payload.narrative), toScale(payload.fluff),
        payload.status || 'draft', payload.editorial_note || null,
      ],
    );
    const gameId = ins.rows[0].id;
    await upsertRelations(client, gameId, payload);
    await logAudit(client, { actor, action: 'insert', entity: 'games', entityId: gameId, diff: { title: payload.title } });
    return { id: gameId, slug: ins.rows[0].slug };
  });
}

export async function updateGame(id, payload, actor) {
  const errors = validateGamePayload(payload, { forPublish: payload.status === 'published' });
  if (errors.length) throw httpError(422, 'Bitte die markierten Felder prüfen.', { errors });

  if (!payload.confirmDuplicate) {
    const dupes = await findDuplicates({ title: payload.title, language: payload.language, edition: payload.edition, excludeId: id });
    if (dupes.length) {
      const exact = dupes.some((d) => d.exact);
      throw httpError(409, exact ? 'Ein identischer Eintrag existiert bereits.' : 'Mögliche Dublette gefunden.', {
        duplicates: dupes, blocking: exact,
      });
    }
  }

  return withTransaction(async (client) => {
    const before = await client.query('SELECT title, status FROM katalog.games WHERE id = $1', [id]);
    if (!before.rowCount) throw httpError(404, 'Eintrag nicht gefunden.');

    const languageId = await languageIdByCode(client, payload.language || 'de');
    const systemFamilyId = await resolveOrCreate(client, 'system_families', payload.system_family);
    const baseSlug = slugify(payload.title) || 'eintrag';
    const slug = await uniqueSlug(client, baseSlug, id);
    const wasPublished = before.rows[0].status === 'published';
    const willPublish = payload.status === 'published';

    await client.query(
      `UPDATE katalog.games SET
        slug=$1, title=$2, original_title=$3, sort_title=$2, language_id=$4, system_family_id=$5,
        edition=$6, release_year=$7, short_description=$8, long_description=$9,
        crunch=$10, narrative=$11, fluff=$12, status=$13, editorial_note=$14,
        search_vector = ${SEARCH_VECTOR_EXPR.replaceAll('$TITLE', '$2').replaceAll('$ORIG', '$3').replaceAll('$SHORT', '$8').replaceAll('$LONG', '$9')},
        published_at = CASE WHEN $13 = 'published' AND published_at IS NULL THEN now() ELSE published_at END
      WHERE id = $15`,
      [
        slug, payload.title.trim(), payload.original_title || null, languageId, systemFamilyId,
        payload.edition || null, payload.release_year || null, payload.short_description.trim(),
        payload.long_description || null, toScale(payload.crunch), toScale(payload.narrative), toScale(payload.fluff),
        payload.status || 'draft', payload.editorial_note || null, id,
      ],
    );
    await upsertRelations(client, id, payload);
    const action = !wasPublished && willPublish ? 'publish' : 'update';
    await logAudit(client, { actor, action, entity: 'games', entityId: id, diff: { title: payload.title } });
    return { id, slug };
  });
}

export async function setGameStatus(id, status, actor) {
  if (!['draft', 'published', 'archived'].includes(status)) throw httpError(400, 'Ungültiger Status.');
  return withTransaction(async (client) => {
    const before = await client.query('SELECT status, crunch, narrative FROM katalog.games WHERE id = $1', [id]);
    if (!before.rowCount) throw httpError(404, 'Eintrag nicht gefunden.');
    if (status === 'published' && (before.rows[0].crunch === null || before.rows[0].narrative === null)) {
      throw httpError(422, 'Zum Veröffentlichen müssen Crunch und Narrativ gesetzt sein.');
    }
    await client.query(
      `UPDATE katalog.games SET status=$1, published_at = CASE WHEN $1='published' AND published_at IS NULL THEN now() ELSE published_at END
       WHERE id = $2`, [status, id],
    );
    const action = status === 'archived' ? 'archive' : status === 'published' ? 'publish' : 'restore';
    await logAudit(client, { actor, action, entity: 'games', entityId: id, diff: { status: { vorher: before.rows[0].status, nachher: status } } });
    return { id, status };
  });
}

export async function deleteGame(id, force, actor) {
  if (!force) return setGameStatus(id, 'archived', actor);
  return withTransaction(async (client) => {
    const r = await client.query('SELECT title FROM katalog.games WHERE id = $1', [id]);
    if (!r.rowCount) throw httpError(404, 'Eintrag nicht gefunden.');
    await client.query('DELETE FROM katalog.games WHERE id = $1', [id]);
    await logAudit(client, { actor, action: 'delete', entity: 'games', entityId: id, diff: { title: r.rows[0].title } });
    return { id, deleted: true };
  });
}

// ------------------------------------------------------------- Stammdaten
const MASTER = {
  publishers: { table: 'publishers', hasSlug: true },
  'system-families': { table: 'system_families', hasSlug: true },
  'product-types': { table: 'product_types', hasSlug: true },
  tags: { table: 'tags', hasSlug: true, needsKind: true },
};

export function masterConfig(kind) {
  const cfg = MASTER[kind];
  if (!cfg) throw httpError(404, 'Unbekannte Stammdaten-Kategorie.');
  return cfg;
}

export async function createMasterEntry(kind, name, tagKind, actor) {
  const cfg = masterConfig(kind);
  const trimmed = String(name).trim();
  if (trimmed.length < 2) throw httpError(400, 'Name muss mindestens 2 Zeichen haben.');
  const slug = slugify(trimmed);
  const cols = cfg.needsKind ? '(kind, name, slug)' : '(name, slug)';
  const vals = cfg.needsKind ? [tagKind, trimmed, slug] : [trimmed, slug];
  const params = vals.map((_, i) => `$${i + 1}`).join(',');
  const r = await pool.query(`INSERT INTO katalog.${cfg.table} ${cols} VALUES (${params}) RETURNING id`, vals);
  await logAudit(pool, { actor, action: 'insert', entity: cfg.table, entityId: r.rows[0].id, diff: { name: trimmed } });
  return r.rows[0];
}

export async function renameMasterEntry(kind, id, name, actor) {
  const cfg = masterConfig(kind);
  const trimmed = String(name).trim();
  if (trimmed.length < 2) throw httpError(400, 'Name muss mindestens 2 Zeichen haben.');
  const r = await pool.query(`UPDATE katalog.${cfg.table} SET name=$1, slug=$2 WHERE id=$3 RETURNING id`, [trimmed, slugify(trimmed), id]);
  if (!r.rowCount) throw httpError(404, 'Nicht gefunden.');
  await logAudit(pool, { actor, action: 'update', entity: cfg.table, entityId: id, diff: { name: trimmed } });
  return r.rows[0];
}

export async function deleteMasterEntry(kind, id, actor) {
  const cfg = masterConfig(kind);
  try {
    const r = await pool.query(`DELETE FROM katalog.${cfg.table} WHERE id=$1 RETURNING id`, [id]);
    if (!r.rowCount) throw httpError(404, 'Nicht gefunden.');
    await logAudit(pool, { actor, action: 'delete', entity: cfg.table, entityId: id });
  } catch (err) {
    if (err.code === '23503') throw httpError(409, 'Wird noch verwendet und kann nicht gelöscht werden.');
    throw err;
  }
}

export { httpError };
