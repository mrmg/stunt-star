import * as THREE from 'three';
import { Drive, Movers } from '../modes/drive.js';
import { model } from '../core/assets.js';
import { clamp, near, smooth, V3, rnd, sr, srand, lerp, damp } from '../world/stage.js';
import { K, CTL, street, botDrive, sign, tumbleScript } from './common.js';

const ftOf = m => Math.round(m * 3.281);
const dock = (s, label, by) => s.rate(label, (s.scores.get(label)?.v ?? 1) - by, s.scores.get(label)?.w ?? 1);
const side = (s, id, n, z0, z1, xin, xout, o = {}) => s.forest(id, n, r => { const sd = o.sd ?? (r() < 0.5 ? -1 : 1), z = z0 + (z1 - z0) * r(); return [sd * (xin + Math.pow(r(), 1.5) * (xout - xin)) + (o.cx ? o.cx(z) : 0), z]; }, { h: o.h || [7, 13], solid: o.solid, solidX: o.solidX, seedv: o.seedv, msg: o.msg });

// tumbleScript pivots a wreck about its wheels, which buries it when it is upside down: re-centre the pivot on the body.
function tumble(s, car, o = {}) {
  const Kk = car.k, done = o.onDone, st = tumbleScript(s, car, { ...o, onDone: t => { car.v = 0; done?.(t); } }); let base = car.pos.y; if (car.mesh) car.mesh.position.y -= Kk.h / 2;
  s.onUpdate(() => { if (!st.done) base = car.pos.y; const a = st.ang; car.pos.y = base + (o.pitchRate ? Kk.h / 2 : (Math.abs(Math.cos(a)) * Kk.h + Math.abs(Math.sin(a)) * Kk.w) / 2); if (o.fwd) car.obj.rotation.x = -st.pang; });
  return st;
}
const rateFor = (rolls, v0, decel) => rolls * 4 * Math.PI * decel / Math.max(6, v0); // roll/pitch rate that makes tumbleScript finish on exactly `rolls`
function headlights(car, i = 500) { const l = new THREE.SpotLight(0xfff0d8, i, 110, 0.5, 0.6, 1.3); l.position.set(0, 0.9, -1.6); l.target.position.set(0, 0, -34); car.obj.add(l, l.target); return l; }

// Air-cannon barrel roll shared by the two record attempts. SPACE fires; rolls = f(speed, timing, line).
function cannonRoll(s, car, o) {
  const { KZ, KX, win, perf, align, minMph, bestMph, record, maxRolls, decel = 8, hop = 1.0, blocked } = o; const S = { fired: false, st: null };
  s.onUpdate(() => {
    if (S.st && !S.st.done) s.hud.readout('rolls', 'Rolls', Math.abs(S.st.rolls).toFixed(1), 'ok');
    if (!s.started || s.ended || S.fired) return; const d = car.pos.z - KZ;
    if (d < 90) { s.hud.bar((75 - d) / 90, [(75 - win) / 90, (75 + win) / 90], [(75 - perf) / 90, (75 + perf) / 90]); s.hud.prompt(`${K('SPACE')} fire the cannon on the kicker`); }
    if (blocked?.(d)) { S.fired = true; s.hud.hideBar(); return; }
    if (d < -win - 3) { S.fired = true; s.hud.hideBar(); s.hud.prompt(''); return s.fail('Sailed past the kicker with the cannon unfired', { injury: 0 }); }
    if (!s.input.hit('a') || d > 110) return;
    S.fired = true; s.hud.hideBar(); s.hud.prompt(''); const dx = car.pos.x - KX, mph = car.mph, v0 = Math.abs(car.v);
    s.fx.smokePuff(car.pos, 14, { color: [0.8, 0.8, 0.8], size: 2.4, up: 5 }); s.fx.sparks(car.pos, 40, { speed: 12 }); s.audio.explosion(0.7); s.engine.addShake(1.1);
    if (Math.abs(d) > win) return car.crash(`Fired the cannon ${Math.abs(d).toFixed(0)} m ${d > 0 ? 'early' : 'late'} — no kicker under the car, it just spat you off the road`, { injury: 0.45 });
    if (Math.abs(dx) > align) return car.crash(`Missed the kicker by ${Math.abs(dx).toFixed(1)} m — the cannon fired into thin air and spun the car`, { injury: 0.35 });
    s.slowmo(0.4, 1.6); s.cam.set({ dist: 12, height: 3.4, side: 5.5, stiff: 4 });
    if (mph < minMph) { S.st = tumble(s, car, { rollRate: rateFor(0.5, v0, decel), decel, hop, onDone: () => s.fail(`Only ${mph.toFixed(0)} mph — one lazy flop onto the roof. That is not a record`, { injury: 0.3 }) }); return; }
    const sp = clamp((mph - minMph) / (bestMph - minMph)), tm = near(Math.abs(d), 0, perf, win), al = near(Math.abs(dx), 0, 0.35, align);
    const rolls = Math.round((2 + (maxRolls - 2) * sp * (0.55 + 0.45 * tm) * (0.7 + 0.3 * al)) * 4) / 4;
    s.msg(Math.round(mph) + ' MPH — CANNON!', 'good'); s.objective('Hang on…');
    S.st = tumble(s, car, { rollRate: rateFor(rolls, v0, decel), decel, hop, onDone: () => {
      s.rate(`Cannon rolls (${rolls} of ${record})`, rolls / record, 2); s.rate(`Speed (${mph.toFixed(0)} mph)`, 0.35 + 0.65 * sp, 1); s.rate('Cannon timing', tm, 1); s.rate('On the kicker', al, 0.7);
      s.bonus(rolls + ' rolls', Math.round(rolls * 250)); if (rolls >= record) { s.bonus('World record', 3000); s.msg(rolls + ' ROLLS — RECORD!', 'huge good'); } else s.msg(rolls + ' ROLLS', 'good');
      s.wrap(1.8, rolls >= record ? 'That one goes in the book.' : undefined);
    } });
  });
  return S;
}

// --------------------------------------------------------------------------------------------- 1
const casino = {
  id: 'casino_roll', title: 'Seven Times Over', film: 'Casino Royale', year: 2006, tier: 4, pay: 15000, mode: 'drive', art: 'bd_georgia', music: 'spy',
  role: 'Doubling 007 — Aston Martin DBS, a country road, midnight',
  brief: 'She is lying in the road. You come round at ninety, swerve off the left lane onto the kicker and hit the air cannon. The record is seven complete rolls. Nobody has ever needed an eighth.',
  tips: ['Be doing <b>75 mph or more</b> — every extra mph is another roll.', 'Stay left past the camera van, then <b>swerve right</b> onto the kicker beside her.', 'Hit <b>SPACE</b> as the marker crosses the green — fire early or late and the cannon just throws you off the road.'],
  controls: `${K('W')} gas &nbsp; ${K('S')} brake &nbsp; ${K('A')}${K('D')} steer &nbsp; ${K('SPACE')} fire the air cannon`, intro: { r: 9, h: 2.2 },
  assets: { models: ['dbs', 'van_white', 'ch_spy'], tex: ['bd_georgia', 'tx_asphalt', 'tx_grass'] },
  build(s) {
    s.env('night', { backdrop: 'bd_georgia', look: 'night', fog: 0.0035, amb: 0.5, bdGain: 0.16, hz: 0.45, lookOver: { bloom: 0.9 } });
    s.ground({ tex: 'tx_grass', tile: 5, color: 0x7a8a7a });
    const KZ = -420, KX = 1.9, LX = -1.9; s.road({ z0: 110, z1: -760, width: 7.6, lanes: 2 });
    side(s, 'tree:oak', 260, 100, -740, 6.6, 70, { h: [8, 15], solid: true, solidX: 16, seedv: 5, msg: 'Wrapped the Aston round an oak' }); side(s, 'tree:oak', 110, 100, -740, 6.4, 11, { h: [9, 14], solid: true, seedv: 14, msg: 'Wrapped the Aston round an oak' }); side(s, 'tree:bush', 120, 100, -740, 5.4, 30, { h: [1, 2.2], seedv: 8 });
    // the camera van that keeps you in the left lane, the girl in the road, the kicker next to her
    s.put('van_white', { x: KX + 0.2, z: KZ + 118, solid: true, sol: { msg: 'Buried the DBS in the camera van' } }); s.light({ x: 4.6, y: 2.4, z: KZ + 121, color: 0xffe0b0, i: 40, dist: 26 });
    s.char('ch_spy', { x: LX, y: 0.02, z: KZ - 7, heading: 1.3, pose: 'lie' }); s.light({ x: LX - 2.6, y: 0.5, z: KZ - 7, color: 0xff3020, i: 18, dist: 16, r: 0.1 });
    s.box({ x: KX, y: 0.12, z: KZ + 1.2, w: 1.5, h: 0.07, d: 3.6, rx: 0.12, mat: s.mat({ color: 0x23262a, metal: 0.6, rough: 0.5 }) });
    s.line({ x: KX, z: KZ, w: 3.4, d: 0.5, color: 0x40ff80, glow: 1.6 }); for (const z of [KZ + 60, KZ + 40, KZ + 20]) s.line({ x: 3.5, z, w: 0.3, d: 2, color: 0xff5030, glow: 2 });
    s.cones([[0.1, KZ + 112], [0.1, KZ + 116], [0.1, KZ + 120], [0.2, KZ + 124]]);
    s.crew({ x: 5.4, z: 74, ry: 0.9, light: 160 }); s.crew({ x: -5.6, z: KZ - 40, ry: 2.4, people: false, light: 200 }); s.light({ x: -5.6, y: 3.2, z: KZ - 38, color: 0xdde8ff, i: 120, dist: 60 });
    const car = s.car = new Drive(s, { kind: 'car', model: 'dbs', x: LX, z: 84, top: 46, accel: 9.5, grip: 7.5, handbrake: false }); headlights(car);
    s.S = { KZ, KX, LX }; s.objective('75 mph+ — swerve onto the kicker and fire');
    cannonRoll(s, car, { KZ, KX, win: 7, perf: 1.6, align: 1.7, minMph: 62, bestMph: 90, record: 7, maxRolls: 7.25, decel: 8, blocked: d => { if (d < -4 && d > -10 && Math.abs(car.pos.x - LX) < 1.5) { s.fail('You ran over the leading lady. The insurers would like a word', { injury: 0 }); return true; } } });
    s.onUpdate(() => { if (!s.S.done) s.hud.readout('spd', 'MPH', Math.round(car.mph), car.mph >= 75 ? 'ok' : car.pos.z < KZ + 200 ? 'warn' : ''); if (car.frozen) s.S.done = true; });
  },
  bot(s, inp) { const c = s.car, d = c.pos.z - s.S.KZ; botDrive(c, inp, d > 110 ? s.S.LX : s.S.KX, 60, 0.07); if (d < 0.4) inp.press('a'); },
};

