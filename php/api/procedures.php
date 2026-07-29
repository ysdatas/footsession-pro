<?php
/**
 * API Procédés — lecture d'un procédé (contexte du tableau tactique) et réordonnancement.
 */
require_once __DIR__ . '/../includes/bootstrap.php';
api_guard();

$pdo    = getDB();
$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];

/** Charge un procédé + sa séance en vérifiant la propriété. */
function own_procedure(PDO $pdo, int $pid): ?array
{
    $st = $pdo->prepare('SELECT p.*, s.user_id AS owner_id, s.titre AS session_titre, s.id AS session_id
                         FROM procedures p JOIN sessions s ON p.session_id = s.id
                         WHERE p.id = :pid LIMIT 1');
    $st->execute(['pid' => $pid]);
    $row = $st->fetch();
    if (!$row) return null;
    if (!is_admin() && (int) $row['owner_id'] !== current_user_id()) return null;
    return $row;
}

if ($method === 'GET' && $action === 'get') {
    $pid = (int) ($_GET['id'] ?? 0);
    $p   = own_procedure($pdo, $pid);
    if (!$p) json_out(['error' => 'Procédé introuvable.'], 404);

    $sc = $pdo->prepare('SELECT canvas_json, canvas_image, vue_terrain FROM tactical_schemas WHERE procedure_id = :pid');
    $sc->execute(['pid' => $pid]);
    json_out(['procedure' => $p, 'schema' => $sc->fetch() ?: null]);
}

if ($method === 'POST' && $action === 'reorder') {
    $body  = json_input();
    $sid   = (int) ($body['session_id'] ?? 0);
    $order = $body['order'] ?? [];

    // Vérifie la propriété de la séance.
    $st = $pdo->prepare('SELECT user_id FROM sessions WHERE id = :sid');
    $st->execute(['sid' => $sid]);
    $s = $st->fetch();
    if (!$s || (!is_admin() && (int) $s['user_id'] !== current_user_id())) {
        json_out(['error' => 'Séance introuvable.'], 404);
    }

    $up = $pdo->prepare('UPDATE procedures SET ordre = :ordre WHERE id = :id AND session_id = :sid');
    $i = 1;
    foreach ($order as $pid) {
        $up->execute(['ordre' => $i++, 'id' => (int) $pid, 'sid' => $sid]);
    }
    json_out(['ok' => true]);
}

json_out(['error' => 'Action inconnue.'], 400);
