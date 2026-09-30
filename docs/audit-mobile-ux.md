# FootSession Pro — Audit mobile-first, Voice of Customer, UX/UI

Octobre 2026. Ce document part des retours du propriétaire du produit (captures d'écran
et « prompt maître »). Il couvre l'espace joueur, la vidéo, le terrain tactique et
l'espace staff.

Il suit l'ordre utilisateur → objectif → geste → résultat, puis UX → UI → code. Le
téléphone est le support principal du joueur ; l'ordinateur en est une adaptation.

Règle de priorité appliquée partout :
- compréhension > esthétique ;
- terrain > panneaux ;
- action directe > navigation ;
- lisibilité > Liquid Glass ;
- rapidité > animation.

---

## A. Voice of Customer

**1. « Le terrain ne doit pas rétrécir »**
- **Besoin réel :** garder le schéma sous les yeux pendant qu'on règle.
- **Friction :** chaque panneau ouvert fait douter du cadrage.
- **Opportunité :** superposer au lieu de pousser.
- **Solution :** déjà en place : terrain plein cadre, tout flotte par-dessus. Maintenu. Sur téléphone, les panneaux deviennent une feuille basse au-dessus du terrain.

**2. « Les contrôles ne doivent pas rester autour du pion »**
- **Besoin réel :** déplacer vite, sans rien toucher par erreur.
- **Friction :** la barre couleurs + tailles + numéro reste affichée pendant le glisser.
- **Opportunité :** montrer au bon moment, cacher pendant l'action.
- **Solution :** la barre apparaît à la sélection, s'efface dès que l'élément bouge de plus de 4 px, les autres barres s'estompent (30 %), et tout revient au relâchement.

**3. « Choisir la couleur avant, et qu'elle reste »**
- **Besoin réel :** poser 11 rouges d'affilée.
- **Friction :** la couleur se réglait dans un panneau « Couleurs » séparé et se perdait d'une session à l'autre.
- **Opportunité :** la couleur est une propriété de création.
- **Solution :** toucher l'équipe active ouvre sa couleur. Une pastille au bout des outils règle celle des tracés. Tout pion suivant la reprend, et elle est mémorisée dans le compte. Le panneau « Couleurs » est supprimé.

**4. « Plus de S / M / L »**
- **Besoin réel :** voir la taille changer en glissant.
- **Friction :** il faut deviner ce que « M » représente.
- **Opportunité :** manipulation directe.
- **Solution :** un curseur ●━━● dans la barre de l'élément, avec aperçu immédiat. Un seul « annuler » par geste. La taille est conservée pour les pions suivants. Paramètres utilise le même curseur.

**5. « Découper doit être intuitif sur téléphone »**
- **Besoin réel :** isoler une action de 5 à 10 s.
- **Friction :** il fallait deux boutons (« Début », « Fin ») et viser précisément avec la barre native.
- **Opportunité :** une timeline tactile.
- **Solution :**
  - « Nouvelle séquence » crée la séquence autour de l'image affichée ;
  - deux poignées dorées de 44 px s'ajustent au doigt, avec aperçu de l'image et timecode ;
  - la durée reste visible.

**6. « Un mode précis pour les avancés »**
- **Besoin réel :** caler au dixième.
- **Friction :** la timeline d'un match (90 min) rend une séquence de 6 s invisible.
- **Opportunité :** d'abord simple, ensuite précis.
- **Solution :**
  - une loupe active l'image par image et le timecode au dixième ;
  - la timeline zoome d'elle-même quand la séquence fait moins de 8 % de la vidéo ;
  - ralenti 0,5× et 0,25×.

**7. « Un habillage beaucoup plus poussé »**
- **Besoin réel :** montrer un joueur, une course, une zone, un message.
- **Friction :** il n'y avait que 4 formes sur une image fixe (« Image à 0:03 »).
- **Opportunité :** un habillage temporel.
- **Solution :**
  - 7 outils : flèche, trajectoire, repère joueur + n°, cercle, zone, projecteur, titre et texte ;
  - chaque annotation a un instant, une durée (2 / 3 / 5 s) et, au choix, un arrêt sur image ;
  - elles se rejouent pendant la lecture.

**8. « Pause → action → reprise »**
- **Besoin réel :** annoter sans quitter la vidéo.
- **Friction :** le mot « Dessiner sur l'image affichée » était ambigu et l'outil caché dans le détail.
- **Opportunité :** un mode rapide.
- **Solution :**
  - le bouton « Annoter » est sous la vidéo ; il met en pause et dessine directement dessus ;
  - « Enregistrer » ramène à la lecture ;
  - sans séquence choisie, une séquence est créée automatiquement.

