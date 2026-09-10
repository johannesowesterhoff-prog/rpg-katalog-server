// Öffentliche Katalogseite: Suche, Filter-Sidebar, Kartenraster, URL-Zustand.
import { api } from './api.js';
import { el, esc, gameCard, skeletonGrid, emptyState, toast, SCALE_HELP } from './ui.js';

const DEFAULTS = { q: '', language: [], publisher: [], systemFamily: [], genre: [], genreMode: 'OR', focus: [], campaign: [], hasProducts: false, crunchMin: 1, crunchMax: 5, narrativeMin: 1, narrativeMax: 5, fluffMin: 1, fluffMax: 5, sort: 'title', page: 1 };
const MULTI = ['language', 'publisher', 'systemFamily', 'genre', 'focus', 'campaign'];
const SCALES = [['crunch', 'Crunch'], ['narrative', 'Narrativ'], ['fluff', 'Fluff']];

export function stateFromQuery(params) {
  const s = structuredClone(DEFAULTS);
  for (const k of MULTI) { const v = params.get(k); if (v) s[k] = v.split(',').filter(Boolean); }
  if (params.get('q')) s.q = params.get('q');
  if (params.get('genreMode') === 'AND') s.genreMode = 'AND';
  if (params.get('hasProducts') === '1') s.hasProducts = true;
  for (const [key] of SCALES) {
    const mn = params.get(key + 'Min'), mx = params.get(key + 'Max');
    if (mn) s[key + 'Min'] = Number(mn);
    if (mx) s[key + 'Max'] = Number(mx);
  }
  if (params.get('sort')) s.sort = params.get('sort');
  if (params.get('page')) s.page = Math.max(1, Number(params.get('page')) || 1);
  return s;
}

export function queryFromState(s) {
  const p = new URLSearchParams();
  if (s.q) p.set('q', s.q);
  for (const k of MULTI) if (s[k].length) p.set(k, s[k].join(','));
  if (s.genre.length > 1 && s.genreMode === 'AND') p.set('genreMode', 'AND');
  if (s.hasProducts) p.set('hasProducts', '1');
  for (const [key] of SCALES) {
    if (s[key + 'Min'] > 1) p.set(key + 'Min', String(s[key + 'Min']));
    if (s[key + 'Max'] < 5) p.set(key + 'Max', String(s[key + 'Max']));
  }
  if (s.sort !== 'title') p.set('sort', s.sort);
  if (s.page > 1) p.set('page', String(s.page));
  return p;
}

function activeChips(s) {
  const chips = [];
  if (s.q) chips.push({ label: `Suche: „${s.q}“`, clear: (st) => { st.q = ''; } });
  const names = { language: 'Sprache', publisher: 'Verlag', systemFamily: 'System', genre: 'Genre', focus: 'Fokus', campaign: 'Kampagne' };
  for (const k of MULTI) s[k].forEach((v) => chips.push({ label: `${names[k]}: ${v}`, clear: (st) => { st[k] = st[k].filter((x) => x !== v); } }));
  for (const [key, label] of SCALES) {
    if (s[key + 'Min'] > 1 || s[key + 'Max'] < 5) {
      chips.push({ label: `${label} ${String(s[key + 'Min']).replace('.', ',')}–${String(s[key + 'Max']).replace('.', ',')}`, clear: (st) => { st[key + 'Min'] = 1; st[key + 'Max'] = 5; } });
    }
  }
  if (s.hasProducts) chips.push({ label: 'nur mit Produkten', clear: (st) => { st.hasProducts = false; } });
  return chips;
}

