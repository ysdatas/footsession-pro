<?php
/**
 * FootSession Pro — Initialisation du premier administrateur.
 *
 * À utiliser UNE SEULE FOIS, juste après l'import de database/schema.sql :
 *   - ne fonctionne que si la table `users` est vide ;
 *   - crée le premier compte admin ;
 *   - SUPPRIMEZ ENSUITE ce fichier (rm setup.php).
 */
require_once __DIR__ . '/php/includes/bootstrap.php';

$pdo = getDB();
$count = (int) $pdo->query('SELECT COUNT(*) AS c FROM users')->fetch()['c'];

$done = false;
$error = '';

if ($count > 0) {
    // Déjà initialisé : ne rien faire.
} elseif (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    $sent = $_POST['csrf'] ?? '';
    if (!is_string($sent) || !hash_equals($_SESSION['csrf'], $sent)) {
        $error = 'Jeton de sécurité invalide. Rechargez la page.';
    } else {
        $nom      = trim((string) ($_POST['nom'] ?? ''));
        $email    = trim((string) ($_POST['email'] ?? ''));
        $password = (string) ($_POST['password'] ?? '');
        $club     = trim((string) ($_POST['club'] ?? ''));

        if ($nom === '' || !filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($password) < 6) {
            $error = 'Nom requis, email valide et mot de passe d\'au moins 6 caractères.';
        } else {
            $stmt = $pdo->prepare('INSERT INTO users (nom, email, password_hash, role, club, avatar_initiales)
                                   VALUES (:nom, :email, :hash, :role, :club, :ini)');
            $stmt->execute([
                'nom'   => $nom,
                'email' => $email,
                'hash'  => password_hash($password, PASSWORD_DEFAULT),
                'role'  => 'admin',
                'club'  => $club ?: null,
                'ini'   => initials($nom),
            ]);
            $done = true;
        }
    }
}
?>
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>FootSession Pro — Initialisation</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="assets/css/main.css">
  <link rel="stylesheet" href="assets/css/auth.css">
</head>
<body class="auth">
  <div class="auth-card">
    <div class="auth-logo">Foot<span class="g">Session</span> Pro</div>
    <div class="auth-sub">Initialisation — premier administrateur</div>

    <?php if ($count > 0): ?>
      <div class="auth-error">L'application est déjà initialisée. Pour la sécurité, <strong>supprimez ce fichier <code>setup.php</code></strong>.</div>
      <a class="btn btn-primary" href="index.php" style="width:100%;justify-content:center;">Aller à la connexion</a>
    <?php elseif ($done): ?>
      <div class="auth-ok">Compte administrateur créé — <strong>supprimez maintenant <code>setup.php</code></strong> puis connectez-vous.</div>
      <a class="btn btn-primary" href="index.php" style="width:100%;justify-content:center;">Se connecter</a>
    <?php else: ?>
      <?php if ($error): ?><div class="auth-error"><?= e($error) ?></div><?php endif; ?>
      <form method="post">
        <?= csrf_field() ?>
        <div class="field"><label>Nom complet</label><input name="nom" required placeholder="Jean Dupont"></div>
        <div class="field"><label>Email</label><input type="email" name="email" required placeholder="admin@club.fr"></div>
        <div class="field"><label>Club (optionnel)</label><input name="club" placeholder="Mon Club FC"></div>
        <div class="field"><label>Mot de passe (6+ caractères)</label><input type="password" name="password" required></div>
        <button class="btn btn-primary" type="submit">Créer l'administrateur</button>
      </form>
    <?php endif; ?>
  </div>
</body>
</html>
