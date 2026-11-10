import * as THREE from 'three';
import { Drive, Movers } from '../modes/drive.js';
import { clamp, near, smooth, V3, rnd, sr, srand, lerp, damp } from '../world/stage.js';
import { K, CTL, street, botDrive, sign, tumbleScript, TRAFFIC } from './common.js';
import { trees } from './drive1.js';
import * as dress from '../world/dress.js';

const ftOf = m => Math.round(m * 3.281);
const MPH = 2.237;
const dock = (s, label, d) => { const r = s.scores.get(label); s.rate(label, (r?.v ?? 1) - d, r?.w ?? 1); };
const wrapA = a => ((a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
const BIKE_CTL = `${K('W')} gas &nbsp; ${K('S')} brake &nbsp; ${K('A')}${K('D')} steer &nbsp; in the air: ${K('W')} nose up ${K('S')} nose down`;
// many identical boxes in one draw call. list: [[x, yCentre, z], ...]
function inst(s, w, h, d, mat, list, cast = false) {
  const im = new THREE.InstancedMesh(new THREE.BoxGeometry(w, h, d), mat, Math.max(1, list.length)), M = new THREE.Matrix4();
  list.forEach((p, i) => { M.makeTranslation(p[0], p[1], p[2]); im.setMatrixAt(i, M); }); im.count = list.length; im.frustumCulled = false; im.castShadow = cast; im.receiveShadow = true; s.scene.add(im); return im;
}
const glow = (r, g, b) => new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b) });
// overhead freeway sign gantry
function gantry(s, z, text, o = {}) {
  const w = o.w ?? 20, y = o.y ?? 6.2, steel = s.mat({ color: 0x55595c, metal: 0.5, rough: 0.6 });
  for (const sx of [-1, 1]) s.box({ x: sx * w / 2, y: o.y0 ?? 0, z, w: 0.4, h: y + 1.6 - (o.y0 ?? 0), d: 0.4, mat: steel, cast: false });
  s.box({ x: 0, y: y + 1.3, z, w, h: 0.3, d: 0.3, mat: steel, cast: false }); sign(s, text, { x: o.x ?? 0, y: y + 0.4, z: z + 0.25, w: o.sw ?? 9, bg: o.bg, fg: o.fg, size: o.size ?? 54 });
}
// a performer who never gets going: one flub, then the take is called off (with advice) instead of rolling forever
function idleGuard(s, car, { warn = 8, stop = 20, advice = 'The camera is rolling the moment the director calls ACTION — get on the gas (W) straight away.' } = {}) {
  let still = 0, warned = false;
  s.onUpdate(dt => {
    if (!s.started || s.ended || car.dead) return; still = Math.abs(car.v) < 1.5 ? still + dt : Math.max(0, still - dt * 3);
    if (still > warn && !warned) { warned = true; s.flub('Sitting on the mark', { penalty: 0.15, advice }); }
    if (still > stop) s.fail('Never got going — we lost the light', { injury: 0, advice });
  });
}
// coloured instanced boxes: list of [x, yBase, z, w, h, d, ry?] -> one draw call (visual only)
function boxes(s, list, colors, o = {}) {
  const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: o.rough ?? 0.8, metalness: o.metal ?? 0.2 }), list.length), M = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), c = new THREE.Color();
  list.forEach((b, i) => { M.compose(V3(b[0], b[1] + b[4] / 2, b[2]), Q.setFromEuler(E.set(0, b[6] || 0, 0)), V3(b[3], b[4], b[5])); im.setMatrixAt(i, M); im.setColorAt(i, c.set(colors[i % colors.length]).multiplyScalar(0.8 + ((i * 0.6180339) % 1) * 0.35)); });
  im.castShadow = o.cast ?? false; im.receiveShadow = true; im.frustumCulled = false; s.scene.add(im); return im;
}
const BOXC = [0xa8382a, 0x2a5a8a, 0xc87a28, 0x3a6a4a, 0x8a8a8a, 0x6a2a3a, 0xd0c8b8, 0x1e3a5a, 0xb8a040];
// a harbour quay along X at height y, edge at zEdge, land extending away (dir = +1 toward +Z): container stacks, ship-to-shore cranes, a moored ship
function harbour(s, { y, zEdge, dir, x0 = -700, x1 = 700, skip = 40, seed = 3 }) {
  srand(seed); s.box({ x: (x0 + x1) / 2, y: y - 6, z: zEdge + dir * 200, w: x1 - x0, h: 6, d: 400, mat: { tex: 'tx_concrete', color: 0x8a867c }, tile: 14, cast: false });
  const C = []; for (let x = x0 + 20; x < x1 - 20; x += sr(14, 22)) { if (Math.abs(x) < skip) continue; for (let r = 0; r < 5; r++) { const n = 1 + Math.floor(sr(4)); for (let k = 0; k < n; k++) C.push([x + sr(-0.4, 0.4), y + k * 2.6, zEdge + dir * (40 + r * 14 + sr(-1, 1)), 12, 2.6, 2.45, Math.PI / 2]); } }
  boxes(s, C, BOXC);
  const red = s.mat({ color: 0xb8402a, metal: 0.3, rough: 0.6 }), wht = s.mat({ color: 0xd8d4cc, metal: 0.3, rough: 0.6 });
  for (let x = x0 + 80; x < x1 - 60; x += sr(70, 110)) { if (Math.abs(x) < skip + 30) continue; const zl = zEdge + dir * 4, zr = zEdge + dir * 26;
    for (const z of [zl, zr]) for (const sx of [-1, 1]) s.box({ x: x + sx * 8, y, z, w: 1.6, h: 54, d: 1.6, mat: red, cast: false });
    for (const z of [zl, zr]) s.box({ x, y: y + 52, z, w: 18, h: 2.4, d: 1.8, mat: wht, cast: false }); for (const sx of [-1, 1]) s.box({ x: x + sx * 8, y: y + 30, z: (zl + zr) / 2, w: 1.2, h: 1.6, d: 22, mat: red, cast: false });
    for (const sx of [-1, 1]) s.box({ x: x + sx * 7, y: y + 50, z: zEdge - dir * 12, w: 1.3, h: 46, d: 1.3, mat: wht, rx: -dir * 0.45, cast: false }); // boom raised
    s.box({ x, y: y + 54, z: zEdge + dir * 15, w: 4, h: 9, d: 3, mat: red, cast: false }); s.box({ x, y: y + 44, z: zEdge - dir * 2, w: 3.4, h: 3, d: 4, mat: wht, cast: false }); }
  // a container ship moored along the quay
  const sx = x0 * 0.45, hl = s.mat({ color: 0x23282c, rough: 0.7 }); s.box({ x: sx, y: y - 12, z: zEdge - dir * 22, w: 220, h: 18, d: 32, mat: hl, cast: false }); s.box({ x: sx + 92, y: y + 6, z: zEdge - dir * 22, w: 18, h: 16, d: 28, mat: s.mat({ color: 0xd8d4cc }), cast: false });
  const S = []; for (let i = 0; i < 14; i++) for (let r = 0; r < 4; r++) { const n = 2 + Math.floor(sr(3)); S.push([sx - 96 + i * 13, y + 6, zEdge - dir * (10 + r * 8), 12.2, n * 2.6, 7.6]); } boxes(s, S, BOXC);
}
// promote the automatic jump moment (Drive._airCine) to the replay headline, cut with the film's angles
function headline(s, w, shots) { const m = s.moments.at(-1); if (m && m.label === 'jump') { m.w = Math.max(m.w, w); if (shots) m.shots = shots; } return m; }

// ---------------------------------------------------------------------------------------------
const V40 = 40 / MPH;
const goldenGun = {
  id: 'golden_gun', title: 'The Corkscrew', film: 'The Man with the Golden Gun', year: 1974, tier: 3, pay: 7000, mode: 'drive', art: 'bd_thai', music: 'spy',
  role: 'Doubling 007 — borrowed AMC Hornet, one collapsed bridge',
  brief: 'The boffins ran this on a computer. Hit the twisted ramp at exactly forty miles an hour and the car does one perfect barrel roll across the klong. One take. We have never tried it before.',
  tips: ['Hit the ramp at <b>exactly 40 mph</b> — the green zone is 38 to 42.', 'Too slow and she lands on her side. Too fast and she over-rotates. The spiral does the rest.', 'Stay dead centre on the planks and <b>do not steer</b> on the ramp.'],
  controls: CTL.drive, intro: { r: 10, h: 2.6 },
  assets: { models: ['hornet', 'police_car'], tex: ['bd_thai', 'tx_grass', 'tx_dirt', 'tx_wood'] },
  build(s) {
    // Phang Nga, 1974: humid tropical afternoon, sun low over the klong from downstream, haze swallowing the jungle
    s.env('day', { backdrop: 'bd_thai', look: 'warm60s', fog: 0.0034, hz: 0.45, sun: [32, -58], sunCol: 0xffdcae, sunI: 3.6, amb: 0.8, fogMix: 0.5, lookOver: { sat: 1.02, contrast: 1.08, tint: [1.07, 1.0, 0.86], bloom: 0.38 } });
    const ZN = -246, ZF = -272, ZA = -250, ZB = -268, H1 = 2.65, H2 = 2.3, TW = 0.22, RW = 5.2, T0 = 1.28;
    s.terrain({ x0: -400, x1: 400, z0: 130, z1: -560, res: 5, fn: (x, z) => (z < ZN + 1 && z > ZF - 1 ? -5 * smooth(0, 3, Math.min(z - ZF, ZN - z)) : 0), tex: 'tx_grass', tile: 5 });
    s.water({ y: -2.2, color: 0x5a5a32, w: 800, d: 30, z: (ZN + ZF) / 2, size: 800, opacity: 0.96, flow: 0.02 });
    const dirt = { tex: 'tx_dirt', color: 0xc9a074 }; s.road({ z0: 130, z1: ZN - 0.5, width: 7, lanes: 2, mat: dirt, marks: false }); s.road({ z0: ZF + 0.5, z1: -560, width: 7, lanes: 2, mat: dirt, marks: false });
    const wood = s.mat({ tex: 'tx_wood', color: 0xb39c78 }), wood2 = s.mat({ tex: 'tx_wood', color: 0x6d5a44 });
    const mkRamp = (z0, z1, H, dir) => {
      const L = Math.abs(z1 - z0), sg = Math.sign(z0 - z1), tt = z => clamp((z - z0) / (z1 - z0)), prof = z => H * Math.pow(tt(z), 1.6), twz = z => TW * dir * Math.pow(tt(z), 1.4);
      s.course.addPiece({ x0: -RW / 2, x1: RW / 2, z0: Math.min(z0, z1), z1: Math.max(z0, z1), fn: (x, z) => prof(z) + x * Math.tan(twz(z)), step: 1.3 });
      const n = Math.round(L / 0.9); for (let i = 0; i < n; i++) { const z = z0 + (z1 - z0) * (i + 0.5) / n, t = tt(z); s.box({ x: 0, y: prof(z) - 0.15, z, w: RW, h: 0.14, d: L / n * 0.9, mat: i % 5 === 2 ? wood2 : wood, rx: sg * Math.atan(H * 1.6 * Math.pow(t, 0.6) / L), rz: twz(z) }); }
      for (const sx of [-1, 1]) for (const f of [0.5, 0.78, 0.99]) { const z = z0 + (z1 - z0) * f, y = prof(z) + sx * (RW / 2 - 0.3) * Math.tan(twz(z)); s.box({ x: sx * (RW / 2 - 0.3), y: -5, z, w: 0.3, h: 4.8 + y, d: 0.3, mat: wood2 }); if (sx > 0) s.box({ x: 0, y: y - 0.55, z, w: RW, h: 0.25, d: 0.25, mat: wood2, rz: twz(z) }); }
      return { tt, twz, prof };
    };
    mkRamp(-236, ZA, H1, 1); const R2 = mkRamp(-284, ZB, H2, -1);
    // what is left of the old bridge: broken piles and rails
    for (const [x, z, h] of [[-3.4, -253, 3.6], [3.4, -254.5, 2.8], [-3.4, -260, 2.2], [3.4, -262, 3.2], [-3.4, -266, 2.9]]) s.box({ x, y: -5, z, w: 0.35, h: 5 + h - 2.2, d: 0.35, mat: wood2, rz: (x + z) % 0.2 - 0.1 });
    for (const sx of [-1, 1]) { s.box({ x: sx * 3.4, y: 0.9, z: -226, w: 0.14, h: 0.14, d: 20, mat: wood2 }); for (let z = -217; z >= -235; z -= 6) s.box({ x: sx * 3.4, y: 0, z, w: 0.2, h: 1, d: 0.2, mat: wood2 }); }
    sign(s, 'BRIDGE CLOSED', { x: 5.6, y: 1.5, z: -205, w: 4.6, ry: -0.4, bg: '#c81e1e', size: 58 });
    // stilt huts, palms
    const thatch = s.mat({ tex: 'tx_wood', color: 0x9a8448 }); for (const [x, z, ry] of [[-14, -40, 0.3], [15, -110, -0.4], [-16, -190, 0.2], [17, -310, -0.2], [-15, -380, 0.4]]) { const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; s.scene.add(g); s.box({ parent: g, y: 1.3, w: 6, h: 2.4, d: 4.6, mat: wood }); for (const a of [-1, 1]) { s.box({ parent: g, x: a * 1.6, y: 3.3, w: 4.2, h: 0.2, d: 5.4, mat: thatch, rz: -a * 0.62 }); for (const b of [-1, 1]) s.box({ parent: g, x: a * 2.7, z: b * 2, y: 0, w: 0.22, h: 1.4, d: 0.22, mat: wood2 }); } }
    // scattered palms and scrub on open ground by the road, nothing standing in the klong
    const scat = (kind, n, xin, xout, o) => s.trees(kind, n, r => { const sd = r() < 0.5 ? -1 : 1, z = 120 - 660 * r(), x = sd * (xin + Math.pow(r(), 1.5) * (xout - xin)); return z < -238 && z > -282 ? null : [x, z]; }, o);
    scat('palm', 150, 11, 150, { h: [9, 16], seedv: 5 }); scat('bush', 110, 6, 60, { h: [1.5, 3], seedv: 8 }); scat('jungle', 90, 50, 260, { h: [12, 20], seedv: 3 });
    // the klong: jungle walls along both banks (gap left for the downstream camera), reeds, stilt houses, long-tail boats
    for (const sd of [-1, 1]) { dress.treeLine(s, { path: [[sd * 20, -241], [sd * 260, -241]], side: sd < 0 ? -1 : 1, depth: 14, step: 6, kinds: ['jungle', 'palm', 'jungle'], h: [9, 17], seed: 40 + sd }); dress.treeLine(s, { path: [[sd * (sd < 0 ? 44 : 16), -277], [sd * 260, -277]], side: sd < 0 ? 1 : -1, depth: 14, step: 6, kinds: ['jungle', 'palm'], h: [10, 18], seed: 44 + sd }); }
    s.trees('bush', 90, (r, i) => { let x = sr(-150, 150); if (Math.abs(x) < 7) x += 12 * Math.sign(x || 1); return [x, i % 2 ? sr(-245, -249) : sr(-269, -273)]; }, { h: [1.2, 2.6], seedv: 23, wide: 1.3 });
    const stilt = (x, z, ry, w = 6, d = 5) => { const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; s.scene.add(g); s.box({ parent: g, y: 0.2, w, h: 2.3, d, mat: wood, tile: 2 }); s.box({ parent: g, y: 0.05, z: d / 2 + 1, w: w * 0.7, h: 0.15, d: 2.2, mat: wood2 }); for (const a of [-1, 1]) { s.box({ parent: g, x: a * w * 0.27, y: 2.6, w: w * 0.68, h: 0.18, d: d + 1, mat: thatch, rz: -a * 0.6 }); for (const b of [-1, 0, 1]) s.box({ parent: g, x: a * (w / 2 - 0.2), z: b * (d / 2 - 0.2), y: -3.2, w: 0.22, h: 3.4, d: 0.22, mat: wood2, cast: false }); } };
    const boat = (x, z, ry) => { const g = new THREE.Group(); g.position.set(x, -2.25, z); g.rotation.y = ry; s.scene.add(g); s.box({ parent: g, w: 1.3, h: 0.55, d: 8, mat: wood2 }); s.box({ parent: g, y: 0.35, z: -4.2, w: 0.5, h: 0.35, d: 1.2, mat: wood2, rx: -0.5 }); s.box({ parent: g, y: 0.5, z: 3.6, w: 0.35, h: 0.45, d: 0.6, mat: s.mat({ color: 0x2a2a2a, metal: 0.5 }) }); s.box({ parent: g, y: 0.5, z: 4.6, w: 0.08, h: 0.08, d: 2.4, mat: s.mat({ color: 0x555555 }), rx: 0.15 }); };
    stilt(-30, -248.5, 0.05); stilt(-44, -249, -0.08, 5, 4.5); stilt(34, -269.5, Math.PI + 0.1); stilt(52, -270, Math.PI - 0.06, 7, 5); stilt(-70, -270, Math.PI, 6, 5); stilt(78, -248, 0.12);
    boat(-24, -252, 1.45); boat(22, -263, 1.7); boat(-58, -266, 1.62); boat(61, -251, 1.5);
    dress.treeLine(s, { x: -52, z0: 120, z1: -236, side: -1, depth: 18, step: 7, kinds: ['palm', 'jungle', 'jungle'], h: [11, 19], seed: 50 }); dress.treeLine(s, { x: 46, z0: 100, z1: -236, side: 1, depth: 18, step: 7, kinds: ['jungle', 'palm'], h: [11, 18], seed: 51 });
    dress.treeLine(s, { x: -40, z0: -284, z1: -540, side: -1, depth: 20, step: 6, kinds: ['jungle', 'palm'], seed: 52 }); dress.treeLine(s, { x: 40, z0: -284, z1: -540, side: 1, depth: 20, step: 6, kinds: ['palm', 'jungle'], seed: 53 });
    dress.hills(s, { z: -250, r: 430, h: 70, depth: 140, color: 0x34482c, trees: 'jungle', nTrees: 200, seed: 7 });
    dress.crowd(s, { path: [[8, -241.5], [15, -242]], rows: 2, step: 0.9, face: 0.7, colors: [0xd88a20, 0xe0d0b0, 0x40506a, 0x8a3a2a, 0x606a40], gaps: 0.3, seed: 62 });
    s.line({ x: 0, z: -235.5, w: RW, d: 0.5, color: 0xffe14a }); s.crew({ x: 7, z: 26, ry: 1.0 }); s.crew({ x: -8, z: -292, ry: -2.2, people: false });
    const car = s.car = new Drive(s, { kind: 'car', model: 'hornet', x: 0, z: 40, air: 0, nose: -0.5, rollTol: 1.0, pitchTol: 0.95, hard: 13 }); car.dustColor = [0.7, 0.55, 0.38]; car.k.dusty = true;
    const mv = new Movers(s, car); mv.add({ model: 'police_car', x: 0.6, z: 64, v: 0, nearMiss: false, solid: false, avoidPlayer: true, ai: (e, dt) => { if (!s.started) return; const want = e.z < -196 ? 0 : Math.max(7, car.v * 0.9); e.v += (want - e.v) * Math.min(1, dt * (want ? 1.5 : 3)); } });
    let jumped = false, landed = false, lastY = 0, tk = 0; s.objective('Hit the ramp at exactly 40 mph'); idleGuard(s, car);
    const spdAdv = () => `You took off at ${tk.toFixed(1)} mph — ${tk < 40 ? 'too slow, so she under-rotated' : 'too fast, so she over-rotated'}. Have the MPH readout green (38–42) for the last 100 m and hold the throttle steady on the planks.`;
    car.onAir = t => { if (t.z < ZA + 2.5 && !jumped) { jumped = true; tk = car.mph; car.rollRate = (2 * Math.PI - 0.35) * (car.v / V40) / T0; s.rate(`Take-off speed (${tk.toFixed(1)} mph)`, near(tk, 40, 1.2, 7), 1.5); s.slowmo(0.33, 2.8); s.msg(tk.toFixed(1) + ' MPH', Math.abs(tk - 40) < 2 ? 'good' : 'bad'); s.audio.whoosh(); } };
    car.onLand = i => {
      if (car.pos.y < -1) { s.fx.splash(car.pos, 80, 2.5); s.audio.splash(); car.crash(jumped ? `Dropped into the klong — ${tk.toFixed(0)} mph was never going to make it` : 'Drove into the klong', { injury: 0.6, advice: jumped ? `${tk.toFixed(0)} mph is far too slow to clear the water. Build up to 40 mph (green readout) before the yellow line and keep the gas steady.` : 'Stay dead centre on the dirt road — the ramp is only 5 m wide and lines up with the road.' }); return true; }
      if (!jumped || landed) return; landed = true;
      const err = wrapA(i.roll - R2.twz(car.pos.z)), deg = Math.round(Math.abs(err) * 57.3);
      if (lastY < car.pos.y - 0.9) { car.crash('Clipped the lip of the landing ramp', { injury: 0.7, advice: `${tk.toFixed(0)} mph did not carry her onto the far ramp. Be at 40 mph (38–42) when you reach the yellow line.` }); return true; }
      if (Math.abs(err) > 1.15) { car.crash(`${err < 0 ? 'Under' : 'Over'}-rotated by ${deg}° and landed on its side — ${tk.toFixed(0)} mph is not 40`, { injury: 0.75, advice: spdAdv() }); return true; }
      if (Math.abs(i.pitchErr) > 1.2) { car.crash('Nose-dived into the landing ramp', { injury: 0.7, advice: spdAdv() }); return true; }
      if (Math.abs(err) > 0.55 || Math.abs(i.pitchErr) > 0.75) { s.flub(`Landed on two wheels (${deg}° off)`, { penalty: 0.15, advice: spdAdv() }); s.fx.sparks(car.pos, 40); s.engine.addShake(1.1); s.audio.crash(); car.roll *= 0.3; }
      s.rate(`The spiral (off by ${deg}°)`, near(Math.abs(err), 0, 0.12, 1.0), 2); s.rate('Landing', clamp(1 - (Math.abs(i.pitchErr) - 0.2) / 0.85) * clamp(1.4 - i.impact / 34), 1);
      s.msg(deg < 8 ? 'PERFECT SPIRAL' : 'SHE IS DOWN!', 'good'); s.objective('Drive it away'); headline(s, 3); return true;
    };
    s.onUpdate(() => {
      s.hud.readout('spd', 'MPH', car.mph.toFixed(1), !jumped && car.pos.z < -120 ? (car.mph > 38 && car.mph < 42 ? 'ok' : 'warn') : '');
      if (!jumped && car.pos.z < -60 && car.pos.z > ZA) s.hud.readout('rmp', 'Ramp (m)', Math.max(0, Math.round(car.pos.z + 236)));
      lastY = car.pos.y; if (landed && car.pos.z < -372 && !s.ended) s.wrap(1.2);
    });
  },
  bot(s, inp) { const c = s.car, tv = V40 * (+new URLSearchParams(location.search).get("vk") || 1); botDrive(c, inp, 0, 99, 0.06); inp.y = c.v < tv - 0.06 ? 1 : c.v > tv + 0.2 ? -0.3 : 0.12; if (!c.grounded || (c.pos.z < -234 && c.pos.z > -290)) inp.x = 0; if (c.pos.z < -290) inp.y = c.v < 18 ? 1 : 0; },
};

