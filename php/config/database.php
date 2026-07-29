<?php
/**
 * FootSession Pro — Connexion base de données (PDO MySQL).
 *
 * Local XAMPP  : utilisateur "root", mot de passe vide.
 * Production o2switch : remplacer DB_HOST / DB_NAME / DB_USER / DB_PASS
 * par les identifiants fournis par l'hébergeur (espace client > Bases MySQL).
 */
declare(strict_types=1);

define('DB_HOST', 'localhost');
define('DB_NAME', 'footsession_pro');
define('DB_USER', 'root');
define('DB_PASS', '');
define('DB_CHARSET', 'utf8mb4');

/**
 * Retourne une instance PDO partagée (un seul pool de connexion par requête).
 */
function getDB(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $dsn = 'mysql:host=' . DB_HOST . ';dbname=' . DB_NAME . ';charset=' . DB_CHARSET;

    try {
        $pdo = new PDO($dsn, DB_USER, DB_PASS, [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]);
        return $pdo;
    } catch (PDOException $e) {
        // Ne jamais exposer le détail SQL au client.
        error_log('FootSession DB connection failed: ' . $e->getMessage());
        http_response_code(500);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode(['error' => 'Connexion à la base de données impossible.']);
        exit;
    }
}
