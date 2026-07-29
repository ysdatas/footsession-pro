<?php
/**
 * API Réglages — identité du club (logo + couleur d'accent) de l'utilisateur.
 *   POST ?action=save → { club, club_color, club_logo }
 */
require_once __DIR__ . '/../includes/bootstrap.php';
api_guard();

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST' || ($_GET['action'] ?? '') !== 'save') {
    json_out(['error' => 'Action inconnue.'], 400);
}

$body  = json_input();
$pdo   = getDB();
$club  = trim((string) ($body['club'] ?? '')) ?: null;
$color = (string) ($body['club_color'] ?? '');
$color = preg_match('/^#[0-9a-fA-F]{6}$/', $color) ? $color : null;

// Logo : data URL image, ou null pour retirer. Limite ~1.5 Mo.
$logo = $body['club_logo'] ?? null;
if ($logo !== null) {
    if (!is_string($logo) || !str_starts_with($logo, 'data:image/') || strlen($logo) > 1_600_000) {
        json_out(['error' => 'Logo invalide (image < 1,5 Mo attendue).'], 422);
    }
}
$keepLogo = ($body['keep_logo'] ?? false) === true;   // ne pas toucher au logo existant

$sql = $keepLogo
    ? 'UPDATE users SET club = :club, club_color = :color WHERE id = :id'
    : 'UPDATE users SET club = :club, club_color = :color, club_logo = :logo WHERE id = :id';
$params = ['club' => $club, 'color' => $color, 'id' => current_user_id()];
if (!$keepLogo) $params['logo'] = $logo;
$pdo->prepare($sql)->execute($params);

// Reflète immédiatement dans la session.
$_SESSION['user']['club'] = $club;
$_SESSION['user']['club_color'] = $color;
if (!$keepLogo) $_SESSION['user']['club_logo'] = $logo;

json_out(['ok' => true]);
