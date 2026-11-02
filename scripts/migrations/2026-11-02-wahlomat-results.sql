-- Wahlomat-Ergebnisse ohne Gruppe: werden beim Abschluss des Fragebogens
-- gespeichert, damit sie im Adminbereich sichtbar sind und später einer
-- Gruppe zugewiesen werden können. Die ID erzeugt der Browser (zufällig) und
-- behält sie, damit Bearbeiten denselben Eintrag aktualisiert.
CREATE TABLE IF NOT EXISTS katalog.wahlomat_results (
  id text PRIMARY KEY,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  answers text NOT NULL CHECK (char_length(answers) <= 4000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
