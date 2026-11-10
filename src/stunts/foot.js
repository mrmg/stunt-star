import * as THREE from 'three';
import { Run } from '../modes/run.js';
import { clamp, near, smooth, V3, rnd, sr, srand, lerp, damp } from '../world/stage.js';
import { K, CTL, sign, pursuer } from './common.js';
import * as dress from '../world/dress.js';

// ---------------------------------------------------------------------------------------------
// shared helpers
const RUNE = CTL.run + ` &nbsp; ${K('E')} action`;
// Bot: follows s.plan = [{z, act:'jump'|'slide'} | {z0, z1, x}] (z0 > z1, travel is -Z)
function botRun(s, inp, o = {}) {
  const r = s.run, z = r.pos.z; let tx = o.x ?? 0; inp.y = o.sprint === false ? 0 : 1;
  for (const h of s.plan || []) {
    if (h.x != null && z <= h.z0 && z >= h.z1) tx = h.x;
    if (h.act && z <= h.z && z > h.z - 0.7 && r.grounded) inp.press(h.act === 'jump' ? 'a' : 'down');
  }
  inp.x = clamp((tx - r.pos.x) * (o.gain ?? 2.5), -1, 1) * r.mirror; inp.a = !r.grounded; return tx;
}
// thin rope / hose between two points
function rope(s, { r = 0.04, color = 0xd8d0b8 } = {}) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1, 6), s.mat({ color, rough: 0.8 })); m.castShadow = true; s.scene.add(m); const up = V3(0, 1, 0), d = V3();
  m.set = (a, b) => { d.subVectors(b, a); const L = Math.max(0.01, d.length()); m.position.copy(a).addScaledVector(d, 0.5); m.scale.set(1, L, 1); m.quaternion.setFromUnitVectors(up, d.multiplyScalar(1 / L)); }; return m;
}
// scripted runner AHEAD of the player (a target). x: z => x. It leaps every gap in the course, and acts = [{z, act:'jump'|'slide'}]
// are performed visibly as it reaches them, so it goes over / under every obstacle on its line instead of through it.
// (For people chasing the player use pursuer() from common.js — it replays the player's own route.)
function runner(s, id, { x = () => 0, z = 0, cadence = 2.1, acts = [] } = {}) {
  const c = s.char(id, { x: x(z), z }), p = c.root.position; p.y = s.course.height(p.x, p.z); const st = { c, p, v: 0, air: false, hop: 0, off: 0, hv: 0, sl: 0, acts: acts.map(a => ({ ...a })) };
  st.next = (ahead = 14) => st.acts.find(a => !a.done && a.z < p.z && a.z > p.z - ahead);
  st.update = dt => {
    p.z -= st.v * dt; p.x = x(p.z); const g = s.course.height(p.x, p.z, p.y + 1.5), base = s.course.base(p.x, p.z);
    for (const a of st.acts) if (!a.done && st.v > 1 && p.z < a.z + (a.act === 'slide' ? 2.4 : 1.6)) { a.done = true; if (a.act === 'slide') { st.sl = 0.7; c.setPose('slide', 0.08); s.audio.whoosh(0.25); } else { st.hv = a.v ?? 5.4; st.off = 0.01; c.setPose('leap', 0.1); } }
    if (g > base + 0.3) {
      if (st.air) st.air = false; st.hop = 0;
      if (st.off > 0) { st.hv -= 21 * dt; st.off = Math.max(0, st.off + st.hv * dt); if (!st.off) st.hv = 0; p.y = g + st.off; } else p.y = g > p.y ? g : damp(p.y, g, 9, dt);
      if (st.sl > 0) { st.sl -= dt; if (st.sl <= 0) c.setCycle('run', 0); }
      if (st.off <= 0 && st.sl <= 0) { if (st.v > 0.5) c.setCycle('run', st.v * cadence, clamp(st.v / 8.5, 0.5, 1.1)); else if (c.cycle) c.setPose('ready', 0.2); }
    }
    else { if (!st.air) { st.air = true; st.off = 0; st.hv = 0; c.setPose('leap', 0.12); } st.hop += dt; p.y += (2.4 - st.hop * 13) * dt; }
  };
  return st;
}
// wall torches: returns per-frame updater
function torches(s, list, { color = 0xff9a40, i = 26, dist = 19 } = {}) {
  const wood = s.mat({ tex: 'tx_wood', color: 0x6a5238 }), P = [];
  for (const [x, y, z, sx] of list) { s.box({ x, y: y - 0.65, z, w: 0.14, h: 0.6, d: 0.14, mat: wood, rz: sx * 0.35, cast: false }); s.light({ x: x - sx * 0.3, y: y + 0.25, z, color, i, dist, bulb: false }); P.push(V3(x - sx * 0.12, y, z)); }
  return pz => { for (const p of P) if (Math.abs(p.z - pz) < 45) s.fx.flame(p, 0.45); };
}
// plate of spikes. dir: [dx,dy] the way the points face. Returns a group positioned at (x,y,z) = centre of the plate face
function spikes(s, { x, y, z, len = 1, across = 2, d = 1.2, dir = [0, 1], n = 4, rows = 3, color = 0x9a9488 }) {
  const g = new THREE.Group(); g.position.set(x, y, z); s.scene.add(g); const geo = new THREE.ConeGeometry(0.11, len, 6), m = s.mat({ color, metal: 0.7, rough: 0.35 });
  for (let i = 0; i < n; i++) for (let j = 0; j < rows; j++) { const c = new THREE.Mesh(geo, m); const a = (i + 0.5 + (j % 2 ? 0.25 : -0.25)) / n * across - across / 2, zz = (j + 0.5) / rows * d - d / 2; if (dir[0]) { c.position.set(dir[0] * len / 2, a, zz); c.rotation.z = -dir[0] * Math.PI / 2; } else { c.position.set(a, dir[1] * len / 2, zz); if (dir[1] < 0) c.rotation.z = Math.PI; } c.castShadow = true; g.add(c); }
  return g;
}

// ---------------------------------------------------------------------------------------------
// Generated crocodiles are one rigid mesh. Cut the upper jaw off along the mouth line and hang it on a hinge at the back
// of the head, add a pink mouth lining and teeth, and return open(a) (a = 0 shut .. 1 wide open).
function crocJaw(s, m) {
  m.updateWorldMatrix(true, true); const inv = m.matrixWorld.clone().invert(), meshes = []; m.traverse(o => { if (o.isMesh) meshes.push(o); }); if (!meshes.length) return null;
  const P = [], v = V3(); for (const o of meshes) { const g = o.geometry, a = g.attributes.position, M = inv.clone().multiply(o.matrixWorld), arr = new Float32Array(a.count * 3); for (let i = 0; i < a.count; i++) { v.fromBufferAttribute(a, i).applyMatrix4(M); v.toArray(arr, i * 3); P.push(v.x, v.y, v.z); } o.userData.hp = arr; o.userData.M = M; }
  // long axis by PCA in xz; the head is the end whose cross-section sits higher (the tail lies on the ground)
  const n = P.length / 3; let mx = 0, mz = 0; for (let i = 0; i < n; i++) { mx += P[i * 3]; mz += P[i * 3 + 2]; } mx /= n; mz /= n; let sxx = 0, szz = 0, sxz = 0; for (let i = 0; i < n; i++) { const x = P[i * 3] - mx, z = P[i * 3 + 2] - mz; sxx += x * x; szz += z * z; sxz += x * z; }
  const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz); let ca = Math.cos(ang), sa = Math.sin(ang); const U = (x, z) => (x - mx) * ca + (z - mz) * sa;
  let u0 = 1e9, u1 = -1e9; for (let i = 0; i < n; i++) { const u = U(P[i * 3], P[i * 3 + 2]); u0 = Math.min(u0, u); u1 = Math.max(u1, u); }
  const endY = (lo) => { let y = 0, k = 0; for (let i = 0; i < n; i++) { const u = U(P[i * 3], P[i * 3 + 2]); if (lo ? u < u0 + 0.4 : u > u1 - 0.4) { y += P[i * 3 + 1]; k++; } } return y / Math.max(1, k); };
  if (endY(true) > endY(false)) { ca = -ca; sa = -sa; const t = u0; u0 = -u1; u1 = -t; } // flip so +u is the head
  const L = u1 - u0, uH = u1 - L * 0.16, B = 24, lo = Array(B).fill(1e9), hi = Array(B).fill(-1e9), wd = Array(B).fill(0), bin = u => clamp(Math.floor((u - uH) / (u1 - uH) * B), 0, B - 1);
  for (let i = 0; i < n; i++) { const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2], u = U(x, z); if (u < uH) continue; const b = bin(u); lo[b] = Math.min(lo[b], y); hi[b] = Math.max(hi[b], y); wd[b] = Math.max(wd[b], Math.abs(-(x - mx) * sa + (z - mz) * ca)); }
  for (let b = 1; b < B; b++) if (lo[b] > 1e8) { lo[b] = lo[b - 1]; hi[b] = hi[b - 1]; wd[b] = wd[b - 1]; }
  const mouth = u => { const b = bin(u); return lo[b] + (hi[b] - lo[b]) * 0.44; }, yH = mouth(uH + 0.01);
  const H = V3(mx + ca * uH, yH, mz + sa * uH), dir = V3(ca, 0, sa), lat = V3(-sa, 0, ca);
  const pivot = new THREE.Group(); pivot.position.copy(H); m.add(pivot);
  for (const o of meshes) {
    const g = o.geometry, hp = o.userData.hp, cnt = hp.length / 3, up = new Uint8Array(cnt);
    for (let i = 0; i < cnt; i++) { const x = hp[i * 3], y = hp[i * 3 + 1], z = hp[i * 3 + 2], u = U(x, z); up[i] = u > uH && y > mouth(u) ? 1 : 0; }
    const idx = g.index ? g.index.array : Array.from({ length: cnt }, (_, i) => i), body = [], jaw = [];
    for (let k = 0; k < idx.length; k += 3) (up[idx[k]] + up[idx[k + 1]] + up[idx[k + 2]] >= 2 ? jaw : body).push(idx[k], idx[k + 1], idx[k + 2]);
    const mk = (list, off) => { const gg = new THREE.BufferGeometry(), pa = new Float32Array(hp); if (off) for (let i = 0; i < cnt; i++) { pa[i * 3] -= off.x; pa[i * 3 + 1] -= off.y; pa[i * 3 + 2] -= off.z; } gg.setAttribute('position', new THREE.BufferAttribute(pa, 3)); for (const k in g.attributes) if (k !== 'position') gg.setAttribute(k, g.attributes[k]); gg.setIndex(list); if (!g.attributes.normal) gg.computeVertexNormals(); else { const nm = new THREE.Matrix3().getNormalMatrix(o.userData.M), na = g.attributes.normal, nn = new Float32Array(na.count * 3), w = V3(); for (let i = 0; i < na.count; i++) { w.fromBufferAttribute(na, i).applyMatrix3(nm).normalize(); w.toArray(nn, i * 3); } gg.setAttribute('normal', new THREE.BufferAttribute(nn, 3)); } return gg; };
    const bm = new THREE.Mesh(mk(body), o.material), jm = new THREE.Mesh(mk(jaw, H), o.material); for (const x of [bm, jm]) { x.castShadow = x.receiveShadow = true; } m.add(bm); pivot.add(jm); o.visible = false;
  }
  // mouth lining (a flat pink tongue on the lower jaw, a palate under the upper one) and two rows of teeth
  const pink = s.mat({ color: 0xc8504c, rough: 0.55, side: true, emissive: 0x501010, emI: 1 }), tooth = s.mat({ color: 0xf0ead8, rough: 0.4 }), shape = new THREE.Shape(), bw = b => wd[b] * 0.82, sl = (u1 - uH);
  shape.moveTo(0, -bw(0)); for (let b = 0; b < B; b++) shape.lineTo((b + 0.5) / B * sl, -bw(b)); shape.lineTo(sl * 0.98, 0); for (let b = B - 1; b >= 0; b--) shape.lineTo((b + 0.5) / B * sl, bw(b)); shape.lineTo(0, bw(0));
  const plate = new THREE.ShapeGeometry(shape); plate.rotateX(Math.PI / 2); plate.scale(0.86, 1, 0.8); // x along the snout, z across it; kept inside the head
  const slope = Math.atan2(mouth(u1 - sl * 0.12) - yH, sl * 0.88), fdir = dir.clone().multiplyScalar(Math.cos(slope)).add(V3(0, Math.sin(slope), 0)), fup = new THREE.Vector3().crossVectors(lat.clone().negate(), fdir).negate();
  const basis = new THREE.Matrix4().makeBasis(fdir, fup.y < 0 ? fup.negate() : fup, lat.clone().negate());
  const tongue = new THREE.Mesh(plate, pink); tongue.applyMatrix4(basis); tongue.position.copy(H).y -= 0.04; m.add(tongue);
  const palate = new THREE.Mesh(plate, pink); palate.applyMatrix4(basis); palate.position.y = 0.01; pivot.add(palate);
  const tg = new THREE.ConeGeometry(0.028, 0.09, 5);
  for (let k = 1; k < 9; k++) for (const sd of [-1, 1]) { const f = k / 9.5, b = bin(uH + f * sl), w = wd[b] * 0.86 * sd, x = f * sl;
    const t1 = new THREE.Mesh(tg, tooth); t1.position.copy(dir).multiplyScalar(x).addScaledVector(lat, w); t1.position.y = mouth(uH + x) - yH - 0.03; t1.rotation.x = Math.PI; pivot.add(t1); // upper teeth hang down
    const t2 = new THREE.Mesh(tg, tooth); t2.position.copy(H).addScaledVector(dir, x + 0.05).addScaledVector(lat, w * 0.94); t2.position.y = mouth(uH + x + 0.05) + 0.02; m.add(t2); }
  pivot.userData.lat = lat; const q = new THREE.Quaternion();
  const inside = [tongue, palate, ...pivot.children.filter(o => o.geometry === tg), ...m.children.filter(o => o.geometry === tg)];
  return { pivot, open(a) { pivot.quaternion.setFromAxisAngle(lat, a * 1.15); const show = a > 0.12; for (const o of inside) o.visible = show; } }; // lining and teeth only while the mouth is open
}

