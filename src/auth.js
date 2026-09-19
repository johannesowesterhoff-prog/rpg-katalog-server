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
// Eigenes, unabhängiges Cookie für den separaten Lesezugriff aufs "Schwarze
// Regal" (siehe requireArchiveAccess weiter unten) -- bewusst nicht dasselbe
// Cookie wie der Admin-Login, damit ein Archiv-Passwort niemals Adminrechte
// gibt (nur umgekehrt: ein Admin-Token genügt auch fürs Archiv).
export const COOKIE_NAME_ARCHIVE = COOKIE_SECURE ? '__Host-rk_archive_session' : 'rk_archive_session';
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 Stunden

const PASSWORD_SETTING_KEY = 'admin_password';
const ARCHIVE_PASSWORD_SETTING_KEY = 'archive_password';

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
async function hasPasswordFor(key) {
  const r = await pool.query('SELECT 1 FROM app_settings WHERE key = $1', [key]);
  return r.rowCount > 0;
}

async function setPasswordFor(key, password) {
  const stored = hashPassword(password);
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, stored],
  );
}

async function checkPasswordFor(key, password) {
  const r = await pool.query('SELECT value FROM app_settings WHERE key = $1', [key]);
  if (!r.rowCount) return false;
  return verifyPasswordHash(password, r.rows[0].value);
}

export const hasPassword = () => hasPasswordFor(PASSWORD_SETTING_KEY);
export const setPassword = (password) => setPasswordFor(PASSWORD_SETTING_KEY, password);
export const checkPassword = (password) => checkPasswordFor(PASSWORD_SETTING_KEY, password);

// Separates, unabhängiges Passwort für den Lesezugriff aufs "Schwarze
// Regal" -- eigener app_settings-Key, eigener Hash, nichts mit dem
// Admin-Passwort geteilt (siehe handoff_archive_link.md).
export const hasArchivePassword = () => hasPasswordFor(ARCHIVE_PASSWORD_SETTING_KEY);
export const setArchivePassword = (password) => setPasswordFor(ARCHIVE_PASSWORD_SETTING_KEY, password);
export const checkArchivePassword = (password) => checkPasswordFor(ARCHIVE_PASSWORD_SETTING_KEY, password);

// -------------------------------------------------------------- Tokens
function sign(payload) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest();
}

export function issueToken(kind = 'admin') {
  const exp = Date.now() + SESSION_TTL_MS;
  const payload = `${kind}.${exp}`;
  const sig = sign(payload).toString('base64url');
  return `${payload}.${sig}`;
}

/** Prüft Signatur + Ablauf eines Tokens und gibt dessen Art zurück
 *  ('admin' | 'archive'), oder null wenn ungültig/abgelaufen. */
function verifyAnyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const lastDot = token.lastIndexOf('.');
  if (lastDot < 0) return null;
  const payload = token.slice(0, lastDot);
  const sig = token.slice(lastDot + 1);
  let sigBuf, expectedBuf;
  try {
    sigBuf = Buffer.from(sig, 'base64url');
    expectedBuf = sign(payload);
  } catch {
    return null;
  }
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
  const [kind, expStr] = payload.split('.');
  if (kind !== 'admin' && kind !== 'archive') return null;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Date.now() > exp) return null;
  return kind;
}

export function verifyToken(token) {
  return verifyAnyToken(token) === 'admin';
}

// --------------------------------------------------------------- Cookie
export function setSessionCookie(res, token, cookieName = COOKIE_NAME) {
  res.setHeader('Set-Cookie', cookie.serialize(cookieName, token, {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  }));
}

export function clearSessionCookie(res, cookieName = COOKIE_NAME) {
  res.setHeader('Set-Cookie', cookie.serialize(cookieName, '', {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  }));
}

export const setArchiveCookie = (res, token) => setSessionCookie(res, token, COOKIE_NAME_ARCHIVE);
export const clearArchiveCookie = (res) => clearSessionCookie(res, COOKIE_NAME_ARCHIVE);

function tokenFromRequest(req) {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7);
  const cookies = cookie.parse(req.headers.cookie || '');
  return cookies[COOKIE_NAME] || cookies[COOKIE_NAME_ARCHIVE] || null;
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

/** Sperrt die Route für alle außer Archiv-Reader ODER Admin (Admin-Login
 *  gibt automatisch auch Zugriff aufs Schwarze Regal -- nicht umgekehrt). */
export function requireArchiveAccess(req, res, next) {
  const kind = verifyAnyToken(tokenFromRequest(req));
  if (!kind) {
    return res.status(401).json({ error: 'Kein gültiger Zugriff auf das Schwarze Regal.' });
  }
  if (kind === 'admin') req.isAdmin = true;
  req.hasArchiveAccess = true;
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
