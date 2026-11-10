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
// Attach a director's note to every solid that carries this crash message (forests/buildings/puts cannot pass advice themselves).
const advise = (s, msg, advice) => { for (const so of s.course.solids) if (so.msg === msg && !so.advice) so.advice = advice; };
// Predicted path of a tumbleScript wreck: straight along the current heading, decelerating to a stop. at(t) -> world position t sim-seconds from now.
function tumblePath(car, decel, lift = 0) {
  const p0 = car.pos.clone(), h = car.heading, fx = -Math.sin(h), fz = -Math.cos(h), v0 = Math.abs(car.v), T = v0 / Math.max(0.1, decel);
  return { T, at: t => { const tt = clamp(t, 0, T), d = v0 * tt - decel * tt * tt / 2; return V3(p0.x + fx * d, p0.y + lift, p0.z + fz * d); } };
}
// Predicted ballistic arc of an airborne Drive (same integration as Drive._airCine); stops at the ground or after `max` s.
function arcPath(s, car, max = 5) {
  const pts = [car.pos.clone()], dt = 0.05; let x = car.pos.x, y = car.pos.y, z = car.pos.z, vy = car.vy, t = 0; const vx = car.vel.x, vz = car.vel.z;
  while (t < max) { t += dt; x += vx * dt; z += vz * dt; vy -= 9.81 * dt * (car.gravK ?? 1); y += vy * dt; pts.push(V3(x, y, z)); const g = s.course.height(x, z, y + 0.9); if (t > 0.15 && g > -1e5 && y <= g) break; if (y < s.course.kill) break; }
  return { T: t, at: tt => { const k = clamp(tt / dt, 0, pts.length - 1), i = Math.min(pts.length - 2, Math.floor(k)); return pts[i].clone().lerp(pts[i + 1], k - i); } };
}
// Live multi-angle edit of a payoff the player cannot steer: shots [{type, d: sim seconds, ...shot opts}] cut back to back
// from the predicted path at(t). The camera always looks at the real subject, so small prediction errors do not matter.
function liveEdit(s, at, shots, o = {}) {
  const t0 = s.t; let undo = null, a = 0, stopped = false; const E = { stop() { if (stopped) return; stopped = true; undo?.(); undo = null; } };
  shots.forEach((sh, i) => {
    const ta = a, tb = a + sh.d; a = tb;
    s.after(ta, () => { if (stopped) return; undo?.(); undo = null; const pts = []; for (let k = 0; k <= 16; k++) { const t = ta + (tb - ta) * k / 16; pts.push({ t: t0 + t, p: at(t) }); } undo = s.cut(pts, sh.type, { ...sh, subject: o.subject }); if (sh.whoosh) s.audio.whoosh(); });
  });
  if (!o.hold) s.after(a, () => E.stop());
  return E;
}
// An idle performer: if the vehicle has not left its mark `sec` seconds after ACTION, the director calls it.
function stall(s, car, sec, advice) { let p0 = null; s.onUpdate((dt, t) => { if (!s.started || s.ended) return; p0 ??= car.pos.clone(); if (t - s.t0 > sec && car.pos.distanceTo(p0) < 20) s.fail('Never left the start mark', { injury: 0, advice }); }); }
function headlights(car, i = 500) { const l = new THREE.SpotLight(0xfff0d8, i, 110, 0.5, 0.6, 1.3); l.position.set(0, 0.9, -1.6); l.target.position.set(0, 0, -34); car.obj.add(l, l.target); return l; }

