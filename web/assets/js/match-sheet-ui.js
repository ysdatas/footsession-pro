/* ============================================================
   LMFC Performance — match-sheet-ui.js (matchs.html)
   « Coller la feuille de match » dans la fiche d'un match : la page « Le
   match » d'epreuves.fff.fr → aperçu (score, joueurs reconnus, à
   confirmer, à choisir, non reconnus ; statut, buts, cartons, minutes) →
   le staff corrige les associations → « Préremplir la fiche ».
   Rien n'est enregistré avant « Enregistrer » ; les valeurs lues sont
   gardées dans ext_data (lmfc_v33.sql) : une correction à la main
   s'affiche « modifié ». Une valeur absente de la feuille ne remplace
   rien de ce que le staff a déjà saisi.
   Dépend de match-sheet.js, fff-import.js, matchs-page.js (editing,
   clubPlayers, myProfile, addRow, renderRows, val).
   ============================================================ */

const SHEET = { parsed: null, rows: [] };
const SHEET_ST = { ok: ['Reconnu', 'is-new'], confirm: ['À confirmer', 'is-warn'], choose: ['À choisir', 'is-warn'], none: ['Non reconnu', ''] };
const sheetDur = () => Number(document.getElementById('sheetDuree').value) || null;

function openSheet() {
  SHEET.parsed = null; SHEET.rows = [];
  document.getElementById('sheetText').value = '';
  document.getElementById('sheetStatus').textContent = '';
  document.getElementById('sheetPreview').innerHTML = '';
  document.getElementById('sheetApply').classList.add('hidden');
  openModal('sheetModal');
}

function sheetAnalyse() {
  const club = myProfile.clubs?.nom || 'Le Mans FC', teamId = Number(val('m-team')) || currentTeamId(), status = document.getElementById('sheetStatus');
  const parsed = msParse(document.getElementById('sheetText').value, club);
  SHEET.parsed = parsed;
  if (!parsed.team) {
    SHEET.rows = [];
    document.getElementById('sheetPreview').innerHTML = '';
    document.getElementById('sheetApply').classList.add('hidden');
    status.innerHTML = `<span class="text-danger">${escapeHtml(parsed.teams.length
      ? `Aucune composition de ${club} dans ce texte (équipes lues : ${parsed.teams.join(', ')}).`
      : 'Aucune composition trouvée. Copiez la page « Le match » d’une rencontre jouée (tout sélectionner).')}</span>`;
    return;
  }
  const found = msMatch(parsed.players.map(p => p.name), clubPlayers, teamId);
  SHEET.rows = parsed.players.map((p, i) => ({ ...p, ...found[i], on: found[i].status === 'ok' }));
  sheetRender();
}

