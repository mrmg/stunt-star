import * as THREE from 'three';
import { Fly } from '../modes/fly.js';
import { clamp, near, damp, V3, rnd, sr, srand, lerp } from '../world/stage.js';
import { K, CTL, sign } from './common.js';
import * as dress from '../world/dress.js';

const ftOf = m => Math.round(m * 3.281);
const avg = a => a.n ? a.s / a.n : 0, acc = (a, v, w = 1) => { a.s += v * w; a.n += w; };

// ---------------------------------------------------------------------------------------------
const octopussy = {
  id: 'octopussy', title: 'The Hangar Squeeze', film: 'Octopussy', year: 1983, tier: 4, pay: 14000, mode: 'fly', art: 'bd_jungle', music: 'spy',
  role: 'Micro-jet pilot with a heat-seeker on his tail',
  brief: 'Tiny jet, big missile. Stay down in the palms where it can\'t get a clean lock, then go straight through the hangar — the doors are closing, so you get one look at the gap. The missile takes the hangar. You do not.',
  tips: ['Stay <b>below the treetops</b> and on the <b>afterburner</b> — fly high or lazy and the missile closes.', 'Weave through the <b>gaps in the palm lines</b>. The trunks are solid.', `The far hangar doors are sliding shut. Hold ${K('SPACE')} to roll <b>knife-edge</b> and slip through the slot.`],
  controls: `${K('A')}${K('D')} bank &nbsp; ${K('W')} climb &nbsp; ${K('S')} dive &nbsp; ${K('SHIFT')} afterburner &nbsp; hold ${K('SPACE')} knife-edge`, intro: { r: 12, h: 2.5, up: 0.3 },
  assets: { models: ['acrostar', 'ww2_truck', 'camera_crew', 'film_light', 'director_chair'], tex: ['bd_jungle', 'tx_grass', 'tx_asphalt', 'tx_metal', 'tx_wood', 'tx_concrete', 'tx_roof'] },
  build(s) {
    // steamy Indian jungle strip: hazy low sun from the right, humid air thick enough to soften the far tree walls
    s.env('jungle', { backdrop: 'bd_jungle', look: 'jungle', fog: 0.0022, sun: [38, 55], sunCol: 0xffe6b4, sunI: 3.5, amb: 0.9, lookOver: { contrast: 1.12, sat: 1.05 } });
    s.ground({ tex: 'tx_grass', tile: 9, color: 0xa4ae84, vary: { lo: 0.7, hi: 1.05, patch: 0x9a8a58, amt: 0.45 } });
    const HZ = -2300, HL = 76, HW = 17, HH = 13, JZ = HZ + 330; // door plane, hangar length, half width, height, end of jungle
    s.road({ z0: 110, z1: -230, width: 14, lanes: 2 }); s.road({ z0: JZ + 40, z1: HZ - 420, width: 20, lanes: 2 });
    // palm lines with one gap each + huts
    srand(41); const gates = s.gates = []; let gx = 0; for (let z = -270; z > JZ + 30; z -= 150) { gx = clamp(gx + sr(-32, 32), -42, 42); gates.push({ z, x: gx }); }
    const pts = []; for (const g of gates) for (let x = -74; x <= 74; x += 5.2) if (Math.abs(x - g.x) > 13.5) pts.push([x + sr(-1.4, 1.4), g.z + sr(-5, 5)]);
    s.forest('tree:palm', pts.length, (r, i) => pts[i], { h: [14, 20], solid: true, msg: 'Clipped a palm tree' });
    s.forest('tree:palm', 260, r => [r(-74, 74), -40 - r() * (-JZ - 60)], { h: [3, 5.5], seedv: 9 });
    s.forest('tree:jungle', 520, r => { const sd = r() < 0.5 ? -1 : 1; return [sd * (82 + r() * 150), 100 - r() * (-JZ + 160)]; }, { h: [18, 30], seedv: 23 });
    s.forest('tree:palm', 90, r => { const sd = r() < 0.5 ? -1 : 1; return [sd * (60 + r() * 120), JZ - r() * 700]; }, { h: [12, 18], seedv: 31 });
    // dense canopy edge just outside the flying corridor, low jungle hills closing the horizon
    dress.treeLine(s, { x: -84, z0: 100, z1: JZ - 200, side: 1, depth: 14, step: 11, kinds: ['jungle', 'palm', 'jungle'], h: [18, 28], seed: 61 }); dress.treeLine(s, { x: 84, z0: 100, z1: JZ - 200, side: -1, depth: 14, step: 11, kinds: ['jungle', 'jungle', 'palm'], h: [18, 28], seed: 62 });
    dress.hills(s, { z: -1100, r: 1700, h: 150, depth: 400, color: 0x3a5a32, trees: 'jungle', nTrees: 160 });
    const thatch = { tex: 'tx_wood', color: 0xb99a5a }, wood = { tex: 'tx_wood', color: 0x8a6a48 };
    gates.forEach((g, i) => { if (i % 2) return; const nx = gates[i + 1]?.x ?? 0, hx = g.x + (g.x >= nx ? 1 : -1) * 24, hz = g.z - 55; s.box({ x: hx, y: 0, z: hz, w: 7, h: 3.2, d: 6, mat: wood, tile: 3, solid: true, sol: { msg: 'Flew into a village hut' } }); s.box({ x: hx, y: 3.2, z: hz, w: 8.4, h: 1.5, d: 7.4, mat: thatch, tile: 2, solid: true, sol: { msg: 'Flew into a village hut' } }); });
    // hangar: open near end, two sliding doors at the far end
    const tin = { tex: 'tx_metal', color: 0xa9b3a6, rough: 0.6 }, dark = { tex: 'tx_metal', color: 0x59625c, rough: 0.7 };
    for (const sd of [-1, 1]) { s.box({ x: sd * (HW + 0.75), y: 0, z: HZ + HL / 2, w: 1.5, h: HH, d: HL, mat: tin, tile: 8, solid: true, sol: { msg: 'Hit the hangar wall' } }); s.box({ x: sd * (HW + 10.5), y: 0, z: HZ - 0.6, w: 18, h: 0.5, d: 0.5, mat: dark, cast: false }); s.box({ x: sd * (HW + 10.5), y: HH, z: HZ - 0.6, w: 18, h: 0.6, d: 0.8, mat: dark }); s.box({ x: sd * (HW + 19.5), y: 0, z: HZ - 0.6, w: 0.6, h: HH, d: 0.8, mat: dark }); }
    s.box({ x: 0, y: HH, z: HZ + HL / 2, w: 2 * HW + 3, h: 1.6, d: HL, mat: tin, tile: 8, solid: true, sol: { msg: 'Hit the hangar roof' } }); s.box({ x: 0, y: HH + 1.6, z: HZ + HL / 2, w: HW * 1.2, h: 1.6, d: HL, mat: tin, tile: 8 });
    sign(s, 'HANGAR 3', { x: 0, y: HH + 3.1, z: HZ + HL + 0.1, w: 12, bg: '#7a1a12' });
    for (const [x, z, w, h] of [[-13, 20, 3, 2.4], [-13.5, 34, 2.2, 3.5], [13, 26, 3, 2], [13.5, 44, 2.4, 3], [-13, 55, 3, 1.6]]) s.box({ x, y: 0, z: HZ + z, w, h, d: 3, mat: wood, tile: 2, solid: true, sol: { msg: 'Hit the crates in the hangar' } });
    for (let i = 0; i < 4; i++) s.light({ x: 0, y: HH - 1.2, z: HZ + 10 + i * 19, color: 0xffe0a0, i: 160, dist: 46 }); s.box({ x: 0, y: 0, z: HZ + HL / 2, w: 2 * HW, h: 0.07, d: HL, mat: { tex: 'tx_concrete', color: 0xb8b8b0 }, tile: 6, cast: false });
    const doors = [-1, 1].map(sd => { const m = s.box({ x: sd * (HW * 1.5), y: 0, z: HZ - 0.6, w: HW, h: HH, d: 0.5, mat: dark, tile: 5, solid: true, sol: { msg: 'The hangar doors closed on you' } }); m.userData.sd = sd; return m; });
    s.put('ww2_truck', { x: 30, z: HZ + 190, ry: 0.5 }); s.box({ x: -34, y: 0, z: HZ + 160, w: 7, h: 11, d: 7, mat: 'tx_concrete' }); s.box({ x: -34, y: 11, z: HZ + 160, w: 9, h: 3, d: 9, mat: { glass: true, color: 0x7fb0a8, opacity: 0.6 } });
    s.crew({ x: 9, z: 46, ry: 0.5 });
    const ADV = {
      palm: 'Each palm line has ONE gap about 27 m wide, and it shifts up to 30 m left or right from line to line. Spot it early and steer for its middle with small taps of A/D.',
      hut: 'The huts stand beside every other palm gap. Fly through the middle of the gap, not its edge.',
      hangar: 'Line up on the hangar from 400 m out: it is dead ahead on the centre line, 34 m wide and 13 m tall. Fly straight down the middle.',
      door: 'Be at the doors before they shut: afterburner (SHIFT) the whole way, centre line, and hold SPACE for knife-edge once the Door gap readout drops under 6 m.',
    };
    for (const so of s.course.solids) if (so.msg === 'Clipped a palm tree') { so.advice = ADV.palm; so.scrape = 'Wing-tip clipped a palm'; } else if (/hut/.test(so.msg || '')) so.advice = ADV.hut; else if (/hangar (wall|roof)|crates/.test(so.msg || '')) so.advice = ADV.hangar;
    for (const d of doors) Object.assign(d.userData.solid, { advice: ADV.door, scrape: 'Wing clipped the closing door' });
    const fly = s.fly = new Fly(s, { model: 'acrostar', len: 5.2, kind: 'jet', engines: 1, x: 0, y: 6, z: 70, speed: 70, boost: 1.32, agility: 34, climb: 17, r: 2.4, knife: true, graze: 0.9, floorGraze: 0.6, wallGraze: 1.2, floor: () => 0, floorMsg: 'Put it into the jungle floor', floorScrape: 'Belly-scraped the jungle floor', floorAdvice: 'Hold the Altitude readout between 15 and 35 ft. Near the ground, tap S — never hold it.', wallMsg: 'Flew into the jungle canopy', wallScrape: 'Wing-tip in the jungle canopy', wallAdvice: 'Stay in the clearing between the jungle walls — the palm gaps are never near the edges, so you never need to go wider than 70 m from the centre.', grazeAdvice: ADV.palm, walls: (z, y) => z > JZ && y < 26 ? [-78, 78] : null, cam: { dist: 8.5, height: 2.3, ahead: 26, fov: 68 } });
    // the missile
    const mis = new THREE.Group(), mm = s.mat({ color: 0xe8e8e0, rough: 0.4 }); const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 2.8, 10), mm); body.rotation.x = Math.PI / 2; const nose = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.7, 10), s.mat({ color: 0xc02020 })); nose.rotation.x = -Math.PI / 2; nose.position.z = -1.75; mis.add(body, nose);
    for (let i = 0; i < 4; i++) { const f = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.04, 0.5), mm); f.rotation.z = i * Math.PI / 2 + 0.78; f.position.z = 1.2; mis.add(f); } s.scene.add(mis);
    // replay subject: rides with the jet, then settles on the doors for the explosion
    const prox = new THREE.Group(), pm = new THREE.Mesh(new THREE.BoxGeometry(6, 4, 6), new THREE.MeshBasicMaterial()); pm.visible = false; prox.add(pm); s.scene.add(prox); prox.position.copy(fly.pos);
    const st = s.st = { gap: 150, minGap: 150, low: { s: 0, n: 0 }, through: false, g: HW, beep: 0, boom: false, warned: false, hist: [], hi: 0 }; const T0 = 6, T1 = 31, mp = V3(0, 9, 220), tail = V3(), tv = V3(0, 0, 30);
    // the missile flies the jet's own line (it never cuts through the palm trunks the jet threaded)
    const lineAt = z => { const H = st.hist; if (!H.length || z >= H[0].z) return [H[0]?.x ?? 0, 6]; let i = Math.min(st.hi, H.length - 1); while (i > 0 && H[i].z < z) i--; while (i < H.length - 1 && H[i + 1].z >= z) i++; st.hi = i; const A = H[i], B = H[i + 1]; if (!B) return [A.x, A.y]; const k = (A.z - z) / Math.max(1e-3, A.z - B.z); return [lerp(A.x, B.x, k), lerp(A.y, B.y, k)]; };
    const boom = () => {
      if (st.boom) return; st.boom = true; const e = V3(0, 6, HZ + 1); s.fx.explosion(e, 3.6); s.fx.explosion(V3(rnd(-6, 6), HH - 1, HZ + 14), 2.6); s.fx.fireBurst(V3(0, 5, HZ - 2), 60, { size: 5, speed: 18 }); s.fx.debris(e, 60, { color: 0x6a726c, speed: 30, size: 1.2, dir: V3(0, 0.3, -1) });
      s.audio.explosion(1.4); s.engine.addShake(1.6); s.engine.flash(0.6); mis.visible = false; for (const d of doors) { d.userData.solid.dead = true; d.userData.blow = { vx: d.userData.sd * rnd(8, 14), vy: rnd(9, 13), vz: -rnd(22, 30), r: rnd(-2, 2) }; }
      s.msg('MISSILE TAKES THE HANGAR', 'huge good'); s.audio.say?.('Beautiful!'); s.wrap(2.6);
      // replay B (signature): low outside the far end of the hangar, the doors nearly shut and the jet bursting out of the slot knife-edge
      const m = st.mom; if (m) { m.t1 = s.t + 2.4; const D = m.t1 - m.t0, k = x => (x - m.t0) / D; m.shots = [{ type: 'track', a: 0, b: k(st.tb - 0.25), speed: 0.6, fov: 34 }, { type: 'front', pos: [2.6, 2.4, HZ - 34], fov: 26, lookUp: -1, a: k(st.tb - 0.7), b: k(st.tb + 0.32), speed: 0.3 }, { type: 'wide', a: k(st.tb + 0.1), b: 1, speed: 0.8, side: 1, dist: 2.5 }]; }
    };
    mis.position.copy(mp); s.objective('Stay low in the palms — the missile is locked on');
    s.onUpdate((dt, t) => {
      const p = fly.pos, el = s.started ? t - s.t0 : 0;
      // doors (blown off their tracks by the missile)
      st.g = HW * clamp(1 - (el - T0) / (T1 - T0)); if (st.boom) st.g = 0;
      for (const d of doors) { const b = d.userData.blow; if (b) { b.vy -= 15 * dt; d.position.x += b.vx * dt; d.position.y = Math.max(-2, d.position.y + b.vy * dt); d.position.z += b.vz * dt; b.vz *= 1 - dt * 0.8; d.rotation.x += b.r * dt; continue; } const sd = d.userData.sd, x = sd * (st.g + HW / 2); d.position.x = x; const so = d.userData.solid; so.x0 = x - HW / 2; so.x1 = x + HW / 2; }
      if (!st.through) prox.position.copy(p); else prox.position.set(lerp(-8, 8, clamp((s.t - st.tb) / 3.5)), 7, HZ - 6); // slides across the doors so the wide shot looks straight at them
      if (!s.started || s.ended && !st.through) return;
      if (!st.through && !fly.dead) {
        const H = st.hist; if (!H.length || H.at(-1).z - p.z > 1.5) H.push({ z: p.z, x: p.x, y: p.y });
        const low = p.y < 12.5, boost = s.input.b; st.gap = Math.min(170, st.gap - (6 - (low ? 4 : 0) - (boost ? 2.5 : 0)) * dt); st.minGap = Math.min(st.minGap, st.gap); if (p.z < -200) acc(st.low, low ? 1 : 0, dt);
        st.beep -= dt; if (st.beep <= 0) { st.beep = clamp(st.gap / 150, 0.07, 0.9); s.audio.tick(); }
        if (st.gap < 45 && !st.warned) { st.warned = true; s.flub('Missile closing!', { penalty: 0.1, advice: 'Get down under 40 ft and stay on the afterburner (SHIFT) — low AND fast is the only way the missile falls back.' }); } else if (st.gap > 80) st.warned = false;
        s.hud.readout('mis', 'Missile (m)', Math.max(0, Math.round(st.gap)), st.gap < 50 ? 'warn' : 'ok'); s.hud.readout('alt', 'Altitude (ft)', ftOf(p.y - 1), low ? 'ok' : 'warn');
        const dd = p.z - HZ; if (dd < 900) { s.hud.readout('door', 'Door gap (m)', (st.g * 2).toFixed(1), st.g < 3 ? 'warn' : ''); s.objective(dd < 420 ? 'THROUGH THE HANGAR — hold SPACE to knife-edge the gap' : 'Hangar ahead — the doors are closing'); }
        if (dd < 140 && !st.mom) st.mom = s.moment('the hangar squeeze', { t0: s.t - 0.5, dur: 5, w: 3, subject: prox, shots: [{ type: 'track', a: 0, b: 0.32, speed: 0.6, fov: 34 }, { type: 'front', a: 0.18, b: 0.42, speed: 0.3 }, { type: 'wide', a: 0.4, b: 1, speed: 0.8 }] });
        if (dd < fly.v * 0.55 && !st.cut && Math.abs(p.x) < st.g + 3 && p.y < HH) st.cut = s.cut([{ t: s.t, p: p.clone() }, { t: s.t + dd / fly.v, p: V3(p.x, p.y, HZ) }], 'front');
        if (st.gap <= 1) return fly.crash('The heat-seeker caught you — too high or too slow', 1, 'Stay under 40 ft (Altitude readout green) and hold SHIFT the whole way — high or slow, the missile gains on you.');
        if (p.z < HZ - 3) {
          if (Math.abs(p.x) > HW || p.y > HH) return fly.crash('Missed the hangar — the missile ran you down', 1, ADV.hangar);
          st.through = true; fly.control = false; fly.liftBias = 9; s.rate('Stayed in the trees', avg(st.low), 1); s.rate('Kept the missile off', clamp(st.minGap / 70), 1); s.rate('Line through the doors', near(Math.abs(p.x), 0, 1, 4), 1.2);
          if (fly.knifeK > 0.6) s.bonus('Knife-edge through the gap', 1500); if (st.g < 2.6) s.bonus('Doors nearly shut', 1000);
          s.msg('THROUGH!', 'good'); s.slowmo(0.4, 0.8); st.tb = s.t;
          s.after(0.35, () => { st.cut?.(); st.cut = s.cut([{ t: s.t, p: V3(-8, 7, HZ - 6) }, { t: s.t + 3.5, p: V3(8, 7, HZ - 6) }], 'wide', { subject: prox, side: 1, dist: 2.5 }); });
        }
      }
      // missile flies the jet's line, trailing smoke; after the jet is through it runs into the doors
      if (!st.boom) {
        mp.z = st.through ? Math.max(HZ + 1, mp.z - fly.v * 1.6 * dt) : p.z + st.gap; const [lx, ly] = lineAt(mp.z); mp.x = lx; mp.y = st.through ? damp(mp.y, 6, 3, dt) : ly;
        mis.position.copy(mp); mis.rotation.z += dt * 5; tail.set(mp.x, mp.y, mp.z + 1.6); s.fx.exhaust(tail, tv, 1.3, true); s.fx.smokePuff(tail, 1, { color: [0.8, 0.8, 0.8], size: 1.1, up: 0.6, spread: 0.3, life: 1.3, a: 0.4 });
        if (st.through && (mp.z <= HZ + 1.5 || s.t - st.tb > 2)) boom();
      }
    });
    s.dbg = () => ({ gap: Math.round(st.gap), g: +st.g.toFixed(1), z: Math.round(fly.pos.z), dmg: +fly.dmg.toFixed(2) });
  },
  bot(s, inp) { const f = s.fly, p = f.pos, g = s.gates.find(g => g.z < p.z - 3); const tx = g ? g.x : 0; inp.x = clamp((tx - p.x) / 9, -1, 1); inp.y = clamp((6.2 - p.y) * 0.5, -1, 1); inp.b = true; inp.a = p.z < -2300 + 230; },
};