const raiders = {
  id: 'raiders_boulder', title: 'Rolling Stone', film: 'Raiders of the Lost Ark', year: 1981, tier: 1, pay: 2400, mode: 'run', art: 'bd_jungle', music: 'epic',
  role: 'Doubling the archaeologist — fedora, leather jacket, one golden idol',
  brief: 'You lift the idol, the temple takes it personally. Twelve feet of fibreglass boulder is coming down that tunnel behind you and it does not stop for anybody. Run at the camera and do not look back.',
  tips: [`Swap the idol with ${K('E')} when the needle is <b>dead centre</b> — a clean swap buys you a head start.`, 'You run <b>towards the camera</b>: watch the warnings — <b>jump</b> the pits, <b>slide</b> under the beams, dodge the rubble.', 'Hold <b>W</b> to sprint. Every stumble lets the boulder gain four metres.', 'At the cave mouth a stone door drops: <b>slide</b> under it — the later you cut it, the better the shot.'],
  controls: RUNE, intro: { r: 6.5, h: 2.2, a0: 2.6 },
  assets: { models: ['ch_adventurer', 'golden_idol', 'rock_grey'], tex: ['bd_jungle', 'tx_cave', 'tx_temple', 'tx_rock', 'tx_jungle_floor', 'tx_wood'] },
  build(s) {
    s.env('cave', { backdrop: 'bd_jungle', look: 'golden', fogColor: 0x070504, fog: 0.016, amb: 0.3 });
    s.course.base = () => -7; const END = -176, W = 6.4, H = 5.6;
    const stone = s.mat({ tex: 'tx_temple', color: 0xb8a888 }), cave = s.mat({ tex: 'tx_cave', color: 0xa89880 }), wood = s.mat({ tex: 'tx_wood', color: 0x6a5238 });
    // hazards
    const pits = [[-40, 3.4], [-88, 3.6], [-136, 3.8]], beams = [-60, -104, -150], rubble = [[-24, -1], [-74, 1], [-114, -1], [-126, 1]];
    s.plan = []; const warn = []; const DZ = END + 0.7, DTOP = 4.3, DTRIG = END + 34; // the last trap: a stone slab drops across the cave mouth
    // floor in segments with the pits cut out
    let z = 20; for (const [pz, len] of [...pits, [END - 46, 0]]) { s.box({ x: 0, y: -7, z: (z + pz) / 2, w: 16, h: 7, d: z - pz, mat: stone, tile: 3.2, top: true, solid: true }); if (len) { s.plan.push({ z: pz + 0.9, act: 'jump' }); warn.push([pz, 'PIT', 'SPACE']); for (let i = 0; i < 9; i++) s.cyl({ x: -2.6 + i * 0.65, y: -5.4, z: pz - len / 2 + (i % 2 ? 0.6 : -0.5), r: 0.16, r1: 0.01, h: 1.9, color: 0x8a8272, seg: 6 }); } z = pz - len; }
    s.box({ x: 0, y: -7.4, z: -80, w: W + 2, h: 2, d: 220, mat: cave }); // pit bottoms
    for (const sx of [-1, 1]) { s.box({ x: sx * (W / 2 + 0.6), y: -7, z: END / 2, w: 1.2, h: 7 + H, d: -END, mat: cave, tile: 5 }); s.box({ x: sx * 6.2, y: 0, z: 9, w: 1.2, h: H, d: 20, mat: cave, tile: 5 }); }
    s.box({ x: 0, y: H, z: (21 + END) / 2, w: 16, h: 1, d: 21 - END, mat: cave, tile: 5 }); s.box({ x: 0, y: 0, z: 19, w: 14, h: H, d: 1, mat: cave, tile: 5 });
    for (const sx of [-1, 1]) s.box({ x: sx * 4.6, y: 0, z: 0.6, w: 3.2, h: H, d: 1.2, mat: cave, tile: 5 });
    // beams with cobwebs, rubble
    const web = s.mat({ color: 0xd8d8d0, opacity: 0.28, side: true });
    for (const bz of beams) { s.box({ x: 0, y: 1.1, z: bz, w: W, h: 0.5, d: 0.5, mat: wood, rz: 0.03, solid: true, sol: { soft: true, once: true } }); s.box({ x: 0.4, y: 1.6, z: bz, w: W * 0.8, h: 3.9, d: 0.02, mat: web, cast: false }); s.box({ x: -2.2, y: 0, z: bz + 0.1, w: 0.4, h: 1.2, d: 0.4, mat: wood }); s.plan.push({ z: bz + 4.2, act: 'slide' }); warn.push([bz, 'BEAM', 'S']); }
    for (const [rz, sd] of rubble) { for (const [dx, dz, h] of [[1.9, 0, 1.5], [0.8, 0.5, 1.1], [2.6, -0.7, 1.0]]) s.put('rock_grey', { x: sd * dx, z: rz + dz, height: h, ry: dx * 3 }); s.course.addSolid({ x0: sd > 0 ? 0.25 : -3.2, x1: sd > 0 ? 3.2 : -0.25, y0: 0, y1: 1.3, z0: rz - 0.8, z1: rz + 0.8, soft: true, once: true }); s.plan.push({ z0: rz + 10, z1: rz - 1, x: -sd * 1.7 }); warn.push([rz, sd > 0 ? 'ROCKS — GO RIGHT' : 'ROCKS — GO LEFT', sd > 0 ? 'D' : 'A']); }
    s.plan.push({ z: DZ + 4.2, act: 'slide' }); warn.push([DZ, 'DOOR — SLIDE', 'S']);
    // torches
    const torches = []; for (let tz = 6; tz > END + 8; tz -= 21) { const sx = (Math.round(tz / 21) % 2 ? 1 : -1), x = sx * (W / 2 - 0.15); s.box({ x, y: 2.3, z: tz, w: 0.14, h: 0.6, d: 0.14, mat: wood, rz: sx * 0.35, cast: false }); s.light({ x: x - sx * 0.3, y: 3.2, z: tz, color: 0xff9a40, i: 26, dist: 19, bulb: false }); torches.push(V3(x - sx * 0.12, 2.95, tz)); }
    // cave mouth and the jungle outside
    for (const sx of [-1, 1]) s.box({ x: sx * 13.3, y: -2, z: END - 1.5, w: 22, h: 20, d: 5, mat: { tex: 'tx_rock', color: 0xffffff }, tile: 7 }); s.box({ x: 0, y: 4.3, z: END - 1.5, w: 4.6, h: 13.7, d: 5, mat: { tex: 'tx_rock', color: 0xffffff }, tile: 7 });
    s.box({ x: 0, y: -0.02, z: END - 26, w: 70, h: 0.05, d: 44, mat: { tex: 'tx_jungle_floor' }, tile: 6, cast: false, top: true });
    const slab = s.box({ x: 0, y: DTOP, z: DZ, w: 5.2, h: 4.6, d: 0.9, mat: stone, tile: 1.6 }); for (const sx of [-1, 1]) s.box({ x: sx * 2.45, y: 0, z: DZ, w: 0.35, h: DTOP, d: 1.1, mat: wood, cast: false }); // the slab and its guide posts
    const door = { y: DTOP, v: 0, on: false, t: 0, shut: false, under: null };
    { // the cave mouth from outside: rock masses breaking up the cliff, vines over the opening, undergrowth
      srand(41); for (const [x, y, h, z] of [[-4.3, -0.4, 2.6, 0.5], [4.4, -0.4, 3, 0.6], [-7, 0.5, 3.6, 1.2], [7.4, 1, 4, 1.3], [-10.5, -0.5, 4.5, 1.6], [11, -0.5, 4.8, 1.7]]) s.put('rock_grey', { x, y, z: END - 4 + z, height: h, ry: sr(6) });
      const vine = s.mat({ color: 0x1e2e14, rough: 0.95 }), leaf = s.mat({ color: 0x24401a, rough: 0.9, side: true });
      for (let i = 0; i < 26; i++) { const x = sr(-4.6, 4.6), L = sr(1.2, Math.abs(x) < 2.3 ? 2.2 : 5), y = Math.abs(x) < 2.3 ? DTOP + 0.2 : sr(3, 8); const v = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.04, L, 4), vine); v.position.set(x, y + 0.3 - L / 2, END - 4.1 - sr(0.3)); v.rotation.z = sr(-0.08, 0.08); s.scene.add(v);
        for (let j = 0; j < L * 2; j++) { const l = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.11), leaf); l.position.set(x + sr(-0.12, 0.12), y + 0.3 - j * 0.5 - sr(0.2), END - 4.15 - sr(0.3)); l.rotation.set(sr(-1, 1), sr(-1, 1), sr(3)); s.scene.add(l); } }
      s.forest('tree:bush', 26, r => { const x = (r() - 0.5) * 22; return Math.abs(x) < 2.6 ? null : [x, END - 3 - r() * 9, 0]; }, { h: [0.7, 1.6], seedv: 12 });
    }
    const dsol = s.course.addSolid({ x0: -2.6, x1: 2.6, y0: DTOP, y1: DTOP + 5, z0: DZ - 0.45, z1: DZ + 0.45, deadly: true, msg: 'Shut in with the boulder', injury: 0.9, grab: false,
      advice: 'The door starts dropping 34 m out. Hold W (sprint) all the way from the last beam and slide (S) about 4 m before it.' });
    const sunL = s.light({ x: 2, y: 13, z: END - 16, color: 0xfff0d0, i: 0, dist: 60, bulb: false }); s.forest('tree:jungle', 46, r => { const x = (r() - 0.5) * 64, zz = END - 5 - r() * 40; return Math.abs(x) < 4 ? null : [x, zz, 0]; }, { h: [7, 13], seedv: 5 }); s.forest('tree:bush', 30, r => { const x = (r() - 0.5) * 50; return Math.abs(x) < 3.4 ? null : [x, END - 4 - r() * 30, 0]; }, { h: [1, 2.2], seedv: 8 });
    // idol chamber
    s.box({ x: 1.05, y: 0, z: -0.5, w: 0.7, h: 1.05, d: 0.7, mat: stone, tile: 1.5 }); const idol = s.put('golden_idol', { x: 1.05, y: 1.05, z: -0.5, height: 0.5, ry: Math.PI / 2 }); s.light({ x: 1.2, y: 2.6, z: -1.4, color: 0xffd070, i: 14, dist: 7, bulb: false });
    s.crew({ x: -3.6, z: 7.5, ry: -2.5 });
    const run = s.run = new Run(s, { char: 'ch_adventurer', x: 0, z: 0.2, speed: 6.9, sprint: 9.0, mirror: true, xmin: -2.7, xmax: 2.7, fallDeath: 3, cam: { yaw: Math.PI, dist: 8.6, height: 2.9, ahead: 4.5, up: 1.3, fov: 64, stiff: 6 } });
    run.speedK = 0; run.c.heading = -0.5; const key = s.light({ x: 0, y: 3, z: 0, color: 0xffe0b0, i: 16, dist: 12, bulb: false });
    // the boulder
    const R = 2.45, ball = new THREE.Mesh(new THREE.SphereGeometry(R, 28, 18), s.mat({ tex: 'tx_rock', rep: 2, color: 0xb0a898 })); ball.castShadow = true; ball.position.set(0, H + R + 1, 14.5); s.scene.add(ball);
    let bz = 14.5, bv = 0, by = H + R + 1, rolling = false, swapQ = 0, t0 = 0, minGap = 99, out = false, jam = false, shakeT = 0, done = false; const E0 = { sun: s.sun.intensity, hemi: s.hemi.intensity, fog: s.scene.fog.color.clone(), dens: s.scene.fog.density, env: s.scene.environmentIntensity }, dayFog = new THREE.Color(0xa8c0a0);
    // the idol rides in his right hand (placed after each animation frame so it never lags), arm tucked to carry it
    const carry = (c, prop) => {
      const hb = c.bones?.RightHand, fa = c.bones?.RightForeArm; if (!hb) { prop.position.set(0.34, 1.05, -0.28); prop.rotation.set(0, 0, 0); c.root.add(prop); return; }
      s.scene.attach(prop); c.over = { aR: [0.3, -0.8, 0.4, 0.05, 0.1, 1] }; const P = V3(), F = V3();
      c.post = () => { hb.updateWorldMatrix(true, false); hb.getWorldPosition(P); if (fa) P.addScaledVector(F.subVectors(P, fa.getWorldPosition(F)).normalize(), 0.08); c.root.getWorldQuaternion(prop.quaternion); prop.position.copy(P); prop.position.y -= 0.13; };
    };
    const grab = q => { swapQ = q; rolling = true; t0 = s.t; run.speedK = 1; s.hud.hideBar(); s.hud.prompt(''); idol.scale.multiplyScalar(0.6); carry(run.c, idol); s.rate('Idol swap', q, 1); if (q < 0.35) s.flub(q > 0 ? 'Fumbled the idol swap' : 'Never swapped the idol', { penalty: 0.08, advice: 'Press E when the swinging needle is dead centre of the bar — wait for it, it comes round every two seconds.' }); s.msg(q > 0.8 ? 'PERFECT SWAP' : q > 0.35 ? 'GOT IT' : 'CLUMSY!', q > 0.35 ? 'good' : 'bad'); s.audio.thud(); s.engine.addShake(0.8); s.objective('RUN! Sprint for daylight'); s.audio.set('rumble', 'rumble', 0.7, 0.5); };
    s.rate('Footwork', 1, 1.5); run.onStumble = () => { s.rate('Footwork', 1 - run.stats.stumbles * 0.25, 1.5); s.msg('STUMBLE!', 'bad'); s.sz = Math.round(run.pos.z); const w = warn.find(([wz]) => Math.abs(run.pos.z - wz) < 3), beam = w && w[1] === 'BEAM';
      s.flub(beam ? 'Clipped a beam' : 'Tripped on the rubble', { penalty: 0.05, advice: beam ? 'Slide (S) the moment the BEAM warning shows — about 4 m before the beam.' : 'Cross early (A/D) when the ROCKS warning shows — it tells you which side is clear.' }); };
    run.onGrab = () => { s.rate('Footwork', (s.scores.get('Footwork')?.v ?? 1) - 0.3, 1.5); };
    run.onLand = i => { if (run.pos.y < -2) { run.die('Fell into the spike pit', 0.8, false, 'Jump (SPACE) about a metre before each PIT and hold SPACE for the full distance — the warning counts you in.'); run.c.setPose('lie', 0.1); return true; } };
    s.onAction = () => s.objective('Swap the idol — press E on the centre mark'); s.dbg = () => ({ z: +run.pos.z.toFixed(1), gap: +(bz - R - run.pos.z).toFixed(1), st: run.stats.stumbles, sz: s.sz });
    s.onUpdate((dt, t) => {
      for (const p of torches) if (Math.abs(p.z - run.pos.z) < 45) s.fx.flame(p, 0.45);
      key.position.set(run.pos.x, run.pos.y + 3, run.pos.z - 3);
      if (!s.started || s.ended && !rolling) return;
      if (!rolling) { const v = s.bar = 0.5 + 0.5 * Math.sin((t - s.t0) * 3.3); s.hud.bar(v, [0.36, 0.64], [0.46, 0.54]); s.hud.prompt(`${K('E')} swap the idol`); if (s.input.hit('x')) grab(near(Math.abs(v - 0.5), 0, 0.04, 0.3)); else if (t - s.t0 > 7) grab(0); return; }
      // boulder drops then rolls, rubber-banded so it always fills the frame
      const gap = bz - R - run.pos.z;
      if (by > R) { by = Math.max(R, by - (4 + (t - t0) * 22) * dt); if (by === R) { s.audio.impact(1); s.engine.addShake(1.2); s.fx.dust(V3(0, 0.2, bz), 30, { spread: 4, size: 3 }); } }
      else if (!jam) { const want = 8.55 + clamp((gap - (6.5 + swapQ * 3.5)) * 0.3, 0, 2.2) - (t - t0 < 2.4 ? 3.2 : 0) - (gap < 3 ? 0.7 : 0); bv = damp(bv, want, 2.5, dt); bz -= bv * dt; ball.rotation.x -= bv * dt / R; if (Math.random() < 0.5) s.fx.dust(V3(rnd(-2, 2), 0.1, bz - 1), 1, { size: 2.2, a: 0.25, color: [0.5, 0.45, 0.38] }); }
      ball.position.set(Math.sin(bz * 0.11) * 0.45, by, bz);
      const close = clamp(1 - gap / 16); s.audio.set('rumble', 'rumble', 0.6 + close * 0.5, jam ? 0 : 0.25 + close * 0.6); shakeT -= dt; if (shakeT < 0 && !jam) { shakeT = 0.16; s.engine.addShake(0.08 + close * 0.3); }
      if (!s.ended) { minGap = Math.min(minGap, gap); s.hud.readout('gap', 'Boulder (m)', Math.max(0, gap).toFixed(1), gap < 5 ? 'warn' : gap > 9 ? 'ok' : ''); let w = ''; for (const [wz, txt, k] of warn) { const d = run.pos.z - wz; if (d > 1.5 && d < 17) { w = `${K(k)} ${txt}`; break; } } s.hud.prompt(w); }
      if (gap < 0.25 && !s.ended && !run.dead) { run.c.setPose('prone', 0.08); run.dead = true; run.v = 0; s.engine.addShake(1.5); s.audio.impact(1); s.fail('Flattened by the boulder', { injury: 0.9, advice: 'Hold W (sprint) the whole way and read the warnings early — every stumble lets the boulder gain four metres. Keep the BOULDER readout above 5 m.' }); }
      // the last trap: the slab grinds down once you're 34 m out; slide under it and it seals the boulder in behind you
      if (!door.on && run.pos.z < DTRIG && !run.dead) { door.on = true; s.msg('THE DOOR!', 'bad'); s.objective('Slide under the door!'); s.audio.set('door', 'rumble', 0.35, 0.45); s.engine.addShake(0.5); s.fx.dust(V3(0, DTOP, DZ + 0.6), 14, { spread: 2.4, size: 1.6 }); }
      if (door.on && !door.shut) { door.t += dt; door.y = Math.max(0, DTOP - 0.75 * door.t); slab.position.y = door.y + 2.3; dsol.y0 = door.y; if (Math.random() < 0.3) s.fx.dust(V3(rnd(-2.3, 2.3), door.y + 0.1, DZ + 0.5), 1, { size: 1, a: 0.2, color: [0.5, 0.45, 0.38] });
        if (door.y === 0) { door.shut = true; s.audio.set('door', 'rumble', 0, 0); s.audio.impact(0.9); s.engine.addShake(0.9); s.fx.dust(V3(0, 0.2, DZ - 0.9), 26, { spread: 3, size: 2.2 }); s.fx.dust(V3(0, 0.2, DZ + 0.9), 18, { spread: 3, size: 2 }); } }
      { const kc = door.on ? smooth(DZ + 16, DZ + 5, run.pos.z) * (1 - smooth(DZ - 2, DZ - 8, run.pos.z)) : 0; const co = s.cam.o; co.height = lerp(2.9, 0.45, kc); co.up = lerp(1.3, 0.7, kc); co.dist = lerp(8.6, 7, kc); co.fov = lerp(64, 70, kc); }
      if (door.on && !door.under && !run.dead && run.pos.z > DZ && run.pos.z - DZ < 1.5) {
        const gapH = door.y - run.pos.y;
        if (run.slide > 0 && gapH > 0.8 || gapH > 1.8) { door.under = { gap: gapH }; run.pass(dsol, 1.2); }
        else if (gapH > 0.45) { door.under = { gap: gapH, scraped: true }; run.pass(dsol, 1.5); run.stumble(0.45, 0.8); s.flub(run.slide > 0 ? 'Scraped under the door' : 'Took the door on the head', { penalty: 0.12, advice: 'Slide (S) when the DOOR warning shows — about 4 m before it — and sprint (W) the whole last stretch so there is room under it.' }); }
        if (door.under) { s.rate('Under the door', near(gapH, 0.9, 0.3, 2.6), 1.2); s.moment('under the door', { t0: s.t - 1.5, dur: 3.4, w: 3.5, shots: [{ type: 'front', speed: 0.3, a: -0.1, b: 0.7 }, { type: 'low', speed: 0.3, side: 1, a: 0.25, b: 0.75 }, { type: 'front', speed: 0.7, a: 0.45, b: 1.25, fov: 55 }] }); s.slowmo(0.35, 0.9); s.msg(gapH < 1.15 ? 'BY AN INCH!' : 'UNDER!', 'good'); }
      }
      if (bz < DZ + 0.45 + R + 0.1 && !jam) { jam = true; bv = 0; s.audio.impact(1); s.audio.explosion(0.5); s.engine.addShake(1.6); s.fx.dust(V3(0, 2, DZ + 1.2), 40, { spread: 4, size: 3.5, up: 3 }); s.fx.dust(V3(0, 0.3, DZ - 1.2), 22, { spread: 3.2, size: 2.4 }); s.fx.debris(V3(0, 3, DZ + 1.4), 18, { color: 0x8a8070, speed: 5, dir: V3(0, 0, 1), floor: 0 }); }
      // daylight
      const k = smooth(END + 26, END - 4, run.pos.z); s.sun.intensity = lerp(E0.sun, 3.2, k); s.hemi.intensity = lerp(E0.hemi, 0.75, k); s.scene.fog.color.copy(E0.fog).lerp(dayFog, k); s.scene.fog.density = lerp(E0.dens, 0.004, k); s.scene.environmentIntensity = lerp(E0.env, 0.8, k); key.intensity = 16 * (1 - k); sunL.intensity = 150 * k;
      if (run.pos.z < END && !out) { out = true; s.moment('out of the cave', { t0: s.t - 2.2, dur: 4.4, w: 1.5 }); s.hud.prompt(''); }
      if (run.pos.z < END - 9 && !done && !run.dead) { done = true; s.rate('Lead over the boulder', clamp(gap / 7), 1); s.bonus('Closest shave ' + minGap.toFixed(1) + ' m', Math.round(clamp(1 - minGap / 8) * 300)); run.speedK = 0.01; s.wrap(1.6, 'The idol is in the bag'); }
    });
  },
  bot(s, inp) { botRun(s, inp); if (s.run.speedK === 0 && Math.abs(s.bar - 0.5) < 0.035) inp.press('x'); },
};