// ---------------------------------------------------------------------------------------------
const BUS_L = [-6.3, -2.1, 2.1, 6.3];
const speedBus = {
  id: 'speed_bus', title: 'Fifty Miles an Hour', film: 'Speed', year: 1994, tier: 3, pay: 7500, mode: 'drive', art: 'bd_la', music: 'chase',
  role: 'Driving city bus 2525 — there is a bomb under it',
  brief: 'Once that bus goes over fifty, the bomb is armed. Drop under fifty and it blows. And nobody told us the freeway is not finished — there is a fifty-foot gap up ahead. Floor it.',
  tips: ['Once you pass <b>50 mph</b> the bomb is armed. Drop below 50 and a <b>3-second fuse</b> starts — get back over 50 or it blows.', 'Hitting traffic scrubs speed. Change lanes <b>early</b> — the bus steers like a bus.', 'The gap needs <b>68 mph or more</b>. Keep your foot flat and the wheels straight.'],
  controls: CTL.drive, intro: { r: 17, h: 4.5 },
  assets: { models: ['city_bus', ...TRAFFIC], tex: ['bd_la', 'tx_asphalt', 'tx_concrete', 'tx_fac_office', 'tx_glass_tower', 'tx_roof', 'tx_metal', 'tx_brick', 'tx_fac_sf', 'tx_dirt'] },
  build(s) {
    // the unfinished 105, South LA: hot hazy afternoon, sun behind the driver's left shoulder, brown smog on the horizon
    s.env('day', { backdrop: 'bd_la', look: 'teal_orange', fog: 0.0021, sun: [34, -55], sunI: 3.5, fogColor: 0xcfc2a6, lookOver: { contrast: 1.14, tint: [1.08, 1.0, 0.9] } });
    const GY = -14, W = 17, GA = -1000, GAP = 15, GB = GA - GAP, ZE = -1300, RH = 1.0;
    s.ground({ tex: 'tx_dirt', y: GY, color: 0xb09c80 });
    const conc = { tex: 'tx_concrete', color: 0xb5b2a8 };
    s.deck({ x: 0, w: W + 1.4, z0: 130, z1: GA, y: 0, thick: 1.8, mat: conc }); s.deck({ x: 0, w: W + 1.4, z0: GB, z1: ZE, y: 0, thick: 1.8, mat: conc });
    s.road({ z0: 130, z1: GA + 30, width: W, lanes: 4, y: 0.03 }); s.road({ z0: GB - 0.5, z1: ZE, width: W, lanes: 4, y: 0.03 });
    s.slope({ x: 0, w: W, z0: GA + 30, z1: GA, y0: 0, y1: RH, curve: 1.5, mat: { tex: 'tx_asphalt' } });
    const BAR = { msg: 'Buried the bus in the barrier', hardK: 3, advice: 'Steer the bus early and gently — it takes a full second to answer the wheel. Stay in the middle lanes.' };
    for (const sx of [-1, 1]) { s.box({ x: sx * (W / 2 + 0.35), y: 0, z: (130 + GA) / 2, w: 0.4, h: 1.0, d: 130 - GA, mat: conc, solid: true, cast: false, sol: BAR }); s.box({ x: sx * (W / 2 + 0.35), y: 0, z: (GB + ZE) / 2, w: 0.4, h: 1.0, d: GB - ZE, mat: conc, solid: true, cast: false, sol: BAR }); }
    for (let z = 100; z > ZE; z -= 60) if (z > GA + 4 || z < GB - 4) s.box({ x: 0, y: GY, z, w: 3.2, h: -GY - 1.8, d: 3.2, mat: conc, cast: false });
    // unfinished edge: rebar, barrels, warning boards
    const rebar = s.mat({ color: 0x6b3d25, rough: 0.9 }); for (let x = -8; x <= 8; x += 1.3) { s.box({ x, y: -0.9 + (x * 7 % 1) * 0.4, z: GA - 0.6, w: 0.07, h: 0.07, d: 1.6, mat: rebar, cast: false }); s.box({ x: x + 0.5, y: -1.1, z: GB + 0.7, w: 0.07, h: 0.07, d: 1.8, mat: rebar, cast: false }); }
    s.cones([[-7.6, GA + 60], [-7.6, GA + 45], [7.6, GA + 60], [7.6, GA + 45], [-7.8, GA + 32], [7.8, GA + 32]]);
    for (const x of [-5, 0, 5]) s.box({ x, y: 0.5, z: GA + 150, w: 3.6, h: 0.5, d: 0.15, mat: s.mat({ color: 0xff7a10 }), solid: 'break', sol: { soft: true, debris: 0xff7a10 } });
    gantry(s, -150, 'DOWNTOWN  ·  LOS ANGELES'); gantry(s, -520, '105  EAST  ·  AIRPORT'); gantry(s, GA + 210, 'FREEWAY ENDS  ·  ROAD CLOSED', { bg: '#d9a400', fg: '#111', size: 44 });
    for (const sd of [-1, 1]) s.row({ side: sd, x: sd * 52, z0: 130, z1: ZE, fac: ['tx_fac_office', 'tx_brick', 'tx_fac_sf', 'tx_glass_tower'], height: [9, 26], width: [20, 34], depth: [18, 26], y: GY, solid: false, seedv: 4, gap: 22 });
    // under and around the deck: palms, power poles, a flyover of the interchange, a tower crane at the unfinished end
    s.trees('palm', 90, (r, i) => { const sd = i % 2 ? 1 : -1, z = 120 - r() * 1400; return Math.abs(z - GA) < 40 ? null : [sd * (16 + r() * 30), z]; }, { h: [19, 27], seedv: 41 });
    for (const sd of [-1, 1]) dress.poles(s, { x: sd * 36, z0: 125, z1: ZE, gap: 44, h: 13 });
    const fc = s.mat({ tex: 'tx_concrete', color: 0xb8b4aa }); s.box({ x: 0, y: 10.5, z: -640, w: 260, h: 1.6, d: 13, ry: 0.35, mat: fc, tile: 10 }); for (const sd of [-1, 1]) s.box({ x: sd * 0.94 * 4, y: 12.1, z: -640 - sd * 0.343 * 4, w: 260, h: 0.9, d: 0.3, ry: 0.35, mat: fc, cast: false }); for (const u of [-120, -85, -50, -22, 22, 50, 85, 120]) s.box({ x: u * 0.94, y: GY, z: -640 - u * 0.343, w: 2.6, h: 10.5 - GY, d: 2.6, mat: fc, cast: false });
    const ye = s.mat({ color: 0xd8a818, metal: 0.4, rough: 0.5 }); s.box({ x: -32, y: GY, z: GB - 30, w: 1.4, h: 62, d: 1.4, mat: ye }); s.box({ x: -32, y: GY + 61, z: GB - 18, w: 1.0, h: 1.2, d: 62, mat: ye, cast: false }); s.box({ x: -32, y: GY + 63, z: GB - 30, w: 0.6, h: 4, d: 0.6, mat: ye, cast: false }); s.box({ x: -32, y: GY + 58, z: GB - 54, w: 2.2, h: 2.4, d: 3, mat: s.mat({ color: 0x55595c }), cast: false });
    s.crew({ x: 6.3, z: 22, ry: 0.9 }); s.crew({ x: -7, z: GB - 60, ry: -2.3, people: false });
    const bus = s.car = new Drive(s, { kind: 'bus', model: 'city_bus', x: 2.1, z: 40, top: 42, accel: 6.5, steer: 1.3, pitchTol: 0.5, hard: 15, cam: { dist: 15, height: 5.2, ahead: 9 } });
    const mv = s.mv = new Movers(s, bus); mv.nearPay = 80; srand(7); s.rate('Clean traffic', 1, 1.2);
    for (let i = 0; i < 20; i++) {
      const e = mv.add({ model: TRAFFIC[Math.floor(sr(TRAFFIC.length))], x: BUS_L[(i * 3 + 1) % 4], z: -90 - i * 24 - sr(10), v: sr(11, 15.5), type: 'break', recycle: [70, 230, 420], zEnd: GA + 110,
        ai: e => { if (e.alive && e.z < GA + 80) { e.alive = false; e.m.visible = false; } },
        on: (c, sol) => { const m = sol.mover; mv.fling(m, 5); m.v = bus.v * 1.15; dock(s, 'Clean traffic', 0.22); s.msg('TRAFFIC!', 'bad'); s.audio.crash(); } }); e.sol.slow = 0.9; e.sol.debris = 0x999999;
    }
    let armed = false, sum = 0, n = 0, jumped = false, landed = false, lastY = 0, beep = 0, slowT = 0, gm = 0; s.objective('Get the bus above 50 mph'); idleGuard(s, bus);
    bus.cineMin = 0.35; // even a short hop over the gap gets the live cut
    const boom = (why, advice) => { s.fx.explosion(V3(bus.pos.x, bus.pos.y + 1.5, bus.pos.z), 3); s.audio.explosion(1.2); s.engine.flash(0.8); bus.crash(why, { injury: 1, fire: true, advice }); };
    const gapAdv = () => `You reached the gap at ${Math.round(gm)} mph — it needs 68+. Keep W flat from the FREEWAY ENDS sign, change lanes early so traffic never slows you, and hit the ramp straight.`;
    bus.onAir = t => { if (t.z < GA + 3 && !jumped) { jumped = true; gm = bus.mph; s.rate(`Speed at the gap (${Math.round(gm)} mph)`, near(gm, 74, 5, 14), 1.5); s.slowmo(0.35, 1.6); s.msg(Math.round(gm) + ' MPH', 'good'); s.moment('the gap', { t0: s.t - 1.4, dur: 3.6, w: 3, shots: [{ type: 'wide', pos: [-30, -2.5, GA - 8], fov: 32, lookUp: 0.8, speed: 0.3, a: 0.2, b: 0.85 }, { type: 'front', pos: [8.1, 1.3, GB - 30], fov: 34, lookUp: 0.8, speed: 0.35, a: 0.25, b: 0.68 }, { type: 'track', speed: 0.45 }] }); } }; // signature: side-on from beside the gap, 2525 in the air with nothing under it
    bus.onLand = i => {
      if (bus.pos.y < -3) { boom('Fell into the gap in the freeway', jumped ? gapAdv() : 'Line the bus up on the ramp in the middle of the road — the gap is right across the freeway.'); return true; }
      if (jumped && !landed) { if (lastY < -0.45 || bus.pos.z > GB - 3.8) { boom('Came up short and hit the far edge of the gap', gapAdv()); return true; } landed = true; s.rate('Landing', i.clean, 1.3); s.bonus('Bus jump: ' + ftOf(i.dist) + ' ft', Math.round(i.dist * 12)); s.msg('MADE IT!', 'huge good'); s.objective('Keep it above 50!'); }
    };
    bus.onHit = () => dock(s, 'Clean traffic', 0.1);
    s.onUpdate((dt, t) => {
      if (!s.started || s.ended) return; const m = bus.mph;
      if (!armed && m >= 50) { armed = true; s.msg('BOMB ARMED', 'bad'); s.audio.bell?.(); s.objective('Stay above 50 mph — gap ahead needs 68'); }
      if (armed) {
        sum += m * dt; n += dt; if (m < 55 && (beep -= dt) < 0) { beep = m < 50 ? 0.1 : 0.25; s.audio.tick(); }
        // under 50: a short fuse, not an instant bang — get back over 50 inside 3 seconds
        if (m < 50 && bus.grounded) { if (!slowT) s.flub(`Dropped under 50 mph`, { penalty: 0.15, advice: 'Never lift near traffic — change lanes early instead of braking, and keep W down after the landing.' }); slowT += dt; s.hud.prompt(`<b>UNDER 50!</b> FUSE ${Math.max(0, 3 - slowT).toFixed(1)}`); if (slowT > 3) { s.hud.prompt(''); return boom(`Stayed under 50 mph for 3 seconds — the bomb went off`, 'When the fuse starts, floor it and steer for the clearest lane — the bus needs a few seconds to climb back over 50.'); } }
        else if (slowT && m >= 50) { slowT = 0; s.hud.prompt(''); s.msg('BACK OVER 50', 'good'); }
      }
      s.hud.readout('spd', 'MPH', Math.round(m), armed ? (m < 55 ? 'warn' : 'ok') : ''); s.hud.readout('bomb', 'Bomb', armed ? (slowT ? 'FUSE!' : 'ARMED') : 'safe', armed ? 'warn' : '');
      if (!jumped) s.hud.readout('gap', 'Gap in (m)', Math.max(0, Math.round(bus.pos.z - GA)), bus.pos.z < GA + 250 ? (m >= 68 ? 'ok' : 'warn') : '');
      lastY = bus.pos.y; if (landed && bus.pos.z < GB - 130) { s.rate('Speed held', clamp((sum / n - 52) / 16), 1); s.wrap(1.3); }
    });
  },
  bot(s, inp, B) {
    const c = s.car; const free = L => { let d = 1e9; for (const e of s.mv.list) { if (!e.alive) continue; if (Math.abs(e.m.position.x - L) < 3.3) { const dz = c.pos.z - e.z; if (dz > -17 && dz < d) d = dz; } } return d; };
    let L = B.lane ?? 2.1; const i = BUS_L.indexOf(L), dc = free(L);
    if (dc < 75) { let best = L, bd = dc + 25; for (const j of [i - 1, i + 1]) if (BUS_L[j] != null) { const d = free(BUS_L[j]); if (d > bd) { bd = d; best = BUS_L[j]; } } L = best; }
    B.lane = L; botDrive(c, inp, L, 99, 0.07); if (!c.grounded) inp.x = 0;
  },
};