// ---------------------------------------------------------------------------------------------
const topgun = {
  id: 'top_gun', title: 'Keeping Up Foreign Relations', film: 'Top Gun', year: 1986, tier: 5, pay: 24000, mode: 'fly', art: 'bd_desert_mtn', music: 'synth',
  role: 'Tomcat pilot — inverted, canopy to canopy with a MiG',
  brief: 'Roll her on her back and sit right on top of the MiG — two metres, canopy to canopy — and hold it there while your back-seater gets his Polaroid. He weaves. You don\'t touch him.',
  tips: [`Tap ${K('SPACE')} to <b>roll inverted</b>. The photo meter only fills while you are upside down.`, 'Ease down into the <b>photo box</b> above the MiG — small inputs, he drifts and you drift with him.', 'Ten seconds in the box gets the picture. <b>Touch him and you both go home in bags.</b>'],
  controls: `${K('A')}${K('D')} slide left / right &nbsp; ${K('W')} up &nbsp; ${K('S')} down &nbsp; ${K('SPACE')} roll inverted`, intro: { r: 36, h: 8, up: -4 },
  assets: { models: ['f14', 'mig'], tex: ['bd_desert_mtn', 'tx_sand'] },
  build(s) {
    s.env('high', { backdrop: 'bd_desert_mtn', look: 'golden', fog: 0.0006, sun: [22, 55], sunCol: 0xffd0a0 }); // a little dust haze so the desert floor falls away
    s.ground({ tex: 'tx_sand', tile: 90, color: 0xcdb48e });
    const Y0 = 320, fly = s.fly = new Fly(s, { model: 'f14', kind: 'jet', x: 16, y: Y0 + 20, z: 0, speed: 120, boost: 1, agility: 10, climb: 8, resp: 3, r: 6, bank: 0.4, canInvert: true, blur: 0.5, cam: { dist: 30, height: 7, ahead: 40, up: -2, fov: 56, stiff: 12 } });
    const mig = s.put('mig', { x: 0, y: Y0, z: -1 }), M = s.mig = { x: 0, y: Y0, vx: 0, vy: 0 }, D0 = (fly.size.y + mig.userData.size.y) / 2 * 0.86; s.D0 = D0; s.migH = mig.userData.size.y;
    const ex = V3(), ev = V3(0, 0, -110);
    const boxM = new THREE.LineBasicMaterial({ color: 0xffe14a, transparent: true, opacity: 0.9, toneMapped: false }), frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(6.5, 3.5, 15)), boxM); s.scene.add(frame); frame.userData.noRec = true; // HUD aid: never in the replay
    const st = s.st = { photo: 0, rel: { s: 0, n: 0 }, tight: { s: 0, n: 0 }, done: false, clear: 20, dx: 16, inT: 0, outT: 0, was: false, drops: 0, low: false, firstIn: -1, boxT: 0, tot: 0 }, FUEL = 45, BINGO = 62;
    s.introFocus = mig.position; s.objective('Roll inverted (SPACE) and settle into the box above the MiG');
    const finish = (el, why) => {
      st.done = true; st.doneT = s.t; s.hud.prompt(''); fly.control = false; fly.liftBias = 7;
      s.rate('Photo', st.photo, 1.6); s.rate('Time to get the shot', near(el, 16, 6, 60), 0.8); s.rate('Smooth formation', st.rel.n ? clamp(1.15 - avg(st.rel) / 3.2) : 0, 1); s.rate('Canopy to canopy', avg(st.tight), 1.2); s.rate('Held the box', st.tot > 0 ? clamp(st.boxT / st.tot * 1.25) : 0, 0.6);
      if (why) { s.msg(why, 'bad'); s.wrap(2, 'Fuel says we go with what we have.'); return; }
      s.engine.flash(1); s.audio.tick(); s.audio.good(); s.msg('CLICK! — got the Polaroid', 'huge good'); s.slowmo(0.35, 0.7); s.wrap(2.4, 'Watch the birdie.');
      // replay C (signature): the camera ship parked off the right wing, level between the two, as the inverted Tomcat and the MiG go past canopy to canopy
      const P = fly.pos, sig = [P.x + 30, P.y - 2.2, P.z - fly.v * 0.15];
      st.mom = s.moment('canopy to canopy', { t0: s.t - 3.6, t1: s.t + 1.2, w: 3, shots: [{ type: 'track', fov: 30, a: 0, b: 0.45, speed: 0.8 }, { type: 'orbit', a: 0.3, b: 0.6, speed: 0.4 }, { type: 'wide', pos: sig, fov: 21, lookUp: -2.6, a: 0.5, b: 0.82, speed: 0.35 }] });
    };
    s.onUpdate((dt, t) => {
      const el = s.started ? t - s.t0 : 0, p = fly.pos, k = st.done ? Math.max(0, 1 - (t - st.doneT) * 0.6) : 1;
      const nx = (12 * Math.sin(0.35 * el) + 3 * Math.sin(0.9 * el + 1) - 3 * Math.sin(1)) * k + (st.done ? M.x * (1 - k) : 0), ny = Y0 + 3 * Math.sin(0.5 * el);
      if (dt > 0) { M.vx = (nx - M.x) / dt; M.vy = (ny - M.y) / dt; } M.x = nx; M.y = ny; mig.position.set(nx, ny, p.z - 1); mig.rotation.z = damp(mig.rotation.z, -M.vx * 0.04, 4, dt); mig.rotation.x = M.vy * 0.03;
      for (const sx of [-0.7, 0.7]) s.fx.exhaust(ex.set(nx + sx, ny + 1.2, p.z - 1 + mig.userData.size.z * 0.5), ev, 1.1, true);
      frame.position.set(nx, ny + mig.userData.size.y / 2 + D0 + 2.05, p.z - 1); frame.visible = !st.done && !s.ended;
      if (!s.started || s.ended || fly.dead) return;
      const dx = p.x - nx, dy = p.y - (ny + mig.userData.size.y / 2), clear = dy - D0; st.clear = clear; st.dx = dx;
      if (!st.done && clear < 0 && clear > -D0 * 2.4 && Math.abs(dx) < 7) { s.fx.explosion(mig.position, 2.5); mig.visible = false; return fly.crash('Mid-air collision with the MiG', 1, 'Come down onto him slowly: stop descending once Separation reads 2 m, and tap W the moment it drops under 1 m. Match his drift with A/D.'); }
      // a generous box: 6.5 m wide, 0.3–3.8 m above his canopy
      const inBox = fly.inverted && Math.abs(dx) < 3.25 && clear > 0.3 && clear < 3.8;
      boxM.color.setHex(inBox ? 0x40ff70 : fly.inverted ? 0xffe14a : 0xff5040);
      if (!st.done) {
        st.tot += st.firstIn >= 0 ? dt : 0;
        if (inBox) { if (st.firstIn < 0) st.firstIn = el; st.photo += dt / 10; st.boxT += dt; st.inT += dt; st.outT = 0; acc(st.rel, Math.hypot(fly.vx - M.vx, fly.vy - M.vy), dt); acc(st.tight, near(clear, 1.9, 0.7, 1.9), dt); }
        else { st.outT += dt; if (st.was && st.inT > 0.8 && st.outT > 0.6) { st.drops++; st.inT = 0; if (st.drops <= 3) s.flub(st.drops === 1 ? 'Dropped out of the photo box' : 'Out of the box again', { penalty: 0.06, advice: 'Once you are in the box, make only small taps — he drifts left and right about 12 m every 18 s, so slide with him early rather than chase him.' }); } if (st.outT > 0.6) st.inT = 0; }
        if (st.outT > 0.6 || inBox) st.was = inBox;
        if (el > FUEL && !st.low) { st.low = true; s.flub('Low fuel', { penalty: 0.1, advice: 'Get inverted straight away (SPACE) and slide over the top of him — you need 10 s in the box before 45 s of fuel are gone.' }); }
        s.hud.meter('ph', inBox ? 'HOLD IT… focusing' : 'Photo', st.photo, { color: inBox ? '#40ff70' : '#ffe14a' });
        s.hud.readout('sep', 'Separation (m)', clear > 30 ? '30+' : clear.toFixed(1), inBox ? 'ok' : clear < 0.8 ? 'warn' : ''); s.hud.readout('fuel', 'Fuel (s)', Math.max(0, Math.ceil(BINGO - el)), el > FUEL ? 'warn' : '');
        s.hud.prompt(fly.inverted ? (inBox ? '' : clear > 3.8 ? 'Ease DOWN onto him' : Math.abs(dx) >= 3.25 ? 'Slide over the top of him' : 'Too close!') : `${K('SPACE')} roll inverted`);
        if (st.photo >= 1) finish(el);
        else if (el > BINGO) { s.flub('Bingo fuel — broke off before the photo was done', { penalty: 0.15, advice: 'Roll inverted at once and get over him early: the Photo meter only fills while you are upside down AND inside the box.' }); finish(el, 'BINGO FUEL — BREAK OFF'); }
      }
    });
    s.dbg = () => ({ ph: +st.photo.toFixed(2), cl: +st.clear.toFixed(1), dx: +st.dx.toFixed(1), drops: st.drops });
  },
  bot(s, inp) { const f = s.fly, p = f.pos, M = s.mig; if (!f.inverted) inp.press('a'); const ty = M.y + s.migH / 2 + s.D0 + 1.9; inp.x = clamp(((M.x - p.x) * 2.4 + M.vx) / 10, -1, 1); inp.y = clamp(((ty - p.y) * 1.6 + M.vy) / 8, -1, 1); },
};

