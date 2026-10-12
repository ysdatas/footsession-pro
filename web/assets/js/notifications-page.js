/* ============================================================
   LMFC Performance — notifications-page.js (administrateur)
   Envoie un message sur le téléphone des joueurs de l'équipe
   choisie : seuls ceux qui ont activé les notifications (push.js)
   peuvent être cochés. L'envoi passe par le Worker (worker/push.js),
   par paquets de 15 joueurs, la limite d'un appel.
   « Sur cet appareil » : activer les notifications ici et s'envoyer
   un test.
   ============================================================ */

const PER_CALL = 15;   // = MAX_PLAYERS du Worker
let ntPlayers = [];    // joueurs de l'équipe, avec leur nombre d'appareils
const ntChecked = new Set();

(async () => {
  const ctx = await requireAuth();
  if (!ctx) return;
  const me = ctx.profile;
  document.getElementById('uName').textContent = me.nom || 'Utilisateur';
  document.getElementById('uRole').textContent = (ROLE_LABELS[me.role] || me.role).toUpperCase();
  document.getElementById('uAvatar').textContent = (me.nom || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  document.getElementById('logoutLink').addEventListener('click', (e) => { e.preventDefault(); logout(); });

  document.getElementById('ntPlayers').addEventListener('change', (e) => {
    const id = Number(e.target.dataset.player);
    if (e.target.checked) ntChecked.add(id); else ntChecked.delete(id);
    renderCount();
  });
  document.getElementById('ntAll').addEventListener('click', () => {
    const reachable = ntPlayers.filter(p => p.devices);
    const all = reachable.every(p => ntChecked.has(p.id));
    reachable.forEach(p => (all ? ntChecked.delete(p.id) : ntChecked.add(p.id)));
    renderPlayers();
  });
  document.getElementById('ntSend').addEventListener('click', sendToPlayers);
  document.getElementById('ntTest').addEventListener('click', sendTest);
  await Promise.all([loadPlayers(), renderDevice()]);
})();

async function loadPlayers() {
  const [pRes, sRes] = await Promise.all([
    byPlayerTeam(sb.from('players').select('id, nom, prenom, numero, auth_user_id')).order('nom'),
    sb.from('push_subscriptions').select('user_id'),
  ]);
  if (pRes.error || sRes.error) {
    console.error('Notifications : liste illisible', pRes.error || sRes.error);
    document.getElementById('ntCount').textContent = 'Les notifications ne sont pas encore disponibles. Réessayez plus tard.';
    return;
  }
  const devices = new Map();
  sRes.data.forEach(s => devices.set(s.user_id, (devices.get(s.user_id) || 0) + 1));
  ntPlayers = pRes.data.map(p => ({ ...p, devices: devices.get(p.auth_user_id) || 0 }));
  ntChecked.clear();
  ntPlayers.filter(p => p.devices).forEach(p => ntChecked.add(p.id));   // par défaut : tous ceux qui peuvent recevoir
  renderPlayers();
}

function renderPlayers() {
  const box = document.getElementById('ntPlayers');
  box.innerHTML = ntPlayers.length ? ntPlayers.map(p => {
    const status = p.devices ? `Activé${p.devices > 1 ? ` · ${p.devices} appareils` : ''}` : p.auth_user_id ? 'Pas activé' : 'Pas de compte';
    return `<label class="nt-player${p.devices ? '' : ' is-off'}">
      <input type="checkbox" data-player="${p.id}"${ntChecked.has(p.id) ? ' checked' : ''}${p.devices ? '' : ' disabled'}>
      <span>${escapeHtml(playerFullName(p))}${p.numero != null ? ` <small>n° ${p.numero}</small>` : ''}</span>
      <small class="nt-status">${status}</small>
    </label>`;
  }).join('') : '<p class="text-muted">Aucun joueur dans cette équipe.</p>';
  renderCount();
}

function renderCount() {
  const reachable = ntPlayers.filter(p => p.devices).length;
  document.getElementById('ntCount').textContent = `${reachable} joueur${reachable > 1 ? 's' : ''} sur ${ntPlayers.length} ${reachable > 1 ? 'ont' : 'a'} activé les notifications · ${ntChecked.size} coché${ntChecked.size > 1 ? 's' : ''}.`;
  document.getElementById('ntAll').textContent = reachable && ntPlayers.filter(p => p.devices).every(p => ntChecked.has(p.id)) ? 'Tout décocher' : 'Tout cocher';
  document.getElementById('ntSend').disabled = !ntChecked.size;
}

const message = () => ({
  title: document.getElementById('n-title').value.trim(),
  body: document.getElementById('n-body').value.trim(),
  url: document.getElementById('n-url').value,
});
const sendPush = (body) => siteApi('push/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, 'Service de notifications');

async function sendToPlayers() {
  const msg = message();
  if (!msg.title) { toast('Ajoute un titre au message.', 'error'); document.getElementById('n-title').focus(); return; }
  const ids = [...ntChecked];
  if (!confirm(`Envoyer « ${msg.title} » à ${ids.length} joueur${ids.length > 1 ? 's' : ''} ?`)) return;
  const btn = document.getElementById('ntSend');
  btn.disabled = true;
  const total = { devices: 0, sent: 0, users: 0, gone: 0 };
  try {
    for (let i = 0; i < ids.length; i += PER_CALL) {
      btn.textContent = `Envoi… ${Math.min(i + PER_CALL, ids.length)}/${ids.length}`;
      const r = await sendPush({ ...msg, player_ids: ids.slice(i, i + PER_CALL) });
      Object.keys(total).forEach(k => { total[k] += r[k] || 0; });
    }
    const missed = total.devices - total.sent;
    toast(`Message reçu par ${total.users} joueur${total.users > 1 ? 's' : ''}${missed ? ` · ${missed} appareil${missed > 1 ? 's' : ''} injoignable${missed > 1 ? 's' : ''}` : ''}.`, total.sent ? 'success' : 'error');
    if (total.sent) { document.getElementById('n-title').value = ''; document.getElementById('n-body').value = ''; }
    if (total.gone) await loadPlayers();   // appareils désabonnés retirés
  } catch (e) {
    console.error('Notifications : envoi impossible', e);
    toast(e.message, 'error');
  } finally {
    btn.textContent = 'Envoyer';
    btn.disabled = !ntChecked.size;
  }
}

async function renderDevice() {
  const test = document.getElementById('ntTest');
  const show = (on) => test.classList.toggle('hidden', !on);
  show(await renderPushCard(document.getElementById('pushBox'), { onChange: show }));
}

async function sendTest() {
  try {
    const r = await sendPush({ title: 'LMFC Performance', body: 'Test : les notifications fonctionnent sur cet appareil.', url: 'dashboard.html', self: true });
    toast(r.sent ? 'Test envoyé : il arrive dans quelques secondes.' : 'Aucun appareil joignable : réactive les notifications.', r.sent ? 'success' : 'error');
  } catch (e) {
    console.error('Notifications : test impossible', e);
    toast(e.message, 'error');
  }
}
