<?php
/**
 * Markup partagé de l'éditeur de séance (create-session.php / edit-session.php).
 * Attend une variable $mode = 'create' | 'edit'.
 */
$isEdit = ($mode ?? 'create') === 'edit';
?>
<div class="page-head">
  <div>
    <h1><?= $isEdit ? 'Modifier la séance' : 'Créer une séance' ?>
      <?php if ($isEdit): ?><span class="badge badge-gold">ÉDITION</span><?php endif; ?>
    </h1>
    <p class="subtitle" id="editorSubtitle">Renseignez les informations puis ajoutez vos procédés.</p>
  </div>
  <div class="page-actions">
    <a class="btn" href="create-session.php">+ Nouvelle</a>
    <button class="btn" id="btnExportPdf" type="button">Exporter PDF</button>
    <button class="btn btn-primary" id="btnSave" type="button"><?= $isEdit ? 'Mettre à jour' : 'Sauvegarder' ?></button>
  </div>
</div>

<div class="card">
  <h3>Informations de la séance</h3>
  <div class="field-row">
    <div class="field" style="flex:2;"><label for="f-titre">Titre</label>
      <input id="f-titre" placeholder="Ex: Travail des transitions" required></div>
    <div class="field"><label for="f-date">Date</label>
      <input id="f-date" type="date"></div>
  </div>
  <div class="field-row">
    <div class="field"><label for="f-categorie">Catégorie</label>
      <input id="f-categorie" placeholder="Ex: Transitions" list="cat-list">
      <datalist id="cat-list">
        <option>Transitions</option><option>Possession</option><option>Pressing</option>
        <option>Finition</option><option>Tactique</option><option>Physique</option>
        <option>Coups de pied arrêtés</option><option>Technique</option>
      </datalist>
    </div>
    <div class="field"><label for="f-equipe">Équipe</label>
      <input id="f-equipe" placeholder="Ex: U17"></div>
    <div class="field"><label for="f-duree">Durée totale (min)</label>
      <input id="f-duree" type="number" min="0" step="5" value="90"></div>
  </div>
  <div class="editor-meta" id="editorMeta">0 procédé · 0 min au total</div>
</div>

<div class="editor-section">
  <div class="flex-between" style="margin:22px 0 12px;">
    <h2 style="margin:0;">Procédés (<span id="procCount">0</span>)</h2>
    <div class="page-actions">
      <button class="btn" id="btnLibrary" type="button">Bibliothèque</button>
      <button class="btn" id="btnAddProc" type="button">+ Ajouter un procédé</button>
    </div>
  </div>
  <div id="proceduresList"></div>
  <button class="btn add-proc-wide" id="btnAddProc2" type="button">+ Ajouter un procédé</button>
</div>

<div class="card attendance" style="margin-top:18px;">
  <button class="attendance-head" id="attendanceToggle" type="button">
    <span>Présence des joueurs <span class="badge" id="presentCount">0 marqué</span></span>
    <span class="chevron">▾</span>
  </button>
  <div id="attendanceBody" class="attendance-body">
    <div id="attendanceList" class="attendance-grid"></div>
  </div>
</div>

<!-- Modale bibliothèque d'exercices -->
<div class="modal-backdrop" id="libraryModal">
  <div class="modal" style="max-width:620px;">
    <div class="flex-between" style="margin-bottom:14px;">
      <h3 style="margin:0;">Bibliothèque d'exercices</h3>
      <button class="btn btn-sm" type="button" data-close="libraryModal">Fermer</button>
    </div>
    <div id="libraryList" class="library-grid"><p class="text-muted">Chargement…</p></div>
  </div>
</div>