// --------------------------------------------------------------------------------------------- 2
const sx = z => 5 * Math.sin(z * 0.011);
const fallGuy = {
  id: 'fall_guy', title: 'Eight and a Half', film: 'The Fall Guy', year: 2024, tier: 6, pay: 55000, mode: 'drive', art: 'bd_beach', music: 'epic',
  role: 'Record attempt — Jeep Grand Cherokee, a beach, one air cannon',
  brief: 'Seven rolls stood for eighteen years. Today we take it on wet sand. Stay on the hard-packed strip or the soft stuff eats your speed, hit the kicker dead straight, and fire. Eight and a half is the number.',
  tips: ['Stay on the <b>dark wet strip</b> between the cones — soft sand caps you well under the speed you need.', 'You want <b>80 mph+</b> at the kicker. The strip snakes, so steer early and smoothly.', 'The cannon window is <b>tight</b>: SPACE exactly on the green, with the wheels on the kicker.'],
  controls: `${K('W')} gas &nbsp; ${K('S')} brake &nbsp; ${K('A')}${K('D')} steer &nbsp; ${K('SPACE')} fire the air cannon`, intro: { r: 10, h: 2.6 },
  assets: { models: ['jeep_gc', 'van_white', 'wrx', 'helicopter'], tex: ['bd_beach', 'tx_sand', 'tx_grass', 'tx_metal'] },
  build(s) {
    s.env('day', { backdrop: 'bd_beach', look: 'teal_orange', fog: 0.0012, hz: 0.47 });
    s.ground({ tex: 'tx_sand', tile: 9 }); s.water({ y: 0.06, color: 0x1f7f96, w: 900, d: 2400, x: -472, z: -400, opacity: 0.88 });
    s.box({ x: -19.5, y: 0, z: -400, w: 5, h: 0.07, d: 2400, mat: s.mat({ color: 0xeef6f4, opacity: 0.55 }), cast: false }); // foam line
    const KZ = -520, KX = sx(KZ);
    s.road({ z0: 110, z1: -820, width: 8.4, path: sx, mat: { tex: 'tx_sand', color: 0x9a8468, rough: 0.45 }, marks: false });
    const cn = []; for (let z = 40; z > KZ - 10; z -= 24) cn.push([sx(z) - 4.5, z], [sx(z) + 4.5, z]); s.cones(cn);
    s.box({ x: KX, y: 0.12, z: KZ + 1.2, w: 1.9, h: 0.08, d: 4, rx: 0.12, mat: s.mat({ tex: 'tx_metal', color: 0x777777 }) }); s.line({ x: KX, z: KZ, w: 5, d: 0.5, color: 0x40ff80, glow: 1.4 });
    for (const sd of [-1, 1]) { s.box({ x: KX + sd * 5.2, y: 0, z: KZ, w: 0.12, h: 3.4, d: 0.12, mat: s.mat({ color: 0xdddddd }) }); s.box({ x: KX + sd * 5.2, y: 2.6, z: KZ, w: 0.05, h: 0.8, d: 1.3, mat: s.mat({ color: 0xff5a10, side: true }) }); }
    side(s, 'tree:palm', 90, 100, -800, 30, 120, { sd: 1, h: [8, 14], seedv: 3 }); side(s, 'tree:bush', 120, 100, -800, 24, 90, { sd: 1, h: [1, 2.4], seedv: 6 });
    s.terrain({ x0: 26, x1: 200, z0: 120, z1: -840, res: 9, fn: (x, z) => smooth(26, 70, x) * (3.5 + Math.sin(z * 0.04 + x * 0.05) * 1.6), tex: 'tx_sand', tile: 9, base: false });
    // video village + tracking vehicles
    s.crew({ x: sx(60) + 8, z: 62, ry: 1.0 }); s.crew({ x: KX + 12, z: KZ - 30, ry: 2.3, people: false }); s.crew({ x: KX + 11, z: KZ - 70, ry: 2.6, people: false }); s.put('wrx', { x: sx(60) + 13, z: 72, ry: 0.5 });
    for (const [x, z, w] of [[sx(60) + 12, 52, 4], [KX + 15, KZ - 50, 6]]) { s.box({ x, y: 2.3, z, w, h: 0.1, d: w, mat: s.mat({ color: 0x222222 }) }); for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) s.box({ x: x + a * w / 2.1, y: 0, z: z + b * w / 2.1, w: 0.08, h: 2.3, d: 0.08, mat: s.mat({ color: 0x999999 }) }); }
    const heli = s.put('helicopter', { x: -34, y: 15, z: KZ + 30, ry: -1.9 }); heli.rotation.z = 0.12;
    const car = s.car = new Drive(s, { kind: 'car', model: 'jeep_gc', x: sx(50), z: 50, top: 43, accel: 8.2, grip: 5.4, rollDrag: 0.5, offroadTop: 0.7, handbrake: false, h: 1.75 }); car.dustColor = [0.86, 0.78, 0.6]; car.k.dusty = true;
    const mv = new Movers(s, car); mv.add({ model: 'van_white', path: z => sx(z) + 12.5, z: 30, v: 0, solid: false, nearMiss: false, ai: (e, dt) => { if (!s.started) return; const want = car.frozen || e.z < KZ + 40 ? 0 : clamp(car.v + (e.z - car.pos.z + 14) * 0.8, 0, 44); e.v += (want - e.v) * Math.min(1, dt * 2.5); if (e.v > 4 && Math.random() < 0.4) s.fx.dust(e.m.position, 1, { color: car.dustColor, size: 2 }); } });
    s.S = { KZ, KX }; s.objective('Stay on the wet strip — 80 mph at the kicker'); let off = 0;
    cannonRoll(s, car, { KZ, KX, win: 4.5, perf: 1.0, align: 1.3, minMph: 64, bestMph: 86, record: 8.5, maxRolls: 9, decel: 9.5, hop: 1.3 });
    s.onUpdate((dt, t) => {
      heli.position.y = 15 + Math.sin(t * 0.8) * 0.6; if (car.frozen || !s.started) return;
      car.offroad = Math.abs(car.pos.x - sx(car.pos.z)) > 4.3; if (car.offroad) { off += dt; if (Math.abs(car.v) > 30) car.vel.multiplyScalar(1 - dt * 0.5); }
      if (car.pos.x < -19 && !car.dead) { s.fx.splash(car.pos, 90, 2.5); s.audio.splash(); car.crash('Drowned the Jeep in the surf', { injury: 0.3 }); }
      s.hud.readout('spd', 'MPH', Math.round(car.mph), car.mph >= 80 ? 'ok' : car.pos.z < KZ + 220 ? 'warn' : ''); s.hud.readout('sand', 'Sand', car.offroad ? 'SOFT' : 'hard-packed', car.offroad ? 'warn' : 'ok');
    });
  },
  bot(s, inp) { const c = s.car, d = c.pos.z - s.S.KZ; botDrive(c, inp, d < 40 ? s.S.KX : sx(c.pos.z - 16), 60, 0.08); if (d < 0.4) inp.press('a'); },
};

// --------------------------------------------------------------------------------------------- 3
const GT = [13, 23, 33, 43, 60], GA = [14, 10.5, 8, 6.2, 4.8];
const fastTrain = {
  id: 'fast_train', title: 'Beat the Freight', film: 'The Fast and the Furious', year: 2001, tier: 4, pay: 13000, mode: 'drive', art: 'bd_la', music: 'chase',
  role: 'Driving the blown ’70 Charger — one quarter mile, one orange Supra, one freight train',
  brief: 'Quarter mile to the level crossing, and the Santa Fe freight is already blowing its horn. Launch it, bang every gear in the green, and get across those tracks before the train does. Lift, and the Supra has you. Miss a gear, and the train has you.',
  tips: ['Hold <b>W</b> and tap <b>SPACE</b> to shift when the rev needle is in the <b>green</b>. Four shifts.', 'Shift early and she bogs; hit the limiter and you are standing still. Both cost you the race.', 'The closer the train is when you clear the tracks, the bigger the bonus. Hit it and you are dead.'],
  controls: `${K('W')} gas &nbsp; ${K('A')}${K('D')} steer &nbsp; ${K('SPACE')} shift up &nbsp; ${K('S')} brake (and lose)`, intro: { r: 10, h: 2.2 },
  assets: { models: ['charger_dom', 'supra', 'street_lamp'], tex: ['bd_la', 'tx_asphalt', 'tx_fac_old', 'tx_brick', 'tx_concrete', 'tx_roof', 'tx_metal', 'tx_dirt'] },
  build(s) {
    s.env('golden', { backdrop: 'bd_la', look: 'teal_orange', fog: 0.0013 });
    s.ground({ tex: 'tx_dirt', tile: 10, color: 0xb8a890 });
    const TZ = -402, VT = 17, TT = 12.9, LEN = 150;
    street(s, { z0: 90, z1: -300, width: 14, lanes: 4, fac: ['tx_fac_old', 'tx_brick'], height: [6, 11], lamps: 0, double: true }); s.road({ z0: -300, z1: -700, width: 14, lanes: 4, double: true });
    const steel = s.mat({ tex: 'tx_metal', color: 0x777777, metal: 0.6, rough: 0.5 });
    for (const dz of [-0.75, 0.75]) s.box({ x: 0, y: 0, z: TZ + dz, w: 700, h: 0.1, d: 0.12, mat: steel, cast: false });
    for (const sd of [-1, 1]) s.box({ x: sd * 182, y: 0, z: TZ, w: 350, h: 0.07, d: 4.4, mat: { tex: 'tx_dirt', color: 0x6a6258 }, cast: false });
    const lamps = []; for (const sd of [-1, 1]) { s.box({ x: sd * 8.2, y: 0, z: TZ + 5, w: 0.2, h: 4, d: 0.2, mat: s.mat({ color: 0xdddddd }) }); s.box({ x: sd * 8.2, y: 2.9, z: TZ + 5.15, w: 1.5, h: 0.5, d: 0.1, mat: s.mat({ color: 0x111111 }) }); for (const k of [-1, 1]) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 0.3, 0.2) })); b.position.set(sd * 8.2 + k * 0.45, 3.15, TZ + 5.25); s.scene.add(b); lamps.push(b); } }
    sign(s, 'RAILROAD CROSSING', { x: -8.2, y: 4.5, z: TZ + 5.3, w: 3.2, bg: '#eee', fg: '#111', size: 44 }); s.line({ x: 0, z: 24, w: 14, d: 0.5, color: 0xffffff, glow: 0.9 }); s.line({ x: 0, z: TZ + 9, w: 14, d: 0.5, color: 0xffffff, glow: 0.9 });
    // the freight: loco + wagons along X
    const tr = new THREE.Group(); tr.position.set(-9999, 0.1, TZ); s.scene.add(tr); const yel = s.mat({ color: 0xd9a400, rough: 0.5, metal: 0.3 }), dark = s.mat({ color: 0x1a1c20, rough: 0.6 });
    s.box({ parent: tr, x: -9.5, y: 0.9, z: 0, w: 19, h: 3.3, d: 3, mat: yel }); s.box({ parent: tr, x: -3, y: 4.2, z: 0, w: 4.4, h: 0.7, d: 2.9, mat: s.mat({ color: 0xb02018 }) }); s.box({ parent: tr, x: -9.5, y: 0.25, z: 0, w: 18, h: 0.7, d: 2.4, mat: dark });
    const hl = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 8, 6) })); hl.position.set(0.05, 3.4, 0); tr.add(hl);
    for (let i = 0; i < 8; i++) { const x = -20.4 - i * 16.2 - 7.5; s.box({ parent: tr, x, y: 1.0, z: 0, w: 15, h: 3.1, d: 2.9, mat: s.mat({ tex: 'tx_metal', color: [0x8a4a2a, 0x4a5a48, 0x6a3a30, 0x3f4a5a][i % 4], rough: 0.8 }), tile: 3 }); s.box({ parent: tr, x, y: 0.25, z: 0, w: 14, h: 0.8, d: 2.2, mat: dark }); }
    s.crew({ x: 8.6, z: 34, ry: 0.9 }); s.crew({ x: 11, z: TZ + 16, ry: 0.4, people: false });
    for (let x = -330; x <= 330; x += 44) { if (Math.abs(x) < 20) continue; s.box({ x, y: 0, z: TZ - 6, w: 0.25, h: 8, d: 0.25, mat: s.mat({ color: 0x4a3a2a }), cast: false }); s.box({ x, y: 7.2, z: TZ - 6, w: 0.15, h: 0.15, d: 2.4, mat: s.mat({ color: 0x4a3a2a }), cast: false }); }
    for (const [x, z, w, d, h] of [[-60, -470, 50, 30, 9], [70, -480, 60, 34, 11], [-90, -350, 40, 24, 8], [95, -345, 46, 26, 7], [40, -560, 30, 30, 14], [-45, -600, 44, 30, 10]]) s.building({ x, z, w, d, h, fac: 'tx_brick', solid: false });
    const car = s.car = new Drive(s, { kind: 'muscle', model: 'charger_dom', x: -2.6, z: 30, top: 400, accel: 0, airDrag: 0.0004, handbrake: false, grip: 6 });
    const mv = new Movers(s, car); const supra = mv.add({ model: 'supra', x: 2.6, z: 30, v: 0, nearMiss: false, msg: 'Traded paint with the Supra', hardK: 3, ai: (e, dt) => { if (s.started) e.v += (61 - e.v) * Math.min(1, dt * 0.195); } });
    const S = s.S = { g: 0, rpm: 0, shifts: [], TZ }; let bog = 0, bogK = 1, crossed = false, bell = 0;
    s.objective('Shift in the green — beat the Supra and the train');
    s.onUpdate((dt, t) => {
      const tt = s.started ? t - s.t0 : 0, front = -3.9 - VT * (TT - tt); tr.position.x = front;
      const on = s.started && Math.floor(t * 3) % 2; lamps.forEach((b, i) => { b.visible = !!(i % 2 ? on : !on); });
      if (!s.started) { s.hud.meter('rev', 'REV — 1st', 0, { zone: [0.81, 0.925], color: '#fc3' }); return; }
      bell -= dt; if (bell < 0 && !s.ended) { bell = 0.55; if (car.pos.z < TZ + 230) s.audio.bell(); if (tt > 5 && Math.random() < 0.22) s.audio.horn(210); }
      if (s.ended) return;
      // gearbox
      const g = S.g, rpm = S.rpm = clamp(car.v / GT[g], 0, 1.06); bog = Math.max(0, bog - dt);
      car.k.accel = car.v >= GT[g] ? 0 : GA[g] * (bog > 0 ? bogK : 1);
      if (s.input.hit('a') && g < 4 && !crossed) { const q = near(rpm, 0.93, 0.055, 0.3); S.shifts.push(q); S.g++; S.rpm = car.v / GT[S.g]; bog = 0.9; bogK = 0.45 + 0.55 * q; s.audio.tick(); s.msg(q > 0.9 ? 'PERFECT SHIFT' : rpm < 0.9 ? 'EARLY — BOGGED' : 'LATE', q > 0.9 ? 'small good' : 'small'); s.engine.addShake(0.2); }
      if (rpm >= 1 && g < 4 && Math.random() < 0.5) s.fx.sparks(V3(car.pos.x, 0.4, car.pos.z + 2.4), 2, { speed: 3 });
      const wp = g === 0 && car.inThr > 0.5 ? 0.17 * Math.sin(Math.PI * clamp(tt / 1.3)) : 0; car.pitchOverride = wp > 0.005 ? wp : null; car.mesh.position.y = -car.k.cg + Math.sin(wp) * 1.6;
      s.audio.set('veh', 'engine', 0.45 + rpm * 0.85, 0.6 + car.inThr * 0.4);
      s.hud.meter('rev', 'REV — ' + ['1st', '2nd', '3rd', '4th', '5th'][g], rpm / 1.06, { color: rpm > 0.985 ? '#f33' : rpm > 0.86 ? '#3f6' : '#fc3' });
      s.hud.readout('spd', 'MPH', Math.round(car.mph)); const lead = supra.z - car.pos.z; s.hud.readout('gap', lead >= 0 ? 'Ahead of Supra (m)' : 'Behind Supra (m)', Math.abs(lead).toFixed(0), lead >= 0 ? 'ok' : 'warn');
      if (!crossed) s.hud.readout('trn', 'Train at crossing in', Math.max(0, TT - tt).toFixed(1), TT - tt < 3 ? 'warn' : '');
      // the crossing
      const hl2 = car.k.len / 2, onTrack = car.pos.z - hl2 < TZ + 1.7 && car.pos.z + hl2 > TZ - 1.7;
      if (onTrack && !car.dead && front > car.pos.x - 1.1 && front - LEN < car.pos.x + 1.1) { s.audio.horn(180); return car.crash(front - car.pos.x < 6 ? 'The freight took the Charger clean off the crossing' : 'Drove into the side of the freight train', { injury: 1, fire: true }); }
      if (!crossed && front > 8 && car.pos.z > TZ + 4 && Math.abs(car.v) < 3) return s.fail('Bottled it — the train beat you to the crossing', { injury: 0 });
      if (!crossed && car.pos.z + hl2 < TZ - 1.7) {
        crossed = true; const margin = Math.max(0, (car.pos.x - 1.1 - front) / VT), sh = S.shifts.concat([0, 0, 0, 0]).slice(0, 4);
        s.rate('Gear shifts', sh.reduce((a, b) => a + b, 0) / 4, 2); s.rate(lead >= 0 ? `Beat the Supra by ${lead.toFixed(1)} m` : `Lost to the Supra by ${(-lead).toFixed(1)} m`, clamp(0.55 + lead / 14), 1.5); s.rate(`Run to the crossing (${tt.toFixed(2)}s)`, near(tt, 11.5, 0.3, 2), 1);
        s.bonus(`Cleared the train by ${margin.toFixed(2)}s`, Math.round(clamp(1 - margin / 2.2) * 3500)); s.msg(margin < 0.6 ? 'INCHES!' : 'ACROSS!', 'huge good'); s.audio.horn(180); s.slowmo(0.3, 1.4);
        s.cam.fixed(V3(car.pos.x + 5.5, 1.3, TZ - 36), () => ({ pos: car.pos, heading: 0 }), { fov: 38 }); s.wrap(2.6);
      }
    });
  },
  bot(s, inp) { const c = s.car, S = s.S; botDrive(c, inp, -2.6, 99); inp.y = 1; if (S.g < 4 && S.rpm >= 0.925) inp.press('a'); },
};