// ---------------------------------------------------------------------------------------------
const CAN_Z = [-170, -340, -510, -680, -850];
const t2 = {
  id: 't2_canal', title: 'Flood Channel', film: 'Terminator 2: Judgment Day', year: 1991, tier: 3, pay: 8000, mode: 'drive', art: 'bd_la', music: 'chase',
  role: 'Doubling the T-800 — Harley Fat Boy, with a tow truck on your tail',
  brief: 'You drop the Harley off the spillway into the flood channel, land it flat, and then you run. The truck comes in right behind you and it does not stop for anything. Neither do you.',
  tips: ['Off the ledge the bike wants to nose-dive: <b>feather W</b> to land it level.', 'The truck is only a little slower than you. Every scrape and every piece of junk lets it close in.', 'Pick your gap between the bridge piers <b>early</b> and stay off the sloping walls.'],
  controls: BIKE_CTL, intro: { r: 8, h: 2.4 },
  assets: { models: ['fatboy', 'ch_biker', 'semi_truck'], tex: ['bd_la', 'tx_concrete', 'tx_brick', 'tx_fac_office', 'tx_roof', 'tx_metal'] },
  build(s) {
    // the LA River, 1991: hard, smoggy San Fernando Valley daylight, warm brown haze down the channel
    s.env('day', { backdrop: 'bd_la', look: 'teal_orange', fog: 0.0026, hz: 0.42, sun: [40, -35], sunI: 3.0, amb: 0.75, fogColor: 0xc9bea6, lookOver: { tint: [1.07, 1.0, 0.88], contrast: 1.14, sat: 1.05 } });
    const LZ = -18, UP = 7, FW = 8, cy = z => UP * smooth(LZ - 3, LZ, z), fn = (x, z) => cy(z) + clamp((Math.abs(x) - FW) * 0.8, 0, 6.5);
    s.terrain({ x0: -60, x1: 60, z0: 130, z1: -1060, res: 2.5, fn, mat: s.mat({ tex: 'tx_concrete', color: 0xb6b1a4 }), tile: 9 });
    const WALL = { y0: -2, y1: 40, z0: -1100, z1: 200, msg: 'Hit the channel wall', hardK: 4, advice: 'Keep off the sloping walls — ride the flat floor (the dark wet stripe marks the middle).' }; s.course.addSolid({ x0: 10.6, x1: 70, ...WALL }); s.course.addSolid({ x0: -70, x1: -10.6, ...WALL });
    const wet = s.mat({ color: 0x3d4a48, rough: 0.15, metal: 0.3 }); s.box({ x: 0, y: 0.005, z: (LZ - 3 - 1060) / 2, w: 1.3, h: 0.02, d: 1060 + LZ - 3, mat: wet, cast: false }); s.box({ x: 0, y: UP + 0.005, z: (130 + LZ) / 2, w: 1.3, h: 0.02, d: 130 - LZ, mat: wet, cast: false });
    s.box({ x: 0, y: UP - 0.05, z: LZ + 0.5, w: 21, h: 0.12, d: 0.6, mat: s.mat({ color: 0xe0c020 }), cast: false });
    // road bridges with piers standing in the channel
    const conc = s.mat({ tex: 'tx_concrete', color: 0x9d9a90 });
    CAN_Z.forEach((z, i) => { s.box({ x: 0, y: 8, z, w: 80, h: 1.5, d: 11, mat: conc, tile: 8 }); for (const sx of [-1, 1]) s.box({ x: 0, y: 9.5, z: z + sx * 5.3, w: 80, h: 0.9, d: 0.3, mat: conc, cast: false }); for (const x of (i % 2 ? [0] : [-4.6, 4.6])) s.box({ x, y: 0, z, w: 1.3, h: 8, d: 9, mat: conc, tile: 5, solid: true, sol: { msg: 'Hit a bridge pier', hardK: 0.6, advice: 'Pick your gap 60 m before each bridge: one pier in the middle means go left or right, two piers means go through the middle.' } }); });
    // junk in the channel
    srand(23); const junk = [0x7a5a3a, 0x445566, 0x883322, 0x55604a, 0x999999]; s.rate('Clean ride', 1, 1);
    for (let z = -80; z > -880; z -= sr(34, 52)) { if (CAN_Z.some(b => Math.abs(z - b) < 34)) continue; const x = sr(-7, 7), c = junk[Math.floor(sr(junk.length))], big = sr() < 0.4; s.box({ x, y: 0, z, w: big ? 1.6 : 0.9, h: big ? 1.1 : 0.7, d: big ? 1.2 : 0.9, ry: sr(3), mat: s.mat({ color: c, rough: 0.8 }), solid: 'break', sol: { debris: c, slow: 0.8, on: () => { dock(s, 'Clean ride', 0.2); s.msg('JUNK!', 'bad'); } } }); }
    // fences and the city on the banks
    const mesh = s.mat({ color: 0x8a9096, opacity: 0.35, metal: 0.6 }); for (const sx of [-1, 1]) { s.box({ x: sx * 17, y: 6.5, z: (LZ - 1060) / 2, w: 0.06, h: 2.2, d: 1060 + LZ, mat: mesh, cast: false }); s.row({ side: sx, x: sx * 24, z0: LZ - 6, z1: -1060, fac: ['tx_brick', 'tx_fac_office'], height: [6, 15], width: [18, 34], y: 6.5, solid: false, seedv: 6, gap: 10 }); s.row({ side: sx, x: sx * 24, z0: 130, z1: LZ + 4, fac: ['tx_brick', 'tx_fac_office'], height: [6, 12], width: [18, 30], y: 13.5, solid: false, seedv: 9 }); }
    // banks: LA palms, power poles and scrub along the fences
    for (const sx of [-1, 1]) { dress.treeLine(s, { x: sx * 20.5, z0: 120, z1: -1050, side: sx, depth: 2, step: 26, kinds: ['palm'], h: [15, 24], seed: 70 + sx, bushes: false }); dress.poles(s, { x: sx * 18.6, z0: 125, z1: -1050, gap: 46, h: 10 }); }
    s.trees('bush', 160, (r, i) => [(i % 2 ? 1 : -1) * sr(17.6, 21), sr(125, -1050)], { h: [0.8, 2.0], seedv: 71, wide: 1.3 });
    s.crew({ x: 6, z: 28, y: UP, ry: 1.0 }); s.crew({ x: -6.5, z: -75, ry: -2.2, people: false });
    const b = s.car = new Drive(s, { kind: 'bike', model: 'fatboy', driver: 'ch_biker', driverPos: [0, -0.52, 0.3], x: 0, z: 40, top: 40, accel: 11.5, nose: -0.9, air: 1.5, hard: 14, cam: { dist: 6.2, height: 2.3 } });
    const mv = new Movers(s, b); const T = { tx: 0, vy: 0, down: false, back: 0, warned: false }, side = z => (Math.round((z + 340) / 340) % 2 ? 1 : -1);
    // the truck's path is scripted through the gaps between the bridge piers (avoid:false); it bulldozes the junk (Movers._smash)
    const tr = mv.add({ model: 'semi_truck', z: 76, y: UP, v: 0, solid: false, nearMiss: false, avoid: false, path: (z, e) => { let x = T.tx; CAN_Z.forEach((bz, i) => { const w = smooth(75, 28, Math.abs(z - bz)); x = lerp(x, i % 2 ? side(bz) * 3.9 : clamp(x, -2.2, 2.2), w); }); return x; },
      ai: (e, dt) => {
        if (!s.started) return; const gap = e.z - b.pos.z - 4.6, tt = s.t - s.t0;
        let want = gap > 55 ? 40.5 : gap > 28 ? 37.5 : gap > 12 ? 35.5 : 34; if (tt < 6) want = Math.min(want, b.v + 1.5); if (T.back > 0) { T.back -= dt; want = Math.min(want, b.v * 0.6); } if (b.dead) want = 12;
        e.v += (want - e.v) * Math.min(1, dt * 1.2); T.tx = damp(T.tx, clamp(b.pos.x, -5.5, 5.5), 0.9, dt);
        if (e.z < LZ - 1 && e.y > 0) { T.vy -= 9.8 * dt; e.y = Math.max(0, e.y + T.vy * dt); if (e.y === 0 && !T.down) { T.down = true; s.moment('the truck drops in', { t0: s.t - 2.0, dur: 3.6, w: 2.5, subject: e.m, shots: [{ type: 'low', pos: [6.4, 1.0, LZ - 42], fov: 40, lookUp: 1.6, speed: 0.4, a: 0.25, b: 0.8 }, { type: 'rear', speed: 0.6 }, { type: 'chase', speed: 0.6, a: 0.4 }] }); /* signature: from the channel floor as the truck comes off the spillway at you */ s.audio.crash(); s.engine.addShake(0.7); s.fx.dust(e.m.position, 24, { spread: 4, size: 3 }); s.fx.sparks(e.m.position, 40); } }
        if (T.down && Math.random() < 0.3) s.fx.sparks(V3(e.m.position.x + rnd(-1.2, 1.2), 0.1, e.z), 2);
      } });
    let dropped = false, minGap = 99, fin = false; s.objective('Off the spillway — land it level'); idleGuard(s, b, { warn: 4, stop: 30 });
    b.onLand = i => { if (!dropped && i.airTime > 0.5 && b.pos.z < LZ) { dropped = true; s.rate('Drop landing', i.clean, 1.3); s.msg(i.clean > 0.75 ? 'CLEAN DROP' : 'DOWN!', 'good'); s.objective('Outrun the truck'); } };
    b.onAir = t => { if (t.z < LZ + 4 && !dropped) s.slowmo(0.5, 1.2); };
    b.onHit = () => dock(s, 'Clean ride', 0.12);
    s.onUpdate(() => {
      if (!s.started || s.ended) return; const gap = tr.z - b.pos.z - 4.6; if (dropped) minGap = Math.min(minGap, gap);
      s.hud.readout('gap', 'Truck (m)', Math.max(0, Math.round(gap)), gap < 14 ? 'warn' : 'ok'); s.hud.readout('spd', 'MPH', Math.round(b.mph)); s.hud.readout('dst', 'To go (m)', Math.max(0, Math.round(b.pos.z + 900)));
      // first time it gets on your back wheel the driver backs off (a flub); the second time it runs you down
      if (gap < 6 && !T.warned && !b.dead) { T.warned = true; T.back = 2.5; s.audio.horn?.(110); s.flub('The truck was on your back wheel', { penalty: 0.2, advice: 'Every scrape and every piece of junk lets the truck close in. Pick a clean line 60 m ahead and keep W flat.' }); }
      if (gap < 0.6 && !b.dead) { s.audio.horn?.(110); return b.crash('The truck ran you down', { injury: 0.95, advice: 'The truck is only a little slower than you. Never touch the brakes — dodge the junk early and keep W flat all the way.' }); }
      if (b.pos.z < -900 && !fin) { fin = true; s.rate('Lead over the truck', clamp(minGap / 15), 1.5); s.wrap(1.3); }
    });
  },
  bot(s, inp, B) {
    const c = s.car, cand = [0, -2.6, 2.6, -5.6, 5.6, -7.4, 7.4]; const blocked = x => { for (const sol of s.course.solids) { if (sol.dead || sol.mover || sol.type === 'trigger' || sol.x1 - sol.x0 > 5) continue; const dz = c.pos.z - sol.z1; if (dz > -10 && dz < 62 && sol.x0 < x + 1.25 && sol.x1 > x - 1.25) return true; } return false; };
    let tx = B.tx ?? 0; if (blocked(tx)) { let best = null; for (const x of cand) if (!blocked(x) && (best == null || Math.abs(x - c.pos.x) < Math.abs(best - c.pos.x))) best = x; if (best != null) tx = best; } B.tx = tx;
    botDrive(c, inp, tx, 99, 0.09); if (!c.grounded) { inp.x = 0; inp.y = c.pitch < -0.04 ? 0.55 : 0; }
  },
};

