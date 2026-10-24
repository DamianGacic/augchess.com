/**
 * views.js — App shell: navigation routing, Augments page, Figures page, app init.
 * Depends on: AUGMENTS, FIGURES, FIGURE_TYPE_ORDER, FIGURE_TYPE_NAMES,
 *             AUGMENT_IMAGE_PATH, FIGURE_IMAGE_PATH, loadAugmentDescriptions(),
 *             startAugmentDraft() — DOM refs below.
 */

// ─── View & Navigation DOM Refs ───────────────────────────────────────────────
const homeView     = document.getElementById('home-view');
const gameView     = document.getElementById('game-view');
const augmentsView = document.getElementById('augments-view');

const navHomeBtn     = document.getElementById('nav-home');
const navGameBtn     = document.getElementById('nav-game');
const navAugmentsBtn = document.getElementById('nav-augments');
const startGameBtn   = document.getElementById('start-game-btn');

const augmentDetailModal = document.getElementById('augment-detail-modal');
const detailTitle        = document.getElementById('detail-title');
const detailCost         = document.getElementById('detail-cost');
const detailDescription  = document.getElementById('detail-description');
const closeDetailBtn     = document.getElementById('close-detail-btn');

// ─── View Routing ─────────────────────────────────────────────────────────────
function showView(viewName) {
  homeView.classList.add('hidden');
  gameView.classList.add('hidden');
  augmentsView.classList.add('hidden');
  document.getElementById('figures-view').classList.add('hidden');
  document.getElementById('account-view').classList.add('hidden');
  document.getElementById('leaderboard-view').classList.add('hidden');

  if (viewName === 'home')           homeView.classList.remove('hidden');
  else if (viewName === 'game')      gameView.classList.remove('hidden');
  else if (viewName === 'augments')  { augmentsView.classList.remove('hidden'); renderAugmentsPage(); }
  else if (viewName === 'figures')   { document.getElementById('figures-view').classList.remove('hidden'); renderFiguresPage(); }
  else if (viewName === 'leaderboard') { document.getElementById('leaderboard-view').classList.remove('hidden'); renderLeaderboard(); }
  else if (viewName === 'account')   { document.getElementById('account-view').classList.remove('hidden'); Settings.refreshFriends(); }

  navHomeBtn.classList.toggle('active', viewName === 'home');
  navGameBtn.classList.toggle('active', viewName === 'game');
  navAugmentsBtn.classList.toggle('active', viewName === 'augments');
  document.getElementById('nav-figures').classList.toggle('active', viewName === 'figures');
  document.getElementById('profile-btn').classList.toggle('active', viewName === 'account');
  document.getElementById('nav-leaderboard').classList.toggle('active', viewName === 'leaderboard');
}

// ─── Shared Augment UI Bits ───────────────────────────────────────────────────
// Also used by draft.js and app.js (loaded after this file is parsed, called
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

// ─── Augments Page ────────────────────────────────────────────────────────────
let augmentFilter = 'all';

function renderAugmentFilters() {
  const bar = document.getElementById('augment-filters');
  bar.innerHTML = '';
  ['all', ...AUGMENT_KIND_ORDER].forEach(kind => {
    const count = kind === 'all' ? AUGMENTS.length : AUGMENTS.filter(a => augmentKind(a) === kind).length;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'filter-chip' + (kind === 'all' ? '' : ` kind-${kind}`) + (augmentFilter === kind ? ' active' : '');
    chip.innerHTML = `${kind === 'all' ? 'All' : AUGMENT_KIND_NAMES[kind]} <span class="chip-count">${count}</span>`;
    chip.addEventListener('click', () => { augmentFilter = kind; renderAugmentsPage(); });
    bar.appendChild(chip);
  });
}

function renderAugmentsPage() {
  renderAugmentFilters();
  const container = document.getElementById('augments-container');
  container.innerHTML = '';
  const kinds = augmentFilter === 'all' ? AUGMENT_KIND_ORDER : [augmentFilter];
  kinds.forEach(kind => {
    const augs = AUGMENTS.filter(a => augmentKind(a) === kind).sort((a, b) => a.cost - b.cost);
    if (augs.length === 0) return;
    const section = document.createElement('div');
    section.className = `augments-by-cost kind-${kind}`;
    const title = document.createElement('h2');
    title.textContent = AUGMENT_KIND_NAMES[kind];
    section.appendChild(title);
    const cardsContainer = document.createElement('div');
    cardsContainer.className = 'augment-cards';
    augs.forEach(aug => cardsContainer.appendChild(buildAugmentPageCard(aug)));
    section.appendChild(cardsContainer);
    container.appendChild(section);
  });
}

