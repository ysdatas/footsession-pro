/* ============================================================
   LMFC Performance — service worker : notifications du club.
   Affiche les messages envoyés par l'administrateur (worker/push.js),
   même application fermée, et ouvre la bonne page au toucher.
   Aucun cache : le site reste toujours celui en ligne.
   Abonnement de l'appareil : assets/js/push.js.
   ============================================================ */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let m = {};
  try { m = e.data?.json() || {}; } catch { m = { body: e.data?.text() || '' }; }
  // Sans message, iOS écrit « from LMFC » (en anglais) : le titre passe en message.
  const title = m.body ? m.title || 'LMFC Performance' : 'LMFC Performance';
  const body = m.body || m.title || '';
  // Toujours une notification visible : iOS retire l'abonnement sinon.
  e.waitUntil(self.registration.showNotification(title, {
    body, icon: 'assets/img/icon-192.png', data: { url: m.url || 'index.html' },
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || 'index.html', self.registration.scope).href;
  e.waitUntil((async () => {
    const [win] = await self.clients.matchAll({ type: 'window' });
    if (win) {
      try { await win.focus(); return await win.navigate(url); } catch { /* fenêtre non pilotable : on en ouvre une */ }
    }
    return self.clients.openWindow(url);
  })());
});
