# LMFC Performance ⚽

> Anciennement « FootSession Pro ». Les identifiants techniques gardent l'ancien nom
> exprès : dépôt `footsession-pro`, Worker Cloudflare `footsession-pro` (le renommer
> créerait un autre Worker, sans le domaine ni le secret), clés du navigateur
> `footsession-*` (les changer déconnecterait tout le monde).

Gestion des séances d'entraînement et suivi individuel des joueurs, pour la cellule
vidéo / coaching d'un club. Design sobre noir / gris / doré, police Inter.

---

## 🏗 Architecture

| Couche | Technologie |
|---|---|
| Front-end | HTML + CSS + JS statiques dans `web/` — **aucun build, aucun npm** |
| Données / Auth / Storage | **Supabase**, appelé directement depuis le navigateur |
| Vidéos joueurs | **Cloudflare R2** via un petit Worker (`worker/index.js`) : bande passante gratuite |
| Sécurité | **RLS Postgres** + buckets Storage privés + URLs signées |
| Déploiement | **Cloudflare** (`wrangler.jsonc` → `web/` en statique + Worker `/api/videos/…`) |
| Dépôt | `git@github.com:ysdatas/footsession-pro.git`, branche `main` |

Il n'y a **pas de back-end applicatif**, à une exception près : le Worker vidéo, qui ne
fait que ranger et servir les fichiers vidéo (les droits restent ceux de la RLS). L'ancienne version PHP + MySQL a été retirée
du dépôt ; elle reste consultable dans l'historique Git. `DEPLOY.md` est une note de
livraison historique, conservée pour référence.

Le modèle de données est **multi-club** : les données appartiennent au club et tout le
staff les partage. Ce n'est plus « un coach ne voit que ses données ».

> ⚠️ **La sécurité est dans la RLS, pas dans l'interface.** Masquer un bouton ne
> protège rien : toute règle d'accès doit exister comme policy Postgres. Le front ne
> fait que refléter ce que la base autorise déjà.

---

## 🗄 Migrations Supabase — ordre d'exécution

À coller dans **SQL Editor** dans cet ordre. Faire une sauvegarde avant.

```
1.  supabase/schema.sql                        clubs, profils, séances, joueurs, RLS de base
2.  supabase/add_preferences.sql
3.  supabase/add_season_start.sql
4.  supabase/add_session_teams.sql
5.  supabase/add_procedure_sequences.sql
6.  supabase/club_invites_migration.sql
7.  supabase/update_shared_session.sql
8.  supabase/storage_policies.sql
9.  supabase/add_player_videos.sql             rôle joueur, player_videos, video_views, bucket
10. supabase/player_access_migration.sql       liaison compte ↔ fiche, RPC admin
11. supabase/player_performance_migration.sql  mesures, tests, notes, radar, buckets photo
12. supabase/player_video_selections.sql       sélection de séquences par le joueur
13. supabase/fix_audit_2026_09.sql             ⚠️ OBLIGATOIRE — voir ci-dessous
14. supabase/perf_dashboard.sql                moyennes du club (bornes + 3 joueurs minimum)
15. supabase/player_profile_career.sql         identité du joueur + parcours en club
16. supabase/performance_one_row_per_period.sql  une ligne par joueur/saison/mois : fin des doublons
17. supabase/roles_teams_preventions.sql     droits par rôle, équipes, vue joueur filtrée
18. supabase/player_lines.sql               ligne de jeu (Gardiens / Défenseurs / Milieux / Attaquants)
19. supabase/player_program.sql             programme individuel : exercices, images, schémas, vidéos
20. supabase/platform_v2.sql                trois rôles, accès par e-mail, séquences vidéo annotées, vidéo liée au schéma
21. supabase/video_status.sql               statuts des séquences : « Vu » (seen_at) et « Modifié » (edited_at)
22. supabase/lmfc_v3.sql                   statut des objectifs, objectif figé sur son joueur, principe de jeu de la
                                           séance, stockage schemas/logos réservé au staff du club
23. supabase/lmfc_v4.sql                   rôle préparateur physique (prepa), coach en consultation sur les données
                                           physiques, préventions (kind 'prevention'), titre d'objectif facultatif,
                                           photo du joueur (RPC set_player_photo), reprise des anciennes préventions
24. supabase/lmfc_v5.sql                   corbeille : table trash, copie de chaque suppression (et de ce qui
                                           part avec elle, joueur compris), trash_restore(), droits trash_right()
                                           — à repasser si une version précédente l'a déjà été (rejouable)
25. supabase/lmfc_v6.sql                   programme terrain par point : video_id et exercise_ids sur
                                           player_performance_notes (sans clé étrangère : la corbeille
                                           restaure les liens), contrôle guard_note_links (rejouable)
26. supabase/lmfc_v7.sql                   SÉCURITÉ : un compte ne change plus lui-même son rôle, son club ni
                                           son équipe (garde guard_profile_membership_changes corrigée) ;
                                           équipe d'un compte (profiles.team_id), joueur dans plusieurs
                                           équipes (players.other_team_ids), rubriques masquées au joueur
                                           (players.hidden_sections, RPC set_player_hidden_sections) (rejouable)
27. supabase/lmfc_v8.sql                   ce que voit le joueur en détail : hidden_sections accepte aussi un
                                           test ('test:sprint10_sec') ou une mesure ('mesure:weight_kg') (rejouable)
28. supabase/lmfc_v9.sql                   séance enrichie : attendance.statut (present suit le statut) et
                                           attendance.invite, procedures.equipes / staff / filme,
                                           sessions.filmee, table session_bilans (staff seulement, corbeille),
                                           trash_restore générique (toute table équipée du déclencheur),
                                           lien de partage sans commentaire général ni motif d'absence,
                                           commentaires de la cellule recopiés dans sessions.notes (rejouable)
29. supabase/lmfc_v10.sql                  droits d'accès par séance : sessions.acces ('club' pour les séances
                                           existantes, 'equipe' par défaut), table session_access, niveau
                                           session_level / session_access_level, politiques de la séance et de
                                           ses tables, garde du créateur, corbeille discrète (rejouable)
30. supabase/lmfc_v11.sql                  retours de match : tables matches et match_players (statut,
                                           minutes, buts, passes, + / = / −), staff en lecture, admin et
                                           coachs en écriture, corbeille avec les joueurs du match (rejouable)
31. supabase/lmfc_v12.sql                  durées à virgule (procedures.duree_min, temps_recup_min,
                                           duree_sequence_min, sessions.duree_min en numeric), statuts
                                           « groupe_pro » et « autre » (attendance.statut_libre, present
                                           suit la case « participe ») (rejouable)
32. supabase/lmfc_v13.sql                  sauvegarde automatique : sessions.updated_at avancé à chaque
                                           modification (trg_touch_session), verrou contre l'écrasement
                                           entre deux personnes ou deux onglets (rejouable)
```

