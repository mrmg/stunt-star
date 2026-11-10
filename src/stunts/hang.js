import * as THREE from 'three';
import { Grip } from '../modes/grip.js';
import { POSES } from '../world/character.js';
import { clamp, near, smooth, V3, rnd, sr, srand, lerp, damp } from '../world/stage.js';
import { K, CTL, sign } from './common.js';

const ftOf = m => Math.round(m * 3.281);
// --- shared helpers -----------------------------------------------------------------------------
const grp = (parent, x = 0, y = 0, z = 0) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };
// bot: brace just before every telegraphed hit, otherwise leave SPACE alone
const botBrace = (g, inp, lead = 0.35) => (inp.a = g.incoming() < lead);
// bot: rest when the tank is low. Returns true while resting.
const botRest = (g, B, lo = 0.2, hi = 0.55) => { if (g.stam < lo) B.rest = true; else if (g.stam > hi) B.rest = false; return !!B.rest; };
// common end-of-take ratings for Grip stunts
function gripScores(s, g, o = {}) {
  const st = g.stats; s.rate('Bracing', st.events ? st.braced / st.events : 1, o.braceW ?? 1.5); s.rate('Grip left', clamp(g.grip * 1.15), 1);
  if (o.time) s.rate('Pace', near(s.t - s.t0, o.time[0], o.time[1], o.time[2]), o.timeW ?? 1);
  if (st.wasted > 2.5) s.rate('Composure', clamp(1 - (st.wasted - 2.5) / 8), 0.5);
}
// dust / wind streaks rushing past a "moving" set that is really standing still
function windStreaks(s, n, vel, col = [1, 1, 1], box = [16, 8, 30], a = 0.35) { const p = V3(); s.onUpdate(() => { const c = s.camera.position; for (let i = 0; i < n; i++) s.fx.streak(p.set(c.x + rnd(-box[0], box[0]), c.y + rnd(-box[1], box[1]), c.z - rnd(4, box[2])), vel, col, 0.35, 0.09, a); }); }
// rope / cable between two world points (thin cylinder re-posed each frame)
function rope(s, r = 0.02, color = 0x2a2018, parent) { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1, 6), s.mat({ color, rough: 0.8 })); m.castShadow = true; (parent || s.scene).add(m); const d = V3(), up = V3(0, 1, 0); m.set = (a, b) => { d.subVectors(b, a); const L = d.length(); m.position.copy(a).addScaledVector(d, 0.5); m.scale.set(1, Math.max(0.001, L), 1); m.quaternion.setFromUnitVectors(up, d.multiplyScalar(1 / Math.max(1e-6, L))); }; return m; }

// ---------------------------------------------------------------------------------------------
const safetyLast = {
  id: 'safety_last', title: 'The Clock Climb', film: 'Safety Last!', year: 1923, tier: 1, pay: 2200, mode: 'grip', art: 'bd_old_la', music: 'silent',
  role: 'Doubling the boy in the straw boater, twelve floors over Broadway',
  brief: 'No nets, no wires, one take. Climb the front of the Bolton Building, and when you get to the clock — grab the big hand. It will give way. That is the picture.',
  tips: ['Climb with <b>W A S D</b>. Stop and rest when the stamina bar runs low — tired fingers slip.', 'Pigeons, planks and a tennis net come at you: <b>wait below or shuffle sideways</b>. For windows and jolts hold <b>SPACE</b> to brace.', 'Under the clock press <b>E</b> to leap for the minute hand, brace as it swings down, then haul up to the roof.'],
  controls: CTL.grip + ` &nbsp; ${K('E')} leap for the clock`, intro: { r: 12, h: 2.5, a0: -0.7, speed: 0.06, up: 1.5, fov: 50 },
  assets: { models: ['ch_silent', 'clock_tower_face', 'sedan_grey', 'wagon_brown', 'street_lamp'], tex: ['bd_old_la', 'tx_fac_old', 'tx_asphalt', 'tx_concrete', 'tx_roof', 'tx_wood', 'tx_brick'] },
  build(s) {
    s.env('day', { backdrop: 'bd_old_la', look: 'silent', fog: 0.0022, hz: 0.42 });
    s.ground({ tex: 'tx_asphalt', tile: 10 });
    const H = 40, W = 20, CY = 36.3, CX = 1.5, HL = 2.35;
    s.building({ x: 0, z: -9, w: W, d: 18, h: H, fac: 'tx_fac_old', parapet: 0.8, top: true, facTile: 10 });
    const stone = s.mat({ tex: 'tx_concrete', color: 0xcfc8b8 }), dark = s.mat({ color: 0x15130f, rough: 0.6 }), wood = s.mat({ tex: 'tx_wood', color: 0xb09870 });
    for (let y = 5; y < H; y += 5) s.box({ x: 0, y: y - 0.15, z: 0.09, w: W + 0.3, h: 0.3, d: 0.2, mat: stone, tile: 3 });
    s.box({ x: 0, y: H - 0.5, z: 0.15, w: W + 0.5, h: 0.5, d: 0.35, mat: stone, tile: 3 });
    // the corner block: side street on the left, lower neighbours all round
    s.road({ x: -17, z0: 70, z1: -260, width: 11, lanes: 2 }); s.box({ x: 0, y: 0, z: 2.5, w: 60, h: 0.16, d: 5, mat: 'tx_concrete', tile: 4, cast: false });
    s.row({ side: -1, x: -23, z0: 60, z1: -260, fac: ['tx_fac_old', 'tx_brick'], height: [12, 30], seedv: 4, solid: false, facTile: 10 }); s.row({ side: 1, x: -11, z0: -20, z1: -260, fac: ['tx_fac_old', 'tx_brick'], height: [14, 30], seedv: 8, solid: false, facTile: 10 });
    s.building({ x: 22, z: -9, w: 22, d: 18, h: 27, fac: 'tx_fac_old', solid: false, facTile: 10 }); s.building({ x: -2, z: 44, w: 60, d: 20, h: 22, fac: 'tx_brick', solid: false, facTile: 8 });
    for (const [id, x, z, ry] of [['sedan_grey', -15, 12, 0], ['wagon_brown', -19.5, -22, Math.PI], ['sedan_grey', -15, -48, 0], ['wagon_brown', 6, 9, Math.PI / 2], ['sedan_grey', -15, -90, 0]]) s.put(id, { x, z, ry });
    for (const x of [-9, 0, 9]) s.put('street_lamp', { x, z: 4.6, height: 5.5 });
    sign(s, 'BOLTON BUILDING', { x: 0, y: 12.4, z: 0.5, w: 9, bg: '#1a1712', fg: '#e8dfc8', glow: 0.7 }); s.crew({ x: 6, z: 12, ry: 0.3 });
    // the clock: a dressed face with one giant, treacherous minute hand
    const clock = grp(s.scene, CX, CY, 0.5), face = grp(clock);
    s.put('clock_tower_face', { parent: face, y: -2.9, z: -0.1, height: 5.8 });
    const hand = grp(clock, 0, 0, 0.5); s.box({ parent: hand, x: 0, y: -HL, w: 0.17, h: HL + 0.35, d: 0.06, mat: dark }); s.cyl({ parent: clock, r: 0.2, h: 0.5, rx: Math.PI / 2, mat: dark, z: 0.4 });
    let ha = -1.62, haT = ha, haV = 0; hand.rotation.z = ha; // angle from straight down; negative = pointing left
    const tip = V3(), tipOf = () => tip.set(CX + Math.sin(ha) * (HL - 0.15), CY - Math.cos(ha) * (HL - 0.15), 0.72 + clock.rotation.x * 2);

    const g = s.g = new Grip(s, { char: 'ch_silent', offset: [0, 0, 0.34], u: -4, v: 15, range: { u: [-7, 7], v: [15, 31.6] }, speed: 1.55, bracePose: 'cling', hazY: 1.0, fallMsg: 'Fell twelve floors onto Broadway', injury: 1 });
    s.cam.follow(g.camTarget(0), { dist: 8.5, height: 4.2, yaw: 0.5, up: 1.1, ahead: 0, fov: 60, ground: false, stiff: 4 });
    s.introFocus = V3(-4, 15, 0.4);
    // --- hazards on the way up
    const bird = (u, v, vu) => { const o = grp(s.scene); s.box({ parent: o, y: -0.1, w: 0.5, h: 0.2, d: 0.22, mat: { color: 0x9a9a9a } }); const wg = s.box({ parent: o, y: 0, w: 0.2, h: 0.05, d: 1.0, mat: { color: 0xdddddd } }); g.hazard({ u, v, vu, r: 0.75, power: 0.24, obj: o, life: 6, msg: 'PIGEON!', upd: h => { wg.rotation.x = Math.sin(g.t * 22 + u) * 0.7; h.v += Math.sin(g.t * 5 + u) * 0.004; } }); };
    const win = (label) => { const o = grp(s.scene, g.u - 0.7, g.v + 1.3, 0.12), pane = s.box({ parent: o, x: 0.7, y: 0, w: 1.4, h: 1.9, d: 0.06, mat: { glass: true, color: 0xcfe0e8, opacity: 0.55 } }); s.box({ parent: o, x: 0.7, y: -0.06, w: 1.5, h: 0.08, d: 0.1, mat: dark }); g.gust(1.0, { label, power: 0.34, sfx: 'thud', kick: [0, 0, 0.25], failLabel: 'KNOCKED OFF THE SILL!', on: () => { o.userData.open = 1; } }); s.onUpdate(dt => { if (o.userData.open) o.rotation.y = damp(o.rotation.y, -1.9, 9, dt); }); };
    const steps = [
      [17, () => { s.msg('PIGEONS!', 'small'); bird(9, g.v + 3.3, -4.6); bird(11.5, g.v + 4.3, -4.6); }],
      [19.6, () => win('WINDOW!')],
      [22.2, () => { s.msg('LOOK OUT ABOVE!', 'bad'); s.audio.tick(); const o = s.box({ w: 2.6, h: 0.1, d: 0.32, mat: wood }); g.hazard({ u: g.u, v: g.v + 15, vv: -7.5, r: 1.15, power: 0.42, obj: o, life: 5, spin: 2.2, msg: 'HIT BY THE PLANK!' }); }],
      [24.6, () => { s.msg('PIGEONS!', 'small'); bird(-9, g.v + 3.2, 4.8); bird(-12, g.v + 4.4, 4.8); bird(-15, g.v + 3.6, 4.8); }],
      [27, () => { s.msg('TENNIS NET!', 'bad'); const o = grp(s.scene); const m = s.box({ parent: o, y: -1, w: 3.4, h: 2, d: 0.05, mat: { color: 0xffffff, opacity: 0.35, side: true } }); for (let i = -3; i <= 3; i++) s.box({ parent: o, x: i * 0.55, y: -1, w: 0.03, h: 2, d: 0.06, mat: dark }); for (let i = 0; i < 5; i++) s.box({ parent: o, y: -1 + i * 0.5, w: 3.4, h: 0.03, d: 0.06, mat: dark }); g.hazard({ u: g.u, v: g.v + 9, vv: -2.6, r: 1.75, power: 0.1, obj: o, life: 7, w: 0.3, msg: 'TANGLED IN THE NET!', on: () => { g.speedK = 0.35; tangled++; s.after(4, () => { g.speedK = 1; }); } }); }],
      [29.4, () => win('ANOTHER WINDOW!')],
    ];
    let si = 0, tangled = 0, phase = 0, pt = 0; s.objective('Climb to the clock');
    s.onUpdate(dt => {
      if (!s.started || s.ended) return; s.hud.readout('alt', 'FT UP', ftOf(g.world.y), '');
      haV += ((haT - ha) * 60 - haV * 7) * dt; ha += haV * dt; hand.rotation.z = ha;
      if (phase === 0) {
        while (si < steps.length && g.v > steps[si][0]) steps[si++][1]();
        tipOf(); const inReach = g.v > 30.9 && Math.abs(g.u - tip.x) < 1.5;
        if (g.v > 30.5) { s.objective('Get under the tip of the big hand and leap'); g.promptText = inReach ? `${K('E')} leap for the hand` : ''; }
        if (inReach && s.input.hit('x')) { phase = 1; pt = 0; g.promptText = ''; g.o.range = null; g.o.pose = 'hang'; g.o.idleCycle = 'hang'; g.o.bracePose = 'hoseswing'; g.o.movePose = 'climb'; s.cam.set({ up: 2.6, height: 3.2, dist: 9.5 }); s.audio.whoosh(1); s.slowmo(0.5, 0.5); s.msg('GOT IT!', 'good'); s.objective('Hang on — brace when it gives');
          haT = -1.05; s.rate('Leap', near(g.u, tip.x, 0.5, 1.6), 0.5);
          g.gust(1.7, { label: 'THE HAND IS GIVING WAY!', sfx: 'thud', power: 0.4, on: () => { haT = -0.38; s.audio.bell(); } });
          g.gust(3.6, { label: 'THE FACE IS COMING OFF!', sfx: 'crash', power: 0.4, on: () => { faceT = 0.3; s.fx.debris(tip, 8, { color: 0x999999, speed: 3 }); s.fx.dust(V3(CX, CY, 0.6), 8, { color: [0.8, 0.8, 0.8] }); } });
          g.gust(5.4, { label: 'SPRING!', sfx: 'bell', power: 0.34, on: () => { haT = 0.12; haV = 3; } }); }
      } else if (phase === 1) {
        pt += dt; tipOf(); g.u = 0; g.v = 0; g.off.set(tip.x, tip.y - 2.12, tip.z);
        if (pt > 6.3) { phase = 2; g.o.pose = 'cling'; g.o.idleCycle = null; g.o.bracePose = 'cling'; g.o.range = { u: [0, 0], v: [0, H - g.off.y] }; g.o.vK = 1.5; s.objective('Haul yourself up to the roof'); g.promptText = `hold ${K('W')} — up and over`; }
      } else if (phase === 2) {
        g.off.z = damp(g.off.z, 0.75, 4, dt);
        if (g.v >= H - g.off.y - 0.02) { phase = 3; g.done = true; g.promptText = ''; s.hud.prompt(''); g.off.set(g.off.x, H, -1.2); g.u = g.v = 0; g.c.heading = Math.PI; g.c.setCycle('cheer', 1); s.msg('TOP OF THE WORLD', 'good');
          gripScores(s, g, { time: [34, 6, 30] }); s.rate('Clean climb', 1 - (g.stats.hits - (g.stats.events - g.stats.braced)) * 0.3 - tangled * 0.15, 1.2); s.bonus('No net, no wires', g.stats.hits ? 0 : 250); s.wrap(1.8); }
      }
      clock.rotation.x = damp(clock.rotation.x, faceT, 6, dt);
    });
    let faceT = 0; s.dbg = () => ({ u: +g.u.toFixed(1), v: +g.v.toFixed(1), grip: +g.grip.toFixed(2), stam: +g.stam.toFixed(2), phase });
    s.tipX = () => tipOf().x;
  },
  bot(s, inp, B) {
    const g = s.g; inp.x = 0; inp.y = 0; if (botBrace(g, inp)) return; const d = s.dbg();
    if (d.phase === 0) {
      let hold = botRest(g, B), dodge = 0;
      for (const h of g.hazards) { const dv = h.v - (g.v + 1), du = h.u - g.u; if (h.vv < 0) { if (Math.abs(du) < h.r + 0.7 && dv > -2.5) dodge = du > 0 || g.u > 5 ? -1 : 1; } else if (dv > -0.6 && dv < 3.2 && Math.abs(du) < 7 && du * h.vu < 0) hold = true; }
      if (dodge) inp.x = dodge; else if (g.v > 30.9) { const dx = s.tipX() - g.u; if (Math.abs(dx) > 0.3) inp.x = Math.sign(dx); else inp.press('x'); } else if (!hold) inp.y = 1; else if (g.v > 29) inp.x = Math.sign(s.tipX() - g.u);
    } else if (d.phase === 2) inp.y = botRest(g, B, 0.1, 0.3) ? 0 : 1;
  },
};

