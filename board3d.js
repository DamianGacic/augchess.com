/**
 * board3d.js — Optional three.js view of the game board, toggled by the
 * "3D Board" button. It only draws: the 2D DOM board (renderBoard in app.js)
 * still renders underneath the canvas and stays the source of truth.
 *   - Square tints come from the DOM squares' classes (selected, legal-move,
 *     targeting zones, ...), so every overlay renderBoard knows about shows up
 *     here as a color without re-deriving it.
 *   - Clicks are raycast to a square and forwarded as a click on the matching
 *     DOM square, so selection, moves and every ability's targeting run
 *     through the exact same handlers (onSquareClick etc.) as the 2D board.
 * Pieces are built from code (lathe profiles); custom figures keep the shape
 * of the piece they replace, with their figures/icons emblem floating above.
 *
 * Loaded as a module (three.js via the importmap in index.html), so it runs
 * after the classic scripts; renderBoard calls window.Board3D.sync().
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const STORAGE_KEY = 'augchess:board3d';
const wrapper = document.querySelector('.board-wrapper');
const toggleBtn = document.getElementById('btn-3d');

// First matching DOM square class wins; plain light/dark otherwise.
const TINTS = [
  ['selected', 0x6fa8ff], ['in-check', 0xe53935], ['check-incoming', 0xff8a65],
  ['shield-pending', 0x9e9e9e], ['shield-choice', 0xcfd8dc],
  ['stunlock-preview', 0x7e57c2], ['stunlock-target', 0xb39ddb],
  ['solarstrike-preview', 0xffb300], ['solarstrike-target', 0xffe082],
  ['clubbing-preview', 0x8d6e63], ['clubbing-target', 0xbcaaa4],
  ['silverbullet-preview', 0x90a4ae], ['silverbullet-target', 0xcfd8dc],
  ['fireball-preview', 0xff7043], ['fireball-target', 0xffab91],
  ['teleport-preview', 0x26c6da], ['teleport-target', 0x80deea],
  ['raisedead-preview', 0x66bb6a], ['raisedead-target', 0xa5d6a7],
  ['legal-capture', 0xef5350], ['legal-shoot', 0xff7043], ['legal-claw', 0xab47bc],
  ['legal-move', 0x81c784],
  ['solar-imminent', 0xff6f00], ['solar-marked', 0xffca28],
  ['fire-priming', 0xff5722], ['fire-zone', 0xffab91], ['fire-king', 0xff8a65],
  ['lightning-zone', 0x80d8ff], ['lightning-king', 0x40c4ff],
  ['stunned', 0x9575cd], ['teleport-marked', 0x4dd0e1],
  ['fire-death-marked', 0xd84315], ['warm-welcome-marked', 0xffcc80],
  ['shoot-range-preview', 0xffccbc], ['claw-range-preview', 0xe1bee7],
  ['broke-rank', 0xce93d8], ['tower', 0x8d8d8d], ['last-move', 0xd4c86a],
];
const LIGHT = 0xeeeed2, DARK = 0x769656;

let enabled = false;
let renderer, scene, camera, controls, piecesGroup, cameraFlipped = null;
const squareMeshes = {};   // 'e4' -> Mesh
const geometryCache = {};
const iconCache = {};
const pieceMats = {
  w: new THREE.MeshStandardMaterial({ color: 0xf5f0e6, roughness: 0.45 }),
  b: new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.4 }),
};

// ─── Piece geometry ───────────────────────────────────────────────────────────
// Profiles are [radius, height] pairs, revolved around the y axis.
function lathe(points) {
  return new THREE.LatheGeometry(points.map(([x, y]) => new THREE.Vector2(x, y)), 24);
}
const BASE = [[0, 0], [0.36, 0], [0.36, 0.08], [0.3, 0.12], [0.22, 0.16]];

function pieceGeometry(type) {
  if (geometryCache[type]) return geometryCache[type];
  const parts = [];
  const add = (g, y = 0) => { g.translate(0, y, 0); parts.push(g); };
  switch (type) {
    case 'p':
      add(lathe([...BASE, [0.13, 0.4], [0.2, 0.44], [0.12, 0.47], [0, 0.47]]));
      add(new THREE.SphereGeometry(0.16, 20, 14), 0.58);
      break;
    case 'r':
      add(lathe([...BASE, [0.22, 0.6], [0.3, 0.62], [0.3, 0.78], [0, 0.78]]));
      for (let i = 0; i < 4; i++) {
        const g = new THREE.BoxGeometry(0.12, 0.12, 0.12);
        g.rotateY((i * Math.PI) / 2);
        g.translate(Math.cos((i * Math.PI) / 2) * 0.22, 0, Math.sin((i * Math.PI) / 2) * 0.22);
        add(g, 0.84);
      }
      break;
    case 'n': {
      add(lathe([...BASE, [0.2, 0.36], [0, 0.36]]));
      const neck = new THREE.BoxGeometry(0.22, 0.46, 0.3);
      neck.rotateX(-0.25);
      add(neck, 0.56);
      const head = new THREE.BoxGeometry(0.2, 0.18, 0.42);
      head.translate(0, 0, 0.12);
      add(head, 0.76);
      break;
    }
    case 'b':
      add(lathe([...BASE, [0.12, 0.6], [0.2, 0.64], [0.1, 0.68], [0, 0.68]]));
      add(new THREE.SphereGeometry(0.17, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.85).scale(1, 1.35, 1), 0.82);
      add(new THREE.SphereGeometry(0.05, 10, 8), 1.06);
      break;
    case 'q':
      add(lathe([...BASE, [0.13, 0.74], [0.24, 0.8], [0.27, 0.92], [0, 0.92]]));
      for (let i = 0; i < 8; i++) {
        const a = (i * Math.PI) / 4;
        add(new THREE.SphereGeometry(0.05, 8, 6).translate(Math.cos(a) * 0.22, 0, Math.sin(a) * 0.22), 0.96);
      }
      add(new THREE.SphereGeometry(0.08, 12, 10), 1.0);
      break;
    case 'k':
      add(lathe([...BASE, [0.14, 0.8], [0.25, 0.86], [0.22, 0.98], [0, 0.98]]));
      add(new THREE.BoxGeometry(0.07, 0.3, 0.07), 1.12);
      add(new THREE.BoxGeometry(0.22, 0.07, 0.07), 1.16);
      break;
  }
  return (geometryCache[type] = parts);
}

// Figure emblem floating above a replaced piece (kingsguard reuses guardsman's).
function iconSprite(key) {
  const id = key === 'kingsguard' ? 'guardsman' : key;
  if (!iconCache[id]) {
    // The icon SVGs have only a viewBox (no width/height), which WebGL can't
    // size — rasterize through a canvas instead.
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const img = new Image();
    img.onload = () => { canvas.getContext('2d').drawImage(img, 0, 0, 128, 128); texture.needsUpdate = true; };
    img.src = `figures/icons/${id}.svg`;
    iconCache[id] = new THREE.SpriteMaterial({ map: texture });
  }
  const sprite = new THREE.Sprite(iconCache[id]);
  sprite.scale.set(0.38, 0.38, 1);
  return sprite;
}

// ─── Scene ────────────────────────────────────────────────────────────────────
// Square 'a1' sits at x=-3.5, z=+3.5 (White's side is +z).
function squarePos(sq) {
  const { f, r } = sqToFR(sq);
  return { x: f - 3.5, z: 3.5 - r };
}

function init() {
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.domElement.id = 'board3d';
  wrapper.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1f1f24);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(4, 10, 6);
  scene.add(sun);

  camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.maxPolarAngle = Math.PI * 0.45;
  controls.minDistance = 6;
  controls.maxDistance = 22;

  const frame = new THREE.Mesh(new THREE.BoxGeometry(8.6, 0.3, 8.6), new THREE.MeshStandardMaterial({ color: 0x4e342e }));
  frame.position.y = -0.2;
  scene.add(frame);
  for (const f of 'abcdefgh') {
    for (const r of '12345678') {
      const sq = f + r;
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 0.1, 1), new THREE.MeshStandardMaterial({ roughness: 0.8 }));
      const { x, z } = squarePos(sq);
      mesh.position.set(x, 0, z);
      mesh.userData.sq = sq;
      squareMeshes[sq] = mesh;
      scene.add(mesh);
    }
  }
  piecesGroup = new THREE.Group();
  scene.add(piecesGroup);

  new ResizeObserver(resize).observe(wrapper);
  resize();
  bindInput();
}

function resize() {
  const w = wrapper.clientWidth, h = wrapper.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function placeCamera() {
  if (cameraFlipped === flipped) return;
  cameraFlipped = flipped;
  // Steep enough that the board fills the frame; aimed a little above the
  // squares so the pieces' height is centered too.
  const side = flipped ? -1 : 1;
  camera.position.set(0, 11.8, 6.4 * side);
  controls.target.set(0, 0.4, 0.7 * side);
  controls.update();
}

// ─── Sync from state + the DOM board ──────────────────────────────────────────
function sync() {
  if (!enabled || !state.game) return;
  placeCamera();

  for (const [sq, mesh] of Object.entries(squareMeshes)) {
    const el = boardEl.querySelector(`.square[data-square="${sq}"]`);
    const tint = el && TINTS.find(([cls]) => el.classList.contains(cls));
    const base = el && el.classList.contains('light') ? LIGHT : DARK;
    mesh.material.color.setHex(tint ? tint[1] : base);
    if (tint) mesh.material.color.lerp(new THREE.Color(base), 0.25);
  }

  // ponytail: pieces rebuilt every render (≤32 meshes, cheap); move tweens and
  // tower garrison / mounted-King badges aren't drawn — the 2D board has them.
  piecesGroup.clear();
  for (const sq of Object.keys(squareMeshes)) {
    const piece = pieceAt(state, sq);
    if (!piece) continue;
    const group = new THREE.Group();
    for (const g of pieceGeometry(piece.type)) group.add(new THREE.Mesh(g, pieceMats[piece.color]));
    const figureKey = figureImageKey(state, piece.type, piece.color);
    if (figureKey) {
      const icon = iconSprite(figureKey);
      icon.position.y = 1.35;
      group.add(icon);
    }
    const { x, z } = squarePos(sq);
    group.position.set(x, sq === selectedSquare ? 0.3 : 0.05, z);
    // Knight heads point +z (toward White) — turn White's to face Black.
    if (piece.type === 'n' && piece.color === 'w') group.rotation.y = Math.PI;
    piecesGroup.add(group);
  }
}

// ─── Input: raycast to a square, forward to the DOM board ─────────────────────
function bindInput() {
  const canvas = renderer.domElement;
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let downAt = null;
  let hoverSq = null;

  function squareAt(e) {
    const rect = canvas.getBoundingClientRect();
    pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    // Hitting a piece counts as its square — project the hit point down.
    const hit = raycaster.intersectObjects([...Object.values(squareMeshes), piecesGroup], true)[0];
    if (!hit) return null;
    const f = Math.round(hit.point.x + 3.5), r = Math.round(3.5 - hit.point.z);
    return f >= 0 && f < 8 && r >= 0 && r < 8 ? frToSq(f, r) : null;
  }
  const domSquare = (sq) => sq && boardEl.querySelector(`.square[data-square="${sq}"]`);

  canvas.addEventListener('pointerdown', (e) => { downAt = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener('pointerup', (e) => {
    // A drag is the camera orbiting, not a click.
    if (!downAt || Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > 5) return;
    const el = domSquare(squareAt(e));
    if (el) el.click();
  });
  canvas.addEventListener('dblclick', (e) => {
    const piece = domSquare(squareAt(e))?.querySelector('.piece');
    if (piece) piece.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  });
  // Stop the 2D targeting modes' document mousemove handlers from mapping
  // canvas pixels onto the hidden 2D board; clicks resolve by square instead.
  canvas.addEventListener('mousemove', (e) => {
    e.stopPropagation();
    const sq = squareAt(e);
    canvas.style.cursor = sq ? 'pointer' : 'grab';
    if (sq === hoverSq) return;
    hoverSq = sq;
    // Bishops' Shields previews the facing on mouseover (shields.js).
    domSquare(sq)?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  });
}

// ─── Toggle ───────────────────────────────────────────────────────────────────
function setEnabled(on) {
  enabled = on;
  if (on && !renderer) init();
  renderer.domElement.style.display = on ? 'block' : 'none'; // three.js sets display inline
  toggleBtn.textContent = on ? '2D Board' : '3D Board';
  try { localStorage.setItem(STORAGE_KEY, on ? '1' : ''); } catch (e) { /* storage unavailable */ }
  if (on) {
    resize();
    sync();
    renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
  } else if (renderer) {
    renderer.setAnimationLoop(null);
  }
}

toggleBtn.addEventListener('click', () => setEnabled(!enabled));
window.Board3D = { sync };
try { if (localStorage.getItem(STORAGE_KEY)) setEnabled(true); } catch (e) { /* storage unavailable */ }
