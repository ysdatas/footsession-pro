/* ============================================================
   LMFC Performance — calendar-utils.js
   Dates du calendrier (calendrier-page.js), en heure locale : jamais
   toISOString, qui passe en UTC et décale d'un jour autour de minuit.
   Semaine du lundi au dimanche ; mois affiché sur 6 semaines (42 jours,
   la grille garde toujours la même hauteur). Testé :
   tests/calendar-utils.test.mjs.
   ============================================================ */

const CAL_DOW = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const calPad = (n) => String(n).padStart(2, '0');
const calIso = (d) => `${d.getFullYear()}-${calPad(d.getMonth() + 1)}-${calPad(d.getDate())}`;
const calDate = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
const calToday = () => calIso(new Date());
const calAddDays = (iso, n) => { const d = calDate(iso); d.setDate(d.getDate() + n); return calIso(d); };
const calMonday = (iso) => { const d = calDate(iso); return calAddDays(iso, -((d.getDay() + 6) % 7)); };

/* Jours chargés pour une vue : mois (6 semaines dès le lundi qui précède le 1er),
   semaine (lundi → dimanche), à venir (60 jours). */
function calRange(view, anchor) {
  if (view === 'week') { const from = calMonday(anchor); return { from, to: calAddDays(from, 6) }; }
  if (view === 'list') return { from: anchor, to: calAddDays(anchor, 59) };
  const from = calMonday(`${anchor.slice(0, 8)}01`);
  return { from, to: calAddDays(from, 41) };
}

/* Mois, semaine ou 60 jours précédents (dir = -1) ou suivants (+1). */
function calMove(view, anchor, dir) {
  if (view === 'week') return calAddDays(anchor, 7 * dir);
  if (view === 'list') return calAddDays(anchor, 60 * dir);
  const d = calDate(`${anchor.slice(0, 8)}01`);
  d.setMonth(d.getMonth() + dir);
  return calIso(d);
}

const calFmt = (iso, opts) => new Intl.DateTimeFormat('fr-FR', opts).format(calDate(iso));
const calCap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
function calTitle(view, anchor) {
  if (view === 'month') return calCap(calFmt(anchor, { month: 'long', year: 'numeric' }));
  const { from, to } = calRange(view, anchor);
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  const start = calFmt(from, sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'short' });
  return `${view === 'week' ? 'Semaine du' : 'Du'} ${start} au ${calFmt(to, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}
/* « mardi 3 novembre » */
const calDayLabel = (iso) => calFmt(iso, { weekday: 'long', day: 'numeric', month: 'long' });
