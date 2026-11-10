import * as THREE from 'three';
import { Drive, Movers, Convoy } from '../modes/drive.js';
import { clamp, near, smooth, V3, rnd, sr, srand, lerp } from '../world/stage.js';
import { K, CTL, street, traffic, botDrive, sign, TRAFFIC } from './common.js';
import * as dress from '../world/dress.js';

const ftOf = m => Math.round(m * 3.281);
function rain(s, n = 6) { const p = V3(), v = V3(0, -38, 0); s.onUpdate(() => { const c = s.camera.position; for (let i = 0; i < n; i++) s.fx.streak(p.set(c.x + rnd(-14, 14), c.y + rnd(2, 9), c.z + rnd(-22, 4)), v, [0.75, 0.82, 1], 0.28, 0.07, 0.35); }); s.audio.set('rain', 'rain', 0.3, 0.12); }
export function trees(s, id, n, z0, z1, xin, xout, o = {}) { return s.forest(id, n * (o.mult ?? 4), (r) => { const sd = r() < 0.5 ? -1 : 1; const z = z0 + (z1 - z0) * r(); return [sd * (xin + Math.pow(r(), 1.5) * (xout - xin)) + (o.cx ? o.cx(z) : 0), z]; }, { h: o.h || [7, 13], solid: o.solid, solidX: o.solidX, seedv: o.seedv }); }

// ---------------------------------------------------------------------------------------------
const italian = {
  id: 'italian_job', title: 'The Rooftop Job', film: 'The Italian Job', year: 1969, tier: 2, pay: 4200, mode: 'drive', art: 'bd_turin', music: 'spy',
  role: 'Lead getaway driver — three Mini Coopers, red, white and blue',
  brief: 'Three Minis, one roof, one gap. You lead, the lads follow your line exactly. Hit the ramp at sixty, land on the far roof and stop before you run out of building.',
  tips: ['Take off between <b>55 and 70 mph</b> — too slow and you drop into the street.', 'The white and blue Minis copy your line. Keep it smooth and they keep formation.', 'Dodge the skylights, then <b>brake hard</b> and stop in the green box on the far roof.'],
  controls: CTL.drive, intro: { r: 11, h: 3 },
  assets: { models: ['mini_red', 'mini_white', 'mini_blue', 'cardboard_boxes'], tex: ['bd_turin', 'tx_cobble', 'tx_fac_italy', 'tx_roof', 'tx_concrete', 'tx_wood'] },
  build(s) {
    s.env('golden', { backdrop: 'bd_turin', look: 'warm60s', fog: 0.0016 });
    s.ground({ tex: 'tx_cobble', tile: 8 });
    const Y = 30, Y2 = 25;
    s.building({ x: 0, z: -65, w: 20, d: 170, h: Y, fac: 'tx_fac_italy', top: true }); s.building({ x: 0, z: -235, w: 24, d: 130, h: Y2, fac: 'tx_fac_italy', top: true });
    s.slope({ x: 0, w: 10, z0: -118, z1: -150, y0: Y, y1: Y + 2.6, curve: 1.7, mat: { tex: 'tx_wood', rep: 0.3 } });
    for (const sx of [-1, 1]) { s.box({ x: sx * 9.8, y: Y, z: -52, w: 0.4, h: 0.7, d: 132, mat: 'tx_concrete', solid: true }); s.box({ x: sx * 11.8, y: Y2, z: -235, w: 0.4, h: 0.9, d: 130, mat: 'tx_concrete', solid: true }); }
    s.box({ x: 0, y: Y2, z: -299.6, w: 24, h: 1.4, d: 0.5, mat: 'tx_concrete', solid: true, sol: { msg: 'Ran out of roof' } });
    const sky = s.mat({ glass: true, color: 0x9fd0e0, opacity: 0.5 });
    for (const [x, z] of [[-4, -38], [4.5, -62], [-3.5, -88], [5.5, -200], [-5.5, -222]]) s.box({ x, y: z < -160 ? Y2 : Y, z, w: 3, h: 1.1, d: 4, mat: sky, solid: 'break', sol: { glass: true, slow: 0.8, on: () => { s.rate('Clean line', (s.scores.get('Clean line')?.v ?? 1) - 0.3); s.msg('SKYLIGHT!', 'bad'); } } });
    s.put('cardboard_boxes', { x: 0, y: Y2, z: -214, height: 2.2, solid: 'break', sol: { soft: true, debris: 0xb08a55 } });
    for (const [sd, x, sv] of [[-1, -24, 3], [1, 24, 5], [-1, -70, 8], [1, 70, 9]]) s.row({ side: sd, x, z0: 60, z1: -340, fac: ['tx_fac_italy'], height: [14, 26], seedv: sv, solid: false });
    const zone = s.line({ x: 0, z: -272, w: 22, d: 22, y: Y2, color: 0x30ff70, glow: 0.8 }); zone.material.opacity = 0.25; s.line({ x: 0, z: -117, w: 10, d: 0.6, y: Y, color: 0xffe14a });
    s.crew({ x: 8, z: -8, y: Y, ry: 1.2 }); s.crew({ x: -9.5, z: -180, y: Y2, ry: -1.9, people: false });
    const car = s.car = new Drive(s, { kind: 'mini', model: 'mini_red', x: 0, z: 8, y: Y });
    new Convoy(s, car, [{ model: 'mini_white' }, { model: 'mini_blue' }], { delay: 0.55, gap: 4.6 });
    s.rate('Clean line', 1); let jumped = false, landed = false, stopped = false;
    car.onAir = t => { if (t.z < -140 && !jumped) { jumped = true; s.rate('Take-off speed', near(car.mph, 62, 7, 26), 1.5); s.slowmo(0.45, 0.9); s.msg(Math.round(car.mph) + ' MPH', 'good'); } };
    car.onLand = i => {
      if (car.pos.y < 10) { car.crash(jumped ? 'Came up short and dropped into the street' : 'Drove off the roof', { injury: 0.75 }); return true; }
      if (jumped && !landed && car.pos.z < -165) { landed = true; s.rate('Landing', i.clean, 1.5); s.msg(i.clean > 0.8 ? 'PERFECT LANDING' : 'DOWN!', i.clean > 0.8 ? 'good' : ''); s.objective('Brake! Stop in the green box'); }
    };
    car.onHit = () => s.rate('Clean line', (s.scores.get('Clean line')?.v ?? 1) - 0.25);
    s.objective('Hit the ramp at 55–70 mph');
    s.onUpdate(() => {
      s.hud.readout('spd', 'MPH', Math.round(car.mph), !jumped && car.pos.z < -70 ? (car.mph > 54 && car.mph < 71 ? 'ok' : 'warn') : '');
      if (landed && !stopped && Math.abs(car.v) < 0.6 && car.grounded) { stopped = true; s.rate('Stopping mark', near(car.pos.z, -272, 9, 30)); s.rate('Time', near(s.t - s.t0, 15, 3, 14), 0.5); s.wrap(1.4); }
    });
  },
  bot(s, inp) { const c = s.car; if (c.pos.z > -150) botDrive(c, inp, c.pos.z > -100 ? (c.pos.z > -50 ? 1 : 0.5) : 0, 27.5); else if (c.pos.z > -165) { inp.y = 0; inp.x = 0; } else botDrive(c, inp, 0, c.pos.z < -205 ? 0 : 14); if (c.pos.z < -262) inp.y = -1; },
};

