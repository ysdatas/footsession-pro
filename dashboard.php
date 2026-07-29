<?php
require_once __DIR__ . '/php/includes/bootstrap.php';
require_login();

$u   = current_user();
$pdo = getDB();

/* ----- Période (fenêtre glissante) ----- */
$period = $_GET['period'] ?? 'month';
$ranges = ['week' => '-7 days', 'month' => '-1 month', 'quarter' => '-3 months'];
$since  = date('Y-m-d', strtotime($ranges[$period] ?? '-1 month'));

/* ----- Restriction par rôle ----- */
$isAdmin   = is_admin();
$ownerAnd  = $isAdmin ? '' : ' AND s.user_id = :uid';
$ownerOnly = $isAdmin ? '1=1' : 'user_id = :uid';
$uidParam  = $isAdmin ? [] : ['uid' => current_user_id()];

$q = function (string $sql, array $params = []) use ($pdo) {
    $st = $pdo->prepare($sql);
    $st->execute($params);
    return $st;
};

/* ----- KPIs ----- */
$nbSessions = (int) $q("SELECT COUNT(*) c FROM sessions s WHERE s.date_seance >= :since$ownerAnd",
                       ['since' => $since] + $uidParam)->fetch()['c'];

$totalSessions = (int) $q("SELECT COUNT(*) c FROM sessions WHERE $ownerOnly", $uidParam)->fetch()['c'];