// ---------------------------------------------------------------------------------------------
const diamonds = {
  id: 'diamonds', title: 'Two-Wheel Alley', film: 'Diamonds Are Forever', year: 1971, tier: 3, pay: 7500, mode: 'drive', art: 'bd_vegas', music: 'spy',
  role: 'Doubling 007 — red Mustang Mach 1, downtown Las Vegas',
  brief: 'The Sheriff has you boxed in and the only way out is an alley too narrow for the car. So you put the right-hand wheels up the ramp, tip her on two and thread it. Do keep her balanced.',
  tips: ['Put your <b>right wheels</b> on the ramp at <b>30–45 mph</b>.', 'In the alley: <b>D lifts</b> the car higher, <b>A lets it down</b>. Keep the needle in the green.', 'Drop too flat and you wedge between the walls. Tip too far and she goes over.'],
  controls: `${K('W')} gas &nbsp; ${K('S')} brake &nbsp; ${K('A')}${K('D')} steer — on two wheels: ${K('A')} lower &nbsp; ${K('D')} lift`, intro: { r: 9, h: 2.3 },
  assets: { models: ['mach1', 'police_car', 'taxi', 'sedan_grey', 'wagon_brown'], tex: ['bd_vegas', 'tx_asphalt', 'tx_fac_night', 'tx_concrete', 'tx_roof', 'tx_brick'] },
  build(s) {
    s.env('night', { backdrop: 'bd_vegas', look: 'neon', fog: 0.002, amb: 1.7, sunI: 1.9, bdGain: 1.3 });
    s.ground({ tex: 'tx_asphalt', tile: 10, color: 0xb0b0c4, rough: 0.5 });
    const RZ = -146, AZ0 = -168, AZ1 = -288, AW = 2.9, PHI = 0.85, LIM = 0.42;
    street(s, { z0: 90, z1: AZ0, width: 14, lanes: 4, fac: ['tx_fac_night'], height: [14, 30], lit: 1.3, lamps: 0 }); street(s, { z0: AZ1, z1: -460, width: 14, lanes: 4, fac: ['tx_fac_night'], height: [14, 30], lit: 1.3, lamps: 0, seedv: 12 });
    for (const sx of [-1, 1]) { s.building({ x: sx * (AW / 2 + 14), z: (AZ0 + AZ1) / 2, w: 28, d: AZ0 - AZ1, h: 17, fac: 'tx_brick', facTile: 2.6, tint: 0xa89888, lit: 0.45, sol: { msg: 'Hit the wall beside the alley', advice: 'Line up on the green stripe 60 m out so the right wheels meet the ramp square — the alley is only 2.9 m wide.' } }); s.box({ x: sx * (AW / 2 + 14), y: 17, z: AZ0 - 1, w: 28, h: 4, d: 1, mat: s.mat({ color: 0x221122 }) }); }
    // neon: blade signs, tubes, lettering
    const neon = c => s.mat({ color: c, emissive: c, emI: 3.2 }), cols = [0xff2d78, 0x22e0ff, 0xffd020, 0x9a50ff, 0x40ff80, 0xff6a20];
    srand(4); for (let z = 70; z > -450; z -= 17) { if (z < AZ0 + 4 && z > AZ1 - 4) continue; for (const sx of [-1, 1]) { const c = cols[Math.floor(sr(cols.length))], y = sr(4, 9); if (sr() < 0.6) s.box({ x: sx * 10.1, y, z: z + sr(-4, 4), w: 0.5, h: sr(3, 7), d: 1.3, mat: neon(c), cast: false }); else s.box({ x: sx * 10.4, y, z: z + sr(-4, 4), w: 0.15, h: 0.35, d: sr(5, 11), mat: neon(c), cast: false }); } }
    for (const [t, x, y, z, ry, bg] of [['CASINO', -10.3, 7, 20, 1.57, '#b0105a'], ['LUCKY  7', 10.3, 8, -30, -1.57, '#0a5d9a'], ['MOTEL', -10.3, 6, -90, 1.57, '#8a6a00'], ['SLOTS  ·  KENO', 6.8, 19, AZ0 + 0.1, 0, '#b0105a'], ['GIRLS  GIRLS  GIRLS', -7, 19, AZ0 + 0.1, 0, '#5a10a0'], ['PARKING', 10.3, 6, -330, -1.57, '#0a7a3a']]) sign(s, t, { x, y, z, ry, w: 9, bg, glow: 2.4 });
    // Glitter Gulch: tall blade signs hanging over the sidewalks, read edge-on by the approaching car
    for (const [t, sx, z, bg] of [['JACKPOT', -1, 46, '#b0105a'], ['GOLD  RUSH', 1, 8, '#8a5a00'], ['HOTEL', -1, -48, '#0a5d9a'], ['BINGO', 1, -78, '#a01818'], ['KENO', 1, -330, '#5a10a0'], ['CASINO', -1, -360, '#b0105a'], ['HOTEL', 1, -410, '#0a7a3a']]) { const m = sign(s, t, { x: sx * 9.0, y: 12, z, w: 10, bg, glow: 1.5, size: 70 }); m.rotation.z = Math.PI / 2; }
    for (const sx of [-1, 1]) { s.box({ x: sx * (AW / 2 + 0.12), y: 0, z: AZ0 + 0.1, w: 0.14, h: 6, d: 0.14, mat: neon(0x22e0ff), cast: false }); } s.box({ x: 0, y: 6, z: AZ0 + 0.1, w: AW + 0.4, h: 0.14, d: 0.14, mat: neon(0x22e0ff), cast: false });
    s.light({ x: 0, y: 5, z: RZ + 4, color: 0x66d0ff, i: 90, dist: 40, bulb: false }); s.light({ x: 0, y: 5, z: AZ1 - 6, color: 0xff60a0, i: 90, dist: 40, bulb: false });
    // alley dressing (kept off the driving line)
    const bin = s.mat({ color: 0x2c4a3a, rough: 0.6, metal: 0.4 }); for (let z = AZ0 - 14; z > AZ1 + 8; z -= 23) { s.box({ x: (z % 2 ? 1 : -1) * (AW / 2 - 0.08), y: 3.2, z, w: 0.12, h: 0.5, d: 1.6, mat: neon(cols[Math.abs(Math.round(z)) % 6]), cast: false }); s.box({ x: 0, y: 7 + (z % 3), z, w: AW, h: 0.12, d: 0.12, mat: bin, cast: false }); }
    // the ramp: right wheels only
    const rm = s.mat({ tex: 'tx_concrete', color: 0xd0c8b0 }); s.box({ x: 1.75, y: 0.42, z: RZ - 5, w: 1.5, h: 0.12, d: 10.1, mat: rm, rx: 0.1 }); s.box({ x: 1.75, y: 0, z: RZ - 8.5, w: 1.5, h: 0.72, d: 3, mat: rm }); s.box({ x: 1.75, y: 0, z: RZ - 5.5, w: 1.5, h: 0.4, d: 3, mat: rm });
    s.line({ x: 1.75, z: RZ + 1.2, w: 1.5, d: 2, color: 0x30ff70, glow: 1.6 }); s.line({ x: 1.75, z: RZ + 14, w: 0.3, d: 20, color: 0x30ff70, glow: 1.2 });
    for (const [m, x, z, ry] of [['taxi', -5.4, -18, 0], ['sedan_grey', 5.4, -44, 0], ['wagon_brown', -1.9, -72, 0.05], ['sedan_grey', -5.5, -112, 0], ['taxi', 5.5, -104, 3.14], ['wagon_brown', 5.4, -335, 0], ['taxi', -5.4, -372, 3.14]]) s.put(m, { x, z, ry, solid: true, sol: { msg: 'Hit a parked car on the Strip', advice: 'Weave round the parked cars early, then settle onto the green stripe on the right for the ramp.' } });
    s.crew({ x: 5.6, z: 28, ry: 0.9, light: 160 });
    const car = s.car = new Drive(s, { kind: 'muscle', model: 'mach1', x: -1.8, z: 40, cam: { dist: 7, height: 2.3 } });
    const mv = new Movers(s, car); for (let i = 0; i < 2; i++) { const e = mv.add({ model: 'police_car', x: i ? 2.4 : -2.2, z: 60 + i * 9, v: 0, solid: false, nearMiss: false, avoidPlayer: true, ai: (e, dt) => { if (!s.started) return; const want = e.z < RZ + 26 + i * 8 ? 0 : Math.max(6, car.v * (0.92 - i * 0.05)); e.v += (want - e.v) * Math.min(1, dt * (want ? 1.4 : 4)); } }); const lb = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.16, 0.3), glow(4, 0.3, 0.3)); lb.position.y = e.h + 0.05; e.m.add(lb); e.bar = lb; }
    const hl = s.light({ color: 0xffe0c0, i: 34, dist: 30, bulb: false }); s.onUpdate(() => hl.position.set(car.pos.x, 3.2, car.pos.z - 5));
    const st = s.bal = { mode: 'drive', e: 0, ed: 0, b: 0, sum: 0, n: 0, t: 0 }; s.rate('Clean approach', 1, 0.7); car.onHit = () => { if (st.mode === 'drive') dock(s, 'Clean approach', 0.3); };
    s.objective('Right wheels up the ramp at 30–45 mph'); idleGuard(s, car);
    const LH = 0.62, rampAdv = 'Line up on the green stripe (right-hand side) and hold 30–45 mph — only the right wheels go on the ramp.';
    s.onUpdate((dt, t) => {
      for (const e of mv.list) if (e.bar) e.bar.material.color.setRGB(Math.sin(t * 14) > 0 ? 5 : 0.3, 0.3, Math.sin(t * 14) > 0 ? 0.3 : 5);
      if (!s.started || s.ended) return; const z = car.pos.z, mph = car.mph; s.hud.readout('spd', 'MPH', Math.round(mph), st.mode === 'drive' && z < -70 ? (mph > 30 && mph < 45 ? 'ok' : 'warn') : '');
      if (st.mode === 'drive' && z < RZ) {
        const on = car.pos.x > 0.15 && car.pos.x < 1.75;
        if (on && mph > 53) { st.mode = 'over'; s.msg('TOO FAST!', 'bad'); tumbleScript(s, car, { rollRate: 8, decel: 12, onDone: () => { } }); return s.fail(`Hit the ramp at ${Math.round(mph)} mph and rolled the Mustang`, { injury: 0.6, advice: `${Math.round(mph)} mph flips her. Brake to 30–45 mph (green readout) before the ramp — 37 is perfect.` }); }
        if (on && mph >= 25) { st.mode = 'tilt'; s.rate(`Ramp speed (${Math.round(mph)} mph)`, near(mph, 37, 6, 16), 1); car.steerScale = 0; s.msg('UP ON TWO!', 'good'); s.audio.impact(0.5); s.engine.addShake(0.4); s.cam.set({ dist: 6.2, height: 1.9 }); s.objective('Balance: A lower · D lift'); s.moment('up on two wheels', { t0: s.t - 1.2, dur: 5.5, w: 3, shots: [{ type: 'front', pos: [0, 1.1, AZ0 - 64], fov: 12, lookUp: 0.6, speed: 0.6, a: 0.15 }, { type: 'rear', speed: 0.6 }, { type: 'low', speed: 0.35 }] }); /* signature: long lens straight down the alley as she comes at you on two wheels */ }
        else { st.mode = 'miss'; st.why = on ? `Only ${Math.round(mph)} mph on the ramp — not enough to tip her onto two wheels` : 'Missed the ramp'; s.msg(on ? 'TOO SLOW' : 'MISSED THE RAMP', 'bad'); }
      }
      if (st.mode === 'miss' && z < AZ0 + 6) {
        // she will not fit on four wheels: stop at the alley mouth, then back to one for another go (once)
        st.misses = (st.misses || 0) + 1; car.v *= 0.2; car.vel.multiplyScalar(0.2);
        if (st.misses > 1) return car.crash(st.why + ' again and wedged the Mustang in the alley mouth', { injury: 0.35, advice: rampAdv });
        s.flub(st.why, { penalty: 0.3, advice: rampAdv }); s.fx.sparks(car.pos, 30); s.audio.impact(0.8); s.engine.addShake(0.6); st.mode = 'reset'; car.control = false;
        s.after(1.1, () => { if (s.ended) return; car.pos.set(1.75, 0, RZ + 22); car.heading = 0; car.camHead = 0; car.v = 0; car.vel.set(0, 0, 0); car.control = true; st.mode = 'drive'; s.msg('BACK TO ONE — GO AGAIN', 'small'); s.objective('Right wheels up the ramp at 30–45 mph'); });
      }
      if (st.mode === 'reset') { car.v *= Math.exp(-6 * dt); car.vel.multiplyScalar(Math.exp(-6 * dt)); }
      if (st.mode === 'tilt') {
        st.b = smooth(0, 1, (RZ - z) / 16); car.throttleLock = car.v < 14.5 ? 0.7 : 0; car.heading = damp(car.heading, 0, 6, dt); car.pos.x = damp(car.pos.x, -0.12, 3.5, dt);
        if (z < AZ0 + 1) {
          st.t += dt; const k = clamp(st.t / 1.2), drift = (1.15 * Math.sin(st.t * 1.3 + 1) + 0.75 * Math.sin(st.t * 2.9 + 0.5) + 0.3 * Math.sin(st.t * 6.1)) * k;
          st.ed += (3.2 * st.e + 4.6 * s.input.x + drift) * dt; st.ed *= Math.exp(-1.2 * dt); st.e += st.ed * dt; st.sum += Math.abs(st.e) * dt; st.n += dt;
          s.hud.meter('bal', 'BALANCE  ·  flat ◄ ► over', clamp(0.5 + st.e / (LH * 2)), { color: Math.abs(st.e) < LIM * 0.45 ? '#30ff70' : '#ff5030', zone: [0.5 - LIM * 0.45 / (LH * 2), 0.5 + LIM * 0.45 / (LH * 2)] });
          if (Math.abs(st.e) > LIM * 0.62 && Math.random() < 0.5) s.fx.sparks(V3(car.pos.x + (st.e < 0 ? 1.3 : -1.1), 0.9 + rnd(0.8), car.pos.z - 1), 3, { dir: V3(0, 0, 1) });
          // wobbles past the soft limit are flubs: the walls (flat side) or the stunt driver's weight (over side) push her back
          if (Math.abs(st.e) > LIM && !st.ex) { st.ex = true; const flat = st.e < 0; s.flub(flat ? 'Dropped her onto the walls' : 'Nearly tipped her over', { penalty: 0.12, advice: flat ? 'Too flat — tap D to lift her as soon as the needle drifts left of the green.' : 'Too far over — tap A to let her down as soon as the needle drifts right of the green.' }); s.fx.sparks(V3(car.pos.x, 1.2, car.pos.z - 1), 40, { dir: V3(0, 0, 1) }); s.audio.impact(0.6); s.engine.addShake(0.5); st.ed = -Math.sign(st.e) * Math.abs(st.ed) * 0.35; }
          if (st.ex && Math.abs(st.e) < LIM * 0.55) st.ex = false;
          if (st.e < -LH) { st.mode = 'dead'; car.v = 0; car.vel.set(0, 0, 0); s.fx.sparks(car.pos, 50); return car.crash('Let her drop flat and wedged the Mustang between the alley walls', { injury: 0.45, advice: 'Small taps: D lifts, A lowers. Correct as soon as the needle leaves the green, and ease off before it overshoots.' }); }
          if (st.e > LH) { st.mode = 'dead'; st.roll = car.rollOverride; car.v *= 0.3; return car.crash('Tipped past the balance point and put her on her roof', { injury: 0.65, advice: 'Small taps: A lowers, D lifts. Never hold D — she keeps rolling once past the balance point.' }); }
          if (z < AZ1 - 1) { st.mode = 'out'; st.t = 0; s.rate('Balance', clamp(1.15 - (st.sum / st.n) / 0.3), 2.2); s.rate('Alley exit', near(Math.abs(st.e), 0, 0.1, LH), 0.8); car.steerScale = 1; car.throttleLock = null; s.msg('THROUGH!', 'huge good'); s.objective('Drop her down and go'); s.cam.set({ dist: 7, height: 2.3 }); }
        }
        car.rollOverride = st.b * (PHI + st.e); car.body.position.x = st.b * car.k.w / 2;
      } else if (st.mode === 'dead') { if (st.roll != null) { st.roll += dt * 2.6; car.rollOverride = Math.min(Math.PI, st.roll); } }
      else if (st.mode === 'out') { st.t += dt; const k = clamp(1 - st.t / 0.55); car.rollOverride = k > 0 ? k * k * (PHI + st.e) : null; car.body.position.x = k * car.k.w / 2; if (k <= 0 && !st.th) { st.th = true; s.audio.impact(0.7); s.engine.addShake(0.5); s.fx.dust(car.pos, 8, { color: [0.7, 0.7, 0.75] }); } if (z < AZ1 - 62) s.wrap(1.2); }
    });
  },
  bot(s, inp) { const c = s.car, st = s.bal; if (st.mode === 'drive') botDrive(c, inp, c.pos.z > -84 ? (c.pos.z > -58 ? -1.8 : 1.6) : 0.95, 16.3, 0.1); else if (st.mode === 'tilt') { inp.y = 0; inp.x = clamp(-(7 * st.e + 2.6 * st.ed), -1, 1); } else botDrive(c, inp, 0, 22); },
};

