/* ============================================================
   LMFC Performance — player-todo.js (mon-espace, mes-formulaires, calendrier)
   Ce que le joueur a à remplir, rangé comme il le vit : un questionnaire par
   séance ou match et par moment, toujours sous le même nom, jamais celui d'une
   équipe ni d'un réglage du staff :
     - « Questionnaire pré-séance » : courbatures du matin (le jour de la séance,
       lmfc_v35.sql) et questionnaires du jour (« j » + date, lmfc_v65.sql) ;
     - « Questionnaire après séance » : l'effort (RPE) et les questions ajoutées
       au même formulaire (lmfc_v47.sql, lmfc_v62.sql), d'un seul écran ;
     - « Questionnaire avant match » (lmfc_v65.sql) et « Questionnaire après
       match » (RPE du match, avis, questions ajoutées) ;
     - « Questionnaire du jour » sans séance ce jour-là ; un formulaire à remplir
       une fois garde son nom.
   Tout se remplit dans Mes formulaires (todo-parts.js), du jour même à deux jours
   après (lmfc_v64.sql, lmfc_v70.sql).
   ptLoad() : { items, error } ; un item : { key, kind, id, date, heure, titre,
   phase, label, parts: [{ type: 'rpe' | 'sore' | 'avis' | 'form', … }] }.
   Dépend de rpe.js (myRpeItems, rpeTodo), match-feedback.js (mfAnswered).
   ============================================================ */

const PT_LABELS = { 'seance:pre': 'Questionnaire pré-séance', 'seance:post': 'Questionnaire après séance',
  'match:pre': 'Questionnaire avant match', 'match:post': 'Questionnaire après match', 'jour:pre': 'Questionnaire du jour' };
const PT_DAYS = 2;   // = rpe_open (lmfc_v70.sql) et custom_forms_my_pending (lmfc_v64.sql)
const ptIso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const ptDay = (n = 0) => { const d = new Date(); d.setDate(d.getDate() - n); return ptIso(d); };
/* Titre montré au joueur : sans le contexte (« · Séance du 21/11 ») ni ce qui suit « — » (équipes). */
const ptTitle = (t) => String(t || 'Questionnaire').split(' · ')[0].split(' — ')[0].trim() || 'Questionnaire';
const ptExtras = (questions) => (questions || []).filter(q => !q.fixe);
const ptBefore = (f) => /^Avant le match/.test(f.titre || '');   // lmfc_v65.sql : même occurrence « m » qu'après
/* Clé d'un questionnaire : « s12:post », « m4:pre », « j2026-11-23:pre », « f88 » (une fois). */
const ptKey = (kind, id, phase) => (kind === 'libre' ? `f${id}` : `${kind === 'match' ? 'm' : kind === 'jour' ? 'j' : 's'}${id}:${phase}`);
/* « aujourd’hui à 16:30 », « hier », « samedi 21 novembre ». */
function ptWhen(item) {
  if (!item.date) return 'À remplir quand tu veux';
  const day = item.date === ptDay(0) ? 'aujourd’hui' : item.date === ptDay(1) ? 'hier'
    : new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(`${item.date}T12:00`));
  return item.heure ? `${day} à ${String(item.heure).slice(0, 5)}` : day;
}
/* « Séance Espoirs | aujourd’hui à 16:30 » : ce qui situe le questionnaire. */
const ptSub = (item) => [item.kind === 'match' ? `Match contre ${item.titre}` : item.kind === 'seance' ? item.titre || 'Séance' : '', ptWhen(item)]
  .filter(Boolean).join(' | ');

async function ptFetch() {
  const [rpe, sore, avis, fb, forms] = await Promise.all([
    myRpeItems(),
    sb.rpc('my_soreness_today'),
    sb.rpc('my_avis_matches'),
    sb.from('match_feedback').select('match_id, individuel, collectif'),
    sb.rpc('custom_forms_my_pending'),
  ]);
  const soft = (r, what, codes = ['PGRST202', '42883', '42P01', 'PGRST205']) => {
    if (r.error && !codes.includes(r.error.code)) console.warn(`À remplir : ${what} indisponible`, r.error.message);
    return r.error ? [] : r.data || [];
  };
  if (rpe.error && rpe.error.code !== 'PGRST202') console.warn('À remplir : RPE indisponible', rpe.error.message);
  return { rpe: rpe.rows || [], sore: soft(sore, 'courbatures')[0] || null, avis: soft(avis, 'avis de match'),
    feedback: soft(fb, 'réponses aux avis'), forms: soft(forms, 'questionnaires', ['PGRST202', 'PGRST203', '42883']), error: forms.error || null };
}

