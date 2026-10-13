-- Spielform eines Spielabends: am Tisch (vor Ort) oder online.
-- Optional; bestehende Einträge bleiben leer (NULL).
ALTER TABLE katalog.play_sessions
  ADD COLUMN IF NOT EXISTS play_mode text
  CONSTRAINT play_sessions_play_mode_check CHECK (play_mode IN ('am-tisch', 'online'));