// ---------------------------------------------------------------------------------------------
const temple = {
  id: 'temple_door', title: 'Never Leave the Hat', film: 'Indiana Jones and the Temple of Doom', year: 1984, tier: 2, pay: 4200, mode: 'run', art: 'bd_india', music: 'epic',
  role: 'Doubling the archaeologist — spike corridor, one very heavy door',
  brief: 'The spike room is live and that stone door is coming down whether you are under it or not. Slide through with daylight to spare and I am bored. Slide through with an inch to spare, then reach back for the hat — that is the shot.',
  tips: ['Wall spikes fire as you approach — <b>switch sides</b>. Jump the floor spikes, <b>slide</b> under the ceiling blocks.', 'The door starts dropping at the red line. Watch <b>DOOR AT ARRIVAL</b>: ease off <b>W</b> to cut it fine — under 0.8 m and you are paste.', `<b>Slide</b> under the door, then hit ${K('E')} to snatch the hat back before the gap closes.`],
  controls: RUNE, intro: { r: 6, h: 2.2, a0: 0.5 },
  assets: { models: ['ch_adventurer'], tex: ['bd_india', 'tx_temple', 'tx_cave', 'tx_rock', 'tx_wood'] },
  build(s) {
    s.env('cave', { look: 'golden', fogColor: 0x0a0403, fog: 0.012, amb: 0.34 });
    const W = 7, H = 4.8, DZ = -150, TRIG = -100, RATE = 0.36, Y0 = 3.1;
    const stone = s.mat({ tex: 'tx_temple', color: 0xc0a080 }), dark = s.mat({ tex: 'tx_cave', color: 0x907060 });
    s.box({ x: 0, y: -1, z: -80, w: W + 10, h: 1, d: 200, mat: stone, tile: 3.5, top: true }); s.box({ x: 0, y: H, z: -80, w: W + 10, h: 1, d: 200, mat: dark, tile: 5 });
    for (const sx of [-1, 1]) { s.box({ x: sx * (W / 2 + 2.5), y: 0, z: -80, w: 5, h: H, d: 200, mat: stone, tile: 4.8 }); for (let z = -6; z > DZ; z -= 12) s.box({ x: sx * (W / 2 - 0.2), y: 0, z, w: 0.7, h: H, d: 0.9, mat: dark, tile: 3 }); }
    s.box({ x: 0, y: 0, z: 19.5, w: W + 10, h: H, d: 1, mat: dark }); s.box({ x: 0, y: 0, z: -178, w: W + 10, h: H, d: 1, mat: dark });
    const fire = torches(s, [...Array(9)].map((_, i) => [(i % 2 ? 1 : -1) * (W / 2 - 0.75), 3, 4 - i * 20.5, i % 2 ? 1 : -1]), { color: 0xff6a30, i: 30, dist: 20 });
    // hazards
    s.plan = []; const warn = [], walls = [], ceils = [];
    for (const [z, sd] of [[-18, -1], [-31, 1], [-70, 1], [-82, -1], [-114, -1], [-136, 1]]) { const g = spikes(s, { x: sd * W / 2, y: 1.25, z, len: 3.7, across: 2.2, d: 1.6, dir: [-sd, 0], n: 5, rows: 3 }); g.position.x = sd * (W / 2 + 3.8); const sol = s.course.addSolid({ x0: sd > 0 ? -0.2 : -W / 2, x1: sd > 0 ? W / 2 : 0.2, y0: 0.1, y1: 2.4, z0: z - 0.8, z1: z + 0.8, dead: true, on: r => { r.pass(sol, 1.1); r.stumble(0.6, 0.5); r.sideTo = -sd * 1.9; s.audio.punch(); s.engine.hurt?.(0.25); s.flub('Grazed by the wall spikes', { penalty: 0.18, advice: `When the prompt says SPIKES — GO ${sd > 0 ? 'LEFT (A)' : 'RIGHT (D)'}, get across before they fire — they come out about 15 m ahead of you.` }); return true; } }); walls.push({ g, sol, z, sd, k: 0 }); s.plan.push({ z0: z + 10.5, z1: z - 1, x: -sd * 2 }); warn.push([z, sd > 0 ? 'SPIKES — GO LEFT' : 'SPIKES — GO RIGHT', sd > 0 ? 'A' : 'D']); s.box({ x: sd * (W / 2 - 0.02), y: 0.1, z, w: 0.06, h: 2.4, d: 1.8, mat: s.mat({ color: 0x1a0c08 }), cast: false }); }
    for (const z of [-45, -94, -125]) { spikes(s, { x: 0, y: 0, z, len: 0.75, across: W - 1, d: 1.7, dir: [0, 1], n: 11, rows: 4 }); s.box({ x: 0, y: 0, z, w: W - 0.8, h: 0.06, d: 2, mat: s.mat({ color: 0x1a0c08 }), cast: false }); s.course.addSolid({ x0: -W / 2, x1: W / 2, y0: 0, y1: 0.62, z0: z - 0.8, z1: z + 0.8, trip: 'Stepped on the floor spikes', penalty: 0.15, advice: 'Jump (SPACE) two to three metres before each FLOOR SPIKES plate — hold SPACE for the full height.' }); s.plan.push({ z: z + 2.6, act: 'jump' }); warn.push([z, 'FLOOR SPIKES', 'SPACE']); }
    for (const z of [-58, -104]) { const g = new THREE.Group(); s.scene.add(g); s.box({ parent: g, x: 0, y: 0.75, z, w: W - 0.9, h: 3, d: 1.6, mat: stone, tile: 2.5 }); g.add(spikes(s, { x: 0, y: 0.75, z, len: 0.7, across: W - 1.2, d: 1.4, dir: [0, -1], n: 10, rows: 3 })); g.position.y = H - 0.9; const sol = s.course.addSolid({ x0: -W / 2, x1: W / 2, y0: 0.95, y1: H, z0: z - 0.8, z1: z + 0.8, dead: true, on: r => { r.pass(sol, 1.1); r.stumble(0.7, 0.5); s.audio.punch(); s.engine.hurt?.(0.25); s.flub('Clipped by the ceiling spikes', { penalty: 0.18, advice: 'Slide (S) about four metres before a ceiling block — as soon as CEILING — SLIDE shows.' }); return true; } }); ceils.push({ g, sol, z, k: 0 }); s.plan.push({ z: z + 4.4, act: 'slide' }); warn.push([z, 'CEILING — SLIDE', 'S']); }
    warn.sort((a, b) => b[0] - a[0]);
    // the door
    s.line({ x: 0, z: TRIG, w: W, d: 0.5, color: 0xff3020, glow: 2 }); for (const sx of [-1, 1]) s.box({ x: sx * (W / 2 - 0.4), y: 0, z: DZ, w: 1.4, h: H, d: 1.6, mat: dark, tile: 3 });
    const door = s.box({ x: 0, y: Y0, z: DZ, w: W, h: 4.6, d: 0.9, mat: s.mat({ tex: 'tx_rock', color: 0xb8a890 }), tile: 3, solid: true }), dsol = door.userData.solid; let yb = Y0, closing = false;
    s.light({ x: 0, y: 2.6, z: DZ - 8, color: 0xffb060, i: 40, dist: 26, bulb: false }); s.light({ x: 0, y: 3.6, z: DZ + 5, color: 0xff4020, i: 16, dist: 16, bulb: false });
    s.box({ x: 0, y: 0, z: DZ - 14, w: 2.4, h: 1.1, d: 1.2, mat: stone, tile: 2 }); // altar in the far chamber
    s.crew({ x: 2.2, z: 9, ry: 0.5 });
    const run = s.run = new Run(s, { char: 'ch_adventurer', x: 0, z: 0, xmin: -W / 2 + 0.75, xmax: W / 2 - 0.75, cam: { dist: 5.6, height: 2.4, ahead: 4, fov: 64 } });
    const key = s.light({ x: 0, y: 3, z: 0, color: 0xffd0a0, i: 12, dist: 11, bulb: false });
    // his own hat comes off the model (split from the mesh); the loose copy is what flies, lands and gets snatched back
    const hat = new THREE.Group(); if (run.c.splitHat()) hat.add(run.c.hatProp); else { const m = s.mat({ color: 0x5a3c22, rough: 0.9 }); s.cyl({ parent: hat, r: 0.3, h: 0.025, mat: m }); s.cyl({ parent: hat, r: 0.15, r1: 0.13, h: 0.14, mat: m }); } hat.visible = false; s.scene.add(hat);
    let inHand = false; const HP = V3(), FA = V3();
    run.c.post = () => { if (!inHand) return; const c = run.c, hb = c.bones.RightHand, fa = c.bones.RightForeArm; if (!hb) return; hb.updateWorldMatrix(true, false); hb.getWorldPosition(HP); if (fa) HP.addScaledVector(FA.subVectors(HP, fa.getWorldPosition(FA)).normalize(), 0.07); hat.position.copy(HP); hat.position.y -= 0.05; hat.rotation.set(0.25, c.heading, 0); };
    let passed = false, hatT = 0, hatGot = false, shave = 0, slideZ = null, hv = V3(), doorM = null;
    let bumped = false, sealed = false;
    dsol.on = r => {
      const under = Math.abs(r.pos.z - DZ) < 0.75; if (yb < 0.05) return true;
      if (under || r.slide > 0) { r.die('Crushed under the stone door', 0.9, false, `The door was down to ${Math.round(yb * 100)} cm. Watch DOOR AT ARRIVAL: keep it above 0.85 m — let go of W early, not at the door.`); r.c.setPose('prone', 0.1); return true; }
      r.stumble(0.6, 0); r.v = 0; r.pos.z = Math.max(r.pos.z, DZ + 1.3); s.audio.impact(0.6); s.engine.addShake(0.5);
      if (!bumped) { bumped = true; s.flub('Ran into the door instead of sliding', { penalty: 0.2, advice: 'You cannot run under it — press S to slide about four metres before the door.' }); } return true;
    };
    run.onSlide = () => { if (run.pos.z < DZ + 9 && !hat.visible) { hat.visible = true; run.c.setHat(false); run.c.bonePos('Head', hat.position); hat.position.y += 0.12; hat.rotation.set(0, run.c.heading, 0); hv.set(0.4, 1.5, -Math.max(0, (run.pos.z - (DZ + 1.6)) * 1.5)); } };
    s.rate('Spike corridor', 1, 1); run.onStumble = () => s.rate('Spike corridor', 1 - run.stats.stumbles * 0.4, 1);
    s.onAction = () => s.objective('Sprint the spike corridor'); s.dbg = () => ({ z: +run.pos.z.toFixed(1), yb: +yb.toFixed(2), shave: +shave.toFixed(2), v: +run.v.toFixed(1) });
    s.onUpdate((dt, t) => {
      fire(run.pos.z); key.position.set(run.pos.x, run.pos.y + 3, run.pos.z + 1.5);
      if (!s.started) return; const z = run.pos.z;
      for (const w of walls) if (z - w.z < 15 && w.k < 1) { if (!w.k) { s.audio.impact(0.5); s.audio.whoosh(1.2); } w.k = Math.min(1, w.k + dt / 0.5); w.g.position.x = w.sd * (W / 2 + 3.8 * (1 - w.k * w.k)); if (w.k > 0.8) w.sol.dead = false; }
      for (const c of ceils) if (z - c.z < 17 && c.k < 1) { if (!c.k) s.audio.impact(0.6); c.k = Math.min(1, c.k + dt / 0.55); c.g.position.y = (H - 0.9) * (1 - c.k * c.k); if (c.k >= 1) { c.sol.dead = false; s.engine.addShake(0.4); s.audio.thud(); } }
      if (!closing && z < TRIG) { closing = true; s.msg('THE DOOR!', 'bad'); s.objective('Slide under the door — cut it fine'); s.audio.set('rumble', 'rumble', 0.5, 0.5); }
      if (closing && yb === 0 && !passed && !sealed && !s.ended) { sealed = true; run.control = false; run.speedK = 0; s.rate('Close shave', 0, 2); s.rate('The hat', 0, 1); s.flub('The door sealed before you got under it', { penalty: 0.45, advice: 'Too slow to the door. Keep sprinting (W) through the spike room, then use DOOR AT ARRIVAL — under about 0.85 m means slide NOW.' }); s.wrap(1.6, 'No way through. Again, please.'); }
      if (closing && yb > 0) { yb = Math.max(0, yb - RATE * dt); door.position.y = yb + 2.3; dsol.y0 = yb; dsol.y1 = yb + 4.6; if (Math.random() < 0.4) s.fx.dust(V3(rnd(-3, 3), yb, DZ), 1, { size: 1, a: 0.3, up: 0.2 }); if (yb === 0) { s.audio.impact(1); s.engine.addShake(1); s.audio.set('rumble', 'rumble', 0.5, 0); s.fx.dust(V3(0, 0.1, DZ), 24, { spread: 4 }); } }
      if (hat.visible && !hatGot) { if (hat.position.y > 0.03) { hv.y -= 12 * dt; hat.position.addScaledVector(hv, dt); hat.rotation.x += 5 * dt; } else { hat.position.y = 0.02; hat.rotation.x = 0; } hat.position.z = Math.max(hat.position.z, DZ + 0.62); }
      if (!passed && !s.ended) {
        const eta = (z - DZ) / Math.max(3, run.v), pred = closing ? yb - RATE * eta : Y0 - RATE * (z - DZ - (TRIG - DZ) > 0 ? (TRIG - DZ) / 9.6 : eta);
        s.hud.readout('door', 'Door gap (m)', yb.toFixed(2), yb < 1.1 ? 'warn' : ''); if (closing) s.hud.readout('eta', 'Door at arrival', Math.max(0, pred).toFixed(2), pred < 0.84 ? 'warn' : pred < 1.12 ? 'ok' : ''); s.pred = pred;
        let w = ''; for (const [wz, txt, k] of warn) { const d = z - wz; if (d > 1 && d < 15) { w = `${K(k)} ${txt}`; break; } } if (z < DZ + 13) w = `${K('S')} SLIDE!`; s.hud.prompt(w);
        if (z < DZ - 0.8) { passed = true; shave = yb - 0.8; run.control = false; run.speedK = 0; run.v = Math.min(run.v, 4); s.rate('Close shave (' + Math.round(shave * 100) + ' cm)', near(shave, 0.1, 0.15, 1.15), 2); doorM = s.moment('under the door', { t0: s.t - 1.8, dur: 3.6, w: 3 }); s.msg(shave < 0.2 ? 'BY A WHISKER!' : shave < 0.4 ? 'CLOSE!' : 'THROUGH', 'good'); s.slowmo(0.5, 0.6); s.objective('The hat! Reach back for it'); if (!hat.visible) { hat.visible = true; run.c.setHat(false); hat.position.set(run.pos.x, 0.02, DZ + 1.1); hv.set(0, 0, 0); } }
      } else if (passed && !s.ended) {
        hatT += dt; s.hud.readout('door', 'Door gap (m)', yb.toFixed(2), 'warn'); s.hud.prompt(hatGot ? '' : `${K('E')} GRAB THE HAT`);
        if (hatT > 0.25 && run.v < 2.5 && !run.c.cycle) run.c.heading = damp(run.c.heading, Math.PI, 8, dt);
        if (run.v < 1 && !hatGot) { run.frozen = true; run.c.setPose('duck', 0.2); run.c.heading = damp(run.c.heading, Math.PI, 8, dt); }
        if (!hatGot && s.input.hit('x') && hatT > 0.15) { if (yb > 0.12) { if (doorM) doorM.t1 = s.t + 2.2; hatGot = true; s.audio.whoosh(1); s.msg('GOT THE HAT', 'good'); s.rate('The hat', 1, 1); s.bonus('Hat grab with ' + Math.round(yb * 100) + ' cm of door left', Math.round(near(yb, 0.22, 0.1, 0.9) * 400)); run.frozen = true; run.c.setPose({ hip: [-0.5, 0.5, 0, 0], sp: [0.7, 0, 0], aR: [0.1, -0.5, 1, 0.05, -0.4, 1], lR: [0.25, -0.25, 1, 0.05, -1, -0.7], lL: [0.25, -0.25, 1, 0.05, -1, -0.7] }, 0.12); s.hud.prompt(''); const side = [clamp(run.pos.x > 0 ? run.pos.x - 3 : run.pos.x + 3, -3.1, 3.1), 0.9, run.pos.z - 2.6];
          s.cut([{ t: s.t, p: run.pos.clone() }, { t: s.t + 3, p: run.pos.clone() }], 'front', { pos: side, fov: 50, R: 2.2 }); // see the snatch while you play
          if (doorM) doorM.shots = [{ type: 'front', speed: 0.5, a: 0.12, b: 0.45, fov: 30 }, { type: 'low', fov: 56, speed: 0.35, a: 0.2, b: 0.6 }, { type: 'front', pos: side, lookUp: 0.55, fov: 46, speed: 0.8, a: 0.5, b: 1.02 }];
          { const g0 = s.t, gx = hat.position.x; s.onUpdate(dt => { const k = s.t - g0; if (k > 2.3) return; run.c.heading = damp(run.c.heading, Math.PI, 12, dt); if (k < 0.6) { run.pos.z = damp(run.pos.z, DZ - 0.85, 8, dt); run.pos.x = damp(run.pos.x, gx, 6, dt); } }); } // turn to the door and lunge back under it
          s.after(0.28, () => { inHand = true; s.audio.whoosh(0.5); });
          s.after(0.8, () => run.c.setPose({ hip: [-0.12, 0.15, 0, 0], sp: [0.12, 0, 0], aR: [0.55, 0.6, 0.35, -0.55, 0.65, -0.05], lR: [0.15, -1, 0.2, 0.05, -1, -0.3], lL: [0.15, -1, -0.1, 0.05, -1, -0.3] }, 0.18));
          s.after(1.2, () => { inHand = false; hat.visible = false; run.c.setHat(true); s.msg('NEVER LEAVE THE HAT', 'good'); });
          s.wrap(2.1, 'And he kept the hat'); } }
        if (!hatGot && yb <= 0.1) { s.rate('The hat', 0.2, 1); s.msg('LOST THE HAT', 'bad'); s.hud.prompt(''); s.flub('Left the hat behind', { penalty: 0.12, advice: 'Once you are through, press E straight away to reach back under the door for the hat.' }); s.wrap(1.4, 'Wardrobe will want a word about the hat'); }
      }
    });
  },
  bot(s, inp) { const r = s.run; botRun(s, inp, { x: r.pos.x * 0.999 }); if (r.pos.z < -100 && s.pred > 1.0) inp.y = 0; if (r.pos.z < -150 + 5 && r.pos.z > -150 + 4.3) inp.press('down'); if (r.pos.z < -151.5 && r.v < 2) inp.press('x'); },
};

