/**
 * views.js — Augment/figure UI bits the classic scripts still share while the
 * frontend moves to React (src/): emblem/tag/badge builders (app.js,
 * augment-demo-player.js) and the augment/figure detail modals
 * (opened from React pages and from the game screen via window globals).
 * Routing, pages and app init now live in src/.
 * Depends on: AUGMENTS, AUGMENT_KIND_NAMES, FIGURE_TYPE_NAMES,
 *             FIGURE_IMAGE_PATH, augmentIconUrl(), figureIconUrl(),
 *             showAugmentDemoInDetail()/stopAugmentDemoInDetail().
 */

const augmentDetailModal = document.getElementById('augment-detail-modal');
const detailTitle        = document.getElementById('detail-title');
const detailCost         = document.getElementById('detail-cost');
const detailDescription  = document.getElementById('detail-description');

// ─── Shared Augment UI Bits ───────────────────────────────────────────────────
// Also used by app.js (loaded after this file is parsed, called
// only at render time).
function emblemImg(src, alt = '') {
  const img = document.createElement('img');
  img.className = 'emblem';
  img.src = src;
  img.alt = alt;
  img.draggable = false;
  return img;
}

function augmentEmblem(aug) {
  return emblemImg(augmentIconUrl(aug.id), aug.name);
}

function kindTag(aug) {
  const kind = augmentKind(aug);
  const el = document.createElement('span');
  el.className = `kind-tag kind-${kind}`;
  el.textContent = AUGMENT_KIND_NAMES[kind];
  return el;
}

function costBadge(cost) {
  const el = document.createElement('span');
  el.className = 'cost-badge';
  el.innerHTML = `<span class="cost-num">${cost}</span>${cost === 1 ? 'point' : 'points'}`;
  return el;
}

function requiresTag(aug) {
  const parent = AUGMENTS.find(a => a.id === aug.requires);
  const el = document.createElement('span');
  el.className = 'requires-tag';
  el.innerHTML = 'Requires <strong></strong>';
  el.querySelector('strong').textContent = parent ? parent.name : aug.requires;
  return el;
}

function showAugmentDetail(augment) {
  document.getElementById('detail-icon').src = augmentIconUrl(augment.id);
  detailTitle.textContent = augment.name;
  detailCost.textContent = `Cost: ${augment.cost}`;
  const meta = document.getElementById('detail-meta');
  meta.innerHTML = '';
  meta.appendChild(kindTag(augment));
  meta.appendChild(costBadge(augment.cost));
  if (augment.requires) meta.appendChild(requiresTag(augment));
  detailDescription.textContent = augment.desc;
  augmentDetailModal.classList.remove('hidden');
  showAugmentDemoInDetail(augment.id);
}

function closeAugmentDetail() {
  augmentDetailModal.classList.add('hidden');
  stopAugmentDemoInDetail();
}

// Figure artwork for the dark UI: the white-side render where one exists
// (the black one vanishes on a dark background), else the figure's emblem.
function figureArtUrl(fig) {
  if (!fig.image) return figureIconUrl(fig.id);
  return `${FIGURE_IMAGE_PATH}/${fig.image.replace('-black.', '-white.')}`;
}

function showFigureDetail(fig) {
  const modal = document.getElementById('figure-detail-modal');
  document.getElementById('figure-detail-title').textContent = fig.name;
  document.getElementById('figure-detail-type').textContent = `Replaces: ${FIGURE_TYPE_NAMES[fig.replaces]}`;
  const imgEl = document.getElementById('figure-detail-img');
  imgEl.src = figureArtUrl(fig);
  imgEl.alt = fig.name;
  imgEl.style.display = 'block';
  imgEl.classList.toggle('emblem', !fig.image);
  imgEl.classList.toggle('detail-emblem', !fig.image);
  imgEl.classList.toggle('figure-ghoul-art', fig.id === 'ghoul');
  document.getElementById('figure-detail-description').textContent = fig.desc;
  modal.classList.remove('hidden');
}

// ─── Modal wiring ─────────────────────────────────────────────────────────────
document.getElementById('close-detail-btn').addEventListener('click', closeAugmentDetail);
augmentDetailModal.addEventListener('click', (e) => {
  if (e.target === augmentDetailModal) closeAugmentDetail();
});

const figureDetailModal = document.getElementById('figure-detail-modal');
document.getElementById('close-figure-detail-btn').addEventListener('click', () => figureDetailModal.classList.add('hidden'));
figureDetailModal.addEventListener('click', (e) => {
  if (e.target === figureDetailModal) figureDetailModal.classList.add('hidden');
});
