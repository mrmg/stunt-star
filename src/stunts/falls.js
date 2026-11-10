import * as THREE from 'three';
import { Fall } from '../modes/fall.js';
import { Drive, Movers } from '../modes/drive.js';
import { clamp, near, smooth, V3, rnd, sr, srand, lerp, damp } from '../world/stage.js';
import { POSES } from '../world/character.js';
import { K, CTL, botDrive, sign } from './common.js';
import { model } from '../core/assets.js';
import * as dress from '../world/dress.js';

const ftOf = m => Math.round(m * 3.281);
const G = 9.81;
// stretched cylinder between two points (bungee cords, piton lines, harness straps)
function rope(s, color = 0x1a1a1a, r = 0.035) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1, 5), new THREE.MeshBasicMaterial({ color })); m.frustumCulled = false; s.scene.add(m); const d = V3(), up = V3(0, 1, 0);
  return { m, set(a, b) { d.subVectors(b, a); const L = d.length() || 1e-3; m.position.copy(a).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(up, d.divideScalar(L)); m.scale.set(1, L, 1); } };
}
// flat disc decal (deep-water patch, landing zones)
function disc(s, x, y, z, r, color, op = 0.6) { const m = new THREE.Mesh(new THREE.CircleGeometry(r, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); s.scene.add(m); return m; }
// bot: steer a Fall (yaw 0) toward a world x/z, compensating for wind
function botSteer(f, inp, tx, tz, g = 0.6) { const st = f.o.steer * (f.chute ? 0.55 : 1) || 1; inp.x = clamp((tx - f.pos.x - f.carry.x * 0.6) * g - (f.windX || 0) / st, -1, 1); inp.y = clamp((f.pos.z + f.carry.z * 0.6 - tz) * g + (f.windZ || 0) / st, -1, 1); }
// instanced trees / rocks at explicit heights (on top of set boxes that are not course pieces): pts = [[x, z, y], ...]
const treesAt = (s, kind, pts, o) => pts.length && s.trees(kind, pts.length, (_, i) => pts[i], o);
const rocksAt = (s, pts, o) => pts.length && s.forest('rock_grey', pts.length, (_, i) => pts[i], o);
const PENCIL = { ...POSES.stand, hd: [0.25, 0, 0], aR: [0.08, -1, 0.12, -0.3, -0.2, 0.5], aL: [0.08, -1, 0.12, -0.3, -0.2, 0.5], lR: [0.03, -1, 0, 0.02, -1, 0], lL: [0.03, -1, 0, 0.02, -1, 0] };

// ---------------------------------------------------------------------------------------------
const SIG_BUTCH = [-26, 139.5, -77.3]; // across the gorge, right on the far lip so the whole fall stays in view
const butch = {
  id: 'butch_cliff', title: 'Canyon Leap', film: 'Butch Cassidy and the Sundance Kid', year: 1969, tier: 1, pay: 2000, mode: 'fall', art: 'bd_river_gorge', music: 'western',
  role: 'Doubling the outlaw — boots, hat and a very long way down',
  brief: 'The posse has you both cornered on the rim. So you run, you jump, and you hit that river feet first. The deep channel is the size of a wagon — everything else is a foot of water over rock.',
  tips: ['Hold <b>W</b> to sprint and hit <b>SPACE</b> right at the lip for a clean take-off.', 'Steer for the <b>marked deep channel</b> — the canyon wind pushes you left.', 'Hold <b>SPACE</b> before you hit to straighten up and go in <b>feet first</b>. You cannot steer much while straight.'],
  controls: `${K('W')} sprint &nbsp; ${K('SPACE')} jump &nbsp; in the air: ${K('W')}${K('A')}${K('S')}${K('D')} steer &nbsp; hold ${K('SPACE')} straighten up`, intro: { r: 9, h: 3 },
  assets: { models: ['ch_adventurer', 'rock_grey', 'camera_crew', 'film_light', 'director_chair', 'ch_stunt'], tex: ['bd_river_gorge', 'tx_rock', 'tx_dirt', 'tx_redrock'] },
  build(s) {
    // Animas gorge, Colorado, summer afternoon: sun high over the far rim lights the face you fall down, the river runs in the canyon's shade
    s.env('day', { backdrop: 'bd_river_gorge', look: 'warm60s', fog: 0.0019, hz: 0.5, sun: [58, 200], sunI: 3.6, amb: 1.25, lookOver: { contrast: 1.1, sat: 1.02, vignette: 0.42 } });
    const H = 130, CX = 9, CZ = -30, R = 7.5, inp = s.input;
    s.ground({ tex: 'tx_rock', tile: 16, y: -3, color: 0x7d7262 }); s.water({ y: 0, color: 0x2c6e62, w: 1400, d: 80, z: -38, opacity: 0.88 }); s.course.addPiece({ x0: -700, x1: 700, z0: -78, z1: -1.2, fn: () => 0, step: 1e9 }); // river surface (keeps replay cameras above the water)
    const rock = s.mat({ tex: 'tx_rock', color: 0xc2a27e }), dirt = s.mat({ tex: 'tx_dirt', color: 0xc9a77c }), mats = [rock, rock, dirt, dirt, rock, rock];
    s.box({ x: 0, y: -3, z: 150, w: 1400, h: H + 3, d: 300, mats, tile: 26, tileTop: 9, top: true });
    s.box({ x: 0, y: -3, z: -78 - 200, w: 1400, h: H + 9, d: 400, mats, tile: 26, tileTop: 9 });
    srand(7); for (let i = 0; i < 16; i++) { const sd = i % 2 ? -1 : 1, x = sd * (34 + Math.floor(i / 2) * 46 + sr(20)), far = i % 4 > 1; const d = sr(8, 20), h = H * sr(0.3, 0.95) + (far ? 20 : 0); s.box({ x: far ? x * 0.7 : x, y: -3, z: far ? -78 + d / 2 - 1 : -d / 2 + 1, w: sr(18, 40), h, d, mats, tile: 26, tileTop: 9, top: true }); }
    const rocks = []; srand(3); for (let i = 0; i < 26; i++) { const x = sr(-70, 80), z = sr(-72, -5); if (Math.hypot(x - CX, z - CZ) < R + 4) continue; const h = sr(2, 5.5); s.put('rock_grey', { x, y: -1.2, z, height: h, ry: sr(6) }); rocks.push([x, z, h * 0.5]); }
    disc(s, CX, 0.04, CZ, R, 0x0b2f3a, 0.75); s.mark({ x: CX, z: CZ, y: 0.02, r: R, color: 0xffe14a }); for (let a = 0; a < 6.2; a += 0.785) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 6), s.mat({ color: 0xff5a10, rough: 0.5 })); b.position.set(CX + Math.cos(a) * R, 0.1, CZ + Math.sin(a) * R); s.scene.add(b); }
    // rock variety: granite slabs and buttresses standing proud of both faces, darker strata ledges with scrub, talus at the foot
    const gran = s.mat({ tex: 'tx_rock', color: 0xa89884 }), red = s.mat({ tex: 'tx_redrock', color: 0xc8a890 }), strat = s.mat({ tex: 'tx_rock', color: 0x7c705f }), slabM = [rock, gran, red, gran];
    const clearN = (x, pad = 0) => x > -18 - pad && x < 28 + pad, clearF = (x, pad = 0) => x > -45 - pad && x < 15 + pad; // the fall line on the near face and the signature camera's patch of the far lip stay bare
    srand(21); for (let i = 0; i < 46; i++) { const near = i % 2 === 0, x = sr(-420, 420), w = sr(12, 40); if (near ? clearN(x, w / 2 + 2) : clearF(x, w / 2)) continue; const h = sr(20, 75), d = sr(2.5, 7), y = sr(-3, H - h - 6); s.box({ x, y, z: near ? -d / 2 + 0.6 : -78 + d / 2 - 0.6, w, h, d, mat: slabM[i % 4], tile: 26 }); }
    s.box({ x: -45, y: -3, z: -14, w: 14, h: 90, d: 28, mats: [gran, gran, rock, rock, gran, gran], tile: 26, tileTop: 9 }); treesAt(s, 'pine', [[-48, -4, 87], [-41, -8, 87], [-50, -12, 87]], { h: [5, 9], seedv: 36 }); // granite spur down-canyon: the profile camera stands on it
    const scrub = [], ledgeRocks = [];
    for (const [near, ys] of [[true, [34, 66, 98]], [false, [28, 61, 92, 118]]]) for (const yb of ys) { srand(yb * 3 + (near ? 1 : 2)); for (let x = -460; x < 460;) { const L = sr(16, 60), d = sr(1.4, 3), y = yb + sr(-5, 5), cx = x + L / 2; x += L + sr(6, 40); if (near ? clearN(cx, L / 2) : clearF(cx, L / 2)) continue; s.box({ x: cx, y, z: near ? -d / 2 : -78 + d / 2, w: L, h: sr(1.2, 2.6), d, mat: strat, tile: 14, cast: true }); for (let k = 0; k < L / 9; k++) if (sr() < 0.7) scrub.push([cx + sr(-L / 2, L / 2), near ? -d * 0.6 : -78 + d * 0.6, y + 2.2]); } }
    treesAt(s, 'bush', scrub, { h: [1.4, 3.2], seedv: 23, wide: 1.3 }); treesAt(s, 'pine', scrub.filter((_, i) => i % 3 === 0).map(([x, z, y]) => [x + 1, z, y]), { h: [3.5, 7], seedv: 24 });
    srand(25); for (let i = 0; i < 110; i++) { const near = i % 2 === 0, x = sr(-360, 360); if (near && clearN(x, -4)) continue; ledgeRocks.push([x, near ? sr(-9, -1.5) : sr(-76.5, -69), sr(-2.2, -1)]); }
    rocksAt(s, ledgeRocks, { h: [3, 9], seedv: 26 });
    // the river: gravel bars along both feet, white water streaming off the boulders, darker eddies
    const grav = s.mat({ tex: 'tx_dirt', color: 0xb8ab94 }); srand(27); for (let x = -500; x < 500;) { const L = sr(20, 70), cx = x + L / 2; x += L + sr(10, 50); for (const near of [true, false]) { if (near && cx > -6 - L / 2 && cx < 22 + L / 2) continue; const d = sr(3, 7); s.box({ x: cx, y: -0.9, z: near ? -d / 2 : -78 + d / 2, w: L, h: 1.15, d, mat: grav, tile: 8, cast: false }); } }
    const foamG = new THREE.CircleGeometry(1, 20), foamM = new THREE.MeshBasicMaterial({ color: 0xe8f0ec, transparent: true, opacity: 0.3, depthWrite: false }), eddyM = new THREE.MeshBasicMaterial({ color: 0x0c3a36, transparent: true, opacity: 0.35, depthWrite: false });
    const sheet = (x, z, sx, sz, m, y = 0.05, ry = 0) => { const q = new THREE.Mesh(foamG, m); q.rotation.set(-Math.PI / 2, 0, ry); q.position.set(x, y, z); q.scale.set(sx, sz, 1); s.scene.add(q); };
    srand(29); for (const [x, z, r] of rocks) { if (Math.hypot(x - CX, z - CZ) < R + 3) continue; sheet(x + r * 2.4, z, r * 3, r * 0.7, foamM); sheet(x + r * 6, z + sr(-1, 1), r * 2.4, r * 0.32, foamM, 0.06); sheet(x + r * 9, z + sr(-1.5, 1.5), r * 2, r * 0.22, foamM, 0.065); }
    for (let i = 0; i < 40; i++) { const x = sr(-400, 400), z = sr(-74, -4); if (Math.hypot(x - CX, z - CZ) < R + 6) continue; sheet(x, z, sr(5, 16), sr(0.25, 0.8), i % 3 ? foamM : eddyM, 0.04 + i * 0.0004, sr(-0.15, 0.15)); }
    // pines along both rims (the far rim is not a course piece, so heights are explicit) and on the near rim either side of the run-up
    srand(31); const farP = [], nearP = []; for (let i = 0; i < 420; i++) { const x = sr(-520, 520), z = -80 - Math.pow(sr(), 1.6) * 260; if (x > -40 && x < -12 && z > -100) continue; farP.push([x, z, H + 6]); }
    for (let i = 0; i < 260; i++) { const x = sr(-480, 480), z = 4 + Math.pow(sr(), 1.3) * 240; if (x > -14 && x < 16 && z < 120) continue; nearP.push([x, z]); }
    treesAt(s, 'pine', farP, { h: [9, 19], seedv: 32 }); treesAt(s, 'bush', farP.filter((_, i) => i % 3 === 0).map(([x, z, y]) => [x + 2, z + 1, y]), { h: [1.2, 2.5], seedv: 33 }); s.trees('pine', nearP.length, (_, i) => nearP[i], { h: [8, 17], seedv: 34 });
    s.trees('bush', 80, r => { const x = sr(-120, 120); return Math.abs(x) < 12 ? null : [x, sr(3, 90)]; }, { h: [0.8, 2], seedv: 35, wide: 1.4 });
    s.crew({ x: 7.5, y: H, z: 26, ry: 0.9 }); s.crew({ x: -40, y: -1.4, z: -62, ry: 2.4, people: false }); s.forest('tree:dead', 14, r => [r() * 160 - 80, 12 + r() * 90], { h: [3, 6], seedv: 5 }); s.forest('rock_grey', 18, r => [r() * 200 - 100, 8 + r() * 120], { h: [0.5, 1.6], seedv: 8 });
    const f = s.fall = new Fall(s, { char: 'ch_adventurer', x: 0, y: H, z: 40, frozen: true, pose: 'ready', spread: 52, steer: 7.5, canTuck: false, waterY: 0, aim: { r: 1.3 }, cam: { dist: 6, height: 3, up: 1.1, ahead: 3, fov: 60 }, bounds: p => { if (p.y < H - 0.3 && p.z > -1.2) p.z = -1.2; } });
    const pal = f.addBody('ch_adventurer', { x: 1.9, y: H, z: 41.2, pose: 'ready', frozen: true, vy: 0 });
    pal.ai = (b, dt) => { const v = -b.vy; b.vy -= G * (1 - (v > 0 ? v * v / 2700 : 0)) * dt; b.vz = damp(b.vz, clamp((CZ + 2.5 - b.pos.z) * 0.6, -4, 4), 0.8, dt); b.vx = damp(b.vx, clamp((CX - 3 - b.pos.x) * 0.6, -4, 4), 1.5, dt); };
    pal.onLand = b => { s.fx.splash(b.pos, 50, 1.6); s.audio.splash(); b.c.root.visible = false; };
    let phase = 'run', v = 0, hold = 0, straight = 0, pen = false, leapM = null, said = false; s.phase = () => phase;
    s.objective('Sprint for the edge — SPACE to jump at the lip');
    const leap = (clean, z) => {
      phase = 'air'; s.rate('Take-off', clean ? near(z, 1.2, 1.2, 9) : 0.25, 0.8); s.msg(clean ? 'JUMP!' : 'STUMBLED OFF THE EDGE', clean ? 'good' : 'bad'); s.audio.whoosh(); s.slowmo(0.45, 0.8);
      if (!clean) s.flub('Stumbled off the edge', { penalty: 0.15, advice: 'Press SPACE when the EDGE readout turns green (under 10 ft) — run off the rim without jumping and you tumble.' });
      f.launch(0, clean ? 4.2 : 0, -(v + (clean ? 2 : -3))); f.poseLock = true; f.c.setCycle('flail', 0.75); f.view('top', { dist: 5, height: 10.5, ahead: 4, up: -6, fov: 66 });
      pal.frozen = false; pal.vy = 3.6; pal.vz = -(v + 1); pal.c.setCycle('flail', 0.8); s.objective('Hit the deep channel — hold SPACE to go in feet first');
      leapM = s.moment('the leap', { t0: s.t - 1.6, dur: 8, w: 3 }); f.cine('front', 1.1, { pos: SIG_BUTCH, fov: 16 }); // a beat from across the canyon, then back to you
    };
    s.onUpdate((dt, t) => {
      if (!s.started || s.ended) return;
      if (!said && t - s.t0 > 0.6) { said = true; s.audio.say('I can\'t swim!', { rate: 1.15, pitch: 1.05 }); }
      if (phase === 'run') {
        v = damp(v, 5 + 3.6 * Math.max(0, inp.y), 2.2, dt); f.pos.z -= v * dt; f.pos.x = clamp(f.pos.x + inp.x * 2.5 * dt, -4, 4); f.c.setCycle('run', v * 2.1); pal.pos.z = f.pos.z + 1.2; pal.c.setCycle('run', v * 2.1);
        s.hud.readout('edge', 'Edge (ft)', Math.max(0, ftOf(f.pos.z)), f.pos.z < 3 ? 'ok' : '');
        if (inp.hit('a') && f.pos.z < 14) leap(true, f.pos.z); else if (f.pos.z < -0.2) leap(false, 0);
      } else if (phase === 'air') {
        f.windX = -3.2 + Math.sin(t * 1.3) * 1.2; const want = inp.a; hold = want ? hold + dt : 0; straight = damp(straight, want ? 1 : 0, want ? 3.2 : 6, dt);
        if (want !== pen) { pen = want; if (want) f.c.setPose(PENCIL, 0.22); else f.c.setCycle('flail', 0.75); } f.steerK = want ? 0.3 : 1; f.termK = want ? 1.08 : 1;
        s.hud.readout('alt', 'Height (ft)', ftOf(f.pos.y), f.pos.y < 45 ? 'warn' : ''); s.hud.readout('off', 'Off target (ft)', ftOf(Math.hypot(f.pos.x - CX, f.pos.z - CZ)), Math.hypot(f.pos.x - CX, f.pos.z - CZ) < R * 0.6 ? 'ok' : 'warn');
        s.hud.meter('str', 'FEET FIRST', straight, { color: straight > 0.8 ? '#4f8' : '#fc4' });
      }
    });
    f.onLand = i => {
      phase = 'done'; if (leapM) leapM.t1 = s.t + 1.6; const d = Math.hypot(i.x - CX, i.z - CZ), miss = d - R, onRock = rocks.some(r => Math.hypot(i.x - r[0], i.z - r[1]) < r[2] + 0.4);
      if (!i.water) { f.c.setPose('lie', 0.1); s.audio.impact(1.3); s.engine.addShake(1.6); return s.fail('Missed the river altogether and hit the rocks', { injury: 1, advice: 'Steer for the yellow ring from the moment you leave the rim — the red ring under you shows where you will land, and the wind drags it left (hold D).' }); }
      s.fx.splash(f.pos, 90, 2.6); s.audio.splash(); s.engine.addShake(0.8); f.c.root.visible = false;
      if (onRock) { s.audio.impact(1.2); return s.fail('Came down on a boulder in the shallows', { injury: 1, advice: 'Keep the red landing ring off the grey boulders — aim for the dark water inside the orange buoys.' }); }
      if (miss > 3) return s.fail(`Missed the deep channel by ${ftOf(miss)} ft — one foot of water over rock`, { injury: 0.9, advice: 'The canyon wind pushes you left all the way down — hold D early and keep OFF TARGET green before you straighten up (SPACE kills your steering).' });
      if (miss > 0) s.flub(`Clipped the edge of the deep channel (${ftOf(miss)} ft out)`, { penalty: 0.3, advice: 'Get the red ring inside the orange buoys before 200 ft — once you hold SPACE to straighten up you can barely steer.' });
      if (straight < 0.4) s.flub('Hit the water flat', { penalty: 0.25, advice: 'Hold SPACE from about 200 ft (HEIGHT readout) so the FEET FIRST meter is full and green before you hit the water.' });
      s.rate('On the mark', near(d, 0, 1.6, R + 3), 1.5); s.rate('Feet-first entry', smooth(0.15, 0.95, straight), 1.5); s.bonus('Fall: ' + ftOf(H) + ' ft', 260); s.msg(miss > 0 || straight < 0.4 ? 'SPLASH… OUCH' : 'SPLASH!', 'huge good');
      s.after(1.3, () => { f.c.root.visible = true; f.c.spinAng.set(0, 0, 0); f.pos.y = -1.25; f.c.setCycle('cheer', 1); s.fx.splash(f.pos, 20, 1); s.audio.cheer?.(); }); s.wrap(2.4, 'Who ARE those guys?');
    };
  },
  bot(s, inp) { const f = s.fall, ph = s.phase(); if (ph === 'run') { inp.y = 1; if (f.pos.z < 1.4) inp.press('a'); } else if (ph === 'air') { botSteer(f, inp, 9, -30, 0.5); if (f.pos.y < 62) inp.a = true; } },
};

