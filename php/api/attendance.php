<?php
/**
 * API Présences — bascule unitaire d'une présence joueur/séance (matrice joueurs).
 */
require_once __DIR__ . '/../includes/bootstrap.php';
api_guard();

$pdo  = getDB();
$body = json_input();

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST' || ($_GET['action'] ?? '') !== 'set') {
    json_out(['error' => 'Action inconnue.'], 400);
}

$playerId  = (int) ($body['player_id'] ?? 0);
$sessionId = (int) ($body['session_id'] ?? 0);
$present   = !empty($body['present']) ? 1 : 0;

// Le joueur ET la séance doivent appartenir à l'utilisateur (sauf admin).
$chk = $pdo->prepare('SELECT
        (SELECT user_id FROM players  WHERE id = :pid) AS p_owner,
        (SELECT user_id FROM sessions WHERE id = :sid) AS s_owner');
$chk->execute(['pid' => $playerId, 'sid' => $sessionId]);
$own = $chk->fetch();

if (!$own || $own['p_owner'] === null || $own['s_owner'] === null) {
    json_out(['error' => 'Joueur ou séance introuvable.'], 404);
}
if (!is_admin() && ((int) $own['p_owner'] !== current_user_id() || (int) $own['s_owner'] !== current_user_id())) {
    json_out(['error' => 'Accès refusé.'], 403);
}

$up = $pdo->prepare('INSERT INTO attendance (player_id, session_id, present)
                     VALUES (:pid, :sid, :present)
                     ON DUPLICATE KEY UPDATE present = VALUES(present)');
$up->execute(['pid' => $playerId, 'sid' => $sessionId, 'present' => $present]);

json_out(['ok' => true, 'present' => $present]);
