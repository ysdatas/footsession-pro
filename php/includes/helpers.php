<?php
/**
 * FootSession Pro — Fonctions utilitaires partagées.
 */
declare(strict_types=1);

/** Échappement HTML sûr pour tout affichage. */
function e($value): string
{
    return htmlspecialchars((string) ($value ?? ''), ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
}

/** Émet une réponse JSON puis termine le script. */
function json_out($data, int $status = 200): void
{
    if (!headers_sent()) {
        http_response_code($status);
        header('Content-Type: application/json; charset=utf-8');
    }
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

/** Décode le corps JSON d'une requête fetch en tableau associatif. */
function json_input(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') {
        return [];
    }
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

/** Récupère un paramètre (corps JSON prioritaire, puis $_POST, puis $_GET). */
function param(array $body, string $key, $default = null)
{
    return $body[$key] ?? $_POST[$key] ?? $_GET[$key] ?? $default;
}

/** Jeton CSRF de session (généré au besoin). */
function csrf_token(): string
{
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf'];
}

/** Champ caché CSRF pour les formulaires HTML. */
function csrf_field(): string
{
    return '<input type="hidden" name="csrf" value="' . e(csrf_token()) . '">';
}

/**
 * Vérifie le jeton CSRF (champ POST "csrf" ou en-tête X-CSRF-Token).
 * Termine en 403 (JSON) si invalide — utilisé par les API.
 */
function verify_csrf(): void
{
    $sent = $_POST['csrf'] ?? $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    if (!is_string($sent) || $sent === '' || empty($_SESSION['csrf']) || !hash_equals($_SESSION['csrf'], $sent)) {
        json_out(['error' => 'Jeton de sécurité invalide. Rechargez la page.'], 403);
    }
}

/** Initiales (1 à 2 lettres) à partir d'un nom et d'un prénom. */
function initials(string $first, string $last = ''): string
{
    $a = mb_substr(trim($first), 0, 1, 'UTF-8');
    $b = mb_substr(trim($last), 0, 1, 'UTF-8');
    $res = mb_strtoupper($a . $b, 'UTF-8');
    return $res !== '' ? $res : '?';
}
