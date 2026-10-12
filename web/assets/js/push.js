/* ============================================================
   LMFC Performance — push.js
   Notifications sur cet appareil : le site, ajouté à l'écran
   d'accueil, reçoit les messages du club même fermé (Web Push).
     - pushSupport() : 'ok' | 'install' (iPhone : ajouter d'abord le
       site à l'écran d'accueil) | 'denied' (refusées dans les
       réglages) | 'none' (navigateur trop ancien) ;
     - enablePush() : demande l'accord (au toucher), abonne l'appareil
       avec la clé du serveur (/api/push/key) et l'enregistre
       (push_subscribe, supabase/lmfc_v16.sql) ;
     - renderPushCard(box) : encart « Activer les notifications ».
   Un appareil déjà abonné est réenregistré une fois par visite :
   abonnement renouvelé par le navigateur ou autre compte connecté.
   sw.js affiche les messages ; worker/push.js les envoie.
   Dépend de supabase-client.js (sb, siteApi) et app.js (toast).
   ============================================================ */

// iPad récent : se présente comme un Mac, mais tactile.
const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
const isInstalled = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const toB64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
// Appareil déjà enregistré pour CE compte pendant cette visite.
const syncKey = (sub) => `${window.CURRENT_USER?.id}|${sub.endpoint}`;
const markSynced = (sub) => { try { sessionStorage.setItem('lmfc-push', syncKey(sub)); } catch { /* stockage bloqué */ } };

function pushSupport() {
  if (isIos() && !isInstalled()) return 'install';   // iPhone : notifications seulement depuis l'icône
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'none';
  return Notification.permission === 'denied' ? 'denied' : 'ok';
}

const saveSubscription = async (sub) => {
  const { error } = await sb.rpc('push_subscribe', {
    p_endpoint: sub.endpoint, p_p256dh: toB64u(sub.getKey('p256dh')), p_auth: toB64u(sub.getKey('auth')),
  });
  if (error) {
    console.error('Notifications : appareil non enregistré', error);
    throw new Error('Appareil non enregistré : réessaie dans un moment.');
  }
};

/* Abonnement de cet appareil s'il existe (et s'il est bien enregistré). */
async function currentPush() {
  if (pushSupport() !== 'ok' || Notification.permission !== 'granted') return null;
  const reg = await navigator.serviceWorker.register('sw.js');
  const sub = await reg.pushManager.getSubscription();
  let synced = false;
  try { synced = !!sub && sessionStorage.getItem('lmfc-push') === syncKey(sub); } catch { /* stockage bloqué */ }
  if (sub && !synced) { await saveSubscription(sub); markSynced(sub); }
  return sub;
}

/* À appeler directement depuis le toucher : iOS l'exige pour demander l'accord. */
async function enablePush() {
  if (await Notification.requestPermission() !== 'granted') return false;
  const reg = await navigator.serviceWorker.register('sw.js');
  await navigator.serviceWorker.ready;
  const { key } = await siteApi('push/key', {}, 'Service de notifications');
  let sub = await reg.pushManager.getSubscription();
  const subKey = sub?.options?.applicationServerKey;
  if (sub && subKey && toB64u(subKey) !== key) { await sub.unsubscribe(); sub = null; }   // ancienne clé du serveur
  try {
    sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64u(key) });
  } catch (e) {
    console.error('Notifications : abonnement refusé par le navigateur', e);
    throw new Error('L’appareil a refusé les notifications : autorise-les dans ses réglages, puis réessaie.');
  }
  await saveSubscription(sub);
  markSynced(sub);
  return true;
}

const BELL = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>';
const PUSH_TEXT = {
  off: ['Notifications du club', 'Reçois les messages du staff sur cet appareil.'],
  on: ['Notifications activées', 'Cet appareil reçoit les messages du club.'],
  denied: ['Notifications bloquées', 'Autorise-les dans les réglages du téléphone (Notifications > LMFC) ou du navigateur.'],
  install: ['Notifications du club', 'Sur iPhone : touche Partager puis « Sur l’écran d’accueil », ouvre LMFC depuis l’icône et connecte-toi. Le bouton pour activer les notifications apparaîtra ici.'],
};

/* Encart dans box. hideWhenOn : rien à afficher une fois activé (accueil du
   joueur) ; onChange(actif) : après « Activer ». Renvoie vrai si cet
   appareil reçoit les notifications. */
async function renderPushCard(box, opts = {}) {
  const { hideWhenOn = false, onChange } = opts;
  const support = pushSupport();
  let on = false;
  try { on = !!(await currentPush()); } catch (e) { console.warn('Notifications : abonnement non enregistré', e); }
  const state = support === 'ok' ? (on ? 'on' : 'off') : support;
  box.hidden = support === 'none' || (on && hideWhenOn);
  if (box.hidden) return on;
  const [title, text] = PUSH_TEXT[state];
  box.innerHTML = `<div class="push-card is-${state}">
      <span class="push-ic">${BELL}</span>
      <span class="push-text"><strong>${title}</strong><small>${text}</small></span>
      ${state === 'off' ? '<button class="btn btn-primary btn-sm" type="button">Activer</button>' : ''}
    </div>`;
  box.querySelector('button')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    try {
      if (await enablePush()) toast('Notifications activées sur cet appareil.', 'success');
    } catch (err) {
      console.error('Notifications : activation impossible', err);
      toast(err.message, 'error');   // messages en français : enablePush, siteApi
    }
    onChange?.(await renderPushCard(box, opts));
  });
  return on;
}
