# FootSession Pro ⚽

Gestion des séances d'entraînement et suivi individuel des joueurs, pour la cellule
vidéo / coaching d'un club. Design sobre noir / gris / doré, police Inter.

---

## 🏗 Architecture

| Couche | Technologie |
|---|---|
| Front-end | HTML + CSS + JS statiques dans `web/` — **aucun build, aucun npm** |
| Données / Auth / Storage | **Supabase**, appelé directement depuis le navigateur |
| Sécurité | **RLS Postgres** + buckets Storage privés + URLs signées |
| Déploiement | **Cloudflare** (`wrangler.jsonc` → `"assets": { "directory": "web" }`) |
| Dépôt | `git@github.com:ysdatas/footsession-pro.git`, branche `main` |

Il n'y a **pas de back-end applicatif**. L'ancienne version PHP + MySQL a été retirée
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
| `admin` | Tout le club, gestion des membres et des rôles (page **Mon club**) |
| `coach` | Séances, joueurs, vidéos, statistiques de visionnage |
| `analyste` | Idem coach (cellule vidéo) |
| `prepa` | Séances, joueurs, **édition** de la Performance et import Excel |
| `viewer` | Lecture seule |
| `joueur` | **Uniquement sa fiche** : ses vidéos, sa Performance en lecture seule, sa sélection de séquences. Aucun accès aux statistiques de visionnage |

Le rôle `joueur` ne s'attribue pas directement : il découle de l'association d'un compte
à une fiche joueur (`club_link_player` côté admin, ou `join_as_player` avec un
`player_code`). Un compte qui a déjà rejoint un club ne peut plus être lié à une fiche :
un joueur doit entrer par `player-join.html`, pas par `index.html`.

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
- **Joueurs** — vue grille + matrice de présence, fiches détaillées.
- **Performance** (`player-performance.html`) — dossier individuel : photo, mesures
  physiques, tests, radar /10, points forts / axes / objectifs, sélection vidéo.
- **Vidéos** (`videos.html`) — envoi d'une séquence à un joueur, statistiques staff.
- **Mes vidéos** / **Voir vidéo** — espace joueur.
- **Mon club** — identité, code d'invitation, rôles, liaison compte ↔ fiche joueur.
- **Analytics** — graphiques Chart.js, export PDF.

---

## 🎨 Tableau tactique — prise en main

- **Outils** : sélection, joueur, adversaire, flèches (droite / courbée / pointillée),
  trait, formes (carré, rectangle, cercle, triangle), texte.
- **Zones** : choisir une forme puis **glisser** sur le terrain ; la sélectionner
  (outil ↖) puis **tirer un coin** pour la redimensionner.
- **Formations** : menu déroulant (4-3-3, 4-4-2…) place 11 joueurs.
- **Étapes animées** : `+ Étape` enregistre les positions, `▶ Jouer` anime la séquence.
- **Raccourcis** : `Ctrl+Z` annuler, `Suppr` supprimer l'élément sélectionné.
- **Sauvegarde** : auto en LocalStorage (30 s) ; `💾 Sauver` enregistre le JSON en
  base ; **Valider ce schéma** enregistre l'image dans le procédé et revient à la séance.

> Pour lier un schéma à un procédé, **enregistrez d'abord la séance**.

---

## 📄 Export PDF

Bouton *Exporter PDF* (séance) → couverture, un procédé par page (schéma + fiche en
deux colonnes), page de présence. Généré côté client (jsPDF).

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
```

Le second tourne sur une extraction du classeur réel
(`tests/fixtures-tests-physiques.json`) et vérifie les valeurs exactes de plusieurs
joueurs, l'absence de fuite de données entre eux, et que les cellules vides le restent.

---

## ☁️ Déploiement

```bash
npx wrangler deploy
```

Seul `web/` est publié. Vérifier au préalable que les migrations Supabase
correspondantes sont passées : **du code déployé sans sa migration échoue en silence.**

---

## 🔒 Sécurité

- **RLS Postgres** sur toutes les tables ; les helpers `my_club_id()`, `can_edit()`,
  `is_staff()`, `is_performance_editor()`, `is_video_stats_staff()` sont en
  `SECURITY DEFINER` pour éviter la récursion de policies.
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
