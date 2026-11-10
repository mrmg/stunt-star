import * as THREE from 'three';
import { Fight, chart } from '../modes/fight.js';
import { clamp, V3, rnd, damp } from '../world/stage.js';
import { CTL, K } from './common.js';

const KEYS = { L: 'left', R: 'right', U: 'up', D: 'down', B: 'a' };
const fbot = (s, inp) => { const f = s.fight; if (!f) return; const b = f.beats.find(b => !b.res); if (b && Math.abs(b.t - f.t) < 0.035) inp.press(KEYS[b.dir]); };
// end of fight: rate it and wrap. A knock-down (health gone) still wraps — with whatever was landed, so a low score.
function finish(s, f, extra) {
  f.onDone = () => { const r = f.score(); s.rate('Timing', r.acc, 2); s.rate('Longest combo', clamp(r.combo * 1.6)); s.rate('Health left', r.hp); extra?.(r); s.bonus('Perfect hits', f.perfects * 40); if (!f.dead) f.c.setCycle('cheer', 1); s.wrap(1.8, f.dead ? 'Knocked down before the end of the fight' : undefined); };
  s.onUpdate(() => { if (s.started && !f.done) s.objective(`${f.beats.filter(b => b.res).length} / ${f.beats.length} moves`); });
}
// mark the film's signature beat for the replay: every successful beat passing test() adds a moment; later/bigger ones win
function signature(s, f, test, label, o = {}) {
  const base = f._success.bind(f); let n = 0;
  f._success = (b, perfect) => { base(b, perfect); if (!test(b, perfect)) return; if (o.slow !== false) s.slowmo(o.slow ?? 0.4, 0.45); s.moment(label, { t0: s.t - (o.pre ?? 1.3), t1: s.t + (o.post ?? 0.9), w: (o.w ?? 2) + (n++) * 0.001 + (perfect ? 0.01 : 0), shots: o.shots }); };
}
// a side-on fight stage: floor, back wall, optional ceiling. Player stands at x=0,z=0 and the camera looks down -Z.
function room(s, o) {
  const { x0 = -30, x1 = 30, depth = 7, h = 4.2, floor, wall, ceil } = o, w = x1 - x0, cx = (x0 + x1) / 2;
  s.box({ x: cx, y: -0.3, z: -depth / 2 + 2.5, w, h: 0.3, d: depth + 5, mat: floor, tile: o.floorTile ?? 3, cast: false });
  s.box({ x: cx, y: 0, z: -depth + 2.2, w, h, d: 0.3, mat: wall, tile: o.wallTile ?? h });
  if (ceil) s.box({ x: cx, y: h, z: -depth / 2 + 2.5, w, h: 0.25, d: depth + 5, mat: ceil, tile: 4, cast: false });
}

// ---------------------------------------------------------------------------------------------
const enterDragon = {
  id: 'enter_dragon', title: 'Cavern of Guards', film: 'Enter the Dragon', year: 1973, tier: 2, pay: 4400, mode: 'fight', art: 'bd_hk', music: 'kungfu',
  role: 'Lead fighter — bare hands against the island guards',
  brief: 'They come at you one at a time, left and right, and each one goes down with a single strike. I do not want fast. I want exact. Hit the beat and the audience feels it in their teeth.',
  tips: ['Each guard is a beat. Press the matching key <b>as the marker enters the box</b>.', '← → strike that side. ↑ is a jump kick, ↓ ducks a high swing, ● blocks.', 'Miss a beat and you take the hit. Eight hits and the director calls it early.'],
  controls: CTL.fight, intro: { r: 6, h: 1.8, up: 1.1 },
  assets: { models: ['ch_kungfu', 'ch_goon'], tex: ['bd_hk', 'tx_cave', 'tx_rock', 'tx_wood'] },
  build(s) {
    s.env('cave', { look: 'golden', fog: 0.02, amb: 1.6, sunI: 0.6, shadows: true, lookOver: { bloom: 0.6 } });
    room(s, { floor: { tex: 'tx_rock', color: 0x8a7a66 }, wall: { tex: 'tx_cave', color: 0xbba58a }, h: 7, depth: 8, wallTile: 5 });
    for (let x = -24; x <= 24; x += 8) { s.cyl({ x, z: -4.6, r: 0.5, h: 7, mat: { tex: 'tx_rock', color: 0x6b5a4a } }); s.light({ x: x + 4, y: 3.2, z: -3.2, color: 0xffa860, i: 22, dist: 16, r: 0.14 }); s.onUpdate(() => { if (Math.random() < 0.5) s.fx.flame(V3(x + 4, 3.1, -3.2), 0.35); }); }
    for (const x of [-9, 9, -17, 17]) s.box({ x, y: 0, z: -4.4, w: 1.6, h: 1.1, d: 1, mat: { tex: 'tx_wood', color: 0x7a5a3a }, tile: 1.2 });
    s.crew({ x: -6, z: 5.5, ry: Math.PI, people: false });
    const beats = chart('R . L . R R . L . U . R L . D . L . R . L R L . B . U . R . L L . R . D . R L R . U', { bpm: 104, start: 1.6 });
    const f = s.fight = new Fight(s, { char: 'ch_kungfu', enemies: ['ch_goon'], beats, hp: 8, camDist: 7.2 }); finish(s, f);
    signature(s, f, b => b.dir === 'U', 'The flying kick', { w: 2 });
  },
  bot: fbot,
};

