/* ============================================================
   LMFC Performance — theme.js (chargé dans le <head> de chaque page)
   Couleur du club (Mon club → Identité) appliquée à toute
   l'interface : elle remplace l'or des boutons, rubriques, titres,
   liserés. Gardée en mémoire du navigateur pour s'afficher dès la
   première image ; la valeur de référence reste clubs.color, relue
   à chaque connexion (requireAuth, requirePlayer) qui rappelle
   applyClubColor().
   ============================================================ */

const CLUB_COLOR_KEY = 'lmfc-club-color';
const DEFAULT_CLUB_COLOR = '#E8B20E';

function applyClubColor(hex, { remember = true } = {}) {
  const root = document.documentElement;
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m || m[1].toUpperCase() === DEFAULT_CLUB_COLOR.slice(1)) {
    ['--gold', '--gold-light', '--gold-rgb', '--on-gold'].forEach(p => root.style.removeProperty(p));
    if (remember) try { localStorage.removeItem(CLUB_COLOR_KEY); } catch { /* stockage bloqué */ }
    return;
  }
  let [r, g, b] = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
  // Sur fond noir, une couleur trop sombre (noir, bleu nuit) devient
  // illisible en texte : on l'éclaircit jusqu'à un minimum lisible.
  const lum = (c) => {
    const l = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
  };
  for (let i = 0; i < 20 && lum([r, g, b]) < 0.12; i++) [r, g, b] = [r, g, b].map(v => Math.round(v + (255 - v) * 0.12));
  const mix = (t) => [r, g, b].map(v => Math.round(v + (255 - v) * t));
  const toHex = (c) => `#${c.map(v => v.toString(16).padStart(2, '0')).join('')}`;
  const L = lum([r, g, b]);
  root.style.setProperty('--gold', toHex([r, g, b]));
  root.style.setProperty('--gold-light', toHex(mix(0.3)));
  root.style.setProperty('--gold-rgb', `${r}, ${g}, ${b}`);
  // Texte posé sur la couleur : noir ou blanc, le plus contrasté.
  root.style.setProperty('--on-gold', (L + 0.05) / 0.05 >= 1.05 / (L + 0.05) ? '#0A0A0A' : '#FFFFFF');
  if (remember) try { localStorage.setItem(CLUB_COLOR_KEY, `#${m[1]}`); } catch { /* stockage bloqué */ }
}

try { applyClubColor(localStorage.getItem(CLUB_COLOR_KEY), { remember: false }); } catch { /* stockage bloqué */ }