// ---------------------------------------------------------------------------------------------
const croc = {
  id: 'croc_run', title: 'Stepping Stones', film: 'Live and Let Die', year: 1973, tier: 2, pay: 3600, mode: 'run', art: 'bd_bayou', music: 'spy',
  role: 'Doubling 007 — safari suit, crocodile-skin shoes, six live crocodiles',
  brief: 'You are marooned on that little island and the only bridge has teeth. Run across their backs to the bank. They are real, they are hungry, and the farmer who owns them did this himself — five takes, one hundred and ninety-three stitches.',
  tips: ['Hold <b>W</b> to run, <b>SPACE</b> to hop to the next back. Let go of W to stop — a back is only three metres long.', 'Watch the <b>jaws</b>: a croc that opens wide is about to snap. Never land on — or stand on — one with its mouth open.', 'Hop on just <b>after</b> the jaws slam shut — you have three seconds before it opens up again.'],
  controls: `${K('W')} run &nbsp; ${K('A')}${K('D')} balance &nbsp; ${K('SPACE')} hop`, intro: { r: 9, h: 3.4, a0: 0.5 },
  assets: { models: ['ch_spy', 'crocodile'], tex: ['bd_bayou', 'tx_grass', 'tx_dirt', 'tx_wood'] },
  build(s) {
    // Kananga's croc farm: hot, hazy Caribbean afternoon light raking across the pond, warm 70s Bond grade
    s.env('day', { backdrop: 'bd_bayou', look: 'warm60s', fog: 0.0065, sun: [36, 75], sunCol: 0xffe2b0, fogColor: 0xa9b29a, lookOver: { sat: 1.0, contrast: 1.08, tint: [1.07, 1.01, 0.9] } });
    s.course.base = () => -2.2; s.water({ y: 0, color: 0x2e4630, opacity: 0.8 });
    const mud = s.mat({ tex: 'tx_dirt', color: 0x8a7a5a }), grass = { tex: 'tx_grass', color: 0xb0c090 };
    s.cyl({ x: 0, y: -1.5, z: 0, r: 2.6, r1: 2.2, h: 1.8, mat: mud, seg: 14 }); s.course.addPiece({ x0: -1.7, x1: 1.7, z0: -1.9, z1: 1.9, fn: () => 0.3 });
    const BZ = -33.3; s.box({ x: 0, y: -2, z: BZ - 20, w: 90, h: 2.4, d: 40, mat: grass, tile: 5, top: true }); s.box({ x: 0, y: -2, z: 34, w: 90, h: 2.4, d: 40, mat: grass, tile: 5, top: true });
    for (const sx of [-1, 1]) s.box({ x: sx * 36, y: -2, z: 0, w: 28, h: 2.4, d: 60, mat: grass, tile: 5 });
    s.forest('tree:cypress', 90, r => { const a = r() * 6.28, d = 24 + r() * 26, x = Math.cos(a) * d * 1.1, z = Math.sin(a) * d - 2; return x > -5 && x < 17 && z < -6 && z > -40 ? null : [x, z, 0.3]; }, { h: [9, 16], seedv: 4 }); // a clear view across the pond from the camera boat s.forest('tree:bush', 40, r => { const a = r() * 6.28, d = 23 + r() * 6; return [Math.cos(a) * d, Math.sin(a) * d - 2, 0.3]; }, { h: [1.2, 2.4], seedv: 6 });
    sign(s, 'TRESPASSERS WILL BE EATEN', { x: -5.5, y: 2.1, z: BZ - 2.5, w: 5.4, ry: 0.35, bg: '#e8e0c8', fg: '#a01810', size: 34 }); for (const dx of [-2, 2]) s.box({ x: -5.5 + dx, y: 0.4, z: BZ - 2.5 + dx * -0.36, w: 0.12, h: 1.2, d: 0.12, mat: 'tx_wood' });
    s.crew({ x: 5.5, y: 0.4, z: 17.5, ry: 0.4 }); s.crew({ x: 6, y: 0.4, z: BZ - 4, ry: 2.4, people: false });
    // the farm on the far bank: a tin-roofed croc shed, a rickety rail fence either side of the landing, palms and reeds
    dress.barn(s, { x: -13, y: 0.4, z: BZ - 13, w: 7, d: 5, h: 2.8, ry: 0.25, color: 0x8a7458, roof: 0x7a6a58, roofTex: 'tx_metal' });
    dress.fence(s, { path: [[-24, BZ - 3.5], [-4.5, BZ - 3.5]], kind: 'rail', h: 1.1, color: 0x7a6a50 }); dress.fence(s, { path: [[4.5, BZ - 3.5], [12, BZ - 3.5]], kind: 'rail', h: 1.1, color: 0x7a6a50 });
    s.trees('palm', 7, (r, i) => [[-19, BZ - 8], [-7, BZ - 18], [9, BZ - 14], [17, BZ - 6], [-26, BZ - 16], [22, 12], [-21, 10]][i], { h: [8, 12], seedv: 8 });
    s.trees('bush', 26, (r, i) => [i % 3 ? -sr(7, 17) : sr(14, 20), sr(-31, -4), -0.25], { h: [0.8, 1.5], seedv: 12, wide: 1.3 }); // reed clumps out in the pond, well off the croc line
    // the crocodiles
    const LEN = 5.2, OX = 0.3785 * LEN / 4.7, OZ = 0.2987 * LEN / 4.7; // the generated croc lies 12° off-axis and off-centre in its box
    const P = 5.8, SNAP = 1.1, WARN = 1.5, lag = [0.8, 3.0, 6.0, 7.4, 10.6, 13.0], xs = [0, 0.5, -0.4, 0.4, -0.5, 0.1], crocs = [];
    for (let i = 0; i < 6; i++) { const z = -5.3 - i * 4.9, m = s.put('crocodile', { x: xs[i], z, len: LEN }), sz = m.userData.size; const c = { m, i, x: xs[i], z, h: sz.y, top: 0.42, st: 'calm', rem: 9, lift: 0, ry: Math.PI + 0.205 + (i % 2 ? 0.07 : -0.06) }; c.piece = s.course.addPiece({ x0: c.x - 0.62, x1: c.x + 0.62, z0: z - 1.55, z1: z + 1.55, fn: () => c.top, step: 0.6 }); c.jaw = crocJaw(s, m); crocs.push(c); }
    const run = s.run = new Run(s, { char: 'ch_spy', x: 0, z: 0.6, auto: false, sprint: 5.6, accel: 30, airAccel: 6, strafe: 3.0, jumpV: 6.6, slide: false, grab: false, fallDeath: 99, steps: false, cam: { dist: 4.6, height: 3.0, side: 1.5, ahead: 4.2, up: 0.1, fov: 56 } }); // high and a little to the side, so the next croc's jaws are never hidden behind 007
    const state = (c, t) => { const ph = ((t - s.t0 - c.i * 0 - lag[c.i]) % P + P) % P; return ph < SNAP ? ['snap', SNAP - ph, 0] : ph > P - WARN ? ['warn', P - ph, P - ph] : ['calm', P - WARN - ph, P - ph]; }; // [state, time left in state, safe time left]
    s.safe = (i, a, b) => { if (i < 0 || i >= crocs.length) return true; const t = s.t, c = crocs[i]; for (let k = a; k <= b + 0.001; k += 0.1) if (state(c, t + k)[0] === 'snap') return false; return true; }; s.crocs = crocs;
    const on = () => crocs.find(c => run.grounded && Math.abs(run.pos.z - c.z) < 1.6 && Math.abs(run.pos.x - c.x) < 0.7);
    let lands = [], bitten = false, wet = false, dunks = 0, done = false, last = null, lastT = 0, heels = 0, safe = null, idleF = false; const tp = V3();
    const bite = c => { if (bitten || s.ended) return; bitten = true; run.dead = true; run.c.setCycle('flail', 1); s.fx.splash(run.pos, 60, 0.8); s.audio.splash(); s.audio.punch(); s.engine.addShake(1); s.fail(s.t - lastT < 0.8 ? 'Landed on a snapping crocodile' : 'Stood on a crocodile while it snapped', { injury: 0.8, advice: 'Only hop when NEXT CROC reads CALM, right after it has snapped — and if you land on a RESTLESS one, hop straight off again.' }); };
    // v2: landing on a snapping croc gives you a beat to get off again; snapping only bites after 0.4 s on its back
    run.onLand = () => { const c = on(); if (c && c !== last) { lands.push(near(Math.abs(run.pos.x - c.x), 0, 0.2, 0.75)); last = c; lastT = s.t; s.fx.splash(tp.set(run.pos.x, 0.05, run.pos.z), 14, 0.35); c.dip = 0.12; s.audio.thud(); if (c.st === 'snap') s.msg('IT IS SNAPPING — GET OFF!', 'bad'); else s.moment('croc ' + (c.i + 1), { t0: s.t - 1.2, dur: 2, w: 0.6 + c.i * 0.1 }); } };
    s.onAction = () => s.objective('Cross the crocodiles to the far bank'); s.dbg = () => ({ z: +run.pos.z.toFixed(1), y: +run.pos.y.toFixed(1), on: on()?.i });
    s.onUpdate((dt, t) => {
      for (const c of crocs) {
        const [st, left] = s.started ? state(c, t) : ['calm', 9]; if (st !== c.st) { if (st === 'snap') { s.fx.splash(tp.set(c.x, 0.1, c.z + 2.1), 40, 0.55); s.audio.punch(); s.audio.splash(); if (last && last.i === c.i + 1 && t - lastT < 0.9 && !bitten) { heels++; s.msg('SNAP! Right at your heels', 'small'); } } c.st = st; }
        c.lift = damp(c.lift, st === 'snap' ? 1 : 0, st === 'snap' ? 16 : 5, dt); c.dip = damp(c.dip || 0, 0, 5, dt);
        const bob = Math.sin(t * 1.7 + c.i * 2.1) * 0.035; c.top = 0.42 + bob - c.dip + c.lift * 0.2; c.m.position.y = c.top - c.h * 0.9; // jaws tell the story: shut and lazy when calm, gaping wide when restless, slammed shut on the snap
        const open = st === 'warn' ? smooth(WARN, WARN * 0.35, left) * (0.92 + 0.08 * Math.sin(t * 9)) : st === 'snap' ? (left > SNAP - 0.12 ? 1 : 0) : 0.06 + 0.04 * Math.sin(t * 0.9 + c.i);
        c.jo = damp(c.jo ?? 0, open, open < (c.jo ?? 0) ? 30 : 4, dt); c.jaw?.open(c.jo);
        c.m.rotation.x = c.lift * (0.16 - 0.1 * clamp((SNAP - left) * 6)) + (st === 'warn' ? 0.05 * c.jo : 0);
        const ry = c.m.rotation.y = c.ry + c.lift * Math.sin(t * 26) * 0.03, cs = Math.cos(ry), sn = Math.sin(ry); c.m.position.x = c.x - (OX * cs + OZ * sn); c.m.position.z = c.z - (-OX * sn + OZ * cs);
         if (st === 'snap' && Math.random() < 0.6) s.fx.spray(tp.set(c.x + rnd(-0.5, 0.5), 0.1, c.z + 2), V3(0, 3, 1), 2, [0.9, 0.95, 1], 0.35);
      }
      if (!s.started || s.ended) return;
      const c = on(); if (c && c.st === 'snap' && state(c, t)[1] < SNAP - 0.4 && t - lastT > 0.4) bite(c);
      if (run.grounded && !wet) { const k = on(); if (k && k.st !== 'snap') safe = k; else if (run.pos.z > -2) safe = null; }
      if (!lands.length && !idleF && t - s.t0 > 14) { idleF = true; s.flub('Dithered on the island', { penalty: 0.15, advice: 'Hold W to walk to the edge of the island, then SPACE onto the first croc as soon as it has snapped.' }); }
      if (!lands.length && t - s.t0 > 34) return s.fail('Never left the island — we lost the light', { injury: 0, advice: 'Hold W to walk to the edge, then SPACE to hop onto a croc that reads CALM. The take only works if you go.' });
      if (run.pos.y < -0.25 && !wet) {
        wet = true; dunks++; run.frozen = true; run.c.setCycle('swim', 2); s.fx.splash(run.pos, 70, 0.9); s.audio.splash(); s.engine.addShake(0.6);
        if (dunks >= 3) { run.dead = true; s.fail('In the water with the crocodiles — third time', { injury: 0.7, advice: 'Stop in the middle of each back (let go of W) and hop only from there — three metres of croc, no more.' }); }
        else { s.flub('Slipped into the water', { penalty: 0.22, advice: 'A back is only three metres long: let go of W to stop on it, then hop. Do not run off the end.' }); s.after(1.1, () => { if (s.ended) return; const k = safe && safe.st !== 'snap' ? safe : null; run.pos.set(k ? k.x : 0, k ? k.top + 0.02 : 0.3, k ? k.z + 0.5 : 0.6); run.vy = 0; run.v = 0; run.vx = 0; run.grounded = true; run.frozen = false; run.c.setPose('ready', 0.2); last = k; lastT = s.t; wet = false; s.fx.splash(run.pos, 20, 0.5); }); }
      }
      const nx = crocs.find(k => k.z < run.pos.z - 1.2); if (nx) { const lbl = { calm: 'CALM', warn: 'RESTLESS', snap: 'SNAPPING' }[nx.st]; s.hud.readout('nx', 'Next croc', lbl, nx.st === 'calm' ? 'ok' : 'warn'); } s.hud.readout('n', 'Crocs crossed', Math.max(0, lands.length - 0) + ' / 6');
      if (run.grounded && run.pos.z < BZ - 0.6 && !done) { done = true; run.control = false; const tt = t - s.t0; s.rate('Footing', lands.reduce((a, b) => a + b, 0) / Math.max(1, lands.length) * (lands.length >= 6 ? 1 : 0.85), 1.5); s.rate('Pace (' + tt.toFixed(1) + ' s)', near(tt, 17, 6, 42), 1); if (heels) s.bonus('Snapped at your heels ×' + heels, heels * 90); s.moment('onto the bank', { t0: s.t - 3.4, dur: 4.6, w: 2.2 }); s.msg('ACROSS!', 'good'); s.wrap(1.5, 'Count your toes'); }
    });
  },
  bot(s, inp, B) {
    const r = s.run, z = r.pos.z, C = s.crocs; if (!r.grounded) { B.go = false; inp.a = true; inp.y = 1; const nx = C.find(c => c.z < z + 0.4 && c.z > z - 4) || { x: 0 }; inp.x = clamp((nx.x - r.pos.x) * 3, -1, 1); return; }
    const i = C.findIndex(c => c.z < z - 1.7), nx = C[i], cur = C.find(c => Math.abs(c.z - z) < 1.7), edge = z > -2 ? -1.9 : !cur ? -99 : cur.z - 1.55; // front edge of what we stand on
    if (edge < -90) { inp.y = 1; return; }
    const cx = cur ? cur.x : 0, tx = clamp(nx ? nx.x : 0, cx - 0.3, cx + 0.3); inp.x = clamp((tx - r.pos.x) * 3, -1, 1);
    if (B.go && z > edge + 0.3) { inp.y = 1; if (z < edge + 0.75) inp.press('a'); return; } B.go = false;
    const mark = edge + 1.15; inp.y = z > mark + 0.25 ? 0.6 : 0; if (z <= mark + 0.3 && r.v < 1 && Math.abs(tx - r.pos.x) < 0.25 && s.safe(i, 0.55, 1.75)) B.go = true;
  },
};

