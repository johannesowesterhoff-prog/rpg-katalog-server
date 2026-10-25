// Öffentliche Katalogseite: Suche, Filter-Sidebar, Kartenraster, URL-Zustand.
import { api } from './api.js';
import { el, esc, gameCard, skeletonGrid, emptyState, toast, SCALE_HELP } from './ui.js';

// Array-Facetten, bei denen ein Spiel mehrere Werte gleichzeitig tragen kann --
// dort ist ein ODER/UND-Umschalter sinnvoll (im Gegensatz zu Sprache/Verlag/
// Systemfamilie, die pro Spiel einwertig sind).
const MODE_DIMS = ['genreTop', 'genre', 'toneTop', 'tone', 'focus', 'campaign'];
const DEFAULTS = { q: '', language: [], publisher: [], systemFamily: [], genreTop: [], genre: [], focus: [], campaign: [], toneTop: [], tone: [], crunchMin: 1, crunchMax: 5, narrativeMin: 1, narrativeMax: 5, fluffMin: 1, fluffMax: 5, sort: 'title', page: 1, ...Object.fromEntries(MODE_DIMS.map((k) => [k + 'Mode', 'OR'])) };
const MULTI = ['language', 'publisher', 'systemFamily', 'genreTop', 'genre', 'focus', 'campaign', 'toneTop', 'tone'];
const SCALES = [['crunch', 'Crunch'], ['narrative', 'Narrativ'], ['fluff', 'Fluff']];

export function stateFromQuery(params) {
  const s = structuredClone(DEFAULTS);
  // Mehrfachwerte sind mit | getrennt -- Kommas kommen in Werten vor
  // (z.B. Systemfamilie "Eigenes System (regelleicht, kinderfreundlich)").
  for (const k of MULTI) { const v = params.get(k); if (v) s[k] = v.split('|').filter(Boolean); }
  if (params.get('q')) s.q = params.get('q');
  for (const k of MODE_DIMS) if (params.get(k + 'Mode') === 'AND') s[k + 'Mode'] = 'AND';
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
  for (const k of MULTI) if (s[k].length) p.set(k, s[k].join('|'));
  for (const k of MODE_DIMS) if (s[k].length > 1 && s[k + 'Mode'] === 'AND') p.set(k + 'Mode', 'AND');
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
  const names = { language: 'Sprache', publisher: 'Verlag', systemFamily: 'System', genreTop: 'Top Genre', genre: 'Sub Genre', focus: 'Fokus', campaign: 'Kampagne', toneTop: 'Top Tone', tone: 'Sub Tone' };
  for (const k of MULTI) s[k].forEach((v) => chips.push({ label: `${names[k]}: ${v}`, clear: (st) => { st[k] = st[k].filter((x) => x !== v); } }));
  for (const [key, label] of SCALES) {
    if (s[key + 'Min'] > 1 || s[key + 'Max'] < 5) {
      chips.push({ label: `${label} ${String(s[key + 'Min']).replace('.', ',')}–${String(s[key + 'Max']).replace('.', ',')}`, clear: (st) => { st[key + 'Min'] = 1; st[key + 'Max'] = 5; } });
    }
  }
  return chips;
}

