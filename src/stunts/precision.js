import * as THREE from 'three';
import { clamp, near, damp, V3, rnd, sr, srand, lerp } from '../world/stage.js';
import { POSES } from '../world/character.js';
import { K, sign } from './common.js';

// ---------------------------------------------------------------------------------------------
const steamboat = {
  id: 'steamboat', title: 'The Falling House', film: 'Steamboat Bill, Jr.', year: 1928, tier: 1, pay: 1800, mode: 'custom', art: 'bd_smalltown', music: 'silent',
  role: 'The great stone face — stand still while two tons of house fall on you',
  brief: 'The whole front of the house comes down on top of you. The attic window is open. Stand on the nail and it passes clean over you with two inches each side. Half the crew won\'t watch. Don\'t flinch.',
  tips: ['Get onto the <b>chalk mark</b> — that is exactly where the open window lands.', `The cyclone shoves you about: tap ${K('A')}${K('D')} <b>against the wind</b> to hold your spot.`, 'When the wall goes you have under two seconds. <b>Within 8 cm is legend. Outside the window is the hospital.</b>'],
  controls: `${K('A')}${K('D')} shuffle left / right against the wind`, intro: { r: 13, h: 2.6, a0: 0.25, speed: 0.06, up: 2.4 },
  assets: { models: ['ch_keaton', 'camera_crew', 'film_light', 'director_chair'], tex: ['bd_smalltown', 'tx_dirt', 'tx_wood', 'tx_roof'] },
  build(s) {
    s.env('day', { backdrop: 'bd_smalltown', look: 'silent', fog: 0.006, amb: 2.4, sunI: 6.5, sun: [38, 24] });
    s.ground({ tex: 'tx_dirt', tile: 7 });
    const HZ = -4.9, W = 7.6, H = 7.2, WB = 4.25, WT = 5.65, WW = 1.04, wood = { tex: 'tx_wood', color: 0xffffff }, dk = { tex: 'tx_wood', color: 0x8a857c }, blk = { color: 0x16140f };
    // the house behind the facade (open front once the wall has gone)
    s.box({ x: 0, y: 0, z: HZ - 7.2, w: W, h: H, d: 0.25, mat: dk, tile: 3 }); for (const sx of [-1, 1]) s.box({ x: sx * (W / 2 - 0.12), y: 0, z: HZ - 3.7, w: 0.25, h: H, d: 7, mat: dk, tile: 3 }); s.box({ x: 0, y: 3.5, z: HZ - 3.7, w: W, h: 0.2, d: 7, mat: dk, tile: 3 }); s.box({ x: 0, y: H, z: HZ - 3.6, w: W + 0.8, h: 0.3, d: 7.8, mat: 'tx_roof' });
    s.box({ x: -1.6, y: 0, z: HZ - 4, w: 1.6, h: 0.9, d: 1, mat: dk }); s.box({ x: 1.8, y: 3.7, z: HZ - 5, w: 1.9, h: 0.6, d: 1, mat: wood });
    // the two-ton facade: four boards round a real window hole, hinged along the ground
    const piv = new THREE.Group(); piv.position.set(0, 0, HZ); s.scene.add(piv); const side = (W - WW) / 2;
    for (const sx of [-1, 1]) s.box({ parent: piv, x: sx * (WW / 2 + side / 2), y: 0, z: 0, w: side, h: H, d: 0.2, mat: wood, tile: 2.5 });
    s.box({ parent: piv, x: 0, y: 0, z: 0, w: WW, h: WB, d: 0.2, mat: wood, tile: 2.5 }); s.box({ parent: piv, x: 0, y: WT, z: 0, w: WW, h: H - WT, d: 0.2, mat: wood, tile: 2.5 });
    for (const [x, y, w, h] of [[-1.9, 0, 1.15, 2.3], [1.9, 1.1, 1.3, 1.5], [-2.2, 4.3, 1.1, 1.3], [2.2, 4.3, 1.1, 1.3]]) s.box({ parent: piv, x, y, z: 0.105, w, h, d: 0.02, mat: blk, cast: false });
    for (const [x, y, w, h] of [[0, WB - 0.1, WW + 0.3, 0.1], [0, WT, WW + 0.3, 0.1], [-WW / 2 - 0.1, WB, 0.1, WT - WB], [WW / 2 + 0.1, WB, 0.1, WT - WB], [0, 3.3, W, 0.14], [0, H - 0.16, W, 0.16]]) s.box({ parent: piv, x, y, z: 0.12, w, h, d: 0.05, mat: dk, cast: false });
    // the street
    srand(5); for (const sd of [-1, 1]) { let x = sd * (W / 2 + 1.2); for (let i = 0; i < 4; i++) { const w = sr(5, 8), h = sr(4.5, 8); s.box({ x: x + sd * w / 2, y: 0, z: HZ - 3.5 + sr(-0.5, 0.5), w, h, d: 7, mat: { tex: 'tx_wood', color: i % 2 ? 0xe0dccf : 0xb5afa2 }, tile: 3 }); s.box({ x: x + sd * w / 2, y: h, z: HZ - 0.2, w: w + 0.2, h: 1.1, d: 0.3, mat: dk }); s.box({ x: x + sd * w / 2, y: 0, z: HZ + 0.02, w: 1, h: 2.1, d: 0.06, mat: blk, cast: false }); for (const px of [-0.4, 0.4]) s.box({ x: x + sd * w / 2 + px * w, y: 0, z: HZ + 1.6, w: 0.14, h: 2.7, d: 0.14, mat: dk }); s.box({ x: x + sd * w / 2, y: 2.7, z: HZ + 0.9, w: w * 0.9, h: 0.1, d: 1.7, mat: dk }); x += sd * (w + sr(0.3, 1.2)); } }
    for (const [x, z, w, h] of [[-5.5, 3.6, 0.9, 0.9], [-6.3, 3.3, 0.7, 1.3], [6.4, 2.6, 1.3, 0.8]]) s.box({ x, y: 0, z, w, h, d: 0.9, mat: dk, tile: 1.5 });
    s.crew({ x: -6.5, z: 6.2, ry: -0.75 });
    const MZ = HZ + (WB + WT) / 2, ring = s.mark({ x: 0, z: MZ, r: 0.34, color: 0xffffff }); s.line({ x: 0, z: MZ, w: 0.5, d: 0.05, color: 0xffffff }); s.line({ x: 0, z: MZ, w: 0.05, d: 0.5, color: 0xffffff });
    const ch = s.me = s.char('ch_keaton', { x: 2.1, z: MZ, heading: Math.PI }); ch.setCycle('idle', 1);
    s.cam.fixed(V3(0.6, 2.2, 8.4), () => ({ pos: s.focus }), { fov: 44, up: 0 }); s.focus.set(0, 2.9, -1.5); s.introFocus = V3(0, 2.4, MZ);
    const st = s.st = { x: 2.1, vx: 0, w: 0, gust: 0, gt: 3, th: 0, fall: -1, done: false }, DROP = 17, FALLT = 1.75, p = V3(), v = V3();
    s.objective('Get on the chalk mark and hold it against the storm');
    s.onUpdate((dt, t) => {
      const el = s.started ? t - s.t0 : 0;
      // storm: slow swell + sharp gusts, always some dust in the air
      st.gt -= dt; if (st.gt <= 0) { st.gt = rnd(1.6, 3.2); st.gust = (Math.random() < 0.5 ? -1 : 1) * rnd(3, 5.2); if (s.started && !st.done) s.audio.whoosh(0.7); } st.gust = damp(st.gust, 0, 1.6, dt);
      st.w = s.started ? (2.1 * Math.sin(0.8 * el) + 1.2 * Math.sin(2.1 * el + 1) + st.gust) * clamp(el / 2) : 1.2;
      for (let i = 0; i < 2; i++) s.fx.streak(p.set(rnd(-9, 9), rnd(0.1, 5), rnd(-3, 5)), v.set(st.w * 5 + rnd(-1, 1), rnd(-0.4, 0.6), rnd(-1, 1)), [0.85, 0.85, 0.8], 0.45, 0.07, 0.3);
      if (Math.random() < 0.25) s.fx.dust(p.set(rnd(-8, 8), 0.05, rnd(-3, 4)), 1, { vel: v.set(st.w * 3, 0, 0), size: 1.0, a: 0.14, color: [0.8, 0.78, 0.72] });
      s.audio.set('storm', 'wind', 0.7 + Math.abs(st.w) * 0.08, 0.35 + Math.abs(st.w) * 0.05);
      if (!s.started) return;
      if (st.fall < 0 && el >= DROP) { st.fall = 0; s.audio.crash?.(0.5); s.engine.addShake(0.4); s.msg('THE WALL IS GOING!', 'bad'); s.objective('HOLD YOUR MARK'); }
      if (st.fall >= 0 && !st.done) {
        st.fall += dt; const k = clamp(st.fall / FALLT); st.th = Math.PI / 2 * Math.pow(k, 2.4); piv.rotation.x = st.th;
        if (k >= 1) {
          st.done = true; const err = Math.abs(st.x), cm = Math.round(err * 100), inWin = err < WW / 2 - 0.24; piv.rotation.x = Math.PI / 2 - 0.004;
          s.audio.crash?.(1.2); s.audio.thud(); s.engine.addShake(1.8); for (let i = 0; i < 26; i++) s.fx.dust(p.set(rnd(-W / 2, W / 2), 0.1, HZ + rnd(0, H)), 2, { size: 2.6, spread: 2.5, up: 2.5, color: [0.85, 0.83, 0.78] });
          if (!inWin) { ch.setPose('lie', 0.05); ch.root.position.y = -0.2; return s.fail(`${cm} cm off the mark — the wall landed on you, not around you`, { injury: 1 }); }
          ch.setPose('stand', 0.3); s.rate('On the mark', near(err, 0, 0.08, WW / 2 - 0.24), 2.4); s.rate('Did not flinch', near(Math.abs(st.vx), 0, 0.25, 1.6), 1); if (err < 0.08) s.bonus('Dead centre of the window', 500);
          s.msg(err < 0.08 ? 'NOT A SCRATCH — LEGEND' : `THROUGH THE WINDOW — ${cm} cm off`, 'huge good'); s.wrap(2.6, 'They only built the wall once.');
        }
      }
      if (st.done) return;
      st.vx += (st.w * 0.95 + s.input.x * 7.5 - st.vx * 3.2) * dt; st.x = clamp(st.x + st.vx * dt, -3.3, 3.3); ch.root.position.x = st.x;
      const sp = Math.abs(st.vx); if (sp > 0.35) { ch.setCycle('walk', 5 + sp * 3); ch.heading = Math.PI + clamp(st.vx * 0.45, -0.9, 0.9); } else { ch.setCycle('idle', 1); ch.heading = damp(ch.heading, Math.PI, 8, dt); }
      const cm = Math.round(Math.abs(st.x) * 100), left = DROP - el; ring.material.color.setScalar(Math.abs(st.x) < 0.1 ? 2.4 : 1.2);
      s.hud.readout('off', 'Off the mark (cm)', cm, cm <= 8 ? 'ok' : cm > 26 ? 'warn' : ''); s.hud.readout('wind', 'Wind', (st.w < -0.4 ? '◀ ' : '') + Math.abs(st.w * 9).toFixed(0) + ' mph' + (st.w > 0.4 ? ' ▶' : ''), Math.abs(st.w) > 3.4 ? 'warn' : '');
      if (st.fall < 0) s.hud.readout('drop', 'Wall drops in', Math.max(0, left).toFixed(1), left < 4 ? 'warn' : '');
    });
    s.dbg = () => ({ x: +st.x.toFixed(2) });
  },
  bot(s, inp) { const st = s.st; inp.x = clamp(-(st.x * 9 + st.vx * 2.6) - st.w * 0.95 / 7.5, -1, 1); },
};

