<?php
require_once __DIR__ . '/php/includes/bootstrap.php';
require_login();
if (!is_admin()) { header('Location: dashboard.php'); exit; }

$status = $_GET['status'] ?? '';
$messages = [
    'created' => ['success', 'Utilisateur créé avec succès.'],
    'exists'  => ['error',   'Cet email est déjà utilisé.'],
    'invalid' => ['error',   'Données invalides (email valide et mot de passe d\'au moins 6 caractères requis).'],
    'csrf'    => ['error',   'Jeton de sécurité invalide.'],
];
page_head('Nouvel utilisateur', ['auth.css']);
app_shell_open('admin');
?>
<div class="page-head">
  <div>
    <h1>Nouvel utilisateur</h1>
    <p class="subtitle">Créez un compte coach, viewer ou administrateur.</p>
  </div>
  <div class="page-actions"><a class="btn" href="admin.php">← Gestion des utilisateurs</a></div>
</div>

<?php if (isset($messages[$status])): [$type, $msg] = $messages[$status]; ?>
  <div class="<?= $type === 'success' ? 'auth-ok' : 'auth-error' ?>" style="max-width:480px;"><?= e($msg) ?></div>
<?php endif; ?>

<div class="card" style="max-width:480px;">
  <form method="post" action="php/auth/register.php">
    <?= csrf_field() ?>
    <input type="hidden" name="back" value="register.php">
    <div class="field"><label>Nom complet</label><input name="nom" required></div>
    <div class="field"><label>Email</label><input type="email" name="email" required></div>
    <div class="field-row">
      <div class="field"><label>Rôle</label>
        <select name="role">
          <option value="coach">Coach</option>
          <option value="analyste">Analyste vidéo</option>
          <option value="prepa">Préparateur physique</option>
          <option value="viewer">Viewer (lecture seule)</option>
          <option value="admin">Administrateur</option>
        </select>
      </div>
      <div class="field"><label>Club</label><input name="club"></div>
    </div>
    <div class="field"><label>Mot de passe (6+ caractères)</label><input type="password" name="password" required></div>
    <button class="btn btn-primary" type="submit">Créer le compte</button>
  </form>
</div>
<?php app_shell_close(['app.js']); ?>