### `lmfc_v7.sql` — garde des profils

La garde `guard_profile_membership_changes` était `SECURITY DEFINER` : à l'intérieur,
`current_user` valait son propriétaire, jamais `authenticated`, et la condition qui
bloque une mise à jour directe ne s'appliquait pas. N'importe quel compte connecté
pouvait se donner `role = 'admin'` et le `club_id` de son choix. Elle tourne désormais avec
les droits de l'appelant (`SECURITY INVOKER`) : depuis le site, rôle, club et équipe restent
inchangés ; les fonctions du serveur (`create_club`, `claim_club_access`,
`club_set_member_role`…) gardent la main. Test : `tests/teams-sql.test.mjs`.

### `lmfc_v5.sql` — la corbeille

- Un déclencheur garde une copie de chaque ligne supprimée (joueurs avec toute leur fiche :
  mesures, tests, vidéos, séquences, objectifs, programme, parcours, présences, accès en attente ;
  séances et leurs exercices,
  schémas, présences, commentaires ; vidéos et leurs séquences ; objectifs, préventions et
  leurs images ; exercices du programme ; parcours ; modèles ; équipes). Les pages
  suppriment comme avant ; la page **Corbeille** restaure (`trash_restore`, mêmes
  identifiants, liens remis : joueurs d'une équipe, vidéo d'un exercice ; plusieurs passes, pour
  qu'une ligne revenue avant son parent soit reprise) ou supprime pour de bon (fichiers compris).
- Droits = ceux de la suppression d'origine (`trash_right`) ; le joueur n'y a pas accès.
- Tant qu'elle n'est pas passée, rien ne change : une suppression reste définitive (la page le
  dit) et les fichiers partent avec la ligne. Ensuite, vidéos et images restent dans le stockage
  jusqu'à la suppression définitive.
- Vérifiée sur un vrai Postgres : `npm i --no-save @electric-sql/pglite && node tests/trash-sql.test.mjs`.

### `lmfc_v4.sql` — à passer avant de déployer ce code

- Le **coach ne modifie plus** les données physiques, les tests ni l'import Excel
  (`is_performance_editor()` = admin + prepa). Un coach qui faisait ce travail doit passer
  **Préparateur physique** dans *Mon club → Membres*.
- Sans cette migration : les préventions et les objectifs sans titre sont refusés par la base,
  et le rôle « Préparateur physique » ne peut pas être attribué.

### `fix_audit_2026_09.sql` — à ne pas sauter

Les migrations 9 à 12 se contredisaient sur `video_views` : l'une retirait au joueur le
droit de lire ses statistiques, l'autre le lui rendait. Selon l'ordre réellement
appliqué, soit le joueur accédait à des statistiques réservées au staff, soit le
tracking vidéo cessait d'enregistrer **en silence**. Ce fichier tranche, et il est
idempotent :

- statistiques de visionnage **réservées au staff** ;
- tracking via la RPC `track_video_view()` : le compte joueur n'a plus **aucun** droit
  direct (SELECT, INSERT ni UPDATE) sur `video_views` ;
- un joueur ne lit plus l'effectif ni les présences des autres ;
- vraie clé d'unicité pour les saisies manuelles (`source_file_name = ''` au lieu de
  `NULL`, qui ne déclenchait jamais de conflit et dupliquait chaque enregistrement) ;
- les scores « Profil /10 » importés depuis l'Excel ne sont plus écrasés par le
  recalcul de groupe.

`web/assets/js/video-tracking.js` appelle cette RPC : **sans cette migration, le suivi
de visionnage n'enregistre rien.**

---

## 👤 Rôles

| Rôle | Accès |
|---|---|
| `admin` | Tout, plus la gestion du club (**Mon club**) : accès par e-mail, membres, équipes, couleur du club, suppression de fiches ; toute la corbeille |
| `coach` | Séances, fiches joueurs, objectifs et préventions, programme terrain, vidéos et séquences, retours aux joueurs, statistiques de visionnage. **Consulte** la performance sans modifier les données physiques ni les tests |
| `prepa` | Préparateur physique : données physiques, tests, import Excel, photos des joueurs, objectifs et préventions. Ni vidéos, ni séances, ni tableau tactique |
| `joueur` | **Uniquement ses données**, en lecture : poids, masse grasse, chronos, radar /10, objectifs, préventions, programme terrain, ses vidéos. Il découpe, sélectionne et annote ses séquences et les envoie au staff. Jamais l'asymétrie, les plis cutanés, le ratio Shirado/Sorensen ni les statistiques de visionnage |

`platform_v2.sql` avait fondu `analyste`, `prepa` et `viewer` dans `coach` ; `lmfc_v4.sql` rétablit `prepa`.

Les droits sont appliqués deux fois : dans l'interface (`auth.js`, `nav.js`) **et** dans la
base (helpers `can_manage_videos()`, `can_manage_plans()`, `is_performance_editor()`).
Le joueur ne lit plus les tables de performance : il passe par `my_physical_measurements()`
et `my_physical_tests()`, qui ne renvoient que les colonnes qui lui sont destinées.

Le menu latéral (`web/assets/js/nav.js`) est construit selon le rôle ; chacun peut
masquer et réordonner ses rubriques (**Paramètres → Mon menu**, stocké dans
`profiles.prefs.nav`). Une page interdite au rôle renvoie au tableau de bord. Un clic sur son nom, en bas du
menu, propose « Paramètres » (staff) ; la déconnexion est l'icône à côté du nom.

### Équipes

Club → équipe → joueurs / séances. L'admin crée les équipes dans **Mon club** ; le
sélecteur en haut du menu (`profiles.prefs.team_id`) filtre Joueurs, Séances,
Performance, Vidéos et le tableau de bord. Les notes /10 et les moyennes
sont calculées au sein de l'équipe du joueur.

- **Compte rattaché à une équipe** (`profiles.team_id`, `lmfc_v7.sql`) : dans **Mon club →
  Membres**, l'admin choisit l'équipe d'un coach ou d'un préparateur (« Toutes les équipes »
  par défaut). Le menu affiche alors cette équipe sans choix possible, et le compte ne voit
  que ses joueurs et ses séances ; les séances de l'équipe sont partagées par tout son staff.
  Filtre d'affichage : la RLS reste celle du club.