// ---------------------------------------------------------------------------------------------
const FOOD = [['apple', 0xc8202a, 's', 0.1], ['milk carton', 0xf4f4ee, 'b', [0.11, 0.2, 0.11]], ['sandwich', 0xd9b46a, 'b', [0.2, 0.07, 0.2]], ['jello', 0x38d060, 'b', [0.14, 0.1, 0.14]], ['orange', 0xff8a1a, 's', 0.095], ['juice box', 0x7a3ac0, 'b', [0.1, 0.16, 0.07]], ['pudding cup', 0x7a4a22, 'c', [0.07, 0.1]], ['bread roll', 0xc99a55, 's', 0.085]];
const spidey = {
  id: 'spiderman_tray', title: 'The Lunch Tray', film: 'Spider-Man', year: 2002, tier: 1, pay: 1600, mode: 'custom', art: 'bd_nyc_night', music: 'tension',
  role: 'High-school kid with suspiciously good reflexes',
  brief: 'She slips, the lunch goes up, and you catch every piece of it on the tray. No wires, no CG — the real fella did it with glue on his hand and it took him a hundred and fifty-six takes. I\'d like it in fewer.',
  tips: ['Each item has a <b>yellow ring</b> on the floor where it will come down. Put the <b>white ring</b> (your tray) on it.', `${K('A')}${K('D')} move sideways, ${K('W')}${K('S')} move away / toward camera. Items land <b>in the order they were thrown</b>.`, 'Catch near the <b>centre of the tray</b> for full marks. Drop one and it is take two.'],
  controls: `${K('A')}${K('D')} left / right &nbsp; ${K('W')}${K('S')} back / forward`, intro: { r: 6.5, h: 2.6, up: 1 },
  assets: { models: ['ch_stunt', 'ch_bride', 'camera_crew', 'film_light', 'director_chair'], tex: ['tx_concrete', 'tx_wallpaper', 'tx_wood', 'tx_metal'] },
  build(s) {
    s.env('indoor', { look: 'neutral', amb: 1.5, sunI: 1.6, sun: [70, 20], fog: 0.00001, top: 0x30343a, hor: 0x50545a });
    s.ground({ tex: 'tx_concrete', tile: 2.2, color: 0xd9d2bf });
    const wall = { tex: 'tx_wallpaper', color: 0xe6dfc8 }, top = { tex: 'tx_wood', color: 0xd8c9a8 }, leg = { color: 0x8a8f96, metal: 0.7, rough: 0.4 }, seat = { color: 0x2f6a8a }, win = { color: 0xdff0ff, emissive: 0xcfe6ff, emI: 0.55 };
    s.box({ x: 0, y: 0, z: -9, w: 30, h: 6, d: 0.3, mat: wall, tile: 4 }); for (const sx of [-1, 1]) s.box({ x: sx * 13, y: 0, z: 0, w: 0.3, h: 6, d: 18, mat: wall, tile: 4 }); s.box({ x: 0, y: 6, z: 0, w: 30, h: 0.3, d: 18, color: 0xeeeeee, cast: false });
    for (let x = -10; x <= 10; x += 5) { s.box({ x, y: 2.2, z: -8.8, w: 3, h: 2.4, d: 0.1, mat: win, cast: false }); s.box({ x, y: 2.2, z: -8.74, w: 0.08, h: 2.4, d: 0.05, color: 0xffffff, cast: false }); }
    s.box({ x: 0, y: 0, z: -8.8, w: 30, h: 1.1, d: 0.12, color: 0x7a2a2a, cast: false }); sign(s, 'MIDTOWN HIGH · GO TIGERS', { x: 0, y: 5.2, z: -8.8, w: 9, bg: '#1c2f6a' });
    const table = (x, z, w = 2.6) => { s.box({ x, y: 0.72, z, w, h: 0.05, d: 0.8, mat: top, tile: 2 }); for (const sx of [-1, 1]) { s.box({ x: x + sx * (w / 2 - 0.15), y: 0, z, w: 0.06, h: 0.72, d: 0.7, mat: leg }); } for (const sz of [-1, 1]) s.box({ x, y: 0.42, z: z + sz * 0.72, w: w - 0.2, h: 0.05, d: 0.3, mat: seat }); };
    for (const z of [-3.6, -6.2]) for (let x = -9; x <= 9; x += 3.6) table(x, z); for (const sx of [-1, 1]) for (const z of [-0.6, 2.4]) table(sx * 8.6, z);
    for (const [x, z, c] of [[-5.4, -3.6, 0xb5651d], [1.8, -3.6, 0xb5651d], [5.6, -6.2, 0x999999]]) { s.box({ x, y: 0.77, z, w: 0.45, h: 0.02, d: 0.32, color: c }); s.box({ x: x + 0.1, y: 0.79, z, w: 0.08, h: 0.14, d: 0.08, color: 0xf4f4ee }); }
    for (const [x, z, hd] of [[-5.4, -2.88, 0], [1.8, -4.32, Math.PI], [5.6, -5.48, 0], [-1.8, -6.92, Math.PI]]) s.char('ch_stunt', { x, y: -0.48, z, heading: hd, pose: 'sit' });
    for (let i = 0; i < 3; i++) s.light({ x: -7 + i * 7, y: 5.6, z: -1, color: 0xfff6e0, i: 22, dist: 16, r: 0.3 });
    s.crew({ x: 5.2, z: 4.4, ry: 0.5, people: false });
    const girl = s.char('ch_bride', { x: -3.7, z: 0.2, heading: -Math.PI / 2 }); girl.setPose('idle', 0);
    const ch = s.me = s.char('ch_stunt', { x: 0.6, z: 0, heading: Math.PI, pose: 'tray' }), TY = 1.08, TO = 0.46;
    const tray = s.box({ w: 0.72, h: 0.025, d: 0.5, color: 0xc8611c }); for (const sx of [-1, 1]) s.box({ parent: tray, x: sx * 0.35, y: -0.012, z: 0, w: 0.02, h: 0.045, d: 0.5, color: 0x8a4212 });
    const mkRing = (r, c) => { const m = s.mark({ x: 0, z: 0, r, color: c }); m.visible = false; return m; }, rings = [0, 1, 2, 3].map(() => mkRing(0.24, 0xffd020)), trayRing = mkRing(0.2, 0xffffff); trayRing.visible = true;
    s.cam.fixed(V3(0.2, 2.7, 4.5), () => ({ pos: s.focus }), { fov: 54, up: 0 }); s.focus.set(0.1, 0.95, -0.4); s.introFocus = V3(0.6, 0, 0);
    // throw schedule
    const N = 14, G = 6.2, items = []; srand(77); let lt = 1.6, lx = 0.4, lz = 0.2;
    for (let i = 0; i < N; i++) { const gapT = lerp(1.75, 1.0, i / (N - 1)); let nx, nz, d; do { nx = sr(-2.3, 2.6); nz = sr(-1.5, 1.4); d = Math.hypot(nx - lx, nz - lz); } while (i && (d < 0.7 || d > Math.min(2.6, 1.95 * gapT))); const T = sr(1.15, 1.4), F = FOOD[i % FOOD.length]; lt += i ? gapT : 0; lx = nx; lz = nz; items.push({ n: F[0], F, t0: lt - T, T, lx, lz, x0: -3.35, y0: 1.35, z0: 0.2 + sr(-0.3, 0.3), state: 0 }); }
    const mkFood = F => { const g = F[2] === 's' ? new THREE.SphereGeometry(F[3], 12, 8) : F[2] === 'c' ? new THREE.CylinderGeometry(F[3][0], F[3][0] * 0.8, F[3][1], 12) : new THREE.BoxGeometry(...F[3]); const m = new THREE.Mesh(g, s.mat({ color: F[1], rough: 0.5, ...(F[0] === 'jello' ? { emissive: 0x1a7030, emI: 0.5 } : {}) })); m.castShadow = true; m.visible = false; s.scene.add(m); return m; };
    for (const it of items) { it.m = mkFood(it.F); it.h = it.F[2] === 's' ? it.F[3] : it.F[2] === 'c' ? it.F[3][1] / 2 : it.F[3][1] / 2; }
    const st = s.st = { x: 0.6, z: 0, vx: 0, vz: 0, caught: 0, sum: 0, items, tx: 0, tz: 0, slip: false };
    s.objective('Catch the whole lunch on the tray'); const p = V3();
    s.onUpdate((dt, t) => {
      const el = s.started ? t - s.t0 : -1, live = s.started && !s.ended;
      if (live) { st.vx = damp(st.vx, s.input.x * 3.4, 10, dt); st.vz = damp(st.vz, -s.input.y * 3.4, 10, dt); st.x = clamp(st.x + st.vx * dt, -2.9, 3.2); st.z = clamp(st.z + st.vz * dt, -2.2, 1.6); }
      else { st.vx = damp(st.vx, 0, 10, dt); st.vz = damp(st.vz, 0, 10, dt); }
      ch.root.position.set(st.x, 0, st.z); st.tx = st.x; st.tz = st.z + TO; tray.position.set(st.tx, TY - 0.012, st.tz); trayRing.position.set(st.tx, 0.07, st.tz);
      const sp = Math.hypot(st.vx, st.vz); if (sp > 0.5) { ch.over = { aR: POSES.tray.aR, aL: POSES.tray.aL, sp: POSES.tray.sp }; ch.setCycle('walk', 5 + sp * 2.5); } else if (ch.cycle) ch.setPose('tray', 0.12);
      if (!s.started) return;
      if (!st.slip && el > items[0].t0 - 0.25) { st.slip = true; girl.setPose('hit', 0.15); s.audio.whoosh(1); s.msg('WHOA—', 'small'); }
      let ri = 0;
      for (const it of items) {
        const a = el - it.t0; if (it.state === 0 && a >= 0) { it.state = 1; it.m.visible = true; it.spin = V3(rnd(-6, 6), rnd(-6, 6), rnd(-6, 6)); }
        if (it.state === 1) {
          const k = a / it.T, vy0 = (TY + it.h - it.y0 + 0.5 * G * it.T * it.T) / it.T, y = it.y0 + vy0 * a - 0.5 * G * a * a; it.m.position.set(lerp(it.x0, it.lx, k), y, lerp(it.z0, it.lz, k)); it.m.rotation.x += it.spin.x * dt; it.m.rotation.z += it.spin.z * dt;
          if (ri < rings.length) { const r = rings[ri++]; r.visible = true; r.position.set(it.lx, 0.06, it.lz); r.scale.setScalar(1 + clamp(1 - k) * 1.6); r.material.opacity = 0.35 + 0.6 * clamp(k); }
          if (k >= 1 && !s.ended) {
            const d = Math.hypot(it.lx - st.tx, it.lz - st.tz);
            if (d < 0.3) { it.state = 2; st.caught++; const q = near(d, 0, 0.07, 0.3); st.sum += q; it.off = [clamp(it.lx - st.tx + ((st.caught * 5) % 7 - 3) * 0.075, -0.27, 0.27), clamp(it.lz - st.tz + ((st.caught * 3) % 5 - 2) * 0.07, -0.17, 0.17)]; it.m.rotation.set(0, rnd(3), 0); s.audio.tick(); s.audio.thud?.(); s.msg(q > 0.9 ? 'CENTRE!' : q > 0.5 ? 'Caught' : 'Just!', q > 0.9 ? 'small good' : 'small'); if (st.caught === N) { s.rate('Every item caught', 1, 1); s.rate('Centre of the tray', st.sum / N, 2); girl.setPose('stand', 0.4); s.msg('ONE TAKE!', 'huge good'); s.wrap(2, 'Got it in one. The original needed 156 takes.'); } }
            else { it.state = 3; it.vy = vy0 - G * it.T; }
          }
        } else if (it.state === 2) it.m.position.set(st.tx + it.off[0], TY + it.h, st.tz + it.off[1]);
        else if (it.state === 3) { it.vy -= G * dt; it.m.position.y += it.vy * dt; it.m.position.x += 1.2 * dt; if (it.m.position.y <= it.h) { it.m.position.y = it.h; it.state = 4; s.audio.thud?.(); s.fx.debris(p.copy(it.m.position), 6, { color: it.F[1], speed: 2.5, size: 0.05 }); s.fail(`Dropped the ${it.n} — only ${155 - Math.min(150, st.caught)} more takes to match the original`, { injury: 0, delay: 1.6 }); } }
      }
      for (; ri < rings.length; ri++) rings[ri].visible = false;
      s.hud.readout('take', 'Take (film: 156)', 1); s.hud.readout('got', 'On the tray', st.caught + ' / ' + N, 'ok');
    });
    s.dbg = () => ({ caught: st.caught });
  },
  bot(s, inp) { const st = s.st, it = st.items.find(i => i.state < 2); if (!it) return; inp.x = clamp((it.lx - st.tx) * 5, -1, 1); inp.y = clamp(-(it.lz - st.tz) * 5, -1, 1); },
};