// ---------------------------------------------------------------------------------------------
// small glowing pad stuck on a hand bone (sticky gloves etc.)
function handPad(s, c, bone, color) { const b = c.bones[bone]; if (!b) return null; const m = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.05, 0.16), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2.2) })); const sc = V3(); b.getWorldScale(sc); m.scale.setScalar(1 / Math.max(1e-4, sc.x)); b.add(m); return m; }
const burj = {
  id: 'mi_burj', title: 'Sticky Gloves', film: 'Mission: Impossible – Ghost Protocol', year: 2011, tier: 5, pay: 25000, mode: 'grip', art: 'bd_dubai', music: 'spy',
  role: 'Doubling the agent on the outside of the tallest building on Earth',
  brief: 'You go out of the window on floor 119 and climb the glass to the server room on 130. The gloves stick while the light is blue. Blue is glue. Red… is dead. And there is a sandstorm coming, so do not hang about.',
  tips: ['<b>Eleven floors</b> against the clock: climb in bursts and rest before the stamina bar empties.', 'Wind gusts are called a moment ahead — <b>hold SPACE</b> flat against the glass, then get moving again.', 'Halfway up a glove dies: everything costs <b>double</b>. Work across to the open window on the right as you climb.'],
  controls: CTL.grip, intro: { r: 13, h: 5, a0: -0.5, speed: 0.07, up: 0, fov: 55 },
  assets: { models: ['ch_agent'], tex: ['bd_dubai', 'tx_glass_tower', 'tx_sand', 'tx_fac_office', 'tx_concrete', 'tx_asphalt'] },
  build(s) {
    s.env('high', { backdrop: 'bd_dubai', look: 'teal_orange', fog: 0.00045, hz: 0.5, bdFollow: 0.55 });
    s.ground({ tex: 'tx_sand', tile: 60, color: 0xd8c8a8 });
    const Y0 = 300, FH = 3.6, NF = 11, TOP = Y0 + NF * FH, WX = 5.5, LIMIT = 62;
    const glass = s.mat({ tex: 'tx_glass_tower', rough: 0.12, metal: 0.75, color: 0xb8d0e0 }), steel = s.mat({ color: 0x9aa4ac, metal: 0.9, rough: 0.3 });
    s.box({ x: 0, y: 0, z: -24, w: 48, h: 430, d: 48, mat: glass, tile: 14.4, tileY: 14.4 }); s.box({ x: 0, y: 430, z: -24, w: 30, h: 120, d: 30, mat: glass, tile: 14.4 }); s.cyl({ x: 0, y: 550, z: -24, r: 4, r1: 0.3, h: 160, mat: steel });
    for (let f = -6; f <= NF + 4; f++) s.box({ x: 0, y: Y0 + f * FH - 0.06, z: 0.03, w: 48, h: 0.12, d: 0.08, mat: steel, cast: false });
    for (let x = -24; x <= 24; x += 2) s.box({ x, y: Y0 - 30, z: 0.04, w: 0.07, h: 90, d: 0.1, mat: steel, cast: false });
    // the open server-room window on 130
    s.box({ x: WX, y: TOP + 0.1, z: 0.02, w: 1.9, h: 3.3, d: 0.1, mat: { color: 0x05080c, rough: 1 } }); s.box({ x: WX, y: TOP + 0.02, z: 0.1, w: 2.1, h: 0.08, d: 0.2, mat: { color: 0x30ff80, emissive: 0x30ff80, emI: 3 } }); s.light({ x: WX, y: TOP + 1.5, z: 1, color: 0x60ffa0, i: 20, dist: 14, bulb: false });
    // a tiny city, a very long way down
    srand(21); for (let i = 0; i < 70; i++) { const a = sr(6.28), r = sr(90, 900), x = Math.sin(a) * r, z = Math.cos(a) * r * 0.9 + 60; if (Math.abs(x) < 40 && z < 30 && z > -80) continue; const w = sr(18, 46); s.building({ x, z, w, d: sr(18, 46), h: sr(18, 150) * (r < 350 ? 1.3 : 0.7), fac: sr() < 0.5 ? 'tx_glass_tower' : 'tx_fac_office', solid: false, facTile: 18 }); }
    for (const [x, z, w, d] of [[-70, 0, 14, 2000], [0, 90, 2000, 16], [160, 0, 12, 2000], [0, -200, 2000, 10], [-300, 0, 10, 2000]]) s.box({ x, y: 0, z, w, h: 0.3, d, mat: { color: 0x2a2a2e }, cast: false });
    s.water({ y: 0.4, color: 0x2a8fa0, w: 220, d: 140, x: -160, z: 200 });

    const g = s.g = new Grip(s, { char: 'ch_agent', offset: [0, 0, 0.3], u: -5, v: Y0, range: { u: [-9, 9], v: [Y0, TOP] }, speed: 1.9, drainMove: 0.052, bracePose: 'cling', fallMsg: 'Fell from the 125th floor', injury: 1 });
    const padL = handPad(s, g.c, 'LeftHand', 0x2090ff), padR = handPad(s, g.c, 'RightHand', 0x2090ff);
    s.cam.follow(g.camTarget(0), { dist: 8, height: 2.4, yaw: 1.0, up: 0.9, ahead: 0, fov: 70, ground: false, stiff: 4 }); s.introFocus = V3(-5, Y0 + 1, 0.4);
    s.audio.set('wind', 'wind', 0.8, 0.25);
    // sandstorm: a wall of sand that closes round the tower
    const veil = new THREE.Mesh(new THREE.SphereGeometry(260, 20, 12), new THREE.MeshBasicMaterial({ color: 0xc09a62, side: THREE.BackSide, transparent: true, opacity: 0, depthWrite: false, fog: false })); veil.renderOrder = -5; s.scene.add(veil);
    const fog0 = s.scene.fog.color.clone(), sandC = new THREE.Color(0xc09a62), sv = V3(26, -2, 6), sp = V3();
    for (const t of [5, 11.5, 17.5, 23, 29.5, 35, 40.5, 46, 50.5, 55, 59]) { const dir = t % 2 > 1 ? 1 : -1; g.gust(t, { label: 'WIND GUST!', power: 0.3, kick: [dir * 0.25, 0, 0.1], failLabel: 'PEELED OFF THE GLASS!', onHit: () => { g.u = clamp(g.u + dir * 1.2, -9, 9); g.v = Math.max(Y0, g.v - 0.8); } }); }
    let glove = 2, won = false; s.objective('Climb 11 floors to the server room window'); s.hud.readout('glv', 'GLOVES', '2 / 2', 'ok');
    s.onUpdate((dt) => {
      if (!s.started) return; const t = s.t - s.t0, k = smooth(18, LIMIT, t); veil.position.copy(s.camera.position); veil.material.opacity = k * 0.97; s.scene.fog.density = 0.00045 + k * k * 0.03; s.scene.fog.color.copy(fog0).lerp(sandC, clamp(k * 1.5));
      if (k > 0.15) for (let i = 0; i < Math.round(k * 5); i++) s.fx.streak(sp.set(g.world.x - rnd(4, 20), g.world.y + rnd(-5, 7), g.world.z + rnd(-1, 7)), sv, [0.8, 0.65, 0.42], 0.6, 0.12 + k * 0.2, 0.3);
      s.audio.set('wind', 'wind', 0.8 + k * 0.6, 0.25 + k * 0.5);
      if (s.ended || won) return; const fl = Math.floor((g.v - Y0) / FH + 0.02);
      s.hud.readout('fl', 'FLOOR', 119 + fl, ''); s.hud.readout('tm', 'STORM IN', Math.max(0, LIMIT - t).toFixed(0) + 's', t > LIMIT - 15 ? 'warn' : '');
      if (k > 0.4) g.u = clamp(g.u + k * 0.22 * dt, -9, 9); // the storm leans on you
      if (glove === 2 && g.v > Y0 + 5.4 * FH) { glove = 1; g.drainK = 2; padL?.material.color.setRGB(3, 0.1, 0.05); s.hud.readout('glv', 'GLOVES', '1 / 2', 'warn'); s.audio.bad(); s.objective('One glove dead — everything costs double'); g.lose(0.15, 'LEFT GLOVE — RED IS DEAD'); s.fx.sparks(g.world.clone().add(V3(-0.3, 1.9, 0)), 10, { color: [1, 0.2, 0.1], speed: 3 }); }
      if (g.v >= TOP - 0.03 && Math.abs(g.u - WX) < 1.0) { won = true; g.done = true; s.hud.prompt(''); g.off.z = -0.6; g.v = TOP + 0.15; g.c.setPose('crouch', 0.3); s.msg('IN!', 'good'); gripScores(s, g, { time: [38, 7, 24], timeW: 1.5 }); s.bonus('Beat the storm', Math.round(clamp((LIMIT - t - 8) / 20) * 2500)); s.wrap(1.6); }
      else if (g.v >= TOP - 0.03) g.promptText = 'The open window is to the ' + (g.u < WX ? 'RIGHT →' : '← LEFT'); else g.promptText = '';
      if (t > LIMIT && !g.dead) { g.dead = true; g.detach(V3(9, 2, 4)); s.hud.prompt(''); s.fail('The sandstorm hit with you still on the glass', { injury: 1 }); }
    });
    s.dbg = () => ({ u: +g.u.toFixed(1), fl: +((g.v - Y0) / FH).toFixed(1), grip: +g.grip.toFixed(2), stam: +g.stam.toFixed(2) }); s.WX = WX;
  },
  bot(s, inp, B) { const g = s.g; inp.x = 0; inp.y = 0; if (botBrace(g, inp) || botRest(g, B, 0.12, 0.5)) return; inp.y = 1; const dx = s.WX - g.u; if (Math.abs(dx) > 0.35) inp.x = Math.sign(dx); },
};

