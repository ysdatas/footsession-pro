<?php
/**
 * API Schémas tactiques — chargement / sauvegarde par procédé.
 *   GET  ?action=load&procedure_id=
 *   POST ?action=save&procedure_id=   {canvas_json, canvas_image, vue_terrain}
 */
require_once __DIR__ . '/../includes/bootstrap.php';
api_guard();

$pdo    = getDB();
$action = $_GET['action'] ?? '';

/** Vérifie qu'un procédé appartient bien à l'utilisateur courant. */
function tactical_own(PDO $pdo, int $pid): bool
{
    $st = $pdo->prepare('SELECT s.user_id FROM procedures p JOIN sessions s ON p.session_id = s.id WHERE p.id = :pid');
    $st->execute(['pid' => $pid]);
    $row = $st->fetch();
    if (!$row) return false;
    return is_admin() || (int) $row['user_id'] === current_user_id();
}

if ($_SERVER['REQUEST_METHOD'] === 'GET' && $action === 'load') {
    $pid = (int) ($_GET['procedure_id'] ?? 0);
    if (!$pid || !tactical_own($pdo, $pid)) json_out(['error' => 'Procédé introuvable.'], 404);
    $st = $pdo->prepare('SELECT canvas_json, canvas_image, vue_terrain FROM tactical_schemas WHERE procedure_id = :pid');
    $st->execute(['pid' => $pid]);
    json_out(['schema' => $st->fetch() ?: null]);
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && $action === 'save') {
    $pid  = (int) ($_GET['procedure_id'] ?? 0);
    if (!$pid || !tactical_own($pdo, $pid)) json_out(['error' => 'Procédé introuvable.'], 404);

    $body = json_input();
    $json = isset($body['canvas_json']) ? json_encode($body['canvas_json'], JSON_UNESCAPED_UNICODE) : null;
    $img  = $body['canvas_image'] ?? null;
    $vue  = substr((string) ($body['vue_terrain'] ?? 'complet'), 0, 50);

    // Garde-fou : limiter la taille de l'image base64 (~3 Mo).
    if ($img !== null && strlen($img) > 3_500_000) {
        json_out(['error' => 'Image trop volumineuse.'], 413);
    }

    $st = $pdo->prepare('INSERT INTO tactical_schemas (procedure_id, canvas_json, canvas_image, vue_terrain)
                         VALUES (:pid, :json, :img, :vue)
                         ON DUPLICATE KEY UPDATE canvas_json = VALUES(canvas_json),
                            canvas_image = VALUES(canvas_image), vue_terrain = VALUES(vue_terrain)');
    $st->execute(['pid' => $pid, 'json' => $json, 'img' => $img, 'vue' => $vue]);
    json_out(['ok' => true]);
}

json_out(['error' => 'Action inconnue.'], 400);
