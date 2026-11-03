-- Neue Tag-Gruppe „Spielweise“ (play_style): Eigenschaften des Regelwerks und
-- Zielgruppen, die vorher im Spielfokus standen. Nur Katalogfilter, nicht im
-- Wahlomat. Die Umsortierung der Begriffe selbst lief per Datenkorrektur
-- (siehe Änderungsprotokoll, 04.11.2026).
ALTER TYPE katalog.tag_kind ADD VALUE IF NOT EXISTS 'play_style';