// ---------------------------------------------------------------------------------------------
const mixPose = (a, b, k) => { const o = {}; for (const key in a) o[key] = a[key].map((v, i) => v + ((b[key]?.[i] ?? v) - v) * k); return o; };
const a400 = {
  id: 'mi_a400', title: 'Open The Door', film: 'Mission: Impossible – Rogue Nation', year: 2015, tier: 6, pay: 50000, mode: 'grip', art: 'bd_alps', music: 'spy',
  role: 'Doubling the agent on the outside of a military transport at take-off',
  brief: 'The package is on that aircraft, the aircraft is leaving, and the door is shut. So you hang on to the outside until someone opens it. One cable, eight takes if we are unlucky. Do not let go.',
  tips: ['You cannot climb anywhere — just <b>hold SPACE</b> for every jolt the moment it is called, and let go again straight after.', 'Bracing burns stamina and it never comes back in this wind. <b>Clenching the whole way = empty arms</b> before the door opens.', 'When the door slides open, <b>tap E as the marker crosses the green</b> to swing inside.'],
  controls: `hold ${K('SPACE')} brace &nbsp; ${K('E')} swing in through the door`, intro: { r: 16, h: 3, a0: -2.2, speed: 0.06, up: 0.5, fov: 50 },
  assets: { models: ['a400m', 'ch_agent', 'jeep_gc', 'van_white'], tex: ['bd_alps', 'tx_grass', 'tx_asphalt', 'tx_concrete', 'tx_metal', 'tx_fac_office'] },
  build(s) {
    s.env('day', { backdrop: 'bd_alps', look: 'teal_orange', fog: 0.0007, hz: 0.44, sun: [38, -65] });
    s.ground({ tex: 'tx_grass', tile: 9 });
    s.road({ z0: 260, z1: -2300, width: 46, lanes: 2, markColor: 0xf0f0f0 }); for (let z = 200; z > -2300; z -= 300) s.box({ x: 0, y: 0, z, w: 46, h: 0.05, d: 1.2, mat: { color: 0xdddddd }, cast: false });
    for (const [x, z, w, d, h] of [[-110, 40, 60, 40, 16], [-120, -60, 50, 50, 14], [120, -20, 44, 70, 18], [-105, -200, 30, 30, 9]]) s.building({ x, z, w, d, h, fac: 'tx_metal', solid: false, facTile: 9, roofMat: { tex: 'tx_metal', color: 0x889098 } });
    s.cyl({ x: 92, y: 0, z: 80, r: 3, h: 26, mat: 'tx_concrete' }); s.box({ x: 92, y: 26, z: 80, w: 9, h: 4, d: 9, mat: { glass: true, color: 0x7fb0c0, opacity: 0.7 } });
    s.forest('tree:pine', 420, r => { const sd = r() < 0.5 ? -1 : 1; return [sd * (70 + r() * r() * 500), 300 - r() * 2700]; }, { h: [9, 17], seedv: 3 }); s.forest('tree:oak', 160, r => [(r() < 0.5 ? -1 : 1) * (50 + r() * 300), -300 - r() * 2100], { h: [7, 12], seedv: 5 });
    s.put('jeep_gc', { x: -30, z: 30, ry: -0.6 }); s.put('van_white', { x: -34, z: 22, ry: 0.4 }); s.crew({ x: -27, z: 14, ry: -2.2 });
    // aircraft
    const ac = grp(s.scene, 0, 0, 0); s.put('a400m', { parent: ac, len: 54, ry: -Math.PI / 2 }); /* this model's nose is on -X and its 'length' is the wingspan */ const DX = -3.2, DY = 2.3, DZ = 5.6;
    const dk = s.mat({ color: 0x0a0c0e, rough: 1 }), grey = s.mat({ color: 0x7c848a, rough: 0.5, metal: 0.4 });
    s.box({ parent: ac, x: DX + 0.05, y: DY, z: DZ, w: 0.1, h: 2.0, d: 1.25, mat: dk }); const door = s.box({ parent: ac, x: DX - 0.03, y: DY, z: DZ, w: 0.08, h: 2.0, d: 1.25, mat: grey });
    s.box({ parent: ac, x: DX - 0.14, y: DY + 1.72, z: DZ - 0.72, w: 0.06, h: 0.06, d: 0.5, mat: { color: 0xd8c020, metal: 0.5 } });
    const HP = V3(DX - 0.3, DY + 1.75, DZ - 0.75); // the grab handle the hands stay on
    let v = 0, pitch = 0, pitchT = 0, roll = 0, rollT = 0, vy = 0, t = 0, doorK = 0, phase = 0, hauls = 0, won = false; const carry = V3();
    s.onUpdate(dt => {
      if (!s.started) return; t = s.t - s.t0; if (!s.ended || won) { v = Math.min(70, v + (t > 1 ? 5.9 : 2) * dt); }
      pitch = damp(pitch, pitchT, 1.2, dt); roll = damp(roll, rollT + Math.sin(t * 1.7) * 0.03 * (ac.position.y > 5 ? 1 : 0), 1.6, dt); vy = v * Math.sin(pitch) * 0.9;
      ac.position.z -= v * Math.cos(pitch) * dt; ac.position.y = Math.max(0, ac.position.y + vy * dt); ac.position.x += -roll * v * 0.25 * dt; ac.rotation.set(pitch, 0, roll); ac.updateMatrixWorld(true); carry.set(0, vy, -v);
      s.audio.set('eng', 'jet', 0.6 + v / 70 * 0.7, 0.5); s.audio.set('wind', 'wind', 0.7 + v / 70, v / 70 * 0.6); if (v > 20) s.engine.addShake(v / 70 * 0.035);
    });
    const A = { ...POSES.cling, body: [0.25, 0, 0], aR: [0.25, 0.75, 0.6, 0.0, 0.9, 0.4], aL: [0.25, 0.75, 0.6, 0.0, 0.9, 0.4] }, F = POSES.flag, Fb = { ...POSES.flag, lR: [0.15, -0.6, 0.6, 0.05, -1, -0.5], lL: [0.15, -0.8, 0.4, 0.05, -1, -0.5], sp: [0.3, 0, 0] }, Fs = { ...POSES.flag, aL: [0.7, -0.5, -0.3, 0.4, -0.8, -0.2], sp: [0, 0, 0.3] };
    const g = s.g = new Grip(s, { char: 'ch_agent', anchor: ac, plane: 'zy', offset: [HP.x, HP.y - 2, HP.z + 0.4], regen: 0, drainIdle: 0.011, drainBrace: 0.1, movePose: null, pose: A, bracePose: A, slipPose: null, fallMsg: 'Peeled off the fuselage', injury: 1, tiredDrain: 0.2, gripRegen: 0 });
    g.carry = carry;
    s.onUpdate(dt => { // streaming back in the slipstream: pivot about the hands, not the feet
      const k = smooth(6, 60, v), th = lerp(0.25, 1.32, k) + Math.sin(s.t * 9) * 0.03 * k, c = g.c, R = 1.2, hh = c.hipH || 0.95; if (g.free || won) return;
      g.o.pose = mixPose(A, F, k); g.o.pose.body = [th, 0, 0]; g.o.bracePose = mixPose(A, Fb, k); g.o.bracePose.body = [th * 0.9, 0, 0]; if (g._slipT > 0) { const sl = mixPose(A, Fs, k); sl.body = [th, 0.25, 0]; c.setPose(sl, 0.1); }
      g.off.set(HP.x, HP.y - hh - Math.cos(th) * R, HP.z + Math.sin(th) * R);
    });
    s.cam.follow(g.camTarget(0), { dist: 9, height: 1.2, yaw: -Math.PI / 2 + 0.75, up: 1.0, ahead: 0, fov: 62, ground: true, stiff: 40, lookStiff: 40 }); s.introFocus = V3(-3, 2.6, 8);
    // scripted jolts
    const birds = []; const flock = () => { const m = s.mat({ color: 0x1c1c1c }); for (let i = 0; i < 14; i++) { const b = s.box({ x: g.world.x + rnd(-5, 2), y: g.world.y + 1 + rnd(-2, 3) + vy * 0.9, z: g.world.z - v * 0.95 + rnd(-12, 12), w: 0.9, h: 0.08, d: 0.3, mat: m }); birds.push(b); } };
    const G = (tt, label, o = {}) => g.gust(tt, { label, power: 0.3, ...o });
    G(4.5, 'RUNWAY JOLT!', { kick: [0, -0.2, 0], sfx: 'thud', power: 0.22 }); G(9, 'CROSSWIND!', { kick: [-0.3, 0, 0], on: () => { rollT = 0.05; s.after(1, () => rollT = 0); } });
    G(13, 'ROTATION — NOSE UP!', { power: 0.34, sfx: 'thud', kick: [0, -0.3, 0.2], on: () => { pitchT = 0.21; s.objective('Airborne. Hang on until the door opens'); } });
    G(16.5, 'GEAR UP!', { sfx: 'impact', kick: [0, 0.2, 0] }); s.after(0, () => { }); 
    G(19.6, 'BIRD STRIKE!', { power: 0.36, sfx: 'punch', failLabel: 'BIRD IN THE FACE!', on: () => { s.fx.debris(g.world.clone().add(V3(0, 1.5, -1)), 14, { color: 0xeeeeee, size: 0.1, speed: 5, floor: -100 }); } });
    G(22.6, 'BANKING HARD!', { kick: [-0.3, 0, 0], on: () => { rollT = -0.32; pitchT = 0.14; } }); G(25.2, 'LOOSE PANEL!', { power: 0.36, sfx: 'crash', on: () => { s.fx.debris(g.world.clone().add(V3(0, 1.5, -2)), 10, { color: 0x8a9298, size: 0.4, speed: 8, floor: -100 }); s.fx.sparks(g.world.clone().add(V3(0.3, 2, -1.5)), 20); } });
    G(27.8, 'TURBULENCE!', { kick: [0, -0.35, 0], on: () => { rollT = 0.22; } }); G(30.2, 'BUFFET!', { kick: [0, 0.3, 0.2], on: () => { rollT = 0; pitchT = 0.1; } });
    s.objective('Hang on — brace for every jolt');
    s.onUpdate(dt => {
      if (!s.started) return; s.hud.readout('kt', 'KNOTS', Math.round(v * 1.944), ''); s.hud.readout('alt', 'ALT FT', ftOf(ac.position.y), '');
      if (t > 18.6 && !birds.length) flock(); if (s.ended) { s.hud.hideBar(); return; }
      if (phase === 0 && t > 32) { phase = 1; s.msg('DOOR OPEN!', 'good'); s.audio.thud?.(1); s.objective('Tap E on the green to swing inside'); }
      if (phase >= 1) { doorK = damp(doorK, 1, 3, dt); door.position.z = DZ + doorK * 1.3; }
      if (phase === 1 && doorK > 0.8) {
        const m = 0.5 + 0.5 * Math.sin((t - 32) * 3.6); s.hud.bar(m, [0.4, 0.6], [0.46, 0.54]); g.promptText = `${K('E')} swing in on the green`;
        if (s.input.hit('x')) { const acc = near(m, 0.5, 0.04, 0.1); if (Math.abs(m - 0.5) <= 0.1) { phase = 2; won = true; g.done = true; g.promptText = ''; s.hud.prompt(''); s.hud.hideBar(); s.rate('Swing-in timing', 0.6 + 0.4 * acc - hauls * 0.2, 1); gripScores(s, g, { braceW: 2 }); s.bonus('First attempt', hauls ? 0 : 3000); s.msg('INSIDE!', 'good'); s.audio.thud?.(1); g.c.setPose('crouch', 0.25); s.wrap(1.8); } else { hauls++; g.lose(0.22, 'MISSED THE DOOR FRAME'); } }
      }
      if (phase === 2) { g.off.x = damp(g.off.x, DX + 0.9, 5, dt); g.off.y = damp(g.off.y, DY + 0.05, 5, dt); g.off.z = damp(g.off.z, DZ, 5, dt); }
    });
    s.dbg = () => ({ t: +t.toFixed(1), v: +v.toFixed(0), y: +ac.position.y.toFixed(0), grip: +g.grip.toFixed(2), stam: +g.stam.toFixed(2), phase }); s.bar = () => 0.5 + 0.5 * Math.sin((t - 32) * 3.6);
  },
  bot(s, inp) { const g = s.g; botBrace(g, inp, 0.3); if (s.dbg().phase === 1 && Math.abs(s.bar() - 0.5) < 0.035) inp.press('x'); },
};