// ---------------------------------------------------------------------------------------------
const oldboy = {
  id: 'oldboy', title: 'The Corridor', film: 'Oldboy', year: 2003, tier: 3, pay: 8200, mode: 'fight', art: 'bd_tokyo', music: 'tension',
  role: 'One man, one hammer, one corridor — in a single unbroken take',
  brief: 'No cuts. The camera tracks sideways down the corridor with you and never stops, so neither do you. Thirty men. Drop a beat and you take the hit — but you keep fighting.',
  tips: ['It is <b>one continuous take</b> — you keep moving right the whole time.', 'They attack from both ends of the corridor. Watch the key letters on the markers, not the bodies.', 'Blocks (● SPACE) come when you are swarmed — do not swing, cover up.'],
  controls: CTL.fight, intro: { r: 5.5, h: 1.6, up: 1.1, a0: 0.2, speed: 0.05 },
  assets: { models: ['ch_hammer', 'ch_thug', 'ch_goon'], tex: ['bd_tokyo', 'tx_wallpaper', 'tx_concrete'] },
  build(s) {
    s.env('indoor', { look: 'matrix', fog: 0.03, amb: 1.9, sunI: 0.3, lookOver: { sat: 0.6, grain: 0.07, tint: [0.92, 1.03, 0.86] } });
    room(s, { x0: -20, x1: 90, depth: 3.4, h: 3, floor: { tex: 'tx_concrete', color: 0x6a6f60 }, wall: { tex: 'tx_wallpaper', color: 0xc8d0b0 }, ceil: { color: 0x555a50 }, wallTile: 3 });
    for (let x = -16; x < 90; x += 6.5) { s.box({ x, y: 0, z: -1.05, w: 1.0, h: 2.2, d: 0.08, mat: { color: 0x3a2f28, rough: 0.6 } }); s.box({ x: x + 3.2, y: 2.9, z: 0.2, w: 1.4, h: 0.06, d: 0.25, mat: s.mat({ color: 0xd8ffd0, emissive: 0xc8ffc0, emI: 2.2 }), cast: false }); if (((x + 16) / 6.5) % 2 < 1) s.light({ x: x + 3.2, y: 2.7, z: 0.2, color: 0xc8ffc0, i: 14, dist: 9, bulb: false }); }
    const beats = chart('R . R . L . R R . L . B . R . L R . D . R . R L . U . R . B . L . R R R . L . D . R L . R . U . R . L . B . R R . L R', { bpm: 112, start: 1.6 });
    const f = s.fight = new Fight(s, { char: 'ch_hammer', enemies: ['ch_thug', 'ch_goon'], beats, hp: 8, travel: 0.95, camDist: 5.6, fov: 52, backZ: -0.6 });
    // the whole corridor in one unbroken sideways track
    finish(s, f, () => s.moment('The corridor — one take', { t0: s.t - 8.5, t1: s.t + 0.6, w: 2.5 }));
    // the hammer
    const hm = new THREE.Group(); hm.add(new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.34, 6), s.mat({ color: 0x6b4a2a }))); const hd = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.04, 0.04), s.mat({ color: 0x333333, metal: 0.8, rough: 0.4 })); hd.position.y = 0.17; hm.add(hd); f.c.bones.RightHand?.add(hm); hm.scale.setScalar(100); hm.rotation.x = Math.PI / 2;
  },
  bot: fbot,
};

