import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const nodes = new Map();
const element = () => ({ addEventListener() {}, classList: { add() {}, remove() {} } });
const context = {
  document: { getElementById(id) { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); } },
  window: { CLUB_TEAMS: [{ id: 1 }, { id: 2 }] },
  CAL: { profile: null },
  canEditTeamContent: role => ['admin', 'coach', 'analyste'].includes(role),
  escapeHtml: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
  teamName: id => ({ 1: 'Pro', 2: 'N2' })[id] || '',
};
vm.runInNewContext(readFileSync(new URL('../web/assets/js/calendar-summary.js', import.meta.url), 'utf8'), context);
const run = code => vm.runInContext(code, context);

run(`CS.editable = true; CS.fields = { lieu: 'Terrain annexe' };`);
const sessionFields = run(`csFieldsHtml({kind:'seance', id:1, team_id:1, date:'2026-11-05', row:{titre:'Entraînement', date_seance:'2026-11-05', lieu:'Terrain annexe', duree_min:90.5}})`);
assert.match(sessionFields, /data-cs-field="lieu" type="text" value="Terrain annexe"/, 'le lieu libre d’une séance est préservé');
assert.match(sessionFields, /step="0\.01"/, 'une durée décimale existante reste valide');
run(`CS.fields = { lieu: 'exterieur' };`);
const matchFields = run(`csFieldsHtml({kind:'match', id:2, team_id:1, date:'2026-11-05', row:{adversaire:'Rival', date_match:'2026-11-05', lieu:'exterieur', stade:'Stade', competition:'Coupe'}})`);
assert.match(matchFields, /data-cs-field="lieu"[\s\S]*value="exterieur" selected/, 'le match conserve son lieu normalisé');
assert.match(matchFields, /data-cs-field="stade" type="text" value="Stade" maxlength="120"/, 'le stade respecte la limite SQL');

const mayEdit = (profile, item) => {
  context.CAL.profile = profile;
  return run(`csCanEditMatch(${JSON.stringify(item)})`);
};
assert.equal(mayEdit({ id: 'a', role: 'analyste', team_ids: [] }, { team_id: null, row: { created_by: 'a' } }), false,
  'un analyste sans équipe ne modifie pas un match non attribué');
assert.equal(mayEdit({ id: 'a', role: 'analyste', team_ids: [2] }, { team_id: 2, row: {} }), true,
  'un analyste modifie un match de son équipe');
assert.equal(mayEdit({ id: 'a', role: 'analyste', team_ids: [2] }, { team_id: 1, row: {} }), false,
  'un analyste ne modifie pas un match d’une autre équipe');
assert.equal(mayEdit({ id: 'a', role: 'coach', team_ids: [] }, { team_id: null, row: { created_by: 'a' } }), true,
  'le coach garde son match sans équipe');
assert.equal(mayEdit({ id: 'a', role: 'coach', team_ids: [1] }, { team_id: 2, row: { created_by: 'a' } }), false,
  'la création ne contourne pas la portée d’équipe SQL');
assert.equal(mayEdit({ id: 'a', role: 'admin', team_ids: [] }, { team_id: 2, row: {} }), true,
  'l’administrateur conserve la portée globale');

console.log('calendar-summary-ui : OK (lieu, durée, limites, droits visibles)');
