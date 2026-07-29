<?php
require_once __DIR__ . '/php/includes/bootstrap.php';
require_login();
page_head('Mes joueurs', ['players.css']);
app_shell_open('players');
$canEdit = can_edit();
?>
<div class="page-head">
  <div>
    <h1>Mes joueurs</h1>
    <p class="subtitle" id="playersSub">Chargement…</p>
  </div>
  <div class="page-actions">
    <div class="segmented" id="viewSwitch">
      <button data-view="grid" class="active">Grille</button>
      <button data-view="matrix">Présence</button>
    </div>
    <?php if ($canEdit): ?><button class="btn btn-primary" id="btnAddPlayer" type="button">+ Ajouter</button><?php endif; ?>
  </div>
</div>

<div class="field" style="max-width:340px;">
  <input id="searchPlayer" placeholder="Rechercher…">
</div>

<div id="gridView"><div class="empty">Chargement…</div></div>
<div id="matrixView" class="hidden"></div>

<!-- Modale ajout/édition -->
<div class="modal-backdrop" id="playerModal">
  <div class="modal">
    <h3 id="playerModalTitle">Nouveau joueur</h3>
    <input type="hidden" id="m-id">
    <div class="field-row">
      <div class="field"><label>Prénom</label><input id="m-prenom"></div>
      <div class="field"><label>Nom</label><input id="m-nom" required></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Numéro</label><input id="m-numero" type="number" min="0"></div>
      <div class="field"><label>Poste</label>
        <input id="m-poste" list="poste-list" placeholder="Ex: MC, DC, AT…">
        <datalist id="poste-list">
          <option>GB</option><option>DC</option><option>DD</option><option>DG</option>
          <option>MDF</option><option>MC</option><option>MO</option>
          <option>AD</option><option>AG</option><option>BU</option><option>RW</option><option>LW</option>
        </datalist>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn" type="button" data-close="playerModal">Annuler</button>
      <button class="btn btn-primary" id="m-save" type="button">Enregistrer</button>
    </div>
  </div>
</div>

<!-- Modale détail -->
<div class="modal-backdrop" id="detailModal">
  <div class="modal" id="detailBody"></div>
</div>

<?php
app_shell_close(['app.js', 'players.js']);
