/* ============================================================
   LMFC Performance — form-body.js (mes-formulaires, formulaires)
   Silhouette du corps pour une question à choix multiple (lmfc_v67.sql)
   marquée « corps » : face et dos, chaque zone cliquable coche la case
   du même libellé. La liste de cases reste dessous : c'est elle qui est
   lue par le clavier et les lecteurs d'écran, et qui est envoyée ; la
   silhouette n'est qu'un raccourci au doigt (aria-hidden).
   Libellés repris du questionnaire douleur de lmfc_v62.sql.
   ============================================================ */

/* [libellé, vue, formes] : c cercle [x, y, r], e ellipse [x, y, rx, ry]. Paires : les deux côtés. */
const FB_ZONES = [
  ['Cou', 'face', [['c', 60, 41, 5]]],
  ['Épaule', 'face', [['c', 33, 52, 6], ['c', 87, 52, 6]]],
  ['Pectoraux', 'face', [['e', 49, 65, 10, 7], ['e', 71, 65, 10, 7]]],
  ['Abdominaux', 'face', [['e', 60, 94, 11, 16]]],
  ['Coude', 'face', [['c', 21, 98, 5], ['c', 99, 98, 5]]],
  ['Poignet / main', 'face', [['c', 14, 146, 6], ['c', 106, 146, 6]]],
  ['Psoas', 'face', [['c', 51, 117, 5], ['c', 69, 117, 5]]],
  ['Hanche', 'face', [['c', 38, 126, 5], ['c', 82, 126, 5]]],
  ['Adducteurs', 'face', [['e', 55, 150, 3.5, 12], ['e', 65, 150, 3.5, 12]]],
  ['Quadriceps', 'face', [['e', 46, 160, 6, 18], ['e', 74, 160, 6, 18]]],
  ['Genou', 'face', [['c', 49, 199, 6], ['c', 71, 199, 6]]],
  ['Cheville', 'face', [['c', 49, 236, 5], ['c', 71, 236, 5]]],
  ['Pied', 'face', [['e', 48, 250, 8, 4], ['e', 72, 250, 8, 4]]],
  ['Dorsaux', 'dos', [['e', 48, 72, 10, 14], ['e', 72, 72, 10, 14]]],
  ['Dos / lombaires', 'dos', [['e', 60, 108, 13, 8]]],
  ['Fessiers', 'dos', [['e', 50, 133, 10, 9], ['e', 70, 133, 10, 9]]],
  ['Ischio-jambiers', 'dos', [['e', 47, 165, 6, 18], ['e', 73, 165, 6, 18]]],
  ['Mollets', 'dos', [['e', 49, 216, 6, 14], ['e', 71, 216, 6, 14]]],
];
/* Choix proposés par défaut dans l'éditeur : toutes les zones, puis « Autre ». */
const FB_DEFAULT = [...FB_ZONES.map(z => z[0]), 'Autre'];

/* Le corps, une seule fois par vue (moitié gauche, l'autre en miroir). */
const FB_HALF = 'M60 36 L54 36 L54 44 Q40 44 33 46 L26 52 L18 98 L10 142 L18 144 L26 100 L34 66 L36 128 L38 128 L42 200 L44 244 L40 252 L56 252 L54 244 L56 200 L58 128 L60 128 Z';
const fbBody = () => `<circle class="fb-skin" cx="60" cy="22" r="13"/>
  <path class="fb-skin" d="${FB_HALF}"/><path class="fb-skin" d="${FB_HALF}" transform="translate(120 0) scale(-1 1)"/>`;
const fbShape = ([k, x, y, a, b]) => (k === 'c' ? `<circle cx="${x}" cy="${y}" r="${a}"/>` : `<ellipse cx="${x}" cy="${y}" rx="${a}" ry="${b}"/>`);

/* La silhouette d'une question : seules ses zones proposées sont cliquables. */
function fbHtml(options) {
  const view = (name, dx) => `<g transform="translate(${dx} 0)">${fbBody()}
    ${FB_ZONES.filter(z => z[1] === name && options.includes(z[0])).map(([label, , shapes]) =>
      `<g class="fb-z" data-fb-zone="${escapeHtml(label)}"><title>${escapeHtml(label)}</title>${shapes.map(fbShape).join('')}</g>`).join('')}
    <text class="fb-cap" x="60" y="266" text-anchor="middle">${name === 'face' ? 'Face' : 'Dos'}</text></g>`;
  return `<svg class="fb-svg" viewBox="0 0 250 272" aria-hidden="true" focusable="false">${view('face', 0)}${view('dos', 130)}</svg>`;
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
