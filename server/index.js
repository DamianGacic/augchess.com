/**
 * server/index.js — Single Node process serving the static site AND the
 * WebSocket game protocol on one port. Room creation is a small REST
 * endpoint (mirrors the old "Create Game Link" flow); everything else about
 * a game happens over `/ws/:gameId`.
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { RoomStore } = require('./rooms.js');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.PORT || 8000;

const store = new RoomStore();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
};

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const full = path.normalize(path.join(ROOT, urlPath));
  if (!full.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(full)] || 'application/octet-stream',
      // Short window: cuts repeat-load bandwidth (the free tier's real limit)
      // without holding stale assets long after a deploy during active dev.
      'Cache-Control': 'public, max-age=300',
    });
    res.end(data);
  });
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/games') {
    const room = store.create();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ gameId: room.id }));
    return;
  }
  if (req.method === 'GET' && req.url.startsWith('/api/games/')) {
    const id = req.url.slice('/api/games/'.length);
    const room = store.get(id);
    res.writeHead(room ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ exists: !!room }));
    return;
  }
  serveStatic(req, res);
});

const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const match = url.pathname.match(/^\/ws\/([a-f0-9]+)$/);
  if (!match) { socket.destroy(); return; }
  const room = store.get(match[1]);
  if (!room) { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req, room, url);
  });
});

wss.on('connection', (ws, req, room, url) => {
  const reconnectColor = url.searchParams.get('color');
  const reconnectToken = url.searchParams.get('token');

  let assignment;
  if ((reconnectColor === 'w' || reconnectColor === 'b') && reconnectToken &&
      room.reconnect(ws, reconnectColor, reconnectToken)) {
    assignment = { color: reconnectColor, token: reconnectToken };
  } else {
    assignment = room.join(ws);
  }

  ws.send(JSON.stringify({ type: 'joined', color: assignment.color, token: assignment.token }));
  // Broadcast (not just sendState to the new socket) so everyone already in
  // the room — the host waiting on "Share this link", other spectators —
  // finds out someone new arrived too, not just the arriver.
  room.broadcast();

  ws.on('message', (raw) => {
    let action;
    try { action = JSON.parse(raw); } catch (e) { return; }
    room.applyAction(ws, action);
  });

  ws.on('close', () => room.leave(ws));
});

server.listen(PORT, () => {
  console.log(`AugChess server listening on http://localhost:${PORT}`);
});

// Last-resort safety net: log and keep serving other rooms/players rather
// than taking the whole process (and every in-progress game) down. The real
// fix for any specific bug still belongs in a try/catch closer to the
// source (see GameRoom.applyAction) — this is only a backstop.
process.on('uncaughtException', (err) => {
  console.error('uncaughtException (server kept running):', err);
});
process.on('unhandledRejection', (err) => {
  console.error('unhandledRejection (server kept running):', err);
});