// --------------------------------------------------------------------------------------------- 4
const roadWarrior = {
  id: 'road_warrior', title: 'Last of the Tankers', film: 'Mad Max 2', year: 1981, tier: 4, pay: 14000, mode: 'drive', art: 'bd_wasteland', music: 'western',
  role: 'Driving the Mack tanker — and rolling it, on purpose, at speed',
  brief: 'You have the rig, they want the juice. Punt every raider you can reach off the road, then when you reach the flags, at fifty or better, haul the wheel over and put her on her side right in front of the cameras. We have one tanker. One.',
  tips: ['<b>Ram the raiders</b> — every one you send flying is money. Burnt-out wrecks and rocks are not raiders.', 'Ramming costs speed. You need <b>50 mph+</b> at the flags or she will not go over.', 'Inside the green zone: <b>hold A or D and hit SPACE</b> to roll the tanker. Closest to the centre line scores best.'],
  controls: `${K('W')} gas &nbsp; ${K('S')} brake &nbsp; ${K('A')}${K('D')} steer &nbsp; ${K('A')}/${K('D')} + ${K('SPACE')} roll the rig at the flags`, intro: { r: 22, h: 5, up: 2 },
  assets: { models: ['tanker', 'sedan_grey', 'wagon_brown', 'mach1', 'ww2_truck', 'enduro_bike', 'ch_biker', 'rock_desert'], tex: ['bd_wasteland', 'tx_sand', 'tx_dirt', 'tx_asphalt', 'tx_metal', 'tx_grass'] },
  build(s) {
    s.env('desert', { backdrop: 'bd_wasteland', look: 'wasteland', fog: 0.0024 });
    s.ground({ tex: 'tx_sand', tile: 12, color: 0xe0a878 }); const MZ = -800;
    s.road({ z0: 140, z1: -1300, width: 11, lanes: 2, mat: { tex: 'tx_asphalt', color: 0xb09880 }, markColor: 0xa89878, edges: false });
    s.forest('rock_desert', 70, r => [(r() < 0.5 ? -1 : 1) * (11 + r() * 80), 120 - r() * 1350], { h: [1.2, 5], solid: true, solidX: 26, msg: 'Piled the tanker into a rock', seedv: 4 });
    side(s, 'tree:dead', 60, 120, -1250, 9, 70, { h: [2.5, 5], seedv: 9 }); side(s, 'tree:bush', 90, 120, -1250, 7, 60, { h: [0.6, 1.4], seedv: 2 });
    const rust = s.mat({ tex: 'tx_metal', color: 0x7a4a30, rough: 0.9 }), black = s.mat({ color: 0x1c1a18, rough: 0.9 });
    for (const [x, z, id, ry] of [[6.3, -210, 'sedan_grey', 0.5], [-6.3, -390, 'wagon_brown', -0.6], [6.3, -570, 'sedan_grey', 2.6], [-6.6, -90, 'sedan_grey', 1.2], [6.8, -700, 'wagon_brown', 0.3]]) { const w = s.put(id, { x, z, ry, solid: true, hitScale: 0.7, sol: { msg: 'Buried the tanker in a burnt-out wreck', hardK: 0.6 } }); w.rotation.z = 0.12; s.box({ x, y: 1.1, z, w: 2.2, h: 0.5, d: 2.6, ry, mat: black }); }
    for (const sd of [-1, 1]) { for (const dz of [-30, 30]) { s.box({ x: sd * 6.4, y: 0, z: MZ + dz, w: 0.12, h: 4.2, d: 0.12, mat: black }); s.box({ x: sd * 6.4, y: 3.2, z: MZ + dz + 0.6, w: 0.05, h: 0.9, d: 1.2, mat: s.mat({ color: 0xd03020, side: true }) }); } s.box({ x: sd * 6.4, y: 0, z: MZ, w: 0.14, h: 5, d: 0.14, mat: black }); s.box({ x: sd * 6.4, y: 3.9, z: MZ + 0.7, w: 0.05, h: 1, d: 1.4, mat: s.mat({ color: 0xffe14a, side: true }) }); }
    const zone = s.line({ x: 0, z: MZ, w: 11, d: 60, color: 0x30ff70, glow: 0.8 }); zone.material.opacity = 0.1; s.line({ x: 0, z: MZ, w: 11, d: 0.8, color: 0xffe14a, glow: 1.6 });
    s.crew({ x: 9, z: 84, ry: 0.9 }); s.crew({ x: -10, z: MZ - 40, ry: 2.4, people: false }); s.crew({ x: 10, z: MZ - 24, ry: -2.3, people: false });
    const car = s.car = new Drive(s, { kind: 'truck', model: 'tanker', x: 0, z: 92, top: 36, accel: 6.2, crashV: 26, handbrake: false, cam: { dist: 21, height: 6.4, ahead: 8 } }); car.dustColor = [0.85, 0.62, 0.42]; car.k.dusty = true;
    // raiders: weak movers that fling when rammed
    const mv = new Movers(s, car); const S = s.S = { MZ, raiders: [], rammed: 0, rolled: false }; const N = 9;
    for (let i = 0; i < N; i++) {
      const g = new THREE.Group(), bike = i % 3 === 2, m = model(bike ? 'enduro_bike' : ['mach1', 'sedan_grey', 'wagon_brown', 'ww2_truck'][i % 4]); g.add(m); const sz = m.userData.size; g.userData.size = bike ? V3(1, 1.6, sz.z) : sz.clone();
      if (bike) { const r = s.char('ch_roadwarrior', { parent: g, x: 0, y: 0.03, z: 0.28 }); r.setPose('bike', 0); }
      else { s.box({ parent: g, x: 0, y: sz.y * 0.55, z: -sz.z / 2 - 0.15, w: sz.x * 0.95, h: 0.5, d: 0.3, mat: rust }); s.box({ parent: g, x: 0, y: sz.y, z: 0.3, w: sz.x * 0.7, h: 0.5, d: sz.z * 0.4, mat: black }); for (const k of [-1, 1]) s.box({ parent: g, x: k * sz.x * 0.5, y: sz.y * 0.5, z: 0, w: 0.08, h: 0.35, d: sz.z * 0.8, mat: rust }); }
      const bx = [-2.2, 1.8, 0, 2.4, -1.6, 0.6, -2.4, 2, -0.5][i], ph = i * 1.7, cruise = 12 + (i % 3) * 2.5;
      const e = mv.add({ obj: g, z: -70 - i * 72, path: z => bx + Math.sin(z * 0.035 + ph) * 0.8, v: 0, type: 'weak', nearMiss: false, on: () => { mv.fling(e, 5 + rnd(4)); e.v = Math.abs(car.v) * 1.15; S.rammed++; s.bonus('Raiders rammed', 450); s.msg(['PUNTED!', 'OFF THE ROAD!', 'SCRAP!'][S.rammed % 3], 'small good'); s.audio.crash(); s.engine.addShake(0.7); s.fx.debris(e.m.position, 16, { color: 0x553322, speed: 10 }); if (S.rammed % 3 === 0) s.fx.explosion(e.m.position, 0.8); },
        ai: (ee, dt) => { if (!s.started || ee.free) return; const gap = car.pos.z - ee.z; ee.v += ((gap < 130 && gap > -30 ? cruise : 0) - ee.v) * Math.min(1, dt * 1.5); if (ee.v > 5 && Math.random() < 0.3) s.fx.dust(ee.m.position, 1, { color: car.dustColor, size: 1.6 }); } });
      e.sol.minV = 7; e.sol.slow = 0.955; S.raiders.push(e);
    }
    s.rate('Rig in one piece', 1, 0.6); car.onHit = () => dock(s, 'Rig in one piece', 0.25); s.objective('Ram the raiders off the road');
    s.onUpdate(() => {
      if (!s.started || s.ended || S.rolled) return; const d = car.pos.z - MZ, mph = car.mph;
      s.hud.readout('spd', 'MPH', Math.round(mph), d < 260 ? (mph >= 50 ? 'ok' : 'warn') : ''); s.hud.readout('ram', 'Raiders rammed', S.rammed + '/' + N, S.rammed >= 6 ? 'ok' : ''); s.hud.readout('mk', 'Mark (m)', Math.round(d), Math.abs(d) < 30 ? 'ok' : '');
      if (d < 200) { s.objective('50 mph+ — roll her in the green zone'); s.hud.prompt(Math.abs(d) < 34 ? `${K('A')}/${K('D')} + ${K('SPACE')} — ROLL IT NOW` : `Roll her between the flags`); }
      if (d < -36) { S.rolled = true; s.hud.prompt(''); return s.fail('Drove straight through the mark — the tanker never went over', { injury: 0 }); }
      if (!s.input.hit('a')) return;
      if (d > 75) return s.msg('NOT YET', 'small'); if (Math.abs(s.input.x) < 0.4) return s.msg('YANK THE WHEEL TOO', 'small');
      S.rolled = true; s.hud.prompt('');
      if (d > 34) return s.fail(`Rolled her ${Math.round(d - 30)} m before the flags — three cameras pointing at empty road`, { injury: 0.3 });
      if (mph < 45) return s.fail(`Only ${mph.toFixed(0)} mph — the rig leaned, thought about it, and sat back down`, { injury: 0.05 });
      const dir = s.input.x < 0 ? 1 : -1, v0 = Math.abs(car.v); car.heading += dir * 0.3; s.slowmo(0.45, 1.8); s.audio.crash(); s.cam.set({ dist: 26, height: 7, side: -dir * 11, stiff: 3 }); s.msg('OVER SHE GOES', 'good'); s.objective('');
      tumble(s, car, { rollRate: -dir * rateFor(1.25, v0, 6.5), decel: 6.5, hop: 0.5, onDone: () => {
        s.rate(`Speed at the roll (${mph.toFixed(0)} mph)`, clamp((mph - 42) / 18), 1.2); s.rate('Hit the mark', near(Math.abs(d), 0, 6, 34), 1.5); s.rate(`Raiders rammed (${S.rammed}/${N})`, clamp(S.rammed / 6), 1.3);
        s.fx.smokePuff(car.pos, 16, { size: 3, up: 5 }); s.wrap(1.8);
      } });
    });
  },
  bot(s, inp) {
    const c = s.car, S = s.S, d = c.pos.z - S.MZ; let tx = 0, best = 1e9;
    for (const e of S.raiders) { if (!e.alive) continue; const dz = c.pos.z - e.z; if (dz > -2 && dz < 80 && dz < best) { best = dz; tx = e.m.position.x; } }
    botDrive(c, inp, clamp(tx, -2.2, 2.2), 99, 0.09); if (d < 40) botDrive(c, inp, 0, 99, 0.09); if (d < 5) { inp.x = -1; inp.press('a'); }
  },
};

