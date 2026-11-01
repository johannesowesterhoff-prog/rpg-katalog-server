-- Produkte ohne eigene ISBN (Zubehör, Crowdfunding-Extras, Box-Inhalte …)
-- markieren, damit sie nicht als „ISBN fehlt“ zählen.
ALTER TABLE katalog.products ADD COLUMN IF NOT EXISTS no_isbn boolean NOT NULL DEFAULT false;
