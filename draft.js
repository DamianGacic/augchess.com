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

  // In multiplayer, only the player whose color matches the current draft turn may pick
  if (mpActive() && ds.current !== mpMyColor) return;

  ds.points[ds.current] -= aug.cost;
  ds.owned[ds.current].push(augId);
  ds.passed[ds.current] = false;

  mpBroadcastDraftPick(augId, ds.current);
  advanceDraft();
}

function draftPass() {
  const ds = draftState;

  // In multiplayer, only the player whose color matches the current draft turn may pass
  if (mpActive() && ds.current !== mpMyColor) return;

  mpBroadcastDraftPass(ds.current);
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
  // Auto-start the game without requiring a button click.
  // In multiplayer: only the host broadcasts the start; the guest waits for the
  // 'draftStart' message so we don't get a double-start race.
  if (mpActive() && mpRole === 'guest') {
    // Guest: just wait — the host will broadcast draftStart and we'll mirror it.
    // Show a brief "waiting" message in case the host hasn't finished yet.
    btnAugmentPass.classList.add('hidden');
    btnAugmentStart.classList.add('hidden');
    augmentTurnText.textContent = 'Draft complete! Starting game…';
    augmentListEl.innerHTML = '';
    return;
  }
  // Host or local game: start immediately (host also broadcasts to guest).
  draftStart(false);
}

// Called by the "Start Game" button (local player) or by multiplayer.js (remote mirror).
// `fromRemote` prevents re-broadcasting back to the peer.
function draftStart(fromRemote) {
  if (!fromRemote) {
    mpBroadcastDraftStart();
  }
  augments = { w: [...draftState.owned.w], b: [...draftState.owned.b] };
  augmentModal.classList.add('hidden');
  newGame();
}

// ─── Draft Button Listeners ───────────────────────────────────────────────────
btnAugmentPass.addEventListener('click', draftPass);
btnAugmentStart.addEventListener('click', draftStart);
