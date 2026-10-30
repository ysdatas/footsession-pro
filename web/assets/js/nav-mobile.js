/* ============================================================
   LMFC Performance — nav-mobile.js
   Icônes du menu (aussi utilisées par l'accueil) et, sur téléphone,
   la barre d'onglets du bas du staff : les quatre premières rubriques
   de SON menu (ordre choisi dans Paramètres) + « Menu » qui ouvre le
   reste. Même barre que l'espace joueur (.pa-tabbar, main.css).
   Chargé avant nav.js, qui appelle renderTabbar à chaque dessin du menu.
   ============================================================ */

/* Icônes du menu et de l'accueil (tracés Lucide, 24 × 24, trait 2). */
const NAV_IC = {
  dashboard: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
  sessions: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>',
  rpe: '<path d="M3 20h18"/><path d="M6 16v-3M10 16V9M14 16v-5M18 16V5"/>',
  matches: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M9 12h6M9 16h6"/>',
  players: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  performance: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  videos: '<path d="m16 13 5.22 3.48a.5.5 0 0 0 .78-.41V7.87a.5.5 0 0 0-.75-.43L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
  library: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="m15 14.5 5 3-5 3z"/>',
  tactical: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M12 4v16"/><circle cx="12" cy="12" r="3"/>',
  analytics: '<path d="M3 3v18h18"/><path d="M18 17V9M13 17V5M8 17v-3"/>',
  faq: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01"/>',
  club: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  notifications: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  scale: '<path d="M12 3v18M5 7h14M5 7l-3 7a4 4 0 0 0 6 0zM19 7l-3 7a4 4 0 0 0 6 0z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
};
const navIc = (k) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${NAV_IC[k] || NAV_IC.plus}</svg>`;

const MENU_IC = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';
/* Noms courts : cinq onglets tiennent sur un téléphone de 360 px. */
const TAB_SHORT = { matches: 'Matchs', videos: 'Vidéos', library: 'Biblio.', tactical: 'Tableau', analytics: 'Bilan', performance: 'Perf.', notifications: 'Notifs', club: 'Club' };

function renderTabbar(items, activeKey) {
  // Plein écran (tableau tactique) ou espace joueur (sa propre barre) : rien.
  if (document.querySelector('.tb-page') || document.body.classList.contains('pa-body')) return;
  const html = items.slice(0, 4).map(i => {
    const on = i.key === activeKey;
    return `<a class="pa-tab${on ? ' is-active' : ''}" href="${i.href}" data-mem="${i.key}"${on ? ' aria-current="page"' : ''}>${navIc(i.key)}<span>${escapeHtml(TAB_SHORT[i.key] || i.label)}</span></a>`;
  }).join('');
  // Rubrique ouverte hors des quatre onglets : « Menu » s'allume, on sait où l'on est.
  const elsewhere = activeKey && !items.slice(0, 4).some(i => i.key === activeKey);
  const menu = `<button type="button" class="pa-tab${elsewhere ? ' is-active' : ''}" data-tab-menu aria-controls="sidebar">${MENU_IC}<span>Menu</span></button>`;
  let bar = document.querySelector('.m-tabbar');
  if (!bar) {
    document.body.insertAdjacentHTML('beforeend', '<nav class="pa-tabbar m-tabbar" aria-label="Raccourcis"></nav>');
    bar = document.querySelector('.m-tabbar');
    bar.addEventListener('click', (e) => { if (e.target.closest('[data-tab-menu]')) document.getElementById('sidebarToggle')?.click(); });
  }
  if (bar.innerHTML !== html + menu) bar.innerHTML = html + menu;
}
