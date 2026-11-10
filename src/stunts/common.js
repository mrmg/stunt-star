import * as THREE from 'three';
import { clamp, rnd, sr, srand, V3 } from '../world/stage.js';

export const K = k => `<kbd>${k}</kbd>`;
export const CTL = {
  drive: `${K('W')} gas &nbsp; ${K('S')} brake &nbsp; ${K('A')}${K('D')} steer &nbsp; ${K('SPACE')} handbrake`,
  bike: `${K('W')} gas &nbsp; ${K('S')} brake &nbsp; ${K('A')}${K('D')} steer &nbsp; in the air: ${K('W')} nose down ${K('S')} nose up`,
  run: `${K('W')} sprint &nbsp; ${K('A')}${K('D')} dodge &nbsp; ${K('SPACE')} jump (hold = higher) &nbsp; ${K('S')} slide`,
  fall: `${K('W')}${K('A')}${K('S')}${K('D')} steer &nbsp; hold ${K('SPACE')} dive faster &nbsp; ${K('E')} action`,
  grip: `${K('W')}${K('A')}${K('S')}${K('D')} move &nbsp; hold ${K('SPACE')} brace`,
  fly: `${K('A')}${K('D')} bank &nbsp; ${K('W')} climb &nbsp; ${K('S')} dive &nbsp; ${K('SHIFT')} afterburner`,
  fight: `${K('A')} strike left &nbsp; ${K('D')} strike right &nbsp; ${K('W')} jump kick &nbsp; ${K('S')} duck &nbsp; ${K('SPACE')} block — hit each move as it reaches the box`,
};
export const TRAFFIC = ['sedan_grey', 'wagon_brown', 'van_white', 'taxi', 'peugeot406', 'bmw_m5', 'lemans', 'wrx'];

