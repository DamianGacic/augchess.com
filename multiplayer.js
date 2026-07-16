/**
 * multiplayer.js — Peer-to-peer 1v1 multiplayer via PeerJS (WebRTC).
 *
 * Flow:
 *   HOST:  clicks "Create Game Link" → gets a Peer ID → shares URL with ?game=<id>
 *          waits for guest to connect → host plays White, guest plays Black
 *   GUEST: opens the link → auto-connects to host → plays Black
 *
 * Message protocol (JSON over PeerJS DataConnection):
 *   { type: 'hello',       role: 'guest' }
 *   { type: 'start',       augments: {w,b}, minutes: number }
 *   { type: 'draftPick',   augId: string, color: 'w'|'b' }
 *   { type: 'draftPass',   color: 'w'|'b' }
 *   { type: 'draftStart' }
 *   { type: 'move',        move: {...}, promotionChoice: string|null }
 *   { type: 'newGame' }
 */

// ─── Multiplayer session state ─────────────────────────────────────────────────
class MultiplayerSession {
  constructor() {
    this.peer = null;
    this.conn = null;
    this.role = null;
    this.myColor = null;
    this.connected = false;
    this.connectTimer = null;
  }

  reset() {
    this._clearConnectTimer();
    this.peer = null;
    this.conn = null;
    this.role = null;
    this.myColor = null;
    this.connected = false;
  }

  _clearConnectTimer() {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
  }

  active() {
    return this.connected && this.conn !== null;
  }

  send(msg) {
    if (this.conn && this.conn.open) {
      this.conn.send(JSON.stringify(msg));
    }
  }

  destroyPeer() {
    if (this.peer) {
      try { this.peer.destroy(); } catch (e) {}
    }
    this.reset();
  }

  createGameLink() {
    showMpModal('Create Game Link', 'Generating your game link…', false, true);

    this.destroyPeer();
    this.peer = new Peer(undefined, { debug: 0 });

    this.peer.on('open', (id) => {
      this.role = 'host';
      this.myColor = 'w';
      const url = buildGameUrl(id);
      mpLinkInput.value = url;
      showMpModal(
        'Share this link',
        'Send this link to your friend. You will play as White.',
        true, true
      );
      updateMpBadge();
    });

    this.peer.on('connection', (conn) => {
      this.conn = conn;
      this.setupConnection(conn);
    });

    this.peer.on('error', (err) => {
      updateMpStatus('Connection error: ' + err.message);
      document.getElementById('mp-spinner').classList.add('hidden');
    });
  }

  joinGame(hostId) {
    showMpModal('Joining Game', 'Connecting to host…', false, true);

    this.destroyPeer();
    this.peer = new Peer(undefined, { debug: 0 });
    this._clearConnectTimer();

    this.peer.on('open', () => {
      this.role = 'guest';
      this.myColor = 'b';
      flipped = true;
      const conn = this.peer.connect(hostId, { reliable: true });
      this.conn = conn;
      this.setupConnection(conn);

      this.connectTimer = setTimeout(() => {
        if (!this.connected) {
          updateMpStatus('Unable to connect to host. Please verify the link and try again.');
          document.getElementById('mp-spinner').classList.add('hidden');
          if (this.conn && this.conn.close) {
            try { this.conn.close(); } catch (e) {}
          }
        }
      }, 10000);
    });

    this.peer.on('error', (err) => {
      updateMpStatus('Connection error: ' + err.message);
      document.getElementById('mp-spinner').classList.add('hidden');
      this._clearConnectTimer();
    });
  }

  setupConnection(conn) {
    conn.on('open', () => {
      this.connected = true;
      this._clearConnectTimer();

      if (this.role === 'host') {
        this.send({ type: 'hello', role: 'host' });
        showMpModal(
          'Opponent Connected!',
          'Your friend has joined. Starting draft…',
          false, false
        );
        updateMpBadge();
        setTimeout(() => {
          mpModal.classList.add('hidden');
          showView('game');
          startAugmentDraft();
        }, 1200);
      } else {
        this.send({ type: 'hello', role: 'guest' });
        showMpModal(
          'Connected!',
          'Connected to host. Waiting for draft to begin…',
          false, true
        );
        updateMpBadge();
        setTimeout(() => {
          mpModal.classList.add('hidden');
          showView('game');
          startAugmentDraft();
        }, 800);
      }
    });

    conn.on('data', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch (e) { return; }
      handleMpMessage(msg);
    });

