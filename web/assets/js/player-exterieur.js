/* ============================================================
   LMFC Performance — player-exterieur.js
   Joueurs extérieurs (lmfc_v54.sql) : un joueur sans fiche au club (essai,
   joueur d'un autre club) a une fiche à lui, retrouvée d'une séance ou d'un
   match à l'autre ; ses présences, RPE et feuilles de match s'y rattachent.
     - extTeamLabel(p) : « Extérieur · Stade Lavallois U14 », sinon l'équipe ;
     - newExterieur(texte, connus) : fenêtre prénom, nom, naissance, origine,
       infos ; une fiche qui lui ressemble (même nom et prénom, ou même nom et
       même naissance) est proposée avant d'en créer une : identité incertaine,
       on demande ; renvoie la fiche choisie ou créée, ou null ;
     - attachExterieur(fiche) : il avait déjà une fiche au club → récapitulatif
       de la base, puis tout son historique y passe (player_exterieur_attach).
   Dépend de app.js (el, toast, escapeHtml, fmtDateFr par procedure-time.js) et
   de nav.js (teamName).
   ============================================================ */

const extKey = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]/g, '');
const extTeamLabel = (p) => (p?.exterieur ? `Extérieur${p.origine ? ` · ${p.origine}` : ''}` : teamName(p?.team_id) || 'Sans équipe');
const extName = (p) => `${p?.prenom || ''} ${p?.nom || ''}`.trim() || 'Joueur';
const extBorn = (p) => (p?.date_naissance ? `né(e) le ${fmtDateFr(p.date_naissance)}` : 'naissance inconnue');
/* Fiches qui ressemblent à la saisie : même nom, et même prénom ou même date de naissance. */
function extSimilar(f, known) {
  const nom = extKey(f.nom), prenom = extKey(f.prenom);
  return known.filter(p => nom && extKey(p.nom) === nom && ((prenom && extKey(p.prenom) === prenom) || (f.naissance && p.date_naissance === f.naissance)));
}

/* Petite fenêtre : champs, zone de message, boutons. Rend une promesse résolue par done(). */
function extModal(title, intro, content, actions) {
  return new Promise((resolve) => {
    const back = document.activeElement;
    const box = el('div', { class: 'modal-backdrop open dlg', 'data-busy': '' },
      el('div', { class: 'modal dlg-box ext-box', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'extTitle' },
        el('h2', { class: 'as-h3', id: 'extTitle' }, title), intro && el('p', { class: 'dlg-body' }, intro), content,
        el('div', { class: 'modal-actions' }, ...actions)));
    const done = (v) => { box.remove(); back?.focus?.(); resolve(v); };
    box.addEventListener('click', (e) => { if (e.target === box) done(null); });
    box.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') done(null); });
    document.body.append(box);
    box.done = done;
    setTimeout(() => box.querySelector('input, select, button')?.focus(), 0);
    extModal.current = box;
  });
}

async function newExterieur(text = '', known = []) {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  const field = (id, label, attrs = {}) => el('div', { class: 'field' }, el('label', { for: id }, label), el(attrs.tag || 'input', { id, ...attrs, tag: null }));
  const form = el('div', { class: 'ext-form' },
    field('extPrenom', 'Prénom', { value: words.length > 1 ? words[0] : '', autocomplete: 'off', maxlength: '80' }),
    field('extNom', 'Nom', { value: words.length > 1 ? words.slice(1).join(' ') : words[0] || '', autocomplete: 'off', maxlength: '80', required: 'required' }),
    field('extNaissance', 'Date de naissance (si connue)', { type: 'date' }),
    field('extOrigine', 'Club ou équipe d’origine', { maxlength: '120', placeholder: 'Ex : Stade Lavallois U14' }),
    field('extInfos', 'Informations', { tag: 'textarea', maxlength: '500', rows: '2', placeholder: 'Essai, poste, contact du club…' }),
    el('div', { class: 'ext-similar', 'aria-live': 'polite' }));
  const cancel = el('button', { type: 'button', class: 'btn' }, 'Annuler');
  const go = el('button', { type: 'button', class: 'btn btn-primary' }, 'Créer sa fiche');
  const wait = extModal('Nouveau joueur extérieur', 'Pour un joueur sans fiche au club. Sa fiche le suit d’une séance ou d’un match à l’autre.', form, [cancel, go]);
  const box = extModal.current, $ = (id) => box.querySelector(`#${id}`);
  let checked = false;
  cancel.addEventListener('click', () => box.done(null));
  box.addEventListener('click', (e) => {
    const use = e.target.closest('[data-ext-use]');
    if (use) box.done(known.find(p => p.id === Number(use.dataset.extUse)) || null);
  });
  box.addEventListener('input', () => { checked = false; go.textContent = 'Créer sa fiche'; $('extSimilarBox')?.remove(); });
  go.addEventListener('click', async () => {
    const f = { prenom: $('extPrenom').value.trim(), nom: $('extNom').value.trim(), naissance: $('extNaissance').value || null,
      origine: $('extOrigine').value.trim(), infos: $('extInfos').value.trim() };
    if (!f.nom) { toast('Le nom est obligatoire.', 'error'); return $('extNom').focus(); }
    const similar = checked ? [] : extSimilar(f, known);
    if (similar.length) {
      // Identité incertaine : on montre les fiches proches, on ne crée qu'après « Créer quand même ».
      box.querySelector('.ext-similar').innerHTML = `<div id="extSimilarBox"><p><strong>Déjà au club ?</strong> Ces fiches lui ressemblent :</p>
        ${similar.map(p => `<p class="ext-hit"><span>${escapeHtml(extName(p))} – ${escapeHtml(extBorn(p))} – ${escapeHtml(extTeamLabel(p))}</span>
          <button type="button" class="btn btn-sm" data-ext-use="${p.id}">Utiliser cette fiche</button></p>`).join('')}</div>`;
      checked = true;
      go.textContent = 'Créer quand même';
      return;
    }
    go.disabled = true;
    const { data: id, error } = await sb.rpc('player_exterieur_create', { p_prenom: f.prenom, p_nom: f.nom, p_naissance: f.naissance, p_origine: f.origine, p_infos: f.infos });
    if (error) { go.disabled = false; return toast(/player_exterieur_create/.test(error.message || '') ? updateNeeded('lmfc_v54.sql') : error.message, 'error'); }
    const { data: p, error: e2 } = await sb.from('players').select('*').eq('id', id).single();
    if (e2) { go.disabled = false; return toast(e2.message, 'error'); }
    toast(`Fiche créée : ${extName(p)} (extérieur).`, 'success');
    box.done(p);
  });
  return wait;
}