// --------------------------------------------------------------------------------------------- 5
const darkKnight = {
  id: 'dark_knight', title: 'Eighteen Wheels Over', film: 'The Dark Knight', year: 2008, tier: 5, pay: 24000, mode: 'drive', art: 'bd_gotham', music: 'tension',
  role: 'Driving the clown’s eighteen-wheeler — to be flipped end over end, for real, in the financial district',
  brief: 'No miniatures, no computers. There is a steam piston under the trailer and a bank on either side. Forty-seven miles an hour, dead on the centre line, and you fire on the mark. Get it right and she goes straight over. Get it wrong and we buy a bank.',
  tips: ['Hold <b>45–50 mph</b>. Slower and she will not go over; faster and she corkscrews.', 'Keep the cab <b>on the centre line</b> — the trailer snakes, so keep correcting. More than a metre off is a write-off.', 'Fire the piston with <b>SPACE</b> exactly on the glowing mark.'],
  controls: `${K('W')} gas &nbsp; ${K('S')} brake &nbsp; ${K('A')}${K('D')} steer &nbsp; ${K('SPACE')} fire the piston`, intro: { r: 24, h: 5, up: 2 },
  assets: { models: ['joker_truck', 'police_car', 'street_lamp'], tex: ['bd_gotham', 'tx_asphalt', 'tx_fac_night', 'tx_concrete', 'tx_roof'] },
  build(s) {
    s.env('night', { backdrop: 'bd_gotham', look: 'night', fog: 0.003, amb: 0.6, lookOver: { bloom: 1.0 } });
    s.ground({ tex: 'tx_asphalt', tile: 10, color: 0x40444c, rough: 0.3 }); const MZ = -440, WIN = 6, PERF = 1.3;
    street(s, { z0: 100, z1: -660, width: 16, lanes: 4, fac: ['tx_fac_night'], height: [55, 140], lit: 1.3, lamps: 64, double: true, roadMat: { tex: 'tx_asphalt', rough: 0.2, metal: 0.4, color: 0x59606c }, depth: [22, 30], bwidth: [24, 42], facTile: 26 });
    s.line({ x: 0, z: MZ, w: 16, d: 0.9, color: 0x60c8ff, glow: 2.4 }); for (const sd of [-1, 1]) for (const dz of [0, 30, 60]) s.light({ x: sd * 7.6, y: 0.25, z: MZ + dz, color: dz ? 0xff7030 : 0x60c8ff, i: 14, dist: 12, r: 0.12 });
    for (let z = 20; z > MZ - 60; z -= 9) s.line({ x: 0, z, w: 0.14, d: 4, color: 0xffe14a, glow: 0.8 });
    for (const [x, z, ry] of [[-6.6, -120, 0.25], [6.7, -250, -0.3], [-6.7, -380, 0.2], [6.6, -520, 2.9]]) { s.put('police_car', { x, z, ry, solid: true, sol: { msg: 'Flattened a Gotham PD cruiser' } }); s.light({ x, y: 1.75, z, color: x < 0 ? 0x3050ff : 0xff2020, i: 26, dist: 20, r: 0.14 }); }
    s.crew({ x: 7.2, z: 44, ry: 0.9, light: 200 }); s.crew({ x: -7.3, z: MZ - 46, ry: 2.5, people: false, light: 260 }); s.crew({ x: 7.3, z: MZ - 30, ry: -2.5, people: false });
    const car = s.car = new Drive(s, { kind: 'truck', model: 'joker_truck', x: 0, z: 54, top: 31, accel: 5.4, handbrake: false, cam: { dist: 21, height: 7.5, ahead: 10 } }); headlights(car, 700);
    const S = s.S = { MZ, fired: false }; let good = 0, tot = 0, ph = rnd(6); s.objective('45–50 mph, dead centre, fire on the mark');
    const jack = why => { const dir = car.pos.x >= 0 ? -1 : 1; car.heading += dir * 0.55; car.crash(why, { injury: 0.65 }); };
    s.onUpdate((dt, t) => {
      if (!s.started || s.ended || S.fired) return; const d = car.pos.z - MZ, mph = car.mph, off = Math.abs(car.pos.x), tt = t - s.t0;
      if (car.grounded && car.v > 6) car.heading += (Math.sin(tt * 1.1 + ph) * 0.045 + Math.sin(tt * 2.7 + ph * 2) * 0.03) * dt * clamp(car.v / 20); // the trailer snakes
      const okV = mph >= 45 && mph <= 50, okX = off < 0.7; if (d < 250 && d > 0) { tot += dt; if (okV && okX) good += dt; }
      s.hud.readout('spd', 'MPH', mph.toFixed(0), okV ? 'ok' : d < 250 ? 'warn' : ''); s.hud.readout('ctr', 'Off centre (m)', off.toFixed(1), okX ? 'ok' : 'warn');
      if (d < 90) { s.hud.bar((75 - d) / 90, [(75 - WIN) / 90, (75 + WIN) / 90], [(75 - PERF) / 90, (75 + PERF) / 90]); s.hud.prompt(`${K('SPACE')} fire the piston on the mark`); }
      if (d < -WIN - 4) { S.fired = true; s.hud.hideBar(); s.hud.prompt(''); return s.fail('Drove straight over the mark with the piston unfired', { injury: 0 }); }
      if (!s.input.hit('a') || d > 120) return;
      S.fired = true; s.hud.hideBar(); s.hud.prompt(''); const p = V3(car.pos.x, 0.4, car.pos.z + 5);
      s.fx.explosion(p, 0.7); s.fx.smokePuff(p, 24, { color: [0.85, 0.85, 0.9], size: 3.5, up: 9, life: 3 }); s.audio.explosion(0.9); s.engine.addShake(1.4);
      if (Math.abs(d) > WIN) return jack(`Piston fired ${Math.abs(d).toFixed(0)} m ${d > 0 ? 'early' : 'late'} — she jackknifed into the bank`);
      if (off > 1.2) return jack(`${off.toFixed(1)} m off the centre line — the trailer went over sideways and through a shop front`);
      if (mph < 41) return s.fail(`Only ${mph.toFixed(0)} mph — the trailer lifted, hung there, and dropped back on its wheels`, { injury: 0.1 });
      if (mph > 54) return jack(`${mph.toFixed(0)} mph is too hot — she corkscrewed into the building`);
      const v0 = Math.abs(car.v); s.slowmo(0.35, 2.8); s.cam.set({ dist: 30, height: 5, side: 13, stiff: 3 }); s.msg('SHE’S GOING OVER', 'good'); s.objective('');
      tumble(s, car, { pitchRate: rateFor(0.5, v0, 6), fwd: true, decel: 6, hop: 0, onDone: () => {
        s.rate(`Speed (${mph.toFixed(0)} mph)`, near(mph, 47.5, 2.5, 8), 1.2); s.rate(`Centre line (${off.toFixed(2)} m off)`, near(off, 0, 0.25, 1.2), 1.3); s.rate('Piston timing', near(Math.abs(d), 0, PERF, WIN), 1.5); s.rate('Approach discipline', clamp(good / Math.max(1, tot) / 0.8), 1);
        s.engine.addShake(1.5); s.audio.crash(); s.fx.sparks(car.pos, 60, { speed: 12 }); s.fx.smokePuff(car.pos, 20, { size: 3 }); s.msg('ON ITS ROOF!', 'huge good'); s.wrap(2.0, 'First take. Nobody breathe on that truck.');
      } });
    });
  },
  bot(s, inp) { const c = s.car, d = c.pos.z - s.S.MZ; botDrive(c, inp, 0, 20.9, 0.16); if (c.v > 21.5) inp.y = 0; if (d < 0.25) inp.press('a'); },
};