// ---------------------------------------------------------------------------------------------
const greatEscape = {
  id: 'great_escape', title: 'The Wire', film: 'The Great Escape', year: 1963, tier: 1, pay: 1900, mode: 'drive', art: 'bd_alps', music: 'western',
  role: 'Doubling the Cooler King on a stolen Triumph',
  brief: 'Open meadow, a grass bank, and a twelve-foot border fence. Wind it up, hit the bank flat out and clear the wire. The Swiss side is a nice soft field, I am told.',
  tips: ['You need <b>50 mph or more</b> at the bank to clear the wire.', 'Go through the gap in the first fence — do not hit the posts.', 'In the air: <b>W lifts the nose, S drops it</b>. Land rear wheel first.'],
  controls: CTL.bike, intro: { r: 7, h: 2 },
  assets: { models: ['triumph', 'ch_biker', 'pine_tree', 'ww2_truck', 'rock_grey'], tex: ['bd_alps', 'tx_grass', 'tx_wood', 'tx_dirt'] },
  build(s) {
    s.env('day', { backdrop: 'bd_alps', look: 'warm60s', fog: 0.0012, hz: 0.42 });
    const hill = (x, z) => (Math.sin(x * 0.035 + 1) * Math.cos(z * 0.02) * 4 + Math.sin(z * 0.011 + x * 0.02) * 3 + 5) * smooth(14, 70, Math.abs(x));
    s.ground({ tex: 'tx_grass', tile: 5, y: -0.4, base: false }); s.terrain({ x0: -170, x1: 170, z0: 90, z1: -560, res: 5, fn: hill, tex: "tx_grass", tile: 5 });
    const wood = s.mat({ tex: 'tx_wood', color: 0x9a8a70 }), wire = s.mat({ color: 0x555555, metal: 0.6, rough: 0.5 });
    // first fence with a gap on the right
    for (let x = -60; x <= 60; x += 4) { if (x > 2 && x < 9) continue; s.box({ x, y: 0, z: -150, w: 0.22, h: 1.5, d: 0.22, mat: wood, solid: 'break', sol: { debris: 0x8a7050, slow: 0.7, on: () => s.flub('Went through the fence', { penalty: 0.15, advice: 'Line up on the gap in the first fence early — it is on the right, by the flag.' }) } }); if (!(x > -2 && x < 9)) s.box({ x: x + 2, y: 0.5, z: -150, w: 4, h: 0.9, d: 0.08, mat: wood, solid: 'break', sol: { debris: 0x8a7050, slow: 0.85 } }); }
    // grass bank + the big double fence
    s.slope({ x: 0, w: 12, z0: -294, z1: -311, y0: 0, y1: 2.6, curve: 1.5, mat: { tex: 'tx_grass', rep: 0.12 } });
    for (const z of [-326, -333]) { for (let x = -80; x <= 80; x += 5) s.box({ x, y: 0, z, w: 0.25, h: 3.3, d: 0.25, mat: wood, cast: x > -30 && x < 30 }); for (let y = 0.5; y < 3.3; y += 0.55) s.box({ x: 0, y, z, w: 160, h: 0.04, d: 0.04, mat: wire, cast: false }); }
    s.course.addSolid({ x0: -80, x1: 80, y0: 0, y1: 3.2, z0: -334, z1: -325, msg: 'Tangled in the barbed wire', hardK: 0.1, advice: 'You hit the bank too slow to clear the wire. Be over 50 mph before the bank and stay flat out up it.' });
    trees(s, 'pine_tree', 70, 60, -540, 22, 150, { h: [8, 15], seedv: 4 }); s.forest('rock_grey', 40, r => [(r() < .5 ? -1 : 1) * (16 + r() * 60), 40 - r() * 520], { h: [1, 2.6], seedv: 9 });
    s.put('ww2_truck', { x: -9, z: 52, ry: 0.5 }); s.crew({ x: 7, z: 30, ry: 0.9 }); s.crew({ x: -10, z: -350, ry: 2.6, people: false });
    s.line({ x: 0, z: -292, w: 12, d: 0.5, color: 0xffe14a }); s.line({ x: 0, z: -430, w: 30, d: 1, color: 0x30ff70 });
    const b = s.car = new Drive(s, { kind: 'bike', model: 'triumph', driver: 'ch_biker', driverPos: [0, -0.52, 0.28], x: 5, z: 36, cam: { dist: 5.6, height: 2.1 } }); b.dustColor = [0.45, 0.5, 0.3]; b.k.dusty = true;
    let jumped = false, landed = false; s.objective('Reach 50+ mph before the bank');
    b.onAir = t => { if (t.z < -300 && !jumped) { jumped = true; s.rate('Speed at the bank', near(b.mph, 62, 7, 22), 1.2); s.slowmo(0.4, 1.0); s.msg(Math.round(b.mph) + ' MPH', 'good'); s.objective('Hold it steady…'); } };
    b.onLand = i => { if (jumped && !landed && b.pos.z < -334) { landed = true; s.rate('Landing', i.clean, 1.5); s.bonus('Height over the wire', Math.round(clamp(i.airTime - 1, 0, 1) * 300)); s.msg(i.clean > 0.75 ? 'CLEARED IT!' : 'OVER!', 'good'); s.objective('Ride for the Swiss border'); } };
    s.onUpdate(() => { s.hud.readout('spd', 'MPH', Math.round(b.mph), !jumped && b.pos.z < -200 ? (b.mph >= 50 ? 'ok' : 'warn') : ''); if (landed && b.pos.z < -430 && !s.ended) { s.rate('Time', near(s.t - s.t0, 17, 2, 12), 0.6); s.wrap(1.2); } });
  },
  bot(s, inp) { const b = s.car; botDrive(b, inp, b.pos.z > -160 ? 5.5 : 0, 28); if (!b.grounded) { inp.x = 0; inp.y = b.pitch > 0.12 ? -0.6 : 0.2; } },
};

