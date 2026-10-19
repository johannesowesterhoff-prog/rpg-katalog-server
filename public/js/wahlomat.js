// RPG-Wahlomat: sieben Fragenschritte über Genre, Ton, Spielstil, Figuren,
// Regeln, Fluff und Prioritäten, danach ein Ranking der eigenen Sammlung.
//
// Datengrundlage pro Frage (wichtig für die Einschätzung der Ergebnisse):
//  - Genre, Ton, Crunch/Narrativ/Fluff: exakte Werte aus dem Katalog
//    (genre_setting_top, tone_theme_top, crunch/narrative/fluff-Skalen).
//    Die Auswahllisten werden bei jedem Aufruf live aus den tatsächlich
//    vergebenen Tags gebaut -- neue Top-Genres/-Tones tauchen also
//    automatisch auf, nichts ist hartkodiert.
//  - Spielstil/Aktivitäten: aus Spielfokus-Tags abgeleitet (play_focus).
//  - Welt-Fremdheit, Bedrohung/Druck, Folgen des Scheiterns,
//    Figurenkompetenz, Handlungsfreiheit: kommen aus den internen
//    Wahlomat-Werten (games.wahlomat_profile, nur im Admin sichtbar). Fehlt
//    ein Wert, wird er wie früher geschätzt: aus der vollen
//    Tag-Palette eines Spiels (Top+Sub-Genre, Top+Sub-Tone, Spielfokus)
//    gezählt werden -- je mehr passende Signal-Tags ein Spiel trägt, desto
//    weiter schlägt der Wert aus 3 (Mitte) aus. Das ist präziser als eine
//    grobe Genre-Schublade, bleibt aber eine Näherung, keine recherchierte
//    Tatsache wie Crunch/Narrativ/Fluff.
import { api } from './api.js';
import { el, esc, toast } from './ui.js';

const B = {
  genre: { total: 7, max: 4, key: 'genre', labels: {} },
  ton: { total: 7, max: 4, key: 'ton', labels: {} },
  aktivitaeten: {
    total: 7, max: 4, key: 'aktivitaeten',
    labels: { kampf_taktik: 'Kämpfen & taktisch planen', erkundung: 'Erkunden & entdecken', ermittlung: 'Ermitteln & Rätsel lösen', soziale_szenen: 'Beziehungen & Rollenspiel', survival: 'Überleben & Ressourcen', weltgestaltung: 'Welt, Basis & Fraktionen' },
  },
};

const W = { genre: 15, setting: 7, tone: 12, threat: 8, activities: 15, agency: 6, figures: 7, lethality: 8, crunch: 7, narrativ: 8, fluff: 10 };

const FIGURE_OPTIONS = [
  [1.5, 'Alltagsmenschen in einer außergewöhnlichen Lage'],
  [2, 'Neulinge, Außenseiter:innen oder Underdogs'],
  [3, 'Fähige Abenteurer:innen'],
  [4, 'Profis und Spezialist:innen'],
  [5, 'Große Held:innen oder außergewöhnliche Wesen'],
];

// Interner Label (muss zu den Komponenten-Labels in scoreGame() passen) +
// Anzeigetext für die optionale Prioritäten-Auswahl im letzten Schritt.
const PRIORITY_OPTIONS = [
  ['Genre', 'Genre'],
  ['Setting', 'Welt-Fremdheit'],
  ['Ton', 'Ton'],
  ['Bedrohung', 'Bedrohung & Druck'],
  ['Spielstil', 'Spielstil / Aktivitäten'],
  ['Freiheit', 'Handlungsfreiheit'],
  ['Figurenbild', 'Figurenkompetenz'],
  ['Scheitern', 'Scheitern-Folgen'],
  ['Crunch', 'Crunch (Regelstruktur)'],
  ['Narrativ', 'Narrative Mitgestaltung'],
  ['Fluff', 'Welt-Ausarbeitung (Fluff)'],
];
const PRIORITY_MAX = 3;
// Regler-Schlüssel -> internes Komponenten-Label (für "Egal": abgewählte Regler
// im Prioritäten-Schritt sperren und im Ergebnis benennen).
const SCALAR_TO_PRIORITY = { welt_fremdheit: 'Setting', gefahr: 'Bedrohung', handlungsfreiheit: 'Freiheit', letalitaet: 'Scheitern', figurenkompetenz: 'Figurenbild', crunch: 'Crunch', narrativ: 'Narrativ', fluff: 'Fluff' };
const PRIORITY_BOOST = 1.5;

// Einzelfragen mit Regler 1-5, je Schritt zugeordnet.
const RANGES = {
  1: [['welt_fremdheit', 'Wie fremd soll die Welt im Vergleich zu unserer sein?', '1 = wie unsere Realität · 5 = völlig fremdartig (andere Welt, andere Regeln der Natur)']],
  2: [['gefahr', 'Wie intensiv sollen Bedrohung und Druck sein?', '1 = entspannt und sicher · 5 = existenziell bedrohlich (unabhängig vom Genre)']],
  3: [['handlungsfreiheit', 'Wie offen soll die Handlung sein?', '1 = klarer Auftrag · 5 = Gruppe setzt Ziele und Richtung']],
  4: [['letalitaet', 'Wie folgenreich darf Scheitern sein?', '1 = Auch bei Fehlschlägen geht die Handlung weiter · 5 = Scheitern ist scheitern – echter Verlust (bis hin zum Charaktertod) ist möglich']],
  5: [['crunch', 'Wie viel Regelstruktur möchtet ihr aktiv nutzen?', '1 = sehr leicht, kaum Optionen · 5 = viele Regeln, Optionen und taktische Tiefe (z.B. Charakterbau, Builds)'], ['narrativ', 'Wie stark gestaltet ihr Handlung und Welt direkt mit?', '1 = Spielleitung führt klar · 5 = Welt gemeinsam gestalten']],
  6: [['fluff', 'Wie stark soll die Spielwelt bereits ausgearbeitet sein?', '1 = offen, wenig vorgegeben, viel selbst ausdenken · 5 = stark ausgearbeitete Welt mit viel Hintergrundmaterial']],
};

const STEPS = [
  { n: 1, title: 'Genre & Setting', lede: 'Welche Art Welt soll eure Geschichte tragen?', budget: 'genre', budgetLegend: 'Welche Welten interessieren euch?' },
  { n: 2, title: 'Ton & Themen', lede: 'Welche Stimmung soll eure Runde prägen?', budget: 'ton', budgetLegend: 'Welcher Grundton passt zu euch?' },
  { n: 3, title: 'Spielstil', lede: 'Was möchtet ihr am Tisch überwiegend tun?', budget: 'aktivitaeten', budgetLegend: 'Verteilt euren Spielfokus' },
  { n: 4, title: 'Figuren & Gefahr', lede: 'Wer seid ihr — und wie hart darf die Welt sein?' },
  { n: 5, title: 'Regeln & Erzählweise', lede: 'Wie viel System und wie viel gemeinsame Gestaltung wollt ihr?' },
  { n: 6, title: 'Fluff & Welttiefe', lede: 'Wie viel Hintergrund und Welterkundung soll das Spiel tragen?' },
  { n: 7, title: 'Prioritäten', lede: 'Optional: Was soll im Ergebnis besonders stark zählen?' },
];