- **Joueur dans plusieurs équipes** : `players.team_id` est l'équipe principale (moyennes
  « équipe »), `players.other_team_ids` les autres (« Joue aussi en », fenêtre **Modifier**).
  Le joueur apparaît dans les listes de chacune (`byPlayerTeam`, `playerInTeam`, `nav.js`) ;
  son compte joueur suit sa fiche.

### Accès : adresse e-mail + fonction (+ fiche joueur)

Plus de codes. L'admin enregistre dans **Mon club → Donner un accès** une adresse e-mail,
une fonction (joueur, coach, préparateur physique, admin) et, pour un joueur, sa fiche (`club_access`). La
personne crée son compte avec cette adresse sur `index.html` (page unique de connexion)
et confirme l'e-mail ; à la connexion, `claim_club_access()` la rattache au club avec son
rôle et sa fiche. Seule une adresse **confirmée** est acceptée, et un compte déjà membre
d'un autre club n'est jamais déplacé. La liste des membres permet ensuite de changer une
fonction ou de retirer quelqu'un du club (`club_remove_member`).

Les pages ouvertes à un compte joueur sont listées dans `PLAYER_PAGES`
(`web/assets/js/auth.js`). **Toute nouvelle page joueur doit y être ajoutée *et*
disposer des policies RLS correspondantes** — l'une sans l'autre donne une page vide
ou une fuite de données.

---

## 📊 Import Excel du préparateur physique

Page **Joueurs** ou fiche Performance → **Importer l’Excel** (admin, préparateur physique). Un seul fichier met à jour tout le club :

- chaque joueur du club est recherché dans le fichier, avec un tableau de contrôle avant validation ;
- une orthographe différente (« Botherel » / « BOTHOREL ») est **proposée**, jamais appliquée sans confirmation ;
- même nom de famille mais **prénom différent** (« Alex ARNOUX » / « ARNOUX Nathan ») : décoché, « à confirmer » ;
- l'aperçu montre la **source** (fichier, taille, date, onglets reconnus, saison et mode visés) et,
  par joueur, « Voir » détaille les valeurs lues (mesures par mois, tests par session) ;
- les joueurs du fichier sans fiche peuvent être créés en même temps ;
- **Compléter** (par défaut) : une cellule vide n’efface rien ; **Remplacer** : le fichier fait foi pour la saison.

Réimporter une version corrigée met à jour les valeurs : une ligne par joueur, saison et mois (ou session).
La lecture part toujours de la cellule A1, quelle que soit la zone que déclare le classeur.

Classeur de référence : `Tests_Physiques_N2-5.xlsx`. Onglets lus : `Anthropométrie`,
`Plis cutanés`, `Tests bruts`, `Profil sur 10`, et l'onglet individuel du joueur s'il
existe. Les décalages de colonnes sont documentés au-dessus de `parseExcel()`.

Le joueur est reconnu par son **nom de famille**, dans n'importe quel ordre
prénom/nom, et les valeurs numériques ne peuvent pas être prises pour un nom.

> **Règle absolue : une donnée absente du fichier reste absente.** Aucune valeur n'est
> recalculée ni devinée pour compléter une fiche — elle affiche `—`, et le radar ne
> relie que les axes réellement renseignés.

---

## 🧭 Pages

- **Accueil** (`dashboard.html`, `dashboard-page.js`) — où je suis (blason, date, club ·
  fonction · équipe), **À traiter** (séquences vidéo à regarder, prochaine séance, objectifs et
  préventions en cours, joueurs sans mesure ce mois-ci pour l'admin et le prépa, accès en attente
  pour l'admin) et **Accès rapides** (rubriques du rôle, dans l'ordre de son menu).
- **Signature visuelle** — l'en-tête « Bonjour » de l'accueil est repris sur chaque page :
  `.page-head` (staff), `.pv-head` (joueur), `.hero-surface` (fiches) dans `main.css` — liseré
  rouge et or à parts égales (`--stripe`), halos rouge à gauche / or à droite (`--hero-bg`),
  blason en filigrane, ligne « club · équipe » au-dessus du titre (`renderPageKicker`, `nav.js`).
- **Paramètres** — ce n'est pas une rubrique du menu : un clic sur son nom, en bas du menu,
  propose un seul lien, « Paramètres » (`renderUserMenu`, `nav.js`). La déconnexion est l'icône
  à côté du nom.
- **Page de connexion** (`index.html`) — sobre : blason sur le rond central d'un terrain, ligne
  médiane fine (rouge à gauche, or à droite) d'un bord à l'autre, « LMFC Performance » entre deux
  filets, « Le Mans FC », la connexion, puis la devise en signature discrète (« Tous acteurs pour
  réussir »), sur le fond aux halos rouge et or du club.
- **Couleur du club** (`theme.js`, chargé dans le `<head>` de chaque page) — choisie dans Mon club,
  appliquée aussitôt à toute l'interface (`--gold`, `--gold-rgb`, `--on-gold` : texte noir ou blanc
  selon le contraste) et aux PDF, enregistrée dans `clubs.color`, relue à chaque page
  (`requireAuth`, `requirePlayer`) ; gardée dans le navigateur pour s'afficher dès la première image.
- **Mémoire de navigation** (`app.js`) — chaque rubrique du menu rouvre sa dernière page (fiche,
  onglet), avec ses champs `data-remember` (recherche, filtres), les questions ouvertes de la FAQ
  et la position dans la page ; les liens `data-back` (« ← Joueurs ») retrouvent la liste telle
  qu'on l'a laissée. `sessionStorage`, vidé à la déconnexion et à la connexion.
- **Menu instantané** (`nav.js`) — le menu, l'équipe, le bloc « moi » et la ligne « club ·
  équipe » sont dessinés dès la fin du chargement de la page à partir du dernier profil connu
  (`localStorage` `lmfc-nav-cache`, même compte seulement, vidé à la déconnexion), puis
  redessinés avec le profil frais seulement s'ils ont changé : plus d'apparition après coup ni
  de page qui saute. La liste garde sa position d'une page à l'autre, la rubrique active reste
  visible ; sur téléphone, le menu glisse et le fond s'assombrit en fondu.
- **Sélection multiple** — « Tout sélectionner / Tout désélectionner » (`selectAllHtml`,
  `[data-select-scope]`, `app.js`) : export PDF, import Excel (joueurs reconnus seulement, jamais un
  rapprochement à confirmer), objectifs pour plusieurs joueurs, menu, compilation vidéo
  (plus « Sélection du joueur »), corbeille.
