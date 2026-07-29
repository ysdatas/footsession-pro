<?php
require_once __DIR__ . '/php/includes/bootstrap.php';
require_login();
if (!can_edit()) { header('Location: dashboard.php'); exit; }
$u = current_user();
page_head('Réglages');
app_shell_open('settings');
?>
<div class="page-head">
  <div>
    <h1>Réglages — Identité du club</h1>
    <p class="subtitle">Personnalisez la couleur d'accent et le logo, appliqués à l'application et aux PDF.</p>
  </div>
</div>

<div class="card" style="max-width:520px;">
  <div class="field"><label>Nom du club</label><input id="s-club" value="<?= e($u['club'] ?? '') ?>" placeholder="Ex: Union Sportive…"></div>
  <div class="field-row">
    <div class="field"><label>Couleur d'accent</label><input id="s-color" type="color" value="<?= e($u['club_color'] ?: '#C9A84C') ?>" style="height:40px;"></div>
    <div class="field">
      <label>Logo (PNG/JPG)</label>
      <input id="s-logo" type="file" accept="image/*">
    </div>
  </div>
  <div id="logoPreview" style="margin:8px 0;">
    <?php if (!empty($u['club_logo'])): ?><img src="<?= e($u['club_logo']) ?>" style="max-height:70px;border:1px solid var(--border);border-radius:8px;padding:6px;background:#fff;"><?php endif; ?>
  </div>
  <div class="flex gap-sm" style="margin-top:12px;">
    <button class="btn btn-primary" id="s-save" type="button">Enregistrer</button>
    <button class="btn btn-danger" id="s-remove-logo" type="button">Retirer le logo</button>
  </div>
</div>

<script>
  let logoData = null, removeLogo = false;
  document.getElementById('s-logo').addEventListener('change', (e) => {
    const file = e.target.files[0]; if (!file) return;
    const r = new FileReader();
    r.onload = ev => { logoData = ev.target.result; removeLogo = false;
      document.getElementById('logoPreview').innerHTML = '<img src="'+logoData+'" style="max-height:70px;border:1px solid var(--border);border-radius:8px;padding:6px;background:#fff;">'; };
    r.readAsDataURL(file);
  });
  document.getElementById('s-remove-logo').addEventListener('click', () => {
    logoData = null; removeLogo = true; document.getElementById('logoPreview').innerHTML = '<span class="text-muted">Logo retiré (enregistrez pour valider).</span>';
  });
  document.getElementById('s-save').addEventListener('click', async () => {
    const body = { club: document.getElementById('s-club').value.trim(), club_color: document.getElementById('s-color').value };
    if (logoData) body.club_logo = logoData;
    else if (removeLogo) body.club_logo = null;
    else body.keep_logo = true;
    try { await API('php/api/settings.php?action=save', { method: 'POST', body }); toast('Réglages enregistrés', 'success'); setTimeout(()=>location.reload(), 700); }
    catch (e) { toast(e.message, 'error'); }
  });
</script>
<?php app_shell_close(['app.js']); ?>
