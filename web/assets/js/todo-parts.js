/* ============================================================
   LMFC Performance — todo-parts.js (mes-formulaires)
   Un questionnaire regroupé (player-todo.js), d'un seul écran et d'un seul
   « Envoyer ». Chaque partie garde son enregistrement d'origine, dans l'ordre :
     - effort : rpe_set ou match_rpe_set (définitif), au curseur (level-slider.js) ;
     - courbatures : soreness_set (0 : aucune ; sinon au moins un muscle) ;
     - avis du match : match_feedback_set (au moins une réponse) ;
     chacune suivie des questions ajoutées au même formulaire (custom_form_submit,
     même occurrence : la base ne les ouvre qu'une fois la réponse d'origine reçue) ;
     - questionnaire : custom_form_submit.
   Tout est vérifié avant le premier envoi. Une erreur en route garde ce qui est
   parti (rien n'est envoyé deux fois) : la liste rechargée montre ce qui reste.
   Dépend de mf-questions.js, level-slider.js, rpe.js, soreness.js, match-feedback.js,
   player-todo.js.
   ============================================================ */

const ptCount = (item) => item.parts.reduce((n, p) => n + (p.type === 'form' ? (p.form.questions || []).length
  : (p.type === 'avis' ? mfShown(p.row).length : p.type === 'sore' ? 2 : 1) + p.extras.length), 0);
const PT_SORE_LEVELS = Array.from({ length: 11 }, (_, v) => ({ valeur: v, libelle: v === 0 ? 'Aucune' : v === 10 ? 'Très fortes' : '', couleur: soreColor(v) }));

/* Un questionnaire replié : son nom, la séance ou le match, le nombre de questions ; ouvert, tout. */
function ptCardHtml(item, n, open) {
  const qs = ptCount(item);
  return `<details class="mf-card pt-card is-${item.phase || 'libre'}" data-pt-card="${n}"${open ? ' open' : ''}>
    <summary><span class="mf-card-title">${escapeHtml(item.label)}</span>
      <span class="mf-card-sub">${escapeHtml(ptSub(item))}</span>
      <span class="mf-card-n" data-pt-n>${qs} question${qs > 1 ? 's' : ''}</span></summary>
    <form class="mf-fields" novalidate data-pt-form="${n}">
      ${item.parts.map((p, k) => ptPartHtml(item, p, `${n}-${k}`)).join('')}
      <div class="mf-submit-bar"><p class="mf-error" data-mf-error aria-live="polite"></p>
        ${item.parts.some(p => p.type === 'rpe') ? '<p class="pt-note">Ton effort ne se modifie plus une fois envoyé.</p>' : ''}
        <button class="btn btn-primary" type="submit">Envoyer</button></div>
    </form>
  </details>`;
}

