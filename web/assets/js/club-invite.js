/* ============================================================
   LMFC Performance — club-invite.js (Mon club, administrateur)
   Accès préparés avant la première connexion (lmfc_v55.sql) : nom,
   responsabilité, rôle, équipes et « lecture sur toutes les équipes ».
     - La responsabilité est un intitulé (directeur sportif, responsable de
       catégorie…) : elle propose un rôle, sans donner de droit elle-même.
     - Une invitation du staff (ni admin ni joueur) sans équipe ni lecture club
       n'est pas activée par la base : le compte reste en attente, sans aucun
       accès, jusqu'à ce que son périmètre soit choisi ici.
   Dernière connexion des membres (lmfc_v56.sql, lastLoginText) : la dernière
   vraie connexion d'Auth, et le nombre de connexions sur 30 jours quand le
   journal d'Auth le donne ; rien n'est suivi en plus.
   Utilisé par club-page.js (formulaire, invitations en attente, membres).
   Dépend de app.js (el, toast, escapeHtml) et de nav.js (teamName).
   ============================================================ */

/* Responsabilité → [intitulé, rôle proposé, lecture club proposée]. */
const RESPONSABILITES = {
  administrateur: ['Administrateur', 'admin', false],
  directeur_sportif: ['Directeur sportif', 'lecteur', true],
  responsable_categorie: ['Responsable de catégorie', 'coach', false],
  entraineur_principal: ['Entraîneur principal', 'coach', false],
  entraineur_adjoint: ['Entraîneur adjoint', 'coach', false],
  preparateur: ['Préparateur physique', 'prepa', false],
  analyste: ['Analyste vidéo', 'analyste', false],
  scout: ['Scout', 'lecteur', false],
};
const respLabel = (k) => RESPONSABILITES[k]?.[0] || '';
const respOptions = (selected = '') => `<option value="">Responsabilité…</option>${Object.entries(RESPONSABILITES)
  .map(([k, [label]]) => `<option value="${k}"${k === selected ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('')}`;
const needsScope = (role) => !['admin', 'joueur'].includes(role);
const scopeHint = (role) => (role === 'lecteur'
  ? 'En lecture seule : ses équipes, ou « toutes les équipes » pour tout le club.'
  : 'Il gère les joueurs et les séances de ses équipes ; « toutes les équipes » ajoute la lecture des autres.');
/* Résumé d'un périmètre : équipes, tout le club, ou à définir (invitation qui ne s'activera pas). */
function scopeText(a) {
  if (!needsScope(a.role)) return '';
  const names = (a.team_ids || []).map(teamName).filter(Boolean);
  if (names.length) return names.join(', ') + (a.lecture_club ? ' + lecture de tout le club' : '');
  return a.lecture_club ? 'Tout le club, en lecture' : '';
}
const teamChecks = (name, ids = []) => (window.CLUB_TEAMS || []).map(t =>
  `<label><input type="checkbox" name="${name}" value="${t.id}"${ids.includes(t.id) ? ' checked' : ''}> ${escapeHtml(t.nom)}</label>`).join('');

/* « Dernière connexion : 13/11/2026 à 18h42 – 4 connexions sur 30 jours ». */
const LOGIN_DAYS = 30;
function lastLoginText(info) {
  if (!info) return '';
  if (!info.last_sign_in_at) return 'Jamais connecté';
  const d = new Date(info.last_sign_in_at), two = (n) => String(n).padStart(2, '0');
  return `Dernière connexion : ${d.toLocaleDateString('fr-FR')} à ${two(d.getHours())}h${two(d.getMinutes())}`
    + (info.logins == null ? '' : ` – ${info.logins} connexion${info.logins > 1 ? 's' : ''} sur ${LOGIN_DAYS} jours`);
}

/* Formulaire « Donner un accès » : responsabilité → rôle proposé ; périmètre pour le staff. */
function syncInviteForm(fromResp = false) {
  const role = document.getElementById('accRole'), resp = document.getElementById('accResp').value;
  if (fromResp && RESPONSABILITES[resp]) {
    role.value = RESPONSABILITES[resp][1];
    document.getElementById('accClub').checked = RESPONSABILITES[resp][2];
  }
  document.getElementById('accPlayer').classList.toggle('hidden', role.value !== 'joueur');
  document.getElementById('accScope').classList.toggle('hidden', !needsScope(role.value) || !(window.CLUB_TEAMS || []).length);
  document.getElementById('accScopeHint').textContent = scopeHint(role.value);
}
function initInviteForm() {
  document.getElementById('accResp').innerHTML = respOptions();
  document.getElementById('accTeams').innerHTML = teamChecks('accTeam');
  document.getElementById('accResp').addEventListener('change', () => syncInviteForm(true));
  document.getElementById('accRole').addEventListener('change', () => syncInviteForm());
  syncInviteForm();
}
/* Valeurs du formulaire, ou une erreur à afficher. */
function inviteFields() {
  const role = document.getElementById('accRole').value;
  const team_ids = [...document.querySelectorAll('#accTeams input:checked')].map(b => Number(b.value));
  const lecture_club = needsScope(role) && document.getElementById('accClub').checked;
  const f = { nom: document.getElementById('accNom').value.trim() || null, responsabilite: document.getElementById('accResp').value || null,
    team_ids: needsScope(role) ? team_ids : [], lecture_club };
  if (needsScope(role) && (window.CLUB_TEAMS || []).length && !team_ids.length && !lecture_club) {
    return { error: 'Choisissez au moins une équipe, ou « Lecture sur toutes les équipes » : sans périmètre, le compte n’aurait accès à rien.' };
  }
  return f;
}

/* Invitation en attente : ses équipes et la lecture club, modifiables avant la première connexion. */
function editInviteScope(a) {
  return new Promise((resolve) => {
    const back = document.activeElement;
    const list = el('div', { class: 'acc-teams', role: 'group', 'aria-label': 'Équipes' });
    list.innerHTML = teamChecks('invTeam', a.team_ids || []);
    const club = el('input', { type: 'checkbox', id: 'invClub', ...(a.lecture_club ? { checked: 'checked' } : {}) });
    const cancel = el('button', { type: 'button', class: 'btn' }, 'Annuler');
    const save = el('button', { type: 'button', class: 'btn btn-primary' }, 'Enregistrer');
    const box = el('div', { class: 'modal-backdrop open dlg', 'data-busy': '' },
      el('div', { class: 'modal dlg-box', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'invTitle' },
        el('h2', { class: 'as-h3', id: 'invTitle' }, `Périmètre de ${a.nom || a.email}`),
        el('p', { class: 'dlg-body' }, scopeHint(a.role)), list,
        el('label', { for: 'invClub', class: 'acc-club' }, club, ' Lecture sur toutes les équipes'),
        el('div', { class: 'modal-actions' }, cancel, save)));
    const done = (v) => { box.remove(); back?.focus?.(); resolve(v); };
    cancel.addEventListener('click', () => done(false));
    box.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') done(false); });
    save.addEventListener('click', async () => {
      const team_ids = [...list.querySelectorAll('input:checked')].map(b => Number(b.value));
      if (!team_ids.length && !club.checked) return toast('Choisissez au moins une équipe, ou « Lecture sur toutes les équipes ».', 'error');
      save.disabled = true;
      const { error } = await sb.from('club_access').update({ team_ids, lecture_club: club.checked }).eq('id', a.id);
      if (error) { save.disabled = false; return toast(error.message, 'error'); }
      toast('Périmètre enregistré : l’accès s’activera à sa première connexion.', 'success');
      done(true);
    });
    document.body.append(box);
    list.querySelector('input')?.focus();
  });
}