**9. « Envoyer au staff, sans détour »**
- **Besoin réel :** savoir ce qui part, à qui, avec quoi.
- **Friction :** l'envoi partait sans aperçu, une séquence à la fois.
- **Opportunité :** une confirmation claire.
- **Solution :**
  - une feuille « Envoyer au staff » montre les séquences cochées, leur durée, leurs annotations, l'analyse et le destinataire ;
  - on peut en envoyer plusieurs d'un coup ;
  - le bouton final est libellé « Envoyer au staff ».

**10. « Des statuts simples »**
- **Besoin réel :** savoir où en est chaque séquence.
- **Friction :** quatre étiquettes cumulables (À travailler, Annotée, Envoyée, Retour).
- **Opportunité :** un statut unique.
- **Solution :** Brouillon → Prêt → Envoyé → Vu → Retour, plus Modifié (changée depuis l'envoi). Le même pour le joueur et le staff, avec une pastille de couleur partout.

**11. « Logo absent côté joueur »**
- **Besoin réel :** sentir que c'est le même produit.
- **Friction :** trois en-têtes différents, et aucun logo sur Mes vidéos et Mon programme.
- **Opportunité :** une coque commune.
- **Solution :** un même en-tête (logo, rubriques, déconnexion) sur toutes les pages joueur, et des onglets en bas sur téléphone. Le logo est identique partout.

**12. « Composant Liquid Glass React »**
- **Besoin réel :** une profondeur premium sur ce qui flotte.
- **Friction :** le projet n'a ni React, ni build, ni Tailwind.
- **Opportunité :** réutiliser l'existant.
- **Solution :** `.glass` et `.glass-btn` existent en CSS natif (voir K). On ne recrée pas un équivalent React.

---

## B. Audit UX mobile — frictions

Priorité : C = critique, I = important, A = amélioration.

**Critique**
- **La page vidéo débordait en largeur sur téléphone.** La ligne de commandes imposait sa largeur à la grille. Corrigé : colonnes `minmax(0, 1fr)`, et la durée totale est masquée sous 420 px (elle reste au bout de la timeline).
- **La page Performance débordait de 90 px sur téléphone (radar).** Corrigé : grilles `minmax(0, 1fr)`.
- **La timeline native était trop fine au doigt et il n'y avait aucune poignée.** Timeline de 56 px, poignées de 44 px.
- **La barre de sélection du terrain faisait 2 lignes sur téléphone et couvrait les barres latérales.** Sur téléphone, elle est posée en bas, au pouce, sur une seule ligne. Elle passe en haut si l'élément est tout en bas.
- **Il était impossible de saisir un pion au doigt** : cible de 9 px, poignées qui volaient le geste. La prise est élargie (≈ 14 px d'écran). Au doigt, saisir le corps déplace, et la taille passe par le curseur.
- **Aucun aperçu avant envoi.** Ajout de la feuille « Envoyer au staff ».

**Important**
- **Les séquences s'empilaient en liste longue sous la vidéo.** Elles forment maintenant un bandeau horizontal au pouce ; « Vidéo entière » est en premier.
- **La barre d'annotation était trop haute et « Enregistrer » passait sous les onglets.** Nouvelle organisation en 5 rangées ; les onglets du bas sont masqués pendant l'annotation.
- **Pas de ralenti ni d'image par image.** Ajout de 1× / 0,5× / 0,25× et d'un mode précision.
- **« Annuler » voulait dire à la fois défaire et quitter.** ↶ défait. « Fermer » quitte l'annotation sans enregistrer.

**Amélioration**
- **Texte saisi par une boîte de dialogue système.** Il est maintenant saisi dans un champ posé à l'endroit touché.

---

## C. Audit UI — cohérence

- **Typographie :** une seule échelle (`--fs-xs` .72 → `--fs-2xl` 1.7rem), déjà appliquée aux 321 tailles de l'app. Tous les nouveaux composants s'y tiennent. Les timecodes sont en chiffres tabulaires.
- **Boutons :**
  - primaire doré : action principale d'un écran (une seule par zone) ;
  - secondaire : fond carte ;
  - icône : 44 px sur téléphone ;
  - flottant : `.glass-btn`, sur terrain et vidéo uniquement.
- **Pastilles de statut :** un seul composant (`.vw-status`) pour le joueur, le staff et Mes vidéos.
- **Couleurs :**
  - palette commune (`COLOR_PALETTE`) ;
  - sur le terrain, une pastille ouvre la palette et elle n'est jamais affichée en permanence.
- **Rayons et profondeur :** `--radius-control` 10 px, `--radius-float` 16 px, `--elev-float`. Les feuilles basses ont des coins de 20 px.

---

## D. Navigation

- **Joueur :** trois destinations, donc une barre d'onglets en bas sur téléphone (Performance · Programme · Vidéos) et des rubriques dans l'en-tête sur ordinateur. Les sous-pages (une vidéo) gardent un lien « ← Mes vidéos » au-dessus du titre. Pas de menu caché.
- **Staff :** menu latéral (8 à 10 rubriques), replié sur téléphone derrière ☰. Une barre du haut garde le logo visible. Le tableau tactique reste en plein écran (← pour sortir).
- **Profondeur maximale :**
  - rubrique → objet (vidéo, schéma) → mode (annoter, envoyer) ;
  - aucun mode ne change de page ;
  - les feuilles et panneaux se referment sans perdre le contexte.

---

## E. Terrain tactique

- **Manipulation :** toucher → barre de l'élément, glisser → barre effacée, relâcher → barre revenue. Double sécurité : seuil de 4 px avant de considérer un déplacement.
- **Barre de l'élément :**
  - couleur (pastille → palette) ;
  - taille (curseur) ;
  - n° / texte ;
  - police (pour un texte) ;
  - angle (pour un tracé) ;
  - pivoter (seulement ce qui a une orientation) ;
  - dupliquer ;
  - supprimer.
  Le libellé « Joueur » a disparu ; seul « 3 éléments » s'affiche en sélection multiple.
- **Couleurs de création :** équipe active et tracés, mémorisées dans `profiles.prefs` (les mêmes valeurs que Paramètres).
- **Téléphone :**
  - nouveau schéma en terrain vertical ;
  - barres d'outils et d'animation défilantes ;
  - vitesse de lecture masquée (secondaire) ;
  - panneaux en feuille basse.
- **Reste possible plus tard :** pincer pour zoomer sur le terrain, appui long = menu contextuel au doigt (le clic droit n'existe pas sur téléphone ; tout ce qu'il offre est désormais dans la barre).

---

## F. Vidéo

- **Commandes propres**, sans barre native :
  - lecture/pause (et toucher la vidéo) ;
  - temps ;
  - ↶ / ↷ ;
  - ralenti ;
  - précision ;
  - plein écran.
- **Timeline :**
  - vidéo entière, séquences en filigrane ;
  - séquence choisie en doré avec sa durée ;
  - annotations en traits dorés ;
  - tête de lecture avec bulle de timecode pendant le geste.
- **Pendant une coupe**, le reste s'estompe (`is-trimming`).
- **Lecture d'une séquence :** elle s'arrête à sa fin ; « Vidéo entière » lit librement.
- **Clavier (staff sur ordinateur) :** Espace = lecture, « , » / « . » = image par image, ← / → sur une poignée = 0,1 s (Maj : 1 s).

---

## G. Habillage

Modèle stocké dans `video_sequences.drawings` (jsonb, sans migration) :
`[{ t, d, freeze, shapes: [...] }]`

Les anciennes annotations `{ t, shapes }` sont lues comme `d = 3 s`, avec arrêt sur image.

**Formes**, en coordonnées 0–1 de l'image, donc identiques sur tout écran :
- flèche, trait ;
- cercle, zone ;
- trajectoire (pointillés + flèche) ;
- projecteur (assombrit tout sauf l'ellipse) ;
- repère joueur (anneau au sol + étiquette) ;
- titre / texte (sur fond sombre lisible).

**Lecture :**
- les annotations « visibles N s » s'affichent de `t` à `t + d` ;
- les arrêts sur image mettent la lecture en pause à `t` pendant `d`, puis la reprennent ;
- l'apparition et la disparition se font en fondu (200 ms).

---

## H. Séquences (clips)

- **Une vidéo produit N séquences :** « Nouvelle séquence », « Couper ici » (chaque partie garde ses annotations), « Dupliquer » (version modifiable, l'original reste), « Supprimer ». Tout passe par ↶ / ↷.
- **La source reste intacte :** une séquence n'est qu'un début et une fin.
- **Écraser volontairement :** c'est l'édition normale. Faire une version : « Dupliquer ».

---

## I. Staff

- **« À voir »** en tête de Vidéos joueurs : les séquences envoyées et pas encore commentées, les plus récentes d'abord. Chacune affiche le joueur, le statut, la durée, les annotations, la date d'envoi et l'analyse du joueur.
- **Ouvrir une séquence la marque « Vu »** (`seen_at`, daté par le serveur). La séquence s'ouvre sur la première annotation ; « Lire » la rejoue avec ses arrêts sur image.
- **Réponse :** « Retour du staff » passe le statut à « Retour ». Si le joueur modifie ensuite, le statut devient « Modifié », puis il renvoie.

---

## J. Branding

**Règle :** le même logo partout, c'est-à-dire « Foot » + « Session » en blanc et la pastille dorée « PRO » (`.brand-accent`, `.brand-pro`). Seule la taille change.

| Espace | Où est le logo |
|---|---|
| Staff, ordinateur | Menu latéral |
| Staff, téléphone | Barre du haut (56 px, collante, floutée) |
| Joueur | En-tête de 56 px, identique sur chaque page |
| Connexion | Grand format |

La page Performance, vue par un joueur, remplace sa barre staff par la coque joueur. Les zones sûres de l'iPhone sont gérées : `viewport-fit=cover`, `env(safe-area-inset-*)`.

---

## K. Architecture cible

Le projet est volontairement **sans build** : HTML/CSS/JS statiques dans `web/`, Supabase appelé depuis le navigateur. Intégrer `/components/ui/liquid-glass-button.tsx` (React, Radix Slot, class-variance-authority, `cn`, Tailwind, TypeScript) imposerait bundler, JSX et Tailwind pour un seul bouton. L'équivalent existe en CSS :
- `.glass` : surface flottante ;
- `.glass-btn` avec `.active`, `.is-primary`, `.is-danger`, `:focus-visible`, états tactiles et mouvement réduit.

À reconsidérer seulement si l'app passe un jour à React.

**Modules ajoutés** (scripts classiques, portée partagée) :

| Fichier | Rôle |
|---|---|
| `video-status.js` | Statuts, formats de temps (testé : `tests/video-status.test.mjs`) |
| `video-timeline.js` | Timeline tactile, poignées, zoom |
| `video-ink.js` | Calque d'habillage |
| `video-workspace.js` | Orchestration : lecture, montage, annotation, envoi |
| `player-nav.js` | Coque de l'espace joueur |

**Base de données :** `supabase/video_status.sql` (migration 21) ajoute `seen_at` et `edited_at`. Le trigger `guard_video_sequence` les pose avec `now()`, ainsi que `submitted_at`. Un joueur ne peut ni se déclarer « vu » ni antidater un envoi.

---

## L. Plan d'implémentation (réalisé)

| # | Priorité | Changement | Fichiers |
|---|---|---|---|
| 1 | C | Coque joueur : logo, onglets en bas, zones sûres | `player-nav.js`, `main.css`, pages joueur |
| 2 | C | Timeline tactile, poignées, précision, ralenti | `video-timeline.js`, `video-workspace.js`, `videos.css` |
| 3 | C | Habillage temporel (7 outils, durée, arrêt sur image) | `video-ink.js`, `video-workspace.js` |
| 4 | C | Envoi avec aperçu, multi-séquences, statuts | `video-workspace.js`, `video-status.js`, `video_status.sql` |
| 5 | C | Terrain : barre effacée pendant le geste, curseur de taille, couleurs mémorisées, prise au doigt | `tactical-board.js/.html/.css`, `settings*` |
| 6 | I | Staff : « À voir », marquage « Vu » | `videos-page.js`, `videos.html` |
| 7 | I | Logo unifié, barre du haut staff sur téléphone | `nav.js`, `layout.css`, `auth.css`, pages |
| 8 | I | Débordements horizontaux sur téléphone (vidéo, Performance) | `videos.css`, `player-performance*.css` |
| 9 | A | FAQ et README à jour | `faq.html`, `README.md` |

---

## Écran par écran (téléphone)

**Mes vidéos**
- **Action principale :** ouvrir une vidéo.
- **Frictions levées :** pas de logo ; l'état du travail était peu clair.
- **Cible :** cartes avec « N à envoyer », « N envoyées », « N retours du staff ».
- **Priorité :** I.

**Vidéo**
- **Action principale :** couper, annoter, envoyer.
- **Frictions levées :** débordement ; barre native fine ; découpe en deux temps ; pas d'aperçu.
- **Cible :** vidéo bord à bord, commandes de 44 px, timeline à poignées, 3 grosses actions, séquences en bandeau, feuille d'envoi.
- **Priorité :** C.

**Ma performance**
- **Action principale :** lire ses données.
- **Frictions levées :** débordement du radar ; barre différente des autres pages.
- **Cible :** coque commune ; grilles souples.
- **Priorité :** C.

**Mon programme**
- **Action principale :** ouvrir un exercice.
- **Friction levée :** pas de logo.
- **Cible :** coque commune.
- **Priorité :** I.

**Tableau tactique**
- **Action principale :** placer, déplacer, régler.
- **Frictions levées :** barre sur 2 lignes ; S/M/L ; couleurs dans un panneau ; cibles minuscules.
- **Cible :** barre en bas au pouce, curseur, pastilles, prise élargie, terrain vertical.
- **Priorité :** C.

**Vidéos joueurs (staff)**
- **Action principale :** voir le travail reçu.
- **Friction levée :** il fallait filtrer puis déplier.
- **Cible :** « À voir » en tête, ouverture directe, « Vu » automatique.
- **Priorité :** I.

**Pages staff**
- **Action principale :** naviguer.
- **Friction levée :** logo invisible sur téléphone.
- **Cible :** barre du haut avec logo.
- **Priorité :** I.

---

## Parcours testés

Tests faits dans le navigateur de développement, au format 375 × 812, sur des données simulées.

**Joueur**
- **Parcours :** Vidéos → vidéo → séquence → Lire → pause → Annoter → flèche + repère « 7 » + projecteur + texte → Enregistrer → lecture avec arrêt sur image de 3 s → analyse → Envoyer → aperçu → Envoyer au staff.
- **Nombre de touchers :** 9 à 10, tous dans la même page.
- **Ce qui a changé :** plus de sélection précise à la barre native ; ce qui part est visible avant l'envoi ; le statut passe à « Envoyé ». Modifier l'analyse ensuite fait passer à « Modifié », et le bouton devient « Renvoyer au staff ».

**Terrain**
- **Parcours :**
  - toucher l'équipe → couleur ;
  - n°1 → poser 1, 2, 3 ;
  - toucher un pion → curseur de taille ;
  - pastille → jaune ;
  - glisser le pion (barre effacée, barres latérales à 30 %) ;
  - n°4 → nouveau pion bleu, grande taille conservée.
- **Nombre de touchers :** 2 pour la couleur, qui reste ensuite, au lieu de 3 plus un panneau.
- **Ce qui a changé :** la couleur et la taille survivent au rechargement (préférences du compte).

**Staff**
- **Parcours :** Vidéos joueurs → carte « À voir » → la séquence s'ouvre sur l'annotation, statut « Vu » → Lire → Retour.
- **Nombre de touchers :** 3 à 4, au lieu de 5 à 6 (filtre, dépliage, choix de l'image).
- **Ce qui a changé :** le joueur voit « Vu » puis « Retour ».

## Premier usage : les questions traitées

- **« Qu'est-ce que je dois faire ? »** Un guide en 3 étapes s'affiche au-dessus des séquences (Choisis ou crée · Annote · Envoie).
- **« Comment je coupe ? »** Le bouton « Nouvelle séquence » est bien visible et un message indique de tirer les poignées dorées.
- **« Comment je reviens ? »** Onglets en bas, « ← Mes vidéos », « Vidéo entière ».
- **« Comment j'envoie ça au staff ? »** Le bouton « Envoyer (n) » apparaît dès qu'une séquence est prête, et l'aperçu nomme le destinataire.
- **« Pourquoi le terrain a bougé ? »** Il ne bouge plus : tout se superpose.
- **« Où sont mes séquences ? »** Dans le bandeau sous la vidéo, avec leur statut, et le résumé sur chaque carte de Mes vidéos.

## Limites connues

- Sur iPhone, le plein écran de la vidéo est celui du système (vidéo seule, sans les annotations). Sur Android et sur ordinateur, les annotations restent visibles.
- « Vu » et « Modifié » demandent la migration 21. Sans elle, ces deux statuts ne s'affichent jamais ; rien ne casse.
- Le staff ne dessine pas encore sur les séquences : son retour est écrit. C'est à ajouter si le besoin est confirmé, avec une colonne dédiée pour ne pas toucher au travail du joueur.
