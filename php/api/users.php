<?php
/**
 * API Utilisateurs (réservée aux administrateurs).
 *   POST ?action=update-role   {id, role}
 *   POST ?action=toggle-active {id}
 *   POST ?action=delete        {id}
 *   GET  ?action=sessions&id=  → séances d'un utilisateur
 */
require_once __DIR__ . '/../includes/bootstrap.php';
api_guard();

if (!is_admin()) {
    json_out(['error' => 'Réservé aux administrateurs.'], 403);
}

$pdo    = getDB();
$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];
$body   = json_input();

if ($method === 'GET' && $action === 'sessions') {
    $id = (int) ($_GET['id'] ?? 0);
    $st = $pdo->prepare("SELECT s.id, s.titre, s.date_seance, s.categorie, s.duree_min,
                         (SELECT COUNT(*) FROM procedures WHERE session_id = s.id) nb
                         FROM sessions s WHERE s.user_id = :id ORDER BY s.date_seance DESC");
    $st->execute(['id' => $id]);
    json_out(['sessions' => $st->fetchAll()]);
}

if ($method === 'POST' && $action === 'update-role') {
    $id   = (int) ($body['id'] ?? 0);
    $role = in_array($body['role'] ?? '', ['admin', 'coach', 'analyste', 'prepa', 'viewer'], true) ? $body['role'] : null;
    if (!$id || !$role) json_out(['error' => 'Paramètres invalides.'], 422);
    if ($id === current_user_id() && $role !== 'admin') {
        json_out(['error' => 'Vous ne pouvez pas retirer votre propre rôle administrateur.'], 400);
    }
    $pdo->prepare('UPDATE users SET role = :role WHERE id = :id')->execute(['role' => $role, 'id' => $id]);
    json_out(['ok' => true]);
}

if ($method === 'POST' && $action === 'toggle-active') {
    $id = (int) ($body['id'] ?? 0);
    if ($id === current_user_id()) json_out(['error' => 'Vous ne pouvez pas désactiver votre propre compte.'], 400);
    $st = $pdo->prepare('SELECT actif FROM users WHERE id = :id');
    $st->execute(['id' => $id]);
    $u = $st->fetch();
    if (!$u) json_out(['error' => 'Utilisateur introuvable.'], 404);
    $new = (int) $u['actif'] === 1 ? 0 : 1;
    $pdo->prepare('UPDATE users SET actif = :a WHERE id = :id')->execute(['a' => $new, 'id' => $id]);
    json_out(['ok' => true, 'actif' => $new]);
}

if ($method === 'POST' && $action === 'delete') {
    $id = (int) ($body['id'] ?? 0);
    if ($id === current_user_id()) json_out(['error' => 'Vous ne pouvez pas supprimer votre propre compte.'], 400);
    $pdo->prepare('DELETE FROM users WHERE id = :id')->execute(['id' => $id]);
    json_out(['ok' => true]);
}

json_out(['error' => 'Action inconnue.'], 400);
