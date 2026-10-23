-- Wahlomat-Gruppen: Jemand erstellt eine Gruppe, verschickt den Link, und
-- jede Person trägt sich mit Namen ein und hinterlegt ihre Antworten. Die
-- Antworten liegen als kompakter Code (Base64url-JSON, siehe
-- public/js/wahlomat.js) vor; der Server prüft nur Länge und Zeichensatz.
-- Bearbeiten/Entfernen geht nur mit dem Token, das beim Anlegen an das
-- jeweilige Gerät zurückgegeben wurde; gespeichert ist nur dessen SHA-256.
CREATE TABLE IF NOT EXISTS katalog.wahlomat_groups (
  id text PRIMARY KEY,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 60),
  admin_token_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS katalog.wahlomat_group_members (
  id serial PRIMARY KEY,
  group_id text NOT NULL REFERENCES katalog.wahlomat_groups(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  answers text NOT NULL CHECK (char_length(answers) <= 4000),
  token_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS wahlomat_group_members_name_uq
  ON katalog.wahlomat_group_members (group_id, lower(name));