// ---------------------------------------------------------------------------------------------
const killBill = {
  id: 'kill_bill', title: 'Eighty-Eight to One', film: 'Kill Bill: Vol. 1', year: 2003, tier: 4, pay: 13500, mode: 'fight', art: 'bd_tokyo', music: 'kungfu',
  role: 'Doubling the Bride against the masked gang — teahouse, Tokyo',
  brief: 'Black suits, black masks, eighty-eight of them. Half way through we kill the colour and go to black and white — that is when it gets fast. Do not blink.',
  tips: ['The tempo <b>steps up</b> when the picture goes black and white.', 'Pairs attack together: two markers close together means two quick presses.', 'A long combo is worth as much as clean timing. Do not break the chain.'],
  controls: CTL.fight, intro: { r: 6, h: 1.8, up: 1.1 },
  assets: { models: ['ch_bride', 'ch_goon'], tex: ['bd_tokyo', 'tx_wood', 'tx_snow'] },
  build(s) {
    s.env('night', { backdrop: 'bd_tokyo', look: 'cold', fog: 0.012, amb: 1.5, sunI: 1.1, lookOver: { bloom: 0.3, sat: 1.2 } });
    s.ground({ tex: 'tx_snow', tile: 5, color: 0x8a94b0 });
    room(s, { x0: -26, x1: 26, depth: 9, h: 0.05, floor: { tex: 'tx_wood', color: 0xb58a55 }, wall: { color: 0x222222 }, floorTile: 2 });
    const paper = s.mat({ color: 0xfff4d8, emissive: 0xffe2a0, emI: 0.22 }), dark = s.mat({ color: 0x1c1410, rough: 0.6 });
    for (let x = -24; x <= 24; x += 4) { s.box({ x, y: 0, z: -6.4, w: 3.7, h: 3.2, d: 0.08, mat: paper, cast: false }); s.box({ x: x + 2, y: 0, z: -6.35, w: 0.16, h: 3.4, d: 0.16, mat: dark }); for (const y of [1.05, 2.1]) s.box({ x, y, z: -6.34, w: 4, h: 0.06, d: 0.06, mat: dark, cast: false }); }
    s.box({ x: 0, y: 3.3, z: -6.3, w: 52, h: 0.5, d: 1.4, mat: dark }); for (const x of [-10, 10]) s.light({ x, y: 2.6, z: -2, color: 0xffd9a0, i: 25, dist: 22, bulb: false });
    s.forest('tree:snowpine', 40, r => [(r() - 0.5) * 90, -14 - r() * 50], { h: [5, 10], seedv: 5 });
    const p = V3(), v = V3(); s.onUpdate(() => { const c = s.camera.position; for (let i = 0; i < 3; i++) s.fx.streak(p.set(c.x + rnd(-10, 10), rnd(1, 7), c.z - rnd(3, 14)), v.set(rnd(-0.6, 0.6), -1.6, 0), [1, 1, 1], 1.2, 0.06, 0.7); });
    const a = chart('R . L . R . U . L L . R . D . R L . B . R . L . U . R R . L', { bpm: 108, start: 1.6 }), tB = a.at(-1).t + 1.6;
    const b = chart('R L . R . L R . U . L . R L R . D . L . R R . B . L R . U . L . R L . R L R . D . R . L L R', { bpm: 132, start: tB });
    const f = s.fight = new Fight(s, { char: 'ch_bride', enemies: ['ch_goon'], beats: [...a, ...b], hp: 8, camDist: 7.4 }); let bw = false;
    s.onUpdate(() => { if (!bw && f.t > tB - 0.9) { bw = true; s.engine.setLook('noir', { grain: 0.09, bloom: 0.15 }); s.engine.flash(0.6); s.msg('NO COLOUR — FASTER', 'small'); } });
    // the black-and-white flurry is the shot (the replay stays in black and white)
    signature(s, f, b => b.t >= tB && (b.dir === 'U' || b.dir === 'D' || b.dir === 'B'), 'Black and white', { w: 2, pre: 1.6 });
    finish(s, f);
  },
  bot: fbot,
};

