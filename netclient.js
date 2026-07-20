/**
 * netclient.js — WebSocket client for a server-authoritative game room.
 * Replaces multiplayer.js (peer-to-peer WebRTC). Owns the connection
 * lifecycle (create/join/reconnect) and the action/state wire protocol;
 * app.js decides what to do with each incoming state — this file only
 * moves bytes.
 *
 * Reconnects automatically (with backoff) on any unexpected close, using the
 * seat's reconnect token saved in sessionStorage — a dropped connection
 * (flaky wifi, a tunnel hiccup, a laptop sleeping) must never leave the
 * client silently unable to send anything with no feedback: that's
 * indistinguishable from "my clicks just don't work."
 *
 * Protocol (mirrors server/rooms.js + engine/index.js):
 *   Client -> server: any {type: 'move'|'draftPick'|'draftPass'|'settingsUpdate'|
 *     'settingsStart'|'armAbility'|'castAbility'|'cancelAbility'|'newGame', ...}
 *   Server -> client: {type:'joined', color, token}, {type:'state', state},
 *     {type:'actionRejected', reason}
 */
const NetClient = (function () {
  let ws = null;
  let gameId = null;
  let color = null;
  let token = null;
  let onStateCb = () => {};
  let onRejectedCb = () => {};
  let onOpenCb = () => {};
  let onCloseCb = () => {};
  let onJoinedCb = () => {};
  let onReconnectingCb = () => {};
  let reconnectAttempt = 0;
  let reconnectTimer = null;
  let intentionalClose = false;

  function storageKey(id) { return 'augchess:' + id; }

  function wsUrl(id) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const params = new URLSearchParams();
    const saved = sessionStorage.getItem(storageKey(id));
    if (saved) {
      try {
        const { color: c, token: t } = JSON.parse(saved);
        if (c && t) { params.set('color', c); params.set('token', t); }
      } catch (e) { /* ignore malformed storage */ }
    }
    const qs = params.toString();
    return `${proto}//${location.host}/ws/${id}` + (qs ? `?${qs}` : '');
  }

  async function createRoom() {
    const res = await fetch('/api/games', { method: 'POST' });
    const data = await res.json();
    return data.gameId;
  }

  function scheduleReconnect() {
    if (reconnectTimer || !gameId) return;
    reconnectAttempt++;
    onReconnectingCb(reconnectAttempt);
    const delay = Math.min(500 * 2 ** (reconnectAttempt - 1), 8000);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect(gameId);
    }, delay);
  }

  function connect(id) {
    gameId = id;
    intentionalClose = false;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    ws = new WebSocket(wsUrl(id));
    ws.addEventListener('open', () => {
      reconnectAttempt = 0;
      onOpenCb();
    });
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.type === 'joined') {
        color = msg.color;
        token = msg.token;
        if (color && token) sessionStorage.setItem(storageKey(id), JSON.stringify({ color, token }));
        onJoinedCb(color, token);
      } else if (msg.type === 'state') {
        onStateCb(msg.state);
      } else if (msg.type === 'actionRejected') {
        onRejectedCb(msg.reason);
      }
    });
    ws.addEventListener('close', () => {
      onCloseCb();
      if (!intentionalClose) scheduleReconnect();
    });
    // 'error' is always followed by a 'close' event for WebSocket, which is
    // what actually triggers the reconnect — this listener just prevents an
    // unhandled-error console spew.
    ws.addEventListener('error', () => {});
  }

  function disconnect() {
    intentionalClose = true;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (ws) { try { ws.close(); } catch (e) { /* already closed */ } }
  }

  function send(action) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(action));
  }

  return {
    createRoom,
    connect,
    disconnect,
    send,
    get active() { return !!ws && ws.readyState === WebSocket.OPEN; },
    get myColor() { return color; },
    get gameId() { return gameId; },
    // Read-only escape hatch for diagnostics/testing — e.g. simulating an
    // involuntary drop with socket.close() (unlike disconnect(), this does
    // NOT set intentionalClose, so the normal auto-reconnect still kicks in,
    // exactly like a real dropped connection would).
    get socket() { return ws; },
    onState(cb) { onStateCb = cb; },
    onRejected(cb) { onRejectedCb = cb; },
    onOpen(cb) { onOpenCb = cb; },
    onClose(cb) { onCloseCb = cb; },
    // Fires the instant the server's {type:'joined'} reply is parsed — the
    // only point color/token are actually known. Prefer this over reading
    // NetClient.myColor inside onOpen: 'open' fires on the raw WS handshake,
    // strictly before the server's application-level reply can have arrived.
    onJoined(cb) { onJoinedCb = cb; },
    // Fires (with the 1-based attempt number) whenever a reconnect attempt
    // is scheduled after an unexpected close.
    onReconnecting(cb) { onReconnectingCb = cb; },
  };
})();

// ─── URL helpers (mirrors old multiplayer.js) ─────────────────────────────────
function getGameIdFromUrl() {
  return new URLSearchParams(window.location.search).get('game');
}
function buildGameUrl(gameId) {
  const url = new URL(window.location.href);
  url.searchParams.set('game', gameId);
  url.hash = '';
  return url.toString();
}