// ---------------------------------------------------------------------------------------------
const smokey = {
  id: 'smokey', title: 'Bridge Out', film: 'Smokey and the Bandit', year: 1977, tier: 1, pay: 2100, mode: 'drive', art: 'bd_georgia', music: 'western',
  role: 'Doubling the Bandit — black and gold Trans Am, Sheriff on your tail',
  brief: 'The Mulberry bridge is gone, the Sheriff is right behind you, and the only way over that river is seventy miles an hour and a prayer. Do not lift.',
  tips: ['Smash through the <b>BRIDGE OUT</b> barrier and keep your foot in.', 'You want <b>70 mph+</b> at the ramp. Under 55 and you are swimming.', 'Keep it straight on the dirt — the Trans Am likes to step out.'],
  controls: CTL.drive, intro: { r: 9, h: 2.4 },
  assets: { models: ['transam', 'police_car', 'pine_tree', 'oak_tree', 'wagon_brown'], tex: ['bd_georgia', 'tx_grass', 'tx_dirt', 'tx_wood'] },
  build(s) {
    s.env('day', { backdrop: 'bd_georgia', look: 'warm60s', fog: 0.0014 });
    const river = (x, z) => -6 * smooth(0, 5, Math.min(z + 367, -335 - z)); // trench between -335 and -367
    s.ground({ tex: "tx_grass", tile: 5, y: -0.3, base: false }); s.terrain({ x0: -200, x1: 200, z0: 100, z1: -700, res: 4, fn: (x, z) => (z < -330 && z > -372 ? river(x, z) : 0), tex: "tx_grass", tile: 5 });
    s.water({ y: -2.4, color: 0x3c5a3a, w: 500, d: 40, z: -351, size: 500 });
    s.road({ z0: 100, z1: -334, width: 8, lanes: 2, mat: { tex: 'tx_dirt', color: 0xc9a074 }, marks: false }); s.road({ z0: -368, z1: -700, width: 8, lanes: 2, mat: { tex: 'tx_dirt', color: 0xc9a074 }, marks: false });
    s.slope({ x: 0, w: 7, z0: -317, z1: -334, y0: 0, y1: 2.0, curve: 1.5 }); // what is left of the bridge
    const red = s.mat({ color: 0xcc2211 }); for (const x of [-2.2, 0, 2.2]) s.box({ x, y: 0.5, z: -270, w: 2, h: 0.35, d: 0.12, mat: x ? s.mat({ color: 0xeeeeee }) : red, solid: 'break', sol: { soft: true, debris: 0xdddddd } });
    sign(s, 'BRIDGE OUT', { x: 0, y: 1.5, z: -269.9, w: 5, bg: '#d9a400', fg: '#111' });
    trees(s, 'pine_tree', 30, 90, -680, 12, 110, { h: [9, 16], seedv: 2 }); trees(s, 'oak_tree', 18, 90, -680, 14, 90, { h: [7, 11], seedv: 6 });
    // Georgia back road: pine woods closing in on both sides, poles, a ranch fence, a barn and baled fields
    dress.treeLine(s, { x: -48, z0: 90, z1: -326, side: -1, depth: 22, step: 6, kinds: ['pine', 'oak', 'pine'], h: [10, 18], seed: 3 }); dress.treeLine(s, { x: 46, z0: 40, z1: -326, side: 1, depth: 22, step: 6, kinds: ['pine', 'oak'], h: [10, 17], seed: 4 });
    dress.treeLine(s, { x: -24, z0: -376, z1: -700, side: -1, depth: 20, kinds: ['pine', 'oak'], seed: 5 }); dress.treeLine(s, { x: 24, z0: -376, z1: -700, side: 1, depth: 20, kinds: ['pine'], seed: 6 });
    dress.hills(s, { z: -300, r: 520, h: 55, color: 0x4a5a3a, trees: 'pine', nTrees: 220 });
    dress.poles(s, { x: -6.5, z0: 95, z1: -320 }); dress.poles(s, { x: -6.5, z0: -372, z1: -690 });
    dress.fence(s, { x: 7, z0: 80, z1: -250, kind: 'rail' }); dress.fence(s, { x: -9, z0: -60, z1: -300, kind: 'wire' });
    dress.barn(s, { x: 22, z: -40, w: 11, d: 16, h: 5.5, ry: 0.3 }); dress.barn(s, { x: 18, z: -70, w: 6, d: 7, h: 3, ry: 0.1, color: 0x6a6258 });
    srand(14); dress.bales(s, Array.from({ length: 14 }, () => [sr(12, 27), sr(-120, -230), sr(3)]));
    s.trees('bush', 70, (r, i) => { let x = sr(-40, 40); if (Math.abs(x) < 6) x += 10 * Math.sign(x || 1); return [x, i % 2 ? sr(-330, -336) : sr(-366, -372)]; }, { h: [1, 2.2], seedv: 21 }); // scrub along both banks
    s.crew({ x: 7, z: 12, ry: 1.0 }); s.crew({ x: -8, z: -385, ry: 2.5, people: false });
    const car = s.car = new Drive(s, { kind: 'muscle', model: 'transam', x: 0, z: 30 }); car.dustColor = [0.7, 0.5, 0.35]; car.k.dusty = true; car.k.grip = 4.2;
    const mv = new Movers(s, car); let sunk = false;
    mv.add({ model: 'wagon_brown', x: -2, z: -150, v: 9, msg: 'Rear-ended a station wagon', nearMiss: true });
    const sher = mv.add({ model: 'police_car', x: 0.5, z: 52, v: 0, nearMiss: false, solid: false, ai: (e, dt) => { if (!s.started || e.free) return; e.v = damp2(e.v, Math.max(8, car.v * 0.97), dt); if (e.z < -330 && !e.free) { mv.fling(e, 3); e.floor = -3; e.v = 24; s.after(1.1, () => { s.fx.splash(e.m.position, 60, 2); s.audio.splash(); sunk = true; s.bonus('Sheriff took a bath', 250); }); } } });
    const damp2 = (a, b, dt) => a + (b - a) * Math.min(1, dt * 2);
    let jumped = false, landed = false; s.objective('Build speed — 70 mph at the ramp');
    car.onAir = t => { if (t.z < -325 && !jumped) { jumped = true; s.rate('Take-off speed', near(car.mph, 80, 9, 30), 1.4); s.slowmo(0.4, 1.1); s.msg(Math.round(car.mph) + ' MPH', 'good'); } };
    car.onLand = i => { if (car.pos.y < -1.5) { s.fx.splash(car.pos, 80, 2.5); s.audio.splash(); car.crash('Parked the Trans Am in the river', { injury: 0.5 }); return true; } if (jumped && !landed) { landed = true; s.rate('Landing', i.clean, 1.4); s.bonus('Air: ' + ftOf(i.dist) + ' ft', Math.round(i.dist * 8)); s.msg(ftOf(i.dist) + ' FEET!', 'good'); s.objective('East bound and down'); } };
    car.onHit = () => s.rate('Clean run', (s.scores.get('Clean run')?.v ?? 1) - 0.3); s.rate('Clean run', 1, 0.7);
    s.onUpdate(() => { s.hud.readout('spd', 'MPH', Math.round(car.mph), !jumped && car.pos.z < -180 ? (car.mph >= 68 ? 'ok' : 'warn') : ''); if (landed && car.pos.z < -470 && !s.ended) s.wrap(1.2); });
  },
  bot(s, inp) { const c = s.car; botDrive(c, inp, c.pos.z < -120 && c.pos.z > -190 ? 2 : 0, 36); if (!c.grounded) { inp.x = 0; inp.y = 1; } },
};

