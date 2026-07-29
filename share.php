<?php
/**
 * Page publique en LECTURE SEULE d'une séance, accessible via un lien de partage
 * (aucune connexion requise). Ne montre que la séance liée au jeton.
 */
require_once __DIR__ . '/php/includes/bootstrap.php';

$token = (string) ($_GET['token'] ?? '');
$pdo   = getDB();
$s = null;
if (preg_match('/^[a-f0-9]{16,40}$/', $token)) {
    $st = $pdo->prepare('SELECT s.*, u.nom AS coach_nom, u.club AS coach_club, u.club_logo
                         FROM sessions s JOIN users u ON u.id = s.user_id
                         WHERE s.share_token = :t LIMIT 1');
    $st->execute(['t' => $token]);
    $s = $st->fetch();
}

$procedures = [];
$attendance = [];
if ($s) {
    $pr = $pdo->prepare('SELECT p.*, t.canvas_image FROM procedures p
                         LEFT JOIN tactical_schemas t ON t.procedure_id = p.id
                         WHERE p.session_id = :sid ORDER BY p.ordre ASC, p.id ASC');
    $pr->execute(['sid' => (int) $s['id']]);
    $procedures = $pr->fetchAll();

    $at = $pdo->prepare('SELECT pl.nom, pl.prenom, pl.numero, COALESCE(a.present,0) present
                         FROM players pl LEFT JOIN attendance a ON a.player_id = pl.id AND a.session_id = :sid
                         WHERE pl.user_id = :owner ORDER BY pl.numero IS NULL, pl.numero');
    $at->execute(['sid' => (int) $s['id'], 'owner' => (int) $s['user_id']]);
    $attendance = $at->fetchAll();
}
?>
<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>FootSession Pro — <?= $s ? e($s['titre']) : 'Séance' ?></title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="assets/css/main.css">
  <style>
    body { padding: 24px; }
    .share-wrap { max-width: 900px; margin: 0 auto; }
    .share-head { display: flex; align-items: center; gap: 14px; border-bottom: 1px solid var(--border); padding-bottom: 16px; margin-bottom: 20px; }
    .share-head img { max-height: 48px; }
    .ro-badge { font-size: .7rem; color: var(--gold); border: 1px solid var(--gold-border); border-radius: 6px; padding: 3px 8px; }
    .sp-meta { display: flex; gap: 18px; flex-wrap: wrap; color: var(--text-secondary); font-size: .85rem; margin-bottom: 20px; }
    .sp-proc { margin-bottom: 16px; }
    .sp-proc h3 { display: flex; justify-content: space-between; }
    .sp-proc img { width: 100%; max-width: 520px; border-radius: 10px; border: 1px solid var(--border); margin: 8px 0; }
    .sp-field { font-size: .88rem; margin: 4px 0; }
    .sp-field b { color: var(--gold); font-weight: 600; }
  </style>
</head>
<body>
<div class="share-wrap">
<?php if (!$s): ?>
  <div class="empty">Lien de partage invalide ou expiré.</div>
<?php else: ?>
  <div class="share-head">
    <?php if (!empty($s['club_logo'])): ?><img src="<?= e($s['club_logo']) ?>" alt=""><?php endif; ?>
    <div style="flex:1;">
      <h1 style="margin:0;"><?= e($s['titre']) ?></h1>
      <div class="text-muted"><?= e($s['coach_club'] ?: 'FootSession Pro') ?> · <?= e($s['coach_nom']) ?></div>
    </div>
    <span class="ro-badge">LECTURE SEULE</span>
  </div>
  <div class="sp-meta">
    <span>Date : <?= e($s['date_seance']) ?></span>
    <?php if ($s['categorie']): ?><span>Phase : <?= e($s['categorie']) ?></span><?php endif; ?>
    <?php if ($s['equipe']): ?><span>Équipe : <?= e($s['equipe']) ?></span><?php endif; ?>
    <span>Durée : <?= (int) $s['duree_min'] ?> min</span>
    <span><?= count($procedures) ?> procédé<?= count($procedures) > 1 ? 's' : '' ?></span>
  </div>

  <?php foreach ($procedures as $i => $p): ?>
    <div class="card sp-proc">
      <h3><span><?= $i + 1 ?>. <?= e($p['nom']) ?></span><span class="text-muted"><?= (int) $p['duree_min'] ?> min<?= $p['intensite'] ? ' · RPE ' . (int) $p['intensite'] . '/10' : '' ?></span></h3>
      <?php if (!empty($p['canvas_image'])): ?><img src="<?= e($p['canvas_image']) ?>" alt="Schéma"><?php endif; ?>
      <?php foreach (['objectif' => 'Objectif', 'consignes' => 'Consignes', 'postes_cibles' => 'Postes ciblés', 'principes_jeu' => 'Principes', 'comportements_individuels' => 'Comportements'] as $k => $lbl): ?>
        <?php if (!empty($p[$k])): ?><div class="sp-field"><b><?= $lbl ?> :</b> <?= e($p[$k]) ?></div><?php endif; ?>
      <?php endforeach; ?>
    </div>
  <?php endforeach; ?>

  <?php if ($attendance): $present = count(array_filter($attendance, fn($a) => (int) $a['present'] === 1)); ?>
    <div class="card">
      <h3>Présence — <?= $present ?>/<?= count($attendance) ?></h3>
      <div class="tag-row" style="display:flex;flex-wrap:wrap;gap:6px;">
        <?php foreach ($attendance as $a): $name = trim(($a['prenom'] ?? '') . ' ' . $a['nom']); ?>
          <span class="pill" style="border-color:<?= (int) $a['present'] ? 'var(--success)' : 'var(--border)' ?>;"><?= e($name) ?><?= $a['numero'] !== null ? ' #' . (int) $a['numero'] : '' ?></span>
        <?php endforeach; ?>
      </div>
    </div>
  <?php endif; ?>

  <p class="text-muted" style="text-align:center;margin-top:24px;font-size:.8rem;">Généré par FootSession Pro</p>
<?php endif; ?>
</div>
</body>
</html>