// Kurze Erklärungen ("Was ist gemeint?") je Frage – bewusst ohne Beispielspiele,
// damit die Antworten nicht durch bekannte Titel vorgeprägt werden.
const HELP = {
  genre: { text: 'Die Art Welt, in der eure Geschichten spielen. Mehr Punkte = reizt euch mehr, 0 = nicht gewünscht. Spiele, die mehrere eurer Wunschgenres verbinden (z. B. Sci-Fi und Horror), rutschen nach oben.' },
  ton: { text: 'Die Grundstimmung am Tisch – unabhängig vom Setting. Eine Fantasywelt kann gemütlich-humorvoll oder bitter-düster sein; hier geht es um das Gefühl, nicht um die Welt.' },
  aktivitaeten: { text: 'Womit verbringt ihr die meiste Spielzeit? Kämpfen = Gefechte und Taktik stehen im Mittelpunkt. Erkunden = unbekannte Orte, Dungeons, Reisen. Ermitteln = Rätsel, Spuren, Intrigen. Beziehungen = Gespräche, Gefühle, Figurenspiel. Überleben = knappe Vorräte, harte Umgebung. Welt & Fraktionen = eigene Basis, Gruppen, Einfluss aufbauen.' },
  welt_fremdheit: { text: 'Wie weit weicht die Spielwelt von unserem Alltag ab – Natur, Technik, Magie, Gesellschaft? Gemeint ist nicht, wie gefährlich sie ist, sondern wie viel ihr euch neu vorstellen müsst.' },
  gefahr: { text: 'Wie viel Druck spüren die Figuren die ganze Zeit: Feinde, Hunger, eine feindliche Welt? Das ist unabhängig vom Genre – auch ein Fantasyspiel kann sehr behaglich sein.' },
  handlungsfreiheit: { text: 'Gibt das Spiel eher Aufträge und Szenarien vor, die ihr löst? Oder entscheidet ihr selbst, wohin ihr geht und was ihr erreichen wollt (Sandbox)?' },
  letalitaet: { text: 'Was passiert, wenn etwas schiefgeht? Niedrig: Rückschläge und Komplikationen, die Geschichte läuft weiter. Hoch: Figuren können sterben oder dauerhaft verlieren – Vorsicht und Planung lohnen sich.' },
  figurenkompetenz: { text: 'Wie fähig sind eure Figuren zu Beginn im Vergleich zur Welt? Kleine Leute, die über sich hinauswachsen – oder Profis und Held:innen, die von Anfang an glänzen?' },
  crunch: { text: 'Wie viele Regeln wollt ihr aktiv nutzen: Werte, Fertigkeiten, Sonderfähigkeiten, taktische Optionen? Niedrig heißt: in zehn Minuten erklärt, wenige Würfe.' },
  narrativ: { text: 'Wie viel bestimmen die Spielenden über Handlung und Welt mit – über die eigene Figur hinaus? Niedrig: Die Spielleitung erzählt die Welt, ihr steuert eure Figuren. Hoch: Ihr erfindet Orte, Fakten und Wendungen gemeinsam.' },
  fluff: { text: 'Wie viel fertige Welt liefert das Spiel mit: Geschichte, Orte, Fraktionen, Abenteuer? Niedrig: ein loser Rahmen, den ihr selbst füllt.' },
  priorities: { text: 'Jede Frage zählt normalerweise mit ihrem festen Gewicht ins Ergebnis. Was ihr hier ankreuzt, zählt stärker – etwa „Crunch“, wenn euch die Regelmenge wichtiger ist als alles andere. Nicht Angekreuztes zählt weiter ganz normal mit, es wird nichts ausgeblendet. Wer nichts wählt, bekommt ein ausgewogenes Ergebnis.' },
};

// ---- Spielstil/Aktivitäten weiterhin aus Spielfokus-Tags abgeleitet.
const AKTIVITAETEN_TAGS = {
  kampf_taktik: new Set(['Superheldenabenteuer', 'Assassinen-Kampagnen', 'John-Wick-Style', 'Stadt- und Bandenkrieg', 'Missionen / Aufträge', 'Kampf / Taktik', 'Action', 'Pulp-Action', 'Cinematic Action', 'Duelle', 'Bändigen der Elemente', 'Zerstörung']),
  erkundung: new Set(['Schatzjagden', 'Indiana-Jones-Style', 'Galaktische Kampagnen', 'Erkundung', 'Dungeon-Crawls', 'Abenteuer', 'Episodische Insel-Abenteuer', 'Sword & Sorcery-Abenteuer', 'Raumfahrt', 'Hex-Crawl / Erkundung', 'Reise']),
  ermittlung: new Set(['Rätsel', 'Heist', 'Spionage', 'Konzernintrigen', 'Kultbekämpfung', 'Ermittlungen', 'Ermittlungen / Verschwörungen', 'Mystery', 'Intrigen', 'Intrigen / Politik', 'kreative Problemlösung', 'Investigation / Detektivarbeit']),
  soziale_szenen: new Set(['Konflikte zwischen Kulturen', 'Charakterentwicklung', 'Charakterspiel', 'Soziale Interaktionen', 'Soziale Konflikte', 'Erzählorientiert', 'kooperatives Storytelling', 'Diplomatie']),
  survival: new Set(['Überleben', 'Survival-Horror', 'Ressourcenmanagement', 'Old-School-Spiel', 'OSR']),
  weltgestaltung: new Set(['Gangspiel', 'Kreativität', 'Gemeinsamer Weltenbau', 'Fraktionen', 'Aufbau einer Festung', 'Sandbox', 'Sandbox-Szenarien', 'Dorfleben', 'Adaptiv / Baukastensystem', 'Dungeonbau']),
};

// ---- Signal-Tagsets für die fünf nicht direkt im Katalog erfassten Achsen.
// Bewusst breit über Top+Sub-Genre, Top+Sub-Tone UND Spielfokus gestreut,
// damit tatsächlich die recherchierten Sub-Tone-Tags (die genauesten Daten,
// die wir pro Spiel haben) mit einfließen statt nur grobe Genre-Schubladen.
const SIGNALS = {
  weltHigh: new Set(['Space Opera', 'Weird Fantasy', 'Primal Punk', 'Mythische Inselwelt', 'Cyberpunk', '(Post-)Apokalypse', 'Low-Fi Sci-Fi', 'Mysteriös', 'Rätselhaft', 'Realitätsbruch', 'Kosmisches Grauen', 'Urzeitlich', 'Zauberhaft', 'Mythisch', 'Feenhaft', 'Skurril', 'Genreoffen', 'Weite', 'Märchenhaft', 'Märchenfantasy']),
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

// Top-Genres, die auf übernatürliche/fantastische Elemente hindeuten. Trägt
// ein Spiel eines davon ZUSAMMEN mit "Gegenwart / Modern" (z.B. Monster im
// Alltag), zieht "Gegenwart / Modern" die Welt-Fremdheit nicht mehr künstlich
// nach unten -- die Mischung aus Alltag und Übernatürlichem ist ja gerade der
// Punkt solcher Settings, nicht pure Realitätsnähe.
const FANTASTICAL_TOP_GENRES = new Set(['Fantasy', 'Science-Fiction', 'Horror', 'Cyberpunk', 'Superhelden', '(Post-)Apokalypse', 'Universal']);

function automaticProfile(game) {
  const allTags = [...game.genre_setting_top, ...game.genre_setting, ...game.play_focus, ...game.tone_theme_top, ...game.tone_theme];
  const modernButFantastical = game.genre_setting_top.includes('Gegenwart / Modern')
    && game.genre_setting_top.some((t) => FANTASTICAL_TOP_GENRES.has(t));
  const weltTags = modernButFantastical ? allTags.filter((t) => t !== 'Gegenwart / Modern') : allTags;
  const aktivitaeten = {};
  Object.entries(AKTIVITAETEN_TAGS).forEach(([key, set]) => { aktivitaeten[key] = anyCount(game.play_focus, set) ? 4 : 1.5; });

  return {
    welt_fremdheit: scaleFromTags(weltTags, SIGNALS.weltHigh, SIGNALS.weltLow),
    gefahr: scaleFromTags(allTags, SIGNALS.gefahrHigh, SIGNALS.gefahrLow),
    letalitaet: scaleFromTags(allTags, SIGNALS.letalHigh, SIGNALS.letalLow),
    figurenkompetenz: scaleFromTags(allTags, SIGNALS.figHigh, SIGNALS.figLow),
    handlungsfreiheit: scaleFromTags(allTags, SIGNALS.handlHigh, SIGNALS.handlLow),
    aktivitaeten,
  };
}

const WAHLOMAT_AXES = ['welt_fremdheit', 'gefahr', 'letalitaet', 'figurenkompetenz', 'handlungsfreiheit'];

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
      ...automaticProfile(g),
      // Im Admin gepflegte Werte haben Vorrang vor der Tag-Schätzung.
      ...Object.fromEntries(Object.entries(game.wahlomat_profile || {})
        .filter(([key, v]) => WAHLOMAT_AXES.includes(key) && Number.isFinite(Number(v)))
        .map(([key, v]) => [key, Number(v)])),
    };
  });
}