// ---------------------------------------------------------------------------------------------
const generalLee = {
  id: 'general_lee', title: 'Yee-Haw', film: 'The Dukes of Hazzard', year: 1979, tier: 1, pay: 2300, mode: 'drive', art: 'bd_georgia', music: 'western',
  role: 'Jump driver — orange ’69 Charger, number 01',
  brief: 'Dirt ramp, three patrol cars parked nose to tail, and one very heavy orange Charger. She flies like a brick with the nose down, so keep your foot in to hold it up.',
  tips: ['Flat out to the ramp — the further you fly, the more you earn.', 'The Charger is nose-heavy: <b>hold W in the air</b> to keep the front up.', 'Land level, on all four wheels. Nose first and the car folds in half.'],
  controls: CTL.drive, intro: { r: 10, h: 2.5 },
  assets: { models: ['general_lee', 'police_car', 'pine_tree', 'oak_tree'], tex: ['bd_georgia', 'tx_grass', 'tx_dirt'] },
  build(s) {
    s.env('golden', { backdrop: 'bd_georgia', look: 'golden', fog: 0.0013 });
    s.ground({ tex: 'tx_dirt', tile: 9, color: 0xd0a070 });
    s.slope({ x: 0, w: 8, z0: -250, z1: -264, y0: 0, y1: 2.0, curve: 1.45, mat: { tex: 'tx_dirt', rep: 0.15, color: 0xb98a5a } });
    for (let i = 0; i < 3; i++) s.put('police_car', { x: 0, z: -272 - i * 6.2, ry: Math.PI / 2 + (i % 2 ? 0.08 : -0.06), solid: true, sol: { msg: 'Landed on the patrol cars', hardK: 0.2 } });
    trees(s, 'pine_tree', 50, 60, -560, 14, 120, { h: [9, 15], seedv: 3 }); trees(s, 'oak_tree', 20, 60, -560, 16, 90, { h: [7, 11], seedv: 8 });
    for (let d = 20; d <= 60; d += 10) { const z = -264 - d; s.line({ x: 0, z, w: 14, d: 0.25, color: 0xffffff, glow: 0.7 }); sign(s, ftOf(d) + ' FT', { x: 8.5, y: 1.2, z, w: 3.4, ry: -0.5, bg: '#222', size: 70 }); }
    s.crew({ x: 8, z: 18, ry: 1.1 }); s.crew({ x: -9, z: -300, ry: -2.0, people: false });
    const car = s.car = new Drive(s, { kind: 'muscle', model: 'general_lee', x: 0, z: 40, nose: -0.62, air: 0.46, pitchTol: 0.45 }); car.dustColor = [0.75, 0.55, 0.38]; car.k.dusty = true;
    // the law arrives just too late: a patrol car chases you down the track and skids to a stop at the ramp
    const mv = new Movers(s, car); let bar = null;
    const cop = mv.add({ model: 'police_car', x: 2.2, z: 70, v: 0, nearMiss: false, solid: false, swerve: 0, ai: (e, dt) => { if (!s.started) return; const want = e.z < -232 ? 0 : Math.max(8, car.v * 0.93); e.v += (want - e.v) * Math.min(1, dt * (want ? 1.4 : 3.5)); if (e.z < -225 && e.v > 3 && Math.random() < 0.6) s.fx.dust(e.m.position, 2, { color: [0.75, 0.55, 0.38], size: 2 }); } });
    { const r = s.mat({ color: 0xff2020, emissive: 0xff1010, emI: 3 }), b = s.mat({ color: 0x2040ff, emissive: 0x2040ff, emI: 3 }); bar = [s.box({ parent: cop.m, x: -0.35, y: 1.45, z: 0, w: 0.5, h: 0.14, d: 0.25, mat: r, cast: false }), s.box({ parent: cop.m, x: 0.35, y: 1.45, z: 0, w: 0.5, h: 0.14, d: 0.25, mat: b, cast: false })]; s.onUpdate((dt, t) => { const on = Math.floor(t * 6) % 2; bar[0].visible = !!on; bar[1].visible = !on; }); }
    let jumped = false, landed = false; s.objective('Flat out! Hold W in the air');
    car.onAir = t => { if (t.z < -255 && !jumped) { jumped = true; s.slowmo(0.3, 1.9); s.audio.tune(); s.audio.say('Yee-haw!', { rate: 1.1, pitch: 1.2 }); s.audio.sting(); s.fx.dust(car.pos, 16, { color: car.dustColor, size: 2.6, spread: 2.5, up: 3 }); } };
    car.onLand = i => { if (jumped && !landed) { landed = true; s.fx.dust(car.pos, 30, { color: car.dustColor, size: 3.2, spread: 3.5, up: 4 }); s.engine.addShake(1.1); s.after(0.6, () => s.audio.cheer()); const ft = ftOf(i.dist); s.rate('Distance (' + ft + ' ft)', clamp((ft - 60) / 85), 1.5); s.rate('Landing', i.clean, 1.5); s.msg(ft + ' FEET', 'good'); s.objective('Bring her home'); } };
    s.onUpdate(() => { s.hud.readout('spd', 'MPH', Math.round(car.mph)); if (landed && (car.pos.z < -420 || Math.abs(car.v) < 1) && !s.ended) s.wrap(1.2); });
  },
  bot(s, inp) { const c = s.car; botDrive(c, inp, 0, 34); if (!c.grounded) { inp.x = 0; inp.y = c.pitch < 0.1 ? 1 : 0; } },
};

// ---------------------------------------------------------------------------------------------
const bttf = {
  id: 'bttf', title: '1.21 Gigawatts', film: 'Back to the Future', year: 1985, tier: 1, pay: 2600, mode: 'drive', art: 'bd_smalltown', music: 'synth',
  role: 'Precision driver — stainless steel DeLorean, one bolt of lightning',
  brief: 'Lightning hits the clock tower at exactly 10:04. You cross the wire at precisely eighty-eight miles per hour at that instant. Not before. Not after. No pressure.',
  tips: ['The bolt strikes when the countdown hits <b>zero</b>. Cross the wire on that beat.', 'You must be doing <b>88 mph</b> at the wire — not 80, not 95.', 'Watch the ARRIVAL readout: hold back or floor it to bring it to 0.0.'],
  controls: CTL.drive, intro: { r: 9, h: 2.2 },
  assets: { models: ['delorean', 'street_lamp', 'clock_tower_face', 'sedan_grey', 'wagon_brown'], tex: ['bd_smalltown', 'tx_asphalt', 'tx_fac_old', 'tx_concrete', 'tx_roof', 'tx_brick'] },
  build(s) {
    s.env('storm', { backdrop: 'bd_smalltown', look: 'night', fog: 0.0035, amb: 0.75, sunI: 1.2, lookOver: { bloom: 0.9 } });
    s.ground({ tex: 'tx_asphalt', tile: 10, color: 0x666666, rough: 0.5 });
    street(s, { z0: 60, z1: -700, width: 13, lanes: 2, fac: ['tx_fac_old', 'tx_brick'], height: [9, 16], lit: 0.5, lamps: 40 });
    s.building({ x: 0, z: -725, w: 46, d: 30, h: 22, fac: 'tx_fac_old' }); s.building({ x: 0, z: -722, w: 12, d: 12, h: 36, fac: 'tx_fac_old' }); s.put('clock_tower_face', { x: 0, y: 26, z: -715.5, height: 7 });
    const WZ = -560, T = 21; // the wire
    for (const x of [-7.2, 7.2]) s.cyl({ x, z: WZ, r: 0.12, h: 6.5, color: 0x333333 }); const wire = s.box({ x: 0, y: 5.6, z: WZ, w: 14.4, h: 0.05, d: 0.05, mat: s.mat({ color: 0x222222 }), cast: false });
    s.line({ x: 0, z: WZ, w: 13, d: 0.6, color: 0x60c8ff, glow: 2 }); s.line({ x: 0, z: 22, w: 13, d: 0.5, color: 0xffffff, glow: 0.8 });
    for (const [x, z] of [[-4.6, -120], [4.6, -260], [-4.6, -400]]) s.put(x < 0 ? 'sedan_grey' : 'wagon_brown', { x, z, solid: true, sol: { msg: 'Hit a parked car' } });
    s.crew({ x: 5.5, z: 34, ry: 0.9, light: 200 }); rain(s, 5);
    const car = s.car = new Drive(s, { kind: 'car', model: 'delorean', x: 0, z: 26, top: 50, accel: 10.5 });
    let done = false, pre = 0; const bolt = new THREE.Group(); s.scene.add(bolt); bolt.visible = false;
    { let p = V3(0, 180, -722); const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 9, 14) }); for (let i = 0; i < 16; i++) { const n = V3(i === 15 ? 0 : rnd(-9, 9), 180 - (i + 1) * 9, -722 + rnd(-3, 3)); const g = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, p.distanceTo(n), 5), m); g.position.copy(p).lerp(n, 0.5); g.lookAt(n); g.rotateX(Math.PI / 2); bolt.add(g); p = n; } const w2 = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 165, 5), m); w2.rotation.x = Math.PI / 2 - 0.19; w2.position.set(0, 21, -640); bolt.add(w2); }
    s.objective('Cross the wire at 88 mph as the lightning strikes');
    s.onUpdate((dt, t) => {
      if (!s.started) return; const tt = t - s.t0, left = T - tt, dist = car.pos.z - WZ, eta = dist / Math.max(car.v, 3);
      if (!done) { s.hud.readout('cd', 'Lightning in', Math.max(0, left).toFixed(1), left < 5 ? 'warn' : ''); if (car.v > 12) { const e = eta - left; s.hud.readout('eta', e > 0 ? 'Arrival: late' : 'Arrival: early', (e > 0 ? '+' : '') + e.toFixed(1), Math.abs(e) < 0.5 ? 'ok' : 'warn'); } }
      s.hud.readout('spd', 'MPH', Math.round(car.mph), Math.abs(car.mph - 88) < 3 ? 'ok' : '');
      if (car.mph > 84 && !done && Math.random() < 0.7) s.fx.sparks(V3(car.pos.x + rnd(-1, 1), car.pos.y + rnd(0.2, 1.2), car.pos.z + rnd(-2, 2)), 2, { speed: 3, color: [0.5, 0.8, 1] });
      pre -= dt; if (pre < 0 && left > 1.5) { pre = rnd(2.5, 6); s.engine.flash(0.25); s.after(rnd(0.6, 1.6), () => s.audio.thunder()); }
      if (left <= 0 && !bolt.visible && !bolt.userData.used) { bolt.visible = true; bolt.userData.used = true; s.engine.flash(1); s.audio.thunder(); s.audio.explosion(0.6); s.engine.addShake(1); s.after(0.3, () => { bolt.visible = false; }); if (!done && dist > 60) { s.flub('Missed the lightning', { penalty: 0.35, advice: `You were ${Math.round(dist)} m short when the bolt hit. Watch ARRIVAL: brake while it says early, floor it while it says late — get it to 0.0.` }); } }
      if (!done && dist <= 0) {
        done = true; const err = left, v = car.mph;
        if (Math.abs(err) < 1.6 && v > 84 && v < 96) {
          s.rate('Timing (' + (err > 0 ? 'early ' : 'late ') + Math.abs(err).toFixed(2) + 's)', near(Math.abs(err), 0, 0.3, 1.8), 2); s.rate('88 mph (' + v.toFixed(0) + ')', near(v, 88, 2.5, 10), 1.5);
          s.engine.flash(1.2); s.audio.explosion(0.8); s.audio.thunder(); s.fx.light(car.pos, 0x80c0ff, 300, 0.8, 60); car.obj.visible = false; car.frozen = true; car.silent = true; s.audio.set('veh', 'engine', 0, 0);
          const fp = V3(); let n = 0; s.onUpdate(() => { if (n++ < 150) for (const x of [-0.8, 0.8]) for (let k = 0; k < 3; k++) s.fx.flame(fp.set(car.pos.x + x, 0.05, WZ - rnd(0, 46)), 0.6); }); s.msg('88 MPH!', 'huge good'); s.wrap(2.6, 'Great Scott!');
        } else {
          s.rate('Timing (' + Math.abs(err).toFixed(1) + 's off)', near(Math.abs(err), 0, 0.3, 3), 2); s.rate('88 mph (' + v.toFixed(0) + ')', near(v, 88, 2.5, 15), 1.5);
          if (v <= 84) s.flub(`Only ${v.toFixed(0)} mph at the wire`, { penalty: 0.3, advice: 'Not enough speed for time travel. You need 88 at the wire — keep your foot down earlier.' });
          else if (v >= 96) s.flub(`${v.toFixed(0)} mph — too hot`, { penalty: 0.3, advice: 'Too fast — the hook would snap. Ease off so the needle sits on 88 as you cross.' });
          else if (Math.abs(err) >= 1.6) s.flub('Missed the lightning', { penalty: 0.3, advice: `The bolt was ${Math.abs(err).toFixed(1)} s ${err > 0 ? 'after' : 'before'} you crossed. Use the ARRIVAL readout to time it.` });
          s.msg('NO TIME TRAVEL', 'bad'); s.wrap(1.8, 'Well… the DeLorean is still in 1955.');
        }
      }
    });
  },
  bot(s, inp) { const c = s.car, left = 21 - (s.t - s.t0), dist = c.pos.z + 560; const tv = 39.45; botDrive(c, inp, 0, tv, 0.08); if (c.v < 5 && left > 17.7) inp.y = 0; else if (c.v > 30) { const e = dist / c.v - left; inp.y = c.v < tv - 0.3 || e > 0.05 ? 1 : c.v > tv + 0.25 ? -0.3 : 0.25; } },
};

