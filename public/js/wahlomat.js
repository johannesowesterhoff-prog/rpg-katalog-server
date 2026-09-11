// RPG-Wahlomat: sechs Fragenschritte über Genre, Ton, Spielstil, Figuren,
// Regeln und Fluff, danach ein Ranking der eigenen Sammlung.
//
// Die Fragen/Gewichte/Heuristiken sind bewusst 1:1 aus Johannes' eigenem
// Fragebogen-Entwurf übernommen (siehe rpg-wahlomat-fragebogen.pdf). Einzige
// inhaltliche Anpassung ggü. dem ursprünglichen Standalone-Tool: die
// Genre-Punkteverteilung matcht jetzt gegen die echten Top-Genre-Tags
// (genre_setting_top) statt gegen Sub-Genre-Tags, und der Ton wird zuerst aus
// den kuratierten Top-Tone-Tags abgeleitet statt nur heuristisch aus
// Genre/Fokus rekonstruiert -- weil wir diese Daten inzwischen im Katalog
// gepflegt haben.
import { api } from './api.js';
import { el, esc, toast } from './ui.js';

const B = {
  genre: {
    total: 6, max: 3, key: 'genre',
    labels: { Fantasy: 'Fantasy', 'Science-Fiction': 'Science-Fiction', Horror: 'Horror', Cyberpunk: 'Cyberpunk', Superhelden: 'Superhelden', Gegenwart: 'Gegenwart / Mystery' },
  },
  ton: {
    total: 6, max: 3, key: 'ton',
    labels: { Heroisch: 'Heroisch & hoffnungsvoll', Abenteuerlich: 'Abenteuerlich & locker', Skurril: 'Skurril & humorvoll', Düster: 'Düster & dramatisch', Bedrohlich: 'Spannend & bedrohlich', Unheimlich: 'Unheimlich & verstörend', Persönlich: 'Persönlich & emotional' },
  },
  aktivitaeten: {
    total: 10, max: 4, key: 'aktivitaeten',
    labels: { kampf_taktik: 'Kämpfen & taktisch planen', erkundung: 'Erkunden & entdecken', ermittlung: 'Ermitteln & Rätsel lösen', soziale_szenen: 'Beziehungen & Rollenspiel', survival: 'Überleben & Ressourcen', weltgestaltung: 'Welt, Basis & Fraktionen' },
  },
};

const W = { genre: 15, setting: 7, tone: 12, threat: 6, activities: 15, agency: 5, figures: 7, lethality: 8, crunch: 7, narrativ: 8, fluff: 7, world: 3 };

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
  2: [['gefahr', 'Wie intensiv sollen Bedrohung und Druck sein?', '1 = entspannt · 5 = Survival oder Horror', 3]],
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

// ---- Heuristik-Tagsets fürs Auto-Profil (Fallback ohne manuelle Recherche).
const TAGS = {
  weltHigh: new Set(['Space Opera', 'Weird Fantasy', 'Primal Punk', 'Mythische Inselwelt', 'Cyberpunk', '(Post-)Apokalypse', 'Low-Fi Sci-Fi']),
  weltMidHigh: new Set(['Science-Fiction', 'High Fantasy', 'Dark Fantasy', 'Superhelden', 'Märchenfantasy', 'Urban Fantasy', 'Hyborisches Zeitalter', 'Asiatische Martial-Arts-Welt']),
  weltLow: new Set(['Gegenwart / Modern', 'Krimi', 'Noir', 'Neo-Noir', 'Politthriller', 'Kindgerecht', 'Akademie', 'Coming-of-Age', '(Pseudo-)Historisch', 'Auftragskiller']),

  gefahrHigh: new Set(['Überleben', 'Survival-Horror', 'Horror', 'Kultbekämpfung', '(Post-)Apokalypse', 'Dark Fantasy']),
  gefahrMid: new Set(['Kampf / Taktik', 'Gangspiel', 'Konflikte zwischen Kulturen', 'Action', 'Pulp-Action', 'Cinematic Action', 'Mystery']),
  gefahrLow: new Set(['Kinderfreundlich / Familienrunden', 'Dorfleben', 'kooperatives Storytelling', 'Kindgerecht']),

  letalHigh: new Set(['Überleben', 'Survival-Horror', 'Old-School-Spiel', 'Dungeon-Crawls', 'Sandbox', 'Sandbox-Szenarien', 'Aufbau einer Festung']),
  letalMid: new Set(['Horror', 'Kampf / Taktik', 'Action', 'Pulp-Action', 'Cinematic Action']),
  letalLow: new Set(['Kinderfreundlich / Familienrunden', 'kooperatives Storytelling', 'Dorfleben', 'Kindgerecht', 'Coming-of-Age']),

  figHigh: new Set(['Superhelden', 'Mythische Heldenreisen', 'Cinematic Action', 'Pulp-Action', 'Ruhm und Rivalität']),
  figLow: new Set(['Kindgerecht', 'Kinderfreundlich / Familienrunden', 'Coming-of-Age', 'Akademie', 'Schnelle Charaktererstellung']),

  handlHigh: new Set(['Sandbox', 'Gemeinsamer Weltenbau', 'Fraktionen', 'Aufbau einer Festung', 'Dorfleben', 'Adaptiv / Baukastensystem', 'Improvisation']),
  handlLow: new Set(['Missionen / Aufträge', 'Cinematic Action', 'Episodische Insel-Abenteuer', 'Serienartige Geschichten']),

  aktivitaeten: {
    kampf_taktik: new Set(['Kampf / Taktik', 'Action', 'Pulp-Action', 'Cinematic Action']),
    erkundung: new Set(['Erkundung', 'Dungeon-Crawls', 'Abenteuer', 'Episodische Insel-Abenteuer', 'Sword & Sorcery-Abenteuer', 'Raumfahrt', 'Hex-Crawl / Erkundung']),
    ermittlung: new Set(['Ermittlungen', 'Mystery', 'Intrigen', 'kreative Problemlösung']),
    soziale_szenen: new Set(['Charakterentwicklung', 'Soziale Interaktionen', 'Erzählorientiert', 'kooperatives Storytelling']),
    survival: new Set(['Überleben', 'Survival-Horror', 'Ressourcenmanagement', 'Old-School-Spiel']),
    weltgestaltung: new Set(['Gemeinsamer Weltenbau', 'Fraktionen', 'Aufbau einer Festung', 'Sandbox', 'Sandbox-Szenarien', 'Dorfleben', 'Adaptiv / Baukastensystem']),
  },
};

