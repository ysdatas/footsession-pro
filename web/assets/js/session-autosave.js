/* ============================================================
   LMFC Performance — session-autosave.js (page séance)
   Sauvegarde automatique : chaque modification (markDirty) est
   enregistrée 0,8 s après la dernière frappe, sans bouton.
     - une seule écriture à la fois : un changement pendant un
       enregistrement en relance un juste après ; le lien de partage
       passe par la même file (exclusiveWrite) ;
     - seul ce qui a changé part (état enregistré gardé en mémoire) ;
     - indicateur : en attente, en cours, enregistré, erreur (nouvel
       essai automatique, de plus en plus espacé, et détail de l'étape
       qui a échoué) ;
     - séance modifiée ailleurs (sessions.updated_at, lmfc_v13.sql) : on
       relit la séance avant d'alerter. Si la base contient ce qu'on vient
       d'envoyer (réponse perdue, page rechargée pendant un envoi), c'était
       notre écriture et on continue. Sinon, vrai conflit : on demande
       (voir l'autre version ou garder la sienne), rien n'est écrasé seul ;
     - quitter : un lien de l'application attend la fin de
       l'enregistrement ; fermer l'onglet avec des modifications en
       attente fait prévenir le navigateur.
   L'état de la séance vit dans session-edit-page.js (procedures,
   attendance, bilans) ; présences et bilans s'enregistrent dans
   session-roster.js, les droits dans session-access.js. Lecture et
   écriture d'une ligne de procédé : procedure-time.js (procFromRow,
   procRow), avec sameValue pour comparer à la base.
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
    if (ok && !dirty) onSessionSaved();   // vidéos de la bibliothèque en attente (session-library.js)
    return ok && !dirty;
  })();
  return autosave.running;
}

/* Écriture hors sauvegarde automatique (lien de partage) : elle attend la
   sauvegarde en cours et bloque la suivante jusqu'à sa fin, pour que la
   date connue de la séance (verrou) reste juste. */
async function exclusiveWrite(fn) {
  await flushSave();
  while (autosave.running) await autosave.running;
  const job = (async () => fn())();
  autosave.running = job.then(() => !dirty, () => false).finally(() => {
    autosave.running = null;
    if (dirty) markDirty();   // ce qui a été saisi pendant ce temps part juste après
  });
  return job;
}

function saveFailed(e) {
  if (e.conflict) {
    autosave.blocked = true;
    console.warn('Séance modifiée ailleurs : sauvegarde automatique en pause', e);
    return setSaveStatus('conflict', e.message);
  }
  console.error('Séance non enregistrée', e);
  // Coupure réseau passagère : un nouvel essai immédiat, sans alarmer.
  if (!autosave.retries && isNetworkError(e.cause || e)) {
    autosave.retries++;
    setSaveStatus('saving');
    autosave.retryTimer = setTimeout(flushSave, 600);
    return;
  }
  setSaveStatus('error', e.message);
  // Nouvel essai tout seul : 2 s, 4 s, 8 s… jusqu'à 30 s entre deux essais.
  const wait = Math.min(30000, 2000 * 2 ** autosave.retries++);
  autosave.retryTimer = setTimeout(flushSave, wait);
}

const SAVE_TEXT = {
  pending: 'Modifications en attente', saving: 'Enregistrement en cours…', saved: 'Enregistré',
  error: 'Erreur d’enregistrement · Réessayer', invalid: 'Titre et date requis pour enregistrer',
  conflict: 'Modifiée par quelqu’un d’autre · choisir', new: 'Pas encore enregistrée',
};
function setSaveStatus(state, detail = '') {
  const b = document.getElementById('saveStatus');
  if (!b) return;
  b.hidden = !CAN_WRITE;
  b.dataset.state = state;
  const at = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  b.textContent = state === 'saved' ? `${SAVE_TEXT.saved} · ${at}` : SAVE_TEXT[state];
  b.title = state === 'error' ? `${detail}. Nouvel essai automatique ; cliquez pour réessayer tout de suite.`
    : state === 'conflict' ? 'Quelqu’un a enregistré cette séance depuis son ouverture. Cliquez pour choisir : voir sa version ou garder la vôtre.'
    : state === 'saved' ? `Enregistré à ${at}` : '';
}