// ---------------------------------------------------------------------------------------------
const rumble = {
  id: 'rumble_bronx', title: 'No Wires, No Pad', film: 'Rumble in the Bronx', year: 1995, tier: 3, pay: 7000, mode: 'run', art: 'bd_brooklyn', music: 'kungfu',
  role: 'Doubling the Hong Kong delivery boy — rooftop car park, one fire escape',
  brief: 'Across the car park flat out, off the edge of the roof, and onto that little balcony across the alley. Eight metres of fresh air, seven floors up. No wire, no airbag, one take — the star did it for real, so you do too.',
  tips: ['You need a <b>full sprint</b> at the edge — hold <b>W</b> and do not clip the parked cars.', 'Take off in the <b>last metre</b> of roof (yellow line) and <b>hold SPACE</b> for the full leap.', 'The balcony is two metres wide: line up with the <b>green marker</b> and steer in the air.'],
  controls: CTL.run, intro: { r: 9, h: 3, a0: 2.4 },
  assets: { models: ['ch_hk', 'sedan_grey', 'taxi', 'van_white', 'wagon_brown'], tex: ['bd_brooklyn', 'tx_asphalt', 'tx_fac_nyc', 'tx_brick', 'tx_concrete', 'tx_roof', 'tx_metal'] },
  build(s) {
    s.env('day', { backdrop: 'bd_brooklyn', look: 'bleach', fog: 0.0034, sun: [30, 55], sunCol: 0xfff0dc, lookOver: { sat: 0.82, tint: [1.03, 1.0, 0.95] } }); s.ground({ tex: 'tx_asphalt', tile: 10, color: 0x666666 });
    const YA = 24, YB = 22.5, E1 = -64, B0 = -67.6, EDGE = -130, ALLEY = 8.25, BX = 2.2, YBAL = YB - 2.6, BZ0 = EDGE - ALLEY, BZ1 = BZ0 - 2.4;
    const park = { tex: 'tx_asphalt', color: 0x8a8a8a }, conc = s.mat({ tex: 'tx_concrete', color: 0xb0aca4 }), iron = s.mat({ tex: 'tx_metal', color: 0x2a2c2e, metal: 0.5, rough: 0.6 });
    s.building({ x: 0, z: (30 + E1) / 2, w: 18, d: 30 - E1, h: YA, fac: 'tx_brick', top: true, roofMat: park }); s.building({ x: 0, z: (B0 + EDGE) / 2, w: 18, d: B0 - EDGE, h: YB, fac: 'tx_fac_nyc', top: true, roofMat: park });
    for (const sx of [-1, 1]) { s.box({ x: sx * 8.8, y: YA, z: (30 + E1) / 2, w: 0.4, h: 0.9, d: 30 - E1, mat: conc }); s.box({ x: sx * 8.8, y: YB, z: (B0 + EDGE) / 2, w: 0.4, h: 0.9, d: B0 - EDGE, mat: conc }); }
    s.box({ x: 0, y: YA, z: 29.8, w: 18, h: 0.9, d: 0.4, mat: conc });
    // parking bays + parked cars (dodge), a low wall to vault
    s.plan = []; const cars = [['sedan_grey', -2.2, 2], ['taxi', 2.4, -14], ['van_white', -1.6, -30], ['wagon_brown', 2.2, -46], ['sedan_grey', 2.6, -80], ['taxi', -2.4, -94], ['van_white', 1.4, -108]];
    for (const [id, x, z] of cars) { const y = z > E1 ? YA : YB; s.put(id, { x, y, z, ry: x > 0 ? 0.12 : Math.PI - 0.1, solid: true, sol: { msg: 'Ran into a parked car', bump: true, penalty: 0.12, advice: 'Pick your side of each parked car early — steer with A/D while it is still ten metres away.' } }); s.plan.push({ z0: z + 11, z1: z - 3, x: x > 0 ? x - 3.6 : x + 3.6 }); }
    for (let z = 20; z > EDGE + 12; z -= 3.2) { if (z < E1 + 4 && z > B0 - 4) continue; for (const sx of [-1, 1]) s.line({ x: sx * 6.1, z, w: 4.6, d: 0.12, y: z > E1 ? YA : YB, color: 0xe8e8e0, glow: 0.8 }); }
    for (const [x, z, id] of [[-6.4, 12, 'wagon_brown'], [6.4, -4, 'sedan_grey'], [-6.4, -36, 'taxi'], [6.4, -86, 'van_white'], [-6.3, -112, 'sedan_grey']]) s.put(id, { x, y: z > E1 ? YA : YB, z, ry: Math.PI / 2 });
    s.box({ x: 0, y: YA, z: -56, w: 17.2, h: 0.75, d: 0.4, mat: conc, solid: true, sol: { soft: true, once: true, msg: 'Clipped the low wall' } }); s.plan.push({ z: -56 + 2.4, act: 'jump' }); s.plan.push({ z: E1 + 0.9, act: 'jump' });
    s.line({ x: 0, z: E1 + 0.5, w: 17, d: 0.5, y: YA, color: 0xffe14a }); s.line({ x: 0, z: EDGE + 0.5, w: 17, d: 1, y: YB, color: 0xffe14a, glow: 1.8 }); s.line({ x: BX, z: EDGE + 6, w: 1.6, d: 9, y: YB, color: 0x30ff70, glow: 0.7 }).material.opacity = 0.3;
    // the building opposite, with its fire escape
    // overshooting into the wall above the balcony is a hard flub: you slap the bricks and drop onto the grating
    const wall = s.building({ x: 0, z: BZ1 - 11, w: 30, d: 22, h: 34, fac: 'tx_fac_nyc', sol: { msg: 'Missed the balcony and hit the wall', injury: 0.9, grab: false, advice: 'Line up with the green marker before the edge (A/D) — the balcony is only two metres wide, and you can only steer a little in the air.', on: r => { if (r.grounded) return true; if (Math.abs(r.pos.x - BX) < 1.25 && r.pos.y > YBAL - 0.6 && r.pos.y < YBAL + 2.6) { r.v = 0; r.pos.z = BZ1 + 0.4; r.pos.x = clamp(r.pos.x, BX - 0.8, BX + 0.8); s.audio.impact(0.7); s.engine.addShake(0.8); s.flub('Slammed into the wall past the balcony', { penalty: 0.15, advice: 'You jumped a touch long — take off right on the yellow line, not before it.' }); return true; } } } });
    for (let k = 0; k < 6; k++) { const y = YBAL - k * 3.3; s.box({ x: BX, y: y - 0.14, z: (BZ0 + BZ1) / 2, w: 2, h: 0.14, d: 2.4, mat: iron, cast: k < 2 }); for (const sx of [-1, 1]) { s.box({ x: BX + sx * 0.97, y, z: (BZ0 + BZ1) / 2, w: 0.05, h: 0.05, d: 2.4, mat: iron, cast: false }).position.y = y + 1; for (let j = 0; j < 4; j++) s.box({ x: BX + sx * 0.97, y, z: BZ0 - 0.05 - j * 0.78, w: 0.04, h: 1, d: 0.04, mat: iron, cast: false }); } s.box({ x: BX + 0.5, y: y - 3.3, z: BZ1 + 0.3, w: 0.5, h: 3.3, d: 0.06, mat: iron, cast: false, rx: 0.2 }); s.box({ x: BX - 0.2, y: y + 0.2, z: BZ1 - 0.02, w: 1.1, h: 1.9, d: 0.06, mat: s.mat({ color: 0x1c2228, rough: 0.3 }), cast: false }); }
    s.course.addPiece({ x0: BX - 1, x1: BX + 1, z0: BZ1, z1: BZ0, fn: () => YBAL, step: 0.7 }); s.course.addSolid({ x0: BX - 1, x1: BX + 1, y0: YBAL - 0.25, y1: YBAL, z0: BZ1, z1: BZ0 });
    for (const [sd, x] of [[-1, -17], [1, 17]]) s.row({ side: sd, x, z0: 60, z1: -220, fac: ['tx_fac_nyc', 'tx_brick'], height: [14, 30], seedv: sd + 4, solid: false });
    s.crew({ x: 5.5, y: YA, z: 18, ry: 0.9 }); s.crew({ x: -6.5, y: YB, z: EDGE + 7, ry: -2.3, people: false });
    // a wooden water tank on the roof across the alley (pure New York skyline) and trash down in the alley
    const tank = s.mat({ tex: 'tx_wood', color: 0x7a5a40 }); s.cyl({ x: -7, y: 38, z: BZ1 - 12, r: 2.2, h: 4.2, mat: tank, seg: 18 }); s.cyl({ x: -7, y: 42.2, z: BZ1 - 12, r: 0.2, r1: 2.5, h: 1.6, mat: iron, seg: 18 });
    for (const [x, z] of [[-8.6, BZ1 - 9.4], [-5.4, BZ1 - 9.4], [-8.6, BZ1 - 14.6], [-5.4, BZ1 - 14.6]]) s.box({ x, y: 34, z, w: 0.22, h: 4, d: 0.22, mat: iron, cast: false });
    for (const [x, z, c] of [[-5, EDGE - 1.5, 0x2a4a30], [-2.6, EDGE - 1.2, 0x5a5a60], [6, EDGE - 6.6, 0x2a4a30]]) s.box({ x, y: 0, z, w: 1.8, h: 1.3, d: 1, mat: { tex: 'tx_metal', color: c }, ry: 0.1 });
    const run = s.run = new Run(s, { char: 'ch_hk', x: 0, z: 24, y: YA, xmin: -8.2, xmax: 8.2, fallDeath: 8, cam: { dist: 6.4, height: 2.9, ahead: 4 } });
    let leapt = false, landed = false, takeV = 0, takeD = 0, leapM = null; s.rate('Run-up', 1, 1); run.autoMoments = false;
    run.onStumble = () => { s.rate('Run-up', 1 - run.stats.stumbles * 0.3, 1); s.msg('CLIPPED IT', 'bad'); if (Math.abs(run.pos.z + 56) < 3) s.flub('Clipped the low wall', { penalty: 0.06, advice: 'Hop the low wall with SPACE about two metres before it — it costs you speed for the leap.' }); };
    run.onJump = () => { if (run.pos.z < EDGE + 6 && !leapt) { leapt = true; takeV = run.v; takeD = run.pos.z - EDGE; s.rate('Take-off (' + takeD.toFixed(1) + ' m from the edge)', near(takeD, 0.3, 0.6, 2.4), 1.5); s.rate('Speed', near(takeV, 9.6, 0.5, 2.6), 1); s.slowmo(0.4, 1.6); leapM = s.moment('the alley leap', { t0: s.t - 1.3, dur: 3.2, w: 3 }); if (takeV < 9) s.flub('Not at full sprint for the leap', { penalty: 0.1, advice: 'Hold W from the second roof all the way to the edge — you want 34 km/h or more on the readout.' }); s.cam.set({ dist: 8.5, height: 4.2, side: 4.5 }); s.objective('Hold SPACE — steer for the balcony'); } };
    const stick = (grabbed) => { if (landed) return; landed = true; if (leapM) leapM.t1 = s.t + (grabbed ? 2 : 1.3); const off = Math.abs(run.pos.x - BX); run.control = false; run.speedK = 0; run.v = Math.min(run.v, 2.2); s.rate('Landing', grabbed ? 0.35 : near(off, 0, 0.4, 1.3), 2); if (grabbed) s.flub('Caught the balcony by your fingertips', { penalty: 0.12, advice: 'You were a little short: take off on the yellow line at full sprint and hold SPACE all the way across.' }); s.bonus('Alley cleared: ' + (ALLEY + Math.max(0, takeD)).toFixed(1) + ' m', grabbed ? 0 : 400); s.msg(grabbed ? 'BY YOUR FINGERTIPS' : off < 0.35 ? 'NAILED IT!' : 'ON THE BALCONY', 'good'); s.engine.addShake(0.8); s.wrap(grabbed ? 2.2 : 1.6, grabbed ? 'He made it. Just.' : 'One take. Print it.'); };
    run.onGrab = sol => { if (run.pos.z < EDGE - 2) stick(true); };
    run.onLand = i => { if (run.pos.y < 6) { const z = run.pos.z; run.die(z < EDGE ? (leapt ? 'Fell short of the balcony — seven floors down' : 'Ran off the roof without jumping') : 'Fell between the buildings', 1, false, z < EDGE ? (leapt ? 'Take off ON the yellow line at full sprint (34+ km/h) and hold SPACE — and line up with the green marker first.' : 'Press SPACE at the yellow line at the very edge of the second roof — the prompt flashes LEAP.') : 'Jump the gap between the two roofs (SPACE at the first yellow line), or at least keep sprinting off it.'); run.c.setPose('lie', 0.1); return true; } if (run.pos.z < BZ0 + 0.1 && run.pos.y < YBAL + 0.5) { stick(false); run.stun = 0.5; run.c.setPose('land', 0.06); s.audio.impact(0.7); return true; } };
    s.onAction = () => s.objective('Sprint the car park — leap from the yellow line'); s.dbg = () => ({ z: +run.pos.z.toFixed(1), x: +run.pos.x.toFixed(1), y: +run.pos.y.toFixed(1), v: +run.v.toFixed(1), takeD: +takeD.toFixed(2) });
    s.onUpdate(() => { if (!s.started || s.ended) return; s.hud.readout('spd', 'km/h', Math.round(run.v * 3.6), run.v > 9.2 ? 'ok' : run.pos.z < EDGE + 40 ? 'warn' : ''); if (!leapt && run.pos.z < EDGE + 60) s.hud.readout('edge', 'Edge in (m)', Math.max(0, run.pos.z - EDGE).toFixed(0), run.pos.z < EDGE + 12 ? 'warn' : ''); if (!leapt && run.pos.z < EDGE + 14 && run.pos.z > EDGE) s.hud.prompt(`${K('SPACE')} LEAP at the line`); else s.hud.prompt(''); });
  },
  bot(s, inp) { const r = s.run; botRun(s, inp, { x: r.pos.z < -112 ? 2.2 : 0 }); if (r.pos.z < -112) inp.x = clamp((2.2 - r.pos.x) * 2.5, -1, 1); if (r.pos.z < -130 + 0.55 && r.pos.z > -130.2 && r.grounded) inp.press('a'); },
};

