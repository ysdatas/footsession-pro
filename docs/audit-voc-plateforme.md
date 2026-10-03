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
- **Solution :** un clic sur son nom, en bas du menu, ouvre :
  - son compte et son mot de passe ;
  - son menu ;
  - les préférences du tableau tactique ;
  - Mon club ;
  - l'aide ;
  - la déconnexion.
  Le menu se ferme avec Échap ou par un clic à côté, et se navigue aux flèches. L'icône de déconnexion isolée disparaît ; le nom et la fonction s'affichent en entier.

**« Donner le bon rôle »**
- **Solution :** « Préparateur physique » est proposé dans « Donner un accès » et dans la liste des membres.

### Landing (première impression)

- **Problème :** le blason et « LMFC Performance » étaient à gauche et la connexion à droite. La page restait asymétrique et ressemblait à un modèle générique.
- **Solution :** une composition centrée.
  - Le blason est posé sur le rond central et la ligne médiane d'un terrain, en filigrane.
  - « **LE MANS FC** » est affiché en très grand, avec « FC » en or.
  - En dessous : « LMFC Performance », puis FOOTBALL · PERFORMANCE · ANALYSE.
  - Les halos rouge et or sont symétriques, et la connexion vient dessous.
  - Le clavier ne s'ouvre plus tout seul sur téléphone (pas d'`autofocus`).

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
