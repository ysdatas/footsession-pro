/* ============================================================
   LMFC Performance — dashboard-page.js
   Accueil du staff : où je suis, ce qui m'attend, où aller.
     - en-tête : blason, date, bonjour, club · fonction · équipe,
       et les actions les plus fréquentes ;
     - « À traiter » : séquences vidéo à regarder, prochaine
       séance, objectifs en cours, accès en attente (admin) ;
     - « Accès rapides » : les rubriques permises à ce rôle, dans
       l'ordre de son menu (nav.js).
   Tout suit l'équipe choisie dans le menu, comme les autres pages.
   ============================================================ */

const HOME_IC = {
  sessions: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  players: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  performance: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  videos: '<path d="m16 13 5.22 3.48a.5.5 0 0 0 .78-.41V7.87a.5.5 0 0 0-.75-.43L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
  tactical: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M12 4v16"/><circle cx="12" cy="12" r="3"/>',
  analytics: '<path d="M3 3v18h18"/><path d="M18 17V9M13 17V5M8 17v-3"/>',
  faq: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3M12 17h.01"/>',
  club: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  key: '<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
};
const homeIc = (k) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${HOME_IC[k] || HOME_IC.plus}</svg>`;
const HOME_DESC = {
  sessions: 'Préparer, modifier, exporter en PDF',
  players: 'Fiches, objectifs, programme terrain',
  performance: 'Tests, évolution, objectifs de l’effectif',
  videos: 'Séquences envoyées, retours, envois',
  tactical: 'Schémas et animations',
  analytics: 'Bilan des séances',
  faq: 'Mode d’emploi',
  club: 'Accès, équipes, identité du club',
};

(async () => {
  const ctx = await requireAuth();
  if (!ctx) return;
  const { profile } = ctx;
  const role = ROLE_LABELS[profile.role] || profile.role;
  document.getElementById('uName').textContent = profile.nom || 'Utilisateur';
  document.getElementById('uRole').textContent = role.toUpperCase();
  document.getElementById('uAvatar').textContent = (profile.nom || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  document.getElementById('logoutLink').addEventListener('click', (e) => { e.preventDefault(); logout(); });

  const team = currentTeam();
  const first = (profile.nom || '').split(' ')[0];
  document.getElementById('homeDate').textContent = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  document.getElementById('greeting').textContent = `Bonjour${first ? `, ${first}` : ''}`;
  document.getElementById('clubLine').textContent = [profile.clubs?.nom || 'Club', role, team?.nom].filter(Boolean).join(' · ');

  const allowed = orderedNavItems(profile.role, profile.prefs).filter(i => i.key !== 'dashboard' && i.key !== 'settings');
  const can = (key) => allowed.some(i => i.key === key);
  document.getElementById('homeActions').innerHTML = [
    can('sessions') && `<a class="btn btn-primary" href="session-edit.html">${homeIc('plus')}Nouvelle séance</a>`,
    can('performance') && `<a class="btn" href="comparaison.html?tab=objectifs&new=1">${homeIc('target')}Objectif</a>`,
    can('videos') && `<a class="btn" href="videos.html">${homeIc('videos')}Vidéos</a>`,
  ].filter(Boolean).join('');

  document.getElementById('homeTiles').innerHTML = allowed.map(i => `
    <a class="home-tile" href="${i.href}">
      <span class="home-tile-ic">${homeIc(i.key)}</span>
      <span class="home-tile-text"><strong>${escapeHtml(i.label)}</strong><small>${escapeHtml(HOME_DESC[i.key] || '')}</small></span>
    </a>`).join('');

  await renderAttention(profile, can);
})();

/* Une carte « À traiter » : chiffre ou titre, explication, lien. */
const attnCard = ({ href, icon, value, label, detail, tone = '' }) => `
  <a class="home-attn-card${tone ? ` is-${tone}` : ''}" href="${href}">
    <span class="home-attn-ic">${homeIc(icon)}</span>
    <span class="home-attn-body">
      <span class="home-attn-value">${value}</span>
      <strong>${label}</strong>
      ${detail ? `<small>${detail}</small>` : ''}
    </span>
  </a>`;

async function renderAttention(profile, can) {
  const box = document.getElementById('homeAttn');
  const today = new Date().toISOString().slice(0, 10);
  try {
    const { data: players, error: pErr } = await byTeam(sb.from('players').select('id'));
    if (pErr) throw pErr;
    const ids = (players || []).map(p => p.id);
    const none = Promise.resolve({ data: [], count: 0 });
    const [seqRes, nextRes, objRes, accessRes] = await Promise.all([
      can('videos') && ids.length
        ? sb.from('video_sequences').select('id, player_id, submitted_at, feedback_at').in('player_id', ids).not('submitted_at', 'is', null)
        : none,
      can('sessions')
        ? byTeam(sb.from('sessions').select('id, titre, date_seance').gte('date_seance', today).order('date_seance').limit(1))
        : none,
      can('performance') && ids.length
        ? sb.from('player_performance_notes').select('id', { count: 'exact', head: true }).eq('kind', 'objective').eq('status', 'active').in('player_id', ids)
        : none,
      profile.role === 'admin'
        ? sb.from('club_access').select('id', { count: 'exact', head: true }).is('claimed_at', null)
        : none,
    ]);
    [seqRes, nextRes, objRes, accessRes].forEach(r => { if (r.error) console.warn('Accueil : donnée indisponible', r.error); });

    const cards = [];
    if (can('videos')) {
      const toSee = (seqRes.data || []).filter(seqToSee).length;
      cards.push(attnCard({
        href: 'videos.html', icon: 'videos', tone: toSee ? 'urgent' : 'calm',
        value: toSee || '✓', label: toSee ? `séquence${toSee > 1 ? 's' : ''} à regarder` : 'Aucune vidéo à regarder',
        detail: toSee ? 'Envoyées par vos joueurs, en attente de votre retour.' : 'Les envois de vos joueurs apparaîtront ici.',
      }));
    }
    if (can('sessions')) {
      const next = (nextRes.data || [])[0];
      cards.push(next
        ? attnCard({
          href: `session-edit.html?id=${next.id}`, icon: 'sessions', tone: next.date_seance === today ? 'urgent' : '',
          value: next.date_seance === today ? 'Aujourd’hui' : escapeHtml(fmtDate(next.date_seance)),
          label: escapeHtml(next.titre || 'Séance'), detail: 'Prochaine séance — ouvrir, ajuster, imprimer.',
        })
        : attnCard({
          href: 'session-edit.html', icon: 'plus', tone: 'calm',
          value: '—', label: 'Aucune séance prévue', detail: 'Préparer la prochaine séance.',
        }));
    }
    if (can('performance')) {
      const n = objRes.count || 0;
      cards.push(attnCard({
        href: 'comparaison.html?tab=objectifs', icon: 'target', tone: n ? '' : 'calm',
        value: n || '—', label: n ? `objectif${n > 1 ? 's' : ''} en cours` : 'Aucun objectif en cours',
        detail: n ? 'Mettre à jour leur statut, en ajouter.' : 'Fixer des objectifs à un ou plusieurs joueurs.',
      }));
    }
    if (profile.role === 'admin' && accessRes.count) {
      cards.push(attnCard({
        href: 'club.html', icon: 'key', tone: 'urgent',
        value: accessRes.count, label: `accès en attente`, detail: 'Personnes enregistrées qui n’ont pas encore créé leur compte.',
      }));
    }
    box.innerHTML = cards.join('') || '<p class="text-muted">Rien à signaler.</p>';
  } catch (e) {
    console.error('Accueil : « À traiter » indisponible', e);
    box.innerHTML = `<p class="text-danger">Impossible de charger ces informations (${escapeHtml(e.message)}).</p>`;
  }
}
