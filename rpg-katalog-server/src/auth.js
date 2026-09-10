// Authentifizierung für den Adminbereich.
//
// Es gibt keine "sessions"-Tabelle im Schema -- Sessions sind zustandslos:
// ein signiertes Token (HMAC-SHA256 mit SESSION_SECRET) wird sowohl als
// httpOnly-Cookie als auch im Response-Body gesetzt (das Frontend hält das
// Token zusätzlich im Speicher und schickt es als Authorization: Bearer,
// siehe public/js/api.js -- praktisch für die eingebettete Perplexity-
// Vorschau, wo Cookies teils nicht mitgeschickt werden).
//
// Passwort wird mit scrypt gehasht (Node-Crypto, kein externes Paket nötig)
// und als "salt:hash" (beides hex) in katalog.app_settings gespeichert.
import crypto from 'node:crypto';
import * as cookie from 'cookie';
import { pool } from './db.js';

const SESSION_SECRET = process.env.SESSION_SECRET;
if (!SESSION_SECRET || SESSION_SECRET.length < 16) {
  throw new Error('SESSION_SECRET ist nicht gesetzt oder zu kurz (siehe .env.example).');
}

const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';
// __Host- verlangt zwingend Secure=true, kein Domain-Attribut, Path=/.
// Lokal über http funktioniert das Präfix nicht -- dann auf einen normalen
// Namen ausweichen, aber weiterhin httpOnly + sameSite=lax.
export const COOKIE_NAME = COOKIE_SECURE ? '__Host-rk_session' : 'rk_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 Stunden

const PASSWORD_SETTING_KEY = 'admin_password';

// ---------------------------------------------------------------- Hashing
function scryptHash(password, salt) {
  return crypto.scryptSync(password, salt, 64);
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = scryptHash(password, salt);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPasswordHash(password, stored) {
  const [saltHex, hashHex] = String(stored).split(':');
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptHash(password, salt);
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

// ------------------------------------------------------------ Settings
export async function hasPassword() {
  const r = await pool.query('SELECT 1 FROM app_settings WHERE key = $1', [PASSWORD_SETTING_KEY]);
  return r.rowCount > 0;
}

export async function setPassword(password) {
  const stored = hashPassword(password);
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [PASSWORD_SETTING_KEY, stored],
  );
}

export async function checkPassword(password) {
  const r = await pool.query('SELECT value FROM app_settings WHERE key = $1', [PASSWORD_SETTING_KEY]);
  if (!r.rowCount) return false;
  return verifyPasswordHash(password, r.rows[0].value);
}

// -------------------------------------------------------------- Tokens
function sign(payload) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest();
}

export function issueToken() {
  const exp = Date.now() + SESSION_TTL_MS;
  const payload = `admin.${exp}`;
  const sig = sign(payload).toString('base64url');
  return `${payload}.${sig}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string') return false;
  const lastDot = token.lastIndexOf('.');
  if (lastDot < 0) return false;
  const payload = token.slice(0, lastDot);
  const sig = token.slice(lastDot + 1);
  let sigBuf, expectedBuf;
  try {
    sigBuf = Buffer.from(sig, 'base64url');
    expectedBuf = sign(payload);
  } catch {
    return false;
  }
  if (sigBuf.length !== expectedBuf.length) return false;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return false;
  const [kind, expStr] = payload.split('.');
  if (kind !== 'admin') return false;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Date.now() > exp) return false;
  return true;
}

// --------------------------------------------------------------- Cookie
export function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', cookie.serialize(COOKIE_NAME, token, {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  }));
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', cookie.serialize(COOKIE_NAME, '', {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  }));
}

function tokenFromRequest(req) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7);
  const cookies = cookie.parse(req.headers.cookie || '');
  return cookies[COOKIE_NAME] || null;
}

/** Ermittelt req.isAdmin, ohne die Route zu sperren -- für öffentliche Routen,
 *  die admin-abhängig andere Daten liefern (z.B. Entwürfe für Admins). */
export function attachAdminFlag(req, _res, next) {
  const token = tokenFromRequest(req);
  req.isAdmin = verifyToken(token);
  next();
}

/** Sperrt die Route komplett für Nicht-Admins. */
export function requireAdmin(req, res, next) {
  const token = tokenFromRequest(req);
  if (!verifyToken(token)) {
    return res.status(401).json({ error: 'Nicht angemeldet.' });
  }
  req.isAdmin = true;
  next();
}

// --------------------------------------------------------- Rate-Limiting
// Einfacher In-Memory-Limiter (ausreichend für eine einzelne Serverinstanz).
const attempts = new Map(); // ip -> { count, windowStart }
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 8;

export function loginRateLimit(req, res, next) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    attempts.set(ip, { count: 1, windowStart: now });
    return next();
  }
  entry.count += 1;
  if (entry.count > MAX_ATTEMPTS) {
    return res.status(429).json({ error: 'Zu viele Anmeldeversuche. Bitte später erneut versuchen.' });
  }
  next();
}

// -------------------------------------------------------------- CSRF
// Zusätzlich zu sameSite=lax (verhindert die meisten klassischen
// Cross-Site-Formular-/Bild-Angriffe): auf allen mutierenden Routen den
// Origin-Header gegen eine Allowlist prüfen, falls vorhanden. Requests ohne
// Origin-Header (z.B. same-origin GET-Navigation, manche Tools) werden
// durchgelassen -- Browser setzen den Origin-Header bei fetch/XHR-Requests
// mit Body praktisch immer.
export function csrfGuard(allowedOrigins) {
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (!origin) return next();
    if (allowedOrigins.has(origin)) return next();
    return res.status(403).json({ error: 'Anfrage von nicht erlaubter Herkunft abgelehnt.' });
  };
}