export function renderCatalog(root, ctx) {
  const s = stateFromQuery(ctx.params);
  root.innerHTML = '';

  const head = el(`<section class="catalog-head">
    <h1>Rollenspiel-Katalog</h1>
    <p class="lede">Alle Spiele der Sammlung mit Einordnung nach <strong>Crunch</strong>, <strong>Narrativ</strong> und <strong>Fluff</strong> sowie den tatsächlich vorhandenen Produkten.</p>
    <div class="search-row">
      <div class="search-box">
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4.2-4.2"/></svg>
        <input type="search" id="suche" placeholder="Titel, System oder Beschreibung suchen …" value="${esc(s.q)}" aria-label="Katalog durchsuchen">
      </div>
      <button type="button" class="btn filter-toggle" id="drawer-open">Filter</button>
      <div class="sort-box">
        <label for="sortierung">Sortierung</label>
        <select id="sortierung">
          <option value="title">Titel A–Z</option>
          <option value="neu">Zuletzt geändert</option>
          <option value="crunch">Crunch</option>
          <option value="narrative">Narrativ</option>
          <option value="fluff">Fluff</option>
        </select>
      </div>
    </div>
  </section>`);
  head.querySelector('#sortierung').value = s.sort;
  root.appendChild(head);

  const layout = el(`<div class="catalog-layout">
    <aside class="sidebar" id="filter-sidebar" aria-label="Filter">
      <div class="drawer-head"><h2 style="font-size:var(--text-md)">Filter</h2><button type="button" class="btn btn-sm" id="drawer-close">Schließen</button></div>
      <div id="filters"></div>
    </aside>
    <div>
      <div class="result-bar">
        <div class="result-count" id="count">Lade …</div>
        <div class="chips" id="chips"></div>
      </div>
      <div id="results"></div>
    </div>
  </div>`);
  root.appendChild(layout);
  root.appendChild(el('<div class="drawer-backdrop" id="drawer-backdrop"></div>'));

  const results = layout.querySelector('#results');
  const filters = layout.querySelector('#filters');
  const countBox = layout.querySelector('#count');
  const chipBox = layout.querySelector('#chips');

  const closeDrawer = () => document.body.classList.remove('drawer-open');
  head.querySelector('#drawer-open').addEventListener('click', () => document.body.classList.add('drawer-open'));
  layout.querySelector('#drawer-close').addEventListener('click', closeDrawer);
  root.querySelector('#drawer-backdrop').addEventListener('click', closeDrawer);

  const push = (mutate, { keepPage = false } = {}) => {
    mutate(s);
    if (!keepPage) s.page = 1;
    location.hash = '#/?' + queryFromState(s).toString();
  };

  // ---- Suche mit Verzögerung
  const searchInput = head.querySelector('#suche');
  let timer;
  searchInput.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => push((st) => { st.q = searchInput.value.trim(); }), 350);
  });
  head.querySelector('#sortierung').addEventListener('change', (e) => push((st) => { st.sort = e.target.value; }));

  // ---- Chips
  const chips = activeChips(s);
  chipBox.innerHTML = '';
  if (chips.length) {
    chips.forEach((c) => {
      const b = el(`<button type="button" class="chip">${esc(c.label)} <span aria-hidden="true">×</span></button>`);
      b.addEventListener('click', () => push(c.clear));
      chipBox.appendChild(b);
    });
    const reset = el('<button type="button" class="btn btn-sm btn-ghost">Alle Filter zurücksetzen</button>');
    reset.addEventListener('click', () => { location.hash = '#/'; });
    chipBox.appendChild(reset);
  }

  results.appendChild(skeletonGrid(6));

  // ---- Daten laden
  const qs = queryFromState(s).toString();
  Promise.all([api('/api/games?' + qs), api('/api/facets?' + qs)])
    .then(([data, facets]) => {
      renderFilters(filters, s, facets, push);
      countBox.innerHTML = data.total === 0
        ? 'Keine Treffer'
        : `<strong>${data.total}</strong> ${data.total === 1 ? 'Eintrag' : 'Einträge'}${data.pages > 1 ? ` · Seite ${data.page} von ${data.pages}` : ''}`;
      results.innerHTML = '';
      if (!data.games.length) {
        results.appendChild(emptyState('Keine Treffer', 'Für diese Filterkombination gibt es keine Einträge. Filter lockern oder zurücksetzen.',
          '<p><a class="btn btn-sm" href="#/">Filter zurücksetzen</a></p>'));
        return;
      }
      const grid = el('<div class="card-grid"></div>');
      data.games.forEach((g) => grid.appendChild(gameCard(g, {
        onTag: (t) => push((st) => { st.genre = st.genre.includes(t) ? st.genre.filter((x) => x !== t) : [...st.genre, t]; }),
      })));
      results.appendChild(grid);
      if (data.pages > 1) results.appendChild(pagination(data, push));
    })
    .catch((e) => {
      results.innerHTML = '';
      countBox.textContent = '';
      results.appendChild(emptyState('Katalog nicht erreichbar', e.message + ' Bitte Seite neu laden.'));
      toast(e.message, 'err');
    });
}

