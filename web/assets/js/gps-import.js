/* ============================================================
   LMFC Performance — gps-import.js
   Moteur d'import GPS (Catapult d'abord). Pur : ni page ni base,
   tests/gps-import.test.mjs (avec le vrai export du club).
     - gpsCsvRows : CSV (séparateur détecté, guillemets, « sep= ») ;
       un Excel passe par SheetJS (gps-page.js) puis le même chemin ;
     - gpsAnalyse : tout part des en-têtes, jamais des positions :
         · dictionnaire d'indicateurs (variantes FR et EN) ;
         · familles à seuils reconnues par motif, quel que soit le seuil :
           « Dist 15-20km.h », « Dist >25km.h », « D >20 m/min. »,
           « Nb accélérations >3m.s », « Nb décélérations <3m.s » ;
         · unités lues dans l'en-tête (km, m/s, s, h) et les cellules
           (01:04:19 → 64,3 min ; 25,5 ; -0,07) ;
         · lignes collectives (« Team Average », « Moyenne »…) exclues ;
         · colonne inconnue : signalée, jamais interprétée ;
         · contrôles : vitesse plausible, Rythme ≈ distance ÷ temps,
           distance par minute ≈ distance de la bande ÷ temps ;
     - gpsMatch : nom du fichier → fiche du club (correspondance déjà
       validée, nom et prénom, nom seul comme Catapult : « CALODAT »).
   Un autre fournisseur = d'autres variantes dans GPS_METRICS.
   Rien n'est inventé : une cellule vide ou illisible reste vide.
   ============================================================ */

const GPS_METRICS = {
  duree: { label: 'Temps', unit: 'min', kind: 'duration', variants: ['temps', 'duree', 'duration', 'total duration', 'temps total', 'field time', 'session duration'] },
  distance: { label: 'Distance totale', unit: 'm', kind: 'distance', variants: ['distance totale', 'total distance', 'distance', 'dist totale', 'distance total'] },
  rythme: { label: 'Rythme', unit: 'm/min', kind: 'rate', variants: ['rythme', 'meterage per minute', 'distance par minute', 'distance per minute', 'work rate', 'mmin'] },
  vmax: { label: 'Vitesse maximale', unit: 'km/h', kind: 'speed', variants: ['vitesse maximale', 'vitesse max', 'vitesse maxi', 'vmax', 'max velocity', 'maximum velocity', 'top speed', 'max speed'] },
  imbalance: { label: 'Imbalance', unit: '', kind: 'plain', variants: ['imbalance', 'running imbalance'] },
  sprints: { label: 'Sprints', unit: 'nb', kind: 'count', variants: ['nb sprint', 'nb sprints', 'sprint', 'sprints', 'sprint efforts', 'nombre de sprints', 'sprint count'] },
  player_load: { label: 'Player Load', unit: 'UA', kind: 'plain', variants: ['player load', 'playerload', 'total player load', 'charge joueur'] },
};
const GPS_PLAYER = ['player', 'player name', 'joueur', 'joueuse', 'nom', 'nom du joueur', 'name', 'athlete', 'athlete name'];
const GPS_AGGREGATE = /^(team|equipe|moyenne|average|avg|total|ecart type|std dev|standard deviation|mediane|median|max|min)\b/;
const gpsFr = (x) => String(x).replace('.', ',');
const gpsDate = (iso) => (iso ? `${String(iso).slice(8, 10)}/${String(iso).slice(5, 7)}/${String(iso).slice(0, 4)}` : '');   // 2026-10-29 → 29/10/2026

/* En-tête ramené à une forme stable : accents, casse, unités écrites de plusieurs façons. */
const gpsNorm = (h) => String(h ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/km\s*[./]?\s*h\b/g, 'kmh').replace(/m\s*\/\s*min\.?/g, 'mmin').replace(/m\s*[./]\s*s(?:\s*[./]\s*s|²|2)?/g, 'ms')
  .replace(/[()[\]]/g, ' ').replace(/\s+/g, ' ').trim();

