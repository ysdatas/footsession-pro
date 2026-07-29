<?php
/**
 * API Bibliothèque d'exercices (modèles réutilisables).
 *   GET  ?action=list            → liste des modèles de l'utilisateur
 *   GET  ?action=get&id=         → modèle complet (avec data)
 *   POST ?action=create          → { nom, categorie, data, canvas_json?, canvas_image? }
 *   POST ?action=delete          → { id }
 */
require_once __DIR__ . '/../includes/bootstrap.php';
api_guard();

$pdo    = getDB();
$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];
$body   = json_input();
$uid    = current_user_id();

if ($method === 'GET' && ($action === 'list' || $action === '')) {
    $st = $pdo->prepare('SELECT id, nom, categorie, canvas_image, created_at
                         FROM exercise_templates
                         WHERE user_id = :uid OR :admin = 1
                         ORDER BY created_at DESC');
    $st->execute(['uid' => $uid, 'admin' => is_admin() ? 1 : 0]);
    json_out(['templates' => $st->fetchAll()]);
}

if ($method === 'GET' && $action === 'get') {
    $st = $pdo->prepare('SELECT * FROM exercise_templates WHERE id = :id LIMIT 1');
    $st->execute(['id' => (int) ($_GET['id'] ?? 0)]);
    $t = $st->fetch();
    if (!$t || (!is_admin() && (int) $t['user_id'] !== $uid)) json_out(['error' => 'Modèle introuvable.'], 404);
    json_out(['template' => $t]);
}

if ($method === 'POST' && $action === 'create') {
    $nom = trim((string) ($body['nom'] ?? ''));
    if ($nom === '') json_out(['error' => 'Nom du modèle requis.'], 422);
    $st = $pdo->prepare('INSERT INTO exercise_templates (user_id, nom, categorie, data, canvas_json, canvas_image)
                         VALUES (:uid, :nom, :cat, :data, :cj, :ci)');
    $st->execute([
        'uid'  => $uid,
        'nom'  => $nom,
        'cat'  => trim((string) ($body['categorie'] ?? '')) ?: null,
        'data' => json_encode($body['data'] ?? [], JSON_UNESCAPED_UNICODE),
        'cj'   => isset($body['canvas_json']) ? json_encode($body['canvas_json'], JSON_UNESCAPED_UNICODE) : null,
        'ci'   => $body['canvas_image'] ?? null,
    ]);
    json_out(['ok' => true, 'id' => (int) $pdo->lastInsertId()]);
}

if ($method === 'POST' && $action === 'delete') {
    $id = (int) ($body['id'] ?? 0);
    $chk = $pdo->prepare('SELECT user_id FROM exercise_templates WHERE id = :id');
    $chk->execute(['id' => $id]);
    $t = $chk->fetch();
    if (!$t || (!is_admin() && (int) $t['user_id'] !== $uid)) json_out(['error' => 'Modèle introuvable.'], 404);
    $pdo->prepare('DELETE FROM exercise_templates WHERE id = :id')->execute(['id' => $id]);
    json_out(['ok' => true]);
}

json_out(['error' => 'Action inconnue.'], 400);
