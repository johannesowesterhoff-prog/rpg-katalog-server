// RPG-Wahlomat: sechs Fragenschritte über Genre, Ton, Spielstil, Figuren,
// Regeln und Fluff, danach ein Ranking der eigenen Sammlung.
//
// Datengrundlage pro Frage (wichtig für die Einschätzung der Ergebnisse):
//  - Genre, Ton, Crunch/Narrativ/Fluff: exakte Werte aus dem Katalog
//    (genre_setting_top, tone_theme_top, crunch/narrative/fluff-Skalen).
//    Die Auswahllisten werden bei jedem Aufruf live aus den tatsächlich
//    vergebenen Tags gebaut -- neue Top-Genres/-Tones tauchen also
//    automatisch auf, nichts ist hartkodiert.
//  - Spielstil/Aktivitäten: aus Spielfokus-Tags abgeleitet (play_focus).
//  - Welt-Fremdheit, Bedrohung/Druck, Folgen des Scheiterns,
//    Figurenkompetenz, Handlungsfreiheit: es gibt dafür KEIN eigenes
//    Katalogfeld. Diese fünf Werte sind Schätzungen, die aus der vollen
//    Tag-Palette eines Spiels (Top+Sub-Genre, Top+Sub-Tone, Spielfokus)
//    gezählt werden -- je mehr passende Signal-Tags ein Spiel trägt, desto
//    weiter schlägt der Wert aus 3 (Mitte) aus. Das ist präziser als eine
//    grobe Genre-Schublade, bleibt aber eine Näherung, keine recherchierte
//    Tatsache wie Crunch/Narrativ/Fluff.
import { api } from './api.js';
import { el, esc, toast } from './ui.js';

const B = {
  genre: { total: 6, max: 3, key: 'genre', labels: {} },
  ton: { total: 6, max: 3, key: 'ton', labels: {} },
  aktivitaeten: {
    total: 10, max: 4, key: 'aktivitaeten',
    labels: { kampf_taktik: 'Kämpfen & taktisch planen', erkundung: 'Erkunden & entdecken', ermittlung: 'Ermitteln & Rätsel lösen', soziale_szenen: 'Beziehungen & Rollenspiel', survival: 'Überleben & Ressourcen', weltgestaltung: 'Welt, Basis & Fraktionen' },
  },
};

const W = { genre: 15, setting: 7, tone: 12, threat: 8, activities: 15, agency: 6, figures: 7, lethality: 8, crunch: 7, narrativ: 8, fluff: 7, world: 3 };

const FIGURE_OPTIONS = [
  [1.5, 'Alltagsmenschen in einer außergewöhnlichen Lage'],
  [2, 'Neulinge, Außenseiter:innen oder Underdogs'],
  [3, 'Fähige Abenteurer:innen'],
  [4, 'Profis und Spezialist:innen'],
  [5, 'Große Held:innen oder außergewöhnliche Wesen'],
];

// Einzelfragen mit Regler 1-5, je Schritt zugeordnet.
const RANGES = {
  1: [['welt_fremdheit', 'Wie fremd und eigenständig soll die Welt sein?', '1 = nah an unserer Realität · 5 = sehr fremd oder seltsam', 3]],
  2: [['gefahr', 'Wie intensiv sollen Bedrohung und Druck sein?', '1 = entspannt und sicher · 5 = existenziell bedrohlich (unabhängig vom Genre)', 3]],
  3: [['handlungsfreiheit', 'Wie offen soll die Handlung sein?', '1 = klarer Auftrag · 5 = Gruppe setzt Ziele und Richtung', 3]],
  4: [['letalitaet', 'Wie folgenreich darf Scheitern sein?', '1 = Folgen treiben weiter · 5 = Verlust gehört zum Nervenkitzel', 3]],
  5: [['crunch', 'Wie viel Regelstruktur möchtet ihr aktiv nutzen?', '1 = sehr leicht · 5 = taktisch und buildintensiv', 2.5], ['narrativ', 'Wie stark gestaltet ihr Handlung und Welt direkt mit?', '1 = Spielleitung führt klar · 5 = Welt gemeinsam gestalten', 3]],
  6: [['fluff', 'Wie wichtig sind Geschichte, Orte, Kultur und Fraktionen?', '1 = Handlung zählt · 5 = Lore ist ein Hauptreiz', 3], ['weltwissen', 'Wie viel Weltwissen möchtet ihr zu Beginn aufnehmen?', '1 = nur das Nötigste · 5 = bewusst tief einsteigen', 2]],
};

