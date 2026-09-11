// Detailseite eines Spiels: Einordnung, Produkte, Skalen, ähnliche Spiele.
import { api } from './api.js';
import { el, esc, fmtScale, gameCard, emptyState, toast, SCALE_HELP, SCALE_LABELS, STATUS_LABEL } from './ui.js';

const BINDING_LABEL = { hardcover: 'Hardcover', softcover: 'Softcover', box: 'Box', heft: 'Heft', kartenset: 'Kartenset', pdf: 'PDF', schirm: 'Spielleiterschirm', trifold: 'Trifold', sonstiges: 'Sonstiges' };

export async function renderDetail(root, slug, ctx) {
  root.innerHTML = '<div class="catalog-head"><div class="skeleton" style="height:120px"></div></div>';
  let data;
  try {
    data = await api('/api/games/' + encodeURIComponent(slug));
  } catch (e) {
    root.innerHTML = '';
    root.appendChild(emptyState(e.status === 404 ? 'Eintrag nicht gefunden' : 'Fehler beim Laden',
      e.status === 404 ? 'Dieser Eintrag existiert nicht oder ist nicht veröffentlicht.' : e.message,
      '<p><a class="btn btn-sm" href="#/">Zurück zum Katalog</a></p>'));
    return;
  }
  const g = data.game;
  document.title = `${g.title} – RPG-Katalog`;
  root.innerHTML = '';

  const head = el(`<section class="detail-head">
    <div class="crumb"><a href="#/">Katalog</a> <span class="faint">/</span> ${esc(g.title)}</div>
    <div class="detail-title-row">
      <h1>${esc(g.title)}</h1>
      <span class="badge badge-lang">${esc(g.language_code)}</span>
      ${g.status !== 'published' ? `<span class="badge badge-status ${g.status}">${STATUS_LABEL[g.status]}</span>` : ''}
    </div>
    ${g.original_title ? `<p class="muted" style="margin-top:.4rem">Originaltitel: ${esc(g.original_title)}</p>` : ''}
    <p class="lede muted" style="margin-top:.6rem;max-width:70ch">${esc(g.short_description)}</p>
    <div class="row-actions" style="margin-top:var(--space-4)">
      <button type="button" class="btn btn-sm" id="share">Link kopieren</button>
      <a class="btn btn-sm btn-ghost" href="#/?systemFamily=${encodeURIComponent(g.system_family)}">Mehr aus dieser Systemfamilie</a>
    </div>
  </section>`);
  head.querySelector('#share').addEventListener('click', async () => {
    const url = location.origin + location.pathname + '#/spiele/' + g.slug;
    try { await navigator.clipboard.writeText(url); toast('Link kopiert.'); }
    catch { toast('Link: ' + url); }
  });
  root.appendChild(head);

  const scaleRow = (key, label) => {
    const v = g[key];
    const pct = v == null ? 0 : ((v - 1) / 4) * 100;
    return `<div class="row">
      <span class="muted" title="${esc(SCALE_HELP[key])}">${label}</span>
      <span class="bar"><i style="width:${pct}%"></i></span>
      <b style="font-family:var(--font-display)">${fmtScale(v)}${v == null ? '' : ' / 5'}</b>
    </div>
    <p class="faint" style="font-size:var(--text-xs);margin:-.4rem 0 .2rem">${v == null ? 'Noch nicht bewertet.' : esc(scaleLabel(key, v))}</p>`;
  };

  const products = g.products || [];
  const layout = el(`<div class="detail-layout">
    <div>
      <section class="section">
        <h2>Einordnung der drei Skalen</h2>
        <div class="scale-detail">${scaleRow('crunch', 'Crunch')}${scaleRow('narrative', 'Narrativ')}${scaleRow('fluff', 'Fluff')}</div>
        <p class="faint" style="font-size:var(--text-xs);margin-top:var(--space-3)">
          Crunch = Regeldichte · Narrativ = Erzählmechanik · Fluff = Ausarbeitungsgrad der gesamten offiziell veröffentlichten Spielwelt (unabhängig vom eigenen Bestand).
        </p>
      </section>

      ${g.long_description ? `<section class="section"><h2>Beschreibung</h2><p>${esc(g.long_description)}</p></section>` : ''}

      <section class="section">
        <h2>Vorhandene Produkte (${products.length})</h2>
        ${products.length ? `<div class="scroll-x"><table>
          <thead><tr><th>Titel</th><th>Typ</th><th>Format</th><th>Edition</th><th>Sprache</th></tr></thead>
          <tbody>${products.map((p) => `<tr>
            <td>${esc(p.title)}</td>
            <td>${esc(p.product_type)}</td>
            <td>${esc(BINDING_LABEL[p.binding] || '–')}</td>
            <td>${esc(p.edition || '–')}</td>
            <td>${esc((p.language || g.language_code).toUpperCase())}</td>
          </tr>`).join('')}</tbody></table></div>`
      : '<p class="muted">Für dieses Spiel ist derzeit kein Produkt im Bestand erfasst.</p>'}
      </section>
    </div>

    <aside>
      <div class="panel section">
        <h2 style="font-size:var(--text-sm);font-family:var(--font-body);text-transform:uppercase;letter-spacing:.07em;color:var(--text-faint);margin-bottom:var(--space-4)">Stammdaten</h2>
        <dl class="dl">
          <dt>Systemfamilie</dt><dd><a href="#/?systemFamily=${encodeURIComponent(g.system_family)}">${esc(g.system_family)}</a></dd>
          <dt>Verlag</dt><dd>${(g.publishers || []).map((p) => `<a href="#/?publisher=${encodeURIComponent(p.name)}">${esc(p.name)}</a>${p.is_primary && g.publishers.length > 1 ? ' <span class="faint">(Haupt)</span>' : ''}`).join(', ') || '–'}</dd>
          <dt>Sprache</dt><dd>${esc(g.language_label || g.language_code)}</dd>
          ${g.edition ? `<dt>Edition</dt><dd>${esc(g.edition)}</dd>` : ''}
          ${g.release_year ? `<dt>Jahr</dt><dd>${g.release_year}</dd>` : ''}
          <dt>Top Genre / Setting</dt><dd class="tag-row">${(g.genre_setting_top || []).map((t) => `<a class="tag" href="#/?genreTop=${encodeURIComponent(t)}">${esc(t)}</a>`).join('') || '–'}</dd>
          <dt>Sub Genre / Setting</dt><dd class="tag-row">${(g.genre_setting || []).map((t) => `<a class="tag" href="#/?genre=${encodeURIComponent(t)}">${esc(t)}</a>`).join('') || '–'}</dd>
          <dt>Top Tone / Themen</dt><dd class="tag-row">${(g.tone_theme_top || []).map((t) => `<a class="tag" href="#/?toneTop=${encodeURIComponent(t)}">${esc(t)}</a>`).join('') || '–'}</dd>
          <dt>Sub Tone / Themen</dt><dd class="tag-row">${(g.tone_theme || []).map((t) => `<a class="tag" href="#/?tone=${encodeURIComponent(t)}">${esc(t)}</a>`).join('') || '–'}</dd>
          <dt>Spielfokus</dt><dd class="tag-row">${(g.play_focus || []).map((t) => `<a class="tag" href="#/?focus=${encodeURIComponent(t)}">${esc(t)}</a>`).join('') || '–'}</dd>
          <dt>Kampagnenart</dt><dd class="tag-row">${(g.campaign_type || []).map((t) => `<a class="tag" href="#/?campaign=${encodeURIComponent(t)}">${esc(t)}</a>`).join('') || '–'}</dd>
        </dl>
      </div>
    </aside>
  </div>`);
  root.appendChild(layout);

  if (data.similar?.length) {
    const sec = el('<section class="section"><h2>Ähnliche Spiele</h2><div class="similar-grid"></div></section>');
    const grid = sec.querySelector('.similar-grid');
    data.similar.forEach((sg) => grid.appendChild(gameCard(sg)));
    root.appendChild(sec);
  }
  if (ctx?.isAdmin) {
    root.appendChild(el(`<p><a class="btn btn-sm" href="#/admin/editor/${g.id}">Diesen Eintrag im Adminbereich bearbeiten</a></p>`));
  }
}

function scaleLabel(key, v) {
  const raw = SCALE_LABELS[key][Math.round(v) - 1] || '';
  if (Number.isInteger(v)) return raw;
  return 'etwa ' + raw.replace(/^\d+\s*=\s*/, '');
}
