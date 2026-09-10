// Adminbereich: Dashboard, Fluff-Schnellerfassung, Editor, Import/Export,
// Stammdaten und Änderungsprotokoll.
import { api, setToken } from './api.js';
import { el, esc, toast, fmtScale, fmtDate, gameCard, emptyState, autocomplete, multiSelect, SCALE_HELP, SCALE_LABELS, STATUS_LABEL } from './ui.js';

const SCALE_STEPS = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];
let master = null;

async function loadMaster(force = false) {
  if (!master || force) master = await api('/api/master-data');
  return master;
}

function openPasswordDialog() {
  const dlg = el(`<dialog class="panel" style="max-width:26rem;border:none;border-radius:var(--radius-lg)">
    <form>
      <h2 style="font-size:var(--text-md);margin:0 0 var(--space-2)">Passwort ändern</h2>
      <div class="field"><label for="cpw0">Bisheriges Passwort</label><input type="password" id="cpw0" autocomplete="current-password" required></div>
      <div class="field"><label for="cpw1">Neues Passwort</label><input type="password" id="cpw1" autocomplete="new-password" minlength="10" required></div>
      <div class="field"><label for="cpw2">Neues Passwort wiederholen</label><input type="password" id="cpw2" autocomplete="new-password" minlength="10" required></div>
      <div id="cpw-error"></div>
      <div class="row-actions" style="justify-content:flex-end;margin-top:var(--space-3)">
        <button type="button" class="btn btn-ghost" id="cpw-cancel">Abbrechen</button>
        <button type="submit" class="btn btn-primary">Speichern</button>
      </div>
    </form>
  </dialog>`);
  document.body.appendChild(dlg);
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.querySelector('#cpw-cancel').addEventListener('click', close);
  dlg.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = dlg.querySelector('#cpw-error');
    errBox.innerHTML = '';
    const p1 = dlg.querySelector('#cpw1').value;
    if (p1 !== dlg.querySelector('#cpw2').value) {
      errBox.appendChild(el('<div class="error-box">Die beiden neuen Passwörter stimmen nicht überein.</div>'));
      return;
    }
    try {
      const r = await api('/api/admin/password', { method: 'POST', body: { current: dlg.querySelector('#cpw0').value, password: p1 } });
      setToken(r.token);
      close();
      toast('Passwort geändert.');
    } catch (err) {
      errBox.appendChild(el(`<div class="error-box">${esc(err.message)}</div>`));
    }
  });
  dlg.showModal();
}

function tabs(active) {
  const items = [['#/admin', 'Übersicht', 'dashboard'], ['#/admin/fluff', 'Fluff-Schnellerfassung', 'fluff'],
    ['#/admin/liste', 'Einträge', 'liste'], ['#/admin/editor', 'Neuer Eintrag', 'editor'],
    ['#/admin/import', 'Import & Export', 'import'], ['#/admin/stammdaten', 'Stammdaten', 'stammdaten'],
    ['#/admin/protokoll', 'Protokoll', 'protokoll']];
  return el(`<nav class="admin-tabs" aria-label="Adminbereich">${items.map(([href, label, key]) =>
    `<a href="${href}" ${key === active ? 'aria-current="page"' : ''}>${label}</a>`).join('')}</nav>`);
}

function adminHead(title, subtitle, extraHtml = '') {
  return el(`<div class="admin-head">
    <div><h1>${esc(title)}</h1><p class="muted" style="margin:.3rem 0 0">${esc(subtitle)}</p></div>
    <div class="row-actions">${extraHtml}<button type="button" class="btn btn-sm btn-ghost" id="change-pw">Passwort ändern</button><button type="button" class="btn btn-sm btn-ghost" id="logout">Abmelden</button></div>
  </div>`);
}

function mount(root, active, title, subtitle, extraHtml = '') {
  root.innerHTML = '';
  const head = adminHead(title, subtitle, extraHtml);
  head.querySelector('#change-pw').addEventListener('click', () => openPasswordDialog());
  head.querySelector('#logout').addEventListener('click', async () => {
    await api('/api/admin/logout', { method: 'POST' }).catch(() => {});
    setToken(null);
    location.hash = '#/admin';
    location.reload();
  });
  root.appendChild(head);
  root.appendChild(tabs(active));
  const body = el('<div></div>');
  root.appendChild(body);
  return body;
}

// ------------------------------------------------- Passwort erstmalig setzen
function renderSetup(root, next) {
  root.innerHTML = '';
  const card = el(`<form class="panel login-card">
    <h1 style="font-size:var(--text-lg);margin-bottom:var(--space-2)">Adminbereich einrichten</h1>
    <p class="muted" style="font-size:var(--text-sm)">Lege jetzt dein Admin-Passwort fest. Nur damit kannst du künftig Einträge anlegen und ändern. Mindestens 10 Zeichen.</p>
    <div class="field"><label for="pw1">Neues Passwort</label><input type="password" id="pw1" autocomplete="new-password" minlength="10" required></div>
    <div class="field"><label for="pw2">Passwort wiederholen</label><input type="password" id="pw2" autocomplete="new-password" minlength="10" required></div>
    <div id="setup-error"></div>
    <button type="submit" class="btn btn-primary" style="width:100%">Passwort festlegen</button>
    <p class="faint" style="font-size:var(--text-xs);margin-top:var(--space-4)">Bewahre das Passwort sicher auf – es lässt sich nicht zurücksetzen, ohne die Datenbank zu bearbeiten. Der Katalog selbst bleibt für alle öffentlich lesbar.</p>
  </form>`);
  card.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = card.querySelector('#setup-error');
    errBox.innerHTML = '';
    const pw1 = card.querySelector('#pw1').value;
    const pw2 = card.querySelector('#pw2').value;
    if (pw1 !== pw2) {
      errBox.appendChild(el('<div class="error-box">Die beiden Passwörter stimmen nicht überein.</div>'));
      return;
    }
    try {
      const r = await api('/api/admin/setup', { method: 'POST', body: { password: pw1 } });
      setToken(r.token);
      toast('Passwort gesetzt. Du bist angemeldet.');
      next();
    } catch (err) {
      errBox.appendChild(el(`<div class="error-box">${esc(err.message)}</div>`));
    }
  });
  root.appendChild(card);
  setTimeout(() => card.querySelector('#pw1').focus(), 50);
}