- **Corbeille** (`trash.html`) — voir `lmfc_v5.sql`.
- **Supprimer un joueur** (administrateur, RLS `players_delete`) — fiche → « Modifier » → « Supprimer
  le joueur », ou *Joueurs* → « Sélectionner » pour plusieurs. Refusé tant que la corbeille n'est pas
  active : la fiche et tout ce qui en dépend doivent rester récupérables.
- **Mode sélection** (`bulkBarHtml`, `selCheckHtml`, `app.js`) — cases, compteur « n sur N »,
  Tout sélectionner (ce qui est affiché) / Tout désélectionner, actions groupées : Joueurs (supprimer),
  Vidéos (supprimer, télécharger les originaux), Séquences (compiler, supprimer), Objectifs ·
  Préventions (statut, supprimer).
- **Gabarit commun** — toutes les pages, staff et joueur, ont la même largeur maximale et les mêmes
  marges (`--page-max`, `--page-pad-top`, `--page-pad-x` dans `main.css`), contenu aligné contre le
  menu ; la place de la barre de défilement est réservée (`scrollbar-gutter`).
- **Séances** — liste, recherche (titre, équipe, principe de jeu, date), export PDF, suppression.
- **Créer / Modifier une séance** — titre + **principe de jeu** (une fois pour la séance,
  `sessions.principes_jeu` ; les procédés en héritent, un ancien procédé garde le sien :
  `sessionPrinciple` / `procPrinciple` de `procedure-time.js`), procédés. Dans l'ordre de la page
  (`lmfc_v9.sql`) :
  - **Présences & statuts** (`session-roster.js`) : Présent, Reprise, Absent, Blessé, Sélection,
    Groupe pro, ou « Autre… » avec un motif libre et une case « participe »
    (`attendance.statut`, `statut_libre` ; `present` suit le statut, Analytics inchangé). Retard,
    Excusé et Malade ne sont plus proposés mais restent affichés sur les anciennes séances ;
    « Tous présents » ; **invité** : recherche dans tout l'effectif du club, ajouté pour cette
    séance seulement (`attendance.invite`, son équipe ne change pas), retiré d'un clic ;
  - **Chaque procédé** porte, dans sa carte (`session-proc-teams.js`), ses **équipes** (couleur,
    nom, joueurs cliqués depuis les présents : présent, reprise, retard, invités ;
    `procedures.equipes`) et son **staff** (nom — comptes du club proposés, saisie libre — et rôle :
    Animation, Consignes, Gestion vidéo… ; `procedures.staff`), « Reprendre de… » un autre
    procédé ; pastilles de couleur, nombre de staff et 🎥 sur l'en-tête replié. Ancienne séance :
    ses chasubles (`sessions.equipes`) sont reprises sur chaque procédé à l'ouverture et y sont
    rangées à la sauvegarde ;
  - **Séance filmée** (Oui / Non, `sessions.filmee`) après les procédés : chaque procédé l'est
    par défaut (case « Procédé filmé » dans sa carte, `procedures.filme = false` pour l'exclure),
    alerte si un procédé filmé n'a personne en « Gestion vidéo », résumé de qui filme quoi ;
  - **Bilan individuel** : + / = / − et commentaire court (140 caractères) par joueur
    (`session_bilans`, lu par le staff seulement), barre de lecture rapide, filtres ;
  - **Droits d'accès** (`session-access.js`, `lmfc_v10.sql`), réglés par le créateur ou
    l'administrateur : accès de base « staff de l'équipe de la séance » (défaut, avec le staff sans
    équipe fixe) ou « tout le staff du club » (les séances d'avant), puis Aucun / Lecture /
    Modification par personne (modification réservée aux comptes admin et coach ; seuls les écarts
    sont enregistrés). Le niveau est calculé en base (`session_access_level`) et s'applique à la
    séance, ses procédés, schémas, présences, bilans et commentaires, donc aux PDF. En lecture
    seule, la page est verrouillée. Le menu Séances s'ouvre au préparateur (ce qu'on lui partage) ;
  - **Commentaire général** (`sessions.notes`) : le seul commentaire de la séance. Les anciens
    « commentaires de la cellule » (`session_comments`) y sont recopiés par `lmfc_v9.sql`, avec
    leur auteur ; le bloc de la cellule a disparu de la page.
  Statuts, notes et équipes d'un procédé : `procedure-time.js` (`statutOf`, `participe`,
  `procTeamsOf`, `procIsFilmed`), partagés par l'éditeur, les PDF et la page de partage.
  **Sauvegarde automatique** (`session-autosave.js`, `lmfc_v13.sql`) : plus de bouton ; chaque
  `markDirty()` enregistre 0,8 s après la dernière modification, une sauvegarde à la fois (un
  changement pendant l'envoi repart juste après). Seul ce qui a changé part (procédés, présences,
  bilans, droits comparés à leur dernier état enregistré) ; la séance est créée dès qu'elle a un
  titre et une date (l'adresse devient `?id=…`, sans rechargement). Indicateur fixe en bas à
  droite : en attente, enregistrement, enregistré (heure), erreur (nouvel essai à 2 s, 4 s, 8 s…
  30 s ; clic = tout de suite). Verrou : la mise à jour de la séance porte `updated_at = celle
  lue` ; si quelqu'un d'autre a enregistré entre-temps, rien n'est écrit et la page demande de
  recharger. Un lien de l'application attend la fin de l'enregistrement ; fermer l'onglet avec
  des modifications en attente fait prévenir le navigateur ; un onglet masqué enregistre aussitôt.
  Les exports PDF enregistrent d'abord. L'ouverture charge séance, procédés, présences, bilans
  et effectif en une seule vague de requêtes.
  Le schéma d'un procédé pas encore enregistré se dessine tout de suite :
  `tactical-board.html?draft=…` le garde dans le navigateur (`tb_draft_*`) et son image dans
  `schemas/{club}/drafts/` ; dès que le tableau l'enregistre (`tb_draftmeta_*`, événement
  `storage`), la sauvegarde automatique le rattache au procédé (`commitDraftSchemas`).
- **PDF** (`pdf-generator.js`, `pdf-coach.js`) — principe de jeu de la séance en tête, objectif
  de chaque procédé, blason LMFC par défaut. Un texte trop long pour son bloc continue sur une
  page de suite au lieu d'être coupé. Le PDF complet garde sa base (page 1 : infos, déroulé,
  présences ; puis une page par procédé avec schéma) et y ajoute : colonne et bandeau « séance
  filmée » (qui gère la vidéo), « FILMÉ » sous le nom du procédé, présences avec la couleur et le
  motif du statut, invités signalés ; sur la page d'un procédé, sous le schéma ses **ÉQUIPES**
  (pastille de couleur, NOM, joueurs séparés par « • ») et sous les rubriques son **STAFF** ; un
  procédé sans schéma les a dans sa sous-ligne du déroulé. Un procédé tient toujours sur sa page
  (la police des rubriques se réduit au besoin). En fin de document : **récapitulatif des joueurs**
  (barre + / = / −, une pastille par joueur, noms et commentaires à la ligne) et **commentaire
  général**. La fiche coach reprend les équipes (couleur et joueurs) et le staff dans chaque quart.