const STEPS = [
  { n: 1, title: 'Genre & Setting', lede: 'Welche Art Welt soll eure Geschichte tragen?', budget: 'genre', budgetLegend: 'Welche Welten interessieren euch?' },
  { n: 2, title: 'Ton & Themen', lede: 'Welche Stimmung soll eure Runde prägen?', budget: 'ton', budgetLegend: 'Welcher Grundton passt zu euch?' },
  { n: 3, title: 'Spielstil', lede: 'Was möchtet ihr am Tisch überwiegend tun?', budget: 'aktivitaeten', budgetLegend: 'Verteilt euren Spielfokus' },
  { n: 4, title: 'Figuren & Gefahr', lede: 'Wer seid ihr — und wie hart darf die Welt sein?' },
  { n: 5, title: 'Regeln & Erzählweise', lede: 'Wie viel System und wie viel gemeinsame Gestaltung wollt ihr?' },
  { n: 6, title: 'Fluff & Welttiefe', lede: 'Wie viel Hintergrund und Welterkundung soll das Spiel tragen?' },
];

// ---- Spielstil/Aktivitäten weiterhin aus Spielfokus-Tags abgeleitet.
const AKTIVITAETEN_TAGS = {
  kampf_taktik: new Set(['Kampf / Taktik', 'Action', 'Pulp-Action', 'Cinematic Action', 'Duelle']),
  erkundung: new Set(['Erkundung', 'Dungeon-Crawls', 'Abenteuer', 'Episodische Insel-Abenteuer', 'Sword & Sorcery-Abenteuer', 'Raumfahrt', 'Hex-Crawl / Erkundung', 'Reise']),
  ermittlung: new Set(['Ermittlungen', 'Ermittlungen / Verschwörungen', 'Mystery', 'Intrigen', 'Intrigen / Politik', 'kreative Problemlösung', 'Investigation / Detektivarbeit']),
  soziale_szenen: new Set(['Charakterentwicklung', 'Charakterspiel', 'Soziale Interaktionen', 'Soziale Konflikte', 'Erzählorientiert', 'kooperatives Storytelling', 'Diplomatie']),
  survival: new Set(['Überleben', 'Survival-Horror', 'Ressourcenmanagement', 'Old-School-Spiel', 'OSR']),
  weltgestaltung: new Set(['Gemeinsamer Weltenbau', 'Fraktionen', 'Aufbau einer Festung', 'Sandbox', 'Sandbox-Szenarien', 'Dorfleben', 'Adaptiv / Baukastensystem', 'Dungeonbau']),
};