// ---------------------------------------------------------------------------------------------
const thelma = {
  id: 'thelma', title: 'Keep Going', film: 'Thelma & Louise', year: 1991, tier: 3, pay: 8500, mode: 'drive', art: 'bd_canyon', music: 'western',
  role: 'Driving the ’66 Thunderbird at the rim — and getting out of it',
  brief: 'Every cop in Arizona is behind you and the canyon is in front. Flat out for the edge. The car goes over. You do not — you bail at the last possible second. The later you leave it, the better my shot.',
  tips: ['Flat out: I want <b>70 mph or more</b> when you leave the car.', 'Press <b>E to bail out</b>. The closer to the rim, the bigger the pay.', 'You will tumble a good <b>15–20 metres</b> after you jump. Leave yourself room — or you follow the car.'],
  controls: `${K('W')} gas &nbsp; ${K('A')}${K('D')} steer &nbsp; ${K('E')} bail out`, intro: { r: 10, h: 2.4 },
  assets: { models: ['thunderbird', 'police_car', 'ch_stunt', 'saguaro', 'rock_desert'], tex: ['bd_canyon', 'tx_sand', 'tx_redrock'] },
  build(s) {
    s.env('desert', { backdrop: 'bd_canyon', look: 'golden', fog: 0.0011, hz: 0.47 });
    const RIM = -600, slideOf = v => 0.42 * v + 2;
    const fn = (x, z) => (z > RIM ? Math.sin(x * 0.05 + z * 0.021) * 0.18 * smooth(6, 30, Math.abs(x)) : 0) - 170 * smooth(RIM, RIM - 16, z) + 150 * smooth(RIM - 330, RIM - 420, z);
    s.terrain({ x0: -520, x1: 520, z0: 150, z1: -1150, res: 8, fn, mat: s.mat({ tex: 'tx_sand', color: 0xe8b890 }), tile: 12 }); s.course.kill = -400;
    const rock = s.mat({ tex: 'tx_redrock', color: 0xe0b090 });
    for (let x = -500; x <= 500; x += 40) s.box({ x, y: -170, z: RIM - 9 - (Math.abs(x * 7) % 5), w: 41, h: 169.6, d: 14, mat: rock, tile: 30, cast: false }); // cliff face
    for (const [x, z, w, h, d] of [[-290, -330, 90, 46, 120], [300, -400, 110, 58, 100], [-330, -40, 80, 34, 80], [360, -90, 100, 50, 130]]) { s.box({ x, y: -1, z, w, h, d, mat: rock, tile: 26 }); s.box({ x: x + 4, y: h - 1, z: z - 3, w: w * 0.6, h: h * 0.22, d: d * 0.6, mat: rock, tile: 26 }); }
    s.forest('saguaro', 70, r => { const x = (r() < 0.5 ? -1 : 1) * (11 + r() * 110); return [x, 130 - r() * 710]; }, { h: [3, 6.5], seedv: 4 }); s.forest('rock_desert', 60, r => { const x = (r() < 0.5 ? -1 : 1) * (10 + r() * 140); return [x, 130 - r() * 720]; }, { h: [0.8, 2.6], seedv: 12 }); trees(s, 'tree:bush', 40, 130, RIM + 4, 7, 90, { h: [0.7, 1.5], seedv: 7 });
    for (const [x, z] of [[4.6, -110], [-4.8, -205], [4.4, -300], [-4.6, -385], [5.5, -455], [-4.4, -535]]) s.put('rock_desert', { x, z, height: 1.9, ry: z, solid: true, hitScale: 0.6, sol: { msg: 'Hit a boulder flat out', advice: 'The boulders sit 4–5 m either side of the track — keep the Thunderbird dead centre and steer only with small taps.' } });
    for (let d = 100; d <= 400; d += 100) for (const sx of [-1, 1]) { s.box({ x: sx * 8, y: 0, z: RIM + d, w: 0.1, h: 1.3, d: 0.1, mat: s.mat({ color: 0xffffff }) }); s.box({ x: sx * 8, y: 1.3, z: RIM + d, w: 0.5, h: 0.5, d: 0.06, mat: s.mat({ color: d === 100 ? 0xff3020 : 0xffb020, emissive: d === 100 ? 0xff3020 : 0xffb020, emI: 0.6 }) }); }
    s.crew({ x: 7.5, z: 28, ry: 1.0 }); s.crew({ x: 14, z: RIM + 12, ry: 2.2, people: false }); s.crew({ x: -13, z: RIM + 40, ry: -2.4, people: false });
    const car = s.car = new Drive(s, { kind: 'muscle', model: 'thunderbird', driver: 'ch_stunt', driverPos: [-0.42, -0.3, 0.2], x: 0, z: 40, top: 45, hard: 99, pitchTol: 9, rollTol: 9 }); car.dustColor = [0.85, 0.66, 0.48]; car.k.dusty = true;
    const dummy = s.char('ch_stunt', { parent: car.body }); dummy.root.position.set(0.42, -0.3, 0.2); dummy.setPose('drive', 0);
    const mv = new Movers(s, car); for (let i = 0; i < 7; i++) mv.add({ model: 'police_car', x: (i - 3) * 5.2, z: 78 + Math.abs(i - 3) * 5 + (i % 2) * 3, v: 0, solid: false, nearMiss: false, avoidPlayer: true, swerve: 3, ai: (e, dt) => { if (!s.started) return; const want = e.z < RIM + 85 + (i % 3) * 9 ? 0 : Math.max(9, car.v * 0.9); e.v += (want - e.v) * Math.min(1, dt * (want ? 1.2 : 2.2)); if (e.v > 6 && Math.random() < 0.25) s.fx.dust(e.m.position, 1, { color: car.dustColor, size: 2.6, a: 0.3 }); } });
    let bailed = false, perf = null, pv = 0, dec = 0, doomed = false, bt = 0, stopped = false, froze = false, margin = 0, overT = 0, bv = 0; s.rate('Clean run', 1, 0.6); car.onHit = () => { if (bailed) return true; dock(s, 'Clean run', 0.3); }; idleGuard(s, car); car.cineOff = true;
    car.onFall = () => true; car.onLand = () => { if (car.pos.y < -50) { s.fx.explosion(car.pos, 2.5); s.audio.explosion(0.7); car.frozen = true; } return true; };
    // the car sails off the rim: scripted payoff, so the camera cuts live to the film's angle behind the car
    car.onAir = () => {
      if (car.pos.z > RIM + 2 || overT) return; overT = s.t; const pts = [], p = car.pos.clone(), v = car.vel.clone(); let vy = car.vy; for (let t = 0; t <= 4; t += 0.1) { pts.push({ t: s.t + t, p: p.clone() }); p.addScaledVector(v, 0.1); vy -= 9.8 * 0.1; p.y += vy * 0.1; }
      s.moment('over the rim', { t0: s.t - 1.6, dur: 4.2, w: 3, subject: car.obj, shots: [{ type: 'wide', pos: [-26, -8, RIM - 34], fov: 34, lookUp: 0.3, speed: 0.45, a: 0.32, b: 1.0 }, { type: 'rear', speed: 0.5, a: -0.1, b: 0.8 }, { type: 'wide', speed: 0.6 }] }); // signature: from out over the canyon, the T-bird launching into the sunset; then the chase car's view
      if (bailed) { const back = s.cut(pts, 'rear', { subject: car.obj }); s.after(1.3, () => { if (!s.ended) back(); }); }
    };
    s.objective('Flat out for the rim — E to bail');
    s.onUpdate((dt, t) => {
      if (!s.started) return; const d = car.pos.z - RIM, inp = s.input;
      if (!s.ended) { s.hud.readout('spd', 'MPH', Math.round(car.mph), car.mph >= 70 ? 'ok' : ''); if (!bailed) { s.hud.readout('rim', 'Rim (m)', Math.max(0, Math.round(d)), d < 60 ? 'warn' : ''); s.hud.prompt(d < 130 ? `${K('E')} BAIL OUT` : ''); } }
      if (!bailed && !s.ended) {
        if (d < -1.5) { s.hud.prompt(''); return s.fail('Never bailed out — you went into the canyon with the car', { injury: 1, advice: 'Press E before the rim! You tumble about 15 m at 70 mph — bail when the RIM readout shows about 20 m.' }); }
        if (inp.hit('x') && car.grounded) {
          bailed = true; s.hud.prompt(''); const v = bv = Math.abs(car.v); let slide = slideOf(v); margin = d - slide; doomed = margin < -4;
          // a few metres too late: you fetch up right on the lip — a scare and a flub, not a fall
          if (!doomed && margin < 0) { slide = Math.max(1, d - 0.6); margin = 0.6; s.flub('Slid right to the lip of the canyon', { penalty: 0.25, advice: `Bail a beat earlier: at ${Math.round(v * MPH)} mph you tumble about ${Math.round(slideOf(v))} m — press E with the RIM readout just above that.` }); }
          pv = v * 0.8; dec = pv * pv / (2 * slide); car.control = false; car.throttleLock = 1; car.driver.root.visible = false;
          perf = s.char('ch_stunt', { x: car.pos.x - 1.7, y: car.pos.y, z: car.pos.z, heading: 0 }); perf.setCycle('flail', 2.2); perf.tumble(-10, 0, 3);
          s.cam.follow(() => ({ pos: perf.root.position, heading: 0.55 }), { dist: 9.5, height: 2.6, ahead: 9, up: 1, stiff: 4, fov: 58, snap: false }); s.audio.whoosh(); s.msg('BAIL!', 'good'); s.objective(''); s.moment('the bail', { t0: s.t - 1.0, dur: 3.2, w: 2, subject: perf.root, shots: ['track', 'low'] });
          s.rate(`Speed at the bail (${Math.round(v * MPH)} mph)`, near(v * MPH, 88, 14, 46), 1.2); if (!doomed) s.rate(`Nerve (stopped ${Math.max(0, margin).toFixed(0)} m from the rim)`, near(margin, 0, 7, 75), 2.2);
        }
      }
      if (perf && !stopped) {
        const p = perf.root.position; bt += dt; pv = Math.max(0, pv - dec * dt); p.z -= pv * dt; const over = p.z < RIM - 0.5;
        if (over) { p.y -= (8 + bt * 6) * dt; if (!s.ended) s.fail('Bailed too late — you tumbled over the rim after the car', { injury: 1, advice: `You need room to stop: at ${Math.round(bv * MPH)} mph you tumble about ${Math.round(slideOf(bv))} m. Press E when RIM shows a few metres more than that.` }); }
        else { p.y = Math.abs(Math.sin(bt * 7)) * 0.5 * clamp(pv / 12) + 0.1; if (Math.random() < 0.7) s.fx.dust(p, 2, { color: car.dustColor, size: 2.2, spread: 1 }); if (Math.floor(bt * 2.3) !== perf._h) { perf._h = Math.floor(bt * 2.3); s.audio.thud(); s.engine.addShake(0.25); } }
        if (pv <= 0.05 && !over) { stopped = true; perf.tumble(0, 0, 0); perf.spinAng?.set(0, 0, 0); perf.setPose('lie', 0.2); p.y = 0; }
      }
      if (bailed && !doomed && !froze && !s.ended && ((car.pos.y < -9 && (stopped || bt > 2.2)) || bt > 11)) { froze = true; s.engine.flash(1.4); s.slowmo(0.04, 6); s.audio.whoosh(); s.msg('FREEZE FRAME', 'huge good'); s.wrap(0.12, 'They just kept going.'); }
    });
  },
  bot(s, inp, B) { const c = s.car; botDrive(c, inp, 0, 99, 0.06); const d = c.pos.z + 600; if (!B.b && d < 0.42 * c.v + 2 + 5.5) { B.b = 1; inp.press('x'); } },
};

// ---------------------------------------------------------------------------------------------
const G_X = [-6.75, -2.25, 2.25, 6.75], G_P = [1, 2, 1, 0, 1, 2, 3, 2, 1], G_S0 = -70, G_SEG = 58;
const gLane = (z, look = 0) => { const u = (G_S0 - (z - look)) / G_SEG, k = clamp(Math.floor(u), 0, 7), f = u - k; return u < 0 ? G_P[0] : u >= 8 ? G_P[8] : (f > 0.5 ? G_P[k + 1] : G_P[k]); };
const gone60 = {
  id: 'gone60', title: 'The Last Car', film: 'Gone in 60 Seconds', year: 2000, tier: 3, pay: 9000, mode: 'drive', art: 'bd_la', music: 'chase',
  role: 'Driving Eleanor — ’67 Shelby GT500, and the bridge is shut',
  brief: 'The whole bridge is gridlocked and the police are right behind you. Thread the gaps, find the flatbed with its ramps down, and put a ’67 Mustang over an accident scene. Do not scratch her.',
  tips: ['Follow the <b>open lane</b> through the gridlock — it switches sides, so look far ahead.', 'After the last gap it is a straight shot to the flatbed. Hit it at <b>65 mph+</b>.', 'Hold <b>W in the air</b> to keep the nose up, and land in the clear lane.'],
  controls: CTL.drive, intro: { r: 10, h: 2.6 },
  assets: { models: ['eleanor', 'police_car', 'van_white', ...TRAFFIC], tex: ['bd_la', 'tx_asphalt', 'tx_concrete', 'tx_metal'] },
  build(s) {
    // Vincent Thomas Bridge, San Pedro: late golden light over the Port of LA, sun low behind the driver's left shoulder, harbour haze
    s.env('golden', { backdrop: 'bd_la', look: 'teal_orange', fog: 0.0019, hz: 0.5, sun: [15, -50], sunI: 3.6, fogMix: 0.55, lookOver: { contrast: 1.14, sat: 1.12, bloom: 0.45 } });
    s.course.base = () => -50; s.water({ y: -50, color: 0x2c4c58 }); s.course.kill = -90;
    const T1 = -150, T2 = -720, RZ0 = -598, RZ1 = -618, RX = G_X[1], RH = 2.4;
    s.deck({ x: 0, w: 20, z0: 140, z1: -1010, y: 0, thick: 1.6, mat: { tex: 'tx_concrete', color: 0x9a9a94 } }); s.road({ z0: 140, z1: -1010, width: 18, lanes: 4, y: 0.03, double: true });
    const steel = s.mat({ tex: 'tx_metal', color: 0x3f8a68, metal: 0.4, rough: 0.6 });
    for (const sx of [-1, 1]) { s.box({ x: sx * 9.5, y: 0, z: -435, w: 0.4, h: 1.1, d: 1150, mat: steel, tile: 4, solid: true, cast: false, sol: { msg: 'Put Eleanor into the bridge rail', hardK: 2.5, advice: 'Keep off the rails — when the open lane switches sides, start the move 30 m early so you are straight before the gap.' } }); s.box({ x: sx * 10.6, y: -3.6, z: -435, w: 1.2, h: 2.2, d: 1150, mat: steel, tile: 6, cast: false }); }
    // towers, main cables, hangers
    const cab = (x, zA, yA, zB, yB, w = 0.5) => { const L = Math.hypot(zA - zB, yA - yB); s.box({ x, y: (yA + yB) / 2 - w / 2, z: (zA + zB) / 2, w, h: w, d: L, mat: steel, tile: 8, rx: Math.atan2(yB - yA, zA - zB), cast: false }); };
    for (const tz of [T1, T2]) { for (const sx of [-1, 1]) { s.box({ x: sx * 11.2, y: -50, z: tz, w: 2.4, h: 118, d: 3.4, mat: steel, tile: 8 }); for (let y = 6; y < 66; y += 12) { s.box({ x: sx * 11.2, y, z: tz, w: 2.6, h: 0.5, d: 3.6, mat: steel, cast: false }); } } for (const y of [22, 44, 64]) { s.box({ x: 0, y, z: tz, w: 22, h: 2.6, d: 2.4, mat: steel, tile: 8 }); cab(0, tz, y - 9, tz, y, 0.01); } for (const [ya, yb] of [[24.6, 44], [46.6, 64]]) for (const d of [-1, 1]) s.box({ x: 0, y: (ya + yb) / 2 - 0.3, z: tz, w: 24, h: 0.6, d: 0.6, mat: steel, rz: d * Math.atan2(yb - ya, 20), cast: false }); }
    const mid = (T1 + T2) / 2, half = (T1 - T2) / 2, cyc = z => 8 + 59 * Math.pow((z - mid) / half, 2), NS = 20, hang = [];
    for (const sx of [-1, 1]) { for (let i = 0; i < NS; i++) { const za = T1 - (T1 - T2) * i / NS, zb = T1 - (T1 - T2) * (i + 1) / NS; cab(sx * 10.9, za, cyc(za), zb, cyc(zb)); if (i) hang.push([sx * 10.9, za, cyc(za)]); } cab(sx * 10.9, 150, 1, T1, 67); cab(sx * 10.9, T2, 67, -1010, 1); for (let z = T1 + 30; z < 140; z += 30) hang.push([sx * 10.9, z, 67 - (z - T1) * 66 / 300]); for (let z = T2 - 30; z > -1000; z -= 30) hang.push([sx * 10.9, z, 67 - (T2 - z) * 66 / 290]); }
    for (const [x, z, y] of hang) s.box({ x, y: 0, z, w: 0.14, h: y, d: 0.14, mat: steel, cast: false });
    // gridlock
    srand(9); s.rate('Clean slalom', 1, 1.3); const stuck = (x, z, id) => s.put(id || TRAFFIC[Math.floor(sr(TRAFFIC.length))], { x: x + sr(-0.25, 0.25), z: z + sr(-1.2, 1.2), ry: sr(-0.05, 0.05), solid: true, hitScale: 0.88, sol: { msg: 'Ploughed into the gridlock', hardK: 1, advice: 'Look 50 m ahead for the open lane and slow to about 45 mph through the slalom — a glancing scrape is fine, a nose-on hit is not.' } });
    for (let r = 0; r < 38; r++) { const z = G_S0 - 5 - r * 12.4, u = (G_S0 - z) / G_SEG, k = clamp(Math.floor(u), 0, 7), f = u - k, open = [G_P[k]]; if (f > 0.46) open.push(G_P[k + 1]); if (f < 0.12 && k > 0) open.push(G_P[k - 1]); if (u >= 8) { open.length = 0; open.push(G_P[8]); }
      for (let L = 0; L < 4; L++) { if (open.includes(L)) continue; const adj = open.some(o => Math.abs(o - L) === 1); if (sr() < (adj ? 0.9 : 0.4)) stuck(G_X[L], z); } }
    for (const z of [26, 12, -6, -24, -44, -60]) for (const L of [0, 2, 3]) if (sr() < 0.5) stuck(G_X[L], z); for (const z of [58, 70]) for (let L = 0; L < 4; L++) if (sr() < 0.6 && L !== 1) stuck(G_X[L], z); // lane 2 stays open behind you: the police come down it
    for (let z = -548; z > -596; z -= 12.4) for (const L of [0, 2, 3]) if (sr() < 0.6) stuck(G_X[L], z); for (let z = -690; z > -860; z -= 12.4) for (const L of [0, 2, 3]) if (sr() < 0.55) stuck(G_X[L], z);
    // flatbed with its ramps down
    const yel = s.mat({ color: 0xd8a818, rough: 0.5, metal: 0.3 }), dark = s.mat({ color: 0x1c1c1e, rough: 0.7 });
    s.slope({ x: RX, w: 3.3, z0: RZ0, z1: RZ1, y0: 0, y1: RH, curve: 1.45, thick: 0.22, mat: s.mat({ tex: 'tx_metal', color: 0x8a8d90, metal: 0.6, rough: 0.5 }) });
    s.box({ x: RX, y: 0, z: RZ1 - 1.2, w: 2.5, h: 2.15, d: 2.3, mat: yel }); s.box({ x: RX, y: 1.25, z: RZ1 - 2.36, w: 2.2, h: 0.75, d: 0.05, mat: dark, cast: false }); s.box({ x: RX, y: 0.55, z: RZ1 + 5, w: 2.2, h: 0.5, d: 11, mat: dark });
    for (const z of [RZ1 - 1.2, RZ1 + 3.5, RZ1 + 5.2]) for (const sx of [-1, 1]) s.box({ x: RX + sx * 1.2, y: 0, z, w: 0.4, h: 1.0, d: 1.0, mat: dark, cast: false });
    s.box({ x: RX, y: 2.15, z: RZ1 - 1.2, w: 1.3, h: 0.16, d: 0.3, mat: s.mat({ color: 0xffa000, emissive: 0xffa000, emI: 3 }), cast: false }); s.line({ x: RX, z: RZ0 + 0.6, w: 3.3, d: 0.6, color: 0xffe14a });
    // the accident
    const wreck = (m, x, z, ry) => s.put(m, { x, z, ry, solid: true, sol: { msg: 'Came down in the middle of the accident scene', hardK: 0.3, advice: 'Hit the flatbed square and fast — 65+ mph, wheels straight — and hold W in the air so she carries over the wreck.' } });
    wreck('police_car', -6.2, -628, 1.2); wreck('van_white', -1.6, -634, 0.25); wreck('police_car', 3.2, -630, -1.1); wreck('sedan_grey', 6.6, -640, 2.4); wreck('wagon_brown', 1.6, -645, 1.4); wreck('police_car', -5.6, -648, -0.5);
    const fl = s.mat({ color: 0xff3010, emissive: 0xff3010, emI: 4 }); for (const [x, z] of [[-3, -623], [0, -624], [4.5, -623.5], [-7, -655], [2, -655], [6, -654]]) s.box({ x, y: 0, z, w: 0.08, h: 0.25, d: 0.08, mat: fl, cast: false });
    s.box({ x: -1.6, y: 2.05, z: -634, w: 1.2, h: 0.15, d: 0.3, mat: s.mat({ color: 0xff2020, emissive: 0xff2020, emI: 3 }), cast: false });
    const zone = s.line({ x: RX, z: -672, w: 4.2, d: 26, color: 0x30ff70, glow: 0.9 }); zone.material.opacity = 0.22;
    // the Port of LA on both banks of the main channel: quays, container stacks, gantry cranes, moored ships
    harbour(s, { y: -44, zEdge: 60, dir: 1, seed: 3 }); harbour(s, { y: -44, zEdge: -880, dir: -1, seed: 4 });
    s.crew({ x: 2.3, z: 30, ry: 0.5 }); s.crew({ x: 7, z: -606, ry: 1.2, people: false });
    const car = s.car = new Drive(s, { kind: 'muscle', model: 'eleanor', x: G_X[G_P[0]], z: 40, hard: 12, pitchTol: 0.6, grip: 6.2, steer: 2.3 });
    const mv = new Movers(s, car); for (let i = 0; i < 2; i++) mv.add({ model: 'police_car', x: G_X[1] + (i ? 0.4 : -0.3), z: 58 + i * 8, v: 0, solid: false, nearMiss: false, avoidPlayer: true, ai: (e, dt) => { if (!s.started) return; const want = e.z < G_S0 + 40 + i * 9 ? 0 : Math.max(5, car.v * 0.8); e.v += (want - e.v) * Math.min(1, dt * 2); } });
    let jumped = false, landed = false, tS = 0, missed = false; car.onHit = () => dock(s, 'Clean slalom', 0.22); s.objective('Thread the gridlock'); idleGuard(s, car);
    car.onAir = t => { if (t.z < RZ1 + 4 && !jumped) { jumped = true; s.rate(`Take-off speed (${Math.round(car.mph)} mph)`, near(car.mph, 72, 7, 20), 1.3); s.slowmo(0.35, 2.0); s.msg(Math.round(car.mph) + ' MPH', 'good'); } };
    car.onLand = i => { if (jumped && !landed && i.airTime > 0.6) { landed = true; s.rate('Landing', i.clean, 1.5); s.bonus('Air: ' + ftOf(i.dist) + ' ft', Math.round(i.dist * 10)); s.msg(ftOf(i.dist) + ' FEET!', 'huge good'); s.objective('Gone.'); headline(s, 3); } };
    s.onUpdate(dt => {
      if (!s.started || s.ended) return; const z = car.pos.z; s.hud.readout('spd', 'MPH', Math.round(car.mph), z < -540 && !jumped ? (car.mph >= 65 ? 'ok' : 'warn') : '');
      if (!tS && z < -540) { tS = s.t - s.t0; s.rate(`Slalom pace (${tS.toFixed(1)}s)`, near(tS, 26, 5, 16), 1); s.objective('Flat out — hit the flatbed at 65+'); s.msg('RAMP AHEAD', 'small'); }
      // missing the flatbed is a flub: stand on the brakes short of the accident and we cheat the jump in the edit
      if (!jumped && !missed && z < RZ0 - 5 && car.grounded && car.pos.y < 0.15) { missed = true; car.ai = () => ({ thr: 0, brk: 1, steer: 0 }); s.audio.set('skid2', 'skid', 0.3, 0.3); s.flub('Missed the flatbed', { penalty: 0.35, advice: 'After the last gap, steer into lane 2 (left of centre) at once and line up on the yellow mark at the foot of the ramps.' }); s.rate('Take-off speed (no jump)', 0, 1.3); s.rate('Landing', 0, 1.5); s.objective('Stop short of the accident'); }
      if (missed) { const k = Math.max(0, car.v - 14 * dt) / Math.max(0.01, car.v); car.v *= k; car.vel.multiplyScalar(k); if (car.v < 0.6) { s.audio.set('skid2', 'skid', 0.3, 0); s.wrap(1.2, 'No jump — we will have to cheat it in the edit.'); } return; }
      if (!jumped) s.hud.readout('rmp', 'Flatbed (m)', Math.max(0, Math.round(z - RZ0)));
      if (landed && z < -790) s.wrap(1.2);
    });
  },
  bot(s, inp) { const c = s.car, z = c.pos.z; if (z > -540) botDrive(c, inp, G_X[gLane(z, 7)], z > G_S0 ? 17 : 20.5, 0.12); else botDrive(c, inp, G_X[1], 99, 0.1); if (!c.grounded) { inp.x = 0; inp.y = c.pitch < 0.03 ? 1 : 0; } },
};