- **Durées** — séquences, récupérations et durées acceptent la virgule (1,5 ; 0,5 ; 11,5),
  partout : saisie (`parseDecimal`), calculs, récapitulatif, PDF (`fmtMin`, au centième).
- **Retours de match** (`matchs.html`, `matchs-page.js`, `lmfc_v11.sql`) — onglet **Matchs** :
  liste de l'équipe choisie (score en vert / gris / rouge), fiche du match (adversaire, date,
  compétition, lieu, score, informations, commentaire général, à retenir) et ses joueurs
  (« Ajouter l'effectif » ou recherche dans le club ; statut, minutes, buts, passes, + / = / −,
  commentaire). Onglet **Par joueur** : totaux et frise de ses matchs. Tout le staff consulte,
  admin et coachs saisissent.
- **Tableau tactique** — Canvas interactif (voir ci-dessous).
- **Joueurs** — une ligne par joueur : nom à gauche, **taille — poids — poste** à droite (dernière
  mesure connue, rien d'inventé), rangés en Gardiens / Défenseurs / Milieux / Attaquants (ligne
  déduite du poste, ou choisie en glissant la ligne, à la souris), recherche, filtre par poste.
  Clic : la fiche ; **double-clic** ou crayon (toujours visible sur écran tactile) : modifier
  prénom, nom, poste, équipe (admin, coach).
- **Fiche joueur** (`player-performance.html?id=…`, staff) — une seule page, trois onglets sans
  changer de page (`?tab=fiche|performance|videos`, gardé au rechargement) sous l'en-tête (photo,
  identité, club, taille, poids, masse grasse, « Modifier » : identité, équipe principale et
  autres équipes, suppression pour l'admin) :
  - **Fiche** : parcours en frise horizontale (modifiable sur place), puis **Préventions** et
    **Programme terrain**, chacun sur toute la largeur. Pas de liste d'objectifs sur la fiche :
    ils figurent dans le document (PDF) joint par le staff ;
  - **Performance** : radar /10 (comparaison à un 2e joueur), tests, suivi physique (graphique
    dessiné à sa largeur réelle). Sous le titre de chaque bloc, l'interrupteur **Visible par le
    joueur** (admin, coach, prépa) : masqué, le bloc disparaît de son espace (Ma performance et
    les chiffres de son accueil), par exemple pour ne lui montrer que la toile. Pour les tests et
    le suivi physique, une pastille par élément affine : juste les sprints, juste le 505, la
    taille et le poids sans la masse grasse… (`players.hidden_sections`, `lmfc_v7.sql` et
    `lmfc_v8.sql`) ;
  - **Vidéos** (admin, coach) : les vidéos du joueur (`player-videos.js`, comme dans Vidéos joueurs).
  **Générer le PDF** : cases à cocher par rubrique (identité, mesures, tests, radar, points avec
  description, titre de la vidéo et exercices, préventions, tous les exercices, images des points).
  Les PDF joints sont reproduits page par page juste après leur point (`pdf-kit.js` →
  `pdfPages`, pdf-lib 1.17.1 avec intégrité vérifiée : pages vectorielles, en-tête et numéro
  de page du dossier). Chaque exercice est un bloc à part (« Exercice 1 — titre », séance,
  dosage, consignes, puis image et schéma côte à côte), images comprises sans case à cocher. `player.html` renvoie ici (anciens liens). Côté joueur, la même page est « Ma
  performance », sans onglets ni parcours. Pas de présences dans la rubrique Joueurs (elles restent dans
  chaque séance et dans le Bilan).
- **Programme terrain** (onglet Fiche) — chaque **point fort** ou **axe d'amélioration** : sa
  **vidéo** à gauche (une vidéo du joueur, ou importée depuis la fenêtre du point, avec son
  pourcentage), la **description du staff** à droite, ses **exercices** dessous (Exo 1, Exo 2…,
  dans l'ordre choisi ; « + Exo » crée un exercice déjà rattaché). Tous les exercices restent
  listés par séance (consignes, dosage, image légendée, schéma dessiné dans le tableau tactique
  via `tactical-board.html?exercise=ID`). Le joueur voit la même chose dans **Objectifs &
  préventions** (`mon-programme.html`), marque un exercice « fait » et laisse un ressenti (RPC
  `mark_program_exercise`). Liens : `lmfc_v6.sql`.
- **Performance de l'effectif** (`comparaison.html`) — tests bruts, évolution, données physiques,
  **Objectifs · Préventions** (`objectives-board.js`, `?tab=objectifs&player=…&new=1`) : tous les
  objectifs et préventions de l'effectif par joueur, filtres par type et par statut, ajout pour un
  ou plusieurs joueurs cochés (une ligne par joueur), titre facultatif, **images importées dans la
  fenêtre** (réduites à 1600 px, une copie dans le dossier de chaque joueur coché), statut modifiable
  sur place, modifier, supprimer (images comprises). Aussi sur la **fiche joueur**. Statut :
  `player_performance_notes.status` (active, achieved, missed) ; type : `kind` (objective,
  prevention) ; le trigger `guard_performance_note` interdit de changer le joueur d'un point.
- **Ordre au glisser-déposer** (`makeSortable`, `app.js`) — doigt et souris, poignée ⋮⋮, flèches
  au clavier : menu (Paramètres → Mon menu, enregistré au lâcher), équipes (Mon club,
  `teams.sort_order`), séquences d'une compilation.
- **FAQ** (`faq.html`) — questions cliquables : prise en main, puis données et calculs.
- **Vidéos** (`videos.html`, staff) — organisation progressive : d'abord **À traiter** (séquences
  envoyées par les joueurs, pas encore commentées) puis les **joueurs**, une ligne chacun
  (« 2 vidéos · 3 séquences » + « 1 à traiter »). Un joueur (`?player=…`, le retour du téléphone
  remonte d'un niveau ; même affichage que l'onglet Vidéos de la fiche, `player-videos.js`) :
  « Comment ça marche ? » (le circuit en 4 étapes), **À traiter**, puis chaque **vidéo envoyée**
  avec, sous elle, ses séquences marquées **Joueur** ou **Staff** (`created_by`) et, pour celles
  du joueur, leur statut. Sélection de séquences (compiler, supprimer) ou de vidéos (supprimer,
  télécharger les originaux).
