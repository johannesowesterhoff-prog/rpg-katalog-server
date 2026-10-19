// Kleine Hilfsfunktionen und wiederverwendbare Bausteine.
export const el = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const dec = (v) => (v == null ? null : String(v).replace('.', ','));
export const fmtScale = (v) => (v == null ? '–' : String(Number(v)).replace('.', ','));

export const SCALE_HELP = {
  crunch: 'Crunch = Regeldichte: wie viele und wie detaillierte Regeln das Spiel nutzt.',
  narrative: 'Narrativ = Erzählmechanik: wie stark Regeln das Erzählen und die Fiktion steuern.',
  fluff: 'Fluff = Ausarbeitungsgrad der gesamten offiziell veröffentlichten Spielwelt – unabhängig davon, was davon im Regal steht.',
};
export const SCALE_LABELS = {
  crunch: ['1 = sehr regelleicht', '2 = leicht', '3 = mittel', '4 = regelreich', '5 = Regelsimulation'],
  narrative: ['1 = klassisch simulativ', '2 = wenig Erzählmechanik', '3 = ausgewogen', '4 = erzählmechanisch stark', '5 = durchgehend narrativ'],
  fluff: ['1 = kaum Weltmaterial', '2 = knappe Welt', '3 = solide ausgearbeitet', '4 = umfangreiche Welt', '5 = enzyklopädisch'],
};

export function toast(message, kind = 'ok') {
  const box = document.getElementById('toasts');
  const t = el(`<div class="toast ${kind === 'err' ? 'err' : ''}">${esc(message)}</div>`);
  box.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, kind === 'err' ? 6000 : 3500);
}

export function dots(v) {
  if (v == null) return '<div class="scale-dots">' + '<i></i>'.repeat(5) + '</div>';
  let out = '';
  for (let i = 1; i <= 5; i++) out += `<i class="${v >= i ? 'on' : (v >= i - 0.5 ? 'half' : '')}"></i>`;
  return `<div class="scale-dots">${out}</div>`;
}

export function scaleBadges(g) {
  const one = (key, label) => {
    const v = g[key];
    return `<div class="scale ${v == null ? 'scale-empty' : ''}" title="${esc(SCALE_HELP[key])}">
      <span class="scale-name">${label}</span>
      <span class="scale-value">${fmtScale(v)}</span>
      ${dots(v)}
    </div>`;
  };
  return `<div class="scale-badges">${one('crunch', 'Crunch')}${one('narrative', 'Narrativ')}${one('fluff', 'Fluff')}</div>`;
}

export const STATUS_LABEL = { published: 'Veröffentlicht', draft: 'Entwurf', archived: 'Archiviert' };
// Spielform eines Spielabends (Feld play_mode).
export const PLAY_MODE_LABEL = { 'am-tisch': 'Am Tisch', online: 'Online' };
export const CAMPAIGN_KIND_LABEL = {
  'one-shot': 'One-Shot (Two-Shot)',
  'few-shot': 'Few-Shot',
  kampagne: 'Kampagne',
  'epische-kampagne': 'Epische Kampagne',
  'sandbox-szenarien': 'Sandbox-Szenarien',
};

