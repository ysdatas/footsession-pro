/* ============================================================
   LMFC Performance — suivi-rpe-remind.js (suivi-rpe)
   Relances RPE (lmfc_v50.sql) : une cloche sur chaque case « … » (le
   joueur peut encore répondre, il a un compte) et « Notifier toute
   l'équipe – RPE du jour » (la dernière journée encore ouverte de
   l'équipe affichée). La base choisit les destinataires, trace la
   relance et refuse les doublons (12 h) ; le Worker (/api/push/rpe)
   livre sur les téléphones et rend compte. La page n'envoie que des
   identifiants. Sans lmfc_v50.sql : ni cloche ni bouton.
   SR.remind : Map « séance:joueur » → dernière relance { at, delivered }.
   Dépend de suivi-rpe-page.js (SR, srKey…), app.js, supabase-client.js (siteApi).
   ============================================================ */

const SR_REMIND_ROLES = ['admin', 'coach', 'prepa', 'analyste'];
const SR_REMIND_H = 12;   // = rpe_remind_take : pas de deuxième relance reçue avant 12 h
const SR_WHY = { non_suivi: 'pas dans vos joueurs', non_concerne: 'pas concerné', deja_repondu: 'a déjà répondu', sans_compte: 'pas de compte joueur',
  deja_relance: `déjà relancé (moins de ${SR_REMIND_H} h)`, sans_appareil: 'notifications non activées sur son téléphone', injoignable: 'téléphone injoignable' };
const SR_BELL = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';
const srCanRemind = () => SR.remind != null && SR_REMIND_ROLES.includes(window.CURRENT_PROFILE?.role);
const srTime = (iso) => new Date(iso).toLocaleString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/* Relances des 15 derniers jours (au-delà, la saisie est fermée) ; la RLS ne rend que les joueurs suivis. */
async function srRemindLoad() {
  const { data, error } = await sb.from('rpe_reminders').select('session_id, match_id, player_id, sent_at, delivered')
    .gte('sent_at', srDays(srToday(), -15)).order('sent_at');
  if (error) {
    if (!['42P01', 'PGRST205'].includes(error.code)) console.warn('Relances RPE illisibles', error);
    return null;
  }
  return new Map(data.map(r => [srKey(r.match_id ? `m${r.match_id}` : r.session_id, r.player_id), { at: r.sent_at, delivered: r.delivered }]));
}

/* Relance récente qui bloque la suivante (comme la base) : reçue, ou livraison en cours. */
const srRecent = (r) => r && r.delivered !== 0 && Date.now() - new Date(r.at) < SR_REMIND_H * 3600e3;
/* Case relançable : en attente, saisie ouverte (heure comprise), compte lié. */
const srRemindable = (c, s, p) => c === 'wait' && srCanRemind() && !!p.auth_user_id && rpeOpen(s.date_seance, s.heure);

/* La cloche d'une case « … », ou rien. */
function srBellHtml(c, j, i) {
  const s = SR.sessions[j], p = SR.players[i];
  if (!srRemindable(c, s, p)) return '';
  const r = SR.remind.get(srKey(s.key, p.id)), sent = srRecent(r);
  const last = r ? ` (dernière relance : ${srTime(r.at)}${r.delivered === 0 ? ', non reçue' : ''})` : '';
  return `<button type="button" class="sr-bell${sent ? ' is-sent' : ''}" data-sr-bell="${j}:${i}"${sent ? ' aria-disabled="true"' : ''}
    aria-label="${escapeHtml(sent ? `${playerFullName(p)} : relancé ${srTime(r.at)}` : `Relancer ${playerFullName(p)} pour ${srWhen(s)}${last}`)}"
    title="${escapeHtml(sent ? `Relancé ${srTime(r.at)}` : `Relancer${last}`)}">${SR_BELL}</button>`;
}

/* Envoi par paquets de 12 (limite du Worker) → { sent: [{ player_id, delivered }], skipped: [{ player_id, reason }] }. */
async function srRemindSend(s, ids) {
  const out = { sent: [], skipped: [] };
  for (let k = 0; k < ids.length; k += 12) {
    const r = await siteApi('push/rpe', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: s.match ? 'match' : 'seance', id: s.id, players: ids.slice(k, k + 12) }) }, 'Notifications');
    out.sent.push(...r.sent);
    out.skipped.push(...r.skipped);
  }
  return out;
}
/* Compte rendu par joueur : notifié, ou la raison. */
const srOutcome = (out) => [...out.sent.map(x => ({ id: x.player_id, ok: x.delivered > 0, why: x.delivered > 0 ? '' : 'injoignable' })),
  ...out.skipped.map(x => ({ id: x.player_id, ok: false, why: x.reason }))];
const srName = (id) => { const p = SR.players.find(x => x.id === id); return p ? playerFullName(p) : `joueur ${id}`; };