// --------------------------------------------------------------------------------------------- 6
const superCop = {
  id: 'supercop', title: 'Catching the Freight', film: 'Police Story 3: Supercop', year: 1992, tier: 5, pay: 22000, mode: 'drive', art: 'bd_kl', music: 'kungfu',
  role: 'Doubling the Inspector — dirt bike onto the roof of a moving train. No wires, no second bike',
  brief: 'The train does not stop and neither do you. Ride alongside, pick your wagon, hit the dirt ramp and steer the bike across onto the roof. Land in the gap between two wagons and that is the end of the picture.',
  tips: ['<b>Match the train</b> — arrive at the ramp a touch faster than it, level with a wagon, not a gap. Watch the <b>landing spot</b> meter.', 'In the air, steer <b>left</b> with A to carry the bike over the roof, then straighten or you go off the far side.', 'Once you are down, <b>brake to train speed</b> and stay on the roof for a second and a half.'],
  controls: `${K('W')} gas &nbsp; ${K('S')} brake &nbsp; ${K('A')}${K('D')} steer — also in the air &nbsp; airborne ${K('W')}/${K('S')} nose up/down`, intro: { r: 8, h: 2.4 },
  assets: { models: ['enduro_bike', 'ch_agent'], tex: ['bd_kl', 'tx_grass', 'tx_dirt', 'tx_metal', 'tx_wood', 'tx_jungle_floor', 'tx_roof'] },
  build(s) {
    s.env('day', { backdrop: 'bd_kl', look: 'jungle', fog: 0.0022, hz: 0.45 });
    s.ground({ tex: 'tx_jungle_floor', tile: 8, color: 0xc8d0b0 });
    const TX = -5.6, RY = 3.5, VT = 20, RZ = -360, WL = 14, GAP = 1.6, HW = 1.6;
    s.road({ z0: 140, z1: -1100, width: 6.4, mat: { tex: 'tx_dirt', color: 0xc9a074 }, marks: false });
    s.box({ x: TX, y: 0, z: -480, w: 4.6, h: 0.22, d: 1300, mat: { tex: 'tx_dirt', color: 0x6a6660 }, tile: 4, cast: false }); const steel = s.mat({ tex: 'tx_metal', color: 0x888888, metal: 0.6, rough: 0.5 }); for (const dx of [-0.72, 0.72]) s.box({ x: TX + dx, y: 0.22, z: -480, w: 0.1, h: 0.12, d: 1300, mat: steel, cast: false });
    s.slope({ x: 0.2, w: 4.6, z0: RZ, z1: RZ - 16, y0: 0, y1: 4.2, curve: 1.5, mat: { tex: 'tx_dirt', rep: 0.15, color: 0xb98a5a } }); s.line({ x: 0.2, z: RZ + 1, w: 4.6, d: 0.5, color: 0xffe14a });
    side(s, 'tree:palm', 120, 130, -1050, 6, 60, { sd: 1, h: [7, 13], seedv: 3 }); side(s, 'tree:jungle', 150, 130, -1050, 14, 90, { sd: 1, h: [9, 17], seedv: 7 }); side(s, 'tree:jungle', 200, 130, -1050, 10, 90, { sd: -1, h: [9, 18], seedv: 11 }); side(s, 'tree:bush', 120, 130, -1050, 4.6, 40, { sd: 1, h: [0.8, 2], seedv: 5 });
    const wood = s.mat({ tex: 'tx_wood', color: 0xa08660 }); for (const [x, z] of [[9, 20], [11, -120], [9.5, -250], [10, -470]]) { s.box({ x, y: 0.8, z, w: 5, h: 2.4, d: 6, mat: wood }); s.box({ x, y: 3.2, z, w: 6.4, h: 0.3, d: 7.4, mat: s.mat({ tex: 'tx_roof', color: 0x8a5a40 }) }); for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) s.box({ x: x + a * 2.3, y: 0, z: z + b * 2.8, w: 0.2, h: 0.8, d: 0.2, mat: wood }); }
    s.rate('Clean approach', 1, 0.6);
    for (const [x, z] of [[-1.3, -70], [1.5, -135], [-1.2, -200], [1.6, -262], [-1.4, -310]]) for (const [dx, dy] of [[0, 0], [0.75, 0], [0.35, 0.7]]) s.box({ x: x + dx, y: dy, z, w: 0.7, h: 0.7, d: 0.7, mat: wood, solid: 'break', sol: { debris: 0xa08660, slow: 0.93, on: () => { dock(s, 'Clean approach', 0.12); } } });
    s.crew({ x: 5, z: 44, ry: 1.0 }); s.crew({ x: 6, z: RZ - 26, ry: 2.2, people: false });
    // the freight: loco + wagons, each with a moving roof deck
    const tr = new THREE.Group(); s.scene.add(tr); const body = [s.mat({ tex: 'tx_metal', color: 0x7a4a34, rough: 0.8 }), s.mat({ tex: 'tx_metal', color: 0x4a6a58, rough: 0.8 }), s.mat({ tex: 'tx_metal', color: 0x8a7a50, rough: 0.8 })], dark = s.mat({ color: 0x1a1c1e, rough: 0.7 }), roofM = s.mat({ tex: 'tx_metal', color: 0xb0b4b0, rough: 0.6 });
    const cars = []; s.box({ parent: tr, x: 0, y: 0.9, z: 8, w: 3.1, h: 2.9, d: 16, mat: s.mat({ color: 0x2f5fa0, rough: 0.5 }) }); s.box({ parent: tr, x: 0, y: 0.3, z: 8, w: 2.5, h: 0.6, d: 15, mat: dark }); s.box({ parent: tr, x: 0, y: 3.2, z: 12, w: 3.0, h: 0.5, d: 6, mat: s.mat({ color: 0xe0d040 }) });
    for (let i = 0; i < 10; i++) { const a = 16 + GAP + i * (WL + GAP); cars.push({ a, b: a + WL }); s.box({ parent: tr, x: 0, y: 0.9, z: a + WL / 2, w: 3.1, h: RY - 1.02, d: WL, mat: body[i % 3], tile: 3 }); s.box({ parent: tr, x: 0, y: RY - 0.12, z: a + WL / 2, w: 3.2, h: 0.12, d: WL, mat: roofM, tile: 3 }); s.box({ parent: tr, x: 0, y: 0.3, z: a + WL / 2, w: 2.4, h: 0.6, d: WL - 1, mat: dark }); }
    const END = cars[cars.length - 1].b, T = s.T = { front: 28, v: 0, cars, TX, RY, VT, RZ, WL }; cars.forEach(c => { c.piece = s.course.addPiece({ x0: TX - HW, x1: TX + HW, z0: 0, z1: 0, fn: () => RY, step: 0.7 }); });
    const sol = s.course.addSolid({ x0: TX - HW, x1: TX + HW, y0: 0, y1: RY - 0.35, z0: 0, z1: 0, msg: 'Slammed into the side of the freight train', hardK: 0.4 });
    const place = () => { tr.position.set(TX, 0, T.front); for (const c of cars) { c.piece.z0 = T.front + c.a; c.piece.z1 = T.front + c.b; } sol.z0 = T.front; sol.z1 = T.front + END; sol.vz = -T.v; }; place();
    const b = s.car = new Drive(s, { kind: 'bike', model: 'enduro_bike', driver: 'ch_hk', driverPos: [0, -0.52, 0.28], x: 0.4, z: 40, top: 40, slopeK: 0.15, pitchTol: 0.8, rollTol: 1.3, hard: 15, handbrake: false, cam: { dist: 6.6, height: 2.7 } }); b.dustColor = [0.7, 0.55, 0.38]; b.k.dusty = true;
    // where would the bike come down if it took off now? (fraction along a wagon roof, or -1 for a gap)
    T.spot = (airT = 1.4) => { const rel = b.pos.z - T.front - (Math.abs(b.v) - T.v) * (airT + Math.max(0, b.pos.z - (RZ - 16)) / Math.max(8, Math.abs(b.v))); for (let i = 0; i < cars.length; i++) if (rel >= cars[i].a && rel <= cars[i].b) return { i, f: (rel - cars[i].a) / WL, rel }; return { i: -1, f: -1, rel }; };
    let jumped = false, landed = false, roofT = 0, landX = 0, done = false; s.objective('Ride alongside — pick a wagon');
    b.onAir = t => { if (t.z < RZ - 10 && !jumped) { jumped = true; s.slowmo(0.5, 1.2); s.msg('STEER LEFT!', 'small'); s.objective('Steer onto the roof'); } };
    b.onLand = i => {
      if (!jumped || landed) return; if (b.pos.y > RY - 0.6) { landed = true; landX = Math.abs(b.pos.x - TX); s.rate('Landing', i.clean, 1.5); s.rate('Middle of the roof', near(landX, 0, 0.35, 1.5), 1); s.msg('ON THE TRAIN!', 'good'); s.objective('Brake to train speed — stay on the roof'); return true; }
      const rel = b.pos.z - T.front, over = Math.abs(b.pos.x - TX) < HW + 0.6 && rel > 0 && rel < END; const gap = !cars.some(c => rel > c.a - 0.3 && rel < c.b + 0.3); b.crash(over ? (gap ? 'Came down in the gap between two wagons' : 'Came up short and bounced off the side of the wagon') : b.pos.x < TX ? 'Overshot the roof and went off the far side of the train' : rel < 0 ? 'Jumped ahead of the train — nothing there to land on' : 'Missed the train and landed in the dirt', { injury: over ? 0.95 : 0.55 }); return true;
    };
    s.onUpdate((dt, t) => {
      if (s.started) { T.v += (VT - T.v) * Math.min(1, dt * 0.55); T.front -= T.v * dt; } place(); if (!s.started || s.ended) return;
      s.audio.set('train', 'rumble', 0.7, clamp(1 - Math.abs(b.pos.x - TX) / 40) * 0.5);
      if (!b.grounded && jumped && !landed) { b.vel.x += s.input.x * 12 * dt; b.vel.x *= 1 - dt * 0.6; b.roll = clamp(b.roll, -0.3, 0.3); }
      s.hud.readout('spd', 'MPH', Math.round(b.mph)); s.hud.readout('trn', 'Train MPH', Math.round(T.v * 2.237));
      if (!jumped) { const sp = T.spot(); s.hud.meter('spot', sp.i < 0 ? 'Landing spot — GAP!' : 'Landing spot on wagon ' + (sp.i + 1), sp.i < 0 ? 0 : sp.f, { zone: [0.25, 0.8], color: sp.i >= 0 && sp.f > 0.25 && sp.f < 0.8 ? '#3f6' : '#f55' }); if (T.front + END < b.pos.z - 25) return s.fail('The train got away from you', { injury: 0 }); if (b.pos.z < RZ - 40) return s.fail('Rode round the ramp — the train is leaving without you', { injury: 0 }); }
      if (landed && !done) {
        if (b.pos.y < RY - 1.2) { done = true; return b.crash(Math.abs(b.pos.x - TX) > HW ? 'Rode off the side of the roof' : 'Dropped between the wagons', { injury: 0.9 }); }
        if (b.grounded) roofT += dt; s.hud.readout('roof', 'On the roof (s)', roofT.toFixed(1), 'ok');
        if (roofT >= 1.5) { done = true; s.rate('Matched the train', near(Math.abs(b.v) - T.v, 0, 1.5, 9), 1); s.bonus('Roof ride', 1500); s.msg('CUT! PRINT IT!', 'huge good'); s.wrap(1.6); }
      }
    });
  },
  bot(s, inp, B) {
    const b = s.car, T = s.T;
    if (!b.grounded) { inp.x = clamp((T.TX - b.pos.x) * 0.9 - b.vel.x * 0.42, -1, 1); inp.y = b.pitch > 0.06 ? -0.35 : 0.7; return; }
    if (b.pos.y > 2 && b.pos.z < T.RZ - 16) { const rel = b.pos.z - T.front; let c = T.cars[0]; for (const k of T.cars) if (Math.abs((k.a + k.b) / 2 - rel) < Math.abs((c.a + c.b) / 2 - rel)) c = k; botDrive(b, inp, T.TX, clamp(T.v + (rel - (c.a + c.b) / 2) * 0.9, 12, 30), 0.1); return; }
    const sp = T.spot(); if (B.w == null && b.pos.z < -40) B.w = Math.max(1, Math.min(8, sp.i < 0 ? 3 : sp.i)); const c = T.cars[B.w ?? 3], err = sp.rel - (c.a + T.WL * 0.5);
    botDrive(b, inp, b.pos.z > T.RZ + 60 ? 0.3 + (Math.sin(b.pos.z * 0.05) > 0 ? 0.15 : -0.1) : 0.2, clamp(T.v + 2.4 + err * 0.7, 6, 34), 0.1); if (b.pos.z < T.RZ + 2) { inp.y = b.v < T.v + 2.4 ? 1 : 0; inp.x *= 0.3; }
  },
};