// Bildet das Label "Kampagne (Art) · Session N[/M]" für einen Spielabend
// innerhalb einer Gruppe (gleiche Kampagne). Eine manuell gesetzte
// session_number ersetzt die chronologisch ermittelte Position -- z.B. um
// eine bereits vor dem Protokoll begonnene Zählung fortzuführen. Das "/M"
// steht bei laufenden und abgeschlossenen Kampagnen; M ist die bisherige
// Gesamtzahl (höchste vergebene Nummer bzw. Anzahl protokollierter Sessions)
// und wächst bei laufenden Kampagnen mit jedem neuen Abend mit.
// Der Status gilt für die ganze Kampagne und kommt vom neuesten Spielabend:
// Wird nur der letzte Abend auf "abgeschlossen" gesetzt, zeigen auch die
// früheren Abende "abgeschlossen" und "Session x/M".
export function campaignSessionParts(s, group) {
  if (!s.campaign) return null;
  const sorted = [...group].sort((a, b) => a.played_on.localeCompare(b.played_on) || ((a.session_number ?? 0) - (b.session_number ?? 0)));
  const idx = s.session_number ?? (sorted.indexOf(s) + 1);
  const closed = (sorted.at(-1) || s).campaign_status === 'abgeschlossen';
  const numbered = sorted.filter((x) => x.session_number != null).map((x) => x.session_number);
  const total = Math.max(sorted.length, idx, ...numbered);
  return {
    name: s.campaign,
    kindLabel: CAMPAIGN_KIND_LABEL[s.campaign_kind] || null,
    statusLabel: closed ? 'abgeschlossen' : 'laufend',
    sessionLabel: `Session ${idx}/${total}`,
    announcementUrl: s.campaign_announcement_url || null,
  };
}

// URL-Schlüssel aus Kampagnenname und Spiel. Gleichnamige Kampagnen
// verschiedener Spiele bleiben so getrennt, ohne dass man alle Kampagnen
// kennen muss, um einen Link zu bauen.
export function slugify(v) {
  return String(v || '').toLowerCase().replace(/['’]/g, '')
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
export function campaignId(s) { return `${slugify(s.campaign)}--${slugify(s.slug || s.title)}`; }
export function campaignHref(s) { return `#/statistik/kampagnen/${campaignId(s)}`; }

export function campaignSessionLabel(s, group) {
  const p = campaignSessionParts(s, group);
  if (!p) return null;
  return `${esc(p.name)}${p.kindLabel ? ` (${p.kindLabel})` : ''} · ${p.sessionLabel}`;
}

// Kompakte Badge-Darstellung: Name als Link zur Kampagnenseite (href) oder
// als Link-Button (für Klick-Filter),
// darunter kleine Tags für Kampagnenart/-status/Session-Zähler.
export function campaignSessionBadges(s, group, { onNameClick, href } = {}) {
  const p = campaignSessionParts(s, group);
  if (!p) return null;
  const nameHtml = href ? `<a href="${esc(href)}" class="campaign-name-link">${esc(p.name)}</a>`
    : onNameClick ? `<button type="button" class="link-btn" id="cn-name">${esc(p.name)}</button>` : `<b>${esc(p.name)}</b>`;
  const wrap = el(`<div class="campaign-badges">
    ${nameHtml}
    <div class="tag-row">
      ${p.kindLabel ? `<span class="tag">${esc(p.kindLabel)}</span>` : ''}
      <span class="tag">${esc(p.statusLabel)}</span>
      <span class="tag">${esc(p.sessionLabel)}</span>
      ${p.announcementUrl ? `<a href="${esc(p.announcementUrl)}" target="_blank" rel="noopener" class="tag tag-link">Aushang ↗</a>` : ''}
    </div>
  </div>`);
  if (onNameClick) wrap.querySelector('#cn-name').addEventListener('click', onNameClick);
  return wrap;
}

export const BINDING_LABEL = { hardcover: 'Hardcover', softcover: 'Softcover', heft: 'Heft', faltblatt: 'Faltblatt', box: 'Box', zubehoer: 'Spielhilfe & Zubehör', sonstiges: 'Sonstiges' };

/** Öffentliche Katalogkarte – Reihenfolge exakt wie im Auftrag. */
// ------------------------------------------------------------ Coverbilder
// Alle Cover erscheinen im selben Rahmen (Seitenverhältnis --cover-ratio).
// "cover" füllt den Rahmen und schneidet zu (vertikaler Ausschnitt über
// focus_y), "contain" zeigt das ganze Bild auf ruhigem Grund in der
// Kartenfarbe. "auto" wählt: Hochformat → ganz zeigen, sonst füllen.
export const COVER_FIT_LABEL = { auto: 'Automatisch', cover: 'Rahmen füllen (zuschneiden)', contain: 'Ganzes Bild zeigen' };
const PORTRAIT_LIMIT = 1.15;

export function coverUrl(slug, cover) {
  return `/api/games/${encodeURIComponent(slug)}/cover?v=${cover.v}`;
}

function resolveFit(c) {
  if (c.fit && c.fit !== 'auto') return c.fit;
  if (!c.w || !c.h) return 'auto';
  return c.w / c.h < PORTRAIT_LIMIT ? 'contain' : 'cover';
}

export function coverFrame(g, { src } = {}) {
  const c = g.cover;
  if (!c) return `<div class="cover-frame cover-empty" aria-hidden="true"><span>${esc(g.title)}</span></div>`;
  const url = src || coverUrl(g.slug, c);
  return `<div class="cover-frame fit-${resolveFit(c)}" style="--focus-y:${Number(c.y ?? 50)}%">
    <img class="cover-bg" src="${esc(url)}" alt="" aria-hidden="true" loading="lazy" decoding="async">
    <img class="cover-img" src="${esc(url)}" alt="Cover: ${esc(g.title)}" data-title="${esc(g.title)}" loading="lazy" decoding="async">
  </div>`;
}

// load/error blubbern nicht -- daher einmalig in der Capture-Phase lauschen.
document.addEventListener('load', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.classList.contains('cover-img')) return;
  const frame = img.closest('.cover-frame.fit-auto');
  if (!frame || !img.naturalHeight) return;
  frame.classList.replace('fit-auto', img.naturalWidth / img.naturalHeight < PORTRAIT_LIMIT ? 'fit-contain' : 'fit-cover');
}, true);
document.addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.classList.contains('cover-img')) return;
  const frame = img.closest('.cover-frame');
  if (!frame) return;
  frame.className = 'cover-frame cover-empty';
  frame.innerHTML = `<span>${esc(img.dataset.title || '')}</span>`;
}, true);