function pagination(data, push) {
  const box = el('<nav class="pagination" aria-label="Seiten"></nav>');
  const btn = (label, page, disabled = false, current = false) => {
    const b = el(`<button type="button" class="btn btn-sm ${current ? 'btn-primary' : ''}">${label}</button>`);
    b.disabled = disabled;
    if (current) b.setAttribute('aria-current', 'page');
    b.addEventListener('click', () => { push((st) => { st.page = page; }, { keepPage: true }); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    return b;
  };
  box.appendChild(btn('← Zurück', data.page - 1, data.page <= 1));
  const from = Math.max(1, data.page - 2), to = Math.min(data.pages, from + 4);
  for (let i = from; i <= to; i++) box.appendChild(btn(String(i), i, false, i === data.page));
  box.appendChild(btn('Weiter →', data.page + 1, data.page >= data.pages));
  return box;
}

function facetGroup(title, dim, items, selected, push, extraHtml = '') {
  const group = el(`<div class="filter-group"><h3>${esc(title)}</h3>${extraHtml}<div class="facet-list"></div></div>`);
  const list = group.querySelector('.facet-list');
  const known = new Set(items.map((i) => i.value));
  const all = [...items, ...selected.filter((v) => !known.has(v)).map((v) => ({ value: v, label: v, count: 0 }))];
  const visible = all.slice(0, 8);
  const rest = all.slice(8);
  const addRow = (i) => {
    const on = selected.includes(i.value);
    const row = el(`<label class="check ${i.count === 0 && !on ? 'is-zero' : ''}">
      <input type="checkbox" ${on ? 'checked' : ''}>
      <span>${esc(i.label)}</span><span class="count">${i.count}</span>
    </label>`);
    row.querySelector('input').addEventListener('change', () => push((st) => {
      st[dim] = on ? st[dim].filter((x) => x !== i.value) : [...st[dim], i.value];
    }));
    list.appendChild(row);
  };
  visible.forEach(addRow);
  if (rest.length) {
    const more = el(`<button type="button" class="btn btn-sm btn-ghost facet-more">${rest.length} weitere anzeigen</button>`);
    more.addEventListener('click', () => { rest.forEach(addRow); more.remove(); });
    group.appendChild(more);
  }
  if (!all.length) list.appendChild(el('<p class="faint" style="font-size:var(--text-xs)">Keine Werte im aktuellen Filterstand.</p>'));
  return group;
}

function rangeGroup(key, label, s, push) {
  const min = s[key + 'Min'], max = s[key + 'Max'];
  const box = el(`<div class="range">
    <div class="range-head"><b title="${esc(SCALE_HELP[key])}">${esc(label)}</b>
      <span class="val">${String(min).replace('.', ',')} – ${String(max).replace('.', ',')}</span></div>
    <div class="range-track">
      <div class="fill"></div>
      <input type="range" min="1" max="5" step="0.5" value="${min}" aria-label="${esc(label)} Minimum">
      <input type="range" min="1" max="5" step="0.5" value="${max}" aria-label="${esc(label)} Maximum">
    </div>
  </div>`);
  const [lo, hi] = box.querySelectorAll('input');
  const fill = box.querySelector('.fill');
  const val = box.querySelector('.val');
  const paint = () => {
    const a = Number(lo.value), b = Number(hi.value);
    fill.style.left = ((a - 1) / 4 * 100) + '%';
    fill.style.width = ((b - a) / 4 * 100) + '%';
    val.textContent = `${String(a).replace('.', ',')} – ${String(b).replace('.', ',')}`;
  };
  const guard = (which) => {
    let a = Number(lo.value), b = Number(hi.value);
    if (a > b) { if (which === 'lo') hi.value = String(a); else lo.value = String(b); }
    paint();
  };
  lo.addEventListener('input', () => guard('lo'));
  hi.addEventListener('input', () => guard('hi'));
  const commit = () => push((st) => { st[key + 'Min'] = Number(lo.value); st[key + 'Max'] = Number(hi.value); });
  lo.addEventListener('change', commit);
  hi.addEventListener('change', commit);
  paint();
  return box;
}

function renderFilters(container, s, facets, push) {
  container.innerHTML = '';
  const scaleGroup = el('<div class="filter-group"><h3>Skalen (gleichwertig)</h3></div>');
  SCALES.forEach(([key, label]) => scaleGroup.appendChild(rangeGroup(key, label, s, push)));
  scaleGroup.appendChild(el('<p class="faint" style="font-size:var(--text-xs);margin:0">Einträge ohne Wert werden ausgeblendet, sobald ein Bereich eingeschränkt wird.</p>'));
  container.appendChild(scaleGroup);

  const modeHtml = `<div class="mode-switch" role="group" aria-label="Genre-Verknüpfung">
    <button type="button" data-mode="OR" class="${s.genreMode === 'OR' ? 'on' : ''}">ODER</button>
    <button type="button" data-mode="AND" class="${s.genreMode === 'AND' ? 'on' : ''}">UND</button>
  </div>`;
  const genreGroup = facetGroup('Genre / Setting', 'genre', facets.genres, s.genre, push, modeHtml);
  genreGroup.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => push((st) => { st.genreMode = b.dataset.mode; })));
  container.appendChild(genreGroup);

  container.appendChild(facetGroup('Sprache', 'language', facets.languages, s.language, push));
  container.appendChild(facetGroup('Systemfamilie', 'systemFamily', facets.systemFamilies, s.systemFamily, push));
  container.appendChild(facetGroup('Spielfokus', 'focus', facets.focus, s.focus, push));
  container.appendChild(facetGroup('Kampagnenart', 'campaign', facets.campaigns, s.campaign, push));
  container.appendChild(facetGroup('Verlag', 'publisher', facets.publishers, s.publisher, push));

  const prod = el(`<div class="filter-group"><h3>Bestand</h3>
    <label class="check"><input type="checkbox" ${s.hasProducts ? 'checked' : ''}>
      <span>nur mit vorhandenen Produkten</span><span class="count">${facets.summary?.with_products ?? ''}</span></label>
  </div>`);
  prod.querySelector('input').addEventListener('change', () => push((st) => { st.hasProducts = !st.hasProducts; }));
  container.appendChild(prod);
}
