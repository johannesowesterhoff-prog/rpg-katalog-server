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

/** Öffentliche Katalogkarte – Reihenfolge exakt wie im Auftrag. */
export function gameCard(g, { onTag, showStatus = false } = {}) {
  const tags = (g.genre_setting_top || []).map((t) => `<button class="tag" data-tag="${esc(t)}" type="button">${esc(t)}</button>`).join('');
  const card = el(`<article class="card game-card">
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
    ${scaleBadges(g)}
    <div class="gc-meta">
      <div><span>Sub Genre</span><span>${esc((g.genre_setting || []).join(' · ') || '–')}</span></div>
      <div><span>Top Tone</span><span>${esc((g.tone_theme_top || []).join(' · ') || '–')}</span></div>
      <div><span>Sub Tone</span><span>${esc((g.tone_theme || []).join(' · ') || '–')}</span></div>
      <div><span>Spielfokus</span><span>${esc((g.play_focus || []).join(' · ') || '–')}</span></div>
      <div><span>Kampagnenart</span><span>${esc((g.campaign_type || []).join(' · ') || '–')}</span></div>
      <div><span>Verlag</span><span>${esc(g.primary_publisher || '–')}</span></div>
    </div>
    <div class="gc-foot">
      <span>${g.product_count === 1 ? '1 Produkt' : `${g.product_count || 0} Produkte`}</span>
      <a href="#/spiele/${esc(g.slug)}">Details →</a>
    </div>
  </article>`);
  if (onTag) card.querySelectorAll('[data-tag]').forEach((b) => b.addEventListener('click', () => onTag(b.dataset.tag)));
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
    const hits = options.filter((o) => o.toLowerCase().includes(q)).slice(0, 8);
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
