// Statistik-Seite: aggregierte Kennzahlen über die veröffentlichte Sammlung
// (Verteilungen, Skalen-Durchschnitte, Spielabend-Auswertung).
import { api } from './api.js';
import { el, esc, emptyState, CAMPAIGN_KIND_LABEL, PLAY_MODE_LABEL, campaignSessionBadges } from './ui.js';

function barSection(title, rows) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return `<section class="section">
    <h2>${esc(title)}</h2>
    ${rows.length ? `<div class="stat-bars">${rows.map((r) => `<div class="stat-bar-row">
      <span class="stat-bar-label">${esc(r.value || '–')}</span>
      <span class="bar"><i style="width:${(r.count / max) * 100}%"></i></span>
      <span class="stat-bar-count">${r.count}</span>
    </div>`).join('')}</div>` : '<p class="muted">Keine Daten.</p>'}
  </section>`;
}

const fmtDateOnly = (v) => (v ? new Date(v).toLocaleDateString('de-DE') : '–');

function wireDotTooltip(section) {
  const wrap = section.querySelector('.scatter-wrap');
  if (!wrap) return;
  const tooltip = wrap.querySelector('.scatter-tooltip');
  const show = (dot, evt) => {
    const rect = wrap.getBoundingClientRect();
    tooltip.innerHTML = `<strong>${esc(dot.dataset.title)}</strong><br>Wert: ${dot.dataset.value}`;
    let x = evt.clientX - rect.left + 12;
    let y = evt.clientY - rect.top + 12;
    tooltip.hidden = false;
    x = Math.min(x, rect.width - tooltip.offsetWidth - 4);
    y = Math.min(y, rect.height - tooltip.offsetHeight - 4);
    tooltip.style.left = `${Math.max(4, x)}px`;
    tooltip.style.top = `${Math.max(4, y)}px`;
  };
  wrap.querySelectorAll('.scatter-dot').forEach((dot) => {
    dot.addEventListener('pointerenter', (evt) => show(dot, evt));
    dot.addEventListener('pointermove', (evt) => show(dot, evt));
    dot.addEventListener('pointerleave', () => { tooltip.hidden = true; });
  });
}

// Ein Punktwolken-Diagramm je Skala (Crunch/Narrativ/Fluff), unabhängig
// voneinander -- keine Verknüpfung zwischen den drei Werten. Je Spielwert
// (1-5 in 0,5er-Schritten) wird ein Turm aus Punkten gestapelt, ein Punkt
// pro Spiel mit genau diesem Wert. 3 ist die Skalenmitte und bekommt eine
// kräftigere Mittellinie.
function dotPlot(label, games, field) {
  const entries = games
    .map((g) => ({ title: g.title, value: g[field] == null ? null : Number(g[field]) }))
    .filter((e) => e.value != null);

  const values = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];
  const buckets = new Map(values.map((v) => [v, []]));
  entries.forEach((e) => { if (buckets.has(e.value)) buckets.get(e.value).push(e.title); });
  const maxCount = Math.max(1, ...[...buckets.values()].map((b) => b.length));

  const W = 340;
  const dotR = 3.5;
  const pitch = Math.min(9, Math.max(dotR * 2 + 1, 120 / maxCount));
  const pad = { l: 18, r: 18, t: 8, b: 26 };
  const plotW = W - pad.l - pad.r;
  const H = pad.t + pad.b + maxCount * pitch + dotR * 2;
  const domain = [0.5, 5.5];
  const sx = (v) => pad.l + ((v - domain[0]) / (domain[1] - domain[0])) * plotW;
  const baseline = H - pad.b;

  const ticks = [1, 2, 3, 4, 5];
  const gridLines = ticks.map((t) => `<line x1="${sx(t)}" y1="${pad.t}" x2="${sx(t)}" y2="${baseline}" class="scatter-grid${t === 3 ? ' origin' : ''}"></line>`).join('');
  const tickLabels = ticks.map((t) => `<text x="${sx(t)}" y="${baseline + 18}" class="scatter-tick" text-anchor="middle">${t}</text>`).join('');

  const dots = values.flatMap((v) => buckets.get(v).map((title, i) => `
    <circle cx="${sx(v).toFixed(1)}" cy="${(baseline - dotR - i * pitch).toFixed(1)}" r="${dotR}" class="scatter-dot"
      data-title="${esc(title)}" data-value="${v}"></circle>`)).join('');

  return `<section class="section">
    <h2>${esc(label)}</h2>
    <p class="muted" style="font-size:var(--text-xs);margin:-.4rem 0 var(--space-3)">Jeder Punkt ein Spiel mit diesem Wert · 3 ist die Skalenmitte.</p>
    ${entries.length ? `<div class="scatter-wrap">
      <svg viewBox="0 0 ${W} ${H}" class="scatter-svg" role="img" aria-label="Verteilung ${esc(label)}, Punkte pro Skalenwert">
        ${gridLines}
        ${tickLabels}
        ${dots}
      </svg>
      <div class="scatter-tooltip" hidden></div>
    </div>` : '<p class="muted">Keine Daten.</p>'}
  </section>`;
}

