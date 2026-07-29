<?php
/**
 * Création d'un utilisateur (réservé aux administrateurs).
 * POST depuis register.php ou admin.php. Redirige avec un statut.
 */
require_once __DIR__ . '/../includes/bootstrap.php';

require_login('../../index.php');
if (!is_admin()) {
    header('Location: ../../dashboard.php');
    exit;
}

$back = ($_POST['back'] ?? 'register.php') === 'admin.php' ? '../../admin.php' : '../../register.php';

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    header('Location: ' . $back);
    exit;
}

$sent = $_POST['csrf'] ?? '';
if (!is_string($sent) || empty($_SESSION['csrf']) || !hash_equals($_SESSION['csrf'], $sent)) {
    header('Location: ' . $back . '?status=csrf');
    exit;
}

$nom      = trim((string) ($_POST['nom'] ?? ''));
$email    = trim((string) ($_POST['email'] ?? ''));
$password = (string) ($_POST['password'] ?? '');
$role     = in_array($_POST['role'] ?? '', ['admin', 'coach', 'analyste', 'prepa', 'viewer'], true) ? $_POST['role'] : 'coach';
$club     = trim((string) ($_POST['club'] ?? ''));

if ($nom === '' || !filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($password) < 6) {
    header('Location: ' . $back . '?status=invalid');
    exit;
}

$pdo = getDB();

// Email déjà pris ?
$check = $pdo->prepare('SELECT id FROM users WHERE email = :email LIMIT 1');
$check->execute(['email' => $email]);
if ($check->fetch()) {
    header('Location: ' . $back . '?status=exists');
    exit;
}

$stmt = $pdo->prepare('INSERT INTO users (nom, email, password_hash, role, club, avatar_initiales)
                       VALUES (:nom, :email, :hash, :role, :club, :ini)');
$stmt->execute([
    'nom'   => $nom,
    'email' => $email,
    'hash'  => password_hash($password, PASSWORD_DEFAULT),
    'role'  => $role,
    'club'  => $club ?: null,
    'ini'   => initials($nom),
]);

header('Location: ' . $back . '?status=created');
exit;
