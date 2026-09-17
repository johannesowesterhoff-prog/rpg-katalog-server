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

function wireScatterTooltip(section) {
  const wrap = section.querySelector('.scatter-wrap');
  if (!wrap) return;
  const tooltip = wrap.querySelector('.scatter-tooltip');
  const show = (dot, evt) => {
    const rect = wrap.getBoundingClientRect();
    tooltip.innerHTML = `<strong>${esc(dot.dataset.title)}</strong><br>Crunch ${dot.dataset.crunch} · Narrativ ${dot.dataset.narrativ} · Fluff ${dot.dataset.fluff}`;
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

// Streudiagramm Crunch (x) gegen Narrativ (y), je ein Punkt pro Spiel. 3 ist
// auf beiden Skalen die Mitte -- entsprechend liegt der "0-Punkt" genau im
// Zentrum der Achsen, betont durch die kräftigere Mittellinie. Fluff hat
// keine dritte Achse, sondern geht als Punkt-Deckkraft ein (mehr Fluff =
// kräftigerer Punkt), damit alle drei Skalen im selben Diagramm stecken.
function scatterSection(games) {
  const W = 640;
  const H = 440;
  const pad = { l: 40, r: 16, t: 16, b: 40 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const domain = [0.5, 5.5];
  const sx = (v) => pad.l + ((v - domain[0]) / (domain[1] - domain[0])) * plotW;
  const sy = (v) => H - pad.b - ((v - domain[0]) / (domain[1] - domain[0])) * plotH;

  const ticks = [1, 2, 3, 4, 5];
  const gridLines = ticks.map((t) => `
    <line x1="${sx(t)}" y1="${pad.t}" x2="${sx(t)}" y2="${H - pad.b}" class="scatter-grid${t === 3 ? ' origin' : ''}"></line>
    <line x1="${pad.l}" y1="${sy(t)}" x2="${W - pad.r}" y2="${sy(t)}" class="scatter-grid${t === 3 ? ' origin' : ''}"></line>`).join('');

  const tickLabels = ticks.map((t) => `
    <text x="${sx(t)}" y="${H - pad.b + 16}" class="scatter-tick" text-anchor="middle">${t}</text>
    <text x="${pad.l - 8}" y="${sy(t) + 4}" class="scatter-tick" text-anchor="end">${t}</text>`).join('');

  const points = games.map((g) => {
    const crunch = Number(g.crunch);
    const narrativ = Number(g.narrative);
    const fluff = g.fluff == null ? null : Number(g.fluff);
    const opacity = fluff == null ? 0.5 : 0.2 + ((fluff - 1) / 4) * 0.8;
    return `<circle cx="${sx(crunch).toFixed(1)}" cy="${sy(narrativ).toFixed(1)}" r="5.5" class="scatter-dot" style="fill-opacity:${opacity.toFixed(2)}"
      data-title="${esc(g.title)}" data-crunch="${crunch}" data-narrativ="${narrativ}" data-fluff="${fluff == null ? '–' : fluff}"></circle>`;
  }).join('');

  return `<section class="section">
    <h2>Crunch × Narrativ</h2>
    <p class="muted" style="font-size:var(--text-xs);margin:-.4rem 0 var(--space-3)">Jeder Punkt ein Spiel · 3 ist die Skalenmitte und liegt im Zentrum · kräftigere Punkte haben mehr Fluff.</p>
    ${games.length ? `<div class="scatter-wrap">
      <svg viewBox="0 0 ${W} ${H}" class="scatter-svg" role="img" aria-label="Streudiagramm Crunch gegen Narrativ, Punktfarbe zeigt Fluff">
        ${gridLines}
        ${tickLabels}
        <text x="${pad.l + plotW / 2}" y="${H - 4}" class="scatter-axis-label" text-anchor="middle">Crunch (Regeldichte)</text>
        <text x="12" y="${pad.t + plotH / 2}" class="scatter-axis-label" text-anchor="middle" transform="rotate(-90 12 ${pad.t + plotH / 2})">Narrativ (Erzählmechanik)</text>
        ${points}
      </svg>
      <div class="scatter-tooltip" hidden></div>
    </div>
    <div class="scatter-legend"><span class="muted" style="font-size:var(--text-xs)">Fluff</span><span class="scatter-legend-ramp"></span><span class="muted" style="font-size:var(--text-xs)">niedrig → hoch</span></div>`
    : '<p class="muted">Keine Daten.</p>'}
  </section>`;
}

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

  const scatterWrap = el(scatterSection(s.scatter));
  root.appendChild(scatterWrap);
  wireScatterTooltip(scatterWrap);

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
