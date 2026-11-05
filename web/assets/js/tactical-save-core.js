/* Helpers de publication des schémas tactiques.
   Chaque image reçoit une clé immuable : la base référence la nouvelle image
   avant que l'ancienne soit retirée. En cas d'échec de la base, l'ancienne
   référence reste intacte ; la nouvelle image pourra être nettoyée plus tard. */
(function (root) {
  function versionedPath(stem, extension = 'jpg') {
    const nonce = Math.random().toString(36).slice(2, 10);
    return `${stem}-${Date.now().toString(36)}-${nonce}.${extension}`;
  }

  const hasSavedRow = (data) => Array.isArray(data) ? data.length > 0 : !!data;

  async function publish({ path, oldPath = null, upload, write, removeOld, emptyResultMessage }) {
    const uploaded = await upload(path);
    if (uploaded?.error) throw uploaded.error;

    // Ne pas supprimer l'image précédente avant confirmation de l'écriture.
    // Une erreur réseau peut être ambiguë : conserver la nouvelle image évite
    // de casser une ligne qui aurait malgré tout été validée par le serveur.
    const saved = await write(path);
    if (saved?.error) throw saved.error;
    if (!hasSavedRow(saved?.data)) throw new Error(emptyResultMessage || 'Schéma non enregistré : aucune ligne confirmée par la base.');

    if (oldPath && oldPath !== path && removeOld) {
      try {
        const removed = await removeOld(oldPath);
        if (removed?.error) throw removed.error;
      } catch (error) {
        console.warn('Ancienne image du schéma restée dans le stockage', error);
      }
    }
    return saved.data;
  }

  root.TacticalSaveCore = Object.freeze({ versionedPath, publish });
})(window);