// --------------------------------------------------------------------------------------------- 7
const furious7 = {
  id: 'furious7', title: 'Cars Don’t Fly', film: 'Furious 7', year: 2015, tier: 6, pay: 60000, mode: 'drive', art: 'bd_abudhabi', music: 'epic',
  role: 'Driving a $3.4 million Lykan HyperSport between three skyscrapers, forty-five floors up',
  brief: 'Penthouse party, tower one. You floor it across the marble, through the window, into tower two — where you will discover the brakes have gone. So you keep your foot in and jump again. Tower three has an art exhibition. Use it.',
  tips: ['Slalom the pillars and hit the first window at <b>75 mph or more</b>. Less, and you do not reach tower two.', 'In the air <b>hold W</b> to keep the nose up. In tower two there are <b>no brakes</b> — dodge the pillar and floor it for the next jump.', 'In tower three, <b>drive into the crates and sofas</b> to scrub speed. Miss them and you leave through the far window.'],
  controls: `${K('W')} gas &nbsp; ${K('S')} brake (while it lasts) &nbsp; ${K('A')}${K('D')} steer &nbsp; airborne ${K('W')} nose up`, intro: { r: 9, h: 2.4 },
  assets: { models: ['lykan'], tex: ['bd_abudhabi', 'tx_glass_tower', 'tx_concrete', 'tx_roof', 'tx_fac_office', 'tx_hotel', 'tx_wood'] },
  build(s) {
    s.env('day', { backdrop: 'bd_abudhabi', look: 'teal_orange', fog: 0.0005, hz: 0.5, shadowSize: 90 });
    s.ground({ tex: 'tx_concrete', tile: 30, color: 0xd8c8a8 });
    const YA = 200, YB = 191, YC = 183, W = 40, AX = 0, BX = 1, CX = 1, A0 = 34, A1 = -170, B0 = -215, B1 = -335, C0 = -370, C1 = -476;
    const marble = { tex: 'tx_concrete', color: 0xf4ecda, rough: 0.14, metal: 0.2 }, glass = s.mat({ glass: true, color: 0xa8d8e8, opacity: 0.28 }), white = s.mat({ color: 0xf4f0e8, rough: 0.5 }), gold = s.mat({ color: 0xc9a040, metal: 0.8, rough: 0.3 });
    const tower = (x, z0, z1, y, room, up, msg) => {
      const zc = (z0 + z1) / 2, d = z0 - z1; s.building({ x, z: zc, w: W, d, h: y, fac: 'tx_glass_tower', facTile: 22, top: true, roofMat: marble, roofTile: 5, sol: { msg } });
      s.box({ x, y: y + room, z: zc, w: W, h: 0.5, d, mat: white, cast: false }); s.building({ x, z: zc, w: W, d, h: up, y: y + room + 0.5, fac: 'tx_glass_tower', facTile: 22, cast: false, sol: { msg: 'Too high — hit the floor above the windows' } });
      for (const sd of [-1, 1]) s.box({ x: x + sd * (W / 2 - 0.15), y, z: zc, w: 0.3, h: room, d, mat: glass, cast: false, solid: true, sol: { msg: 'Went out through the side windows' } });
      for (let k = 0; k < 4; k++) s.light({ x, y: y + room - 0.3, z: z0 - (k + 0.5) * d / 4, color: 0xfff0d8, i: 50, dist: 40, r: 0.5, glow: 2 });
    };
    const windows = (x, z, y, h, tag) => { for (let k = 0; k < 5; k++) s.box({ x: x - W / 2 + 4 + k * 8, y, z, w: 8, h, d: 0.25, mat: glass, cast: false, solid: 'break', sol: { glass: true, slow: 0.985, on: () => { if (!S['w' + tag]) { S['w' + tag] = 1; s.bonus('Windows', 400); s.engine.addShake(0.6); } } } }); };
    const pillar = (x, z, y, h, msg = 'Wrapped a $3.4 million Lykan round a marble pillar') => s.box({ x, y, z, w: 1.4, h, d: 1.4, mat: s.mat({ tex: 'tx_concrete', color: 0xe8dcc4, rough: 0.2 }), solid: true, sol: { msg, hardK: 0.8 } });
    const S = s.S = { YA, YB, YC, A1, B0, B1, C0, C1, pil: [] }; const race = (x, z, y, h) => { S.pil.push([x, z]); pillar(x, z, y, h); };
    // tower one — the penthouse
    tower(AX, A0, A1, YA, 5.6, 34, ''); windows(AX, A1 + 0.3, YA, 5.6, 'a');
    for (const [x, z] of [[1.3, -18], [-1.3, -52], [1.3, -86], [-1.3, -120], [1.3, -150]]) race(AX + x, z, YA, 5.6); for (const z of [-18, -52, -86, -120, -150]) for (const x of [-11, 11]) pillar(AX + x, z, YA, 5.6);
    for (const [x, z, w, d] of [[-8, 4, 3, 1.2], [8, -8, 1.2, 3], [-7, -36, 3, 1.2], [8, -68, 3, 1.4], [-8, -76, 1.2, 3], [7, -104, 3, 1.2], [-7, -136, 1.2, 3], [6, -160, 3, 1.2]]) s.box({ x, y: YA, z, w, h: 0.8, d, mat: white, solid: 'break', sol: { debris: 0xf4f0e8, slow: 0.9 } });
    s.box({ x: 0, y: YA, z: A0 - 0.3, w: W, h: 5.6, d: 0.4, mat: { tex: 'tx_hotel', color: 0xd8c8b0 }, solid: true }); s.crew({ x: 7, z: 22, y: YA, ry: 1.0 });
    // tower two — the gallery, double height
    tower(BX, B0, B1, YB, 10, 26, 'Came up short and hit tower two below the windows'); windows(BX, B0 - 0.3, YB, 10, 'b'); windows(BX, B1 + 0.3, YB, 10, 'c');
    race(BX - 2.1, -268, YB, 10); race(BX + 1.4, -306, YB, 10); for (const z of [-240, -268, -306]) for (const x of [-11, 11]) pillar(BX + x, z, YB, 10);
    for (const [x, z] of [[-7, -250], [6, -262], [-6, -290], [7, -318]]) { s.box({ x: BX + x, y: YB, z, w: 1, h: 0.9, d: 1, mat: white, solid: 'break', sol: { debris: 0xf4f0e8, slow: 0.85 } }); s.box({ x: BX + x, y: YB + 0.9, z, w: 0.5, h: 1.5, d: 0.5, mat: gold }); }
    // tower three — the exhibition you stop in
    tower(CX, C0, C1, YC, 9, 24, 'Came up short and hit tower three below the windows'); windows(CX, C0 - 0.3, YC, 9, 'd'); windows(CX, C1 + 0.3, YC, 9, 'e');
    const crate = s.mat({ tex: 'tx_wood', color: 0xb89868 }), sofa = s.mat({ color: 0x7a2030, rough: 0.9 }); S.stuff = 0;
    for (let i = 0; i < 9; i++) { const z = C0 - 30 - i * 7.5, cx = CX + (i % 2 ? 1.5 : -1.5); for (let k = 0; k < 3; k++) s.box({ x: cx + (k - 1) * 1.7, y: YC, z, w: 1.6, h: i % 3 === 1 ? 0.9 : 1.5, d: 1.5, mat: i % 3 === 1 ? sofa : crate, solid: 'break', sol: { debris: i % 3 === 1 ? 0x7a2030 : 0xb89868, slow: 0.905, on: () => { S.stuff++; } } }); }
    s.crew({ x: CX + 12, z: C1 + 12, y: YC, ry: -2.4, people: false });
    // the rest of the skyline
    srand(31); for (let i = 0; i < 16; i++) { const a = i / 16 * 6.28, r = sr(130, 380), h = sr(70, 240); s.building({ x: Math.cos(a) * r, z: -230 + Math.sin(a) * r * 1.3, w: sr(26, 44), d: sr(26, 44), h, fac: i % 3 ? 'tx_glass_tower' : 'tx_fac_office', facTile: 22, solid: false, cast: false }); }
    const car = s.car = new Drive(s, { kind: 'super', model: 'lykan', x: -1.1, z: 24, y: YA, top: 60, accel: 9.5, hard: 13, pitchTol: 0.75, air: 0.36, handbrake: false, cam: { dist: 6.8, height: 2.1, ground: false } });
    let stage = 0, hitsOk = true; s.rate('Bodywork', 1, 1); car.onHit = () => dock(s, 'Bodywork', 0.25); s.objective('Floor it — 75 mph+ through the window');
    car.onAir = t => { if (stage === 0 && t.z < A1 + 4) { stage = 1; s.rate(`Launch speed (${car.mph.toFixed(0)} mph)`, near(car.mph, 104, 10, 34), 1.2); s.slowmo(0.35, 1.5); s.msg(Math.round(car.mph) + ' MPH', 'good'); s.objective('Hold W — nose up'); } else if (stage === 2 && t.z < B1 + 4) { stage = 3; s.slowmo(0.35, 1.4); s.msg('AGAIN!', 'good'); } };
    car.onLand = i => {
      if (stage === 1 && car.pos.y > YB - 1 && car.pos.z < B0 + 2) { stage = 2; s.rate('Landing — tower two', i.clean, 1.2); s.bonus('Air: ' + ftOf(i.dist) + ' ft', Math.round(i.dist * 25)); car.k.brake = 0; car.k.reverse = false; s.msg('NO BRAKES!', 'bad'); s.objective('No brakes — floor it and jump again'); }
      else if (stage === 3 && car.pos.y > YC - 1 && car.pos.z < C0 + 2) { stage = 4; s.rate('Landing — tower three', i.clean, 1.2); s.bonus('Second jump: ' + ftOf(i.dist) + ' ft', Math.round(i.dist * 25)); car.k.rollDrag = 3.2; car.throttleLock = 0; s.objective('Hit the crates to stop!'); }
    };
    s.onUpdate(() => {
      if (!s.started || s.ended) return; const z = car.pos.z, y = car.pos.y, fl = z > A1 - 2 ? YA : z > B1 - 2 ? YB : YC;
      s.hud.readout('spd', 'MPH', Math.round(car.mph), stage === 0 && z < -90 ? (car.mph >= 75 ? 'ok' : 'warn') : ''); if (stage >= 2) s.hud.readout('brk', 'Brakes', 'GONE', 'warn');
      if (y < fl - 16 && !car.dead) { car.dead = true; return s.fail(z < C1 ? 'Could not stop — out through the far windows of tower three' : z > B0 ? 'Fell short of tower two. It is a very long way down' : z > C0 ? 'Fell short of tower three. It is a very long way down' : 'Left the building', { injury: 1 }); }
      if (stage === 4 && Math.abs(car.v) < 2.5 && car.grounded) { stage = 5; s.rate('Stopped it', clamp((z - C1) / 20), 1); s.msg('CUT!', 'huge good'); s.wrap(1.6, S.stuff >= 15 ? 'The art department is in tears.' : undefined); }
    });
  },
  bot(s, inp) {
    const c = s.car, S = s.S, z = c.pos.z; if (!c.grounded) { inp.x = 0; inp.y = c.pitch < 0.03 ? 1 : 0; return; }
    let tx = z < S.C0 + 4 ? 1 : c.pos.x, best = 1e9; for (const p of S.pil) { const d = z - p[1]; if (d > -3 && d < 30 && d < best) { best = d; tx = p[0] > 0.5 ? p[0] - 2.5 : p[0] + 2.5; } } botDrive(c, inp, tx, 99, 0.09);
  },
};

