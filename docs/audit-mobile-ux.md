# FootSession Pro — Audit mobile-first (v2) : vidéo source, séquences, staff

Octobre 2026. Ce document part des 5 captures iPhone envoyées le 1er octobre et du
« prompt final ». Il remplace la v1 (voir l'historique Git).

Règle de priorité appliquée partout :
- compréhension > esthétique ;
- mobile > ordinateur ;
- action directe > navigation ;
- lisibilité > quantité d'information ;
- robustesse > effet visuel.

---

## 1. Voice of Customer

**1. « Créer une séquence ne doit pas donner l'impression de modifier la vidéo »**
- **Besoin réel :** savoir ce qu'on manipule.
- **Problème UX (v1) :** la séquence était une zone dorée posée sur la timeline de la source. On restait dans le même lecteur.
- **Impact :** « Est-ce que je modifie l'original ? »
- **Solution :** deux écrans distincts. La **vidéo source** (chip « Vidéo source · jamais modifiée ») et la **séquence**, qui s'ouvre comme une nouvelle vidéo : titre, durée, timeline de 0 à sa fin, bannière « Séquence créée ».

**2. « Une séquence = une nouvelle vidéo indépendante »**
- **Besoin réel :** retrouver, nommer et envoyer chaque extrait.
- **Problème UX (v1) :** des noms génériques et pas de miniature.
- **Impact :** les cartes se ressemblent (« XX », « DDDD »).
- **Solution :** chaque séquence a son identifiant, son titre (« Séquence N », renommable d'un toucher), sa durée, sa miniature (l'image de son début), son habillage, son statut, sa date et son envoi.

**3. « La timeline jaune prend trop de place »**
- **Besoin réel :** voir la vidéo, pas un outil.
- **Problème UX (v1) :** la plage dorée et les poignées étaient affichées en permanence.
- **Impact :** c'était ambigu et lourd.
- **Solution :**
  - le doré n'existe qu'en **mode sélection** ;
  - partout ailleurs, la barre est fine ;
  - dans une séquence, elle va de 0:00 à la durée de la séquence.

**4. « Un bouton Sélectionner »**
- **Besoin réel :** une entrée claire dans le découpage.
- **Problème UX (v1) :** couper dépendait de gestes sur la timeline.
- **Impact :** il y avait des conflits de gestes.
- **Solution :**
  - « Sélectionner une portion » ouvre le mode sélection (cadre doré, « Sélection en cours 0:08 → 0:17 · 9 s ») ;
  - on y trouve « Annuler » et « Créer la séquence » ;
  - ▶ relit la sélection, la loupe ouvre l'image par image.

**5. « Pas de gestes ambigus »**
- **Besoin réel :** chaque geste fait une seule chose.
- **Problème UX (v1) :** toucher la timeline pouvait déplacer la tête de lecture ou la séquence.
- **Impact :** les erreurs donnaient l'impression de bugs.
- **Solution :**
  - les poignées n'existent qu'en sélection ;
  - tirer une poignée règle la sélection ;
  - partout ailleurs, la barre déplace la lecture, dans tous les modes ;
  - le milieu de la sélection ne déplace rien.

**6. « Habillage simple par défaut »**
- **Besoin réel :** ne voir que l'utile.
- **Problème UX (v1) :** toutes les options restaient visibles et aucun élément n'était éditable.
- **Impact :** c'était chargé, et une erreur obligeait à tout refaire.
- **Solution :**
  - les couleurs n'apparaissent que pour l'outil choisi ;
  - l'outil « Choisir » sélectionne un élément posé et ne montre que **ses** réglages (couleur, texte, supprimer) ;
  - on peut le déplacer au doigt.

**7. « Envoyer, puis savoir que c'est parti »**
- **Besoin réel :** être rassuré.
- **Problème UX (v1) :** la feuille se fermait après l'envoi.
- **Impact :** le joueur ne savait pas si l'envoi avait marché.
- **Solution :**
  - la feuille montre le contenu (miniature, titre, durée), le destinataire et un message facultatif ;
  - après l'envoi, une confirmation indique destinataire, date et statut « Envoyé ».

**8. « Pas de doublons »**
- **Besoin réel :** une carte = un contenu.
- **Problème UX (v1) :**
  - « Couper ici » créait des « (suite) » ;
  - un double toucher pouvait créer deux séquences ;
  - les noms se répétaient.
- **Impact :** confusion.
- **Solution :**
  - « Couper ici » est retiré : on crée une autre séquence depuis la source ;
  - une seule opération à la fois (verrou) ;
  - numérotation qui ne réutilise jamais un numéro (`nextSeqLabel`).

**9. « Coach : trop d'informations d'un coup »**
- **Besoin réel :** voir ce qui demande une action.
- **Problème UX (v1) :** un accordéon par joueur avec 3 sections, des compteurs et toutes les vidéos.
- **Impact :** un écran dense, des dashboards compressés.
- **Solution :** navigation progressive : **À voir** + **Joueurs** (une ligne chacun) → un joueur → rubriques **À voir · Séquences · Vidéos** → un contenu.

**10. « Badges simples »**
- **Besoin réel :** comprendre en une seconde.
- **Problème UX (v1) :** six statuts, dont « Prêt ».
- **Impact :** trop de nuances.
- **Solution :** un badge, jamais cumulé :
  - Brouillon ;
  - Envoyé (« À voir » côté staff) ;
  - Vu ;
  - Retour ;
  - Modifié (rare : changée depuis l'envoi).

**11. « Cartes trop étroites »**
- **Besoin réel :** lire sur téléphone.
- **Problème UX (v1) :** sur la page Performance, deux colonnes forcées : le texte se cassait lettre par lettre (« A x e p r i o… »).
- **Impact :** illisible.
- **Solution :** une colonne sous 900 px. Le tableau des tests est compact (l'unité est collée à la valeur). L'explication des moyennes est repliée derrière « Voir le détail ».

**12. « Header et navigation cohérents »**
- **Besoin réel :** le même produit partout.
- **Problème UX :** les onglets du bas étaient parfois là, parfois non, sans règle.
- **Impact :** la page semblait instable.
- **Solution :**
  - règle unique : onglets du bas sur toutes les pages joueur au téléphone, masqués **seulement** pendant une sélection ou une annotation (modes de concentration) ;
  - le logo est identique partout.

---

## 2. Audit UX mobile, écran par écran (captures du 1ᵉʳ octobre)

**Annotation (capture « XX »)**
- **Objectif :** habiller une image.
- **Frictions :**
  - un « faisceau » clair partait du coin de l'image ;
  - les éléments n'étaient pas modifiables.
- **Correction :**
  - le bug de tracé du projecteur est corrigé (chaque ellipse démarre son propre tracé) ;
  - outil « Choisir », réglages contextuels.

**Vidéo (capture « DDDD »)**
- **Objectif :** découper, annoter, envoyer.
- **Frictions :**
  - la plage dorée de 17 s était affichée en permanence ;
  - trois actions côte à côte ;
  - « Envoyer (1) » était ambigu ;
  - les séquences étaient coupées par les onglets.
- **Correction :**
  - écran source : une seule action, « Sélectionner une portion » ;
  - écran séquence : « Annoter » + « Envoyer au staff » ;
  - les séquences sont listées en cartes avec miniature.

**Performance, Suivi physique / Objectifs**
- **Objectif :** lire ses mesures et objectifs.
- **Frictions :** deux colonnes de 170 px, textes cassés, tableau tronqué (« POI »).
- **Correction :** une colonne sur téléphone ; règle CSS corrigée (elle annulait la version mobile).

**Performance, tests**
- **Objectif :** se situer.
- **Frictions :** colonnes serrées, long paragraphe d'explication.
- **Correction :** colonne « Unité » retirée sur téléphone (l'unité suit la valeur) ; explication repliée.

**Vidéos joueurs (staff)**
- **Objectif :** traiter le travail reçu.
- **Frictions :** un accordéon dense, « 2 vidéos · 1 sélectionnée · 2 annotées », mélange des types.
- **Correction :** « À voir » en tête, une ligne par joueur, rubriques séparées.

---

## 3. Audit UI

- **Un seul système de cartes** (`.vp-card`), le même pour le joueur et le staff :
  - miniature 16:9 à gauche, avec sa durée en badge ;
  - titre en premier, puis une ligne de méta ;
  - le badge de statut à droite.
- **Onglets** (`.vp-tabs`) et **filtres** (`.pv-chips`) : un seul style, 40 px de haut.
- **Typographie :**
  - titres d'écran en `--fs-2xl` ;
  - titres de carte en `--fs-md` 600 ;
  - méta en `--fs-sm` secondaire ;
  - labels de section en `--fs-xs` capitales ;
  - aucun nouveau corps de texte hors échelle.
- **Boutons :**
  - une action primaire dorée par écran (Sélectionner une portion / Créer la séquence / Envoyer au staff / Enregistrer) ;
  - secondaires en fond carte ;
  - hauteur 48 à 50 px sur téléphone.
- **Feuilles basses :** un seul composant pour les options (⋯), l'envoi et la confirmation.
- **Liquid Glass :** réservé au terrain tactique et à ce qui flotte au-dessus d'un contenu. Les cartes restent opaques.

---

## 4. Audit vidéo : lecture, sélection, découpage, séquences

**Modèle**
- **Vidéo source :** `player_videos` (fichier).
- **Séquence :** `video_sequences` (début, fin, titre, habillage, statut, dates).
- **Contenu envoyé :** la même séquence, `submitted_at`. Il n'y a jamais de copie, donc jamais de doublon après envoi.

Une séquence se lit comme une vidéo à part :
- lecture limitée à sa portion ;
- temps affichés de 0:00 à sa durée ;
- l'arrêt à la fin relance au début ;
- sa timeline ne montre que sa portion.

Pourquoi pas un nouveau fichier ? Ré-encoder une vidéo dans le navigateur d'un téléphone serait lent, consommerait la batterie et doublerait le stockage. Le résultat visible est le même : un contenu indépendant, ouvert dans son propre écran. Un export MP4 téléchargeable pourra s'ajouter si le besoin apparaît.

**Mode sélection**
- La portion part de l'image affichée et dure 6 s.
- Les poignées de 44 px s'ajustent au doigt.
- La timeline zoome seule sur une portion courte dans une longue vidéo.
- La précision (loupe) ajoute l'image par image, « Début ici » et « Fin ici ».
- On en sort par « Annuler », par le retour du téléphone, par Échap, ou par « Créer la séquence ».

**Séquence**
- Menu ⋯ : renommer, ajuster le début et la fin (même mode sélection, bouton « Enregistrer le découpage »), image par image, dupliquer, supprimer.
- ↶ / ↷ couvrent la création, le découpage, la duplication, la suppression et l'habillage.

---

## 5. Audit habillage

- **Outils :** Choisir, Flèche, Trajectoire, Repère joueur, Cercle, Zone, Projecteur, Texte (titre ou texte).
- **Contexte :** les couleurs de l'outil actif s'affichent, plus une consigne courte (« Touche les pieds du joueur »). Un élément sélectionné montre ses propres réglages.
- **Temps :** chaque annotation a un début (l'image affichée), une durée (2, 3 ou 5 s) et, au choix, un arrêt sur image. La liste « Habillage » affiche les plages relatives à la séquence (« 0:02 → 0:05 · Flèche, Projecteur · arrêt sur image »).
- **Sécurité :**
  - « Fermer » demande confirmation s'il reste des changements ;
  - le retour du téléphone pendant l'annotation aussi ;
  - fermer l'onglet affiche l'alerte du navigateur.

---

## 6. Audit terrain

Ce qui est déjà en place depuis la v1, et inchangé :
- couleurs de création mémorisées ;
- réglages qui s'effacent pendant le déplacement ;
- curseur de taille à la place de S/M/L ;
- barre en bas sur téléphone.

Nouveauté : au doigt, le curseur passe à 44 px de haut et sa poignée à 28 px.

---

## 7. Audit coach / admin

| Niveau | Contenu | Action |
|---|---|---|
| 1. Ensemble | **À voir** (séquences envoyées, sans retour) puis **Joueurs** : nom, « N vidéos · N séquences », « N à voir » ou date de dernière activité | toucher un joueur ou une séquence |
| 2. Joueur | En-tête « ← Tous les joueurs », nom, résumé | — |
| 3. Rubriques | **À voir** · **Séquences** · **Vidéos** (onglets) | toucher un contenu |
| 4. Contenu | Poste de travail en plein écran : séquence (habillage du joueur, analyse, retour) ou vidéo source | Envoyer mon retour |

La recherche filtre les joueurs, mais la navigation principale reste joueur → rubrique → contenu. Une séquence ouverte passe « Vu » pour le joueur. Le retour du téléphone remonte d'un niveau.

---

## 8. Audit navigation

```
Joueur : Mes vidéos ─┬─ Vidéos ──► Vidéo source ──Sélectionner──► Sélection ──Créer──► Séquence
                     └─ Mes séquences ───────────────────────────────────────────────► Séquence
         Séquence ──Annoter──► Habillage ──Enregistrer──► Séquence ──Envoyer──► Confirmation
Staff  : Vidéos joueurs ──► Joueur (À voir · Séquences · Vidéos) ──► Séquence / Vidéo source
```

- Chaque flèche correspond à une entrée d'historique : le retour du téléphone fait le chemin inverse.
- Une séquence a son adresse (`voir-video.html?id=…&seq=…`) et peut être partagée.

---

## 9. Audit bugs : trouvés, corrigés, protégés

**Corrigés**
- **Projecteur :** un triangle clair partait du coin. Chaque ellipse était reliée au tracé précédent ; elle démarre maintenant son propre tracé.
- **Suivi de visionnage arrêté depuis la v1 :** le lecteur avait perdu l'identifiant que `video-tracking.js` attend. Il est rétabli (`id="playerVideo"`).
- **Performance en deux colonnes sur téléphone :** une règle CSS placée en fin de fichier annulait la règle mobile. Elle est maintenant limitée aux écrans de 900 px et plus.

**Protections ajoutées**
- **Doublons :** une seule opération à la fois, donc un double toucher sur « Créer la séquence » n'en crée qu'une.
- **Gestes :** sans poignée hors sélection, il n'y a pas de conflit possible.
- **Changement d'écran :** la lecture s'arrête, l'arrêt sur image en cours est annulé, la feuille ouverte se ferme.
- **Données :**
  - l'analyse s'enregistre pendant la frappe (0,9 s), en quittant le champ et en quittant la page ;
  - l'indicateur montre « Enregistrement… », « Enregistré » ou « Non enregistré » ;
  - en cas d'erreur d'envoi, la feuille reste ouverte avec un message.
- **Suppression :** pas de confirmation (↶ annule), et l'option n'est proposée qu'à qui a le droit de supprimer.

**États explicites**
- **Inactif :** écran source ou séquence.
- **Sélectionné :** mode sélection ; élément choisi dans l'habillage.
- **Édition :** habillage ou découpage.
- **Enregistrement en cours / enregistré :** indicateur dans l'en-tête de la séquence.
- **Envoi en cours :** bouton « Envoi… » désactivé.
- **Envoyé :** écran de confirmation.
- **Erreur :** message sur place, rien n'est perdu.

---

## 10. Architecture cible

| Fichier | Rôle |
|---|---|
| `video-workspace.js` | Écrans source / séquence, lecture, sélection, montage, historique (↶ ↷ et retour du téléphone) |
| `video-timeline.js` | Timeline en trois modes : `view`, `select`, `clip` |
| `video-annotate.js` | Barre d'habillage, réglages contextuels, timing, protection |
| `video-ink.js` | Calque de dessin : formes, sélection, déplacement, historique propre |
| `video-send.js` | Feuille d'envoi et confirmation |
| `video-status.js` | Statuts, noms par défaut, miniatures (`#t=` + chargement à l'affichage) — testé |
| `videos-page.js` | Staff : ensemble → joueur → rubrique |
| `mes-videos.html` | Joueur : Vidéos / Mes séquences |

Pas de nouvelle migration : le modèle tient dans `video_sequences` (migrations 20 et 21).

---

## 11. Plan d'implémentation (réalisé)

| # | Priorité | Changement |
|---|---|---|
| 1 | C | Écrans source / séquence, « Sélectionner une portion », « Créer la séquence », séquence ouverte comme une nouvelle vidéo |
| 2 | C | Timeline à modes explicites, sans conflit de gestes |
| 3 | C | Habillage : outil Choisir, réglages contextuels, déplacement, protection des changements |
| 4 | C | Envoi : contenu, destinataire, message, confirmation |
| 5 | C | Bugs : projecteur, suivi de visionnage, deux colonnes sur la page Performance |
| 6 | I | Staff progressif (À voir · Joueurs → À voir · Séquences · Vidéos) |
| 7 | I | Mes vidéos : Vidéos / Mes séquences + filtres, miniatures |
| 8 | I | Statuts simplifiés, numérotation sans doublon |
| 9 | A | Tests : tableau compact, explication repliée ; curseur du terrain au doigt |

## Parcours testés

Tests faits à 375 × 812 sur des données simulées.

**Joueur**
- **Parcours :**
  - vidéo source → Sélectionner → poignée de fin tirée (0:08 → 0:19) → Créer la séquence ;
  - « Séquence 5 » s'ouvre (0:00 / 0:11) ;
  - le retour mène à la source, qui liste alors 5 séquences.
- **Habillage :**
  - Annoter → flèche + projecteur → Choisir → flèche recolorée en rouge et déplacée → Enregistrer ;
  - la liste indique « 0:02 → 0:05 · Flèche, Projecteur · arrêt sur image ».
- **Envoi :** aperçu (miniature, Staff — club, message) → Envoyer → confirmation (« Envoyée le 01/10 02:35 · Envoyé »).
- **Découpage :** ⋯ → Ajuster → image par image → « Début ici » 0:11 → Enregistrer. Statut « Modifié », bouton « Renvoyer au staff ».

**Staff**
- **Parcours :** Vidéos joueurs → carte « À voir » ou joueur → onglets → séquence en plein écran (statut « Vu ») → fermer. Le badge « Vu » reste ; le retour du téléphone ramène à la liste des joueurs.

## Limites connues

- Sur iPhone, le plein écran est celui du système : vidéo seule, sans habillage.
- Les miniatures viennent de la vidéo elle-même (`#t=`). Sur une connexion très lente, elles apparaissent après le texte de la carte.
- Le staff répond par écrit et ne dessine pas sur les séquences (à ajouter si le besoin est confirmé).