// ---------------------------------------------------------------------------------------------
const t2 = {
  id: 't2_heli', title: 'Under the Overpass', film: 'Terminator 2: Judgment Day', year: 1991, tier: 5, pay: 23000, mode: 'fly', art: 'bd_la', music: 'chase',
  role: 'Police helicopter pilot hunting a SWAT van down the freeway',
  brief: 'Night, freeway, a stolen SWAT van. I want the skids a few metres off the tarmac the whole way — and when the overpass comes, you go UNDER it. The real pilot did it for the picture. So do you.',
  tips: ['Keep it <b>on the deck</b>: under the sign gantries and <b>under both overpasses</b>.', `Stay <b>within 40 m of the van</b> — it speeds up, so use ${K('SHIFT')} to close in.`, 'Slide <b>around the big rigs</b> — you can\'t climb over them where the signs are. The centre lamp posts are solid.'],
  controls: `${K('A')}${K('D')} slide &nbsp; ${K('W')} up &nbsp; ${K('S')} down &nbsp; ${K('SHIFT')} nose down / faster`, intro: { r: 17, h: 4, up: 0 },
  assets: { models: ['helicopter', 'van_white', 'semi_truck', 'sedan_grey', 'taxi', 'camera_crew', 'film_light', 'director_chair'], tex: ['bd_la', 'tx_asphalt', 'tx_concrete', 'tx_metal', 'tx_fac_night', 'tx_fac_office'] },
  build(s) {
    s.env('night', { backdrop: 'bd_la', look: 'night', fog: 0.0026, amb: 0.5, bdGain: 0.32, skyGain: 0.3, fogColor: 0x0b0f1a });
    s.ground({ tex: 'tx_concrete', tile: 14, color: 0x4a4a4a });
    const Z0 = 90, Z1 = -1760, ZE = Z1 - 260, L = Z0 - ZE, ZM = (Z0 + ZE) / 2, EDGE = 15.5;
    s.road({ z0: Z0, z1: ZE, width: 30, lanes: 8 });
    s.box({ x: 0, y: 0, z: ZM, w: 0.9, h: 1.1, d: L, mat: 'tx_concrete', tile: 4, solid: true, sol: { msg: 'Hit the centre divider', advice: 'Stay on the right-hand carriageway (the van never crosses the divider): keep well right of the centre lamp posts.' } });
    for (const sd of [-1, 1]) { s.box({ x: sd * (EDGE + 0.5), y: 0, z: ZM, w: 0.8, h: 4.2, d: L, mat: { tex: 'tx_concrete', color: 0x8a8a84 }, tile: 5, solid: true, sol: { msg: 'Hit the freeway wall', advice: 'The van keeps between 4 and 12 m right of centre — follow its lane, not the wall.' } }); s.row({ side: sd, x: sd * 26, z0: Z0, z1: ZE, fac: ['tx_fac_night', 'tx_fac_office'], height: [9, 30], lit: 0.9, seedv: sd > 0 ? 4 : 9, solid: false }); }
    // centre lamp posts (solid) with twin sodium heads; a small pool of real lights follows the camera
    const pole = s.mat({ color: 0x555a60, metal: 0.6, rough: 0.5 }), bulb = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffb050).multiplyScalar(5) }), LG = 70, lampZ = k => 40 - k * LG;
    for (let k = 0; lampZ(k) > ZE; k++) { const z = lampZ(k); s.box({ x: 0, y: 1.1, z, w: 0.26, h: 9.4, d: 0.26, mat: pole, solid: true, sol: { msg: 'Hit a lamp post', advice: 'The lamp posts run down the centre divider every 70 m. Keep at least 3 m right of the centre line.' } }); s.box({ x: 0, y: 10.4, z, w: 6.4, h: 0.16, d: 0.2, mat: pole, solid: true, sol: { msg: 'Hit a lamp post', advice: 'The lamp arms are 10 m up over the divider. Stay low and right of centre.' } }); for (const sx of [-3, 3]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.14, 0.4), bulb); b.position.set(sx, 10.32, z); s.scene.add(b); } }
    const pool = [0, 1, 2, 3].map(() => { const l = new THREE.PointLight(0xffc488, 110, 85, 1.5); s.scene.add(l); return l; });
    // overpasses and sign gantries
    const BR = s.bridges = [-540, -1260], GA = s.gantries = [-250, -830, -1040, -1520], conc = { tex: 'tx_concrete', color: 0x9a9a94 };
    for (const z of BR) { s.box({ x: 0, y: 7.6, z, w: 76, h: 1.7, d: 20, mat: conc, tile: 6, solid: true, sol: { msg: 'Flew into the overpass', advice: 'Get down early: under 15 ft (Skids readout green) by the time the OVERPASS warning appears. There is 7.6 m under the deck.' } }); for (const sx of [-1, 1]) { s.box({ x: 0, y: 9.3, z: z + sx * 9.7, w: 76, h: 1, d: 0.5, mat: conc }); s.box({ x: sx * (EDGE + 2), y: 0, z, w: 2.2, h: 7.6, d: 16, mat: conc, tile: 6 }); } s.box({ x: 0, y: 0, z, w: 1.6, h: 7.6, d: 12, mat: conc, tile: 6, solid: true, sol: { msg: 'Hit the overpass pillar', advice: 'Each overpass stands on a pillar in the centre. Go under on the van\'s side, 4–12 m right of centre.' } }); }
    const names = ['LONG BEACH', 'HARBOR FWY', 'TERMINAL ISL', 'CYBERDYNE EXIT', 'SAN PEDRO', 'STEEL MILL', 'NO TRUCKS', 'PICO BLVD'];
    GA.forEach((z, i) => { s.box({ x: 0, y: 6.1, z, w: 2 * EDGE, h: 0.5, d: 0.5, mat: pole, solid: true, sol: { y1: 8.9, msg: 'Hit a sign gantry', advice: 'The sign gantries are 6 m up: stay under 15 ft through them — never try to hop over.' } }); for (const sx of [-1, 1]) { s.box({ x: sx * EDGE, y: 0, z, w: 0.5, h: 6.6, d: 0.5, mat: pole }); sign(s, names[(i * 2 + (sx > 0 ? 1 : 0)) % 8], { x: sx * 7.6, y: 7.75, z: z + 0.3, w: 9.6, glow: 0.55 }); } });
    s.crew({ x: 12.5, z: 70, ry: 0.6 });
    const fly = s.fly = new Fly(s, { model: 'helicopter', kind: 'heli', x: 7.5, y: 12, z: 40, speed: 38, boost: 1.32, agility: 13, climb: 9, resp: 3, r: 2.6, blur: 0.5, graze: 0.7, floorGraze: 0.9, floor: () => 0, floorMsg: 'Put the skids into the freeway', floorScrape: 'Skids touched the tarmac', floorAdvice: 'Hover the skids 6–15 ft up: tap S to come down, never hold it this close to the road.', grazeAdvice: 'Give the posts and walls a metre more — slide with A/D early rather than late.', cam: { dist: 13, height: 6.2, ahead: 26, up: -1.5, fov: 62 } });
    const van = s.van = s.put('van_white', { x: 7.5, z: 0 }), VS = van.userData.size; van.userData.v = 38;
    srand(12); const trucks = s.trucks = [0, 1, 2, 3, 4].map(i => { const m = s.put('semi_truck', { x: i % 2 ? 11.2 : 4.4, z: -210 - i * 250, len: 9 }); m.userData.v = 21; return m; });
    const onc = [0, 1, 2, 3, 4, 5, 6].map(i => { const m = s.put(i % 2 ? 'sedan_grey' : 'taxi', { x: -4 - (i % 3) * 3.7, z: -150 - i * 260, ry: Math.PI }); for (const sx of [-0.6, 0.6]) { const b = new THREE.Mesh(new THREE.SphereGeometry(0.14, 6, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff4d0).multiplyScalar(6) })); b.position.set(sx, 0.7, -2.2); m.add(b); } return m; });
    for (const sx of [-0.75, 0.75]) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.08), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2010).multiplyScalar(5) })); b.position.set(sx, 1.0, VS.z / 2); van.add(b); }
    const spot = new THREE.SpotLight(0xdfe8ff, 90, 120, 0.2, 0.5, 1.2); s.scene.add(spot, spot.target); const rim = new THREE.PointLight(0xbfd0ff, 70, 26, 1.4); fly.obj.add(rim); rim.position.set(0, 5, 9); const bcn = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff2010).multiplyScalar(6) })); bcn.position.set(0, -fly.size.y / 2 + 0.2, fly.size.z * 0.2); fly.obj.add(bcn);
    const st = s.st = { gap: 40, low: { s: 0, n: 0 }, rng: { s: 0, n: 0 }, under: 0, br: BR.map(() => 0), tx: 7.5, scr: 0, lost: false, over: false, high: false, vanHit: 0 };
    const ADV = { lost: 'Hold SHIFT whenever the Van readout goes over 40 m — the van surges and you only have the speed on the throttle.', over: 'Stay in the van\'s lane and match its speed: let off SHIFT once the Van readout is under 25 m.', bridge: 'Get down under 15 ft (Skids readout green) as soon as OVERPASS shows — there is 7.6 m of clearance under the deck.' };
    s.objective('Get DOWN on the deck and chase the van');
    s.onUpdate((dt, t) => {
      const p = fly.pos, el = s.started ? t - s.t0 : 0, cz = s.camera.position.z, k0 = Math.floor((40 - cz) / LG);
      pool.forEach((l, i) => l.position.set(0, 9.6, lampZ(k0 + i)));
      spot.position.set(p.x, p.y - fly.size.y / 2 - 0.4, p.z - 3); spot.target.position.set(van.position.x, 0.5, van.position.z);
      if (!s.started) return;
      // the van weaves away from the trucks, surging and backing off; it waits for a pilot who falls behind and pulls away from one who overshoots
      let vb = 38 * (1.06 + 0.13 * Math.sin(0.5 * el + 1)); if (!s.ended && !fly.dead) { if (st.gap > 80) vb = Math.min(vb, fly.v * 0.8); else if (st.gap < -10) vb = Math.max(vb, fly.v * 1.15); }
      van.userData.v = damp(van.userData.v, vb, 1.2, dt); let tx = 7.6 + 3.6 * Math.sin(0.33 * el);
      if (st.gap < 8 && p.y < 5) tx = p.x > 7.8 ? 4.2 : 11.4; // keep out from under a low helicopter
      for (const tr of trucks) { tr.position.z -= tr.userData.v * dt; const dz = van.position.z - tr.position.z; if (dz > -14 && dz < 60) tx = tr.position.x > 8 ? 4.2 : 11.4; }
      for (const c of onc) { c.position.z += 30 * dt; if (c.position.z > cz + 30) c.position.z -= 900; }
      st.tx = damp(st.tx, tx, 1.6, dt); van.position.x = st.tx; van.position.z -= van.userData.v * dt; van.rotation.y = clamp((st.tx - tx) * 0.03, -0.12, 0.12);
      for (const tr of trucks) if (Math.abs(tr.position.x - van.position.x) < (tr.userData.size.x + VS.x) / 2 && Math.abs(tr.position.z - van.position.z) < (tr.userData.size.z + VS.z) / 2) st.vanHit++; // debug: must stay 0
      if (s.ended || fly.dead) return;
      const alt = p.y - 1.6, gap = st.gap = p.z - van.position.z, hit = (o, sz, pad = 0.5) => Math.abs(p.x - o.position.x) < sz.x / 2 + fly.hw * 0.7 && Math.abs(p.z - o.position.z) < sz.z / 2 + 3 && p.y - fly.hh - pad < sz.y;
      if (hit(van, VS, 0.3)) return fly.crash('Put the skids through the roof of the van', 1, 'Stay 10–40 m behind the van, not on top of it — let off SHIFT once the Van readout is under 25 m.');
      for (const tr of trucks) if (hit(tr, tr.userData.size, 0.3)) return fly.crash('Flew into the back of a big rig', 1, 'The big rigs are slower than you: when one is ahead in your lane, slide over to the other lane (A/D) 60 m before you reach it.');
      // over the top is a flub; under is the shot
      // replay A (signature): on the hard shoulder past the overpass, low, as the helicopter comes out from under the deck straight at the lens
      BR.forEach((z, i) => { if (!st.br[i] && p.z < z - 10) { st.br[i] = 1; if (p.y < 7.6) { st.under++; s.msg('UNDER THE BRIDGE!', 'good'); s.bonus('Under the overpass', 2000); s.engine.addShake(0.5); s.moment('under the overpass', { t0: s.t - 1.5, t1: s.t + 1.1, w: 2 + st.under, shots: [{ type: 'front', pos: [14.2, 1.3, z - 34], fov: 40, lookUp: -0.3, a: -0.05, b: 0.78, speed: 0.45 }, { type: 'low', a: 0.15, b: 0.85, speed: 0.35, at: 0.55 }, { type: 'track', a: 0.5, b: 1.2, speed: 0.8, fov: 36 }] }); } else s.flub('Went over the overpass', { penalty: 0.2, advice: ADV.bridge }); } });
      if (p.y > 30) { p.y = Math.min(p.y, 34); fly.vy = Math.min(fly.vy, 0); if (!st.high) { st.high = true; s.flub('Climbed out of the shot', { penalty: 0.1, advice: 'The shot is the skids a few feet off the freeway. Keep the Skids readout under 15 ft.' }); } } else if (p.y < 15) st.high = false;
      acc(st.low, near(alt, 2.6, 2.8, 12), dt); acc(st.rng, gap > 6 && gap < 45 ? 1 : gap < 70 ? 0.3 : 0, dt);
      s.hud.readout('alt', 'Skids (ft)', ftOf(Math.max(0, alt)), alt < 5.5 ? 'ok' : 'warn'); s.hud.readout('gap', 'Van (m)', Math.round(gap), gap > 6 && gap < 45 ? 'ok' : 'warn');
      const nb = BR.find(z => p.z - z > 0 && p.z - z < 260), ng = GA.find(z => p.z - z > 0 && p.z - z < 150); s.objective(nb ? 'OVERPASS — go under it' : ng ? 'Sign gantry — stay low' : gap > 45 ? 'Falling behind — SHIFT to close up on the van' : 'Chase the van — stay low and stay close');
      if (gap > 80 && !st.lost) { st.lost = true; s.flub('Losing the van', { penalty: 0.15, advice: ADV.lost }); } else if (gap < 45) st.lost = false;
      if (gap < -15 && !st.over) { st.over = true; s.flub('Overshot the van', { penalty: 0.1, advice: ADV.over }); } else if (gap > 5) st.over = false;
      if (p.z < Z1) { s.rate('On the deck', avg(st.low), 1.2); s.rate('On the van', avg(st.rng), 1.2); s.rate('Under the overpasses', st.under / BR.length, 1.4); s.wrap(1.6); }
    });
    s.dbg = () => ({ gap: Math.round(st.gap), y: +fly.pos.y.toFixed(1), z: Math.round(fly.pos.z), vanHit: st.vanHit, dmg: +fly.dmg.toFixed(2) });
  },
  bot(s, inp) { const f = s.fly, p = f.pos, v = s.van.position; let tx = clamp(v.x, 3.6, 12); for (const tr of s.trucks) { const dz = p.z - tr.position.z; if (dz > -12 && dz < 55) tx = tr.position.x > 8 ? 4.3 : 11.3; } inp.x = clamp((tx - p.x) / 3, -1, 1); inp.y = clamp((3.7 - p.y) * 0.9, -1, 1); inp.b = s.st.gap > 26; },
};