// ---------------------------------------------------------------------------------------------
const dieHard = {
  id: 'die_hard', title: 'Welcome to the Party', film: 'Die Hard', year: 1988, tier: 3, pay: 8500, mode: 'run', art: 'bd_nyc_night', music: 'tension',
  role: 'Doubling the barefoot cop — vest, fire hose, forty storeys of glass',
  brief: 'The roof is wired to blow. You tie the fire hose round your waist, run for the edge with the fireball right on your back and jump — late as you dare. Then you swing in on the hose and shoot out the window. Barefoot, obviously.',
  tips: ['The blast chases you across the roof. Ease off <b>W</b> to let it get close — <b>the hotter your back, the better the shot</b>.', 'Dodge the vents, then <b>SPACE</b> to jump off the edge in the last couple of metres.', `On the hose: press ${K('E')} as you swing <b>into</b> the glass — inside the green zone — to shoot the window out.`],
  controls: RUNE, intro: { r: 10, h: 3.4, a0: 0.4 },
  assets: { models: ['ch_cop', 'helicopter'], tex: ['bd_nyc_night', 'tx_glass_tower', 'tx_concrete', 'tx_roof', 'tx_metal', 'tx_fac_night', 'tx_hotel'] },
  build(s) {
    s.env('night', { backdrop: 'bd_nyc_night', look: 'teal_orange', fog: 0.0012, amb: 0.5, sunI: 1.1 }); s.ground({ tex: 'tx_concrete', tile: 12, color: 0x333840 });
    const Y = 120, EDGE = -84, FY = 105.4, CY = 109, HW = 20, L = 13.2, AX = 0;
    const lit = { tex: 'tx_glass_tower', emissive: 0xffd9a0, emI: 0.5, emMap: true, rough: 0.3, metal: 0.4 }, roofM = s.mat({ tex: 'tx_roof', color: 0xc0c4cc }), conc = s.mat({ tex: 'tx_concrete', color: 0x9a9aa0 }), steel = s.mat({ tex: 'tx_metal', color: 0x8a9098, metal: 0.6, rough: 0.5 });
    const side = s.mat(lit); const zc = (40 + EDGE) / 2, D = 40 - EDGE;
    s.box({ x: 0, y: 0, z: zc, w: HW * 2, h: FY, d: D, mats: [side, side, conc, conc, side, side], tile: 14 }); s.box({ x: 0, y: CY, z: zc, w: HW * 2, h: Y - CY, d: D, mats: [side, side, roofM, conc, side, side], tile: 14, tileTop: 7, top: true });
    s.course.addPiece({ x0: -HW, x1: HW, z0: EDGE, z1: 40, fn: () => FY, step: 0.5 });
    // open office floor behind glass
    s.box({ x: 0, y: FY, z: zc, w: HW * 2 - 6, h: CY - FY, d: D - 6, mat: s.mat({ tex: 'tx_hotel', color: 0x807060, emissive: 0x403020, emI: 0.6 }), tile: 4 });
    const glass = s.mat({ glass: true, color: 0x9fd0e8, opacity: 0.28 }), panes = [];
    for (let x = -HW + 2; x < HW; x += 4) { const m = s.box({ x, y: FY, z: EDGE + 0.05, w: 3.9, h: CY - FY, d: 0.08, mat: glass, cast: false }); panes.push(m); s.box({ x: x - 2, y: FY, z: EDGE + 0.05, w: 0.14, h: CY - FY, d: 0.16, mat: steel, cast: false }); }
    for (const sx of [-1, 1]) s.box({ x: sx * (HW - 0.05), y: FY, z: zc, w: 0.08, h: CY - FY, d: D, mat: glass, cast: false });
    for (let x = -14; x <= 14; x += 7) { s.light({ x, y: CY - 0.5, z: EDGE + 3.4, color: 0xfff0d0, i: 26, dist: 14, r: 0.12 }); s.box({ x: x + 3, y: FY, z: EDGE + 8.5, w: 1.6, h: 0.75, d: 0.8, mat: s.mat({ tex: 'tx_metal', color: 0x504840 }) }); }
    // roof dressing: helipad, parapet, vents
    for (const sx of [-1, 1]) s.box({ x: sx * (HW - 0.2), y: Y, z: zc, w: 0.4, h: 0.6, d: D, mat: conc }); s.box({ x: 0, y: Y, z: 39.8, w: HW * 2, h: 0.6, d: 0.4, mat: conc });
    s.mark({ x: 0, z: -22, y: Y, r: 9, color: 0x7a6a1c }); for (const [dx, dz, w, d] of [[-2.4, 0, 0.8, 7], [2.4, 0, 0.8, 7], [0, 0, 4.8, 0.8]]) s.line({ x: dx, z: -22 + dz, w, d, y: Y, color: 0xffffff, glow: 1 });
    s.put('helicopter', { x: -12, y: Y, z: 22, ry: 0.7, len: 11 }); for (let z = 30; z > EDGE; z -= 19) for (const sx of [-1, 1]) s.light({ x: sx * (HW - 1.2), y: Y + 3.2, z: z + sx * 4, color: sx > 0 ? 0xbfd8ff : 0xffe0b0, i: 46, dist: 34, r: 0.14 });
    s.plan = []; const warnV = [];
    for (const [x, z, w, d, h] of [[-2.5, -6, 3, 2, 1.5], [3, -40, 3.4, 2.2, 1.7], [-2.6, -54, 3, 2, 1.5], [2.4, -68, 2.6, 2, 1.4]]) { s.box({ x, y: Y, z, w, h, d, mat: steel, tile: 2, solid: true, sol: { soft: true, once: true } }); s.box({ x, y: Y + h, z, w: w * 0.5, h: 0.3, d: d * 0.6, mat: s.mat({ color: 0x22262a }) }); warnV.push(z); s.plan.push({ z0: z + 11, z1: z - 2, x: x > 0 ? x - 3.4 : x + 3.4 }); }
    for (let x = -18; x <= 18; x += 6) s.light({ x, y: Y + 0.5, z: EDGE + 0.4, color: 0xff3020, i: 5, dist: 7, r: 0.1 });
    s.line({ x: 0, z: EDGE + 1.2, w: HW * 2 - 1, d: 2.4, y: Y, color: 0xffe14a }).material.opacity = 0.35;
    for (const [sd, x, sv] of [[-1, -44, 2], [1, 44, 6]]) s.row({ side: sd, x, z0: 120, z1: -260, fac: ['tx_fac_night'], height: [40, 100], width: [24, 40], depth: [24, 36], lit: 0.9, seedv: sv, solid: false });
    for (const [x, z, h] of [[-26, -150, 70], [22, -170, 90], [60, -140, 60], [-64, -180, 85]]) s.building({ x, z, w: 30, d: 30, h, fac: 'tx_fac_night', lit: 0.9, solid: false });
    // hose reel
    s.cyl({ x: 2.2, y: Y + 0.5, z: 12.6, r: 0.55, h: 0.35, rz: Math.PI / 2, color: 0xb02018 }); s.box({ x: 2.2, y: Y, z: 12.6, w: 0.5, h: 0.5, d: 0.3, mat: steel }); s.crew({ x: 7, y: Y, z: 16, ry: 0.8, light: 120 });
    const run = s.run = new Run(s, { char: 'ch_cop', x: 0, z: 10, y: Y, xmin: -HW + 1, xmax: HW - 1, fallDeath: 400, cam: { dist: 6.8, height: 3.2, ahead: 4 } });
    const key = s.light({ x: 0, y: Y + 3, z: 12, color: 0xfff0e0, i: 22, dist: 13, bulb: false }); const hose = rope(s, { r: 0.045, color: 0xd8cfb0 }), reel = V3(2.2, Y + 0.5, 12.6), waist = V3(), A = V3(AX, Y + 0.3, EDGE - 0.35);
    let front = 32, fv = 0, nextB = 30, phase = 'roof', gapJ = 0, th = 0, om = 0, vy = 0, vz = 0, swings = 0, lock = false, shotQ = 0, tIn = 0, flameT = 0, blastM = null; const P = run.pos, tp = V3(), fires = []; run.autoMoments = false;
    const blast = (x, z, sc = 1.3) => { s.fx.explosion(tp.set(x, Y + 1, z), sc); s.audio.explosion(0.8); s.engine.addShake(0.5); fires.push(V3(x, Y + 0.2, z)); if (fires.length > 10) fires.shift(); };
    s.rate('Clean run', 1, 1); run.onStumble = () => { s.rate('Clean run', 1 - run.stats.stumbles * 0.35, 1); s.msg('STUMBLE!', 'bad'); s.flub('Clipped a roof vent', { penalty: 0.06, advice: 'Steer round the vents early with A/D — a stumble lets the fireball jump three metres closer.' }); };
    s.onAction = () => s.objective('Run for the edge — let the blast get close'); s.dbg = () => ({ ph: phase, z: +P.z.toFixed(1), y: +P.y.toFixed(1), gap: +(front - P.z).toFixed(1), th: +th.toFixed(2), sw: swings });
    s.onUpdate((dt, t) => {
      waist.set(P.x, P.y + 1.05, P.z + 0.1); key.position.set(P.x + (phase === 'roof' ? 1 : 4), P.y + (phase === 'roof' ? 3 : 2), P.z + (phase === 'roof' ? 2.5 : -4)); if (phase === 'roof') hose.set(reel, waist); else hose.set(A, waist);
      for (const f of fires) if (Math.random() < 0.6) s.fx.flame(f, 1.4);
      if (!s.started) return; const tt = t - s.t0;
      if (phase === 'roof') {
        const gap = front - P.z; if (tt > 0.9) { fv = damp(fv, 8.9 + clamp((gap - 6) * 0.3, 0, 3), 2, dt); front -= fv * dt; }
        if (front < nextB) { nextB -= 6.5; blast(rnd(-9, 9) + P.x * 0.5, front + 2); s.fx.debris(tp.set(P.x + rnd(-3, 3), Y + 2, front), 8, { color: 0x333333, speed: 14, dir: V3(0, 0.3, -1), floor: Y }); if (gap < 14) { s.engine.flash(0.25 * clamp(1 - gap / 14)); s.fx.light(tp.set(P.x, Y + 2, P.z + 3), 0xff8030, 40, 0.4, 20); } }
        if (!s.ended) { s.hud.readout('gap', 'Fireball (m)', Math.max(0, gap).toFixed(1), gap < 4.5 ? 'ok' : gap < 2 ? 'warn' : ''); s.hud.readout('edge', 'Edge in (m)', Math.max(0, P.z - EDGE).toFixed(0), P.z < EDGE + 15 ? 'warn' : ''); s.hud.prompt(P.z < EDGE + 13 ? `${K('SPACE')} JUMP!` : ''); }
        if (gap < 0.6 && tt > 1.5 && !s.ended) { blast(P.x, P.z, 1.6); run.die('Caught in the blast — you let it get too close', 0.9, true, 'Keep the FIREBALL readout between 2 and 4 m — the moment it drops under 2, hold W and sprint again. Never let it under 1 m.'); return; }
        if (P.z < EDGE - 0.2 && !run.grounded && !run.dead) { // over the edge: take over
          phase = 'fall'; gapJ = gap; const d = run.takeZ - EDGE, jumped = run.vy > -3 || run.stats.jumps > 0 && d < 4; run.frozen = true; vy = run.vy; vz = -run.v; s.hud.prompt('');
          s.rate('Heat on your back (' + gap.toFixed(1) + ' m)', near(gap, 2.6, 1.8, 13), 2); s.rate('Leap', jumped ? near(d, 0.5, 1.0, 4) : 0.3, 1); if (!jumped) s.flub('Ran off the edge without jumping', { penalty: 0.1, advice: 'Press SPACE in the last two metres of roof — the prompt flashes JUMP — for the big leap out.' });
          blastM = s.moment('the rooftop blast', { t0: s.t - 1.6, dur: 6, w: 3 });
          for (let i = 0; i < 5; i++) s.after(i * 0.12, () => blast(P.x + rnd(-8, 8), EDGE + 2 + rnd(0, 8), 1.8)); s.engine.flash(0.6); s.audio.explosion(1.2); s.engine.addShake(1.4); s.slowmo(0.35, 1.3); s.msg(gap < 4.5 ? 'YIPPEE-KI-YAY!' : 'JUMP!', 'good'); s.objective('Swing in and shoot out the window');
          run.c.setPose('fall', 0.15); s.cam.fixed(V3(P.x + 8.5, Y - 10.5, EDGE - 11), () => ({ pos: P, heading: 0 }), { fov: 55, up: 1.2, lookStiff: 5 }); key.intensity = 70; key.distance = 20;
        }
      } else if (phase === 'fall') {
        vy -= 16 * dt; P.y += vy * dt; P.z += vz * dt; if (Math.random() < 0.5) s.fx.debris(tp.set(P.x + rnd(-6, 6), Y + 1, EDGE + 1), 2, { color: 0x333333, speed: 9, dir: V3(0, 0.2, -1), floor: 0 });
        const dy = A.y - (P.y + 1.05), dz = A.z - P.z, dist = Math.hypot(dy, dz);
        if (dist >= L) { phase = 'swing'; th = Math.atan2(dz, dy); const tz = -Math.cos(th), ty = Math.sin(th); om = (vz * tz + vy * ty) / L * 0.9; s.engine.addShake(0.9); s.audio.thud(); s.audio.whoosh(1.4); run.c.setPose('hoseswing', 0.2); s.msg('HOSE HOLDS!', 'small'); }
      } else if (phase === 'swing') {
        om += (-(15 / L) * Math.sin(th) - om * 0.05) * dt; th += om * dt; tIn += dt; // th > 0 = out from the building
        P.set(AX + (P.x - AX) * (1 - dt * 2), A.y - Math.cos(th) * L - 1.05, A.z - Math.sin(th) * L); run.c.cur.body[0] = -th * 0.7; s.audio.set('wind', 'wind', 0.8 + Math.abs(om), 0.3);
        const v = clamp(1 - th / 0.95), inbound = om < 0; if (!s.ended) { s.hud.bar(v, [0.76, 0.97], [0.87, 0.95]); s.hud.prompt(lock ? '' : `${K('E')} SHOOT`); s.bar = v; s.inb = inbound; }
        if (s.input.hit('x') && !lock && !s.ended) { lock = true; for (let i = 0; i < 3; i++) s.after(i * 0.07, () => s.audio.gun()); s.fx.sparks(tp.set(P.x, P.y + 1.2, P.z + 0.6), 8, { speed: 5 }); if (inbound && v > 0.76 && v < 0.975) { shotQ = near(v, 0.905, 0.06, 0.2); for (const m of panes) if (Math.abs(m.position.x - P.x) < 2.1) m.visible = false; s.fx.glass(tp.set(P.x, FY + 1.6, EDGE), 70, { dir: V3(0, 0, 1), speed: 6 }); s.audio.glass(); s.msg('GLASS OUT!', 'good'); } else s.msg(inbound ? (v <= 0.76 ? 'TOO EARLY' : 'TOO LATE') : 'WRONG WAY — wait for the swing in', 'bad'); }
        if (th <= 0.02 && om < 0) { // at the glass
          swings++; if (shotQ > 0) { phase = 'in'; if (blastM) blastM.t1 = s.t + 1.6; vz = -om * L; vy = 1.5; s.rate('Window timing', shotQ * (swings === 1 ? 1 : swings === 2 ? 0.8 : 0.6), 2); s.hud.hideBar(); s.hud.prompt(''); s.audio.set('wind', 'wind', 1, 0); hose.visible = false; s.slowmo(0.5, 0.7); s.cam.fixed(V3(P.x + 4.2, FY + 1.3, EDGE + 7.5), () => ({ pos: P, heading: 0 }), { fov: 58, up: 1 }); run.c.setPose('kick', 0.1); }
          else if (swings >= 3 || Math.abs(om) * 0.72 * L < 3) { // v2: no more swing in it — he kicks the glass through instead
            shotQ = 0.15; phase = 'in'; if (blastM) blastM.t1 = s.t + 1.6; vz = Math.max(3.5, -om * L); vy = 1.2; for (const m of panes) if (Math.abs(m.position.x - P.x) < 2.1) m.visible = false; s.fx.glass(tp.set(P.x, FY + 1.6, EDGE), 70, { dir: V3(0, 0, 1), speed: 4 }); s.audio.glass(); s.audio.impact(0.8);
            s.rate('Window timing', 0.15, 2); s.hud.hideBar(); s.hud.prompt(''); s.audio.set('wind', 'wind', 1, 0); hose.visible = false; s.cam.fixed(V3(P.x + 4.2, FY + 1.3, EDGE + 7.5), () => ({ pos: P, heading: 0 }), { fov: 58, up: 1 }); run.c.setPose('kick', 0.1);
            s.flub('Kicked through the glass — never shot it out', { penalty: 0.2, advice: 'Press E only while you swing IN toward the building, when the needle is in the green (right-hand end of the bar).' });
          }
          else { om = -om * 0.72; th = 0.021; lock = false; s.engine.addShake(0.8); s.audio.impact(0.6); s.msg('BOUNCED OFF THE GLASS', 'bad'); s.flub('Bounced off the glass', { penalty: 0.06, quiet: true, advice: 'Press E only while you swing IN toward the building, when the needle is in the green (right-hand end of the bar).' }); }
        }
      } else if (phase === 'in') {
        vy -= 16 * dt; P.z += vz * dt; P.y = Math.max(FY, P.y + vy * dt); vz = Math.min(vz, 9);
        if (P.y <= FY && phase === 'in') { vz = damp(vz, 0, 5, dt); run.c.setPose(vz > 1.5 ? 'slide' : 'crouch', 0.15); run.c.cur.body[0] *= 0.9; if (Math.random() < 0.5) s.fx.debris(tp.set(P.x, FY + 0.3, P.z), 1, { color: 0xcfe8ef, speed: 3, size: 0.12, floor: FY }); if (vz < 0.6 && !s.ended) { s.msg('INSIDE!', 'good'); s.wrap(1.4, 'Now I have a machine gun. Ho ho ho.'); } }
      }
    });
  },
  bot(s, inp) {
    const r = s.run, d = s.dbg(); if (d.ph === 'roof') { botRun(s, inp); if (d.gap < 4.2 && r.pos.z > -84 + 9 || d.gap < 3.2) inp.y = 1; else if (r.pos.z < -20) inp.y = 0; if (r.pos.z < -84 + 0.9 && r.grounded) inp.press('a'); }
    else if (d.ph === 'swing' && s.inb && s.bar > 0.885 && s.bar < 0.95) inp.press('x');
  },
};