    conn.on('close', () => {
      const wasConnected = this.connected;
      this.connected = false;
      updateMpBadge();
      if (mpStatusEl) {
        if (!wasConnected && this.role === 'guest') {
          updateMpStatus('Unable to connect to host. Please verify the link and try again.');
        } else {
          updateMpStatus('Opponent disconnected.');
        }
      }
      document.getElementById('mp-spinner').classList.add('hidden');
      this._clearConnectTimer();
      if (wasConnected) showDisconnectNotice();
    });

    conn.on('error', (err) => {
      if (mpStatusEl && !this.connected) {
        updateMpStatus('Connection failed: ' + (err && err.message ? err.message : 'unknown error'));
        document.getElementById('mp-spinner').classList.add('hidden');
      }
      this._clearConnectTimer();
      console.error('MP conn error', err);
    });
  }
}

const mpSession = new MultiplayerSession();

const mpGlobal = typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : globalThis;
Object.defineProperty(mpGlobal, 'mpRole', {
  configurable: true,
  enumerable: true,
  get() { return mpSession.role; },
  set(value) { mpSession.role = value; },
});
Object.defineProperty(mpGlobal, 'mpMyColor', {
  configurable: true,
  enumerable: true,
  get() { return mpSession.myColor; },
  set(value) { mpSession.myColor = value; },
});

// ─── DOM refs (created dynamically) ──────────────────────────────────────────
let mpModal      = null;
let mpStatusEl   = null;
let mpLinkInput  = null;
let mpCopyBtn    = null;
let mpCloseBtn   = null;

// ─── Public helpers ───────────────────────────────────────────────────────────

/** True when we are in a live multiplayer session */
function mpActive() { return mpSession.active(); }

/** True when it is this client's turn to move */
function mpIsMyTurn() {
  if (!mpActive()) return true; // local game — always allowed
  return game.turn() === mpSession.myColor;
}

/** Send a message to the peer */
function mpSend(msg) {
  mpSession.send(msg);
}

// ─── UI helpers ───────────────────────────────────────────────────────────────
function buildMpModal() {
  if (mpModal) return;

  mpModal = document.createElement('div');
  mpModal.id = 'mp-modal';
  mpModal.className = 'modal hidden';
  mpModal.innerHTML = `
    <div class="modal-content mp-modal-content">
      <h3 id="mp-modal-title">Multiplayer</h3>
      <p id="mp-status" class="mp-status"></p>
      <div id="mp-link-row" class="mp-link-row hidden">
        <input id="mp-link-input" class="mp-link-input" type="text" readonly />
        <button id="mp-copy-btn" class="btn btn-secondary mp-copy-btn">Copy</button>
      </div>
      <div id="mp-spinner" class="mp-spinner hidden">
        <div class="mp-dot"></div><div class="mp-dot"></div><div class="mp-dot"></div>
      </div>
      <button id="mp-close-btn" class="btn btn-secondary" style="margin-top:16px">Close</button>
    </div>`;
  document.body.appendChild(mpModal);

  mpStatusEl  = document.getElementById('mp-status');
  mpLinkInput = document.getElementById('mp-link-input');
  mpCopyBtn   = document.getElementById('mp-copy-btn');
  mpCloseBtn  = document.getElementById('mp-close-btn');

  mpCopyBtn.addEventListener('click', () => {
    mpLinkInput.select();
    navigator.clipboard.writeText(mpLinkInput.value).then(() => {
      mpCopyBtn.textContent = 'Copied!';
      setTimeout(() => { mpCopyBtn.textContent = 'Copy'; }, 2000);
    }).catch(() => {
      document.execCommand('copy');
      mpCopyBtn.textContent = 'Copied!';
      setTimeout(() => { mpCopyBtn.textContent = 'Copy'; }, 2000);
    });
  });

  mpCloseBtn.addEventListener('click', () => {
    mpModal.classList.add('hidden');
  });

  // Close on backdrop click
  mpModal.addEventListener('click', (e) => {
    if (e.target === mpModal) mpModal.classList.add('hidden');
  });
}

