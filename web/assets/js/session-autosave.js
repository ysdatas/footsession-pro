/* ============================================================
   LMFC Performance — session-autosave.js (page séance)
   Sauvegarde automatique : chaque modification (markDirty) est
   enregistrée 0,8 s après la dernière frappe, sans bouton.
     - une seule sauvegarde à la fois : un changement pendant un
       enregistrement en relance une juste après, jamais en parallèle ;
     - seul ce qui a changé part (état enregistré gardé en mémoire) ;
     - indicateur : en attente, enregistrement, enregistré, erreur
       (nouvel essai automatique, de plus en plus espacé) ;
     - séance modifiée ailleurs (sessions.updated_at, lmfc_v13.sql) :
       la sauvegarde s'arrête au lieu d'écraser, il faut recharger ;
     - quitter : un lien de l'application attend la fin de
       l'enregistrement ; fermer l'onglet avec des modifications en
       attente fait prévenir le navigateur.
   L'état de la séance vit dans session-edit-page.js (procedures,
   attendance, bilans) ; présences et bilans s'enregistrent dans
   session-roster.js, les droits dans session-access.js.
   ============================================================ */

const AUTOSAVE_DELAY = 800;
const autosave = { ready: false, timer: null, running: null, again: false, retries: 0, retryTimer: null, blocked: false, knownAt: null };
let dirty = false;                 // modifications pas encore enregistrées
const savedProcs = new Map();      // id du procédé → ligne telle qu'enregistrée (JSON)
const savePending = () => dirty || !!autosave.running;

function markDirty() {
  dirty = true;
  if (!autosave.ready || !CAN_WRITE || autosave.blocked) return;
  setSaveStatus('pending');
  clearTimeout(autosave.timer);
  autosave.timer = setTimeout(flushSave, AUTOSAVE_DELAY);
}

/* Enregistre maintenant ce qui est en attente. Renvoie vrai si tout est
   enregistré (ou s'il n'y avait rien à faire). */
function flushSave() {
  clearTimeout(autosave.timer);
  clearTimeout(autosave.retryTimer);
  if (autosave.running) { if (dirty) autosave.again = true; return autosave.running; }
  if (!dirty || !CAN_WRITE || autosave.blocked) return Promise.resolve(!dirty);
  autosave.running = (async () => {
    let ok = true;
    do {
      autosave.again = false;
      dirty = false;   // ce qui changera pendant l'enregistrement repartira au tour suivant
      setSaveStatus('saving');
      try {
        if (await saveAll() === 'invalid') { dirty = true; ok = false; setSaveStatus('invalid'); break; }
        autosave.retries = 0;
      } catch (e) {
        dirty = true; ok = false;
        saveFailed(e);
        break;
      }
    } while (autosave.again);
    autosave.running = null;
    if (ok) setSaveStatus(dirty ? 'pending' : 'saved');
    return ok && !dirty;
  })();
  return autosave.running;
}

function saveFailed(e) {
  if (e.conflict) {
    autosave.blocked = true;
    console.warn('Séance modifiée ailleurs : sauvegarde automatique arrêtée', e);
    return setSaveStatus('conflict');
  }
  console.error('Séance non enregistrée', e);
  setSaveStatus('error', e.message);
  // Nouvel essai tout seul : 2 s, 4 s, 8 s… jusqu'à 30 s entre deux essais.
  const wait = Math.min(30000, 2000 * 2 ** autosave.retries++);
  autosave.retryTimer = setTimeout(flushSave, wait);
}

const SAVE_TEXT = {
  pending: 'Modifications en attente…', saving: 'Enregistrement…', saved: 'Enregistré',
  error: 'Non enregistré · réessayer', invalid: 'Titre et date requis pour enregistrer',
  conflict: 'Modifiée ailleurs · recharger', new: 'Pas encore enregistrée',
};
function setSaveStatus(state, detail = '') {
  const b = document.getElementById('saveStatus');
  if (!b) return;
  b.hidden = !CAN_WRITE;
  b.dataset.state = state;
  const at = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  b.textContent = state === 'saved' ? `${SAVE_TEXT.saved} · ${at}` : SAVE_TEXT[state];
  b.title = state === 'error' ? `Erreur : ${detail}. Cliquez pour réessayer.`
    : state === 'conflict' ? 'Quelqu’un d’autre a enregistré cette séance depuis son ouverture. Rechargez pour voir sa version : rien n’a été écrasé.'
    : state === 'saved' ? `Enregistré à ${at}` : '';
}

/* À la fin de l'ouverture de la page : la sauvegarde automatique démarre. */
function startAutosave(session) {
  autosave.knownAt = session?.updated_at || null;
  procedures.forEach((p, i) => { if (p.id) savedProcs.set(p.id, JSON.stringify(procRow(p, savedSessionId, i + 1))); });
  clearTimeout(autosave.timer);
  dirty = false;
  autosave.ready = true;
  setSaveStatus(savedSessionId ? 'saved' : 'new');
  if (!CAN_WRITE) return;
  document.getElementById('saveStatus').addEventListener('click', () => {
    if (autosave.blocked) return location.reload();
    dirty = true;
    flushSave();
  });
  // Fermer l'onglet ou recharger : le navigateur prévient s'il reste quelque chose à enregistrer.
  window.addEventListener('beforeunload', (e) => { if (savePending()) { flushSave(); e.preventDefault(); e.returnValue = ''; } });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSave(); });
  // Lien de l'application (menu, retour, fiche joueur) : on enregistre d'abord, puis on part.
  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[href]');
    if (!a || !savePending() || a.target === '_blank' || a.hasAttribute('download')) return;
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (a.getAttribute('href').startsWith('#') && a.id !== 'logoutLink') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    flushSave().then(ok => {
      if (ok) a.click();
      else toast('Séance non enregistrée : corrigez l’erreur avant de quitter la page.', 'error');
    });
  }, true);
}