function ptPartHtml(item, p, uid) {
  const more = (qs) => qs.map((q, i) => mfQuestionHtml(q, `${uid}-${i}`)).join('');
  const main = (label, levels, aria) => `<div class="field mf-field" data-mf-q="__main"><label for="pt-${uid}">${escapeHtml(label)} <small>Obligatoire</small></label>
    ${lsHtml({ id: `pt-${uid}`, levels, label: aria })}<input type="hidden" data-pt-main value=""></div>`;
  if (p.type === 'rpe') {
    return `<div class="pt-part" data-pt-part="${uid}">${main(formLabel(p.row, 'rpe') || `Comment as-tu ressenti l’effort de ${rpeWhat(p.row)} ?`,
      rpeScaleOf(p.row).map(([valeur, libelle, couleur]) => ({ valeur, libelle, couleur })), 'Ton effort, de 1 à 10')}${more(p.extras)}</div>`;
  }
  if (p.type === 'sore') {
    return `<div class="pt-part" data-pt-part="${uid}" data-pt-sore>${main(formLabel(p.row, 'niveau') || 'Ton niveau de courbature au réveil (0 = aucune, 10 = très fortes) :',
      PT_SORE_LEVELS, 'Niveau de courbature, de 0 à 10')}
      <fieldset class="field mf-field hidden" data-mf-q="__muscles" data-pt-muscles><legend>${escapeHtml(formLabel(p.row, 'muscles') || 'Quels muscles sont courbaturés ?')} <small>Au moins un</small></legend>
        ${SORE_ZONES.map(([zone, title]) => `<div class="pt-zone"><span class="pt-zone-t">${title}</span><div class="mf-chips is-text">${SORE_MUSCLES.filter(m => m[3] === zone)
          .map(([k, label]) => `<label class="mf-chip"><input type="checkbox" value="${k}" data-pt-muscle><span class="mf-chip-v">${label}</span></label>`).join('')}</div></div>`).join('')}
      </fieldset>${more(p.extras)}</div>`;
  }
  if (p.type === 'avis') {
    const shown = mfShown(p.row), tag = shown.length > 1 ? 'Au moins une des deux' : 'Obligatoire';
    return `<div class="pt-part" data-pt-part="${uid}">${shown.map(([k, q, hint]) => `<div class="field mf-field" data-mf-q="__${k}"><label for="pt-${uid}-${k}">${escapeHtml(q)} <small>${tag}</small></label>
      <textarea id="pt-${uid}-${k}" rows="3" maxlength="2000" placeholder="${escapeHtml(hint)}" data-pt-avis="${k}"></textarea></div>`).join('')}${more(p.extras)}</div>`;
  }
  const f = p.form;
  return `<div class="pt-part" data-pt-part="${uid}">${item.parts.length > 1 ? `<h3 class="pt-part-title">${escapeHtml(ptTitle(f.titre))}</h3>` : ''}
    ${f.description ? `<p class="mf-card-desc">${escapeHtml(f.description)}</p>` : ''}${more(Array.isArray(f.questions) ? f.questions : [])}</div>`;
}

/* Les réponses du questionnaire, partie par partie, et ce qu'il faudra envoyer.
   Erreur : { error, box } (la question à revoir). */
function ptRead(form, item, n, demo) {
  const jobs = [], today = ptDay(0);
  const rpc = async (name, args) => {
    if (demo) return { alerte: false };
    const { data, error } = await sb.rpc(name, args);
    if (error) throw error;
    return data;
  };
  for (const [k, p] of item.parts.entries()) {
    const box = form.querySelector(`[data-pt-part="${n}-${k}"]`), q = (id) => box.querySelector(`[data-mf-q="${id}"]`);
    const extras = p.type === 'form' ? p.form.questions || [] : p.extras;
    const read = mfAnswers(box, extras);
    const main = box.querySelector('[data-pt-main]')?.value ?? '';
    if (['rpe', 'sore'].includes(p.type) && main === '') {
      return { error: p.type === 'rpe' ? 'Indique ton effort : glisse le curseur.' : 'Indique tes courbatures : glisse le curseur (0 = aucune).', box: q('__main') };
    }
    if (p.type === 'form') {
      if (read.error) return { error: read.error, box: [...box.querySelectorAll('[data-mf-q]')].find(x => x.dataset.mfQ === read.q.id) };
      jobs.push(() => rpc('custom_form_submit', { p_version_id: Number(p.form.version_id), p_answers: read.answers, p_occurrence: p.form.occurrence || '' }));
      continue;
    }
    let save, occ;
    if (p.type === 'rpe') {
      const r = p.row;
      occ = `${r.match ? 'm' : 's'}${r.id}`;
      save = () => rpc(r.match ? 'match_rpe_set' : 'rpe_set', { [r.match ? 'p_match' : 'p_session']: r.id, p_rpe: Number(main) });
    } else if (p.type === 'sore') {
      const niveau = Number(main), muscles = [...box.querySelectorAll('[data-pt-muscle]:checked')].map(x => x.value);
      if (niveau > 0 && !muscles.length) return { error: 'Choisis au moins un muscle courbaturé (ou mets 0).', box: q('__muscles') };
      occ = `j${today}`;
      save = async () => {
        const data = await rpc('soreness_set', { p_niveau: niveau, p_muscles: niveau ? muscles : [] });
        // 3 jours de suite : la base a créé l'alerte ; le Worker prévient le staff (sans attendre).
        if (data?.alerte) siteApi('push/soreness', { method: 'POST' }, 'Notifications').catch(e => console.warn('Alerte courbatures non envoyée sur les téléphones', e));
      };
    } else {
      const v = Object.fromEntries(MF_QUESTIONS.map(([key]) => [key, box.querySelector(`[data-pt-avis="${key}"]`)?.value.trim() || null]));
      if (!v.individuel && !v.collectif) return { error: 'Écris au moins quelques mots sur le match.', box: box.querySelector('[data-mf-q]') };
      occ = `m${p.row.id}`;
      save = () => rpc('match_feedback_set', { p_match: p.row.id, p_individuel: v.individuel, p_collectif: v.collectif });
    }
    if (read.error) return { error: read.error, box: [...box.querySelectorAll('[data-mf-q]')].find(x => x.dataset.mfQ === read.q.id) };
    jobs.push(async () => {
      await save();
      if (extras.length && !demo) await ptExtrasSubmit(occ, extras, read.answers);
    });
  }
  return { jobs };
}