// ---------------------------------------------------------------------------------------------
const hz = z => { const d = -z - 40; if (d <= 0) return 0; const b = Math.floor(d / 105), r = d - b * 105; return -(b * 12) - (r < 22 ? 0 : (r - 22) / 83 * 12); };
const bullitt = {
  id: 'bullitt', title: 'San Francisco Airtime', film: 'Bullitt', year: 1968, tier: 2, pay: 4600, mode: 'drive', art: 'bd_sf', music: 'chase',
  role: 'Doubling the Lieutenant — Highland Green Mustang GT 390',
  brief: 'Stay on that black Charger down the hills. Every cross street is a launch pad — I want daylight under all four wheels, and I want you still pointing the right way when you land.',
  tips: ['Keep the <b>black Charger</b> within sight — lose him and the scene is dead.', 'Each crest throws you in the air. Stay straight and off the brakes over the top.', 'Parked cars and traffic will end your day. Thread the gaps.'],
  controls: CTL.drive, intro: { r: 10, h: 2.5 },
  assets: { models: ['mustang_green', 'charger_black', 'street_lamp', ...TRAFFIC], tex: ['bd_sf', 'tx_asphalt', 'tx_fac_sf', 'tx_concrete', 'tx_roof'] },
  build(s) {
    s.env('day', { backdrop: 'bd_sf', look: 'warm60s', fog: 0.0016, hz: 0.46, bdFollow: 0.3 });
    s.ground({ tex: 'tx_asphalt', y: -150, base: false, color: 0x8899aa }); s.course.kill = -500;
    s.terrain({ x0: -44, x1: 44, z0: 80, z1: -1260, res: 2.6, fn: (x, z) => hz(z), tex: 'tx_asphalt', tile: 9 });
    street(s, { z0: 80, z1: -1260, width: 15, lanes: 4, fac: ['tx_fac_sf'], height: [16, 22], yfn: hz, lamps: 0, bwidth: [14, 22], tints: [0xffffff, 0xe8d8c0, 0xcfe0e8, 0xf0d0c8, 0xd8e8c8], double: true });
    srand(21); for (let z = -70; z > -1200; z -= 13) { if (sr() < 0.55) continue; const sd = sr() < 0.5 ? -1 : 1; const d = (-z - 40) % 105; if (d < 26) continue; s.put(TRAFFIC[Math.floor(sr(TRAFFIC.length))], { x: sd * 6.5, z, y: hz(z), rx: sd * 0, solid: true, sol: { msg: 'Ploughed into a parked car' } }).rotation.x = -Math.atan(12 / 83) * 1; }
    s.crew({ x: 6.6, z: 22, ry: 0.8 });
    const car = s.car = new Drive(s, { kind: 'muscle', model: 'mustang_green', x: -1.8, z: 30, hard: 12, pitchTol: 0.75 });
    const mv = new Movers(s, car); mv.nearPay = 120;
    const ch = s.rival = mv.add({ model: 'charger_black', z: -6, path: (z, e) => 1.8 + Math.sin(z * 0.017) * 2.6, v: 0, nearMiss: false, hardK: 3, ai: (e, dt) => { if (!s.started) return; const gap = car.pos.z - e.z; const want = gap > 140 ? 10 : gap > 75 ? 24 : gap < 14 ? 42 : 33.5; e.v += (want - e.v) * Math.min(1, dt * 1.2); } });
    traffic(s, mv, { lanes: [[-1.9, 1], [1.9, -1], [4.0, -1]], n: 9, z0: -160, z1: -1150, speed: [9, 13], zEnd: -1200, recycle: false, msg: 'Collected the traffic' });
    let close = 0, tot = 0, lands = [], fin = false; s.rate('Clean driving', 1);
    car.onLand = i => { if (i.airTime > 0.35) { lands.push(i.clean); s.bonus('Airtime', Math.round(i.airTime * 220)); if (i.airTime > 0.8) s.msg('BIG AIR', 'small'); } };
    car.onHit = (sol, imp) => s.rate('Clean driving', (s.scores.get('Clean driving')?.v ?? 1) - 0.2);
    s.objective('Stay on the Charger');
    s.onUpdate(dt => {
      if (!s.started || s.ended) return; const gap = car.pos.z - ch.z; tot += dt; if (gap < 55 && gap > -10) close += dt;
      s.hud.readout('gap', 'Gap (m)', Math.max(0, Math.round(gap)), gap > 80 ? 'warn' : gap < 45 ? 'ok' : ''); s.hud.readout('spd', 'MPH', Math.round(car.mph));
      if (gap > 150 && !s.lost) { s.lost = true; s.flub('Lost the Charger', { penalty: 0.2, advice: 'Stay within 50 m of the Charger — take the straight line over the crests and only brake for traffic.' }); }
      if (gap < 100) s.lost = false;
      if (car.pos.z < -1130 && !fin) { fin = true; s.rate('On his tail', clamp(close / tot / 0.85), 2); s.rate('Landings', lands.length ? lands.reduce((a, b) => a + b, 0) / lands.length : 0.5, 1.2); s.wrap(1.5); }
    });
  },
  bot(s, inp) { const c = s.car; let tx = -1.9; for (const sol of s.course.solids) { if (sol.dead || sol.type === 'trigger') continue; const dz = c.pos.z - sol.z1; if (dz > 0 && dz < 42 && sol.x0 < tx + 1.4 && sol.x1 > tx - 1.4) tx = sol.x1 + 1.6 < 5 ? sol.x1 + 1.6 : sol.x0 - 1.6; } botDrive(c, inp, tx, 33, 0.07); if (!c.grounded) inp.x = 0; },
};

