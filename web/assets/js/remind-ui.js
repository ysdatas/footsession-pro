/* ============================================================
   LMFC Performance — remind-ui.js
   Relancer des joueurs (lmfc_v50.sql, lmfc_v59.sql) : RPE d'un match, avis
   après le match, vidéos pas encore regardées. Une seule fenêtre :
     1. la base fait l'aperçu (rien n'est écrit) : qui serait relancé, et
        pourquoi les autres ne le seraient pas (déjà à jour, sans compte…) ;
     2. le nombre de destinataires s'affiche ; on peut décocher un joueur
        (un seul coché : relance individuelle) ;
     3. « Envoyer » : la base trace, le Worker livre par paquets de 12 et rend
        compte : notifié, ou non reçu (téléphone injoignable) ;
     4. les dernières relances : envoyée, reçue ou non, ouverte par le joueur.
   openRemindDialog({ kind: 'rpe_match' | 'avis' | 'video', id, players: [{ id, name }], label })
   Dépend de app.js (el, toast, escapeHtml) et de supabase-client.js (siteApi).
   ============================================================ */

const REMIND_KINDS = {
  rpe_match: { title: 'Relancer : RPE du match', rpc: 'rpe_remind_take', kind: 'match', route: 'push/rpe', journal: 'rpe' },
  avis: { title: 'Relancer : avis sur le match', rpc: 'remind_take', kind: 'avis', route: 'push/remind', journal: 'avis' },
  video: { title: 'Relancer : vidéos à regarder', rpc: 'remind_take', kind: 'video', route: 'push/remind', journal: 'video' },
};
const REMIND_WHY = { non_suivi: 'pas dans vos joueurs', non_concerne: 'pas concerné', deja_repondu: 'a déjà répondu', a_jour: 'a tout regardé',
  sans_compte: 'pas de compte joueur', deja_relance: 'déjà relancé depuis moins de 12 h', sans_appareil: 'notifications non activées sur son téléphone' };
const remindTime = (iso) => new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(' ', ' à ');
const remindState = (r) => (r.delivered == null ? 'envoi en cours' : r.delivered === 0 ? 'non reçue (téléphone injoignable)' : 'reçue')
  + (r.opened_at ? `, ouverte le ${remindTime(r.opened_at)}` : '');

async function openRemindDialog({ kind, id = null, players, label = '' }) {
  const K = REMIND_KINDS[kind], name = new Map(players.map(p => [p.id, p.name])), ids = [...name.keys()];
  if (!ids.length) return toast('Aucun joueur à relancer.', 'error');
  // Aperçu (300 joueurs au plus par appel) et dernières relances, ensemble.
  const preview = { ready: [], skipped: [] };
  const journal = sb.from('rpe_reminders').select('player_id, sent_at, delivered, opened_at').eq('kind', K.journal)
    .gte('sent_at', new Date(Date.now() - 14 * 864e5).toISOString()).order('sent_at', { ascending: false }).limit(30);
  const [, hist] = await Promise.all([(async () => {
    for (let k = 0; k < ids.length; k += 300) {
      const { data, error } = await sb.rpc(K.rpc, { p_kind: K.kind, p_id: id, p_players: ids.slice(k, k + 300), p_preview: true });
      if (error) throw error;
      preview.ready.push(...data.ready);
      preview.skipped.push(...data.skipped);
    }
  })().catch(e => { preview.error = e; }), id ? journal.eq('match_id', id) : journal.in('player_id', ids)]);
  if (preview.error) return toast(/remind_take|p_preview/.test(preview.error.message || '') ? updateNeeded('lmfc_v59.sql') : preview.error.message, 'error');

  const byWhy = preview.skipped.reduce((m, s) => m.set(s.reason, [...(m.get(s.reason) || []), name.get(s.player_id) || `joueur ${s.player_id}`]), new Map());
  const list = el('div', { class: 'remind-list', role: 'group', 'aria-label': 'Joueurs relancés' });
  list.innerHTML = preview.ready.map(p => `<label><input type="checkbox" value="${p}" checked> ${escapeHtml(name.get(p) || `joueur ${p}`)}</label>`).join('')
    || '<p class="text-muted">Personne à relancer.</p>';
  const others = el('div', { class: 'remind-others' });
  others.innerHTML = [...byWhy].map(([why, who]) => `<p><strong>${escapeHtml(REMIND_WHY[why] || why)}</strong> : ${escapeHtml(who.join(', '))}</p>`).join('');
  const past = el('div', { class: 'remind-past' });
  const rows = (hist?.data || []).filter(r => name.has(r.player_id));
  past.innerHTML = rows.length ? `<h3 class="as-h4">Dernières relances</h3>${rows.slice(0, 12).map(r =>
    `<p>${escapeHtml(name.get(r.player_id))} – ${escapeHtml(remindTime(r.sent_at))} – ${escapeHtml(remindState(r))}</p>`).join('')}` : '';
  const cancel = el('button', { type: 'button', class: 'btn' }, 'Fermer');
  const go = el('button', { type: 'button', class: 'btn btn-primary' });
  const count = () => list.querySelectorAll('input:checked').length;
  const sync = () => { const n = count(); go.textContent = n ? `Envoyer à ${n} joueur${n > 1 ? 's' : ''}` : 'Envoyer'; go.disabled = !n; };
  const box = el('div', { class: 'modal-backdrop open dlg', 'data-busy': '' },
    el('div', { class: 'modal dlg-box remind-box', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'remindTitle' },
      el('h2', { class: 'as-h3', id: 'remindTitle' }, K.title),
      label && el('p', { class: 'dlg-body' }, label),
      el('p', { class: 'remind-count' }, preview.ready.length
        ? `${preview.ready.length} joueur${preview.ready.length > 1 ? 's' : ''} recevr${preview.ready.length > 1 ? 'ont' : 'a'} une notification. Décochez ceux à ne pas relancer.`
        : 'Aucun joueur à relancer pour l’instant.'),
      list, others, past, el('div', { class: 'modal-actions' }, cancel, go)));
  const back = document.activeElement;
  const close = () => { box.remove(); back?.focus?.(); };
  cancel.addEventListener('click', close);
  box.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') close(); });
  list.addEventListener('change', sync);
  go.addEventListener('click', async () => {
    const chosen = [...list.querySelectorAll('input:checked')].map(b => Number(b.value));
    go.disabled = true; cancel.disabled = true;
    const out = { sent: [], skipped: [] };
    try {
      for (let k = 0; k < chosen.length; k += 12) {
        const r = await siteApi(K.route, { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ kind: K.kind, id, players: chosen.slice(k, k + 12) }) }, 'Notifications');
        out.sent.push(...r.sent); out.skipped.push(...r.skipped);
      }
    } catch (e) {
      console.error('Relance non envoyée', e);
      toast(e.message, 'error');
    }
    const ok = out.sent.filter(x => x.delivered > 0).length, lost = out.sent.length - ok, skip = out.skipped.length;
    if (out.sent.length || skip) {
      toast([`${ok} joueur${ok > 1 ? 's' : ''} notifié${ok > 1 ? 's' : ''}`, lost && `${lost} non reçu${lost > 1 ? 's' : ''} (téléphone injoignable)`,
        skip && `${skip} non relancé${skip > 1 ? 's' : ''} (déjà à jour ou relancé entre-temps)`].filter(Boolean).join(' – '), ok ? 'success' : 'error');
    }
    close();
  });
  sync();
  document.body.append(box);
  (count() ? go : cancel).focus();
}