// --------------------------------------------------------------------------------------------- 8
const whoAmI = {
  id: 'who_am_i', title: 'Twenty-One Storeys', film: 'Who Am I?', year: 1998, tier: 5, pay: 21000, mode: 'drive', art: 'bd_rotterdam', music: 'kungfu',
  role: 'Doubling the amnesiac — sliding down the glass face of a Rotterdam office tower. No wires',
  brief: 'Forty-five degrees of glass, ninety metres top to bottom, and a ledge at the bottom about as wide as a dinner table. You slide. Steer round the window-cleaning cradles, use your hands to slow down — until they burn — and stop on that ledge.',
  tips: ['<b>A/D</b> steer the slide: go round the cradles and through the gaps in the ledges.', 'Hold <b>S</b> to brake with your palms — in <b>bursts</b>. Fill the heat meter and your hands let go.', 'Hit the bottom ledge at <b>under 18 mph</b> or you go straight over the edge.'],
  controls: `${K('A')}${K('D')} steer &nbsp; ${K('S')} brake with your hands (heats up!)`, intro: { r: 8, h: 4, up: 0.5 },
  assets: { models: ['ch_agent'], tex: ['bd_rotterdam', 'tx_glass_tower', 'tx_concrete', 'tx_roof', 'tx_fac_office', 'tx_metal'] },
  build(s) {
    s.env('day', { backdrop: 'bd_rotterdam', look: 'cold', fog: 0.0011, hz: 0.5 });
    s.ground({ tex: 'tx_concrete', tile: 20, color: 0x9aa4a8 }); s.water({ y: 0.3, color: 0x3a5a66, w: 900, d: 300, z: -420 });
    const Y0 = 120, Y1 = 30, L = 90, W = 28, LED = 6, ys = z => Y0 + z;
    s.slope({ x: 0, w: W, z0: 0, z1: -L, y0: Y0, y1: Y1, mat: { tex: 'tx_glass_tower', rep: 1 / 16, rough: 0.12, metal: 0.55, color: 0xd8e8f0 } });
    s.building({ x: 0, z: (40 - L - LED) / 2, w: W, d: 40 + L + LED, h: Y1, fac: 'tx_glass_tower', facTile: 20, top: true }); s.building({ x: 0, z: 20, w: W, d: 40, h: Y0 + 26, fac: 'tx_glass_tower', facTile: 20 });
    for (const sd of [-1, 1]) s.box({ x: sd * (W / 2 + 0.2), y: 0, z: 20, w: 0.6, h: Y0 + 30, d: 41, mat: s.mat({ color: 0xe8e8e8 }) });
    for (let x = -W / 2; x <= W / 2 + 0.1; x += 3.5) s.box({ x, y: (Y0 + Y1) / 2 - 0.04, z: -L / 2, w: 0.12, h: 0.14, d: L * 1.414, rx: -Math.PI / 4, mat: s.mat({ color: 0x8a949c, metal: 0.7, rough: 0.4 }), cast: false });
    s.line({ x: 0, z: -L - 0.4, w: W, d: 0.5, y: Y1, color: 0xffe14a, glow: 1.6 }); const zone = s.line({ x: 0, z: -L - LED / 2, w: W, d: LED, y: Y1, color: 0x30ff70, glow: 0.8 }); zone.material.opacity = 0.25;
    srand(12); for (let i = 0; i < 22; i++) { const a = i / 22 * 6.28 + 0.4, r = sr(110, 360), x = Math.cos(a) * r, z = -60 + Math.sin(a) * r; if (Math.abs(x) < 40 && z > -200 && z < 80) continue; s.building({ x, z, w: sr(22, 40), d: sr(22, 40), h: sr(18, 85), fac: i % 2 ? 'tx_fac_office' : 'tx_glass_tower', facTile: 18, solid: false, cast: false }); }
    // cradles + ledges
    const yel = s.mat({ color: 0xe0b020, rough: 0.6 }), steel = s.mat({ tex: 'tx_metal', color: 0x90989c, metal: 0.5 }), conc = s.mat({ tex: 'tx_concrete', color: 0xd0d0d0 }), S = s.S = { gates: [], L, ys };
    const obst = (x0, x1, z, rig) => {
      const w = x1 - x0, x = (x0 + x1) / 2, y = ys(z); s.course.addSolid({ x0, x1, y0: y - 1, y1: y + 2, z0: z - 0.6, z1: z + 0.6, msg: rig ? 'Slammed into a window-cleaning cradle' : 'Hit a ledge at speed and cartwheeled off the building', hardK: 0.42 });
      if (rig) { s.box({ x, y: y + 0.1, z, w, h: 0.15, d: 1.3, mat: yel }); for (const dz of [-0.6, 0.6]) s.box({ x, y: y + 0.2, z: z + dz, w, h: 1.0, d: 0.07, mat: yel }); for (const dx of [-w / 2 + 0.15, w / 2 - 0.15]) { s.box({ x: x + dx, y: y + 0.2, z, w: 0.07, h: 1.0, d: 1.3, mat: yel }); s.box({ x: x + dx, y: ys(z / 2) + 0.3, z: z / 2, w: 0.04, h: 0.04, d: -z * 1.414, rx: -Math.PI / 4, mat: steel, cast: false }); } }
      else s.box({ x, y: y - 0.5, z, w, h: 1.3, d: 0.9, mat: conc });
    };
    obst(-2.6, 2.6, -18, true); S.gates.push([-18, 5.2]);
    obst(-14, 2.4, -36, false); S.gates.push([-36, 6]);
    obst(2, 14, -55, false); obst(-13.5, -10, -52, true); S.gates.push([-55, -2.2]);
    obst(-14, -1.4, -74, false); obst(6.5, 14, -74, false); obst(7, 10.5, -64, true); S.gates.push([-74, 2.4]);
    s.crew({ x: 9, z: 12, y: Y0 + 26, ry: 0.5 }); s.crew({ x: -10, z: -L - 3, y: Y1, ry: 2.6, people: false });
    const car = s.car = new Drive(s, { kind: 'sled', driver: 'ch_hk', driverPose: 'slide', x: 0, z: -2.5, slopeK: 0.2, steer: 2.0, grip: 4.5, brake: 4.2, pitchTol: 9, rollTol: 9, hard: 99, crashV: 12, reverse: false, handbrake: false, cam: { dist: 8, height: 9.5, ahead: 12, up: -5, fov: 66 } });
    car.pitch = -Math.PI / 4; car.frozen = true; s.onAction = () => { car.frozen = false; car.v = 1.5; car.vel.set(0, 0, -1.5); };
    let heat = 0, burnt = false, arr = null, bumps = 0, last = 0; S.heat = () => heat; S.burnt = () => burnt; s.rate('Clean slide', 1, 1); car.onHit = () => { bumps++; dock(s, 'Clean slide', 0.3); s.msg('OOF!', 'small bad'); };
    car.onLand = () => true; s.objective('Slide! Steer round the cradles');
    s.onUpdate((dt, t) => {
      if (!s.started || s.ended) return; const z = car.pos.z, on = z > -L, mph = Math.abs(car.v) * (on ? 1.414 : 1) * 2.237, braking = s.input.y < -0.3 && !burnt && on && car.grounded && car.v > 0.5;
      heat = clamp(heat + (braking ? 0.52 : -0.14) * dt); if (on) last = mph; if (heat >= 1 && !burnt) { burnt = true; s.msg('HANDS BURNT — LET GO!', 'bad'); s.engine.hurt?.(0.3); } if (burnt && heat < 0.45) burnt = false;
      car.k.brake = burnt || !on ? 0 : 4.2; car.k.rollDrag = on ? 0.35 : 2.9; car.k.slopeK = 0.2;
      if (braking && Math.random() < 0.5) { s.fx.smokePuff(V3(car.pos.x + rnd(-0.5, 0.5), car.pos.y + 0.2, car.pos.z + 0.6), 1, { color: [0.9, 0.9, 0.9], size: 0.7, a: 0.3, up: 1 }); s.audio.set('skid', 'skid', 0.5, 0.25); }
      s.hud.readout('spd', 'MPH', mph.toFixed(0), z < -55 ? (mph < 18 ? 'ok' : 'warn') : ''); s.hud.readout('drop', 'To the ledge (m)', Math.max(0, Math.round((z + L) * 1.414)));
      s.hud.meter('hands', burnt ? 'Hands — BURNT' : 'Hands (heat)', heat, { color: burnt ? '#f33' : heat > 0.7 ? '#f90' : '#fc6' });
      if (Math.abs(car.pos.x) > W / 2 + 0.3 && !car.dead) { car.dead = true; return s.fail('Slid off the side of the building', { injury: 1 }); }
      if (arr == null && z < -L) { arr = last; s.objective(''); if (arr > 22) s.msg('TOO FAST!', 'bad'); }
      if (z < -L - LED - 0.4 && !car.dead) { car.dead = true; return s.fail(`Hit the ledge at ${Math.round(arr)} mph and went straight over the edge`, { injury: 1 }); }
      if (arr != null && Math.abs(car.v) < 0.5) { const tt = t - s.t0; s.rate(`Pace (${tt.toFixed(1)}s)`, near(tt, 16, 2.5, 16), 1.2); s.rate(`Nerve — ${Math.round(arr)} mph at the ledge`, near(arr, 16, 3, 16), 1); s.bonus('Hands left', Math.round((1 - heat) * 600)); car.driver?.setPose('crouch', 0.3); s.msg('STUCK IT!', 'huge good'); s.wrap(1.6); }
    });
  },
  bot(s, inp) {
    const c = s.car, S = s.S, z = c.pos.z; let tx = 2.4; for (const g of S.gates) if (g[0] < z - 0.3) { tx = g[1]; break; }
    botDrive(c, inp, tx, 99, 0.13); const tv = z < -64 ? 4.3 : 8; inp.y = 0; if (!B_hold(S, c.v > tv)) return; inp.y = -1;
  },
};
// bot brake hysteresis: brake when too fast, but let the hands cool before they burn
function B_hold(S, fast) { if (S.burnt()) return false; if (S.heat() > 0.9) S.rest = true; if (S.heat() < 0.55) S.rest = false; return fast && !S.rest; }