// ---------------------------------------------------------------------------------------------
const blues = {
  id: 'blues_brothers', title: 'Mission from God', film: 'The Blues Brothers', year: 1980, tier: 2, pay: 4000, mode: 'drive', art: 'bd_chicago', music: 'chase',
  role: 'Driving the Bluesmobile — cop motor, cop tyres, cop suspension',
  brief: 'The drawbridge is going up and half the Illinois State Police are behind you. The longer you leave it the steeper it gets — and the better it looks. How much nerve have you got?',
  tips: ['The bridge keeps rising. <b>Steeper = more airtime = more money</b>… and a harder landing.', 'Smash the barrier, stay in the middle of the deck.', 'She is heavy: <b>hold W in the air</b> to keep the nose up for the landing.'],
  controls: CTL.drive, intro: { r: 10, h: 2.5 },
  assets: { models: ['bluesmobile', 'police_car', 'street_lamp'], tex: ['bd_chicago', 'tx_asphalt', 'tx_fac_office', 'tx_fac_nyc', 'tx_concrete', 'tx_roof', 'tx_metal'] },
  build(s) {
    s.env('overcast', { backdrop: 'bd_chicago', look: 'bleach', fog: 0.0016 });
    s.ground({ tex: 'tx_concrete', y: -0.2, base: false, color: 0x777777 });
    s.terrain({ x0: -260, x1: 260, z0: 100, z1: -800, res: 6, fn: (x, z) => -9 * smooth(0, 6, Math.min(z + 366, -296 - z)), tex: 'tx_concrete', tile: 12 }); s.water({ y: -5, color: 0x3a4a44, w: 520, d: 66, z: -331, size: 520 });
    street(s, { z0: 100, z1: -292, width: 14, lanes: 4, fac: ['tx_fac_office', 'tx_fac_nyc'], height: [18, 46], lamps: 38 }); street(s, { z0: -370, z1: -800, width: 14, lanes: 4, fac: ['tx_fac_office', 'tx_fac_nyc'], height: [18, 46], lamps: 38, seedv: 9 });
    const L = 30, pA = -298, pB = -364, st = { th: 0 }; const steel = s.mat({ tex: 'tx_metal', color: 0x6a7480, metal: 0.5, rough: 0.6 });
    const mk = (pz, dir) => { const g = new THREE.Group(); g.position.set(0, 0, pz); s.scene.add(g); s.box({ parent: g, x: 0, y: -0.9, z: dir * L / 2, w: 14, h: 0.9, d: L, mat: steel, tile: 5 }); for (const sx of [-7.3, 7.3]) s.box({ parent: g, x: sx, y: 0, z: dir * L / 2, w: 0.4, h: 2.2, d: L, mat: steel }); return g; };
    const gA = mk(pA, -1), gB = mk(pB, 1);
    s.course.addPiece({ x0: -7, x1: 7, z0: pA - L, z1: pA, fn: (x, z) => (pA - z) * Math.tan(st.th), step: 2.5 }); s.course.addPiece({ x0: -7, x1: 7, z0: pB, z1: pB + L, fn: (x, z) => (z - pB) * Math.tan(st.th), step: 2.5 });
    for (const x of [-3.5, 3.5]) s.box({ x, y: 0.9, z: -286, w: 6.6, h: 0.18, d: 0.18, mat: s.mat({ color: 0xdd2222 }), solid: 'break', sol: { soft: true, debris: 0xdd2222 } });
    s.crew({ x: 6.2, z: 30, ry: 0.9 });
    const car = s.car = new Drive(s, { kind: 'muscle', model: 'bluesmobile', x: 0, z: 40, hard: 12.5, nose: -0.42, air: 0.5, pitchTol: 0.6, top: 50 });
    const mv = new Movers(s, car); for (let i = 0; i < 3; i++) mv.add({ model: 'police_car', x: (i - 1) * 3.6, z: 62 + i * 7, v: 0, nearMiss: false, solid: false, ai: (e, dt) => { if (!s.started) return; const want = e.z < -265 ? 0 : Math.max(10, car.v * (0.9 - i * 0.03)); e.v += (want - e.v) * Math.min(1, dt * (want ? 1.5 : 4)); } });
    let jumped = false, landed = false, thTake = 0; s.objective('Jump the rising bridge');
    car.onAir = t => { if (t.z < pA - 12 && !jumped) { jumped = true; thTake = st.th; s.rate('Nerve (bridge at ' + Math.round(st.th * 57.3) + '°)', clamp(st.th / 0.27), 1.4); s.slowmo(0.35, 1.5); } };
    car.onLand = i => { if (car.pos.y < -3) { s.fx.splash(car.pos, 80, 2.5); s.audio.splash(); car.crash('Dropped it in the Chicago River', { injury: 0.55 }); return true; } if (jumped && !landed && car.pos.z < pB + L) { /* touched the far leaf */ } if (jumped && !landed && i.airTime > 0.5) { landed = true; s.rate('Landing', i.clean, 1.6); s.bonus('Hang time ' + i.airTime.toFixed(1) + 's', Math.round(i.airTime * 260)); s.msg(i.airTime.toFixed(1) + ' SEC AIR', 'good'); } };
    s.onUpdate((dt, t) => { if (s.started) st.th = clamp((t - s.t0 - 2.5) * 0.03, 0, 0.36); gA.rotation.x = st.th; gB.rotation.x = -st.th; s.hud.readout('br', 'Bridge angle', Math.round(st.th * 57.3) + '°', st.th > 0.3 ? 'warn' : ''); s.hud.readout('spd', 'MPH', Math.round(car.mph)); if (landed && (car.pos.z < -520 || Math.abs(car.v) < 1) && !s.ended) s.wrap(1.2); });
  },
  bot(s, inp) { const c = s.car; botDrive(c, inp, 0, (s.t - s.t0) < 3.2 ? 0 : 31); if (!c.grounded) { inp.x = 0; inp.y = c.pitch < 0.05 ? 1 : 0; } },
};