export function gameCard(g, { onTag, onToneTag, showStatus = false } = {}) {
  const tags = (g.genre_setting_top || []).map((t) => `<button class="tag" data-tag="${esc(t)}" type="button">${esc(t)}</button>`).join('');
  const toneTags = (g.tone_theme_top || []).map((t) => `<button class="tag tag-tone" data-tone="${esc(t)}" type="button">${esc(t)}</button>`).join('');
  const card = el(`<article class="card game-card">
    <a class="gc-cover" href="#/spiele/${esc(g.slug)}" tabindex="-1" aria-hidden="true">${coverFrame(g)}</a>
    <div>
      <div class="gc-title">
        <h3><a href="#/spiele/${esc(g.slug)}">${esc(g.title)}</a></h3>
        <span class="badge badge-lang">${esc(g.language_code || '')}</span>
      </div>
      <div class="gc-system">${esc(g.system_family || '')}</div>
      ${showStatus ? `<div style="margin-top:.35rem"><span class="badge badge-status ${g.status}">${STATUS_LABEL[g.status] || g.status}</span></div>` : ''}
    </div>
    <p class="gc-desc">${esc(g.short_description)}</p>
    <div class="tag-row">${tags}</div>
    ${toneTags ? `<div class="tag-row tag-row-tone">${toneTags}</div>` : ''}
    ${scaleBadges(g)}
    <div class="gc-meta">
      <div><span>Sub Genre</span><span>${esc((g.genre_setting || []).join(' · ') || '–')}</span></div>
      <div><span>Sub Tone</span><span>${esc((g.tone_theme || []).join(' · ') || '–')}</span></div>
      <div><span>Spielfokus</span><span>${esc((g.play_focus || []).join(' · ') || '–')}</span></div>
      <div><span>Kampagnenart</span><span>${esc((g.campaign_type || []).join(' · ') || '–')}</span></div>
      <div><span>Verlag</span><span>${esc(g.primary_publisher || '–')}</span></div>
    </div>
    <div class="gc-foot">
      <div class="gc-foot-counts">
        <span>${g.product_count === 1 ? '1 Produkt' : `${g.product_count || 0} Produkte`}</span>
        ${g.session_count ? `<span>${g.session_count === 1 ? '1 Spielabend' : `${g.session_count} Spielabende`}</span>` : ''}
      </div>
      <a href="#/spiele/${esc(g.slug)}">Details →</a>
    </div>
  </article>`);
  if (onTag) card.querySelectorAll('[data-tag]').forEach((b) => b.addEventListener('click', () => onTag(b.dataset.tag)));
  if (onToneTag) card.querySelectorAll('[data-tone]').forEach((b) => b.addEventListener('click', () => onToneTag(b.dataset.tone)));
  return card;
}

