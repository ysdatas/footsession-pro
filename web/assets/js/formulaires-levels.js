/* ============================================================
   LMFC Performance — formulaires-levels.js (formulaires)
   Les niveaux d'une échelle dans l'éditeur (formulaires-editor.js) : valeur
   enregistrée, libellé et couleur montrés au joueur ; réglages rapides (0 à 10,
   1 à 10, 1 à 5, intensité). Les questions d'origine (RPE) gardent leurs valeurs.
   ============================================================ */
const CF_PALETTE = ['#2e7d32', '#ef6c00', '#c62828'];   // couleur proposée pour un nouveau niveau : vert, orange, rouge
/* Réglages rapides d'une échelle : remplacent les niveaux affichés, modifiables ensuite. */
const CF_PRESETS = {
  '0-10': () => cfRange(0, 10), '1-10': () => cfRange(1, 10), '1-5': () => cfRange(1, 5),
  intensite: () => FQ_RPE_PRESET.map(n => ({ ...n })),
};
function cfRange(min, max) { return Array.from({ length: max - min + 1 }, (_, i) => ({ valeur: min + i, libelle: '', couleur: null })); }

/* Les niveaux d'une échelle : valeur, libellé, couleur (facultative). */
function cfLevelsHtml(question) {
  const fixed = !!question.fixe;
  const levels = question.type === 'scale' ? fqLevels(question) : cfRange(1, 10);
  return `<p class="cf-levels-head">Niveaux de l’échelle <span class="text-muted">${fixed ? '(valeurs de 1 à 10 : le RPE en dépend)' : '(valeur enregistrée, libellé et couleur montrés au joueur)'}</span></p>
    <div class="cf-levels-presets" role="group" aria-label="Réglages rapides">
      ${fixed ? '' : '<button class="btn btn-sm" type="button" data-cf-preset="0-10">0 à 10</button><button class="btn btn-sm" type="button" data-cf-preset="1-10">1 à 10</button><button class="btn btn-sm" type="button" data-cf-preset="1-5">1 à 5</button>'}
      <button class="btn btn-sm" type="button" data-cf-preset="intensite">Intensité 1 à 10 (libellés)</button>
    </div>
    <div class="cf-levels" data-cf-levels>${levels.map(cfLevelRow).join('')}</div>
    <button class="btn btn-sm" type="button" data-cf-level-add>+ Niveau</button>`;
}

function cfLevelRow(n) {
  const uid = cfUid(), color = /^#[0-9a-f]{6}$/i.test(n.couleur || '') ? n.couleur : '';
  return `<div class="cf-level" data-cf-level>
    <label class="sr-only" for="cf-lv-v-${uid}">Valeur</label><input id="cf-lv-v-${uid}" class="cf-level-v" type="number" min="0" max="10" step="1" value="${Number(n.valeur)}" data-cf-lv-value required>
    <label class="sr-only" for="cf-lv-l-${uid}">Libellé</label><input id="cf-lv-l-${uid}" class="cf-level-l" maxlength="60" value="${escapeHtml(n.libelle || '')}" placeholder="Libellé (facultatif)" data-cf-lv-label>
    <label class="cf-level-c" title="Couleur"><input type="checkbox" data-cf-lv-colored${color ? ' checked' : ''} aria-label="Couleur pour ce niveau">
      <input type="color" value="${color || CF_PALETTE[Math.min(2, Math.floor(Number(n.valeur) / 4))]}" data-cf-lv-color aria-label="Couleur du niveau"></label>
    <button class="btn btn-sm cf-level-x" type="button" data-cf-level-remove aria-label="Retirer ce niveau">×</button>
  </div>`;
}

/* Clics sur les niveaux : réglage rapide, ajouter, retirer. Rend true si le clic est traité. */
function cfLevelsClick(e) {
  const preset = e.target.closest('[data-cf-preset]');
  if (preset) {
    preset.closest('[data-cf-levels-box]').querySelector('[data-cf-levels]').innerHTML = CF_PRESETS[preset.dataset.cfPreset]().map(cfLevelRow).join('');
    return true;
  }
  const add = e.target.closest('[data-cf-level-add]');
  if (add) {
    const list = add.closest('[data-cf-levels-box]').querySelector('[data-cf-levels]');
    const used = [...list.querySelectorAll('[data-cf-lv-value]')].map(x => Number(x.value));
    const next = [...Array(11).keys()].find(v => !used.includes(v) && v > Math.max(-1, ...used)) ?? [...Array(11).keys()].find(v => !used.includes(v));
    if (next == null || used.length >= 11) { toast('Une échelle a 11 niveaux au plus (de 0 à 10).', 'error'); return true; }
    list.insertAdjacentHTML('beforeend', cfLevelRow({ valeur: next, libelle: '', couleur: null }));
    return true;
  }
  const remove = e.target.closest('[data-cf-level-remove]');
  if (remove) {
    if (remove.closest('[data-cf-levels]').children.length <= 2) { toast('Une échelle garde au moins deux niveaux.', 'error'); return true; }
    remove.closest('[data-cf-level]').remove();
    return true;
  }
  return false;
}

/* Les niveaux lus dans l'éditeur ; error si une valeur est fausse ou en double. */
function cfReadLevels(row) {
  const levels = [...row.querySelectorAll('[data-cf-level]')].map(x => ({
    valeur: Number(x.querySelector('[data-cf-lv-value]').value),
    libelle: x.querySelector('[data-cf-lv-label]').value.trim(),
    couleur: x.querySelector('[data-cf-lv-colored]').checked ? x.querySelector('[data-cf-lv-color]').value : null,
  })).sort((a, b) => a.valeur - b.valeur);
  const bad = levels.length < 2 || levels.some(n => !Number.isInteger(n.valeur) || n.valeur < 0 || n.valeur > 10)
    || new Set(levels.map(n => n.valeur)).size !== levels.length;
  return { levels, bad };
}

/* Une échelle : sans libellé ni couleur et sans trou, de simples bornes ; sinon ses niveaux. */
function cfScale(q, row, fixed) {
  const { levels, bad } = cfReadLevels(row);
  if (bad) return { error: `« ${q.label || 'Échelle'} » : de 2 à 11 niveaux, valeurs entières distinctes de 0 à 10.` };
  const min = fixed ? q.min : levels[0].valeur, max = fixed ? q.max : levels[levels.length - 1].valeur;
  if (fixed && levels.some(n => n.valeur < min || n.valeur > max)) return { error: `« ${q.label} » : valeurs de ${min} à ${max}.` };
  const plain = levels.every(n => !n.libelle && !n.couleur) && levels.length === max - min + 1;
  const out = { ...q, min, max };
  delete out.niveaux;
  if (!plain) out.niveaux = levels;
  if (!fixed && out.min === out.max) return { error: `« ${q.label} » : au moins deux valeurs.` };
  return { q: out };
}