function sheetRender() {
  const { parsed, rows } = SHEET, h = parsed.head, dur = sheetDur(), teamId = Number(val('m-team')) || currentTeamId();
  const team = clubPlayers.filter(p => playerInTeam(p, teamId)), num = (v) => (v === null || v === undefined ? '—' : v);
  const options = (r) => {
    const first = r.candidates.length ? r.candidates : [];
    const rest = team.filter(p => !first.includes(p));
    return `<option value="">— Ignorer —</option>${[...first, ...rest].map(p => `<option value="${p.id}"${r.player?.id === p.id ? ' selected' : ''}>${escapeHtml(playerName(p))}</option>`).join('')}`;
  };
  const counts = Object.fromEntries(Object.keys(SHEET_ST).map(k => [k, rows.filter(r => r.status === k).length]));
  document.getElementById('sheetStatus').textContent = [`${rows.length} joueurs lus pour ${parsed.team}`,
    counts.ok && `${counts.ok} reconnus`, counts.confirm && `${counts.confirm} à confirmer`, counts.choose && `${counts.choose} à choisir`,
    counts.none && `${counts.none} non reconnus`, !parsed.goalsKnown && 'buteurs non publiés sur la feuille (buts laissés vides)'].filter(Boolean).join(' · ');
  document.getElementById('sheetPreview').innerHTML = `
    ${h ? `<label class="sheet-head"><input type="checkbox" id="sheetScore"${val('m-pour') === '' ? ' checked' : ''}>
      Reporter dans la fiche : <strong>${escapeHtml(h.home)} ${h.score_home ?? '–'} – ${h.score_away ?? '–'} ${escapeHtml(h.away)}</strong>
      · ${escapeHtml(h.competition)} · ${fmtDateFr(h.date)}${h.heure ? ` · ${h.heure}` : ''}</label>` : ''}
    ${counts.confirm ? '<button class="btn btn-sm" type="button" id="sheetConfirmAll">Tout confirmer</button>' : ''}
    <div class="sheet-wrap"><table class="table sheet-table">
      <thead><tr><th scope="col"><span class="sr-only">Retenu</span></th><th scope="col">Feuille</th><th scope="col">Fiche du club</th>
        <th scope="col">Statut</th><th scope="col">Min</th><th scope="col">Buts</th><th scope="col">Cartons</th></tr></thead>
      <tbody>${rows.map((r, i) => `<tr class="${r.on ? '' : 'is-off'}">
        <td><input type="checkbox" data-sheet-on="${i}" aria-label="Retenir ${escapeHtml(r.name)}"${r.on ? ' checked' : ''}${r.player ? '' : ' disabled'}></td>
        <td><span class="sheet-num">${r.numero}</span> ${escapeHtml(r.name)} <span class="fff-st ${SHEET_ST[r.status][1]}">${SHEET_ST[r.status][0]}</span></td>
        <td><select data-sheet-player="${i}" aria-label="Fiche du club pour ${escapeHtml(r.name)}">${options(r)}</select></td>
        <td>${STATUT_MATCH_LABEL[r.statut]}${r.entre != null && r.statut === 'remplacant' ? ` (${r.entre}e)` : ''}</td>
        <td>${num(msMinutes(r, dur))}</td><td>${num(r.buts)}</td>
        <td>${r.cartons_jaunes ? `<span class="card-y" title="Carton jaune">${r.cartons_jaunes}</span>` : ''}${r.carton_rouge ? '<span class="card-r" title="Carton rouge">R</span>' : ''}${!r.cartons_jaunes && !r.carton_rouge ? '—' : ''}</td>
      </tr>`).join('')}</tbody></table></div>`;
  document.getElementById('sheetApply').classList.toggle('hidden', !rows.some(r => r.on && r.player));
}

function sheetApply() {
  const dur = sheetDur();
  let n = 0;
  for (const r of SHEET.rows.filter(x => x.on && x.player)) {
    addRow(r.player.id);
    const row = editing.rows.get(r.player.id);
    const vals = { statut: r.statut, minutes: msMinutes(r, dur), buts: r.buts, cartons_jaunes: r.cartons_jaunes, carton_rouge: r.carton_rouge };
    Object.entries(vals).forEach(([k, v]) => { if (v !== null && v !== undefined) row[k] = v; });   // absent de la feuille : on garde la saisie
    row.ext_data = { source: 'fff-feuille', ...vals };
    n++;
  }
  const h = SHEET.parsed.head, side = SHEET.parsed.side;
  if (h && document.getElementById('sheetScore')?.checked && (side === 'home' || side === 'away')) {
    const inc = fffIncoming(h, side), set = (id, v, always) => { const e = document.getElementById(id); if (v != null && (always || !e.value)) e.value = v; };
    set('m-pour', inc.score_pour, true); set('m-contre', inc.score_contre, true);
    set('m-adv', inc.adversaire); set('m-date', inc.date_match); set('m-heure', inc.heure); set('m-comp', inc.competition); set('m-lieu', inc.lieu);
  }
  renderRows();
  closeModal('sheetModal');
  toast(`${n} joueur${n > 1 ? 's' : ''} prérempli${n > 1 ? 's' : ''} : vérifiez, puis « Enregistrer ».`, 'success');
}

(function initSheet() {
  document.getElementById('btnSheet').addEventListener('click', openSheet);
  document.getElementById('sheetAnalyse').addEventListener('click', sheetAnalyse);
  document.getElementById('sheetApply').addEventListener('click', sheetApply);
  document.getElementById('sheetDuree').addEventListener('input', () => { if (SHEET.rows.length) sheetRender(); });
  const box = document.getElementById('sheetPreview');
  box.addEventListener('change', (e) => {
    const on = e.target.dataset.sheetOn, pick = e.target.dataset.sheetPlayer;
    if (on != null) SHEET.rows[Number(on)].on = e.target.checked;
    if (pick != null) {
      const r = SHEET.rows[Number(pick)];
      r.player = clubPlayers.find(p => p.id === Number(e.target.value)) || null;
      r.on = !!r.player;
      if (r.player) r.status = 'ok';   // choisi par le staff
    }
    sheetRender();
  });
  box.addEventListener('click', (e) => {
    if (!e.target.closest('#sheetConfirmAll')) return;
    SHEET.rows.filter(r => r.status === 'confirm').forEach(r => { r.on = true; r.status = 'ok'; });
    sheetRender();
  });
})();
