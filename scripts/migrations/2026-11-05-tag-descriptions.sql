-- Ein Satz Erklärung je Begriff (öffentlich: Katalog-Tooltips, Begriffsseite, Wahlomat).
ALTER TABLE katalog.tags ADD COLUMN IF NOT EXISTS description text;
