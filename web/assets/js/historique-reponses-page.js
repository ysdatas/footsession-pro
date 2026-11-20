/* L'historique des réponses est devenu la vue « Historique » du Suivi RPE (suivi-rpe-hist.js) :
   l'ancienne adresse y renvoie, avec ses filtres (team, joueur, du, au, form). */
(() => {
  const u = new URLSearchParams(location.search);
  u.set('vue', 'historique');
  location.replace(`suivi-rpe?${u}`);
})();