// ---- Signal-Tagsets für die fünf nicht direkt im Katalog erfassten Achsen.
// Bewusst breit über Top+Sub-Genre, Top+Sub-Tone UND Spielfokus gestreut,
// damit tatsächlich die recherchierten Sub-Tone-Tags (die genauesten Daten,
// die wir pro Spiel haben) mit einfließen statt nur grobe Genre-Schubladen.
const SIGNALS = {
  weltHigh: new Set(['Space Opera', 'Weird Fantasy', 'Primal Punk', 'Mythische Inselwelt', 'Cyberpunk', '(Post-)Apokalypse', 'Low-Fi Sci-Fi', 'Mysteriös', 'Rätselhaft', 'Realitätsbruch', 'Kosmisches Grauen', 'Urzeitlich', 'Zauberhaft', 'Mythisch', 'Feenhaft', 'Skurril', 'Genreoffen', 'Weite']),
  weltLow: new Set(['Gegenwart / Modern', 'Krimi', 'Noir', 'Neo-Noir', 'Politthriller', 'Akademie', 'Coming-of-Age', '(Pseudo-)Historisch', 'Auftragskiller', 'Alltagsnah', 'Glaubwürdig', 'Bürokratisch', 'Klassisch', 'Bodenständig'].filter(Boolean)),

  gefahrHigh: new Set(['Existenzielle Angst', 'Existenzieller Horror', 'Ausweglos', 'Kompromisslos', 'Brutal', 'Blutig', 'Körperliche Bedrohung', 'Klaustrophobisch', 'Entbehrungsreich', 'Bösartig', 'Prekär', 'Überlebenskampf', 'Weltuntergangsstimmung', 'Verstörend', 'Kosmisches Grauen', 'Horror', 'Survival-Horror', 'Überleben', 'Konsequenzenreich']),
  gefahrLow: new Set(['Gemütlich', 'Idyllisch', 'Unbeschwert', 'Herzlich', 'Warmherzig', 'Niedlich', 'Verspielt', 'Fürsorglich', 'Einsteigerfreundlich', 'Jugendfreundlich', 'Kindgerecht', 'Kinderfreundlich / Familienrunden', 'kooperatives Storytelling']),

  letalHigh: new Set(['Kompromisslos', 'Ausweglos', 'Verlust', 'Opferbereitschaft', 'Existenzielle Angst', 'Brutal', 'Blutig', 'Körperliche Bedrohung', 'Überlebenskampf', 'Konsequenzenreich', 'Old-School-Spiel', 'OSR', 'Dungeon-Crawls']),
  letalLow: new Set(['Fürsorglich', 'Gemütlich', 'Kinderfreundlich / Familienrunden', 'Kindgerecht', 'Einsteigerfreundlich', 'Jugendfreundlich', 'Verspielt', 'kooperatives Storytelling', 'Coming-of-Age']),

  figHigh: new Set(['Heroisch', 'Superhelden', 'Mythische Heldenreisen', 'Cinematic Action', 'Pulp-Action', 'Ruhm und Rivalität', 'Legendenbildung', 'Episch', 'Tollkühn']),
  figLow: new Set(['Kindgerecht', 'Kinderfreundlich / Familienrunden', 'Coming-of-Age', 'Akademie', 'Schnelle Charaktererstellung', 'Niedlich', 'Alltagsnah', 'Prekär', 'Tollpatschig']),

  handlHigh: new Set(['Sandbox', 'Sandbox-Szenarien', 'Gemeinsamer Weltenbau', 'Fraktionen', 'Aufbau einer Festung', 'Dorfleben', 'Adaptiv / Baukastensystem', 'Improvisation', 'Freie Weltgestaltung', 'Offen gestaltbar', 'Freiheit']),
  handlLow: new Set(['Missionen / Aufträge', 'Cinematic Action', 'Episodische Insel-Abenteuer', 'Serienartige Geschichten']),
};

function anyCount(tags, set) { return tags.filter((t) => set.has(t)).length; }

// Zählbasierte Schätzung statt starrer Wenn/Sonst-Stufen: je mehr Signal-Tags
// in eine Richtung zeigen, desto weiter weicht der Wert von der Mitte (3) ab.
// Das verhindert, dass viele unterschiedliche Spiele auf denselben groben
// Wert kollabieren.
function scaleFromTags(tags, highSet, lowSet, step = 0.45) {
  const value = 3 + (anyCount(tags, highSet) - anyCount(tags, lowSet)) * step;
  return Math.min(5, Math.max(1, Math.round(value * 2) / 2));
}