/* À la fin de l'ouverture de la page : la sauvegarde automatique démarre. */
function startAutosave(session) {
  autosave.knownAt = session?.updated_at || null;
  // Procédé qui reçoit les chasubles d'une ancienne séance : pas encore en base, il partira au premier enregistrement.
  procedures.forEach((p, i) => { if (p.id) savedProcs.set(p.id, p._legacyTeams ? 'à enregistrer' : JSON.stringify(procRow(p, savedSessionId, i + 1))); });
  clearTimeout(autosave.timer);
  dirty = false;
  autosave.ready = true;
  setSaveStatus(savedSessionId ? 'saved' : 'new');
  if (!CAN_WRITE) return;
  document.getElementById('saveStatus').addEventListener('click', () => {
    if (autosave.blocked) return openModal('conflictModal');
    dirty = true;
    flushSave();
  });
  document.getElementById('conflictReload').addEventListener('click', () => location.reload());
  document.getElementById('conflictKeep').addEventListener('click', keepMyVersion);
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

/* Vrai conflit, choix « Garder ma version » : on reprend la date actuelle de
   la séance et on réenregistre tout ce qui est à l'écran par-dessus. */
async function keepMyVersion() {
  closeModal('conflictModal');
  const { data, error } = await sb.from('sessions').select('updated_at').eq('id', savedSessionId).maybeSingle();
  if (error || !data) return toast('Séance introuvable ou droits retirés : rechargez la page.', 'error');
  autosave.knownAt = data.updated_at;
  autosave.blocked = false;
  savedProcs.forEach((_, id) => savedProcs.set(id, 'à enregistrer'));   // tout repart, pas seulement le dernier changement
  dirty = true;
  flushSave();
}

/* ---------- Enregistrement ---------- */
/* Erreur réseau : la requête a pu arriver en base sans que la réponse revienne. */
const isNetworkError = (e) => !e?.code && /fetch|network|load failed|connexion/i.test(e?.message || String(e));
/* Une étape de l'enregistrement : son nom accompagne l'erreur affichée. */
async function step(label, fn) {
  try { return await fn(); } catch (e) {
    if (e.conflict) throw e;
    const why = isNetworkError(e) ? 'connexion interrompue' : (e.message || String(e));
    throw Object.assign(new Error(`${label} : ${why}`), { cause: e });
  }
}

/* Toute la séance : la séance d'abord (verrou sur updated_at), puis ce qui a changé. */
async function saveAll() {
  syncFromDom();
  const titre = document.getElementById('f-titre').value.trim();
  const date_seance = document.getElementById('f-date').value;
  if (!titre || !date_seance) return 'invalid';
  const heure = document.getElementById('f-heure').value;
  const sessionRow = {
    titre, date_seance,
    heure: heure ? `${heure.slice(0, 5)}:00` : null,   // relue « 18:00:00 » : même écriture, pas de faux conflit (adoptOwnWrite)
    principes_jeu: document.getElementById('f-principe').value.trim() || null,
    equipe: document.getElementById('f-equipe').value.trim() || null,
    equipes: [],   // les chasubles vivent sur chaque procédé (procedures.equipes)
    duree_min: parseDecimal(document.getElementById('f-duree').value) || 0,
    rpe_attendue: Number(document.getElementById('f-rpe-att').value) || null,   // lmfc_v34.sql
    filmee: sessionFilmee,
    notes: document.getElementById('f-notes').value.trim() || null,
    terrain,   // terrain d'effectif (session-pitch.js, lmfc_v15.sql)
  };
  if (access.ready) sessionRow.acces = access.base;
  if (hasTeams()) {
    sessionRow.team_id = sessionTeamId;
    sessionRow.equipe = teamName(sessionTeamId) || null;
  }

  let sid = savedSessionId;
  if (sid) {
    await step('Séance', async () => {
      // Verrou : la mise à jour ne passe que si personne n'a enregistré la séance depuis notre dernière lecture.
      let q = sb.from('sessions').update(sessionRow).eq('id', sid);
      if (autosave.knownAt) q = q.eq('updated_at', autosave.knownAt);
      const { data, error } = await q.select('updated_at');
      if (error) throw error;
      autosave.knownAt = data?.length ? data[0].updated_at : await adoptOwnWrite(sid, sessionRow);
    });
  } else {
    const data = await step('Séance', () => createSession(sessionRow));
    sid = savedSessionId = data.id;
    autosave.knownAt = data.updated_at;
    history.replaceState(null, '', `session-edit.html?id=${sid}`);   // recharger rouvre la séance créée
    onSessionCreated();
  }
  await step('Procédés', () => saveProcedures(sid));
  // Indépendants entre eux : en même temps.
  await Promise.all([
    step('Présences', () => saveAttendance(sid)),
    step('Bilans', () => saveBilans(sid)),
    step('Droits d’accès', () => saveAccess(sid)),
  ]);
  // En dernier : une image de schéma pas encore copiée ne retient pas le reste.
  await step('Schémas', commitDraftSchemas);
}

/* Création de la séance. Si la réponse d'un premier essai s'est perdue, la
   séance existe peut-être déjà : on la reprend au lieu d'en créer une seconde. */
let createUncertain = false;
async function createSession(row) {
  if (createUncertain) {
    const since = new Date(Date.now() - 15 * 60000).toISOString();
    const { data: found, error } = await sb.from('sessions').select('id, updated_at')
      .eq('created_by', myProfile.id).eq('titre', row.titre).eq('date_seance', row.date_seance)
      .gte('created_at', since).order('created_at', { ascending: false }).limit(1);
    if (error) throw error;
    if (found?.length) { createUncertain = false; return found[0]; }
  }
  const { data, error } = await sb.from('sessions').insert({ ...row, club_id: myProfile.club_id }).select('id, updated_at').single();
  if (error) { createUncertain = isNetworkError(error); throw error; }
  createUncertain = false;
  return data;
}

/* La mise à jour verrouillée n'a touché aucune ligne : la séance a changé
   depuis notre dernière lecture. Si elle contient exactement ce qu'on
   envoie, c'est notre propre écriture dont la réponse s'est perdue : on
   reprend sa date. Sinon, quelqu'un d'autre l'a modifiée. */
async function adoptOwnWrite(sid, sent) {
  const { data, error } = await sb.from('sessions').select(`updated_at, ${Object.keys(sent).join(', ')}`).eq('id', sid).maybeSingle();
  if (error) throw error;
  if (!data) throw Object.assign(new Error('Séance supprimée ou droits retirés.'), { conflict: true });
  if (Object.keys(sent).every(k => sameValue(data[k], sent[k]))) return data.updated_at;
  throw Object.assign(new Error('Séance modifiée par quelqu’un d’autre.'), { conflict: true });
}
/* Nouveau procédé. Réponse perdue au premier essai : on cherche d'abord la
   ligne déjà créée (même place, même nom, inconnue de la page). */
async function insertProcedure(p, row) {
  if (p._insertUncertain) {
    const { data: rows, error } = await sb.from('procedures').select('id, nom, ordre').eq('session_id', row.session_id);
    if (error) throw error;
    const known = new Set(procedures.map(x => x.id).filter(Boolean));
    const twin = (rows || []).find(r => !known.has(r.id) && !savedProcs.has(r.id) && r.ordre === row.ordre && r.nom === row.nom);
    if (twin) {
      const { error: upErr } = await sb.from('procedures').update(row).eq('id', twin.id);
      if (upErr) throw upErr;
      p._insertUncertain = false;
      return twin.id;
    }
  }
  const { data, error } = await sb.from('procedures').insert(row).select('id').single();
  if (error) { p._insertUncertain = isNetworkError(error); throw error; }
  p._insertUncertain = false;
  return data.id;
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
      p.id = await insertProcedure(p, row);
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