// ---------------------------------------------------------------------------------------------
const BACK = { ...POSES.lie, hip: [0, 0, 0, 0], body: [-1.35, 0, 0] };
const lethal = {
  id: 'lethal_weapon', title: 'Do You Really Wanna Jump?', film: 'Lethal Weapon', year: 1987, tier: 2, pay: 3800, mode: 'fall', art: 'bd_la', music: 'tension',
  role: 'Doubling the detective — handcuffed to a jumper, nine storeys up',
  brief: 'Nine storeys, one airbag, and the Santa Ana is blowing down the boulevard. Line yourself up, step off, and get on your back before you hit the bag. Land on your feet and the bag folds you in half.',
  tips: ['On the ledge: <b>A / D</b> to shuffle over the bag, <b>SPACE</b> to step off.', 'Gusts shove you sideways — steer back over the <b>X</b> all the way down.', 'Hit <b>E</b> in the green window (about 60 ft up) to <b>roll onto your back</b>. Too early and you over-rotate.'],
  controls: `${K('A')}${K('D')} line up &nbsp; ${K('SPACE')} jump &nbsp; ${K('W')}${K('A')}${K('S')}${K('D')} steer &nbsp; ${K('E')} roll onto your back`, intro: { r: 9, h: 2.5, a0: 2.6 },
  assets: { models: ['ch_cop', 'airbag', 'police_car', 'sedan_grey', 'taxi', 'van_white', 'street_lamp', 'camera_crew', 'film_light', 'director_chair', 'ch_stunt', 'ch_goon'], tex: ['bd_la', 'tx_asphalt', 'tx_fac_office', 'tx_concrete', 'tx_roof', 'tx_fac_mall'] },
  build(s) {
    // downtown LA, 1987: hazy smog-white afternoon sun raking down the boulevard, warm grade
    s.env('day', { backdrop: 'bd_la', look: 'teal_orange', fog: 0.0021, fogMix: 0.6, hz: 0.5, sun: [46, 118], sunCol: 0xffe2b8, sunI: 3.5, amb: 0.95, lookOver: { sat: 1.05, contrast: 1.1, tint: [1.08, 1.0, 0.9] } });
    const H = 84, BX = 4, BZ = -15, inp = s.input; s.ground({ tex: 'tx_asphalt', tile: 10, color: 0x8a8a8a });
    s.building({ x: 0, z: 23, w: 48, d: 44, h: H, fac: 'tx_fac_office', top: true, facTile: 14, sol: { msg: 'Drifted back into the building' } });
    s.box({ x: 0, y: H, z: 1.5, w: 48, h: 0.9, d: 1, mat: { tex: 'tx_concrete', color: 0xb8b2a6 }, top: true, step: 2 });
    for (const [x, w, h, fac] of [[-52, 50, 46, 'tx_fac_mall'], [54, 52, 62, 'tx_fac_office'], [-110, 60, 70, 'tx_fac_office'], [116, 66, 38, 'tx_fac_mall']]) s.building({ x, z: 24, w, d: 44, h, fac });
    srand(11); for (let x = -190; x < 200;) { const w = sr(24, 46); s.building({ x: x + w / 2, z: -34 - 20, w, d: 40, h: sr(22, 96), fac: sr() < 0.7 ? 'tx_fac_office' : 'tx_fac_mall' }); x += w + sr(0, 5); }
    for (const z of [-2, -30]) s.box({ x: 0, y: 0, z, w: 420, h: 0.16, d: 4, mat: { tex: 'tx_concrete', color: 0xbbbbbb }, tile: 4, cast: false }); for (let x = -200; x < 200; x += 9) s.line({ x, z: -16, w: 3, d: 0.16, color: 0xd8d8c8, glow: 0.9 });
    s.forest('tree:palm', 16, (r, i) => [-170 + i * 23 + r() * 4, i % 2 ? -29.5 : -2.6], { h: [9, 13], seedv: 4 });
    const bag = s.put('airbag', { x: BX, z: BZ, len: 9, fit: 'max' }), bs = bag.userData.size, hw = bs.x / 2, hd = bs.z / 2, top = bs.y;
    s.course.addPiece({ x0: BX - hw * 0.92, x1: BX + hw * 0.92, z0: BZ - hd * 0.92, z1: BZ + hd * 0.92, fn: () => top * bag.scale.y, step: 1e9 });
    const red = s.mat({ color: 0xd01818, rough: 0.6 }); for (const ry of [0.785, -0.785]) s.box({ parent: bag, x: 0, y: top + 0.01, z: 0, w: 0.5, h: 0.05, d: Math.min(bs.x, bs.z) * 0.8, ry, mat: red, cast: false });
    s.put('police_car', { x: -12, z: -9, ry: 0.5 }); s.put('police_car', { x: 19, z: -21, ry: -2.2 }); s.put('taxi', { x: 34, z: -8, ry: Math.PI / 2 }); s.put('sedan_grey', { x: -30, z: -24, ry: -Math.PI / 2 }); s.put('van_white', { x: -24, z: -7, ry: Math.PI / 2 + 0.1 });
    s.crew({ x: BX + 12, z: BZ - 6, ry: 0.9 }); s.crew({ x: -5, z: -24, ry: 3.4, people: false }); s.crew({ x: 9, y: H, z: 9, ry: 0.5 });
    // the circus round the bag: LAFD engines either side, the street taped off, crowds pressed against the barriers on both sidewalks
    const redP = s.mat({ color: 0xb01212, rough: 0.45, metal: 0.3 }), chrome = s.mat({ color: 0xc8c8c8, metal: 0.8, rough: 0.3 }), tyre = s.mat({ color: 0x1a1a1a, rough: 0.9 }), glassD = s.mat({ color: 0x223040, rough: 0.2, metal: 0.5 }), lite = s.mat({ color: 0xff2020, emissive: 0xff2020, emI: 2 });
    const engine = (x, z, ry) => { const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; s.scene.add(g); s.box({ parent: g, x: 0, y: 0.55, z: -1, w: 2.5, h: 2.2, d: 7, mat: redP }); s.box({ parent: g, x: 0, y: 0.55, z: 3.6, w: 2.5, h: 2.5, d: 2.4, mat: redP }); s.box({ parent: g, x: 0, y: 1.9, z: 4.85, w: 2.3, h: 0.9, d: 0.06, mat: glassD });
      s.box({ parent: g, x: 0, y: 2.8, z: -1.2, w: 1.1, h: 0.35, d: 7.6, mat: chrome }); s.box({ parent: g, x: 0, y: 3.05, z: 3.6, w: 1.8, h: 0.18, d: 0.4, mat: lite }); for (const [wx, wz] of [[-1.2, 3.4], [1.2, 3.4], [-1.2, -2.6], [1.2, -2.6], [-1.2, -3.9], [1.2, -3.9]]) s.cyl({ parent: g, x: wx, y: 0.5, z: wz, r: 0.5, h: 0.4, rz: Math.PI / 2, mat: tyre }); };
    engine(-20, -17.5, Math.PI / 2 + 0.12); engine(31, -19, -Math.PI / 2 - 0.08);
    dress.fence(s, { path: [[-48, -27.6], [58, -27.6]], kind: 'barrier' }); dress.crowd(s, { path: [[-46, -28.4], [56, -28.4]], side: 1, rows: 3, step: 0.85, face: Math.PI, seed: 3 });
    for (const [a, b] of [[-52, -12], [20, 60]]) { dress.fence(s, { path: [[a, -4.4], [b, -4.4]], kind: 'barrier' }); dress.crowd(s, { path: [[a, -3.6], [b, -3.6]], side: -1, rows: 2, step: 0.9, face: 0, seed: 4 + a }); }
    const tape = s.mat({ color: 0xffd400, rough: 0.6 }); for (const [x0, z0, x1, z1] of [[-12, -6, -12, -26], [21, -6, 21, -26]]) s.box({ x: (x0 + x1) / 2, y: 0.95, z: (z0 + z1) / 2, w: 0.04, h: 0.08, d: Math.abs(z1 - z0), mat: tape, cast: false });
    // rooftop clutter behind the ledge: AC units, a water tank, a stair housing
    const roofM = s.mat({ tex: 'tx_concrete', color: 0x9a968e }), acM = s.mat({ color: 0x8a8c8e, metal: 0.4, rough: 0.5 });
    for (const [x, z, w, d, h] of [[-16, 14, 4, 3, 1.8], [-10, 30, 3, 3, 1.6], [17, 24, 5, 3, 2], [20, 36, 3, 2.5, 1.5]]) s.box({ x, y: H, z, w, h, d, mat: acM }); s.box({ x: -4, y: H, z: 34, w: 6, h: 4.2, d: 5, mat: roofM }); s.box({ x: 6, y: H + 3.5, z: 30, w: 4, h: 4, d: 4, mat: s.mat({ tex: 'tx_roof', color: 0x6a5a4a }) }); for (const [dx, dz] of [[-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6], [1.6, 1.6]]) s.box({ x: 6 + dx, y: H, z: 30 + dz, w: 0.2, h: 3.5, d: 0.2, mat: acM });
    srand(5); for (let i = 0; i < 7; i++) s.char(i % 2 ? 'ch_goon' : 'ch_stunt', { x: -9 + sr(-3, 3) + (i > 3 ? 26 : 0), z: -26 + sr(-2, 1.5), heading: Math.PI + sr(-0.5, 0.5) }).setCycle(i % 3 ? 'idle' : 'cheer', 1);
    const f = s.fall = new Fall(s, { char: 'ch_cop', x: -5, y: H + 0.9, z: 1.3, frozen: true, pose: 'ready', spread: 40, steer: 9, canTuck: false, aim: { r: 0.9, ref: 30, max: 3 }, cam: { dist: 5.5, height: 3.4, up: -1.6, ahead: 5, fov: 64 } });
    const wind = t => 4.2 * Math.sin(t * 0.8 + 1) + 2.8 * Math.sin(t * 2.1);
    let phase = 'ledge', rot = null, sq = 0, onBag = false, dropM = null, warned = false, cut = false; s.phase = () => phase; s.bag = { x: BX, z: BZ, top };
    s.objective('Line up over the bag (A/D), then SPACE to step off');
    const step = pulled => {
      phase = 'air'; f.launch(0, pulled ? 1.2 : 2.6, -5.2); f.poseLock = true; f.c.setPose('fall', 0.3); f.view('top', { dist: 4, height: 12, ahead: 3, up: -5 }); s.audio.whoosh(); s.objective('Stay over the X — E to roll onto your back');
      dropM = s.moment('the drop', { t0: s.t - 1.4, dur: 5.5, w: 3 }); s.slowmo(0.55, 0.6);
      if (pulled) { s.msg('HE PULLED YOU OFF!', 'bad'); s.audio.say('He\'s taking you with him!', { rate: 1.15 }); } else s.audio.say('You really wanna jump? Fine with me!', { rate: 1.15, pitch: 0.95 });
    };
    s.onUpdate((dt, t) => {
      if (sq > 0) { sq = Math.max(0, sq - dt); const k = 1 - sq / 1.4; bag.scale.y = 1 - 0.55 * Math.exp(-k * 4) * Math.cos(k * 9); if (onBag) f.pos.y = top * bag.scale.y - 0.15; }
      if (!s.started || s.ended) return; const w = wind(t - s.t0), alt = f.pos.y - top;
      s.hud.readout('wind', 'Wind (mph)', (w < -0.5 ? '◀ ' : '') + Math.round(Math.abs(w) * 2.24) + (w > 0.5 ? ' ▶' : ''), Math.abs(w) > 4.5 ? 'warn' : 'ok');
      if (phase === 'ledge') {
        f.pos.x = clamp(f.pos.x + inp.x * 3.2 * dt, -14, 14); if (Math.abs(inp.x) > 0.1) f.c.setCycle('walk', 7); else f.c.setPose('ready', 0.2);
        s.hud.readout('line', 'Off line (ft)', ftOf(Math.abs(f.pos.x - BX)), Math.abs(f.pos.x - BX) < 1.2 ? 'ok' : '');
        const lt = t - s.t0; if (lt > 14 && !warned) { warned = true; s.flub('Hesitated on the ledge', { penalty: 0.1, advice: 'Shuffle with A/D until OFF LINE reads 0 ft, then SPACE straight away — after 25 s the jumper drags you off wherever you stand.' }); }
        if (inp.hit('a')) step(false); else if (lt > 25) step(true);
      } else if (phase === 'air') {
        f.windX = w; s.hud.readout('alt', 'Height (ft)', ftOf(Math.max(0, alt)), alt < 34 && rot == null ? 'warn' : ''); s.hud.bar(clamp(1 - alt / H), [1 - 34 / H, 1 - 9 / H], [1 - 24 / H, 1 - 14 / H]);
        if (rot == null && inp.hit('x')) { rot = alt; f.c.setPose(BACK, 0.32); s.audio.whoosh(1.2); if (alt > 36) { f.c.tumble(-2.2, 0, 0); s.msg('TOO EARLY!', 'bad'); s.flub('Rolled over too early', { penalty: 0.1, advice: 'Wait for the green zone of the timing bar (about 60 ft up) before pressing E — go early and you over-rotate.' }); } else s.msg('ON YOUR BACK', 'small'); }
        if (!cut && alt < 9) { cut = true; f.cine('low', 3, { fov: 64 }); } // the impact, from the street
      }
    });
    f.onLand = i => {
      phase = 'done'; s.hud.hideBar(); if (dropM) dropM.t1 = s.t + 1.8; const dx = i.x - BX, dz = i.z - BZ, ex = Math.max(Math.abs(dx) - hw * 0.92, Math.abs(dz) - hd * 0.92); f.c.tumble(0, 0, 0); f.c.spinAng.set(0, 0, 0);
      if (ex > 1.4) { f.c.setPose('lie', 0.05); s.audio.impact(1.4); s.engine.addShake(1.8); s.fx.dust(f.pos, 14, { color: [0.6, 0.6, 0.6] }); return s.fail(`Missed the airbag by ${ftOf(ex)} ft`, { injury: 1, advice: 'Keep the red ring under you on the white X all the way down — steer back against every gust as soon as the WIND arrow flips.' }); }
      sq = 1.4; onBag = ex <= 0; s.audio.thud(); s.audio.whoosh(0.5); s.engine.addShake(0.7); s.fx.dust(f.pos, 16, { color: [0.85, 0.85, 0.8], size: 2.2, spread: 3 }); f.c.setPose('lie', 0.1); s.slowmo(0.4, 0.8);
      const att = rot == null ? 0 : rot > 36 ? 0.3 : near(rot, 19, 6, 22);
      if (!onBag) { s.audio.impact(0.9); s.engine.hurt(0.4); s.msg('CLIPPED THE EDGE', 'bad'); s.flub('Clipped the edge of the bag and rolled off', { penalty: 0.35, advice: 'Get the red ring onto the X before 100 ft — the last gusts near the bag push you a full metre sideways.' }); }
      if (rot == null) { s.msg('FEET FIRST!', 'bad'); s.flub('Hit the bag feet first', { penalty: 0.3, advice: 'Press E when the timing bar reaches the green (about 60 ft up) — feet first, the bag folds you in half.' }); }
      s.rate('Centre of the bag', onBag ? near(Math.hypot(dx / hw, dz / hd), 0, 0.22, 1.05) : 0, 1.5); s.rate('On your back', att, 1.5); s.bonus('Drop: ' + ftOf(H) + ' ft', 300);
      if (onBag && rot != null) { s.msg(att > 0.8 ? 'TEXTBOOK!' : 'ON THE BAG', 'good'); s.after(0.6, () => s.audio.cheer?.()); }
      s.wrap(2.4, 'I\'m getting too old for this.');
    };
  },
  bot(s, inp, B) { const f = s.fall, ph = s.phase(), b = s.bag; if (ph === 'ledge') { const dx = b.x - f.pos.x; inp.x = clamp(dx * 2, -1, 1); if (Math.abs(dx) < 0.2) inp.press('a'); } else if (ph === 'air') { botSteer(f, inp, b.x, b.z, 0.9); if (f.pos.y - b.top < 20.5) inp.press('x'); } },
};

