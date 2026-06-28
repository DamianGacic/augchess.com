/**
 * draft.js — Pre-game augment drafting flow.
 * Depends on: AUGMENTS, augments, newGame(), showView() — and DOM refs below.
 */

// ─── Augment Draft DOM Refs ───────────────────────────────────────────────────
const augmentModal    = document.getElementById('augment-modal');
const augmentListEl   = document.getElementById('augment-list');
const augmentTurnText = document.getElementById('augment-turn-text');
const apWhiteEl       = document.getElementById('ap-white');
const apBlackEl       = document.getElementById('ap-black');
const apBoxWhite      = document.getElementById('augment-points-white');
const apBoxBlack      = document.getElementById('augment-points-black');
const btnAugmentPass  = document.getElementById('btn-augment-pass');
const btnAugmentStart = document.getElementById('btn-augment-start');

// ─── Draft State ──────────────────────────────────────────────────────────────
let draftState = null; // { points:{w,b}, current:'w'|'b', owned:{w:[],b:[]}, passed:{w,b} }

// ─── Draft Functions ──────────────────────────────────────────────────────────
function startAugmentDraft() {
  draftState = {
    points: { w: 2, b: 2 },
    current: 'w',
    owned: { w: [], b: [] },
    passed: { w: false, b: false },
  };
  augmentModal.classList.remove('hidden');
  btnAugmentStart.classList.add('hidden');
  btnAugmentPass.classList.remove('hidden');
  renderDraft();
}

function renderDraft() {
  const ds = draftState;
  apWhiteEl.textContent = ds.points.w;
  apBlackEl.textContent = ds.points.b;
  apBoxWhite.classList.toggle('active', ds.current === 'w');
  apBoxBlack.classList.toggle('active', ds.current === 'b');

  const who = ds.current === 'w' ? 'White' : 'Black';
  augmentTurnText.textContent = `${who}, choose an augment (or pass)`;

  augmentListEl.innerHTML = '';
  AUGMENTS.forEach(aug => {
    const card = document.createElement('button');
    card.className = 'augment-card cost-' + aug.cost;

    const ownerW = ds.owned.w.includes(aug.id);
    const ownerB = ds.owned.b.includes(aug.id);
    const ownedByCurrent = ds.owned[ds.current].includes(aug.id);
    const affordable = ds.points[ds.current] >= aug.cost;
    const disabled = ownedByCurrent || !affordable;

    if (disabled) card.classList.add('disabled');

    let owners = '';
    if (ownerW) owners += '<span class="ac-owner white">W</span>';
    if (ownerB) owners += '<span class="ac-owner black">B</span>';

    card.innerHTML = `
      <div class="ac-cost">${aug.cost}</div>
      <div class="ac-body">
        <div class="ac-name">${aug.name} ${owners}</div>
        <div class="ac-desc">${aug.desc}</div>
      </div>`;
    card.title = aug.desc;

    if (!disabled) {
      card.addEventListener('click', () => draftPick(aug.id));
    }
    augmentListEl.appendChild(card);
  });
}

function draftPick(augId) {
  const ds = draftState;
  const aug = AUGMENTS.find(a => a.id === augId);
  if (!aug) return;
  if (ds.owned[ds.current].includes(augId)) return;
  if (ds.points[ds.current] < aug.cost) return;

  ds.points[ds.current] -= aug.cost;
  ds.owned[ds.current].push(augId);
  ds.passed[ds.current] = false;

  advanceDraft();
}

function draftPass() {
  const ds = draftState;
  ds.passed[ds.current] = true;
  advanceDraft();
}

function advanceDraft() {
  const ds = draftState;
  const canBuy = (c) => AUGMENTS.some(a => !ds.owned[c].includes(a.id) && ds.points[c] >= a.cost);
  const doneW = ds.passed.w || !canBuy('w');
  const doneB = ds.passed.b || !canBuy('b');

  if (doneW && doneB) { finishDraft(); return; }

  const other = ds.current === 'w' ? 'b' : 'w';
  const otherDone = other === 'w' ? doneW : doneB;
  if (!otherDone) ds.current = other;
  renderDraft();
}

function finishDraft() {
  btnAugmentPass.classList.add('hidden');
  btnAugmentStart.classList.remove('hidden');
  augmentTurnText.textContent = 'Draft complete! Ready to play.';
  augmentListEl.innerHTML = '';
  ['w', 'b'].forEach(c => {
    draftState.owned[c].forEach(id => {
      const aug = AUGMENTS.find(a => a.id === id);
      const card = document.createElement('div');
      card.className = 'augment-card cost-' + aug.cost;
      card.innerHTML = `
        <div class="ac-cost">${aug.cost}</div>
        <div class="ac-body">
          <div class="ac-name">${aug.name} <span class="ac-owner ${c === 'w' ? 'white' : 'black'}">${c === 'w' ? 'W' : 'B'}</span></div>
          <div class="ac-desc">${aug.desc}</div>
        </div>`;
      augmentListEl.appendChild(card);
    });
  });
  if (draftState.owned.w.length === 0 && draftState.owned.b.length === 0) {
    augmentTurnText.textContent = 'No augments selected. Standard chess!';
  }
}

function draftStart() {
  augments = { w: [...draftState.owned.w], b: [...draftState.owned.b] };
  augmentModal.classList.add('hidden');
  newGame();
}

// ─── Draft Button Listeners ───────────────────────────────────────────────────
btnAugmentPass.addEventListener('click', draftPass);
btnAugmentStart.addEventListener('click', draftStart);