// Nähe auf den 1-5-Skalen: ab 3 Punkten Abstand gibt es nichts mehr. Vorher
// lief die Gerade bis Abstand 4, dadurch unterschied ein Regler kaum zwischen
// 2,5 und 3 -- alle acht Regler zusammen machten nur ein Fünftel der
// Score-Unterschiede aus, Genre/Ton/Spielstil den Rest.
function proximity(gameValue, desiredValue) { return Math.max(0, 1 - Math.abs(Number(gameValue) - Number(desiredValue)) / 3); }
// Genre/Ton: je zur Hälfte der beste Treffer (relativ zum höchsten vergebenen
// Wunschwert, damit 4 Punkte nicht über 100 % hinausschießen) und wie gut die
// Tags des Spiels insgesamt zu den Wünschen passen. So landet z.B. bei
// "Sci-Fi + Horror" ein Spiel mit beiden Genres vor einem reinen Horrorspiel.
// Bei 70/30 gewannen Spiele mit drei Genres fast immer: Sie trafen dreimal so
// oft irgendeinen Wunsch und verloren für die Beliebigkeit kaum etwas.
function tagScore(tags, wishes) {
  const given = Object.values(wishes).filter((v) => v > 0).sort((a, b) => b - a);
  if (!tags.length || !given.length) return 0;
  const hits = tags.map((tag) => wishes[tag] || 0);
  const best = Math.max(...hits) / given[0];
  const ideal = given.slice(0, tags.length).reduce((a, b) => a + b, 0);
  const fit = hits.reduce((a, b) => a + b, 0) / ideal;
  return 0.5 * best + 0.5 * fit;
}
// Spielstil: Anteil der Wunschpunkte, die das Spiel abdeckt (60 %), plus
// wie viele seiner eigenen Schwerpunkte gewünscht sind (40 %). Der zweite
// Teil bremst Spiele mit vier Schwerpunkten, die sonst jede Kombination
// abdecken; bei 20 % kostete ein überzähliger Schwerpunkt fast nichts.
function activityScore(activities, wishes) {
  const total = Object.values(wishes).reduce((sum, v) => sum + v, 0) || 1;
  const has = (key) => (activities[key] || 0) >= 3;
  const coverage = Object.entries(wishes).reduce((sum, [key, points]) => sum + points * (has(key) ? 1 : 0.15), 0) / total;
  const own = Object.keys(activities).filter(has);
  const precision = own.length ? own.filter((key) => (wishes[key] || 0) > 0).length / own.length : 0;
  return 0.6 * coverage + 0.4 * precision;
}
// Figurenbild: Jede gewählte Stufe deckt ±0,5 ab. Die Katalogwerte liegen
// oft auf 2,5/3,5/4,5, also zwischen den Optionen -- ohne Toleranz bekämen
// 18 Spiele mit einer Auswahl nie volle Punkte.
function figureScore(gameValue, selectedValues) {
  if (!selectedValues || !selectedValues.length) return 0;
  return Math.max(...selectedValues.map((v) => proximity(gameValue - Math.sign(gameValue - v) * Math.min(0.5, Math.abs(gameValue - v)), v)));
}

function scoreGame(game, profile) {
  const components = [
    ['Genre', W.genre, true, tagScore(game.genre, profile.genre)],
    ['Setting', W.setting, profile.welt_fremdheit != null, profile.welt_fremdheit != null ? proximity(game.welt_fremdheit, profile.welt_fremdheit) : 0],
    ['Ton', W.tone, true, tagScore(game.ton, profile.ton)],
    ['Bedrohung', W.threat, profile.gefahr != null, profile.gefahr != null ? proximity(game.gefahr, profile.gefahr) : 0],
    ['Spielstil', W.activities, true, activityScore(game.aktivitaeten, profile.aktivitaeten)],
    ['Freiheit', W.agency, profile.handlungsfreiheit != null, profile.handlungsfreiheit != null ? proximity(game.handlungsfreiheit, profile.handlungsfreiheit) : 0],
    ['Figurenbild', W.figures, profile.figurenkompetenz != null, figureScore(game.figurenkompetenz, profile.figurenkompetenz)],
    ['Scheitern', W.lethality, profile.letalitaet != null, profile.letalitaet != null ? proximity(game.letalitaet, profile.letalitaet) : 0],
    ['Crunch', W.crunch, profile.crunch != null, profile.crunch != null ? proximity(game.crunch, profile.crunch) : 0],
    ['Narrativ', W.narrativ, profile.narrativ != null, profile.narrativ != null ? proximity(game.narrativ, profile.narrativ) : 0],
    ['Fluff', W.fluff, profile.fluff != null, profile.fluff != null ? proximity(game.fluff, profile.fluff) : 0],
  ];
  // Bis zu drei per "Prioritäten"-Schritt gewählte Dimensionen zählen stärker.
  const priorities = profile.priorities || [];
  const weightOf = (label, base) => (priorities.includes(label) ? base * PRIORITY_BOOST : base);
  const activeWeight = components.reduce((sum, [label, weight, active]) => sum + (active ? weightOf(label, weight) : 0), 0) || 1;
  const breakdown = {};
  let raw = 0;
  // Mit "Egal" abgewählte Regler (Wert null) sind inaktiv: Sie zählen weder
  // im Zähler noch im Nenner und tauchen in der Aufschlüsselung nicht auf.
  components.forEach(([label, weight, active, value]) => { if (!active) return; const c = weightOf(label, weight) * value; breakdown[label] = c; raw += c; });
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

// ------------------------------------------------------- Teilen & Gruppe
// Die Antworten einer Person stehen kompakt (JSON → Base64url) in der URL:
// #/wahlomat?p=<Person 1>&p=<Person 2>. So lässt sich ein Ergebnis per Link
// teilen, und eine Gruppe sammelt ihre Antworten, indem jede Person den
// Link öffnet, sich hinzufügt und den neuen Link weitergibt. Gespeichert
// werden nur vergebene Punkte und bewegte Regler.
const SCALAR_KEYS = Object.keys(SCALAR_TO_PRIORITY).filter((k) => k !== 'figurenkompetenz');
const STORAGE_KEY = 'rpg-wahlomat:last';
const MAX_MEMBERS = 12;

function toB64url(text) {
  let bin = '';
  new TextEncoder().encode(text).forEach((b) => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(code) {
  const bin = atob(String(code).replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (ch) => ch.charCodeAt(0)));
}

function encodeMember({ name, profile }) {
  const positive = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v > 0));
  return toB64url(JSON.stringify({
    n: name,
    g: positive(profile.genre), t: positive(profile.ton), a: positive(profile.aktivitaeten),
    s: Object.fromEntries(SCALAR_KEYS.filter((k) => profile[k] != null).map((k) => [k, profile[k]])),
    f: profile.figurenkompetenz,
    p: profile.priorities,
  }));
}

// Unbekannte Schlüssel (etwa ein inzwischen umbenanntes Genre) und Werte
// außerhalb der Skalen fallen still heraus; ein kaputter Link ergibt null.
function decodeMember(code) {
  try {
    const o = JSON.parse(fromB64url(code));
    const budget = (src, cfg) => Object.fromEntries(Object.entries(src || {})
      .filter(([k, v]) => Object.hasOwn(cfg.labels, k) && Number.isInteger(v) && v > 0 && v <= cfg.max));
    const scalar = (v) => (v != null && Number(v) >= 1 && Number(v) <= 5 ? Number(v) : null);
    const figureValues = FIGURE_OPTIONS.map(([v]) => v);
    const figures = Array.isArray(o.f) ? o.f.filter((v) => figureValues.includes(v)) : [];
    return {
      name: String(o.n || '').trim().slice(0, 40),
      profile: {
        genre: budget(o.g, B.genre), ton: budget(o.t, B.ton), aktivitaeten: budget(o.a, B.aktivitaeten),
        ...Object.fromEntries(SCALAR_KEYS.map((k) => [k, scalar(o.s?.[k])])),
        figurenkompetenz: figures.length ? figures : null,
        priorities: Array.isArray(o.p) ? o.p.filter((p) => PRIORITY_OPTIONS.some(([k]) => k === p)).slice(0, PRIORITY_MAX) : [],
      },
    };
  } catch { return null; }
}