// ---------------------------------------------------------------------------------------------
const SWAN_DOWN = { ...POSES.swan, body: [2.85, 0, 0], hd: [-0.5, 0, 0] };
const dam = {
  id: 'goldeneye_dam', title: 'The Long Drop', film: 'GoldenEye', year: 1995, tier: 3, pay: 8000, mode: 'fall', art: 'bd_dam', music: 'spy',
  role: 'Doubling 007 — 220 metres of concrete and one bungee cord',
  brief: 'World record bungee, straight down the face of the dam. Perfect swan dive, as close to the concrete as you dare, and you fire the piton gun at the very last moment. Fire late and there is no second take.',
  tips: ['The face <b>leans out</b> toward the bottom and the updraught pushes you in — keep easing away with <b>A</b>.', 'Closer to the concrete looks better and <b>pays more</b>. Touch it and you are paint.', 'Fire the piton (<b>E</b>) when <b>STOP HEIGHT</b> turns green — the cord needs about 45 m to stop you.'],
  controls: `${K('SPACE')} dive &nbsp; ${K('A')} away from the wall &nbsp; ${K('D')} toward the wall &nbsp; ${K('E')} fire piton gun`, intro: { r: 12, h: 4, a0: 3.9 },
  assets: { models: ['ch_agent', 'camera_crew', 'film_light', 'director_chair', 'ch_stunt', 'ww2_truck', 'rock_grey'], tex: ['bd_dam', 'tx_concrete', 'tx_rock', 'tx_roof', 'tx_metal'] },
  build(s) {
    // Verzasca, high summer: sun low across the valley so it rakes the concrete and picks out every seam, cool Alpine haze down the gorge
    s.env('day', { backdrop: 'bd_dam', look: 'cold', fog: 0.0015, hz: 0.5, sun: [36, 115], sunI: 3.3, amb: 0.95, lookOver: { contrast: 1.12, sat: 0.95 } });
    const H = 220, SL = 0.07, A = 24, inp = s.input, zf = y => -(H - clamp(y, 0, H)) * SL, X0 = -170, X1 = 440, XC = (X0 + X1) / 2, W = X1 - X0;
    s.ground({ tex: 'tx_rock', tile: 30, color: 0x7f8580 });
    const conc = s.mat({ tex: 'tx_concrete', color: 0xc6c0b4 }), dark = s.mat({ color: 0x6e6a62, rough: 1 }), rock = s.mat({ tex: 'tx_rock', color: 0x8d8f88 });
    s.box({ x: XC, y: 0, z: 13, w: W, h: H, d: 26, mat: conc, tile: 34, top: true });
    s.slope({ x: XC, w: W, z0: -H * SL, z1: 0, y0: 0, y1: H, mat: { tex: 'tx_concrete', rep: 0.03, color: 0xc6c0b4 } });
    for (let y = 20; y < H; y += 20) s.box({ x: XC, y, z: zf(y) - 0.2, w: W, h: 0.45, d: 0.6, mat: dark, cast: false }); for (let x = X0 + 30; x < X1; x += 60) s.box({ x, y: 0, z: -H * SL - 1, w: 5, h: 26, d: 6, mat: conc, tile: 20 });
    for (const sd of [-1, 1]) s.box({ x: XC, y: H, z: sd < 0 ? 0.6 : 25.4, w: W, h: 1.1, d: 0.5, mat: conc, tile: 20, top: sd < 0, step: 2 });
    s.box({ x: X0 - 200, y: 0, z: 0, w: 400, h: H + 70, d: 900, mat: rock, tile: 40 }); s.box({ x: X1 + 200, y: 0, z: 0, w: 400, h: H + 90, d: 900, mat: rock, tile: 40 }); s.box({ x: XC, y: 0, z: 26 + 200, w: W, h: H - 8, d: 400, mat: rock, tile: 40 });
    s.water({ y: H - 7, color: 0x1f5560, w: W, d: 400, z: 226, x: XC, size: 800 }); s.water({ y: 0.3, color: 0x2a5d5a, w: 34, d: 600, z: -330, x: 160, size: 600 });
    s.box({ x: XC, y: 0, z: -40, w: W, h: 0.5, d: 50, mat: conc, tile: 20, cast: false }); for (const [x, z, w, d, h] of [[60, -44, 40, 18, 9], [112, -52, 26, 30, 14], [-60, -40, 30, 16, 7], [200, -46, 60, 20, 11]]) s.building({ x, z, w, d, h, fac: 'tx_concrete', roofMat: { tex: 'tx_roof', color: 0x777777 }, solid: false, facTile: 10 });
    s.forest('tree:pine', 160, r => { const x = X0 + r() * W, z = -70 - r() * 380; return Math.abs(x - 160) < 22 ? null : [x, z]; }, { h: [8, 16], seedv: 3 });
    // the face: pour joints and rust/water stains running down from the crest (flat on the concrete, nothing proud of it)
    const seamM = s.mat({ color: 0x5a5852, rough: 1 }), stainM = s.mat({ color: 0x3e3a32, opacity: 0.16 }), tilt = Math.atan(SL), FL = Math.hypot(H, H * SL);
    for (let x = X0 + 15; x < X1; x += 15) if (Math.abs(x) > 4) s.box({ x, y: H / 2 - FL / 2, z: zf(H / 2) - 0.1, w: 0.22, h: FL, d: 0.2, rx: tilt, mat: seamM, cast: false });
    srand(41); for (let i = 0; i < 44; i++) { const x = sr(X0 + 10, X1 - 10), h = sr(25, 150), yc = H - 3 - h / 2; if (Math.abs(x) < 3) continue; s.box({ x, y: yc - h / 2, z: zf(yc) - 0.13 - i * 0.002, w: sr(2, 9), h, d: 0.04, rx: tilt, mat: stainM, cast: false }); }
    // the gorge below: rock buttresses on both valley walls, pines on their tops and along the river, boulders in the riverbed, mountains closing the valley
    const rock2 = s.mat({ tex: 'tx_rock', color: 0x767a72 }); srand(43);
    for (let i = 0; i < 26; i++) { const L = i % 2 === 0, d = sr(4, 14), w = sr(25, 70), h = sr(60, 240), z = sr(-440, -30); s.box({ x: L ? X0 + d / 2 - 1 : X1 - d / 2 + 1, y: 0, z, w: d, h, d: w, mat: i % 3 ? rock : rock2, tile: 40 }); }
    const tops = []; for (let i = 0; i < 300; i++) { const L = i % 2 === 0; tops.push([L ? X0 - sr(2, 190) : X1 + sr(2, 190), sr(-440, 300), L ? H + 70 : H + 90]); } treesAt(s, 'pine', tops, { h: [12, 22], seedv: 44 });
    s.forest('tree:pine', 280, r => { const L = r() < 0.5, x = L ? X0 + 4 + r() * 70 : X1 - 4 - r() * 70, z = -20 - r() * 430; return [x, z]; }, { h: [10, 20], seedv: 45 });
    s.trees('bush', 120, r => { const x = 160 + (r() < 0.5 ? -1 : 1) * (18 + r() * 12); return [x, -60 - r() * 520]; }, { h: [1.2, 3], seedv: 46, wide: 1.4 });
    srand(47); const bould = []; for (let i = 0; i < 70; i++) bould.push([160 + sr(-20, 20), sr(-70, -620), sr(-1, 0)]); rocksAt(s, bould, { h: [1.5, 5], seedv: 48 });
    dress.hills(s, { x: 135, z: -60, r: 820, a0: Math.PI * 0.62, a1: Math.PI * 1.38, h: 260, depth: 300, color: 0x4f5e48, trees: 'pine', nTrees: 260, seed: 5 });
    s.put('ww2_truck', { x: -14, y: H, z: 14, ry: Math.PI / 2 }); s.crew({ x: 7, y: H, z: 9, ry: 0.7 }); s.crew({ x: 14, y: 0.5, z: -30, ry: 3.3, people: false });
    const f = s.fall = new Fall(s, { char: 'ch_agent', x: 0, y: H + 1.1, z: 0.6, heading: 0, yaw: -Math.PI / 2, frozen: true, pose: 'ready', spread: 60, steer: 8, canTuck: false, cam: { dist: 11.5, height: 2.5, side: -5, up: -2.5, ahead: 0, fov: 62 } });
    f.poseLock = true; const anchor = V3(0, H + 1.1, 1.0), cord = rope(s, 0x202020, 0.045), pit = rope(s, 0xdddddd, 0.02); pit.m.visible = false; const hip = V3(), gp = V3();
    let phase = 'ledge', wdSum = 0, wdN = 0, vy = 0, yStop = 0, ht = 0, clr = 0, Ab = A, dropM = null, warned = false; s.phase = () => phase; s.wallDist = () => zf(f.pos.y) - f.pos.z;
    s.objective('SPACE — swan dive off the parapet');
    const splat = (why, advice) => { phase = 'dead'; f.die(); f.frozen = true; s.audio.impact(1.4); s.engine.addShake(1.8); s.fx.dust(f.pos, 12, { color: [0.7, 0.7, 0.68] }); s.fail(why, { injury: 1, advice }); };
    const WALL_ADV = 'Keep WALL between 2 and 7 m — tap A the moment it turns orange; the updraught shoves you toward the concrete every couple of seconds.';
    const dive = pushed => {
      phase = 'fall'; f.launch(0, 3.4, -4.8); f.c.setPose(SWAN_DOWN, 1.25); s.audio.whoosh(); s.slowmo(0.5, 0.7); s.objective('Hug the wall — fire the piton (E) when STOP HEIGHT goes green');
      dropM = s.moment('the long drop', { t0: s.t - 1.2, dur: 9, w: 3 }); if (pushed) s.msg('GO GO GO!', 'bad');
    };
    // brake path for the live cut: decelerating at Ab from (y, vy) to the stop, then the rebound
    const brakePts = () => { const pts = []; let y = f.pos.y, v = vy; for (let t = 0; t <= 4; t += 0.1) { pts.push({ t: s.t + t, p: V3(f.pos.x, y, f.pos.z) }); if (v < 0) { v = Math.min(0, v + Ab * 0.1); y += v * 0.1; } } return pts; };
    s.onUpdate((dt, t) => {
      hip.set(f.pos.x, f.pos.y + 0.95, f.pos.z); cord.set(anchor, hip); if (!s.started || s.ended) return; const y = f.pos.y, v = phase === 'fall' ? f.speed : -vy, wd = zf(y) - f.pos.z, stop = y - Math.max(0, v) * Math.max(0, v) / (2 * A);
      s.hud.readout('alt', 'Altitude (m)', Math.max(0, y).toFixed(0), y < 70 && phase === 'fall' ? 'warn' : '');
      if (phase === 'ledge') {
        const lt = t - s.t0; if (lt > 12 && !warned) { warned = true; s.flub('Hesitated on the parapet', { penalty: 0.1, advice: 'Press SPACE as soon as ACTION is called — the light on the dam face is going.' }); }
        if (inp.hit('a')) dive(false); else if (lt > 20) dive(true);
      }
      else if (phase === 'fall') {
        f.windZ = 1.6 + 4.5 * Math.pow(Math.max(0, Math.sin((t - s.t0) * 1.5 + 0.6)), 2); wdSum += clamp(wd, 0, 30) * dt; wdN += dt;
        s.hud.readout('wall', 'Wall (m)', Math.max(0, wd).toFixed(1), wd < 2 ? 'warn' : wd < 7 ? 'ok' : ''); if (y < 170) s.hud.readout('stop', 'Stop height (m)', stop.toFixed(0), stop < 0 ? 'warn' : stop < 14 ? 'ok' : ''); s.hud.bar(clamp(1 - y / H), [1 - 62 / H, 1 - 46 / H], [1 - 54 / H, 1 - 47 / H]);
        if (wd < 0.45 && y < H - 2) return splat('Brushed the dam face at ' + Math.round(v * 3.6) + ' km/h', WALL_ADV);
        const fire = inp.hit('x'); if (fire && y >= 190) s.msg('TOO HIGH — WAIT FOR GREEN', 'small bad');
        if (fire && y < 190) {
          phase = 'brake'; f.frozen = true; vy = f.vel.y; clr = stop; pit.m.visible = true; gp.set(f.pos.x, 0, f.pos.z - 1.5); s.audio.gun?.(); s.fx.sparks(gp, 24); s.engine.addShake(0.5); s.hud.hideBar(); s.msg('PITON AWAY', 'small'); f.c.setPose({ ...SWAN_DOWN, aR: [0.12, 1, 0.1, 0.04, 1, 0.1] }, 0.2); s.audio.set('wind', 'wind', 0.4, 0.15);
          // leeway: a slightly late shot over-stretches the cord and stops you just off the ground (a hard flub, not a death)
          Ab = A; if (clr < 1.5 && clr > -16) { Ab = vy * vy / (2 * Math.max(0.5, y - 1.5)); s.flub('Late piton — the cord bottomed out', { penalty: 0.3, advice: 'Fire the piton (E) the instant STOP HEIGHT turns green (under 14 m) — at 200 km/h you need about 45 m of cord to stop.' }); }
          s.cut(brakePts(), 'low', { fov: 70, at: 0.9 }); // ground camera looking up the dam face
        }
      } else if (phase === 'brake') {
        vy += Ab * dt; f.pos.y += vy * dt; s.engine.addShake(0.05); pit.set(hip, gp);
        if (f.pos.y <= 0.2) { f.pos.y = 0.2; return splat('Fired the piton too late — the cord ran out of room', 'Fire the piton (E) the instant STOP HEIGHT turns green (under 14 m) — at 200 km/h you need about 45 m of cord to stop.'); }
        if (vy >= 0) {
          phase = 'hang'; yStop = f.pos.y; vy = 0; s.audio.thud(); s.slowmo(0.4, 1.1); if (dropM) dropM.t1 = s.t + 2.4;
          s.rate('Piton shot (' + yStop.toFixed(0) + ' m to spare)', near(yStop, 6, 10, 110), 2); s.rate('Close to the concrete', near(wdSum / Math.max(0.1, wdN), 4.5, 2.5, 18), 1.2); s.bonus('Record drop: ' + Math.round(H - yStop) + ' m', Math.round((H - yStop) * 3));
          if (yStop > 80) s.flub('Fired the piton far too early', { penalty: 0.1, advice: 'Hold your nerve: wait until STOP HEIGHT drops into the green (0–14 m) before pressing E — every metre lower pays more.' });
          s.msg(yStop < 14 ? 'INCH PERFECT' : yStop < 40 ? 'GOT IT' : 'FIRED EARLY', yStop < 40 ? 'good' : ''); s.after(0.7, () => s.audio.cheer?.()); s.wrap(2.6);
        }
      }
      if (phase === 'hang') { ht += dt; f.pos.y = yStop + 2.2 * (1 - Math.exp(-ht * 1.6) * Math.cos(ht * 4.2)); pit.set(hip, gp); }
    });
    s.onUpdate(dt => { if (phase === 'hang' && s.ended) { ht += dt; f.pos.y = yStop + 2.2 * (1 - Math.exp(-ht * 1.6) * Math.cos(ht * 4.2)); hip.set(f.pos.x, f.pos.y + 0.95, f.pos.z); pit.set(hip, gp); } });
    f.onLand = () => { if (phase !== 'fall') return; if (f.pos.y > 3) splat('Flew into the dam face', WALL_ADV); else splat('Never fired the piton — 220 metres, no brakes', 'Press E to fire the piton gun when STOP HEIGHT turns green — around 50 m above the ground.'); };
  },
  bot(s, inp) { const f = s.fall, ph = s.phase(); if (ph === 'ledge') { if (s.t - s.t0 > 0.8) inp.press('a'); } else if (ph === 'fall') { const wd = s.wallDist(); inp.x = clamp((wd - 4.6) * 0.7 + (f.windZ || 0) / 8, -1, 1); const v = f.speed; if (f.pos.y - v * v / 48 < 7.5) inp.press('x'); } },
};

