<?php
/**
 * API Joueurs — list / create / update / delete / detail / matrix.
 */
require_once __DIR__ . '/../includes/bootstrap.php';
api_guard();

$pdo    = getDB();
$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];
$body   = json_input();

[$ownerWhere, $ownerParams] = is_admin() ? ['1=1', []] : ['user_id = :uid', ['uid' => current_user_id()]];

/** Vérifie qu'un joueur appartient à l'utilisateur courant (ou admin). */
function own_player(PDO $pdo, int $id): ?array
{
    $st = $pdo->prepare('SELECT * FROM players WHERE id = :id LIMIT 1');
    $st->execute(['id' => $id]);
    $p = $st->fetch();
    if (!$p) return null;
    if (!is_admin() && (int) $p['user_id'] !== current_user_id()) return null;
    return $p;
}

if ($method === 'GET' && ($action === 'list' || $action === '')) {
    $st = $pdo->prepare("SELECT p.*,
        (SELECT COUNT(*) FROM attendance a WHERE a.player_id = p.id AND a.present = 1) AS nb_present,
        (SELECT COUNT(*) FROM attendance a WHERE a.player_id = p.id) AS nb_total
        FROM players p WHERE $ownerWhere
        ORDER BY p.numero IS NULL, p.numero ASC, p.nom ASC");
    $st->execute($ownerParams);
    $rows = $st->fetchAll();
    foreach ($rows as &$r) {
        $r['presence_pct'] = (int) $r['nb_total'] > 0 ? (int) round($r['nb_present'] / $r['nb_total'] * 100) : 0;
    }
    json_out(['players' => $rows]);
}

if ($method === 'GET' && $action === 'matrix') {
    $sess = $pdo->prepare("SELECT id, titre, date_seance FROM sessions
                           WHERE $ownerWhere ORDER BY date_seance ASC, id ASC");
    $sess->execute($ownerParams);
    $sessions = $sess->fetchAll();

    $pl = $pdo->prepare("SELECT id, nom, prenom, numero, poste FROM players
                         WHERE $ownerWhere ORDER BY numero IS NULL, numero ASC, nom ASC");
    $pl->execute($ownerParams);
    $players = $pl->fetchAll();

    $attWhere = is_admin() ? '1=1' : 'p.user_id = :uid';
    $att = $pdo->prepare("SELECT a.player_id, a.session_id, a.present FROM attendance a
                          JOIN players p ON a.player_id = p.id WHERE $attWhere");
    $att->execute($ownerParams);
    $map = [];
    foreach ($att->fetchAll() as $a) {
        $map[$a['player_id']][$a['session_id']] = (int) $a['present'];
    }
    json_out(['sessions' => $sessions, 'players' => $players, 'present' => $map]);
}

if ($method === 'GET' && $action === 'detail') {
    $id = (int) ($_GET['id'] ?? 0);
    $p  = own_player($pdo, $id);
    if (!$p) json_out(['error' => 'Joueur introuvable.'], 404);

    $hist = $pdo->prepare("SELECT s.id, s.titre, s.date_seance, s.categorie, a.present
                           FROM attendance a JOIN sessions s ON a.session_id = s.id
                           WHERE a.player_id = :pid ORDER BY s.date_seance DESC");
    $hist->execute(['pid' => $id]);
    $history = $hist->fetchAll();

    $postes = $pdo->prepare("SELECT DISTINCT pr.postes_cibles FROM attendance a
                             JOIN procedures pr ON pr.session_id = a.session_id
                             WHERE a.player_id = :pid AND a.present = 1
                               AND pr.postes_cibles IS NOT NULL AND pr.postes_cibles <> ''");
    $postes->execute(['pid' => $id]);
    json_out([
        'player'  => $p,
        'history' => $history,
        'postes'  => array_values(array_filter(array_column($postes->fetchAll(), 'postes_cibles'))),
    ]);
}

if ($method === 'POST' && $action === 'create') {
    $nom = trim((string) ($body['nom'] ?? ''));
    if ($nom === '') json_out(['error' => 'Le nom est obligatoire.'], 422);
    $st = $pdo->prepare('INSERT INTO players (user_id, nom, prenom, numero, poste)
                         VALUES (:uid, :nom, :prenom, :numero, :poste)');
    $st->execute([
        'uid'    => current_user_id(),
        'nom'    => $nom,
        'prenom' => trim((string) ($body['prenom'] ?? '')) ?: null,
        'numero' => $body['numero'] !== '' && $body['numero'] !== null ? (int) $body['numero'] : null,
        'poste'  => trim((string) ($body['poste'] ?? '')) ?: null,
    ]);
    json_out(['ok' => true, 'id' => (int) $pdo->lastInsertId()]);
}

if ($method === 'POST' && $action === 'update') {
    $id = (int) ($body['id'] ?? 0);
    if (!own_player($pdo, $id)) json_out(['error' => 'Joueur introuvable.'], 404);
    $nom = trim((string) ($body['nom'] ?? ''));
    if ($nom === '') json_out(['error' => 'Le nom est obligatoire.'], 422);
    $st = $pdo->prepare('UPDATE players SET nom=:nom, prenom=:prenom, numero=:numero, poste=:poste WHERE id=:id');
    $st->execute([
        'nom'    => $nom,
        'prenom' => trim((string) ($body['prenom'] ?? '')) ?: null,
        'numero' => $body['numero'] !== '' && $body['numero'] !== null ? (int) $body['numero'] : null,
        'poste'  => trim((string) ($body['poste'] ?? '')) ?: null,
        'id'     => $id,
    ]);
    json_out(['ok' => true]);
}

if ($method === 'POST' && $action === 'delete') {
    $id = (int) ($body['id'] ?? 0);
    if (!own_player($pdo, $id)) json_out(['error' => 'Joueur introuvable.'], 404);
    $pdo->prepare('DELETE FROM players WHERE id = :id')->execute(['id' => $id]);
    json_out(['ok' => true]);
}

json_out(['error' => 'Action inconnue.'], 400);
