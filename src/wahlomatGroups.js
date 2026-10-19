// Wahlomat-Gruppen (Tabellen siehe scripts/migrations/2026-10-19-wahlomat-groups.sql).
// Öffentlich und ohne Login: Wer den Gruppenlink kennt, sieht alle Namen und
// Antworten und kann sich eintragen. Ändern oder Entfernen geht nur mit dem
// Token, das beim Anlegen zurückkommt (Person: eigener Eintrag; Gruppe:
// alle Einträge). In der Datenbank steht nur der SHA-256 der Tokens.
import crypto from 'node:crypto';
import { pool } from './db.js';

const MAX_MEMBERS = 20;
// Gruppen, in denen sich so lange nichts getan hat, räumt das Anlegen neuer Gruppen weg.
const EXPIRE_DAYS = 365;
const ANSWERS_RE = /^[A-Za-z0-9_-]{1,4000}$/;
const GROUP_ID_RE = /^[A-Za-z0-9_-]{8,32}$/;

function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

const newToken = () => crypto.randomBytes(18).toString('base64url');
const hash = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
function tokenMatches(token, storedHash) {
  if (!token || !storedHash) return false;
  const a = Buffer.from(hash(token), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function cleanText(v, max, label) {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  if (!s) throw httpError(422, `Bitte ${label} angeben.`);
  if (s.length > max) throw httpError(422, `${label[0].toUpperCase()}${label.slice(1)} darf höchstens ${max} Zeichen lang sein.`);
  return s;
}

function checkGroupId(id) {
  if (!GROUP_ID_RE.test(String(id || ''))) throw httpError(404, 'Diese Gruppe gibt es nicht.');
  return id;
}

export async function createGroup(body) {
  const name = cleanText(body?.name, 60, 'einen Gruppennamen');
  const id = crypto.randomBytes(9).toString('base64url');
  const adminToken = newToken();
  await pool.query(`DELETE FROM katalog.wahlomat_groups WHERE updated_at < now() - make_interval(days => $1)`, [EXPIRE_DAYS]);
  await pool.query('INSERT INTO katalog.wahlomat_groups (id, name, admin_token_hash) VALUES ($1, $2, $3)', [id, name, hash(adminToken)]);
  return { id, name, adminToken };
}

export async function getGroup(id) {
  checkGroupId(id);
  const g = await pool.query('SELECT id, name, created_at, updated_at FROM katalog.wahlomat_groups WHERE id = $1', [id]);
  if (!g.rowCount) throw httpError(404, 'Diese Gruppe gibt es nicht (mehr).');
  const m = await pool.query(
    'SELECT id, name, answers, updated_at FROM katalog.wahlomat_group_members WHERE group_id = $1 ORDER BY created_at, id',
    [id],
  );
  return { ...g.rows[0], members: m.rows };
}

// Neuer Eintrag – oder Aktualisierung, wenn das Token zu einem Eintrag passt.
export async function saveMember(groupId, body) {
  checkGroupId(groupId);
  const name = cleanText(body?.name, 40, 'deinen Namen');
  const answers = String(body?.answers || '');
  if (!ANSWERS_RE.test(answers)) throw httpError(422, 'Die Antworten sind unvollständig oder beschädigt.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const g = await client.query('SELECT id FROM katalog.wahlomat_groups WHERE id = $1 FOR UPDATE', [groupId]);
    if (!g.rowCount) throw httpError(404, 'Diese Gruppe gibt es nicht (mehr).');
    const members = (await client.query('SELECT id, name, token_hash FROM katalog.wahlomat_group_members WHERE group_id = $1', [groupId])).rows;
    const own = body?.memberId != null ? members.find((x) => x.id === Number(body.memberId)) : null;
    if (body?.memberId != null && (!own || !tokenMatches(body.token, own.token_hash))) {
      throw httpError(403, 'Diesen Eintrag kannst du von diesem Gerät aus nicht ändern.');
    }
    if (members.some((x) => x.id !== own?.id && x.name.toLowerCase() === name.toLowerCase())) {
      throw httpError(409, `„${name}“ ist in dieser Gruppe schon vergeben – bitte einen anderen Namen wählen.`);
    }
    let result;
    if (own) {
      await client.query('UPDATE katalog.wahlomat_group_members SET name = $1, answers = $2, updated_at = now() WHERE id = $3', [name, answers, own.id]);
      result = { memberId: own.id };
    } else {
      if (members.length >= MAX_MEMBERS) throw httpError(409, `Mehr als ${MAX_MEMBERS} Personen passen nicht in eine Gruppe.`);
      const token = newToken();
      const r = await client.query(
        'INSERT INTO katalog.wahlomat_group_members (group_id, name, answers, token_hash) VALUES ($1, $2, $3, $4) RETURNING id',
        [groupId, name, answers, hash(token)],
      );
      result = { memberId: r.rows[0].id, token };
    }
    await client.query('UPDATE katalog.wahlomat_groups SET updated_at = now() WHERE id = $1', [groupId]);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    // Gleichzeitiges Eintragen mit demselben Namen fängt der Unique-Index ab.
    if (err.code === '23505') throw httpError(409, `„${name}“ ist in dieser Gruppe schon vergeben – bitte einen anderen Namen wählen.`);
    throw err;
  } finally {
    client.release();
  }
}

// Entfernen mit dem Token des Eintrags oder dem der Gruppe.
export async function removeMember(groupId, memberId, body) {
  checkGroupId(groupId);
  const r = await pool.query(
    `SELECT m.id, m.token_hash, g.admin_token_hash FROM katalog.wahlomat_group_members m
       JOIN katalog.wahlomat_groups g ON g.id = m.group_id WHERE m.group_id = $1 AND m.id = $2`,
    [groupId, Number(memberId) || 0],
  );
  if (!r.rowCount) throw httpError(404, 'Diesen Eintrag gibt es nicht (mehr).');
  const row = r.rows[0];
  if (!tokenMatches(body?.token, row.token_hash) && !tokenMatches(body?.adminToken, row.admin_token_hash)) {
    throw httpError(403, 'Diesen Eintrag kannst du von diesem Gerät aus nicht entfernen.');
  }
  await pool.query('DELETE FROM katalog.wahlomat_group_members WHERE id = $1', [row.id]);
  await pool.query('UPDATE katalog.wahlomat_groups SET updated_at = now() WHERE id = $1', [groupId]);
  return { ok: true };
}