// ---------------------------------------------------------------------------------------------
// patchwork farmland seen from altitude
function farmland(s, seedv = 4, cols = [0x8a9a4a, 0xb9a85a, 0x6f8f4a, 0xc2b070, 0x5f7f3f, 0xa3b060]) {
  srand(seedv); const cs = Math.cos(0.3), sn = Math.sin(0.3); for (let i = -4; i <= 4; i++) for (let j = -4; j <= 4; j++) { if (sr() < 0.25) continue; const w = sr(220, 540), d = sr(220, 540), u = i * 600 + sr(-25, 25), v = j * 600 + sr(-25, 25); s.box({ x: u * cs + v * sn, y: -0.2, z: -u * sn + v * cs, w, d, h: 0.5, mat: s.mat({ color: cols[Math.floor(sr(cols.length))], rough: 1 }), ry: 0.3, cast: false }); }
  for (const [x, z, ry, L] of [[200, 0, 0.3, 5200], [-700, 300, 1.75, 5200], [900, -900, 1.1, 4000]]) s.box({ x, y: 3, z, w: 16, h: 0.1, d: L, ry, mat: s.mat({ color: 0x8a8a86, rough: 1 }), cast: false });
}
// always-visible ring that marks another faller from far away
function beacon(s, color) { const m = new THREE.Mesh(new THREE.RingGeometry(0.82, 1, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(1.7), transparent: true, opacity: 0.9, depthTest: false, depthWrite: false, side: THREE.DoubleSide })); m.rotation.x = -Math.PI / 2; m.renderOrder = 9; s.scene.add(m); return m; }
const pointBreak = {
  id: 'point_break', title: 'No Chute', film: 'Point Break', year: 1991, tier: 4, pay: 12500, mode: 'fall', art: 'bd_clouds', music: 'synth',
  role: 'Doubling the rookie agent — out of the door with no parachute',
  brief: 'He jumped with the only rig left, so you go out after him with nothing. Dive, catch him, and hang on while he tries to shake you off. One canopy, two passengers — and it has to be open by two thousand feet.',
  tips: ['Hold <b>SPACE</b> to dive after the orange smoke. <b>Flare out before you reach him</b> — hit him at speed and you bounce off.', 'Get within arm’s reach, then <b>hold E</b> and stay glued to him while he bucks — let the GRIP meter fill.', 'The higher you hook up, the better. Below <b>600 m</b> the canopy cannot save two.'],
  controls: `${K('W')}${K('A')}${K('S')}${K('D')} steer &nbsp; hold ${K('SPACE')} dive &nbsp; hold ${K('E')} grab and hang on`, intro: { r: 9, h: 2.5, up: 0.5 },
  assets: { models: ['ch_skydiver', 'a400m', 'parachute'], tex: ['bd_clouds', 'tx_grass', 'tx_sand'] },
  build(s) {
    // southern California from two miles up: late golden sun, dry patchwork fields, aerial haze that swallows the horizon
    s.env('high', { backdrop: 'bd_clouds', look: 'teal_orange', fog: 0.00024, hz: 0.5, sun: [30, 215], sunCol: 0xffe0b0, sunI: 3.6, lookOver: { sat: 1.05, contrast: 1.08 } });
    s.ground({ tex: 'tx_grass', tile: 240, size: 14000, color: 0xa8a070, vary: { tint: 0xb8a878 } }); farmland(s, 4, [0xa89a68, 0xc4ae7a, 0x7d8450, 0xb8a070, 0x6f7a48, 0xd0bc8a, 0x8a7a58]);
    srand(51); for (let i = 0; i < 22; i++) s.box({ x: sr(-2600, 2600), y: -0.1, z: sr(-2600, 2600), w: sr(80, 260), d: sr(80, 260), h: 0.7, ry: 0.3, mat: s.mat({ color: 0x4a5634, rough: 1 }), cast: false }); // orchards and creek woods
    dress.hills(s, { r: 2900, depth: 1300, h: 520, color: 0x8a7e66, tex: 'tx_sand', seed: 9 }); s.water({ y: 0.3, color: 0x2a5f78, w: 150, d: 9000, x: -1200, size: 9000 });
    const DECK = 600, T = 2.2, inp = s.input;
    const f = s.fall = new Fall(s, { char: 'ch_skydiver', x: 0, y: 2600, z: 0, vy0: 25, view: 'top', clouds: true, cloudBase: 900, spread: 52, tuck: 88, steer: 15, cam: { height: 11, dist: 4.5, up: -5, ahead: 3 } });
    const plane = s.put('a400m', { x: -9, y: 2606, z: -16 });
    const tg = s.target = f.addBody('ch_skydiver', { x: 55, y: 2600 - 250, z: -75, vy: -47 }), ring = beacon(s, 0xff7a20), sm = V3(), sv = V3(0, 6, 0), dock = V3();
    let phase = 'chase', hold = 0, bounces = 0, slips = 0, cd = 0, grabRv = null, lockAlt = 0, can = null, wob = 0, near1 = false, tGrip = 0; s.phase = () => phase;
    tg.ai = (b, dt, F) => {
      if (phase === 'open' || phase === 'reserve') return; const dy = f.pos.y - b.pos.y, close = Math.hypot(f.pos.x - b.pos.x, f.pos.z - b.pos.z) < 40 && Math.abs(dy) < 60;
      b.vy = damp(b.vy, -(close ? clamp(f.speed - dy * 0.9, 40, 66) : dy < -20 ? 66 : 47), phase === 'grip' ? 6 : 1.6, dt); wob += dt;
      const k = phase === 'grip' ? 1 : 0.35; b.vx = damp(b.vx, k * (5.2 * Math.sin(wob * 2.1) + 3.2 * Math.sin(wob * 4.7 + 1)) + (b.kx || 0), 5, dt); b.vz = damp(b.vz, k * (4.6 * Math.cos(wob * 1.7 + 0.5) + 2.6 * Math.sin(wob * 3.9)) + (b.kz || 0), 5, dt); b.kx = damp(b.kx || 0, 0, 2, dt); b.kz = damp(b.kz || 0, 0, 2, dt);
      b.c.heading += dt * (phase === 'grip' ? 1.6 * Math.sin(wob * 3) : 0.25); b.c.cur.body[1] = phase === 'grip' ? 0.35 * Math.sin(wob * 5) : 0;
    };
    s.objective('Dive after him — hold SPACE');
    s.onUpdate((dt, t) => {
      if (s.started) { plane.position.z -= 72 * dt; plane.position.y += 4 * dt; } if (can) can.scale.setScalar(damp(can.scale.x, 1, 4, dt));
      if (phase === 'reserve') { tg.vy = damp(tg.vy, -7, 1.7, dt); tg.vx = damp(tg.vx, 3, 2, dt); tg.vz = damp(tg.vz, 0, 2, dt); ring.visible = false; return; }
      if (phase === 'open') { tg.vy = damp(tg.vy, -7, 1.7, dt); tg.vx = damp(tg.vx, 0, 2, dt); tg.vz = damp(tg.vz, 0, 2, dt); f.pos.set(tg.pos.x + 0.42, tg.pos.y - 0.75, tg.pos.z - 0.28); ring.visible = false; return; }
      if (!s.started || s.ended) return; cd -= dt;
      const dy = f.pos.y - tg.pos.y, side = f.pos.x >= tg.pos.x ? 1 : -1; dock.set(tg.pos.x + side * 0.95, tg.pos.y, tg.pos.z);
      const dh = Math.hypot(f.pos.x - dock.x, f.pos.z - dock.z), d3 = Math.hypot(dh, dy), rv = f.speed + tg.vy, alt = f.pos.y;
      ring.position.set(tg.pos.x, tg.pos.y + 1, tg.pos.z); ring.scale.setScalar(clamp(d3 / 16, 1.6, 30)); ring.visible = d3 > 12; s.fx.streak(sm.set(tg.pos.x, tg.pos.y + 1, tg.pos.z), sv, [1, 0.45, 0.1], 1.8, 1.3, 0.55);
      s.hud.readout('alt', 'Altitude (m)', Math.round(alt), alt < DECK + 500 ? 'warn' : ''); s.hud.readout('sep', dy >= 0 ? 'Below you (m)' : 'Above you (m)', Math.abs(dy).toFixed(0), Math.abs(dy) < 3 ? 'ok' : ''); s.hud.readout('rv', 'Closing (m/s)', rv.toFixed(0), Math.abs(rv) < 9 ? 'ok' : d3 < 90 ? 'warn' : '');
      if (alt < DECK) { // leeway: the hidden reserve under your jumpsuit — the take is blown, but you are both alive
        phase = 'reserve'; s.msg('HARD DECK — PULL THE RESERVE', 'bad'); s.hud.prompt(''); s.hud.meter('grip', 'GRIP', 0); f.termK = 1; f.o.canTuck = false; f.deploy('parachute'); f.view('chase', { dist: 9, height: 2, up: 3, fov: 60 });
        can = model('parachute', { height: 7 }); can.position.y = 1.5; can.scale.setScalar(0.05); tg.c.root.add(can); tg.c.setPose('hang', 0.3); tg.c.cur.body[1] = 0;
        s.flub('Missed the hook-up — pulled the hidden reserve', { penalty: 0.35, advice: 'Dive (hold SPACE) until he is about 30 m below you, then let go so CLOSING drops under 9 m/s, and hold E beside him — aim to be hooked up by 1,500 m.' });
        s.rate('Hook-up height (missed)', 0, 1.4); s.rate('Docking speed', grabRv == null ? 0 : near(grabRv, 0, 5.5, 9.5), 1); s.rate('Clean catch', 0, 1.2); s.wrap(3.4, 'He got away. This time.'); return;
      }
      if (d3 < 30 !== near1) { near1 = d3 < 30; if (near1) f.view('chase', { dist: 5.5, height: 4.2, up: -0.8, ahead: 0.5, fov: 64 }); else f.view('top', { height: 11, dist: 4.5, up: -5, ahead: 3 }); }
      if (phase === 'chase') {
        s.hud.prompt(d3 < 3.2 && Math.abs(rv) < 9 ? `Hold ${K('E')} — grab him!` : ''); s.hud.meter('grip', 'GRIP', 0);
        if (d3 < 1.7 && Math.abs(rv) > 9 && cd < 0) { bounces++; cd = 1.6; const a = Math.atan2(f.pos.z - tg.pos.z, f.pos.x - tg.pos.x) + (dh < 0.2 ? rnd(6) : 0); f.carry.set(Math.cos(a) * 17, 0, Math.sin(a) * 17); tg.kx = -Math.cos(a) * 8; tg.kz = -Math.sin(a) * 8; f.c.tumble(5, 0, 3); s.after(0.9, () => { f.c.tumble(0, 0, 0); f.c.spinAng.set(0, 0, 0); }); s.audio.punch?.(); s.audio.impact(0.7); s.engine.addShake(1); s.engine.hurt(0.3); s.msg('TOO FAST — BOUNCED OFF', 'bad'); s.objective('Flare out (release SPACE) before you reach him'); }
        else if (inp.xk && d3 < 3.2 && Math.abs(rv) < 9 && cd < 0) { phase = 'grip'; hold = 0; if (grabRv == null) { grabRv = Math.abs(rv); s.audio.say('Pull the cord, Bodhi!', { rate: 1.2, pitch: 0.95 }); } tGrip = t; f.o.canTuck = false; s.audio.thud(); s.msg('GOT HIM — HANG ON!', 'small'); s.objective('Hold E and stay with him'); }
      } else if (phase === 'grip') {
        f.termK = clamp(-tg.vy / f.o.spread, 0.8, 1.3); f.pos.y = damp(f.pos.y, tg.pos.y, 5, dt); hold += dt; s.hud.meter('grip', 'GRIP', hold / T, { color: '#4f8' }); s.hud.prompt(`Hold ${K('E')}`); s.engine.addShake(0.03);
        if (!inp.xk || dh > 2.3) { phase = 'chase'; slips++; cd = 0.5; f.termK = 1; f.o.canTuck = true; s.msg(inp.xk ? 'SHAKEN OFF!' : 'LET GO!', 'bad'); s.audio.whoosh(); s.objective('Get back on him — hold E'); }
        else if (hold >= T) {
          phase = 'open'; lockAlt = alt; f.frozen = true; const P = tg.pos; s.moment('one canopy, two passengers', { t0: Math.max(tGrip, t - 3) - 0.8, dur: 6.5, w: 3, shots: [{ type: 'orbit', a: -0.05, b: 0.52, speed: 0.75 }, { type: 'top', pos: [P.x + 8, P.y + 9, P.z + 12], fov: 34, lookUp: 0.4, a: 0.5, b: 1.0, speed: 0.6 }, { type: 'wide', dist: 1.2, a: 0.62, b: 1.05, speed: 0.8 }] }); /* signature: from the camera flyer above, the canopy blooms over the fields */ s.slowmo(0.45, 1.3);
          { const pts = []; let y = tg.pos.y, v = -tg.vy; for (let k = 0; k <= 40; k++) { pts.push({ t: t + k * 0.1, p: V3(tg.pos.x + 0.42, y - 0.75, tg.pos.z - 0.28) }); v = 7 + (v - 7) * Math.exp(-1.7 * 0.1); y -= v * 0.1; } s.cut(pts, 'orbit', { fov: 46 }); } f.poseLock = true; f.c.setPose('cling', 0.3); f.c.heading = 0; tg.c.setPose('hang', 0.3); tg.c.cur.body[1] = 0; tg.c.heading = 0; s.hud.prompt(''); f.view('chase', { dist: 9, height: 2, up: 3, fov: 60 });
          can = model('parachute', { height: 7 }); can.position.y = 1.5; can.scale.setScalar(0.05); tg.c.root.add(can); s.audio.whoosh(1.4); s.audio.thud(); s.engine.addShake(0.8); s.audio.set('wind', 'wind', 0.3, 0.1); s.engine.fx.uBlur.value = 0; s.cam.fovKick = 0;
          s.rate('Hook-up height (' + Math.round(alt) + ' m)', near(alt, 2600, 1100, 2000), 1.4); s.rate('Docking speed', near(grabRv, 0, 5.5, 9.5), 1); s.rate('Clean catch', 1 - bounces * 0.3 - slips * 0.22, 1.2); s.bonus('Seconds without a parachute', Math.round((t - s.t0) * 60)); s.msg('CANOPY!', 'huge good'); s.wrap(2.8, 'Vaya con Dios.');
        }
      }
    });
    f.onLand = i => { if (phase === 'reserve') return; f.c.setPose('lie', 0.05); s.audio.impact(1.5); s.engine.addShake(2); s.fail('Hit the ground at ' + Math.round(i.speed * 3.6) + ' km/h without a parachute', { injury: 1, advice: 'Hook up with him (hold E beside him) well above 600 m — that is where his canopy has to open.' }); };
  },
  bot(s, inp) {
    const f = s.fall, tg = s.target, ph = s.phase(), dy = f.pos.y - tg.pos.y, side = f.pos.x >= tg.pos.x ? 1 : -1, tx = tg.pos.x + side * 0.95, st = f.o.steer;
    inp.x = clamp((tx - f.pos.x) * 1.4 + tg.vx / st, -1, 1); inp.y = clamp((f.pos.z - tg.pos.z) * 1.4 - tg.vz / st, -1, 1);
    if (ph === 'chase') { inp.a = dy > 34; inp.xk = Math.abs(dy) < 3; } else if (ph === 'grip') inp.xk = true;
  },
};