function automaticProfile(game) {
  const allTags = [...game.genre_setting_top, ...game.genre_setting, ...game.play_focus, ...game.tone_theme_top, ...game.tone_theme];
  const aktivitaeten = {};
  Object.entries(AKTIVITAETEN_TAGS).forEach(([key, set]) => { aktivitaeten[key] = anyCount(game.play_focus, set) ? 4 : 1.5; });

  return {
    welt_fremdheit: scaleFromTags(allTags, SIGNALS.weltHigh, SIGNALS.weltLow),
    gefahr: scaleFromTags(allTags, SIGNALS.gefahrHigh, SIGNALS.gefahrLow),
    letalitaet: scaleFromTags(allTags, SIGNALS.letalHigh, SIGNALS.letalLow),
    figurenkompetenz: scaleFromTags(allTags, SIGNALS.figHigh, SIGNALS.figLow),
    handlungsfreiheit: scaleFromTags(allTags, SIGNALS.handlHigh, SIGNALS.handlLow),
    aktivitaeten,
  };
}

function buildGames(catalog) {
  if (!catalog || !Array.isArray(catalog.games) || !catalog.games.length) {
    throw new Error('Der Katalog enthält kein gültiges Spiele-Array.');
  }
  return catalog.games.map((game) => {
    const g = {
      genre_setting_top: game.genre_setting_top || [], genre_setting: game.genre_setting || [],
      play_focus: game.play_focus || [], tone_theme_top: game.tone_theme_top || [], tone_theme: game.tone_theme || [],
    };
    return {
      id: game.slug,
      title: game.title,
      language: game.language,
      system_family: game.system_family,
      genre: g.genre_setting_top,
      ton: g.tone_theme_top,
      crunch: Number(game.crunch ?? 3),
      narrativ: Number(game.narrative ?? 3),
      fluff: Number(game.fluff ?? 3),
      weltwissen_einstieg: Math.min(5, Math.max(1, Number(game.fluff ?? 3) - 0.5)),
      ...automaticProfile(g),
    };
  });
}

function proximity(gameValue, desiredValue) { return Math.max(0, 1 - Math.abs(Number(gameValue) - Number(desiredValue)) / 4); }
function tagScore(tags, wishes) { return Math.max(0, ...tags.map((tag) => wishes[tag] || 0)) / 3; }
function activityScore(activities, wishes) {
  const total = Object.values(wishes).reduce((sum, v) => sum + v, 0) || 1;
  return Object.entries(wishes).reduce((sum, [key, points]) => sum + points * ((activities[key] || 1) / 5), 0) / total;
}
function figureScore(gameValue, selectedValues) {
  if (!selectedValues || !selectedValues.length) return 0;
  return Math.max(...selectedValues.map((v) => proximity(gameValue, v)));
}

function scoreGame(game, profile) {
  const components = [
    ['Genre', W.genre, true, tagScore(game.genre, profile.genre)],
    ['Setting', W.setting, profile.welt_fremdheit != null, profile.welt_fremdheit != null ? proximity(game.welt_fremdheit, profile.welt_fremdheit) : 0],
    ['Ton', W.tone, true, tagScore(game.ton, profile.ton)],
    ['Bedrohung', W.threat, profile.gefahr != null, profile.gefahr != null ? proximity(game.gefahr, profile.gefahr) : 0],
    ['Spielstil', W.activities, true, activityScore(game.aktivitaeten, profile.aktivitaeten)],
    ['Freiheit', W.agency, profile.handlungsfreiheit != null, profile.handlungsfreiheit != null ? proximity(game.handlungsfreiheit, profile.handlungsfreiheit) : 0],
    ['Figurenbild', W.figures, true, figureScore(game.figurenkompetenz, profile.figurenkompetenz)],
    ['Scheitern', W.lethality, profile.letalitaet != null, profile.letalitaet != null ? proximity(game.letalitaet, profile.letalitaet) : 0],
    ['Crunch', W.crunch, profile.crunch != null, profile.crunch != null ? proximity(game.crunch, profile.crunch) : 0],
    ['Narrativ', W.narrativ, profile.narrativ != null, profile.narrativ != null ? proximity(game.narrativ, profile.narrativ) : 0],
    ['Fluff', W.fluff, profile.fluff != null, profile.fluff != null ? proximity(game.fluff, profile.fluff) : 0],
    ['Weltwissen', W.world, profile.weltwissen != null, profile.weltwissen != null ? proximity(game.weltwissen_einstieg, profile.weltwissen) : 0],
  ];
  const activeWeight = components.reduce((sum, [, weight, active]) => sum + (active ? weight : 0), 0) || 1;
  const breakdown = {};
  let raw = 0;
  components.forEach(([label, weight, active, value]) => { const c = active ? weight * value : 0; breakdown[label] = c; raw += c; });
  return { ...game, score: (raw / activeWeight) * 100, breakdown };
}

