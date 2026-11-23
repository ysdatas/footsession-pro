/* ============================================================
   LMFC Performance — form-body.js (mes-formulaires, formulaires)
   Silhouette du corps pour une question à choix multiple (lmfc_v67.sql)
   marquée « corps » : face et dos, chaque zone cliquable coche la case
   du même libellé. La liste de cases reste dessous : c'est elle qui est
   lue par le clavier et les lecteurs d'écran, et qui est envoyée ; la
   silhouette n'est qu'un raccourci au doigt (aria-hidden).
   Libellés repris du questionnaire douleur de lmfc_v62.sql.
   ============================================================ */

/* [libellé, vue, formes] sur la photo corps-muscles.webp (560 × 420, face à gauche, dos à droite) :
   c cercle [x, y, r], e ellipse [x, y, rx, ry]. Paires : les deux côtés. */
const FB_ZONES = [
  ['Cou', 'face', [['c', 145, 74, 9]]],
  ['Épaule', 'face', [['c', 96, 98, 12], ['c', 194, 98, 12]]],
  ['Pectoraux', 'face', [['e', 125, 110, 16, 11], ['e', 165, 110, 16, 11]]],
  ['Abdominaux', 'face', [['e', 145, 160, 18, 32]]],
  ['Coude', 'face', [['c', 75, 152, 9], ['c', 215, 152, 9]]],
  ['Poignet / main', 'face', [['c', 71, 207, 11], ['c', 213, 207, 11]]],
  ['Psoas', 'face', [['c', 130, 196, 8], ['c', 160, 196, 8]]],
  ['Hanche', 'face', [['c', 109, 190, 9], ['c', 181, 190, 9]]],
  ['Adducteurs', 'face', [['e', 133, 240, 7, 22], ['e', 157, 240, 7, 22]]],
  ['Quadriceps', 'face', [['e', 116, 248, 11, 30], ['e', 174, 248, 11, 30]]],
  ['Genou', 'face', [['c', 115, 300, 11], ['c', 175, 300, 11]]],
  ['Cheville', 'face', [['c', 106, 375, 8], ['c', 184, 375, 8]]],
  ['Pied', 'face', [['e', 99, 397, 12, 7], ['e', 191, 397, 12, 7]]],
  ['Dorsaux', 'dos', [['e', 393, 138, 17, 26], ['e', 451, 138, 17, 26]]],
  ['Dos / lombaires', 'dos', [['e', 422, 172, 18, 12]]],
  ['Fessiers', 'dos', [['e', 404, 207, 18, 17], ['e', 440, 207, 18, 17]]],
  ['Ischio-jambiers', 'dos', [['e', 401, 262, 12, 30], ['e', 443, 262, 12, 30]]],
  ['Mollets', 'dos', [['e', 395, 328, 11, 26], ['e', 449, 328, 11, 26]]],
];
/* Choix proposés par défaut dans l'éditeur : toutes les zones, puis « Autre ». */
const FB_DEFAULT = [...FB_ZONES.map(z => z[0]), 'Autre'];

const fbShape = ([k, x, y, a, b]) => (k === 'c' ? `<circle cx="${x}" cy="${y}" r="${a}"/>` : `<ellipse cx="${x}" cy="${y}" rx="${a}" ry="${b}"/>`);

/* La silhouette d'une question : la photo, et seules ses zones proposées, cliquables. */
function fbHtml(options) {
  const zones = FB_ZONES.filter(z => options.includes(z[0])).map(([label, , shapes]) =>
    `<g class="fb-z" data-fb-zone="${escapeHtml(label)}"><title>${escapeHtml(label)}</title>${shapes.map(fbShape).join('')}</g>`).join('');
  return `<svg class="fb-svg" viewBox="0 0 560 420" aria-hidden="true" focusable="false">
    <rect class="fb-bg" width="560" height="420" rx="14"/>
    <image href="assets/img/corps-muscles.webp" width="560" height="420"/>${zones}
    <text class="fb-cap" x="145" y="414" text-anchor="middle">Face</text><text class="fb-cap" x="422" y="414" text-anchor="middle">Dos</text></svg>`;
}

/* Une question a sa silhouette si elle est marquée « corps » et propose au moins une zone connue. */
const fbHas = (q) => q?.type === 'multi' && q.corps === true && (q.options || []).some(o => FB_ZONES.some(z => z[0] === o));

/* Clic sur une zone : coche ou décoche la case du même libellé, dans la même question. */
function fbClick(e) {
  const zone = e.target.closest?.('.fb-z');
  const box = zone?.closest('[data-mf-q]');
  if (!box) return;
  const input = [...box.querySelectorAll('input[type="checkbox"]')].find(x => x.value === zone.dataset.fbZone);
  if (!input) return;
  input.checked = !input.checked;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

/* Case cochée ou décochée : la zone suit. */
function fbSync(e) {
  const input = e.target;
  if (input?.type !== 'checkbox') return;
  input.closest('[data-mf-q]')?.querySelectorAll('.fb-z').forEach(z => {
    if (z.dataset.fbZone === input.value) z.classList.toggle('is-on', input.checked);
  });
}

document.addEventListener('click', fbClick);
document.addEventListener('change', fbSync);