// ---------------------------------------------------------------------------------------------
const MX_L = [-7.4, -3.7, 0, 3.7, 7.4];
const matrix = {
  id: 'matrix_freeway', title: 'Wrong Way', film: 'The Matrix Reloaded', year: 2003, tier: 4, pay: 13000, mode: 'drive', art: 'bd_la', music: 'synth',
  role: 'Doubling Trinity — Ducati 996, against five lanes of freeway traffic',
  brief: 'You go up the off-ramp and ride straight into the traffic. Five lanes, all of it coming at you, and the Agents right behind. Brush a wing mirror and we keep rolling — meet one of them nose to nose and you are done.',
  tips: ['<b>A head-on is fatal</b>; a glancing clip costs you. Ride the white lines between lanes — but trucks leave you no room.', 'Watch for cars <b>changing lanes</b>. Look far up the road, not at your front wheel.', 'Stay above <b>60 mph</b> or the Agents catch you. Close passes pay a bonus.'],
  controls: BIKE_CTL, intro: { r: 7, h: 2.1 },
  assets: { models: ['ducati', 'ch_coat', 'semi_truck', 'van_white', 'charger_black', ...TRAFFIC], tex: ['bd_la', 'tx_asphalt', 'tx_concrete', 'tx_fac_office', 'tx_glass_tower', 'tx_roof'] },
  build(s) {
    // the purpose-built Alameda freeway: flat grey Bay Area overcast with a weak sun, everything pushed toward the film's green
    s.env('overcast', { backdrop: 'bd_la', look: 'matrix', fog: 0.0028, hz: 0.47, sun: [36, 25], sunI: 2.1, amb: 1.0, fogColor: 0xa8b4a8, lookOver: { contrast: 1.2, sat: 0.7, vignette: 0.5 } });
    s.ground({ tex: 'tx_asphalt', tile: 12, color: 0x7a807a }); const ZE = -1450, conc = { tex: 'tx_concrete', color: 0xaab0aa };
    s.road({ z0: 120, z1: ZE - 250, width: 19, lanes: 5 });
    for (const sx of [-1, 1]) { s.box({ x: sx * 10, y: 0, z: -760, w: 0.5, h: 0.95, d: 1800, mat: conc, solid: true, cast: false, sol: { msg: 'Hit the barrier', hardK: 1.6, advice: 'Stay off the concrete barriers — use the inner three lanes and only go wide to pass a truck.' } }); s.box({ x: sx * 15, y: 0, z: -760, w: 0.5, h: 4.5, d: 1800, mat: conc, tile: 7, cast: false }); s.row({ side: sx, x: sx * 24, z0: 120, z1: ZE - 250, fac: ['tx_fac_office', 'tx_glass_tower'], height: [12, 44], width: [22, 40], depth: [16, 24], solid: false, seedv: 14, gap: 30 }); }
    for (let z = -110, i = 0; z > ZE - 200; z -= 265, i++) { s.box({ x: 0, y: 6.3, z, w: 70, h: 1.5, d: 13, mat: conc, tile: 8 }); for (const sx of [-1, 1]) s.box({ x: sx * 12.5, y: 0, z, w: 1.6, h: 6.3, d: 9, mat: conc, cast: false }); sign(s, ['WRONG WAY', 'EXIT 12  ·  DOWNTOWN', '101  NORTH', 'EXIT 14  ·  PASEO', 'WRONG WAY', '110  SOUTH'][i % 6], { x: i % 2 ? 4 : -4, y: 5.4, z: z + 6.6, w: 8.5, bg: i % 4 === 0 ? '#b01818' : '#0a5d2a', size: 50 }); }
    // freeway light standards on the shoulders (arm over the outer lane) and a chain-link fence on the sound walls
    const LS = [], ARM = []; for (let z = 60; z > ZE - 240; z -= 48) for (const sx of [-1, 1]) { LS.push([sx * 12.4, 0, z + sx * 24, 0.32, 11.5, 0.32]); ARM.push([sx * 11.0, 11.2, z + sx * 24, 3.2, 0.2, 0.25]); ARM.push([sx * 9.5, 10.95, z + sx * 24, 0.9, 0.22, 0.45]); }
    boxes(s, LS, [0x8a908a], { metal: 0.5, rough: 0.5, cast: true }); boxes(s, ARM, [0x8a908a], { metal: 0.5, rough: 0.5 });
    for (const sx of [-1, 1]) dress.fence(s, { path: [[sx * 15, 120], [sx * 15, ZE - 250]], kind: 'wire', h: 2.2, gap: 3.2, color: 0x6a706a });
    s.crew({ x: 6, z: 20, ry: 0.9 });
    const b = s.car = new Drive(s, { kind: 'bike', model: 'ducati', driver: 'ch_coat', driverPos: [0, -0.5, 0.26], driverPose: 'bikeSport', x: 1.85, z: 34, w: 0.6, top: 47, accel: 15, steer: 2.5, cam: { dist: 5.6, height: 2.0 } });
    b.k.len = 1.2; // slim hit box: lane-splitting has to be possible
    const mv = s.mv = new Movers(s, b); mv.nearPay = 70; srand(11);
    for (let i = 0; i < 20; i++) {
      const li = (i * 2 + (i > 11 ? 1 : 0)) % 5, x0 = MX_L[li], id = i % 6 === 0 ? 'semi_truck' : i % 6 === 3 ? 'van_white' : TRAFFIC[Math.floor(sr(TRAFFIC.length))], weave = i % 5 === 2, xb = MX_L[li === 4 ? 3 : li + 1], ph = sr(6.28);
      const e = mv.add({ model: id, x: x0, path: weave ? z => lerp(x0, xb, smooth(0.25, 0.75, 0.5 + 0.5 * Math.sin(z * 0.011 + ph))) : undefined, z: -150 - i * 27 - sr(10), v: -sr(17, 25), recycle: [35, 290, 620], zEnd: ZE - 120, msg: 'Head-on with the freeway traffic', hardK: 0.45, xmin: -8, xmax: 8 }); e.sol.advice = 'Look far up the road, not at your front wheel: pick the white line with the most room 2 seconds ahead and move early. Trucks need a whole lane.';
    }
    // the Agents' Charger drives for real (speed-controlled to its slot behind you) so Movers steering threads it through the oncoming traffic
    const ag = { m: 0, warned: false }; mv.add({ model: 'charger_black', x: 0, z: 110, v: 0, solid: false, nearMiss: false, swerve: 8, xmin: -8, xmax: 8, path: (z, e) => e?.cx ?? 0, ai: (e, dt) => { if (!s.started) return; e.cx = damp(e.cx ?? 0, b.pos.x * 0.7, 2, dt); const slot = b.pos.z + 76 - 66 * ag.m; e.v = Math.max(0, b.v + clamp((e.z - slot) * 0.8, -12, 14)); if (e.z - b.pos.z > 220) e.z = b.pos.z + 200; } });
    let sum = 0, n = 0, clips = 0; s.rate('Barrier-free', 1, 0.6); idleGuard(s, b, { warn: 5, stop: 15 });
    b.onHit = (sol, imp) => { if (sol.mover) { if (imp > b.k.crashV * 1.3 * 0.45) return; if (imp > 0.8) { clips++; ag.m = clamp(ag.m + 0.12); s.flub('Clipped a car', { penalty: 0.12, advice: 'Give the traffic half a metre more: ride the exact middle of the white line and move over before the car is alongside.' }); } return; } dock(s, 'Barrier-free', 0.34); }; s.objective('Ride against the traffic — stay above 60');
    let lastNear = 0; const nearT = [];
    s.onUpdate(dt => {
      if (!s.started || s.ended) return; const tt = s.t - s.t0, m = b.mph;
      if (tt > 6) { ag.m = clamp(ag.m + (m < 60 ? 0.2 : -0.16) * dt); sum += m * dt; n += dt; }
      if (ag.m > 0.65 && !ag.warned) { ag.warned = true; s.flub('The Agents are closing in', { penalty: 0.1, advice: 'Keep the MPH above 60 — the AGENTS meter only fills while you are slower. Thread gaps instead of braking.' }); } if (ag.m < 0.3) ag.warned = false;
      // close passes in quick succession are the money shot: mark them for the replay
      if (b.stats.near !== lastNear) { lastNear = b.stats.near; nearT.push(s.t); while (nearT.length && s.t - nearT[0] > 2.5) nearT.shift(); const lx = [-5.55, -1.85, 1.85, 5.55].reduce((a, x) => Math.abs(x - b.pos.x) < Math.abs(a - b.pos.x) ? x : a); s.moment('threading the traffic', { t0: s.t - 1.8, dur: 3, w: nearT.length > 1 ? 1.4 + nearT.length * 0.5 : 0.9, shots: [{ type: 'front', pos: [lx, 0.75, b.pos.z - 62], fov: 11, lookUp: 0.5, speed: 0.5, a: 0.3, b: 1.0 }, 'track', 'chase'] }); } // signature: a camera planted on the lane line 60 m ahead, long lens, Trinity coming at it through the traffic
      s.hud.readout('spd', 'MPH', Math.round(m), tt > 6 ? (m < 60 ? 'warn' : 'ok') : ''); s.hud.readout('dst', 'To go (m)', Math.max(0, Math.round(b.pos.z - ZE))); s.hud.readout('nm', 'Near misses', b.stats.near);
      s.hud.meter('ag', 'AGENTS', ag.m, { color: ag.m > 0.6 ? '#ff4030' : '#40ff80' });
      if (ag.m >= 1) return s.fail('Dropped below 60 mph for too long — the Agents ran you off the road', { injury: 0.35, advice: 'Never sit under 60 mph for more than a few seconds — when the AGENTS meter turns red, open the throttle and pick the widest gap.' });
      if (b.pos.z < ZE) { s.rate(`Speed (avg ${Math.round(sum / n)} mph)`, clamp((sum / n - 62) / 18), 1.5); s.rate(`Nerve (${b.stats.near} close passes)`, clamp(b.stats.near / 10), 1.2); s.rate(clips ? `Untouched (${clips} clip${clips > 1 ? 's' : ''})` : 'Untouched', clamp(1 - clips * 0.25), 1.5); s.wrap(1.2); }
    });
  },
  bot(s, inp, B) {
    const c = s.car, xs = [-8.3, -7.4, -6.5, -5.55, -4.6, -3.7, -2.8, -1.85, -0.9, 0, 0.9, 1.85, 2.8, 3.7, 4.6, 5.55, 6.5, 7.4, 8.3]; let best = B.tx ?? 1.85, bs = -1e9;
    for (const x of xs) {
      if (Math.abs(x - c.pos.x) > 6) continue; let cn = 2, cf = 2;
      for (const e of s.mv.list) { if (!e.alive || !e.sol) continue; const dz = c.pos.z - e.z, tm = dz / Math.max(20, c.v - e.v); if (dz < -6 || tm > 2.3) continue; const r = 9 * Math.max(0, tm - 0.1), bx = c.pos.x + clamp(x - c.pos.x, -r, r), cl = Math.abs(bx - (e.m.position.x + (e.sol.vx || 0) * Math.min(tm, 1.5))) - e.hw - 0.55; if (tm < 1) cn = Math.min(cn, cl); else cf = Math.min(cf, cl); }
      const sc = Math.min(cn, 1.2) * 3 + Math.min(cf, 0.8) - Math.abs(x - c.pos.x) * 0.2 + (x === B.tx ? 0.3 : 0) - (cn < 0 ? 5 : 0); if (sc > bs) { bs = sc; best = x; }
    }
    B.tx = best; s.dbgTx = best + '/' + bs.toFixed(2); botDrive(c, inp, best, bs < 0.6 ? 30 : 38.5, 0.09);
  },
};