// ---------------------------------------------------------------------------------------------
const crane = {
  id: 'casino_crane', title: 'High Steel', film: 'Casino Royale', year: 2006, tier: 4, pay: 13000, mode: 'run', art: 'bd_ocean', music: 'spy',
  role: 'Doubling the new 007 — chasing a free-running bomb-maker across three tower cranes',
  brief: 'He goes up the crane, you go up the crane. He jumps to the next one, you jump to the next one. The jib is a foot wider than your shoulders and it is two hundred feet straight down. Stay on him, and stay on the steel.',
  tips: ['The jib is <b>narrow</b>: small corrections only. Step off the side and that is the end of the picture.', '<b>Slide</b> under the yellow tie-frames, <b>jump</b> the cable drums, and <b>hold SPACE</b> for the leaps between cranes.', 'Keep the bomb-maker inside <b>15 metres</b> — sprint on the open steel, he will not wait.'],
  controls: CTL.run, intro: { r: 9, h: 3, a0: 2.5 },
  assets: { models: ['ch_spy', 'ch_thug'], tex: ['bd_ocean', 'tx_metal', 'tx_sand', 'tx_concrete', 'tx_dirt'] },
  build(s) {
    // Madagascar building site by the sea: hard tropical sun, red laterite earth, salt haze over the water
    s.env('day', { backdrop: 'bd_ocean', look: 'teal_orange', fog: 0.0017, hz: 0.5, sun: [42, 65], sunCol: 0xfff0d8, lookOver: { contrast: 1.14, sat: 1.12 } }); s.ground({ tex: 'tx_dirt', tile: 14, color: 0xb07a58 }); s.audio.set('wind', 'wind', 1, 0.35);
    s.water({ x: 2620, y: 0.15, w: 5000, d: 7000, color: 0x1f6a78 }); s.box({ x: 108, y: -0.3, z: -100, w: 26, h: 0.4, d: 2400, mat: { tex: 'tx_sand', color: 0xd8c8a0 }, tile: 12, cast: false });
    const Y1 = 60, Y2 = 57, Y3 = 58, yel = s.mat({ tex: 'tx_metal', color: 0xffd23a, rough: 0.6, metal: 0.1, emissive: 0x5a4200, emI: 0.5 }), red = s.mat({ tex: 'tx_metal', color: 0xff5a38, rough: 0.6, metal: 0.1, emissive: 0x5a1000, emI: 0.5 }), grey = s.mat({ tex: 'tx_metal', color: 0x7a8088, metal: 0.5, rough: 0.5 }), conc = s.mat({ tex: 'tx_concrete', color: 0xb0aaa0 });
    // lattice jib: walkable top chord + truss underneath
    const jib = (x, z0, z1, y, w, m, y1 = y) => { const len = z0 - z1, ang = Math.atan2(y1 - y, len), g = new THREE.Group(); g.position.set(x, y, z0); g.rotation.x = ang; s.scene.add(g); const L = Math.hypot(len, y1 - y);
      s.box({ parent: g, x: 0, y: -0.22, z: -L / 2, w, h: 0.22, d: L, mat: m, tile: 2 }); s.box({ parent: g, x: 0, y: -2.0, z: -L / 2, w: 0.22, h: 0.22, d: L, mat: m, tile: 2, cast: false });
      for (let d = 0; d < L - 1; d += 2.2) for (const sx of [-1, 1]) { const b = s.box({ parent: g, x: sx * w * 0.24, y: -1.9, z: -d - 1.1, w: 0.09, h: 2.5, d: 0.09, mat: m, cast: false }); b.rotation.set((Math.round(d / 2.2) % 2 ? 1 : -1) * 0.62, 0, sx * 0.2); }
      if (y1 === y) s.course.addPiece({ x0: x - w / 2, x1: x + w / 2, z0: z1, z1: z0, fn: () => y, step: 0.6 }); else s.course.addPiece({ x0: x - w / 2, x1: x + w / 2, z0: z1, z1: z0, fn: (px, pz) => y + (y1 - y) * (z0 - pz) / len, step: 1.0 }); };
    const mast = (x, z, top, m) => { for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) s.box({ x: x + dx * 1.1, y: 0, z: z + dz * 1.1, w: 0.26, h: top, d: 0.26, mat: m, tile: 3 }); for (let y = 3; y < top; y += 4.5) { for (const sd of [-1, 1]) { s.box({ x, y, z: z + sd * 1.1, w: 2.2, h: 0.14, d: 0.14, mat: m, cast: false }); s.box({ x: x + sd * 1.1, y, z, w: 0.14, h: 0.14, d: 2.2, mat: m, cast: false }); const b = s.box({ x, y: y + 1.5, z: z + sd * 1.1, w: 0.1, h: 5, d: 0.1, mat: m, cast: false }); b.rotation.z = sd * 0.45; } } s.box({ x: x + 1.9, y: top - 3.4, z, w: 1.6, h: 2.2, d: 1.8, mat: grey }); };
    // v2: a tie-frame knocks you flat on the steel (flub) instead of off it; the bomb-maker slides / vaults every one of these (acts)
    const acts = [], frame = (x, z, y, w) => { for (const sx of [-1, 1]) s.box({ x: x + sx * (w / 2 + 0.75), y: y - 0.3, z, w: 0.16, h: 2.4, d: 0.16, mat: yel }); const b = s.box({ x, y: y + 1.0, z, w: w + 1.8, h: 0.55, d: 0.3, mat: yel, solid: true, sol: { on: (r, sol) => { r.pass(sol, 1.1); r.stumble(0.8, 0.35); r.c.setPose('hit', 0.06); s.audio.punch(); s.engine.addShake(0.6); s.flub('Clotheslined by a tie-frame', { penalty: 0.18, advice: 'Slide (S) about four metres before each yellow tie-frame — it is chest height, you cannot jump it.' }); return true; } } }); s.box({ x, y: y - 0.34, z, w: w + 1.8, h: 0.12, d: 0.2, mat: yel, cast: false }); s.plan.push({ z: z + 4.2, act: 'slide' }); acts.push({ z, act: 'slide' }); };
    const drum = (x, z, y, w) => { s.box({ x, y, z, w: w * 0.9, h: 0.62, d: 0.9, mat: grey, tile: 1, solid: true, sol: { soft: true, once: true } }); s.plan.push({ z: z + 2.6, act: 'jump' }); acts.push({ z, act: 'jump' }); };
    s.plan = [];
    // unfinished building where it starts
    s.box({ x: 0, y: Y1 - 0.5, z: 3, w: 16, h: 0.5, d: 32, mat: conc, tile: 5, top: true }); for (const [x, z] of [[-7, 17], [7, 17], [-7, -11], [7, -11], [-7, 3], [7, 3]]) s.box({ x, y: 0, z, w: 0.8, h: Y1 + 4, d: 0.8, mat: conc, tile: 4 }); for (let y = 12; y < Y1 - 4; y += 12) s.box({ x: 0, y, z: 3, w: 16, h: 0.4, d: 32, mat: conc, tile: 5 });
    for (const [x, z] of [[-4.5, 8], [5, 4], [-5, -4]]) s.box({ x, y: Y1, z, w: 1.6, h: 1.1, d: 2.4, mat: grey, tile: 1.5 });
    // crane 1 (yellow), crane 2 (red, offset right, then climbs), crane 3 (yellow, narrower)
    jib(0, -13, -70, Y1, 1.4, yel); mast(0, -42, Y1 + 9, yel); frame(0, -30, Y1, 1.4); drum(0, -55, Y1, 1.4);
    jib(1.6, -76.5, -128, Y2, 1.3, red); mast(1.6, -100, Y2 + 9, red); frame(1.6, -90, Y2, 1.3); drum(1.6, -112, Y2, 1.3); jib(1.6, -128, -150, Y2, 1.3, red, Y2 + 5);
    jib(0, -157, -202, Y3, 1.1, yel); mast(0, -182, Y3 + 9, yel); frame(0, -170, Y3, 1.1); drum(0, -190, Y3, 1.1);
    s.box({ x: 0, y: Y3 - 0.6, z: -208, w: 6, h: 0.6, d: 12, mat: grey, tile: 2, top: true }); for (const sx of [-1, 1]) s.box({ x: sx * 2.9, y: Y3, z: -208, w: 0.08, h: 1, d: 12, mat: grey, cast: false }); s.box({ x: 0, y: Y3, z: -213.9, w: 6, h: 1, d: 0.08, mat: grey, cast: false }); s.box({ x: 0, y: 0, z: -209, w: 2.6, h: Y3 - 0.6, d: 2.6, mat: yel, tile: 3 });
    for (const [x, z0, y0, z1, y1] of [[0, -42, Y1 + 9, -68, Y1], [0, -42, Y1 + 9, -15, Y1], [1.6, -100, Y2 + 9, -126, Y2], [1.6, -100, Y2 + 9, -78, Y2], [0, -182, Y3 + 9, -200, Y3], [0, -182, Y3 + 9, -159, Y3]]) for (const sx of [-1, 1]) { const d = Math.hypot(z1 - z0, y1 - y0), b = s.box({ x: x + sx * 1.1, y: (y0 + y1) / 2 - d / 2, z: (z0 + z1) / 2, w: 0.05, h: d, d: 0.05, mat: s.mat({ color: 0x222222 }), cast: false }); b.rotation.x = Math.atan2(z1 - z0, y1 - y0); }
    // site far below
    srand(7); for (let i = 0; i < 26; i++) { const x = sr(-70, 70), z = sr(30, -260); if (Math.abs(x) < 6) continue; s.box({ x, y: 0, z, w: 2.5, h: 2.6, d: sr() < 0.5 ? 6 : 12, mat: s.mat({ color: [0x9a3a2a, 0x2a5a8a, 0x3a7a4a, 0xb89030][i % 4], rough: 0.7 }), ry: sr(3) }); }
    for (const [x, z, w, h, d] of [[-34, -60, 26, 30, 40], [38, -120, 30, 22, 30], [-40, -190, 24, 38, 30]]) { for (let y = 0; y < h; y += 6) s.box({ x, y: y + 5.6, z, w, h: 0.4, d, mat: conc, tile: 6 }); for (const sx of [-1, 1]) for (const sz of [-1, 1]) s.box({ x: x + sx * (w / 2 - 0.5), y: 0, z: z + sz * (d / 2 - 0.5), w: 0.8, h, d: 0.8, mat: conc }); }
    s.crew({ x: 4.5, y: Y1, z: 12, ry: 0.7 });
    // the site around it: palms along the beach, site huts and a wire perimeter fence, green hills inland
    s.trees('palm', 70, (r, i) => i < 46 ? [sr(88, 112), sr(80, -420)] : [sr(-1, 1) < 0 ? sr(-95, -60) : sr(60, 82), sr(60, -330)], { h: [9, 14], seedv: 9 });
    for (const [x, z, ry, c] of [[-22, -24, 0.2, 0x3a5a8a], [-26, -36, 0.2, 0xd8d0c0], [24, -64, -0.4, 0x3a5a8a], [18, -150, 0.1, 0xd8d0c0], [-18, -232, 0.5, 0x3a5a8a]]) dress.barn(s, { x, z, w: 4, d: 9, h: 2.8, ry, color: c, roof: 0x9aa0a6, roofTex: 'tx_metal', rh: 0.8 });
    dress.fence(s, { path: [[-58, 40], [-58, -280], [76, -280], [76, 40]], kind: 'wire', h: 2.2, gap: 4 });
    dress.hills(s, { x: 0, z: -120, r: 520, a0: -Math.PI * 0.95, a1: -Math.PI * 0.05, h: 70, color: 0x4a6a3a, trees: 'jungle', nTrees: 200 });
    const px = z => z > -70 ? 0 : z > -76.5 ? 1.6 * (-70 - z) / 6.5 : z > -150 ? 1.6 : z > -157 ? 1.6 * (1 - (-150 - z) / 7) : 0;
    const run = s.run = new Run(s, { char: 'ch_spy', x: 0, z: 9, y: Y1, strafe: 3.3, fallDeath: 99, cam: { dist: 6.4, height: 3.5, ahead: 4.5, fov: 66 } });
    const tgt = runner(s, 'ch_thug', { x: px, z: -4, acts }); let close = 0, tot = 0, done = false, got = false, lost = false, saves = 0;
    // a lip under the start of crane 2 and 3: come up a little short on a leap and you catch the steel instead of falling
    for (const [x, z0, y, w] of [[1.6, -76.5, Y2, 1.3], [0, -157, Y3, 1.1]]) s.course.addSolid({ x0: x - w / 2 - 0.25, x1: x + w / 2 + 0.25, y0: y - 0.6, y1: y, z0: z0 - 0.5, z1: z0 });
    const jw = z => z > -70 ? 1.4 : z > -76.5 ? 0 : z > -150 ? 1.3 : z > -157 ? 0 : z > -202 ? 1.1 : 0, edges = [-70, -150];
    for (const [z0, z1, x] of [[-62, -69.4, 0.4], [-69.4, -143, 1.6], [-143, -149.4, 1.25], [-149.4, -230, 0]]) s.plan.push({ z0, z1, x }); s.plan.push({ z: -70 + 0.8, act: 'jump' }, { z: -150 + 0.8, act: 'jump' });
    s.rate('Footwork', 1, 1); run.onStumble = () => { s.rate('Footwork', 1 - run.stats.stumbles * 0.34, 1); s.msg('TRIPPED', 'bad'); }; run.onGrab = () => s.rate('Footwork', (s.scores.get('Footwork')?.v ?? 1) - 0.25, 1);
    run.autoMoments = false; run.onGrab = () => { s.rate('Footwork', (s.scores.get('Footwork')?.v ?? 1) - 0.2, 1); s.flub('Caught the jib by your fingertips', { penalty: 0.1, advice: 'Jump from the very end of the jib (last metre) and hold SPACE for the whole leap.' }); };
    run.onLand = i => { if (i.airT > 0.5 && run.pos.y > 20 && (run.pos.z < -76 && run.pos.z > -84 || run.pos.z < -156 && run.pos.z > -164)) { s.msg(i.dist.toFixed(1) + ' m LEAP', 'small'); s.bonus('Crane-to-crane leaps', 250); s.moment('crane-to-crane leap', { t0: s.t - i.airT - 1.0, t1: s.t + 1.1, w: run.pos.z < -150 ? 2.6 : 2.4 }); } };
    s.onAction = () => s.objective('Stay on the bomb-maker — do not fall'); s.dbg = () => ({ z: +run.pos.z.toFixed(1), x: +run.pos.x.toFixed(2), y: +run.pos.y.toFixed(1), gap: +(run.pos.z - tgt.p.z).toFixed(1) });
    s.onUpdate(dt => {
      if (!s.started) return; const gap = run.pos.z - tgt.p.z;
      if (!got) {
        // if you fall too far behind he waits at the next obstacle, looking back, then bolts again when you close in
        if (gap > 24 && !tgt.wait) { tgt.wait = true; if (!lost && !s.ended) { lost = true; s.flub('Lost the bomb-maker', { penalty: 0.15, advice: 'Hold W (sprint) on every open stretch of steel — he only waits so long. Keep the TARGET readout under 15 m.' }); } }
        if (tgt.wait && gap < 11) tgt.wait = false;
        const nx = tgt.next(12), edge = edges.find(e => e < tgt.p.z && e > tgt.p.z - 12), stopZ = nx ? nx.z + 2.6 : edge != null ? edge + 1.6 : tgt.p.z + 1;
        const hold = tgt.wait && !tgt.air && tgt.p.z <= stopZ + 0.4, want = tgt.p.z < -207.5 || hold ? 0 : 8.9 + (gap < 7 ? 1.1 : gap > 20 ? -1.1 : 0);
        tgt.v = tgt.p.z < -207.5 || hold ? damp(tgt.v, 0, 6, dt) : damp(tgt.v, want, 2.2, dt); tgt.update(dt);
        if (tgt.v < 0.6 && (tgt.p.z < -207 || hold)) { tgt.c.heading = damp(tgt.c.heading, Math.PI, 6, dt); tgt.c.setPose('guard', 0.3); } else tgt.c.heading = damp(tgt.c.heading, 0, 8, dt);
      }
      if (s.ended) return;
      // v2: stepping off the side of a jib (not a gap) — you wobble and catch yourself, once per jib section
      { const z = run.pos.z, w = jw(z), cx = px(z), dx = run.pos.x - cx, top = s.course.height(cx, z, run.pos.y + 2);
        if (w && !run.dead && run.grabT <= 0 && !run.grounded && run.vy <= 0 && Math.abs(dx) > w / 2 - 0.05 && Math.abs(dx) < w / 2 + 0.9 && run.pos.y > top - 1.2 && run.pos.y < top + 0.2) {
          saves++; run.pos.x = cx + Math.sign(dx) * (w / 2 - 0.3); run.pos.y = top; run.vy = 0; run.grounded = true; run.vx = 0; run.stumble(0.7, 0.4); s.engine.addShake(0.5);
          if (saves > 3) { run.grounded = false; run.vy = -2; run.pos.x = cx + Math.sign(dx) * (w / 2 + 0.6); } else s.flub('Wobbled off the edge of the jib', { penalty: 0.12, advice: 'Small taps on A/D only — the jib is barely wider than you. Let go of the keys and you run straight.' });
        } }
      if (run.pos.y < Y2 - 9 && !run.dead) { const gapFall = run.pos.z < -66 && run.pos.z > -78 || run.pos.z < -147 && run.pos.z > -158; run.die(gapFall ? 'Missed the jump between the cranes' : 'Stepped off the jib — two hundred feet down', 1, true, gapFall ? 'Jump (SPACE) from the last metre of the jib at full sprint and hold SPACE — and line up with the next jib before you go.' : 'Keep your corrections tiny (tap A/D) — the jib is barely wider than your shoulders.'); return; }
      tot += dt; if (gap < 18) close += dt; s.hud.readout('gap', 'Target (m)', Math.max(0, gap).toFixed(0), gap < 15 ? 'ok' : gap > 28 ? 'warn' : ''); s.hud.readout('alt', 'Height (m)', Math.round(run.pos.y));
      const z = run.pos.z; s.hud.prompt((z < -62 && z > -70) || (z < -142 && z > -150) ? `${K('SPACE')} LEAP — hold it` : '');
      if (!done && run.pos.z < -203.5 && run.grounded) { done = got = true; run.control = false; run.speedK = 0; tgt.c.setPose('hit', 0.2); s.rate('On his tail', clamp(close / tot / 0.8), 2); s.msg('CORNERED!', 'good'); s.wrap(1.6, 'Nowhere left to run'); }
    });
  },
  bot(s, inp) { botRun(s, inp, { gain: 4 }); },
};

