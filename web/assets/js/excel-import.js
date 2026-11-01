/* ============================================================
   LMFC Performance — excel-import.js
   Import du classeur du préparateur physique pour TOUT le club.

   Utilisé depuis la page Joueurs et depuis la fiche Performance :
   un seul fichier met à jour tous les joueurs qu'il contient.

   Principes :
   - chaque joueur est lu sur SA ligne : aucune donnée ne peut passer
     d'un joueur à un autre ;
   - chaque ligne de l'Excel est rapprochée des fiches du club sur
     plusieurs critères (excel-match.js : nom, date de naissance, équipe,
     taille) ; tant que plusieurs fiches restent possibles, rien n'est
     associé sans le choix du préparateur ;
   - la date de naissance du classeur remplit une fiche qui n'en a pas,
     sans jamais en écraser une autre ;
   - une ligne par joueur, saison et mois (ou session) : réimporter une
     version à jour de l'Excel met à jour les valeurs au lieu de créer
     des doublons ;
   - une cellule vide de l'Excel n'efface pas une valeur déjà connue, et
     rien n'est estimé : une donnée absente reste absente ;
   - rien n'est écrit avant validation du tableau de contrôle.

   Dépend de perf-metrics.js (MONTHS, STAGES, num, normalizeName,
   seasonKeyFor) et de la bibliothèque XLSX.
   ============================================================ */

/* Tous les mots de `name` sont-ils présents dans `parts` ?
   Couvre les noms composés (« DA SILVA ») sans assouplir la règle. */
function containsAll(parts, name) {
  const words = String(name || '').split(' ').filter(Boolean);
  return words.length > 0 && words.every(w => parts.includes(w));
}

/* « BARAKAT Sacha » -> { nom: 'BARAKAT', prenom: 'Sacha' }.
   Les mots en capitales forment le nom ; à défaut, le dernier mot. */
function splitExcelName(text) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  const isUpper = w => /[A-ZÀ-Þ]/.test(w) && w === w.toUpperCase() && w.length > 1;
  const upper = words.filter(isUpper);
  if (upper.length && upper.length < words.length) {
    return { nom: upper.join(' '), prenom: words.filter(w => !isUpper(w)).join(' ') };
  }
  if (words.length <= 1) return { nom: words[0] || '', prenom: '' };
  return { nom: words.at(-1), prenom: words.slice(0, -1).join(' ') };
}

