// Baut SQL-WHERE-Klauseln für die öffentliche/administrative Katalogsuche.
//
// Ansatz: eine Basis-CTE "gd" (game detail) aggregiert pro Spiel die
// Facetten (Tags, Hauptverlag, Produktanzahl) einmal als Arrays/Skalare --
// darauf lassen sich Filter dann sehr einfach mit &&/@>/= ANY(...) auf den
// Array- bzw. Skalarspalten ausdrücken, ohne JOIN-Explosion durch die
// Zuordnungstabellen.

export const PAGE_SIZE = 24;

export const SORTS = {
  title: 'gd.sort_title NULLS LAST, gd.title',
  neu: 'gd.updated_at DESC',
  crunch: 'gd.crunch DESC NULLS LAST, gd.title',
  narrative: 'gd.narrative DESC NULLS LAST, gd.title',
  fluff: 'gd.fluff DESC NULLS LAST, gd.title',
};

// Array-Facetten, bei denen ein Spiel mehrere Werte gleichzeitig tragen kann --
// dort ist ODER/UND-Verknüpfung sinnvoll (im Gegensatz zu Sprache/Verlag/
// Systemfamilie, die pro Spiel einwertig sind).
export const MODE_DIMS = ['genreTop', 'genre', 'toneTop', 'tone', 'focus', 'campaign'];

const DEFAULTS = {
  q: '', language: [], publisher: [], systemFamily: [], genreTop: [], genre: [],
  focus: [], campaign: [], toneTop: [], tone: [],
  crunchMin: 1, crunchMax: 5, narrativeMin: 1, narrativeMax: 5, fluffMin: 1, fluffMax: 5,
  sort: 'title', page: 1, status: null,
  ...Object.fromEntries(MODE_DIMS.map((k) => [k + 'Mode', 'OR'])),
};

function splitCsv(v) {
  return v ? String(v).split(',').filter(Boolean) : [];
}

/** Liest Query-Parameter (aus req.query) in ein normalisiertes Filterobjekt. */
export function parseFilters(query, isAdmin) {
  const f = { ...DEFAULTS };
  f.q = (query.q || '').trim();
  for (const key of ['language', 'publisher', 'systemFamily', 'genreTop', 'genre', 'focus', 'campaign', 'toneTop', 'tone']) {
    f[key] = splitCsv(query[key]);
  }
  for (const key of MODE_DIMS) {
    if (query[key + 'Mode'] === 'AND') f[key + 'Mode'] = 'AND';
  }
  for (const key of ['crunch', 'narrative', 'fluff']) {
    const mn = Number(query[key + 'Min']);
    const mx = Number(query[key + 'Max']);
    if (Number.isFinite(mn) && mn >= 1 && mn <= 5) f[key + 'Min'] = mn;
    if (Number.isFinite(mx) && mx >= 1 && mx <= 5) f[key + 'Max'] = mx;
  }
  if (SORTS[query.sort]) f.sort = query.sort;
  f.page = Math.max(1, Number(query.page) || 1);
  // status: nur Admins dürfen einen bestimmten Status erzwingen (draft/archived/all).
  if (isAdmin && query.status && ['draft', 'published', 'archived', 'all'].includes(query.status)) {
    f.status = query.status;
  }
  return f;
}

/**
 * Baut WHERE-Bedingungen + Parameter gegen die "gd"-CTE.
 * @param {object} f Filterobjekt aus parseFilters()
 * @param {boolean} isAdmin
 * @param {{ excludeScales?: boolean }} [opts] excludeScales: für Facettenzählung
 *   pro Dimension sinnvoll, s. catalog.js
 */
export function buildWhere(f, isAdmin, opts = {}) {
  const conds = [];
  const params = [];
  const p = (v) => { params.push(v); return `$${params.length}`; };

  if (!isAdmin) {
    conds.push(`gd.status = 'published'`);
  } else if (f.status && f.status !== 'all') {
    conds.push(`gd.status = ${p(f.status)}`);
  }

  if (f.q) {
    // websearch_to_tsquery matcht nur ganze Wortstämme ("Tiny" findet "Tiny",
    // aber "Tin" nicht) -- für Suche-während-des-Tippens zusätzlich eine
    // Präfix-tsquery bauen (jedes Wort + ':*'), damit auch Teilwörter wie
    // "Tin" schon "Tiny Dungeon" treffen.
    const qConds = [`gd.search_vector @@ websearch_to_tsquery('german', ${p(f.q)})`];
    const prefixWords = f.q.trim().split(/\s+/).map((w) => w.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean);
    if (prefixWords.length) {
      const prefixQuery = prefixWords.map((w) => w + ':*').join(' & ');
      qConds.push(`gd.search_vector @@ to_tsquery('german', ${p(prefixQuery)})`);
    }
    qConds.push(`similarity(lower(katalog.imm_unaccent(gd.title)), lower(katalog.imm_unaccent(${p(f.q)}))) > 0.2`);
    conds.push(`(${qConds.join(' OR ')})`);
  }
  if (f.language.length) conds.push(`gd.language_code = ANY(${p(f.language)}::text[])`);
  if (f.publisher.length) conds.push(`gd.publisher_names && ${p(f.publisher)}::text[]`);
  if (f.systemFamily.length) conds.push(`gd.system_family = ANY(${p(f.systemFamily)}::text[])`);

  // Array-Facetten: ODER (&&, mind. eine Überschneidung) oder UND (@>, alle
  // gewählten Werte müssen vorhanden sein), je nach f.<dim>Mode.
  const arrayCol = {
    genreTop: 'genre_setting_top', genre: 'genre_setting',
    toneTop: 'tone_theme_top', tone: 'tone_theme',
    focus: 'play_focus', campaign: 'campaign_type',
  };
  for (const [dim, col] of Object.entries(arrayCol)) {
    if (!f[dim].length) continue;
    conds.push(f[dim + 'Mode'] === 'AND'
      ? `gd.${col} @> ${p(f[dim])}::text[]`
      : `gd.${col} && ${p(f[dim])}::text[]`);
  }

  if (!opts.excludeScales) {
    for (const key of ['crunch', 'narrative', 'fluff']) {
      const min = f[key + 'Min'], max = f[key + 'Max'];
      if (min > 1 || max < 5) {
        conds.push(`(gd.${key} IS NOT NULL AND gd.${key} BETWEEN ${p(min)} AND ${p(max)})`);
      }
    }
  }

  return { whereSql: conds.length ? 'WHERE ' + conds.join(' AND ') : '', params };
}