/* ---------- Enregistrement ---------- */
/* Ligne d'un procédé telle qu'envoyée à la base (et comparée à la dernière enregistrée). */
function procRow(p, sid, ordre) {
  return {
    session_id: sid, ordre, nom: (p.nom || '').trim() || 'Procédé', duree_min: p.duree_min || 0,
    objectif: p.objectif || null, effectif: p.effectif || null,
    taille_terrain: p.taille_terrain || null, consignes: p.consignes || null,
    principes_jeu: p.principes_jeu || null, comportements_individuels: p.comportements_individuels || null,
    temps_recup_min: p.temps_recup_min === '' ? null : p.temps_recup_min,
    type_procede: p.type_procede || null,
    nb_sequences: p.nb_sequences === '' ? null : p.nb_sequences,
    duree_sequence_min: p.duree_sequence_min === '' ? null : p.duree_sequence_min,
    equipes: (p.equipes || []).map(t => ({ nom: (t.nom || '').trim() || 'Équipe', couleur: t.couleur, player_ids: t.player_ids })),
    staff: (p.staff || []).map(m => ({ nom: (m.nom || '').trim(), role: (m.role || '').trim() })).filter(m => m.nom || m.role),
    filme: p.filme === false ? false : null,
  };
}

/* Toute la séance : la séance d'abord (verrou sur updated_at), puis ce qui a changé. */
async function saveAll() {
  syncFromDom();
  const titre = document.getElementById('f-titre').value.trim();
  const date_seance = document.getElementById('f-date').value;
  if (!titre || !date_seance) return 'invalid';
  const sessionRow = {
    titre, date_seance,
    principes_jeu: document.getElementById('f-principe').value.trim() || null,
    equipe: document.getElementById('f-equipe').value.trim() || null,
    equipes: [],   // les chasubles vivent sur chaque procédé (procedures.equipes)
    duree_min: parseDecimal(document.getElementById('f-duree').value) || 0,
    filmee: sessionFilmee,
    notes: document.getElementById('f-notes').value.trim() || null,
  };
  if (access.ready) sessionRow.acces = access.base;
  if (hasTeams()) {
    sessionRow.team_id = sessionTeamId;
    sessionRow.equipe = teamName(sessionTeamId) || null;
  }

  let sid = savedSessionId;
  if (sid) {
    // Verrou : la mise à jour ne passe que si personne n'a enregistré la séance depuis notre dernière lecture.
    let q = sb.from('sessions').update(sessionRow).eq('id', sid);
    if (autosave.knownAt) q = q.eq('updated_at', autosave.knownAt);
    const { data, error } = await q.select('updated_at');
    if (error) throw error;
    if (!data?.length) throw Object.assign(new Error('Séance modifiée ailleurs ou droits retirés.'), { conflict: true });
    autosave.knownAt = data[0].updated_at;
  } else {
    const { data, error } = await sb.from('sessions').insert({ ...sessionRow, club_id: myProfile.club_id }).select('id, updated_at').single();
    if (error) throw error;
    sid = savedSessionId = data.id;
    autosave.knownAt = data.updated_at;
    history.replaceState(null, '', `session-edit.html?id=${sid}`);   // recharger rouvre la séance créée
    onSessionCreated();
  }
  await saveProcedures(sid);
  await commitDraftSchemas();
  await saveAttendance(sid);
  await saveBilans(sid);
  await saveAccess(sid);
}

/* Procédés : seuls ceux qui ont changé sont mis à jour ; les nouveaux sont
   créés, ceux qu'on a retirés vont à la corbeille. */
async function saveProcedures(sid) {
  const list = procedures;   // l'ordre au moment de l'enregistrement
  const keep = new Set();
  for (const [i, p] of list.entries()) {
    const row = procRow(p, sid, i + 1), json = JSON.stringify(row);
    if (p.id) {
      keep.add(p.id);
      if (savedProcs.get(p.id) === json) continue;
      const { error } = await sb.from('procedures').update(row).eq('id', p.id);
      if (error) throw error;
    } else {
      const { data, error } = await sb.from('procedures').insert(row).select('id').single();
      if (error) throw error;
      p.id = data.id;
      keep.add(p.id);
      refreshSchemaBox(p);   // le schéma se dessine désormais sur le procédé enregistré
    }
    savedProcs.set(p.id, json);
  }
  const gone = [...savedProcs.keys()].filter(id => !keep.has(id) && !procedures.some(p => p.id === id));
  if (gone.length) {
    const { error } = await sb.from('procedures').delete().in('id', gone);
    if (error) throw error;
    gone.forEach(id => savedProcs.delete(id));
  }
}