// ---------------------------------------------------------------------------------------------
const halo = {
  id: 'mi_halo', title: 'Through the Storm', film: 'Mission: Impossible – Fallout', year: 2018, tier: 6, pay: 48000, mode: 'fall', art: 'bd_storm', music: 'epic',
  role: 'Doubling the agent — HALO jump into a thunderstorm at dusk',
  brief: 'Out the ramp at dusk, straight into the storm. Your partner gets hit and goes limp. You dodge the lightning, catch him, clip on, and you do not pull until the last possible second. Then put both of you on the glass roof.',
  tips: ['A <b>blue column</b> means lightning in one second. Get out of it — you move faster when you are <b>not</b> diving.', 'Dive (<b>SPACE</b>) to the red strobe, then <b>hold E</b> beside him to clip on.', 'Pull (<b>E</b>) between <b>1500 and 1100 ft</b> — lower pays more, below 1000 ft costs you, below 400 ft is fatal. Steer the canopy to the lit ring.'],
  controls: `${K('W')}${K('A')}${K('S')}${K('D')} steer &nbsp; hold ${K('SPACE')} dive &nbsp; hold ${K('E')} clip on &nbsp; ${K('E')} pull`, intro: { r: 9, h: 2.5, up: 0.5 },
  assets: { models: ['ch_agent', 'ch_skydiver', 'a400m', 'parachute'], tex: ['bd_storm', 'tx_asphalt', 'tx_fac_paris', 'tx_roof', 'tx_concrete', 'tx_cobble'] },
  build(s) {
    // dusk over Paris: the last orange light on the horizon behind the storm, blue-black cloud above, the city lit up below
    s.env('storm', { backdrop: 'bd_storm', look: 'cold', fog: 0.00045, amb: 1.6, sunI: 3.2, hz: 0.5, sun: [7, 250], sunCol: 0xffa060, shadows: false, lookOver: { bloom: 0.65, lift: [0.02, 0.035, 0.07], vignette: 0.38, contrast: 1.12 } });
    const M = 3.281, LX = 130, LZ = -240, RY = 34, HARD = 305, FATAL = 122, MISS = 560, inp = s.input;
    s.ground({ tex: 'tx_asphalt', tile: 60, size: 9000, color: 0x5d6878 }); s.water({ y: 0.4, color: 0x18303c, w: 9000, d: 110, z: LZ + 190, size: 9000 });
    // Paris: lit blocks around a big glass-roofed hall
    const glass = s.mat({ color: 0x9fd8d0, emissive: 0x4fa89a, emI: 0.9, rough: 0.3, metal: 0.4 });
    s.building({ x: LX, z: LZ, w: 96, d: 56, h: RY - 4, fac: 'tx_fac_paris', lit: 0.8, facTile: 16 }); s.box({ x: LX, y: RY - 4, z: LZ, w: 84, h: 4, d: 46, mat: glass, top: true, step: 1e9 }); s.mark({ x: LX, z: LZ, y: RY, r: 13, color: 0x60ffb0 }); s.mark({ x: LX, z: LZ, y: RY, r: 4, color: 0xffffff });
    for (const [dx, dz] of [[-38, -20], [38, -20], [-38, 20], [38, 20]]) s.light({ x: LX + dx, y: RY + 2.5, z: LZ + dz, color: 0x9fffe0, i: 500, dist: 80, r: 0.6 });
    srand(9); for (let gx = -4; gx <= 4; gx++) for (let gz = -4; gz <= 3; gz++) { const x = LX + gx * 150, z = LZ - 60 + gz * 130; if ((gx === 0 && (gz === 0 || gz === 1)) || Math.abs(z - (LZ + 190)) < 90) continue; const w = sr(70, 120), d = sr(60, 100); s.building({ x: x + sr(-10, 10), z: z + sr(-10, 10), w, d, h: sr(18, 30), fac: 'tx_fac_paris', lit: sr(0.5, 1.1), solid: false, facTile: 16, top: true, roofMat: { tex: 'tx_roof', color: 0x4c5662 } }); }
    // street lights: thousands of sodium dots along the boulevards between the blocks (one instanced mesh), brighter round the landing hall
    { const pts = []; srand(19); for (let gx = -5; gx <= 4; gx++) for (let z = LZ - 600; z < LZ + 470; z += 13) for (const o of [-6, 6]) pts.push([LX + gx * 150 + 75 + o, z]); for (let gz = -5; gz <= 3; gz++) for (let x = LX - 680; x < LX + 680; x += 13) for (const o of [-6, 6]) pts.push([x, LZ - 60 + gz * 130 + 65 + o]);
      const im = new THREE.InstancedMesh(new THREE.SphereGeometry(0.9, 6, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffa040).multiplyScalar(2.2) }), pts.length), M = new THREE.Matrix4(); pts.forEach(([x, z], i) => im.setMatrixAt(i, M.makeTranslation(x + sr(-1, 1), 6, z))); im.frustumCulled = false; im.userData.noRec = true; s.scene.add(im); }
    s.water({ y: 0.6, color: 0x0e2230, w: 9000, d: 70, z: LZ + 190, size: 9000, opacity: 0.85 }); // the Seine, darker down the middle
    const f = s.fall = new Fall(s, { char: 'ch_agent', x: 0, y: 2300, z: 0, vy0: 30, view: 'top', clouds: true, cloudBase: 700, spread: 52, tuck: 88, steer: 15, chuteV: 15, chuteSteer: 17, openRate: 1.5, aim: { r: 2.2, ref: 40, max: 7, color: 0xffffff }, cam: { height: 9, dist: 4, up: -5, ahead: 3 } }); f.aimOff = true; s.light({ parent: f.c.root, x: 0, y: 4, z: 3, color: 0xbfd0ff, i: 320, dist: 26, bulb: false });
    const plane = s.put('a400m', { x: 10, y: 2308, z: -18 });
    const mate = s.target = f.addBody('ch_skydiver', { x: -40, y: 2300 - 210, z: -45, vy: -50, pose: 'fall' }); mate.c.tumble(1.7, 0.8, 0.5); const ring = beacon(s, 0xff2a2a), strobe = s.light({ color: 0xff3030, i: 0, dist: 60, r: 0.25, glow: 6 });
    mate.ai = (b, dt) => { if (solo) { b.vy = damp(b.vy, -8, 1.4, dt); b.vx = damp(b.vx, 3, 1, dt); b.vz = damp(b.vz, -2, 1, dt); if (mcan) mcan.scale.setScalar(damp(mcan.scale.x, 1, 4, dt)); return; } const dy = f.pos.y - b.pos.y, close = Math.hypot(f.pos.x - b.pos.x, f.pos.z - b.pos.z) < 30 && Math.abs(dy) < 50; b.vy = damp(b.vy, -(close ? clamp(f.speed - dy * 0.8, 42, 70) : dy < -20 ? 70 : 50), 1.5, dt); b.vx = 2.5; b.vz = -1; };
    const R = 10, col = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 28, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 0.7, 1.6), transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })); col.visible = false; col.frustumCulled = false; s.scene.add(col);
    let phase = 'chase', clip = 0, stk = null, nextStk = 2.6, boltT = 0, dodged = 0, pullAlt = 0, amb = 2, cd = 0, bounces = 0, tAtt = 0, near1 = false, solo = false, mcan = null; s.phase = () => phase; s.stk = () => stk; s.lz = [LX, LZ];
    const STRIKE_ADV = 'When the blue column appears, steer straight out of it with WASD and let go of SPACE — you have 1.4 s, and you move faster flat than diving.';
    s.objective('Dodge the lightning — dive to the red strobe');
    s.onUpdate((dt, t) => {
      strobe.position.set(mate.pos.x, mate.pos.y + 1, mate.pos.z); strobe.userData.bulb.position.copy(strobe.position); const blink = (t * 2.2) % 1 < 0.18, clipped = !solo && (phase === 'carry' || phase === 'canopy' || phase === 'down'); strobe.intensity = blink ? (clipped ? 30 : 300) : 0; strobe.userData.bulb.visible = blink && !clipped; // once he is on your harness the strobe stops flaring over you both
      if (boltT > 0) { boltT -= dt; if (boltT <= 0) col.visible = false; }
      if ((phase === 'carry' || phase === 'canopy') && !solo) { mate.pos.set(f.pos.x + 0.3, f.pos.y - (phase === 'canopy' ? 0.5 : 0.12), f.pos.z - 0.55); }
      if (!s.started || s.ended) return; const tt = t - s.t0, alt = f.pos.y; plane.position.z -= 80 * dt; cd -= dt;
      // ambient storm
      amb -= dt; if (amb < 0) { amb = rnd(2.2, 5); s.engine.flash(0.22); s.after(rnd(0.5, 1.4), () => s.audio.thunder()); }
      // telegraphed strikes
      if (!stk && tt > nextStk && (phase === 'chase' || phase === 'carry') && alt > 520 && boltT <= 0) { stk = { x: f.pos.x + f.vel.x * 0.35, z: f.pos.z + f.vel.z * 0.35, t: 1.4 }; s.audio.tick?.(); s.msg('LIGHTNING!', 'small bad'); }
      if (stk) {
        stk.t -= dt; col.visible = true; col.position.set(stk.x, alt - 250, stk.z); col.scale.set(R, 900, R); col.material.opacity = 0.1 + 0.3 * (1 - stk.t / 1.4) + (Math.random() < 0.2 ? 0.2 : 0);
        if (stk.t <= 0) {
          const d = Math.hypot(f.pos.x - stk.x, f.pos.z - stk.z); col.scale.set(1.4, 1400, 1.4); col.material.opacity = 1; boltT = 0.22; s.engine.flash(1); s.audio.thunder(); s.audio.explosion?.(0.5); s.engine.addShake(1.2); nextStk = tt + 4.6; stk = null;
          if (d < R * 0.55) { phase = 'dead'; f.die(); s.fx.sparks(f.pos, 40, { color: [0.6, 0.8, 1] }); return s.fail('Struck by lightning at ' + Math.round(alt * M).toLocaleString('en-US') + ' ft', { injury: 1, advice: STRIKE_ADV }); }
          if (d < R + 0.4) { s.fx.sparks(f.pos, 24, { color: [0.6, 0.8, 1] }); s.engine.hurt(0.45); f.c.tumble(3, 1, 2); s.after(0.8, () => { if (!f.chute && !f.dead) { f.c.tumble(0, 0, 0); f.c.spinAng.set(0, 0, 0); } }); s.flub('Singed by the lightning', { penalty: 0.2, advice: STRIKE_ADV }); }
          else { dodged++; s.bonus('Lightning dodged', 600); if (d < R + 6) { s.msg('CLOSE!', 'small'); s.moment('lightning', { t0: s.t - 2, dur: 3, w: 1.5 }); } }
        }
      }
      s.hud.readout('alt', 'Altitude (ft)', Math.round(alt * M / 10) * 10, phase === 'carry' ? (alt < HARD + 30 ? 'warn' : alt < 460 ? 'ok' : '') : alt < 900 && phase !== 'canopy' ? 'warn' : '');
      if (phase === 'chase') {
        const dy = alt - mate.pos.y, side = f.pos.x >= mate.pos.x ? 1 : -1, dh = Math.hypot(f.pos.x - mate.pos.x - side * 0.9, f.pos.z - mate.pos.z), d3 = Math.hypot(dh, dy), rv = f.speed + mate.vy;
        ring.position.set(mate.pos.x, mate.pos.y + 1, mate.pos.z); ring.scale.setScalar(clamp(d3 / 16, 1.6, 30)); ring.visible = d3 > 12;
        s.hud.readout('sep', dy >= 0 ? 'Partner below (ft)' : 'Partner above (ft)', Math.round(Math.abs(dy) * M), Math.abs(dy) < 3 ? 'ok' : ''); s.hud.readout('rv', 'Closing (kt)', Math.round(rv * 1.94), Math.abs(rv) < 10 ? 'ok' : d3 < 90 ? 'warn' : '');
        if (d3 < 30 !== near1) { near1 = d3 < 30; if (near1) f.view('chase', { dist: 5.5, height: 4.2, up: -0.8, ahead: 0.5, fov: 64 }); else f.view('top', { height: 11, dist: 4.5, up: -5, ahead: 3 }); }
        const inR = d3 < 3 && Math.abs(rv) < 10; s.hud.prompt(inR ? `Hold ${K('E')} — clip on` : ''); s.hud.meter('clip', 'HARNESS', clip / 1.6, { color: '#4f8' });
        if (alt < MISS) { // leeway: his automatic opener fires; you carry on alone to your own pull and landing
          phase = 'carry'; solo = true; tAtt = tt; clip = 0; f.termK = 1; ring.visible = false; s.hud.prompt(''); s.hud.meter('clip', 'HARNESS', 0);
          mate.c.tumble(0, 0, 0); mate.c.spinAng.set(0, 0, 0); mate.c.setPose('hang', 0.4); mcan = model('parachute', { height: 7 }); mcan.position.y = 1.5; mcan.scale.setScalar(0.05); mate.c.root.add(mcan); s.audio.whoosh(1.2);
          s.flub('Missed the catch — his auto-opener fired', { penalty: 0.35, advice: 'Dive (hold SPACE) straight at the red strobe, let go when he is 30 ft below, and hold E beside him — clip on well before 1,800 ft, when his auto-opener fires.' });
          s.rate('Catch', 0, 1); s.objective('On your own now — pull (E) between 1500 and 1100 ft'); f.view('top', { height: 11, dist: 4.5, up: -5, ahead: 3 }); return;
        }
        if (d3 < 1.6 && Math.abs(rv) > 12 && cd < 0) { cd = 1.5; bounces++; const a = Math.atan2(f.pos.z - mate.pos.z, f.pos.x - mate.pos.x); f.carry.set(Math.cos(a) * 15, 0, Math.sin(a) * 15); s.audio.impact(0.7); s.engine.addShake(1); s.engine.hurt(0.3); s.msg('TOO FAST!', 'bad'); }
        if (inR && inp.xk && cd < 0) { clip += dt; f.termK = clamp(-mate.vy / f.o.spread, 0.8, 1.4); f.pos.y = damp(f.pos.y, mate.pos.y, 4, dt); } else { clip = Math.max(0, clip - dt * 0.5); f.termK = 1; }
        if (clip >= 1.6) { phase = 'carry'; tAtt = tt; s.moment('clipped on in the storm', { t0: s.t - 2.6, dur: 4.4, w: 2 }); s.audio.say('Got you. Hold on.', { rate: 1.1 }); f.termK = 1; mate.frozen = true; mate.c.tumble(0, 0, 0); mate.c.spinAng.set(0, 0, 0); mate.c.setPose('freefall', 0.4); mate.c.heading = 0; ring.visible = false; s.hud.prompt(''); s.audio.thud(); s.msg('CLIPPED ON', 'good'); s.rate('Catch', 1 - bounces * 0.3, 1); s.objective('Hold your nerve — pull (E) between 1500 and 1100 ft'); f.view('top', { height: 11, dist: 4.5, up: -5, ahead: 3 }); }
      } else if (phase === 'carry') {
        s.hud.bar(clamp(1 - (alt - 200) / 900), [1 - (460 - 200) / 900, 1 - (HARD - 200) / 900], [1 - (370 - 200) / 900, 1 - (HARD - 200) / 900]); if (alt < 520) s.hud.prompt(`${K('E')} PULL!`);
        if (inp.hit('x') && tt - tAtt > 0.6) {
          pullAlt = alt; s.hud.hideBar(); s.hud.prompt('');
          if (alt < FATAL) { phase = 'dead'; f.o.openRate = 0.12; f.deploy('parachute'); s.msg('TOO LOW!', 'bad'); return s.fail('Pulled at ' + Math.round(alt * M) + ' ft — far too low, the canopy never opened', { injury: 1, delay: 2.6, advice: 'Pull (E) as the altitude passes 1,300 ft — the PULL prompt appears at 1,700 ft; below 400 ft there is no time for it to open.' }); }
          if (alt < HARD) s.flub('Pulled below 1,000 ft', { penalty: 0.3, advice: 'Pull (E) between 1,300 and 1,000 ft — lower than that and the canopy only just opens in time.' });
          phase = 'canopy'; f.deploy('parachute'); f.aimOff = false; if (!solo) mate.c.setPose('hang', 0.4); s.rate('Low pull (' + Math.round(alt * M) + ' ft)', alt < HARD ? 0.5 : near(alt, HARD + 45, 45, 700), 1.6); s.slowmo(0.5, 1); f.cine('orbit', 1.6, { fov: 50 });
          const P = f.pos; s.moment('the last-second pull', { t0: s.t - 3, dur: 6, w: 3, shots: [{ type: 'orbit', fov: 24, a: -0.1, b: 0.5, speed: 0.6 }, { type: 'top', pos: [P.x + 10, P.y + 7, P.z + 12], fov: 28, lookUp: 0.4, a: 0.45, b: 1.0, speed: 0.55 }, { type: 'track', fov: 38, a: 0.6, b: 1.05, speed: 0.8 }] }); /* signature: from the camera jumper above, the canopy snaps open over the lights of Paris */ s.bonus('Seconds of freefall', Math.round(tt * 150)); s.msg(alt < HARD + 75 ? 'LAST SECOND!' : 'CANOPY', 'good'); s.objective('Steer for the lit ring on the glass roof'); f.view('chase', { dist: 8, height: 19, up: -10, ahead: 3, fov: 64 });
        }
      } else if (phase === 'canopy') {
        const d = Math.hypot(f.pos.x - LX, f.pos.z - LZ); s.hud.readout('sep', 'Landing zone (ft)', Math.round(d * M), d < 13 ? 'ok' : ''); s.hud.readout('rv', 'Sink (ft/s)', Math.round(f.speed * M));
        f.o.chuteV = f.pos.y - RY < 22 ? 4.5 : 15;
      }
    });
    f.onLand = i => {
      if (phase !== 'canopy') { phase = 'dead'; f.c.setPose('lie', 0.05); s.audio.impact(1.5); s.engine.addShake(2); return s.fail('Never pulled — hit Paris at ' + Math.round(i.speed * 3.6) + ' km/h', { injury: 1, advice: 'Press E to pull as the altitude passes 1,300 ft — the PULL prompt flashes up at 1,700 ft.' }); }
      phase = 'down'; const d = Math.hypot(i.x - LX, i.z - LZ), onRoof = Math.abs(i.x - LX) < 42 && Math.abs(i.z - LZ) < 23 && f.pos.y > RY - 1; f.c.setPose('land', 0.15); if (!solo) { mate.c.setPose('lie', 0.3); mate.pos.y = f.pos.y; } s.audio.thud(); s.engine.addShake(0.5);
      if (!onRoof) { s.flub(f.pos.y < 1 ? (solo ? 'Landed in the street' : 'Put your partner down in the street') : 'Landed on the wrong rooftop', { penalty: 0.25, advice: 'Under the canopy, steer (WASD) so the white ring under you sits on the green ring on the glass roof — start turning as soon as it opens.' }); s.rate('Landing (' + Math.round(d * M) + ' ft off)', 0, 1.4); s.msg('DOWN… WRONG SPOT', 'bad'); }
      else { s.rate('Landing (' + Math.round(d * M) + ' ft off)', near(d, 0, 3.5, 30), 1.4); s.msg(d < 6 ? 'ON THE RING' : 'DOWN SAFE', 'good'); }
      s.wrap(2.2);
    };
  },
  bot(s, inp, B) {
    const f = s.fall, m = s.target, ph = s.phase(), stk = s.stk(), st = f.o.steer;
    if (ph === 'chase') { const dy = f.pos.y - m.pos.y, side = f.pos.x >= m.pos.x ? 1 : -1; inp.x = clamp((m.pos.x + side * 0.9 - f.pos.x) * 1.2 + m.vx / st, -1, 1); inp.y = clamp((f.pos.z - m.pos.z) * 1.2 - m.vz / st, -1, 1); inp.a = dy > 34; inp.xk = Math.abs(dy) < 3.5; }
    else if (ph === 'carry') { botSteer(f, inp, s.lz[0], s.lz[1], 0.05); inp.a = f.pos.y > 600; if (f.pos.y < 345) inp.press('x'); }
    else if (ph === 'canopy') { inp.x = clamp((s.lz[0] - f.pos.x) * 0.25, -1, 1); inp.y = clamp((f.pos.z - s.lz[1]) * 0.25, -1, 1); }
    if (stk && ph !== 'canopy') { let dx = f.pos.x - stk.x, dz = f.pos.z - stk.z; const d = Math.hypot(dx, dz); if (d < 13.5) { if (d < 0.5) { dx = 1; dz = 0; } inp.x = dx / (d || 1) * 2; inp.y = -dz / (d || 1) * 2; inp.x = clamp(inp.x, -1, 1); inp.y = clamp(inp.y, -1, 1); inp.a = false; } }
  },
};