// ---------------------------------------------------------------------------------------------
const rcx = z => Math.sin(z * 0.011) * 24 + Math.sin(z * 0.027 + 1) * 7;
const boat = {
  id: 'boat_jump', title: 'Bayou Record', film: 'Live and Let Die', year: 1973, tier: 2, pay: 3800, mode: 'drive', art: 'bd_bayou', music: 'spy',
  role: 'Doubling 007 — Glastron speedboat, Louisiana bayou',
  brief: 'Follow the bayou flat out and take the levee road at full throttle. The world record is one hundred and ten feet. There is a Sheriff parked on that road, so do keep it tidy.',
  tips: ['Boats slide — turn <b>early</b> and stay off the banks.', 'Hit the earth ramp in the centre of the river, throttle wide open.', 'Match the record: <b>110 feet</b>. Land flat and keep going.'],
  controls: `${K('W')} throttle &nbsp; ${K('A')}${K('D')} steer &nbsp; ${K('S')} ease off`, intro: { r: 9, h: 2.2 },
  assets: { models: ['speedboat', 'police_car', 'oak_tree', 'ch_spy'], tex: ['bd_bayou', 'tx_grass', 'tx_dirt', 'tx_asphalt'] },
  build(s) {
    s.env('day', { backdrop: 'bd_bayou', look: 'warm60s', fog: 0.002 });
    const W = 15, RZ = -690; const bank = (x, z) => { const d = Math.abs(x - rcx(z)) - W; return z < RZ + 2 && z > RZ - 16 ? 1.7 : (d < 0 ? -1.2 : Math.min(2.2, d * 0.35) + Math.sin(x * 0.2 + z * 0.13) * 0.15); };
    s.terrain({ x0: -120, x1: 120, z0: 90, z1: -1000, res: 3.5, fn: bank, tex: "tx_grass", tile: 5, base: false }); s.water({ y: 0, color: 0x35503a, opacity: 0.9 });
    const rx = rcx(RZ - 6); s.slope({ x: rx, w: 9, z0: RZ + 14, z1: RZ, y0: -0.4, y1: 1.9, curve: 1.4, mat: { tex: 'tx_dirt', rep: 0.15 } });
    s.box({ x: 0, y: 1.72, z: RZ - 7, w: 240, h: 0.1, d: 9, mat: { tex: 'tx_asphalt' }, cast: false }); s.course.addPiece({ x0: -120, x1: 120, z0: RZ - 16, z1: RZ, fn: () => 1.8, step: 0.5 });
    s.put('police_car', { x: rx + 9, y: 1.8, z: RZ - 7, ry: Math.PI / 2, solid: true, sol: { msg: 'Landed on the Sheriff' } }); s.put('police_car', { x: rx - 15, y: 1.8, z: RZ - 6.5, ry: -Math.PI / 2 + 0.3 });
    s.forest('tree:cypress', 420, (r) => { const z = 80 - r() * 1060, sd = r() < .5 ? -1 : 1; return [rcx(z) + sd * (W + 4 + Math.pow(r(), 1.6) * 70), z]; }, { h: [9, 17], seedv: 12 });
    s.crew({ x: rcx(40) + W + 4, y: 1.4, z: 40, ry: 1.3 });
    const b = s.car = new Drive(s, { kind: 'boat', model: 'speedboat', driver: 'ch_spy', driverPos: [-0.35, -0.42, 0.5], x: rcx(50), z: 50, y: 0, cam: { dist: 9, height: 3.2 }, pitchTol: 0.7, hard: 14 }); b.gravK = 1; b.k.handbrake = false;
    let jumped = false, landed = false, off = 0, tot = 0; s.objective('Follow the bayou to the levee');
    b.onAir = t => { if (t.z < RZ + 6 && !jumped) { jumped = true; s.slowmo(0.4, 1.3); } };
    b.onLand = i => { if (jumped && !landed && i.airTime > 0.5) { landed = true; const ft = ftOf(i.dist); s.rate('Jump (' + ft + ' ft)', near(ft, 112, 10, 60), 1.6); s.rate('Landing', i.clean, 1.2); s.msg(ft + ' FEET', 'good'); s.fx.splash(b.pos, 70, 2); s.audio.splash(); } };
    s.onUpdate(dt => {
      if (!s.started || s.ended) return; const d = Math.abs(b.pos.x - rcx(b.pos.z)) - W + 1; tot += dt;
      if (b.grounded && b.pos.y < 0.5 && d > 0) { off += dt; b.vel.multiplyScalar(1 - Math.min(0.9, dt * 3)); s.engine.addShake(0.15); if (d > 3.5) { s.flub('Beached it on the bank', { penalty: 0.15, advice: 'Boats slide wide. Start every turn early and stay in the middle of the channel.' }); const cx = rcx(b.pos.z); b.pos.x += Math.sign(cx - b.pos.x) * 1.2; b.v *= 0.6; b.heading = b.heading * 0.6; } }
      s.hud.readout('spd', 'MPH', Math.round(b.mph)); if (landed && b.pos.z < RZ - 150) { s.rate('Clean line', clamp(1 - off / 2.5)); s.wrap(1.2); }
    });
  },
  bot(s, inp) { const b = s.car, z = b.pos.z - 26; botDrive(b, inp, z < -660 && z > -720 ? rcx(-696) : rcx(z), b.pos.z < -640 ? 23.5 : 27, 0.06); if (!b.grounded) inp.x = 0; },
};

