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
