/* Statut d'une séquence vidéo (web/assets/js/video-status.js), le même
   pour le joueur et le staff : Brouillon, Envoyé, Vu, Modifié, Retour ;
   et le nom par défaut d'une nouvelle séquence (jamais de doublon).
   Lancement : node tests/video-status.test.mjs */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ctx = vm.createContext({ Number, String, Math, Date });
vm.runInContext(readFileSync('web/assets/js/video-status.js', 'utf8'), ctx);
const status = (s) => vm.runInContext(`seqStatus(${JSON.stringify(s)})`, ctx);
const toSee = (s) => vm.runInContext(`seqToSee(${JSON.stringify(s)})`, ctx);

const sent = '2026-09-30T10:00:00Z', before = '2026-09-30T09:00:00Z', after = '2026-09-30T11:00:00Z';

assert.equal(status({}), 'draft', 'rien ajouté : brouillon');
assert.equal(status({ player_note: 'Je presse trop tard', drawings: [{ t: 3, shapes: [] }] }), 'draft', 'pas envoyée : brouillon, même annotée');
assert.equal(status({ submitted_at: sent }), 'sent', 'envoyé, pas encore ouvert');
assert.equal(status({ submitted_at: sent, seen_at: after }), 'seen', 'ouvert par le staff après l’envoi');
assert.equal(status({ submitted_at: after, seen_at: sent }), 'sent', 'renvoyé après avoir été vu : de nouveau « envoyé »');
assert.equal(status({ submitted_at: sent, edited_at: before }), 'sent', 'modifié avant l’envoi : rien à renvoyer');
assert.equal(status({ submitted_at: sent, edited_at: sent }), 'sent', 'même instant (même requête) : envoyé');
assert.equal(status({ submitted_at: sent, edited_at: after }), 'modified', 'changé depuis l’envoi : à renvoyer');
assert.equal(status({ submitted_at: sent, feedback_at: after, seen_at: after }), 'answered', 'le staff a répondu');
assert.equal(status({ submitted_at: after, feedback_at: sent }), 'sent', 'renvoyé après le retour : le staff doit revoir');
assert.equal(status({ submitted_at: sent, feedback_at: after, edited_at: after }), 'modified', 'modifié après le retour : à renvoyer');

// Ce que le staff doit voir : envoyé et sans retour postérieur.
assert.equal(toSee({}), false);
assert.equal(toSee({ submitted_at: sent }), true);
assert.equal(toSee({ submitted_at: sent, seen_at: after }), true, 'vu mais pas encore commenté');
assert.equal(toSee({ submitted_at: sent, feedback_at: after }), false, 'déjà commenté');
assert.equal(toSee({ submitted_at: after, feedback_at: sent }), true, 'renvoyé depuis le retour');

// Nom par défaut : le numéro suivant, même après une suppression ou un renommage.
const next = (seqs) => vm.runInContext(`nextSeqLabel(${JSON.stringify(seqs)})`, ctx);
assert.equal(next([]), 'Séquence 1');
assert.equal(next([{ label: 'Séquence 1' }, { label: 'Séquence 3' }]), 'Séquence 4', 'après une suppression : pas de doublon');
assert.equal(next([{ label: 'Pressing côté droit' }]), 'Séquence 2', 'une séquence renommée compte quand même');
assert.equal(next([{ label: 'Séquence 2 – Sacha' }]), 'Séquence 3', 'anciens noms avec le prénom');

console.log('video-status.test.mjs : OK');
