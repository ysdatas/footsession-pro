/* ============================================================
   LMFC Performance — perf-measure-edit.js (player-performance)
   Suivi physique : modifier ou supprimer une mesure déjà saisie.
   « + Mesure » complète un mois sans rien effacer (un champ vide ne
   change rien) ; « Modifier » sur une ligne du tableau rouvre la même
   fenêtre sur cette ligne : un champ vidé efface la valeur, le mois et la
   date peuvent changer, « Supprimer » retire la ligne. Une mesure retirée
   seule ne va pas dans la corbeille (mode « child », lmfc_v5.sql) : la
   confirmation le dit. Droits : admin, prépa, analyste avec le niveau
   « modification » sur le joueur (policies performance_measurements_*,
   lmfc_v19.sql, lmfc_v41.sql) ; la base décide.
   Dépend de player-performance-page.js (measurements, player, ctxProfile,
   canEditPerformance, notify, openPerfModal, closePerfModal, reloadData,
   num, fmt, esc) et de perf-metrics.js (seasonKeyFor), app.js (confirmDialog).
   ============================================================ */

let measureEditId = null;   // null : « + Mesure » ; sinon l'id de la ligne modifiée
const ofMonth = (m) => (!m ? 'de ce mois' : /^[aeiouéh]/i.test(m) ? `d’${m}` : `de ${m}`);   // « d’Octobre », « de Novembre »

/* Bouton « Modifier » d'une ligne du tableau (staff qui peut écrire). */
const measureEditButton = (m) => `<button class="btn btn-sm btn-ghost measure-edit" type="button" data-measure="${Number(m.id)}"
  aria-label="Modifier la mesure ${esc(ofMonth(m.month_label))}">Modifier</button>`;

/* Titre, phrase d'aide et bouton Supprimer selon le mode (ajout ou modification). */
function setMeasureMode(m) {
  measureEditId = m ? m.id : null;
  document.getElementById('measureModalTitle').textContent = m ? `Modifier la mesure ${ofMonth(m.month_label)}` : 'Ajouter une mesure';
  document.getElementById('measureModalLead').textContent = m
    ? 'Corrigez les valeurs : un champ vidé efface la valeur de ce mois.'
    : 'Une ligne par mois : la saisie complète ou corrige ce mois. Un champ vide ne change rien.';
  document.getElementById('btnDeleteMeasurement').classList.toggle('hidden', !m);
}

function openMeasureEdit(id) {
  const m = measurements.find(x => Number(x.id) === id);
  if (!canEditPerformance || !m) return;
  setMeasureMode(m);
  document.getElementById('m-date').value = m.measured_at ? String(m.measured_at).slice(0, 10) : '';
  if (m.month_label) document.getElementById('m-month').value = m.month_label;
  const put = (el, v) => { document.getElementById(el).value = num(v) === null ? '' : String(num(v)); };
  put('m-height', m.height_cm); put('m-weight', m.weight_kg); put('m-fat', m.body_fat_pct);
  openPerfModal('measureModal');
  setTimeout(() => document.getElementById('m-weight').focus(), 50);
}

/* Enregistre la ligne modifiée telle qu'affichée : un champ vide devient null. */
async function updateMeasurement() {
  const m = measurements.find(x => x.id === measureEditId);
  if (!canEditPerformance || !m) return;
  const date = document.getElementById('m-date').value || null;
  const body = {
    measured_at: date,
    month_label: document.getElementById('m-month').value,
    height_cm: num(document.getElementById('m-height').value),
    weight_kg: num(document.getElementById('m-weight').value),
    body_fat_pct: num(document.getElementById('m-fat').value),
    // Sans date, la ligne garde sa saison (une ligne de l'Excel n'a souvent que le mois).
    season_key: date ? seasonKeyFor(date, clubSeasonStartMonth(ctxProfile?.clubs)) : m.season_key,
  };
  if ([body.height_cm, body.weight_kg, body.body_fat_pct].every(v => v === null)) {
    return notify('Renseignez au moins une valeur, ou supprimez la mesure.', 'error');
  }
  const { data, error } = await sb.from('player_physical_measurements').update(body).eq('id', m.id).select('id');
  if (error) {
    console.error('Mesure non modifiée', error);
    return notify(error.code === '23505' ? `${body.month_label} a déjà une mesure : modifiez cette ligne-là, ou supprimez-en une.` : error.message, 'error');
  }
  if (!data?.length) return notify('Modification refusée : vos droits sur ce joueur ne le permettent pas.', 'error');
  notify('Mesure modifiée.', 'success');
  closePerfModal('measureModal');
  await reloadData();
}

async function deleteMeasurement() {
  const m = measurements.find(x => x.id === measureEditId);
  if (!canEditPerformance || !m) return;
  const values = [['height_cm', 0, 'cm'], ['weight_kg', 1, 'kg'], ['body_fat_pct', 1, '%']]
    .filter(([k]) => num(m[k]) !== null).map(([k, d, u]) => `${fmt(m[k], d)} ${u}`).join(', ');
  if (!await confirmDialog(`Supprimer la mesure ${ofMonth(m.month_label)}${values ? ` (${values})` : ''} ?\n\nElle ne va pas dans la corbeille : la suppression est définitive.`, { ok: 'Supprimer' })) return;
  const { data, error } = await sb.from('player_physical_measurements').delete().eq('id', m.id).select('id');
  if (error) {
    console.error('Mesure non supprimée', error);
    return notify(error.message, 'error');
  }
  if (!data?.length) return notify('Suppression refusée : vos droits sur ce joueur ne le permettent pas.', 'error');
  notify('Mesure supprimée.', 'success');
  closePerfModal('measureModal');
  await reloadData();
}

document.getElementById('measurementHistory')?.addEventListener('click', (e) => {
  const b = e.target.closest('[data-measure]');
  if (b) openMeasureEdit(Number(b.dataset.measure));
});
document.getElementById('btnDeleteMeasurement')?.addEventListener('click', deleteMeasurement);
