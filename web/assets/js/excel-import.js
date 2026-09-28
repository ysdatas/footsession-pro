/* ============================================================
   FootSession Pro — excel-import.js
   Import du classeur du préparateur physique pour TOUT le club.

   Utilisé depuis la page Joueurs et depuis la fiche Performance :
   un seul fichier met à jour tous les joueurs qu'il contient.

   Principes :
   - chaque joueur est lu sur SA ligne : aucune donnée ne peut passer
     d'un joueur à un autre ; un nom revendiqué par deux fiches est
     signalé et exclu ;
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

/* Noms de joueurs présents dans le classeur (une entrée par personne). */
function excelRoster(workbook) {
  const names = new Map();
  for (const sheet of ['Tests bruts', 'Anthropométrie', 'Profil sur 10', 'Plis cutanés']) {
    const rows = workbookRows(workbook, sheet);
    for (let r = 4; r < rows.length; r++) {
      const cell = (rows[r] || []).find(v => {
        const t = String(v ?? '').trim();
        return t && !/^[+-]?\d+(?:[.,]\d+)?$/.test(t) && !isAggregateName(t);
      });
      if (!cell) continue;
      const key = normalizeName(cell);
      if (key && !names.has(key)) names.set(key, String(cell).trim());
    }
  }
  return [...names.values()];
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

  let surnameOnlyMatch = null;

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

    if (!surnameOnlyMatch) {
      surnameOnlyMatch = {
        index: r,
        name: matchedText || String(target.nom || '').trim()
      };
    }
  }

  return surnameOnlyMatch;
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

