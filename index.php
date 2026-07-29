<?php
require_once __DIR__ . '/php/includes/bootstrap.php';

// Déjà connecté → tableau de bord.
if (is_logged_in()) {
    header('Location: dashboard.php');
    exit;
}
$error = isset($_GET['error']);
?>
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>FootSession Pro — Connexion</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="assets/css/main.css">
  <link rel="stylesheet" href="assets/css/auth.css">
</head>
<body class="auth">
  <form class="auth-card" method="post" action="php/auth/login.php" autocomplete="on">
    <div class="auth-logo">Foot<span class="g">Session</span><span class="auth-pro">Pro</span></div>
    <div class="auth-sub">Espace cellule vidéo &amp; coaching</div>

    <?php if ($error): ?>
      <div class="auth-error">Identifiants incorrects ou compte désactivé.</div>
    <?php endif; ?>

    <?= csrf_field() ?>
    <div class="field">
      <label for="email">Email</label>
      <input type="email" id="email" name="email" required autofocus placeholder="vous@club.fr">
    </div>
    <div class="field">
      <label for="password">Mot de passe</label>
      <input type="password" id="password" name="password" required placeholder="••••••••">
    </div>
    <button type="submit" class="btn btn-primary">Se connecter</button>

    <div class="auth-foot"><a href="#" onclick="alert('Contactez votre administrateur pour réinitialiser votre mot de passe.');return false;">Mot de passe oublié ?</a></div>
  </form>
</body>
</html>
