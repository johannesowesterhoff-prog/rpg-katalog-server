// Kurzerklärungen der Begriffe (Tags): einmal laden, überall nutzen –
// Tooltips im Katalog, Begriffsseite (#/begriffe) und Wahlomat.
import { api } from './api.js';
import { el, esc } from './ui.js';

let cache = null;
/** Map "kind|Name" → { description, count }. Fehler → leere Map (Erklärungen sind nur Beiwerk). */
export function tagInfo() {
  if (!cache) {
    cache = api('/api/master-data')
      .then((md) => new Map((md.tags || []).map((t) => [`${t.kind}|${t.name}`, { description: t.description || '', count: t.usage_count || 0 }])))
      .catch(() => { cache = null; return new Map(); });
  }
  return cache;
}
export const tagDescription = (info, kind, name) => info?.get(`${kind}|${name}`)?.description || '';

// Reihenfolge und Filter-Parameter je Begriffsart.
export const GLOSSARY_KINDS = [
  ['play_focus', 'Spielfokus', 'Was ihr am Tisch vor allem tut.', 'focus'],
  ['tone_theme', 'Untertöne', 'Wie sich die Geschichten anfühlen.', 'tone'],
  ['genre_setting', 'Untergenres', 'In welcher Art Welt gespielt wird.', 'genre'],
  ['play_style', 'Spielweise', 'Wie das Spiel selbst funktioniert.', 'style'],
  ['genre_setting_top', 'Genre (Hauptkategorie)', '', 'genreTop'],
  ['tone_theme_top', 'Ton (Hauptkategorie)', '', 'toneTop'],
  ['campaign_type', 'Kampagnenart', '', 'campaign'],
];

export async function renderGlossary(root) {
  root.innerHTML = '';
  const info = await tagInfo();
  const page = el(`<div class="glossary">
    <div class="crumb"><a href="#/">Katalog</a> <span class="faint">/</span> Begriffe</div>
    <h1>Begriffe erklärt</h1>
    <p class="lede muted">Was die Schlagworte im Katalog und im Wahlomat bedeuten. Ein Klick auf einen Begriff zeigt alle Spiele damit.</p>
  </div>`);
  for (const [kind, label, intro, param] of GLOSSARY_KINDS) {
    const terms = [...info.entries()]
      .filter(([key, v]) => key.startsWith(kind + '|') && v.description && v.count > 0)
      .map(([key, v]) => [key.slice(kind.length + 1), v])
      .sort((a, b) => a[0].localeCompare(b[0], 'de'));
    if (!terms.length) continue;
    page.appendChild(el(`<section class="section">
      <h2>${esc(label)}</h2>${intro ? `<p class="muted">${esc(intro)}</p>` : ''}
      <dl class="glossary-list">${terms.map(([name, v]) => `<dt><a href="#/?${param}=${encodeURIComponent(name)}">${esc(name)}</a> <span class="faint">(${v.count})</span></dt><dd>${esc(v.description)}</dd>`).join('')}</dl>
    </section>`));
  }
  root.appendChild(page);
  document.title = 'Begriffe erklärt – RPG-Katalog';
}