// Für jede skalare Achse (1-5) symmetrisch prüfen: nah dran -> gut-Chip,
// deutlich daneben -> Warn-Chip in die passende Richtung. Vorher gab es das
// nur für Fluff/Letalität -- Crunch, Narrativ, Bedrohung, Handlungsfreiheit
// und Welt-Fremdheit hatten gar keine oder nur eine einseitige Rückmeldung,
// wodurch am Ende fast immer nur "Mehr/weniger Lore" als Warnung auftauchte.
const SCALAR_AXES = [
  ['crunch', 'Passender Regelumfang', 'Mehr Crunch als gewünscht', 'Weniger Crunch als gewünscht'],
  ['narrativ', 'Passende narrative Mitgestaltung', 'Mehr narrative Mitgestaltung als gewünscht', 'Weniger narrative Mitgestaltung als gewünscht'],
  ['fluff', 'Passende Welttiefe', 'Mehr Lore als gewünscht', 'Weniger Lore als gewünscht'],
  ['gefahr', 'Passende Bedrohungsintensität', 'Bedrohlicher als gewünscht', 'Harmloser als gewünscht'],
  ['letalitaet', 'Passende Schärfe beim Scheitern', 'Tödlicher als gewünscht', 'Glimpflicher als gewünscht'],
  ['handlungsfreiheit', 'Passende Handlungsfreiheit', 'Offener als gewünscht', 'Linearer als gewünscht'],
  ['welt_fremdheit', 'Passende Welt-Fremdheit', 'Fremder/seltsamer als gewünscht', 'Näher an der Realität als gewünscht'],
];

function makeChips(game, profile) {
  const highest = (values) => Object.entries(values).sort((a, b) => b[1] - a[1])[0]?.[0];
  const good = [];
  const warnings = [];

  const genre = highest(profile.genre);
  const tone = highest(profile.ton);
  const activity = highest(profile.aktivitaeten);
  const genreHit = tagScore(game.genre, profile.genre) > 0;
  const tonHit = tagScore(game.ton, profile.ton) > 0;
  if (genreHit) good.push(`Genre „${genre && game.genre.includes(genre) ? genre : game.genre[0]}“`);
  else warnings.push('Kein Wunschgenre getroffen');
  if (tonHit) good.push(`Ton „${tone && game.ton.includes(tone) ? tone : game.ton[0]}“`);
  else warnings.push('Kein Wunschton getroffen');
  if (activity && game.aktivitaeten[activity] >= 3.5) good.push('Stark bei ' + B.aktivitaeten.labels[activity]);

  for (const [key, goodLabel, warnHighLabel, warnLowLabel] of SCALAR_AXES) {
    const desired = profile[key];
    if (desired == null) continue;
    const gameValue = game[key];
    if (proximity(gameValue, desired) >= 0.82) good.push(goodLabel);
    else if (Math.abs(gameValue - desired) >= 1.5) warnings.push(gameValue > desired ? warnHighLabel : warnLowLabel);
  }

  return { good: good.slice(0, 6), warnings: warnings.slice(0, 5) };
}