// ---------------------------------------------------------------------------------------------
const french = {
  id: 'french_connection', title: 'Under the El', film: 'The French Connection', year: 1971, tier: 2, pay: 4400, mode: 'drive', art: 'bd_brooklyn', music: 'chase',
  role: 'Doubling Popeye — commandeered Pontiac LeMans, Brooklyn',
  brief: 'The hitman is on the train overhead. You are underneath, in traffic, between the pillars, with no permits and no closed streets. Keep up with that train.',
  tips: ['Stay level with the <b>elevated train</b> above you.', 'The steel pillars do not move. The traffic does — some of it towards you.', 'Scrapes cost time; a head-on ends the shoot.'],
  controls: CTL.drive, intro: { r: 9, h: 2.2 },
  assets: { models: ['lemans', 'street_lamp', 'fruit_cart', 'cardboard_boxes', ...TRAFFIC], tex: ['bd_brooklyn', 'tx_asphalt', 'tx_fac_nyc', 'tx_brick', 'tx_concrete', 'tx_roof', 'tx_metal'] },
  build(s) {
    s.env('overcast', { backdrop: 'bd_brooklyn', look: 'bleach', fog: 0.0024 });
    s.ground({ tex: 'tx_asphalt', tile: 10, color: 0x777777 });
    const Z1 = -1150; street(s, { z0: 80, z1: Z1 - 80, width: 17, lanes: 4, fac: ['tx_fac_nyc', 'tx_brick'], height: [12, 22], lamps: 0, double: true });
    const steel = s.mat({ tex: 'tx_metal', color: 0x3d4a44, metal: 0.4, rough: 0.7 });
    s.box({ x: 0, y: 7.2, z: (80 + Z1 - 80) / 2, w: 10.5, h: 0.9, d: 80 - Z1 + 80, mat: steel, tile: 4 });
    for (let z = 60; z > Z1 - 60; z -= 22) for (const x of [-4.4, 4.4]) { s.box({ x, y: 0, z, w: 0.55, h: 7.2, d: 0.55, mat: steel, solid: true, sol: { msg: 'Hit an El pillar head-on', hardK: 0.75 } }); }
    for (const [x, z] of [[6.6, -210], [-6.8, -520], [6.6, -830]]) s.put('fruit_cart', { x, z, height: 2.4, ry: x > 0 ? -1.57 : 1.57, solid: 'break', sol: { debris: 0xff9020, slow: 0.93, on: () => s.bonus('Fruit cart', 100) } });
    for (const [x, z] of [[-6.7, -330], [6.7, -660], [-6.7, -960]]) s.put('cardboard_boxes', { x, z, height: 2, solid: 'break', sol: { soft: true, debris: 0xb08a55 } });
    // the train
    const tr = new THREE.Group(), tm = s.mat({ tex: 'tx_metal', color: 0x8a8f86, metal: 0.5, rough: 0.5 }); for (let i = 0; i < 4; i++) { s.box({ parent: tr, x: 0, y: 0, z: i * 16.4, w: 2.9, h: 3.1, d: 15.8, mat: tm, tile: 3 }); s.box({ parent: tr, x: 0, y: 1.5, z: i * 16.4, w: 2.96, h: 0.9, d: 14.5, mat: s.mat({ color: 0x151a1e, rough: 0.2, metal: 0.8 }), cast: false }); } tr.userData.size = V3(2.9, 3.1, 16);
    s.crew({ x: 7.6, z: 26, ry: 0.9 });
    const car = s.car = new Drive(s, { kind: 'muscle', model: 'lemans', x: -2.2, z: 30, crashV: 14 });
    const mv = new Movers(s, car); const train = mv.add({ obj: tr, x: 0, y: 8.1, z: 10, v: 0, solid: false, nearMiss: false, ai: (e, dt) => { if (s.started) { const gap = car.pos.z - e.z; e.v += ((gap > 160 ? 6 : 19) - e.v) * Math.min(1, dt * 0.5); } } });
    traffic(s, mv, { lanes: [[-6.4, 1], [-2.2, 1], [2.2, -1], [6.4, -1]], n: 13, z0: -70, z1: Z1, speed: [9, 13], ahead: [200, 420], zEnd: Z1 - 40 });
    s.rate('Bodywork', 1); car.onHit = () => s.rate('Bodywork', (s.scores.get('Bodywork')?.v ?? 1) - 0.14); s.objective('Keep up with the train');
    s.onUpdate(() => { if (!s.started || s.ended) return; const gap = car.pos.z - train.z; s.hud.readout('gap', gap > 0 ? 'Behind train (m)' : 'Ahead (m)', Math.abs(Math.round(gap)), gap > 60 ? 'warn' : 'ok'); s.hud.readout('spd', 'MPH', Math.round(car.mph)); if (gap > 200 && !s.lost) { s.lost = true; s.flub('The train got away', { penalty: 0.2, advice: 'Stay under the train. Change lanes between the pillar rows and keep the speed up through the gaps.' }); } if (gap < 120) s.lost = false; if (car.pos.z < Z1) { s.rate('Kept up with the train', near(Math.max(0, gap), 0, 12, 150), 2); s.wrap(1.2); } });
  },
  bot(s, inp, B) {
    const c = s.car, z = c.pos.z; const ahead = L => { let d = 1e9; for (const sol of s.course.solids) { if (sol.dead || !sol.mover || (sol.vz || 0) > 0) continue; if (sol.x0 < L + 1.4 && sol.x1 > L - 1.4) { const dz = z - sol.z1; if (dz > -7 && dz < d) d = dz; } } return d; };
    const cur = B.lane ?? -2.2, other = cur === -2.2 ? -6.4 : -2.2; const pil = ((60 - z) % 22 + 22) % 22; // metres past the last pillar row
    if (!B.chg && ahead(cur) < 50 && ahead(other) > ahead(cur) + 25 && pil > 1 && pil < 4) { B.lane = other; B.chg = 1; } if (B.chg && Math.abs(c.pos.x - (B.lane ?? cur)) < 0.5) B.chg = 0;
    const L = B.lane ?? cur; botDrive(c, inp, L, ahead(L) < 14 && !B.chg ? 10 : 26, 0.16);
  },
};

// What the player is asked to do, in plain numbers, plus the film's signature camera angles for the replay.
const EXTRA = {
  italian_job: { goals: { shot: ['Drive along the roof and hit the wooden ramp at 55–70 mph', 'Jump the gap and land on the far roof', 'Brake and stop inside the green box'], cut: ['You drop into the street (too slow at the ramp)'], stars: ['Take-off speed', 'Landing', 'Stopping on the mark', 'Missing the skylights'] }, cine: ['low', 'wide', 'front'] },
  great_escape: { goals: { shot: ['Ride through the gap in the first fence', 'Be doing 50+ mph when you hit the grass bank', 'Clear the barbed wire and land, then ride on'], cut: ['You hit the wire (too slow at the bank)'], stars: ['Speed at the bank', 'Landing', 'Time'] }, cine: ['wide', 'low', 'track'] },
  smokey: { goals: { shot: ['Drive straight down the dirt road, flat out', 'Smash the BRIDGE OUT barrier at 70+ mph', 'Fly the river and land on the far road'], cut: ['You land in the river (too slow)'], stars: ['Take-off speed', 'Landing', 'Not hitting anything'] }, cine: [{ type: 'front', pos: [-30, 2.2, -351], fov: 36, lookUp: 0.4, speed: 0.4 }, 'low', { type: 'wide', speed: 0.8 }] },
  general_lee: { freeze: { line: 'Now most folks would have called it a day right there. Not this one.', shot: 1, at: 0.5 }, liveShots: ['low', 'track'], goals: { shot: ['Floor it down the dirt track to the ramp', 'Hold W in the air to keep the heavy nose up', 'Land on all four wheels past the patrol cars'], cut: ['You land nose-first and fold the car'], stars: ['Distance (feet)', 'Landing'] }, cine: ['wide', 'low', 'track'] },
  bttf: { goals: { shot: ['Wait, then drive at the wire so you arrive as the countdown hits 0', 'Be doing 88 mph (85–95) as you cross the wire — within 1.5 s of the bolt', 'Use ARRIVAL: early = slow down, late = speed up'], cut: ['You crash into a parked car'], stars: ['Timing to the lightning', 'Exactly 88 mph'] }, cine: ['front', 'low', 'wide'], liveShot: 'front' },
  bullitt: { goals: { shot: ['Chase the black Charger down the San Francisco hills', 'Stay within 50 m of it (GAP readout)', 'Fly the crests and land straight — avoid traffic'], cut: ['You wreck the Mustang'], stars: ['Staying on his tail', 'Clean landings', 'Clean driving'] }, cine: ['front', 'low', 'track'] },
  blues_brothers: { goals: { shot: ['Drive at the drawbridge as it starts to rise', 'The longer you wait, the steeper it gets — and the more you earn', 'Hold W in the air and land on the far side'], cut: ['You drop into the river'], stars: ['Nerve (bridge angle)', 'Landing'] }, cine: ['wide', 'low', 'front'] },
  boat_jump: { goals: { shot: ['Follow the bayou channel at full throttle', 'Hit the earth ramp in the middle of the river', 'Jump the levee road — the record is 110 feet'], cut: ['You crash into the Sheriff'], stars: ['Jump distance vs the record', 'Landing', 'Staying off the banks'] }, cine: ['wide', 'low', 'track'] },
  french_connection: { goals: { shot: ['Drive under the elevated railway, chasing the train above', 'Weave through the traffic and between the steel pillars', 'Stay level with the train to the end of the line'], cut: ['You hit a pillar or a car head-on'], stars: ['Keeping up with the train', 'Bodywork'] }, cine: ['track', 'front', 'rear'] },
};
export default [italian, greatEscape, smokey, generalLee, bttf, bullitt, blues, boat, french].map(d => Object.assign(d, EXTRA[d.id]));
