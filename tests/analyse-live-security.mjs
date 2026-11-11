/* Clips réservés au staff (lmfc_v49.sql) : contrôle sur un VRAI projet Supabase
   de test, avec deux comptes réellement distincts, par l'API publique (celle
   que le navigateur d'un joueur peut appeler, avec ou sans l'application).

   Ce test n'est PAS lancé avec les autres : il lui faut un projet de test où
   toutes les migrations sont passées, un compte staff (admin, coach ou
   analyste) et le compte d'un joueur qui a au moins une vidéo que ce staff
   peut modifier. Il refuse de tourner sur le projet de production.

   Lancement (les mots de passe restent dans votre terminal, jamais dans un fichier) :
     SUPABASE_TEST_URL=https://xxxx.supabase.co SUPABASE_TEST_KEY=clé-publique \
     STAFF_EMAIL=… STAFF_PASSWORD=… PLAYER_EMAIL=… PLAYER_PASSWORD=… \
     node tests/analyse-live-security.mjs

   Il crée un clip réservé au staff, vérifie que le joueur ne le voit et ne le
   touche par aucune voie (tables, fonctions, corbeille), le démasque, le
   remasque, puis le supprime. Rien d'autre n'est modifié : chaque écriture
   tentée par le joueur vise ce clip et lui seul. */
import { readFileSync } from 'node:fs';

const env = (k) => { const v = process.env[k]; if (!v) { console.error(`Variable ${k} manquante (voir l'en-tête de ce fichier).`); process.exit(2); } return v; };
const URL_ = env('SUPABASE_TEST_URL').replace(/\/$/, ''), KEY = env('SUPABASE_TEST_KEY');
const prod = /https:\/\/[a-z0-9]+\.supabase\.co/.exec(readFileSync(new URL('../web/assets/js/supabase-client.js', import.meta.url), 'utf8'))?.[0];
if (prod && URL_ === prod) { console.error('Refusé : SUPABASE_TEST_URL est le projet de PRODUCTION. Utilisez un projet de test.'); process.exit(2); }

async function signIn(email, password) {
  const r = await fetch(`${URL_}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: KEY, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const j = await r.json();
  if (!r.ok) throw new Error(`Connexion de ${email} refusée : ${j.error_description || j.msg || r.status}`);
  return { token: j.access_token, uid: j.user.id };
}
/* Appel de l'API REST au nom d'un compte. Rend { status, body }. */
function api(who) {
  return async (method, path, body) => {
    const r = await fetch(`${URL_}/rest/v1/${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body),
      headers: { apikey: KEY, authorization: `Bearer ${who.token}`, 'content-type': 'application/json', prefer: 'return=representation' } });
    const text = await r.text();
    let json = null; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    return { status: r.status, body: json };
  };
}