async function srBellClick(b) {
  const [j, i] = b.dataset.srBell.split(':').map(Number), s = SR.sessions[j], p = SR.players[i];
  const r = SR.remind.get(srKey(s.key, p.id));
  if (b.getAttribute('aria-disabled') === 'true') return toast(`${playerFullName(p)} a été relancé ${srTime(r.at)} : nouvelle relance possible ${SR_REMIND_H} h après.`);
  if (b.disabled) return;
  b.disabled = true;
  try {
    const [o] = srOutcome(await srRemindSend(s, [p.id]));
    toast(o?.ok ? `Relance envoyée à ${playerFullName(p)}.` : `${playerFullName(p)} non relancé : ${SR_WHY[o?.why] || 'refusé'}.`, o?.ok ? 'success' : 'error');
  } catch (e) {
    console.error('Relance RPE non envoyée', e);
    toast(e.message, 'error');
  }
  loadSr(true);   // la case affiche l'état enregistré par la base
}

/* « RPE du jour » : la journée la plus récente encore ouverte parmi les colonnes affichées (séances ou matchs). */
function srTodayCols() {
  const open = SR.sessions.map((s, j) => ({ s, j })).filter(({ s }) => rpeOpen(s.date_seance, s.heure));
  const day = open.at(-1)?.s.date_seance;
  return open.filter(x => x.s.date_seance === day);
}
function srTeamBtn() {
  const btn = document.getElementById('btnSrRemind');
  if (!btn) return;
  btn.classList.toggle('hidden', SR.remind === null || !SR_REMIND_ROLES.includes(window.CURRENT_PROFILE?.role));
  btn.disabled = !srCanRemind() || !srTodayCols().length;
}

async function srTeamRemind() {
  const btn = document.getElementById('btnSrRemind'), team = (window.CLUB_TEAMS || []).find(t => t.id === SR.team);
  const cols = srTodayCols().map(({ s, j }) => {
    const col = SR.players.map((p, i) => ({ p, c: SR.cells[i][j] })).filter(x => x.c === 'wait');
    const to = col.filter(x => srRemindable(x.c, s, x.p) && !srRecent(SR.remind.get(srKey(s.key, x.p.id)))).map(x => x.p);
    return { s, to, again: col.filter(x => x.p.auth_user_id && srRecent(SR.remind.get(srKey(s.key, x.p.id)))).length, noAccount: col.filter(x => !x.p.auth_user_id).length };
  });
  const total = cols.reduce((n, c) => n + c.to.length, 0);
  if (!cols.length) return toast('Aucune séance dont la saisie est encore ouverte.');
  if (!total) return toast('Aucun joueur à relancer : ils ont répondu, ont déjà été relancés ou n’ont pas de compte.');
  const lines = cols.map(c => `${c.s.match ? 'Match' : 'Séance'} « ${c.s.adversaire || c.s.titre} » ${srWhen(c.s)} : ${c.to.length} joueur${c.to.length > 1 ? 's' : ''}`
    + (c.to.length ? ` – ${c.to.map(playerFullName).join(', ')}` : '')
    + (c.again ? `. Déjà relancés : ${c.again}` : '') + (c.noAccount ? `. Sans compte : ${c.noAccount}` : '') + '.');
  if (!await confirmDialog(`Notifier l’équipe ${team?.nom || ''} – RPE du ${srShort(cols[0].s.date_seance)} ? ${total} joueur${total > 1 ? 's' : ''} sans réponse recevront un rappel sur leur téléphone.\n\n${lines.join('\n')}`, { ok: 'Envoyer' })) return;
  btn.disabled = true;
  const res = [];
  for (const c of cols.filter(x => x.to.length)) {
    try { res.push(...srOutcome(await srRemindSend(c.s, c.to.map(p => p.id)))); } catch (e) {
      console.error('Relance RPE non envoyée', e);
      res.push(...c.to.map(p => ({ id: p.id, ok: false, why: e.message })));
    }
  }
  const ok = res.filter(x => x.ok), ko = res.filter(x => !x.ok);
  document.getElementById('srRemindOut').innerHTML = `<strong>${escapeHtml(`RPE du ${srShort(cols[0].s.date_seance)} – ${team?.nom || ''}`)} :</strong>
    ${ok.length} notification${ok.length > 1 ? 's' : ''} envoyée${ok.length > 1 ? 's' : ''}${ko.length ? `, ${ko.length} échec${ko.length > 1 ? 's' : ''}` : ''}.
    ${ok.length ? `<br>Notifiés : ${escapeHtml(ok.map(x => srName(x.id)).join(', '))}.` : ''}
    ${ko.length ? `<br>Non notifiés : ${escapeHtml(ko.map(x => `${srName(x.id)} (${SR_WHY[x.why] || x.why})`).join(', '))}.` : ''}`;
  document.getElementById('srRemindOut').classList.remove('hidden');
  toast(`${ok.length} notification${ok.length > 1 ? 's' : ''} envoyée${ok.length > 1 ? 's' : ''}${ko.length ? `, ${ko.length} échec${ko.length > 1 ? 's' : ''}` : ''}.`, ko.length && !ok.length ? 'error' : 'success');
  loadSr(true);
}