// City street: road, kerbs, facades both sides, lamps. Returns nothing; everything is registered on the stage.
export function street(s, o = {}) {
  const { z0 = 60, z1 = -900, width = 14, lanes = 4, walk = 3.5, fac = ['tx_fac_office'], height = [14, 34], lit = 0, lamps = 34, x = 0, yfn, solidRows = true } = o;
  s.road({ z0, z1, width, lanes, x, double: o.double, mat: o.roadMat, path: o.path });
  if (!o.path) for (const sd of [-1, 1]) {
    if (!yfn) s.box({ x: x + sd * (width / 2 + walk / 2), y: 0, z: (z0 + z1) / 2, w: walk, h: 0.16, d: z0 - z1, mat: { tex: 'tx_concrete', color: 0xbbbbbb }, tile: 4, cast: false, top: true, step: 0.4 });
    s.row({ side: sd, x: x + sd * (width / 2 + walk), z0, z1, fac, height, depth: o.depth || [14, 22], width: o.bwidth || [12, 26], lit, seedv: (o.seedv || 3) + (sd > 0 ? 50 : 0), tints: o.tints, yfn: yfn ? (z => yfn(z) - 6) : undefined, solid: solidRows, facTile: o.facTile });
    if (lamps) for (let z = z0 - 10; z > z1; z -= lamps) { const lx = x + sd * (width / 2 + 0.9), ly = yfn ? yfn(z) : 0.16; s.put('street_lamp', { x: lx, y: ly, z, height: 6.5, ry: sd > 0 ? Math.PI : 0, solid: 'break', hitScale: 0.12, sol: { debris: 0x333333 } }); if (lit) s.light({ x: lx - sd * 1.4, y: ly + 6, z, color: 0xffc070, i: 60, dist: 34, bulb: true, r: 0.22 }); }
  }
}
// Scatter looping traffic on lanes. lanes: [[x, dir(+1 with player / -1 oncoming)], ...]
export function traffic(s, movers, o) {
  const { lanes, n = 12, z0 = -80, z1 = -900, speed = [14, 20], models = TRAFFIC, seedv = 5, ahead = [260, 520], zEnd } = o; srand(seedv); const out = [];
  for (let i = 0; i < n; i++) { const L = lanes[i % lanes.length], v = sr(speed[0], speed[1]) * L[1]; out.push(movers.add({ model: models[Math.floor(sr(models.length))], x: L[0], z: z0 + (z1 - z0) * ((i + sr(0.8)) / n), v, recycle: o.recycle === false ? null : [60, ahead[0], ahead[1]], zEnd, msg: o.msg || 'Head-on with the traffic', hardK: o.hardK, swerve: o.swerve ?? 1.5 })); }
  return out;
}
// autopilot helpers for test bots
export function botDrive(car, inp, tx = 0, tv = 30, gain = 0.05) {
  const want = -clamp((tx - car.pos.x) * gain, -0.45, 0.45); inp.x = clamp((car.heading - want) * 5, -1, 1);
  inp.y = car.v < tv ? 1 : car.v > tv + 1.5 ? -1 : 0;
}
export const mph = v => Math.round(Math.abs(v) * 2.237), kmh = v => Math.round(Math.abs(v) * 3.6);
// tall thin post / sign helpers
export function sign(s, text, o = {}) {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128; const g = cv.getContext('2d'); g.fillStyle = o.bg || '#0a5d2a'; g.fillRect(0, 0, 512, 128); g.strokeStyle = '#fff'; g.lineWidth = 6; g.strokeRect(6, 6, 500, 116); g.fillStyle = o.fg || '#fff'; g.font = `bold ${o.size || 64}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 256, 68);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.userData.own = true; const w = o.w || 6, m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide, toneMapped: false, color: new THREE.Color(o.glow ?? 0.9, o.glow ?? 0.9, o.glow ?? 0.9) }));
  m.position.set(o.x || 0, o.y ?? 5, o.z || 0); m.rotation.y = o.ry || 0; s.scene.add(m); return m;
}
// simple rolling/tumbling wreck animation for scripted cannon rolls & flips. Returns controller with .rolls
export function tumbleScript(s, car, { rollRate = 9, pitchRate = 0, decel = 9, hop = 0.7, onDone } = {}) {
  car.frozen = true; const st = { rolls: 0, flips: 0, v: Math.abs(car.v), done: false, ang: 0, pang: 0 }; const h = car.heading, fx = -Math.sin(h), fz = -Math.cos(h), v0 = st.v, y0 = car.pos.y;
  s.onUpdate(dt => {
    if (st.done) return; st.v = Math.max(0, st.v - decel * dt); const k = st.v / Math.max(1, v0);
    car.pos.x += fx * st.v * dt; car.pos.z += fz * st.v * dt; st.ang += rollRate * k * dt; st.pang += pitchRate * k * dt; st.rolls = st.ang / (2 * Math.PI); st.flips = st.pang / (2 * Math.PI);
    const g = s.course.height(car.pos.x, car.pos.z, car.pos.y + 2); car.pos.y = (g > -1e5 ? g : y0) + Math.abs(Math.sin(st.ang + st.pang)) * hop * (0.4 + k) + (pitchRate ? Math.sin(Math.min(Math.PI, st.pang)) * car.k.len * 0.45 : 0);
    car.obj.rotation.set(st.pang, h, st.ang); car.camHead = h;
    if (Math.random() < 0.6 && st.v > 2) { s.fx.dust(car.pos, 2, { color: car.dustColor, size: 2.2, spread: 2 }); if (Math.random() < 0.3) s.fx.sparks(car.pos, 4); }
    if (Math.floor(st.rolls * 2) !== st._h) { st._h = Math.floor(st.rolls * 2); s.audio.impact(0.5 + k * 0.5); s.engine.addShake(0.5 + k * 0.6); s.fx.debris(car.pos, 3, { color: 0x333333, speed: 6 }); }
    if (st.v <= 0.05) { st.done = true; onDone?.(st); }
  });
  return st;
}

// On-foot chaser that follows the player's exact route with a delay — it jumps, slides and climbs
// wherever the player did, so it can never clip through the obstacles the player had to avoid.
// const p = pursuer(s, run.c, 'ch_goon', { delay: 1.6 });  p.gap() -> metres behind the player along the route
export function pursuer(s, lead, id, { delay = 1.5, speedUp = 0 } = {}) {
  const c = s.char(id, {}), H = []; let t = 0, d = delay; c.root.visible = false;
  const KEYS = ['hip', 'sp', 'hd', 'body', 'aR', 'aL', 'lR', 'lL', 'ft'];
  s.onUpdate(dt => {
    if (!s.started) return; t += dt; d = Math.max(0.35, d - speedUp * dt);
    H.push({ t, p: lead.root.position.clone(), h: lead.heading, pose: KEYS.map(k => lead.cur[k].slice()), sa: lead.spinAng.clone() }); if (H.length > 2400) H.splice(0, 600);
    const tt = t - d; if (tt < H[0].t) return; let i = H.findIndex(e => e.t >= tt); if (i < 0) i = H.length - 1;
    const e = H[i]; c.root.visible = true; c.root.position.copy(e.p); c.heading = e.h; c.cycle = null; c.target = Object.fromEntries(KEYS.map((k, j) => [k, e.pose[j]])); c.k = 40; c.spinAng.copy(e.sa);
  });
  return { c, gap: () => { const tt = t - d; const e = H.find(x => x.t >= tt); return e ? e.p.distanceTo(lead.root.position) : 99; }, set delay(v) { d = v; }, get delay() { return d; } };
}