// ---------------------------------------------------------------------------------------------
const RN_L = [-2.2, -5.9];
const ronin = {
  id: 'ronin', title: 'Contre-Sens', film: 'Ronin', year: 1998, tier: 4, pay: 12500, mode: 'drive', art: 'bd_paris', music: 'chase',
  role: 'Chasing the BMW in a Peugeot 406 — the wrong way through a Paris underpass',
  brief: 'She takes the tunnel against the traffic, so you take the tunnel against the traffic. No tricks, no process shots: real cars, real speed, and their headlamps coming straight at you. Do not lose that BMW.',
  tips: ['Stay within <b>60 metres</b> of the BMW. Lose her and she has to wait for you — the shot suffers.', 'Oncoming cars keep to the two lanes — <b>headlights</b> are your warning. Switch lanes early.', 'The centre pillars are solid concrete. Scrapes on the wall cost speed; a head-on costs everything.'],
  controls: CTL.drive, intro: { r: 9, h: 2.3 },
  assets: { models: ['peugeot406', 'bmw_m5', ...TRAFFIC], tex: ['bd_paris', 'tx_asphalt', 'tx_fac_paris', 'tx_concrete', 'tx_roof'] },
  build(s) {
    s.env('overcast', { backdrop: 'bd_paris', look: 'bleach', fog: 0.002, hz: 0.47 });
    s.ground({ tex: 'tx_asphalt', tile: 10, color: 0x80807c }); const TZ0 = -150, TZ1 = -950, END = -1090, HW = 8.6, CH = 5.6;
    street(s, { z0: 100, z1: TZ0 + 2, width: 17, lanes: 4, fac: ['tx_fac_paris'], height: [17, 23], lamps: 0, double: true }); street(s, { z0: TZ1 - 2, z1: END - 120, width: 17, lanes: 4, fac: ['tx_fac_paris'], height: [17, 23], lamps: 0, double: true, seedv: 21 });
    s.road({ z0: TZ0 + 2, z1: TZ1 - 2, width: 17, lanes: 4, double: true });
    const wall = s.mat({ tex: 'tx_concrete', color: 0x8d8778 }), stone = s.mat({ tex: 'tx_concrete', color: 0xcfc6b0 }), tile = s.mat({ tex: 'tx_concrete', color: 0xb8b29c, rough: 0.5 });
    for (const sx of [-1, 1]) { s.box({ x: sx * (HW + 0.3), y: 0, z: (TZ0 + TZ1) / 2, w: 0.6, h: CH, d: TZ0 - TZ1, mat: tile, tile: 5, solid: true, sol: { msg: 'Buried it in the tunnel wall', hardK: 2.2, advice: 'Keep a car width off the tunnel wall — switch lanes with small steering inputs, not big swerves.' } }); s.box({ x: sx * (HW - 0.02), y: 1.1, z: (TZ0 + TZ1) / 2, w: 0.06, h: 0.25, d: TZ0 - TZ1, mat: s.mat({ color: 0xe8e2d0 }), cast: false }); }
    s.box({ x: 0, y: CH, z: (TZ0 + TZ1) / 2, w: HW * 2 + 1.2, h: 0.7, d: TZ0 - TZ1, mat: wall, tile: 6 });
    for (const pz of [TZ0, TZ1]) { s.box({ x: 0, y: CH, z: pz, w: 90, h: 5.5, d: 2.2, mat: stone, tile: 5 }); for (const sx of [-1, 1]) s.box({ x: sx * (HW + 20.6), y: 0, z: pz, w: 40, h: CH + 5.5, d: 2.2, mat: stone, tile: 5 }); for (let x = -40; x <= 40; x += 4) s.box({ x, y: CH + 5.5, z: pz, w: 0.3, h: 1, d: 0.3, mat: s.mat({ color: 0x2a2a2a }), cast: false }); s.box({ x: 0, y: CH + 6.4, z: pz, w: 84, h: 0.12, d: 0.2, mat: s.mat({ color: 0x2a2a2a }), cast: false }); }
    sign(s, 'TUNNEL  ·  SENS INTERDIT', { x: 0, y: CH + 2.6, z: TZ0 + 1.2, w: 13, bg: '#16308a', size: 46 });
    const pil = [], strip = []; for (let z = TZ0 - 5; z > TZ1 + 4; z -= 10) { pil.push([0, CH / 2, z]); s.course.addSolid({ x0: -0.38, x1: 0.38, y0: 0, y1: CH, z0: z - 0.38, z1: z + 0.38, msg: 'Hit a tunnel pillar head-on', hardK: 0.7, advice: 'The pillars run down the centre line every 10 m — stay left of them in the two wrong-way lanes and never dodge right.' }); }
    for (let z = TZ0 - 8; z > TZ1 + 4; z -= 16) for (const x of [-4.3, 4.3]) strip.push([x, CH - 0.06, z]);
    inst(s, 0.76, CH, 0.76, tile, pil); inst(s, 0.5, 0.1, 5, glow(3.4, 2.4, 1.2), strip); s.box({ x: 0, y: 0, z: (TZ0 + TZ1) / 2, w: 0.9, h: 0.25, d: TZ0 - TZ1 - 8, mat: wall, cast: false });
    const l1 = s.light({ color: 0xffb060, i: 110, dist: 46, bulb: false, y: 4.6 }), l2 = s.light({ color: 0xffb060, i: 110, dist: 46, bulb: false, y: 4.6 });
    s.crew({ x: 6.5, z: 28, ry: 0.9 });
    const car = s.car = new Drive(s, { kind: 'car', model: 'peugeot406', x: -2.2, z: 40, top: 50, accel: 11.5 });
    const mv = s.mv = new Movers(s, car); mv.nearPay = 110; const lamps = (e, front = true) => { const sz = e.m.userData.size || V3(1.8, 1.4, 4.5); for (const sx of [-1, 1]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.16, 0.08), front ? glow(7, 6.4, 4.6) : glow(5, 0.3, 0.2)); b.position.set(sx * sz.x * 0.33, sz.y * 0.47, (front ? -1 : 1) * (sz.z / 2 + 0.02)); e.m.add(b); } };
    // oncoming: evenly staggered so there is always a way through
    const onc = []; let nz = -130; srand(17);
    for (let i = 0; i < 9; i++) { const e = mv.add({ model: TRAFFIC[Math.floor(sr(TRAFFIC.length))], z: nz, v: -13.5, path: (z, e) => e?.lx ?? RN_L[i % 2], msg: 'Head-on in the tunnel', hardK: 0.45, xmin: -7.4, xmax: -1.1, swerve: 3.8,
      ai: e => { if (!e.alive || e.z - car.pos.z < 45) return; let lead = 1e9, ll = null; for (const o of onc) if (o.alive && o.z < lead) { lead = o.z; ll = o; } e.z = lead - rnd(62, 88); e.lx = Math.random() < 0.62 ? RN_L[ll.lx === RN_L[0] ? 1 : 0] : ll.lx; e.near = false; if (e.z < END - 40) { e.alive = false; e.m.visible = false; } } });
      e.lx = RN_L[i % 2]; if (i % 3 === 2) e.lx = RN_L[(i + 1) % 2]; e.sol.advice = 'Watch for headlights 80 m out and switch to the other wrong-way lane early — the BMW shows you which one is clear.'; onc.push(e); lamps(e); nz -= sr(62, 88); }
    for (let i = 0; i < 5; i++) lamps(mv.add({ model: TRAFFIC[(i * 3 + 1) % TRAFFIC.length], x: i % 2 ? 2.2 : 5.9, z: -60 - i * 190, v: 15 + (i % 3), nearMiss: false, recycle: [70, 240, 420], zEnd: END - 40, msg: 'Rear-ended the traffic', hardK: 2, xmin: 1.1, xmax: 7.4 }), false);
    // the BMW threads the oncoming cars for real: lane choice below plus Movers steering (bounded to the wrong-way half)
    const bm = s.rival = mv.add({ model: 'bmw_m5', z: -4, v: 0, nearMiss: false, hardK: 4, xmin: -7.4, xmax: -1.1, swerve: 3.8, msg: 'Rammed the BMW', path: (z, e) => e?.cx ?? -2.2,
      ai: (e, dt) => {
        if (!s.started) return; const gap = car.pos.z - e.z, free = L => { let d = 1e9; for (const o of onc) { if (!o.alive || o.lx !== L) continue; const dz = e.z - o.z; if (dz > -6 && dz < d) d = dz; } return d; };
        e.ln ??= RN_L[0]; const other = e.ln === RN_L[0] ? RN_L[1] : RN_L[0]; if (free(e.ln) < 85 && free(other) > free(e.ln) + 20) e.ln = other; e.cx = damp(e.cx ?? -2.2, e.ln, 3.2, dt);
        const want = car.dead ? 30 : gap > 140 ? 0 : gap > 90 ? 10 : gap > 52 ? 24 : gap > 34 ? 31 : gap < 14 ? 43 : 36.5; e.v += (want - e.v) * Math.min(1, dt * 1.1);
      } }); bm.cx = -2.2; bm.sol.advice = 'Sit 15–35 m behind the BMW — close enough for the shot, far enough to react when she brakes.'; lamps(bm, false);
    const e0 = s.scene.environmentIntensity, h0 = s.hemi.intensity, s0 = s.sun.intensity;
    let close = 0, tot = 0, lost = 0, fin = false, lostF = false, lastNear = 0; const nearT = []; s.rate('Bodywork', 1, 1); car.onHit = () => dock(s, 'Bodywork', 0.15); s.objective('Stay on the BMW'); idleGuard(s, car);
    s.onUpdate(dt => {
      const z = car.pos.z, k = smooth(TZ0 + 12, TZ0 - 30, z) * smooth(TZ1 - 12, TZ1 + 30, z); s.scene.environmentIntensity = lerp(e0, e0 * 0.16, k); s.hemi.intensity = lerp(h0, h0 * 0.2, k); s.sun.intensity = lerp(s0, 0.03, k);
      const lz = clamp(z, TZ1 + 20, TZ0 - 20); l1.position.set(-3.5, 4.6, lz - 4); l2.position.set(-3.5, 4.6, clamp(z - 34, TZ1 + 20, TZ0 - 20)); l1.intensity = l2.intensity = 110 * k;
      if (!s.started || s.ended) return; const gap = z - bm.z; tot += dt; if (gap < 38) close += dt; lost = gap > 60 ? lost + dt : 0;
      s.hud.readout('gap', 'BMW (m)', Math.max(0, Math.round(gap)), gap > 60 ? 'warn' : gap < 38 ? 'ok' : ''); s.hud.readout('spd', 'KM/H', Math.round(car.kmh));
      if (gap > 60 && !lostF) s.hud.prompt(`LOSING HER — ${Math.max(0, 3 - lost).toFixed(1)}`); else s.hud.prompt(lostF && gap > 60 ? 'SHE IS WAITING FOR YOU — CATCH UP' : '');
      // lose her and she pulls over and waits (a flub, not a cut)
      if ((lost > 3 || gap > 110) && !lostF) { lostF = true; s.flub('Lost the BMW', { penalty: 0.2, advice: 'Stay within 60 m of the BMW (BMW readout): keep the throttle in through the gaps and only brake for a head-on.' }); }
      if (lostF && gap < 45) lostF = false;
      if (car.stats.near !== lastNear) { lastNear = car.stats.near; nearT.push(s.t); while (nearT.length && s.t - nearT[0] > 2.5) nearT.shift(); s.moment('headlights', { t0: s.t - 1.8, dur: 3, w: nearT.length > 1 ? 1.4 + nearT.length * 0.5 : 0.95 }); }
      if (z < END && !fin) { fin = true; s.hud.prompt(''); s.rate('On her tail', clamp(close / tot / 0.8), 2); s.rate('Gap at the exit', near(gap, 10, 14, 60), 1); s.wrap(1.3); }
    });
  },
  bot(s, inp, B) {
    const c = s.car, tm = L => { let t = 1e9; for (const e of s.mv.list) { if (!e.alive || !e.sol || e.v >= 0) continue; if (Math.abs(e.m.position.x - L) > 2.6) continue; const dz = c.pos.z - e.z; if (dz > -6) t = Math.min(t, dz / (c.v - e.v + 1)); } return t; };
    B.ln ??= RN_L[0]; const other = B.ln === RN_L[0] ? RN_L[1] : RN_L[0], a = tm(B.ln), b = tm(other); if (a < 2.6 && b > a + 0.9) B.ln = other;
    const gap = c.pos.z - s.rival.z; botDrive(c, inp, B.ln, gap > 24 ? 44 : gap < 13 ? 30 : 36, 0.13);
  },
};

