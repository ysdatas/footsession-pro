<?php
/**
 * API Analytics — agrégations pour les graphiques (scopées par rôle).
 *   GET ?action=overview&period=week|month|season|custom[&from=&to=]
 */
require_once __DIR__ . '/../includes/bootstrap.php';
api_guard();

$pdo = getDB();
if (($_GET['action'] ?? '') !== 'overview') {
    json_out(['error' => 'Action inconnue.'], 400);
}

/* ----- Plage de dates ----- */
$period = $_GET['period'] ?? 'month';
$to     = date('Y-m-d');
switch ($period) {
    case 'week':   $from = date('Y-m-d', strtotime('-7 days')); break;
    case 'season': $from = date('Y-m-d', strtotime('-12 months')); break;
    case 'custom':
        $from = preg_match('/^\d{4}-\d{2}-\d{2}$/', $_GET['from'] ?? '') ? $_GET['from'] : date('Y-m-d', strtotime('-1 month'));
        $to   = preg_match('/^\d{4}-\d{2}-\d{2}$/', $_GET['to'] ?? '')   ? $_GET['to']   : $to;
        break;
    case 'month':
    default:       $from = date('Y-m-d', strtotime('-1 month'));
}

/* ----- Restriction par rôle ----- */
$ownerAnd   = is_admin() ? '' : ' AND s.user_id = :uid';
$baseParams = ['from' => $from, 'to' => $to] + (is_admin() ? [] : ['uid' => current_user_id()]);

$run = function (string $sql, array $params) use ($pdo) {
    $st = $pdo->prepare($sql);
    $st->execute($params);
    return $st->fetchAll();
};

/* ----- KPIs ----- */
$nbSessions = (int) $run("SELECT COUNT(*) c FROM sessions s
    WHERE s.date_seance BETWEEN :from AND :to$ownerAnd", $baseParams)[0]['c'];

$nbProcedures = (int) $run("SELECT COUNT(*) c FROM procedures p JOIN sessions s ON p.session_id = s.id
    WHERE s.date_seance BETWEEN :from AND :to$ownerAnd", $baseParams)[0]['c'];

$avgPresenceRow = $run("SELECT AVG(a.present)*100 p FROM attendance a JOIN sessions s ON a.session_id = s.id
    WHERE s.date_seance BETWEEN :from AND :to$ownerAnd", $baseParams)[0]['p'] ?? null;
$avgPresence = $avgPresenceRow !== null ? round((float) $avgPresenceRow) : 0;

/* ----- Aide : agrégation simple sur une colonne ----- */
$groupBy = function (string $col, string $table = 'sessions s', string $joinOn = '') use ($run, $ownerAnd, $baseParams) {
    $join = $joinOn ? " JOIN sessions s ON $joinOn" : '';
    $sql = "SELECT COALESCE(NULLIF(TRIM($col),''),'—') label, COUNT(*) c
            FROM $table$join
            WHERE s.date_seance BETWEEN :from AND :to$ownerAnd
              AND $col IS NOT NULL AND TRIM($col) <> ''
            GROUP BY label ORDER BY c DESC LIMIT 8";
    return $run($sql, $baseParams);
};

$byCategory = $groupBy('s.categorie');
$effectifs  = $groupBy('p.effectif',      'procedures p', 'p.session_id = s.id');
$topPostes  = $groupBy('p.postes_cibles', 'procedures p', 'p.session_id = s.id');
$zones      = $groupBy('p.zones_jeu',     'procedures p', 'p.session_id = s.id');
$principes  = $groupBy('p.principes_jeu', 'procedures p', 'p.session_id = s.id');

/* ----- Séances sur 6 mois (série continue) ----- */
$rows = $run("SELECT DATE_FORMAT(s.date_seance,'%Y-%m') ym, COUNT(*) c FROM sessions s
              WHERE s.date_seance >= :from6$ownerAnd GROUP BY ym",
    ['from6' => date('Y-m-01', strtotime('-5 months'))] + (is_admin() ? [] : ['uid' => current_user_id()]));
$found = [];
foreach ($rows as $r) $found[$r['ym']] = (int) $r['c'];
$months = [];
for ($i = 5; $i >= 0; $i--) {
    $ym = date('Y-m', strtotime("-$i months"));
    $months[] = ['label' => date('M', strtotime($ym . '-01')), 'c' => $found[$ym] ?? 0];
}

json_out([
    'period'       => ['from' => $from, 'to' => $to, 'name' => $period],
    'kpis'         => ['sessions' => $nbSessions, 'procedures' => $nbProcedures, 'presence' => $avgPresence],
    'byCategory'   => $byCategory,
    'effectifs'    => $effectifs,
    'topPostes'    => $topPostes,
    'zones'        => $zones,
    'principes'    => $principes,
    'sessionsPerMonth' => $months,
]);