// ------------------------------------------------------------------ Login
export async function renderLogin(root, next) {
  root.innerHTML = '';
  try {
    const st = await api('/api/admin/setup-state');
    if (st.needsSetup) return renderSetup(root, next);
  } catch { /* im Zweifel normale Anmeldung zeigen */ }
  const card = el(`<form class="panel login-card">
    <h1 style="font-size:var(--text-lg);margin-bottom:var(--space-2)">Adminbereich</h1>
    <p class="muted" style="font-size:var(--text-sm)">Bitte Passwort eingeben. Nur du kannst hier Einträge ändern.</p>
    <div class="field"><label for="pw">Passwort</label><input type="password" id="pw" autocomplete="current-password" required></div>
    <div id="login-error"></div>
    <button type="submit" class="btn btn-primary" style="width:100%">Anmelden</button>
    <p class="faint" style="font-size:var(--text-xs);margin-top:var(--space-4)">Der Katalog selbst bleibt öffentlich lesbar.</p>
  </form>`);
  card.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = card.querySelector('#login-error');
    errBox.innerHTML = '';
    try {
      const r = await api('/api/admin/login', { method: 'POST', body: { password: card.querySelector('#pw').value } });
      setToken(r.token);
      toast('Angemeldet.');
      next();
    } catch (err) {
      errBox.appendChild(el(`<div class="error-box">${esc(err.message)}</div>`));
    }
  });
  root.appendChild(card);
  setTimeout(() => card.querySelector('#pw').focus(), 50);
}

// -------------------------------------------------------------- Dashboard
export async function renderDashboard(root) {
  const body = mount(root, 'dashboard', 'Übersicht', 'Stand der Sammlung und offene Aufgaben.');
  body.innerHTML = '<div class="skeleton" style="height:140px"></div>';
  const d = await api('/api/admin/dashboard');
  body.innerHTML = '';
  const c = d.counts;
  const tiles = el(`<div class="tiles">
    <a class="card tile" href="#/admin/liste?status=published"><span class="num">${c.published}</span><span class="lbl">Veröffentlicht</span></a>
    <a class="card tile" href="#/admin/liste?status=draft"><span class="num">${c.draft}</span><span class="lbl">Entwürfe</span></a>
    <a class="card tile" href="#/admin/liste?status=archived"><span class="num">${c.archived}</span><span class="lbl">Archiviert</span></a>
    <div class="card tile"><span class="num">${d.productCount}</span><span class="lbl">Produkte im Bestand</span></div>
    <a class="card tile task" href="#/admin/fluff"><span class="num">${c.without_fluff}</span><span class="lbl">${c.without_fluff === 1 ? 'Eintrag' : 'Einträge'} ohne Fluff-Wert – jetzt bewerten</span></a>
  </div>`);
  body.appendChild(tiles);

  if (c.without_fluff > 0) {
    body.appendChild(el(`<div class="help-box"><strong>Nächster Schritt:</strong> ${c.without_fluff} ${c.without_fluff === 1 ? 'Eintrag hat' : 'Einträge haben'} noch keinen Fluff-Wert.
      Die <a href="#/admin/fluff">Schnellerfassung</a> zeigt alle in einer Liste – ein Klick pro Spiel genügt.</div>`));
  }

  const sec = el(`<section class="section"><h2>Letzte Änderungen</h2><div class="panel scroll-x" style="padding:0">
    <table><thead><tr><th>Zeitpunkt</th><th>Aktion</th><th>Eintrag</th><th>Details</th></tr></thead><tbody></tbody></table></div></section>`);
  const tb = sec.querySelector('tbody');
  if (!d.audit.length) tb.appendChild(el('<tr><td colspan="4" class="muted">Noch keine Änderungen protokolliert.</td></tr>'));
  d.audit.forEach((a) => tb.appendChild(auditRow(a)));
  body.appendChild(sec);
}

const ACTION_LABEL = { insert: 'Neu angelegt', update: 'Geändert', delete: 'Gelöscht', import: 'Import', publish: 'Veröffentlicht', archive: 'Archiviert', restore: 'Zurückgeholt' };

function auditRow(a) {
  const keys = a.diff ? Object.keys(a.diff) : [];
  const summary = keys.length
    ? keys.slice(0, 4).map((k) => {
      const v = a.diff[k];
      if (v && typeof v === 'object' && 'vorher' in v) return `${k}: ${fmtVal(v.vorher)} → ${fmtVal(v.nachher)}`;
      return `${k}: ${fmtVal(v)}`;
    }).join(' · ') + (keys.length > 4 ? ` … (+${keys.length - 4})` : '')
    : 'keine Feldänderung';
  return el(`<tr><td class="muted" style="white-space:nowrap">${fmtDate(a.created_at)}</td>
    <td>${esc(ACTION_LABEL[a.action] || a.action)}<div class="faint" style="font-size:var(--text-xs)">${esc(a.actor)}</div></td>
    <td>${a.entity === 'games' && a.entity_id ? `<a href="#/admin/editor/${a.entity_id}">${esc(a.title || 'Eintrag ' + a.entity_id)}</a>` : esc(a.entity)}</td>
    <td class="diff">${esc(summary)}</td></tr>`);
}
const fmtVal = (v) => (v == null ? '–' : Array.isArray(v) ? v.join(', ') : String(v));

