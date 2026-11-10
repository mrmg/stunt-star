// Set dressing: things that frame an open set so the shot has walls, foreground and depth.
// Everything here is visual only (no course solids) unless o.solid is passed, and instanced where it repeats,
// so a 600 m tree line or fence costs a handful of draw calls. All functions take the Stage first.
import * as THREE from 'three';
import { V3, srand, sr, varyMaterial } from './stage.js';

const _M = new THREE.Matrix4(), _Q = new THREE.Quaternion(), _E = new THREE.Euler(), _S = new THREE.Vector3(), _P = new THREE.Vector3();
// one InstancedMesh from a list of [x, y, z, ry, sx, sy, sz, rx?, rz?]
function inst(s, geo, mat, list, o = {}) {
  if (!list.length) return null; const im = new THREE.InstancedMesh(geo, mat, list.length); im.castShadow = o.cast !== false; im.receiveShadow = true; im.frustumCulled = false;
  list.forEach((t, i) => { _M.compose(_P.set(t[0], t[1], t[2]), _Q.setFromEuler(_E.set(t[7] || 0, t[3] || 0, t[8] || 0)), _S.set(t[4] ?? 1, t[5] ?? 1, t[6] ?? 1)); im.setMatrixAt(i, _M); if (o.colors) im.setColorAt(i, new THREE.Color(o.colors[i % o.colors.length]).multiplyScalar(0.85 + sr(0.3))); });
  s.scene.add(im); return im;
}
const ground = (s, x, z) => { const g = s.course.height(x, z); return g > -1e5 ? g : 0; };
// points along a polyline [[x,z],...] every `step` metres -> [x, z, heading]
function along(path, step, jitter = 0) {
  const out = []; for (let i = 0; i < path.length - 1; i++) { const [ax, az] = path[i], [bx, bz] = path[i + 1], L = Math.hypot(bx - ax, bz - az), h = Math.atan2(bx - ax, bz - az); for (let d = 0; d < L; d += step) { const k = (d + (jitter ? sr(-jitter, jitter) : 0)) / L; out.push([ax + (bx - ax) * k, az + (bz - az) * k, h]); } }
  return out;
}
const line = o => o.path || [[o.x ?? 0, o.z0], [o.x1 ?? o.x ?? 0, o.z1]];

// Dense multi-row forest edge along a line: tall trees behind, smaller in front, bushes at the foot.
// side = which way the band extends from the line (+1 = +X). kinds: any of the procedural tree kinds.
export function treeLine(s, o = {}) {
  const P = line(o), side = o.side ?? 1, depth = o.depth ?? 16, kinds = o.kinds || ['oak'], step = o.step ?? 4.5, hs = o.h || [8, 15];
  srand(o.seed ?? 31); const pts = along(P, step, step * 0.4), per = kinds.map(() => []);
  for (const [x, z, h] of pts) { const nx = Math.cos(h) * side, nz = -Math.sin(h) * side; const rows = Math.max(1, Math.round(depth / 6)); for (let r = 0; r < rows; r++) { const d = r * (depth / rows) + sr(0, depth / rows); per[Math.floor(sr(kinds.length))].push([x + nx * d, z + nz * d, r]); } }
  kinds.forEach((k, i) => { const L = per[i]; if (L.length) s.trees(k, L.length, (_, j) => { const [x, z, r] = L[j]; return [x, z]; }, { h: [hs[0] * (o.front ?? 0.75), hs[1]], seedv: (o.seed ?? 31) + i, bright: o.bright, solid: o.solid }); });
  if (o.bushes !== false) { const B = pts.filter(() => sr() < 0.8); s.trees('bush', B.length, (_, j) => { const [x, z, h] = B[j]; return [x + Math.cos(h) * side * sr(-0.5, 1.5), z - Math.sin(h) * side * sr(-0.5, 1.5)]; }, { h: [1.2, 2.6], seedv: (o.seed ?? 31) + 9, wide: 1.4 }); }
}