/* Les questionnaires à remplir, du plus urgent (aujourd'hui, l'heure, avant puis après) aux « une fois ». */
function ptBuild({ rpe, sore, avis, feedback, forms }) {
  const map = new Map(), today = ptDay(0), from = ptDay(PT_DAYS);
  const adv = (t) => String(t || '').replace(/^Match contre /, '');   // match : l'adversaire seul
  // Séance ou match connu par le RPE (noté ou non) : son titre et son heure.
  const known = (kind, id) => rpe.find(r => !!r.match === (kind === 'match') && r.id === Number(id));
  const item = (kind, id, phase, ev = {}) => {
    const key = ptKey(kind, id, phase);
    if (!map.has(key)) map.set(key, { key, kind, id, phase, label: kind === 'libre' ? ptTitle(ev.titre) : PT_LABELS[`${kind}:${phase}`], parts: [],
      titre: '', date: null, heure: null });
    const it = map.get(key), k = known(kind, id);
    it.titre ||= adv(ev.titre || k?.titre); it.heure ||= ev.heure || k?.heure || null; it.date ||= ev.date || k?.date || null;
    if (kind === 'libre') it.titre = '';
    return it;
  };
  const seances = rpe.filter(r => !r.match);
  const firstSeance = (date) => seances.filter(r => r.date === date).sort((a, b) => String(a.heure || '').localeCompare(String(b.heure || '')))[0];
  // Effort à noter (rpeTodo : ouvert, pas avant l'heure de début), avec ses questions ajoutées.
  for (const r of rpeTodo(rpe)) {
    item(r.match ? 'match' : 'seance', r.id, 'post', { titre: r.titre, date: r.date, heure: r.heure })
      .parts.push({ type: 'rpe', row: r, extras: ptExtras(r.form_questions) });
  }
  if (sore && sore.niveau == null && sore.session_id) {
    item('seance', sore.session_id, 'pre', { titre: sore.titre, date: today, heure: sore.heure })
      .parts.push({ type: 'sore', row: sore, extras: ptExtras(sore.form_questions) });
  }
  for (const a of avis) {
    if (a.date_match < from || mfAnswered(feedback.find(f => f.match_id === a.match_id))) continue;
    const match = { id: a.match_id, titre: a.titre, date: a.date_match, form_titre: a.form_titre, form_questions: a.form_questions };
    item('match', a.match_id, 'post', { titre: a.titre, date: a.date_match }).parts.push({ type: 'avis', row: match, extras: ptExtras(a.form_questions) });
  }
  for (const f of forms) {
    const occ = f.occurrence || '', ctx = String(f.titre || '').split(' · ').slice(1), day = f.jour ? String(f.jour).slice(0, 10) : null;
    const part = { type: 'form', form: f };
    if (!occ) { item('libre', f.version_id, null, { titre: f.titre }).parts.push(part); continue; }
    const id = occ.slice(1);
    if (occ[0] === 's') item('seance', Number(id), 'post', { titre: ctx[0], date: day }).parts.push(part);
    else if (occ[0] === 'm') item('match', Number(id), ptBefore(f) ? 'pre' : 'post', { titre: ctx[0], date: day }).parts.push(part);
    else {
      const s = firstSeance(id);   // questionnaire du jour : avec la séance de ce jour-là, s'il y en a une
      (s ? item('seance', s.id, 'pre', { titre: s.titre, date: s.date, heure: s.heure }) : item('jour', id, 'pre', { date: id })).parts.push(part);
    }
  }
  const order = (x) => [x.date ? 0 : 1, x.date ? -Number(x.date.replaceAll('-', '')) : 0, String(x.heure || '99'), x.phase === 'pre' ? 0 : 1];
  return [...map.values()].filter(x => x.parts.length).sort((a, b) => {
    const [p, q] = [order(a), order(b)];
    return p[0] - q[0] || p[1] - q[1] || p[2].localeCompare(q[2]) || p[3] - q[3];
  });
}

async function ptLoad() {
  const data = await ptFetch();
  return { items: ptBuild(data), error: data.error, rpe: data.rpe };
}