// ------------------------------------------------- Fluff-Schnellerfassung
export async function renderFluffQueue(root) {
  const body = mount(root, 'fluff', 'Fluff-Schnellerfassung', 'Alle Spiele ohne Fluff-Wert – direkt bewerten, ohne Formularwechsel.');
  body.innerHTML = '<div class="skeleton" style="height:160px"></div>';
  const { games } = await api('/api/admin/fluff-queue');
  body.innerHTML = '';
  body.appendChild(el(`<div class="help-box"><strong>Fluff</strong> = Ausarbeitungsgrad der gesamten offiziell veröffentlichten Spielwelt,
    unabhängig davon, wie viel davon du besitzt. Maßstab: ${SCALE_LABELS.fluff.join(' · ')}.</div>`));
  const counter = el(`<p class="muted" id="fluff-count">${games.length} ${games.length === 1 ? 'Eintrag offen' : 'Einträge offen'}</p>`);
  body.appendChild(counter);

  if (!games.length) {
    body.appendChild(emptyState('Alles bewertet', 'Für jedes Spiel liegt ein Fluff-Wert vor. Sehr gut!', '<p><a class="btn btn-sm" href="#/admin">Zur Übersicht</a></p>'));
    return;
  }
  const list = el('<div class="panel" style="padding:0"></div>');
  let open = games.length;
  games.forEach((g) => {
    const row = el(`<div class="fluff-row">
      <div>
        <strong>${esc(g.title)}</strong> <span class="badge badge-lang">${esc(g.language_code)}</span>
        <div class="faint" style="font-size:var(--text-xs)">${esc(g.system_family)} · Crunch ${fmtScale(g.crunch)} · Narrativ ${fmtScale(g.narrative)} · ${esc(g.primary_publisher || '')}</div>
        <div class="muted" style="font-size:var(--text-xs);margin-top:.2rem">${esc(g.short_description)}</div>
      </div>
      <div class="fluff-scale" role="group" aria-label="Fluff-Wert für ${esc(g.title)}">
        ${SCALE_STEPS.map((v) => `<button type="button" data-v="${v}">${String(v).replace('.', ',')}</button>`).join('')}
      </div>
    </div>`);
    row.querySelectorAll('button[data-v]').forEach((b) => b.addEventListener('click', async () => {
      const v = Number(b.dataset.v);
      row.querySelectorAll('button[data-v]').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      try {
        await api(`/api/admin/games/${g.id}/fluff`, { method: 'PATCH', body: { fluff: v } });
        if (!row.classList.contains('done')) { open--; counter.textContent = `${open} ${open === 1 ? 'Eintrag offen' : 'Einträge offen'}`; }
        row.classList.add('done');
        toast(`${g.title}: Fluff ${String(v).replace('.', ',')} gespeichert.`);
      } catch (e) { toast(e.message, 'err'); b.classList.remove('on'); }
    }));
    list.appendChild(row);
  });
  body.appendChild(list);
}

// ------------------------------------------------------------ Eintragsliste
export async function renderList(root, params) {
  const status = params.get('status') || 'all';
  const q = params.get('q') || '';
  const body = mount(root, 'liste', 'Einträge', 'Alle Einträge – auch Entwürfe und archivierte.',
    '<a class="btn btn-sm btn-primary" href="#/admin/editor">Neuer Eintrag</a>');
  const bar = el(`<div class="list-toolbar">
    <div class="search-box" style="max-width:320px"><input type="search" id="q" placeholder="Suchen …" value="${esc(q)}"></div>
    <select id="status" style="width:auto">
      <option value="all">Alle Status</option><option value="published">Veröffentlicht</option>
      <option value="draft">Entwurf</option><option value="archived">Archiviert</option>
    </select>
  </div>`);
  bar.querySelector('#status').value = status;
  const go = () => { location.hash = `#/admin/liste?status=${bar.querySelector('#status').value}&q=${encodeURIComponent(bar.querySelector('#q').value)}`; };
  bar.querySelector('#status').addEventListener('change', go);
  bar.querySelector('#q').addEventListener('change', go);
  body.appendChild(bar);

  const holder = el('<div class="panel scroll-x" style="padding:0"></div>');
  body.appendChild(holder);
  holder.innerHTML = '<div class="skeleton" style="height:200px;border:none"></div>';
  const data = await api(`/api/games?status=${status}&pageSize=96&sort=title&q=${encodeURIComponent(q)}`);
  holder.innerHTML = '';
  if (!data.games.length) { holder.appendChild(emptyState('Keine Einträge', 'Für diese Auswahl gibt es keine Einträge.')); return; }
  const table = el(`<table><thead><tr><th>Titel</th><th>Status</th><th>System</th><th>C</th><th>N</th><th>F</th><th>Produkte</th><th></th></tr></thead><tbody></tbody></table>`);
  const tb = table.querySelector('tbody');
  data.games.forEach((g) => {
    const tr = el(`<tr>
      <td><a href="#/admin/editor/${g.id}">${esc(g.title)}</a> <span class="badge badge-lang">${esc(g.language_code)}</span></td>
      <td><span class="badge badge-status ${g.status}">${STATUS_LABEL[g.status]}</span></td>
      <td class="muted">${esc(g.system_family)}</td>
      <td>${fmtScale(g.crunch)}</td><td>${fmtScale(g.narrative)}</td><td>${fmtScale(g.fluff)}</td>
      <td>${g.product_count}</td>
      <td class="row-actions">
        <a class="btn btn-sm" href="#/admin/editor/${g.id}">Bearbeiten</a>
        <a class="btn btn-sm btn-ghost" href="#/spiele/${esc(g.slug)}">Ansehen</a>
      </td></tr>`);
    tb.appendChild(tr);
  });
  holder.appendChild(table);
  body.appendChild(el(`<p class="muted" style="margin-top:var(--space-3)">${data.total} ${data.total === 1 ? 'Eintrag' : 'Einträge'}${data.total > data.games.length ? ` (erste ${data.games.length} angezeigt – Suche nutzen)` : ''}</p>`));
}