// ---------------------------------------------------------------------------------------------
const matrixDodge = {
  id: 'matrix_dodge', title: 'Bullet Time', film: 'The Matrix', year: 1999, tier: 4, pay: 12500, mode: 'fight', art: 'bd_nyc_night', music: 'synth',
  role: 'Wire work — rooftop, one hundred and twenty still cameras in an arc',
  brief: 'He empties the clip at you. We shoot it so slow the audience can count the bullets — which means they can also see exactly when you move. Lean on the beat. Late and it clips you.',
  tips: ['Every marker is a <b>bullet</b>. Press its key as it reaches the box: <b>A</b>/<b>D</b> sway, <b>S</b> the big lean back, <b>SPACE</b> brace.', 'The gunshot comes half a second before the bullet arrives — dodge on the marker, not the bang.', 'Time slows on every clean dodge. Use it to read the next one.'],
  controls: `${K('A')}${K('D')} sway &nbsp; ${K('S')} lean back &nbsp; ${K('W')} hop &nbsp; ${K('SPACE')} brace — on the beat`, intro: { r: 6, h: 2, up: 1.1 },
  assets: { models: ['ch_coat', 'ch_goon'], tex: ['bd_nyc_night', 'tx_roof', 'tx_concrete', 'tx_fac_office'] },
  build(s) {
    s.env('overcast', { backdrop: 'bd_nyc_night', look: 'matrix', fog: 0.004, hz: 0.42, bdGain: 2.2 });
    s.ground({ tex: 'tx_concrete', y: -80, base: false, color: 0x333833 });
    s.box({ x: 0, y: -40, z: -4, w: 60, h: 40, d: 34, mats: undefined, mat: { tex: 'tx_roof', color: 0x8a9488 }, tile: 5 });
    for (const [x, z, w, h] of [[-12, -12, 5, 2.6], [9, -14, 3, 3.4], [16, -9, 2, 1.4]]) s.box({ x, y: 0, z, w, h, d: 3, mat: { tex: 'tx_concrete', color: 0x8a9488 }, tile: 3 });
    for (let i = 0; i < 9; i++) s.building({ x: -70 + i * 18, z: -60 - (i % 3) * 14, w: 14, d: 14, h: 30 + (i * 37) % 50, y: -80, fac: 'tx_fac_office', solid: false });
    const agent = s.char('ch_goon', { x: 5.4, z: 0, heading: Math.PI / 2 }); agent.setPose('point', 0);
    const beats = chart('D . . L . . R . . D . L . R . . B . . D . R L . . D . . L . R . D . . B . L R . D', { bpm: 76, start: 2, sub: 2 });
    const tmp = V3(), vel = V3();
    const f = s.fight = new Fight(s, {
      char: 'ch_coat', beats, hp: 8, camDist: 6.2, camLead: 2.4, look: 2.1, failMsg: 'Took too many rounds — the director called it', injury: 0.55, names: { L: 'sway left', R: 'sway right', U: 'hop', D: 'lean back', B: 'brace' },
      koAdvice: 'Each marker is one bullet: press its key once as it enters the box — S for the big lean, A/D to sway, SPACE to brace. Ignore the gunshot sound; it comes early.',
      spawn: (b, F) => { s.after(Math.max(0, b.t - F.t - 0.5), () => { s.audio.gun(); s.fx.light(V3(4.7, 1.5, 0), 0xfff0b0, 30, 0.08, 12); b.shot = F.t; }); return true; },
      onHit: (b, perfect, F) => { F.c.heading = -Math.PI / 2; F.c.setPose(b.dir === 'D' ? 'lean' : b.dir === 'B' ? 'block' : b.dir === 'U' ? 'jump' : { sp: [0, 0, b.dir === 'L' ? 0.75 : -0.75], hip: [-0.1, 0, 0, b.dir === 'L' ? 0.25 : -0.25], aR: [1, 0.1, 0.1, 1, 0.3, 0.2], aL: [1, 0.1, 0.1, 1, 0.3, 0.2] }, 0.07); F.poseT = 0.6; s.slowmo(0.22, 0.28); s.audio.whoosh(1.6); return true; },
      onMiss: (b, F) => { s.fx.sparks(V3(F.pos.x, 1.3, 0), 10, { speed: 4, color: [1, 0.3, 0.2] }); if (F.hp <= 0) return false; return true; },
    });
    f.c.heading = -Math.PI / 2;
    s.onUpdate(() => { for (const b of f.beats) { if (b.shot == null || f.t > b.t + 0.5) continue; const k = (f.t - b.shot) / Math.max(0.05, b.t - b.shot), x = 4.6 - k * 5.0, y = b.dir === 'D' ? 1.45 : 1.25, z = b.dir === 'L' ? 0.25 : b.dir === 'R' ? -0.25 : 0; for (let i = 0; i < 3; i++) s.fx.streak(tmp.set(x + i * 0.12, y, z), vel.set(0, 0, 0), [0.75, 1, 0.8], 0.45, 0.09, 0.5); if (Math.random() < 0.5) s.fx.streak(tmp.set(x, y, z), vel.set(0, 0, 0), [1, 1, 1], 0.1, 0.16, 0.9); } });
    signature(s, f, b => b.dir === 'D', 'Bullet time', { w: 2.2, pre: 1.0, post: 0.8, slow: false });
    finish(s, f);
  },
  bot: fbot,
};

