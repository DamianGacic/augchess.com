/**
 * abilities.js — Two 8-slot ability clusters, one per player, both visible at
 * the same time. Up to 4 unit abilities (Q/W/E/R, tied to whichever piece
 * THAT player currently has selected) and up to 4 global abilities (A/S/D/F).
 *
 * Availability/legality of an ability lives in engine/augments-engine.js
 * (unitAbilitiesFor/globalAbilitiesFor/armAbility/castAbility) — this file
 * only renders those lists and turns key presses/clicks into dispatch() calls
 * (armAbility for Stunlock, which resolves after a later move; castAbility
 * directly for Advance, a global ability with no targeting step) or into
 * client-local targeting mode (Solar Strike, which casts directly once a
 * center square is chosen — see solarstrike.js).
 */

const ABILITY_UNIT_KEYS = ['Q', 'W', 'E', 'R'];
const ABILITY_GLOBAL_KEYS = ['A', 'S', 'D', 'F'];
const ABILITY_COLORS = ['w', 'b'];
const ABILITY_META = {
  stunlock: { icon: '⚡', label: 'Stunlock' },
  solarStrike: { icon: '☀', label: 'Solar Strike' },
  breakingRank: { icon: '💥', label: 'Breaking Rank (passive)' },
  advance: { icon: '⏫', label: 'Advance' },
  kingsLightning: { icon: '🌩', label: 'I Am Lightning' },
  ringOfFire: { icon: '🔥', label: 'Ring of Fire' },
  clubbing: { icon: '🔨', label: 'Clubbing' },
  silverBullet: { icon: '🎯', label: 'Silver Bullet' },
  unstableFireball: { icon: '🔥', label: 'Unstable Fireball' },
  unstableTeleport: { icon: '✨', label: 'Unstable Teleport' },
};

function renderAbilityBar() {
  ABILITY_COLORS.forEach(renderAbilityCluster);
}

function renderAbilityCluster(color) {
  const selectedPiece = selectedSquare ? pieceAt(state, selectedSquare) : null;
  const isThisClusterActive = !state.gameOver && selectedPiece && selectedPiece.color === color;
  const unitList = isThisClusterActive ? unitAbilitiesFor(state, selectedSquare) : [];
  const globalList = state.gameOver ? [] : globalAbilitiesFor(state, color);
  ABILITY_UNIT_KEYS.forEach((key, i) => renderAbilitySlot(color, key, unitList[i]));
  ABILITY_GLOBAL_KEYS.forEach((key, i) => renderAbilitySlot(color, key, globalList[i]));
}

function isAbilityArmed(ability, key) {
  if (ability.id === 'stunlock') {
    return !!(state.armedAbility && state.armedAbility.key === key && state.armedAbility.unitSq === selectedSquare);
  }
  if (ability.id === 'solarStrike') {
    return solarStrikeTargeting && pendingSolarStrike && pendingSolarStrike.queenSq === selectedSquare;
  }
  if (ability.id === 'clubbing') {
    return clubbingTargeting && pendingClubbing && pendingClubbing.trollSq === selectedSquare;
  }
  if (ability.id === 'silverBullet') {
    return silverBulletTargeting && pendingSilverBullet && pendingSilverBullet.kingSq === selectedSquare;
  }
  if (ability.id === 'unstableFireball') {
    return unstableFireballTargeting && pendingUnstableFireball && pendingUnstableFireball.apprenticeSq === selectedSquare;
  }
  if (ability.id === 'unstableTeleport') {
    return unstableTeleportTargeting && pendingUnstableTeleport && pendingUnstableTeleport.apprenticeSq === selectedSquare;
  }
  return false;
}

function renderAbilitySlot(color, key, ability) {
  const el = document.getElementById('ability-slot-' + color + '-' + key);
  if (!el) return;
  el.innerHTML = `<span class="ability-key">${key}</span>`;
  el.classList.toggle('empty', !ability);
  el.classList.toggle('passive', !!(ability && ability.passive));
  el.classList.toggle('armed', !!(ability && !ability.passive && isAbilityArmed(ability, key)));
  if (ability) {
    const meta = ABILITY_META[ability.id] || { icon: '?', label: ability.id };
    const icon = document.createElement('span');
    icon.className = 'ability-icon';
    icon.textContent = meta.icon;
    el.appendChild(icon);
    el.title = meta.label + ' (' + key + ')';
    el.dataset.abilityId = ability.id;
  } else {
    el.title = '';
    delete el.dataset.abilityId;
  }
}

