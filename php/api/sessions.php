<?php
/**
 * API Séances — list / get / create / update / delete.
 * Toutes les écritures passent par api_guard() (auth + CSRF + blocage viewer).
 */
require_once __DIR__ . '/../includes/bootstrap.php';
api_guard();

$pdo    = getDB();
$action = $_GET['action'] ?? '';
$method = $_SERVER['REQUEST_METHOD'];
$body   = json_input();

/** Champs autorisés pour un procédé. */
const PROC_FIELDS = ['nom', 'duree_min', 'objectif', 'effectif', 'postes_cibles',
    'zones_jeu', 'taille_terrain', 'consignes', 'principes_jeu', 'comportements_individuels',
    'intensite', 'temps_recup_min'];

/** Récupère une séance en vérifiant la propriété (null si interdit/inexistant). */
function own_session(PDO $pdo, int $id): ?array
{
    $st = $pdo->prepare('SELECT * FROM sessions WHERE id = :id LIMIT 1');
    $st->execute(['id' => $id]);
    $s = $st->fetch();
    if (!$s) return null;
    if (!is_admin() && (int) $s['user_id'] !== current_user_id()) return null;
    return $s;
}

if ($method === 'GET' && ($action === 'list' || $action === '')) {
    [$where, $params] = is_admin() ? ['1=1', []] : ['s.user_id = :uid', ['uid' => current_user_id()]];
    $st = $pdo->prepare("SELECT s.*, (SELECT COUNT(*) FROM procedures WHERE session_id = s.id) AS nb_procedures
                         FROM sessions s WHERE $where ORDER BY s.date_seance DESC, s.id DESC");
    $st->execute($params);
    json_out(['sessions' => $st->fetchAll()]);
}

if ($method === 'GET' && $action === 'get') {
    $id = (int) ($_GET['id'] ?? 0);
    $s  = own_session($pdo, $id);
    if (!$s) json_out(['error' => 'Séance introuvable.'], 404);

    $pr = $pdo->prepare("SELECT p.*, t.id AS schema_id, t.canvas_image, t.canvas_json, t.vue_terrain
                         FROM procedures p
                         LEFT JOIN tactical_schemas t ON t.procedure_id = p.id
                         WHERE p.session_id = :sid ORDER BY p.ordre ASC, p.id ASC");
    $pr->execute(['sid' => $id]);
    $procedures = $pr->fetchAll();

    // Présences : tous les joueurs du propriétaire + état pour cette séance.
    $owner = (int) $s['user_id'];
    $att = $pdo->prepare("SELECT pl.id AS player_id, pl.nom, pl.prenom, pl.numero, pl.poste,
                                 COALESCE(a.present, 0) AS present
                          FROM players pl
                          LEFT JOIN attendance a ON a.player_id = pl.id AND a.session_id = :sid
                          WHERE pl.user_id = :owner
                          ORDER BY pl.numero IS NULL, pl.numero ASC, pl.nom ASC");
    $att->execute(['sid' => $id, 'owner' => $owner]);

    // Identité du coach/club (propriétaire) pour l'export PDF.
    $cn = $pdo->prepare('SELECT nom, club, club_color, club_logo FROM users WHERE id = :id');
    $cn->execute(['id' => $owner]);
    $coach = $cn->fetch();
    $s['coach_nom']   = $coach['nom']        ?? '';
    $s['coach_club']  = $coach['club']       ?? '';
    $s['club_color']  = $coach['club_color'] ?? '';
    $s['club_logo']   = $coach['club_logo']  ?? '';

    json_out(['session' => $s, 'procedures' => $procedures, 'attendance' => $att->fetchAll()]);
}

if ($method === 'POST' && $action === 'create') {
    $sess = $body['session'] ?? [];
    if (trim((string) ($sess['titre'] ?? '')) === '' || empty($sess['date_seance'])) {
        json_out(['error' => 'Titre et date obligatoires.'], 422);
    }
    $pdo->beginTransaction();
    try {
        $st = $pdo->prepare('INSERT INTO sessions (user_id, titre, date_seance, categorie, equipe, duree_min, notes)
                             VALUES (:uid, :titre, :date, :cat, :eq, :duree, :notes)');
        $st->execute([
            'uid'   => current_user_id(),
            'titre' => trim($sess['titre']),
            'date'  => $sess['date_seance'],
            'cat'   => $sess['categorie'] ?? null,
            'eq'    => $sess['equipe'] ?? null,
            'duree' => (int) ($sess['duree_min'] ?? 90),
            'notes' => $sess['notes'] ?? null,
        ]);
        $sid = (int) $pdo->lastInsertId();
        save_procedures($pdo, $sid, $body['procedures'] ?? []);
        save_attendance($pdo, $sid, (int) current_user_id(), $body['attendance'] ?? []);
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        error_log('session create: ' . $e->getMessage());
        json_out(['error' => 'Échec de l\'enregistrement.'], 500);
    }
    json_out(['ok' => true, 'id' => $sid]);
}

if ($method === 'POST' && $action === 'update') {
    $id = (int) ($_GET['id'] ?? 0);
    $s  = own_session($pdo, $id);
    if (!$s) json_out(['error' => 'Séance introuvable.'], 404);

    $sess = $body['session'] ?? [];
    if (trim((string) ($sess['titre'] ?? '')) === '' || empty($sess['date_seance'])) {
        json_out(['error' => 'Titre et date obligatoires.'], 422);
    }
    $pdo->beginTransaction();
    try {
        $st = $pdo->prepare('UPDATE sessions SET titre=:titre, date_seance=:date, categorie=:cat,
                             equipe=:eq, duree_min=:duree, notes=:notes WHERE id=:id');
        $st->execute([
            'titre' => trim($sess['titre']),
            'date'  => $sess['date_seance'],
            'cat'   => $sess['categorie'] ?? null,
            'eq'    => $sess['equipe'] ?? null,
            'duree' => (int) ($sess['duree_min'] ?? 90),
            'notes' => $sess['notes'] ?? null,
            'id'    => $id,
        ]);
        save_procedures($pdo, $id, $body['procedures'] ?? []);
        save_attendance($pdo, $id, (int) $s['user_id'], $body['attendance'] ?? []);
        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        error_log('session update: ' . $e->getMessage());
        json_out(['error' => 'Échec de la mise à jour.'], 500);
    }
    json_out(['ok' => true, 'id' => $id]);
}

if ($method === 'POST' && $action === 'delete') {
    $id = (int) ($_GET['id'] ?? 0);
    $s  = own_session($pdo, $id);
    if (!$s) json_out(['error' => 'Séance introuvable.'], 404);
    $pdo->prepare('DELETE FROM sessions WHERE id = :id')->execute(['id' => $id]);
    json_out(['ok' => true]);
}

if ($method === 'POST' && ($action === 'share' || $action === 'unshare')) {
    $id = (int) ($_GET['id'] ?? 0);
    $s  = own_session($pdo, $id);
    if (!$s) json_out(['error' => 'Séance introuvable.'], 404);
    if ($action === 'unshare') {
        $pdo->prepare('UPDATE sessions SET share_token = NULL WHERE id = :id')->execute(['id' => $id]);
        json_out(['ok' => true, 'token' => null]);
    }
    $token = $s['share_token'] ?: bin2hex(random_bytes(16));
    $pdo->prepare('UPDATE sessions SET share_token = :t WHERE id = :id')->execute(['t' => $token, 'id' => $id]);
    json_out(['ok' => true, 'token' => $token]);
}

json_out(['error' => 'Action inconnue.'], 400);

/* ---------------- Helpers persistance ---------------- */

/**
 * Synchronise les procédés d'une séance avec la liste reçue.
 * Met à jour les procédés existants (par id), insère les nouveaux,
 * supprime ceux absents — ce qui préserve les schémas tactiques liés.
 */
function save_procedures(PDO $pdo, int $sid, array $procedures): void
{
    $existing = $pdo->prepare('SELECT id FROM procedures WHERE session_id = :sid');
    $existing->execute(['sid' => $sid]);
    $existingIds = array_map('intval', array_column($existing->fetchAll(), 'id'));
    $keep = [];

    $ordre = 1;
    foreach ($procedures as $p) {
        $data = [];
        foreach (PROC_FIELDS as $f) {
            $data[$f] = $p[$f] ?? null;
        }
        $data['nom']             = trim((string) ($data['nom'] ?? '')) ?: 'Procédé';
        $data['duree_min']       = (int) ($data['duree_min'] ?? 20);
        $data['intensite']       = ($data['intensite'] ?? '') !== '' ? (int) $data['intensite'] : null;
        $data['temps_recup_min'] = ($data['temps_recup_min'] ?? '') !== '' ? (int) $data['temps_recup_min'] : null;
        $data['ordre']           = $ordre++;
        $pid = (int) ($p['id'] ?? 0);

        if ($pid && in_array($pid, $existingIds, true)) {
            $sql = 'UPDATE procedures SET ordre=:ordre, nom=:nom, duree_min=:duree_min, objectif=:objectif,
                    effectif=:effectif, postes_cibles=:postes_cibles, zones_jeu=:zones_jeu,
                    taille_terrain=:taille_terrain, consignes=:consignes, principes_jeu=:principes_jeu,
                    comportements_individuels=:comportements_individuels, intensite=:intensite,
                    temps_recup_min=:temps_recup_min WHERE id=:id AND session_id=:sid';
            $data['id'] = $pid; $data['sid'] = $sid;
            $pdo->prepare($sql)->execute($data);
            $keep[] = $pid;
        } else {
            $sql = 'INSERT INTO procedures (session_id, ordre, nom, duree_min, objectif, effectif,
                    postes_cibles, zones_jeu, taille_terrain, consignes, principes_jeu, comportements_individuels,
                    intensite, temps_recup_min)
                    VALUES (:sid, :ordre, :nom, :duree_min, :objectif, :effectif, :postes_cibles,
                    :zones_jeu, :taille_terrain, :consignes, :principes_jeu, :comportements_individuels,
                    :intensite, :temps_recup_min)';
            $data['sid'] = $sid;
            $pdo->prepare($sql)->execute($data);
            $keep[] = (int) $pdo->lastInsertId();
        }
    }

    $toDelete = array_diff($existingIds, $keep);
    if ($toDelete) {
        $in = implode(',', array_fill(0, count($toDelete), '?'));
        $del = $pdo->prepare("DELETE FROM procedures WHERE session_id = ? AND id IN ($in)");
        $del->execute(array_merge([$sid], array_values($toDelete)));
    }
}

/** Upsert des présences (seulement pour les joueurs appartenant au propriétaire). */
function save_attendance(PDO $pdo, int $sid, int $ownerId, array $attendance): void
{
    if (!$attendance) return;
    $valid = $pdo->prepare('SELECT id FROM players WHERE user_id = :owner');
    $valid->execute(['owner' => $ownerId]);
    $validIds = array_map('intval', array_column($valid->fetchAll(), 'id'));

    $up = $pdo->prepare('INSERT INTO attendance (player_id, session_id, present)
                         VALUES (:pid, :sid, :present)
                         ON DUPLICATE KEY UPDATE present = VALUES(present)');
    foreach ($attendance as $a) {
        $pid = (int) ($a['player_id'] ?? 0);
        if (!in_array($pid, $validIds, true)) continue;
        $up->execute(['pid' => $pid, 'sid' => $sid, 'present' => !empty($a['present']) ? 1 : 0]);
    }
}