// ---------------------------------------------------------------------------------------------
const RZ = -5600, TZ = -6050, HW0 = z => 27 + 45 * clamp((RZ - z) / 250);
const mcx = z => (70 * Math.sin(z / 480) + 20 * Math.sin(z / 190 + 1) - 20 * Math.sin(1)) * clamp((60 - z) / 1100);
const mfl = z => 14 + 9 * Math.sin(z / 330) + 95 * Math.exp(-(((z - RZ) / 300) ** 2)) + 185 * clamp((-6250 - z) / 560);
const mH = (x, z) => { const d = Math.abs(x - mcx(z)) - HW0(z), f = mfl(z); return d <= 0 ? f : f + Math.min(150, d * 3.4) + (d > 5 ? 5 * Math.sin(x / 17 + z / 23) * Math.min(1, (d - 5) / 12) : 0); };
const maverick = {
  id: 'maverick', title: 'The Canyon Run', film: 'Top Gun: Maverick', year: 2022, tier: 6, pay: 60000, mode: 'fly', art: 'bd_canyon_snow', music: 'epic',
  role: 'Strike lead — low-level canyon ingress, pop-up attack, 9 g egress',
  brief: 'Two minutes thirty to target on the real thing; you get forty-two seconds. Stay under a hundred feet or the SAMs light you up. Pop over the ridge, put it on the target, then pull like your life depends on it — because the far wall is coming.',
  tips: ['Stay <b>below 100 ft</b> in the canyon. Linger above it and the <b>SAM lock</b> meter fills.', `You must <b>release by 0:00</b>. Use ${K('SHIFT')} on the straights — the clock does not wait.`, `Over the ridge, dive until the <b>red pipper</b> sits on the green target, hit ${K('E')} to release, then <b>hold ${K('W')}</b> to clear the far wall.`],
  controls: `${CTL.fly} &nbsp; ${K('E')} release &nbsp; ${K('SPACE')} roll inverted`, intro: { r: 30, h: 7, up: 0 },
  assets: { models: ['fa18'], tex: ['bd_canyon_snow', 'tx_rock', 'tx_snow', 'tx_concrete'] },
  build(s) {
    s.env('snow', { backdrop: 'bd_canyon_snow', look: 'teal_orange', fog: 0.0016, shadows: false, sun: [36, -40], sunI: 3.7, amb: 1.4 }); // lower raking sun models the walls (no shadow maps at this scale), cold haze down the canyon
    s.ground({ tex: 'tx_snow', tile: 40, y: -40, base: false });
    s.terrain({ x0: -350, x1: 350, z0: 160, z1: -6950, res: 7, fn: mH, mat: { tex: 'tx_rock', color: 0xd8dde4 }, tile: 46, base: false });
    const tx = mcx(TZ), ty = mfl(TZ); s.box({ x: tx, y: ty, z: TZ, w: 12, h: 4, d: 12, mat: 'tx_concrete' }); s.cyl({ x: tx, y: ty + 4, z: TZ, r: 4, r1: 3, h: 2.5, mat: { color: 0x555555, metal: 0.6 } });
    const tgt = s.mark({ x: tx, z: TZ, y: ty + 0.4, r: 22, color: 0x40ff70 }), pip = s.mark({ x: tx, z: TZ, y: ty, r: 9, color: 0xff3030 }); pip.visible = false; pip.material.depthTest = false; tgt.material.depthTest = false;
    for (const [dz, sd] of [[-900, 1], [-2300, -1], [-3600, 1], [-4700, -1]]) for (let i = 0; i < 5; i++) { const z = dz - i * 14, x = mcx(z) + sd * (HW0(z) + 8 + i * 3); s.box({ x, y: mH(x, z) - 2, z, w: 9 - i, h: 9 + i * 3, d: 9 - i, mat: { tex: 'tx_rock', color: 0xc8ced6 }, ry: i }); }
    const fly = s.fly = new Fly(s, { model: 'fa18', kind: 'jet', x: mcx(60), y: mfl(60) + 16, z: 60, speed: 135, boost: 1.3, agility: 52, climb: 64, r: 5, canInvert: true, graze: 0.8, floorGraze: 0.7, floor: mH, floorScrape: 'Scraped the rock', floorAdvice: 'Look 2–3 s ahead down the canyon and start every turn and climb early: small, steady A/D and W inputs, never full stick at the last moment.', cam: { dist: 24, height: 5.2, ahead: 46, fov: 68 } });
    // signature replay camera: down on the floor beyond the ridge, looking back up as the Hornet pops over the crest against the sky and dives at the lens
    const SIG = (() => { const z = RZ - 230, x = mcx(z) + 14; return [x, mH(x, z) + 2.5, z]; })();
    const bomb = s.box({ w: 0.5, h: 0.5, d: 2.4, color: 0x30343a }); bomb.visible = false; const bv = V3();
    const CLOCK = 42, CEIL = 34, st = s.st = { lock: 0, maxLock: 0, low: { s: 0, n: 0 }, rel: false, hit: null, sam: false, inv: false, agl: 16, crest: false, pops: 0, popF: false, late: false };
    const ADV = { sam: 'Keep the Altitude readout under 100 ft. If you balloon above it, push S at once — about 3 s up there and the SAM fires.', aim: 'Over the ridge, dive with S until the red pipper sits inside the green ring, THEN press E. Releasing early throws the bomb long.', late: 'Hold SHIFT on every straight — the canyon is 6 km and the clock gives you 42 s.' };
    const hitAt = d => { st.hit = d; if (d > 75) { s.flub(`Bomb landed ${Math.round(d)} m off the target`, { penalty: 0.3, advice: ADV.aim }); s.rate('Bomb on target', 0, 2); s.msg('MISSED THE TARGET', 'bad'); } else { s.rate('Bomb on target', near(d, 0, 12, 75), 2); s.msg(d < 14 ? 'BULLSEYE!' : d < 40 ? 'TARGET HIT' : 'Wide — but it counts', d < 40 ? 'huge good' : ''); if (d < 14) s.bonus('Bullseye', 6000); } s.objective('PULL UP! Clear the far wall'); if (st.mom) st.mom.t1 = s.t + 1.6; };
    s.objective('Canyon ingress — stay under 100 ft');
    s.onUpdate((dt, t) => {
      const p = fly.pos, el = s.started ? t - s.t0 : 0, f = mfl(p.z), agl = st.agl = p.y - f; fly.o.floorMsg = Math.abs(p.x - mcx(p.z)) > HW0(p.z) - 2 ? 'Clipped the canyon wall' : 'Flew it into the canyon floor';
      if (st.rel && bomb.visible) { bv.y -= 40 * dt; bomb.position.addScaledVector(bv, dt); const g = mH(bomb.position.x, bomb.position.z); if (bomb.position.y <= g) { bomb.visible = false; const d = Math.hypot(bomb.position.x - tx, bomb.position.z - TZ); bomb.position.y = g + 2; s.fx.explosion(bomb.position, 3.6); s.audio.explosion(1.3); s.engine.addShake(1.2); hitAt(d); } }
      if (!s.started || s.ended || fly.dead) return;
      const left = CLOCK - el;
      if (!st.rel) {
        s.hud.readout('clk', 'Time to target', (left < 0 ? '-' : '') + '0:' + String(Math.floor(Math.abs(left))).padStart(2, '0'), left < 8 ? 'warn' : ''); s.hud.readout('rng', 'Target (km)', ((p.z - TZ) / 1000).toFixed(1));
        if (left <= 0 && !st.late) { st.late = true; s.flub('Late on target', { penalty: 0.15, advice: ADV.late }); }
      }
      s.hud.readout('alt', 'Altitude (ft)', ftOf(Math.max(0, agl - fly.hh)), agl > CEIL && !st.crest ? 'warn' : 'ok');
      if (!st.crest) {
        // a brief pop above the radar floor is a flub; only a sustained exposure (~3 s) gets a SAM
        const hi = agl > CEIL; st.lock = clamp(st.lock + (hi ? dt / 3.2 : -dt * 0.3)); st.maxLock = Math.max(st.maxLock, st.lock); acc(st.low, near(agl, 16, 12, CEIL + 6), dt);
        if (hi && st.lock > 0.25 && !st.popF) { st.popF = true; st.pops++; s.flub('Popped above the radar', { penalty: 0.08, advice: ADV.sam }); } else if (st.lock < 0.05) st.popF = false;
        s.hud.meter('sam', hi ? 'SAM RADAR — GET DOWN' : 'SAM lock', st.lock, { color: '#ff4030' }); if (hi && Math.floor(t * 6) % 2) s.audio.tick();
        if (st.lock >= 1 && !st.sam) { st.sam = true; s.msg('SAM LAUNCH!', 'huge bad'); s.after(0.7, () => fly.crash('Stayed above the radar floor — SAM launch', 1, ADV.sam)); }
        if (p.z < RZ + 520 && p.z > RZ) s.objective('RIDGE — climb the face, stay tight to it');
        if (p.z < RZ + 160 && !st.mom) st.mom = s.moment('pop-up and dive', { t0: s.t - 0.6, dur: 6, w: 3, shots: [{ type: 'low', pos: SIG, fov: 30, a: 0.1, b: 0.5, speed: 0.45 }, { type: 'track', a: 0.3, b: 0.65, speed: 0.7, fov: 32 }, { type: 'wide', a: 0.5, b: 1, speed: 0.8 }] });
        if (p.z < RZ) { st.crest = true; pip.visible = true; s.objective('Dive on the target — E to release when the pipper is on it'); s.msg('POP UP — TARGET IN SIGHT', 'good'); if (fly.inverted) { st.inv = true; s.bonus('Inverted over the ridge', 4000); } }
      } else if (!st.rel) {
        // continuously computed impact point
        const h = Math.max(0, p.y - mfl(p.z - 150)), tf = (fly.vy + Math.sqrt(fly.vy * fly.vy + 80 * h)) / 40, iz = p.z - fly.v * tf, ix = p.x + fly.vx * tf * 0.5; st.iz = iz; pip.position.set(ix, mH(ix, iz) + 0.8, iz);
        const rel = () => { st.rel = true; pip.visible = false; s.rate('Time on target', clamp(0.45 + left / 7), 1); s.rate('Under the radar', clamp(1.15 - st.maxLock * 0.9), 1.2); s.rate('Low level', avg(st.low), 1); };
        if (s.input.hit('x')) { rel(); bomb.visible = true; bomb.position.copy(p); bomb.position.y -= 1.5; bv.set(fly.vx * 0.5, fly.vy, -fly.v); s.audio.thud?.(); s.msg('BOMBS AWAY', 'good'); }
        else if (p.z < TZ - 130) { rel(); s.flub('Overflew the target without releasing', { penalty: 0.35, advice: ADV.aim }); st.hit = 999; s.rate('Bomb on target', 0, 2); s.objective('PULL UP! Clear the far wall'); }
      } else if (p.z < -6760 && st.hit != null) { s.msg('MIRACLE NUMBER TWO', 'good'); s.wrap(1.6); }
    });
    s.dbg = () => ({ z: Math.round(fly.pos.z), agl: Math.round(st.agl), lock: +st.maxLock.toFixed(2), hit: st.hit && Math.round(st.hit), dmg: +fly.dmg.toFixed(2) });
  },
  bot(s, inp) {
    const f = s.fly, p = f.pos, st = s.st, la = f.v * 0.3, fr = (mfl(p.z - la) - mfl(p.z + 10)) / (la + 10) * f.v; inp.b = !st.rel; let tx = mcx(p.z - f.v * 0.45), ty = mfl(p.z - la) + 15;
    if (st.crest && !st.rel) { tx = mcx(TZ); ty = Math.max(ty, mfl(TZ) + 24 + Math.max(0, (p.z - TZ)) * 0.16); if (st.iz != null && st.iz <= TZ + 3) inp.press('x'); }
    if (st.rel) ty = mfl(p.z - 260) + 60;
    inp.x = clamp((tx - p.x) / 9, -1, 1); inp.y = clamp(((ty - p.y) * 1.5 + fr) / 64, -1, 1);
  },
};

