-- Kurzbegründung mit Quelle je Wahlomat-Wert (nur im Adminbereich sichtbar),
-- z. B. {"figurenkompetenz": "2: Rezensionen beschreiben blue-collar-Figuren (GamesRadar)"}.
ALTER TABLE katalog.games ADD COLUMN IF NOT EXISTS wahlomat_notes jsonb;