// ---------------------------------------------------------------------------------------------
const cliffhanger = {
  id: 'cliffhanger', title: 'The Transfer', film: 'Cliffhanger', year: 1993, tier: 6, pay: 70000, mode: 'grip', art: 'bd_clouds', music: 'epic',
  role: 'Crossing a line between two aircraft at fifteen thousand feet',
  brief: 'Two aircraft, one cable, fifteen thousand feet, a hundred and fifty knots and it is minus twenty out there. Nobody has ever done this and the insurers say nobody will again. Go hand over hand to the small jet. Once.',
  tips: ['Hold <b>D</b> to go hand over hand along the cable to the small jet on the right.', 'When the jets drift apart the line <b>snaps taut</b> — hold SPACE the moment it is called, then move again.', 'The cold eats your stamina and it <b>never comes back</b>. Do not dawdle, do not over-brace.'],
  controls: `${K('D')} along the cable &nbsp; ${K('A')} back &nbsp; hold ${K('SPACE')} brace`, intro: { r: 17, h: 3, a0: 0.5, speed: 0.05, up: 1, fov: 55 },
  assets: { models: ['a400m', 'learjet', 'ch_agent'], tex: ['bd_clouds', 'tx_snow', 'tx_rock'] },
  build(s) {
    s.env('high', { backdrop: 'bd_clouds', look: 'cold', fog: 0.00016, hz: 0.5, sun: [42, 150] }); s.course.base = () => -1e6;
    const SPD = 78; // m/s, faked: the world goes past the aircraft
    const peaks = (x, z) => -2300 + Math.abs(Math.sin(x * 0.0021 + 1) * Math.cos(z * 0.0016)) * 900 + Math.sin(x * 0.006 + z * 0.004) * 220 + Math.sin(z * 0.011) * 90;
    const land = s.terrain({ x0: -5000, x1: 5000, z0: -9000, z1: 1500, res: 125, fn: peaks, mat: { tex: 'tx_snow', color: 0xe8eef6 }, tile: 260, base: false });
    const big = grp(s.scene, -24, 0, 0), small = grp(s.scene, 12, -2.2, 2); s.put('a400m', { parent: big, len: 54, ry: -Math.PI / 2 }); s.put('learjet', { parent: small });
    const dk = s.mat({ color: 0x07090b, rough: 1 }); s.box({ parent: big, x: 3.16, y: 2.3, z: 5.6, w: 0.1, h: 2.0, d: 1.25, mat: dk }); s.box({ parent: small, x: -0.78, y: 0.95, z: -1.2, w: 0.12, h: 1.0, d: 0.7, mat: dk });
    const A = V3(), Bp = V3(), H = V3(), P = V3(), c1 = rope(s, 0.022, 0x1a1a1a), c2 = rope(s, 0.022, 0x1a1a1a);
    let t = 0, drift = 0, driftV = 0, driftT = 0, won = false;
    s.onUpdate(dt => {
      if (s.started) t = s.t - s.t0; land.position.z += SPD * dt * 0.6;
      driftV += ((driftT - drift) * 9 - driftV * 2.4) * dt; drift += driftV * dt;
      big.position.y = Math.sin(s.t * 0.7) * 0.35; big.rotation.z = Math.sin(s.t * 0.5) * 0.025; small.position.set(12 + drift + Math.sin(s.t * 0.9) * 0.5, -2.2 + Math.sin(s.t * 1.3 + 1) * 0.5 + drift * 0.25, 2 + Math.sin(s.t * 0.6) * 0.6); small.rotation.z = Math.sin(s.t * 1.1) * 0.06 - driftV * 0.03;
      A.set(big.position.x + 3.2, big.position.y + 4.25, 5.6); Bp.set(small.position.x - 0.85, small.position.y + 1.95, small.position.z - 1.2);
      if (Math.random() < 0.3) s.fx.cloudPuff(P.set(rnd(-180, 180), rnd(-90, 5), s.camera.position.z - 320), V3(0, 0, SPD * 2.2), rnd(60, 140));
    });
    const LEN = 31.5;
    const g = s.g = new Grip(s, { char: 'ch_agent', range: { u: [0, LEN], v: [0, 0] }, u: 0.5, speed: 1.3, heading: -Math.PI / 2, pose: 'hang', idleCycle: 'hang', movePose: 'hang', moveRate: 2.6, bracePose: 'hoseswing', regen: 0, drainIdle: 0.017, drainMove: 0.022, drainBrace: 0.09, gripRegen: 0.02, fallMsg: 'Lost the cable at 15,000 feet', injury: 1, tiredDrain: 0.25 });
    g.carry = V3(0, 0, 14);
    s.onUpdate(dt => {
      if (g.free) return; const k = clamp(g.u / LEN), sag = (0.35 + clamp(1.6 - drift, 0, 4) * 0.55) * 4 * k * (1 - k) + 0.12;
      H.lerpVectors(A, Bp, k); H.y -= sag; if (!won) g.off.set(H.x - g.u, H.y - 2.12, H.z); c1.set(A, H); c2.set(H, Bp);
      const ph = s.t * 7; g.c.over = g.moving ? { aR: [0.2, 1, 0.1 + 0.4 * Math.sin(ph), 0.02, 1, 0.05 + 0.35 * Math.sin(ph)], aL: [0.2, 1, 0.1 - 0.4 * Math.sin(ph), 0.02, 1, 0.05 - 0.35 * Math.sin(ph)] } : null;
      if (s.started && Math.random() < 0.5) s.fx.streak(P.set(g.world.x + rnd(-8, 8), g.world.y + rnd(-3, 5), g.world.z - 30), V3(0, 0, 110), [1, 1, 1], 0.5, 0.06, 0.25);
    });
    s.cam.follow(g.camTarget(0), { dist: 12.5, height: 2.6, yaw: 0.22, up: 1.6, ahead: 0, fov: 62, ground: false, stiff: 5 }); s.introFocus = V3(-12, 1, 5);
    s.audio.set('jet', 'jet', 1, 0.45); s.audio.set('wind', 'wind', 1.5, 0.6);
    const ev = [[4, 'TURBULENCE!', 0], [8.5, 'LINE SNAPS TAUT!', 1], [13, 'WAKE VORTEX!', 0], [17.5, 'LINE SNAPS TAUT!', 1], [21.5, 'JET WASH!', 0], [25.5, 'LINE SNAPS TAUT!', 1], [29.5, 'TURBULENCE!', 0], [33.5, 'LINE SNAPS TAUT!', 1], [37.5, 'JET WASH!', 0], [41.5, 'LINE SNAPS TAUT!', 1], [45.5, 'TURBULENCE!', 0], [49, 'LINE SNAPS TAUT!', 1], [52, 'TURBULENCE!', 0], [55, 'TURBULENCE!', 0]];
    for (const [tt, label, snap] of ev) { if (snap) s.after(0, () => { }); g.gust(tt, { label, power: snap ? 0.36 : 0.3, sfx: snap ? 'thud' : 'whoosh', kick: snap ? [0, 0.7, 0] : [0, -0.3, 0.4], failLabel: snap ? 'WHIPPED OFF THE LINE!' : 'ONE HAND OFF!', on: () => { if (snap) { driftT = 2.6; driftV = 6; s.after(1.6, () => driftT = -1.2); s.after(3.2, () => driftT = 0); } else { small.position.y -= 0.4; driftV -= 2; } } }); }
    s.objective('Cross the cable to the small jet');
    s.onUpdate(() => {
      if (!s.started || s.ended) return; s.hud.readout('m', 'METRES TO GO', Math.max(0, LEN - g.u).toFixed(0), ''); s.hud.readout('alt', 'ALT FT', 15000 + Math.round(g.world.y * 3.3), ''); s.hud.readout('tmp', 'TEMP', '-21°C', g.stam < 0.3 ? 'warn' : '');
      if (g.stam < 0.25) g.promptText = '<span style="color:#9fd0ff">FREEZING — keep moving</span>'; else g.promptText = '';
      if (g.u >= LEN - 0.02) { won = true; g.done = true; s.hud.prompt(''); g.c.over = null; gripScores(s, g, { time: [30, 4, 22], braceW: 2 }); s.rate('Strength left', clamp(g.stam * 3 + 0.25), 0.7); s.bonus('Most expensive stunt in the book', 5000); s.msg('MADE IT ACROSS!', 'good'); g.c.setPose('crouch', 0.3); small.attach(g.c.root); s.wrap(1.8); }
    });
    s.dbg = () => ({ u: +g.u.toFixed(1), grip: +g.grip.toFixed(2), stam: +g.stam.toFixed(2), drift: +drift.toFixed(1) });
  },
  bot(s, inp) { const g = s.g; inp.x = 0; if (!botBrace(g, inp, 0.3)) inp.x = 1; },
};