function showMpModal(title, status, showLink, showSpinner) {
  buildMpModal();
  document.getElementById('mp-modal-title').textContent = title;
  mpStatusEl.textContent = status;
  document.getElementById('mp-link-row').classList.toggle('hidden', !showLink);
  document.getElementById('mp-spinner').classList.toggle('hidden', !showSpinner);
  mpModal.classList.remove('hidden');
}

function updateMpStatus(text) {
  if (mpStatusEl) mpStatusEl.textContent = text;
  // Also update the persistent connection badge in the header
  updateMpBadge();
}

function updateMpBadge() {
  const badge = document.getElementById('mp-badge');
  if (!badge) return;
  if (mpSession.connected) {
    const colorLabel = mpSession.myColor === 'w' ? 'White' : 'Black';
    badge.textContent = `🟢 Online · You are ${colorLabel}`;
    badge.classList.remove('hidden');
  } else if (mpSession.role === 'host' && !mpSession.connected) {
    badge.textContent = '⏳ Waiting for opponent…';
    badge.classList.remove('hidden');
  } else {
    badge.classList.add('hidden');
  }
}

// ─── Create Game (Host) ───────────────────────────────────────────────────────
function createGameLink() {
  mpSession.createGameLink();
}

// ─── Join Game (Guest) ────────────────────────────────────────────────────────
function joinGame(hostId) {
  mpSession.joinGame(hostId);
}

// ─── Connection Setup ─────────────────────────────────────────────────────────
function setupConnection(conn) {
  conn.on('open', () => {
    mpSession.connected = true;
    if (mpSession.connectTimer) {
      clearTimeout(mpSession.connectTimer);
      mpSession.connectTimer = null;
    }

    if (mpSession.role === 'host') {
      // Tell guest they connected
      mpSend({ type: 'hello', role: 'host' });
      showMpModal(
        'Opponent Connected!',
        'Your friend has joined. Starting draft…',
        false, false
      );
      updateMpBadge();
      // Host kicks off the draft — guest will mirror it via 'draftPick'/'draftPass' messages
      setTimeout(() => {
        mpModal.classList.add('hidden');
        showView('game');
        startAugmentDraft();
      }, 1200);
    } else {
      // Guest: navigate to game view and open the draft modal (host will drive it)
      mpSend({ type: 'hello', role: 'guest' });
      showMpModal(
        'Connected!',
        'Connected to host. Waiting for draft to begin…',
        false, true
      );
      updateMpBadge();
      // Pre-navigate to game view so the draft modal appears in the right place
      setTimeout(() => {
        mpModal.classList.add('hidden');
        showView('game');
        // Open the draft modal in a waiting state — host will drive picks
        startAugmentDraft();
      }, 800);
    }
  });

  conn.on('data', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch(e) { return; }
    handleMpMessage(msg);
  });

  conn.on('close', () => {
    const wasConnected = mpSession.connected;
    mpSession.connected = false;
    updateMpBadge();
    if (mpStatusEl) {
      if (!wasConnected && mpSession.role === 'guest') {
        updateMpStatus('Unable to connect to host. Please verify the link and try again.');
      } else {
        updateMpStatus('Opponent disconnected.');
      }
    }
    document.getElementById('mp-spinner').classList.add('hidden');
    if (mpSession.connectTimer) {
      clearTimeout(mpSession.connectTimer);
      mpSession.connectTimer = null;
    }
    if (wasConnected) showDisconnectNotice();
  });
  conn.on('error', (err) => {
    if (mpStatusEl && !mpSession.connected) {
      updateMpStatus('Connection failed: ' + (err && err.message ? err.message : 'unknown error'));
      document.getElementById('mp-spinner').classList.add('hidden');
    }
    if (mpSession.connectTimer) {
      clearTimeout(mpSession.connectTimer);
      mpSession.connectTimer = null;
    }
    console.error('MP conn error', err);
  });
}

