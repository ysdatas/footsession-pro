<?php
/**
 * FootSession Pro — Coquille applicative (head, barre latérale, scripts).
 * Utilisé par toutes les pages internes pour éviter de dupliquer la navigation.
 */
declare(strict_types=1);

/** URL d'un asset avec cache-busting basé sur la date de modification. */
function asset(string $path): string
{
    $full = __DIR__ . '/../../' . ltrim($path, '/');
    $v = is_file($full) ? filemtime($full) : time();
    return $path . '?v=' . $v;
}

/** Émet le <head> complet (polices + CSS de base + CSS spécifiques). */
function page_head(string $title, array $cssFiles = []): void
{
    echo "<!DOCTYPE html>\n<html lang=\"fr\">\n<head>\n";
    echo '<meta charset="utf-8">' . "\n";
    echo '<meta name="viewport" content="width=device-width, initial-scale=1">' . "\n";
    echo '<meta name="csrf-token" content="' . e(csrf_token()) . '">' . "\n";
    echo '<title>FootSession Pro — ' . e($title) . "</title>\n";
    echo '<link rel="preconnect" href="https://fonts.googleapis.com">' . "\n";
    echo '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' . "\n";
    echo '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">' . "\n";
    echo '<link rel="stylesheet" href="' . e(asset('assets/css/main.css')) . '">' . "\n";
    echo '<link rel="stylesheet" href="' . e(asset('assets/css/layout.css')) . '">' . "\n";
    foreach ($cssFiles as $css) {
        echo '<link rel="stylesheet" href="' . e(asset('assets/css/' . $css)) . '">' . "\n";
    }
    // Thème club : surcharge de la couleur d'accent.
    $cc = current_user()['club_color'] ?? null;
    if ($cc && preg_match('/^#[0-9a-fA-F]{6}$/', $cc)) {
        echo '<style>:root{--gold:' . $cc . ';--gold-light:' . club_lighten($cc, 0.25)
           . ';--gold-border:' . club_rgba($cc, 0.4) . ';--border-gold:' . club_rgba($cc, 0.4)
           . ';--shadow-gold:0 0 20px ' . club_rgba($cc, 0.15) . ';}</style>' . "\n";
    }
    echo "</head>\n";
}

function club_rgba(string $hex, float $a): string
{
    $n = hexdec(ltrim($hex, '#'));
    return 'rgba(' . (($n >> 16) & 255) . ',' . (($n >> 8) & 255) . ',' . ($n & 255) . ',' . $a . ')';
}
function club_lighten(string $hex, float $amt): string
{
    $n = hexdec(ltrim($hex, '#'));
    $c = [($n >> 16) & 255, ($n >> 8) & 255, $n & 255];
    foreach ($c as &$v) $v = (int) round($v + (255 - $v) * $amt);
    return sprintf('#%02x%02x%02x', $c[0], $c[1], $c[2]);
}

/** Définition de la navigation principale : [slug, libellé, href, icône]. */
function nav_items(): array
{
    return [
        ['dashboard', 'Tableau de bord',   'dashboard.php'],
        ['sessions',  'Mes séances',       'sessions.php'],
        ['create',    'Créer une séance',  'create-session.php'],
        ['tactical',  'Tableau tactique',  'tactical-board.php'],
        ['players',   'Mes joueurs',       'players.php'],
        ['analytics', 'Bilan & Analytics', 'analytics.php'],
    ];
}

/** Ouvre <body>, dessine la barre latérale et ouvre <main>. */
function app_shell_open(string $active): void
{
    $u    = current_user() ?? [];
    $name = $u['nom'] ?? 'Utilisateur';
    $role = $u['role'] ?? 'viewer';
    $ini  = ($u['avatar_initiales'] ?? '') ?: initials($name);

    echo '<body class="app">' . "\n";
    echo '<button class="sidebar-toggle" id="sidebarToggle" aria-label="Menu"><svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h14M3 10h14M3 14h14"/></svg></button>' . "\n";
    echo '<aside class="sidebar" id="sidebar">' . "\n";
    $logo = $u['club_logo'] ?? '';
    if ($logo) {
        echo '  <div class="brand"><img class="brand-logo" src="' . e($logo) . '" alt=""><span class="brand-clubname">' . e($u['club'] ?: 'FootSession Pro') . '</span></div>' . "\n";
    } else {
        echo '  <div class="brand">Foot<span class="brand-accent">Session</span> <span class="brand-pro">Pro</span></div>' . "\n";
    }
    echo '  <nav class="nav">' . "\n";
    foreach (nav_items() as [$slug, $label, $href]) {
        $cls = $slug === $active ? 'nav-item active' : 'nav-item';
        echo '    <a class="' . $cls . '" href="' . e($href) . '"><span class="nav-dot"></span>' . e($label) . '</a>' . "\n";
    }
    if (can_edit()) {
        $cls = $active === 'settings' ? 'nav-item active' : 'nav-item';
        echo '    <a class="' . $cls . '" href="settings.php"><span class="nav-dot"></span>Réglages</a>' . "\n";
    }
    if (is_admin()) {
        $cls = $active === 'admin' ? 'nav-item active' : 'nav-item';
        echo '    <a class="' . $cls . '" href="admin.php"><span class="nav-dot"></span>Admin</a>' . "\n";
    }
    echo '  </nav>' . "\n";
    echo '  <div class="sidebar-user">' . "\n";
    echo '    <div class="avatar">' . e($ini) . '</div>' . "\n";
    echo '    <div class="su-meta"><div class="su-name">' . e($name) . '</div><div class="su-role">' . e(strtoupper($role)) . '</div></div>' . "\n";
    echo '    <a class="logout" href="php/auth/logout.php" title="Déconnexion" aria-label="Déconnexion"><svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H4v14h4M13 14l4-4-4-4M17 10H8"/></svg></a>' . "\n";
    echo '  </div>' . "\n";
    echo '</aside>' . "\n";
    echo '<main class="main">' . "\n";
}

/** Ferme <main>/<body> et injecte les scripts (URL absolue ou fichier de assets/js/). */
function app_shell_close(array $scripts = []): void
{
    echo '</main>' . "\n";
    echo '<div class="sidebar-backdrop" id="sidebarBackdrop"></div>' . "\n";
    foreach ($scripts as $src) {
        $url = str_starts_with($src, 'http') ? $src : asset('assets/js/' . $src);
        echo '<script src="' . e($url) . '"></script>' . "\n";
    }
    echo "</body>\n</html>";
}