function buildAugmentPageCard(aug) {
  const card = document.createElement('div');
  card.className = `augment-card-upright kind-${augmentKind(aug)}`;
  card.dataset.augId = aug.id;

  const header = document.createElement('div');
  header.className = 'ac-header';
  header.appendChild(augmentEmblem(aug));
  const titles = document.createElement('div');
  titles.className = 'ac-titles';
  const nameEl = document.createElement('div');
  nameEl.className = 'ac-name';
  nameEl.textContent = aug.name;
  const meta = document.createElement('div');
  meta.className = 'ac-meta';
  meta.appendChild(kindTag(aug));
  meta.appendChild(costBadge(aug.cost));
  titles.appendChild(nameEl);
  titles.appendChild(meta);
  header.appendChild(titles);
  card.appendChild(header);

  const descEl = document.createElement('div');
  descEl.className = 'ac-desc';
  descEl.textContent = aug.desc;
  card.appendChild(descEl);

  if (aug.requires) {
    const footer = document.createElement('div');
    footer.className = 'ac-footer';
    footer.appendChild(requiresTag(aug));
    card.appendChild(footer);
  }

  card.addEventListener('click', () => showAugmentDetail(aug));
  return card;
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

// ─── Home Page Showcase ───────────────────────────────────────────────────────
// Hero "board" of emblems plus a scrolling strip of every augment.
function renderHomeShowcase() {
  const board = document.getElementById('hero-board');
  board.innerHTML = '';
  const featured = ['archers', 'solarStrike', 'ghouls', 'kingsLightning', 'mounting',
    'silverBullet', 'watchtowers', 'raiseTheDead', 'trolls', 'ringOfFire',
    'stunlock', 'coronation', 'unstableTeleport', 'longbowmen', 'leaping'];
  for (let i = 0; i < 25; i++) {
    const tile = document.createElement('div');
    tile.className = 'hero-tile';
    // Scatter the 15 featured emblems over a 5×5 grid, leaving gaps so it
    // reads like pieces on a board rather than a dense icon sheet.
    const slot = [0, 2, 4, 6, 8, 10, 11, 12, 14, 16, 17, 18, 20, 22, 24].indexOf(i);
    if (slot !== -1) {
      const aug = AUGMENTS.find(a => a.id === featured[slot]);
      const img = augmentEmblem(aug);
      img.style.animationDelay = `${(i * 0.37) % 6}s`;
      tile.appendChild(img);
    }
    board.appendChild(tile);
  }

  const track = document.getElementById('augment-marquee');
  track.innerHTML = '';
  // Two copies back to back so the -50% translate loops seamlessly.
  [0, 1].forEach(copy => {
    AUGMENTS.forEach(aug => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'marquee-item';
      item.dataset.augId = aug.id;
      if (copy) item.setAttribute('aria-hidden', 'true');
      item.appendChild(augmentEmblem(aug));
      item.appendChild(document.createTextNode(aug.name));
      item.addEventListener('click', () => showAugmentDetail(aug));
      track.appendChild(item);
    });
  });
}

function closeAugmentDetail() {
  augmentDetailModal.classList.add('hidden');
  stopAugmentDemoInDetail();
}

// ─── Figures Page ─────────────────────────────────────────────────────────────
function renderFiguresPage() {
  const container = document.getElementById('figures-container');
  container.innerHTML = '';
  FIGURE_TYPE_ORDER.forEach(type => {
    const figures = FIGURES.filter(f => f.replaces === type);
    if (figures.length === 0) return;
    const section = document.createElement('div');
    section.className = 'augments-by-cost';
    const title = document.createElement('h2');
    title.textContent = FIGURE_TYPE_NAMES[type] + ' Figures';
    section.appendChild(title);
    const cardsContainer = document.createElement('div');
    cardsContainer.className = 'augment-cards';
    figures.forEach(fig => {
      const card = document.createElement('div');
      card.className = 'augment-card-upright figure-card';
      card.dataset.id = fig.id;
      const art = document.createElement('div');
      art.className = 'figure-art';
      art.appendChild(figureArt(fig));
      card.appendChild(art);
      const header = document.createElement('div');
      header.className = 'ac-header';
      const titles = document.createElement('div');
      titles.className = 'ac-titles';
      const nameEl = document.createElement('div');
      nameEl.className = 'ac-name';
      nameEl.textContent = fig.name;
      const meta = document.createElement('div');
      meta.className = 'ac-meta';
      const replacesEl = document.createElement('span');
      replacesEl.className = 'kind-tag kind-unit';
      replacesEl.textContent = `Replaces ${FIGURE_TYPE_NAMES[fig.replaces]}`;
      meta.appendChild(replacesEl);
      if (!fig.image) {
        const pending = document.createElement('span');
        pending.className = 'pending-tag';
        pending.textContent = 'Art pending';
        meta.appendChild(pending);
      }
      titles.appendChild(nameEl);
      titles.appendChild(meta);
      header.appendChild(titles);
      card.appendChild(header);
      const descEl = document.createElement('div');
      descEl.className = 'ac-desc';
      descEl.textContent = fig.desc;
      card.appendChild(descEl);
      card.addEventListener('click', () => showFigureDetail(fig));
      cardsContainer.appendChild(card);
    });
    section.appendChild(cardsContainer);
    container.appendChild(section);
  });
}