// Kuratierte Top-Tone-Tags (siehe Katalog: Bodenständig, Cinematisch, Düster,
// Heroisch, Hoffnungsvoll, Humorvoll, Mystisch / Okkult, Märchenhaft,
// Politisch / Gesellschaftlich, Tragisch) auf die 7 Wahlomat-Tonbuckets.
const TOP_TONE_MAP = {
  'Düster': ['Düster'],
  'Heroisch': ['Heroisch'],
  'Hoffnungsvoll': ['Heroisch'],
  'Humorvoll': ['Skurril'],
  'Märchenhaft': ['Skurril'],
  'Mystisch / Okkult': ['Unheimlich'],
  'Tragisch': ['Persönlich'],
  'Politisch / Gesellschaftlich': ['Düster'],
  'Cinematisch': ['Abenteuerlich'],
  'Bodenständig': ['Bedrohlich'],
};

const GENRE_ALIAS = { 'Gegenwart / Modern': 'Gegenwart' };

function anyTag(tags, set) { return tags.some((tag) => set.has(tag)); }

function automaticProfile(game) {
  const tags = [...game.genre_setting_top, ...game.genre_setting, ...game.play_focus];
  const aktivitaeten = {};
  Object.entries(TAGS.aktivitaeten).forEach(([key, set]) => { aktivitaeten[key] = anyTag(tags, set) ? 4 : 1.5; });

  return {
    welt_fremdheit: anyTag(tags, TAGS.weltHigh) ? 4.5 : anyTag(tags, TAGS.weltMidHigh) ? 4 : anyTag(tags, TAGS.weltLow) ? 2 : 3,
    gefahr: anyTag(tags, TAGS.gefahrHigh) ? 4.5 : anyTag(tags, TAGS.gefahrMid) ? 3.5 : anyTag(tags, TAGS.gefahrLow) ? 2 : 2.5,
    letalitaet: anyTag(tags, TAGS.letalHigh) ? 4 : anyTag(tags, TAGS.letalMid) ? 3.5 : anyTag(tags, TAGS.letalLow) ? 2 : 2.5,
    figurenkompetenz: anyTag(tags, TAGS.figHigh) ? 4.5 : anyTag(tags, TAGS.figLow) ? 2 : 3,
    handlungsfreiheit: anyTag(tags, TAGS.handlHigh) ? 4 : anyTag(tags, TAGS.handlLow) ? 2.5 : 3,
    aktivitaeten,
  };
}

function toneFromBuckets(game) {
  const fromTop = game.tone_theme_top.flatMap((t) => TOP_TONE_MAP[t] || []);
  if (fromTop.length) return [...new Set(fromTop)];
  // Fallback nur, falls ein Spiel ausnahmsweise kein Top-Tone-Tag trägt.
  const tags = [...game.genre_setting, ...game.play_focus];
  const heuristic = {
    Unheimlich: new Set(['Horror', 'Survival-Horror', '(Post-)Apokalypse']),
    Bedrohlich: new Set(['Horror', 'Survival-Horror', 'Dark Fantasy']),
    Düster: new Set(['Dark Fantasy', 'Noir', 'Neo-Noir', 'Politthriller', 'Krimi', 'Gangspiel']),
    Heroisch: new Set(['Superhelden', 'Cinematic Action', 'Pulp-Action', 'Mythische Heldenreisen', 'Ruhm und Rivalität', 'High Fantasy']),
    Abenteuerlich: new Set(['Erkundung', 'Abenteuer', 'Dungeon-Crawls', 'Missionen / Aufträge', 'Sword & Sorcery', 'Sword & Sorcery-Abenteuer']),
    Skurril: new Set(['Satire', 'Kindgerecht', 'Märchen', 'kreative Problemlösung']),
    Persönlich: new Set(['Charakterentwicklung', 'Soziale Interaktionen', 'Intrigen', 'Coming-of-Age']),
  };
  const tones = Object.entries(heuristic).filter(([, set]) => anyTag(tags, set)).map(([tone]) => tone);
  return tones.length ? tones : ['Abenteuerlich'];
}