// ---------------------------------------------------------------------------------------------
const vault = {
  id: 'mi_vault', title: 'The Wire Drop', film: 'Mission: Impossible', year: 1996, tier: 4, pay: 12000, mode: 'custom', art: 'bd_stpetersburg', music: 'spy',
  role: 'Agent on a wire above a floor that must never be touched',
  brief: 'The room listens, the room feels heat, and the floor is one big pressure plate. You come down on the wire, hover at the terminal while it copies, and you leave. Your man on the rope is… distractible. When it slips, you stop it.',
  tips: [`${K('W')} lower, ${K('S')} raise. <b>Slow is silent</b> — rush and the sound meter climbs. Dawdle and the room warms up.`, `When the rope <b>slips</b>, hit ${K('SPACE')} at once to arrest before you reach the floor.`, `Hover level with the screen to download. When a <b>bead of sweat</b> falls, press ${K('E')} as the marker crosses the green zone to catch it.`],
  controls: `${K('W')} lower &nbsp; ${K('S')} raise &nbsp; ${K('SPACE')} arrest a slip &nbsp; ${K('E')} catch the sweat drop`, intro: { r: 6.5, h: 1.2, up: 0, a0: 0.9 },
  assets: { models: ['ch_agent'], tex: [] },
  build(s) {
    s.env('indoor', { look: 'cold', amb: 0.8, sunI: 0.9, sun: [80, 30], fog: 0.00001, top: 0x8a96a4, hor: 0xa4aeb8, shadows: true });
    const R = 6.5, CH = 7.4, white = { color: 0xdfe4ea, rough: 0.6 }, pane = { color: 0xcfd6de, rough: 0.5 }, grid = { color: 0x6f7c8c }, dark = { color: 0x23272d, rough: 0.5, metal: 0.4 };
    s.box({ x: 0, y: -0.3, z: 0, w: 2 * R, h: 0.3, d: 2 * R, mat: white }); s.box({ x: 0, y: CH, z: 0, w: 2 * R, h: 0.3, d: 2 * R, mat: white, cast: false });
    for (const [x, z, w, d] of [[0, -R, 2 * R, 0.3], [0, R, 2 * R, 0.3], [-R, 0, 0.3, 2 * R], [R, 0, 0.3, 2 * R]]) s.box({ x, y: 0, z, w, h: CH, d, mat: pane, cast: false });
    for (let i = -6; i <= 6; i++) { s.box({ x: i, y: 0, z: 0, w: 0.025, h: 0.006, d: 2 * R, mat: grid, cast: false }); s.box({ x: 0, y: 0, z: i, w: 2 * R, h: 0.006, d: 0.025, mat: grid, cast: false }); }
    for (let y = 1.2; y < CH; y += 1.2) { s.box({ x: 0, y, z: -R + 0.16, w: 2 * R, h: 0.02, d: 0.02, mat: grid, cast: false }); s.box({ x: -R + 0.16, y, z: 0, w: 0.02, h: 0.02, d: 2 * R, mat: grid, cast: false }); } for (let i = -6; i <= 6; i += 2) { s.box({ x: i, y: 0, z: -R + 0.16, w: 0.02, h: CH, d: 0.02, mat: grid, cast: false }); s.box({ x: -R + 0.16, y: 0, z: i, w: 0.02, h: CH, d: 0.02, mat: grid, cast: false }); }
    const TZ = -0.75; // terminal desk
    s.box({ x: 0, y: 0.7, z: TZ - 0.25, w: 1.9, h: 0.06, d: 0.95, mat: dark }); for (const sx of [-1, 1]) s.box({ x: sx * 0.85, y: 0, z: TZ - 0.25, w: 0.08, h: 0.7, d: 0.85, mat: dark });
    s.box({ x: 0, y: 0.76, z: TZ - 0.4, w: 0.62, h: 0.5, d: 0.5, color: 0xcfc9b8 }); const scr = s.box({ x: 0, y: 0.82, z: TZ - 0.14, w: 0.5, h: 0.38, d: 0.02, mat: new THREE.MeshBasicMaterial({ color: 0x1a6a3a }), cast: false }); s.box({ x: 0, y: 0.76, z: TZ + 0.05, w: 0.5, h: 0.03, d: 0.18, color: 0xcfc9b8 }); s.box({ x: 0.55, y: 0.76, z: TZ - 0.3, w: 0.3, h: 0.34, d: 0.45, color: 0xbdb7a6 });
    s.box({ x: 0, y: 0, z: TZ + 0.75, w: 0.5, h: 0.45, d: 0.5, mat: dark }); s.box({ x: 0, y: CH - 0.05, z: 0.85, w: 1.1, h: 0.06, d: 1.1, color: 0x0c0d10, cast: false });
    for (const [x, z] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) s.light({ x, y: CH - 0.4, z, color: 0xf2f7ff, i: 5, dist: 16, r: 0.25, glow: 2 });
    const laser = s.box({ x: 0, y: 0.02, z: 0, w: 2 * R, h: 0.01, d: 2 * R, mat: new THREE.MeshBasicMaterial({ color: 0xff2020, transparent: true, opacity: 0, depthWrite: false }), cast: false });
    const CZ = 0.85, ch = s.me = s.char('ch_agent', { x: 0, y: 5, z: CZ, heading: 0, pose: 'wire' }), hipH = ch.hipH || 0.95;
    const wire = s.cyl({ r: 0.012, h: 1, color: 0x15171a, cast: false }), drop = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), new THREE.MeshBasicMaterial({ color: 0x9fd8ff })); drop.visible = false; s.scene.add(drop);
    const Y0 = 6.1, BAND = [1.06, 1.5], VMAX = 2.4, FLOOR = 0.34, QUIET = 0.45, st = s.st = { y: Y0, vy: 0, sw: 0, noise: 0, maxN: 0, temp: 0, prog: 0, phase: 'in', slip: null, slips: 0, drops: [], sweat: null, sweats: 0, sw8: [], jolt: 0, alarm: false };
    s.cam.fixed(V3(4.6, 1.9, 4.9), () => ({ pos: s.focus }), { fov: 46, up: 0, lookStiff: 4 }); s.introFocus = V3(0, 1.6, 0);
    const alarm = why => { if (st.alarm) return; st.alarm = true; laser.material.opacity = 0.35; s.hemi.color.set(0xff3030); s.audio.bell(); s.audio.bad?.(); s.engine.flash(0.5); s.fail(why, { injury: 0.1 }); };
    s.objective('Lower to the terminal — quietly');
    s.onUpdate((dt, t) => {
      const el = s.started ? t - s.t0 : 0, live = s.started && !s.ended, inp = s.input;
      if (live) {
        // rope slips: once on the way down, once mid-download
        if (!st.slip && ((st.slips === 0 && st.y < 3.3) || (st.slips === 1 && st.prog > 0.5 && !st.sweat))) { st.slip = { t: 0, fall: false, y0: st.y, held: false }; st.slips++; }
        const sl = st.slip;
        if (sl) {
          sl.t += dt; if (!sl.fall && Math.floor(sl.t * 14) % 2 === 0) s.audio.tick();
          if (inp.hit('a')) { const d = sl.y0 - st.y; st.drops.push(d); st.slip = null; st.vy = 0; st.jolt = 0.5 + d; st.noise += 0.05 + d * 0.12; s.audio.thud(); s.engine.addShake(0.25 + d * 0.5); s.hud.prompt(''); s.msg(d < 0.12 ? 'HELD IT!' : d < 0.5 ? 'Caught it' : 'INCHES!', d < 0.5 ? 'good' : 'bad'); }
          else if (sl.t > 0.62) { if (!sl.fall) { sl.fall = true; sl.y0 = st.y; s.audio.whoosh(1.4); } st.vy -= 7.5 * dt; s.hud.prompt(`ROPE! ${K('SPACE')}`); }
          else { st.vy = damp(st.vy, 0, 6, dt); s.hud.prompt(`The rope is slipping… ${K('SPACE')} to arrest`); }
        } else st.vy = damp(st.vy, -inp.y * VMAX, 4, dt);
        st.y = Math.min(Y0 + 0.2, st.y + st.vy * dt); if (st.y >= Y0 + 0.2 && st.vy > 0) st.vy = 0;
        // sensors
        const lvl = sl?.fall ? 0.45 : Math.abs(st.vy) / VMAX; st.noise = clamp(st.noise + (lvl - QUIET) * 0.75 * dt, 0, 1.2); st.maxN = Math.max(st.maxN, st.noise); st.temp = el / 58;
        if (st.y <= FLOOR) { st.y = FLOOR; return alarm('Touched the pressure floor — every alarm in the building'); }
        if (st.noise >= 1) return alarm('Too fast on the wire — the sound sensor heard you'); if (st.temp >= 1) return alarm('Took too long — your body heat raised the room one degree');
        // download while hovering at the terminal
        const inBand = st.y > BAND[0] && st.y < BAND[1] && !sl;
        if (st.phase === 'in' && inBand) { st.phase = 'dl'; s.objective('Hold level with the screen — copying the list'); }
        if (st.phase === 'dl') {
          if (inBand && !st.sweat) st.prog += dt / 9.5; scr.material.color.setHex(inBand ? (Math.floor(t * 8) % 2 ? 0x30ff80 : 0x20c060) : 0x1a6a3a);
          if (!st.sweat && !sl && st.sweats < 2 && st.prog > [0.22, 0.78][st.sweats]) { st.sweat = { t: 0 }; st.sweats++; drop.visible = true; s.msg('SWEAT!', 'small bad'); }
          if (st.sweat) {
            const sw = st.sweat; sw.t += dt; const v = sw.t / 1.5, hy = st.y + 0.12, hz = CZ - 0.78; drop.position.set(st.sw * 0.5, lerp(hy, v < 0.72 ? hy - 0.45 : 0.02, v < 0.72 ? v / 0.72 : (v - 0.72) / 0.28), hz); s.hud.bar(clamp(v), [0.58, 0.84], [0.68, 0.76]); s.hud.prompt(`${K('E')} catch the drop`);
            const end = ok => { st.sweat = null; drop.visible = false; s.hud.hideBar(); s.hud.prompt(''); ch.setPose('wire', 0.3); if (!ok) alarm('A bead of sweat hit the pressure floor'); };
            if (inp.hit('x')) { if (v >= 0.58 && v <= 0.84) { st.sw8.push(near(v, 0.72, 0.045, 0.13)); s.audio.tick(); s.msg('Caught', 'small good'); ch.setPose({ ...POSES.wire, aR: [0.25, -0.2, 1, 0.0, -0.9, 0.6] }, 0.08); s.after(0.35, () => !st.alarm && ch.setPose('wire', 0.3)); st.sweat = null; drop.visible = false; s.hud.hideBar(); s.hud.prompt(''); } else end(false); }
            else if (v >= 1) end(false);
          }
          if (st.prog >= 1) { st.phase = 'out'; scr.material.color.setHex(0x2060ff); s.audio.good(); s.msg('DOWNLOAD COMPLETE', 'good'); s.objective('Out! Raise back to the vent — still quiet'); }
        } else if (st.phase === 'out' && st.y > 5.4) {
          const av = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 1; s.rate('Silence', clamp(1.3 - st.maxN * 1.1), 1.2); s.rate('Rope arrests', av(st.drops.map(d => near(d, 0, 0.14, 0.85))), 1.2); s.rate('Sweat catch', av(st.sw8), 1); s.rate('Cool room', clamp((1 - st.temp) / 0.4), 0.8);
          s.wrap(1.4, 'Toast.');
        }
        s.hud.meter('noise', 'Sound', st.noise, { color: st.noise > 0.7 ? '#ff4030' : '#40c0ff' }); s.hud.meter('temp', 'Room temp', st.temp, { color: st.temp > 0.75 ? '#ff4030' : '#ffb040' }); s.hud.meter('dl', 'Download', st.prog, { color: '#40ff70' });
        s.hud.readout('h', 'Above floor (cm)', Math.round((st.y - FLOOR) * 100), st.y < 0.9 ? 'warn' : inBand ? 'ok' : '');
      }
      // swing & rig
      st.jolt = damp(st.jolt, 0, 2.5, dt); const amp = clamp(Math.abs(st.vy) * 0.07 + st.jolt * 0.12, 0, 0.3); st.sw = damp(st.sw, amp * Math.sin(t * 2.3), 5, dt);
      ch.root.position.set(st.sw, st.y - hipH, CZ); ch.spinAng.z = st.sw * 0.5; s.focus.set(0, clamp(st.y * 0.55 + 0.5, 1.1, 3.2), 0.2);
      const top = CH - 0.05, by = st.y + 0.16, len = Math.hypot(st.sw, top - by); wire.scale.y = len; wire.position.set(st.sw / 2, (top + by) / 2, CZ); wire.rotation.z = Math.atan2(st.sw, top - by);
    });
    s.dbg = () => ({ y: +st.y.toFixed(2), n: +st.maxN.toFixed(2), prog: +st.prog.toFixed(2), ph: st.phase });
  },
  bot(s, inp, B) {
    const st = s.st; if (st.slip) { if (st.slip.fall) inp.press('a'); return; } if (st.sweat) { if (st.sweat.t / 1.5 >= 0.71) inp.press('x'); }
    inp.y = st.phase === 'out' ? -0.6 : clamp((st.y - 1.28) * 1.3, -0.6, 0.6);
  },
};

export default [steamboat, spidey, vault];
