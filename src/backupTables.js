// Vollständige Sicherung aller Tabellen im Schema „katalog“ (wöchentlich per
// GitHub Actions abgeholt und verschlüsselt abgelegt). Cover-Bilder mit
// Quell-Adresse fehlen (sie werden aus source_url neu geladen), hochgeladene
// Cover ohne Quelle sind enthalten. Ohne den berechneten Suchindex.
// Wiederherstellen: scripts/restore-backup.sh (siehe docs/BACKUP.md).
export const BACKUP_TABLES = {
  games: "to_jsonb(t) - 'search_vector'",
  game_covers: "CASE WHEN coalesce(t.source_url, '') = '' THEN to_jsonb(t) ELSE to_jsonb(t) - 'data' END",
  game_tags: null, game_publishers: null, tags: null, products: null, product_types: null, publishers: null,
  system_families: null, languages: null, play_sessions: null, app_settings: null, wahlomat_groups: null,
  wahlomat_group_members: null, wahlomat_results: null, audit_log: null, import_runs: null, import_issues: null, staging_games_raw: null,
};

// Eine Abfrage, die alle (oder die genannten) Tabellen als ein JSON-Objekt liefert.
export function backupSelect(only = Object.keys(BACKUP_TABLES)) {
  const parts = Object.entries(BACKUP_TABLES).filter(([t]) => only.includes(t))
    .map(([t, expr]) => `'${t}', (SELECT coalesce(jsonb_agg(${expr || 'to_jsonb(t)'}), '[]'::jsonb) FROM katalog.${t} t)`);
  return `SELECT jsonb_build_object(${parts.join(', ')}) AS data`;
}
