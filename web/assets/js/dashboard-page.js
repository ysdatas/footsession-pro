/* ============================================================
   LMFC Performance — dashboard-page.js
   Accueil du staff : où je suis, ce qui m'attend, où aller.
     - en-tête : blason, date, bonjour, club · fonction · équipe,
       et les actions les plus fréquentes ;
     - « À traiter » : séquences vidéo à regarder, prochaine
       séance, objectifs en cours, mesures du mois (admin, prépa),
       accès en attente (admin) ;
     - « Accès rapides » : les rubriques permises à ce rôle, dans
       l'ordre de son menu (nav.js).
   Tout suit l'équipe choisie dans le menu, comme les autres pages.
   ============================================================ */

const homeIc = navIc;   // icônes communes au menu (nav.js)

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
    canEditPerformanceData(profile.role) && `<a class="btn${can('sessions') ? '' : ' btn-primary'}" href="comparaison.html?tab=morpho">${homeIc('scale')}Données physiques</a>`,
  ].filter(Boolean).join('');

  document.getElementById('homeTiles').innerHTML = allowed.map(i => `
    <a class="home-tile" href="${i.href}">${homeIc(i.key)}<span>${escapeHtml(i.label)}</span></a>`).join('');

  // Autant de cartes vides que le rôle en affichera (place réservée, rien ne bouge).
  const expected = [can('videos'), can('sessions'), can('performance'), canEditPerformanceData(profile.role) && monthLabelNow()].filter(Boolean).length;
  document.getElementById('homeAttn').innerHTML = '<div class="home-attn-card is-skel" aria-hidden="true"></div>'.repeat(expected);
  await renderAttention(profile, can);
  onRestore(() => renderAttention(profile, can));   // retour arrière : « À traiter » relu (app.js)
})();

/* Une case « À traiter » : libellé court, chiffre, précision éventuelle. */
const attnCard = ({ href, icon, value, label, detail, tone = '' }) => `
  <a class="home-attn-card${tone ? ` is-${tone}` : ''}" href="${href}">
    <span class="home-attn-head"><strong>${label}</strong>${homeIc(icon)}</span>
    <span class="home-attn-value">${value ?? '—'}</span>
    ${detail ? `<small>${detail}</small>` : ''}
  </a>`;

async function renderAttention(profile, can) {
  const box = document.getElementById('homeAttn');
  const today = new Date().toISOString().slice(0, 10);
  try {
    const none = Promise.resolve({ data: [], count: 0 });
    const month = monthLabelNow();
    const measuring = canEditPerformanceData(profile.role) && month;
    // Tout part en une vague (avant : les joueurs de l'équipe d'abord, puis le
    // reste filtré sur eux). La base ne renvoie que les joueurs permis ; le
    // filtre de l'équipe choisie se fait ici, sur leurs identifiants.
    const [pRes, seqRes, nextRes, objRes, accessRes, measRes] = await Promise.all([
      byPlayerTeam(sb.from('players').select('id')),
      can('videos')
        ? sb.from('video_sequences').select('id, player_id, submitted_at, feedback_at').not('submitted_at', 'is', null)
        : none,
      can('sessions')
        ? byTeam(sb.from('sessions').select('id, titre, date_seance').gte('date_seance', today).order('date_seance').limit(1))
        : none,
      can('performance')
        ? sb.from('player_performance_notes').select('player_id').in('kind', ['objective', 'prevention']).eq('status', 'active')
        : none,
      profile.role === 'admin'
        ? sb.from('club_access').select('id', { count: 'exact', head: true }).is('claimed_at', null)
        : none,
      measuring
        ? sb.from('player_physical_measurements').select('player_id, weight_kg, height_cm, body_fat_pct')
            .eq('month_label', month).eq('season_key', seasonKeyFor(null, clubSeasonStartMonth(profile.clubs)))
        : none,
    ]);
    if (pRes.error) throw pRes.error;
    [seqRes, nextRes, objRes, accessRes, measRes].forEach(r => { if (r.error) console.warn('Accueil : donnée indisponible', r.error); });
    const ids = (pRes.data || []).map(p => p.id), inTeam = new Set(ids);
    const mine = (res) => (res.data || []).filter(r => inTeam.has(r.player_id));

    const cards = [];
    if (can('videos')) {
      const toSee = mine(seqRes).filter(seqToSee).length;
      cards.push(attnCard({
        href: 'videos.html', icon: 'videos', tone: toSee ? 'urgent' : 'calm',
        value: toSee, label: 'Séquences à traiter',
      }));
    }
    if (can('sessions')) {
      const next = (nextRes.data || [])[0];
      cards.push(next
        ? attnCard({
          href: `session-edit.html?id=${next.id}`, icon: 'sessions', tone: next.date_seance === today ? 'urgent' : '',
          value: next.date_seance === today ? 'Aujourd’hui' : escapeHtml(fmtDate(next.date_seance)),
          label: 'Prochaine séance', detail: escapeHtml(next.titre || 'Séance'),
        })
        : attnCard({
          href: 'session-edit.html', icon: 'sessions', tone: 'calm',
          label: 'Prochaine séance', detail: 'Aucune prévue',
        }));
    }
    if (can('performance')) {
      const n = mine(objRes).length;
      cards.push(attnCard({
        href: 'comparaison.html?tab=objectifs', icon: 'target', tone: n ? '' : 'calm',
        value: n, label: 'Objectifs en cours', detail: 'Préventions comprises',
      }));
    }
    if (measuring && ids.length && !measRes.error) {
      const done = new Set(mine(measRes).filter(m => m.weight_kg != null || m.height_cm != null || m.body_fat_pct != null).map(m => m.player_id));
      const missing = ids.filter(id => !done.has(id)).length;
      cards.push(attnCard({
        href: 'comparaison.html?tab=morpho', icon: 'scale', tone: missing ? '' : 'calm',
        value: missing, label: `Sans mesure en ${month.toLowerCase()}`, detail: missing ? `sur ${ids.length} joueurs` : 'Tout est à jour',
      }));
    }
    if (profile.role === 'admin' && accessRes.count) {
      cards.push(attnCard({
        href: 'club.html', icon: 'key', tone: 'urgent',
        value: accessRes.count, label: 'Accès en attente', detail: 'Compte pas encore créé',
      }));
    }
    box.innerHTML = cards.join('') || '<p class="text-muted">Rien à signaler.</p>';
  } catch (e) {
    console.error('Accueil : « À traiter » indisponible', e);
    box.innerHTML = `<p class="text-danger">Impossible de charger ces informations (${escapeHtml(e.message)}).</p>`;
  }
}

/* Mois en cours s'il fait partie de la saison (août → juin), sinon null. */
function monthLabelNow() {
  const m = new Date().toLocaleDateString('fr-FR', { month: 'long' });
  const label = m.charAt(0).toUpperCase() + m.slice(1);
  return MONTHS.includes(label) ? label : null;
}