// ---------------------------------------------------------------------------------------------
const tcx = z => 16 * smooth(-240, -315, z) - 16 * smooth(-560, -635, z);
const tank = {
  id: 'goldeneye_tank', title: 'Heavy Traffic', film: 'GoldenEye', year: 1995, tier: 4, pay: 14000, mode: 'drive', art: 'bd_stpetersburg', music: 'spy',
  role: 'Doubling 007 — thirty-six tons of T-55 through St Petersburg',
  brief: 'The General has the girl in that grey saloon and you have a tank. Stay with him. Walls, cars, statues — go through all of it, the insurance people have stopped taking my calls anyway. Just mind the buildings.',
  tips: ['Keep the <b>grey saloon</b> within 62 m. Lose him and he has to wait for you — and the shot suffers.', '<b>Smash everything</b>: walls, parked cars, the statue — destruction pays.', 'Buildings do not move. Hit a corner in the bends and thirty-six tons stops dead.'],
  controls: `${K('W')} drive &nbsp; ${K('S')} brake &nbsp; ${K('A')}${K('D')} steer the tracks`, intro: { r: 15, h: 4.5 },
  assets: { models: ['t55_tank', 'sedan_grey', 'wagon_brown', 'van_white', 'lemans', 'taxi', 'street_lamp'], tex: ['bd_stpetersburg', 'tx_cobble', 'tx_asphalt', 'tx_fac_russia', 'tx_brick', 'tx_concrete', 'tx_roof', 'tx_wood'] },
  build(s) {
    // St Petersburg in winter light: low grey ceiling, cold blue haze closing off the long boulevard, muted pastels
    s.env('overcast', { backdrop: 'bd_stpetersburg', look: 'cold', fog: 0.0029, hz: 0.46, sun: [26, -40], sunI: 2.0, amb: 1.35, fogColor: 0xa4adb6, lookOver: { contrast: 1.1, sat: 0.85, vignette: 0.42, exposure: 1.12 } });
    s.ground({ tex: 'tx_cobble', tile: 8, color: 0x9a9a9a }); const ZE = -960;
    s.road({ z0: 110, z1: ZE - 160, width: 16, lanes: 2, path: tcx, step: 5 });
    srand(31); const tints = [0xffffff, 0xf2e2b8, 0xd8e6d0, 0xf0d0c0, 0xe0e0ea];
    for (const sd of [-1, 1]) { let z = 110; while (z > ZE - 170) { const w = sr(14, 22), d = sr(12, 18), h = sr(13, 23), zc = z - w / 2; s.building({ x: tcx(zc) + sd * (11.6 + d / 2), z: zc, w: d, d: w, h, fac: 'tx_fac_russia', tint: tints[Math.floor(sr(tints.length))] }); z -= w; } }
    for (let z = 80; z > ZE - 100; z -= 44) for (const sd of [-1, 1]) s.put('street_lamp', { x: tcx(z) + sd * 9.6, z, height: 6.5, ry: sd > 0 ? Math.PI : 0, solid: 'break', hitScale: 0.12, sol: { debris: 0x333333, soft: true } });
    // tram catenary down the boulevard (two contact wires hung from span wires) and onlookers on the square by the statue
    const TW = [], dz = 6; for (let z = 110; z > ZE - 160; z -= dz) { const x0 = tcx(z), x1 = tcx(z - dz), hd = Math.atan2(x1 - x0, -dz), L = Math.hypot(x1 - x0, dz); for (const o of [-1.6, 1.6]) TW.push([(x0 + x1) / 2 + o, 6.6, z - dz / 2, 0.035, 0.035, L, hd]); }
    for (let z = 96; z > ZE - 150; z -= 33) TW.push([tcx(z), 6.75, z, 23, 0.03, 0.03]); boxes(s, TW, [0x1a1a1a], { rough: 0.6 });
    for (const sd of [-1, 1]) dress.crowd(s, { path: [[tcx(-452) + sd * 10.4, -452], [tcx(-490) + sd * 10.4, -490]], rows: 2, step: 0.8, side: sd, face: sd > 0 ? Math.PI / 2 : -Math.PI / 2, colors: [0x2a2a30, 0x3a3428, 0x5a3a2a, 0x4a4a52, 0x6a2a2a, 0x2a3a4a, 0x7a6a50], gaps: 0.25, seed: 80 + sd });
    s.crew({ x: 7, z: 26, ry: 0.9 });
    const tk = s.car = new Drive(s, { kind: 'tank', model: 't55_tank', x: 0, z: 40, top: 23.5, accel: 7.5, steer: 1.55, cam: { dist: 13.5, height: 5.6, ahead: 9 } }); tk.fovK = 7;
    const mv = new Movers(s, tk); let wrecks = 0, lastWall = 0; const smash = (label, pay) => () => { wrecks++; s.bonus(label, pay); };
    // every wall the tank bursts through is a beat for the replay (one per wall, not per brick panel)
    const wallHit = () => { if (s.t - lastWall > 2) { lastWall = s.t; const z = tk.pos.z - 28; s.moment('through the wall', { t0: s.t - 1.4, dur: 3, w: 1.6 + clamp(tk.v / 23.5) * 0.6, shots: [{ type: 'front', pos: [tcx(z) + 4.3, 1.0, z], fov: 30, lookUp: 1.3, speed: 0.45, a: 0.2, b: 0.8 }, 'low', 'wide'] }); s.engine.addShake(0.5); } }; // signature: a camera planted in the street beyond the wall, the T-55 bursting through at it
    // walls across the street, crates, the statue
    const brick = s.mat({ tex: 'tx_brick', color: 0xb08a78 });
    // full-width walls keep a 6 m gateway on the General's line so his saloon drives through instead of ghosting the bricks
    const genOff = z => Math.sin(z * 0.031) * 2.4, wb = smash('Walls demolished', 90);
    const wallAt = (z, x0, x1, gate) => { for (let x = x0; x < x1 - 0.1; x += 3) { const c = x + 1.5; if (gate && Math.abs(c - genOff(z)) < 3) continue; s.box({ x: tcx(z) + c, y: 0, z, w: 3, h: 3.2, d: 0.7, mat: brick, tile: 3, solid: 'break', sol: { debris: 0x9a5a40, slow: 0.965, on: () => { wb(); wallHit(); } } }); } };
    wallAt(-150, -8, 8, true); wallAt(-278, 0, 9); wallAt(-420, -8, 8, true); wallAt(-598, -9, 0); wallAt(-760, -8, 8, true); wallAt(-880, -8, 1);
    const crate = s.mat({ tex: 'tx_wood', color: 0xb89a6a }); for (const [, z] of [[2, -60], [-2.5, -195], [3, -345], [-3, -500], [0, -690], [2.5, -820], [-2, -925]]) for (let i = 0, x = genOff(z) > 0 ? -3.4 : 2.8; i < 4; i++) s.box({ x: tcx(z) + x + (i % 2) * 1.3 - 0.6, y: i > 1 ? 1.2 : 0, z: z - (i > 1 ? 0.3 : 0) - (i % 2) * 0.2, w: 1.2, h: 1.2, d: 1.2, mat: crate, tile: 1.2, solid: 'break', sol: { soft: true, debris: 0xb89a6a, on: i ? undefined : smash('Market stalls', 60) } });
    const stone = s.mat({ tex: 'tx_concrete', color: 0xcfcabb }), bronze = s.mat({ color: 0x3f6a58, metal: 0.7, rough: 0.45 });
    const horse = (parent, y) => { s.box({ parent, y, w: 0.7, h: 0.9, d: 2.2, mat: bronze }).position.y += 1.0; for (const [x, z] of [[-0.25, 0.8], [0.25, 0.8], [-0.25, -0.8], [0.25, -0.8]]) s.box({ parent, x, z, y, w: 0.2, h: 1.05, d: 0.22, mat: bronze }); s.box({ parent, y: y + 1.7, z: -1.15, w: 0.4, h: 0.95, d: 0.5, mat: bronze, rx: 0.5 }); s.box({ parent, y: y + 1.9, z: 0.05, w: 0.5, h: 1.0, d: 0.4, mat: bronze }); s.box({ parent, y: y + 2.9, z: 0.05, w: 0.3, h: 0.34, d: 0.3, mat: bronze }); s.box({ parent, x: 0.42, y: y + 2.3, z: -0.3, w: 0.14, h: 0.14, d: 1.1, mat: bronze, rx: 0.5 }); };
    const SZ = -470, pl = s.box({ x: tcx(SZ), y: 0, z: SZ, w: 2.8, h: 2.4, d: 3.6, mat: stone, tile: 3, solid: 'break', sol: { debris: 0xcfcabb, slow: 0.95, on: () => { wrecks += 2; s.bonus('Borrowed a statue', 500); s.msg('NICE HORSE', 'good'); s.moment('the statue', { t0: s.t - 1.6, dur: 3.4, w: 3, shots: [{ type: 'front', pos: [tcx(SZ) - 4.3, 1.1, SZ - 30], fov: 36, lookUp: 1.4, speed: 0.5, b: 0.85 }, { type: 'low', speed: 0.3 }, { type: 'wide', speed: 0.7 }] }); const g = new THREE.Group(); g.position.set(0, tk.k.h - tk.k.cg - 0.15, 0.6); g.rotation.set(0.12, 0.3, 0.1); tk.body.add(g); horse(g, 0); } } }); horse(pl, 1.2);
    for (const sd of [-1, 1]) for (const dz of [-9, 9]) s.box({ x: tcx(SZ) + sd * 5, y: 0, z: SZ + dz, w: 0.5, h: 0.9, d: 0.5, mat: stone, solid: 'break', sol: { soft: true, debris: 0xcfcabb } });
    // parked cars: fair game
    const park = ['sedan_grey', 'wagon_brown', 'van_white', 'lemans', 'taxi']; srand(5);
    for (let z = -30, i = 0; z > ZE + 10; z -= sr(30, 44), i++) { const sd = i % 2 ? 1 : -1, x = tcx(z) + sd * (i % 3 === 0 ? 2.6 : 5.8); const e = mv.add({ model: park[i % park.length], x, z, v: 0, ry: sr(-0.08, 0.08) + (sd < 0 ? Math.PI : 0), type: 'break', nearMiss: false, on: (c, sol) => { const m = sol.mover; mv.fling(m, rnd(5, 8.5)); m.v = Math.abs(tk.v) * rnd(1.2, 1.6); wrecks++; s.bonus('Cars flattened', 140); s.audio.crash(); s.msg(['CRUNCH', 'FLATTENED', 'TAXI!', 'OOPS'][wrecks % 4], 'small'); } }); e.sol.slow = 0.975; e.sol.debris = 0x777777; }
    // the General's saloon steers round the parked cars and the plinth (Movers avoidance) and takes the gateways in the walls
    const gen = s.rival = mv.add({ model: 'sedan_grey', z: -12, v: 0, solid: false, nearMiss: false, swerve: 6, xmin: -7, xmax: 7, path: z => tcx(z) + genOff(z), ai: (e, dt) => { if (!s.started) return; e.o.xmin = tcx(e.z) - 7; e.o.xmax = tcx(e.z) + 7; const gap = tk.pos.z - e.z, want = gap > 140 ? 0 : gap > 105 ? 7 : gap > 80 ? 13.5 : gap > 48 ? 19.5 : gap < 22 ? 27 : 22.6; e.v += (want - e.v) * Math.min(1, dt * 1.2); if (e.v > 8 && Math.random() < 0.1) s.fx.dust(e.m.position, 1, { size: 1.4, a: 0.2 }); } });
    let close = 0, tot = 0, fin = false, lostF = false; s.rate('Driving', 1, 1); idleGuard(s, tk); tk.onHit = (sol, imp) => { if (imp > 5) { dock(s, 'Driving', 0.2); s.msg('STALLED!', 'bad'); } }; s.objective('Stay with the General — flatten everything else');
    s.onUpdate(dt => {
      if (!s.started || s.ended) return; const gap = tk.pos.z - gen.z; tot += dt; if (gap < 62) close += dt;
      s.hud.readout('gap', 'Target (m)', Math.max(0, Math.round(gap)), gap > 85 ? 'warn' : gap < 62 ? 'ok' : ''); s.hud.readout('wr', 'Wrecked', wrecks); s.hud.readout('spd', 'KM/H', Math.round(tk.kmh));
      // lose him and he idles round the next corner waiting for you (a flub, not a cut)
      if (gap > 120 && !lostF) { lostF = true; s.flub('Lost the General', { penalty: 0.2, advice: 'Keep the tank at full throttle and steer the bends early — stalling on a building corner is what loses him.' }); } if (lostF && gap < 70) lostF = false;
      if (tk.pos.z < ZE && !fin) { fin = true; s.rate('Kept him in range', clamp(close / tot / 0.85), 2); s.rate(`Destruction (${wrecks} wrecked)`, clamp(wrecks / 22), 1.5); s.wrap(1.4); }
    });
  },
  bot(s, inp) {
    const c = s.car, z = c.pos.z; let tx = tcx(z - 20), bd = 60; const bend = Math.abs(tcx(z - 45) - tcx(z + 10)) > 1.5;
    if (!bend) for (const sol of s.course.solids) { if (sol.dead || sol.type !== 'break') continue; const dz = z - sol.z1, xc = (sol.x0 + sol.x1) / 2; if (dz > 10 && dz < bd && Math.abs(xc - tcx(sol.z1)) < 6.6 && Math.abs(xc - c.pos.x) < 2 + dz * 0.22) { bd = dz; tx = xc; } }
    botDrive(c, inp, tx, 99, 0.06);
  },
};

// What the player is asked to do, in plain numbers, plus the film's signature camera angles for the replay.
const EXTRA = {
  golden_gun: { goals: { shot: ['Drive down the dirt road and line up dead centre on the twisted wooden ramp', 'Hit the ramp at 40 mph — the MPH readout turns green between 38 and 42', 'Do not steer or change throttle on the planks: the spiral rolls the car one full turn', 'Land on the far ramp and drive on 100 m'], cut: ['You drop into the klong (far too slow) or miss the ramp', 'You land on the side or roof (more than about 7 mph off 40)'], stars: ['Take-off speed', 'The spiral (degrees off level)', 'Landing'] },
    // the film's frame: side-on from the water downstream, the Hornet upside down over the klong between the two ramps
    cine: [{ type: 'wide', pos: [-32, -1.0, -263], fov: 30, lookUp: -1.4, speed: 0.35 }, { type: 'orbit', speed: 0.3 }, { type: 'low', speed: 0.35 }], liveShot: 'wide' },
  speed_bus: { goals: { shot: ['Accelerate past 50 mph — that arms the bomb', 'Stay above 50: weave round the traffic and change lanes early (under 50 starts a 3-second fuse)', 'Hit the ramp at the freeway gap at 68+ mph with the wheels straight', 'Land and keep it above 50 for another 130 m'], cut: ['You stay under 50 mph for 3 seconds — the bomb goes off', 'You come up short at the gap (under 68 mph)'], stars: ['Speed at the gap', 'Landing', 'Clean traffic', 'Average speed'] },
    cine: ['wide', 'low', 'front'] },
  t2_canal: { goals: { shot: ['Ride off the spillway ledge and land the 7 m drop level (feather W in the air)', 'Ride 900 m down the flood channel with the tow truck behind you', 'Pick your gap at every bridge: one pier = go left or right, two piers = go through the middle', 'Dodge the junk and keep the TRUCK readout above 14 m'], cut: ['The truck runs you down (it backs off once, the first time it gets close)', 'You hit a bridge pier head-on'], stars: ['Drop landing', 'Lead over the truck', 'Clean ride'] },
    cine: [{ type: 'wide', pos: [-8.8, 1.1, -34], fov: 44, lookUp: 0.6, speed: 0.4 }, 'low', 'chase'] },
  diamonds: { goals: { shot: ['Weave round the parked cars, then line up on the green stripe on the right', 'Put your right wheels on the ramp at 30–45 mph — she tips onto two wheels', 'In the alley keep the BALANCE needle in the green: D lifts, A lowers (small taps)', 'After the alley let her drop and drive on 60 m'], cut: ['You hit the ramp above 53 mph and roll her', 'The needle goes all the way over (roof) or all the way flat (wedged)', 'You miss the ramp twice (the first miss is a flub — back to one)'], stars: ['Ramp speed', 'Balance', 'Alley exit', 'Clean approach'] },
    cine: [{ type: 'front', pos: [0, 1.1, -232], fov: 12, lookUp: 0.6, speed: 0.6 }, 'low', 'rear'] },
  thelma: { goals: { shot: ['Floor it toward the canyon rim — 70+ mph', 'Watch the RIM readout: after you jump you tumble about 15 m at 70 mph (18 m at 85)', 'Press E to bail out as late as you dare (marker posts every 100 m; red = 100 m to go)', 'Lie still while the car sails over the edge'], cut: ['You never bail out', 'You bail so late you tumble over the edge after the car'], stars: ['Speed at the bail', 'Nerve (how close to the rim you stop)', 'Clean run'] },
    cine: ['rear', 'wide', 'low'] },
  gone60: { goals: { shot: ['Thread the gridlock: follow the open lane — it switches sides, so look 50 m ahead', 'After the last gap, take lane 2 (left of centre) flat out to the yellow flatbed', 'Hit the flatbed ramps at 65+ mph and hold W in the air', 'Clear the accident, land in the green zone and drive on'], cut: ['You plough nose-first into the gridlock', 'You come down on the accident scene', '(Missing the flatbed is a flub: you brake and the take ends with no jump)'], stars: ['Clean slalom', 'Slalom pace', 'Take-off speed', 'Landing'] },
    // signature: side-on from off the bridge deck, Eleanor in the air over the wrecks with the cables and the far tower behind
    cine: [{ type: 'wide', pos: [-22, 3, -640], fov: 36, lookUp: 0.3, speed: 0.4 }, 'track', { type: 'front', pos: [-4.2, 1.0, -712], fov: 44, lookUp: 1.2, speed: 0.5, a: 0.2 }], liveShot: 'low' },
  matrix_freeway: { goals: { shot: ['Ride 1,450 m against five lanes of oncoming traffic', 'Ride the white lines between lanes; look far ahead for lane-changers and trucks', 'Keep above 60 mph — the AGENTS meter fills while you are slower', 'Close passes pay a bonus; a glancing clip costs you'], cut: ['A head-on with a car or truck', 'The AGENTS meter fills up (about 5 s under 60 mph)'], stars: ['Average speed', 'Nerve (close passes)', 'Untouched (clips)', 'Barrier-free'] },
    cine: ['front', 'low', 'track'] },
  ronin: { goals: { shot: ['Follow the BMW into the tunnel on the LEFT side — against the traffic', 'Stay within 60 m of her (BMW readout); 15–35 m is ideal', 'Switch between the two wrong-way lanes when headlights come at you — never cross the centre pillars', 'Follow her out of the far end of the tunnel'], cut: ['A head-on with an oncoming car', 'Hitting a centre pillar head-on'], stars: ['On her tail', 'Gap at the exit', 'Bodywork'] },
    cine: ['front', 'chase', 'low'] },
  goldeneye_tank: { goals: { shot: ['Chase the grey saloon in the T-55 — keep the TARGET readout under 62 m', 'Smash the brick walls, market stalls, parked cars and the horse statue for bonus pay', 'Start steering the bends early — buildings stop 36 tons dead', 'Follow him 960 m to the end of the street'], cut: ['Nothing short of sitting still — a tank cannot crash (losing him is a flub: he waits)'], stars: ['Kept him in range', 'Destruction (wrecks)', 'Driving (stalls on buildings)'] },
    cine: ['front', 'low', 'wide'] },
};
export default [goldenGun, speedBus, t2, diamonds, thelma, gone60, matrix, ronin, tank].map(d => Object.assign(d, EXTRA[d.id]));