// ---------------------------------------------------------------------------------------------
const deathProof = {
  id: 'death_proof', title: "Ship's Mast", film: 'Death Proof', year: 2007, tier: 5, pay: 22000, mode: 'grip', art: 'bd_georgia', music: 'chase',
  role: 'On the bonnet of a white 1970 Challenger, two belts and no harness',
  brief: "It's called Ship's Mast. You lie on the hood, you hold two belts, she drives. Then a maniac in a black Charger turns up and starts ramming us — and you, my darling, stay on that hood.",
  tips: ['The car swerves and you slide: use <b>A / D</b> to stay in the middle of the bonnet. Hanging off an edge shreds your grip.', 'The Charger swings in before every ram — <b>hold SPACE</b> as it is called. Braced, you cannot shuffle.', 'Bracing stops the slide but empties your arms in seconds. <b>Brace the rams, steer the swerves.</b>'],
  controls: `${K('A')}${K('D')} shuffle across the bonnet &nbsp; hold ${K('SPACE')} brace`, intro: { r: 7.5, h: 2.4, a0: 2.6, speed: 0.1, up: 0.6 },
  assets: { models: ['challenger_white', 'charger_black', 'ch_bride', 'ch_stunt'], tex: ['bd_georgia', 'tx_grass', 'tx_asphalt', 'tx_wood', 'tx_dirt'] },
  build(s) {
    s.env('day', { backdrop: 'bd_georgia', look: 'warm60s', fog: 0.0016, hz: 0.45, lookOver: { grain: 0.09, sat: 1.15 } });
    s.ground({ tex: 'tx_grass', tile: 6 }); s.road({ z0: 90, z1: -1900, width: 8.4, lanes: 2, double: true, markColor: 0xe0c040 });
    for (const sd of [-1, 1]) { s.box({ x: sd * 5.4, y: 0, z: -900, w: 2.2, h: 0.04, d: 2000, mat: { tex: 'tx_dirt', color: 0xb09a78 }, tile: 4, cast: false }); }
    s.forest('tree:oak', 520, r => { const sd = r() < 0.5 ? -1 : 1; return [sd * (9 + Math.pow(r(), 1.6) * 110), 100 - r() * 2000]; }, { h: [8, 15], seedv: 6 }); s.forest('tree:bush', 200, r => [(r() < 0.5 ? -1 : 1) * (7.5 + r() * 30), 100 - r() * 2000], { h: [1.2, 2.6], seedv: 8 });
    const wood = s.mat({ tex: 'tx_wood', color: 0x8a7a66 }); for (let z = 60; z > -1900; z -= 55) { s.cyl({ x: -7.2, y: 0, z, r: 0.13, h: 8, mat: wood }); s.box({ x: -7.2, y: 7.2, z, w: 1.8, h: 0.1, d: 0.1, mat: wood }); }
    for (const [x, z] of [[30, -260], [-36, -640], [34, -1100], [-30, -1500]]) { s.building({ x, z, w: 12, d: 16, h: 6, fac: 'tx_wood', solid: false, facTile: 5, roofMat: { color: 0x7a2a22 } }); }
    s.crew({ x: 7.5, z: 6, ry: 0.9 });
    const car = grp(s.scene, 0, 0, 12), bad = grp(s.scene, -3.4, 0, 22); s.put('challenger_white', { parent: car }); s.put('charger_black', { parent: bad }); s.char('ch_stunt', { parent: car, x: -0.42, y: 0.05, z: 0.25, pose: 'sit' });
    let v = 0, t = 0, x0 = 0, jolt = 0, joltV = 0, px = 0, pvx = 0, ax = 0, side = -1, sideT = -1, rx = -3.4, rz = 9, swing = 0, uv = 0, sumU = 0, nU = 0, edgeT = 0, over = false; const P = V3(), Q = V3(), carry = V3();
    const swerve = tt => { const k = smooth(2, 6, tt); return k * (1.05 * Math.sin(tt * 0.9) + 0.55 * Math.sin(tt * 2.3 + 1)); };
    s.onUpdate(dt => {
      if (!s.started) return; t = s.t - s.t0; v = damp(v, over ? 40 : 34, 0.8, dt); car.position.z -= v * dt;
      joltV += (-jolt * 40 - joltV * 7) * dt; jolt += joltV * dt; const nx = swerve(t) + jolt, nv = dt > 0 ? (nx - px) / dt : 0; ax = damp(ax, dt > 0 ? (nv - pvx) / dt : 0, 12, dt); pvx = nv; px = nx; car.position.x = nx; car.rotation.y = -nv / Math.max(8, v) * 1.6; car.rotation.z = clamp(ax * 0.012, -0.08, 0.08); carry.set(nv, 0, -v);
      // the Charger: hangs off the rear quarter, crosses behind, swings in to ram
      side = damp(side, sideT, 1.4, dt); const cross = Math.abs(side) < 0.75; rx = damp(rx, side * (over ? 6 : lerp(3.5, 2.08, swing)), 7, dt); rz = damp(rz, over ? 40 : cross ? 7.5 : 0.6 + Math.sin(t * 0.8) * 0.5, over ? 0.6 : 2.2, dt);
      bad.position.set(car.position.x + rx, 0, car.position.z + rz); bad.rotation.y = (over ? t * 3 : -(swing > 0.3 ? sideT * 0.12 : 0)) + car.rotation.y;
      if (v > 10 && Math.random() < 0.4) { s.fx.dust(P.set(car.position.x + rnd(-1, 1), 0.1, car.position.z + 2.6), 1, { color: [0.75, 0.7, 0.6], size: 1.2, a: 0.18 }); }
      if (over && Math.random() < 0.7) s.fx.smokePuff(P.copy(bad.position), 1, { color: [0.7, 0.7, 0.7], size: 2, a: 0.4 });
      s.audio.set('eng', 'engine', 0.7 + v / 34 * 0.8, 0.5); s.audio.set('wind', 'wind', 1, v / 34 * 0.35); if (v > 10) s.engine.addShake(0.02);
    });
    const BY = 0.9, EDGE = 0.8, prone = { ...POSES.prone, aR: [0.75, 1, 0.05, 0.3, 1, 0.1], aL: [0.75, 1, 0.05, 0.3, 1, 0.1], lR: [0.3, -1, -0.03, 0.2, -1, -0.03], lL: [0.3, -1, -0.03, 0.2, -1, -0.03] }, tight = { ...POSES.prone, aR: [1, 0.7, 0.05, 0.6, 1, 0.1], aL: [1, 0.7, 0.05, 0.6, 1, 0.1], lR: [0.7, -1, -0.03, 0.5, -1, -0.03], lL: [0.7, -1, -0.03, 0.5, -1, -0.03], hd: [-0.2, 0, 0] };
    const g = s.g = new Grip(s, { char: 'ch_bride', anchor: car, plane: 'xz', offset: [0, BY, -1.5], range: { u: [-EDGE - 0.08, EDGE + 0.08], v: [0, 0] }, speed: 1.05, flipU: true, heading: Math.PI, pose: prone, movePose: null, bracePose: tight, slipPose: null, drainMove: 0.02, drainBrace: 0.2, regen: 0.09, gripRegen: 0.02, fallMsg: 'Thrown off the bonnet at 75 mph', injury: 1 });
    g.carry = carry; const b1 = rope(s, 0.018, 0x3a2a1a), b2 = rope(s, 0.018, 0x3a2a1a);
    s.onUpdate(dt => {
      if (g.free) { b1.visible = b2.visible = false; return; } car.updateMatrixWorld(true);
      g.c.bonePos('LeftHand', P); b1.set(Q.set(-0.88, 1.12, -0.5).applyMatrix4(car.matrixWorld), P); g.c.bonePos('RightHand', P); b2.set(Q.set(0.88, 1.12, -0.5).applyMatrix4(car.matrixWorld), P);
      if (!s.started || s.ended) return;
      uv += -ax * (g.braced ? 0.05 : 0.2) * dt; uv *= Math.exp(-(g.braced ? 9 : 2.4) * dt); g.u = clamp(g.u + uv * dt, -EDGE - 0.08, EDGE + 0.08);
      prone.body = [1.5, 0, clamp(uv * 0.35, -0.4, 0.4)]; sumU += Math.abs(g.u) * dt; nU += dt;
      if (Math.abs(g.u) >= EDGE) { edgeT += dt; g.grip = clamp(g.grip - 0.42 * dt); uv *= 0.5; g.promptText = '<span style="color:#ff6a5a">GOING OVER THE WING!</span> — get back to the middle'; if (g.grip <= 0) g.fall(); } else g.promptText = '';
      s.hud.readout('mph', 'MPH', Math.round(v * 2.237), ''); s.hud.bar(0.5 - g.u / (EDGE * 2.2), [0.3, 0.7], [0.43, 0.57]);
    });
    s.cam.follow(() => ({ pos: car.position, heading: 0 }), { dist: 6.4, height: 2.7, side: -1.6, yaw: Math.PI, up: 1.0, ahead: 0, fov: 64, stiff: 30, lookStiff: 30 }); s.introFocus = V3(0, 0.6, 11);
    const rams = [5, 9, 13.5, 17, 21.5, 25, 28.5, 32, 35.5], flips = [11, 19.2, 26.6, 33.6];
    for (const tt of rams) { s.after(0, () => { }); g.gust(tt, { label: 'RAM!', power: 0.34, sfx: 'crash', shake: 1.3, failLabel: 'SLAMMED ACROSS THE HOOD!', on: () => { joltV = -sideT * 9; swing = 0; s.fx.sparks(P.set(car.position.x + sideT * 1.05, 0.7, car.position.z + 0.6), 26); s.fx.debris(P, 5, { color: 0x222222, size: 0.12 }); }, onHit: () => { uv += -sideT * 2.6; } }); }
    s.onUpdate(() => { if (!s.started) return; for (const tt of rams) if (t > tt - 0.8 && t < tt) swing = damp(swing, 1, 6, s.dt); for (let i = 0; i < flips.length; i++) if (t > flips[i]) sideT = i % 2 ? -1 : 1;
      if (!s.ended && t > 38.5 && !over) { over = true; s.hud.hideBar(); g.done = true; s.hud.prompt(''); s.msg('LOST HIM!', 'good'); gripScores(s, g, { braceW: 2 }); s.rate('Middle of the bonnet', clamp(1.3 - (sumU / Math.max(1, nU)) / 0.42), 1.5); s.rate('Stayed off the edges', clamp(1 - edgeT / 2.5), 1); s.bonus('No harness', 1500); s.wrap(2.2); } });
    s.objective('Stay on the bonnet until she shakes him off');
    s.dbg = () => ({ t: +t.toFixed(1), u: +g.u.toFixed(2), grip: +g.grip.toFixed(2), stam: +g.stam.toFixed(2) });
  },
  bot(s, inp) { const g = s.g; inp.x = 0; if (botBrace(g, inp, 0.3)) return; if (Math.abs(g.u) > 0.12) inp.x = Math.sign(g.u); },
};

// ---------------------------------------------------------------------------------------------
const furyRoad = {
  id: 'fury_road', title: 'Polecat', film: 'Mad Max: Fury Road', year: 2015, tier: 5, pay: 27000, mode: 'grip', art: 'bd_wasteland', music: 'chase',
  role: 'Polecat — on top of a thirty-foot pole swinging over the War Rig',
  brief: 'The pole is a metronome with you on the end of it. It swings out over the rig, you take a fuel pod off the rack, it swings you home. All of it for real, at fifty miles an hour, in the Namib. Three pods. Go.',
  tips: ['The pole swings by itself. <b>Tap E as the marker crosses the gold</b> — that is the bottom of the swing, right over the rig.', 'Grab at the wrong moment and you snatch air and nearly come off. <b>Three pods</b> to take.', 'Explosions and collisions are called a moment ahead: <b>hold SPACE</b>. You cannot grab while braced, so pick your swing.'],
  controls: `${K('E')} snatch at the bottom of the swing &nbsp; hold ${K('SPACE')} brace`, intro: { r: 19, h: 6, a0: 0.9, speed: 0.07, up: 3, fov: 50 },
  assets: { models: ['tanker', 'charger_black', 'charger_dom', 'ch_roadwarrior', 'ch_goon', 'rock_desert'], tex: ['bd_wasteland', 'tx_sand', 'tx_metal', 'tx_dirt'] },
  build(s) {
    s.env('desert', { backdrop: 'bd_wasteland', look: 'wasteland', fog: 0.0014, hz: 0.46 });
    s.ground({ tex: 'tx_sand', tile: 14, color: 0xe0a060 });
    s.forest('rock_desert', 170, r => { const sd = r() < 0.5 ? -1 : 1; return [sd * (16 + r() * r() * 160), 60 - r() * 1900]; }, { h: [1.5, 7], seedv: 12 }); s.forest('tree:dead', 80, r => [(r() < 0.5 ? -1 : 1) * (14 + r() * 120), 60 - r() * 1900], { h: [3, 6], seedv: 14 });
    s.crew({ x: -13, z: 4, ry: -1 });
    const SPD = 26, L = 9.5, TH = 1.25, PER = 4.4, PX = -5.6;
    const cv = grp(s.scene, 0, 0, 0), rig = grp(cv, 3.1, 0, 0), pc = grp(cv, PX, 0, 4), esc = grp(cv, 9.5, 0, 6), rear = grp(cv, -2, 0, 17);
    s.put('tanker', { parent: rig }); s.put('charger_black', { parent: pc }); s.put('charger_dom', { parent: esc }); s.put('charger_dom', { parent: rear });
    const iron = s.mat({ tex: 'tx_metal', color: 0x6a5a4a, rough: 0.7, metal: 0.5 }), rust = s.mat({ color: 0x5a3020, rough: 0.9 }), glow = s.mat({ color: 0xff9020, emissive: 0xff7010, emI: 2.2 });
    for (const sx of [-1, 1]) { const a = s.box({ parent: pc, x: sx * 0.55, y: 1.35, z: 0.4, w: 0.1, h: 2.3, d: 0.1, mat: iron }); a.rotation.z = sx * 0.27; } s.box({ parent: pc, x: 0, y: 1.3, z: 0.4, w: 1.9, h: 0.12, d: 1.3, mat: rust });
    const piv = grp(pc, 0, 3.5, 0.4), tip = grp(piv, 0, L, 0); s.cyl({ parent: piv, y: -1.5, r: 0.07, r1: 0.05, h: L + 1.5, mat: iron, seg: 8 }); s.cyl({ parent: piv, y: -1.9, r: 0.42, h: 0.75, mat: rust, seg: 10 }); s.cyl({ parent: piv, y: 0, r: 0.16, h: 0.9, rx: Math.PI / 2, mat: rust }); s.box({ parent: tip, y: -0.5, x: 0, w: 0.5, h: 0.06, d: 0.3, mat: iron });
    s.char('ch_goon', { parent: rig, x: 0.2, y: 4.3, z: 6.2, heading: Math.PI / 2, pose: 'guard' });
    // fuel pods on racks along the top of the tank
    const pods = [-3.6, 0.6, 4.6].map(z => { const o = grp(rig, 0.25, 4.3, z); for (const sx of [-0.3, 0.3]) s.box({ parent: o, x: sx, y: 0, w: 0.06, h: 1.3, d: 0.06, mat: iron }); const pod = s.cyl({ parent: o, y: 1.3, r: 0.26, h: 0.75, mat: glow, seg: 10 }); return { z, o, pod }; });
    let t = 0, v = 0, ph = 0, n = 0, armed = false, cool = 0, shove = 0, shoveV = 0, sumAcc = 0, won = false, th = 0; const P = V3(), carry = V3();
    s.onUpdate(dt => {
      if (s.started) { t = s.t - s.t0; v = damp(v, SPD, 1.2, dt); ph += dt / PER; } cv.position.z -= v * dt; carry.set(0, 0, -v);
      shoveV += (-shove * 30 - shoveV * 5) * dt; shove += shoveV * dt;
      const tz = won ? 7 : pods[Math.min(n, 2)].z + 0.05; pc.position.z = damp(pc.position.z, tz, 0.9, dt); pc.position.x = PX + shove + (won ? -Math.min(2.5, (t - wonT) * 2) : 0) + Math.sin(s.t * 1.3) * 0.12; armed = !won && t > 6 && Math.abs(pc.position.z - tz) < 0.5 && cool <= 0; cool -= dt;
      th = TH * Math.sin(ph * 2 * Math.PI) * (s.started ? smooth(0, 2.5, t) * 0.25 + 0.75 : 0.5); piv.rotation.z = -th;
      esc.position.x = 9.5 + Math.sin(s.t * 0.7) * 1.2; esc.position.z = 6 + Math.sin(s.t * 0.4) * 5; rear.position.x = -2 + Math.sin(s.t * 0.5 + 2) * 2.5; rig.rotation.z = Math.sin(s.t * 2.1) * 0.006;
      if (v > 5) for (const [o, dz, k] of [[rig, 7, 3], [pc, 2.3, 1], [esc, 2.3, 1], [rear, 2.3, 1]]) if (Math.random() < 0.5 * k) s.fx.dust(P.set(cv.position.x + o.position.x + rnd(-1, 1), 0.2, cv.position.z + o.position.z + dz), 1, { color: [0.85, 0.58, 0.32], size: 2.6 * (k > 1 ? 1.6 : 1), a: 0.3, up: 2.5 });
      s.audio.set('eng', 'engine', 0.6 + v / SPD * 0.5, 0.55); s.audio.set('rm', 'rumble', 1, 0.4); if (v > 5) s.engine.addShake(0.025);
    });
    let wonT = 0;
    const g = s.g = new Grip(s, { char: 'ch_roadwarrior', anchor: tip, offset: [0, -1.45, 0.24], pose: 'cling', movePose: null, bracePose: { ...POSES.cling, sp: [0.5, 0, 0], hd: [0.3, 0, 0] }, regen: 0.07, drainBrace: 0.18, gripRegen: 0.02, fallMsg: 'Thrown off the pole under the wheels', injury: 1 });
    g.carry = carry; s.introFocus = V3(-2, 4, 2);
    s.cam.follow(() => ({ pos: P2.set(cv.position.x - 2.4, 0, cv.position.z + 1.5), heading: 0 }), { dist: 15.5, height: 6.2, side: -1.5, up: 4.6, ahead: 0, fov: 60, stiff: 30, lookStiff: 30 }); const P2 = V3();
    const boom = (dx, dz, sc) => () => { s.fx.explosion(P.set(cv.position.x + dx, 0.6, cv.position.z + dz), sc); s.audio.explosion?.(1); s.engine.flash(0.4); };
    const slam = () => { shoveV = 7; s.audio.crash(1); s.fx.sparks(P.set(cv.position.x + 1.0, 1, cv.position.z + pc.position.z), 30); };
    for (const [tt, label, on, pw] of [[3.2, 'EXPLOSION!', boom(-9, -14, 1.5), 0.3], [7.4, 'COLLISION!', slam, 0.34], [11.0, 'EXPLOSION!', boom(-3, -16, 1.8), 0.34], [14.6, 'COLLISION!', slam, 0.34], [18.2, 'THUNDERSTICK!', boom(-7, -10, 1.4), 0.36], [21.8, 'COLLISION!', slam, 0.34], [25.4, 'EXPLOSION!', boom(-10, -15, 2), 0.36], [29, 'COLLISION!', slam, 0.34], [32.6, 'EXPLOSION!', boom(-4, -14, 1.6), 0.36], [36.2, 'COLLISION!', slam, 0.34], [39.8, 'EXPLOSION!', boom(-8, -12, 1.8), 0.36], [43.4, 'COLLISION!', slam, 0.34], [47, 'EXPLOSION!', boom(-8, -12, 1.8), 0.36]]) g.gust(tt, { label, power: pw, sfx: 'impact', shake: 1.2, on, failLabel: 'NEARLY SHAKEN OFF!' });
    const reach = { ...POSES.cling, sp: [0.6, 0.5, 0.3], aR: [0.9, -0.5, 0.5, 0.8, -0.8, 0.4] }, LIMIT = 50;
    s.objective('Snatch 3 fuel pods off the War Rig');
    s.onUpdate(dt => {
      if (!s.started || s.ended) { if (s.ended) s.hud.hideBar(); return; } const m = (ph + 0.25) % 1; s.bar = m;
      s.hud.bar(m, [0.43, 0.57], [0.478, 0.522]); s.hud.readout('pods', 'PODS', n + ' / 3', ''); s.hud.readout('tm', 'TIME', Math.max(0, LIMIT - t).toFixed(0), t > LIMIT - 10 ? 'warn' : '');
      g.promptText = armed ? `${K('E')} snatch on the gold` : '<span style="opacity:.6">lining up on the next pod…</span>';
      if (s.input.hit('x') && armed && !g.braced) {
        const d = Math.abs(m - 0.5);
        if (d <= 0.07) { const acc = near(d, 0, 0.022, 0.075); sumAcc += acc; const pd = pods[n]; pd.pod.visible = false; n++; cool = 6.5; s.audio.good(); s.fx.sparks(tip.getWorldPosition(P), 16, { color: [1, 0.6, 0.2] }); s.msg(acc > 0.9 ? 'PERFECT SNATCH!' : 'GOT ONE!', 'good'); s.slowmo(0.5, 0.35); g.c.setPose(reach, 0.06); g._slipT = 0.5; s.bonus('Fuel pods', 600);
          if (n >= 3) { won = true; wonT = t; g.done = true; s.hud.prompt(''); s.hud.hideBar(); s.rate('Snatch timing', 0.45 + 0.55 * sumAcc / 3, 2); gripScores(s, g, { time: [28, 6, 20] }); s.rate('Clean hands', 1 - misses * 0.3, 1); s.msg('WITNESS!', 'huge'); s.wrap(2.2); } }
        else { misses++; cool = 0.8; g.c.setPose(reach, 0.06); g.lose(0.2, 'SNATCHED AIR!'); }
      }
      if (t > LIMIT && !won) { g.done = true; s.hud.prompt(''); s.fail('Too slow — the War Rig pulled away with the fuel', { injury: 0 }); }
    });
    let misses = 0; s.dbg = () => ({ t: +t.toFixed(1), n, grip: +g.grip.toFixed(2), stam: +g.stam.toFixed(2), armed }); s.armed = () => armed;
  },
  bot(s, inp) { const g = s.g; if (botBrace(g, inp, 0.3)) return; if (s.armed() && Math.abs(s.bar - 0.5) < 0.012 && g.incoming() > 0.5) inp.press('x'); },
};