/* Il avait déjà une fiche au club : son historique de joueur extérieur y passe. */
async function attachExterieur(mini) {
  const { data: list, error } = await sb.from('players').select('id, nom, prenom, date_naissance, team_id, other_team_ids').eq('exterieur', false).order('nom');
  if (error) return toast(error.message, 'error');
  const near = extKey(mini.nom);
  const sorted = [...(list || [])].sort((a, b) => (extKey(b.nom) === near) - (extKey(a.nom) === near));
  if (!sorted.length) return toast('Aucune fiche du club que vous pouvez modifier.', 'error');
  const pick = el('select', { id: 'extAttachTo' }, sorted.map(p => el('option', { value: p.id },
    `${extKey(p.nom) === near ? 'Même nom – ' : ''}${extName(p)} (${p.date_naissance ? fmtDateFr(p.date_naissance) : 'naissance inconnue'}, ${teamName(p.team_id) || 'sans équipe'})`)));
  const recap = el('div', { class: 'ext-recap', 'aria-live': 'polite' });
  const cancel = el('button', { type: 'button', class: 'btn' }, 'Annuler');
  const go = el('button', { type: 'button', class: 'btn btn-primary', disabled: 'disabled' }, 'Rattacher');
  const wait = extModal('Rattacher à une fiche du club', `${extName(mini)} a déjà une fiche au club ? Tout ce qui est rattaché à sa fiche de joueur extérieur (présences, RPE, bilans, matchs) y passe ; sa fiche extérieure, vide, part à la corbeille.`,
    el('div', {}, el('label', { for: 'extAttachTo' }, 'Sa fiche au club'), pick, recap), [cancel, go]);
  const box = extModal.current;
  const LABELS = { attendance: 'présences', session_rpe: 'RPE de séance', session_bilans: 'bilans de séance', match_players: 'feuilles de match', match_rpe: 'RPE de match',
    match_feedback: 'avis de match', club_event_players: 'événements', player_soreness: 'courbatures', rpe_reminders: 'relances', calendar_notifs: 'annonces' };
  const preview = async () => {
    go.disabled = true;
    recap.innerHTML = '<p class="text-muted">Récapitulatif…</p>';
    const { data, error: e } = await sb.rpc('player_exterieur_attach', { p_mini: mini.id, p_player: Number(pick.value), p_apply: false });
    if (e) { recap.innerHTML = `<p class="ext-warn" role="alert">${escapeHtml(e.message)}</p>`; return; }
    const lines = Object.entries(data.lignes || {}), dups = Object.entries(data.doublons || {});
    recap.innerHTML = `<ul class="ext-list">${lines.map(([k, n]) => `<li>${escapeHtml(LABELS[k] || k)} : ${n}</li>`).join('') || '<li>Aucune donnée à reprendre.</li>'}</ul>
      ${dups.length ? `<p class="ext-warn" role="alert">Les deux fiches ont déjà une ligne pour la même séance, le même match ou le même jour (${dups.map(([k, n]) => `${escapeHtml(LABELS[k] || k)} : ${n}`).join(', ')}). Retirez l’une des deux d’abord.</p>` : ''}`;
    go.disabled = dups.length > 0;
  };
  pick.addEventListener('change', preview);
  cancel.addEventListener('click', () => box.done(null));
  go.addEventListener('click', async () => {
    go.disabled = true;
    const { error: e } = await sb.rpc('player_exterieur_attach', { p_mini: mini.id, p_player: Number(pick.value), p_apply: true });
    if (e) { go.disabled = false; return toast(e.message, 'error'); }
    toast('Historique rattaché à sa fiche du club.', 'success');
    box.done(Number(pick.value));
  });
  preview();
  return wait;
}
