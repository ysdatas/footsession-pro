# Déploiement — Vidéos joueurs (Supabase)

⚠️ Ceci remplace tout ce que je t'avais envoyé précédemment en PHP — ton site en ligne
n'utilise pas PHP, il est 100 % statique (HTML/CSS/JS) et parle directement à Supabase.

## 1. Base de données + Storage (Supabase)

1. Va sur https://supabase.com/dashboard → ton projet `footsession-pro` (celui dont
   l'URL est `ygnvijxspkrqhasvjfqg.supabase.co`).
2. Menu **SQL Editor** → **New query**.
3. Colle tout le contenu de `supabase/add_player_videos.sql` → **Run**.
   Ça crée : le rôle `joueur`, le lien joueur ↔ compte (`player_code` / `auth_user_id`),
   les tables `player_videos` et `video_views`, toutes les policies RLS, **et** le bucket
   Storage `player-videos` avec ses politiques (pas besoin de le créer à la main dans
   l'onglet Storage).
4. Vérifie dans **Table Editor** que `player_videos` et `video_views` sont bien apparues,
   et dans **Storage** que le bucket `player-videos` existe (privé).

## 2. Fichiers à copier dans ton dépôt

Dans le dossier `web/` de ton projet (c'est lui qui est réellement déployé, cf.
`wrangler.jsonc` → `"assets": { "directory": "web" }`) :

```
web/player-join.html         (nouveau — connexion/inscription joueur)
web/mes-videos.html          (nouveau — liste des vidéos du joueur connecté)
web/voir-video.html          (nouveau — lecteur + suivi de visionnage)
web/videos.html              (nouveau — page staff : envoi + stats)
web/assets/css/videos.css    (nouveau)
web/assets/js/videos-page.js (nouveau)
web/assets/js/video-tracking.js (nouveau)
```

Et **remplace** ces 7 fichiers existants par les versions fournies ici (ils sont
identiques aux tiens, avec juste le lien « Vidéos joueurs » ajouté au menu) :

```
web/dashboard.html
web/sessions.html
web/players.html
web/tactical-board.html
web/analytics.html
web/club.html
web/settings.html
```

(Si tu as modifié ces fichiers depuis l'export du ZIP que tu m'as envoyé, ajoute juste
à la main cette ligne dans le `<nav class="nav">` de chacun, juste avant le lien
« Mon club » :
```html
<a class="nav-item" href="videos.html"><span class="nav-dot"></span>Vidéos joueurs</a>
```
)

## 3. Pousser sur GitHub

Dans ton terminal, à la racine du projet cloné :
```bash
git add .
git commit -m "Ajout vidéos joueurs (upload, accès exclusif, suivi de visionnage)"
git push
```

## 4. Mettre à jour le site en ligne (Cloudflare Workers)

Le dépôt ne contient pas de workflow de déploiement automatique (pas de dossier
`.github/workflows`). Deux cas possibles :

- **Si ton projet Cloudflare est connecté à GitHub** (Workers & Pages → ton projet →
  onglet **Settings** → section **Build** montre un dépôt Git relié) : le déploiement se
  déclenche tout seul après le `git push`. Va juste vérifier dans l'onglet
  **Deployments** que le build s'est bien lancé.
- **Sinon**, déploie manuellement depuis ton terminal, à la racine du projet :
  ```bash
  npx wrangler deploy
  ```
  (Ça republie le contenu du dossier `web/` tel quel, selon `wrangler.jsonc`. Il te
  demandera de te connecter à Cloudflare la première fois : `npx wrangler login`.)

## 5. Comment ça marche pour toi (coach/admin)

1. Va sur `videos.html` (nouveau lien dans le menu).
2. Bouton **« Codes joueurs »** → tu vois un code à 6 caractères par joueur (généré
   automatiquement en base, comme le code d'invitation de ton club).
3. Donne ce code au joueur concerné (message, papier, peu importe).
4. Le joueur va sur `https://ton-site.workers.dev/player-join.html`, crée son compte
   (email + mot de passe), puis entre ce code → son compte est lié à sa fiche joueur,
   pour toujours.
5. Bouton **« + Envoyer une vidéo »** → choisis le joueur, titre, fichier → envoyée.
   Seul ce joueur (et le staff du club) peuvent la voir.
6. La page `videos.html` affiche pour chaque vidéo : vue/non vue, nombre de
   visionnages, temps total regardé, % de progression, dernière consultation.

## 6. Points importants à connaître

- **Exclusivité réellement garantie côté base** : ce n'est pas juste "caché dans
  l'interface" — les politiques RLS empêchent au niveau Postgres/Storage qu'un joueur
  lise la vidéo ou les statistiques d'un autre, même en bidouillant les requêtes
  réseau dans son navigateur.
- **Taille des fichiers** : par défaut Supabase Storage limite l'upload à 50 Mo par
  fichier sur le plan gratuit (jusqu'à plusieurs Go sur les plans payants, réglable
  dans **Storage → Configuration**). Augmente cette limite dans le dashboard Supabase
  si tes vidéos sont plus lourdes, en plus de la limite `maxBytes` côté JS dans
  `videos-page.js`.
- **Suivi lors de la fermeture brutale de l'onglet** : le "heartbeat" envoie les
  stats toutes les 5 secondes + à la pause + en quittant l'onglet, mais un envoi
  déclenché à la toute dernière seconde (fermeture brutale) peut ne pas avoir le temps
  d'arriver — c'est une limite technique du navigateur, l'essentiel du visionnage est
  quand même capté.
- **URLs signées** : chaque lecture génère une URL temporaire (1h) via
  `createSignedUrl` — comme pour le logo du club. Personne ne peut donc partager un
  lien direct permanent vers la vidéo d'un autre joueur.