- **Vidéo source et séquences** — deux écrans qui ne se mélangent pas (`video-workspace.js`) :
  - **Vidéo source** : la vidéo envoyée, jamais modifiée. « Sélectionner une portion » ouvre
    le mode sélection (`video-timeline.js` : poignées début / fin de 44 px, durée, ▶ relire,
    précision image par image avec « Début ici » / « Fin ici ») ; « Créer la séquence » ;
  - **Séquence** : une nouvelle vidéo à part entière — titre (« Séquence N », renommable),
    durée et timeline de 0 à sa fin, miniature, habillage, statut, envoi. Menu ⋯ : renommer,
    ajuster début et fin, image par image, dupliquer, supprimer ; ↶ / ↷ sur tout le montage ;
  - techniquement, une séquence est une ligne de `video_sequences` (début, fin, habillage,
    statut) qui ne lit que sa portion de la source : création instantanée, aucun fichier recopié ;
  - **Habillage** (`video-annotate.js`, `video-ink.js`) : flèche, trajectoire, repère joueur
    (anneau + n°), cercle, zone, projecteur, titre / texte. L'outil « Choisir » sélectionne un
    élément posé : ses seuls réglages apparaissent (couleur, texte, supprimer), on le déplace
    au doigt. Chaque annotation a un instant, une durée et, au choix, un arrêt sur image ;
    stockée dans `drawings` : `{ t, d, freeze, shapes }` ;
  - **Envoi** (`video-send.js`) : contenu (miniature, titre, durée), destinataire, message
    facultatif (l'analyse du joueur), puis une confirmation (destinataire, date, statut) ;
  - **Statuts** (`video-status.js`), un seul badge : Brouillon, Envoyé (« À traiter » côté staff),
    Vu, Retour, Modifié (changée depuis l'envoi). Le trigger `guard_video_sequence` date
    lui-même l'envoi, la lecture et les modifications (jamais l'horloge du téléphone) ;
  - le retour du téléphone passe d'un écran à l'autre (history) ; une annotation non
    enregistrée est protégée ; l'analyse s'enregistre au fil de la frappe.
  - **Compilation** (`video-compile.js`, staff) : un joueur → Séquences → « Compiler des
    séquences », touchées dans l'ordre, réordonnées au glisser-déposer, puis une seule vidéo.
    L'habillage n'est pas dans le fichier source (il est dans `drawings`) : la page rejoue
    chaque séquence dans un `<canvas>` — image, annotations dessinées par `paintInk`
    (`video-ink.js`, le même code qu'à l'écran), arrêts sur image, carton de titre — et
    l'enregistre avec le son (`MediaRecorder` : MP4 sur Chrome / Safari, WebM sinon).
    **Génération rapide** (`video-fastcompile.js`) quand le navigateur le permet : chaque fichier
    (95 Mo au plus) est lu d'un bloc par mp4box.js, ses images décodées et réencodées
    (WebCodecs), le son décodé puis réencodé (AAC), mp4-muxer écrit le MP4 — quelques secondes
    au lieu de la durée de la vidéo, même onglet en arrière-plan ; vidéos de téléphone tournées
    comme à l'écran. Bibliothèques chargées à la demande, versions figées avec empreinte SRI.
    Sinon (codec ou son illisible, navigateur ancien) : le temps réel, onglet au premier plan.
    Le fichier est téléchargé, rien n'est stocké ; « Ajouter aux vidéos du joueur » l'envoie
    sur R2 dans le dossier de CE joueur.
- **Mes vidéos** (joueur) — deux rubriques : **Vidéos** (sources) et **Mes séquences**
  (filtres Toutes · Brouillons · Envoyées), une carte avec miniature par contenu.
- **Espace joueur** — la même coque que le staff (`player-nav.js` + `layout.css`) : barre
  latérale (Accueil · Ma performance · Mes vidéos · Objectifs & préventions, son nom en bas avec
  la déconnexion) et, sur téléphone, onglets en bas ; garde `requirePlayer()`.
  **Accueil joueur** (`mon-espace.html`, `player-home.js`) : « Bonjour, Prénom », vidéos reçues,
  retours du staff, objectifs et préventions en cours, exercices à faire, derniers chiffres.
  **Objectifs & préventions** (`mon-programme.html`) : objectifs et préventions avec statut et
  images, puis programme terrain, en lecture seule.
- **Points** (objectifs, préventions, points forts, axes) — `notes.js` : un clic ouvre le point
  en grand (images, légendes, consignes) ; « Modifier » ajoute, légende ou retire des images et
  des **PDF** (20 Mo au plus, même table `player_performance_media`, reconnus à leur extension,
  aucune migration) : chaque PDF devient un lien qui s'ouvre dans un nouvel onglet ;
  sans titre, la carte reprend le début de la description.
- **Mon club** (admin) — identité (logo cliquable, couleur en pastilles), équipes, accès par
  e-mail, membres.
- **Design system** — `main.css` : échelle typographique unique (`--fs-xs` à `--fs-2xl`,
  toutes les tailles de l'app en font partie), espacements, rayons, profondeur, durées
  d'animation ; icônes Lucide en sprite SVG. Le projet reste sans build : pas de React ni
  de Tailwind, le « Liquid Glass » est en CSS natif, réservé à ce qui flotte au-dessus d'un
  terrain ou d'une vidéo. **Logo** : le même partout (« LMFC » + badge `.brand-pro` « Performance ») —
  menu du staff, barre du haut sur téléphone (`nav.js`), espace joueur, connexion. Cibles
  tactiles de 44 px sur téléphone. Règles détaillées : `docs/audit-mobile-ux.md` (vidéo) et
  `docs/audit-voc-plateforme.md` (Voice of Customer et QA mobile de toute la plateforme).
- **Couleurs** — partout (club, paramètres, tableau tactique) des pastilles d'une palette
  commune, plus « autre couleur » (`enhanceColorInputs`, `app.js`).
- **Analytics** — graphiques Chart.js, export PDF.

---

## 🎨 Tableau tactique — prise en main

- **Outils** : sélection, joueur, adversaire, flèche pleine (**passe**), flèche pointillée
  (**trajectoire**), trait, formes (carré, rectangle, cercle, triangle), texte. Une flèche ou un
  trait sélectionné passe en plein ou en pointillé avec « Pointillé » (barre de sélection ou menu
  de l'élément, `style` de l'élément) ; les schémas existants gardent leur tracé.
- **Zones** : choisir une forme puis **glisser** sur le terrain ; la sélectionner
  (outil ↖) puis **tirer un coin** pour la redimensionner.
- **Formations** : menu déroulant (4-3-3, 4-4-2…) place 11 joueurs.
- **Pion en image** : sélectionner un pion → icône image : PNG/JPG importé (maillot détouré,
  forme libre), photo d'un joueur du club (forme ronde, nom repris) ou **maillot du club** dessiné
  à la couleur du pion (col et manches à la couleur du club, `jerseyPng`), « Même image pour toute
  l'équipe », retirer. L'image, réduite à 192 px, est gardée DANS le schéma (`images` : id →
  dataURL ; le pion porte `img` et `imgFit`) : un seul exemplaire pour onze pions, et elle
  suit déplacement, copier-coller, taille, étapes animées, enregistrement et export.
- **Disposition** : le terrain est fixe et plein cadre (herbe texturée jusqu'aux bords) ;
  rien ne le réduit ni ne le déplace. Tout flotte par-dessus, en « verre » (`.glass`,
  `.glass-btn` dans `main.css`) : outils en haut à gauche, joueurs 1 à 11 à gauche,
  Matériel / Terrain / Exporter / Vidéo à droite (un clic ouvre le panneau par-dessus),
  animation en bas, réglages de l'élément juste au-dessus de lui (en bas, au pouce, sur
  téléphone). Pendant qu'on déplace un élément, ses réglages s'effacent et les barres
  s'estompent ; tout revient au relâchement.
- **Couleurs** : plus de panneau. Toucher à nouveau l'équipe active ouvre sa couleur ; la
  pastille au bout des outils règle celle des flèches, zones et textes. Les éléments suivants
  la reprennent, et elle est mémorisée dans le compte (comme dans **Paramètres**). Un élément
  sélectionné change de couleur seul, par la pastille de sa barre.
- **Téléphone** : un nouveau schéma s'ouvre en terrain vertical ; les barres défilent au doigt ;
  au doigt, la prise d'un pion est élargie et saisir son corps le déplace.
- **Joueurs** : choisir l'équipe (pastille), puis un numéro : chaque clic pose le joueur et
  passe au numéro suivant, une équipe se place en onze clics.
- **Dessin libre** (crayon), en plus des flèches, traits, zones et textes.
- **Annuler / Rétablir** : `Ctrl+Z` / `Ctrl+Maj+Z`, y compris étapes et clips.
- **Clips** : plusieurs animations sur le même terrain. Nouveau, dupliquer, découper à l'étape
  affichée (le début reste, la suite devient un nouveau clip), retirer avant / après,
  renommer, supprimer. Vitesse de lecture 0,5× à 2×.
- **Matériel** : cônes et coupelles en plusieurs couleurs, piquet, haie, échelle, cage, ballon.
- **Taille** : un curseur dans la barre de l'élément (glisser → voir → relâcher), plus de
  S / M / L ; les pions suivants gardent la taille choisie. À la souris, tirer un coin marche
  aussi. **Pincer** (deux doigts, ou le pavé tactile : Ctrl + molette / `gesturechange` sur
  Safari) agrandit la sélection, jamais la page (`touch-action: none`, viewport
  `maximum-scale=1` sur cette page). **Paramètres** règle la taille par défaut avec le même curseur.
- **Texte d'un pion** : « Texte » (nom, court libellé) en plus du N°, placé à l'une des 9 places
  autour du pion (`labelPos` : tl, t, tr, l, c, r, bl, b, br), lisible sur pastille sombre, qui
  suit le pion quand il bouge ou grandit. Un pion en image (maillot) peut pivoter.
- **Étapes** : « + Étape » crée l'étape suivante ; cliquer une pastille (1, 2, 3…)
  l'affiche, et chaque déplacement y est enregistré. « ▶ Lire » part de l'étape 1.
  Chaque étape garde ses éléments : flèches, traits et tracés n'appartiennent qu'à leur
  étape ; pions, matériel, zones et textes passent aux étapes suivantes et y bougent
  librement ; supprimer retire l'élément de l'étape affichée et des suivantes. Entre deux
  étapes, ce qui apparaît ou disparaît le fait en fondu (`STEP_ONLY`, `isVisible`,
  `tactical-board.js`).
- **Fiche tactique (PDF)** : titre, objectif, consignes (pré-remplis depuis le procédé ou
  l'exercice), une image par étape et la vidéo liée.
- **Vidéo liée** : associer une vidéo déjà sur la plateforme au procédé ou à l'exercice,
  sans la réimporter ; « ▶ » en haut la lit, la séance affiche « ▶ Vidéo liée ».
- **Export** : image de l'étape affichée, images de toutes les étapes, vidéo (MP4 quand le
  navigateur le permet), présentation plein écran avec sa barre (étapes, lecture, quitter).
  « Cadrer une zone » limite l'export ; Échap ou le même bouton annule, « ✕ » retire le cadrage.
- **Raccourcis** : `Ctrl+Z` annuler, `Suppr` supprimer l'élément sélectionné.
- **Sauvegarde** : auto en LocalStorage (30 s) ; « Enregistrer » (panneau Exporter) enregistre le JSON en
  base ; **Valider ce schéma** enregistre l'image dans le procédé et revient à la séance.

> Pour lier un schéma à un procédé, **enregistrez d'abord la séance**.

---

## 📄 Export PDF

Tous les PDF sont générés dans le navigateur avec jsPDF, en texte vectoriel (net à
l'impression, sélectionnable), avec la même composition (`pdf-kit.js`) :

- en-tête sur panneau clair : blason, rubrique du club, titre, faits clés à droite — pas de
  filet sous le logo ;
- rubriques numérotées (01, 02…), tableaux légers dont l'en-tête se répète en haut de page et
  dont aucune ligne n'est coupée, chiffres clés, radar vectoriel, images en grille ;
- pied de page : le numéro de page, rien d'autre ; couleur d'accent = couleur du club.

| Export | Où | Fichier |
|---|---|---|
| Fiche Performance (rubriques et période au choix, préventions comprises) | Performance d'un joueur | `perf-export.js` |
| Séance complète (récapitulatif, un procédé par page) | Séances, séance | `pdf-generator.js` |
| Fiche coach (4 procédés par page) | Séances, séance | `pdf-coach.js` |
| Bilan (chiffres clés, graphiques redessinés pour le papier) | Bilan & Analytics | `analytics-page.js` |
| Fiche tactique (une image par étape) | Tableau tactique | `tactical-board-ui.js` |

---

## 🛠 Développement

Aucune dépendance à installer. Servir le dossier `web/` :

```bash
python3 -m http.server 4173 --directory web
```

Vérifications (Node ≥ 18, aucun framework, aucun `node_modules`) :

```bash
node tests/perf-logic.test.mjs    # détection du joueur dans l'Excel + radar partiel
node tests/excel-import.test.mjs  # import validé sur le vrai Tests_Physiques_N2-5.xlsx
node tests/nav.test.mjs           # menu : rôles (dont prépa), ordre, rubriques masquées, pages interdites
node tests/lines-ranks.test.mjs    # lignes de jeu déduites du poste, classement de chaque test
node tests/video-worker.test.mjs  # Worker vidéo : droits, liens signés, lecture partielle (Range)
node tests/session-principle.test.mjs  # principe de jeu : séance, anciennes séances, héritage
node tests/video-status.test.mjs   # statuts des séquences vidéo
node tests/trash-sql.test.mjs      # corbeille sur un vrai Postgres (ignoré sans PGlite)
```

Le second tourne sur une extraction du classeur réel
(`tests/fixtures-tests-physiques.json`) et vérifie les valeurs exactes de plusieurs
joueurs, l'absence de fuite de données entre eux, et que les cellules vides le restent.

---

## ☁️ Déploiement

```bash
npx wrangler deploy
```

`web/` est publié tel quel, avec le Worker `worker/index.js` pour `/api/videos/…`.
Vérifier au préalable que les migrations Supabase correspondantes sont passées : **du
code déployé sans sa migration échoue en silence.**

### Vidéos sur Cloudflare R2 (une seule fois)

1. **R2 Object Storage** → activer (moyen de paiement demandé ; gratuit jusqu'à 10 Go).
2. **Create bucket** `lmfc-performance`, juridiction **Union européenne** (sinon,
   retirer `"jurisdiction"` dans `wrangler.jsonc`). Sans ce bucket, le déploiement échoue.
3. **Workers → footsession-pro → Settings → Variables and Secrets** → **Add** → type
   **Secret** (pas « Text »), nom `VIDEO_URL_SECRET`, valeur = une longue chaîne aléatoire
   (signe les liens de lecture ; la changer invalide seulement les liens en cours). Jamais
   dans le code. Sans lui, l'envoi marche mais aucune vidéo ne se lit : le Worker répond 503
   « Serveur vidéo incomplet : secret VIDEO_URL_SECRET absent ». `keep_vars` (wrangler.jsonc)
   évite qu'un déploiement efface une variable ajoutée à la main.

Les nouvelles vidéos (chemin `r2/{club_id}/{player_id}/…`, 95 Mo au plus) vont sur R2 ;
les anciennes restent lisibles dans le bucket Supabase `player-videos`. Tout passe par
`videoUrls` / `uploadVideoFile` / `removeVideoFile` (`web/assets/js/supabase-client.js`).
`uploadVideoFile` passe par XHR (seul moyen d'avoir l'avancement d'un envoi) : « + Envoyer
des vidéos » prend plusieurs fichiers d'un coup, envoyés l'un après l'autre avec le
pourcentage de chacun et du total ; un échec n'arrête pas les suivants (« Réessayer »).
Droits : lire = pouvoir lire la ligne `player_videos` (RLS) ; envoyer ou supprimer =
`can_manage_videos()` et le club du chemin est le sien.

### E-mails de confirmation (une seule fois)

L'inscription exige une adresse confirmée (c'est ce qui empêche de prendre l'accès d'un
joueur en s'inscrivant avec son adresse : ne pas désactiver « Confirm email »). Le service
d'envoi intégré de Supabase n'écrit qu'aux membres de l'équipe du projet Supabase, à
quelques e-mails par heure : les joueurs ne reçoivent rien. Il faut un SMTP à soi :

1. **Resend** (gratuit jusqu'à 100 e-mails par jour) : ajouter le domaine
   `lmfcperformance.com`, valider les enregistrements DNS (Cloudflare : « Auto configure »),
   créer une clé API (envoi seul).
2. **Supabase → Authentication → Emails → SMTP Settings** : activer le SMTP personnalisé.
   Hôte `smtp.resend.com`, port `465`, utilisateur `resend`, mot de passe = la clé API
   (jamais dans le dépôt), expéditeur `no-reply@lmfcperformance.com`, nom `LMFC Performance`.
3. **Authentication → URL Configuration** : Site URL `https://lmfcperformance.com`,
   Redirect URLs `https://lmfcperformance.com/**` (le lien de l'e-mail ramène sur `index.html`).
4. **Emails → Templates → Confirm signup** : coller `supabase/email-confirmation.html`
   (e-mail en français aux couleurs du club).

Variante en place aujourd'hui : SMTP Gmail (`smtp.gmail.com`, port `465`, identifiant et
expéditeur = l'adresse Gmail, mot de passe = un **mot de passe d'application** Google) ;
environ 500 e-mails par jour, l'expéditeur visible est l'adresse Gmail. Passer à Resend
plus tard ne touche pas au code.

`index.html` affiche « Renvoyer l'e-mail de confirmation » après l'inscription et quand
une connexion échoue sur une adresse non confirmée.

---

## 🔒 Sécurité

- **RLS Postgres** sur toutes les tables ; les helpers `my_club_id()`, `can_edit()`,
  `is_staff()`, `is_performance_editor()`, `is_video_stats_staff()` sont en
  `SECURITY DEFINER` pour éviter la récursion de policies.
- Vidéos R2 : liens de lecture signés HMAC (6 h) délivrés par le Worker après contrôle
  RLS ; servies en `video/*` avec `nosniff`, jamais comme une page.
- Buckets Storage **privés** (`player-videos`, `player-photos`,
  `player-performance-media`, `logos`, `schemas`), accès par **URL signée** à durée
  limitée. Convention de chemin `{club_id}/{player_id}/…`, contrôlée par policy.
- Élévation de privilèges bloquée : le trigger `guard_profile_membership_changes`
  empêche un utilisateur de modifier son propre `role` ou `club_id`.
- Écritures sensibles (rôles, liaison de fiche, tracking vidéo) par **RPC**
  `SECURITY DEFINER`, jamais par écriture directe.
- Échappement systématique des données affichées (`escapeHtml` / `esc`) ; **ne jamais
  injecter de JSON dans un attribut `onclick`** (un nom de joueur suffit à casser
  l'attribut).
- La clé Supabase publiée dans `web/assets/js/supabase-client.js` est la clé
  *publishable* : elle est publique par conception, c'est la RLS qui protège.
