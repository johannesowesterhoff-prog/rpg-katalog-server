// Zugriff auf das Express-Backend.
// Frontend und Server laufen auf derselben Origin (z.B. bei Render), daher
// reicht ein relativer Pfad.
export const API = '';

// Das Anmelde-Token wird nur im Arbeitsspeicher gehalten; zusätzlich setzt der
// Server ein HttpOnly-Cookie, das außerhalb der eingebetteten Vorschau greift.
let token = null;

export function setToken(t) { token = t; }
export function hasToken() { return !!token; }

export async function api(path, { method = 'GET', body, raw = false } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = 'Bearer ' + token;
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