// ─── Message Handler ──────────────────────────────────────────────────────────
function handleMpMessage(msg) {
  switch (msg.type) {

    case 'hello':
      // Guest already handled in open; host already handled in open
      break;

    case 'draftPick': {
      // Mirror the remote player's draft pick locally (without re-sending)
      if (!draftState) return;
      const aug = AUGMENTS.find(a => a.id === msg.augId);
      if (!aug) return;
      draftState.points[msg.color] -= aug.cost;
      draftState.owned[msg.color].push(msg.augId);
      draftState.passed[msg.color] = false;
      advanceDraft();
      break;
    }

    case 'draftPass': {
      if (!draftState) return;
      draftState.passed[msg.color] = true;
      advanceDraft();
      break;
    }

    case 'draftStart': {
      // Host auto-started the game — mirror it locally without re-broadcasting.
      // Guard: only act if a draft is still in progress.
      if (draftState) {
        draftStart(true); // fromRemote=true prevents echo back to peer
      }
      break;
    }

    case 'move': {
      // Apply the remote player's move locally
      const move = msg.move;
      const promo = msg.promotionChoice || undefined;
      // Close any pending promotion modal that might be open on our side
      // (shouldn't happen, but guard anyway)
      executeMove(move, promo);
      break;
    }

    case 'newGame': {
      // Remote player started a new game — show the game view and open draft
      showView('game');
      startAugmentDraft();
      break;
    }
  }
}

// ─── Broadcast helpers (called from app.js / draft.js) ───────────────────────

/** Called by draft.js when the LOCAL player picks an augment */
function mpBroadcastDraftPick(augId, color) {
  mpSend({ type: 'draftPick', augId, color });
}

/** Called by draft.js when the LOCAL player passes */
function mpBroadcastDraftPass(color) {
  mpSend({ type: 'draftPass', color });
}

/** Called by draft.js when the LOCAL player clicks "Start Game" */
function mpBroadcastDraftStart() {
  mpSend({ type: 'draftStart' });
}

/** Called by app.js after a LOCAL move is executed */
function mpBroadcastMove(move, promotionChoice) {
  mpSend({ type: 'move', move, promotionChoice: promotionChoice || null });
}

/** Called by app.js when local player starts a new game */
function mpBroadcastNewGame() {
  mpSend({ type: 'newGame' });
}

// ─── URL helpers ─────────────────────────────────────────────────────────────
function buildGameUrl(peerId) {
  const url = new URL(window.location.href);
  url.searchParams.set('game', peerId);
  // Remove hash so the URL is clean
  url.hash = '';
  return url.toString();
}

function getGameIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return params.get('game');
}

// ─── Disconnect notice ────────────────────────────────────────────────────────
function showDisconnectNotice() {
  const notice = document.createElement('div');
  notice.className = 'mp-disconnect-notice';
  notice.textContent = '⚠ Opponent disconnected';
  document.body.appendChild(notice);
  setTimeout(() => notice.remove(), 5000);
}

// ─── Init: check URL on page load ────────────────────────────────────────────
function mpInit() {
  // Inject the connection badge into the header
  const header = document.querySelector('header');
  if (header) {
    const badge = document.createElement('div');
    badge.id = 'mp-badge';
    badge.className = 'mp-badge hidden';
    header.appendChild(badge);
  }

  const gameId = getGameIdFromUrl();
  if (gameId) {
    // Auto-join as guest
    // Wait for DOMContentLoaded / initApp to finish first
    setTimeout(() => joinGame(gameId), 300);
  }
}

// Run after DOM is ready (views.js calls initApp on DOMContentLoaded)
document.addEventListener('DOMContentLoaded', mpInit);