// ---------------------------------------------------------------------------------------------
// hand a Drive over to a Fall at the same position / velocity (ski jump, bike off a ramp)
function driveToFall(s, car, o) {
  const vy = car.vy, vx = car.vel.x, vz = car.vel.z; car.frozen = true; car.silent = true; car.v = 0;
  s.audio.set('veh', car.kind === 'ski' ? 'wind' : 'engine', 0, 0); s.audio.set('skid', 'skid', 0, 0); s.audio.set('windv', 'wind', 0, 0);
  return new Fall(s, { x: car.pos.x, y: car.pos.y, z: car.pos.z, vy0: -vy, vx0: vx, vz0: vz, camSnap: false, ...o });
}
const SKI_LIP = -640, SKI_H = 900, SKI_SL = 0.42, skiY = z => SKI_H + (z - SKI_LIP) * SKI_SL;
const skiFn = (x, z) => skiY(z) + 0.45 * Math.sin(x * 0.16) * Math.sin(z * 0.09) * smooth(SKI_LIP, SKI_LIP + 30, z) + 9 * smooth(34, 80, Math.abs(x));
const spySki = {
  id: 'spy_ski', title: 'Off the Edge of the World', film: 'The Spy Who Loved Me', year: 1977, tier: 4, pay: 14000, mode: 'drive', art: 'bd_snow', music: 'spy',
  role: 'Doubling 007 — yellow ski suit, one take, three thousand feet of nothing',
  brief: 'Down the slope with the heavies on your tail, straight off the edge of the mountain. Then you fall. And you keep falling. Kick the skis away, and only when the audience has given up on you does that parachute open.',
  tips: ['Dodge the rocks and the gunmen on skis. <b>S</b> scrubs speed, but a fast exit off the lip looks best.', 'In the air press <b>SPACE</b> to <b>kick off the skis</b> — open with them on and the lines tangle.', 'Open the chute (<b>E</b>) as <b>late</b> as you dare: best between 850 and 650 ft. Below 650 ft it barely opens; below 300 ft it will not.'],
  controls: `${K('A')}${K('D')} carve &nbsp; ${K('S')} brake &nbsp; then: ${K('SPACE')} kick off skis &nbsp; ${K('E')} open parachute`, intro: { r: 8, h: 2.4 },
  assets: { models: ['ch_skier', 'ch_goon', 'rock_grey', 'parachute_uj', 'camera_crew', 'film_light', 'director_chair', 'ch_stunt', 'helicopter'], tex: ['bd_snow', 'tx_snow', 'tx_rock'] },
  build(s) {
    // Asgard Peak, Baffin Island: low clear arctic sun raking across a sheer granite wall, blue shadows on the snow
    s.env('snow', { backdrop: 'bd_snow', look: 'warm60s', fog: 0.00048, hz: 0.5, sun: [24, 228], sunI: 3.0, amb: 0.8, lookOver: { contrast: 1.14, vignette: 0.42, sat: 1.05 } });
    const LIP = SKI_LIP, H = SKI_H, HARD = 198, FATAL = 90, inp = s.input, snow = s.mat({ tex: 'tx_snow' }), rock = s.mat({ tex: 'tx_rock', color: 0x9aa0a8 });
    s.ground({ tex: 'tx_snow', tile: 60, y: -6, size: 12000 });
    s.terrain({ x0: -1500, x1: 1500, z0: LIP - 2600, z1: LIP - 0.01, res: 100, fn: (x, z) => 14 * Math.sin(x * 0.004 + 1) * Math.cos(z * 0.003) + 10, tex: 'tx_snow', tile: 60 });
    s.terrain({ x0: -96, x1: 96, z0: LIP, z1: 120, res: 4, fn: skiFn, tex: 'tx_snow', tile: 14 });
    s.box({ x: 0, y: -6, z: LIP + 1.5 + 450, w: 760, h: H + 3, d: 900, mats: [rock, rock, snow, snow, rock, rock], tile: 60, tileTop: 30, top: true });
    for (const [x, w, h, d] of [[-250, 120, H * 0.55, 60], [300, 150, H * 0.4, 80], [-90, 70, H * 0.3, 50], [150, 60, H * 0.75, 40]]) s.box({ x, y: -6, z: LIP + 4 + d / 2 - (h < H ? d * 0.8 : 0), w, h, d, mats: [rock, rock, snow, snow, rock, rock], tile: 60, tileTop: 30 });
    s.forest('tree:snowpine', 300, r => { const sd = r() < 0.5 ? -1 : 1; return [sd * (40 + Math.pow(r(), 1.4) * 52), 110 - r() * (110 - LIP - 30)]; }, { h: [6, 11], solid: true, seedv: 6, msg: 'Wrapped yourself round a pine' });
    s.forest('tree:snowpine', 420, r => [r() * 2600 - 1300, LIP - 150 - r() * 2200], { h: [16, 30], seedv: 9 });
    // the wall: granite buttresses and slabs standing proud of the face, snow lying on their ledges (all well inside the line you fall on)
    const gran = s.mat({ tex: 'tx_rock', color: 0xa8988a }), dk = s.mat({ tex: 'tx_rock', color: 0x6c7078 }), ledge = s.mat({ tex: 'tx_snow', color: 0xf4f6fa }), wallM = [rock, gran, dk];
    srand(61); for (let i = 0; i < 46; i++) { const x = sr(-420, 420), w = sr(20, 80), h = sr(80, 520), d = sr(4, 14), cap = Math.abs(x) < 70 + w / 2 ? H - 90 : H - 25, y = Math.min(sr(-6, H - h - 20), cap - h); if (y + h < 30) continue; s.box({ x, y, z: LIP + 1.5 - d / 2 + 0.5, w, h, d, mat: wallM[i % 3], tile: 60 }); if (i % 2 === 0) s.box({ x, y: y + h, z: LIP + 1.5 - d / 2 + 0.3, w: w * 0.92, h: 1.6, d: d + 0.6, mat: ledge, tile: 30, cast: false }); }
    // the valley floor: dark rock outcrops and stands of pine breaking up the white, so the drop reads from the air
    s.forest('rock_grey', 110, r => [r() * 2400 - 1200, LIP - 100 - r() * 2100], { h: [6, 28], seedv: 62 });
    srand(63); for (let c = 0; c < 14; c++) { const cx = sr(-1100, 1100), cz = sr(LIP - 300, LIP - 2200); s.trees('snowpine', 26, r => [cx + sr(-60, 60), cz + sr(-60, 60)], { h: [14, 26], seedv: 64 + c }); }
    const rocks = [[-9, -60], [12, -110], [-3, -165], [20, -205], [-18, -250], [5, -300], [-12, -345], [16, -385], [-2, -430], [-22, -470], [10, -505], [26, -330], [-27, -140], [0, -560]];
    for (const [x, z] of rocks) s.put('rock_grey', { x, y: skiFn(x, z) - 0.5, z, height: 3.2, ry: x, solid: true, hitScale: 0.7, sol: { msg: 'Hit a rock at full tilt', hardK: 0.3, advice: 'Look 50 m down the slope and carve early round the grey rocks (A/D) — tap S if you are not lined up in time.' } });
    s.crew({ x: 9, y: skiFn(9, 52), z: 52, ry: 1.0 }); s.put('helicopter', { x: -60, y: H + 60, z: LIP - 120, ry: 2.2 });
    const car = s.car = new Drive(s, { kind: 'ski', driver: 'ch_skier', driverPose: 'ski', driverPos: [0, -0.9, 0], x: 0, z: 44, cam: { dist: 6.5, height: 2.7, ahead: 6 }, airDrag: 0.0024, steer: 1.7, crashV: 9, hard: 30, pitchTol: 3, rollTol: 3 }); car.dustColor = [1, 1, 1]; car.k.dusty = true; car.frozen = true; car.cineOff = true; s.onAction = () => { car.frozen = false; car.vel.set(0, 0, -7); car.v = 7; };
    const red = s.mat({ color: 0xd01c1c, rough: 0.4 }), mkSkis = parent => [-0.14, 0.14].map(x => s.box({ parent, x, y: 0, z: -0.25, w: 0.09, h: 0.03, d: 1.85, mat: red })); const skis = mkSkis(car.body); skis.forEach(k => k.position.y -= 0.9);
    // the heavies
    const mv = new Movers(s, car); mv.nearPay = 250; srand(4);
    for (const [x, z, v, ph] of [[-8, -40, 21, 0], [9, -120, 23, 2], [-3, -230, 22, 4], [12, -330, 24, 1]]) { const g = new THREE.Group(); g.userData.size = V3(0.9, 1.8, 1.4); s.char('ch_goon', { parent: g, pose: 'ski' }); s.scene.add(g); mv.add({ obj: g, z, v: 0, path: zz => x + Math.sin(zz * 0.03 + ph) * 7, msg: 'Tangled with one of the gunmen', hardK: 0.2, ai: e => { if (!s.started) return; e.v = e.z < LIP + 46 ? Math.max(0, e.v - 0.5) : v; } }); }
    // replay subject: follows the skier down the slope, then the falling body (the Drive and the Fall are different objects)
    const subj = new THREE.Object3D(); s.scene.add(subj); s.subject = subj; s.onUpdate(() => subj.position.copy(f ? f.pos : car.pos));
    let f = null, phase = 'ski', kicked = false, free = [], hits = 0; s.phase = () => phase; s.rate('Clean run', 1, 0.8);
    car.onHit = sol => { hits++; s.rate('Clean run', 1 - hits * 0.3, 0.8); if (sol?.mover) { mv.fling(sol.mover, 4); car.v *= 0.6; s.audio.thud(); s.engine.addShake(0.8); s.flub('Tangled with a gunman', { penalty: 0.15, advice: 'Watch the skiers ahead and carve (A/D) wide of them early — they weave side to side across the run.' }); return true; } };
    s.objective('Ski for the edge — dodge the rocks and the gunmen');
    s.onUpdate((dt, t) => {
      for (const k of free) { k.vel.y -= G * 0.6 * dt; k.m.position.addScaledVector(k.vel, dt); k.m.rotation.x += k.sp * dt; k.m.rotation.z += k.sp * 0.7 * dt; }
      if (!s.started || s.ended) return;
      if (phase === 'ski') {
        s.hud.readout('spd', 'MPH', Math.round(car.mph)); s.hud.readout('edge', 'Edge (ft)', ftOf(Math.max(0, car.pos.z - LIP)));
        if (Math.abs(car.pos.x) > 90 && !car.dead) return car.crash('Skied off the side of the mountain', { injury: 0.8, advice: 'Stay between the tree lines and point your skis down the fall line — the edge you jump from is dead ahead, not off to the side.' });
        if (car.pos.z < LIP - 0.4 && !car.dead) {
          phase = 'fall'; s.rate('Exit speed (' + Math.round(car.mph) + ' mph)', near(car.mph, 80, 14, 50), 1); const yaw = car.heading; car.obj.visible = false;
          f = s.fall = driveToFall(s, car, { char: 'ch_skier', spread: 54, steer: 8, canTuck: false, carryDrag: 0.22, pose: 'ski', heading: 0, yaw: Math.PI, cam: { dist: 13, height: 4.5, side: 7, up: -1.5, ahead: 0, fov: 60, stiff: 7 } }); f.poseLock = true;
          mkSkis(f.c.root).forEach((k, i) => { free.push({ m: k, vel: V3(), sp: 0, on: true }); }); s.slowmo(0.4, 1.4); s.msg('OFF THE EDGE!', 'huge'); s.moment('off the edge', { t0: s.t - 2.2, dur: 4.5, w: 2, shots: [{ type: 'wide', dist: 1.3 }, { type: 'low', fov: 56 }, { type: 'track', fov: 38 }] }); s.objective('Kick off the skis (SPACE)… then open late (E)'); s.hud.readout('edge', 'Skis', 'ON', 'warn');
          f.onLand = i => { phase = 'dead'; f.c.setPose('lie', 0.05); s.audio.impact(1.5); s.engine.addShake(2); s.fx.dust(f.pos, 20, { color: [1, 1, 1], size: 3 }); const cliffHit = f.pos.y > 200; s.fail(cliffHit ? 'Drifted back into the cliff face' : f.chute ? 'Opened too late — still doing ' + Math.round(i.speed * 3.6) + ' km/h at the valley floor' : 'Never opened the parachute', { injury: 1, advice: cliffHit ? 'Leave the lip with speed (60+ mph) and push W/S away from the rock face as you fall — do not drift back toward the mountain.' : 'Press E to open the chute between 850 and 650 ft on the ALTITUDE readout — below 300 ft it cannot open in time.' }); };
        }
      } else if (phase === 'fall') {
        const alt = f.alt; s.hud.readout('spd', 'Altitude (ft)', ftOf(alt), alt < HARD + 70 ? 'warn' : alt < 290 ? 'ok' : ''); s.hud.bar(clamp(1 - alt / 800), [1 - 290 / 800, 1 - HARD / 800], [1 - 255 / 800, 1 - HARD / 800]);
        if (!kicked && inp.hit('a')) { kicked = true; f.c.setPose('freefall', 0.5); s.audio.thud(); s.msg('SKIS AWAY', 'small'); s.hud.readout('edge', 'Skis', 'OFF', 'ok'); free.forEach((k, i) => { s.scene.attach(k.m); k.vel.set((i ? 1 : -1) * 3 + f.carry.x, f.vel.y + 5, f.carry.z - 2); k.sp = i ? 5 : -4; }); s.objective('Hold it… open (E) between 850 and 650 ft'); }
        if (inp.hit('x')) {
          s.hud.hideBar();
          if (alt < FATAL) { phase = 'late'; f.o.openRate = 0.1; f.deploy('parachute_uj'); s.msg('TOO LATE!', 'bad'); return; }
          if (alt < HARD) s.flub('Opened below 650 ft', { penalty: 0.3, advice: 'Open (E) while the ALTITUDE readout is between 850 and 650 ft — any lower and the canopy only just snaps open before the valley floor.' });
          if (!kicked) s.flub('Opened with the skis on — tangled lines', { penalty: 0.15, advice: 'Press SPACE as soon as you leave the lip to kick the skis away, then wait for the chute.' });
          phase = 'open'; f.deploy('parachute_uj'); s.rate('Late opening (' + ftOf(alt) + ' ft)', alt < HARD ? 0.5 : near(alt, HARD + 25, 35, 520), 2); s.rate('Ski release', kicked ? 1 : 0.3, 0.8); s.bonus('Freefall: ' + ftOf(H - alt) + ' ft', Math.round((H - alt) * 2.2)); s.msg(kicked ? 'RULE BRITANNIA!' : 'SKIS TANGLED IN THE LINES', kicked ? 'huge good' : 'bad');
          const P = f.pos; s.slowmo(0.5, 1.4); s.moment('the Union Jack', { t0: s.t - 2.4, dur: 6, w: 3, shots: [{ type: 'wide', pos: [P.x - 75, P.y + 25, P.z - 70], fov: 18, lookUp: 1.5, a: 0.15, b: 0.75, speed: 0.8 }, { type: 'low', fov: 52, a: 0.3, b: 0.9, speed: 0.5 }, { type: 'wide', dist: 2.6, side: 1, a: 0.5, b: 1.05, speed: 0.6 }] }); /* signature: across the valley, the canopy blooms against the granite wall */ f.view('', { dist: 17, height: 2, side: 5, up: 4.5, ahead: 0, fov: 58 }); f.cine('wide', 2.6, { dist: 1.6 }); s.wrap(3.4, 'Keeping the British end up, sir.');
        }
      }
    });
  },
  bot(s, inp) {
    const c = s.car, ph = s.phase();
    if (ph === 'ski') { let tx = 0, best = 1e9; for (const sol of s.course.solids) { if (sol.dead || sol.type !== 'solid') continue; const dz = c.pos.z - sol.z1; if (dz > -4 && dz < 60 && dz < best && sol.x0 < c.pos.x + 3 && sol.x1 > c.pos.x - 3 && Math.abs((sol.x0 + sol.x1) / 2) < 34) { best = dz; const mid = (sol.x0 + sol.x1) / 2; tx = mid > c.pos.x ? sol.x0 - 4.5 : sol.x1 + 4.5; } } if (best > 1e8) tx = clamp(c.pos.x, -14, 14); botDrive(c, inp, tx, 99, 0.09); inp.y = 0; }
    else if (ph === 'fall') { const f = s.fall; if (f.t > 1.5) inp.press('a'); if (f.alt < 232) inp.press('x'); }
  },
};