// ---------------------------------------------------------------------------------------------
const bourne = {
  id: 'bourne', title: 'Tangier Window', film: 'The Bourne Ultimatum', year: 2007, tier: 5, pay: 21000, mode: 'run', art: 'bd_egypt', music: 'chase',
  role: 'Doubling the amnesiac assassin — Tangier medina, rooftop to rooftop',
  brief: 'Handheld, no cuts. You go across the rooftops flat out — gaps, walls, washing — with the asset right behind you, then straight off the last roof, across the street and through a closed window. The camera operator is jumping with you, so do not make him do it twice.',
  tips: ['<b>Jump</b> the gaps and low walls, <b>slide</b> under the washing lines. Every stumble lets the man behind you close in.', 'The plank bridge is one board wide — line up <b>early</b>.', 'Last roof: <b>full sprint</b>, jump inside the last two metres, and steer for the <b>shuttered window</b>. Miss it and you hit the wall.'],
  controls: CTL.run, intro: { r: 9, h: 3.2, a0: 2.3 },
  assets: { models: ['ch_agent', 'ch_goon'], tex: ['bd_egypt', 'tx_concrete', 'tx_cobble', 'tx_wood', 'tx_roof', 'tx_wallpaper', 'tx_metal'] },
  build(s) {
    // Tangier medina: hard afternoon sun, dusty ochre haze, bleach-bypass grade (warm highlights, cool shadows)
    s.env('desert', { backdrop: 'bd_egypt', look: 'bleach', fog: 0.0034, fogColor: 0xd6c6a6, sun: [40, 55], sunCol: 0xffe6c0, amb: 0.8, lookOver: { sat: 0.82, contrast: 1.22, tint: [1.08, 1.0, 0.88] } }); s.ground({ tex: 'tx_cobble', tile: 6, color: 0xb0a898 });
    const white = s.mat({ tex: 'tx_concrete', color: 0xf4efe2 }), cream = s.mat({ tex: 'tx_concrete', color: 0xe6d8b8 }), blue = s.mat({ tex: 'tx_concrete', color: 0x9ec4dc }), wood = s.mat({ tex: 'tx_wood', color: 0x8a6a48 }), dark = s.mat({ color: 0x2a2622 }), tin = s.mat({ tex: 'tx_metal', color: 0xc8c8c8, metal: 0.5, rough: 0.4 }), ochre = s.mat({ tex: 'tx_concrete', color: 0xd8b07a });
    s.plan = []; const roofs = [[14, -26, 14, 0, 11], [-29.2, -58, 13, 0, 10], [-62, -92, 13.5, 0, 10], [-95.6, -124, 12.3, 0, 10], [-128, -160, 12.3, 3, 10], [-167.5, -197, 12.3, 3, 11]];
    roofs.forEach(([z0, z1, y, x, w], i) => { s.box({ x, y: 0, z: (z0 + z1) / 2, w, h: y, d: z0 - z1, mat: [white, cream, white, blue, white, cream][i], tile: 5, top: true, solid: true, sol: { msg: 'Came up short and hit the wall', injury: 0.8 } }); for (const sx of [-1, 1]) s.box({ x: x + sx * (w / 2 - 0.12), y, z: (z0 + z1) / 2, w: 0.24, h: 0.45, d: z0 - z1, mat: white, tile: 3 }); if (i) s.plan.push({ z: roofs[i - 1][1] + 0.9, act: 'jump' }); });
    const wallLow = (z, y, x = 0, w = 10) => { s.box({ x, y, z, w, h: 0.78, d: 0.35, mat: white, tile: 2, solid: true, sol: { soft: true, once: true } }); s.plan.push({ z: z + 2.5, act: 'jump' }); };
    const cols = [0xc83a2a, 0xf0f0f0, 0x2a6ab0, 0xe8c040, 0x3a9a6a, 0xf0f0f0];
    const washing = (z, y, x = 0, w = 10) => { for (const sx of [-1, 1]) s.box({ x: x + sx * (w / 2 - 0.5), y, z, w: 0.08, h: 2.2, d: 0.08, mat: wood }); s.box({ x, y: y + 2.1, z, w: w - 1, h: 0.025, d: 0.025, mat: dark, cast: false }); for (let k = 0; k < 7; k++) { const c = s.box({ x: x - w / 2 + 1.3 + k * (w - 2.6) / 6, y: y + 1.02 + (k % 3) * 0.08, z, w: 0.95, h: 1.08 - (k % 3) * 0.08, d: 0.03, mat: s.mat({ color: cols[k % 6], rough: 0.9, side: true }) }); c.rotation.x = 0.06 * (k % 2 ? 1 : -1); } s.course.addSolid({ x0: x - w / 2 + 0.8, x1: x + w / 2 - 0.8, y0: y + 1.0, y1: y + 2.1, z0: z - 0.15, z1: z + 0.15, soft: true, once: true }); s.plan.push({ z: z + 4.2, act: 'slide' }); };
    const dish = (x, z, y) => { s.cyl({ x, y, z, r: 0.05, h: 1.1, color: 0x666666 }); const d = s.cyl({ x, y: y + 1.1, z, r: 0.75, r1: 0.75, h: 0.06, mat: tin, rx: 1.0 }); d.position.y = y + 1.25; s.course.addSolid({ x0: x - 0.7, x1: x + 0.7, y0: y, y1: y + 1.9, z0: z - 0.4, z1: z + 0.4, soft: true, once: true }); s.plan.push({ z0: z + 10, z1: z - 1, x: x > roofX(z) ? x - 2.6 : x + 2.6 }); };
    const roofX = z => z > -126 ? 0 : 3; const hut = (x, z, y) => { s.box({ x, y, z, w: 2.6, h: 2.4, d: 3, mat: white, tile: 3 }); s.box({ x: x + (x > roofX(z) ? -1.31 : 1.31), y, z, w: 0.04, h: 1.9, d: 0.9, mat: s.mat({ color: 0x2a6a8a }), cast: false }); };
    wallLow(-12, 14, 0, 11); hut(-3.8, 2, 14); washing(-44, 13); dish(1.6, -36, 13); hut(3.6, -52, 13); dish(-1.4, -72, 13.5); dish(1.8, -84, 13.5); wallLow(-108, 12.3); washing(-117, 12.3); hut(-3.6, -100, 12.3); dish(4.6, -140, 12.3); wallLow(-150, 12.3, 3); hut(6.4, -132, 12.3); washing(-180, 12.3, 3, 11); hut(-0.8, -172, 12.3);
    // plank bridge
    s.box({ x: 4.2, y: 12.3 - 0.08, z: -163.75, w: 0.85, h: 0.08, d: 8.2, mat: wood, tile: 1.2, top: true, step: 0.5 }); s.plan.push({ z0: -148, z1: -168, x: 4.2 }); s.plan = s.plan.filter(h => !(h.act === 'jump' && Math.abs(h.z - (-160 + 0.9)) < 0.1));
    // the street and the apartment opposite
    const SZ = -197, WZ = SZ - 7, WX = 1.4, FY = 10.7, WT = 14.3; s.line({ x: WX, z: SZ + 1.1, w: 2.2, d: 2.2, y: 12.3, color: 0xffe14a }).material.opacity = 0.4;
    let inside = false; const wadv = 'Line up on the yellow square at the edge, take off at full sprint inside the last two metres and steer for the teal shutters.';
    // v2: clip the window frame (within ~0.8 m of the opening) and you are bundled through it — a flub, not a fall
    const wmsg = { msg: 'Missed the window and hit the wall', injury: 0.9, grab: false, advice: wadv, on: r => { if (r.grounded || inside) return; if (Math.abs(r.pos.x - WX) < 1.85 && r.pos.y > FY - 1.1 && r.pos.y < WT - 1.0) { r.pos.x = WX + clamp(r.pos.x - WX, -0.5, 0.5); r.pos.y = Math.max(r.pos.y, FY + 0.05); r.vy = Math.max(r.vy, 0); s.audio.impact(0.7); s.flub('Clipped the window frame', { penalty: 0.15, advice: wadv }); return true; } } };
    s.box({ x: WX - 11, y: 0, z: WZ - 6, w: 20, h: 19, d: 12, mat: cream, tile: 5, solid: true, sol: wmsg }); s.box({ x: WX + 11, y: 0, z: WZ - 6, w: 20, h: 19, d: 12, mat: cream, tile: 5, solid: true, sol: wmsg });
    s.box({ x: WX, y: 0, z: WZ - 6, w: 2, h: FY, d: 12, mat: cream, tile: 5, solid: true, sol: { ...wmsg, grab: true }, top: true }); s.box({ x: WX, y: WT, z: WZ - 0.4, w: 2, h: 19 - WT, d: 0.8, mat: cream, tile: 5, solid: true, sol: wmsg }); s.box({ x: WX, y: 18.6, z: WZ - 6, w: 2.2, h: 0.4, d: 12, mat: cream });
    s.box({ x: WX, y: FY, z: WZ - 11.9, w: 2, h: WT - FY, d: 0.1, mat: { tex: 'tx_wallpaper' }, tile: 2, solid: true, sol: { on: () => true } }); s.light({ x: WX, y: FY + 2.6, z: WZ - 5, color: 0xffd8a0, i: 20, dist: 12, r: 0.1 });
    for (const sx of [-1, 1]) { s.box({ x: WX + sx * 1.06, y: FY, z: WZ + 0.06, w: 0.12, h: WT - FY, d: 0.14, mat: wood }); s.box({ x: WX + sx * 1.6, y: FY + 0.2, z: WZ + 0.05, w: 0.9, h: WT - FY - 0.4, d: 0.06, mat: s.mat({ color: 0x2a7a8a, rough: 0.8 }) }); }
    const pane = s.box({ x: WX, y: FY, z: WZ, w: 2, h: WT - FY, d: 0.06, mat: s.mat({ glass: true, color: 0xa8d0e0, opacity: 0.4 }), cast: false, solid: 'break', sol: { glass: true, on: () => { s.through = true; } } }); for (const dy of [1.2, 2.4]) s.box({ x: WX, y: FY + dy, z: WZ + 0.02, w: 2, h: 0.05, d: 0.05, mat: wood, cast: false });
    for (const [x, y] of [[-5, 9], [-9, 14], [8, 10], [12, 15], [-14, 10]]) s.box({ x: WX + x, y, z: WZ + 0.03, w: 1.3, h: 2, d: 0.06, mat: s.mat({ color: 0x2a3a48, rough: 0.3 }), cast: false });
    // the medina around
    srand(31); for (let i = 0; i < 70; i++) { const sd = sr() < 0.5 ? -1 : 1, x = sd * sr(9.5, 70) + (sd > 0 ? 3 : 0), z = sr(40, -260), w = sr(7, 14), d = sr(7, 14), h = sr(7, 15); if (z < SZ - 2 && z > WZ - 14 && Math.abs(x) < 24) continue; s.box({ x, y: 0, z, w, h, d, mat: [white, cream, ochre, blue, cream][i % 5], tile: 5 }); if (i % 3 === 0) s.box({ x: x + 1, y: h, z, w: 2.4, h: 2.2, d: 2.6, mat: white }); else if (i % 3 === 1) { const r = s.cyl({ x: x - w * 0.3, y: h + 1.1, z: z + d * 0.25, r: 0.6, h: 0.05, mat: tin, rx: 1.0 }); r.rotation.y = i; s.cyl({ x: x - w * 0.3, y: h, z: z + d * 0.25, r: 0.04, h: 1.1, color: 0x666666, cast: false }); } else s.cyl({ x: x + w * 0.3, y: h, z: z - d * 0.3, r: 0.55, h: 1.2, mat: tin, seg: 10 }); }
    // a minaret over the skyline, a couple of palms in the courtyards
    s.box({ x: -46, y: 0, z: -128, w: 4.2, h: 34, d: 4.2, mat: cream, tile: 4 }); s.box({ x: -46, y: 34, z: -128, w: 5, h: 0.6, d: 5, mat: white }); s.box({ x: -46, y: 34.6, z: -128, w: 2.6, h: 4, d: 2.6, mat: cream, tile: 3 }); s.cyl({ x: -46, y: 38.6, z: -128, r: 0.1, r1: 1.4, h: 2.2, mat: { color: 0x3a8a6a }, seg: 8 });
    s.trees('palm', 9, (r, i) => [[-14, -20], [18, -48], [-20, -88], [22, -110], [-16, -150], [26, -170], [-30, -60], [32, -30], [-26, -232]][i], { h: [11, 15], seedv: 4 });
    s.crew({ x: 3.6, y: 14, z: 9, ry: 0.8 });
    const run = s.run = new Run(s, { char: 'ch_agent', x: 0, z: 6, y: 14, fallDeath: 5, cam: { dist: 5.8, height: 2.7, ahead: 4, fov: 66, stiff: 9 } });
    // the asset chases on foot along YOUR route (jumps, slides and climbs wherever you did — never through the scenery)
    const foe = pursuer(s, run.c, 'ch_goon', { delay: 1.35 }); let t0 = 0, minGap = 99, caught = 0, foeStop = false, winM = null; s.through = false; run.autoMoments = true;
    const line = () => s.rate('Parkour line', 1 - run.stats.stumbles * 0.22 - run.stats.grabs * 0.22, 1.5);
    s.rate('Parkour line', 1, 1.5); run.onStumble = () => { line(); foe.delay = Math.max(0.5, foe.delay - 0.08); s.msg('SNAGGED!', 'bad'); s.flub('Snagged on the rooftop clutter', { penalty: 0.05, quiet: true, advice: 'Jump the low walls (SPACE), slide the washing lines (S) and go round the dishes (A/D) — each snag lets the asset gain.' }); };
    run.onGrab = sol => { line(); s.msg('SCRAMBLE UP!', 'bad'); if (sol === pane.userData.solid || Math.abs(run.pos.z - WZ) < 1) { const ps = pane.userData.solid; if (!ps.dead) { ps.dead = true; pane.visible = false; s.fx.glass(V3(WX, FY + 1.6, WZ), 60, { dir: V3(0, 0, -1), speed: 4 }); s.audio.glass(); } s.flub('Caught the windowsill', { penalty: 0.15, advice: wadv }); } else s.flub('Came up short — scrambled up the ledge', { penalty: 0.08, advice: 'Jump from the last metre of each roof at full sprint (W) and hold SPACE for distance.' }); };
    run.onJump = () => { if (run.pos.z < SZ + 5 && !winM) { s.rate('Take-off speed', near(run.v, 9.6, 0.5, 2.4), 1); s.slowmo(0.45, 1.2); s.cam.set({ dist: 4.6, height: 2.2 }); run.autoMoments = false; winM = s.moment('through the window', { t0: s.t - 1.3, dur: 3.4, w: 3 }); } };
    const goInside = () => { inside = true; run.control = false; run.speedK = 0; run.v = Math.min(run.v, 6); run.stun = 0.4; run.c.setPose('land', 0.06); s.audio.impact(0.7); s.engine.addShake(0.9); if (winM) winM.t1 = s.t + 1.5; s.rate('Window', near(Math.abs(run.pos.x - WX), 0, 0.35, 1.1), 1.5); s.rate('Lead on the asset', clamp(foe.gap() / 10), 1); s.bonus('Through the glass', 600); s.msg('THROUGH THE WINDOW!', 'good'); s.wrap(1.6, 'Cut. Somebody check on the camera operator.'); };
    run.onLand = i => { if (run.pos.y < 6) { const st = run.pos.z < SZ; run.die(st ? 'Fell into the street short of the window' : 'Fell between the rooftops', 0.95, false, st ? 'For the window: full sprint (W), jump inside the last two metres of the roof and hold SPACE — line up on the yellow square first.' : 'Jump every gap from the last metre of roof (SPACE) and keep sprinting — a short jump can still catch the far ledge.'); run.c.setPose('lie', 0.1); return true; } if (run.pos.z < WZ && !inside) { goInside(); return true; } };
    const fgap = () => foe.gap();
    s.onAction = () => s.objective('Run the rooftops — he is right behind you'); s.dbg = () => ({ z: +run.pos.z.toFixed(1), x: +run.pos.x.toFixed(2), y: +run.pos.y.toFixed(1), gap: +fgap().toFixed(1), v: +run.v.toFixed(1) });
    s.onUpdate(dt => {
      if (!s.started) return; const gap = fgap();
      // he pulls up at the last roof edge and watches you go (stop replaying the route there)
      const fp = foe.c.root.position; if (!foeStop && foe.c.root.visible && fp.z < SZ + 3.5 && fp.y > 11) { foeStop = true; foe.delay = 1e9; foe.c.setPose('ready', 0.3); foe.c.heading = 0; }
      if (foeStop) { fp.z = Math.min(fp.z, SZ + 3); return; }
      if (s.ended || inside) return; if (run.grounded && run.pos.z < WZ) return goInside(); minGap = Math.min(minGap, gap);
      s.hud.readout('gap', 'Pursuer (m)', Math.max(0, gap).toFixed(1), gap < 5 ? 'warn' : gap > 9 ? 'ok' : ''); const z = run.pos.z; s.hud.prompt(z < SZ + 12 && z > SZ ? `${K('SPACE')} LEAP FOR THE WINDOW` : '');
      if (gap < 1.3 && foe.c.root.visible && !run.dead && run.pos.z > SZ + 1 && s.t - s.t0 > 2.5) {
        caught++; foe.c.setPose('punchR', 0.08); s.audio.punch(); s.engine.addShake(0.8);
        if (caught >= 2) { run.dead = true; run.v = 0; run.c.setPose('hit', 0.1); s.fail('The asset caught you on the rooftops — again', { injury: 0.5, advice: 'Every stumble and ledge-scramble lets him close in. Jump from the last metre of each roof and read the clutter early.' }); }
        else { foe.delay += 1.1; run.stumble(0.5, 0.7); s.flub('The asset got a hand on you', { penalty: 0.2, advice: 'Keep the PURSUER readout above 5 m — clean jumps from the last metre, no scrambles, no snags.' }); }
      }
    });
  },
  bot(s, inp) { const r = s.run; botRun(s, inp, { x: r.pos.z > -126 ? 0 : r.pos.z > -168 ? 3 : 1.4 }); if (r.pos.z < -197 + 1.2 && r.pos.z > -197.1 && r.grounded) inp.press('a'); if (r.pos.z < -186) inp.x = clamp((1.4 - r.pos.x) * 2.5, -1, 1); },
};

// What the player is asked to do, in plain numbers, plus the film's signature camera angles for the replay.
const EXTRA = {
  raiders_boulder: { goals: { shot: ['Press E when the swinging needle is dead centre to swap the idol', 'Run at the camera, holding W: SPACE over the 3 pits, S under the 3 beams, A/D round the 4 rock piles', 'Keep the BOULDER readout above 5 m', 'At the cave mouth a stone door drops — slide (S) under it into the daylight'], cut: ['The boulder flattens you', 'You fall into a spike pit', 'The door shuts you in'], stars: ['Idol swap timing', 'Footwork (each stumble costs)', 'Cutting the door fine', 'Lead over the boulder'] }, cine: ['front', { type: 'low', fov: 52 }, 'wide'] },
  temple_door: { goals: { shot: ['Sprint the spike corridor: A/D away from the wall spikes, SPACE over the 3 floor plates, S under the 2 ceiling blocks', 'Past the red line the door drops: ease off W so DOOR AT ARRIVAL reads 0.85–1.1 m', 'Press S about 4 m before the door to slide under it', 'Then press E at once to reach back for the hat'], cut: ['The door crushes you (gap under 0.8 m when you slide)'], stars: ['Close shave under the door (closer = more)', 'The hat', 'Spike corridor'] }, cine: ['front', { type: 'low', fov: 56 }, 'track'] },
  croc_run: { goals: { shot: ['Hold W to walk, let go to stop — each croc back is only 3 m long', 'Watch the jaws (and NEXT CROC): hop (SPACE) on just after they slam shut — mouth closed means CALM', 'Cross all 6 crocodiles, then hop onto the far bank'], cut: ['A croc bites you (still on its back 0.4 s into a snap)', 'Falling in the water a third time'], stars: ['Footing (land in the middle of each back)', 'Pace (about 17 s)'] }, cine: [{ type: 'track', pos: [10.5, 1.15, -22], fov: 30, lookUp: 0.75, speed: 0.55, a: -0.1, b: 1.0 }, { type: 'low', side: 1 }, { type: 'rear', pos: [-2.2, 2.6, 4], fov: 24, lookUp: 0.6, speed: 0.7 }] },
  rumble_bronx: { goals: { shot: ['Hold W to sprint the car park — A/D round the 7 parked cars, SPACE over the low wall', 'SPACE at the first yellow line to jump down to the second roof', 'Line up with the green marker, then jump ON the far yellow line at 34+ km/h, holding SPACE', 'Steer onto the 2 m balcony across the alley'], cut: ['Falling short of the balcony (or off the roof)'], stars: ['Take-off point', 'Speed', 'Landing on the balcony', 'Run-up'] }, cine: [{ type: 'wide', pos: [14.5, 24.4, -134.5], fov: 44, lookUp: 0.7, speed: 0.5, a: 0.15, b: 0.85 }, { type: 'low', pos: [-3.5, 1.7, -133.5], fov: 34, lookUp: 0.6, speed: 0.4, a: 0.3, b: 0.75 }, { type: 'rear', pos: [-0.8, 25.4, -119], fov: 42, lookUp: 0.6, speed: 0.7, a: -0.1, b: 0.8 }] },
  die_hard: { goals: { shot: ['Run 94 m for the roof edge with the fireball behind you — A/D round the 4 vents', 'Ease off W so FIREBALL reads 2–4 m (never under 1 m)', 'SPACE to jump in the last 2 m of roof', 'On the hose, press E as you swing IN toward the glass with the needle in the green'], cut: ['The fireball catches you (under 1 m)'], stars: ['Heat on your back', 'Leap', 'Window timing', 'Clean run'] }, cine: [{ type: 'wide', pos: [7, 118.5, -97], fov: 44, lookUp: 0.8, speed: 0.4, a: 0.14, b: 0.36 }, { type: 'low', pos: [3.5, 99, -91], fov: 52, lookUp: 0.6, speed: 0.5, a: 0.25, b: 0.85 }, { type: 'track', pos: [-6.5, 107.4, -82.4], fov: 62, lookUp: 0.5, speed: 0.5, a: 0.6, b: 1.02 }] },
  casino_crane: { goals: { shot: ['Chase the bomb-maker along the jib, holding W — keep TARGET under 15 m', 'S to slide under the 3 yellow tie-frames, SPACE over the 3 cable drums', 'Jump from the last metre of each jib and hold SPACE for the 2 leaps between cranes', 'Corner him on the platform at the end of crane 3'], cut: ['You fall off the steel'], stars: ['On his tail', 'Footwork'] }, cine: [{ type: 'wide', pos: [26, 61, -151], fov: 26, lookUp: 0.7, speed: 0.45, a: -0.1, b: 1.0 }, { type: 'low', fov: 50 }, 'track'] },
  bourne: { goals: { shot: ['Sprint across 6 rooftops: SPACE over the gaps and low walls, S under the washing, A/D round the dishes', 'Line up early (x≈4) for the one-board plank bridge', 'Keep PURSUER above 5 m — every snag lets him gain', 'Last roof: full sprint, jump in the last 2 m and steer through the shuttered window'], cut: ['Falling off the roofs', 'Hitting the wall beside the window', 'The asset catching you twice'], stars: ['Parkour line', 'Take-off speed', 'Window', 'Lead on the asset'] }, cine: [{ type: 'wide', pos: [14, 12.8, -200.5], fov: 40, lookUp: 0.7, speed: 0.45, a: 0.1, b: 0.9 }, 'chase', { type: 'front', pos: [1.6, 12.4, -213], fov: 58, lookUp: 0.5, speed: 0.5, a: 0.35, b: 1.05 }] },
};
export default [raiders, temple, croc, rumble, dieHard, crane, bourne].map(d => Object.assign(d, EXTRA[d.id]));