// ---------------------------------------------------------------------------------------------
const policeStory = {
  id: 'police_story', title: 'The Pole Of Lights', film: 'Police Story', year: 1985, tier: 2, pay: 4500, mode: 'grip', art: 'bd_hk', music: 'kungfu',
  role: 'Doubling the Hong Kong cop — one take, three cameras, live bulbs',
  brief: 'Top floor of the mall. You jump from the railing to the pole, slide down through the lights and go through the glass roof of the kiosk. The bulbs are mains voltage and they will explode. We only have the mall for one night.',
  tips: ['Keep your balance on the railing with <b>A / D</b>, then <b>hold SPACE to wind up and release on the gold</b> to leap.', 'On the pole, <b>hold SPACE to grip</b>. Friction burns: grabbing at high speed cooks your hands, so brake early and often.', 'Let go through the <b>sparking junction boxes</b>, and hit the kiosk roof at a survivable speed.'],
  controls: `${K('A')}${K('D')} balance &nbsp; ${K('SPACE')} wind up / release to leap &nbsp; then hold ${K('SPACE')} to grip the pole`, intro: { r: 9, h: 1.5, a0: 1.2, speed: 0.08, up: 0.8, fov: 55 },
  assets: { models: ['ch_hk', 'ch_goon'], tex: ['bd_hk', 'tx_fac_mall', 'tx_concrete', 'tx_metal', 'tx_wood'] },
  build(s) {
    s.env('indoor', { look: 'vhs80s', fog: 0.003, amb: 0.9, sunI: 0.9, top: 0x1a1612, hor: 0x2a2420, lookOver: { bloom: 0.28 } });
    s.ground({ tex: 'tx_concrete', tile: 5, color: 0xd8cdb8, rough: 0.35 });
    const FH = 5, NF = 6, TOPY = NF * FH, HALF = 7, PXp = -3.3, CEIL = TOPY + 5.2, KR = 2.8;
    const wall = s.mat({ tex: 'tx_fac_mall', rep: 1, emissive: 0xffe2b0, emI: 0.55, emMap: true, rough: 0.6 }), brass = s.mat({ color: 0xd8b060, metal: 0.9, rough: 0.25 }), slab = s.mat({ color: 0xe8e0d0, rough: 0.5 }), gl = s.mat({ glass: true, color: 0xbfe6ee, opacity: 0.28 });
    for (const [x, z, w, d] of [[-HALF - 3.5, 0, 1, 22], [HALF + 3.5, 0, 1, 22], [0, -HALF - 3.5, 22, 1], [0, HALF + 3.5, 22, 1]]) s.box({ x, y: 0, z, w, h: CEIL, d, mat: wall, tile: 9.2, tileY: 9.2, cast: false });
    s.box({ x: 0, y: CEIL, z: 0, w: 22, h: 0.3, d: 22, mat: { color: 0xfff4d8, emissive: 0xfff0d0, emI: 0.45 }, cast: false });
    for (let k = 1; k <= NF; k++) { const y = k * FH; for (const [x, z, w, d] of [[-HALF - 1.5, 0, 3, 20], [HALF + 1.5, 0, 3, 20], [0, -HALF - 1.5, 14, 3], [0, HALF + 1.5, 14, 3]]) { s.box({ x, y: y - 0.4, z, w, h: 0.4, d, mat: slab, tile: 4 }); const ix = x ? Math.sign(x) * HALF : 0, iz = z ? Math.sign(z) * HALF : 0; s.box({ x: ix, y, z: iz, w: x ? 0.05 : 14, h: 0.95, d: x ? 14 : 0.05, mat: gl, cast: false }); s.box({ x: ix, y: y + 0.95, z: iz, w: x ? 0.09 : 14.1, h: 0.07, d: x ? 14.1 : 0.09, mat: brass, cast: false }); s.box({ x: ix, y: y - 0.55, z: iz, w: x ? 0.12 : 14.1, h: 0.55, d: x ? 14.1 : 0.12, mat: { color: 0xff5a8a, emissive: 0xff3070, emI: k % 2 ? 1.2 : 0.4 }, cast: false }); } }
    for (const [x, y, z, c] of [[5, 6, 5, 0xffc080], [-5, 15, -5, 0xffd0a0], [5, 24, -4, 0xffc080], [0, 3.5, 5, 0xa0d0ff], [-2, 31, 4, 0xffe0b0]]) s.light({ x, y, z, color: c, i: 30, dist: 30, bulb: false });
    // the pole and its strings of bulbs
    s.cyl({ x: PXp, y: 0, z: 0, r: 0.075, h: CEIL, mat: brass, seg: 10 });
    const bulbs = []; for (let y = KR + 0.5, i = 0; y < TOPY + 3.6; y += 0.2, i++) bulbs.push([PXp + Math.cos(i * 0.9) * 0.24, y, Math.sin(i * 0.9) * 0.24]);
    const nSpiral = bulbs.length; for (const [ex, ez] of [[HALF, HALF], [HALF, -HALF], [-HALF, HALF], [-HALF, -HALF], [HALF, 0]]) for (let i = 1; i < 26; i++) { const k = i / 26; bulbs.push([lerp(PXp, ex, k), lerp(TOPY + 3.6, TOPY + 1.1, k) - Math.sin(k * Math.PI) * 1.6, lerp(0, ez, k)]); }
    const bm = new THREE.InstancedMesh(new THREE.SphereGeometry(0.075, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }), bulbs.length), M = new THREE.Matrix4(), col = new THREE.Color(); const PAL = [[1.9, 1.5, 0.6], [1.9, 0.5, 0.4], [0.5, 1.5, 1.9], [1.7, 1.8, 0.9]];
    bulbs.forEach((b, i) => { M.makeTranslation(b[0], b[1], b[2]); bm.setMatrixAt(i, M); const c = PAL[i % 4]; bm.setColorAt(i, col.setRGB(c[0], c[1], c[2])); }); bm.frustumCulled = false; s.scene.add(bm);
    const JB = [25.5, 19.6, 13.6, 7.8].map(y => { const m = s.box({ x: PXp, y: y - 0.25, z: 0, w: 0.4, h: 0.5, d: 0.4, mat: { color: 0x303030, emissive: 0x40a0ff, emI: 1 } }); return { y, m, hit: false }; });
    // kiosk at the bottom
    const kio = grp(s.scene, PXp, 0, 0); const kroof = s.box({ parent: kio, y: KR - 0.06, w: 3.4, h: 0.06, d: 3.4, mat: gl }); for (const [x, z] of [[-1.7, -1.7], [1.7, -1.7], [-1.7, 1.7], [1.7, 1.7]]) s.box({ parent: kio, x, y: 0, z, w: 0.1, h: KR, d: 0.1, mat: brass });
    const kwalls = [[0, -1.7, 3.4, 0.04], [0, 1.7, 3.4, 0.04], [-1.7, 0, 0.04, 3.4], [1.7, 0, 0.04, 3.4]].map(([x, z, w, d]) => s.box({ parent: kio, x, y: 0.9, z, w, h: KR - 0.9, d, mat: gl })); s.box({ parent: kio, y: 0, w: 3.3, h: 0.9, d: 3.3, mat: { tex: 'tx_wood', color: 0xb08050 } }); s.box({ parent: kio, y: KR, z: 1.75, w: 3.4, h: 0.5, d: 0.1, mat: { color: 0xffe060, emissive: 0xffc020, emI: 1.6 } });
    for (const [x, z] of [[4.5, 3], [3, -4.5], [-5.5, 4.5]]) { s.cyl({ x, y: 0, z, r: 0.7, h: 0.6, mat: slab }); s.forest('tree:palm', 1, () => [x, z, 0.5], { h: [3.2, 3.6], seedv: x + 9 }); }
    s.crew({ x: 4.5, z: -1.5, ry: -1.2 });
    const RX = -HALF, RY = TOPY + 1.02; const c = s.char('ch_hk', { x: RX, y: RY, z: 0, heading: -Math.PI / 2 }); c.setPose('ready', 0);
    const thugs = [s.char('ch_goon', { x: -9.3, y: TOPY, z: -7, heading: Math.PI, pose: 'guard' }), s.char('ch_goon', { x: -9.6, y: TOPY, z: 7.5, heading: 0, pose: 'guard' })];
    const pos = c.root.position, focus = V3().copy(pos); s.focus = focus; s.introFocus = V3(RX, RY, 0);
    s.cam.follow(() => ({ pos: focus, heading: 0 }), { dist: 5.6, height: 2.0, yaw: 0.95, up: 0.5, ahead: 0, fov: 64, ground: false, stiff: 5 });
    let shoved = 0, phase = 0, t = 0, bal = 0, balV = 0, charge = 0, chT = 0, charging = false, vx = 0, vy = 0, v = 0, heat = 0, slideT = 0, bi = nSpiral - 1, wob = 0, balSum = 0, leapQ = 0, shocks = 0, gripping = false, endV = 0; const P = V3();
    const die = (msg, vel) => { if (phase === 9) return; phase = 9; s.hud.prompt(''); s.hud.hideBar(); c.setCycle('flail', 1); c.tumble(3, 1, 2); vx = vel?.[0] ?? 0; vy = vel?.[1] ?? -v; s.audio.whoosh(1); s.fail(msg, { injury: 0.9 }); };
    s.objective('Balance on the railing…'); s.dbg = () => ({ phase, y: +pos.y.toFixed(1), v: +v.toFixed(1), heat: +heat.toFixed(2), bal: +bal.toFixed(2), charge: +charge.toFixed(2) });
    s.st = () => ({ phase, bal, balV, charge, y: pos.y, v, heat, JB, t });
    s.onUpdate(dt => {
      focus.lerp(pos, 1 - Math.exp(-12 * dt)); for (const j of JB) j.m.material.emissiveIntensity = j.hit ? 0 : 1.5 + Math.sin(s.t * 18 + j.y) * 1.2;
      if (!s.started) return; t = s.t - s.t0; const inp = s.input;
      if (phase === 0) { // balance on the railing while the thugs close in
        wob += dt; balV += (bal * 2.6 + Math.sin(wob * 2.3) * 0.9 + Math.sin(wob * 5.1 + 1) * 0.6 + inp.x * 4.2) * dt; balV *= Math.exp(-0.8 * dt); bal += balV * dt; balSum += Math.abs(bal) * dt;
        c.setPose({ ...POSES.ready, body: [0, bal * 0.5, 0], aR: [1, 0.2 - bal * 0.6, 0.1, 1, 0.3 - bal * 0.5, 0.1], aL: [1, 0.2 + bal * 0.6, 0.1, 1, 0.3 + bal * 0.5, 0.1] }, 0.08); pos.z = bal * 0.25;
        thugs[0].root.position.z = Math.min(-1.6, -7 + t * 0.7); thugs[1].root.position.z = Math.max(1.8, 7.5 - t * 0.72); thugs[0].setCycle(t < 7.6 ? 'run' : 'guard', 7); thugs[1].setCycle(t < 7.6 ? 'run' : 'guard', 7);
        for (const ts of [3, 5.6]) if (t > ts && shoved < ts) { shoved = ts; balV += (bal >= 0 ? 1 : -1) * 1.5; s.msg('THEY ARE GRABBING AT YOU!', 'bad'); s.engine.addShake(0.5); s.audio.punch?.(0.6); }
        if (Math.abs(bal) > 1) return die('Lost your balance and fell off the railing', [0.6, 0]);
        const ready = t > 7.5; if (ready && !charging) { s.objective('Leap for the pole!'); s.hud.prompt(`hold ${K('SPACE')} to wind up — release on the gold`); }
        if (ready && inp.a) { charging = true; chT += dt; charge = 1 - Math.abs(1 - (chT * 1.25) % 2); s.hud.bar(charge, [0.5, 0.82], [0.6, 0.72]); }
        else if (charging) { // released: commit
          s.hud.hideBar(); s.hud.prompt(''); phase = 1; leapQ = near(charge, 0.66, 0.06, 0.3); vx = 3.2 + 5.2 * charge; vy = 2.4; c.setPose('leap', 0.1); s.audio.whoosh(1); s.rate('Balance', clamp(1.25 - balSum / 1.6), 0.6); s.slowmo(0.55, 0.5);
        } else if (!ready) s.hud.bar(0.5 + bal * 0.5, [0.25, 0.75], [0.42, 0.58]);
      } else if (phase === 1) { // in the air
        vy -= 9.5 * dt; pos.x += vx * dt; pos.y += vy * dt; pos.z = damp(pos.z, 0, 6, dt);
        if (charge < 0.36 && pos.x > PXp - 1.2) { vx *= 0.3; return die('Fell short of the pole', [vx, vy]); }
        if (pos.x >= PXp - 0.32) { pos.x = PXp - 0.3; phase = 2; v = Math.max(1.5, -vy); c.setPose('cling', 0.08); s.audio.impact(0.6); s.engine.addShake(0.6); s.objective('Slide! Hold SPACE to brake'); if (charge > 0.86) { heat += 0.22; s.msg('SLAMMED INTO THE POLE', 'bad'); s.engine.hurt(0.3); } else if (charge < 0.5) { heat += 0.14; s.msg('BY YOUR FINGERTIPS!', 'bad'); } else s.msg('ON THE POLE!', 'good'); s.rate('Leap', 0.3 + 0.7 * leapQ, 1); }
      } else if (phase === 2) { // the slide
        slideT += dt; gripping = inp.a; v = Math.max(0, v + (9.5 - (gripping ? 17.5 : 1.2)) * dt); if (gripping && v < 0.25) v = 0.25; pos.y -= v * dt;
        heat = clamp(heat + (gripping ? 0.02 * v * v + 0.03 : -0.085) * dt); c.setPose(gripping ? { ...POSES.cling, sp: [0.35, 0, 0] } : { ...POSES.cling, lR: [0.3, -0.9, 0.5, 0.05, -1, -0.2], lL: [0.3, -1, 0.3, 0.05, -1, -0.2] }, 0.1);
        P.set(pos.x + 0.3, pos.y + 1.7, pos.z); if (gripping && v > 1 && Math.random() < 0.5) { s.fx.sparks(P, 2, { speed: 3 }); if (Math.random() < 0.2) s.fx.smokePuff(P, 1, { size: 0.5, a: 0.25, up: 1 }); }
        while (bi >= 0 && bulbs[bi][1] > pos.y + 0.9) { M.makeScale(0, 0, 0); bm.setMatrixAt(bi, M); bm.instanceMatrix.needsUpdate = true; if (bi % 2 === 0) { P.set(bulbs[bi][0], bulbs[bi][1], bulbs[bi][2]); s.fx.sparks(P, 5, { speed: 4, color: [1, 0.9, 0.5] }); } if (bi % 5 === 0) { s.audio.glass?.(0.3); s.fx.glass(P, 4, { speed: 2 }); s.engine.flash(0.08); } bi--; }
        let near1 = null; for (const j of JB) { const d = pos.y + 1.6 - j.y; if (!j.hit && d < 0.45 && d > -0.5) { if (gripping) { j.hit = true; shocks++; heat = clamp(heat + 0.24); s.msg('SHOCK!', 'bad'); s.engine.flash(0.6); s.engine.hurt(0.4); s.engine.addShake(1); s.audio.crash(0.6); P.set(PXp, j.y, 0); s.fx.sparks(P, 50, { speed: 9, color: [0.6, 0.8, 1] }); } } else if (!j.hit && d < -0.5) j.hit = 'passed'; if (!j.hit && d > 0 && d < 3.5) near1 = j; }
        s.hud.prompt(near1 ? `<span style="color:#7fc8ff">JUNCTION BOX</span> — let go!` : heat > 0.75 ? '<span style="color:#ff6a5a">HANDS BURNING</span>' : `hold ${K('SPACE')} to grip`);
        s.hud.meter('heat', 'Hands', heat, { color: heat > 0.75 ? '#e23b2e' : '#f29a3e' }); s.hud.readout('spd', 'MPH', Math.round(v * 2.237), v > 6.5 ? 'warn' : 'ok'); s.hud.readout('fl', 'FLOOR', Math.max(0, Math.ceil(pos.y / FH)), '');
        if (heat >= 1) return die('Hands burned through — let go of the pole', [0.5, -v]);
        if (v > 10) return die('Lost control of the slide and came off the pole', [1, -v]);
        if (pos.y <= KR) { // through the glass
          endV = v; kroof.visible = false; kwalls.forEach(w => w.visible = false); P.set(PXp, KR, 0); s.fx.glass(P, 90, { speed: 6 }); s.fx.sparks(P, 40, { speed: 8 }); s.audio.glass(1); s.audio.crash(1); s.engine.addShake(1.6); s.slowmo(0.4, 0.8);
          if (v > 7) { phase = 9; vy = -v; vx = 1.5; c.setCycle('flail', 1); s.hud.prompt(''); return s.fail(`Went through the kiosk at ${Math.round(v * 2.237)} mph`, { injury: 0.9 }); }
          phase = 3; vy = -v; vx = 1.8; c.setPose('land', 0.15); s.hud.prompt('');
          s.rate('Landing speed', near(v, 3.6, 1.6, 7), 1.5); s.rate('Hands', clamp(1.15 - heat), 1.2); s.rate('Pace', near(slideT, 9, 1.5, 8), 1); s.rate('Junction boxes', 1 - shocks / 3, 0.8); s.bonus('Every bulb on the pole', 400); s.msg('CUT! PRINT IT!', 'good'); s.wrap(2.4);
        }
      } else if (phase === 3) { vy -= 9.5 * dt; pos.y = Math.max(0.9, pos.y + vy * dt); if (pos.y <= 0.9) { pos.x = Math.min(PXp + 2.6, pos.x + vx * dt); vx *= Math.exp(-2 * dt); c.setPose('crouch', 0.25); } }
      else if (phase === 9) { vy -= 9.5 * dt; pos.x += vx * dt; pos.y += vy * dt; const fl = pos.x > PXp - 1.8 && pos.x < PXp + 1.8 ? 0.9 : 0; if (pos.y <= fl) { pos.y = fl; vx = 0; vy = 0; c.tumble(0, 0, 0); c.spinAng.set(0, 0, 0); c.setPose('lie', 0.1); if (!endV) { endV = 1; s.audio.impact(1); s.engine.addShake(1.2); } } }
    });
  },
  bot(s, inp) {
    const d = s.st(); inp.a = false; inp.x = 0;
    if (d.phase === 0) { inp.x = clamp(-(d.bal * 3 + d.balV * 1.2), -1, 1); if (d.t > 7.6) inp.a = !(d.charge > 0.63 && d.charge < 0.7); }
    else if (d.phase === 2) { let vt = 3.1, inJ = false; for (const j of d.JB) { if (j.hit) continue; const dd = d.y + 1.6 - j.y; if (dd < 0.6 && dd > -0.6) inJ = true; else if (dd > 0 && dd < 2.2) vt = 2.2; } if (d.y < 5.5) vt = 3; inp.a = !inJ && d.v > vt; }
  },
};