// ---------------------------------------------------------------------------------------------
const cliff = {
  id: 'mi_cliff', title: 'The Biggest Stunt in Cinema', film: 'Mission: Impossible – Dead Reckoning', year: 2023, tier: 6, pay: 65000, mode: 'drive', art: 'bd_norway', music: 'epic',
  role: 'Doubling the agent — motorcycle, a ramp, and a Norwegian mountain',
  brief: 'Flat out up the ramp and straight off the mountain. Let the bike go and get away from it, track out from the wall, and open low over the valley. Five hundred skydives of rehearsal for six seconds of film. Do not make it seven.',
  tips: ['Hold the bike at <b>58–68 mph</b> and dead centre — the ramp is one plank wide.', 'Off the lip: <b>steer away from the bike</b> at once, then hold <b>SPACE</b> to track away from the cliff.', 'Pull (<b>E</b>) between <b>300 and 160 m</b> — lower pays more — then steer the canopy to the orange ring.'],
  controls: `${K('W')} gas &nbsp; ${K('S')} brake &nbsp; ${K('A')}${K('D')} steer &nbsp; then: ${K('W')}${K('A')}${K('S')}${K('D')} steer &nbsp; hold ${K('SPACE')} track &nbsp; ${K('E')} parachute`, intro: { r: 8, h: 2.4 },
  assets: { models: ['enduro_bike', 'ch_agent', 'parachute', 'camera_crew', 'film_light', 'director_chair', 'ch_stunt', 'helicopter', 'rock_grey'], tex: ['bd_norway', 'tx_rock', 'tx_grass', 'tx_dirt', 'tx_wood', 'tx_metal'] },
  build(s) {
    // Helsetkopen, Norway: broken cloud, a low sun breaking through across the plateau, fjord haze in the valley below
    s.env('overcast', { backdrop: 'bd_norway', look: 'teal_orange', fog: 0.00042, hz: 0.5, amb: 1.05, sun: [28, 235], sunCol: 0xfff0dc, sunI: 2.9, lookOver: { sat: 0.95, contrast: 1.12, vignette: 0.42 } });
    const H = 800, EDGE = -250, R0 = -140, R1 = -264, RH = 15, LX = 70, LZ = EDGE - 470, HARD = 150, FATAL = 70, inp = s.input, rock = s.mat({ tex: 'tx_rock', color: 0x8f9490 }), grass = s.mat({ tex: 'tx_grass', color: 0x8e9a72 });
    s.ground({ tex: 'tx_grass', tile: 50, y: -5, size: 12000, color: 0x8a9c74 });
    const vfn = (x, z) => 8 * Math.sin(x * 0.005) * Math.cos(z * 0.004) + 6 - 14 * smooth(-420, -620, x);
    s.terrain({ x0: -1600, x1: 1600, z0: EDGE - 2800, z1: EDGE - 0.01, res: 100, fn: vfn, tex: 'tx_grass', tile: 50, mat: s.mat({ tex: 'tx_grass', rep: 1, color: 0xa9bf8f }) });
    s.water({ y: 0.2, color: 0x2b5a6a, w: 1100, d: 5000, x: -1100, z: EDGE - 1400, size: 5000 });
    s.terrain({ x0: -160, x1: 160, z0: EDGE, z1: 140, res: 5, fn: (x, z) => H + 1.2 * Math.sin(x * 0.05 + z * 0.03) * smooth(7, 30, Math.abs(x)), tex: 'tx_grass', tile: 8, vary: { tint: 0x8e9670, patch: 0x7a6e58, amt: 0.5 } });
    s.box({ x: 0, y: -5, z: EDGE + 1 + 500, w: 1500, h: H + 4.5, d: 1000, mats: [rock, rock, grass, grass, rock, rock], tile: 60, tileTop: 12, top: true });
    for (const [x, w, h, d] of [[-330, 130, H * 0.5, 70], [420, 170, H * 0.62, 90], [-120, 80, H * 0.3, 50], [190, 70, H * 0.8, 40]]) s.box({ x, y: -5, z: EDGE + 3 + d / 2 - (h < H ? d * 0.75 : 0), w, h, d, mats: [rock, rock, grass, grass, rock, rock], tile: 60, tileTop: 12 });
    s.road({ z0: 130, z1: R0, width: 4.5, lanes: 1, mat: { tex: 'tx_dirt', color: 0xb49a78 }, marks: false });
    s.slope({ x: 0, w: 3.2, z0: R0, z1: R1, y0: H, y1: H + RH, curve: 1.45, thick: 0.5, mat: { tex: 'tx_wood', rep: 0.25, color: 0xb9a888 }, step: 1.5 });
    const steel = s.mat({ tex: 'tx_metal', color: 0x777c80, metal: 0.5 }), rp = z => H + RH * Math.pow((z - R0) / (R1 - R0), 1.45);
    for (let z = R0 - 12; z > EDGE; z -= 12) for (const x of [-1.5, 1.5]) s.box({ x, y: H, z, w: 0.14, h: Math.max(0.1, rp(z) - H - 0.5), d: 0.14, mat: steel }); for (const x of [-1.5, 1.5]) s.box({ x, y: H + 5.5, z: EDGE - 6, w: 0.2, h: 0.2, d: 17, mat: steel, rx: 0.75 });
    s.forest('tree:pine', 500, r => { const x = r() * 2800 - 1100, z = EDGE - 120 - r() * 2400; return Math.hypot(x - LX, z - LZ) < 60 ? null : [x, z]; }, { h: [14, 26], seedv: 5 }); s.forest('rock_grey', 30, r => [(r() < 0.5 ? -1 : 1) * (9 + r() * 120), 120 - r() * 350], { h: [0.6, 2.4], seedv: 3 });
    disc(s, LX, vfn(LX, LZ) + 0.3, LZ, 16, 0xff7a20, 0.5); s.mark({ x: LX, z: LZ, y: vfn(LX, LZ) + 0.3, r: 16, color: 0xffa040 }); s.mark({ x: LX, z: LZ, y: vfn(LX, LZ) + 0.3, r: 4, color: 0xffffff }); s.crew({ x: LX + 22, y: vfn(LX + 22, LZ), z: LZ - 8, ry: 1.2 });
    // the plateau: bare granite breaking through the heather, boulders and a lip of rock either side of the ramp (the track and ramp stay clear)
    const slab = s.mat({ tex: 'tx_rock', color: 0x8a8c88 }); srand(71);
    for (let i = 0; i < 26; i++) { const x = (i % 2 ? 1 : -1) * sr(12, 150), z = sr(EDGE + 4, 120), w = sr(6, 22), d = sr(5, 18); s.box({ x, y: H - 1.4, z, w, h: sr(1.6, 2.6), d, ry: sr(3), mat: slab, tile: 10, cast: false }); }
    for (const [x0, x1] of [[-60, -9], [9, 70]]) for (let x = x0; x < x1; x += sr(5, 9)) s.box({ x, y: H - 1, z: EDGE + sr(1, 4), w: sr(4, 8), h: sr(1.5, 4), d: sr(3, 6), ry: sr(-0.3, 0.3), mat: rock, tile: 10 });
    s.forest('rock_grey', 60, r => { const x = (r() < 0.5 ? -1 : 1) * (10 + r() * 140); return [x, EDGE + 6 + r() * 360]; }, { h: [1.2, 4.5], seedv: 72 });
    s.trees('bush', 260, r => { const x = (r() < 0.5 ? -1 : 1) * (8 + r() * 150); return [x, EDGE + 5 + r() * 380]; }, { h: [0.5, 1.3], seedv: 73, wide: 1.8 });
    s.crew({ x: 6, y: H, z: 96, ry: 0.9 }); s.put('helicopter', { x: 55, y: H + 30, z: EDGE - 90, ry: -0.9 }); s.line({ x: 0, z: R0 + 1, w: 3.2, d: 0.4, y: H, color: 0xffe14a });
    const car = s.car = new Drive(s, { kind: 'bike', model: 'enduro_bike', driver: 'ch_agent', driverPos: [0, -0.52, 0.28], x: 0, z: 110, cam: { dist: 5.8, height: 2.2 }, hard: 14 });
    car.cineOff = true; const subj = new THREE.Object3D(); s.scene.add(subj); s.subject = subj; s.onUpdate(() => subj.position.copy(f ? f.pos : car.pos)); // replay follows rider, then the body
    let f = null, phase = 'ride', tF = 0, minD = 99, pullAlt = 0, slowWarn = false; const bv = V3(), bp = car.pos; s.phase = () => phase; s.lz = [LX, LZ];
    const PULL_ADV = 'Press E to pull while ALTITUDE reads 300–160 m (the green of the timing bar) — below 70 m the canopy cannot open in time.';
    s.objective('Hit the ramp at 58–68 mph');
    car.onLand = i => { if (phase === 'ride' && i.airTime > 0.3 && car.pos.y < H + 1 && car.pos.z < R0 - 10) { car.crash('Came off the side of the ramp', { injury: 0.6, advice: 'Line up on the yellow line before the ramp and keep A/D light — the ramp is one plank (3 m) wide.' }); return true; } };
    s.onUpdate((dt, t) => {
      if (phase !== 'ride' && !car.landed) { // the bike is now just falling scrap
        const v = -bv.y; bv.y -= G * (1 - (v > 0 ? v * v / 5600 : 0)) * dt; bv.x *= Math.exp(-0.3 * dt); bv.z *= Math.exp(-0.3 * dt);
        if (f && tF > 0.3 && tF < 3.2 && !f.dead) { const dx = f.pos.x - bp.x, dz = f.pos.z - bp.z, d = Math.hypot(dx, dz) || 1; bp.x += dx / d * Math.min(d, 5 * dt); bp.z += dz / d * Math.min(d, 5 * dt); }
        bp.addScaledVector(bv, dt); car.obj.rotation.x += 2.6 * dt; car.obj.rotation.z += 0.9 * dt; const g = s.course.height(bp.x, bp.z, bp.y + 1); if (bp.y <= g) { bp.y = g; car.landed = true; s.fx.dust(bp, 20, { size: 3 }); s.fx.debris(bp, 16, { color: 0x333333 }); s.audio.crash?.(); }
      }
      if (!s.started || s.ended) return;
      if (phase === 'ride') {
        s.hud.readout('spd', 'MPH', Math.round(car.mph), car.pos.z < 0 ? (car.mph > 57 && car.mph < 69 ? 'ok' : 'warn') : '');
        if (Math.abs(car.pos.x) > 150 && !car.dead) return car.crash('Rode off the side of the mountain', { injury: 0.9, advice: 'Follow the dirt track straight to the ramp — it is dead ahead.' });
        if (t - s.t0 > 20 && car.pos.z > R0 && !slowWarn) { slowWarn = true; s.flub('Dawdled to the ramp', { penalty: 0.1, advice: 'Hold W from ACTION — the ramp is 250 m ahead and the weather window is short.' }); }
        if (t - s.t0 > 40 && car.pos.z > R0) return s.fail('Never made it to the ramp — the weather closed in', { injury: 0, advice: 'Hold W from ACTION and ride straight for the ramp; ease off to 58–68 mph only on the last stretch.' });
        if (car.pos.z < R1 - 0.3 && car.pos.y > H + RH - 4 && !car.dead) {
          const mph = car.mph; bv.set(car.vel.x, car.vy, car.vel.z); car.driver.root.visible = false; phase = 'sep'; tF = 0;
          f = s.fall = driveToFall(s, car, { char: 'ch_agent', spread: 52, tuck: 78, steer: 13, carryDrag: 0.3, chuteV: 9, chuteSteer: 9.5, openRate: 1.6, pose: 'fall', tuckPose: 'track', aim: { r: 2.2, ref: 40, max: 7, color: 0xffffff }, cam: { dist: 8.5, height: 5.5, up: -1.5, ahead: 2, fov: 66 } }); f.aimOff = true; f.pos.y += 0.9; f.vel.y += 1.4; f.o.canTuck = false;
          s.rate('Ramp speed (' + Math.round(mph) + ' mph)', near(mph, 63, 5, 24), 1); s.slowmo(0.35, 1.6); s.msg(Math.round(mph) + ' MPH', 'huge'); s.objective('Get away from the bike! Steer clear');
          s.moment('off the mountain', { t0: s.t - 1.8, dur: 5, w: 3 }); s.audio.roar?.(); f.cine('wide', 0.9, { dist: 1.5 });
          if (mph < 40) s.flub('Slow off the ramp (' + Math.round(mph) + ' mph)', { penalty: 0.2, advice: 'Hold W up the ramp — you want 58–68 mph at the lip to fly clear of the cliff and the bike.' });
          f.onLand = i => {
            if (phase === 'canopy' && f.pos.y < 200) { const d = Math.hypot(i.x - LX, i.z - LZ); f.c.setPose('land', 0.15); s.audio.thud(); s.rate('Landing (' + Math.round(d) + ' m off)', near(d, 0, 6, 150), 1.2); s.msg(d < 16 ? 'IN THE RING' : 'DOWN SAFE', 'good'); if (d < 40) s.after(0.5, () => s.audio.cheer?.()); return s.wrap(2.2); }
            f.c.setPose('lie', 0.05); s.audio.impact(1.5); s.engine.addShake(2); s.fx.dust(f.pos, 16, { size: 3 }); const cliffHit = f.pos.y > 200; s.fail(cliffHit ? 'Did not track far enough — flew back into the cliff' : phase === 'late' ? 'Pulled far too low — the canopy never opened' : 'Never pulled', { injury: 1, advice: cliffHit ? 'Hold SPACE to track away as soon as you are clear of the bike, and keep A/D away from the rock buttresses either side.' : PULL_ADV }); phase = 'dead';
          };
        }
      } else if (f && phase !== 'dead') {
        tF += dt; const alt = f.alt, dB = Math.hypot(f.pos.x - bp.x, f.pos.z - bp.z), out = EDGE - f.pos.z;
        s.hud.readout('spd', 'Altitude (m)', Math.round(alt), phase !== 'canopy' && alt < HARD + 60 ? 'warn' : phase !== 'canopy' && alt < 215 ? 'ok' : '');
        if (phase === 'sep') {
          f.poseLock = tF < 0.5; s.hud.readout('bike', 'Bike (m)', dB.toFixed(1), dB < 4 ? 'warn' : 'ok'); if (tF > 0.6) minD = Math.min(minD, dB);
          if (tF > 0.9 && dB < 1.3 && Math.abs(f.pos.y - bp.y) < 3.2) { phase = 'dead'; f.die(); s.audio.impact(1.2); s.engine.addShake(1.5); s.fx.sparks(f.pos, 30); return s.fail('The bike came down on top of you', { injury: 0.9, advice: 'The moment you leave the lip, hold D (or A) and W to steer away from the bike — get the BIKE readout over 4 m within 2 seconds.' }); }
          if (tF > 3.2) { phase = 'track'; f.o.canTuck = true; s.rate('Clear of the bike', clamp((dB - 3) / 9), 0.8); s.objective('Hold SPACE to track away from the cliff — pull (E) at 300–160 m'); }
        } else if (phase === 'track') {
          f.windZ = f.tucked ? -24 : 0; s.hud.readout('bike', 'From the cliff (m)', Math.round(out), out > 230 ? 'ok' : ''); s.hud.bar(clamp(1 - alt / H), [1 - 300 / H, 1 - HARD / H], [1 - 200 / H, 1 - HARD / H]);
          if (inp.hit('x')) {
            s.hud.hideBar(); f.windZ = 0; pullAlt = alt;
            if (alt < FATAL) { phase = 'late'; f.o.openRate = 0.1; f.deploy('parachute'); s.msg('TOO LOW!', 'bad'); return; }
            if (alt < HARD) s.flub('Pulled below 150 m', { penalty: 0.3, advice: 'Pull (E) inside the green of the timing bar (200–150 m) — lower than that and the canopy barely opens before the trees.' });
            phase = 'canopy'; f.deploy('parachute'); f.aimOff = false; s.rate('Low pull (' + Math.round(alt) + ' m)', alt < HARD ? 0.5 : near(alt, HARD + 30, 30, 500), 1.6); s.slowmo(0.5, 0.9); s.moment('low pull over the valley', { t0: s.t - 2.5, dur: 5, w: 2, shots: [{ type: 'orbit' }, { type: 'low', fov: 56 }, { type: 'wide', dist: 1.4 }] }); s.bonus('Freefall: ' + Math.round(H - alt) + ' m', Math.round((H - alt) * 4)); s.msg(alt < 205 ? 'LOW AND LATE!' : 'CANOPY', 'good'); s.objective('Steer the canopy to the orange ring'); f.view('chase', { dist: 8, height: 19, up: -10, ahead: 3, fov: 64 });
          }
        } else if (phase === 'canopy') { const d = Math.hypot(f.pos.x - LX, f.pos.z - LZ); s.hud.readout('bike', 'Landing zone (m)', Math.round(d), d < 16 ? 'ok' : ''); f.o.chuteV = alt < 18 ? 4 : 9; }
      }
    });
  },
  bot(s, inp) {
    const c = s.car, ph = s.phase(), f = s.fall, L = s.lz;
    if (ph === 'ride') botDrive(c, inp, 0, 28.3, 0.12);
    else if (ph === 'sep') { inp.x = 1; inp.y = 0.5; }
    else if (ph === 'track') { inp.x = clamp((L[0] - f.pos.x) * 0.1, -1, 1); inp.y = clamp((f.pos.z - L[1]) * 0.05, -1, 1); inp.a = f.pos.z - L[1] > 190 && f.alt > 330; if (f.alt < 192) inp.press('x'); }
    else if (ph === 'canopy') { inp.x = clamp((L[0] - f.pos.x) * 0.3, -1, 1); inp.y = clamp((f.pos.z - L[1]) * 0.3, -1, 1); }
  },
};