// Gruppenwertung: 60 % Durchschnitt + 40 % schwächster Einzelwert. Oben
// landet, womit alle gut leben können -- ein Spiel, das eine Person begeistert
// und eine andere gar nicht abholt, rutscht nach unten.
function scoreForGroup(game, members) {
  const single = members.map((m) => scoreGame(game, m.profile));
  if (single.length === 1) return { ...single[0], perPerson: [single[0].score] };
  const scores = single.map((r) => r.score);
  const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
  return { ...game, score: 0.6 * mean + 0.4 * Math.min(...scores), perPerson: scores };
}

// ------------------------------------------------------------ Klartext
const joinDe = (items) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} und ${items.at(-1)}`);
const lowerFirst = (t) => (/^(Genre|Ton) /.test(t) ? t : t[0].toLowerCase() + t.slice(1));

function explain(game, members) {
  const chips = members.map((m) => makeChips(game, m.profile));
  if (members.length === 1) {
    const { good, warnings } = chips[0];
    return {
      good: good.length ? `Passt: ${joinDe(good.map(lowerFirst))}.` : '',
      warn: warnings.length ? `Weicht ab: ${joinDe(warnings.map(lowerFirst))}.` : '',
    };
  }
  const common = chips[0].good.filter((t) => chips.every((c) => c.good.includes(t)));
  const warn = chips.map((c, i) => (c.warnings.length ? `${members[i].name}: ${joinDe(c.warnings.map(lowerFirst))}` : '')).filter(Boolean);
  return {
    good: common.length ? `Passt für alle: ${joinDe(common.map(lowerFirst))}.` : '',
    warn: warn.length ? `Weicht ab – ${warn.join(' · ')}.` : '',
  };
}

// ------------------------------------------------------- Netzdiagramm
const RADAR_AXES = [
  ['welt_fremdheit', 'Welt', 'Welt-Fremdheit'], ['gefahr', 'Bedrohung', 'Bedrohung & Druck'],
  ['handlungsfreiheit', 'Freiheit', 'Handlungsfreiheit'], ['letalitaet', 'Scheitern', 'Scheitern-Folgen'],
  ['figurenkompetenz', 'Figuren', 'Figurenkompetenz'], ['crunch', 'Crunch', 'Crunch'],
  ['narrativ', 'Narrativ', 'Narrative Mitgestaltung'], ['fluff', 'Fluff', 'Welt-Ausarbeitung'],
];
const fmtNum = (v) => String(Math.round(v * 10) / 10).replace('.', ',');

// Wunschwert einer Achse, gemittelt über alle, die sie nicht auf „Egal“
// gelassen haben (Figurenbild: Mittel der gewählten Stufen).
function wishValue(members, key) {
  const vals = members.map((m) => m.profile[key])
    .filter((v) => v != null && !(Array.isArray(v) && !v.length))
    .map((v) => (Array.isArray(v) ? v.reduce((a, b) => a + b, 0) / v.length : v));
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

function radarSvg(game, members) {
  const w = 380; const h = 290; const cx = w / 2; const cy = h / 2; const r = 100;
  const n = RADAR_AXES.length;
  const pt = (i, v) => {
    const a = -Math.PI / 2 + (i / n) * 2 * Math.PI;
    return [cx + Math.cos(a) * (v / 5) * r, cy + Math.sin(a) * (v / 5) * r].map((x) => Math.round(x * 10) / 10);
  };
  const poly = (pts) => pts.map((p) => p.join(',')).join(' ');
  const rings = [1, 2, 3, 4, 5].map((v) => `<polygon points="${poly(RADAR_AXES.map((_, i) => pt(i, v)))}" class="radar-grid${v === 3 ? ' mid' : ''}"/>`).join('');
  const spokes = RADAR_AXES.map((_, i) => { const [x, y] = pt(i, 5); return `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" class="radar-grid"/>`; }).join('');
  const gamePts = RADAR_AXES.map(([k], i) => pt(i, Number(game[k] ?? 3)));
  const wish = RADAR_AXES.map(([k], i) => { const v = wishValue(members, k); return v == null ? null : pt(i, v); }).filter(Boolean);
  const labels = RADAR_AXES.map(([, label], i) => {
    const [x, y] = pt(i, 5.75);
    const anchor = Math.abs(x - cx) < 2 ? 'middle' : x > cx ? 'start' : 'end';
    return `<text x="${x}" y="${y}" text-anchor="${anchor}" dominant-baseline="middle">${label}</text>`;
  }).join('');
  const title = `Profil von ${game.title}${wish.length ? ' im Vergleich mit euren Wünschen' : ''}`;
  return `<svg viewBox="0 0 ${w} ${h}" class="radar" role="img" aria-label="${esc(title)}">
    ${rings}${spokes}
    <polygon points="${poly(gamePts)}" class="radar-game"/>
    ${wish.length >= 3 ? `<polygon points="${poly(wish)}" class="radar-wish"/>` : ''}
    ${wish.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.5" class="radar-wish-dot"/>`).join('')}
    ${labels}
  </svg>`;
}

function radarTable(game, members) {
  return `<table class="radar-table"><thead><tr><th>Achse</th><th>Spiel</th><th>${members.length > 1 ? 'Gruppe (Ø)' : 'Wunsch'}</th></tr></thead><tbody>${RADAR_AXES.map(([k, , long]) => {
    const v = wishValue(members, k);
    return `<tr><td>${long}</td><td>${fmtNum(Number(game[k] ?? 3))}</td><td>${v == null ? 'egal' : fmtNum(v)}</td></tr>`;
  }).join('')}</tbody></table>`;
}

// ------------------------------------------------------- Gruppenbild
// Wo liegen die Wünsche nah beieinander, wo weit auseinander? Hilft beim
// Gespräch, warum das Gruppenergebnis so aussieht.
function groupPicture(members) {
  const agree = [];
  const differ = [];
  RADAR_AXES.forEach(([key, , long]) => {
    const vals = members.map((m) => ({ name: m.name, v: wishValue([m], key) })).filter((x) => x.v != null);
    if (vals.length < 2) return;
    const spread = Math.max(...vals.map((x) => x.v)) - Math.min(...vals.map((x) => x.v));
    if (spread <= 1) agree.push(long);
    else if (spread >= 2) differ.push(`${long} (${vals.map((x) => `${x.name} ${fmtNum(x.v)}`).join(' · ')})`);
  });
  const shared = (key) => Object.entries(B[key].labels).filter(([k]) => members.every((m) => (m.profile[key][k] || 0) > 0)).map(([, label]) => label);
  const row = (label, items, empty) => `<div><dt>${label}</dt><dd>${items.length ? esc(items.join(', ')) : `<span class="faint">${empty}</span>`}</dd></div>`;
  return `<section class="panel wahlomat-group">
    <h3>Gruppenbild</h3>
    <dl>
      ${row('Gemeinsame Genres', shared('genre'), 'keine Überschneidung')}
      ${row('Gemeinsamer Ton', shared('ton'), 'keine Überschneidung')}
      ${row('Gemeinsamer Spielstil', shared('aktivitaeten'), 'keine Überschneidung')}
      ${row('Einig bei', agree, '–')}
      ${row('Weit auseinander', differ, 'nirgends – ihr liegt überall nah beieinander')}
    </dl>
  </section>`;
}

// Wie oft und wann ein Spiel zuletzt am Tisch lag (aus dem Spielabend-Protokoll).
function playHistory(sessions) {
  const map = new Map();
  sessions.forEach((s) => {
    if (!s.slug) return;
    const h = map.get(s.slug) || { count: 0, last: '' };
    h.count += 1;
    if (s.played_on > h.last) h.last = s.played_on;
    map.set(s.slug, h);
  });
  return map;
}
const fmtDay = (v) => new Date(v).toLocaleDateString('de-DE');

// Server-Gruppen: Die Tokens zum Ändern/Entfernen bleiben auf dem Gerät,
// das den Eintrag (bzw. die Gruppe) angelegt hat.
const groupKey = (id) => `rpg-wahlomat:group:${id}`;
function loadGroupStore(id) {
  try { return { members: {}, ...JSON.parse(localStorage.getItem(groupKey(id)) || '{}') }; } catch { return { members: {} }; }
}
function saveGroupStore(id, data) {
  try { localStorage.setItem(groupKey(id), JSON.stringify(data)); } catch { /* privat/gesperrt */ }
}
const groupPath = (id) => `#/wahlomat/gruppe/${encodeURIComponent(id)}`;