export function skeletonGrid(n = 6) {
  return el(`<div class="card-grid">${'<div class="skeleton"></div>'.repeat(n)}</div>`);
}

export function emptyState(title, text, actionHtml = '') {
  return el(`<div class="empty"><h3>${esc(title)}</h3><p class="muted">${esc(text)}</p>${actionHtml}</div>`);
}

export function fmtDate(v) {
  if (!v) return '–';
  const d = new Date(v);
  return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Autocomplete-Feld mit freier Eingabe (neue Werte anlegbar). */
export function autocomplete({ value = '', options = [], placeholder = '', onChange, id }) {
  const wrap = el(`<div class="autocomplete">
    <input type="text" ${id ? `id="${id}"` : ''} value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off">
  </div>`);
  const input = wrap.querySelector('input');
  let list = null;
  const close = () => { list?.remove(); list = null; };
  const open = () => {
    close();
    const q = input.value.trim().toLowerCase();
    const hits = options.filter((o) => o.toLowerCase().includes(q));
    if (!hits.length) return;
    list = el(`<div class="ac-list">${hits.map((h) => `<button type="button">${esc(h)}</button>`).join('')}</div>`);
    list.querySelectorAll('button').forEach((b, i) => b.addEventListener('mousedown', (ev) => {
      ev.preventDefault(); input.value = hits[i]; close(); onChange?.(hits[i]);
    }));
    wrap.appendChild(list);
  };
  input.addEventListener('input', () => { open(); onChange?.(input.value); });
  input.addEventListener('focus', open);
  input.addEventListener('blur', () => setTimeout(close, 120));
  return { wrap, input, get value() { return input.value.trim(); } };
}

/** Mehrfachauswahl mit Autocomplete (Tags, Verlage). */
export function multiSelect({ values = [], options = [], placeholder = '', onChange }) {
  const wrap = el('<div><div class="chosen"></div></div>');
  const chosen = wrap.querySelector('.chosen');
  const list = [...(values || [])];
  const render = () => {
    chosen.innerHTML = '';
    if (!list.length) chosen.appendChild(el('<span class="faint" style="font-size:var(--text-xs)">Noch nichts ausgewählt</span>'));
    list.forEach((v, i) => {
      const chip = el(`<button type="button" class="chip">${esc(v)} <span aria-hidden="true">×</span></button>`);
      chip.title = `„${v}“ entfernen`;
      chip.addEventListener('click', () => { list.splice(i, 1); render(); onChange?.([...list]); });
      chosen.appendChild(chip);
    });
  };
  const ac = autocomplete({ options, placeholder });
  const add = () => {
    const v = ac.input.value.trim();
    if (!v) return;
    if (!list.some((x) => x.toLowerCase() === v.toLowerCase())) list.push(v);
    ac.input.value = ''; render(); onChange?.([...list]);
  };
  ac.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  const row = el('<div style="display:flex;gap:.4rem;align-items:flex-start"></div>');
  ac.wrap.style.flex = '1';
  row.appendChild(ac.wrap);
  const btn = el('<button type="button" class="btn btn-sm">Hinzufügen</button>');
  btn.addEventListener('click', add);
  row.appendChild(btn);
  wrap.appendChild(row);
  render();
  return { wrap, get values() { return [...list]; } };
}

export function confirmDialog(text) { return window.confirm(text); }