// Low grassy/earth bank: a trapezoid ridge along a line (visual). Closes the horizon at ground level.
export function berm(s, o = {}) {
  const P = line(o), side = o.side ?? 1, w = o.w ?? 10, h = o.h ?? 2.5, off = o.off ?? 0, segs = [];
  for (let i = 0; i < P.length - 1; i++) {
    const [ax, az] = P[i], [bx, bz] = P[i + 1], L = Math.hypot(bx - ax, bz - az), hd = Math.atan2(bx - ax, bz - az), nx = Math.cos(hd) * side, nz = -Math.sin(hd) * side;
    const n = Math.max(2, Math.ceil(L / 6)), prof = [[0, 0], [w * 0.3, h], [w * 0.7, h * 0.9], [w, 0]];
    const g = new THREE.PlaneGeometry(1, 1, prof.length - 1, n); const p = g.attributes.position, uv = g.attributes.uv;
    for (let k = 0; k < p.count; k++) { const ci = k % prof.length, ri = Math.floor(k / prof.length), t = ri / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t, wob = Math.sin(t * L * 0.11 + i) * h * 0.25;
      const [d, y] = prof[ci], X = x + nx * (off + d), Z = z + nz * (off + d); p.setXYZ(k, X, ground(s, X, Z) + (y ? y + wob : -0.2), Z); uv.setXY(k, X / 8, Z / 8); }
    g.computeVertexNormals(); segs.push(g);
  }
  const m = new THREE.MeshStandardMaterial({ color: o.color ?? 0x8a9a60, roughness: 0.95, side: THREE.DoubleSide }); const t = s.mat({ tex: o.tex ?? 'tx_grass' }).map; if (t) m.map = t;
  varyMaterial(m, { lo: 0.6, hi: 1.05, patch: o.patch ?? 0xa89a62, amt: 0.4 });
  for (const g of segs) { const mesh = new THREE.Mesh(g, m); mesh.receiveShadow = true; mesh.castShadow = true; s.scene.add(mesh); }
}

// Fences along a line. kind: 'rail' (ranch post-and-rail), 'wire' (posts + strands), 'picket', 'barrier' (crowd barrier), 'guard' (road guardrail)
export function fence(s, o = {}) {
  const P = line(o), kind = o.kind ?? 'rail', gap = o.gap ?? (kind === 'picket' ? 0.35 : kind === 'barrier' ? 2.2 : 2.6), h = o.h ?? (kind === 'barrier' ? 1.1 : kind === 'guard' ? 0.75 : 1.25);
  srand(o.seed ?? 5); const wood = s.mat({ tex: 'tx_wood', color: o.color ?? (kind === 'picket' ? 0xe8e4da : 0x9a8060) }), metal = s.mat({ color: o.color ?? 0x9aa0a6, metal: 0.6, rough: 0.4 });
  const pts = along(P, gap), posts = [], rails = [];
  for (const [x, z, hd] of pts) posts.push([x, ground(s, x, z) + h / 2, z, hd + sr(-0.04, 0.04), 1, 1, 1, sr(-0.05, 0.05)]);
  if (kind === 'barrier') { inst(s, new THREE.BoxGeometry(0.05, h, gap * 0.98), metal, posts.map(t => [...t.slice(0, 4), 1, 1, 1])); return; }
  inst(s, kind === 'guard' ? new THREE.BoxGeometry(0.12, h, 0.12) : new THREE.BoxGeometry(0.14, h, 0.14), kind === 'guard' ? metal : wood, posts);
  if (kind === 'picket') return;
  for (let i = 0; i < P.length - 1; i++) { const [ax, az] = P[i], [bx, bz] = P[i + 1], L = Math.hypot(bx - ax, bz - az), hd = Math.atan2(bx - ax, bz - az), mx = (ax + bx) / 2, mz = (az + bz) / 2, gy = ground(s, mx, mz);
    for (const y of kind === 'guard' ? [h * 0.75] : kind === 'wire' ? [h * 0.35, h * 0.62, h * 0.9] : [h * 0.45, h * 0.88]) rails.push([mx, gy + y, mz, hd, 1, 1, L]); }
  inst(s, kind === 'wire' ? new THREE.BoxGeometry(0.012, 0.012, 1) : kind === 'guard' ? new THREE.BoxGeometry(0.06, 0.32, 1) : new THREE.BoxGeometry(0.08, 0.14, 1), kind === 'wire' ? s.mat({ color: 0x55504a, metal: 0.4 }) : kind === 'guard' ? metal : wood, rails, { cast: kind !== 'wire' });
}

