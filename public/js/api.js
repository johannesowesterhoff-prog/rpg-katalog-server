// Zugriff auf das Express-Backend.
// Frontend und Server laufen auf derselben Origin (z.B. bei Render), daher
// reicht ein relativer Pfad.
export const API = '';

// Das Anmelde-Token wird nur im Arbeitsspeicher gehalten; zusätzlich setzt der
// Server ein HttpOnly-Cookie, das außerhalb der eingebetteten Vorschau greift.
let token = null;
// Separates Token für den Lesezugriff aufs "Schwarze Regal" (siehe
// detail.js) -- unabhängig vom Admin-Token, eigenes Cookie serverseitig.
// Ein Admin-Token deckt Archiv-Routen serverseitig automatisch mit ab, daher
// hat es hier Vorrang vor dem Archiv-Token.
let archiveToken = null;

export function setToken(t) { token = t; }
export function hasToken() { return !!token; }
export function setArchiveToken(t) { archiveToken = t; }
export function hasArchiveToken() { return !!archiveToken; }

export async function api(path, { method = 'GET', body, raw = false } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const bearer = token || archiveToken;
  if (bearer) headers.Authorization = 'Bearer ' + bearer;
  const res = await fetch(API + path, {
    method, headers, credentials: 'include',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (raw) return res;
  let data = null;
  const text = await res.text();
  if (text) { try { data = JSON.parse(text); } catch { data = { error: text.slice(0, 200) }; } }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Serverfehler (${res.status}).`);
    err.status = res.status; err.data = data || {};
    throw err;
  }
  return data;
}

export function apiUrl(path) { return API + path; }
