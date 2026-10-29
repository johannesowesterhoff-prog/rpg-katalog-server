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
const core = `${source.slice(start, end + 3)}\nexport { buildGames, scoreGame, FIGURE_OPTIONS, TAG_MAX };\n`;
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wahlomat-')), 'core.mjs');
fs.writeFileSync(tmp, core);
const { buildGames, scoreGame, FIGURE_OPTIONS, TAG_MAX } = await import(pathToFileURL(tmp));

const target = process.argv[2] || LIVE;
const data = /^https?:\/\//.test(target)
  ? await (await fetch(target)).json()
  : JSON.parse(fs.readFileSync(target, 'utf8'));
const games = buildGames(data);
if (games.length < 10) {
  console.error(`Nur ${games.length} Spiele geladen – Daten unvollständig?`);
  process.exit(1);
}

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
      subGenre: (g.subGenre || []).slice(0, TAG_MAX),
      subTon: (g.subTon || []).slice(0, TAG_MAX),
      fokus: (g.fokus || []).slice(0, TAG_MAX),
    };
    const { score } = scoreGame(g, profile);
    if (!best || score > best.score) best = { score, profile };
  }
  return best;
}

const problems = [];
for (const g of games) {
  const { score, profile } = bestProfile(g);
  const rivals = games.filter((o) => o.id !== g.id).map((o) => ({ title: o.title, score: scoreGame(o, profile).score }));
  const top = rivals.reduce((a, b) => (b.score > a.score ? b : a));
  if (score < 99.5) problems.push(`${g.title}: erreicht nur ${score.toFixed(1)} %`);
  else if (top.score >= score) problems.push(`${g.title}: nicht allein auf Platz 1 (${top.title} hat ${top.score.toFixed(1)} %)`);
}

if (problems.length) {
  console.error(`Wahlomat-Prüfung fehlgeschlagen (${problems.length} von ${games.length} Spielen):`);
  problems.forEach((p) => console.error(`  – ${p}`));
  process.exit(1);
}
console.log(`Wahlomat-Prüfung bestanden: alle ${games.length} Spiele erreichen 100 % und Platz 1.`);
