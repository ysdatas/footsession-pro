<?php
/**
 * API Commentaires de séance (échanges de la cellule).
 *   GET  ?action=list&session_id=   → commentaires
 *   POST ?action=add                → { session_id, body }
 *   POST ?action=delete             → { id }
 */
require_once __DIR__ . '/../includes/bootstrap.php';
api_guard();

$pdo    = getDB();
$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];
$body   = json_input();

/** La séance doit appartenir à l'utilisateur (ou admin). */
function own_session_c(PDO $pdo, int $sid): bool
{
    $st = $pdo->prepare('SELECT user_id FROM sessions WHERE id = :id');
    $st->execute(['id' => $sid]);
    $s = $st->fetch();
    return $s && (is_admin() || (int) $s['user_id'] === current_user_id());
}

if ($method === 'GET' && $action === 'list') {
    $sid = (int) ($_GET['session_id'] ?? 0);
    if (!own_session_c($pdo, $sid)) json_out(['error' => 'Séance introuvable.'], 404);
    $st = $pdo->prepare("SELECT c.id, c.body, c.author, c.created_at, c.user_id,
                                COALESCE(u.nom, c.author, 'Anonyme') AS author_name, u.role
                         FROM session_comments c LEFT JOIN users u ON u.id = c.user_id
                         WHERE c.session_id = :sid ORDER BY c.created_at ASC");
    $st->execute(['sid' => $sid]);
    json_out(['comments' => $st->fetchAll(), 'me' => current_user_id()]);
}

if ($method === 'POST' && $action === 'add') {
    $sid  = (int) ($body['session_id'] ?? 0);
    $text = trim((string) ($body['body'] ?? ''));
    if (!own_session_c($pdo, $sid)) json_out(['error' => 'Séance introuvable.'], 404);
    if ($text === '') json_out(['error' => 'Commentaire vide.'], 422);
    $u = current_user();
    $st = $pdo->prepare('INSERT INTO session_comments (session_id, user_id, author, body)
                         VALUES (:sid, :uid, :author, :body)');
    $st->execute(['sid' => $sid, 'uid' => current_user_id(), 'author' => $u['nom'] ?? null, 'body' => $text]);
    json_out(['ok' => true, 'id' => (int) $pdo->lastInsertId()]);
}

if ($method === 'POST' && $action === 'delete') {
    $id = (int) ($body['id'] ?? 0);
    $st = $pdo->prepare('SELECT c.user_id, s.user_id AS owner FROM session_comments c
                         JOIN sessions s ON s.id = c.session_id WHERE c.id = :id');
    $st->execute(['id' => $id]);
    $c = $st->fetch();
    if (!$c) json_out(['error' => 'Introuvable.'], 404);
    // L'auteur, le propriétaire de la séance ou un admin peuvent supprimer.
    if (!is_admin() && (int) $c['user_id'] !== current_user_id() && (int) $c['owner'] !== current_user_id()) {
        json_out(['error' => 'Accès refusé.'], 403);
    }
    $pdo->prepare('DELETE FROM session_comments WHERE id = :id')->execute(['id' => $id]);
    json_out(['ok' => true]);
}

json_out(['error' => 'Action inconnue.'], 400);