$nbProcedures = (int) $q("SELECT COUNT(*) c FROM procedures p
                          JOIN sessions s ON p.session_id = s.id
                          WHERE s.date_seance >= :since$ownerAnd", ['since' => $since] + $uidParam)->fetch()['c'];

$totalPlayers = (int) $q("SELECT COUNT(*) c FROM players WHERE $ownerOnly", $uidParam)->fetch()['c'];

$activePlayers = (int) $q("SELECT COUNT(DISTINCT a.player_id) c FROM attendance a
                           JOIN sessions s ON a.session_id = s.id
                           WHERE a.present = 1 AND s.date_seance >= :since$ownerAnd",
                          ['since' => $since] + $uidParam)->fetch()['c'];

$avgPresence = $q("SELECT AVG(a.present) * 100 p FROM attendance a
                   JOIN sessions s ON a.session_id = s.id
                   WHERE s.date_seance >= :since$ownerAnd", ['since' => $since] + $uidParam)->fetch()['p'];
$avgPresence = $avgPresence !== null ? round((float) $avgPresence) : 0;

/* ----- Charge de la période (unités arbitraires = durée × intensité RPE) ----- */
$charge = (int) $q("SELECT COALESCE(SUM(p.duree_min * COALESCE(p.intensite, 0)), 0) c
                    FROM procedures p JOIN sessions s ON p.session_id = s.id
                    WHERE s.date_seance >= :since$ownerAnd", ['since' => $since] + $uidParam)->fetch()['c'];

/* ----- Séances récentes ----- */
$recent = $q("SELECT s.*, (SELECT COUNT(*) FROM procedures WHERE session_id = s.id) nb
              FROM sessions s WHERE $ownerOnly ORDER BY s.date_seance DESC, s.id DESC LIMIT 6", $uidParam)->fetchAll();

/* ----- Récap par catégorie ----- */
$byCat = $q("SELECT COALESCE(NULLIF(s.categorie,''),'Sans catégorie') cat, COUNT(*) c
             FROM sessions s WHERE s.date_seance >= :since$ownerAnd
             GROUP BY cat ORDER BY c DESC", ['since' => $since] + $uidParam)->fetchAll();
$catMax = $byCat ? max(array_column($byCat, 'c')) : 1;

$labels = ['week' => 'Cette semaine', 'month' => 'Ce mois', 'quarter' => '3 mois'];
$periodLabel = $labels[$period] ?? 'Ce mois';

page_head('Tableau de bord', ['dashboard.css']);
app_shell_open('dashboard');
?>
<div class="page-head">
  <div>
    <h1>Bonjour, <?= e($u['nom']) ?></h1>
    <p class="subtitle"><?= e(ucfirst(strftime_fr())) ?></p>
  </div>
  <div class="page-actions">
    <a class="btn btn-primary" href="create-session.php">+ Nouvelle séance</a>
    <a class="btn" href="tactical-board.php">Tableau tactique</a>
  </div>
</div>

<div class="flex-between" style="margin-bottom:16px;">
  <h2 style="margin:0;">Aperçu — <?= e($periodLabel) ?></h2>
  <div class="segmented">
    <a href="?period=week"><button class="<?= $period === 'week' ? 'active' : '' ?>">Semaine</button></a>
    <a href="?period=month"><button class="<?= $period === 'month' ? 'active' : '' ?>">Mois</button></a>
    <a href="?period=quarter"><button class="<?= $period === 'quarter' ? 'active' : '' ?>">3 mois</button></a>
  </div>
</div>

<div class="kpi-grid">
  <div class="card kpi">
    <div class="kpi-num"><?= $nbSessions ?></div>
    <div class="kpi-label">Séances</div>
    <div class="kpi-sub"><?= $totalSessions ?> au total</div>
  </div>
  <div class="card kpi">
    <div class="kpi-num"><?= $activePlayers ?></div>
    <div class="kpi-label">Joueurs actifs</div>
    <div class="kpi-sub">Présence moy. <?= $avgPresence ?>%</div>
  </div>
  <div class="card kpi">
    <div class="kpi-num"><?= $nbProcedures ?></div>
    <div class="kpi-label">Procédés travaillés</div>
    <div class="kpi-sub"><?= $totalPlayers ?> joueurs au total</div>
  </div>
  <div class="card kpi gold">
    <div class="kpi-num"><?= number_format($charge, 0, ',', ' ') ?></div>
    <div class="kpi-label">Charge (u.a.)</div>
    <div class="kpi-sub">durée × intensité</div>
  </div>
</div>

<div class="dash-grid">
  <div class="card">
    <div class="flex-between" style="margin-bottom:14px;">
      <h3 style="margin:0;">Séances récentes</h3>
      <a class="text-gold" href="sessions.php" style="font-size:.85rem;">Voir tout →</a>
    </div>
    <?php if (!$recent): ?>
      <div class="empty">Aucune séance pour le moment.<br><a class="text-gold" href="create-session.php">Créer votre première séance</a></div>
    <?php else: ?>
      <ul class="recent-list">
        <?php foreach ($recent as $s): ?>
          <li class="recent-item" onclick="location.href='edit-session.php?id=<?= (int) $s['id'] ?>'">
            <span class="recent-bar"></span>
            <div class="recent-main">
              <div class="recent-title"><?= e($s['titre']) ?></div>
              <div class="recent-meta"><?= e($s['date_seance']) ?> · <?= (int) $s['duree_min'] ?> min · <?= (int) $s['nb'] ?> procédés</div>
            </div>
            <?php if ($s['categorie']): ?><span class="badge"><?= e($s['categorie']) ?></span><?php endif; ?>
          </li>
        <?php endforeach; ?>
      </ul>
    <?php endif; ?>
  </div>

  <div class="card">
    <h3>Accès rapide</h3>
    <div class="quick-grid">
      <a class="quick-tile" href="create-session.php"><span class="qt-dot" style="background:var(--gold)"></span>Créer une séance</a>
      <a class="quick-tile" href="tactical-board.php"><span class="qt-dot" style="background:var(--success)"></span>Tableau tactique</a>
      <a class="quick-tile" href="sessions.php"><span class="qt-dot" style="background:#7e6cff"></span>Mes séances</a>
      <a class="quick-tile" href="players.php"><span class="qt-dot" style="background:#3aa0ff"></span>Mes joueurs</a>
    </div>
  </div>
</div>

<div class="card" style="margin-top:18px;">
  <h3>Récapitulatif — <?= e($periodLabel) ?> (par catégorie)</h3>
  <?php if (!$byCat): ?>
    <p class="text-muted" style="margin:0;">Pas encore de données sur cette période.</p>
  <?php else: ?>
    <div class="recap">
      <?php foreach ($byCat as $row): $pct = round($row['c'] / $catMax * 100); ?>
        <div class="recap-row">
          <span class="recap-label"><?= e($row['cat']) ?></span>
          <span class="recap-track"><span class="recap-fill" style="width:<?= $pct ?>%"></span></span>
          <span class="recap-val"><?= (int) $row['c'] ?> séance<?= $row['c'] > 1 ? 's' : '' ?></span>
        </div>
      <?php endforeach; ?>
    </div>
  <?php endif; ?>
</div>

<?php
app_shell_close(['app.js']);

/* Date du jour en français, sans dépendre de l'extension intl/strftime. */
function strftime_fr(): string
{
    $jours = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
    $mois  = ['', 'janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
    return $jours[(int) date('w')] . ' ' . (int) date('j') . ' ' . $mois[(int) date('n')] . ' ' . date('Y');
}
?>