// Reiter oben auf der Statistikseite: Übersicht und das Spielabend-Protokoll.
function statsTabs(active) {
  const items = [['#/statistik', 'Übersicht', 'overview'], ['#/statistik/spielabende', 'Spielabende', 'sessions']];
  return `<nav class="admin-tabs" aria-label="Statistik">${items.map(([href, label, key]) =>
    `<a href="${href}"${key === active ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</nav>`;
}

export async function renderStats(root, sub, params) {
  if (sub === 'spielabende') return renderSessionLog(root, params);
  root.innerHTML = '<div class="catalog-head"><div class="skeleton" style="height:220px"></div></div>';
  document.title = 'Statistik – RPG-Katalog';

  let s;
  try {
    s = await api('/api/stats.json');
  } catch (e) {
    root.innerHTML = '';
    root.appendChild(emptyState('Statistik nicht verfügbar', e.message));
    return;
  }

  root.innerHTML = '';
  const head = el(`<section class="catalog-head">
    <h1>Statistik</h1>
    <p class="lede">Zahlen und Verteilungen über die gesamte veröffentlichte Sammlung.</p>
  </section>`);
  root.appendChild(head);
  root.appendChild(el(statsTabs('overview')));

  const tiles = el(`<div class="tiles">
    <div class="card tile"><span class="num">${s.totals.games}</span><span class="lbl">Spiele</span></div>
    <div class="card tile"><span class="num">${s.totals.products}</span><span class="lbl">Produkte</span></div>
    <div class="card tile"><span class="num">${s.totals.publishers}</span><span class="lbl">Verlage</span></div>
    <div class="card tile"><span class="num">${s.totals.sessions}</span><span class="lbl">Spielabende protokolliert</span></div>
  </div>`);
  root.appendChild(tiles);

  const scaleTiles = el(`<div class="tiles">
    <div class="card tile"><span class="num">${s.scales.crunch ?? '–'}</span><span class="lbl">Ø Crunch</span></div>
    <div class="card tile"><span class="num">${s.scales.narrativ ?? '–'}</span><span class="lbl">Ø Narrativ</span></div>
    <div class="card tile"><span class="num">${s.scales.fluff ?? '–'}</span><span class="lbl">Ø Fluff</span></div>
  </div>`);
  root.appendChild(scaleTiles);

  const dotPlotGrid = el('<div class="stat-grid"></div>');
  root.appendChild(dotPlotGrid);
  [['Crunch', 'crunch'], ['Narrativ', 'narrative'], ['Fluff', 'fluff']].forEach(([label, field]) => {
    const section = el(dotPlot(label, s.scatter, field));
    dotPlotGrid.appendChild(section);
    wireDotTooltip(section);
  });

  const distGrid = el(`<div class="stat-grid"></div>`);
  distGrid.innerHTML = barSection('Top Genre / Setting', s.genreDist)
    + barSection('Top Tone / Themen', s.toneDist)
    + barSection('Systemfamilie', s.systemDist)
    + barSection('Kampagnenart', s.campaignDist)
    + barSection('Sprache', s.langDist);
  root.appendChild(distGrid);

  const titleLink = (title, slug) => (slug ? `<a href="#/spiele/${esc(slug)}">${esc(title)}</a>` : `${esc(title)} <span class="faint" style="font-size:var(--text-xs)">(extern)</span>`);

  const mostPlayedHtml = s.mostPlayed.length
    ? `<ol class="stat-list">${s.mostPlayed.map((g) => `<li>
        ${titleLink(g.title, g.slug)}
        <span class="muted">${g.sessions}× gespielt, zuletzt ${fmtDateOnly(g.last_played)}</span>
      </li>`).join('')}</ol>`
    : '<p class="muted">Noch keine Spielabende protokolliert.</p>';

  const recentHtml = s.recentSessions.length
    ? `<ol class="stat-list">${s.recentSessions.map((r) => `<li>
        ${titleLink(r.title, r.slug)}
        <span class="muted">${esc(fmtDateOnly(r.played_on))}</span>
        ${r.note ? `<p class="faint" style="font-size:var(--text-xs);margin:.2rem 0 0">${esc(r.note)}</p>` : ''}
      </li>`).join('')}</ol>`
    : '<p class="muted">Noch keine Spielabende protokolliert.</p>';

  const sessionSections = el(`<div class="stat-grid">
    <section class="section"><h2>Meistgespielt</h2>${mostPlayedHtml}</section>
    <section class="section"><h2>Zuletzt gespielt</h2>${recentHtml}</section>
  </div>`);
  root.appendChild(sessionSections);

  const roleMap = Object.fromEntries((s.roleStats || []).map((r) => [r.value, r.count]));
  if (roleMap.spielleiter || roleMap.spieler) {
    const roleTiles = el(`<div class="tiles">
      <div class="card tile"><span class="num">${roleMap.spielleiter || 0}</span><span class="lbl">× Spielleiter:in</span></div>
      <div class="card tile"><span class="num">${roleMap.spieler || 0}</span><span class="lbl">× Spieler:in</span></div>
    </div>`);
    root.appendChild(roleTiles);
  }

  if (s.campaigns?.length) {
    const kindTag = (c) => (CAMPAIGN_KIND_LABEL[c.campaign_kind] ? `, ${CAMPAIGN_KIND_LABEL[c.campaign_kind]}` : '');
    const campaignsHtml = `<ol class="stat-list">${s.campaigns.map((c) => `<li>
        <b>${esc(c.campaign)}</b> <span class="faint" style="font-size:var(--text-xs)">(${c.campaign_status === 'abgeschlossen' ? 'abgeschlossen' : 'laufend'}${kindTag(c)})</span>
        ${c.campaign_announcement_url ? `<a href="${esc(c.campaign_announcement_url)}" target="_blank" rel="noopener" class="faint" style="font-size:var(--text-xs)"> · Aushang ↗</a>` : ''}
        <br>${titleLink(c.title, c.slug)}
        <span class="muted">${c.sessions}× gespielt, zuletzt ${fmtDateOnly(c.last_played)}</span>
      </li>`).join('')}</ol>`;
    root.appendChild(el(`<section class="section"><h2>Kampagnen</h2>${campaignsHtml}</section>`));
  }
}

// ------------------------------------------------------------ Spielabende
// Alle protokollierten Spielabende, filterbar nach Jahr, Spiel, Kampagne und
// Freitext (Spiel, Kampagne, Notiz). Die Filter stehen in der URL, z. B.
// #/statistik/spielabende?jahr=2026&spiel=forbidden-lands, damit sich eine
// Ansicht teilen lässt. "Meistgespielt" steht bewusst nur auf der Übersicht.
// Die Kampagnen-Badges zählen über alle Abende, damit "Session x/M" auch
// gefiltert stimmt.
async function renderSessionLog(root, params) {
  root.innerHTML = '<div class="catalog-head"><div class="skeleton" style="height:220px"></div></div>';
  document.title = 'Spielabende – Statistik – RPG-Katalog';

  let data;
  try {
    data = await api('/api/play-sessions.json');
  } catch (e) {
    root.innerHTML = '';
    root.appendChild(emptyState('Spielabende nicht verfügbar', e.message));
    return;
  }

  const all = data.sessions;
  const yearOf = (s) => Number(s.played_on.slice(0, 4));
  const gameKey = (s) => s.slug || `x:${s.title}`;
  const years = [...new Set(all.map(yearOf))].sort((a, b) => b - a);
  const requestedYear = Number(params?.get('jahr'));
  const state = {
    year: years.includes(requestedYear) ? requestedYear : null,
    game: params?.get('spiel') || '',
    campaign: params?.get('kampagne') || '',
    q: params?.get('q') || '',
    mode: params?.get('spielform') || '',
  };

  root.innerHTML = '';
  root.appendChild(el(`<section class="catalog-head">
    <h1>Statistik</h1>
    <p class="lede">Alle protokollierten Spielabende.</p>
  </section>`));
  root.appendChild(el(statsTabs('sessions')));

  const games = [...new Map(all.map((s) => [gameKey(s), s.title])).entries()].sort((a, b) => a[1].localeCompare(b[1], 'de'));
  const campaigns = [...new Set(all.map((s) => s.campaign).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de'));
  const filters = el(`<div class="search-row session-filters">
    <div class="search-box">
      <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4.2-4.2"/></svg>
      <input type="search" id="sl-q" placeholder="Spiel, Kampagne oder Notiz suchen …" aria-label="Spielabende durchsuchen">
    </div>
    <select id="sl-game" aria-label="Spiel"><option value="">Alle Spiele</option>${games.map(([k, t]) => `<option value="${esc(k)}">${esc(t)}</option>`).join('')}</select>
    <select id="sl-campaign" aria-label="Kampagne"><option value="">Alle Kampagnen</option>${campaigns.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select>
    <select id="sl-mode" aria-label="Spielform"><option value="">Am Tisch &amp; online</option>${Object.entries(PLAY_MODE_LABEL).map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>
    ${years.length > 1 ? `<select id="sl-year" aria-label="Jahr"><option value="">Alle Jahre</option>${years.map((y) => `<option value="${y}">${y}</option>`).join('')}</select>` : ''}
    <button type="button" class="btn btn-sm" id="sl-reset" hidden>Filter zurücksetzen</button>
  </div>`);
  root.appendChild(filters);
  const qInput = filters.querySelector('#sl-q');
  const gameSel = filters.querySelector('#sl-game');
  const campSel = filters.querySelector('#sl-campaign');
  const yearSel = filters.querySelector('#sl-year');
  const modeSel = filters.querySelector('#sl-mode');
  qInput.value = state.q;
  gameSel.value = state.game;
  campSel.value = state.campaign;
  modeSel.value = PLAY_MODE_LABEL[state.mode] ? state.mode : '';
  if (yearSel) yearSel.value = state.year ? String(state.year) : '';

  const content = el('<div></div>');
  root.appendChild(content);

  const titleLink = (title, slug) => (slug ? `<a href="#/spiele/${esc(slug)}">${esc(title)}</a>` : `${esc(title)} <span class="faint" style="font-size:var(--text-xs)">(extern)</span>`);

  // Spaltensortierung wie im Adminbereich: Klick sortiert, erneuter Klick dreht
  // die Richtung. Standard ist Datum, neueste zuerst; am selben Tag entscheidet
  // die Session-Nummer. Leere Werte stehen immer unten, bei Gleichstand gilt
  // das Datum (neueste zuerst).
  let sort = { key: 'played_on', dir: 'desc' };
  const SORT_VALUE = { game: (s) => s.title, campaign: (s) => s.campaign, play_mode: (s) => PLAY_MODE_LABEL[s.play_mode], note: (s) => s.note };
  const chrono = (a, b) => a.played_on.localeCompare(b.played_on) || ((a.session_number ?? 0) - (b.session_number ?? 0));
  function sortSessions(list) {
    const sign = sort.dir === 'asc' ? 1 : -1;
    if (sort.key === 'played_on') return [...list].sort((a, b) => sign * chrono(a, b));
    const get = SORT_VALUE[sort.key];
    return [...list].sort((a, b) => {
      const va = get(a) || '', vb = get(b) || '';
      if (!va !== !vb) return va ? -1 : 1;
      return sign * va.localeCompare(vb, 'de', { sensitivity: 'base', numeric: true }) || chrono(b, a);
    });
  }
  const sortHead = (key, label) => {
    const active = sort.key === key;
    return `<th data-sort="${key}" aria-sort="${active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}"><button type="button" class="sort-btn">${label}${active ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</button></th>`;
  };

  function syncUrl() {
    const qs = new URLSearchParams();
    if (state.year) qs.set('jahr', state.year);
    if (state.game) qs.set('spiel', state.game);
    if (state.campaign) qs.set('kampagne', state.campaign);
    if (state.q) qs.set('q', state.q);
    if (state.mode) qs.set('spielform', state.mode);
    const hash = `#/statistik/spielabende${qs.toString() ? `?${qs}` : ''}`;
    if (location.hash !== hash) history.replaceState(null, '', hash);
  }

  function renderContent() {
    const needle = state.q.trim().toLowerCase();
    const sessions = sortSessions(all.filter((s) => (!state.year || yearOf(s) === state.year)
      && (!state.game || gameKey(s) === state.game)
      && (!state.campaign || s.campaign === state.campaign)
      && (!state.mode || s.play_mode === state.mode)
      && (!needle || [s.title, s.campaign, s.note].some((v) => v && v.toLowerCase().includes(needle)))));
    const narrowed = state.game || state.campaign || state.mode || needle;
    filters.querySelector('#sl-reset').hidden = !(narrowed || state.year);

    // Rollen gibt es nur aufsummiert pro Jahr, daher nur ohne weitere Filter.
    const roles = { spielleiter: 0, spieler: 0 };
    (data.rolesByYear || []).filter((r) => !state.year || r.year === state.year).forEach((r) => { roles[r.role] = (roles[r.role] || 0) + r.count; });

    content.innerHTML = '';
    content.appendChild(el(`<div class="tiles">
      <div class="card tile"><span class="num">${sessions.length}</span><span class="lbl">Spielabende</span></div>
      <div class="card tile"><span class="num">${new Set(sessions.map(gameKey)).size}</span><span class="lbl">verschiedene Spiele</span></div>
      <div class="card tile"><span class="num">${sessions.filter((s) => s.play_mode === 'am-tisch').length}</span><span class="lbl">× am Tisch</span></div>
      <div class="card tile"><span class="num">${sessions.filter((s) => s.play_mode === 'online').length}</span><span class="lbl">× online</span></div>
      ${narrowed ? '' : `<div class="card tile"><span class="num">${roles.spielleiter}</span><span class="lbl">× Spielleiter:in</span></div>
      <div class="card tile"><span class="num">${roles.spieler}</span><span class="lbl">× Spieler:in</span></div>`}
    </div>`));

    const list = el(`<section class="section">
      <h2>Spielabende (${sessions.length})</h2>
      ${sessions.length ? `<div class="scroll-x"><table>
        <thead><tr>${sortHead('played_on', 'Datum')}${sortHead('game', 'Spiel')}${sortHead('campaign', 'Kampagne')}${sortHead('play_mode', 'Spielform')}${sortHead('note', 'Notiz')}</tr></thead>
        <tbody>${sessions.map((s) => `<tr>
          <td>${esc(fmtDateOnly(s.played_on))}</td>
          <td>${titleLink(s.title, s.slug)}</td>
          <td class="session-campaign-cell">–</td>
          <td>${esc(PLAY_MODE_LABEL[s.play_mode] || '–')}</td>
          <td>${esc(s.note || '–')}${s.summary_url ? `<br><a href="${esc(s.summary_url)}" target="_blank" rel="noopener" class="faint" style="font-size:var(--text-xs)">Zusammenfassung ↗</a>` : ''}</td>
        </tr>`).join('')}</tbody></table></div>`
      : `<p class="muted">${all.length ? 'Keine Spielabende für diese Filter.' : 'Noch keine Spielabende protokolliert.'}</p>`}
    </section>`);
    list.querySelectorAll('.session-campaign-cell').forEach((cell, i) => {
      const s = sessions[i];
      const group = all.filter((x) => x.campaign && x.campaign === s.campaign && gameKey(x) === gameKey(s));
      const badges = campaignSessionBadges(s, group, { onNameClick: () => { state.campaign = s.campaign; campSel.value = s.campaign; update(); } });
      if (badges) { cell.textContent = ''; cell.appendChild(badges); }
    });
    list.querySelectorAll('th[data-sort] button').forEach((btn) => btn.addEventListener('click', () => {
      const key = btn.parentElement.dataset.sort;
      sort = sort.key === key ? { key, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'played_on' ? 'desc' : 'asc' };
      renderContent();
    }));
    content.appendChild(list);
  }

  function update() { syncUrl(); renderContent(); }
  qInput.addEventListener('input', () => { state.q = qInput.value; update(); });
  gameSel.addEventListener('change', () => { state.game = gameSel.value; update(); });
  campSel.addEventListener('change', () => { state.campaign = campSel.value; update(); });
  modeSel.addEventListener('change', () => { state.mode = modeSel.value; update(); });
  if (yearSel) yearSel.addEventListener('change', () => { state.year = yearSel.value ? Number(yearSel.value) : null; update(); });
  filters.querySelector('#sl-reset').addEventListener('click', () => {
    Object.assign(state, { year: null, game: '', campaign: '', q: '', mode: '' });
    qInput.value = ''; gameSel.value = ''; campSel.value = ''; modeSel.value = '';
    if (yearSel) yearSel.value = '';
    update();
  });
  renderContent();
}
