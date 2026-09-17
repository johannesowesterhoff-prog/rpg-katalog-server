// Statistik-Seite: aggregierte Kennzahlen über die veröffentlichte Sammlung
// (Verteilungen, Skalen-Durchschnitte, Spielabend-Auswertung).
import { api } from './api.js';
import { el, esc, emptyState } from './ui.js';

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

export async function renderStats(root) {
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

  const distGrid = el(`<div class="stat-grid"></div>`);
  distGrid.innerHTML = barSection('Top Genre / Setting', s.genreDist)
    + barSection('Top Tone / Themen', s.toneDist)
    + barSection('Systemfamilie', s.systemDist)
    + barSection('Kampagnenart', s.campaignDist)
    + barSection('Sprache', s.langDist);
  root.appendChild(distGrid);

  const mostPlayedHtml = s.mostPlayed.length
    ? `<ol class="stat-list">${s.mostPlayed.map((g) => `<li>
        <a href="#/spiele/${esc(g.slug)}">${esc(g.title)}</a>
        <span class="muted">${g.sessions}× gespielt, zuletzt ${fmtDateOnly(g.last_played)}</span>
      </li>`).join('')}</ol>`
    : '<p class="muted">Noch keine Spielabende protokolliert.</p>';

  const recentHtml = s.recentSessions.length
    ? `<ol class="stat-list">${s.recentSessions.map((r) => `<li>
        <a href="#/spiele/${esc(r.slug)}">${esc(r.title)}</a>
        <span class="muted">${esc(fmtDateOnly(r.played_on))}${r.participants ? ' · ' + esc(r.participants) : ''}${r.rating ? ' · ' + '★'.repeat(r.rating) : ''}</span>
        ${r.note ? `<p class="faint" style="font-size:var(--text-xs);margin:.2rem 0 0">${esc(r.note)}</p>` : ''}
      </li>`).join('')}</ol>`
    : '<p class="muted">Noch keine Spielabende protokolliert.</p>';

  const sessionSections = el(`<div class="stat-grid">
    <section class="section"><h2>Meistgespielt</h2>${mostPlayedHtml}</section>
    <section class="section"><h2>Zuletzt gespielt</h2>${recentHtml}</section>
  </div>`);
  root.appendChild(sessionSections);
}