// Hay bales. list of [x, z, ry]; o.round (default) or square; stacks when o.stack > 1.
export function bales(s, list, o = {}) {
  const m = s.mat({ tex: 'tx_wood', color: 0xd8b868, rough: 1 }), round = o.round !== false, T = [];
  for (const [x, z, ry = 0] of list) { const g = ground(s, x, z); if (round) T.push([x, g + 0.72, z, ry, 1, 1, 1, 0, Math.PI / 2]); else for (let k = 0; k < (o.stack ?? 1); k++) T.push([x, g + 0.28 + k * 0.56, z, ry + (k % 2) * 0.1, 1, 1, 1]); }
  inst(s, round ? new THREE.CylinderGeometry(0.72, 0.72, 1.3, 14) : new THREE.BoxGeometry(1.1, 0.56, 0.55), m, T);
}

// Telegraph poles with cross-arms and sagging wires along a line: instant "country road".
export function poles(s, o = {}) {
  const P = line(o), gap = o.gap ?? 38, h = o.h ?? 8.5, wood = s.mat({ tex: 'tx_wood', color: 0x5a4632 }), pts = along(P, gap), T = [], A = [], W = [];
  for (const [x, z, hd] of pts) { const g = ground(s, x, z); T.push([x, g + h / 2, z, hd, 1, 1, 1, 0, sr(-0.03, 0.03)]); A.push([x, g + h - 0.5, z, hd + Math.PI / 2, 1, 1, 1]); }
  inst(s, new THREE.CylinderGeometry(0.11, 0.15, h, 7), wood, T); inst(s, new THREE.BoxGeometry(1.8, 0.12, 0.12), wood, A);
  const wm = new THREE.LineBasicMaterial({ color: 0x1a1a1a, transparent: true, opacity: 0.7 }), pos = [];
  for (let i = 0; i < pts.length - 1; i++) { const [ax, az, hd] = pts[i], [bx, bz] = pts[i + 1], ga = ground(s, ax, az) + h - 0.56, gb = ground(s, bx, bz) + h - 0.56; for (const off of [-0.75, -0.25, 0.25, 0.75]) { const ox = Math.cos(hd) * off, oz = -Math.sin(hd) * off; for (let k = 0; k < 8; k++) { const t0 = k / 8, t1 = (k + 1) / 8, sag = t => Math.sin(t * Math.PI) * 0.9; pos.push(ax + (bx - ax) * t0 + ox, ga + (gb - ga) * t0 - sag(t0), az + (bz - az) * t0 + oz, ax + (bx - ax) * t1 + ox, ga + (gb - ga) * t1 - sag(t1), az + (bz - az) * t1 + oz); } } }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); const l = new THREE.LineSegments(g, wm); l.userData.noRec = true; s.scene.add(l);
}

// A crowd of simple low-poly spectators (instanced, coloured clothes) along a line, facing `face` (radians, 0 = facing -Z).
// For a few close-up faces use real performers (s.char) instead; these read well from 8 m and beyond.
export function crowd(s, o = {}) {
  const P = line(o), rows = o.rows ?? 2, step = o.step ?? 0.75, side = o.side ?? 1; srand(o.seed ?? 13);
  const cloth = o.colors || [0x7a2a22, 0x2a3a6a, 0xd8c8a0, 0x3a5a3a, 0x8a6a3a, 0x222222, 0xb08040, 0x6a6a78, 0xa03a30, 0x405070], skin = [0xe0b090, 0xc08a68, 0x8a5a3a, 0xf0c8a8];
  const B = [], Hd = [], Lg = [];
  for (const [x, z, hd] of along(P, step, step * 0.3)) for (let r = 0; r < rows; r++) { if (sr() < (o.gaps ?? 0.15)) continue; const nx = Math.cos(hd) * side, nz = -Math.sin(hd) * side, d = r * 0.8 + sr(0, 0.3), X = x + nx * d, Z = z + nz * d, g = ground(s, X, Z) + (o.y ?? 0) + r * (o.tier ?? 0), k = sr(0.92, 1.1), f = (o.face ?? 0) + sr(-0.35, 0.35);
    Lg.push([X, g + 0.42 * k, Z, f, k, k, k]); B.push([X, g + 1.12 * k, Z, f, k, k, k]); Hd.push([X, g + 1.62 * k, Z, f, k, k, k]); }
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.9 });
  inst(s, new THREE.CylinderGeometry(0.16, 0.13, 0.84, 6), mat, Lg, { colors: [0x2a2a30, 0x3a3428, 0x4a4a52, 0x2a3040] });
  inst(s, new THREE.CapsuleGeometry(0.21, 0.42, 3, 8), mat.clone(), B, { colors: cloth });
  inst(s, new THREE.SphereGeometry(0.13, 10, 8), mat.clone(), Hd, { colors: skin });
}

