// Prüft den Wahlomat gegen echte Katalogdaten: Jedes Spiel muss mit
// „perfekten“ Antworten (seine eigenen Werte und Tags) 100 % erreichen und
// allein auf Platz 1 stehen. Läuft in GitHub Actions vor jedem Deploy.
//
// Aufruf: node scripts/check-wahlomat.mjs [URL oder Datei]
// Standard ist die öffentliche Live-API (/api/wahlomat.json).
//
// Die Rechenlogik kommt unverändert aus public/js/wahlomat.js: der Abschnitt
// von `const B = {` bis zum Ende von scoreGame() wird ausgeschnitten und als
// Modul geladen. Der Rest der Datei braucht einen Browser.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const LIVE = 'https://rpg-katalog-666839148899.us-east1.run.app/api/wahlomat.json';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = fs.readFileSync(path.join(root, 'public/js/wahlomat.js'), 'utf8');

const start = source.indexOf('\nconst B = {');
const scoreAt = source.indexOf('\nfunction scoreGame(');
const end = scoreAt < 0 ? -1 : source.indexOf('\n}\n', scoreAt);
if (start < 0 || scoreAt < 0 || end < 0) {
  console.error('Wahlomat-Kern nicht gefunden (Marker „const B = {“ / „function scoreGame(“ fehlen in public/js/wahlomat.js).');
  process.exit(1);
}
const core = `${source.slice(start, end + 3)}\nexport { buildGames, scoreGame, FIGURE_OPTIONS, TAG_MAX, AKTIVITAETEN_TAGS, SIGNALS, TAG_GROUPS, TAG_KINDS, TAG_ALIASES, B, W };\n`;
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wahlomat-')), 'core.mjs');
fs.writeFileSync(tmp, core);
const { buildGames, scoreGame, FIGURE_OPTIONS, TAG_MAX, AKTIVITAETEN_TAGS, SIGNALS, TAG_GROUPS, TAG_KINDS, TAG_ALIASES, B, W } = await import(pathToFileURL(tmp));

const target = process.argv[2] || LIVE;
const data = /^https?:\/\//.test(target)
  ? await (await fetch(target)).json()
  : JSON.parse(fs.readFileSync(target, 'utf8'));
const games = buildGames(data);
if (games.length < 10) {
  console.error(`Nur ${games.length} Spiele geladen – Daten unvollständig?`);
  process.exit(1);
}

// Wie im Fragebogen: In den Tag-Matrizen stehen nur Begriffe, die mindestens drei Spiele tragen.
const visible = {};
for (const kind of ['subGenre', 'subTon', 'fokus']) {
  const counts = new Map();
  games.forEach((g) => (g[kind] || []).forEach((t) => counts.set(t, (counts.get(t) || 0) + 1)));
  visible[kind] = new Set([...counts].filter(([, n]) => n >= 3).map(([t]) => t));
}
const pick = (g, kind) => (g[kind] || []).filter((t) => visible[kind].has(t)).slice(0, TAG_MAX);

const grid = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];
const snap = (v) => grid.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
const figures = FIGURE_OPTIONS.map(([v]) => v);

// Antworten, die ein Spiel genau beschreiben. Die Härte ist eine Frage für
// Bedrohung und Scheitern; probiert werden alle Stufen, die beste zählt.
function bestProfile(g) {
  let best = null;
  for (const hart of grid) {
    const profile = {
      genre: Object.fromEntries(g.genre.map((t) => [t, 4])),
      ton: Object.fromEntries(g.ton.map((t) => [t, 4])),
      aktivitaeten: Object.fromEntries(Object.entries(g.aktivitaeten).filter(([, v]) => v >= 3).map(([k]) => [k, 4])),
      gefahr: hart, letalitaet: hart,
      handlungsfreiheit: snap(g.handlungsfreiheit),
      figurenkompetenz: [figures.reduce((a, b) => (Math.abs(b - g.figurenkompetenz) < Math.abs(a - g.figurenkompetenz) ? b : a))],
      crunch: snap(g.crunch), narrativ: snap(g.narrativ), fluff: snap(g.fluff),
      priorities: [],
      subGenre: pick(g, 'subGenre'),
      subTon: pick(g, 'subTon'),
      fokus: pick(g, 'fokus'),
    };
    const { score } = scoreGame(g, profile);
    if (!best || score > best.score) best = { score, profile };
  }
  return best;
}

