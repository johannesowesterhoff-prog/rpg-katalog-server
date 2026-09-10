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

const DEFAULTS = {
  q: '', language: [], publisher: [], systemFamily: [], genre: [], genreMode: 'OR',
  focus: [], campaign: [], hasProducts: false,
  crunchMin: 1, crunchMax: 5, narrativeMin: 1, narrativeMax: 5, fluffMin: 1, fluffMax: 5,
  sort: 'title', page: 1, status: null,
};

function splitCsv(v) {
  return v ? String(v).split(',').filter(Boolean) : [];
}

/** Liest Query-Parameter (aus req.query) in ein normalisiertes Filterobjekt. */
export function parseFilters(query, isAdmin) {
  const f = { ...DEFAULTS };
  f.q = (query.q || '').trim();
  for (const key of ['language', 'publisher', 'systemFamily', 'genre', 'focus', 'campaign']) {
    f[key] = splitCsv(query[key]);
  }
  if (query.genreMode === 'AND') f.genreMode = 'AND';
  f.hasProducts = query.hasProducts === '1';
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
    conds.push(`(
      gd.search_vector @@ websearch_to_tsquery('german', ${p(f.q)})
      OR similarity(lower(katalog.imm_unaccent(gd.title)), lower(katalog.imm_unaccent(${p(f.q)}))) > 0.2
    )`);
  }
  if (f.language.length) conds.push(`gd.language_code = ANY(${p(f.language)}::text[])`);
  if (f.publisher.length) conds.push(`gd.primary_publisher = ANY(${p(f.publisher)}::text[])`);
  if (f.systemFamily.length) conds.push(`gd.system_family = ANY(${p(f.systemFamily)}::text[])`);
  if (f.genre.length) {
    conds.push(f.genreMode === 'AND'
      ? `gd.genre_setting @> ${p(f.genre)}::text[]`
      : `gd.genre_setting && ${p(f.genre)}::text[]`);
  }
  if (f.focus.length) conds.push(`gd.play_focus && ${p(f.focus)}::text[]`);
  if (f.campaign.length) conds.push(`gd.campaign_type && ${p(f.campaign)}::text[]`);
  if (f.hasProducts) conds.push(`gd.product_count > 0`);

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
          SELECT p.name FROM game_publishers gp JOIN publishers p ON p.id = gp.publisher_id
          WHERE gp.game_id = g.id AND gp.is_primary LIMIT 1
        ) AS primary_publisher,
        (
          SELECT array_agg(t.name ORDER BY t.sort_order, t.name)
          FROM game_tags gt JOIN tags t ON t.id = gt.tag_id
          WHERE gt.game_id = g.id AND t.kind = 'genre_setting'::katalog.tag_kind
        ) AS genre_setting,
        (
          SELECT array_agg(t.name ORDER BY t.sort_order, t.name)
          FROM game_tags gt JOIN tags t ON t.id = gt.tag_id
          WHERE gt.game_id = g.id AND t.kind = 'play_focus'::katalog.tag_kind
        ) AS play_focus,
        (
          SELECT array_agg(t.name ORDER BY t.sort_order, t.name)
          FROM game_tags gt JOIN tags t ON t.id = gt.tag_id
          WHERE gt.game_id = g.id AND t.kind = 'campaign_type'::katalog.tag_kind
        ) AS campaign_type,
        (SELECT count(*) FROM products pr WHERE pr.game_id = g.id)::int AS product_count
      FROM games g
      JOIN languages l ON l.id = g.language_id
      JOIN system_families sf ON sf.id = g.system_family_id
    )`;
}

export const CARD_COLUMNS = `
  slug, title, language_code, system_family, short_description,
  genre_setting, play_focus, campaign_type, crunch, narrative, fluff,
  primary_publisher, product_count, status`;
