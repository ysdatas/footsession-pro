/* Contrat statique des migrations et de l'interface formulaires. Le test SQL
   complet est custom-forms-sql.test.mjs (PGlite requis). */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
const migration = read('supabase/lmfc_v44.sql');
const answersMigration = read('supabase/lmfc_v45.sql');
const page = read('web/formulaires.html');
const js = read('web/assets/js/formulaires-page.js');
const editor = read('web/assets/js/formulaires-editor.js');
const css = read('web/assets/css/formulaires.css');
const playerPage = read('web/mes-formulaires.html');
const playerJs = read('web/assets/js/mes-formulaires-page.js');
const playerHome = read('web/assets/js/player-home.js');
const readme = read('README.md');

for (const table of ['custom_forms', 'custom_form_versions', 'custom_form_teams']) {
  assert.match(migration, new RegExp(`create table if not exists public\\.${table}`), `${table} créée`);
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`), `${table} sous RLS`);
}
assert.match(migration, /create or replace function public\.custom_form_save/);
assert.match(migration, /unique \(form_id, version_no\)/, 'les versions sont conservées distinctement');
assert.match(migration, /Seul un administrateur peut modifier un formulaire partagé avec une équipe hors de votre périmètre/);
assert.match(migration, /Désactiver|actif/, 'les formulaires se désactivent sans suppression');
assert.match(page, /data-cf-new/);
assert.match(page, /id="cfTeams"/);
assert.match(js, /p_expected_version/);
assert.match(js, /p_team_ids/);
assert.match(js, /cfError/);
assert.match(js, /cfLocalPreview/);
assert.match(js, /getElementById\('cfEditor'\)\.classList\.contains\('open'\)/, 'la fenêtre ouverte se reconnaît à .open, comme partout');
assert.doesNotMatch(js, /!allowed\.size/, 'sans équipe, un préparateur n’a aucune équipe à choisir');
assert.match(js, /if \(CF\.demo\)/, 'l’aperçu local n’envoie pas les modifications à Supabase');
assert.match(css, /@media\(max-width:640px\)/, "l'interface s'adapte au téléphone");
assert.match(readme, /62\. supabase\/lmfc_v44\.sql/);
assert.match(answersMigration, /create table if not exists public\.custom_form_responses/);
assert.match(answersMigration, /alter table public\.custom_form_responses enable row level security/);
assert.match(answersMigration, /create or replace function public\.custom_form_submit/);
assert.match(answersMigration, /on conflict \(form_version_id, player_id\) do nothing/);
assert.match(answersMigration, /questions_snapshot/);
assert.match(answersMigration, /public\.team_level\(p_team\) <> 'aucun'/, 'le coach voit seulement ses équipes');
assert.match(playerPage, /id="mfPending"/);
assert.match(playerPage, /id="mfHistory"/);
assert.match(playerJs, /custom_forms_my_pending/);
assert.match(playerJs, /custom_forms_my_history/);
assert.match(playerJs, /custom_form_submit/);
assert.match(playerJs, /MF\.demo/);
assert.match(playerHome, /custom_forms_my_pending/);
assert.match(js, /custom_form_responses/);
assert.match(js, /\.range\(from, from \+ CF_PAGE - 1\)/, 'le staff retrouve toutes les réponses, page par page');
assert.match(page, /id="cfResponsesMore"/);
assert.match(playerJs, /p_offset: MF\.history\.length/, 'le joueur retrouve tout son historique');
assert.match(playerJs, /getElementById\('mfHistoryMore'\)\.addEventListener/, 'le bouton est relié');
assert.match(page, /formulaires-editor\.js[\s\S]*formulaires-page\.js/, 'l’éditeur est chargé avant la page qui le relie');
assert.match(js, /custom_form_duplicate/, 'une copie n’est créée qu’à l’enregistrement');
assert.match(editor, /copy_of: found\.id/);
assert.match(editor, /x\.fixe\)/, 'une question d’origine garde tout, sauf son intitulé');
assert.match(playerJs, /p_occurrence: form\.dataset\.mfOccurrence/, 'les questions ajoutées désignent leur séance');
assert.match(readme, /65\. supabase\/lmfc_v47\.sql/);
assert.match(js, /CF\.responseOnly/);
assert.match(readme, /63\. supabase\/lmfc_v45\.sql/);
console.log('custom-forms-contract : OK');