/* Lit le classeur du préparateur pour UN joueur.
   Décalages du modèle Tests_Physiques_N2-5 (vérifiés contre le fichier réel) :
     Anthropométrie  en-tête ligne 4 ; taille col C.., poids col N.., MG col Y..
     Plis cutanés    âge col C, puis 6 colonnes par mois à partir de D
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

  const age = num(foldRow[2]);

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
        age_at_measurement: age,
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

    const ratio = playerSheet?.ratioByStage?.[s.key] ?? null;

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
        ? `La base n’est pas encore prête pour l’import par saison.<br>
           Exécutez <code>supabase/performance_one_row_per_period.sql</code> dans Supabase, puis réessayez.`
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
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      const missingSheets = ['Anthropométrie', 'Tests bruts'].filter(n => !workbook.SheetNames.includes(n));
      if (missingSheets.length) {
        return fail(`Ce fichier ne suit pas le modèle attendu : onglet${missingSheets.length > 1 ? 's' : ''}
          ${missingSheets.map(n => `« ${h(n)} »`).join(', ')} introuvable${missingSheets.length > 1 ? 's' : ''}.`);
      }
      const { data: roster, error } = await sb.from('players')
        .select('id, nom, prenom, numero, club_id').eq('club_id', opts.clubId).order('nom');
      if (error) return fail(`Lecture de l’effectif impossible : ${h(error.message)}`);

      st = {
        workbook, fileName: file.name, season: $('xiSeason').value, roster: roster || [],
        overrides: new Map(), suggested: new Set(), include: new Set(), create: new Set(),
        existingMeasures: [], existingTests: [],
      };
      if (!(await loadExisting())) return;
      compute();
      suggestMatches();
      compute();
      // Par défaut : tous les joueurs reconnus sans ambiguïté.
      st.entries.filter(e => e.status === 'ok').forEach(e => st.include.add(e.fiche.id));
      render();
    } catch (e) {
      console.error('Import Excel :', e);
      fail(`Lecture du fichier impossible : ${h(e.message)}`);
    }
  }

  /* Lit chaque fiche du club dans le classeur et classe le résultat. */
  function compute() {
    st.entries = st.roster.map(fiche => {
      const override = st.overrides.get(fiche.id) || null;
      const target = override ? { ...fiche, ...splitExcelName(override) } : fiche;
      let data = null;
      try { data = parseExcel({ name: st.fileName }, st.workbook, target); } catch { data = null; }
      // Toutes les orthographes rencontrées pour ce joueur : le classeur
      // peut écrire le même prénom différemment d'un onglet à l'autre.
      const claims = data
        ? new Set([...data.excelNames, override].filter(Boolean).map(normalizeName))
        : new Set();
      return { fiche, data, override, claims };
    });

    const byClaim = new Map();
    for (const e of st.entries) {
      for (const c of e.claims) byClaim.set(c, [...(byClaim.get(c) || []), e]);
    }
    for (const e of st.entries) {
      const shared = [...e.claims].some(c => byClaim.get(c).length > 1);
      e.status = !e.data ? 'absent'
        : shared ? 'conflict'
        : st.suggested.has(e.fiche.id) ? 'suggested'
        : 'ok';
      if (e.status === 'conflict' || e.status === 'absent') st.include.delete(e.fiche.id);
      if (e.data) Object.assign(e, buildPlayerImport(e.data, e.fiche, {
        season: st.season, fileName: st.fileName, userId: opts.userId,
        existingMeasures: st.existingMeasures, existingTests: st.existingTests,
        replace: replaceMode(),
      }));
    }
    st.orphans = excelRoster(st.workbook).filter(n => !byClaim.has(normalizeName(n)));
    for (const n of [...st.create]) if (!st.orphans.includes(n)) st.create.delete(n);
  }

  /* Orthographe différente entre la fiche et l'Excel (« Botherel » /
     « BOTHOREL ») : même prénom et nom à une ou deux lettres près.
     Le rapprochement est proposé, jamais appliqué sans validation. */
  function suggestMatches() {
    const orphans = st.orphans.map(n => ({ name: n, ...splitExcelName(n) }));
    for (const e of st.entries.filter(x => x.status === 'absent')) {
      const first = normalizeName(e.fiche.prenom);
      const last = normalizeName(e.fiche.nom);
      if (!first || !last) continue;
      const candidates = orphans.filter(o => {
        if (normalizeName(o.prenom) !== first) return false;
        const d = levenshtein(normalizeName(o.nom), last);
        return d > 0 && d <= (last.length < 5 ? 1 : 2);
      });
      if (candidates.length === 1) {
        st.overrides.set(e.fiche.id, candidates[0].name);
        st.suggested.add(e.fiche.id);
      }
    }
  }

  function render() {
    const focus = opts.focusPlayerId;
    const order = { conflict: 0, suggested: 1, ok: 2, absent: 3 };
    const matched = st.entries.filter(e => e.data)
      .sort((a, b) => (b.fiche.id === focus) - (a.fiche.id === focus)
        || order[a.status] - order[b.status] || fullName(a.fiche).localeCompare(fullName(b.fiche)));
    const absent = st.entries.filter(e => !e.data);
    const included = matched.filter(e => st.include.has(e.fiche.id));
    const toUpdate = included.filter(e => e.changes > 0).length;
    const conflicts = matched.filter(e => e.status === 'conflict').length;

    const statusCell = e => ({
      ok: e.changes ? `<span class="xi-badge xi-update">${e.changes} valeur${e.changes > 1 ? 's' : ''}</span>`
                    : '<span class="xi-badge xi-same">déjà à jour</span>',
      suggested: '<span class="xi-badge xi-warn">rapprochement à confirmer</span>',
      conflict: '<span class="xi-badge xi-danger">ambigu : exclu</span>',
    })[e.status];

    const nLines = e => e.measurements.length + e.tests.length;

    $('xiBody').innerHTML = `
      <div class="xi-summary">
        <div><strong>${matched.length}</strong> joueur${matched.length > 1 ? 's' : ''} reconnu${matched.length > 1 ? 's' : ''}</div>
        <div><strong>${toUpdate}</strong> à mettre à jour</div>
        <div><strong>${st.orphans.length}</strong> sans fiche</div>
        <div><strong>${absent.length}</strong> fiche${absent.length > 1 ? 's' : ''} absente${absent.length > 1 ? 's' : ''} du fichier</div>
      </div>
      ${conflicts ? `<div class="xi-alert">${conflicts} fiche${conflicts > 1 ? 's revendiquent' : ' revendique'} la même ligne de l’Excel
        qu’une autre (homonymes ?). Elles sont exclues pour ne pas mélanger les données : précisez le prénom sur les fiches concernées.</div>` : ''}

      <table class="xi-table">
        <thead><tr><th></th><th>Fiche</th><th>Nom dans l’Excel</th><th>Lignes</th><th>Changements</th></tr></thead>
        <tbody>${matched.map(e => `
          <tr class="${e.fiche.id === focus ? 'is-focus' : ''} xi-${e.status}">
            <td><input type="checkbox" data-include="${e.fiche.id}" aria-label="Importer ${h(fullName(e.fiche))}"
              ${st.include.has(e.fiche.id) ? 'checked' : ''} ${e.status === 'conflict' ? 'disabled' : ''}></td>
            <td class="xi-name">${h(fullName(e.fiche))}${e.fiche.id === focus ? ' <small>(fiche ouverte)</small>' : ''}</td>
            <td class="xi-src">${h([...new Set(e.data.excelNames)].join(' · ') || e.override || '—')}
              ${e.data.individualSheet ? `<small>onglet ${h(e.data.individualSheet)}</small>` : ''}</td>
            <td class="xi-num">${nLines(e)}${e.created ? ` <small>dont ${e.created} nouvelle${e.created > 1 ? 's' : ''}</small>` : ''}</td>
            <td>${statusCell(e)}</td>
          </tr>`).join('')}
        </tbody>
      </table>

      ${absent.length ? `<div class="xi-section">
        <h4>Fiches absentes du fichier</h4>
        <p class="xi-hint">Si le joueur figure dans l’Excel sous une autre orthographe, associez-le.</p>
        ${absent.map(e => `<div class="xi-row">
          <span>${h(fullName(e.fiche))}</span>
          <select data-assoc="${e.fiche.id}">
            <option value="">— non présent dans l’Excel —</option>
            ${st.orphans.map(n => `<option value="${h(n)}">${h(n)}</option>`).join('')}
          </select>
        </div>`).join('')}
      </div>` : ''}

      ${st.orphans.length ? `<div class="xi-section">
        <h4>Dans l’Excel, sans fiche dans le club</h4>
        <p class="xi-hint">Cochez pour créer la fiche et importer ses données en même temps.</p>
        ${st.orphans.map(n => `<label class="xi-row xi-check">
          <input type="checkbox" data-create="${h(n)}" ${st.create.has(n) ? 'checked' : ''}>
          <span>${h(n)}</span><small>${h(`fiche « ${[splitExcelName(n).prenom, splitExcelName(n).nom].filter(Boolean).join(' ')} »`)}</small>
        </label>`).join('')}
      </div>` : ''}`;

    // Association choisie : la sélection courante est restituée.
    absent.forEach(e => {
      const sel = $('xiBody').querySelector(`select[data-assoc="${e.fiche.id}"]`);
      if (sel) sel.value = st.overrides.get(e.fiche.id) || '';
    });

    $('xiBody').querySelectorAll('[data-include]').forEach(cb => cb.addEventListener('change', () => {
      const id = Number(cb.dataset.include);
      cb.checked ? st.include.add(id) : st.include.delete(id);
      // Cocher un rapprochement proposé vaut confirmation.
      if (cb.checked && st.suggested.delete(id)) { compute(); render(); return; }
      updateConfirm();
    }));
    $('xiBody').querySelectorAll('[data-assoc]').forEach(sel => sel.addEventListener('change', () => {
      const id = Number(sel.dataset.assoc);
      st.suggested.delete(id);
      if (sel.value) { st.overrides.set(id, sel.value); st.include.add(id); }
      else { st.overrides.delete(id); st.include.delete(id); }
      compute(); render();
    }));
    $('xiBody').querySelectorAll('[data-create]').forEach(cb => cb.addEventListener('change', () => {
      cb.checked ? st.create.add(cb.dataset.create) : st.create.delete(cb.dataset.create);
      updateConfirm();
    }));
    updateConfirm();
  }

  function updateConfirm() {
    const n = st.entries.filter(e => e.data && e.status !== 'conflict' && st.include.has(e.fiche.id)).length + st.create.size;
    $('xiConfirm').disabled = n === 0;
    $('xiConfirm').textContent = n ? `Importer (${n} joueur${n > 1 ? 's' : ''})` : 'Importer';
  }

  async function confirm() {
    if (!st) return;
    const btn = $('xiConfirm');
    btn.disabled = true;
    btn.textContent = 'Import en cours…';

    try {
      const chosen = st.entries.filter(e => e.data && e.status !== 'conflict' && st.include.has(e.fiche.id));

      // 1) Fiches à créer, puis lecture de leurs données.
      const createdFiches = [];
      for (const name of st.create) {
        const { nom, prenom } = splitExcelName(name);
        const { data: fiche, error } = await sb.from('players')
          // Rattachée à l'équipe choisie dans le menu, s'il y en a une.
          .insert({ club_id: opts.clubId, nom, prenom: prenom || null,
            ...(typeof currentTeamId === 'function' && currentTeamId() ? { team_id: currentTeamId() } : {}) })
          .select('id, nom, prenom, numero, club_id').single();
        if (error) throw new Error(`création de la fiche « ${name} » : ${error.message}`);
        createdFiches.push(fiche);
        const data = parseExcel({ name: st.fileName }, st.workbook, { ...fiche, ...splitExcelName(name) });
        chosen.push({ fiche, data, ...buildPlayerImport(data, fiche, {
          season: st.season, fileName: st.fileName, userId: opts.userId,
          existingMeasures: [], existingTests: [],
        }) });
      }

      // 2) Mode « remplacer » : la saison des joueurs cochés repart de zéro.
      if (replaceMode()) {
        const ids = chosen.map(e => e.fiche.id);
        for (const table of ['player_physical_measurements', 'player_physical_tests']) {
          const { error } = await sb.from(table).delete()
            .eq('club_id', opts.clubId).eq('season_key', st.season).in('player_id', ids);
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

      $('excelImportModal').classList.remove('open');
      say(`Import terminé : ${chosen.length} joueur${chosen.length > 1 ? 's' : ''}` +
        `${createdFiches.length ? ` (dont ${createdFiches.length} fiche${createdFiches.length > 1 ? 's' : ''} créée${createdFiches.length > 1 ? 's' : ''})` : ''}` +
        `, saison ${st.season}.`, 'success');
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