// Dispatches a key press on either ability row to the right handler: the
// unit row (Q/W/E/R, tied to the selected piece) or the global row (A/S/D/F,
// standalone — Advance casts directly, Breaking Rank is passive and ignores
// the press).
function toggleAbility(key, color) {
  if (ABILITY_GLOBAL_KEYS.includes(key)) { castGlobalAbility(key, color); return; }
  toggleUnitAbility(key, color);
}

// Arm/disarm (Stunlock) or begin targeting (Solar Strike) the ability bound to
// `key` for `color`'s selected unit. `color` must match the currently
// selected piece's owner.
function toggleUnitAbility(key, color) {
  if (state.gameOver || !selectedSquare) return;
  const piece = pieceAt(state, selectedSquare);
  if (!piece || piece.color !== color) return;
  if (netMode && myColor !== color) return;
  const idx = ABILITY_UNIT_KEYS.indexOf(key);
  if (idx === -1) return;
  const ability = unitAbilitiesFor(state, selectedSquare)[idx];
  if (!ability) return;

  if (ability.id === 'solarStrike') {
    if (solarStrikeTargeting && pendingSolarStrike && pendingSolarStrike.queenSq === selectedSquare) {
      cancelSolarStrikeTargeting();
    } else {
      beginSolarStrikeTargeting(selectedSquare, color);
    }
    renderAbilityBar();
    return;
  }

  if (ability.id === 'clubbing') {
    if (clubbingTargeting && pendingClubbing && pendingClubbing.trollSq === selectedSquare) {
      cancelClubbingTargeting();
    } else {
      beginClubbingTargeting(selectedSquare, color);
    }
    renderAbilityBar();
    return;
  }

  if (ability.id === 'silverBullet') {
    if (silverBulletTargeting && pendingSilverBullet && pendingSilverBullet.kingSq === selectedSquare) {
      cancelSilverBulletTargeting();
    } else {
      beginSilverBulletTargeting(selectedSquare, color);
    }
    renderAbilityBar();
    return;
  }

  if (ability.id === 'unstableFireball') {
    if (unstableFireballTargeting && pendingUnstableFireball && pendingUnstableFireball.apprenticeSq === selectedSquare) {
      cancelUnstableFireballTargeting();
    } else {
      beginUnstableFireballTargeting(selectedSquare, color);
    }
    renderAbilityBar();
    return;
  }

  if (ability.id === 'unstableTeleport') {
    if (unstableTeleportTargeting && pendingUnstableTeleport && pendingUnstableTeleport.apprenticeSq === selectedSquare) {
      cancelUnstableTeleportTargeting();
    } else {
      beginUnstableTeleportTargeting(selectedSquare, color);
    }
    renderAbilityBar();
    return;
  }

  dispatch({ type: 'armAbility', key, unitSq: selectedSquare });
}

// Casts a global-row ability directly (no arming, no targeting — Advance is
// the only one so far; Breaking Rank is passive and never reaches here since
// it's filtered out below).
function castGlobalAbility(key, color) {
  if (state.gameOver) return;
  if (netMode && myColor !== color) return;
  if (color !== state.game.turn()) return;
  const idx = ABILITY_GLOBAL_KEYS.indexOf(key);
  const ability = globalAbilitiesFor(state, color)[idx];
  if (!ability || ability.passive) return;
  dispatch({ type: 'castAbility', id: ability.id });
}

// Esc/Backspace: cancel whatever's in progress but not yet resolved.
function cancelArmedAbility() {
  if (stunlockTargeting && state.pendingStunlock) { onStunlockSkip(); return; }
  if (solarStrikeTargeting) { cancelSolarStrikeTargeting(); return; }
  if (silverBulletTargeting) { cancelSilverBulletTargeting(); return; }
  if (unstableFireballTargeting) { cancelUnstableFireballTargeting(); return; }
  if (unstableTeleportTargeting) { cancelUnstableTeleportTargeting(); return; }
  if (state.armedAbility) { dispatch({ type: 'cancelAbility' }); }
}

document.addEventListener('keydown', (e) => {
  const tag = e.target && e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  if (state.phase !== 'playing') return;

  if (e.key === 'Escape' || e.key === 'Backspace') {
    cancelArmedAbility();
    return;
  }
  if (!isMyTurn()) return;
  const key = e.key.toUpperCase();
  if (ABILITY_UNIT_KEYS.includes(key) || ABILITY_GLOBAL_KEYS.includes(key)) toggleAbility(key, state.game.turn());
});

document.addEventListener('DOMContentLoaded', () => {
  ABILITY_COLORS.forEach(color => {
    ABILITY_UNIT_KEYS.concat(ABILITY_GLOBAL_KEYS).forEach(key => {
      const el = document.getElementById('ability-slot-' + color + '-' + key);
      if (el) el.addEventListener('click', () => toggleAbility(key, color));
    });
  });
  renderAbilityBar();
});
