/**
 * draft.js — Pre-game settings + augment draft UI. All the actual rules
 * (affordability, exclusivity, prerequisites, when the draft finishes) live
 * in engine/draft-engine.js; this file only renders `state` and turns clicks
 * into dispatch() calls — see app.js for the dispatch/state model.
 */

// ─── Augment Draft DOM Refs ───────────────────────────────────────────────────
const augmentModal        = document.getElementById('augment-modal');
const augmentColOther     = document.getElementById('augment-col-other');
const augmentColExchange  = document.getElementById('augment-col-exchange');
const augmentColAbility   = document.getElementById('augment-col-ability');
const augmentTurnText  = document.getElementById('augment-turn-text');
const apWhiteEl       = document.getElementById('ap-white');
const apBlackEl       = document.getElementById('ap-black');
const apBoxWhite      = document.getElementById('augment-points-white');
const apBoxBlack      = document.getElementById('augment-points-black');
const btnAugmentPass  = document.getElementById('btn-augment-pass');
const btnAugmentStart = document.getElementById('btn-augment-start');

// ─── Pre-Draft Game Settings ──────────────────────────────────────────────────
const settingsModal     = document.getElementById('settings-modal');
const settingsTcOptions = document.getElementById('settings-tc-options');
const settingsPtOptions = document.getElementById('settings-points-options');
const btnSettingsStart  = document.getElementById('btn-settings-start');

function showGameSettings() {
  settingsModal.classList.remove('hidden');
  syncSettingsUI();
}

function syncSettingsUI() {
  settingsTcOptions.querySelectorAll('.tc-btn').forEach(b => {
    b.classList.toggle('selected', parseInt(b.dataset.minutes) === state.settings.minutes);
  });
  settingsPtOptions.querySelectorAll('.tc-btn').forEach(b => {
    b.classList.toggle('selected', parseInt(b.dataset.points) === state.settings.points);
  });
}

settingsTcOptions.querySelectorAll('.tc-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    dispatch({ type: 'settingsUpdate', minutes: parseInt(btn.dataset.minutes), points: state.settings.points });
  });
});

settingsPtOptions.querySelectorAll('.tc-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    dispatch({ type: 'settingsUpdate', minutes: state.settings.minutes, points: parseInt(btn.dataset.points) });
  });
});

btnSettingsStart.addEventListener('click', () => {
  dispatch({ type: 'settingsStart' });
});

// exchangeType(aug) comes from engine/draft-engine.js (loaded before this file).

// Which draft column an augment belongs in.
function augmentColumn(aug) {
  if (aug.exchanges) return augmentColExchange;
  if (aug.category === 'ability') return augmentColAbility;
  return augmentColOther;
}

function renderDraft() {
  const ds = state.draftState;
  apWhiteEl.textContent = ds.points.w;
  apBlackEl.textContent = ds.points.b;
  apBoxWhite.classList.toggle('active', ds.current === 'w');
  apBoxBlack.classList.toggle('active', ds.current === 'b');

  const who = ds.current === 'w' ? 'White' : 'Black';
  augmentTurnText.textContent = `${who}, choose an augment (or pass)`;

  const canInteract = !netMode || myColor === ds.current;
  btnAugmentPass.disabled = !canInteract;

  [augmentColOther, augmentColExchange, augmentColAbility].forEach(col => {
    col.querySelectorAll('.augment-card').forEach(card => card.remove());
  });

  const byPrice = [...AUGMENTS].sort((a, b) => a.cost - b.cost);
  byPrice.forEach(aug => {
    if (aug.requires && !ds.owned[ds.current].includes(aug.requires)) return;

    const card = document.createElement('button');
    card.className = 'augment-card cost-' + aug.cost;

    const ownerW = ds.owned.w.includes(aug.id);
    const ownerB = ds.owned.b.includes(aug.id);
    const ownedByCurrent = ds.owned[ds.current].includes(aug.id);
    const affordable = ds.points[ds.current] >= aug.cost;
    const exType = exchangeType(aug);
    const conflictsWithOwned = exType && ds.owned[ds.current].some(ownedId => {
      const ownedAug = AUGMENTS.find(a => a.id === ownedId);
      return ownedAug && exchangeType(ownedAug) === exType;
    });
    const otherColor = ds.current === 'w' ? 'b' : 'w';
    const takenByOpponent = ds.owned[otherColor].includes(aug.id);
    const disabled = ownedByCurrent || !affordable || conflictsWithOwned || takenByOpponent || !canInteract;

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
      card.addEventListener('click', () => dispatch({ type: 'draftPick', augId: aug.id }));
    }
    augmentColumn(aug).appendChild(card);
  });
}

// ─── Draft Button Listeners ───────────────────────────────────────────────────
btnAugmentPass.addEventListener('click', () => dispatch({ type: 'draftPass' }));