// What the player is asked to do, in plain numbers, plus the film's signature camera angles for the replay.
const EXTRA = {
  octopussy: { goals: { shot: ['Fly low through the palms on afterburner (hold SHIFT) — Altitude under 40 ft keeps the missile back', 'Each line of palms has ONE gap (27 m wide) — thread every one, about every 150 m for 2 km', 'Fly into HANGAR 3 and out through the closing doors — hold SPACE for knife-edge if the Door gap is under 6 m'], cut: ['You hit the ground, a hut, the hangar or a palm trunk dead-on (wing-tip clips only cost damage)', 'The missile catches you (Missile readout hits 0) or you miss the hangar doors'], stars: ['Staying under the treetops', 'Distance kept from the missile', 'Line through the doors (dead centre is best)', 'Clips, scrapes and letting the missile close cost stars'] }, cine: ['track', 'front', 'wide'] },
  top_gun: { goals: { shot: ['Tap SPACE to roll inverted', 'Slide over the MiG and ease down into the yellow box above his canopy (Separation 0.3–3.8 m) — it turns green', 'Stay in the box for 10 s in total to fill the Photo meter — he drifts left and right, drift with him', 'Do it before 45 s — after that you are low on fuel; at 62 s you must break off'], cut: ['You touch the MiG (mid-air collision)'], stars: ['The photo (how full the meter got)', 'Time to get the shot', 'Smooth formation and canopy-to-canopy closeness', 'Dropping out of the box and low fuel cost stars'] }, cine: ['track', 'orbit', 'front'] },
  t2_heli: { goals: { shot: ['Drop to the deck: Skids under 15 ft (green) and keep them there', 'Chase the SWAT van down the freeway, staying 6–45 m behind it (Van readout green) — SHIFT to close up', 'Fly UNDER both overpasses and the sign gantries; slide round the big rigs, never over them'], cut: ['You hit the freeway, a wall, a lamp post, a bridge, a truck or the van'], stars: ['On the deck (skids low)', 'On the van (within 45 m)', 'Under both overpasses', 'Going over a bridge, losing or overshooting the van cost stars'] }, cine: ['low', 'front', 'track'] },
  maverick: { goals: { shot: ['Fly the canyon on afterburner (SHIFT), Altitude under 100 ft — above it the SAM lock meter fills', 'At the ridge (~5.6 km) climb the face and pop over the top', 'Dive until the red pipper sits on the green target and press E to release — before the clock reads 0:00', 'Hold W to pull up over the far wall'], cut: ['You hit the canyon floor or walls (light scrapes only cost damage)', 'You stay above 100 ft for about 3 s and the SAM fires'], stars: ['Bomb on target', 'Time on target', 'Under the radar', 'Low level', 'Pop-ups, a late release and misses cost stars'] }, cine: ['low', 'track', 'wide'] },
};
export default [octopussy, topgun, t2, maverick].map(d => Object.assign(d, EXTRA[d.id]));