function buildGames(catalog) {
  if (!catalog || !Array.isArray(catalog.games) || !catalog.games.length) {
    throw new Error('Der Katalog enthält kein gültiges Spiele-Array.');
  }
  return catalog.games.map((game) => {
    const genreTop = (game.genre_setting_top || []).map((g) => GENRE_ALIAS[g] || g);
    const g = { ...game, genre_setting_top: game.genre_setting_top || [], genre_setting: game.genre_setting || [], play_focus: game.play_focus || [], tone_theme_top: game.tone_theme_top || [], tone_theme: game.tone_theme || [] };
    return {
      id: game.slug,
      title: game.title,
      language: game.language,
      system_family: game.system_family,
      genre: genreTop,
      ton: toneFromBuckets(g),
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

function makeChips(game, profile) {
  const highest = (values) => Object.entries(values).sort((a, b) => b[1] - a[1])[0][0];
  const good = [];
  const warnings = [];
  const genre = highest(profile.genre);
  const tone = highest(profile.ton);
  const activity = highest(profile.aktivitaeten);
  if (game.genre.includes(genre)) good.push('Wunschgenre');
  if (game.ton.includes(tone)) good.push('Passender Ton');
  if (game.aktivitaeten[activity] >= 3.5) good.push('Stark bei ' + B.aktivitaeten.labels[activity]);
  if (profile.crunch != null && proximity(game.crunch, profile.crunch) >= 0.82) good.push('Passender Regelumfang');
  if (profile.letalitaet != null && Math.abs(game.letalitaet - profile.letalitaet) >= 1.5) {
    warnings.push(game.letalitaet > profile.letalitaet ? 'Tödlicher als gewünscht' : 'Weniger harte Folgen');
  }
  if (profile.fluff != null && Math.abs(game.fluff - profile.fluff) >= 1.5) {
    warnings.push(game.fluff > profile.fluff ? 'Mehr Lore als gewünscht' : 'Weniger Lore als gewünscht');
  }
  return { good: good.slice(0, 3), warnings: warnings.slice(0, 2) };
}

// ---------------------------------------------------------------- Rendering
export async function renderWahlomat(root) {
  root.innerHTML = '<div class="catalog-head"><div class="skeleton" style="height:220px"></div></div>';
  document.title = 'RPG-Wahlomat – RPG-Katalog';

  let games;
  try {
    const data = await api('/api/wahlomat.json');
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

  const state = {
    step: 1,
    genre: Object.fromEntries(Object.keys(B.genre.labels).map((k) => [k, 0])),
    ton: Object.fromEntries(Object.keys(B.ton.labels).map((k) => [k, 0])),
    aktivitaeten: Object.fromEntries(Object.keys(B.aktivitaeten.labels).map((k) => [k, 0])),
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

  function rangeField(name, label, hint, disableable = true) {
    const wrap = el(`<fieldset class="wahlomat-field">
      <legend>${esc(label)}</legend>
      <small>${esc(hint)}</small>
      <div class="wahlomat-range">
        <input type="range" min="1" max="5" step=".5" value="${state[name]}">
        <output>${state[name]}</output>
      </div>
      ${disableable ? `<label class="wahlomat-nopref"><input type="checkbox"> Keine Präferenz -- diese Frage nicht werten</label>` : ''}
    </fieldset>`);
    const input = wrap.querySelector('input[type=range]');
    const output = wrap.querySelector('output');
    input.addEventListener('input', () => { state[name] = Number(input.value); output.textContent = String(state[name]); });
    const nopref = wrap.querySelector('.wahlomat-nopref input');
    if (nopref) {
      nopref.addEventListener('change', () => {
        state.noPref[name] = nopref.checked;
        input.disabled = nopref.checked;
        output.textContent = nopref.checked ? '–' : String(state[name]);
      });
    }
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
      state.genre = Object.fromEntries(Object.keys(B.genre.labels).map((k) => [k, 0]));
      state.ton = Object.fromEntries(Object.keys(B.ton.labels).map((k) => [k, 0]));
      state.aktivitaeten = Object.fromEntries(Object.keys(B.aktivitaeten.labels).map((k) => [k, 0]));
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
