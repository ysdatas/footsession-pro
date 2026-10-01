# FootSession Pro ⚽

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
```

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
| `admin` | Tout, plus la gestion du club (**Mon club**) : accès par e-mail, membres, équipes, suppression de fiches |
| `coach` | Tout le travail du staff : séances, joueurs, données physiques et tests, import Excel, objectifs, programme terrain, vidéos et séquences, retours aux joueurs, statistiques de visionnage |
| `joueur` | **Uniquement ses données** : poids, masse grasse, chronos, radar /10, objectifs, programme terrain, ses vidéos. Il découpe, sélectionne et annote ses séquences et les envoie au staff. Jamais l'asymétrie, les plis cutanés, le ratio Shirado/Sorensen ni les statistiques de visionnage |

Depuis `platform_v2.sql`, les anciens rôles `analyste`, `prepa` et `viewer` sont devenus `coach`.

Les droits sont appliqués deux fois : dans l'interface (`auth.js`, `nav.js`) **et** dans la
base (helpers `can_manage_videos()`, `can_manage_plans()`, `is_performance_editor()`).
Le joueur ne lit plus les tables de performance : il passe par `my_physical_measurements()`
et `my_physical_tests()`, qui ne renvoient que les colonnes qui lui sont destinées.

Le menu latéral (`web/assets/js/nav.js`) est construit selon le rôle ; chacun peut
masquer et réordonner ses rubriques (**Paramètres → Mon menu**, stocké dans
`profiles.prefs.nav`). Une page interdite au rôle renvoie au tableau de bord.

### Équipes

Club → équipe → joueurs / séances. L'admin crée les équipes dans **Mon club** ; le
sélecteur en haut du menu (`profiles.prefs.team_id`) filtre Joueurs, Séances,
Performance, Vidéos et le tableau de bord. Les notes /10 et les moyennes
sont calculées au sein de l'équipe du joueur.

### Accès : adresse e-mail + fonction (+ fiche joueur)

Plus de codes. L'admin enregistre dans **Mon club → Donner un accès** une adresse e-mail,
une fonction (joueur, coach, admin) et, pour un joueur, sa fiche (`club_access`). La
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

Page **Joueurs** ou fiche joueur → **Importer l’Excel**. Un seul fichier met à jour tout le club :

- chaque joueur du club est recherché dans le fichier, avec un tableau de contrôle avant validation ;
- une orthographe différente (« Botherel » / « BOTHOREL ») est **proposée**, jamais appliquée sans confirmation ;
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

- **Tableau de bord** — KPIs, séances récentes, récap par catégorie.
- **Séances** — liste, recherche, export PDF, suppression.
- **Créer / Modifier une séance** — procédés dynamiques, présence, schéma tactique.
- **Tableau tactique** — Canvas interactif (voir ci-dessous).
- **Joueurs** — effectif rangé en Gardiens / Défenseurs / Milieux / Attaquants (ligne déduite du
  poste, ou choisie en glissant la carte dans une autre rubrique), recherche, filtre par poste.
- **Fiche joueur** (`player.html`) — informations modifiables sur place, photo (clic sur
  l'avatar), derniers relevés, parcours, **Programme terrain** ; accès Performance / Vidéos.
- **Programme terrain** (fiche joueur) — développement footballistique : points forts, axes
  d'amélioration, exercices regroupés par séance (consignes, dosage, image légendée, schéma
  dessiné dans le tableau tactique via `tactical-board.html?exercise=ID`, vidéo déjà sur la
  plateforme). Le joueur le consulte dans **Mon programme terrain** (`mon-programme.html`),
  marque un exercice « fait » et laisse un ressenti (RPC `mark_program_exercise`).
- **Performance** (`player-performance.html`) — développement physique : photo (clic sur
  l'avatar), mesures, tests, radar /10 (comparaison à un 2e joueur pour le staff),
  **Objectifs** (objectifs et exercices physiques avec images), parcours, **Générer le PDF**.
- **Performance de l'effectif** (`comparaison.html`) — tests bruts, évolution, données physiques.
- **FAQ** (`faq.html`) — questions cliquables : prise en main, puis données et calculs.
- **Vidéos** (`videos.html`, staff) — organisation progressive : d'abord **À voir** (séquences
  envoyées par les joueurs, pas encore commentées) puis les **joueurs**, une ligne chacun
  (« 2 vidéos · 3 séquences » + « 1 à voir »). Un joueur ouvre ses rubriques **À voir ·
  Séquences · Vidéos** (`?player=…&tab=…`, le retour du téléphone remonte d'un niveau).
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
  - **Statuts** (`video-status.js`), un seul badge : Brouillon, Envoyé (« À voir » côté staff),
    Vu, Retour, Modifié (changée depuis l'envoi). Le trigger `guard_video_sequence` date
    lui-même l'envoi, la lecture et les modifications (jamais l'horloge du téléphone) ;
  - le retour du téléphone passe d'un écran à l'autre (history) ; une annotation non
    enregistrée est protégée ; l'analyse s'enregistre au fil de la frappe.
- **Mes vidéos** (joueur) — deux rubriques : **Vidéos** (sources) et **Mes séquences**
  (filtres Toutes · Brouillons · Envoyées), une carte avec miniature par contenu.
- **Espace joueur** — même coque sur chaque page (`player-nav.js`) : en-tête avec le logo et,
  sur téléphone, onglets en bas (Performance · Programme · Vidéos), masqués seulement pendant
  une sélection ou une annotation ; garde `requirePlayer()`.
- **Points** (objectifs, points forts, axes) — `notes.js` : un clic ouvre le point en grand
  (images, légendes, consignes) ; « Modifier » ajoute, légende ou retire des images.
- **Mon club** (admin) — identité (logo cliquable, couleur en pastilles), équipes, accès par
  e-mail, membres.
- **Design system** — `main.css` : échelle typographique unique (`--fs-xs` à `--fs-2xl`,
  toutes les tailles de l'app en font partie), espacements, rayons, profondeur, durées
  d'animation ; icônes Lucide en sprite SVG. Le projet reste sans build : pas de React ni
  de Tailwind, le « Liquid Glass » est en CSS natif, réservé à ce qui flotte au-dessus d'un
  terrain ou d'une vidéo. **Logo** : le même partout (`.brand-accent` + `.brand-pro`) —
  menu du staff, barre du haut sur téléphone (`nav.js`), espace joueur, connexion. Cibles
  tactiles de 44 px sur téléphone. Règles détaillées : `docs/audit-mobile-ux.md`.
- **Couleurs** — partout (club, paramètres, tableau tactique) des pastilles d'une palette
  commune, plus « autre couleur » (`enhanceColorInputs`, `app.js`).
- **Analytics** — graphiques Chart.js, export PDF.

---

## 🎨 Tableau tactique — prise en main

- **Outils** : sélection, joueur, adversaire, flèches (droite / courbée / pointillée),
  trait, formes (carré, rectangle, cercle, triangle), texte.
- **Zones** : choisir une forme puis **glisser** sur le terrain ; la sélectionner
  (outil ↖) puis **tirer un coin** pour la redimensionner.
- **Formations** : menu déroulant (4-3-3, 4-4-2…) place 11 joueurs.
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
  aussi. **Paramètres** règle la taille par défaut avec le même curseur.
- **Étapes** : « + Étape » crée l'étape suivante ; cliquer une pastille (1, 2, 3…)
  l'affiche, et chaque déplacement y est enregistré. « ▶ Lire » part de l'étape 1.
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

Bouton *Exporter PDF* (séance) → couverture, un procédé par page (schéma + fiche en
deux colonnes), page de présence. Généré côté client (jsPDF).

Fiche Performance → **Générer le PDF** : fichier téléchargé directement (html2pdf.js,
chargé au premier export), sans fenêtre d'impression. Rubriques et période au choix.

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
node tests/nav.test.mjs           # menu : rôles, ordre, rubriques masquées, pages interdites
node tests/lines-ranks.test.mjs    # lignes de jeu déduites du poste, classement de chaque test
node tests/video-worker.test.mjs  # Worker vidéo : droits, liens signés, lecture partielle (Range)
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
3. **Workers → footsession-pro → Settings → Variables and Secrets** → secret
   `VIDEO_URL_SECRET` = une longue chaîne aléatoire (signe les liens de lecture ; la
   changer invalide seulement les liens en cours). Jamais dans le code.

Les nouvelles vidéos (chemin `r2/{club_id}/{player_id}/…`, 95 Mo au plus) vont sur R2 ;
les anciennes restent lisibles dans le bucket Supabase `player-videos`. Tout passe par
`videoUrls` / `uploadVideoFile` / `removeVideoFile` (`web/assets/js/supabase-client.js`).
Droits : lire = pouvoir lire la ligne `player_videos` (RLS) ; envoyer ou supprimer =
`can_manage_videos()` et le club du chemin est le sien.

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
