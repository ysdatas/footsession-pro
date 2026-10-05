# LMFC Performance — Voice of Customer et QA de la plateforme (v3)

Octobre 2026. Ce document part du prompt « refonte et correction globale » (27 points)
et des captures de la version en ligne du 4 octobre. Il complète
`docs/audit-mobile-ux.md` (vidéo, séquences), qui reste valable.

Chaque modification a été jugée sur quatre critères : **fonctionnalité, UX, design,
téléphone**. « Ça marche » ne suffisait pas.

---

## 1. Ce qui donnait une impression d'assemblage

| Constat | Correction |
|---|---|
| L'accueil avait une vraie signature (« Bonjour Yanis »), les autres pages un simple titre gris. | L'en-tête de l'accueil devient celui de **toutes** les pages : `.page-head` (staff), `.pv-head` (joueur), `.hero-surface` (fiche joueur, Performance). |
| Le liseré du club était rouge à 62 %, or à 38 %. | `--stripe` : rouge et or **à parts égales**, fondus au centre. Halos rouge à gauche, or à droite, d'intensité perçue égale (`--hero-bg`). |
| Avatars violets, bleus, verts, roses ; lignes de jeu bleues, vertes, orange. | Uniquement les couleurs du club (or, rouge, graphite). |
| La page Performance individuelle sortait de la plateforme (pas de menu). | Barre latérale visible, staff comme joueur ; même en-tête que le reste. |
| L'espace joueur avait sa propre barre du haut, différente du staff. | Même barre latérale que le staff, même bloc « moi » en bas ; onglets en bas sur téléphone en plus. |

---

## 2. Voice of Customer, par profil

### Coach

**« Où suis-je ? Quelle équipe ? »**
- **Problème :** l'équipe de travail n'apparaissait que dans le sélecteur du menu.
- **Solution :** chaque page affiche « Le Mans FC · N2 » (ou « Toutes les équipes ») au-dessus du titre.

**« Les informations du joueur prennent toute une colonne »** (retour du 4 octobre)
- **Problème :** la carte « Informations » occupait une colonne entière sous l'en-tête, et une carte « Présence » s'y ajoutait.
- **Solution :** l'essentiel est affiché **à côté du nom** : « 1,80 m | 73,8 kg | MC ». Équipe, ligne, âge, pied et statut suivent sur une ligne discrète, et les traits ne s'affichent qu'entre deux valeurs. « Modifier » ouvre la fiche en fenêtre. Les présences sont retirées de la rubrique Joueurs.