const problems = [];
const warnings = [];
const results = new Map();
for (const g of games) {
  const { score, profile } = bestProfile(g);
  const rivals = games.filter((o) => o.id !== g.id).map((o) => ({ title: o.title, score: scoreGame(o, profile).score }));
  const top = rivals.reduce((a, b) => (b.score > a.score ? b : a));
  results.set(g.id, { profile, score, second: top });
  if (score < 99.5) problems.push(`${g.title}: erreicht nur ${score.toFixed(1)} %`);
  else if (top.score >= score) problems.push(`${g.title}: nicht allein auf Platz 1 (${top.title} hat ${top.score.toFixed(1)} %)`);
}

// ---- 2. Tag-Anzahlen je Spiel (Pflegeregel 3 im Review-Dokument).
const RULES = [
  ['genre_setting_top', 'Genre', 1, 3],
  ['genre_setting', 'Untergenres', 1, 2],
  ['tone_theme_top', 'Top-Töne', 2, 3],
  ['tone_theme', 'Untertöne', 3, 5],
  ['play_focus', 'Spielfokus', 3, 5],
];
for (const raw of data.games || []) {
  const universal = (raw.genre_setting_top || []).includes('Universal');
  for (const [key, label, min, max] of RULES) {
    const n = (raw[key] || []).length;
    const [lo, hi] = key === 'tone_theme' && universal ? [0, 2] : [min, max];
    if (n < lo || n > hi) problems.push(`${raw.title}: ${n} ${label} (erlaubt ${lo}–${hi})`);
  }
}

// ---- 3. Code-Listen enthalten nur Begriffe, die es gibt (sonst wirkungslos).
const masterUrl = /^https?:\/\//.test(target) ? target.replace(/\/api\/wahlomat\.json$/, '/api/master-data') : LIVE.replace(/\/api\/wahlomat\.json$/, '/api/master-data');
let master = null;
try { master = await (await fetch(masterUrl)).json(); } catch (e) { problems.push(`Stammdaten nicht ladbar (${masterUrl}): ${e.message}`); }
if (master?.tags) {
  const byKind = (...kinds) => new Set(master.tags.filter((t) => kinds.includes(t.kind)).map((t) => t.name));
  const all = new Set(master.tags.map((t) => t.name));
  const checkSet = (name, set, valid) => { const bad = [...set].filter((t) => !valid.has(t)); if (bad.length) problems.push(`${name}: unbekannte Begriffe ${bad.map((b) => `„${b}“`).join(', ')}`); };
  const focusStyle = byKind('play_focus', 'play_style');
  Object.entries(AKTIVITAETEN_TAGS).forEach(([k, set]) => checkSet(`Aktivität ${k}`, set, focusStyle));
  Object.entries(SIGNALS).forEach(([k, set]) => checkSet(`Signal ${k}`, set, all));
  Object.entries(TAG_GROUPS).forEach(([kind, groups]) => {
    const valid = byKind(TAG_KINDS[kind].source);
    // Eine gemeinsame Option (z. B. „Weird Fantasy / Weird Fiction“) gilt, wenn alle ihre Begriffe existieren.
    const expand = (t) => { const m = Object.entries(TAG_ALIASES[kind] || {}).filter(([, a]) => a === t).map(([n]) => n); return m.length ? m : [t]; };
    groups.forEach(([gname, tags]) => checkSet(`Gruppe ${kind}/${gname}`, new Set(tags.flatMap(expand)), valid));
  });
}

// ---- 4. Hinweise (kein Abbruch): knapper Vorsprung und Stabilität bei ±0,5.
const close = [...results].map(([id, r]) => ({ title: games.find((g) => g.id === id).title, gap: r.score - r.second.score, second: r.second.title }))
  .filter((r) => r.gap < 5).sort((a, b) => a.gap - b.gap);