// --------------------------------------------------------------------------------------------- 9
const hooper = {
  id: 'hooper', title: 'Rocket Over the Gorge', film: 'Hooper', year: 1978, tier: 5, pay: 26000, mode: 'drive', art: 'bd_river_gorge', music: 'western',
  role: 'The greatest stuntman alive — rocket Trans Am, 325 feet of nothing',
  brief: 'The whole town blows up around you — smokestacks, gas tanks, the lot — and at the end the bridge is gone. Three hundred and twenty-five feet. The car will not do it on its own, so there is a rocket in the back. You get about four seconds of it. Do not waste them.',
  tips: ['Smokestacks fall across the street — <b>go round the end</b> that is still standing clear.', 'Hold <b>SHIFT</b> for the rocket. Four seconds of fuel: save it for the run to the bridge.', 'You need <b>110 mph+</b> off the ramp. In the air <b>hold W</b> to keep the nose up and land on your wheels.'],
  controls: `${K('W')} gas &nbsp; ${K('S')} brake &nbsp; ${K('A')}${K('D')} steer &nbsp; hold ${K('SHIFT')} rocket &nbsp; airborne ${K('W')} nose up`, intro: { r: 9, h: 2.4 },
  assets: { models: ['rocket_car', 'wagon_brown', 'sedan_grey'], tex: ['bd_river_gorge', 'tx_rock', 'tx_dirt', 'tx_brick', 'tx_fac_old', 'tx_roof', 'tx_concrete', 'tx_metal', 'tx_wood', 'tx_grass'] },
  build(s) {
    s.env('golden', { backdrop: 'bd_river_gorge', look: 'warm60s', fog: 0.0013, hz: 0.5 });
    const G0 = -520, G1 = -619, DEEP = 70, gorge = (x, z) => (z < G0 && z > G1 ? -DEEP * smooth(0, 7, Math.min(z - G1, G0 - z)) : 0);
    s.ground({ tex: 'tx_rock', tile: 14, y: -0.5, base: false, color: 0xb8a890 }); s.terrain({ x0: -300, x1: 300, z0: 130, z1: -900, res: 5, fn: gorge, tex: 'tx_rock', tile: 16 }); s.course.kill = -200;
    s.water({ y: -DEEP + 4, color: 0x2a6a70, w: 600, d: 110, z: (G0 + G1) / 2, size: 600 });
    s.road({ z0: 130, z1: G0 + 20, width: 9, lanes: 2, mat: { tex: 'tx_dirt', color: 0xc0a080 }, marks: false }); s.road({ z0: G1 - 2, z1: -900, width: 9, lanes: 2, mat: { tex: 'tx_dirt', color: 0xc0a080 }, marks: false });
    // the film-set town
    for (const sd of [-1, 1]) s.row({ side: sd, x: sd * 11.5, z0: 40, z1: -420, fac: ['tx_fac_old'], height: [6, 12], depth: [9, 14], width: [12, 22], seedv: sd > 0 ? 4 : 8, sol: undefined });
    const steel = s.mat({ tex: 'tx_metal', color: 0x6a5a50, rough: 0.8 }), brick = s.mat({ tex: 'tx_brick', color: 0xb08070 }), wood = s.mat({ tex: 'tx_wood', color: 0x9a8060 });
    // what is left of the bridge
    s.slope({ x: 0, w: 7.5, z0: G0 + 21, z1: G0 - 2, y0: 0, y1: 3.3, curve: 1.5, thick: 0.5, mat: { tex: 'tx_wood', rep: 0.2, color: 0x9a8a78 } }); s.box({ x: 0, y: -0.6, z: G1 - 10, w: 7.5, h: 0.6, d: 20, mat: wood });
    for (const [z, sgn] of [[G0, 1], [G1, -1]]) for (const sd of [-1, 1]) { s.box({ x: sd * 4.4, y: -6, z: z + sgn * 3, w: 0.7, h: 15, d: 0.7, mat: steel }); s.box({ x: sd * 4.4, y: 6, z: z - sgn * 4, w: 0.4, h: 0.4, d: 16, rx: sgn * sd * 0.12 - sgn * 0.25, mat: steel }); }
    s.box({ x: -2, y: -9, z: G0 - 9, w: 3, h: 0.4, d: 14, rx: -0.7, rz: 0.2, mat: wood }); sign(s, 'BRIDGE OUT', { x: -6.6, y: 2, z: G0 + 60, w: 5, ry: 0.3, bg: '#d9a400', fg: '#111' }); sign(s, '325 FT', { x: 6.6, y: 2, z: G0 + 30, w: 4, ry: -0.3, bg: '#222' });
    s.line({ x: 0, z: G0 + 22, w: 7.5, d: 0.5, color: 0xffe14a }); s.crew({ x: 7, z: 72, ry: 0.9 }); s.crew({ x: -9, z: G1 - 24, ry: 2.5, people: false }); s.crew({ x: 12, z: G0 + 40, ry: -0.6, people: false });
    const car = s.car = new Drive(s, { kind: 'muscle', model: 'rocket_car', x: 0, z: 80, top: 36, accel: 10, nose: -0.2, air: 0.44, pitchTol: 0.66, hard: 14, handbrake: false }); car.dustColor = [0.7, 0.58, 0.45]; car.k.dusty = true;
    // falling smokestacks: [side, z]
    const S = s.S = { G0, G1, fuel: 1, stacks: [] }; const H = 15;
    for (const [sd, z] of [[1, -110], [-1, -215], [1, -315], [-1, -400]]) {
      const g = new THREE.Group(); g.position.set(sd * 10.6, 0, z); s.scene.add(g); s.cyl({ parent: g, r: 0.95, r1: 0.7, h: H, mat: brick }); s.cyl({ parent: g, r: 0.78, r1: 0.78, h: 0.5, y: H - 0.4, color: 0x222222 });
      const sol = s.course.addSolid({ x0: Math.min(sd * 10.6, sd * (10.6 - H)), x1: Math.max(sd * 10.6, sd * (10.6 - H)), y0: 0, y1: 1.9, z0: z - 0.95, z1: z + 0.95, msg: 'Flattened by a falling smokestack', hardK: 0.2, dead: true });
      S.stacks.push({ sd, z, g, sol, t: -1, free: -sd * 7.6 });
    }
    // charges along the street
    const charges = []; srand(5); for (let z = -20; z > -470; z -= 34) charges.push({ x: (charges.length % 2 ? 1 : -1) * sr(8.5, 10.5), y: sr(0.5, 5), z: z + sr(-8, 8) }); charges.push({ x: -7, y: 1, z: G0 + 34 }, { x: 7, y: 1, z: G0 + 30 });
    for (const [x, z] of [[2.2, -60], [-6, -175], [3, -250], [-5, -372], [-3, -452]]) { s.box({ x, y: 0, z, w: 1.6, h: 1.1, d: 1.6, mat: wood, solid: 'break', sol: { debris: 0x9a8060, slow: 0.86, on: () => { dock(s, 'Dodged the set', 0.2); s.fx.fireBurst(V3(x, 1, z), 14); } } }); }
    for (const [x, z, id, ry] of [[7.4, -30, 'wagon_brown', 0.2], [-7.3, -150, 'sedan_grey', 2.9], [7.2, -262, 'sedan_grey', -0.3]]) s.put(id, { x, z, ry, solid: true, sol: { msg: 'Hit a parked picture car' } });
    s.rate('Dodged the set', 1, 1); car.onHit = () => dock(s, 'Dodged the set', 0.25);
    let jumped = false, landed = false, used = 0; const fwd = V3(), p = V3(); s.objective('Dodge the falling stacks — save the rocket');
    car.onAir = t => { if (t.z < G0 + 6 && !jumped) { jumped = true; s.rate(`Take-off (${car.mph.toFixed(0)} mph)`, near(car.mph, 118, 8, 20), 1.4); s.slowmo(0.35, 1.8); s.msg(Math.round(car.mph) + ' MPH', 'good'); s.objective('Hold W — nose up'); } };
    car.onLand = i => { if (jumped && !landed && car.pos.z < G1 + 4 && car.pos.y > -6) { landed = true; const ft = ftOf(i.dist); s.rate('Landing', i.clean, 1.6); s.bonus('Jump: ' + ft + ' ft', Math.round(ft * 6)); s.msg(ft + ' FEET!', 'huge good'); s.objective('Bring her home'); } };
    s.onUpdate((dt, t) => {
      if (!s.started) return; const z = car.pos.z;
      for (const k of S.stacks) { // topple
        if (k.t < 0) { if (z < k.z + 100) { k.t = 0; s.fx.explosion(V3(k.sd * 10.6, 1, k.z), 1.2); s.audio.explosion(0.8); s.engine.addShake(0.6); } continue; } if (k.t > 1.75) continue;
        k.t += dt; const a = Math.min(1, k.t / 1.75); k.g.rotation.z = k.sd * a * a * Math.PI / 2 * 0.985; if (a > 0.8) k.sol.dead = false;
        if (a >= 1) { k.t = 9; s.audio.crash(); s.engine.addShake(clamp(1.4 - Math.abs(z - k.z) / 80, 0.2, 1.2)); for (let i = 0; i < 6; i++) s.fx.dust(V3(k.sd * (10.6 - (i + 0.5) * H / 6), 0.3, k.z), 4, { size: 3, spread: 2, color: [0.6, 0.45, 0.4] }); s.fx.debris(V3(k.sd * (10.6 - H * 0.6), 0.6, k.z), 20, { color: 0x8a5a48, speed: 7 }); }
      }
      for (const c of charges) if (!c.done && z < c.z + 26) { c.done = true; s.fx.explosion(V3(c.x, c.y, c.z), 1.3); s.audio.explosion(clamp(1.2 - Math.abs(c.x) / 14, 0.4, 1)); s.engine.addShake(0.5); s.engine.flash?.(0.12); }
      if (s.ended) { car.boost = 1; s.audio.set('rocket', 'jet', 1, 0); return; }
      // rocket
      const burn = s.input.b && S.fuel > 0 && !car.dead && !landed; car.boost = burn && car.grounded ? 1.8 : 1;
      if (burn) { S.fuel = Math.max(0, S.fuel - dt / 4); used += dt; car.fwd(fwd); p.set(car.pos.x - fwd.x * 2.7, car.pos.y + 0.7, car.pos.z - fwd.z * 2.7); for (let i = 0; i < 3; i++) s.fx.exhaust(p, V3(-fwd.x * 14, 0.5, -fwd.z * 14), 1.5); s.fx.flame(p, 0.8); s.engine.addShake(0.08); if (!car.grounded) car.vel.addScaledVector(fwd, 5 * dt); if (S.fuel <= 0) s.msg('ROCKET OUT', 'small bad'); }
      s.audio.set('rocket', 'jet', 1.1, burn ? 0.7 : 0);
      s.hud.meter('fuel', 'Rocket fuel — hold SHIFT', S.fuel, { color: S.fuel < 0.25 ? '#f33' : '#f90' }); s.hud.readout('spd', 'MPH', Math.round(car.mph), !jumped && z < G0 + 160 ? (car.mph >= 110 ? 'ok' : 'warn') : '');
      if (car.pos.y < -10 && !car.dead) { car.dead = true; const short = Math.max(1, Math.round((car.pos.z - G1) * 3.281)); return s.fail(jumped ? `Came up ${short} feet short. Three hundred and twenty-five was the number` : 'Drove into the gorge', { injury: 1 }); }
      if (landed && (z < G1 - 150 || Math.abs(car.v) < 1)) { s.bonus('Fuel left', Math.round(S.fuel * 800)); s.wrap(1.3); }
    });
  },
  bot(s, inp) {
    const c = s.car, S = s.S, z = c.pos.z; if (!c.grounded) { inp.x = 0; inp.y = c.pitch < 0.04 ? 1 : 0; return; }
    let tx = 0; for (const k of S.stacks) if (z < k.z + 85 && z > k.z - 6) tx = k.free; if (z < S.G0 + 95) tx = 0;
    botDrive(c, inp, tx, 99, 0.08); if (z < S.G0 + 150) inp.b = true;
  },
};

export default [casino, fallGuy, fastTrain, roadWarrior, darkKnight, superCop, furious7, whoAmI, hooper];