/* Les questions ajoutées, une fois la réponse d'origine reçue : leur version, par la liste du joueur. */
async function ptExtrasSubmit(occ, questions, answers) {
  const { data, error } = await sb.rpc('custom_forms_my_pending');
  if (error) throw error;
  const ids = (qs) => (qs || []).map(q => q.id).sort().join('|');
  const f = (data || []).find(x => (x.occurrence || '') === occ && ids(x.questions) === ids(questions));
  if (!f) { console.warn('Questions ajoutées introuvables après la réponse d’origine', occ); return; }
  const { error: e2 } = await sb.rpc('custom_form_submit', { p_version_id: Number(f.version_id), p_answers: answers, p_occurrence: occ });
  if (e2) throw e2;
}

/* Envoi d'un questionnaire regroupé. after(sent) : recharger la liste (sent : au moins une partie est partie). */
async function ptSubmit(form, item, n, { demo = false, after }) {
  const error = form.querySelector('[data-mf-error]'), button = form.querySelector('button[type="submit"]');
  const read = ptRead(form, item, n, demo);
  form.querySelectorAll('.is-missing').forEach(x => x.classList.remove('is-missing'));
  if (read.error) {
    error.textContent = read.error;
    read.box?.classList.add('is-missing');
    read.box?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    read.box?.querySelector('input:not([type="hidden"]), select, textarea')?.focus({ preventScroll: true });
    return;
  }
  button.disabled = true;
  error.textContent = 'Envoi…';
  let sent = 0;
  try {
    for (const job of read.jobs) { await job(); sent += 1; }
    toast('Merci, c’est envoyé au staff.', 'success');
    await after(true);
  } catch (err) {
    console.error('Questionnaire non envoyé', err);
    error.textContent = mfError(err);
    button.disabled = false;
    if (sent) { toast(`${mfError(err)} Le début est enregistré : il reste la suite.`, 'error'); await after(true); }
  }
}

/* Réponses données / questions, dans le résumé du questionnaire. */
function ptProgress(card) {
  const boxes = [...card.querySelectorAll('[data-mf-q]')].filter(b => !b.classList.contains('hidden'));
  const done = boxes.filter(b => [...b.querySelectorAll('input, textarea, select')].some(x => (['radio', 'checkbox'].includes(x.type) ? x.checked
    : x.type !== 'range' && x.value.trim() !== ''))).length;
  card.querySelector('[data-pt-n]').textContent = done ? `${done}/${boxes.length} répondues` : `${boxes.length} question${boxes.length > 1 ? 's' : ''}`;
}

/* Curseur d'effort ou de courbatures : la valeur va dans le champ caché ; courbatures > 0 : les muscles. */
document.addEventListener('ls-change', (e) => {
  const box = e.target.closest('[data-mf-q="__main"]');
  if (!box?.closest('[data-pt-part]')) return;
  box.querySelector('[data-pt-main]').value = String(e.detail.valeur);
  box.classList.remove('is-missing');
  const sore = box.closest('[data-pt-sore]')?.querySelector('[data-pt-muscles]');
  if (sore) {
    sore.classList.toggle('hidden', !e.detail.valeur);
    if (!e.detail.valeur) sore.querySelectorAll('input:checked').forEach(x => { x.checked = false; });
  }
  ptProgress(box.closest('[data-pt-card]'));
});