// Gable-roofed barn / shed / farmhouse (visual). ry rotates it; color is the walls.
export function barn(s, o = {}) {
  const { x = 0, z = 0, w = 10, d = 14, h = 5, ry = 0 } = o, g = new THREE.Group(); g.position.set(x, o.y ?? ground(s, x, z), z); g.rotation.y = ry; s.scene.add(g);
  const wall = s.mat({ tex: 'tx_wood', color: o.color ?? 0x8a3a2a }), roof = s.mat({ tex: o.roofTex ?? 'tx_roof', color: o.roof ?? 0x5a5650 });
  s.box({ parent: g, x: 0, y: 0, z: 0, w, h, d, mat: wall, tile: 3 }); const rh = o.rh ?? w * 0.38;
  const tri = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, rh)]); const gg = new THREE.ExtrudeGeometry(tri, { depth: d, bevelEnabled: false }); gg.translate(0, h, -d / 2);
  const gable = new THREE.Mesh(gg, wall); gable.castShadow = gable.receiveShadow = true; g.add(gable);
  const L = Math.hypot(w / 2, rh) + 0.4, a = Math.atan2(rh, w / 2);
  for (const sx of [-1, 1]) { const r = new THREE.Mesh(new THREE.BoxGeometry(L, 0.15, d + 0.8), roof); r.position.set(sx * w / 4, h + rh / 2 + 0.05, 0); r.rotation.z = -sx * a; r.castShadow = r.receiveShadow = true; g.add(r); }
  if (o.door !== false) s.box({ parent: g, x: 0, y: 0, z: d / 2 + 0.02, w: w * 0.4, h: h * 0.75, d: 0.06, mat: s.mat({ color: 0x2a1a12 }) });
  return g;
}

// Distant low hills/ridges as a ring segment behind the set: closes the horizon without a wall of trees.
export function hills(s, o = {}) {
  const { x = 0, z = 0, r = 420, a0 = -Math.PI, a1 = Math.PI, h = 40 } = o, n = 72, rows = 4, pos = [], idx = [], uv = []; srand(o.seed ?? 3);
  const bump = []; for (let i = 0; i <= n; i++) bump.push(0.5 + 0.5 * Math.sin(i * 0.37 + sr(0, 1)) * Math.sin(i * 0.11 + 1.3) + sr(-0.15, 0.15));
  for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n, ca = Math.sin(a), sa = Math.cos(a); for (let j = 0; j <= rows; j++) { const t = j / rows, R = r + t * (o.depth ?? 160), y = Math.sin(t * Math.PI) * h * bump[i] + (o.y ?? 0) - 2 * (1 - Math.sin(t * Math.PI)); pos.push(x + ca * R, y, z + sa * R); uv.push(i * 0.8, j); } }
  for (let i = 0; i < n; i++) for (let j = 0; j < rows; j++) { const a = i * (rows + 1) + j, b = a + rows + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.MeshStandardMaterial({ color: o.color ?? 0x5a6a48, roughness: 1, side: THREE.DoubleSide }); const t = o.tex !== false && s.mat({ tex: o.tex ?? 'tx_grass' }).map; if (t) m.map = t;
  varyMaterial(m, { lo: 0.55, hi: 1.0, patch: o.patch ?? 0x8a8058, amt: 0.4, scale: 0.4 }); const mesh = new THREE.Mesh(g, m); mesh.receiveShadow = true; s.scene.add(mesh);
  if (o.trees) s.trees(o.trees, o.nTrees ?? 160, () => { const a = a0 + sr(0, a1 - a0), t = sr(0.15, 0.85), R = r + t * (o.depth ?? 160); const X = x + Math.sin(a) * R, Z = z + Math.cos(a) * R; return [X, Z, Math.sin(t * Math.PI) * h * 0.7]; }, { h: [12, 22], cast: false, seedv: (o.seed ?? 3) + 1 });
  return mesh;
}

// Scattered clutter: e.g. dress.clutter(s, 'rock_grey', 40, area, { h: [0.3, 1] }) is just s.scatter/forest; kept for symmetry.
export const clutter = (s, id, n, area, o) => s.forest(id, n, area, o);
