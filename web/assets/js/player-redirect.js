/* LMFC Performance — player-redirect.js
   Ancienne adresse player.html : renvoie vers la fiche joueur.
   Script sorti de la page pour la politique de contenu (CSP : aucun script en ligne). */
location.replace('player-performance.html' + location.search + location.hash);