// Basis-CTE, die alle Aggregatfelder pro Spiel bereitstellt. isAdmin
// entscheidet, ob editorial_note/status/Zeitstempel mit ausgegeben werden --
// die öffentliche API bekommt diese Felder nie (Fix aus der
// Sicherheitsprüfung: editorial_note-Leak).
export function gameDetailCte(isAdmin) {
  return `
    gd AS (
      SELECT
        g.id, g.slug, g.title, g.original_title, g.sort_title,
        l.code AS language_code, l.label_de AS language_label,
        sf.name AS system_family,
        g.edition, g.release_year, g.short_description, g.long_description,
        g.crunch, g.narrative, g.fluff,
        g.status, g.updated_at, g.created_at, g.published_at,
        g.search_vector,
        ${isAdmin ? 'g.editorial_note,' : 'NULL::text AS editorial_note,'}
        (
          SELECT p.name FROM katalog.game_publishers gp JOIN katalog.publishers p ON p.id = gp.publisher_id
          WHERE gp.game_id = g.id AND gp.is_primary LIMIT 1
        ) AS primary_publisher,
        (
          SELECT array_agg(p.name ORDER BY gp.is_primary DESC, p.name)
          FROM katalog.game_publishers gp JOIN katalog.publishers p ON p.id = gp.publisher_id
          WHERE gp.game_id = g.id
        ) AS publisher_names,
        (
          SELECT array_agg(t.name ORDER BY t.sort_order, t.name)
          FROM katalog.game_tags gt JOIN katalog.tags t ON t.id = gt.tag_id
          WHERE gt.game_id = g.id AND t.kind = 'genre_setting_top'::katalog.tag_kind
        ) AS genre_setting_top,
        (
          SELECT array_agg(t.name ORDER BY t.sort_order, t.name)
          FROM katalog.game_tags gt JOIN katalog.tags t ON t.id = gt.tag_id
          WHERE gt.game_id = g.id AND t.kind = 'genre_setting'::katalog.tag_kind
        ) AS genre_setting,
        (
          SELECT array_agg(t.name ORDER BY t.sort_order, t.name)
          FROM katalog.game_tags gt JOIN katalog.tags t ON t.id = gt.tag_id
          WHERE gt.game_id = g.id AND t.kind = 'play_focus'::katalog.tag_kind
        ) AS play_focus,
        (
          SELECT array_agg(t.name ORDER BY t.sort_order, t.name)
          FROM katalog.game_tags gt JOIN katalog.tags t ON t.id = gt.tag_id
          WHERE gt.game_id = g.id AND t.kind = 'campaign_type'::katalog.tag_kind
        ) AS campaign_type,
        (
          SELECT array_agg(t.name ORDER BY t.sort_order, t.name)
          FROM katalog.game_tags gt JOIN katalog.tags t ON t.id = gt.tag_id
          WHERE gt.game_id = g.id AND t.kind = 'tone_theme_top'::katalog.tag_kind
        ) AS tone_theme_top,
        (
          SELECT array_agg(t.name ORDER BY t.sort_order, t.name)
          FROM katalog.game_tags gt JOIN katalog.tags t ON t.id = gt.tag_id
          WHERE gt.game_id = g.id AND t.kind = 'tone_theme'::katalog.tag_kind
        ) AS tone_theme,
        (SELECT count(*) FROM katalog.products pr WHERE pr.game_id = g.id)::int AS product_count
      FROM katalog.games g
      JOIN katalog.languages l ON l.id = g.language_id
      JOIN katalog.system_families sf ON sf.id = g.system_family_id
    )`;
}

export const CARD_COLUMNS = `
  id, slug, title, language_code, system_family, short_description,
  genre_setting_top, genre_setting, play_focus, campaign_type, tone_theme_top, tone_theme, crunch, narrative, fluff,
  primary_publisher, product_count, status`;
