-- Kampagnenstatus „geplant“: für Kampagnen, deren erster Termin noch aussteht.
-- Angezeigt wird er nur, solange der letzte Termin in der Zukunft liegt.
ALTER TABLE katalog.play_sessions DROP CONSTRAINT IF EXISTS play_sessions_campaign_status_check;
ALTER TABLE katalog.play_sessions
  ADD CONSTRAINT play_sessions_campaign_status_check
  CHECK (campaign_status IN ('geplant', 'laufend', 'abgeschlossen'));