export function renderCatalog(root, ctx) {
  const s = stateFromQuery(ctx.params);

  // Die Suche re-rendert den kompletten Katalog bei jeder Änderung (via
  // Hash-Routing) -- ohne diese Rettung verliert das #suche-Feld dabei den
  // Fokus (neues DOM-Element), was auf dem Handy und bei schnellem Tippen
  // dazu führt, dass man quasi jeden Buchstaben einzeln eintippen muss.
  const prevInput = document.getElementById('suche');
  const hadFocus = !!prevInput && document.activeElement === prevInput;
  const selStart = hadFocus ? prevInput.selectionStart : null;
  const selEnd = hadFocus ? prevInput.selectionEnd : null;

  root.innerHTML = '';

  const head = el(`<section class="catalog-head">
    <h1>Rollenspiel-Katalog</h1>
    <p class="lede">Alle Spiele der Sammlung – durchsuchen, filtern, entdecken.</p>
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

  if (hadFocus) {
    const newInput = head.querySelector('#suche');
    newInput.focus();
    newInput.setSelectionRange(selStart, selEnd);
  }

  const layout = el(`<div class="catalog-layout">
    <aside class="sidebar" id="filter-sidebar" aria-label="Filter">
      <div class="drawer-head"><h2 style="font-size:var(--text-md)">Filter</h2><button type="button" class="btn btn-sm" id="drawer-close">Schließen</button></div>
      <div id="filters"></div>
    </aside>
    <div>
      <div class="result-bar">
        <div class="result-count" id="count">Lade …</div>
        <div class="chips" id="chips"></div>
        <button type="button" class="btn btn-sm" id="roulette-btn" title="Zufälliges Spiel aus der aktuellen Auswahl">🎲 Regal-Roulette</button>
      </div>
      <div id="roulette"></div>
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
  // Escape schließt den Drawer. Einmalig am Dokument registriert, weil
  // renderCatalog() bei jeder Filteränderung neu läuft.
  if (!document.body.dataset.drawerEsc) {
    document.body.dataset.drawerEsc = '1';
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });
  }
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

  layout.querySelector('#roulette-btn').addEventListener('click', () => openRoulette(layout.querySelector('#roulette'), s));

  results.appendChild(skeletonGrid(6));

  // ---- Daten laden
  const qs = queryFromState(s).toString();
  Promise.all([api('/api/games?' + qs), api('/api/facets?' + qs)])
    .then(([data, facets]) => {
      renderFilters(filters, s, facets, push);
      countBox.innerHTML = data.total === 0
        ? 'Keine Treffer'
        : `<strong>${data.total}</strong> ${data.total === 1 ? 'Eintrag' : 'Einträge'}`;
      results.innerHTML = '';
      if (!data.games.length) {
        results.appendChild(emptyState('Keine Treffer', 'Für diese Filterkombination gibt es keine Einträge. Filter lockern oder zurücksetzen.',
          '<p><a class="btn btn-sm" href="#/">Filter zurücksetzen</a></p>'));
        return;
      }
      const grid = el('<div class="card-grid"></div>');
      const cardOpts = {
        onTag: (t) => push((st) => { st.genreTop = st.genreTop.includes(t) ? st.genreTop.filter((x) => x !== t) : [...st.genreTop, t]; }),
        onToneTag: (t) => push((st) => { st.toneTop = st.toneTop.includes(t) ? st.toneTop.filter((x) => x !== t) : [...st.toneTop, t]; }),
      };
      data.games.forEach((g) => grid.appendChild(gameCard(g, cardOpts)));
      results.appendChild(grid);
      // Seitenzahlen als Standard; „Weitere laden“ hängt zusätzlich die
      // nächste Seite unten an, ohne die Seite zu wechseln.
      let page = data.page;
      const firstPage = data.page;
      const moreBox = el('<div class="load-more"></div>');
      const pager = el('<nav class="pagination" aria-label="Seiten"></nav>');
      const renderPager = () => {
        pager.innerHTML = '';
        if (data.pages <= 1) return;
        const go = (p) => push((st) => { st.page = p; }, { keepPage: true });
        const btn = (label, p, { current = false, disabled = false, aria = '' } = {}) => {
          const b = el(`<button type="button" class="btn btn-sm${current ? ' btn-primary' : ''}"${current ? ' aria-current="page"' : ''}${aria ? ` aria-label="${aria}"` : ''}>${label}</button>`);
          b.disabled = disabled;
          if (!current && !disabled) b.addEventListener('click', () => go(p));
          return b;
        };
        pager.appendChild(btn('‹', firstPage - 1, { disabled: firstPage <= 1, aria: 'Vorherige Seite' }));
        for (let p = 1; p <= data.pages; p++) pager.appendChild(btn(String(p), p, { current: p >= firstPage && p <= page }));
        pager.appendChild(btn('›', page + 1, { disabled: page >= data.pages, aria: 'Nächste Seite' }));
      };
      const renderMore = () => {
        moreBox.innerHTML = '';
        const shownCount = grid.children.length;
        if (page >= data.pages) return;
        const more = el(`<button type="button" class="btn">Weitere ${Math.min(data.pageSize || 25, data.total - (page * (data.pageSize || 25)))} laden <span class="faint">(${shownCount} von ${data.total})</span></button>`);
        more.addEventListener('click', async () => {
          more.disabled = true;
          try {
            const next = await api('/api/games?' + queryFromState({ ...s, page: page + 1 }).toString());
            next.games.forEach((g) => grid.appendChild(gameCard(g, cardOpts)));
            page = next.page;
            renderMore();
            renderPager();
          } catch (e) { toast(e.message, 'err'); more.disabled = false; }
        });
        moreBox.appendChild(more);
      };
      renderMore();
      renderPager();
      results.appendChild(moreBox);
      results.appendChild(pager);
    })
    .catch((e) => {
      results.innerHTML = '';
      countBox.textContent = '';
      results.appendChild(emptyState('Katalog nicht erreichbar', e.message + ' Bitte Seite neu laden.'));
      toast(e.message, 'err');
    });
}