// ---------------------------------------------------------------------------------------------
const inception = {
  id: 'inception', title: 'The Spinning Hallway', film: 'Inception', year: 2010, tier: 5, pay: 23000, mode: 'fight', art: 'bd_paris', music: 'epic',
  role: 'Hotel corridor fight — inside a hundred-foot rotating set',
  brief: 'The whole corridor is built inside a steel drum and it turns. The floor becomes the wall becomes the ceiling. You fight him and you fight gravity, and you do both on the beat.',
  tips: ['The set <b>rotates</b>: ↑ <b>W</b> markers are your jump as the wall comes round to meet you.', 'Ignore the horizon — it is lying to you. Trust the markers.', 'Miss a beat and you take the hit — eight and the director calls it.'],
  controls: CTL.fight, intro: { r: 5, h: 1.5, up: 1.1, a0: 0.15, speed: 0.04 },
  assets: { models: ['ch_suit', 'ch_goon'], tex: ['bd_paris', 'tx_hotel', 'tx_wood'] },
  build(s) {
    s.env('indoor', { look: 'teal_orange', fog: 0.02, amb: 4.5, sunI: 0.4, lookOver: { bloom: 0.3 } });
    const drum = new THREE.Group(); drum.position.set(0, 1.5, 0); s.scene.add(drum);
    const wall = { tex: 'tx_hotel', color: 0xfff0dd }, carpet = s.mat({ color: 0x7a2a22, rough: 0.95 }), wood = s.mat({ tex: 'tx_wood', color: 0x5a3a22 }), lamp = s.mat({ color: 0xfff0c0, emissive: 0xffd890, emI: 1.1 });
    s.box({ parent: drum, x: 20, y: -1.62, z: 0, w: 110, h: 0.12, d: 3, mat: carpet, cast: false }); s.box({ parent: drum, x: 20, y: 1.5, z: 0, w: 110, h: 0.12, d: 3, mat: { color: 0xe8e0d0 }, cast: false });
    s.box({ parent: drum, x: 20, y: -1.5, z: -1.56, w: 110, h: 3, d: 0.12, mat: wall, tile: 3 });
    for (let x = -30; x < 74; x += 5) { s.box({ parent: drum, x, y: -1.5, z: -1.48, w: 1, h: 2.2, d: 0.06, mat: wood }); s.box({ parent: drum, x: x + 2.5, y: 0.55, z: -1.44, w: 0.18, h: 0.3, d: 0.14, mat: lamp, cast: false }); s.box({ parent: drum, x: x + 2.5, y: 1.42, z: 0, w: 0.5, h: 0.06, d: 0.5, mat: lamp, cast: false }); }
    for (const x of [-8, 6, 20, 34, 48]) s.light({ x, y: 2.6, z: 0.3, color: 0xffd9a0, i: 30, dist: 14, bulb: false });
    const beats = chart('R . L . R . . U . R . L . D . . U . L R . B . . U . R . R L . . U . D . L . R . . U . R L R . B . . U . L . R', { bpm: 104, start: 1.8 });
    const f = s.fight = new Fight(s, { char: 'ch_suit', enemies: ['ch_goon'], beats, hp: 8, travel: 0.5, camDist: 5.2, fov: 54, failMsg: 'Thrown into the ceiling one time too many', injury: 0.5, koAdvice: 'The ↑ W markers are jumps timed to the wall coming round — press W as the marker enters the box, and do not swing between moves.' });
    signature(s, f, b => b.dir === 'U', 'The corridor turns', { w: 2, pre: 1.6, post: 1.0 });
    // rotation: a quarter turn completes on every ↑ beat
    const ups = beats.filter(b => b.dir === 'U').map(b => b.t); let ang = 0;
    s.onUpdate(dt => { if (!s.started) return; const n = ups.filter(t => t <= f.t).length, nx = ups[n], pv = n ? ups[n - 1] : 0; const k = nx ? clamp((f.t - pv) / (nx - pv)) : 0; const target = (n + k * k * k) * Math.PI / 2; ang = damp(ang, target, 8, dt); drum.rotation.x = ang; s.cam.roll = Math.sin(ang * 0.5) * 0.16; drum.position.x = f.pos.x * 0; });
    finish(s, f, () => { s.cam.roll = 0; });
  },
  bot: fbot,
};