**« Je cherche un joueur, je vois des cartes »**
- **Problème :** une carte par joueur, avec les informations sous le nom. Peu de joueurs par écran, rien de comparable d'un coup d'œil.
- **Solution :** une ligne par joueur. Le nom est à gauche ; **taille — poids — poste** sont à droite, séparés par de fins traits (dernière mesure connue, rien d'inventé). On peut rechercher par nom et filtrer par poste. Pas de présence dans la liste, pas de « Poste non renseigné ».

**« Je veux supprimer un objectif sans ouvrir Performance »**
- **Solution :** la fiche joueur a une carte « Objectifs & préventions » où l'on peut tout faire sur place :
  - changer le statut ;
  - modifier ;
  - supprimer (✕, avec une confirmation qui nomme l'élément).

**« L'image d'un objectif s'ajoute ailleurs »**
- **Problème :** la fenêtre « Ajouter un objectif » renvoyait vers la fiche pour les images.
- **Solution :** on importe les images (PNG, JPG) directement dans la fenêtre.
  - Elles s'affichent tout de suite et peuvent avoir une légende.
  - Elles sont réduites à 1600 px.
  - Chaque joueur coché reçoit sa propre copie, lisible par lui seul et par le staff.

**« J'ouvre une fenêtre longue, le titre et les boutons disparaissent »**
- **Problème :** les fenêtres étaient centrées verticalement, sans défilement. Une fenêtre plus haute que l'écran sortait par le haut et par le bas.
- **Solution :** la fenêtre défile dans son voile et la page derrière ne bouge plus. Correction globale, valable pour toutes les fenêtres.

**« Le tableau tactique zoome quand je redimensionne »**
- **Problème :**
  - sur Mac, le pincement du pavé tactile zoomait toute la page ;
  - sur téléphone, le double-tap ou le focus d'un champ de moins de 16 px zoomait aussi.
- **Solution :**
  - pincer (deux doigts, ou le pavé tactile) agrandit l'**élément sélectionné**, jamais la page, et un seul « annuler » suffit par geste ;
  - les champs passent à 16 px sur écran tactile, et le double-tap ne zoome plus ;
  - le terrain capte tous les gestes.

**« Un nom à côté du pion, à l'endroit que je veux »**
- **Solution :** « Texte » en plus du N°, avec 9 places au choix (grille ↖ ↑ ↗ ← ● → ↙ ↓ ↘). Le texte est posé sur une pastille sombre, lisible sur l'herbe comme sur une photo. Il suit le pion quand il bouge ou grandit, et il est exporté avec le schéma.

### Préparateur physique

**« Je n'existe pas dans la plateforme »**
- **Problème :** depuis `platform_v2.sql`, le préparateur était un « coach » :
  - il voyait les séances et les vidéos ;
  - le coach, lui, pouvait modifier les données physiques.
- **Solution :** un vrai rôle **Préparateur physique** (`lmfc_v4.sql`).
  - Il peut : données physiques, tests, import Excel, photos des joueurs, objectifs et préventions.
  - Il n'a pas : vidéos, séances, tableau tactique.
  - Le coach consulte la Performance mais n'en modifie plus les données, et la base le refuse aussi.

**« L'import Excel est-il fiable ? »**
- **Avant :** il y avait déjà un aperçu avant validation, une correspondance fiche ↔ nom dans l'Excel, l'exclusion des homonymes et aucune valeur inventée.
- **Ajouté :**
  - la **source** est bien visible : fichier, taille, date, onglets reconnus (✓), saison et mode visés ;
  - « **Voir** » sur chaque joueur montre les valeurs lues (mesures par mois, tests par session) avant d'importer ;
  - **garde-fou** : « Alex ARNOUX » n'est plus associé en silence à « ARNOUX Nathan ». Un prénom différent est décoché et marqué « à confirmer ».

**« Qu'est-ce qui m'attend ce mois-ci ? »**
- **Solution :** l'accueil affiche « X joueurs sans mesure en octobre » (admin, prépa) et un accès direct « Données physiques ».

**« Comment sont calculées les données ? »**
- **Solution :** une entrée de FAQ sous ce titre, dans un groupe « Données et calculs » marqué *Staff*. Elle reprend la notice du classeur : saisie, 5 qualités, note /10, asymétrie, masse grasse, ratio. Aucune formule n'est ajoutée. La FAQ n'est pas accessible aux joueurs.

### Joueur

**« J'arrive sur une page technique »**
- **Problème :** le joueur atterrissait sur sa page Performance (radar, tableaux).
- **Solution :** un **accueil « Bonjour, Prénom »** (`mon-espace.html`) avec la même signature que le staff. Il y trouve :
  - les vidéos reçues (« nouvelle cette semaine ») ;
  - les retours du staff, avec un extrait ;
  - les objectifs et préventions en cours ;
  - les exercices à faire ;
  - ses derniers chiffres (poids, masse grasse, taille, dernière session de tests).

**« Mes objectifs sont introuvables »**
- **Problème :** ils étaient en bas de la page Performance, sous le radar et les tableaux.
- **Solution :** une rubrique **Objectifs & préventions** dans la navigation.
  - On y voit le statut (En cours, Atteint, Non atteint) et les images, en lecture seule.
  - Le programme terrain suit.

**« Navigation qui change d'une page à l'autre »**
- **Solution :** une seule coque : Accueil → Performance → Vidéos → Objectifs, avec la barre latérale sur ordinateur et les onglets en bas sur téléphone.

### Administrateur

**« Mes réglages sont loin »**
- **Solution :** « Paramètres » n'est plus une rubrique du menu. Un clic sur son nom, en bas du menu, propose ce seul lien (retour du 4 octobre : rien d'autre, tout est déjà dans Paramètres).
- La déconnexion reste l'icône à côté du nom.
- La fonction s'écrit en casse normale (« Administrateur ») pour tenir sans couper le mot.

**« Donner le bon rôle »**
- **Solution :** « Préparateur physique » est proposé dans « Donner un accès » et dans la liste des membres.

### Landing (première impression)

- **Problème :** une première version mettait « LE MANS FC » en très grand avec des mots-slogans (FOOTBALL · PERFORMANCE · ANALYSE). Retour du 4 octobre : trop marketing, trop « fait par une IA » pour un outil interne au club.
- **Solution :** une page sobre.
  - Le blason, « LMFC Performance » et « Le Mans FC » en petit, puis la connexion.
  - Le fond aux halos rouge et or est conservé, sans slogan, sans phrase d'accroche.
  - Le clavier ne s'ouvre pas tout seul sur téléphone (pas d'`autofocus`).