// ---------------------------------------------------------------- Rendering
export async function renderWahlomat(root, params, groupId = null) {
  root.innerHTML = '<div class="catalog-head"><div class="skeleton" style="height:220px"></div></div>';
  document.title = 'RPG-Wahlomat – RPG-Katalog';

  let games;
  let played = new Map();
  let groupData = null;
  try {
    // Das Protokoll ist nur Beiwerk: Fehlt es, läuft der Wahlomat ohne
    // „zuletzt gespielt“ weiter.
    const [data, log, grp] = await Promise.all([
      api('/api/wahlomat.json'),
      api('/api/play-sessions.json').catch(() => null),
      groupId ? api(`/api/wahlomat/groups/${encodeURIComponent(groupId)}`) : null,
    ]);
    groupData = grp;
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
    played = playHistory(log?.sessions || []);
  } catch (e) {
    root.innerHTML = '';
    if (groupId && e.status === 404) {
      root.appendChild(el(`<div class="empty"><h3>Gruppe nicht gefunden</h3><p class="muted">${esc(e.message)} Vielleicht ist der Link unvollständig.</p><p><a class="btn btn-sm" href="#/wahlomat">Zum Wahlomat</a></p></div>`));
      return;
    }
    root.appendChild(el(`<div class="empty"><h3>Wahlomat nicht verfügbar</h3><p class="muted">${esc(e.message)}</p></div>`));
    toast(e.message, 'err');
    return;
  }
  const gamesById = new Map(games.map((g) => [g.id, g]));

  // Gruppe vom Server oder Personen aus einem geteilten Ergebnis-Link.
  const members = [];
  let group = null;
  let store = { members: {} };
  function applyGroup(d) {
    group = { id: d.id, name: d.name };
    members.length = 0;
    d.members.forEach((x) => { const m = decodeMember(x.answers); if (m) members.push({ ...m, name: x.name, id: x.id }); });
  }
  async function reloadGroup() { applyGroup(await api(`/api/wahlomat/groups/${encodeURIComponent(group.id)}`)); }
  if (groupData) {
    applyGroup(groupData);
    store = loadGroupStore(group.id);
    document.title = `${group.name} – RPG-Wahlomat – RPG-Katalog`;
  } else {
    (params?.getAll('p') || []).map(decodeMember).filter(Boolean).slice(0, MAX_MEMBERS).forEach((m) => members.push(m));
    members.forEach((m, i) => { if (!m.name) m.name = `Person ${i + 1}`; });
  }
  const isMine = (m) => !!(group && m.id != null && store.members[m.id]);

  root.innerHTML = '';
  const head = el(`<section class="catalog-head">
    <h1>RPG-Wahlomat${group ? ` <span class="wahlomat-group-title">· ${esc(group.name)}</span>` : ''}</h1>
    <p class="lede">Sieben kurze Fragebereiche zu Genre, Ton, Spielstil, Figuren, Regeln, Fluff und euren Prioritäten — am Ende ein Ranking ausschließlich aus deiner eigenen Sammlung (${games.length} Spiele). Allein oder als Gruppe.</p>
    <p class="faint" style="font-size:var(--text-xs);max-width:70ch">Alle Werte kommen aus den recherchierten Katalogdaten der Spiele. Unter jeder Frage erklärt „Was ist gemeint?“, worum es geht. Regler stehen anfangs auf „Egal“ und zählen erst, wenn ihr sie bewegt – was euch nicht wichtig ist, lasst ihr einfach stehen. Im letzten Schritt könnt ihr optional bis zu drei Dimensionen stärker gewichten, die euch besonders wichtig sind.</p>
  </section>`);
  root.appendChild(head);

  const resumeWrap = el('<div></div>');
  root.appendChild(resumeWrap);

  const progress = el(`<div class="panel wahlomat-progress">
    <div class="wahlomat-progress-head"><span id="wProgressText"></span><span class="muted" id="wProgressPct"></span></div>
    <div class="bar"><i id="wProgressBar" style="width:0%"></i></div>
  </div>`);
  root.appendChild(progress);

  const quizWrap = el('<div id="wQuiz"></div>');
  const resultsWrap = el('<div id="wResults" hidden></div>');
  root.appendChild(quizWrap);
  root.appendChild(resultsWrap);

  // "Was ist gemeint?" je Frage.
  function helpBox(key) {
    const h = HELP[key];
    if (!h) return null;
    return el(`<details class="wahlomat-help"><summary>Was ist gemeint?</summary><p>${esc(h.text)}</p></details>`);
  }

  function freshBudget(key) { return Object.fromEntries(Object.keys(B[key].labels).map((k) => [k, 0])); }

  const state = {
    step: 1,
    name: '',
    // Index der Person, deren Antworten gerade bearbeitet werden; null = neue Person.
    editIndex: null,
    genre: freshBudget('genre'),
    ton: freshBudget('ton'),
    aktivitaeten: freshBudget('aktivitaeten'),
    // Regler und Figurenbild starten als "Egal" (null): Unberührt heißt
    // "zählt nicht", nicht "Mittelmaß gewünscht". Wer einen Regler bewegt
    // oder eine Figurenstufe anklickt, aktiviert die Frage damit.
    figurenkompetenz: null,
    welt_fremdheit: null, gefahr: null, handlungsfreiheit: null, letalitaet: null,
    crunch: null, narrativ: null, fluff: null,
    priorities: [],
  };

  // Lädt die Antworten einer Person in den Fragebogen (oder leert ihn).
  function loadState(member) {
    const p = member?.profile;
    state.step = 1;
    state.name = member?.name || '';
    ['genre', 'ton', 'aktivitaeten'].forEach((k) => { state[k] = { ...freshBudget(k), ...(p?.[k] || {}) }; });
    SCALAR_KEYS.forEach((k) => { state[k] = p?.[k] ?? null; });
    state.figurenkompetenz = p?.figurenkompetenz ? [...p.figurenkompetenz] : null;
    state.priorities = p ? [...p.priorities] : [];
  }

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
        <input type="range" min="1" max="5" step=".5" value="${state[name] ?? 3}">
        <output>${state[name] ?? 3}</output>
        <label class="wahlomat-skip"><input type="checkbox"> Egal</label>
      </div>
    </fieldset>`);
    const input = wrap.querySelector('input[type=range]');
    const output = wrap.querySelector('output');
    const skip = wrap.querySelector('.wahlomat-skip input');
    // "Egal" setzt den Wert auf null -> die Komponente zählt in scoreGame()
    // weder im Zähler noch im Nenner. Vorher hieß ein unberührter Regler
    // "3 = Mittelmaß gewünscht" und bevorzugte mittige Spiele.
    const range = wrap.querySelector('.wahlomat-range');
    const sync = () => { skip.checked = state[name] == null; range.classList.toggle('is-egal', skip.checked); };
    sync();
    // Bewegen des Reglers hebt "Egal" auf; der Regler bleibt dafür bedienbar.
    input.addEventListener('input', () => { state[name] = Number(input.value); output.textContent = String(state[name]); sync(); });
    skip.addEventListener('change', () => { state[name] = skip.checked ? null : Number(input.value); sync(); });
    const help = helpBox(name);
    if (help) wrap.querySelector('small').after(help);
    return wrap;
  }

  function figureField() {
    const wrap = el(`<fieldset class="wahlomat-field">
      <legend>Welche Art Figuren möchtet ihr spielen?</legend>
      <small>Mehrfachauswahl möglich — wählt alle Kompetenzstufen, die für euch in Frage kommen.</small>
      <div class="wahlomat-choices"></div>
      <label class="wahlomat-skip"><input type="checkbox"> Egal</label>
    </fieldset>`);
    const list = wrap.querySelector('.wahlomat-choices');
    const skip = wrap.querySelector('.wahlomat-skip input');
    const help = helpBox('figurenkompetenz');
    if (help) wrap.querySelector('small').after(help);
    const sync = () => { skip.checked = state.figurenkompetenz == null; list.classList.toggle('is-egal', skip.checked); };
    FIGURE_OPTIONS.forEach(([value, label]) => {
      const checked = (state.figurenkompetenz || []).includes(value);
      const item = el(`<label class="wahlomat-choice"><input type="checkbox" value="${value}" ${checked ? 'checked' : ''}><span>${esc(label)}</span></label>`);
      const cb = item.querySelector('input');
      cb.addEventListener('change', () => {
        const current = state.figurenkompetenz || [];
        state.figurenkompetenz = cb.checked ? [...current, value] : current.filter((v) => v !== value);
        sync();
        updateError();
      });
      list.appendChild(item);
    });
    skip.addEventListener('change', () => {
      state.figurenkompetenz = skip.checked ? null : [];
      if (skip.checked) list.querySelectorAll('input').forEach((cb) => { cb.checked = false; });
      sync();
      updateError();
    });
    sync();
    return wrap;
  }

  function priorityField() {
    const wrap = el(`<fieldset class="wahlomat-field">
      <legend>Was ist euch am wichtigsten?</legend>
      <small>Optional: wählt bis zu ${PRIORITY_MAX} Dimensionen, die ${Math.round((PRIORITY_BOOST - 1) * 100)} % stärker gewichtet werden sollen (${PRIORITY_BOOST}x statt 1x). Ohne Auswahl bleibt alles gleich gewichtet.</small>
      <div class="wahlomat-choices"></div>
    </fieldset>`);
    const list = wrap.querySelector('.wahlomat-choices');
    const help = helpBox('priorities');
    if (help) wrap.querySelector('small').after(help);
    function refresh() {
      const atMax = state.priorities.length >= PRIORITY_MAX;
      list.querySelectorAll('input').forEach((cb) => { if (!cb.checked) cb.disabled = atMax || cb.closest('.is-off') !== null; });
    }
    const skipped = new Set(Object.entries(SCALAR_TO_PRIORITY).filter(([axis]) => state[axis] == null).map(([, label]) => label));
    PRIORITY_OPTIONS.forEach(([key, label]) => {
      const off = skipped.has(key);
      const item = el(`<label class="wahlomat-choice${off ? ' is-off' : ''}" ${off ? 'title="Als „Egal“ abgewählt – zählt nicht"' : ''}><input type="checkbox" value="${esc(key)}" ${state.priorities.includes(key) && !off ? 'checked' : ''} ${off ? 'disabled' : ''}><span>${esc(label)}${off ? ' (egal)' : ''}</span></label>`);
      const cb = item.querySelector('input');
      cb.addEventListener('change', () => {
        state.priorities = cb.checked
          ? [...state.priorities, key]
          : state.priorities.filter((v) => v !== key);
        refresh();
      });
      list.appendChild(item);
    });
    state.priorities = state.priorities.filter((p) => !skipped.has(p));
    refresh();
    return wrap;
  }

  function nameField() {
    const wrap = el(`<label class="wahlomat-name">
      <span>${group ? 'Dein Name <span class="faint">(Pflicht – so sehen die anderen, wer ausgefüllt hat)</span>' : 'Wer füllt aus? <span class="faint">(optional)</span>'}</span>
      <input type="text" maxlength="40" placeholder="Name" value="${esc(state.name)}" ${group ? 'required' : ''}>
    </label>`);
    wrap.querySelector('input').addEventListener('input', (e) => { state.name = e.target.value; updateError(); });
    return wrap;
  }

  let errorBox;
  // Die Meldung erscheint erst, wenn jemand auf "Weiter" geklickt hat --
  // vorher stand bei jedem Punkteschritt sofort rot "aktuell 0/7" da.
  let attempted = false;
  function updateError() {
    if (!errorBox || !attempted) return;
    const s = STEPS[state.step - 1];
    let msg = '';
    if (s.budget) {
      const cfg = B[s.budget];
      const sum = budgetSum(s.budget);
      if (sum !== cfg.total) msg = `Bitte verteilt genau ${cfg.total} Punkte (aktuell ${sum}/${cfg.total}).`;
    }
    if (s.n === 4 && state.figurenkompetenz && !state.figurenkompetenz.length) msg = 'Bitte wählt mindestens ein Figurenbild – oder hakt „Egal“ an.';
    if (s.n === 1 && group) {
      const n = state.name.trim();
      if (!n) msg = 'Bitte trag deinen Namen ein.';
      else if (members.some((m, i) => i !== state.editIndex && m.name.toLowerCase() === n.toLowerCase())) msg = `„${n}“ ist in dieser Gruppe schon vergeben – bitte einen anderen Namen wählen.`;
    }
    errorBox.textContent = msg;
  }

  function stepValid() {
    attempted = true;
    updateError();
    return !errorBox.textContent;
  }

  // Wer gerade ausfüllt, sobald schon andere im Ergebnis stehen.
  function personLabel() {
    if (group) return state.name.trim();
    const idx = state.editIndex ?? members.length;
    return state.name.trim() || members[idx]?.name || `Person ${idx + 1}`;
  }

  function renderStep() {
    const s = STEPS[state.step - 1];
    quizWrap.innerHTML = '';
    const section = el(`<section class="panel wahlomat-step">
      <h2><span class="step-num">${s.n}</span> ${esc(s.title)}</h2>
      <p class="muted">${esc(s.lede)}</p>
    </section>`);

    if (s.n === 1) section.appendChild(nameField());
    if (s.budget) {
      const cfg = B[s.budget];
      const fs = el(`<fieldset class="wahlomat-field"><legend>${esc(s.budgetLegend)}</legend><small>Verteilt genau ${cfg.total} Punkte, höchstens ${cfg.max} je Option.</small></fieldset>`);
      const help = helpBox(s.budget);
      if (help) fs.appendChild(help);
      fs.appendChild(renderBudget(cfg));
      section.appendChild(fs);
    }
    if (s.n === 4) section.appendChild(figureField());
    if (s.n === 7) section.appendChild(priorityField());
    (RANGES[s.n] || []).forEach(([name, label, hint]) => section.appendChild(rangeField(name, label, hint)));

    errorBox = el('<p class="wahlomat-error"></p>');
    section.appendChild(errorBox);

    const nav = el('<div class="row-actions" style="justify-content:space-between;margin-top:var(--space-4)"></div>');
    const left = el('<div class="row-actions"></div>');
    const back = el('<button type="button" class="btn">Zurück</button>');
    back.disabled = state.step === 1;
    back.addEventListener('click', () => { state.step -= 1; renderStep(); });
    left.appendChild(back);
    // Wer eine Person hinzufügt oder bearbeitet, kommt ohne Änderung zurück.
    if (members.length || group) {
      const cancel = el('<button type="button" class="btn btn-ghost">Abbrechen</button>');
      cancel.addEventListener('click', () => renderResults());
      left.appendChild(cancel);
    }
    const next = el(`<button type="button" class="btn btn-primary">${state.step === STEPS.length ? 'Ergebnisse anzeigen' : 'Weiter'}</button>`);
    next.addEventListener('click', () => {
      if (!stepValid()) return;
      if (state.step === STEPS.length) {
        next.disabled = true;
        finishQuiz().finally(() => { next.disabled = false; });
        return;
      }
      state.step += 1; renderStep();
    });
    nav.appendChild(left); nav.appendChild(next);
    section.appendChild(nav);

    quizWrap.innerHTML = '';
    quizWrap.appendChild(section);
    attempted = false;
    errorBox.textContent = '';

    const pct = Math.round(state.step / STEPS.length * 100);
    progress.querySelector('#wProgressText').textContent = `${(members.length || group) && personLabel() ? `${personLabel()} · ` : ''}Schritt ${state.step} von ${STEPS.length}`;
    progress.querySelector('#wProgressPct').textContent = `${pct} %`;
    progress.querySelector('#wProgressBar').style.width = `${pct}%`;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function currentProfile() {
    return {
      genre: state.genre, ton: state.ton, aktivitaeten: state.aktivitaeten,
      welt_fremdheit: state.welt_fremdheit, gefahr: state.gefahr, handlungsfreiheit: state.handlungsfreiheit,
      figurenkompetenz: state.figurenkompetenz, letalitaet: state.letalitaet,
      crunch: state.crunch, narrativ: state.narrativ, fluff: state.fluff,
      priorities: state.priorities,
    };
  }

  function startQuiz(member = null, editIndex = null) {
    loadState(member);
    state.editIndex = editIndex;
    resumeWrap.innerHTML = '';
    quizWrap.hidden = false;
    progress.hidden = false;
    resultsWrap.hidden = true;
    renderStep();
  }

  async function finishQuiz() {
    const idx = state.editIndex ?? members.length;
    const member = { name: personLabel(), profile: currentProfile() };
    // Für „Letzte Antworten“ beim nächsten Besuch – nur in diesem Browser.
    try { localStorage.setItem(STORAGE_KEY, encodeMember(member)); } catch { /* privat/gesperrt */ }
    if (!group) { members[idx] = member; renderResults(); return; }
    const existing = state.editIndex != null ? members[state.editIndex] : null;
    const body = { name: member.name, answers: encodeMember(member) };
    if (existing?.id != null) Object.assign(body, { memberId: existing.id, token: store.members[existing.id] });
    try {
      const r = await api(`/api/wahlomat/groups/${encodeURIComponent(group.id)}/members`, { method: 'POST', body });
      if (r.token) { store.members[r.memberId] = r.token; saveGroupStore(group.id, store); }
      await reloadGroup();
      renderResults();
      toast('Gespeichert – deine Antworten zählen jetzt im Gruppenergebnis.');
    } catch (e) {
      toast(e.message, 'err');
      if (e.status === 409) { state.step = 1; renderStep(); }
    }
  }

  // Neue Gruppe anlegen; optional gleich die erste Person mit ihren Antworten.
  async function createGroup(name, firstMember = null) {
    const g = await api('/api/wahlomat/groups', { method: 'POST', body: { name } });
    const st = { adminToken: g.adminToken, members: {} };
    if (firstMember) {
      const r = await api(`/api/wahlomat/groups/${encodeURIComponent(g.id)}/members`, { method: 'POST', body: { name: firstMember.name, answers: encodeMember(firstMember) } });
      st.members[r.memberId] = r.token;
    }
    saveGroupStore(g.id, st);
    location.hash = groupPath(g.id);
  }

  function createGroupForm({ withMe = null } = {}) {
    const form = el(`<form class="wahlomat-join">
      <input type="text" name="group" maxlength="60" required placeholder="Gruppenname, z. B. Donnerstagsrunde" aria-label="Gruppenname">
      ${withMe ? `<input type="text" name="me" maxlength="40" required placeholder="Dein Name" aria-label="Dein Name" value="${esc(/^Person \d+$/.test(withMe.name) ? '' : withMe.name)}">` : ''}
      <button type="submit" class="btn btn-primary">Gruppe erstellen</button>
    </form>`);
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const btn = form.querySelector('button');
      btn.disabled = true;
      try {
        const name = form.group.value.trim();
        await createGroup(name, withMe ? { ...withMe, name: form.me.value.trim() } : null);
      } catch (e) { toast(e.message, 'err'); btn.disabled = false; }
    });
    return form;
  }

  function shareHash() {
    const qs = members.map((m) => `p=${encodeMember(m)}`).join('&');
    return `#/wahlomat${qs ? `?${qs}` : ''}`;
  }
  function syncUrl() {
    if (group) return;
    const hash = shareHash();
    if (location.hash !== hash) history.replaceState(null, '', hash);
  }

  async function share() {
    const url = `${location.origin}${location.pathname}${group ? groupPath(group.id) : shareHash()}`;
    const text = group ? `Mach mit beim RPG-Wahlomat der Gruppe „${group.name}“: Namen eintragen, Fragen beantworten – dann sehen wir, welches Spiel zu uns allen passt.` : 'Mein Ergebnis im RPG-Wahlomat';
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      try { await navigator.share({ title: 'RPG-Wahlomat', text, url }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    try {
      await navigator.clipboard.writeText(url);
      toast(group ? 'Gruppenlink kopiert – einfach an alle schicken.' : 'Link kopiert.');
    } catch {
      window.prompt('Link zum Kopieren:', url);
    }
  }

  function restart() {
    if (members.length > 1 && !window.confirm('Alle Antworten der Gruppe verwerfen und neu starten?')) return;
    members.length = 0;
    syncUrl();
    startQuiz();
  }

  function resultCard(g, rank, group) {
    const score = Math.round(g.score);
    const why = explain(g, members);
    const h = played.get(g.id);
    const langLabel = (l) => (l === 'de' ? 'Deutsch' : l === 'en' ? 'Englisch' : l || 'Sprache offen');
    const playedHtml = h
      ? `<span class="wahlomat-played">${h.count}× gespielt, zuletzt ${esc(fmtDay(h.last))}</span>`
      : '<span class="wahlomat-played is-new">noch nie gespielt</span>';
    const perPerson = group
      ? `<div class="tag-row">${members.map((m, j) => `<span class="badge">${esc(m.name)}: <strong>${Math.round(g.perPerson[j])}</strong></span>`).join('')}</div>`
      : '';
    const breakdown = group ? '' : `<details><summary>Punkteaufschlüsselung</summary><div class="tag-row" style="margin-top:var(--space-2)">${Object.entries(g.breakdown).map(([n, v]) => `<span class="badge">${esc(n)}: <strong>${v.toFixed(1)}</strong></span>`).join(' ')}</div></details>`;
    return `<article class="card wahlomat-result">
      <div class="wahlomat-result-top">
        <span class="faint">#${rank}</span>
        <div><h3><a href="#/spiele/${esc(g.id)}">${esc(g.title)}</a></h3><div class="muted" style="font-size:var(--text-xs)">${esc(g.system_family || '–')} · ${esc(langLabel(g.language))} · ${playedHtml}</div></div>
        <span class="badge badge-lang">${score}/100</span>
      </div>
      <div class="bar"><i style="width:${score}%"></i></div>
      ${why.good || why.warn ? `<p class="wahlomat-why">${why.good ? `<span class="is-good">✓ ${esc(why.good)}</span>` : ''}${why.warn ? `<span class="is-warn">△ ${esc(why.warn)}</span>` : ''}</p>` : ''}
      ${perPerson}
      <div class="wahlomat-more">
        <details class="wahlomat-radar" data-id="${esc(g.id)}"><summary>Profilvergleich</summary><div class="radar-slot"></div></details>
        ${breakdown}
      </div>
    </article>`;
  }

  // Personen-Leiste: Namen mit ✎/× und – je nach Modus – Mitmachen,
  // weitere Person am selben Gerät oder Gruppe erstellen.
  function membersPanel(multi) {
    const mine = members.filter(isMine).length;
    const people = members.length === 1 ? '1 Person' : `${members.length} Personen`;
    const intro = group
      ? (mine
        ? 'Schick den Gruppenlink an alle, die mitspielen. Wer ausgefüllt hat, erscheint hier – „Aktualisieren“ holt den neuesten Stand.'
        : 'Trag dich mit deinem Namen ein und beantworte die Fragen. Danach siehst du hier das gemeinsame Ergebnis.')
      : 'Spielt ihr zu mehreren? Erstellt eine Gruppe und schickt den Link herum: Jede:r trägt sich mit Namen ein und füllt aus, das Ergebnis sammelt sich automatisch.';
    const rule = multi ? ' Das Ranking verbindet alle Antworten: 60 % Durchschnitt, 40 % der schwächste Einzelwert – oben steht, womit alle gut leben können.' : '';
    const panel = el(`<div class="panel wahlomat-members">
      <div class="wahlomat-members-head">
        <strong>${group ? (members.length ? `${people} dabei` : 'Noch hat niemand ausgefüllt') : (multi ? `Gruppe · ${people}` : 'Als Gruppe spielen')}</strong>
        <p class="muted">${esc(intro + rule)}</p>
      </div>
      <div class="wahlomat-member-list"></div>
    </div>`);
    const list = panel.querySelector('.wahlomat-member-list');
    members.forEach((m, i) => {
      const canEdit = group ? isMine(m) : members.length === 1;
      const canRemove = group ? (isMine(m) || !!store.adminToken) : multi;
      const chip = el(`<span class="wahlomat-member${isMine(m) ? ' is-mine' : ''}"><span>${esc(m.name)}</span>
        ${canEdit ? `<button type="button" class="wahlomat-member-btn" data-act="edit" title="Antworten von ${esc(m.name)} ändern" aria-label="Antworten von ${esc(m.name)} ändern">✎</button>` : ''}
        ${canRemove ? `<button type="button" class="wahlomat-member-btn" data-act="remove" title="${esc(m.name)} entfernen" aria-label="${esc(m.name)} entfernen">×</button>` : ''}
      </span>`);
      chip.querySelector('[data-act=edit]')?.addEventListener('click', () => startQuiz(m, i));
      chip.querySelector('[data-act=remove]')?.addEventListener('click', async () => {
        if (!group) { members.splice(i, 1); renderResults(); return; }
        if (!window.confirm(`${m.name} aus der Gruppe entfernen?`)) return;
        try {
          await api(`/api/wahlomat/groups/${encodeURIComponent(group.id)}/members/${m.id}`, { method: 'DELETE', body: { token: store.members[m.id], adminToken: store.adminToken } });
          delete store.members[m.id];
          saveGroupStore(group.id, store);
          await reloadGroup();
          renderResults();
        } catch (e) { toast(e.message, 'err'); }
      });
      list.appendChild(chip);
    });
    if (group && !mine) {
      const join = el(`<form class="wahlomat-join">
        <input type="text" maxlength="40" required placeholder="Dein Name" aria-label="Dein Name">
        <button type="submit" class="btn btn-primary">Mitmachen</button>
      </form>`);
      join.addEventListener('submit', (ev) => {
        ev.preventDefault();
        const name = join.querySelector('input').value.trim();
        if (members.some((m) => m.name.toLowerCase() === name.toLowerCase())) { toast(`„${name}“ ist in dieser Gruppe schon vergeben – bitte einen anderen Namen wählen.`, 'err'); return; }
        startQuiz({ name });
      });
      panel.appendChild(join);
    } else if (group && members.length < 20) {
      const add = el('<button type="button" class="btn btn-sm">+ Weitere Person an diesem Gerät</button>');
      add.addEventListener('click', () => startQuiz());
      list.appendChild(add);
    } else if (!group && members.length === 1) {
      panel.appendChild(el('<p class="faint wahlomat-join-hint">Deine Antworten werden in die neue Gruppe übernommen.</p>'));
      panel.appendChild(createGroupForm({ withMe: members[0] }));
    }
    return panel;
  }

  function renderResults() {
    syncUrl();
    resumeWrap.innerHTML = '';
    const multi = members.length > 1;
    const results = members.length ? games.map((g) => scoreForGroup(g, members)).sort((a, b) => b.score - a.score) : [];
    let skippedNote = '';
    if (members.length === 1) {
      const skippedLabels = Object.entries(SCALAR_TO_PRIORITY).filter(([axis]) => members[0].profile[axis] == null)
        .map(([, key]) => PRIORITY_OPTIONS.find(([k]) => k === key)[1]);
      skippedNote = skippedLabels.length ? ` Nicht gewertet (als „Egal“ abgewählt): ${esc(skippedLabels.join(', '))}.` : '';
    }

    quizWrap.hidden = true;
    progress.hidden = true;
    resultsWrap.hidden = false;
    resultsWrap.innerHTML = '';

    const section = el(`<section>
      <div class="result-bar">
        <div><p class="eyebrow">${group ? 'Gruppenergebnis' : multi ? 'Gruppenergebnis' : 'Euer Ergebnis'}</p><h2>${members.length ? 'Passende Spiele' : 'Noch keine Antworten'}</h2></div>
        <div class="row-actions">
          <button type="button" class="btn btn-primary" id="wShare">${group ? 'Gruppenlink teilen' : 'Link teilen'}</button>
          ${group ? '<button type="button" class="btn" id="wReload">Aktualisieren</button>' : '<button type="button" class="btn" id="wRestart">Neu starten</button>'}
        </div>
      </div>
      <div id="wMembersSlot"></div>
      ${multi ? groupPicture(members) : ''}
      ${members.length ? `<div class="help-box">Bewertet wurden alle ${results.length} veröffentlichten Spiele aus dem Katalog.${skippedNote}</div>
      ${played.size ? '<label class="wahlomat-skip wahlomat-filter"><input type="checkbox" id="wUnplayed"> Nur Spiele, die noch nie am Tisch lagen</label>' : ''}
      <div class="wahlomat-results"></div>` : ''}
    </section>`);
    section.querySelector('#wMembersSlot').replaceWith(membersPanel(multi));

    const listWrap = section.querySelector('.wahlomat-results');
    const unplayed = section.querySelector('#wUnplayed');
    const renderList = () => {
      const shown = unplayed?.checked ? results.filter((g) => !played.has(g.id)) : results;
      listWrap.innerHTML = shown.map((g, i) => resultCard(g, i + 1, multi)).join('') || '<p class="muted">Alle passenden Spiele lagen schon am Tisch.</p>';
      // Das Netzdiagramm entsteht erst beim Aufklappen.
      listWrap.querySelectorAll('details.wahlomat-radar').forEach((d) => d.addEventListener('toggle', () => {
        if (!d.open || d.dataset.ready) return;
        d.dataset.ready = '1';
        const g = gamesById.get(d.dataset.id);
        d.querySelector('.radar-slot').innerHTML = `<div class="radar-wrap">${radarSvg(g, members)}
          <div class="radar-legend"><span><i class="lg-game"></i>${esc(g.title)}</span><span><i class="lg-wish"></i>${multi ? 'Gruppe (Ø)' : 'Euer Wunsch'}</span></div>
          ${radarTable(g, members)}</div>`;
      }));
    };
    if (listWrap) { unplayed?.addEventListener('change', renderList); renderList(); }

    section.querySelector('#wShare').addEventListener('click', share);
    section.querySelector('#wRestart')?.addEventListener('click', restart);
    section.querySelector('#wReload')?.addEventListener('click', async (ev) => {
      ev.target.disabled = true;
      try { await reloadGroup(); renderResults(); toast('Auf dem neuesten Stand.'); } catch (e) { toast(e.message, 'err'); ev.target.disabled = false; }
    });
    resultsWrap.appendChild(section);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // Gruppe: immer erst die Gruppenansicht (Mitmachen bzw. Ergebnis).
  if (group || members.length) { renderResults(); return; }

  // Ohne Link: Gruppe erstellen anbieten und frühere Antworten aus diesem Browser.
  let saved = null;
  try { saved = decodeMember(localStorage.getItem(STORAGE_KEY)); } catch { /* privat/gesperrt */ }
  startQuiz();
  const groupBox = el(`<details class="panel wahlomat-start-group">
    <summary><strong>Als Gruppe spielen?</strong> <span class="muted">Gruppe erstellen, Link verschicken – jede:r trägt sich mit Namen ein und füllt aus.</span></summary>
  </details>`);
  groupBox.appendChild(createGroupForm());
  resumeWrap.appendChild(groupBox);
  if (saved) {
    const box = el(`<div class="help-box wahlomat-resume">
      <span>Du hast den Wahlomat hier schon einmal ausgefüllt${saved.name ? ` (als ${esc(saved.name)})` : ''}.</span>
      <span class="row-actions"><button type="button" class="btn btn-sm btn-primary">Letztes Ergebnis ansehen</button><button type="button" class="btn btn-sm">Antworten bearbeiten</button></span>
    </div>`);
    const [showBtn, editBtn] = box.querySelectorAll('button');
    showBtn.addEventListener('click', () => { members.push({ ...saved, name: saved.name || 'Person 1' }); renderResults(); });
    editBtn.addEventListener('click', () => startQuiz(saved, 0));
    resumeWrap.appendChild(box);
  }
}