// ---------------------------------------------------------------- Rendering
export async function renderWahlomat(root) {
  root.innerHTML = '<div class="catalog-head"><div class="skeleton" style="height:220px"></div></div>';
  document.title = 'RPG-Wahlomat – RPG-Katalog';

  let games;
  try {
    const data = await api('/api/wahlomat.json');
    // Auswahllisten für Genre & Ton live aus den tatsächlich vergebenen
    // Top-Tags bauen -- so tauchen alle Top-Genres/-Tones automatisch auf,
    // auch neu hinzugekommene, ohne Codeänderung.
    const genreSet = new Set();
    const tonSet = new Set();
    (data.games || []).forEach((g) => {
      (g.genre_setting_top || []).forEach((t) => genreSet.add(t));
      (g.tone_theme_top || []).forEach((t) => tonSet.add(t));
    });
    B.genre.labels = Object.fromEntries([...genreSet].sort().map((t) => [t, t]));
    B.ton.labels = Object.fromEntries([...tonSet].sort().map((t) => [t, t]));

    games = buildGames(data);
  } catch (e) {
    root.innerHTML = '';
    root.appendChild(el(`<div class="empty"><h3>Wahlomat nicht verfügbar</h3><p class="muted">${esc(e.message)}</p></div>`));
    toast(e.message, 'err');
    return;
  }

  root.innerHTML = '';
  const head = el(`<section class="catalog-head">
    <h1>RPG-Wahlomat</h1>
    <p class="lede">Sechs kurze Fragebereiche zu Genre, Ton, Spielstil, Figuren, Regeln und Fluff — am Ende ein Ranking ausschließlich aus deiner eigenen Sammlung (${games.length} Spiele).</p>
    <p class="faint" style="font-size:var(--text-xs);max-width:70ch">Genre, Ton, Crunch/Narrativ/Fluff kommen 1:1 aus den recherchierten Katalogdaten. Welt-Fremdheit, Bedrohung, Scheitern-Folgen, Figurenkompetenz und Handlungsfreiheit gibt es als Feld im Katalog nicht -- sie werden aus der vollen Tag-Palette jedes Spiels geschätzt, sind also Näherungen.</p>
  </section>`);
  root.appendChild(head);

  const progress = el(`<div class="panel wahlomat-progress">
    <div class="wahlomat-progress-head"><span id="wProgressText"></span><span class="muted" id="wProgressPct"></span></div>
    <div class="bar"><i id="wProgressBar" style="width:0%"></i></div>
  </div>`);
  root.appendChild(progress);

  const quizWrap = el('<div id="wQuiz"></div>');
  const resultsWrap = el('<div id="wResults" hidden></div>');
  root.appendChild(quizWrap);
  root.appendChild(resultsWrap);

  function freshBudget(key) { return Object.fromEntries(Object.keys(B[key].labels).map((k) => [k, 0])); }

  const state = {
    step: 1,
    genre: freshBudget('genre'),
    ton: freshBudget('ton'),
    aktivitaeten: freshBudget('aktivitaeten'),
    figurenkompetenz: [],
    welt_fremdheit: 3, gefahr: 3, handlungsfreiheit: 3, letalitaet: 3,
    crunch: 2.5, narrativ: 3, fluff: 3, weltwissen: 2,
    noPref: {},
  };

  function budgetSum(key) { return Object.values(state[key]).reduce((a, b) => a + b, 0); }

  function renderBudget(config) {
    const wrap = el('<div class="wahlomat-budget"></div>');
    Object.entries(config.labels).forEach(([key, label]) => {
      const row = el(`<label class="wahlomat-budget-row">
        <span>${esc(label)}</span>
        <input type="range" min="0" max="${config.max}" step="1" value="${state[config.key][key]}">
        <output>${state[config.key][key]}</output>
      </label>`);
      const input = row.querySelector('input');
      const output = row.querySelector('output');
      input.addEventListener('input', () => {
        let v = Number(input.value);
        const others = budgetSum(config.key) - state[config.key][key];
        if (others + v > config.total) v = Math.max(0, config.total - others);
        input.value = String(v);
        state[config.key][key] = v;
        output.textContent = String(v);
        updateError();
      });
      wrap.appendChild(row);
    });
    return wrap;
  }

  function rangeField(name, label, hint) {
    const wrap = el(`<fieldset class="wahlomat-field">
      <legend>${esc(label)}</legend>
      <small>${esc(hint)}</small>
      <div class="wahlomat-range">
        <input type="range" min="1" max="5" step=".5" value="${state[name]}">
        <output>${state[name]}</output>
      </div>
      <label class="wahlomat-nopref"><input type="checkbox"> Keine Präferenz -- diese Frage nicht werten</label>
    </fieldset>`);
    const input = wrap.querySelector('input[type=range]');
    const output = wrap.querySelector('output');
    input.addEventListener('input', () => { state[name] = Number(input.value); output.textContent = String(state[name]); });
    const nopref = wrap.querySelector('.wahlomat-nopref input');
    nopref.addEventListener('change', () => {
      state.noPref[name] = nopref.checked;
      input.disabled = nopref.checked;
      output.textContent = nopref.checked ? '–' : String(state[name]);
    });
    return wrap;
  }

  function figureField() {
    const wrap = el(`<fieldset class="wahlomat-field">
      <legend>Welche Art Figuren möchtet ihr spielen?</legend>
      <small>Mehrfachauswahl möglich — wählt alle Kompetenzstufen, die für euch in Frage kommen.</small>
      <div class="wahlomat-choices"></div>
    </fieldset>`);
    const list = wrap.querySelector('.wahlomat-choices');
    FIGURE_OPTIONS.forEach(([value, label]) => {
      const item = el(`<label class="wahlomat-choice"><input type="checkbox" value="${value}"><span>${esc(label)}</span></label>`);
      const cb = item.querySelector('input');
      cb.addEventListener('change', () => {
        state.figurenkompetenz = cb.checked
          ? [...state.figurenkompetenz, value]
          : state.figurenkompetenz.filter((v) => v !== value);
        updateError();
      });
      list.appendChild(item);
    });
    return wrap;
  }

  let errorBox;
  function updateError() {
    if (!errorBox) return;
    const s = STEPS[state.step - 1];
    let msg = '';
    if (s.budget) {
      const cfg = B[s.budget];
      const sum = budgetSum(s.budget);
      if (sum !== cfg.total) msg = `Bitte verteilt genau ${cfg.total} Punkte (aktuell ${sum}/${cfg.total}).`;
    }
    if (s.n === 4 && !state.figurenkompetenz.length) msg = 'Bitte wählt mindestens ein Figurenbild.';
    errorBox.textContent = msg;
  }

  function stepValid() {
    updateError();
    return !errorBox.textContent;
  }

  function renderStep() {
    const s = STEPS[state.step - 1];
    quizWrap.innerHTML = '';
    const section = el(`<section class="panel wahlomat-step">
      <h2><span class="step-num">${s.n}</span> ${esc(s.title)}</h2>
      <p class="muted">${esc(s.lede)}</p>
    </section>`);

    if (s.budget) {
      const cfg = B[s.budget];
      const fs = el(`<fieldset class="wahlomat-field"><legend>${esc(s.budgetLegend)}</legend><small>Verteilt genau ${cfg.total} Punkte, höchstens ${cfg.max} je Option.</small></fieldset>`);
      fs.appendChild(renderBudget(cfg));
      section.appendChild(fs);
    }
    if (s.n === 4) section.appendChild(figureField());
    (RANGES[s.n] || []).forEach(([name, label, hint]) => section.appendChild(rangeField(name, label, hint)));

    errorBox = el('<p class="wahlomat-error"></p>');
    section.appendChild(errorBox);

    const nav = el('<div class="row-actions" style="justify-content:space-between;margin-top:var(--space-4)"></div>');
    const back = el('<button type="button" class="btn">Zurück</button>');
    back.disabled = state.step === 1;
    back.addEventListener('click', () => { state.step -= 1; renderStep(); });
    const next = el(`<button type="button" class="btn btn-primary">${state.step === STEPS.length ? 'Ergebnisse anzeigen' : 'Weiter'}</button>`);
    next.addEventListener('click', () => {
      if (!stepValid()) return;
      if (state.step === STEPS.length) { renderResults(); return; }
      state.step += 1; renderStep();
    });
    nav.appendChild(back); nav.appendChild(next);
    section.appendChild(nav);

    quizWrap.innerHTML = '';
    quizWrap.appendChild(section);
    updateError();

    const pct = Math.round(state.step / STEPS.length * 100);
    progress.querySelector('#wProgressText').textContent = `Schritt ${state.step} von ${STEPS.length}`;
    progress.querySelector('#wProgressPct').textContent = `${pct} %`;
    progress.querySelector('#wProgressBar').style.width = `${pct}%`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function groupProfile() {
    const val = (name) => (state.noPref[name] ? null : state[name]);
    return {
      genre: state.genre, ton: state.ton, aktivitaeten: state.aktivitaeten,
      welt_fremdheit: val('welt_fremdheit'), gefahr: val('gefahr'), handlungsfreiheit: val('handlungsfreiheit'),
      figurenkompetenz: state.figurenkompetenz, letalitaet: val('letalitaet'),
      crunch: val('crunch'), narrativ: val('narrativ'), fluff: val('fluff'), weltwissen: val('weltwissen'),
    };
  }

  function renderResults() {
    const profile = groupProfile();
    const results = games.map((g) => scoreGame(g, profile)).sort((a, b) => b.score - a.score);

    quizWrap.hidden = true;
    progress.hidden = true;
    resultsWrap.hidden = false;
    resultsWrap.innerHTML = '';

    const langLabel = (l) => (l === 'de' ? 'Deutsch' : l === 'en' ? 'Englisch' : l || 'Sprache offen');
    const listHtml = results.map((g, i) => {
      const score = Math.round(g.score);
      const chips = makeChips(g, profile);
      const breakdown = Object.entries(g.breakdown).map(([n, v]) => `<span class="badge">${esc(n)}: <strong>${v.toFixed(1)}</strong></span>`).join(' ');
      return `<article class="card wahlomat-result">
        <div class="wahlomat-result-top">
          <span class="faint">#${i + 1}</span>
          <div><h3><a href="#/spiele/${esc(g.id)}">${esc(g.title)}</a></h3><div class="muted" style="font-size:var(--text-xs)">${esc(g.system_family || '–')} · ${esc(langLabel(g.language))}</div></div>
          <span class="badge badge-lang">${score}/100</span>
        </div>
        <div class="bar"><i style="width:${score}%"></i></div>
        <div class="tag-row">
          ${chips.good.map((t) => `<span class="badge">✓ ${esc(t)}</span>`).join('')}
          ${chips.warnings.map((t) => `<span class="badge" style="color:var(--warn);border-color:var(--warn)">△ ${esc(t)}</span>`).join('')}
        </div>
        <details><summary class="muted" style="font-size:var(--text-xs);cursor:pointer">Punkteaufschlüsselung</summary><div class="tag-row" style="margin-top:var(--space-2)">${breakdown}</div></details>
      </article>`;
    }).join('');

    const section = el(`<section>
      <div class="result-bar">
        <div><p class="faint" style="font-size:var(--text-xs);text-transform:uppercase;letter-spacing:.07em;margin:0 0 .2rem">Euer Ergebnis</p><h2>Passende Spiele</h2></div>
        <button type="button" class="btn" id="wRestart">Neu starten</button>
      </div>
      <div class="help-box">Bewertet wurden alle ${results.length} veröffentlichten Spiele aus dem Katalog.</div>
      <div class="wahlomat-results">${listHtml}</div>
    </section>`);
    section.querySelector('#wRestart').addEventListener('click', () => {
      state.step = 1;
      state.genre = freshBudget('genre');
      state.ton = freshBudget('ton');
      state.aktivitaeten = freshBudget('aktivitaeten');
      state.figurenkompetenz = [];
      state.noPref = {};
      quizWrap.hidden = false;
      progress.hidden = false;
      resultsWrap.hidden = true;
      renderStep();
    });
    resultsWrap.appendChild(section);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  renderStep();
}