// Figure artwork for the dark UI: the white-side render where one exists
// (the black one vanishes on a dark background), else the figure's emblem.
function figureArtUrl(fig) {
  if (!fig.image) return figureIconUrl(fig.id);
  return `${FIGURE_IMAGE_PATH}/${fig.image.replace('-black.', '-white.')}`;
}

function figureArt(fig) {
  if (!fig.image) return emblemImg(figureIconUrl(fig.id), fig.name);
  const img = document.createElement('img');
  img.src = figureArtUrl(fig);
  img.alt = fig.name;
  // Ghoul art is a single grey set — lift it like a White piece on the board.
  if (fig.id === 'ghoul') img.className = 'figure-ghoul-art';
  return img;
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

// ─── Leaderboard Page ─────────────────────────────────────────────────────────
// Re-fetched on every visit; the RPC caps it at 100 rows.
async function renderLeaderboard() {
  const list = document.getElementById('leaderboard-list');
  const status = document.getElementById('leaderboard-status');
  status.textContent = 'Loading…';
  const { data, error } = await Auth.leaderboard();
  if (error) { list.replaceChildren(); status.textContent = 'Could not load the leaderboard.'; return; }
  const me = Auth.profile && Auth.profile.display_name;
  list.replaceChildren(...data.map((row, i) => {
    const li = document.createElement('li');
    li.className = 'leaderboard-row' + (row.display_name === me ? ' me' : '');
    li.innerHTML = '<span class="lb-rank"></span><span class="lb-name"></span><span class="lb-rating"></span>';
    li.querySelector('.lb-rank').textContent = i + 1;
    li.querySelector('.lb-name').textContent = row.display_name;
    li.querySelector('.lb-rating').textContent = row.rating;
    return li;
  }));
  status.textContent = data.length ? '' : 'No rated players yet — set a display name in Settings to appear here.';
}

// ─── Navigation Init ──────────────────────────────────────────────────────────
function initNavigation() {
  navHomeBtn.addEventListener('click', () => showView('home'));
  document.getElementById('nav-leaderboard').addEventListener('click', () => showView('leaderboard'));
  navGameBtn.addEventListener('click', () => showView('game'));
  navAugmentsBtn.addEventListener('click', () => showView('augments'));
  document.getElementById('nav-figures').addEventListener('click', () => showView('figures'));
  document.getElementById('logo-home').addEventListener('click', () => showView('home'));

  startGameBtn.addEventListener('click', () => {
    showView('game');
    showGameSettings();
  });

  document.getElementById('create-game-link-btn').addEventListener('click', () => {
    createGameLink();
  });

  document.getElementById('play-online-btn').addEventListener('click', () => findMatch(false));
  // Ranked needs an account: signed out, this opens the sign-in modal instead.
  document.getElementById('play-ranked-btn').addEventListener('click', () => {
    if (Auth.session) findMatch(true);
    else document.getElementById('account-sign-in-btn').click();
  });

  closeDetailBtn.addEventListener('click', closeAugmentDetail);
  augmentDetailModal.addEventListener('click', (e) => {
    if (e.target === augmentDetailModal) closeAugmentDetail();
  });

  document.getElementById('close-figure-detail-btn').addEventListener('click', () => {
    document.getElementById('figure-detail-modal').classList.add('hidden');
  });
  document.getElementById('figure-detail-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('figure-detail-modal')) {
      document.getElementById('figure-detail-modal').classList.add('hidden');
    }
  });
}

// ─── App Init ─────────────────────────────────────────────────────────────────
async function initApp() {
  await loadAugmentDescriptions();
  initNavigation();
  renderHomeShowcase();
  showView('home');
}

document.addEventListener('DOMContentLoaded', initApp);