// ---------------------------------------------------------------------------------------------
const raidersTruck = {
  id: 'raiders_truck', title: 'Under The Truck', film: 'Raiders of the Lost Ark', year: 1981, tier: 3, pay: 8500, mode: 'grip', art: 'bd_egypt', music: 'western',
  role: 'Doubling the archaeologist — over the bonnet, under the truck and back again',
  brief: 'You have just gone through the windscreen. So: over the front, down the grille, under the truck hand over hand, out the back on the whip, up the tailgate and along the side to the cab. We dug a trench down the road so you fit underneath. Mostly.',
  tips: ['Follow the route with <b>W A S D</b> — down the grille, <b>A</b> back along the chassis, <b>D</b> up the whip, <b>W</b> up the tailgate, <b>D</b> to the cab.', 'Every rut and swerve is called a moment ahead: <b>hold SPACE</b>, then move again. You cannot move while braced.', 'Being dragged on the whip drains you fast — <b>haul in as soon as you can</b> and rest only when you must.'],
  controls: CTL.grip, intro: { r: 9, h: 2.2, a0: 1.9, speed: 0.08, up: 0.8 },
  assets: { models: ['ww2_truck', 'ch_adventurer', 'ch_goon', 'jeep_gc', 'rock_desert'], tex: ['bd_egypt', 'tx_sand', 'tx_dirt', 'tx_temple', 'tx_wood'] },
  build(s) {
    s.env('desert', { backdrop: 'bd_egypt', look: 'golden', fog: 0.0013, hz: 0.45, sun: [50, 70] });
    s.ground({ tex: 'tx_sand', tile: 12, color: 0xe6cf9e }); s.road({ z0: 80, z1: -1300, width: 7.5, marks: false, mat: { tex: 'tx_dirt', color: 0xd8b888 } });
    s.forest('tree:palm', 150, r => { const sd = r() < 0.5 ? -1 : 1; return [sd * (7 + Math.pow(r(), 2) * 70), 80 - r() * 1380]; }, { h: [6, 11], seedv: 5 }); s.forest('rock_desert', 90, r => [(r() < 0.5 ? -1 : 1) * (9 + r() * 90), 80 - r() * 1380], { h: [0.8, 4], seedv: 7 });
    const mud = s.mat({ tex: 'tx_temple', color: 0xe0c898 }); srand(31); for (let z = -60; z > -1300; z -= sr(70, 150)) { const sd = sr() < 0.5 ? -1 : 1, x = sd * sr(12, 26), w = sr(5, 9), h = sr(3, 5.5); s.box({ x, y: 0, z, w, h, d: sr(5, 9), mat: mud, tile: 5 }); s.box({ x: x + sd * 1.5, y: h, z: z + 1, w: w * 0.5, h: 1.6, d: 3, mat: mud, tile: 5 }); }
    for (const [x, z] of [[-14, -240], [15, -700]]) for (let i = 0; i < 4; i++) { s.cyl({ x: x + i * 2.6 * Math.sign(-x), y: 0, z: z - i * 0.4, r: 0.55, h: 6.5 - (i % 2) * 2.5, mat: mud, seg: 12 }); }
    s.crew({ x: 7, z: 4, ry: 1.2 });
    const truck = grp(s.scene, 0, 0, 0), lead = grp(s.scene, 0, 0, -24); s.put('ww2_truck', { parent: truck }); s.put('jeep_gc', { parent: lead }); s.char('ch_goon', { parent: truck, x: -0.45, y: 0.95, z: -1.05, pose: 'sit' });
    let v = 0, t = 0, bounce = 0, bV = 0, sway = 0, swayV = 0; const carry = V3(), P = V3(), Q = V3();
    s.onUpdate(dt => {
      if (s.started) { t = s.t - s.t0; v = damp(v, 17, 1.5, dt); } truck.position.z -= v * dt; lead.position.z = truck.position.z - 24 + Math.sin(s.t * 0.5) * 3;
      bV += (-bounce * 90 - bV * 9) * dt; bounce += bV * dt; swayV += (-sway * 30 - swayV * 4) * dt; sway += swayV * dt;
      truck.position.y = Math.max(0, bounce) + Math.abs(Math.sin(s.t * 13)) * 0.012 * v / 17; truck.rotation.x = bV * 0.012; truck.position.x = sway + Math.sin(s.t * 0.6) * 0.35; truck.rotation.z = -swayV * 0.02; truck.updateMatrixWorld(true); carry.set(0, 0, -v);
      if (v > 4) { for (const dz of [-1.9, 1.7]) if (Math.random() < 0.6) s.fx.dust(P.set(truck.position.x + rnd(-1, 1), 0.15, truck.position.z + dz + 1), 1, { color: [0.86, 0.74, 0.52], size: 2, a: 0.28, up: 2 }); if (Math.random() < 0.5) s.fx.dust(P.set(lead.position.x, 0.2, lead.position.z + 2.5), 1, { color: [0.86, 0.74, 0.52], size: 2.2, a: 0.25 }); }
      s.audio.set('eng', 'engine', 0.55 + v / 17 * 0.35, 0.5); s.audio.set('rm', 'rumble', 0.9, 0.3); if (v > 4) s.engine.addShake(0.02);
    });
    const RAIL = [[2.3, 1.6, 0], [3.05, 1.5, 0], [3.42, 0.5, 0], [2.4, 0.12, 0.42], [-2.9, 0.12, 0.42], [-7.4, 0.03, 0], [-4.25, 0.08, 0], [-3.42, 0.72, 0], [-3.0, 0.78, 1.42], [0.75, 0.78, 1.42]];
    const g = s.g = new Grip(s, { char: 'ch_adventurer', anchor: truck, plane: 'zy', rail: RAIL, speed: 1.35, drainMove: 0.05, pose: 'prone', movePose: null, slipPose: null, fallMsg: 'Lost the truck and went under the wheels', injury: 1 });
    g.carry = carry; s.introFocus = V3(0, 1.3, -1.5);
    s.cam.follow(g.camTarget(0), { dist: 7.2, height: 0.9, yaw: Math.PI / 2 - 0.12, up: 0.9, ahead: 0, fov: 60, stiff: 30, lookStiff: 12 });
    const whip = rope(s, 0.016, 0x2a1a0e); whip.visible = false;
    const under = k => ({ ...POSES.lie, hd: [0.4, 0, 0], aR: [0.25, 0.45 + 0.4 * Math.sin(k), 1, 0.08, 0.7 + 0.3 * Math.sin(k), 1], aL: [0.25, 0.45 - 0.4 * Math.sin(k), 1, 0.08, 0.7 - 0.3 * Math.sin(k), 1], lR: [0.12, -1, 0.05, 0.05, -1, 0.0], lL: [0.14, -1, 0.1, 0.05, -1, -0.05] });
    const drag = k => ({ ...POSES.prone, body: [1.5, 0.12 * Math.sin(k * 0.6), 0], aR: [0.15, 1, 0.1 + 0.25 * Math.sin(k), 0.05, 1, 0.1], aL: [0.15, 1, 0.1 - 0.25 * Math.sin(k), 0.05, 1, 0.1], lR: [0.2, -1, -0.03, 0.12, -1, 0.1 * Math.sin(k * 2)], lL: [0.2, -1, -0.03, 0.12, -1, -0.1 * Math.sin(k * 2)] });
    const crawl = k => ({ ...POSES.prone, aR: [0.5, 0.8 + 0.2 * Math.sin(k), 0.1, 0.2, 1, 0.1], aL: [0.5, 0.8 - 0.2 * Math.sin(k), 0.1, 0.2, 1, 0.1] });
    const SEGNAME = ['Over the bonnet', 'Down the grille', 'Under the bumper', 'Hand over hand to the back', 'THE WHIP', 'Haul yourself in on the whip', 'Up the tailgate', 'Round the corner', 'Along the side to the cab'], KEYS = ['D', 'S', 'A', 'A', '', 'D', 'W', 'D', 'D'];
    let stage = 0, dragT = 0, ph = 0, nextG = 3, hd = 0, won = false;
    const gustFor = () => { const sg = g.seg; if (sg <= 1) return ['POTHOLE!', () => { bV = 3.2; }]; if (sg <= 3) return ['RUT!', () => { bV = 3.6; s.fx.dust(g.world, 8, { color: [0.86, 0.74, 0.52] }); }]; if (sg <= 5) return ['ROCKS!', () => { bV = 2.5; s.fx.debris(g.world, 6, { color: 0x8a7a5a, size: 0.2, speed: 5 }); s.fx.dust(g.world, 10, { color: [0.86, 0.74, 0.52] }); }]; return ['HE IS SWERVING!', () => { swayV = 5; s.fx.dust(P.set(truck.position.x, 0.2, truck.position.z), 10, { color: [0.86, 0.74, 0.52], size: 3 }); }]; };
    s.onUpdate(dt => {
      if (g.free) { whip.visible = false; return; } const sg = g.seg, c = g.c; if (g.moving || stage === 1 || stage === 2) ph += dt * 8;
      // pose + facing per section of the route
      let pose, head = 0; if (sg === 0) pose = crawl(ph); else if (sg === 1) { pose = 'cling'; head = Math.PI; } else if (sg <= 3) { pose = under(ph); head = Math.PI; } else if (sg <= 5) pose = drag(ph); else if (sg === 6) pose = null; else { pose = null; head = Math.PI / 2; }
      hd = damp(hd, head, 9, dt); c.heading = hd; g.o.pose = pose || 'cling'; g.o.bracePose = pose && sg !== 1 ? pose : { ...POSES.cling, sp: [0.45, 0, 0] }; g.o.movePose = pose ? null : 'climb';
      s.cam.set({ dist: sg === 2 || sg === 3 ? 5.4 : 7.2, height: sg === 2 || sg === 3 ? 0.5 : 0.9 }); whip.visible = sg >= 4 && sg <= 6; if (whip.visible) { c.bonePos('RightHand', P); whip.set(Q.set(0, 0.85, 3.05).applyMatrix4(truck.matrixWorld), P); }
      if (!s.started || s.ended) return;
      if (sg >= 4 && sg <= 5 && Math.random() < 0.8) s.fx.dust(P.copy(g.world).add(V3(0, 0.1, 0.8)), 1, { color: [0.86, 0.74, 0.52], size: 1.8, a: 0.4, up: 2.5 });
      if (stage === 0) { g.pMax = g.railP(4); if (g.p >= g.railP(4) - 0.01) { stage = 1; g.control = false; s.msg('THE WHIP!', 'bad'); s.audio.whoosh(1); s.objective('Dragged behind — hang on to the whip!'); } }
      else if (stage === 1) { g.p = Math.min(g.railP(5), g.p + 6 * dt); g.pMax = g.pMin = g.p; g._rail(); if (g.p >= g.railP(5)) { stage = 2; g.control = true; dragT = 0; nextG = Math.min(nextG, t + 0.4); } }
      else if (stage === 2) { dragT += dt; g.stam = clamp(g.stam - 0.15 * dt); if (dragT > 3.6) { stage = 3; g.pMax = g.railLen; g.speedK = 0.8; } }
      else if (stage === 3 && sg >= 6) g.speedK = 1;
      const nm = stage === 2 ? 'Dragged behind — brace!' : SEGNAME[sg]; s.objective(nm); g.promptText = stage === 2 || stage === 1 || !KEYS[sg] ? '' : `${K(KEYS[sg])} ${nm.toLowerCase()}`;
      if (t > nextG && stage !== 1) { const [label, on] = gustFor(); g.gust(0.85, { label, on, power: 0.3, sfx: 'thud', kick: [0, -0.12, 0], failLabel: 'NEARLY UNDER THE WHEELS!' }); nextG = t + (stage === 2 ? 1.9 : 4.4); }
      s.hud.readout('mph', 'MPH', Math.round(v * 2.237), '');
      if (g.p >= g.railLen - 0.02 && !won) { won = true; g.done = true; s.hud.prompt(''); g.c.setPose('cling', 0.2); gripScores(s, g, { time: [30, 5, 22] }); s.rate('Clean run', 1 - (g.stats.hits) * 0.3, 1); s.msg('THE TRUCK IS YOURS', 'good'); s.bonus('No trench needed', g.stats.hits ? 0 : 800); s.wrap(1.8); }
    });
    s.dbg = () => ({ seg: g.seg, p: +g.p.toFixed(1), grip: +g.grip.toFixed(2), stam: +g.stam.toFixed(2), stage });
  },
  bot(s, inp, B) { const g = s.g; inp.x = 0; inp.y = 0; if (botBrace(g, inp, 0.3) || botRest(g, B, 0.12, 0.4)) return; const R = g.rail, i = g.railSeg(Math.min(g.p + 0.03, g.railLen - 1e-3)), du = R[i + 1][0] - R[i][0], dv = R[i + 1][1] - R[i][1]; if (Math.abs(du) >= Math.abs(dv)) inp.x = Math.sign(du); else inp.y = Math.sign(dv); },
};

const ALL = [safetyLast, policeStory, raidersTruck, deathProof, burj, furyRoad, a400, cliffhanger];
// test hook: ?bot=1&lazy=1 plays the bot as a careless performer who never braces / never grips (every stunt must then fail)
if (typeof location !== 'undefined' && /[?&]lazy=1/.test(location.search)) for (const st of ALL) { const b = st.bot; st.bot = (s, inp, B) => { b(s, inp, B); if (st.id !== 'police_story' || s.st().phase >= 2) inp.a = false; }; }
export default ALL;

