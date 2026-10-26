// WebSocket client for a server-authoritative game room — the app's
// netclient.js, same protocol (see that file's header). Reconnects with
// backoff on any unexpected close, reclaiming the seat with its token.
import { SERVER_URL, WS_URL } from './config.js';
import { authReady, currentSession } from './auth.js';

const seats = new Map(); // gameId -> { color, token }, for reconnecting

let ws = null;
let gameId = null;
let color = null;
let reconnectAttempt = 0;
let reconnectTimer = null;
let intentionalClose = false;
const cb = {
  state() {}, rejected() {}, open() {}, close() {}, joined() {}, reconnecting() {}, chat() {}, rating() {},
};

function wsUrl(id) {
  const saved = seats.get(id);
  const qs = saved ? `?color=${saved.color}&token=${saved.token}` : '';
  return `${WS_URL}/ws/${id}${qs}`;
}

export async function createRoom() {
  const res = await fetch(`${SERVER_URL}/api/games`, { method: 'POST' });
  const data = await res.json();
  return data.gameId;
}

function sendAuth(sock) {
  authReady.then(() => {
    const session = currentSession();
    if (session && sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify({ type: 'auth', accessToken: session.access_token }));
  });
}

function scheduleReconnect() {
  if (reconnectTimer || !gameId) return;
  reconnectAttempt++;
  cb.reconnecting(reconnectAttempt);
  const delay = Math.min(500 * 2 ** (reconnectAttempt - 1), 8000);
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(gameId); }, delay);
}

export function connect(id) {
  if (ws) { const old = ws; ws = null; old.close(); }
  gameId = id;
  intentionalClose = false;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  const sock = ws = new WebSocket(wsUrl(id));
  sock.onopen = () => {
    if (sock !== ws) return;
    reconnectAttempt = 0;
    cb.open();
  };
  sock.onmessage = (ev) => {
    if (sock !== ws) return;
    let msg;
    try { msg = JSON.parse(ev.data); } catch (e) { return; }
    if (msg.type === 'joined') {
      color = msg.color;
      if (color && msg.token) seats.set(id, { color, token: msg.token });
      if (!msg.ranked || !color) sendAuth(sock); // casual: names you in the game history
      cb.joined(color, !!msg.ranked);
    } else if (msg.type === 'state') {
      cb.state(msg.state, msg.now);
    } else if (msg.type === 'actionRejected') {
      cb.rejected(msg.reason);
    } else if (msg.type === 'chat' || msg.type === 'chatHistory') {
      cb.chat(msg);
    } else if (msg.type === 'rating') {
      cb.rating(msg);
    }
  };
  sock.onclose = () => {
    if (sock !== ws) return;
    cb.close();
    if (!intentionalClose) scheduleReconnect();
  };
  sock.onerror = () => {};
}

export function disconnect() {
  intentionalClose = true;
  color = null;
  gameId = null;
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (ws) { try { ws.close(); } catch (e) { /* already closed */ } }
  ws = null;
}

export function send(action) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(action));
}

export const net = {
  get active() { return !!ws && ws.readyState === WebSocket.OPEN; },
  get myColor() { return color; },
  get gameId() { return gameId; },
  on(name, fn) { cb[name] = fn; },
};

// Matchmaking queue (server/matchmaking.js): resolves listeners with
// queued/matched/queueError messages. Returns a cancel function.
export function joinQueue(ranked, { onQueued, onMatched, onError }) {
  const sock = new WebSocket(`${WS_URL}/ws/queue`);
  let done = false;
  sock.onopen = () => authReady.then(() => {
    const session = currentSession();
    const accessToken = ranked && session ? session.access_token : undefined;
    sock.send(JSON.stringify({ type: 'queue', mode: ranked ? 'ranked' : 'casual', accessToken }));
  });
  sock.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'queued') onQueued(msg);
    else if (msg.type === 'matched') { done = true; sock.close(); onMatched(msg.gameId); }
    else if (msg.type === 'queueError') { done = true; sock.close(); onError(msg.reason); }
  };
  sock.onclose = () => { if (!done) { done = true; onError('Lost connection to the server — try again.'); } };
  return () => { done = true; sock.close(); };
}