if (close.length) warnings.push(`Knapper Vorsprung (< 5 Punkte) bei ${close.length} Spielen: ${close.map((r) => `${r.title} vor ${r.second} (+${r.gap.toFixed(1)})`).join('; ')}`);
const AXES = ['crunch', 'narrativ', 'fluff', 'gefahr', 'letalitaet', 'figurenkompetenz', 'handlungsfreiheit'];
const unstable = [];
for (const g of games) {
  const { profile } = results.get(g.id);
  for (const axis of AXES) for (const d of [-0.5, 0.5]) {
    const v = Math.min(5, Math.max(1, Number(g[axis]) + d));
    if (v === Number(g[axis])) continue;
    const moved = { ...g, [axis]: v };
    const own = scoreGame(moved, profile).score;
    const beaten = games.some((o) => o.id !== g.id && scoreGame(o, profile).score >= own);
    if (beaten) unstable.push(`${g.title} (${axis} ${d > 0 ? '+' : ''}${d})`);
  }
}
if (unstable.length) warnings.push(`Nicht mehr allein vorn, wenn ein Wert um 0,5 abweicht: ${unstable.join('; ')}`);

// ---- 5. Gewichte: Anteil jeder Frage an den Unterschieden zwischen den Spielen,
// gemessen mit festen Zufallsprofilen (gleiches Ergebnis bei jedem Lauf).
let seed = 20261108;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const choose = (arr) => arr[Math.floor(rnd() * arr.length)];
const levels = [4, 2, 0, 0, 0, -2];
// Wie im Browser: Genre- und Ton-Optionen entstehen aus den vergebenen Top-Tags.
B.genre.labels = Object.fromEntries([...new Set(games.flatMap((g) => g.genre))].map((t) => [t, t]));
B.ton.labels = Object.fromEntries([...new Set(games.flatMap((g) => g.ton))].map((t) => [t, t]));
const shares = {};
const RUNS = 400;
for (let r = 0; r < RUNS; r++) {
  const budget = (labels) => Object.fromEntries(Object.keys(labels).map((k) => [k, choose(levels)]).filter(([, v]) => v !== 0));
  const scalar = () => (rnd() < 0.2 ? null : choose(grid));
  const hart = scalar();
  const profile = {
    genre: budget(B.genre.labels), ton: budget(B.ton.labels), aktivitaeten: budget(B.aktivitaeten.labels),
    gefahr: hart, letalitaet: hart, handlungsfreiheit: scalar(),
    figurenkompetenz: rnd() < 0.2 ? null : [choose(figures)],
    crunch: scalar(), narrativ: scalar(), fluff: scalar(), priorities: [], subGenre: [], subTon: [], fokus: [],
  };
  const rows = games.map((g) => scoreGame(g, profile).breakdown);
  const labels = { Genre: ['Genre'], Ton: ['Ton'], Spielstil: ['Spielstil'], 'Härte': ['Bedrohung', 'Scheitern'], Freiheit: ['Freiheit'], Figurenbild: ['Figurenbild'], Crunch: ['Crunch'], Narrativ: ['Narrativ'], Fluff: ['Fluff'] };
  const variances = Object.fromEntries(Object.entries(labels).map(([name, parts]) => {
    const vals = rows.map((b) => parts.reduce((s2, p) => s2 + (b[p] || 0), 0));
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    return [name, vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length];
  }));
  const total = Object.values(variances).reduce((a, b) => a + b, 0) || 1;
  Object.entries(variances).forEach(([k, v]) => { shares[k] = (shares[k] || 0) + v / total / RUNS; });
}
const CORRIDOR = { Genre: [0.10, 0.22], Ton: [0.10, 0.22], Spielstil: [0.10, 0.22] };
const shareText = Object.entries(shares).map(([k, v]) => `${k} ${(v * 100).toFixed(0)} %`).join(', ');
for (const [k, v] of Object.entries(shares)) {
  const [lo, hi] = CORRIDOR[k] || [0.05, 0.14];
  // Abbruch: Die Gewichte sind auf diese Anteile kalibriert (Nov. 2026).
  if (v < lo || v > hi) problems.push(`Gewicht ${k}: Anteil ${(v * 100).toFixed(1)} % außerhalb des Zielkorridors ${Math.round(lo * 100)}–${Math.round(hi * 100)} %`);
}

warnings.forEach((w) => console.log(`Hinweis: ${w}`));
console.log(`Anteile an den Unterschieden: ${shareText}`);
if (problems.length) {
  console.error(`Wahlomat-Prüfung fehlgeschlagen (${problems.length} Punkte):`);
  problems.forEach((p) => console.error(`  – ${p}`));
  process.exit(1);
}
console.log(`Wahlomat-Prüfung bestanden: alle ${games.length} Spiele erreichen 100 % und Platz 1, Tag-Anzahlen, Code-Listen und Gewichtsanteile stimmen.`);