// v2: goals (briefing + ACTION card), replay edits (cine), freeze-frames and live-cut angles
const EXTRA = {
  butch_cliff: {
    goals: { shot: ['Hold W to sprint for the rim and press SPACE in the last 3 m (EDGE readout green, under 10 ft)', 'In the air, steer (WASD) the red ring into the yellow ring inside the orange buoys — the wind drags you left, so lean on D', 'From about 200 ft (HEIGHT readout), hold SPACE to straighten up feet first until the FEET FIRST meter is green'], cut: ['Landing on the rocks, a boulder, or more than 10 ft outside the deep channel'], stars: ['Take-off at the lip', 'Distance from the centre of the deep channel', 'Feet-first entry'] },
    cine: [{ type: 'front', pos: SIG_BUTCH, fov: 13, lookUp: 0.6, a: -0.1, b: 0.3, speed: 1 }, { type: 'wide', pos: [-43, 89.6, -24], fov: 20, lookUp: 0.6, a: 0.2, b: 0.62, speed: 0.7 }, { type: 'track', fov: 58, a: 0.45, b: 0.8, speed: 0.55 }, { type: 'low', pos: [21, 2.0, -41], fov: 36, lookUp: 0.8, a: 0.72, b: 1.05, speed: 0.5 }],
    freeze: { line: 'You crazy? The fall\'ll probably kill ya!', shot: 1, at: 0.45 },
  },
  lethal_weapon: {
    goals: { shot: ['On the ledge, A/D until OFF LINE reads 0 ft, then SPACE to step off (wait 25 s and the jumper drags you off)', 'Steer (WASD) to keep the red ring on the X — gusts shove you sideways, watch the WIND arrow', 'Press E inside the green of the timing bar (about 60 ft up) to roll onto your back'], cut: ['Missing the airbag by more than about 4 ft and hitting the street'], stars: ['Landing in the centre of the bag', 'Back-first landing (timing of E)'] },
    cine: [{ type: 'wide', pos: [-12, 60, -32.5], fov: 22, lookUp: 0.6, a: -0.1, b: 0.72, speed: 0.85 }, { type: 'low', pos: [11.5, 0.9, -8], fov: 46, lookUp: 0.6, a: 0.5, b: 1.0, speed: 0.45 }, { type: 'wide', dist: 1.3, a: 0.7, b: 1.1, speed: 0.7 }],
  },
  goldeneye_dam: {
    goals: { shot: ['Press SPACE to swan-dive off the parapet', 'All the way down keep WALL between 2 and 7 m: A eases away, D closes in — the updraught keeps pushing you in', 'Press E to fire the piton when STOP HEIGHT reads 0–14 m (green); it shows up below 170 m'], cut: ['Touching the dam face', 'Firing the piton so late that the cord runs out (STOP HEIGHT under −16 m), or never firing it'], stars: ['How low the cord stops you', 'How close to the concrete you stayed'] },
    cine: [{ type: 'top', pos: [5, 224, -2.6], fov: 16, lookUp: 0.3, a: 0.14, b: 0.6, speed: 1 }, { type: 'low', fov: 55, at: 0.9, a: 0.35, b: 1.0, speed: 0.5 }, { type: 'wide', dist: 1.5, a: 0.65, b: 1.05, speed: 0.7 }],
  },
  point_break: {
    goals: { shot: ['Hold SPACE to dive after the orange smoke trail', 'Let go of SPACE before you reach him — CLOSING must be under 9 m/s or you bounce off', 'Beside him, hold E and stay glued to him (WASD) for 2 s until GRIP is full', 'Hook up before 600 m altitude — the higher, the better'], cut: ['He opens the canopy with you hanging on', 'Reaching 600 m without him: you pull the hidden reserve and the take is blown (almost no stars)'], stars: ['Hook-up height', 'Docking speed', 'Clean catch (each bounce or slip costs)'] },
    cine: ['orbit', { type: 'track', fov: 58 }, { type: 'wide', dist: 1.2 }],
  },
  mi_halo: {
    goals: { shot: ['Lightning: when a blue column appears around you, steer out of it within 1.4 s (let go of SPACE — you move faster flat)', 'Hold SPACE to dive to the red strobe, let go when close, then hold E beside him until HARNESS is full', 'Press E to pull between 1,300 and 1,000 ft — lower pays more', 'Steer the canopy onto the green ring on the glass roof'], cut: ['A direct lightning strike', 'Pulling below 400 ft, or never pulling'], stars: ['Catch', 'Low pull', 'Landing on the ring', 'Bonus: every bolt dodged'] },
    cine: [{ type: 'track', fov: 38 }, { type: 'orbit', fov: 30 }, { type: 'wide', dist: 1.2 }],
  },
  spy_ski: {
    goals: { shot: ['Ski down with A/D, carving round the rocks and the 4 gunmen (S brakes; about 80 mph off the lip scores best)', 'Ski straight off the edge of the mountain', 'In the air press SPACE to kick off the skis', 'Then wait — press E to open the Union Jack between 850 and 650 ft (ALTITUDE readout)'], cut: ['Hitting a rock or skiing off the side of the run', 'Opening below 300 ft, or never opening'], stars: ['Clean run', 'Exit speed', 'Late opening', 'Ski release'] },
    cine: [{ type: 'wide', dist: 1.6, a: -0.1, b: 0.55, speed: 0.8 }, { type: 'low', fov: 52, a: 0.3, b: 0.9, speed: 0.5 }, { type: 'wide', dist: 2.6, side: 1, a: 0.5, b: 1.05, speed: 0.6 }],
    freeze: { line: 'Nobody does it better.', shot: 2, at: 0.55 },
  },
  mi_cliff: {
    goals: { shot: ['Ride the dirt track and up the one-plank ramp dead centre at 58–68 mph (W gas, S brake)', 'Off the lip, steer hard away from the bike (A or D) until BIKE reads over 4 m', 'Hold SPACE to track away from the cliff, then press E to pull at 300–160 m (green of the bar)', 'Steer the canopy to the orange ring in the valley'], cut: ['Falling off the side of the ramp', 'The bike landing on you', 'Pulling below 70 m, or never pulling'], stars: ['Ramp speed', 'Clear of the bike', 'Low pull', 'Landing in the ring'] },
    cine: [{ type: 'wide', pos: [-24, 806, -246], fov: 26, lookUp: 0.6, a: 0.1, b: 0.75, speed: 0.6 }, { type: 'track', fov: 56, a: 0.3, b: 0.85, speed: 0.45 }, { type: 'orbit', a: 0.55, b: 1.05, speed: 0.6 }],
  },
};
export default [butch, lethal, dam, pointBreak, halo, spySki, cliff].map(d => Object.assign(d, EXTRA[d.id]));
