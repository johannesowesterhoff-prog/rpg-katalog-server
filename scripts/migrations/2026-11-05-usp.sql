-- „Das macht <Spiel> aus“: bis zu drei Alleinstellungsmerkmale je Spiel,
-- öffentlich sichtbar, z. B. [{"k": "Die Welt geht wirklich unter", "t": "Ein Würfel pro Spieltag …"}].
-- usp_source: Quellen der Recherche, nur im Adminbereich.
ALTER TABLE katalog.games ADD COLUMN IF NOT EXISTS usp jsonb;
ALTER TABLE katalog.games ADD COLUMN IF NOT EXISTS usp_source text;
