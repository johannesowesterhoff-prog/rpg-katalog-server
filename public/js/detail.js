// Detailseite eines Spiels: Einordnung, Produkte, Skalen, ähnliche Spiele.
import { api, setArchiveToken, hasArchiveToken, hasToken } from './api.js';
import { el, esc, fmtScale, gameCard, emptyState, toast, SCALE_HELP, SCALE_LABELS, STATUS_LABEL, BINDING_LABEL, PLAY_MODE_LABEL, campaignSessionBadges, campaignHref, coverUrl } from './ui.js';

// Deep-Link-Ziel im privaten "Schwarzen Regal" (separate PDF-Datenbank,
// siehe handoff_archive_link.md). Format: #<archive_slug> -- das Regal läuft in
// einem Rahmen, der nur einfache Anker ohne "=" durchreicht.
const ARCHIVE_URL = 'https://claude.ai/artifact/T9PsrHThnX4oiZU6CnYSdm';

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

  const head = el(`<section class="detail-head${g.cover ? ' has-cover' : ''}">
    <div>
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
    </div>
    ${g.cover ? `<img class="detail-cover" src="${esc(coverUrl(g.slug, g.cover))}" alt="Cover: ${esc(g.title)}"${g.cover.w && g.cover.h ? ` width="${Number(g.cover.w)}" height="${Number(g.cover.h)}" style="aspect-ratio:${Number(g.cover.w)}/${Number(g.cover.h)}"` : ''}>` : ''}
  </section>`);
  head.querySelector('.detail-cover')?.addEventListener('error', (e) => { e.target.remove(); head.classList.remove('has-cover'); });
  head.querySelector('#share').addEventListener('click', async () => {
    // Pfad-Link statt #-Link: Nur der liefert dem Server den Spieltitel und
    // das Cover für Link-Vorschauen.
    const url = location.origin + '/spiele/' + g.slug;
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
  const sessions = g.play_sessions || [];
  const showCampaign = sessions.some((s) => s.campaign != null);
  // Öffentlich ist alles außer den Notizen; die gibt es nur im Adminbereich.
  const ROLE_LABEL = { spielleiter: 'Spielleiter:in', spieler: 'Spieler:in' };
  const summaryLink = (s) => (s.summary_url ? `<a href="${esc(s.summary_url)}" target="_blank" rel="noopener" class="tag tag-link">Zusammenfassung ↗</a>` : '');
  const fmtDateOnly = (v) => (v ? new Date(v).toLocaleDateString('de-DE') : '–');
  const layout = el(`<div class="detail-layout">
    <div>
      <section class="section">
        <h2>Einordnung der drei Skalen</h2>
        <div class="scale-detail">${scaleRow('crunch', 'Crunch')}${scaleRow('narrative', 'Narrativ')}${scaleRow('fluff', 'Fluff')}</div>
        <details class="scale-info"><summary>ⓘ Was bedeuten die Skalen?</summary>
          <p><strong>Crunch</strong> = Detailgrad der Regeln (was mechanisch simuliert wird) · <strong>Narrativ</strong> = Erzählmechanik (wie stark die Regeln narratives Spielen unterstützen) · <strong>Fluff</strong> = Ausarbeitung der Spielwelt (wie viel Lore es gibt, über alle offiziellen Veröffentlichungen – unabhängig vom eigenen Bestand).</p>
        </details>
      </section>

      ${g.long_description ? `<section class="section"><h2>Beschreibung</h2><p>${esc(g.long_description)}</p></section>` : ''}

      <section class="section">
        <h2>Vorhandene Produkte (${products.length})</h2>
        ${products.length ? `<div class="scroll-x"><table>
          <thead><tr><th>Titel</th><th>Typ</th><th>Format</th><th>Be- &amp; Anmerkungen</th><th>Sprache</th><th>ISBN</th></tr></thead>
          <tbody>${products.map((p) => `<tr>
            <td>${esc(p.title)}</td>
            <td>${esc(p.product_type)}</td>
            <td>${esc(BINDING_LABEL[p.binding] || '–')}</td>
            <td>${esc(p.edition || '–')}</td>
            <td>${esc((p.language || g.language_code).toUpperCase())}</td>
            <td>${esc(p.isbn || '–')}</td>
          </tr>`).join('')}</tbody></table></div>`
      : '<p class="muted">Für dieses Spiel ist derzeit kein Produkt im Bestand erfasst.</p>'}
      </section>

      <section class="section">
        <h2>Spielabende (${sessions.length})</h2>
        ${sessions.length ? `<div class="scroll-x"><table class="cards-on-mobile">
          <thead><tr><th>Datum</th>${showCampaign ? '<th>Kampagne</th>' : ''}<th>Mitspieler:innen</th><th>Spielform</th><th>Rolle</th><th>Zusammenfassung</th></tr></thead>
          <tbody>${sessions.map((s) => `<tr>
            <td data-label="Datum" class="card-title-cell">${esc(fmtDateOnly(s.played_on))}</td>
            ${showCampaign ? '<td data-label="Kampagne" class="session-campaign-cell">–</td>' : ''}
            <td data-label="Mitspieler:innen">${esc(s.participants || '–')}</td>
            <td data-label="Spielform">${esc(PLAY_MODE_LABEL[s.play_mode] || '–')}</td>
            <td data-label="Rolle">${esc(ROLE_LABEL[s.role] || '–')}</td>
            <td data-label="Zusammenfassung">${summaryLink(s) || '–'}</td>
          </tr>`).join('')}</tbody></table></div>`
      : '<p class="muted">Für dieses Spiel ist noch kein Spielabend protokolliert.</p>'}
      </section>
    </div>

    <aside>
      <div class="panel section">
        <h2 style="font-size:var(--text-sm);font-family:var(--font-body);text-transform:uppercase;letter-spacing:.07em;color:var(--text-faint);margin-bottom:var(--space-4)">Stammdaten</h2>
        <dl class="dl">
          <dt>Systemfamilie</dt><dd><a href="#/?systemFamily=${encodeURIComponent(g.system_family)}">${esc(g.system_family)}</a></dd>
          <dt>Verlag</dt><dd>${(g.publishers || []).map((p) => `<a href="#/?publisher=${encodeURIComponent(p.name)}">${esc(p.name)}</a>${/^https?:\/\//.test(p.website || '') ? ` <a class="faint" href="${esc(p.website)}" target="_blank" rel="noopener" title="Webseite von ${esc(p.name)}" aria-label="Webseite von ${esc(p.name)}">↗</a>` : ''}${p.is_primary && g.publishers.length > 1 ? ' <span class="faint">(Haupt)</span>' : ''}`).join(', ') || '–'}</dd>
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

      <div class="panel section">
        <h2 style="font-size:var(--text-sm);font-family:var(--font-body);text-transform:uppercase;letter-spacing:.07em;color:var(--text-faint);margin-bottom:var(--space-4)">Schwarzes Regal</h2>
        <div id="archive-panel"><p class="faint" style="font-size:var(--text-xs)">Lädt …</p></div>
      </div>
    </aside>
  </div>`);
  if (showCampaign) {
    layout.querySelectorAll('.session-campaign-cell').forEach((cell, i) => {
      const s = sessions[i];
      const badges = campaignSessionBadges(s, sessions.filter((x) => x.campaign === s.campaign), { href: campaignHref({ ...s, slug: g.slug }) });
      if (badges) { cell.textContent = ''; cell.appendChild(badges); }
    });
  }
  root.appendChild(layout);
  renderArchivePanel(layout.querySelector('#archive-panel'), g.slug, ctx);

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

// -------------------------------------------------------- Schwarzes Regal
// Privater, passwortgeschützter Deep-Link zur separaten PDF-Datenbank
// "Schwarzes Regal" (siehe handoff_archive_link.md). archive_slug wird nie
// in der öffentlichen /api/games/:slug-Antwort mitgeliefert -- diese eigene,
// separat authentifizierte Route ist die einzige Quelle dafür.
async function renderArchivePanel(container, slug, ctx) {
  // Ohne Sitzung (laut /api/admin/session) und ohne Token im Speicher gleich
  // das Passwortfeld zeigen -- vorher lief bei jedem Besuch eine Abfrage, die
  // für normale Besucher:innen immer mit 401 endete.
  if (!(ctx?.isAdmin || ctx?.hasArchiveAccess || hasArchiveToken() || hasToken())) return renderArchiveLocked(container, slug, ctx);
  let data;
  try {
    data = await api(`/api/games/${encodeURIComponent(slug)}/archive-link`);
  } catch (e) {
    if (e.status === 401) return renderArchiveLocked(container, slug, ctx);
    container.innerHTML = '';
    return;
  }
  renderArchiveUnlocked(container, data);
}

function renderArchiveUnlocked(container, data) {
  container.innerHTML = '';
  if (!data.archive_slug) {
    container.appendChild(el('<p class="faint" style="font-size:var(--text-xs)">Kein Eintrag im Schwarzen Regal gefunden.</p>'));
    return;
  }
  const url = `${ARCHIVE_URL}#${encodeURIComponent(data.archive_slug)}`;
  container.appendChild(el(`<a class="btn btn-sm" target="_blank" rel="noopener" href="${esc(url)}">Im Schwarzen Regal öffnen ↗</a>`));
}

function renderArchiveLocked(container, slug, ctx) {
  container.innerHTML = '';
  const form = el(`<form>
    <p class="faint" style="font-size:var(--text-xs);margin-bottom:.5rem">Privat, nur für dich – Passwort eingeben.</p>
    <div style="display:flex;gap:.4rem">
      <input type="password" placeholder="Passwort" autocomplete="current-password" aria-label="Passwort fürs Schwarze Regal" style="flex:1;min-width:0">
      <button type="submit" class="btn btn-sm">Freischalten</button>
    </div>
    <div class="archive-error"></div>
  </form>`);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = form.querySelector('input');
    const errBox = form.querySelector('.archive-error');
    errBox.innerHTML = '';
    try {
      const r = await api('/api/archive/login', { method: 'POST', body: { password: input.value } });
      setArchiveToken(r.token);
      if (ctx) ctx.hasArchiveAccess = true;
      await renderArchivePanel(container, slug, ctx);
    } catch (err) {
      errBox.appendChild(el(`<p class="error-box" style="font-size:var(--text-xs);margin:.5rem 0 0">${esc(err.message)}</p>`));
    }
  });
  container.appendChild(form);
}
