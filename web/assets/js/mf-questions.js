/* ============================================================
   LMFC Performance — mf-questions.js (mes-formulaires)
   Les questions d'un questionnaire, prêtes à remplir, et leur lecture à l'envoi :
     - mfQuestionHtml : texte, nombre, Oui / non et choix en pastilles, choix
       multiple (avec la silhouette du corps, form-body.js), échelle au curseur
       (form-slider.js) ou en pastilles ;
     - mfAnswers : les réponses, chacune avec son vrai type (une échelle est un
       nombre, jamais le texte « 8 ») ; erreur : la première question à revoir.
   Partagé par Mes formulaires et les questionnaires regroupés (todo-parts.js).
   ============================================================ */

const MF_CHIPS_MAX = 6;     // une question à choix plus longue reste une liste

function mfQuestionHtml(q, index) {
  const id = `mf-${index}-${String(q.id || '').replace(/[^a-z0-9_-]/gi, '')}`, key = escapeHtml(q.id);
  const label = `${escapeHtml(q.label || 'Question')} <small>${q.required ? 'Obligatoire' : 'Facultatif'}</small>`;
  const field = (control) => `<div class="field mf-field" data-mf-q="${key}"><label for="${id}">${label}</label>${control}</div>`;
  // Pastilles : un groupe de boutons radio, une seule réponse, grosse cible au doigt.
  const chips = (opts, cls = '') => `<fieldset class="field mf-field" data-mf-q="${key}"><legend>${label}</legend>
    <div class="mf-chips${cls}" role="radiogroup">${opts.map((o, i) => `<label class="mf-chip"${o.color ? ` style="--lv:${o.color}"` : ''}>
      <input type="radio" name="${id}" value="${escapeHtml(o.value)}" data-mf-answer="${key}" data-mf-kind="${o.kind}"${i === 0 ? ` id="${id}"` : ''}>
      <span class="mf-chip-v">${escapeHtml(o.text)}</span>${o.sub ? `<span class="mf-chip-l">${escapeHtml(o.sub)}</span>` : ''}</label>`).join('')}</div>
    ${q.type === 'scale' ? `<p class="mf-chip-out" data-mf-out aria-live="polite"></p>` : ''}</fieldset>`;
  if (q.type === 'textarea') return field(`<textarea id="${id}" data-mf-answer="${key}" data-mf-kind="text" rows="3" maxlength="2000"></textarea>`);
  if (q.type === 'text') return field(`<input id="${id}" data-mf-answer="${key}" data-mf-kind="text" type="text" maxlength="200">`);
  if (q.type === 'number') return field(`<input id="${id}" data-mf-answer="${key}" data-mf-kind="number" type="text" inputmode="decimal" autocomplete="off">`);
  if (q.type === 'boolean') return chips([{ value: 'true', text: 'Oui', kind: 'boolean' }, { value: 'false', text: 'Non', kind: 'boolean' }], ' is-two');
  if (q.type === 'multi') {   // choix multiple (lmfc_v67.sql) : pastilles à cocher, autant que voulu
    const options = Array.isArray(q.options) ? q.options : [];
    return `<fieldset class="field mf-field" data-mf-q="${key}"><legend>${label} <small>Plusieurs réponses possibles</small></legend>
      ${fbHas(q) ? fbHtml(options) : ''}<div class="mf-chips is-text">${options.map((o, i) => `<label class="mf-chip">
        <input type="checkbox" name="${id}" value="${escapeHtml(o)}" data-mf-answer="${key}" data-mf-kind="multi"${i === 0 ? ` id="${id}"` : ''}>
        <span class="mf-chip-v">${escapeHtml(o)}</span></label>`).join('')}</div></fieldset>`;
  }
  if (q.type === 'choice') {
    const options = Array.isArray(q.options) ? q.options : [];
    if (options.length <= MF_CHIPS_MAX) return chips(options.map(o => ({ value: o, text: o, kind: 'text' })), ' is-text');
    return field(`<select id="${id}" data-mf-answer="${key}" data-mf-kind="text"><option value="">Choisir</option>${options.map(o => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join('')}</select>`);
  }
  if (q.curseur !== false) return fsHtml(q, id, key, label);   // échelle au curseur, sauf pastilles choisies (form-slider.js)
  const levels = fqLevels(q);   // échelle : la valeur reste un nombre, le libellé s'affiche
  return chips(levels.map(n => ({ value: String(n.valeur), text: String(n.valeur), sub: levels.length <= 5 ? n.libelle : '', color: n.couleur, kind: 'number' })),
    levels.length > 6 ? ' is-scale is-long' : ' is-scale');
}

/* Les réponses d'un questionnaire, chacune avec son vrai type. Erreur : la première question à revoir. */
function mfAnswers(form, questions) {
  const answers = {};
  for (const q of questions) {
    const inputs = [...form.querySelectorAll('[data-mf-answer]')].filter(x => x.dataset.mfAnswer === q.id);
    if (inputs[0]?.type === 'checkbox') {   // choix multiple : la liste cochée, rien coché = sans réponse
      const picked = inputs.filter(x => x.checked).map(x => x.value);
      if (!picked.length && q.required) return { error: `Réponds à « ${q.label} ».`, q };
      answers[q.id] = picked.length ? picked : null;
      continue;
    }
    const input = inputs.find(x => x.type !== 'radio') || inputs.find(x => x.checked) || null;
    const raw = input ? input.value.trim() : '';
    let value = null;
    if (raw !== '') {
      const kind = input.dataset.mfKind;
      if (kind === 'number') {
        value = Number(raw.replace(',', '.'));
        if (!Number.isFinite(value)) return { error: `Indique un nombre pour « ${q.label} ».`, q };
      } else value = kind === 'boolean' ? raw === 'true' : raw;
    }
    if (value === null && q.required) return { error: `Réponds à « ${q.label} ».`, q };
    answers[q.id] = value;
  }
  return { answers };
}
