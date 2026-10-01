/* ============================================================
   LMFC Performance — lightbox.js
   Visionneuse plein écran commune : images en grand (titre,
   annotation par image, texte du point) ou vidéo avec le son et
   les contrôles. Flèches ou ← → pour passer d'un média à l'autre,
   Échap ou clic à côté pour fermer.

   openLightbox({ title, text, items: [{ type: 'image'|'video', src, caption }],
                  start, footer })  → renvoie l'élément de la visionneuse
   `footer` : HTML ajouté sous le contenu (boutons d'action).
   ============================================================ */

function openLightbox({ title = '', text = '', items = [], start = 0, footer = '' } = {}) {
  closeLightbox();
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const media = items.filter(m => m && m.src);
  let index = Math.min(Math.max(0, start), Math.max(0, media.length - 1));

  const box = document.createElement('div');
  box.className = 'lightbox';
  box.id = 'lightbox';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.setAttribute('aria-label', title || 'Visionneuse');
  box.innerHTML = `
    <div class="lb-panel">
      <div class="lb-head">
        <h2 class="lb-title">${esc(title)}</h2>
        <span class="lb-count"></span>
        <button type="button" class="lb-close" aria-label="Fermer">✕</button>
      </div>
      ${media.length ? `<div class="lb-stage">
        ${media.length > 1 ? '<button type="button" class="lb-nav lb-prev" aria-label="Précédent">‹</button>' : ''}
        <div class="lb-media"></div>
        ${media.length > 1 ? '<button type="button" class="lb-nav lb-next" aria-label="Suivant">›</button>' : ''}
      </div>
      <p class="lb-caption"></p>` : ''}
      ${text ? `<div class="lb-text">${esc(text).replace(/\n/g, '<br>')}</div>` : ''}
      ${footer ? `<div class="lb-footer">${footer}</div>` : ''}
    </div>`;

  const show = () => {
    if (!media.length) return;
    const m = media[index];
    const holder = box.querySelector('.lb-media');
    holder.querySelectorAll('video').forEach(v => v.pause());
    holder.innerHTML = m.type === 'video'
      ? `<video src="${esc(m.src)}" controls autoplay playsinline></video>`
      : `<img src="${esc(m.src)}" alt="${esc(m.caption || title)}">`;
    box.querySelector('.lb-caption').textContent = m.caption || '';
    box.querySelector('.lb-caption').classList.toggle('hidden', !m.caption);
    box.querySelector('.lb-count').textContent = media.length > 1 ? `${index + 1} / ${media.length}` : '';
  };
  const move = (d) => { if (media.length > 1) { index = (index + d + media.length) % media.length; show(); } };

  box.addEventListener('click', (e) => {
    if (e.target === box || e.target.closest('.lb-close')) closeLightbox();
    else if (e.target.closest('.lb-prev')) move(-1);
    else if (e.target.closest('.lb-next')) move(1);
  });
  box._onKey = (e) => {
    if (e.key === 'Escape') closeLightbox();
    else if (e.key === 'ArrowLeft' && !/INPUT|TEXTAREA/.test(e.target.tagName)) move(-1);
    else if (e.key === 'ArrowRight' && !/INPUT|TEXTAREA/.test(e.target.tagName)) move(1);
  };
  document.addEventListener('keydown', box._onKey);
  document.body.append(box);
  document.body.classList.add('lb-open');
  show();
  box.querySelector('.lb-close').focus();
  return box;
}

function closeLightbox() {
  const box = document.getElementById('lightbox');
  if (!box) return;
  box.querySelectorAll('video').forEach(v => v.pause());
  document.removeEventListener('keydown', box._onKey);
  box.remove();
  document.body.classList.remove('lb-open');
}