let failed = 0;
const check = (ok, label, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'OK    ' : 'ÉCHEC '} ${label}${ok || !detail ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`); };
const empty = (r) => r.status >= 400 || (Array.isArray(r.body) && r.body.length === 0);

const staffAcc = await signIn(env('STAFF_EMAIL'), env('STAFF_PASSWORD')), playerAcc = await signIn(env('PLAYER_EMAIL'), env('PLAYER_PASSWORD'));
if (staffAcc.uid === playerAcc.uid) { console.error('Les deux comptes sont le même : il en faut deux distincts.'); process.exit(2); }
const staff = api(staffAcc), player = api(playerAcc);

// Une vidéo du joueur, vue par lui-même : c'est sur elle que le staff crée le clip.
const vids = await player('GET', 'player_videos?select=id,player_id,club_id&limit=1');
if (!vids.body?.length) { console.error('Le compte joueur ne voit aucune vidéo à lui : envoyez-lui une vidéo sur le projet de test.'); process.exit(2); }
const video = vids.body[0], TAG = `__test_securite_${Date.now()}__`;
const visibleBefore = (await player('GET', 'video_sequences?select=id')).body?.length ?? 0;

const created = await staff('POST', 'rpc/save_sequence_code', { p_sequence_id: null, p_video_id: video.id, p_label: 'Test sécurité', p_start: 1, p_end: 2,
  p_code: { action: 'passe', resultat: 'ok', tags: [TAG] } });
if (created.status !== 200) { console.error('Le compte staff n\'a pas pu créer le clip (droits sur ce joueur ? lmfc_v49.sql passée ?) :', created.body); process.exit(2); }
const id = created.body, one = `video_sequences?id=eq.${id}`;
const asStaff = async () => (await staff('GET', `${one}&select=label,staff_only,start_sec`)).body?.[0];

try {
  check((await asStaff())?.staff_only === true, 'créé depuis l\'Analyse : réservé au staff');
  // --- Le joueur, par les tables ---
  check(empty(await player('GET', one)), 'joueur : ne lit pas le clip par son identifiant');
  const all = await player('GET', 'video_sequences?select=id');
  check(all.status === 200 && !all.body.some(s => s.id === id) && all.body.length === visibleBefore, 'joueur : sa liste de séquences est inchangée, sans le clip', all.body?.length);
  check(empty(await player('GET', `video_sequences?video_id=eq.${video.id}&staff_only=eq.true`)), 'joueur : aucun clip réservé au staff, même en le demandant');
  check(empty(await player('GET', 'sequence_codes?select=sequence_id')), 'joueur : aucun codage');
  check(empty(await player('GET', `sequence_codes?tags=cs.{${TAG}}`)), 'joueur : aucun codage, même par le tag');
  check(empty(await player('GET', 'sequence_descriptors?select=id')), 'joueur : pas de catalogue de descripteurs');
  check(empty(await player('GET', 'trash?select=id&limit=1')), 'joueur : pas de corbeille');
  check(empty(await player('PATCH', one, { staff_only: false })), 'joueur : ne démasque pas le clip');
  check(empty(await player('PATCH', one, { label: 'vu', start_sec: 0 })), 'joueur : ne modifie pas le clip');
  check(empty(await player('DELETE', one)), 'joueur : ne supprime pas le clip');
  const mine = await player('POST', 'video_sequences', { club_id: video.club_id, player_id: video.player_id, video_id: video.id, start_sec: 1, end_sec: 2, staff_only: true });
  check(mine.status >= 400, 'joueur : ne crée pas de clip réservé au staff', mine.body);
  if (mine.status < 300 && mine.body?.[0]?.id) await staff('DELETE', `video_sequences?id=eq.${mine.body[0].id}`);   // ne rien laisser derrière un échec
  // --- Le joueur, par les fonctions ---
  const rpc = (fn, args) => player('POST', `rpc/${fn}`, args);
  check((await rpc('save_sequence_code', { p_sequence_id: id, p_video_id: video.id, p_label: null, p_start: 0, p_end: 9, p_code: {} })).status >= 400, 'joueur : save_sequence_code refusée');
  check((await rpc('bulk_update_sequence_codes', { p_ids: [id], p_set: {}, p_add_tags: ['x'], p_remove_tags: null })).status >= 400, 'joueur : bulk_update_sequence_codes refusée');
  const undo = await rpc('undo_sequence_changes', { p_changes: [{ sequence_id: id, before: { tags: [] }, after: { tags: [TAG] } }] });
  check(undo.status >= 400 || undo.body?.restored === 0, 'joueur : undo_sequence_changes ne défait rien', undo.body);
  const ren = await rpc('rename_sequence_tag', { p_old: TAG, p_new: 'x' });
  check(ren.status >= 400 || ren.body === 0, 'joueur : rename_sequence_tag ne renomme rien', ren.body);
  const patch = await rpc('sequence_code_patch', { p_sequence_id: id, p_patch: { tags: [] } });
  check(patch.status >= 400 || patch.body === false, 'joueur : sequence_code_patch n\'écrit rien', patch.body);
  // --- Rien n'a bougé, vu par le staff ---
  const s = await asStaff(), c = (await staff('GET', `sequence_codes?sequence_id=eq.${id}&select=tags,action`)).body?.[0];
  check(s?.label === 'Test sécurité' && s?.staff_only === true && Number(s?.start_sec) === 1, 'staff : le clip est intact', s);
  check(c?.action === 'passe' && c?.tags?.length === 1 && c.tags[0] === TAG, 'staff : le codage est intact', c);
  // --- La règle suit la colonne : démasqué par le staff (écriture directe, hors interface), puis remasqué ---
  const mask = (v) => staff('PATCH', one, { staff_only: v });
  await mask(false);
  check((await player('GET', one)).body?.length === 1, 'clip démasqué par le staff : le joueur le voit');
  check(empty(await player('GET', `sequence_codes?sequence_id=eq.${id}`)), 'clip démasqué : son codage reste réservé au staff');
  await mask(true);
  check(empty(await player('GET', one)), 'clip remasqué : le joueur ne le voit plus');
} finally {
  const del = await staff('DELETE', one);   // part à la corbeille du projet de test
  check(del.status < 300, 'nettoyage : clip de test supprimé par le staff', del.body);
}

console.log(failed ? `\n${failed} contrôle(s) en ÉCHEC : ne pas mettre en ligne.` : '\nanalyse-live-security : OK (deux comptes distincts, clip réservé au staff invisible et intouchable pour le joueur)');
process.exit(failed ? 1 : 0);
