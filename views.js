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

  if (viewName === 'home')           homeView.classList.remove('hidden');
  else if (viewName === 'game')      gameView.classList.remove('hidden');
  else if (viewName === 'augments')  { augmentsView.classList.remove('hidden'); renderAugmentsPage(); }
  else if (viewName === 'figures')   { document.getElementById('figures-view').classList.remove('hidden'); renderFiguresPage(); }

  navHomeBtn.classList.toggle('active', viewName === 'home');
  navGameBtn.classList.toggle('active', viewName === 'game');
  navAugmentsBtn.classList.toggle('active', viewName === 'augments');
  document.getElementById('nav-figures').classList.toggle('active', viewName === 'figures');
}

// ─── Augments Page ────────────────────────────────────────────────────────────
function renderAugmentsPage() {
  const container = document.getElementById('augments-container');
  container.innerHTML = '';
  const augmentsByCost = {};
  AUGMENTS.forEach(aug => {
    if (!augmentsByCost[aug.cost]) augmentsByCost[aug.cost] = [];
    augmentsByCost[aug.cost].push(aug);
  });
  [1, 2].forEach(cost => {
    if (!augmentsByCost[cost] || augmentsByCost[cost].length === 0) return;
    const section = document.createElement('div');
    section.className = 'augments-by-cost';
    const title = document.createElement('h2');
    title.textContent = `Cost ${cost} Augments`;
    section.appendChild(title);
    const cardsContainer = document.createElement('div');
    cardsContainer.className = 'augment-cards';
    augmentsByCost[cost].forEach(aug => {
      const card = document.createElement('div');
      card.className = `augment-card-upright cost-${aug.cost}`;
      card.dataset.id = aug.id;
      const header = document.createElement('div');
      header.className = 'ac-header';
      const costEl = document.createElement('div');
      costEl.className = 'ac-cost';
      costEl.textContent = aug.cost;
      const nameEl = document.createElement('div');
      nameEl.className = 'ac-name';
      nameEl.textContent = aug.name;
      header.appendChild(costEl);
      header.appendChild(nameEl);
      card.appendChild(header);
      if (aug.image) {
        const imgEl = document.createElement('img');
        imgEl.className = 'ac-image';
        imgEl.src = `${AUGMENT_IMAGE_PATH}/${aug.image}`;
        imgEl.alt = aug.name;
        card.appendChild(imgEl);
      }
      const descEl = document.createElement('div');
      descEl.className = 'ac-desc';
      descEl.textContent = aug.desc;
      card.appendChild(descEl);
      card.addEventListener('click', () => showAugmentDetail(aug));
      cardsContainer.appendChild(card);
    });
    section.appendChild(cardsContainer);
    container.appendChild(section);
  });
}

function showAugmentDetail(augment) {
  detailTitle.textContent = augment.name;
  detailCost.textContent = `Cost: ${augment.cost}`;
  detailDescription.textContent = augment.desc;
  augmentDetailModal.classList.remove('hidden');
}

function closeAugmentDetail() {
  augmentDetailModal.classList.add('hidden');
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
      card.className = 'augment-card-upright';
      card.dataset.id = fig.id;
      const header = document.createElement('div');
      header.className = 'ac-header';
      const typeEl = document.createElement('div');
      typeEl.className = 'ac-cost';
      typeEl.textContent = FIGURE_TYPE_NAMES[fig.replaces][0];
      const nameEl = document.createElement('div');
      nameEl.className = 'ac-name';
      nameEl.textContent = fig.name;
      header.appendChild(typeEl);
      header.appendChild(nameEl);
      card.appendChild(header);
      if (fig.image) {
        const imgEl = document.createElement('img');
        imgEl.className = 'ac-image';
        imgEl.src = `${FIGURE_IMAGE_PATH}/${fig.image}`;
        imgEl.alt = fig.name;
        card.appendChild(imgEl);
      }
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

function showFigureDetail(fig) {
  const modal = document.getElementById('figure-detail-modal');
  document.getElementById('figure-detail-title').textContent = fig.name;
  document.getElementById('figure-detail-type').textContent = `Replaces: ${FIGURE_TYPE_NAMES[fig.replaces]}`;
  const imgEl = document.getElementById('figure-detail-img');
  if (fig.image) {
    imgEl.src = `${FIGURE_IMAGE_PATH}/${fig.image}`;
    imgEl.alt = fig.name;
    imgEl.style.display = 'block';
  } else {
    imgEl.style.display = 'none';
  }
  document.getElementById('figure-detail-description').textContent = fig.desc;
  modal.classList.remove('hidden');
}

// ─── Navigation Init ──────────────────────────────────────────────────────────
function initNavigation() {
  navHomeBtn.addEventListener('click', () => showView('home'));
  navGameBtn.addEventListener('click', () => showView('game'));
  navAugmentsBtn.addEventListener('click', () => showView('augments'));
  document.getElementById('nav-figures').addEventListener('click', () => showView('figures'));

  startGameBtn.addEventListener('click', () => {
    showView('game');
    startAugmentDraft();
  });

  document.getElementById('create-game-link-btn').addEventListener('click', () => {
    createGameLink();
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
  showView('home');
}

document.addEventListener('DOMContentLoaded', initApp);
