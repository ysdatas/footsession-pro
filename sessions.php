<?php
require_once __DIR__ . '/php/includes/bootstrap.php';
require_login();

$pdo = getDB();
[$where, $params] = is_admin() ? ['1=1', []] : ['s.user_id = :uid', ['uid' => current_user_id()]];
$st = $pdo->prepare("SELECT s.*, (SELECT COUNT(*) FROM procedures WHERE session_id = s.id) nb
                     FROM sessions s WHERE $where ORDER BY s.date_seance DESC, s.id DESC");
$st->execute($params);
$sessions = $st->fetchAll();

page_head('Mes séances', ['session.css', 'pdf.css']);
app_shell_open('sessions');
?>
<div class="page-head">
  <div>
    <h1>Mes séances</h1>
    <p class="subtitle"><?= count($sessions) ?> séance<?= count($sessions) > 1 ? 's' : '' ?> au total</p>
  </div>
  <div class="page-actions">
    <?php if (can_edit()): ?><a class="btn btn-primary" href="create-session.php">+ Nouvelle séance</a><?php endif; ?>
  </div>
</div>

<div class="field" style="max-width:340px;">
  <input id="searchSession" placeholder="Rechercher une séance…">
</div>

<?php if (!$sessions): ?>
  <div class="empty">Aucune séance enregistrée.</div>
<?php else: ?>
  <div class="card" style="padding:6px;">
    <table class="table" id="sessionsTable">
      <thead><tr><th>Titre</th><th>Date</th><th>Catégorie</th><th>Équipe</th><th>Durée</th><th>Procédés</th><th></th></tr></thead>
      <tbody>
        <?php foreach ($sessions as $s): ?>
          <tr data-search="<?= e(mb_strtolower($s['titre'] . ' ' . $s['categorie'] . ' ' . $s['equipe'])) ?>">
            <td><a class="text-gold" href="edit-session.php?id=<?= (int) $s['id'] ?>"><?= e($s['titre']) ?></a></td>
            <td><?= e($s['date_seance']) ?></td>
            <td><?= $s['categorie'] ? '<span class="badge">' . e($s['categorie']) . '</span>' : '—' ?></td>
            <td><?= e($s['equipe'] ?: '—') ?></td>
            <td><?= (int) $s['duree_min'] ?> min</td>
            <td><?= (int) $s['nb'] ?></td>
            <td style="text-align:right;white-space:nowrap;">
              <a class="btn btn-sm" href="edit-session.php?id=<?= (int) $s['id'] ?>">Ouvrir</a>
              <button class="btn btn-sm" type="button" onclick="generateSessionPDF(<?= (int) $s['id'] ?>)">PDF</button>
              <?php if (can_edit()): ?>
                <button class="btn btn-sm btn-danger" type="button" onclick="deleteSession(<?= (int) $s['id'] ?>, this)">Suppr.</button>
              <?php endif; ?>
            </td>
          </tr>
        <?php endforeach; ?>
      </tbody>
    </table>
  </div>
<?php endif; ?>

<script>
  document.getElementById('searchSession')?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll('#sessionsTable tbody tr').forEach(tr => {
      tr.style.display = tr.dataset.search.includes(q) ? '' : 'none';
    });
  });
  async function deleteSession(id, btn) {
    if (!confirm('Supprimer cette séance et tous ses procédés ?')) return;
    try {
      await API('php/api/sessions.php?action=delete&id=' + id, { method: 'POST', body: {} });
      btn.closest('tr').remove();
      toast('Séance supprimée.', 'success');
    } catch (err) { toast(err.message, 'error'); }
  }
</script>
<?php
app_shell_close([
    'app.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
    'pdf-generator.js',
]);
