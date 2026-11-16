/* ============================================================
   LMFC Performance — session-merge.js (page séance)
   Fusionner deux séances (lmfc_v52.sql), jamais d'office :
     1. « Fusionner… » : on choisit l'autre séance et celle qu'on garde ;
     2. la base fait le récapitulatif sans rien modifier (session_merge, p_apply = false) ;
     3. « Fusionner » : la base fait tout en une transaction, puis la page ouvre
        la séance gardée.
   La séance source n'est jamais supprimée : elle s'ouvre en lecture, avec un
   bandeau vers la séance qui l'a reçue et « Annuler la fusion »
   (session_merge_undo). La séance qui a reçu une fusion la rappelle de même.
   Dépend de session-edit-page.js (SESSION_ID, loadedSession, CAN_WRITE,
   flushSave) et de app.js (el, toast, confirmDialog).
   ============================================================ */

const MERGE_FIELDS = { heure: 'heure', lieu: 'lieu', principes_jeu: 'principe de jeu', rpe_attendue: 'RPE attendue', notes: 'commentaire général' };
const mergeDate = (iso) => (iso ? fmtDateFr(iso) : 'sans date');
const mergeWhen = (iso) => (iso ? new Date(iso).toLocaleDateString('fr-FR') : '');
const plural = (n, one, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;

/* Séances fusionnées dans celle-ci : lu avec la séance (session-edit-page.js), le bandeau
   s'affiche avec le reste de la page, sans la décaler. Sans lmfc_v52.sql : aucune. */
async function loadMergedSources() {
  const { data, error } = await sb.from('sessions').select('id, titre, date_seance, fusionnee_le').eq('fusionnee_dans', SESSION_ID);
  if (error) console.warn('Fusions non lues (lmfc_v52.sql ?)', error.message);
  return data || [];
}

function initSessionMerge(sources = []) {
  if (!SESSION_ID || !loadedSession) return;
  const banner = document.getElementById('mergeBanner');
  // Séance fusionnée : lecture seule (CAN_WRITE, session-edit-page.js), bandeau vers la séance gardée.
  if (loadedSession.fusionnee_dans) {
    banner.innerHTML = `<p><strong>Séance fusionnée</strong> le ${escapeHtml(mergeWhen(loadedSession.fusionnee_le))} dans
      <a class="text-gold" href="session-edit?id=${Number(loadedSession.fusionnee_dans)}">la séance gardée</a>.
      Elle est vide : présences, RPE, procédés et commentaires y sont.</p>
      <button class="btn btn-sm" type="button" data-merge-undo="${SESSION_ID}">Annuler la fusion</button>`;
    banner.classList.remove('hidden');
  } else {
    if (sources.length) {
      banner.innerHTML = sources.map(s => `<p>A reçu la séance <a class="text-gold" href="session-edit?id=${s.id}">« ${escapeHtml(s.titre)} » (${escapeHtml(mergeDate(s.date_seance))})</a>,
        fusionnée le ${escapeHtml(mergeWhen(s.fusionnee_le))}.</p>${CAN_WRITE ? `<button class="btn btn-sm" type="button" data-merge-undo="${s.id}">Annuler cette fusion</button>` : ''}`).join('');
      banner.classList.remove('hidden');
    }
    const btn = document.getElementById('btnMerge');
    if (CAN_WRITE) { btn.classList.remove('hidden'); btn.addEventListener('click', openMergeDialog); }
  }
  banner.addEventListener('click', (e) => { const b = e.target.closest('[data-merge-undo]'); if (b) undoMerge(Number(b.dataset.mergeUndo), b); });
}

async function undoMerge(sourceId, btn) {
  const ok = await confirmDialog('Annuler la fusion ?\n\nPrésences, RPE, procédés, commentaires et équipes reviennent dans la séance fusionnée. Ce qui a été ajouté depuis à la séance gardée y reste.', { ok: 'Annuler la fusion', cancel: 'Garder' });
  if (!ok) return;
  btn.disabled = true;
  const { error } = await sb.rpc('session_merge_undo', { p_source: sourceId });
  if (error) { btn.disabled = false; return toast(error.message, 'error'); }
  toast('Fusion annulée', 'success');
  setTimeout(() => location.reload(), 600);
}

/* Récapitulatif rendu par la base (session_merge, sans rien modifier). */
function mergeRecapHtml(r) {
  const L = r.lignes, pair = (x) => `${plural(x.deplacees, 'reprise')}${x.doublons ? `, ${x.doublons} en double : celle de la séance gardée est retenue` : ''}`;
  const teams = (x) => (x.equipes?.length ? ` – ${x.equipes.join(' + ')}` : '');
  const items = [
    `Joueurs : ${plural(r.joueurs.total, 'joueur')} au total, sans doublon (${r.joueurs.source} dans la séance fusionnée, ${r.joueurs.cible} dans la séance gardée)`,
    r.equipes_ajoutees.length && `Équipes ajoutées à la séance gardée : ${r.equipes_ajoutees.join(', ')} (leur staff et leurs joueurs y ont accès)`,
    `Présences : ${pair(L.attendance)}`,
    `RPE : ${pair(L.session_rpe)}`,
    `Bilans : ${pair(L.session_bilans)}`,
    L.session_access.deplacees + L.session_access.doublons && `Droits nominatifs du staff : ${pair(L.session_access)}`,
    `Commentaires : ${L.session_comments}`,
    `Procédés : ${L.procedures}${L.procedures ? ', ajoutés à la suite' : ''}`,
    r.informations.length && `Complété là où la séance gardée est vide : ${r.informations.map(k => MERGE_FIELDS[k] || k).join(', ')}`,
  ].filter(Boolean);
  return `<p class="merge-route">« ${escapeHtml(r.source.titre)} » (${escapeHtml(mergeDate(r.source.date))}${escapeHtml(teams(r.source))})
      → « ${escapeHtml(r.cible.titre)} » (${escapeHtml(mergeDate(r.cible.date))}${escapeHtml(teams(r.cible))})</p>
    ${r.meme_date ? '' : '<p class="merge-warn" role="alert">Ces deux séances n’ont pas la même date. Vérifiez qu’il s’agit bien de la même séance.</p>'}
    <ul class="merge-list">${items.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul>
    <p class="field-hint">« ${escapeHtml(r.source.titre)} » n’est pas supprimée : elle reste, vide, marquée fusionnée. La fusion pourra être annulée.</p>`;
}

async function openMergeDialog() {
  if (!(await flushSave())) return toast('Enregistrez d’abord la séance.', 'error');
  const { data: list, error } = await sb.rpc('my_editable_sessions', { p_limit: 100 });
  if (error) return toast(error.message, 'error');
  const day = (iso) => new Date(`${iso}T12:00`).getTime();
  const here = day(loadedSession.date_seance);
  const others = (list || []).filter(s => s.id !== SESSION_ID).sort((a, b) => Math.abs(day(a.date_seance) - here) - Math.abs(day(b.date_seance) - here));
  if (!others.length) return toast('Aucune autre séance que vous pouvez modifier.', 'error');

  const pick = el('select', { id: 'mergeOther' }, others.map(s => el('option', { value: s.id },
    `${s.date_seance === loadedSession.date_seance ? 'Même jour – ' : ''}${s.titre} (${mergeDate(s.date_seance)})`)));
  const keepHere = el('input', { type: 'radio', name: 'mergeKeep', id: 'mergeKeepHere', value: 'here', checked: 'checked' });
  const keepOther = el('input', { type: 'radio', name: 'mergeKeep', id: 'mergeKeepOther', value: 'other' });
  const recap = el('div', { class: 'merge-recap', 'aria-live': 'polite' });
  const cancel = el('button', { type: 'button', class: 'btn' }, 'Annuler');
  const go = el('button', { type: 'button', class: 'btn btn-primary', disabled: 'disabled' }, 'Fusionner');
  const box = el('div', { class: 'modal-backdrop open dlg', 'data-busy': '' },
    el('div', { class: 'modal dlg-box merge-box', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'mergeTitle' },
      el('h2', { class: 'as-h3', id: 'mergeTitle' }, 'Fusionner deux séances'),
      el('p', { class: 'dlg-body' }, 'Pour une séance saisie deux fois (par exemple une fois par équipe). Rien ne change avant « Fusionner ».'),
      el('label', { for: 'mergeOther' }, 'Autre séance'), pick,
      el('fieldset', { class: 'merge-keep' }, el('legend', {}, 'Séance gardée'),
        el('label', { for: 'mergeKeepHere' }, keepHere, ' Celle-ci'), el('label', { for: 'mergeKeepOther' }, keepOther, ' L’autre')),
      recap,
      el('div', { class: 'modal-actions' }, cancel, go)));
  const back = document.activeElement;
  const close = () => { box.remove(); back?.focus?.(); };
  let pair = null;
  const preview = async () => {
    const other = Number(pick.value);
    pair = keepHere.checked ? { p_source: other, p_target: SESSION_ID } : { p_source: SESSION_ID, p_target: other };
    go.disabled = true;
    recap.innerHTML = '<p class="text-muted">Récapitulatif…</p>';
    const { data, error: e } = await sb.rpc('session_merge', { ...pair, p_apply: false });
    if (e) { recap.innerHTML = `<p class="merge-warn" role="alert">${escapeHtml(e.message)}</p>`; return; }
    recap.innerHTML = mergeRecapHtml(data);
    go.disabled = false;
  };
  [pick, keepHere, keepOther].forEach(c => c.addEventListener('change', preview));
  cancel.addEventListener('click', close);
  box.addEventListener('click', (e) => { if (e.target === box) close(); });
  box.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') close(); });
  go.addEventListener('click', async () => {
    go.disabled = true; cancel.disabled = true;
    const { error: e } = await sb.rpc('session_merge', { ...pair, p_apply: true });
    if (e) { cancel.disabled = false; go.disabled = false; return toast(e.message, 'error'); }
    toast('Séances fusionnées', 'success');
    setTimeout(() => { location.href = `session-edit?id=${pair.p_target}`; }, 600);
  });
  document.body.append(box);
  pick.focus();
  preview();
}
