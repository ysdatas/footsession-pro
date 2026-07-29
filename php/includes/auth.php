<?php
/**
 * FootSession Pro — Authentification & contrôle d'accès par rôle.
 *
 * Rôles :
 *   - admin  : accès total + gestion des utilisateurs
 *   - coach  : ses propres séances / joueurs uniquement
 *   - viewer : lecture seule (aucune écriture)
 */
declare(strict_types=1);

function is_logged_in(): bool
{
    return !empty($_SESSION['user']) && !empty($_SESSION['user']['id']);
}

function current_user(): ?array
{
    return $_SESSION['user'] ?? null;
}

function current_user_id(): int
{
    return (int) ($_SESSION['user']['id'] ?? 0);
}

function current_role(): string
{
    return $_SESSION['user']['role'] ?? 'viewer';
}

function is_admin(): bool
{
    return current_role() === 'admin';
}

/** Vrai si l'utilisateur peut créer / modifier (staff éditeur, pas viewer). */
function can_edit(): bool
{
    return in_array(current_role(), ['admin', 'coach', 'analyste', 'prepa'], true);
}

/** Libellé lisible d'un rôle. */
function role_label(string $role): string
{
    return ['admin' => 'Administrateur', 'coach' => 'Coach', 'analyste' => 'Analyste vidéo',
        'prepa' => 'Préparateur physique', 'viewer' => 'Lecture seule'][$role] ?? $role;
}

/** Garde de page : redirige vers la connexion si non authentifié. */
function require_login(string $loginUrl = 'index.php'): void
{
    if (!is_logged_in()) {
        header('Location: ' . $loginUrl);
        exit;
    }
}

/** Garde de page par rôle : redirige si le rôle n'est pas autorisé. */
function require_role(array $roles, string $redirect = 'dashboard.php'): void
{
    require_login();
    if (!in_array(current_role(), $roles, true)) {
        header('Location: ' . $redirect);
        exit;
    }
}

/**
 * Garde d'API :
 *   - 401 JSON si non authentifié
 *   - CSRF vérifié sur toute écriture (POST/PUT/PATCH/DELETE)
 *   - 403 JSON si un "viewer" tente une écriture
 */
function api_guard(): void
{
    if (!is_logged_in()) {
        json_out(['error' => 'Non authentifié.'], 401);
    }
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if (!in_array($method, ['GET', 'HEAD', 'OPTIONS'], true)) {
        verify_csrf();
        if (current_role() === 'viewer') {
            json_out(['error' => 'Votre compte est en lecture seule.'], 403);
        }
    }
}

/**
 * Clause SQL de restriction par propriétaire.
 * - coach  : limité à ses propres lignes
 * - admin  : voit tout (clause neutre)
 * Retourne [sql, params] à fusionner dans une requête.
 */
function owner_clause(string $column = 'user_id'): array
{
    if (is_admin()) {
        return ['1=1', []];
    }
    return ["$column = :owner_id", ['owner_id' => current_user_id()]];
}