// Air-cannon barrel roll shared by the two record attempts. SPACE fires; rolls = f(speed, timing, line).
// v2 leeway: a mistimed / off-line / slow shot still fires and rolls the car — just fewer rolls and director's notes.
// If SPACE never comes, the effects man fires it late for you. Only `danger` (e.g. the actress in the road) ends the take.
function cannonRoll(s, car, o) {
  const { KZ, KX, win, perf, align, minMph, bestMph, record, maxRolls, decel = 8, hop = 1.0, blocked, danger, side = 1 } = o; const S = { fired: false, st: null };
  const fire = auto => {
    S.fired = true; s.hud.hideBar(); s.hud.prompt(''); const d = car.pos.z - KZ, dx = car.pos.x - KX, mph = car.mph, v0 = Math.abs(car.v), ad = Math.abs(d), adx = Math.abs(dx);
    s.fx.smokePuff(car.pos, 14, { color: [0.8, 0.8, 0.8], size: 2.4, up: 5 }); s.fx.sparks(car.pos, 40, { speed: 12 }); s.audio.explosion(0.7); s.engine.addShake(1.1);
    if (danger?.(d, dx)) return;
    const sp = clamp((mph - minMph) / (bestMph - minMph)), tm = near(ad, 0, perf, win), al = near(adx, 0, 0.35, align);
    let rolls = 2 + (maxRolls - 2) * sp * (0.55 + 0.45 * tm) * (0.7 + 0.3 * al);
    if (mph < minMph) { rolls = 0.75 + 1.25 * clamp((mph - 30) / (minMph - 30)); s.flub(`Only ${mph.toFixed(0)} mph at the kicker`, { penalty: 0.2, advice: `Every extra mph is another roll: be at ${minMph + 13}+ mph (the MPH readout turns green) before the kicker and keep your foot flat to the end.` }); }
    if (ad > win) { rolls *= clamp(1 - (ad - win) / (win * 2.5), 0.3, 0.7); if (!auto) s.flub(`Fired the cannon ${ad.toFixed(0)} m ${d > 0 ? 'early' : 'late'}`, { penalty: 0.15, advice: `You were ${ad.toFixed(0)} m ${d > 0 ? 'short of' : 'past'} the kicker. Press SPACE as the marker crosses the green band on the timing bar — not before, not after.` }); }
    if (adx > align) { rolls *= clamp(1 - (adx - align) / 3, 0.35, 0.75); s.flub(`Missed the kicker by ${adx.toFixed(1)} m`, { penalty: 0.15, advice: `Only one side of the car was on the kicker. Line the nose up on the green line ${o.lineTip || ''}at least 40 m out, then hold the wheel straight.` }); }
    rolls = Math.max(0.5, Math.round(rolls * 4) / 4); const rec = rolls >= record;
    s.msg(Math.round(mph) + ' MPH — CANNON!', 'good'); s.objective('Hang on…'); s.audio.sting(); s.slowmo(0.35, 2.6); s.cam.set({ dist: 12, height: 3.4, side: 5.5 * side, stiff: 4 });
    // the payoff: live edit while it rolls, plus the replay moment
    const P = tumblePath(car, decel, 0.6), T = P.T;
    s.moment('cannon roll', { t0: s.t - 1.4, dur: T + 2.4, w: 4 + rolls, shots: [{ type: 'low', speed: 0.4, a: 0.1, b: 0.35, at: 0.75, side }, { type: 'wide', speed: 1, a: 0, b: 0.45 }, { type: 'front', speed: 0.6, a: 0.25, b: 0.65, side: 0.15 }, { type: 'track', speed: 0.8, a: 0.5, b: 1 }] });
    S.cine = liveEdit(s, P.at, [{ type: 'low', d: 0.6, at: 0.9, side }, { type: 'front', d: 0.75, side: 0.12 }, { type: 'wide', d: Math.min(1.5, T * 0.3), side: -side, whoosh: 1 }, { type: 'track', d: Math.max(0.8, T * 0.3) }, { type: 'low', d: Math.max(0.6, T * 0.3) + 2.2, at: 1, side: -side }]);
    S.st = tumble(s, car, { rollRate: rateFor(rolls, v0, decel), decel, hop, onDone: () => {
      s.rate(`Cannon rolls (${rolls} of ${record})`, rolls / record, 2); s.rate(`Speed (${mph.toFixed(0)} mph)`, 0.35 + 0.65 * sp, 1); s.rate('Cannon timing', near(ad, 0, perf, win * 1.6), 1); s.rate('On the kicker', near(adx, 0, 0.35, align * 1.5), 0.7);
      s.bonus(rolls + ' rolls', Math.round(rolls * 250)); if (rec) { s.bonus('World record', 3000); s.msg(rolls + ' ROLLS — RECORD!', 'huge good'); } else s.msg(rolls + ' ROLLS', rolls >= record * 0.6 ? 'good' : '');
      s.engine.addShake(0.8); s.fx.smokePuff(car.pos, 14, { size: 3, up: 4 }); s.wrap(2.2, rec ? 'That one goes in the book.' : rolls < 2 ? 'Well… it is on its roof. We will fix it in the edit.' : undefined);
    } });
  };
  s.onUpdate(() => {
    if (S.st && !S.st.done) s.hud.readout('rolls', 'Rolls', Math.abs(S.st.rolls).toFixed(1), 'ok');
    if (!s.started || s.ended || S.fired) return; const d = car.pos.z - KZ;
    if (d < 90) { s.hud.bar((75 - d) / 90, [(75 - win) / 90, (75 + win) / 90], [(75 - perf) / 90, (75 + perf) / 90]); s.hud.prompt(`${K('SPACE')} fire the cannon on the kicker`); }
    if (blocked?.(d)) { S.fired = true; s.hud.hideBar(); return; }
    if (d < -win - 3) { s.flub('Never fired the cannon', { penalty: 0.25, advice: 'Press SPACE as the marker on the timing bar crosses the green band — the effects man had to fire it for you, late, off the kicker.' }); return fire(true); }
    if (s.input.hit('a') && d < 110) fire(false);
  });
  return S;
}