// ------------------------------------------------------------ Regal-Roulette
// Zieht ein zufälliges Spiel aus der aktuellen Auswahl (alle gesetzten Filter
// gelten), auf Wunsch nur aus Spielen ohne protokollierten Spielabend.
async function openRoulette(box, s) {
  const qs = queryFromState({ ...s, page: 1 });
  qs.delete('page');
  qs.set('pageSize', '100');
  let pool = [];
  try {
    for (let page = 1, pages = 1; page <= pages && page <= 20; page++) {
      qs.set('page', String(page));
      const d = await api('/api/games?' + qs);
      pool.push(...d.games);
      pages = d.pages;
    }
  } catch (e) { toast(e.message, 'err'); return; }
  let last = null;
  const panel = el(`<section class="panel roulette" aria-live="polite">
    <div class="roulette-head">
      <strong>🎲 Wie wär's mit …</strong>
      <label class="roulette-opt"><input type="checkbox" id="roulette-new"> nur ungespielte</label>
      <span class="roulette-actions">
        <button type="button" class="btn btn-sm btn-primary" id="roulette-again">Nochmal würfeln</button>
        <button type="button" class="btn btn-sm btn-ghost" id="roulette-close" aria-label="Schließen">×</button>
      </span>
    </div>
    <p class="faint roulette-from"></p>
    <div class="roulette-card"></div>
  </section>`);
  const candidatesNow = () => {
    const onlyNew = panel.querySelector('#roulette-new').checked;
    const candidates = pool.filter((g) => !onlyNew || !g.session_count);
    panel.querySelector('.roulette-from').textContent =
      `Gezogen aus ${candidates.length} ${candidates.length === 1 ? 'Spiel' : 'Spielen'} der aktuellen Auswahl${onlyNew ? ' ohne Spielabend' : ''}.`;
    return candidates;
  };
  const roll = () => {
    const candidates = candidatesNow();
    const slot = panel.querySelector('.roulette-card');
    slot.innerHTML = '';
    if (!candidates.length) { last = null; slot.appendChild(el('<p class="muted">Keine passenden Spiele – Filter lockern oder „nur ungespielte“ abwählen.</p>')); return; }
    const choices = candidates.length > 1 ? candidates.filter((g) => g.slug !== last) : candidates;
    const g = choices[Math.floor(Math.random() * choices.length)];
    last = g.slug;
    slot.appendChild(gameCard(g));
  };
  panel.querySelector('#roulette-again').addEventListener('click', roll);
  // Der Haken grenzt nur den Topf ein: Das gezogene Spiel bleibt stehen,
  // solange es noch passt – neu gewürfelt wird nur, wenn es rausfällt.
  panel.querySelector('#roulette-new').addEventListener('change', () => {
    if (candidatesNow().some((g) => g.slug === last)) return;
    roll();
  });
  panel.querySelector('#roulette-close').addEventListener('click', () => { box.innerHTML = ''; });
  box.innerHTML = '';
  box.appendChild(panel);
  roll();
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}


function modeSwitchHtml(dim, s, label) {
  return `<div class="mode-switch" role="group" aria-label="${esc(label)}-Verknüpfung">
    <button type="button" data-mode="OR" class="${s[dim + 'Mode'] === 'OR' ? 'on' : ''}">ODER</button>
    <button type="button" data-mode="AND" class="${s[dim + 'Mode'] === 'AND' ? 'on' : ''}">UND</button>
  </div>`;
}

/** Facettengruppe mit optionalem ODER/UND-Umschalter (wenn dim in MODE_DIMS ist). */
function facetGroup(title, dim, items, s, push) {
  const selected = s[dim];
  const extraHtml = MODE_DIMS.includes(dim) ? modeSwitchHtml(dim, s, title) : '';
  const group = el(`<div class="filter-group"><h3>${esc(title)}</h3>${extraHtml}<div class="facet-list"></div></div>`);
  if (MODE_DIMS.includes(dim)) {
    group.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => push((st) => { st[dim + 'Mode'] = b.dataset.mode; })));
  }
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

  container.appendChild(facetGroup('Top Genre / Setting', 'genreTop', facets.genresTop, s, push));
  container.appendChild(facetGroup('Top Tone / Themen', 'toneTop', facets.toneThemesTop, s, push));

  const scaleGroup = el('<div class="filter-group"><h3>Skalen (gleichwertig)</h3></div>');
  SCALES.forEach(([key, label]) => scaleGroup.appendChild(rangeGroup(key, label, s, push)));
  scaleGroup.appendChild(el('<p class="faint" style="font-size:var(--text-xs);margin:0">Einträge ohne Wert werden ausgeblendet, sobald ein Bereich eingeschränkt wird.</p>'));
  container.appendChild(scaleGroup);

  container.appendChild(facetGroup('Spielfokus', 'focus', facets.focus, s, push));
  container.appendChild(facetGroup('Systemfamilie', 'systemFamily', facets.systemFamilies, s, push));
  container.appendChild(facetGroup('Kampagnenart', 'campaign', facets.campaigns, s, push));
  container.appendChild(facetGroup('Sub Genre / Setting', 'genre', facets.genres, s, push));
  container.appendChild(facetGroup('Sub Tone / Themen', 'tone', facets.toneThemes, s, push));
  container.appendChild(facetGroup('Verlag', 'publisher', facets.publishers, s, push));
  container.appendChild(facetGroup('Sprache', 'language', facets.languages, s, push));
}
