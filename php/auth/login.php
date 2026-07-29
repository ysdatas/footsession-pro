<?php
/**
 * Traitement de la connexion. POST depuis index.php.
 */
require_once __DIR__ . '/../includes/bootstrap.php';

if (is_logged_in()) {
    header('Location: ../../dashboard.php');
    exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Location: ../../index.php');
    exit;
}

// CSRF (redirection plutôt que JSON pour un formulaire classique).
$sent = $_POST['csrf'] ?? '';
if (!is_string($sent) || empty($_SESSION['csrf']) || !hash_equals($_SESSION['csrf'], $sent)) {
    header('Location: ../../index.php?error=1');
    exit;
}

$email    = trim((string) ($_POST['email'] ?? ''));
$password = (string) ($_POST['password'] ?? '');

if ($email === '' || $password === '') {
    header('Location: ../../index.php?error=1');
    exit;
}

$pdo  = getDB();
$stmt = $pdo->prepare('SELECT id, nom, email, password_hash, role, club, avatar_initiales, actif, club_color, club_logo
                       FROM users WHERE email = :email LIMIT 1');
$stmt->execute(['email' => $email]);
$user = $stmt->fetch();

if (!$user || (int) $user['actif'] !== 1 || !password_verify($password, $user['password_hash'])) {
    header('Location: ../../index.php?error=1');
    exit;
}

// Connexion réussie : régénérer l'ID de session contre la fixation.
session_regenerate_id(true);
$_SESSION['user'] = [
    'id'               => (int) $user['id'],
    'nom'              => $user['nom'],
    'email'            => $user['email'],
    'role'             => $user['role'],
    'club'             => $user['club'],
    'avatar_initiales' => $user['avatar_initiales'],
    'club_color'       => $user['club_color'],
    'club_logo'        => $user['club_logo'],
];

header('Location: ../../dashboard.php');
exit;