// --------------------------------------------------------------------------------------------- 1
const casino = {
  id: 'casino_roll', title: 'Seven Times Over', film: 'Casino Royale', year: 2006, tier: 4, pay: 15000, mode: 'drive', art: 'bd_georgia', music: 'spy',
  role: 'Doubling 007 — Aston Martin DBS, a country road, midnight',
  brief: 'She is lying in the road. You come round at ninety, swerve off the left lane onto the kicker and hit the air cannon. The record is seven complete rolls. Nobody has ever needed an eighth.',
  tips: ['Be doing <b>75 mph or more</b> — every extra mph is another roll.', 'Stay left past the camera van, then <b>swerve right</b> onto the kicker beside her.', 'Hit <b>SPACE</b> as the marker crosses the green — early, late or off the kicker and you get fewer rolls.'],
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
    s.S = { KZ, KX, LX }; s.objective('75 mph+ — swerve onto the kicker and fire'); stall(s, car, 20, 'Hold W from ACTION — you need 75+ mph by the kicker, 500 m down the road.');
    const LADY = 'Steer right onto the kicker straight after the red marks on the road — she is lying in the left lane just past it.';
    advise(s, 'Buried the DBS in the camera van', 'Stay in the LEFT lane past the cones and the camera van, and only swerve right once you are past it.'); advise(s, 'Wrapped the Aston round an oak', 'Stay on the tarmac — small steering inputs at 90 mph. Swerve onto the kicker with a gentle lane change, not a yank.');
    cannonRoll(s, car, { KZ, KX, win: 8, perf: 2.0, align: 2.0, minMph: 60, bestMph: 90, record: 7, maxRolls: 7.25, decel: 8, lineTip: '(right lane, beside her) ',
      blocked: d => { if (d < -4 && d > -10 && Math.abs(car.pos.x - LX) < 1.5) { s.fail('You ran over the leading lady. The insurers would like a word', { injury: 0, advice: LADY }); return true; } },
      danger: (d, dx) => { if (d > -5 && Math.abs(car.pos.x - LX) < 1.5) { car.crash('The cannon threw the DBS straight at the leading lady', { injury: 0.3, advice: LADY }); return true; } } });
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
  tips: ['Stay on the <b>dark wet strip</b> between the cones — soft sand caps you well under the speed you need.', 'You want <b>80 mph+</b> at the kicker. The strip snakes, so steer early and smoothly.', 'SPACE on the green, wheels on the kicker. Early, late or off-line still rolls — just not enough for the record.'],
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
    s.S = { KZ, KX }; s.objective('Stay on the wet strip — 80 mph at the kicker'); let off = 0; const S0 = {}; stall(s, car, 20, 'Hold W from ACTION — you need 80+ mph by the kicker, 570 m down the beach.');
    cannonRoll(s, car, { KZ, KX, win: 6, perf: 1.4, align: 1.7, minMph: 62, bestMph: 86, record: 8.5, maxRolls: 9, decel: 9.5, hop: 1.3, side: -1, lineTip: '(between the orange flags) ' });
    s.onUpdate((dt, t) => {
      heli.position.y = 15 + Math.sin(t * 0.8) * 0.6; if (car.frozen || !s.started) return;
      car.offroad = Math.abs(car.pos.x - sx(car.pos.z)) > 4.3; if (car.offroad) { off += dt; if (Math.abs(car.v) > 30) car.vel.multiplyScalar(1 - dt * 0.5); }
      if (car.pos.x < -19 && !car.dead) { s.fx.splash(car.pos, 90, 2.5); s.audio.splash(); car.crash('Drowned the Jeep in the surf', { injury: 0.3, advice: 'Keep the Jeep between the cones on the dark wet strip — the sea is on your LEFT, so if it snakes left, ease off and steer back early.' }); }
      if (car.offroad && off > 1.2 && !S0.flubbed) { S0.flubbed = true; s.flub('Bogged down in the soft sand', { penalty: 0.1, advice: 'Stay on the dark wet strip between the cones — the soft sand caps your speed and every mph is a roll.' }); }
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
    // the Supra races in its own lane; it never noses onto the crossing while the freight is on it
    const trainAt = x => { const f = tr.position.x; return f > x - 1.4 && f - LEN < x + 1.4; };
    const mv = new Movers(s, car); const supra = mv.add({ model: 'supra', x: 2.6, z: 30, v: 0, nearMiss: false, msg: 'Traded paint with the Supra', hardK: 3, ai: (e, dt) => { if (!s.started) return; const toX = e.z - TZ - 4, f = tr.position.x, soon = f > 2.6 - 1.4 - VT * (toX / Math.max(8, e.v) + 0.4) && f - LEN < 2.6 + 1.4; const want = toX > 0 && toX < 60 && soon ? 0 : 61; e.v += (want - e.v) * Math.min(1, dt * (want ? 0.195 : 3)); } });
    supra.sol.advice = 'Keep to your own (left) lane: A/D only to hold it straight while you shift.';
    const S = s.S = { g: 0, rpm: 0, shifts: [], TZ }; let bog = 0, bogK = 1, crossed = false, bell = 0, cine = null;
    const TRAIN_TIP = 'Shift on the green every time — four clean shifts get you across with a second to spare. If you are late, brake and let the train pass rather than drive into it.';
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
      if (s.input.hit('a') && g < 4 && !crossed) { const q = near(rpm, 0.93, 0.07, 0.35); S.shifts.push(q); S.g++; S.rpm = car.v / GT[S.g]; bog = 0.9; bogK = 0.45 + 0.55 * q; s.audio.tick(); s.msg(q > 0.9 ? 'PERFECT SHIFT' : rpm < 0.9 ? 'EARLY — BOGGED' : 'LATE', q > 0.9 ? 'small good' : 'small'); s.engine.addShake(0.2); }
      if (rpm >= 1 && g < 4 && Math.random() < 0.5) s.fx.sparks(V3(car.pos.x, 0.4, car.pos.z + 2.4), 2, { speed: 3 });
      const wp = g === 0 && car.inThr > 0.5 ? 0.17 * Math.sin(Math.PI * clamp(tt / 1.3)) : 0; car.pitchOverride = wp > 0.005 ? wp : null; car.mesh.position.y = -car.k.cg + Math.sin(wp) * 1.6;
      s.audio.set('veh', 'engine', 0.45 + rpm * 0.85, 0.6 + car.inThr * 0.4);
      s.hud.meter('rev', 'REV — ' + ['1st', '2nd', '3rd', '4th', '5th'][g], rpm / 1.06, { color: rpm > 0.985 ? '#f33' : rpm > 0.86 ? '#3f6' : '#fc3' });
      s.hud.readout('spd', 'MPH', Math.round(car.mph)); const lead = supra.z - car.pos.z; s.hud.readout('gap', lead >= 0 ? 'Ahead of Supra (m)' : 'Behind Supra (m)', Math.abs(lead).toFixed(0), lead >= 0 ? 'ok' : 'warn');
      if (!crossed) s.hud.readout('trn', 'Train at crossing in', Math.max(0, TT - tt).toFixed(1), TT - tt < 3 ? 'warn' : '');
      // the crossing
      const hl2 = car.k.len / 2, onTrack = car.pos.z - hl2 < TZ + 1.7 && car.pos.z + hl2 > TZ - 1.7;
      if (onTrack && !car.dead && front > car.pos.x - 1.1 && front - LEN < car.pos.x + 1.1) { s.audio.horn(180); cine?.stop(); return car.crash(front - car.pos.x < 6 ? 'The freight took the Charger clean off the crossing' : 'Drove into the side of the freight train', { injury: 1, fire: true, advice: TRAIN_TIP }); }
      // late: the train got there first. Keep rolling — wait for it to pass and cross behind it (low score)
      if (!crossed && !S.late && front > car.pos.x - 1.1 && car.pos.z - hl2 > TZ + 1.7) { S.late = true; s.flub('The train beat you to the crossing', { penalty: 0.3, advice: TRAIN_TIP }); s.objective('Brake! Wait for the train to pass'); }
      if (S.late && !crossed && !trainAt(car.pos.x)) s.objective('Clear — go!');
      if (!crossed && tt > TT + 16) { crossed = true; s.flub('Never made the crossing', { penalty: 0.3, advice: 'Hold W from the start and tap SPACE each time the rev needle reaches the green — four shifts, quarter of a mile, then across the tracks.' }); s.rate('Gear shifts', 0, 2); s.rate('Beat the Supra', 0, 1.5); s.rate('Run to the crossing', 0, 1); return s.wrap(1.5, 'The Supra is in Mexico by now.'); }
      // the payoff: just before the rails, cut live to the film's angles while the freight bears down
      if (!crossed && !cine && !S.late && car.v > 15 && car.pos.z - TZ < car.v * 0.55 + hl2 + 2) {
        const p0 = car.pos.clone(), v = car.v, close = front > car.pos.x - 70; s.slowmo(close ? 0.28 : 0.4, close ? 2.4 : 1.4); s.audio.horn(180); s.audio.sting();
        cine = liveEdit(s, t => V3(p0.x, p0.y, p0.z - v * t), [{ type: 'low', d: 0.42, at: 0.55, side: -1 }, { type: 'front', d: 0.45 }, { type: 'wide', d: 1.6, side: -1 }], { hold: true });
        s.moment('beat the freight', { t0: s.t - 1.6, dur: 3.6, w: close ? 5 : 2.5, shots: [{ type: 'track', speed: 1, a: 0, b: 0.5, side: -1 }, { type: 'low', speed: 0.3, a: 0.35, b: 0.62, side: -1 }, { type: 'front', speed: 0.5, a: 0.3, b: 0.85 }, { type: 'wide', speed: 1, a: 0.5, b: 1 }] });
      }
      if (!crossed && car.pos.z + hl2 < TZ - 1.7) {
        crossed = true; const margin = S.late ? 99 : Math.max(0, (car.pos.x - 1.1 - front) / VT), sh = S.shifts.concat([0, 0, 0, 0]).slice(0, 4);
        s.rate('Gear shifts', sh.reduce((a, b) => a + b, 0) / 4, 2); s.rate(lead >= 0 ? `Beat the Supra by ${lead.toFixed(1)} m` : `Lost to the Supra by ${(-lead).toFixed(1)} m`, clamp(0.55 + lead / 14), 1.5); s.rate(`Run to the crossing (${tt.toFixed(2)}s)`, near(tt, 11.5, 0.5, 3.5), 1);
        if (lead < -15) s.flub('The Supra beat you', { penalty: 0.1, quiet: true, advice: 'The Supra pulls away if you bog it: shift exactly on the green and never let the needle sit on the red limiter.' });
        if (!S.late) { s.bonus(`Cleared the train by ${margin.toFixed(2)}s`, Math.round(clamp(1 - margin / 2.2) * 3500)); s.msg(margin < 0.6 ? 'INCHES!' : 'ACROSS!', 'huge good'); s.audio.horn(180); }
        else s.msg('ACROSS — EVENTUALLY', 'small');
        if (!cine) s.cam.fixed(V3(car.pos.x + 5.5, 1.3, TZ - 36), () => ({ pos: car.pos, heading: 0 }), { fov: 38 }); s.wrap(2.6);
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
        avoidPlayer: true, ai: (ee, dt) => { if (!s.started || ee.free) return; const gap = car.pos.z - ee.z; ee.v += ((gap < 130 && gap > -30 && !S.rolled ? cruise : 0) - ee.v) * Math.min(1, dt * (S.rolled ? 2.5 : 1.5)); if (ee.v > 5 && Math.random() < 0.3) s.fx.dust(ee.m.position, 1, { color: car.dustColor, size: 1.6 }); } });
      e.sol.minV = 7; e.sol.slow = 0.955; S.raiders.push(e);
    }
    advise(s, 'Piled the tanker into a rock', 'Stay on the tarmac — the rocks start just off the verge. Ram raiders with small steering inputs; the rig needs 50 m to change lanes.');
    advise(s, 'Buried the tanker in a burnt-out wreck', 'The burnt-out wrecks sit on the verges and do not move. Ram raiders in the middle of the road and ease back to centre before each wreck.');
    s.rate('Rig in one piece', 1, 0.6); car.onHit = () => dock(s, 'Rig in one piece', 0.25); s.objective('Ram the raiders off the road'); stall(s, car, 25, 'Hold W — the rig is slow to wind up, and you need 50+ mph at the flags 900 m away.');
    // the roll: a straight-line slide onto its side, cut live from the road like the film
    const roll = (d, mph, auto) => {
      S.rolled = true; s.hud.prompt(''); s.objective(''); const dir = (auto ? -1 : s.input.x) < 0 ? 1 : -1, v0 = Math.abs(car.v), ad = Math.abs(d);
      const slow = mph < 45, early = d > 34, late = d < -34;
      if (early) s.flub(`Rolled her ${Math.round(d - 30)} m before the flags`, { penalty: 0.15, advice: 'Wait for the green zone between the red flags — the prompt says ROLL IT NOW — then A/D + SPACE together.' });
      if (late && !auto) s.flub(`Rolled her ${Math.round(-d - 30)} m past the flags`, { penalty: 0.15, advice: 'Roll inside the green zone: the yellow flags mark the centre line. Start looking for it from 200 m out.' });
      if (slow) s.flub(`Only ${mph.toFixed(0)} mph at the roll`, { penalty: 0.15, advice: 'She needs 50+ mph to go over cleanly. Stop ramming raiders 300 m before the flags and let her wind back up.' });
      car.heading += dir * (slow ? 0.08 : 0.12); s.slowmo(0.35, 3.2); s.audio.crash(); s.audio.sting(); s.cam.set({ dist: 26, height: 7, side: -dir * 11, stiff: 3 }); s.msg(slow ? 'SHE’S… GOING…' : 'OVER SHE GOES', 'good');
      const decel = slow ? 7.5 : 6.5, rolls = slow ? 1 : 1.25, P = tumblePath(car, decel, 2), T = P.T;
      s.moment('tanker roll', { t0: s.t - 1.5, dur: T + 2.4, w: 6, shots: [{ type: 'low', speed: 0.35, a: 0.1, b: 0.45, at: 0.8, side: 0.35 }, { type: 'wide', speed: 0.8, a: 0.05, b: 0.6, side: dir }, { type: 'front', speed: 0.5, a: 0.3, b: 0.8 }, { type: 'track', speed: 1, a: 0.6, b: 1, side: -dir }] });
      liveEdit(s, P.at, [{ type: 'low', d: 0.5, at: 0.85, side: 0.3 }, { type: 'wide', d: 0.6, side: dir }, { type: 'front', d: Math.max(0.8, T * 0.35) }, { type: 'track', d: Math.max(0.8, T * 0.35), side: -dir, whoosh: 1 }, { type: 'wide', d: 3, side: -dir }], { hold: true });
      const st = tumble(s, car, { rollRate: -dir * rateFor(rolls, v0, decel), decel, hop: 0.5, onDone: () => {
        s.rate(`Speed at the roll (${mph.toFixed(0)} mph)`, clamp((mph - 35) / 17), 1.2); s.rate('Hit the mark', near(ad, 0, 8, 60), 1.5); s.rate(`Raiders rammed (${S.rammed}/${N})`, clamp(S.rammed / 5), 1.3);
        s.fx.smokePuff(car.pos, 16, { size: 3, up: 5 }); s.fx.fireBurst?.(car.pos, 16); s.audio.crash(); s.engine.addShake(1); s.msg(slow ? 'ON ITS SIDE' : 'WHAT A ROLL!', 'huge good'); s.wrap(2.2);
      } });
      const fx = -Math.sin(car.heading), fz = -Math.cos(car.heading); s.onUpdate(() => car.vel.set(fx * st.v, 0, fz * st.v)); // so the raiders behind see a slowing wreck and stop short of it
    };
    s.onUpdate(() => {
      if (!s.started || s.ended || S.rolled) return; const d = car.pos.z - MZ, mph = car.mph;
      s.hud.readout('spd', 'MPH', Math.round(mph), d < 260 ? (mph >= 50 ? 'ok' : 'warn') : ''); s.hud.readout('ram', 'Raiders rammed', S.rammed + '/' + N, S.rammed >= 5 ? 'ok' : ''); s.hud.readout('mk', 'Mark (m)', Math.round(d), Math.abs(d) < 30 ? 'ok' : '');
      if (d < 200) { s.objective('50 mph+ — roll her in the green zone'); s.hud.prompt(Math.abs(d) < 34 ? `${K('A')}/${K('D')} + ${K('SPACE')} — ROLL IT NOW` : d < -34 ? `Late! ${K('A')}/${K('D')} + ${K('SPACE')} — roll her anyway` : `Roll her between the flags`); }
      if (d < -70) { s.flub('Drove through the mark — the stunt team rolled her for you', { penalty: 0.3, advice: 'Between the red flags hold A or D and press SPACE — the rig only goes over when you do both together.' }); return roll(d, mph, true); }
      if (!s.input.hit('a')) return;
      if (d > 75) return s.msg('NOT YET', 'small'); if (Math.abs(s.input.x) < 0.4) return s.msg('YANK THE WHEEL TOO', 'small');
      if (mph < 30) { s.flub(`Only ${mph.toFixed(0)} mph — she leaned and sat back down`, { penalty: 0.15, advice: 'She needs 50+ mph to go over. Build speed back up and try again before the last flag.' }); s.engine.addShake(0.6); s.audio.crash(); return; }
      roll(d, mph, false);
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
    advise(s, 'Flattened a Gotham PD cruiser', 'The cruisers are parked on the kerbs: stay between the yellow centre dashes and correct the trailer snake with small taps of A and D.');
    stall(s, car, 25, 'Hold W to get the rig rolling, then ease off at 45 mph — the MPH readout turns green.');
    const jack = (why, advice) => { const dir = car.pos.x >= 0 ? -1 : 1; car.heading += dir * 0.55; car.crash(why, { injury: 0.65, advice }); };
    // Fire the piston. Within the window it is the shot; outside it she still goes over, just messily (slewed, twisted, lower score).
    // Only a really bad shot jackknifes the rig into the bank.
    const fire = auto => {
      S.fired = true; s.hud.hideBar(); s.hud.prompt(''); const d = car.pos.z - MZ, mph = car.mph, off = Math.abs(car.pos.x), ad = Math.abs(d), p = V3(car.pos.x, 0.4, car.pos.z + 5);
      s.fx.explosion(p, 0.7); s.fx.smokePuff(p, 24, { color: [0.85, 0.85, 0.9], size: 3.5, up: 9, life: 3 }); s.audio.explosion(0.9); s.engine.addShake(1.4);
      if (ad > 18) return jack(`Piston fired ${ad.toFixed(0)} m ${d > 0 ? 'early' : 'late'} — she jackknifed into the bank`, 'Fire with SPACE as the marker on the timing bar crosses the green — the blue line across the street is the mark.');
      if (off > 2.8) return jack(`${off.toFixed(1)} m off the centre line — the trailer went over sideways and through a shop front`, 'Keep the cab on the yellow centre dashes: the trailer snakes, so make small A/D corrections all the way to the mark.');
      if (mph > 64) return jack(`${mph.toFixed(0)} mph is far too hot — she corkscrewed into the building`, 'Hold 45–50 mph: once the readout goes green, lift off W and just feather it.');
      if (ad > WIN && !auto) s.flub(`Piston fired ${ad.toFixed(0)} m ${d > 0 ? 'early' : 'late'}`, { penalty: 0.12, advice: 'Press SPACE as the marker crosses the green band — the truck flips cleanest exactly on the glowing blue line.' });
      if (off > 1.2) s.flub(`${off.toFixed(1)} m off the centre line`, { penalty: 0.12, advice: 'Keep the OFF CENTRE readout under 0.7 m: small A/D taps against the trailer snake, starting 250 m out.' });
      if (mph > 54) s.flub(`${mph.toFixed(0)} mph — too hot`, { penalty: 0.12, advice: 'She corkscrews when you are over 50. Lift off W at 45 mph and let the rig settle.' });
      if (mph < 40) s.flub(`Only ${mph.toFixed(0)} mph — she went over lazily`, { penalty: 0.12, advice: 'Under 45 mph the trailer barely lifts. Keep W down until the MPH readout goes green.' });
      const mess = clamp(Math.max((ad - WIN) / 10, (off - 1.0) / 1.6, (mph - 53) / 9, (40 - mph) / 14, 0)), sg = car.pos.x >= 0 ? 1 : -1;
      const v0 = Math.max(9, Math.abs(car.v)); car.v = v0; car.heading -= sg * mess * 0.15;
      s.slowmo(0.3, 3.2); s.audio.sting(); s.audio.horn(150); s.cam.set({ dist: 30, height: 5, side: 13, stiff: 3 }); s.msg(mess > 0.4 ? 'SHE’S GOING OVER… SORT OF' : 'SHE’S GOING OVER', 'good'); s.objective('');
      // the shot the player loved: low on the street as the rig flips toward camera, then wide, head-on, and round it as it lands
      const P = tumblePath(car, 6, 3), T = P.T;
      s.moment('truck flip', { t0: s.t - 1.6, dur: T + 2.6, w: 8, shots: [{ type: 'low', speed: 0.3, a: 0.2, b: 0.55, at: 1, side: 0.12 }, { type: 'wide', speed: 0.6, a: 0, b: 0.75 }, { type: 'front', speed: 0.45, a: 0.25, b: 0.85 }, { type: 'orbit', speed: 0.7, a: 0.55, b: 1 }] });
      liveEdit(s, P.at, [{ type: 'low', d: 0.95, at: 1, side: 0.12 }, { type: 'wide', d: 1.0, side: 1, whoosh: 1 }, { type: 'front', d: Math.max(0.8, T - 1.95) }, { type: 'orbit', d: 3 }], { hold: true });
      tumble(s, car, { pitchRate: rateFor(0.5, v0, 6), rollRate: sg * rateFor(0.07 * mess, v0, 6), fwd: true, decel: 6, hop: 0, onDone: () => {
        s.rate(`Speed (${mph.toFixed(0)} mph)`, near(mph, 47.5, 3, 15), 1.2); s.rate(`Centre line (${off.toFixed(2)} m off)`, near(off, 0, 0.4, 2.4), 1.3); s.rate('Piston timing', near(ad, 0, PERF + 0.5, 14), 1.5); s.rate('Approach discipline', clamp(good / Math.max(1, tot) / 0.7), 1);
        s.engine.addShake(1.5); s.audio.crash(); s.audio.metal?.(); s.fx.sparks(car.pos, 80, { speed: 14 }); s.fx.smokePuff(car.pos, 24, { size: 3.5 }); s.fx.debris(car.pos, 24, { color: 0x333333, speed: 9 });
        s.msg('ON ITS ROOF!', 'huge good'); s.wrap(2.4, mess < 0.2 ? 'First take. Nobody breathe on that truck.' : 'It is on its roof. That is what counts.');
      } });
    };
    s.onUpdate((dt, t) => {
      if (!s.started || s.ended || S.fired) return; const d = car.pos.z - MZ, mph = car.mph, off = Math.abs(car.pos.x), tt = t - s.t0;
      if (car.grounded && car.v > 6) car.heading += (Math.sin(tt * 1.1 + ph) * 0.045 + Math.sin(tt * 2.7 + ph * 2) * 0.03) * dt * clamp(car.v / 20); // the trailer snakes
      const okV = mph >= 43 && mph <= 52, okX = off < 1.0; if (d < 250 && d > 0) { tot += dt; if (okV && okX) good += dt; }
      s.hud.readout('spd', 'MPH', mph.toFixed(0), okV ? 'ok' : d < 250 ? 'warn' : ''); s.hud.readout('ctr', 'Off centre (m)', off.toFixed(1), okX ? 'ok' : 'warn');
      if (d < 90) { s.hud.bar((75 - d) / 90, [(75 - WIN) / 90, (75 + WIN) / 90], [(75 - PERF) / 90, (75 + PERF) / 90]); s.hud.prompt(`${K('SPACE')} fire the piston on the mark`); }
      if (d < -WIN - 4) { s.flub('Drove over the mark — effects fired the piston late', { penalty: 0.25, advice: 'Press SPACE yourself as the marker crosses the green — the blue line across the street is the mark.' }); return fire(true); }
      if (s.input.hit('a') && d < 120) fire(false);
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

// What the player is asked to do, in plain numbers, plus the film's signature camera angles for the replay.
const EXTRA = {
  casino_roll: { goals: { shot: ['Floor it in the LEFT lane — be at 75+ mph past the camera van', 'After the red road marks, swerve RIGHT onto the steel kicker (green line)', 'Press SPACE as the timing marker crosses the green band to fire the cannon', 'Hang on — the record is 7 rolls'], cut: ['You run over the actress lying in the left lane', 'You hit the camera van or a tree'], stars: ['Number of rolls (record 7)', 'Speed at the kicker', 'Cannon timing', 'Wheels on the kicker'] }, cine: ['low', 'wide', 'front', 'track'] },
  fall_guy: { goals: { shot: ['Stay on the dark wet sand between the cones — soft sand slows you', 'Be doing 80+ mph as you reach the kicker between the orange flags', 'Press SPACE as the timing marker crosses the green band', 'Beat the record: 8.5 rolls'], cut: ['You drive into the sea', 'You crash into something'], stars: ['Number of rolls (record 8.5)', 'Speed at the kicker', 'Cannon timing', 'Wheels on the kicker'] }, cine: ['wide', 'low', 'top', 'front'] },
  fast_train: { goals: { shot: ['Hold W to launch', 'Tap SPACE to shift each time the rev needle is in the GREEN — 4 shifts', 'Beat the orange Supra to the level crossing, 430 m ahead', 'Cross before the freight train (the crossing timer counts down from 12.9 s)'], cut: ['The train hits you'], stars: ['Gear shifts', 'Beating the Supra', 'Time to the crossing', 'Bonus: how close the train was'] }, cine: ['low', 'front', 'track', 'wide'], liveShot: 'low' },
  road_warrior: { goals: { shot: ['Drive the tanker down the desert road and ram the raiders off it (5+ is good)', 'Avoid the burnt-out wrecks and rocks on the verges', 'Reach the red flags (900 m) at 50+ mph', 'Between the flags: hold A or D AND press SPACE to roll the tanker'], cut: ['You crash the tanker into a wreck or rock'], stars: ['Speed at the roll', 'Rolling on the yellow centre flags', 'Raiders rammed', 'Rig in one piece'] }, cine: ['low', 'wide', 'front', 'track'] },
  dark_knight: { goals: { shot: ['Drive the truck down the centre line, holding 45–50 mph (green MPH)', 'Keep OFF CENTRE under 0.7 m — tap A/D against the trailer snake', 'Press SPACE as the timing marker crosses the green, on the blue line, to fire the piston', 'The truck flips end over end onto its roof'], cut: ['You fire 18+ m off the mark, 2.8+ m off centre or above 64 mph — she jackknifes', 'You hit a parked police car'], stars: ['Piston timing', 'Centre line', 'Speed', 'Approach discipline'] }, cine: ['front', 'low', 'wide', 'orbit'] },
  supercop: { goals: { shot: ['Ride the dirt road alongside the train, a touch faster than it (20 m/s)', 'Hit the yellow ramp when the LANDING SPOT meter is green (middle of a wagon)', 'In the air hold A to steer LEFT onto the roof, then straighten up', 'Brake to train speed and stay on the roof for 1.5 s'], cut: ['You fall between wagons, off the roof or hit the side of the train'], stars: ['Landing', 'Middle of the roof', 'Matching train speed', 'Clean approach (no crates)'] }, cine: ['track', 'wide', 'low', 'front'], liveShot: 'wide' },
  furious7: { goals: { shot: ['Slalom the marble pillars and hit the window at 65+ mph (75+ is ideal)', 'In the air hold W to keep the nose up — land in tower two', 'NO BRAKES: dodge the two pillars, floor it, jump into tower three', 'Drive into the crates and sofas to stop before the far windows'], cut: ['You fall short of a tower or go out through the far windows', 'You hit a pillar head-on'], stars: ['Launch speed', 'Both landings', 'Stopping', 'Bodywork'] }, cine: ['wide', 'front', 'low', 'track'] },
  who_am_i: { goals: { shot: ['Slide down the glass — A/D to steer round the yellow cradles and through the gaps in the ledges', 'Hold S to brake with your palms in bursts — let go before the heat meter fills', 'Reach the bottom ledge (green zone) under 18 mph and stop on it'], cut: ['You slide off the side or over the bottom ledge', 'You hit a ledge or cradle hard'], stars: ['Arrival speed at the ledge', 'Pace', 'Clean slide (no bumps)', 'Hands left'] }, cine: ['wide', 'top', 'low', 'front'] },
  hooper: { goals: { shot: ['Drive through the exploding town — swerve round each falling smokestack on the side it is NOT falling from', 'Save the rocket: hold SHIFT for the last 300 m before the ramp', 'Hit the ramp at 110+ mph and hold W in the air', 'Clear the 325 ft gorge and land on all four wheels'], cut: ['You fall into the gorge', 'A smokestack or parked car stops you dead'], stars: ['Take-off speed', 'Landing', 'Dodging the set', 'Rocket fuel left'] }, cine: ['wide', 'low', 'front', 'track'] },
};
export default [casino, fallGuy, fastTrain, roadWarrior, darkKnight, superCop, furious7, whoAmI, hooper].map(d => Object.assign(d, EXTRA[d.id]));