// What the player is asked to do, in plain numbers, plus the film's signature camera angles for the replay.
const KEYS_LINE = 'Press the key shown on each marker as it slides into the white box: A strike left, D strike right, W jump kick, S duck, SPACE block';
const CUT = ['Nothing ends it early except 8 missed moves — then the director calls it and you keep a low score'];
const STARS = ['Timing (inside the box = GOOD, dead centre = PERFECT)', 'Longest combo without a miss', 'Health left'];
const EXTRA = {
  enter_dragon: { goals: { shot: ['Guards run in from both sides — one marker per guard slides along the lane', KEYS_LINE, '25 moves in about 14 s, one every half-second — a missed one costs a combo and 1 of your 8 health'], cut: CUT, stars: STARS }, cine: ['wide', { type: 'low', speed: 0.4 }, { type: 'orbit', speed: 0.5 }] },
  oldboy: { goals: { shot: ['You walk right down the corridor the whole time — the camera tracks with you in one take', KEYS_LINE, '34 moves in about 17 s, attackers from both ends; ● SPACE blocks come when you are swarmed'], cut: CUT, stars: STARS }, cine: [{ type: 'track', side: -1, speed: 1, a: -0.05, b: 1.05, fov: 46 }] },
  kill_bill: { goals: { shot: [KEYS_LINE, '17 moves at a steady pace, then the picture goes black and white and 29 more come faster (132 bpm)', 'Two markers close together = two quick presses — do not break the chain'], cut: CUT, stars: STARS }, cine: ['top', { type: 'low', speed: 0.45 }, { type: 'orbit', speed: 0.5 }] },
  matrix_dodge: { goals: { shot: ['Each marker is a bullet — 18 of them over about 18 s', 'Press its key as it reaches the box: S lean back, A sway left, D sway right, SPACE brace', 'The gunshot comes ~0.5 s before the bullet — dodge on the marker, not the bang'], cut: ['Only 8 bullets taken — then the director calls it and you keep a low score'], stars: STARS }, cine: [{ type: 'orbit', speed: 0.22, a: -0.4, b: 1.1, heading: Math.PI / 2 }, { type: 'low', speed: 0.45, heading: Math.PI / 2 }, { type: 'wide', speed: 0.7 }] },
  inception: { goals: { shot: ['The corridor rotates a quarter turn on every ↑ marker — press W to jump as the wall comes round (6 jumps)', KEYS_LINE, '27 moves in about 18 s while you drift right down the corridor'], cut: CUT, stars: STARS }, cine: [{ type: 'track', side: -1, fov: 40 }, { type: 'low', side: -1, speed: 0.4 }, { type: 'wide', side: -1 }] },
};
export default [enterDragon, oldboy, killBill, matrixDodge, inception].map(d => Object.assign(d, EXTRA[d.id]));