// ---------------------------------------------------------------- Editor
export async function renderEditor(root, id) {
  const body = mount(root, id ? 'liste' : 'editor', id ? 'Eintrag bearbeiten' : 'Neuer Eintrag',
    'Geführtes Formular in fünf Abschnitten. Pflichtfelder werden vor dem Speichern geprüft.');
  body.innerHTML = '<div class="skeleton" style="height:260px"></div>';
  const md = await loadMaster();
  let game = {
    title: '', original_title: '', language: 'de', system_family: '', edition: '', release_year: '',
    short_description: '', long_description: '', crunch: null, narrative: null, fluff: null,
    status: 'draft', editorial_note: '', publishers: [], genre_setting: [], play_focus: [], campaign_type: [], products: [],
  };
  if (id) {
    const r = await api('/api/admin/games/' + id);
    game = { ...r.game, publishers: r.game.publishers.map((p) => p.name), language: r.game.language,
      products: r.game.products.map((p) => ({ ...p })) };
  }
  body.innerHTML = '';

  const state = { ...game };
  const tagsOf = (kind) => md.tags.filter((t) => t.kind === kind).map((t) => t.name);

  let previewBox = null;
  let dupBox = null;
  const layout = el('<div class="editor-layout"><form id="editor-form"></form><aside class="editor-preview"></aside></div>');
  const form = layout.querySelector('form');
  const side = layout.querySelector('.editor-preview');
  body.appendChild(layout);

  // ---- 1. Grunddaten
  const s1 = step(1, 'Grunddaten', `
    <div class="grid-2">
      <div class="field"><label for="f-title">Titel *</label><input type="text" id="f-title" value="${esc(state.title)}" required>
        <div class="hint">So erscheint der Eintrag im Katalog.</div></div>
      <div class="field"><label for="f-orig">Originaltitel</label><input type="text" id="f-orig" value="${esc(state.original_title || '')}"></div>
      <div class="field"><label for="f-lang">Sprache *</label><select id="f-lang">
        ${md.languages.map((l) => `<option value="${l.code}" ${state.language === l.code ? 'selected' : ''}>${esc(l.label_de)}</option>`).join('')}
      </select></div>
      <div class="field"><label for="f-edition">Edition</label><input type="text" id="f-edition" value="${esc(state.edition || '')}">
        <div class="hint">Zum Beispiel „3rd Edition“ – hilft, Dubletten zu unterscheiden.</div></div>
      <div class="field"><label for="f-year">Erscheinungsjahr</label><input type="number" id="f-year" min="1970" max="2100" value="${state.release_year || ''}"></div>
    </div>
    <div class="field"><label for="f-desc">Kurzbeschreibung * <span class="faint">(10–400 Zeichen)</span></label>
      <textarea id="f-desc">${esc(state.short_description)}</textarea></div>
    <div class="field"><label for="f-long">Ausführliche Beschreibung</label><textarea id="f-long">${esc(state.long_description || '')}</textarea></div>`);
  form.appendChild(s1.wrap);

  // ---- 2. Einordnung
  const s2 = step(2, 'Einordnung', '<div id="slot-einordnung"></div>');
  form.appendChild(s2.wrap);
  const slot2 = s2.wrap.querySelector('#slot-einordnung');
  const sysAc = autocomplete({ value: state.system_family, options: md.systemFamilies.map((s) => s.name), placeholder: 'Systemfamilie suchen oder neu eingeben' });
  slot2.appendChild(fieldWrap('Systemfamilie *', sysAc.wrap, 'Neue Werte werden beim Speichern automatisch angelegt.'));
  const pubMs = multiSelect({ values: state.publishers, options: md.publishers.map((p) => p.name), placeholder: 'Verlag suchen oder neu eingeben' });
  slot2.appendChild(fieldWrap('Verlage * (erster Eintrag = Hauptverlag)', pubMs.wrap));
  const genreMs = multiSelect({ values: state.genre_setting, options: tagsOf('genre_setting'), placeholder: 'Genre / Setting' });
  slot2.appendChild(fieldWrap('Genre / Setting *', genreMs.wrap));
  const focusMs = multiSelect({ values: state.play_focus, options: tagsOf('play_focus'), placeholder: 'Spielfokus' });
  slot2.appendChild(fieldWrap('Spielfokus', focusMs.wrap));
  const campMs = multiSelect({ values: state.campaign_type, options: tagsOf('campaign_type'), placeholder: 'Kampagnenart' });
  slot2.appendChild(fieldWrap('Kampagnenart', campMs.wrap));

  // ---- 3. Skalen
  const scaleSelect = (key, label) => `<div class="field"><label for="f-${key}">${label}</label>
    <select id="f-${key}"><option value="">– noch offen –</option>
      ${SCALE_STEPS.map((v) => `<option value="${v}" ${Number(state[key]) === v ? 'selected' : ''}>${String(v).replace('.', ',')}</option>`).join('')}
    </select><div class="hint">${esc(SCALE_HELP[key])}</div></div>`;
  const s3 = step(3, 'Skalen (Crunch, Narrativ, Fluff)', `
    <div class="help-box">Die drei Skalen sind gleichwertig und laufen von 1 bis 5 in 0,5er-Schritten.
      Zum Veröffentlichen sind Crunch und Narrativ nötig; Fluff darf offen bleiben und erscheint dann in der Schnellerfassung.</div>
    <div class="grid-2">${scaleSelect('crunch', 'Crunch – Regeldichte')}${scaleSelect('narrative', 'Narrativ – Erzählmechanik')}${scaleSelect('fluff', 'Fluff – Ausarbeitung der Spielwelt')}</div>
    <details><summary class="muted" style="font-size:var(--text-sm);cursor:pointer">Was bedeuten die Stufen?</summary>
      <div class="muted" style="font-size:var(--text-sm);margin-top:var(--space-2)">
        <p><strong>Crunch:</strong> ${SCALE_LABELS.crunch.join(' · ')}</p>
        <p><strong>Narrativ:</strong> ${SCALE_LABELS.narrative.join(' · ')}</p>
        <p><strong>Fluff:</strong> ${SCALE_LABELS.fluff.join(' · ')}</p>
      </div></details>`);
  form.appendChild(s3.wrap);

  // ---- 4. Produkte
  const s4 = step(4, 'Produkte im Bestand', `
    <div class="help-box">Produkte sind die <strong>physisch vorhandenen Einzelprodukte</strong> – nicht alles, was es zum Spiel gibt.</div>
    <div id="products"></div>
    <button type="button" class="btn btn-sm" id="add-product">+ Weiteres Produkt hinzufügen</button>`);
  form.appendChild(s4.wrap);
  const prodBox = s4.wrap.querySelector('#products');
  const productRows = [];
  const productTypeOptions = md.productTypes.map((p) => p.name);
  function addProduct(p = { title: '', product_type: 'Grundregelwerk', binding: '', edition: '', language: '' }) {
    const row = el(`<div class="product-row">
      <div class="field" style="margin:0"><label>Titel</label><input type="text" class="p-title" value="${esc(p.title || '')}"></div>
      <div class="field" style="margin:0"><label>Typ</label><select class="p-type">
        ${productTypeOptions.map((t) => `<option ${p.product_type === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>
      <div class="field" style="margin:0"><label>Format</label><select class="p-binding">
        <option value="">–</option>
        ${['hardcover', 'softcover', 'box', 'heft', 'kartenset', 'pdf', 'schirm', 'trifold', 'sonstiges'].map((b) => `<option value="${b}" ${p.binding === b ? 'selected' : ''}>${{ schirm: 'Spielleiterschirm' }[b] || (b.charAt(0).toUpperCase() + b.slice(1))}</option>`).join('')}</select></div>
      <div class="field" style="margin:0"><label>Edition</label><input type="text" class="p-edition" value="${esc(p.edition || '')}"></div>
      <div class="field" style="margin:0"><label>Sprache</label><select class="p-lang"><option value="">wie Spiel</option>
        ${md.languages.map((l) => `<option value="${l.code}" ${p.language === l.code ? 'selected' : ''}>${l.code.toUpperCase()}</option>`).join('')}</select></div>
      <button type="button" class="btn btn-sm btn-danger" title="Produkt entfernen">Entfernen</button>
    </div>`);
    row.querySelector('button').addEventListener('click', () => { row.remove(); productRows.splice(productRows.indexOf(row), 1); updatePreview(); });
    row.querySelectorAll('input,select').forEach((i) => i.addEventListener('input', updatePreview));
    productRows.push(row);
    prodBox.appendChild(row);
    updatePreview();
  }
  (state.products || []).forEach(addProduct);
  if (!state.products?.length) addProduct();
  s4.wrap.querySelector('#add-product').addEventListener('click', () => addProduct());

  // ---- 5. Prüfen & Veröffentlichen
  const s5 = step(5, 'Prüfen & Veröffentlichen', `
    <div class="field"><label for="f-status">Status</label><select id="f-status">
      <option value="draft" ${state.status === 'draft' ? 'selected' : ''}>Entwurf – nicht öffentlich</option>
      <option value="published" ${state.status === 'published' ? 'selected' : ''}>Veröffentlicht – im Katalog sichtbar</option>
      <option value="archived" ${state.status === 'archived' ? 'selected' : ''}>Archiviert – aus dem Katalog genommen</option>
    </select><div class="hint">Einträge werden archiviert, nicht gelöscht.</div></div>
    <div class="field"><label for="f-note">Redaktioneller Hinweis (nicht öffentlich)</label><textarea id="f-note">${esc(state.editorial_note || '')}</textarea></div>
    <div id="form-messages"></div>
    <div class="row-actions">
      <button type="submit" class="btn btn-primary">${id ? 'Änderungen speichern' : 'Eintrag anlegen'}</button>
      ${id ? '<button type="button" class="btn" id="archive-btn">Archivieren</button>' : ''}
      <a class="btn btn-ghost" href="#/admin/liste">Abbrechen</a>
    </div>`, true);
  form.appendChild(s5.wrap);

  // ---- Live-Vorschau
  side.appendChild(el('<h2 style="font-size:var(--text-sm);text-transform:uppercase;letter-spacing:.07em;color:var(--text-faint);font-family:var(--font-body)">Live-Vorschau der Karte</h2>'));
  previewBox = el('<div></div>');
  side.appendChild(previewBox);
  dupBox = el('<div></div>');
  side.appendChild(dupBox);

  function val(sel) { return form.querySelector(sel)?.value ?? ''; }
  function collect() {
    return {
      title: val('#f-title').trim(),
      original_title: val('#f-orig').trim() || null,
      language: val('#f-lang') || 'de',
      edition: val('#f-edition').trim() || null,
      release_year: val('#f-year') || null,
      short_description: val('#f-desc').trim(),
      long_description: val('#f-long').trim() || null,
      system_family: sysAc.value,
      publishers: pubMs.values,
      genre_setting: genreMs.values, play_focus: focusMs.values, campaign_type: campMs.values,
      crunch: val('#f-crunch') || null,
      narrative: val('#f-narrative') || null,
      fluff: val('#f-fluff') || null,
      status: val('#f-status') || state.status || 'draft',
      editorial_note: val('#f-note').trim() || null,
      products: productRows.map((r) => ({
        title: r.querySelector('.p-title').value.trim(),
        product_type: r.querySelector('.p-type').value,
        binding: r.querySelector('.p-binding').value || null,
        edition: r.querySelector('.p-edition').value.trim() || null,
        language: r.querySelector('.p-lang').value || null,
      })).filter((p) => p.title),
    };
  }

  function updatePreview() {
    if (!previewBox) return;
    const d = collect();
    previewBox.innerHTML = '';
    previewBox.appendChild(gameCard({
      slug: state.slug || '', title: d.title || 'Ohne Titel', language_code: d.language,
      system_family: d.system_family || 'Systemfamilie offen',
      short_description: d.short_description || 'Noch keine Kurzbeschreibung.',
      genre_setting: d.genre_setting, play_focus: d.play_focus, campaign_type: d.campaign_type,
      crunch: d.crunch ? Number(d.crunch) : null, narrative: d.narrative ? Number(d.narrative) : null,
      fluff: d.fluff ? Number(d.fluff) : null, primary_publisher: d.publishers[0] || null,
      product_count: d.products.length, status: d.status,
    }, { showStatus: true }));
  }
  form.querySelectorAll('input,select,textarea').forEach((i) => i.addEventListener('input', updatePreview));
  [sysAc.input].forEach((i) => i.addEventListener('input', updatePreview));
  form.addEventListener('click', () => setTimeout(updatePreview, 0));
  updatePreview();

  // Dublettenwarnung vor dem Speichern
  let dupTimer;
  const checkDupes = async () => {
    const d = collect();
    if (!dupBox) return;
    if (!d.title) { dupBox.innerHTML = ''; return; }
    try {
      const r = await api(`/api/admin/duplicates?title=${encodeURIComponent(d.title)}&language=${d.language}&edition=${encodeURIComponent(d.edition || '')}${id ? `&excludeId=${id}` : ''}`);
      dupBox.innerHTML = '';
      if (r.duplicates.length) {
        dupBox.appendChild(el(`<div class="warn-box"><strong>Mögliche Dublette:</strong><ul style="margin:.4rem 0 0;padding-left:1.1rem">
          ${r.duplicates.map((x) => `<li>${esc(x.title)}${x.edition ? ' (' + esc(x.edition) + ')' : ''} · ${x.language_code.toUpperCase()} ${x.exact ? '– identischer Titel!' : `– ${Math.round(x.sim * 100)} % Ähnlichkeit`}</li>`).join('')}
        </ul></div>`));
      }
    } catch { /* Hinweis ist optional */ }
  };
  form.querySelector('#f-title').addEventListener('input', () => { clearTimeout(dupTimer); dupTimer = setTimeout(checkDupes, 400); });
  checkDupes();

  if (id) {
    s5.wrap.querySelector('#archive-btn').addEventListener('click', async () => {
      if (!window.confirm('Diesen Eintrag archivieren? Er bleibt erhalten, ist aber nicht mehr öffentlich sichtbar.')) return;
      try { await api(`/api/games/${id}/status`, { method: 'PATCH', body: { status: 'archived' } }); toast('Eintrag archiviert.'); location.hash = '#/admin/liste'; }
      catch (e) { toast(e.message, 'err'); }
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = form.querySelector('#form-messages');
    msg.innerHTML = '';
    form.querySelectorAll('.field').forEach((f) => { f.classList.remove('invalid'); f.querySelector('.error')?.remove(); });
    const payload = collect();
    const submit = async (confirmDuplicate = false) => {
      try {
        const r = await api(id ? `/api/games/${id}` : '/api/games', { method: id ? 'PATCH' : 'POST', body: { ...payload, confirmDuplicate } });
        toast(id ? 'Änderungen gespeichert.' : 'Eintrag angelegt.');
        master = null;
        location.hash = '#/admin/liste';
        return r;
      } catch (err) {
        if (err.status === 409 && err.data?.duplicates && !err.data.blocking) {
          const list = err.data.duplicates.map((x) => `${x.title} (${x.language_code.toUpperCase()})`).join(', ');
          if (window.confirm(`${err.message}\n\nÄhnliche Einträge: ${list}\n\nTrotzdem speichern?`)) return submit(true);
          return null;
        }
        msg.appendChild(el(`<div class="error-box"><strong>${esc(err.message)}</strong>
          ${err.data?.errors ? `<ul style="margin:.4rem 0 0;padding-left:1.1rem">${err.data.errors.map((x) => `<li>${esc(x.message)}</li>`).join('')}</ul>` : ''}
          ${err.data?.duplicates ? `<ul style="margin:.4rem 0 0;padding-left:1.1rem">${err.data.duplicates.map((x) => `<li>${esc(x.title)} (${x.language_code.toUpperCase()})</li>`).join('')}</ul>` : ''}
        </div>`));
        (err.data?.errors || []).forEach((x) => {
          const node = form.querySelector('#f-' + ({ short_description: 'desc', system_family: null, publishers: null, genre_setting: null }[x.field] ?? x.field));
          node?.closest('.field')?.classList.add('invalid');
        });
        msg.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return null;
      }
    };
    await submit(false);
  });
}

function step(n, title, innerHtml, open = false) {
  const wrap = el(`<details class="step" ${open || n === 1 ? 'open' : ''}>
    <summary><span class="step-num">${n}</span>${esc(title)}</summary>
    <div class="step-body">${innerHtml}</div>
  </details>`);
  return { wrap };
}
function fieldWrap(label, node, hint = '') {
  const f = el(`<div class="field"><label>${esc(label)}</label></div>`);
  f.appendChild(node);
  if (hint) f.appendChild(el(`<div class="hint">${esc(hint)}</div>`));
  return f;
}

// -------------------------------------------------------- Import / Export
export function renderImport(root) {
  const body = mount(root, 'import', 'Import & Export', 'CSV oder JSON einlesen – erst Vorschau, dann Übernahme. Export als vollständiges Backup.');
  body.appendChild(el(`<section class="section">
    <h2>Export (Backup)</h2>
    <div class="panel">
      <p class="muted">Vollständiger Bestand inklusive Produkte, Stammdaten und Skalen.</p>
      <div class="row-actions">
        <button type="button" class="btn btn-sm btn-primary" id="dl-json">JSON herunterladen</button>
        <button type="button" class="btn btn-sm" id="dl-csv">CSV herunterladen (Altformat + Spalte „fluff“)</button>
      </div>
      <p class="faint" style="font-size:var(--text-xs);margin-top:var(--space-3)">Die Datei wird direkt im Browser erzeugt. JSON eignet sich als vollständiges Backup, CSV für die Bearbeitung in Excel.</p>
    </div>
  </section>`));

  const dl = async (kind) => {
    try {
      const res = await api(`/api/admin/export.${kind}`, { raw: true });
      if (!res.ok) throw new Error('Export nicht möglich – bitte neu anmelden.');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = url; a.download = `rpg-katalog-${stamp}.${kind}`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast('Export erstellt.');
    } catch (e) { toast(e.message, 'err'); }
  };
  body.querySelector('#dl-json').addEventListener('click', () => dl('json'));
  body.querySelector('#dl-csv').addEventListener('click', () => dl('csv'));

  const sec = el(`<section class="section"><h2>Import</h2>
    <div class="dropzone" id="drop">
      <p><strong>Datei hierher ziehen</strong> oder auswählen – CSV (Semikolon) oder JSON.</p>
      <input type="file" id="file" accept=".csv,.json,text/csv,application/json" style="max-width:320px;margin-inline:auto">
    </div>
    <div id="import-result"></div>
  </section>`);
  body.appendChild(sec);
  const drop = sec.querySelector('#drop');
  const result = sec.querySelector('#import-result');

  const handle = async (file) => {
    if (!file) return;
    const content = await file.text();
    const format = file.name.toLowerCase().endsWith('.json') ? 'json' : 'csv';
    result.innerHTML = '<div class="skeleton" style="height:120px"></div>';
    try {
      const r = await api('/api/admin/import', { method: 'POST', body: { filename: file.name, format, content } });
      showPreview(result, r);
    } catch (e) {
      result.innerHTML = '';
      result.appendChild(el(`<div class="error-box">${esc(e.message)}</div>`));
    }
  };
  sec.querySelector('#file').addEventListener('change', (e) => handle(e.target.files[0]));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('hover'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('hover'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('hover'); handle(e.dataTransfer.files[0]); });

  api('/api/admin/dashboard').then((d) => {
    if (!d.imports.length) return;
    const sec2 = el(`<section class="section"><h2>Bisherige Importläufe</h2><div class="panel scroll-x" style="padding:0">
      <table><thead><tr><th>Datei</th><th>Format</th><th>Start</th><th>Zeilen</th><th>OK</th><th>Fehler</th><th>Status</th></tr></thead>
      <tbody>${d.imports.map((i) => `<tr><td>${esc(i.source_name)}</td><td>${esc(i.source_format)}</td><td class="muted">${fmtDate(i.started_at)}</td>
        <td>${i.rows_total}</td><td>${i.rows_ok}</td><td>${i.rows_failed}</td>
        <td>${i.committed ? '<span class="badge badge-status published">übernommen</span>' : '<span class="badge badge-status draft">nur Vorschau</span>'}</td></tr>`).join('')}</tbody></table>
    </div></section>`);
    body.appendChild(sec2);
  }).catch(() => {});
}

function showPreview(container, r) {
  container.innerHTML = '';
  const errors = r.issues.filter((i) => i.severity === 'error');
  const warnings = r.issues.filter((i) => i.severity === 'warning');
  const infos = r.issues.filter((i) => i.severity === 'info');
  container.appendChild(el(`<div class="${errors.length ? 'error-box' : 'help-box'}" style="margin-top:var(--space-4)">
    <strong>Vorschau für „${esc(r.filename)}“:</strong> ${r.rowsTotal} Zeilen gelesen, ${r.rowsOk} übernehmbar,
    ${r.rowsFailed} mit blockierenden Fehlern · ${errors.length} Fehler, ${warnings.length} Warnungen, ${infos.length} Hinweise.
    ${errors.length ? ' Zeilen mit Fehlern werden nicht übernommen.' : ''}
  </div>`));

  if (r.issues.length) {
    const tbl = el(`<div class="panel scroll-x" style="padding:0;margin-bottom:var(--space-4)">
      <table><thead><tr><th>Zeile</th><th>Schwere</th><th>Feld</th><th>Wert</th><th>Hinweis</th></tr></thead>
      <tbody>${[...errors, ...warnings, ...infos].slice(0, 120).map((i) => `<tr>
        <td>${i.row_number ?? '–'}</td><td><span class="sev ${i.severity}">${i.severity === 'error' ? 'Fehler' : i.severity === 'warning' ? 'Warnung' : 'Hinweis'}</span></td>
        <td class="muted">${esc(i.field || '–')}</td><td class="muted">${esc((i.value || '').slice(0, 40))}</td><td>${esc(i.message)}</td></tr>`).join('')}</tbody></table></div>`);
    container.appendChild(tbl);
  }

  const tbl2 = el(`<div class="panel scroll-x" style="padding:0"><table>
    <thead><tr><th>Zeile</th><th>Aktion</th><th>Titel</th><th>Sprache</th><th>System</th><th>C</th><th>N</th><th>F</th><th>Produkte</th></tr></thead>
    <tbody>${r.preview.map((p) => `<tr><td>${p.rowNumber}</td>
      <td>${p.mode === 'insert' ? '<span class="badge badge-status published">neu</span>' : '<span class="badge badge-status draft">aktualisiert</span>'}</td>
      <td>${esc(p.title)}</td><td>${esc(p.language.toUpperCase())}</td><td class="muted">${esc(p.system_family)}</td>
      <td>${fmtScale(p.crunch)}</td><td>${fmtScale(p.narrative)}</td><td>${fmtScale(p.fluff)}</td><td>${p.products}</td></tr>`).join('')}</tbody></table></div>`);
  container.appendChild(tbl2);

  const actions = el(`<div class="row-actions" style="margin-top:var(--space-4)">
    <button type="button" class="btn btn-primary" id="commit">${r.rowsOk} Zeilen jetzt übernehmen</button>
    <button type="button" class="btn btn-ghost" id="cancel">Verwerfen</button>
  </div>`);
  actions.querySelector('#cancel').addEventListener('click', () => { container.innerHTML = '<p class="muted">Import verworfen. Es wurde nichts geändert.</p>'; });
  actions.querySelector('#commit').addEventListener('click', async (e) => {
    e.target.disabled = true;
    e.target.textContent = 'Übernehme …';
    try {
      const out = await api(`/api/admin/import/${r.runId}/commit`, { method: 'POST', body: {} });
      container.innerHTML = '';
      container.appendChild(el(`<div class="help-box"><strong>Import übernommen.</strong> ${out.inserted} neu angelegt, ${out.updated} aktualisiert.
        <a href="#/admin">Zur Übersicht</a></div>`));
      toast('Import übernommen.');
    } catch (err) {
      toast(err.message, 'err');
      e.target.disabled = false;
      e.target.textContent = 'Erneut versuchen';
    }
  });
  if (r.rowsOk === 0) actions.querySelector('#commit').disabled = true;
  container.appendChild(actions);
}

// ------------------------------------------------------------ Stammdaten
export async function renderMasterData(root) {
  const body = mount(root, 'stammdaten', 'Stammdaten', 'Verlage, Systemfamilien, Schlagworte und Produkttypen. Löschen ist nur möglich, wenn nichts darauf verweist.');
  body.innerHTML = '<div class="skeleton" style="height:200px"></div>';
  const md = await loadMaster(true);
  body.innerHTML = '';
  const groups = [
    ['publishers', 'Verlage', md.publishers, null],
    ['system-families', 'Systemfamilien', md.systemFamilies, null],
    ['product-types', 'Produkttypen', md.productTypes, null],
    ['tags', 'Genre / Setting', md.tags.filter((t) => t.kind === 'genre_setting'), 'genre_setting'],
    ['tags', 'Spielfokus', md.tags.filter((t) => t.kind === 'play_focus'), 'play_focus'],
    ['tags', 'Kampagnenart', md.tags.filter((t) => t.kind === 'campaign_type'), 'campaign_type'],
  ];
  for (const [kind, label, items, tagKind] of groups) {
    const sec = el(`<section class="section"><h2>${esc(label)} (${items.length})</h2>
      <div class="panel" style="padding:0">
        <div style="padding:var(--space-4);border-bottom:1px solid var(--border);display:flex;gap:var(--space-2);flex-wrap:wrap">
          <input type="text" placeholder="Neuen Wert anlegen …" style="max-width:280px">
          <button type="button" class="btn btn-sm">Anlegen</button>
        </div>
        <div class="scroll-x"><table><thead><tr><th>Name</th><th>Verwendet</th><th></th></tr></thead><tbody></tbody></table></div>
      </div></section>`);
    const tb = sec.querySelector('tbody');
    items.forEach((it) => {
      const tr = el(`<tr><td>${esc(it.name)}</td><td class="muted">${it.usage_count}×</td>
        <td class="row-actions"><button type="button" class="btn btn-sm" data-act="rename">Umbenennen</button>
        <button type="button" class="btn btn-sm btn-danger" data-act="del" ${it.usage_count > 0 ? 'disabled title="Wird noch verwendet"' : ''}>Löschen</button></td></tr>`);
      tr.querySelector('[data-act=rename]').addEventListener('click', async () => {
        const name = window.prompt(`Neuen Namen für „${it.name}“ eingeben:`, it.name);
        if (!name || name === it.name) return;
        try { await api(`/api/admin/master-data/${kind}/${it.id}`, { method: 'PATCH', body: { name } }); toast('Umbenannt.'); renderMasterData(root); }
        catch (e) { toast(e.message, 'err'); }
      });
      tr.querySelector('[data-act=del]').addEventListener('click', async () => {
        if (!window.confirm(`„${it.name}“ wirklich löschen?`)) return;
        try { await api(`/api/admin/master-data/${kind}/${it.id}`, { method: 'DELETE' }); toast('Gelöscht.'); renderMasterData(root); }
        catch (e) { toast(e.message, 'err'); }
      });
      tb.appendChild(tr);
    });
    if (!items.length) tb.appendChild(el('<tr><td colspan="3" class="muted">Noch keine Werte.</td></tr>'));
    const input = sec.querySelector('input');
    sec.querySelector('.btn').addEventListener('click', async () => {
      const name = input.value.trim();
      if (name.length < 2) { toast('Bitte mindestens 2 Zeichen eingeben.', 'err'); return; }
      try {
        await api(`/api/admin/master-data/${kind}`, { method: 'POST', body: { name, tagKind } });
        toast('Angelegt.'); renderMasterData(root);
      } catch (e) { toast(e.message, 'err'); }
    });
    body.appendChild(sec);
  }
}

// -------------------------------------------------------------- Protokoll
export async function renderAudit(root) {
  const body = mount(root, 'protokoll', 'Änderungsprotokoll', 'Jede Änderung wird mit Zeitpunkt und Unterschieden aufgezeichnet.');
  body.innerHTML = '<div class="skeleton" style="height:200px"></div>';
  const { entries } = await api('/api/admin/audit?limit=120');
  body.innerHTML = '';
  const holder = el(`<div class="panel scroll-x" style="padding:0"><table>
    <thead><tr><th>Zeitpunkt</th><th>Aktion</th><th>Eintrag</th><th>Details</th></tr></thead><tbody></tbody></table></div>`);
  const tb = holder.querySelector('tbody');
  if (!entries.length) tb.appendChild(el('<tr><td colspan="4" class="muted">Noch keine Einträge.</td></tr>'));
  entries.forEach((a) => tb.appendChild(auditRow(a)));
  body.appendChild(holder);
}
