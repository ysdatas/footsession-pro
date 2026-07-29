# FootSession Pro ⚽

Application web de gestion de séances d'entraînement football pour la cellule
vidéo / coaching d'un club. **PHP 8 + MySQL 8 + Vanilla JS**, sans framework.
Design sobre noir / gris / doré, police Inter.

---

## 🚀 Installation locale (XAMPP)

1. **Copier le projet** dans `xampp/htdocs/` (ex. `htdocs/footsession-pro/`).
2. Démarrer **Apache** et **MySQL** depuis le panneau XAMPP.
3. **Créer la base** : ouvrir phpMyAdmin → onglet *Importer* → choisir
   [`database/schema.sql`](database/schema.sql) → *Exécuter*.
   (Crée la base `footsession_pro` et toutes les tables.)
4. Vérifier les identifiants MySQL dans [`php/config/database.php`](php/config/database.php)
   (par défaut XAMPP : utilisateur `root`, mot de passe vide).
5. **Créer le premier administrateur** : visiter
   `http://localhost/footsession-pro/setup.php`, remplir le formulaire.
6. ⚠️ **Supprimer `setup.php`** une fois l'admin créé (sécurité).
7. Se connecter sur `http://localhost/footsession-pro/` (`index.php`).

> Les comptes coach / viewer se créent ensuite depuis **Admin** ou **register.php**
> (réservé aux administrateurs — pas d'inscription publique).

---

## 👤 Rôles

| Rôle    | Droits                                                        |
|---------|--------------------------------------------------------------|
| `admin` | Accès total + gestion des utilisateurs (`admin.php`)         |
| `coach` | Crée et modifie **ses** séances / joueurs uniquement         |
| `viewer`| Lecture seule (aucune création ni modification)              |

---

## 🧭 Pages

- **Tableau de bord** — KPIs, séances récentes, récap par catégorie.
- **Mes séances** — liste, recherche, export PDF, suppression.
- **Créer / Modifier une séance** — procédés dynamiques, présence, schéma tactique.
- **Tableau tactique** — Canvas interactif (joueurs, adversaires, zones
  redimensionnables, flèches, texte, logo, formations, étapes animées).
- **Mes joueurs** — vue grille + matrice de présence, fiches détaillées.
- **Bilan & Analytics** — graphiques Chart.js, export PDF.
- **Admin** — comptes, rôles, activation, séances par coach.

---

## 🎨 Tableau tactique — prise en main

- **Outils** (barre du haut) : sélection, joueur, adversaire, flèches
  (droite / courbée / pointillée), trait, formes (carré, rectangle, cercle,
  triangle), texte.
- **Zones** : choisir une forme puis **glisser** sur le terrain pour la tracer ;
  la sélectionner (outil ↖) puis **tirer un coin** pour la redimensionner.
- **Formations** : menu déroulant (4-3-3, 4-4-2…) place 11 joueurs.
- **Étapes animées** : `+ Étape` enregistre les positions, `▶ Jouer` anime la séquence.
- **Raccourcis** : `Ctrl+Z` annuler, `Suppr` supprimer l'élément sélectionné.
- **Sauvegarde** : auto en LocalStorage (toutes les 30 s) ; `💾 Sauver` enregistre
  le JSON en base ; **Valider ce schéma** enregistre l'image (PNG base64) dans le
  procédé et revient à la séance.

> Pour lier un schéma à un procédé, **enregistrez d'abord la séance** (le bouton
> « Ouvrir le tableau tactique → » devient alors actif sur chaque procédé).

---

## 📄 Export PDF

Bouton *Exporter PDF* (séance) → couverture, un procédé par page (schéma + fiche
en deux colonnes), page de présence. Généré côté client (jsPDF).

---

## ☁️ Déploiement o2switch

1. Envoyer les fichiers par FTP dans le dossier web (ex. `public_html/`).
2. Créer une base MySQL depuis l'espace client, importer `database/schema.sql`.
3. Modifier `php/config/database.php` avec les identifiants fournis par o2switch
   (`DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASS`).
4. Lancer `setup.php` une fois, puis le supprimer.

---

## 🔒 Sécurité

- Toutes les requêtes via **PDO préparé** (anti-injection).
- `htmlspecialchars()` sur les affichages, jeton **CSRF** sur les écritures.
- `session_regenerate_id()` à la connexion, en-têtes `X-Frame-Options`, etc.
- Filtrage par propriétaire : un coach ne voit que ses données.

## 📝 Notes

- Conçu et testé pour **XAMPP / o2switch** (PHP 8.x, MySQL 8.x). Le projet ne
  tourne pas sans serveur PHP + MySQL.
- Après *Valider ce schéma*, l'onglet du tableau tactique se ferme et la séance
  est rechargée pour afficher la miniature.