/* Lignes d'un CSV : séparateur le plus fréquent de la 1re ligne (; , tabulation), guillemets doublés. */
function gpsCsvRows(text) {
  let lines = String(text ?? '').replace(/^﻿/, '').split(/\r?\n/);
  let sep = null;
  if (/^sep=(.)$/i.test(lines[0] || '')) { sep = lines[0].slice(4, 5); lines = lines.slice(1); }
  const first = lines.find(l => l.trim()) || '';
  sep ||= [';', '\t', ','].map(s => [s, first.split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
  return lines.filter(l => l.trim()).map(line => {
    const out = [];
    let cur = '', quoted = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quoted) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') quoted = false; else cur += ch; }
      else if (ch === '"') quoted = true;
      else if (ch === sep) { out.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    out.push(cur.trim());
    return out;
  });
}

/* Une colonne : indicateur connu, famille à seuil, ou null (inconnue). */
function gpsHeader(header) {
  const n = gpsNorm(header), unit = (/\(([^)]+)\)/.exec(String(header)) || [])[1]?.trim().toLowerCase() || '';
  const base = n.replace(/\s*\b(km|m|s|h|min|kmh|ms|mmin|nb|%)$/, '').trim();
  const num = (x) => Number(String(x).replace(',', '.'));
  let m;
  if ((m = /^(?:dist(?:ance)?|d)\s*(\d+(?:[.,]\d+)?)\s*-\s*(\d+(?:[.,]\d+)?)\s*(?:kmh)?\s*mmin$/.exec(n))) {
    return { key: `rate_${num(m[1])}_${num(m[2])}`, label: `Distance ${gpsFr(num(m[1]))}–${gpsFr(num(m[2]))} km/h par minute`, unit: 'm/min', kind: 'rate', band: [num(m[1]), num(m[2])] };
  }
  if ((m = /^(?:dist(?:ance)?|d)\s*>\s*(\d+(?:[.,]\d+)?)\s*(?:kmh)?\s*mmin$/.exec(n))) {
    return { key: `rate_gt${num(m[1])}`, label: `Distance > ${gpsFr(num(m[1]))} km/h par minute`, unit: 'm/min', kind: 'rate', band: [num(m[1]), null] };
  }
  if ((m = /^(?:dist(?:ance)?|d)\s*(\d+(?:[.,]\d+)?)\s*-\s*(\d+(?:[.,]\d+)?)\s*kmh(?:\s*(km|m))?$/.exec(n))) {
    return { key: `dist_${num(m[1])}_${num(m[2])}`, label: `Distance ${gpsFr(num(m[1]))}–${gpsFr(num(m[2]))} km/h`, unit: 'm', kind: 'distance', band: [num(m[1]), num(m[2])], factor: unit === 'km' ? 1000 : 1 };
  }
  if ((m = /^(?:dist(?:ance)?|d)\s*>\s*(\d+(?:[.,]\d+)?)\s*kmh(?:\s*(km|m))?$/.exec(n))) {
    return { key: `dist_gt${num(m[1])}`, label: `Distance > ${gpsFr(num(m[1]))} km/h`, unit: 'm', kind: 'distance', band: [num(m[1]), null], factor: unit === 'km' ? 1000 : 1 };
  }
  if ((m = /^(?:nb\s*)?acc(?:el(?:eration)?s?)?\s*>\s*(\d+(?:[.,]\d+)?)\s*ms$/.exec(n))) {
    return { key: `acc_gt${num(m[1])}`, label: `Accélérations > ${gpsFr(num(m[1]))} m/s²`, unit: 'nb', kind: 'count' };
  }
  if ((m = /^(?:nb\s*)?dec(?:el(?:eration)?s?)?\s*[<>]\s*-?\s*(\d+(?:[.,]\d+)?)\s*ms$/.exec(n))) {
    return { key: `dec_gt${num(m[1])}`, label: `Décélérations > ${gpsFr(num(m[1]))} m/s²`, unit: 'nb', kind: 'count' };
  }
  const key = Object.keys(GPS_METRICS).find(k => GPS_METRICS[k].variants.includes(base) || GPS_METRICS[k].variants.includes(n));
  if (!key) return null;
  const d = GPS_METRICS[key];
  const factor = d.kind === 'distance' && unit === 'km' ? 1000 : d.kind === 'speed' && /m\/?s/.test(unit) ? 3.6
    : d.kind === 'duration' && unit === 's' ? 1 / 60 : d.kind === 'duration' && unit === 'h' ? 60 : 1;
  return { key, label: d.label, unit: d.unit, kind: d.kind, factor };
}

/* Valeur d'une cellule : « 25,5 », « -0,07 », « 01:04:19 » (durée), vide → null. */
function gpsValue(cell, info) {
  const t = String(cell ?? '').trim();
  if (!t || t === '-' || t === '—') return null;
  if (info?.kind === 'duration') {
    const hms = /^(\d{1,3}):(\d{2})(?::(\d{2}(?:[.,]\d+)?))?$/.exec(t);
    if (hms) return Math.round((hms[3] !== undefined ? Number(hms[1]) * 60 + Number(hms[2]) + Number(hms[3].replace(',', '.')) / 60 : Number(hms[1]) + Number(hms[2]) / 60) * 100) / 100;
  }
  const n = Number(t.replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  if (info?.kind === 'duration' && n > 0 && n < 1 && (info.factor ?? 1) === 1) return Math.round(n * 1440 * 100) / 100;   // Excel : fraction de jour
  return Math.round(n * (info?.factor || 1) * 1000) / 1000;
}

function gpsAnalyse(rows) {
  const head = rows[0] || [], body = rows.slice(1);
  const numeric = (j) => { const v = body.map(r => r[j]).filter(x => String(x ?? '').trim()); return v.length > 0 && v.filter(x => gpsValue(x) !== null).length / v.length >= 0.6; };
  let playerCol = head.findIndex(h => GPS_PLAYER.includes(gpsNorm(h)));
  if (playerCol < 0) playerCol = head.findIndex((h, j) => String(h).trim() && !numeric(j));
  const columns = head.map((header, index) => {
    if (!String(header).trim()) return { index, header, status: 'empty' };
    if (index === playerCol) return { index, header, status: 'player' };
    const info = gpsHeader(header);
    if (info) return { index, header, status: 'known', ...info };
    return { index, header, status: numeric(index) ? 'unknown' : 'text', key: `x_${gpsNorm(header).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40)}`,
      label: String(header).trim(), unit: (/\(([^)]+)\)/.exec(String(header)) || [])[1] || '' };
  });
  const keep = columns.filter(c => c.status === 'known' || c.status === 'unknown');
  const players = [], excluded = [], seen = new Map();
  for (const r of body) {
    const name = String(r[playerCol] ?? '').trim();
    if (!name) continue;
    if (GPS_AGGREGATE.test(gpsNorm(name))) { excluded.push({ name, reason: 'ligne collective' }); continue; }
    const raw = Object.fromEntries(columns.filter(c => c.status !== 'empty').map(c => [c.header, String(r[c.index] ?? '')]));
    const values = Object.fromEntries(keep.map(c => [c.key, gpsValue(r[c.index], c)]).filter(([, v]) => v !== null));
    const key = gpsNorm(name);
    if (seen.has(key)) { seen.get(key).dup = true; excluded.push({ name, reason: 'nom en double dans le fichier' }); continue; }
    const p = { name, values, raw, dup: false };
    seen.set(key, p);
    players.push(p);
  }
  return { columns, players: players.filter(p => !p.dup), excluded: [...excluded, ...players.filter(p => p.dup).map(p => ({ name: p.name, reason: 'nom en double dans le fichier' }))], ...gpsChecks(columns, players) };
}

/* Contrôles de cohérence : signalés, jamais corrigés en silence. */
function gpsChecks(columns, players) {
  const warnings = [], checks = [], has = (k) => columns.some(c => c.key === k && c.status === 'known');
  const agree = (a, b) => { const pairs = players.filter(p => p.values[a] != null && p.values[b] != null); return pairs.length ? pairs : null; };
  const vmax = players.map(p => p.values.vmax).filter(v => v != null).sort((a, b) => a - b);
  if (vmax.length) {
    const med = vmax[Math.floor(vmax.length / 2)];
    if (med < 13) warnings.push(`Vitesse maximale : valeurs basses (médiane ${gpsFr(med)}) ; en m/s plutôt qu’en km/h ? Vérifiez l’unité de l’export.`);
    else if (med > 45) warnings.push(`Vitesse maximale : valeurs élevées (médiane ${gpsFr(med)}) : vérifiez l’unité de l’export.`);
  }
  const ratio = (num, den, ref, label) => {
    const pairs = agree(num, ref)?.filter(p => p.values[den] > 0);
    if (!pairs?.length) return;
    const off = pairs.filter(p => Math.abs(p.values[num] / p.values[den] - p.values[ref]) > Math.max(1, Math.abs(p.values[ref]) * 0.05));
    (off.length ? warnings : checks).push(off.length ? `${label} : incohérent pour ${off.map(p => p.name).join(', ')}.` : `${label} : vérifié.`);
  };
  if (has('duree')) {
    if (has('distance') && has('rythme')) ratio('distance', 'duree', 'rythme', 'Rythme = distance ÷ temps');
    columns.filter(c => c.kind === 'rate' && c.band).forEach(c => {
      const dist = c.band[1] === null ? null : `dist_${c.band[0]}_${c.band[1]}`;
      if (dist && has(dist)) ratio(dist, 'duree', c.key, `${c.label} = distance de la bande ÷ temps`);
    });
  }
  return { warnings, checks };
}

/* Nom du fichier → fiche du club. Lien : 'exact' (nom et prénom), 'nom' (nom seul : « CALODAT »). */
function gpsLink(name, p) {
  const w = normalizeName(name).split(' ').filter(Boolean), nom = normalizeName(p.nom).split(' ').filter(Boolean), pre = normalizeName(p.prenom).split(' ').filter(Boolean);
  const has = (l) => l.length > 0 && l.every(x => w.includes(x));
  if (!has(nom)) return null;
  if (has(pre)) return 'exact';
  return w.length === nom.length ? 'nom' : null;
}
/* Statuts : 'alias' (déjà validé), 'ok' (nom et prénom, une fiche), 'confirm' (nom seul, une fiche
   de l'équipe), 'choose' (plusieurs), 'none'. L'équipe de l'import d'abord ; une fiche visée par
   deux lignes n'est donnée à aucune. aliases : Map(nom normalisé → player_id). */
function gpsMatch(names, roster, teamId, aliases = new Map()) {
  const inTeam = (p) => !!teamId && (p.team_id === teamId || (p.other_team_ids || []).includes(teamId));
  const out = names.map(name => {
    const known = roster.find(p => p.id === aliases.get(normalizeName(name)));
    if (known) return { name, status: 'alias', player: known, candidates: [known] };
    let c = roster.map(p => ({ p, link: gpsLink(name, p) })).filter(x => x.link);
    if (c.some(x => inTeam(x.p))) c = c.filter(x => inTeam(x.p));
    const exact = c.filter(x => x.link === 'exact');
    if (exact.length === 1) return { name, status: 'ok', player: exact[0].p, candidates: c.map(x => x.p) };
    if (c.length === 1) return { name, status: 'confirm', player: c[0].p, candidates: [c[0].p] };
    return { name, status: c.length ? 'choose' : 'none', player: null, candidates: c.map(x => x.p) };
  });
  const claims = new Map();
  out.filter(r => r.player).forEach(r => claims.set(r.player.id, [...(claims.get(r.player.id) || []), r]));
  for (const list of claims.values()) if (list.length > 1) list.forEach(r => Object.assign(r, { status: 'choose', player: null }));
  return out;
}

/* Date d'un nom de fichier (2026-10-29, 29-10-2026, 29.10.26), sinon null. */
function gpsFileDate(name) {
  const s = String(name || '');
  let m = /(20\d{2})[-_.](\d{2})[-_.](\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /(\d{2})[-_.](\d{2})[-_.](20\d{2}|\d{2})(?!\d)/.exec(s);
  return m ? `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[2]}-${m[1]}` : null;
}