---

## 3. QA mobile — méthode et résultats

**Méthode.** Les tests ont tourné sur un serveur local avec de **fausses données** : 7 joueurs, dont un nom très long (« Jean-Baptiste-Alexandre DE LA FONTAINE-MONTGOMERY »), un poste long, des données manquantes, et une option à 40 joueurs.
- **Débordement :** un script mesure, page par page, tout élément visible qui dépasse de l'écran hors conteneur défilant.
- **Cibles tactiles :** il relève aussi celles de moins de 30 px.
- **Rôles :** chaque page est ouverte avec chaque rôle, et les erreurs de console sont relevées.

**Tailles testées :**
- 320 × 640 (petit téléphone) ;
- 375 × 812 (téléphone standard) ;
- 812 × 375 (paysage) ;
- 768 × 1024 (tablette) ;
- 1366 × 860 (ordinateur).

**Pages testées :**
- **Staff :** accueil, séances, édition de séance, joueurs, fiche joueur, Performance (4 onglets), fiche Performance, vidéos, bilan, FAQ, Mon club, paramètres, tableau tactique.
- **Joueur :** accueil, Performance, vidéos, lecture vidéo, objectifs.
- **Connexion.**

**Corrigé pendant la QA :**

| Défaut trouvé | Où | Correction |
|---|---|---|
| Graphiques plus larges que l'écran à 320 px | Bilan | grilles en `minmax(0, 1fr)`, cartes `min-width: 0` |
| Cartes poussées hors écran par un champ (largeur intrinsèque) | Mon club | `min-width: 0` sur cartes et champs, lignes d'équipe qui passent à la ligne |
| En-tête de page avec ~200 px de vide sur téléphone | toutes les pages staff | bloc titre sans hauteur imposée en colonne |
| Fenêtre plus haute que l'écran : titre et boutons hors écran | toutes les fenêtres | défilement dans le voile, page bloquée derrière |
| Menu mobile impossible à fermer en touchant à côté | toutes les pages | voile créé automatiquement, Échap ferme |
| Bouton ☰ posé sur le blason quand le menu est ouvert | toutes les pages | menu décalé sous le bouton |
| Astuce « glissez un joueur » affichée au doigt (le glisser ne marche qu'à la souris) | Joueurs | astuce et glisser réservés à la souris |
| Nom long réduit à « J… » par un poste long | Joueurs | poste tronqué en premier, le nom garde sa place |
| Onglets de Performance sur 3 lignes | Performance | une ligne qui défile au doigt |
| Barre de l'élément sélectionné sur 2 lignes / hors écran | Tableau tactique | une ligne, défilement horizontal au doigt sur téléphone |
| Texte d'un pion en diagonale masqué par une poignée | Tableau tactique | écart plus grand en diagonale |
| Cibles de 24 à 30 px (petits boutons, pastilles, cases) | partout | 40 à 44 px sur écran tactile |
| Barre d'actions staff vide en haut de la Performance du joueur | Performance (joueur) | masquée pour le joueur |

**Résultat final :**
- aucun débordement horizontal, quel que soit l'écran testé ;
- aucune erreur JavaScript, quel que soit le rôle ;
- les pages interdites renvoient au bon accueil : le préparateur est renvoyé des Séances, des Vidéos et du Tableau, le joueur de toutes les pages staff.

---

## 4. Limites connues et suites possibles

- **« Informations importantes » sur la fiche joueur :**
  - Un champ libre « à savoir » (blessure, consigne) demanderait une table à part. La raison : une colonne sur `players` serait lisible par le joueur, puisque la RLS filtre des lignes, pas des colonnes.
  - Ce champ n'a pas été ajouté sans cette table.
- **Tests sur appareil réel :**
  - Les gestes (pincer, double-tap, clavier) ont été vérifiés en émulation et par événements simulés.
  - Un essai sur un vrai iPhone reste à faire après déploiement.
- **Export PDF de l'effectif :**
  - Le PDF de la fiche Performance est généré directement, sans boîte d'impression.
  - Un export PDF du tableau de l'effectif (onglet Tests) n'existe pas encore.
- **Anciennes préventions :**
  - Celles visibles par le joueur sont reprises par `lmfc_v4.sql`.
  - Celles marquées « staff uniquement » restent dans `player_programs`, non affichées.

---

## 5. Passe du 4 octobre (29 points) — constats et corrections

### Vidéos : diagnostic avant correction

Symptômes en ligne : « Vidéo introuvable dans le stockage » (staff), « Impossible de charger la
vidéo (Erreur du serveur vidéo.) » (joueur), alors que l'envoi aboutissait.

| Vérification | Résultat |
|---|---|
| Lien de lecture expiré envoyé au Worker en ligne | 403 « expiré ou invalide » : routage, Worker et contrôle d'échéance fonctionnent |
| Même lien, échéance future | **500** : le Worker plante au moment de vérifier la signature |
| Code de la signature (`hmacKey`) | lève une erreur quand `VIDEO_URL_SECRET` est absent ou vide |
| Envoi (PUT) | n'utilise pas le secret : c'est pour ça qu'il marchait |
| Supabase (RLS `player_videos`, ligne créée) | correct : la vidéo « FFFF » est bien listée |

**Cause :** configuration Cloudflare. Le secret `VIDEO_URL_SECRET` manque sur le Worker en ligne.
Ce n'est ni le code, ni Supabase, ni R2, ni un push manquant. Cause probable : une variable
ajoutée en type « Text » dans le tableau de bord, que chaque `wrangler deploy` remplace par les
`vars` du fichier.

**Corrections dans le code :**
- le Worker répond 503 avec la marche à suivre au lieu d'une « erreur du serveur » ;
- les pages affichent la vraie cause au lieu de « introuvable » ;
- `keep_vars` est ajouté dans `wrangler.jsonc`.

**Reste à faire par l'administrateur :** ajouter le secret, en type **Secret**.

### Coach

| Retour | Correction |
|---|---|
| « Je vais voir la FAQ, je reviens sur Performance : je repars de zéro. » | Mémoire de navigation : même joueur, même onglet, mêmes filtres, même hauteur ; « ← Joueurs » retrouve la liste filtrée. |
| « J'ai supprimé une séance par erreur. » | Corbeille : la séance revient avec ses exercices, schémas, présences et commentaires. |
| « Cocher 30 séquences une par une. » | « Tout sélectionner », « Sélection du joueur », « Tout désélectionner » ; téléchargement des vidéos d'origine depuis la compilation. |
| « Le PDF fait document généré : bandeaux noirs, trait doré sous le logo, mention en bas à gauche. » | Nouvelle composition commune (voir ci-dessous). |

### Préparateur physique

| Retour | Correction |
|---|---|
| « Dans l'import Excel, tout cocher m'oblige à refaire un par un ce qui est à confirmer. » | « Tout sélectionner » coche les joueurs reconnus, jamais un rapprochement à confirmer (homonyme, prénom différent). |
| « La fiche PDF commence en bas de la page 1 et perd les objectifs. » | Le PDF ne dépend plus de la position dans la page ; aucune rubrique n'est perdue (vérifié avec 16 clubs et 12 objectifs aux textes longs). |
| « Les préventions ne sont pas dans le PDF. » | Rubrique « Préventions » ajoutée à l'export. |

### Joueur

- Accueil, Performance, Vidéos et Objectifs ont le même menu et le même en-tête (« Bonjour, Prénom »).
- La couleur du club s'applique aussi à son espace.
- Il ne voit pas la corbeille : la base la lui refuse.

### Administrateur

| Retour | Correction |
|---|---|
| « Je choisis une couleur, rien ne change. » | La couleur s'applique aussitôt à toute l'interface et aux PDF. Elle est enregistrée dans `clubs.color`, relue à chaque page et à chaque connexion, sans rien à valider. La chaîne complète a été vérifiée, y compris avec le cache du navigateur vidé. |
| « Paramètres encombre le menu. » | Un clic sur le nom en bas du menu propose seulement « Paramètres ». |

### Landing

- Retirés : le nom du club en très grand, le slogan marketing, « Football / Analyse / Performance ».
- Gardés : les halos rouge et or, le rond central du terrain et la ligne médiane fine derrière le blason, les filets autour de « LMFC Performance ».
- La devise « Tous acteurs pour réussir » apparaît en petites capitales discrètes sous la connexion.

### Exports PDF : audit et nouvelle composition

Les 5 exports ont été générés avec peu de données, beaucoup de données, des textes longs, un nom très long et des images, puis relus page par page.

| Défaut trouvé | Où | Correction |
|---|---|---|
| Page 1 presque vide : le contenu est décalé de la hauteur défilée | Fiche Performance | Génération en texte vectoriel, indépendante de l'écran |
| Rubriques de fin perdues (objectifs, mi-saison) | Fiche Performance | Pagination maîtrisée ; un bloc ne se coupe pas |
| Texte coupé à droite, en-têtes de tableau décalés | Fiche Performance | Tableaux aux colonnes calculées, chiffres alignés à droite |
| Texte d'exercice tronqué en silence | Séance | La suite passe sur une page de suite |
| Titre long coupé (« …MONTG ») | Toutes | La taille du titre baisse, le texte reste entier |
| Images non JPEG/PNG absentes (WebP, SVG) | Fiche Performance | Toute image est redessinée en JPEG ou PNG |
| Signe « − » illisible dans les polices PDF | Toutes | Caractères hors police remplacés |
| Bilan de 9,6 Mo, capture de l'écran sombre | Bilan | Graphiques redessinés pour le papier, en JPEG : 99 Ko ; graphiques vides signalés au lieu d'être imprimés |

**Composition (`pdf-kit.js`) :**
- en-tête sur panneau clair : blason, rubrique du club, titre, faits clés à droite ;
- rubriques numérotées ;
- tableaux légers dont l'en-tête se répète sur la page suivante ;
- chiffres clés et radar vectoriel ;
- numéro de page seul en pied de page.

**Supprimés :** le filet sous le logo, les bandeaux noirs, la mention technique en bas à gauche.

### QA mobile de cette passe

- **Pages testées :** 22 pages, avec les rôles admin, coach, préparateur et joueur.
- **Tailles :** 320 × 640, 375 × 812, 812 × 375, 768 × 1024, 1366 × 800, avec 47 joueurs.
- **Débordement horizontal :** aucun, sur toutes les pages et à toutes les tailles.
- **Petites cibles :** celles relevées à la souris font 30 px ; sur écran tactile, elles passent à 40-44 px (`pointer: coarse`).
- **Sélection multiple sur petit téléphone :** les deux boutons tiennent côte à côte.
- **Tableau tactique au doigt, sur 375 px :**
  - sélectionner un pion ;
  - lui mettre le maillot du club ;
  - écrire un nom ;
  - le placer en haut à droite.

  Aucun défilement horizontal. Le pincement agit sur l'élément, pas sur la page. Le double appui ne zoome pas.

### Limites de cette passe

- **La corbeille ne se vide pas toute seule.** Les vidéos et les images restent dans le stockage jusqu'à la suppression définitive.
- **La restauration d'une séquence en reprend le contenu.** La date « modifiée le » est recalculée par la base.
- **La compilation se fabrique dans le navigateur.** Il faut garder l'onglet ouvert, pendant une durée égale à celle des séquences.
- **Les gestes ont été vérifiés en émulation.** Un essai sur un vrai iPhone reste conseillé après le déploiement.

---

## 6. Passe du 5 octobre — largeur, suppression d'un joueur, sélection multiple

| Retour | Constat | Correction |
|---|---|---|
| « Les pages n'ont pas la même largeur. » | Cinq largeurs maximales différentes : accueil 1120 px, FAQ 980, fiche 1240, Performance 1340, espace joueur 960 et 1180 ; le reste à 1280. Espace joueur centré, staff aligné contre le menu. | Un seul gabarit (`--page-max`, `--page-pad-top`, `--page-pad-x`). Mesuré à 1440 et 1920 px : en-tête de 284 à 1394 px (à 1440) sur toutes les pages, staff comme joueur. À 375 px, mêmes marges de 12 px partout. Les réponses de la FAQ gardent une longueur de ligne lisible. |
| « Je ne peux pas supprimer un joueur. » | La base l'autorise déjà à l'administrateur seul, mais aucun bouton n'existait. Une suppression efface en cascade une quinzaine de tables. | Bouton sur la fiche (« Modifier » → « Supprimer le joueur ») et suppression groupée dans *Joueurs*, après confirmation listant les noms. Le joueur part dans la corbeille avec toute sa fiche et revient complet. Vérifié sur Postgres : vidéo, séquences annotées, vues, mesures, tests, objectifs, programme, parcours, accès en attente. La suppression est refusée tant que la corbeille n'est pas active. |
| « Je veux agir sur plusieurs vidéos ou préventions d'un coup. » | La sélection n'existait que pour la compilation. | Mode sélection commun : cases, compteur, Tout sélectionner (sur ce qui est affiché) et Tout désélectionner. Actions groupées : vidéos (supprimer, télécharger les originaux), séquences (compiler, supprimer), objectifs et préventions (statut, supprimer), joueurs (supprimer). |