function levenshtein(a, b) {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/* Nom du joueur d'une ligne : première cellule de texte, ni nombre ni agrégat. */
const XI_NAME_SHEETS = ['Tests bruts', 'Anthropométrie', 'Profil sur 10', 'Plis cutanés'];
function excelRowName(row) {
  return (row || []).find(v => {
    const t = String(v ?? '').trim();
    return t && typeof v !== 'object' && !/^[+-]?\d+(?:[.,]\d+)?$/.test(t) && !isAggregateName(t);
  });
}

/* Noms de joueurs présents dans le classeur (une entrée par personne). */
function excelRoster(workbook) {
  const names = new Map();
  for (const sheet of XI_NAME_SHEETS) {
    const rows = workbookRows(workbook, sheet);
    for (let r = 4; r < rows.length; r++) {
      const cell = excelRowName(rows[r]);
      if (!cell) continue;
      const key = normalizeName(cell);
      if (key && !names.has(key)) names.set(key, String(cell).trim());
    }
  }
  return [...names.values()];
}

/* Noms portés par deux lignes d'un même onglet : impossibles à distinguer,
   jamais importés (la lecture par nom prendrait la première ligne). */
function excelDuplicateNames(workbook) {
  const dups = new Set();
  for (const sheet of XI_NAME_SHEETS) {
    const seen = new Set(), rows = workbookRows(workbook, sheet);
    for (let r = 4; r < rows.length; r++) {
      const cell = excelRowName(rows[r]);
      const key = cell && normalizeName(cell);
      if (!key) continue;
      if (seen.has(key)) dups.add(key); else seen.add(key);
    }
  }
  return dups;
}

/* ------------------------------------------------------------
   Lecture du classeur (modèle Tests_Physiques_N2-5)
   ------------------------------------------------------------ */
/* Lignes d'un onglet, TOUJOURS indexées depuis la cellule A1.
   Un classeur déclare sa zone utilisée (ex. « B2:AD36 » quand la ligne 1
   et la colonne A sont vides — c'est le cas du modèle du préparateur).
   Sans forcer l'origine, la bibliothèque démarre le tableau en B2 : tout
   est décalé d'une ligne et d'une colonne, et chaque test est lu dans la
   colonne voisine (le Shirado de 240 s se retrouvait dans la colonne VIFT).
   Les décalages de colonnes du parseur sont exprimés depuis A1. */
function workbookRows(workbook, name) {
  const ws = workbook?.Sheets?.[name];
  if (!ws) return [];
  const opts = { header: 1, raw: true, defval: null };
  if (ws['!ref'] && XLSX.utils.decode_range) {
    const range = XLSX.utils.decode_range(ws['!ref']);
    range.s.r = 0;
    range.s.c = 0;
    opts.range = range;
  }
  return XLSX.utils.sheet_to_json(ws, opts);
}

function isAggregateName(name) {
  const k = normalizeName(name);
  return [
    'moyenne',
    'ecart type',
    'n joueurs testes'
  ].includes(k);
}

function findPlayerRow(rows, target) {
  if (!target) return null;

  const firstName = normalizeName(target.prenom || '');
  const lastName = normalizeName(target.nom || '');

  if (!lastName) return null;

  // Nom seul (sans prénom écrit) : candidat ; un autre prénom écrit : un homonyme, jamais lui.
  const surnameOnly = [];

  for (let r = 4; r < rows.length; r++) {
    const row = rows[r] || [];

    let hasLastName = false;
    let hasFirstName = false;
    let matchedText = '';

    for (const value of row) {
      if (value === null || value === undefined) continue;

      const text = String(value).trim();
      if (!text) continue;

      if (/^[+-]?\d+(?:[.,]\d+)?$/.test(text)) continue;
      if (isAggregateName(text)) continue;

      const normalized = normalizeName(text);
      const parts = normalized.split(' ').filter(Boolean);

      if (containsAll(parts, lastName)) {
        hasLastName = true;
        if (!matchedText) matchedText = text;
      }

      if (firstName && containsAll(parts, firstName)) {
        hasFirstName = true;
      }
    }

    if (!hasLastName) continue;

    if (hasFirstName) {
      return {
        index: r,
        name: matchedText || `${target.prenom || ''} ${target.nom || ''}`.trim()
      };
    }

    const extra = normalizeName(matchedText).split(' ').filter(w => w && !lastName.split(' ').includes(w));
    if (!firstName || !extra.length) {
      surnameOnly.push({ index: r, name: matchedText || String(target.nom || '').trim() });
    }
  }

  return surnameOnly.length === 1 ? surnameOnly[0] : null;   // plusieurs : rien d'attribué au hasard
}

function findPlayerSheet(workbook, target) {
  if (!target) return null;

  const wantedLastName = normalizeName(target.nom || '')
    .replace(/[^a-z0-9]/g, '');

  if (!wantedLastName) return null;

  const sheetNames = workbook?.SheetNames || [];

  return sheetNames.find(sheetName => {
    const normalized = normalizeName(sheetName)
      .replace(/[^a-z0-9]/g, '');

    return normalized === wantedLastName;
  }) || null;
}

function parsePlayerSheet(workbook, target) {
  const sheetName = findPlayerSheet(workbook, target);

  if (!sheetName) return null;

  const rows = workbookRows(workbook, sheetName);

  const result = {
    sheetName,
    ratioByStage: {}
  };

  // Onglet individuel :
  // ligne 17 = Ratio Shirado / Sorensen
  // colonnes C/D/E = Pré-saison / Mi-saison / Fin de saison
  const ratioRow = rows[16] || [];

  STAGES.forEach((s, index) => {
    result.ratioByStage[s.key] = num(ratioRow[2 + index]);
  });

  return result;
}

/* Date de naissance d'une cellule Excel (lue avec cellDates) : la
   bibliothèque la rend quelques secondes avant minuit ; on la ramène au
   jour local le plus proche. */
function excelDay(v) {
  if (Object.prototype.toString.call(v) !== '[object Date]' || isNaN(v)) return null;
  const d = new Date(v.getTime() + 12 * 3600e3);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
const isoDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/* Âge au 15 du mois de mesure, comme le classeur Espoirs :
   (DATE(année de début de saison [+1 de janvier à juin]; mois; 15) − naissance) / 365,25. */
function ageAtMonth(birth, startYear, mi) {
  const month = ((mi + 7) % 12) + 1;                 // MONTHS[0] = août
  const day = new Date(startYear + (month < 8 ? 1 : 0), month - 1, 15);
  return Math.floor((day - birth) / 864e5 / 365.25);
}

/* Lit le classeur du préparateur pour UN joueur.
   Décalages du modèle Tests_Physiques_N2-5 (vérifiés contre le fichier réel) :
     Anthropométrie  en-tête ligne 4 ; taille col C.., poids col N.., MG col Y..
     Plis cutanés    âge col C (modèle Espoirs : date de naissance, et
                     année de début de saison en C3), puis 6 colonnes par
                     mois à partir de D
     Tests bruts     9 colonnes par session à partir de C
     Profil sur 10   5 colonnes par session à partir de C
   Voir tests/perf-logic.test.mjs. */
function parseExcel(file, workbook, target) {
  const anth = workbookRows(workbook, 'Anthropométrie');
  const folds = workbookRows(workbook, 'Plis cutanés');
  const raw = workbookRows(workbook, 'Tests bruts');
  const profile = workbookRows(workbook, 'Profil sur 10');

  const anthMatch = findPlayerRow(anth, target);
  const foldsMatch = findPlayerRow(folds, target);
  const rawMatch = findPlayerRow(raw, target);
  const profileMatch = findPlayerRow(profile, target);

  const playerSheet = parsePlayerSheet(workbook, target);

  if (!anthMatch && !foldsMatch && !rawMatch && !profileMatch) {
    throw new Error(
      `Le joueur « ${`${target.prenom || ''} ${target.nom || ''}`.trim()} » n’a pas été trouvé dans cet Excel.`
    );
  }

  const measurementsRows = [];
  const testRows = [];

  /*
   * ============================================================
   * ANTHROPOMÉTRIE + PLIS CUTANÉS
   * ============================================================
   *
   * On lit UNIQUEMENT la ligne correspondant au joueur courant.
   *
   * Important :
   * - aucune masse grasse n'est recalculée ;
   * - si Excel contient une valeur => on l'importe ;
   * - si Excel est vide => on conserve null.
   */

  const anthRow = anthMatch ? (anth[anthMatch.index] || []) : [];
  const foldRow = foldsMatch ? (folds[foldsMatch.index] || []) : [];

  const birth = excelDay(foldRow[2]);
  const age = birth ? null : num(foldRow[2]);
  const startYear = num(folds[2]?.[2]);

  MONTHS.forEach((month, mi) => {
    const height = num(anthRow[2 + mi]);
    const weight = num(anthRow[13 + mi]);
    const mgFromAnth = num(anthRow[24 + mi]);

    // Plis cutanés :
    // Août commence colonne D (index 3)
    // puis 6 colonnes par mois.
    const fs = 3 + mi * 6;

    const biceps = num(foldRow[fs]);
    const triceps = num(foldRow[fs + 1]);
    const subscapular = num(foldRow[fs + 2]);
    const suprailiac = num(foldRow[fs + 3]);
    const skinfoldSum = num(foldRow[fs + 4]);
    const mgFromFolds = num(foldRow[fs + 5]);

    // PRIORITÉ À LA VALEUR DÉJÀ PRÉSENTE DANS EXCEL.
    const bodyFat = mgFromAnth ?? mgFromFolds;

    if ([
      height,
      weight,
      bodyFat,
      biceps,
      triceps,
      subscapular,
      suprailiac,
      skinfoldSum
    ].some(v => v !== null)) {
      measurementsRows.push({
        name: anthMatch?.name || foldsMatch?.name || `${target.prenom || ''} ${target.nom || ''}`.trim(),
        month_label: month,
        age_at_measurement: birth && startYear ? ageAtMonth(birth, startYear, mi) : age,
        height_cm: height,
        weight_kg: weight,
        body_fat_pct: bodyFat,
        biceps_mm: biceps,
        triceps_mm: triceps,
        subscapular_mm: subscapular,
        suprailiac_mm: suprailiac,
        skinfold_sum_4_mm: skinfoldSum
      });
    }
  });

  /*
   * ============================================================
   * TESTS BRUTS
   * ============================================================
   *
   * Les colonnes "505 moyenne" et "Asymétrie" sont déjà calculées
   * dans Excel : on les reprend directement.
   */

  const rawRow = rawMatch ? (raw[rawMatch.index] || []) : [];

  STAGES.forEach((s, si) => {
    const c = 2 + si * 9;

    const sprint10 = num(rawRow[c]);
    const five05Left = num(rawRow[c + 1]);
    const five05Right = num(rawRow[c + 2]);
    const five05Avg = num(rawRow[c + 3]);
    const five05Asym = num(rawRow[c + 4]);
    const sprint40 = num(rawRow[c + 5]);
    const vift = num(rawRow[c + 6]);
    const shirado = num(rawRow[c + 7]);
    const sorensen = num(rawRow[c + 8]);

    // Onglet individuel (ancien modèle) ; sinon Shirado ÷ Sorensen, la formule
    // du classeur et du déclencheur de la base : l'aperçu montre ce qui sera enregistré.
    const ratio = playerSheet?.ratioByStage?.[s.key] ?? (shirado !== null && sorensen ? shirado / sorensen : null);

    if ([
      sprint10,
      five05Left,
      five05Right,
      five05Avg,
      five05Asym,
      sprint40,
      vift,
      shirado,
      sorensen,
      ratio
    ].some(v => v !== null)) {
      testRows.push({
        name: rawMatch?.name || `${target.prenom || ''} ${target.nom || ''}`.trim(),
        stage: s.key,

        sprint10_sec: sprint10,
        five05_left_sec: five05Left,
        five05_right_sec: five05Right,
        five05_avg_sec: five05Avg,
        five05_asymmetry_pct: five05Asym,
        sprint40_sec: sprint40,
        vift_kmh: vift,
        shirado_sec: shirado,
        sorensen_sec: sorensen,
        core_ratio: ratio
      });
    }
  });

  /*
   * ============================================================
   * PROFIL /10
   * ============================================================
   *
   * Ces scores existent déjà dans "Profil sur 10".
   * On les importe tels quels pour alimenter le radar.
   */

  const profileRow = profileMatch ? (profile[profileMatch.index] || []) : [];

  STAGES.forEach((s, si) => {
    const c = 2 + si * 5;

    const profileStart = num(profileRow[c]);
    const profileAgility = num(profileRow[c + 1]);
    const profileSpeed = num(profileRow[c + 2]);
    const profileEndurance = num(profileRow[c + 3]);
    const profileCore = num(profileRow[c + 4]);

    const test = testRows.find(t => t.stage === s.key);

    const hasProfile = [
      profileStart,
      profileAgility,
      profileSpeed,
      profileEndurance,
      profileCore
    ].some(v => v !== null);

    if (hasProfile) {
      if (test) {
        test.profile_start = profileStart;
        test.profile_agility = profileAgility;
        test.profile_speed = profileSpeed;
        test.profile_endurance = profileEndurance;
        test.profile_core = profileCore;
      } else {
        testRows.push({
          name: profileMatch?.name || `${target.prenom || ''} ${target.nom || ''}`.trim(),
          stage: s.key,

          sprint10_sec: null,
          five05_left_sec: null,
          five05_right_sec: null,
          five05_avg_sec: null,
          five05_asymmetry_pct: null,
          sprint40_sec: null,
          vift_kmh: null,
          shirado_sec: null,
          sorensen_sec: null,
          core_ratio: null,

          profile_start: profileStart,
          profile_agility: profileAgility,
          profile_speed: profileSpeed,
          profile_endurance: profileEndurance,
          profile_core: profileCore
        });
      }
    }
  });

  return {
    fileName: file.name,
    sourceFile: file.name,

    targetPlayerId: target.id,

    targetName: `${target.prenom || ''} ${target.nom || ''}`.trim(),

    excelNames: [
      anthMatch?.name,
      foldsMatch?.name,
      rawMatch?.name,
      profileMatch?.name
    ].filter(Boolean),

    measurements: measurementsRows,
    tests: testRows,
    birthDate: birth ? isoDay(birth) : null,

    individualSheet: playerSheet?.sheetName || null
  };
}


/* ------------------------------------------------------------
   Lignes Supabase et fusion avec l'existant
   ------------------------------------------------------------ */
const XI_MEASURE_FIELDS = ['age_at_measurement', 'height_cm', 'weight_kg', 'body_fat_pct',
  'biceps_mm', 'triceps_mm', 'subscapular_mm', 'suprailiac_mm', 'skinfold_sum_4_mm'];
const XI_TEST_FIELDS = ['sprint10_sec', 'five05_left_sec', 'five05_right_sec', 'five05_avg_sec',
  'five05_asymmetry_pct', 'sprint40_sec', 'vift_kmh', 'shirado_sec', 'sorensen_sec', 'core_ratio',
  'profile_start', 'profile_agility', 'profile_speed', 'profile_endurance', 'profile_core'];

const xiHas = v => v !== null && v !== undefined && v !== '';

/* Une valeur de l'Excel remplace l'ancienne ; une cellule vide la laisse
   en place. Les colonnes techniques de la ligne existante sont retirées. */
function mergeImportRow(existing, incoming, fields, meta) {
  const out = {};
  if (existing) {
    for (const [k, v] of Object.entries(existing)) {
      if (!['id', 'created_at', 'updated_at'].includes(k)) out[k] = v;
    }
  }
  Object.assign(out, meta);
  for (const f of fields) {
    if (xiHas(incoming[f])) out[f] = incoming[f];
    else if (!(f in out)) out[f] = null;
  }
  return out;
}

/* Nombre de valeurs que l'import va réellement changer. */
function countImportChanges(existing, incoming, fields) {
  return fields.filter(f => xiHas(incoming[f]) &&
    (!existing || !xiHas(existing[f]) || Math.abs(Number(existing[f]) - Number(incoming[f])) > 1e-9)).length;
}

/* Lignes à écrire pour un joueur, fusionnées avec ce qui existe déjà. */
function buildPlayerImport(data, fiche, ctx) {
  const meta = {
    club_id: fiche.club_id, player_id: fiche.id, season_key: ctx.season,
    source: 'import_excel', source_file_name: ctx.fileName,
  };
  let changes = 0, created = 0;
  // Mode « remplacer » : le fichier fait foi, rien n'est repris de l'existant
  // (qui sert seulement à compter ce qui change).
  const base = row => (ctx.replace ? null : row);

  const measurements = data.measurements.map(r => {
    const existing = ctx.existingMeasures.find(m =>
      m.player_id === fiche.id && m.month_label === r.month_label);
    changes += countImportChanges(existing, r, XI_MEASURE_FIELDS);
    if (!existing) created++;
    return mergeImportRow(base(existing), r, XI_MEASURE_FIELDS, {
      ...meta, month_label: r.month_label, source_sheet: 'Anthropométrie + Plis cutanés',
      created_by: existing?.created_by || ctx.userId,
    });
  });

  const tests = data.tests.map(r => {
    const existing = ctx.existingTests.find(t => t.player_id === fiche.id && t.stage === r.stage);
    changes += countImportChanges(existing, r, XI_TEST_FIELDS);
    if (!existing) created++;
    return mergeImportRow(base(existing), r, XI_TEST_FIELDS, {
      ...meta, stage: r.stage, source_sheet: 'Tests bruts + Profil sur 10',
      created_by: existing?.created_by || ctx.userId,
    });
  });

  return { measurements, tests, changes, created };
}

/* ------------------------------------------------------------
   Fenêtre d'import
   ------------------------------------------------------------ */
const ExcelImport = (() => {
  let opts = null;
  let st = null;

  const h = s => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const say = (message, type = 'info') =>
    (typeof notify === 'function' ? notify(message, type) : toast(message, type === 'info' ? '' : type));
  const fullName = p => `${p.prenom || ''} ${p.nom || ''}`.trim() || `Fiche #${p.id}`;
  const $ = id => document.getElementById(id);

  function ensureModal() {
    if ($('excelImportModal')) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = `
    <div class="modal-backdrop" id="excelImportModal">
      <div class="modal xi-modal" role="dialog" aria-labelledby="xiTitle">
        <h3 id="xiTitle">Importer l’Excel du préparateur</h3>
        <p class="text-muted xi-lead">Un seul fichier met à jour <strong>tous les joueurs du club</strong> qu’il contient.
          Réimporter une version corrigée met les valeurs à jour, sans créer de doublon.
          Une cellule vide ne supprime pas une valeur existante. Rien n’est enregistré avant votre validation.</p>
        <div class="xi-controls">
          <label>Saison<select id="xiSeason"></select></label>
          <label class="xi-file">Fichier Excel<input id="xiFile" type="file" accept=".xlsx,.xls"></label>
          <label class="xi-mode">Mode<select id="xiMode">
            <option value="merge">Compléter — une cellule vide ne supprime rien</option>
            <option value="replace">Remplacer — le fichier fait foi pour la saison</option>
          </select></label>
        </div>
        <div id="xiModeNote" class="xi-alert hidden"></div>
        <div id="xiBody" class="xi-body">
          <div class="xi-placeholder">Choisissez le fichier pour voir ce qui sera importé.</div>
        </div>
        <div class="modal-actions">
          <button class="btn" type="button" data-close="excelImportModal">Annuler</button>
          <button class="btn btn-primary" type="button" id="xiConfirm" disabled>Importer</button>
        </div>
      </div>
    </div>`;
    document.body.appendChild(wrap.firstElementChild);
    $('xiFile').addEventListener('change', e => e.target.files[0] && readFile(e.target.files[0]));
    $('xiSeason').addEventListener('change', async () => {
      if (!st) return;
      st.season = $('xiSeason').value;
      if (await loadExisting()) { compute(); render(); }
    });
    $('xiConfirm').addEventListener('click', confirm);
    $('xiMode').addEventListener('change', () => {
      showModeNote();
      if (st) { compute(); render(); }
    });
  }

  function open(options) {
    opts = options;
    ensureModal();
    st = null;
    const current = seasonKeyFor(null, opts.seasonStartMonth || 8);
    const y = Number(current.slice(0, 4));
    $('xiSeason').innerHTML = [0, 1, 2].map(i => `${y - i}-${y - i + 1}`)
      .map(s => `<option value="${s}">Saison ${s}${s === current ? ' (en cours)' : ''}</option>`).join('');
    $('xiFile').value = '';
    $('xiMode').value = 'merge';
    showModeNote();
    $('xiBody').innerHTML = '<div class="xi-placeholder">Choisissez le fichier pour voir ce qui sera importé.</div>';
    $('xiConfirm').disabled = true;
    $('xiConfirm').textContent = 'Importer';
    $('excelImportModal').classList.add('open');
  }

  const replaceMode = () => $('xiMode')?.value === 'replace';

  function showModeNote() {
    const note = $('xiModeNote');
    note.classList.toggle('hidden', !replaceMode());
    note.innerHTML = `<strong>Remplacer</strong> : pour chaque joueur coché, toutes ses mesures et tous ses tests
      de la saison choisie sont supprimés puis remplacés par ceux du fichier — saisies manuelles comprises.
      À utiliser pour repartir d’une version propre de l’Excel, par exemple après un import erroné.`;
  }

  function fail(message) {
    $('xiBody').innerHTML = `<div class="xi-error">${message}</div>`;
    $('xiConfirm').disabled = true;
  }

  async function loadExisting() {
    const [em, et] = await Promise.all([
      sb.from('player_physical_measurements').select('*').eq('club_id', opts.clubId).eq('season_key', st.season),
      sb.from('player_physical_tests').select('*').eq('club_id', opts.clubId).eq('season_key', st.season),
    ]);
    const err = em.error || et.error;
    if (err) {
      // Sans la migration, importer recréerait exactement les doublons qu'on corrige.
      fail(/season_key/.test(err.message)
        ? updateNeeded('performance_one_row_per_period.sql')
        : `Lecture des données existantes impossible : ${h(err.message)}`);
      return false;
    }
    st.existingMeasures = em.data || [];
    st.existingTests = et.data || [];
    return true;
  }

  async function readFile(file) {
    $('xiBody').innerHTML = '<div class="xi-placeholder">Lecture du fichier…</div>';
    $('xiConfirm').disabled = true;
    try {
      await loadLib('xlsx');   // 860 Ko, chargé seulement au premier import
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      const missingSheets = ['Anthropométrie', 'Tests bruts'].filter(n => !workbook.SheetNames.includes(n));
      if (missingSheets.length) {
        return fail(`Ce fichier ne suit pas le modèle attendu : onglet${missingSheets.length > 1 ? 's' : ''}
          ${missingSheets.map(n => `« ${h(n)} »`).join(', ')} introuvable${missingSheets.length > 1 ? 's' : ''}.`);
      }
      // Fiches du club avec leurs critères d'identification, et dernière taille connue.
      const [rosterRes, heightsRes] = await Promise.all([
        sb.from('players').select('id, nom, prenom, numero, poste, club_id, team_id, other_team_ids, date_naissance')
          .eq('club_id', opts.clubId).order('nom'),
        sb.from('player_physical_measurements').select('player_id, height_cm, season_key, month_label')
          .eq('club_id', opts.clubId).not('height_cm', 'is', null),
      ]);
      if (rosterRes.error) return fail(`Lecture de l’effectif impossible : ${h(rosterRes.error.message)}`);
      if (heightsRes.error) console.warn('Tailles connues indisponibles (critère ignoré) :', heightsRes.error.message);
      const heights = new Map();
      [...(heightsRes.data || [])]
        .sort((a, b) => String(a.season_key).localeCompare(String(b.season_key)) || MONTHS.indexOf(a.month_label) - MONTHS.indexOf(b.month_label))
        .forEach(m => heights.set(m.player_id, Number(m.height_cm)));

      st = {
        workbook, fileName: file.name, fileSize: file.size, fileDate: file.lastModified, season: $('xiSeason').value,
        roster: rosterRes.data || [], heights, teamId: typeof currentTeamId === 'function' ? currentTeamId() : null,
        rows: [], choice: new Map(), include: new Set(), existingMeasures: [], existingTests: [],
      };
      if (!(await loadExisting())) return;
      st.rows = readExcelRows();
      matchRows();
      compute();
      render();
    } catch (e) {
      console.error('Import Excel :', e);
      fail(`Lecture du fichier impossible : ${h(e.message)}`);
    }
  }

  /* Une ligne par joueur de l'Excel : ses valeurs et sa carte d'identité. */
  function readExcelRows() {
    const dups = excelDuplicateNames(st.workbook);
    return excelRoster(st.workbook).map(name => {
      let data = null;
      try { data = parseExcel({ name: st.fileName }, st.workbook, splitExcelName(name)); } catch { data = null; }
      return { key: normalizeName(name), name, data, identity: xmIdentity(name, data), dupInFile: dups.has(normalizeName(name)) };
    }).filter(r => r.data);
  }

  /* Rapprochement (excel-match.js) et choix par défaut : seules les lignes
     reconnues sans doute sont cochées ; les autres attendent un choix. */
  function matchRows() {
    st.rows = matchExcelRows(st.rows, st.roster, { teamId: st.teamId, heights: st.heights });
    st.choice.clear();
    st.include.clear();
    for (const r of st.rows) {
      if (r.status === 'ok') { st.choice.set(r.key, r.fiche.id); st.include.add(r.key); }
      else if (r.status === 'confirm') st.choice.set(r.key, r.fiche.id);
      else if (r.status === 'new') st.choice.set(r.key, 'new');
    }
  }

  const ficheOf = (r) => { const c = st.choice.get(r.key); return typeof c === 'number' ? st.roster.find(f => f.id === c) || null : null; };
  const bornOf = (f) => (f?.date_naissance ? String(f.date_naissance).slice(0, 10) : null);

  /* Lignes à écrire pour la fiche choisie, et la date de naissance à reprendre. */
  function compute() {
    for (const r of st.rows) {
      const fiche = ficheOf(r);
      Object.assign(r, buildPlayerImport(r.data, fiche || { id: null, club_id: opts.clubId }, {
        season: st.season, fileName: st.fileName, userId: opts.userId,
        existingMeasures: fiche ? st.existingMeasures : [], existingTests: fiche ? st.existingTests : [],
        replace: replaceMode(),
      }));
      const born = bornOf(fiche), excelBorn = r.identity.birthDate;
      r.birthFill = !!(fiche && excelBorn && !born);
      r.birthClash = !!(fiche && excelBorn && born && born !== excelBorn);
      if (r.birthFill) r.changes += 1;
    }
  }

  const day = (iso) => (iso ? iso.split('-').reverse().join('/') : '');
  const num1 = (v) => String(Math.round(v * 10) / 10).replace('.', ',');
  const team = (f) => (f.team_id && typeof teamName === 'function' ? teamName(f.team_id) : '');
  function identityLine(id) {
    return [id.birthDate && `né le ${day(id.birthDate)}`, id.height !== null && `${num1(id.height)} cm`,
      id.weight !== null && `${num1(id.weight)} kg`].filter(Boolean).join(' · ') || 'ni date de naissance ni mesure';
  }
  function ficheLabel(f) {
    const hgt = st.heights.get(f.id);
    return [fullName(f), team(f), bornOf(f) && `né le ${day(bornOf(f))}`, hgt && `${num1(hgt)} cm`,
      f.poste, f.numero !== null && f.numero !== undefined && `n° ${f.numero}`].filter(Boolean).join(' · ');
  }
  /* Ce qui rapproche (ou éloigne) la fiche choisie de la ligne de l'Excel. */
  function criteriaHtml(r) {
    const c = r.candidates.find(x => x.fiche.id === st.choice.get(r.key));
    const chips = [];
    if (c?.birth === 'same') chips.push(['ok', 'Même date de naissance']);
    if (c?.link === 'nom') chips.push(['warn', 'Fiche sans prénom']);
    if (c?.link === 'proche') chips.push(['warn', 'Orthographe proche']);
    if (c?.team) chips.push(['same', 'Équipe de l’import']);
    if (c?.height === 'near') chips.push(['ok', 'Taille proche']);
    if (c?.height === 'far') chips.push(['warn', `Taille très différente (${num1(c.knownHeight)} cm sur la fiche)`]);
    if (r.birthFill) chips.push(['update', `Date de naissance ajoutée : ${day(r.identity.birthDate)}`]);
    if (r.birthClash) chips.push(['danger', `Date de naissance différente sur la fiche (${day(bornOf(ficheOf(r)))}) : non modifiée`]);
    if (st.choice.get(r.key) === 'new') {
      (r.twins || []).forEach(f => chips.push(['warn', `Même date de naissance que ${fullName(f)} : doublon ?`]));
      r.excluded.forEach(x => chips.push(['same', `Homonyme écarté : ${fullName(x.fiche)}, né le ${day(bornOf(x.fiche))}`]));
    }
    return chips.length ? `<div class="xi-crit">${chips.map(([k, t]) => `<span class="xi-badge xi-${k}">${h(t)}</span>`).join('')}</div>` : '';
  }
  function choiceHtml(r, takenBy) {
    if (r.status === 'dup') return '<span class="xi-hint">Deux lignes du fichier portent ce nom : distinguez-les dans l’Excel.</span>';
    const cur = st.choice.get(r.key);
    const opt = (f) => {
      const other = takenBy.get(f.id);
      return `<option value="${f.id}" ${cur === f.id ? 'selected' : ''} ${other && other !== r.key ? 'disabled' : ''}>${h(ficheLabel(f))}${other && other !== r.key ? ' — déjà associée' : ''}</option>`;
    };
    const candIds = new Set(r.candidates.map(c => c.fiche.id));
    const others = st.roster.filter(f => !candIds.has(f.id));
    return `<select data-choice="${h(r.key)}" aria-label="Fiche pour ${h(r.name)}">
        ${cur === undefined ? '<option value="" selected>— Choisir la fiche —</option>' : ''}
        ${r.candidates.length ? `<optgroup label="Fiches possibles">${r.candidates.map(c => opt(c.fiche)).join('')}</optgroup>` : ''}
        <option value="new" ${cur === 'new' ? 'selected' : ''}>Créer une nouvelle fiche</option>
        ${others.length ? `<optgroup label="Autres fiches du club">${others.map(opt).join('')}</optgroup>` : ''}
      </select>${criteriaHtml(r)}`;
  }
  const STATUS = {
    ok: ['update', 'Reconnu'], confirm: ['warn', 'À confirmer'], choose: ['warn', 'À choisir'],
    new: ['same', 'Sans fiche'], dup: ['danger', 'Doublon dans le fichier'],
  };

  function render() {
    const focus = opts.focusPlayerId;
    const rank = { choose: 0, confirm: 1, dup: 2, new: 3, ok: 4 };
    const rows = [...st.rows].sort((a, b) => (st.choice.get(b.key) === focus) - (st.choice.get(a.key) === focus)
      || rank[a.status] - rank[b.status] || a.name.localeCompare(b.name, 'fr'));
    const takenBy = new Map();
    st.rows.forEach(r => { const c = st.choice.get(r.key); if (typeof c === 'number') takenBy.set(c, r.key); });
    const absent = st.roster.filter(f => !takenBy.has(f.id));
    const count = (s) => st.rows.filter(r => r.status === s).length;
    const toCheck = count('choose') + count('confirm') + count('dup');
    const nLines = r => r.measurements.length + r.tests.length;

    const SHEETS = ['Anthropométrie', 'Plis cutanés', 'Tests bruts', 'Profil sur 10'];
    const kb = Math.max(1, Math.round((st.fileSize || 0) / 1024));
    const when = st.fileDate ? new Date(st.fileDate).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
    const source = `<div class="xi-source">
        <div class="xi-source-file"><span class="xi-source-k">Source</span><strong>${h(st.fileName)}</strong>
          <small>${kb} Ko${when ? ` · modifié le ${h(when)}` : ''} · ${st.workbook.SheetNames.length} onglets</small></div>
        <ul class="xi-sheets">${SHEETS.map(n => `<li class="${st.workbook.SheetNames.includes(n) ? 'is-ok' : 'is-missing'}">${st.workbook.SheetNames.includes(n) ? '✓' : '—'} ${h(n)}</li>`).join('')}</ul>
        <div class="xi-source-target"><span class="xi-source-k">Vers</span><strong>Saison ${h(st.season)}</strong><small>${replaceMode() ? 'Remplacer' : 'Compléter'}</small></div>
      </div>`;

    $('xiBody').innerHTML = source + `
      <div class="xi-summary">
        <div><strong>${count('ok')}</strong> reconnu${count('ok') > 1 ? 's' : ''}</div>
        <div><strong>${toCheck}</strong> à vérifier</div>
        <div><strong>${count('new')}</strong> sans fiche</div>
        <div><strong>${absent.length}</strong> fiche${absent.length > 1 ? 's' : ''} absente${absent.length > 1 ? 's' : ''} du fichier</div>
      </div>
      ${toCheck ? `<div class="xi-alert">${toCheck} ligne${toCheck > 1 ? 's' : ''} à vérifier : rien n’y est importé sans votre choix.
        Chaque fiche possible est présentée avec son équipe, sa date de naissance et sa taille ; une date de naissance différente écarte une fiche.</div>` : ''}

      <div data-select-scope="#xiBody .xi-table" id="xiSelectMatched">${selectAllHtml()}</div>
      <table class="xi-table">
        <thead><tr><th></th><th>Dans l’Excel</th><th>Fiche</th><th>Statut</th><th>Changements</th></tr></thead>
        <tbody>${rows.map(r => {
          const cur = st.choice.get(r.key), ready = r.status !== 'dup' && cur !== undefined;
          const [cls, label] = STATUS[r.status];
          return `
          <tr class="xi-${r.status}${cur === focus && focus ? ' is-focus' : ''}">
            <td><input type="checkbox" data-include="${h(r.key)}" aria-label="Importer ${h(r.name)}"
              ${st.include.has(r.key) && ready ? 'checked' : ''} ${ready ? '' : 'disabled'}></td>
            <td class="xi-src"><strong>${h(r.name)}</strong><small>${h(identityLine(r.identity))}</small></td>
            <td class="xi-choice">${choiceHtml(r, takenBy)}</td>
            <td><span class="xi-badge xi-${cls}">${label}</span>${r.reason ? `<small class="xi-reason">${h(r.reason)}</small>` : ''}</td>
            <td class="xi-num">${!nLines(r) && !r.birthFill ? 'Aucune valeur' : !ready ? '—' : r.changes ? `${r.changes} valeur${r.changes > 1 ? 's' : ''}` : 'Déjà à jour'}
              ${nLines(r) ? `<button class="xi-more" type="button" data-detail="${h(r.key)}" aria-expanded="false">Voir</button>` : ''}</td>
          </tr>
          ${nLines(r) ? `<tr class="xi-detail hidden" data-detail-row="${h(r.key)}"><td></td><td colspan="4">${detailHtml(r)}</td></tr>` : ''}`;
        }).join('')}
        </tbody>
      </table>

      ${absent.length ? `<details class="xi-section">
        <summary>Fiches du club absentes du fichier (${absent.length})</summary>
        <p class="xi-hint">Rien n’est modifié sur ces fiches. Si l’une d’elles figure dans l’Excel sous une autre orthographe, choisissez-la sur la ligne correspondante.</p>
        <p class="xi-absent">${absent.map(f => h(fullName(f))).join(' · ')}</p>
      </details>` : ''}`;

    $('xiBody').querySelectorAll('[data-detail]').forEach(b => b.addEventListener('click', () => {
      const row = $('xiBody').querySelector(`[data-detail-row="${b.dataset.detail}"]`);
      const open = row.classList.toggle('hidden') === false;
      b.setAttribute('aria-expanded', String(open));
      b.textContent = open ? 'Masquer' : 'Voir';
    }));
    // « Tout sélectionner » : les lignes reconnues ; une ligne à vérifier se coche à la main.
    $('xiSelectMatched')?.addEventListener('select-all', (ev) => {
      ev.preventDefault();
      if (ev.detail.on) st.rows.filter(r => r.status === 'ok' && st.choice.has(r.key)).forEach(r => st.include.add(r.key));
      else st.include.clear();
      render();
    });
    // Cocher une ligne « à confirmer » vaut confirmation de la fiche proposée.
    $('xiBody').querySelectorAll('[data-include]').forEach(cb => cb.addEventListener('change', () => {
      cb.checked ? st.include.add(cb.dataset.include) : st.include.delete(cb.dataset.include);
      updateConfirm();
    }));
    // Choisir une fiche (ou la création) est un choix explicite : la ligne est cochée.
    $('xiBody').querySelectorAll('[data-choice]').forEach(sel => sel.addEventListener('change', () => {
      const key = sel.dataset.choice;
      if (!sel.value) { st.choice.delete(key); st.include.delete(key); }
      else { st.choice.set(key, sel.value === 'new' ? 'new' : Number(sel.value)); st.include.add(key); }
      compute(); render();
    }));
    updateConfirm();
  }

  /* Valeurs qui seront écrites pour un joueur, telles que lues dans le
     classeur : le préparateur vérifie la correspondance avant d'importer. */
  function detailHtml(e) {
    const val = (m, v) => `${Number(v).toFixed(m.digits).replace('.', ',')}${m.unit === '%' ? ' %' : ` ${m.unit}`}`;
    const line = (label, metrics, r) => {
      const parts = metrics.filter(m => r[m.key] !== null && r[m.key] !== undefined && r[m.key] !== '')
        .map(m => `${h(m.short || m.label)} <b>${val(m, r[m.key])}</b>`);
      return parts.length ? `<li><span>${h(label)}</span>${parts.join(' · ')}</li>` : '';
    };
    const meas = e.measurements.map(r => line(r.month_label || 'Mesure', MORPHO_METRICS, r)).join('');
    const tests = e.tests.map(r => line(STAGES.find(x => x.key === r.stage)?.label || r.stage, PERF_METRICS, r)).join('');
    return `<div class="xi-values">
      ${meas ? `<div><h5>Mesures</h5><ul>${meas}</ul></div>` : ''}
      ${tests ? `<div><h5>Tests</h5><ul>${tests}</ul></div>` : ''}
      ${!meas && !tests ? '<p class="xi-hint">Aucune valeur lisible pour ce joueur.</p>' : ''}
    </div>`;
  }

  const picked = () => st.rows.filter(r => st.include.has(r.key) && r.status !== 'dup' && st.choice.has(r.key));
  function updateConfirm() {
    const n = picked().length;
    $('xiConfirm').disabled = n === 0;
    $('xiConfirm').textContent = n ? `Importer (${n} joueur${n > 1 ? 's' : ''})` : 'Importer';
  }

  async function confirm() {
    if (!st) return;
    const btn = $('xiConfirm');
    btn.disabled = true;
    btn.textContent = 'Import en cours…';

    try {
      const rows = picked();
      // Garde-fou : une fiche ne reçoit jamais deux lignes de l'Excel.
      const ids = rows.map(r => st.choice.get(r.key)).filter(v => typeof v === 'number');
      if (new Set(ids).size !== ids.length) throw new Error('une fiche est associée à deux lignes de l’Excel.');

      // 1) Fiches à créer (avec la date de naissance du classeur), puis lignes de chaque joueur.
      const chosen = [], createdFiches = [], births = [];
      for (const r of rows) {
        let fiche = ficheOf(r);
        if (st.choice.get(r.key) === 'new') {
          const { nom, prenom } = splitExcelName(r.name);
          const { data, error } = await sb.from('players')
            // Rattachée à l'équipe choisie dans le menu, s'il y en a une.
            .insert({ club_id: opts.clubId, nom, prenom: prenom || null,
              ...(r.identity.birthDate ? { date_naissance: r.identity.birthDate } : {}),
              ...(st.teamId ? { team_id: st.teamId } : {}) })
            .select('id, nom, prenom, numero, club_id').single();
          if (error) throw new Error(`création de la fiche « ${r.name} » : ${error.message}`);
          fiche = data;
          createdFiches.push(fiche);
        } else if (r.birthFill) births.push({ id: fiche.id, date: r.identity.birthDate });
        const isNew = createdFiches.includes(fiche);
        chosen.push({ fiche, ...buildPlayerImport(r.data, fiche, {
          season: st.season, fileName: st.fileName, userId: opts.userId,
          existingMeasures: isNew ? [] : st.existingMeasures, existingTests: isNew ? [] : st.existingTests,
          replace: replaceMode(),
        }) });
      }

      // 2) Mode « remplacer » : la saison des joueurs cochés repart de zéro.
      if (replaceMode()) {
        const playerIds = chosen.map(e => e.fiche.id);
        for (const table of ['player_physical_measurements', 'player_physical_tests']) {
          const { error } = await sb.from(table).delete()
            .eq('club_id', opts.clubId).eq('season_key', st.season).in('player_id', playerIds);
          if (error) throw new Error(`nettoyage avant remplacement : ${error.message}`);
        }
      }

      // 3) Écriture groupée, sur les clés (joueur, saison, mois|session).
      const mRows = chosen.flatMap(e => e.measurements);
      const tRows = chosen.flatMap(e => e.tests);
      if (mRows.length) {
        const { error } = await sb.from('player_physical_measurements')
          .upsert(mRows, { onConflict: 'club_id,player_id,season_key,month_label' });
        if (error) throw error;
      }
      if (tRows.length) {
        const { error } = await sb.from('player_physical_tests')
          .upsert(tRows, { onConflict: 'club_id,player_id,season_key,stage' });
        if (error) throw error;
      }

      // 4) Dates de naissance : seulement sur les fiches qui n'en ont pas (jamais écrasées).
      const birthRes = await Promise.all(births.map(b => sb.from('players').update({ date_naissance: b.date })
        .eq('id', b.id).is('date_naissance', null).select('id')));
      const birthMissed = birthRes.filter(({ data, error }) => {
        if (error) console.warn('Date de naissance non reprise :', error.message);
        return error || !data?.length;
      }).length;
      const birthDone = births.length - birthMissed;

      $('excelImportModal').classList.remove('open');
      say(`Import terminé : ${chosen.length} joueur${chosen.length > 1 ? 's' : ''}` +
        `${createdFiches.length ? ` (dont ${createdFiches.length} fiche${createdFiches.length > 1 ? 's' : ''} créée${createdFiches.length > 1 ? 's' : ''})` : ''}` +
        `${birthDone ? `, ${birthDone} date${birthDone > 1 ? 's' : ''} de naissance ajoutée${birthDone > 1 ? 's' : ''}` : ''}` +
        `, saison ${st.season}.` +
        `${birthMissed ? ` ${birthMissed} date${birthMissed > 1 ? 's' : ''} de naissance non reprise${birthMissed > 1 ? 's' : ''} (droits du compte ou fiche modifiée entre-temps).` : ''}`, 'success');
      st = null;
      await opts.onDone?.();
    } catch (e) {
      console.error('Import Excel :', e);
      say(`Import non effectué : ${e.message}`, 'error');
      btn.disabled = false;
      updateConfirm();
    }
  }

  return { open };
})();
