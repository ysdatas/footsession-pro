<?php
require_once __DIR__ . '/php/includes/bootstrap.php';
require_role(['admin']);

$pdo = getDB();
$users = $pdo->query("SELECT u.*,
    (SELECT COUNT(*) FROM sessions WHERE user_id = u.id) AS nb_sessions,
    (SELECT COUNT(*) FROM players  WHERE user_id = u.id) AS nb_players
    FROM users u ORDER BY u.created_at DESC")->fetchAll();

$status = $_GET['status'] ?? '';
$msg = ['created' => ['auth-ok', 'Utilisateur créé'], 'exists' => ['auth-error', 'Email déjà utilisé.'],
        'invalid' => ['auth-error', 'Données invalides.'], 'csrf' => ['auth-error', 'Jeton invalide.']][$status] ?? null;

page_head('Administration', ['players.css']);
app_shell_open('admin');
?>
<div class="page-head">
  <div>
    <h1>Administration</h1>
    <p class="subtitle"><?= count($users) ?> utilisateur<?= count($users) > 1 ? 's' : '' ?> · gestion des comptes</p>
  </div>
  <div class="page-actions"><button class="btn btn-primary" id="btnNewUser" type="button">+ Nouvel utilisateur</button></div>
</div>

<?php if ($msg): ?><div class="<?= $msg[0] ?>" style="max-width:520px;"><?= e($msg[1]) ?></div><?php endif; ?>

<div class="card" style="padding:6px;">
  <table class="table">
    <thead><tr><th>Nom</th><th>Email</th><th>Rôle</th><th>Club</th><th>Données</th><th>Statut</th><th></th></tr></thead>
    <tbody>
      <?php foreach ($users as $u): $self = (int) $u['id'] === current_user_id(); ?>
        <tr data-id="<?= (int) $u['id'] ?>">
          <td><strong><?= e($u['nom']) ?></strong><?= $self ? ' <span class="badge badge-gold">vous</span>' : '' ?></td>
          <td class="text-muted"><?= e($u['email']) ?></td>
          <td>
            <select class="role-select" onchange="updateRole(<?= (int) $u['id'] ?>, this.value)" <?= $self ? 'title="Votre compte"' : '' ?> style="width:auto;padding:6px 8px;">
              <?php foreach (['admin' => 'Admin', 'coach' => 'Coach', 'analyste' => 'Analyste vidéo', 'prepa' => 'Prépa physique', 'viewer' => 'Viewer'] as $r => $lbl): ?>
                <option value="<?= $r ?>" <?= $u['role'] === $r ? 'selected' : '' ?>><?= $lbl ?></option>
              <?php endforeach; ?>
            </select>
          </td>
          <td><?= e($u['club'] ?: '—') ?></td>
          <td class="text-muted"><?= (int) $u['nb_sessions'] ?> séances · <?= (int) $u['nb_players'] ?> joueurs</td>
          <td>
            <span class="badge <?= (int) $u['actif'] ? 'badge-success' : '' ?>" id="status-<?= (int) $u['id'] ?>">
              <?= (int) $u['actif'] ? 'Actif' : 'Inactif' ?>
            </span>
          </td>
          <td style="text-align:right;white-space:nowrap;">
            <button class="btn btn-sm" type="button" onclick="viewSessions(<?= (int) $u['id'] ?>)">Séances</button>
            <?php if (!$self): ?>
              <button class="btn btn-sm" type="button" onclick="toggleActive(<?= (int) $u['id'] ?>, this)"><?= (int) $u['actif'] ? 'Désactiver' : 'Activer' ?></button>
              <button class="btn btn-sm btn-danger" type="button" onclick="deleteUser(<?= (int) $u['id'] ?>)">Suppr.</button>
            <?php endif; ?>
          </td>
        </tr>
      <?php endforeach; ?>
    </tbody>
  </table>
</div>

<!-- Modale création -->
<div class="modal-backdrop" id="userModal">
  <div class="modal">
    <h3>Nouvel utilisateur</h3>
    <form method="post" action="php/auth/register.php">
      <?= csrf_field() ?>
      <input type="hidden" name="back" value="admin.php">
      <div class="field"><label>Nom complet</label><input name="nom" required></div>
      <div class="field"><label>Email</label><input type="email" name="email" required></div>
      <div class="field-row">
        <div class="field"><label>Rôle</label>
          <select name="role"><option value="coach">Coach</option><option value="analyste">Analyste vidéo</option><option value="prepa">Prépa physique</option><option value="viewer">Viewer</option><option value="admin">Admin</option></select>
        </div>
        <div class="field"><label>Club</label><input name="club"></div>
      </div>
      <div class="field"><label>Mot de passe (6+)</label><input type="password" name="password" required></div>
      <div class="modal-actions">
        <button class="btn" type="button" data-close="userModal">Annuler</button>
        <button class="btn btn-primary" type="submit">Créer</button>
      </div>
    </form>
  </div>
</div>

<!-- Modale séances d'un coach -->
<div class="modal-backdrop" id="sessionsModal"><div class="modal" id="sessionsBody"></div></div>

<script>
  document.getElementById('btnNewUser').addEventListener('click', () => openModal('userModal'));

  async function updateRole(id, role) {
    try { await API('php/api/users.php?action=update-role', { method: 'POST', body: { id, role } }); toast('Rôle mis à jour', 'success'); }
    catch (e) { toast(e.message, 'error'); }
  }
  async function toggleActive(id, btn) {
    try {
      const r = await API('php/api/users.php?action=toggle-active', { method: 'POST', body: { id } });
      const badge = document.getElementById('status-' + id);
      badge.textContent = r.actif ? 'Actif' : 'Inactif';
      badge.classList.toggle('badge-success', !!r.actif);
      btn.textContent = r.actif ? 'Désactiver' : 'Activer';
      toast('Statut mis à jour', 'success');
    } catch (e) { toast(e.message, 'error'); }
  }
  async function deleteUser(id) {
    if (!confirm('Supprimer ce compte et TOUTES ses données (séances, joueurs) ? Action irréversible.')) return;
    try {
      await API('php/api/users.php?action=delete', { method: 'POST', body: { id } });
      document.querySelector(`tr[data-id="${id}"]`)?.remove();
      toast('Compte supprimé.', 'success');
    } catch (e) { toast(e.message, 'error'); }
  }
  async function viewSessions(id) {
    const name = document.querySelector(`tr[data-id="${id}"] td strong`)?.textContent || 'Coach';
    try {
      const d = await API('php/api/users.php?action=sessions&id=' + id);
      const rows = d.sessions.length
        ? d.sessions.map(s => `<div class="detail-row"><span>${escapeHtml(s.titre)} <span class="text-muted">${escapeHtml(s.date_seance)}</span></span><span class="text-muted">${s.nb} proc. · ${s.duree_min} min</span></div>`).join('')
        : '<p class="text-muted">Aucune séance.</p>';
      document.getElementById('sessionsBody').innerHTML =
        `<div class="flex-between" style="margin-bottom:14px;"><h3 style="margin:0;">Séances — ${escapeHtml(name)}</h3>
         <button class="btn btn-sm" data-close="sessionsModal">Fermer</button></div><div class="detail-list">${rows}</div>`;
      openModal('sessionsModal');
    } catch (e) { toast(e.message, 'error'); }
  }
</script>
<?php
app_shell_close(['app.js']);
