<?php
require_once __DIR__ . '/php/includes/bootstrap.php';
require_login();

$id = (int) ($_GET['id'] ?? 0);

// Vérifie l'existence et la propriété avant d'afficher l'éditeur.
$pdo = getDB();
$st  = $pdo->prepare('SELECT id, user_id FROM sessions WHERE id = :id LIMIT 1');
$st->execute(['id' => $id]);
$s = $st->fetch();
if (!$s || (!is_admin() && (int) $s['user_id'] !== current_user_id())) {
    header('Location: sessions.php');
    exit;
}

$mode = 'edit';
page_head('Modifier la séance', ['session.css', 'pdf.css']);
app_shell_open('sessions');
include __DIR__ . '/php/includes/session_editor.php';
?>
<!-- Partage & commentaires de la cellule (mode édition) -->
<div class="dash-grid" style="margin-top:18px;">
  <div class="card">
    <h3>Commentaires de la cellule</h3>
    <div id="commentList" class="comment-list"><p class="text-muted">Chargement…</p></div>
    <div class="field" style="margin-top:10px;">
      <textarea id="commentInput" placeholder="Ajouter une note (analyste, prépa, coach…)" rows="2"></textarea>
    </div>
    <button class="btn btn-primary btn-sm" id="commentSend" type="button">Publier</button>
  </div>
  <div class="card">
    <h3>Partage lecture seule</h3>
    <p class="text-muted" style="font-size:.85rem;">Générez un lien consultable sans compte (staff, joueurs).</p>
    <div id="shareArea">
      <button class="btn btn-primary" id="shareToggle" type="button">Générer un lien</button>
    </div>
  </div>
</div>
<?php
echo '<script>window.SESSION_ID=' . (int) $id . ';window.EDITOR_MODE="edit";</script>';
app_shell_close([
    'app.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
    'pdf-generator.js',
    'session.js',
]);
