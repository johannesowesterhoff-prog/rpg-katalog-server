// Router und Grundgerüst der Anwendung.
import { api, hasToken } from './api.js';
import { renderCatalog } from './catalog.js';
import { renderDetail } from './detail.js';
import { renderWahlomat } from './wahlomat.js';
import { renderLogin, renderDashboard, renderList, renderEditor, renderImport, renderMasterData, renderAudit } from './admin.js';
import { toast, emptyState } from './ui.js';

const root = document.getElementById('app');
const ctx = { isAdmin: false, dbMode: 'pglite' };

// ---- Farbschema
// Farbschema folgt der Systemeinstellung und lässt sich pro Sitzung umschalten.
document.documentElement.dataset.theme = window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
document.getElementById('theme-toggle').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
});

// Pfad-Aufrufe (/spiele/slug vom Server) auf Hash-Routing übertragen
if (location.pathname !== '/' && !location.hash) {
  const m = location.pathname.match(/^\/(spiele|admin)(\/.*)?$/);
  if (m) location.hash = '#/' + m[1] + (m[2] || '');
}

function parseRoute() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  return { parts: path.split('/').filter(Boolean), params: new URLSearchParams(qs || '') };
}

function markNav(kind) {
  document.querySelectorAll('.site-nav a').forEach((a) => {
    if (a.dataset.nav === kind) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
}

async function requireLogin(render) {
  if (ctx.isAdmin) return render();
  const s = await api('/api/admin/session').catch(() => ({ isAdmin: false }));
  ctx.isAdmin = s.isAdmin;
  if (ctx.isAdmin) return render();
  renderLogin(root, () => { ctx.isAdmin = true; route(); });
}

async function route() {
  const { parts, params } = parseRoute();
  window.scrollTo({ top: 0 });
  document.body.classList.remove('drawer-open');
  document.title = 'RPG-Katalog – Sammlung von Rollenspielen';
  try {
    if (parts[0] === 'spiele' && parts[1]) { markNav('katalog'); await renderDetail(root, decodeURIComponent(parts[1]), ctx); return; }
    if (parts[0] === 'wahlomat') { markNav('wahlomat'); await renderWahlomat(root); return; }
    if (parts[0] === 'admin') {
      markNav('admin');
      const sub = parts[1];
      const map = {
        undefined: () => renderDashboard(root),
        liste: () => renderList(root, params),
        editor: () => renderEditor(root, parts[2] || null),
        import: () => renderImport(root),
        stammdaten: () => renderMasterData(root),
        protokoll: () => renderAudit(root),
      };
      const fn = map[sub];
      if (!fn) { root.innerHTML = ''; root.appendChild(emptyState('Seite nicht gefunden', 'Diese Adminseite gibt es nicht.', '<p><a class="btn btn-sm" href="#/admin">Zur Übersicht</a></p>')); return; }
      await requireLogin(fn);
      return;
    }
    markNav('katalog');
    renderCatalog(root, { params });
  } catch (e) {
    if (e.status === 401) { ctx.isAdmin = false; renderLogin(root, () => { ctx.isAdmin = true; route(); }); return; }
    root.innerHTML = '';
    root.appendChild(emptyState('Etwas ist schiefgelaufen', e.message));
    toast(e.message, 'err');
  }
}

window.addEventListener('hashchange', route);

api('/api/admin/session').then((s) => {
  ctx.isAdmin = s.isAdmin; ctx.dbMode = s.dbMode;
  document.getElementById('db-hint').textContent = `Datenbank: ${s.dbMode === 'postgres' ? 'PostgreSQL-Server (DATABASE_URL)' : 'PostgreSQL über PGlite (lokale Datei)'}`;
}).catch(() => {}).finally(route);
