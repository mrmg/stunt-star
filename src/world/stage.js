import * as THREE from 'three';
import { FX } from '../core/fx.js';
import { tex, rawTex, model, MODEL_META } from '../core/assets.js';
import { Character } from './character.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Recorder, recordingAudio, liveCut } from './replay.js';

export const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const rnd = (a = 1, b) => b === undefined ? Math.random() * a : a + Math.random() * (b - a);
export const pick = a => a[Math.floor(Math.random() * a.length)];
// closeness score: 1 when |v-target|<=perfect, falling to 0 at |v-target|>=worst
export const near = (v, target, perfect, worst) => clamp(1 - (Math.abs(v - target) - perfect) / (worst - perfect));
let seed = 1; export const srand = s => { seed = s; }; export const sr = (a = 1, b) => { seed = (seed * 16807) % 2147483647; const r = (seed - 1) / 2147483646; return b === undefined ? r * a : a + r * (b - a); };

const ENV = {
  day: { top: 0x2a6fd6, hor: 0xbcd9f5, sun: [33, 38], sunCol: 0xffecd2, sunI: 3.3, amb: 0.78, fog: 0.0011 }, // morning/afternoon sun: long shadows, warm key
  noon: { top: 0x1f62cf, hor: 0xcfe3f7, sun: [70, 20], sunCol: 0xffffff, sunI: 3.8, amb: 1.0, fog: 0.0009 },
  golden: { top: 0x3a66b8, hor: 0xffc890, sun: [13, 60], sunCol: 0xffad5c, sunI: 3.8, amb: 0.68, fog: 0.0015 },
  dusk: { top: 0x1a2550, hor: 0xe07a50, sun: [5, 75], sunCol: 0xff7a40, sunI: 2.2, amb: 0.55, fog: 0.0016 },
  night: { top: 0x02040c, hor: 0x101a33, sun: [40, -30], sunCol: 0x8fa8ff, sunI: 0.7, amb: 0.28, fog: 0.0016, stars: 1 },
  overcast: { top: 0x7d8894, hor: 0xc5ccd2, sun: [55, 20], sunCol: 0xe8eef5, sunI: 1.6, amb: 1.15, fog: 0.0018 },
  storm: { top: 0x10141c, hor: 0x39424f, sun: [50, 10], sunCol: 0x9fb0d0, sunI: 0.8, amb: 0.5, fog: 0.003, stars: 0 },
  desert: { top: 0x2d74d8, hor: 0xf1dcba, sun: [62, 40], sunCol: 0xfff0d0, sunI: 4.2, amb: 0.95, fog: 0.0009 },
  snow: { top: 0x2f6fd0, hor: 0xe8f1fb, sun: [35, 50], sunCol: 0xffffff, sunI: 3.6, amb: 1.2, fog: 0.0008 },
  jungle: { top: 0x5f8fbf, hor: 0xcfe0c8, sun: [55, 30], sunCol: 0xfff0c0, sunI: 2.6, amb: 0.8, fog: 0.004 },
  indoor: { top: 0x101010, hor: 0x181818, sun: [80, 0], sunCol: 0xfff0dd, sunI: 0.6, amb: 0.5, fog: 0.004 },
  cave: { top: 0x020202, hor: 0x0a0806, sun: [80, 0], sunCol: 0xffc080, sunI: 0.25, amb: 0.22, fog: 0.012 },
  high: { top: 0x0b2f8a, hor: 0xa9cdf5, sun: [50, 30], sunCol: 0xffffff, sunI: 3.8, amb: 1.0, fog: 0.00018 },
};

class Course {
  constructor() { this.pieces = []; this.solids = []; this.base = () => 0; this.kill = -60; }
  height(x, z, yRef = 1e9) {
    let h = this.base(x, z);
    const P = this.pieces;
    for (let i = 0; i < P.length; i++) {
      const p = P[i]; if (p.off || x < p.x0 || x > p.x1 || z < p.z0 || z > p.z1) continue;
      const y = p.fn(x, z); if (y > h && y <= yRef + p.step) h = y;
    }
    return h;
  }
  // underside clearance: lowest ceiling above y at (x,z), or Infinity
  ceiling(x, z, y) { let c = Infinity; for (const p of this.pieces) { if (p.off || p.under == null || x < p.x0 || x > p.x1 || z < p.z0 || z > p.z1) continue; const u = p.under(x, z); if (u > y && u < c) c = u; } return c; }
  normal(x, z, yRef, out) { const e = 0.6, hl = this.height(x - e, z, yRef), hr = this.height(x + e, z, yRef), hb = this.height(x, z + e, yRef), hf = this.height(x, z - e, yRef); const ok = v => v > -1e5; const dx = ok(hl) && ok(hr) ? hl - hr : 0, dz = ok(hf) && ok(hb) ? hb - hf : 0; return out.set(dx, 2 * e, -dz).normalize(); }
  addPiece(p) { p.step = p.step ?? 0.7; this.pieces.push(p); return p; }
  addSolid(s) { s.type = s.type || 'solid'; this.solids.push(s); return s; }
  // box overlap query
  hit(x, y, z, hw, hh, hd, cb) {
    const S = this.solids;
    for (let i = 0; i < S.length; i++) {
      const s = S[i]; if (s.dead) continue;
      if (x + hw < s.x0 || x - hw > s.x1 || z + hd < s.z0 || z - hd > s.z1 || y + hh < s.y0 || y - hh > s.y1) continue;
      if (cb(s) === true) return s;
    }
    return null;
  }
}

class CamRig {
  constructor(stage) { this.s = stage; this.cam = stage.camera; this.mode = 'free'; this.o = {}; this.pos = new THREE.Vector3(); this.look = new THREE.Vector3(); this.fovKick = 0; this._t = new THREE.Vector3(); this._l = new THREE.Vector3(); this.first = true; this.roll = 0; }
  // target: fn returning {pos:Vector3, heading:number} or an Object3D (uses rotation.y)
  follow(target, o = {}) { this.mode = 'follow'; this.target = target; this.o = { dist: 8, height: 2.6, side: 0, ahead: 4, up: 1, stiff: 6, lookStiff: 12, fov: 62, yaw: 0, ...o }; if (o.snap) this.first = true; return this; }
  set(o) { Object.assign(this.o, o); return this; }
  fixed(pos, target, o = {}) { this.mode = 'fixed'; this.fpos = pos.clone ? pos.clone() : V3(...pos); this.target = target; this.o = { fov: 45, lookStiff: 8, up: 1, ahead: 0, ...o }; this.first = true; return this; }
  free() { this.mode = 'free'; return this; }
  _tp() { const t = this.target; if (!t) return null; if (typeof t === 'function') return t(); return { pos: t.position, heading: t.userData?.heading ?? t.rotation.y }; }
  update(dt) {
    const c = this.cam; if (this.mode === 'free') return;
    if (this.mode === 'cine') { const k = this.cineFn(); c.position.copy(k.pos); c.up.set(0, 1, 0); c.lookAt(k.look); if (Math.abs(c.fov - k.fov) > 0.05) { c.fov = k.fov; c.updateProjectionMatrix(); } return; }
    const tp = this._tp(); if (!tp) return; const o = this.o, h = (tp.heading || 0) + (o.yaw || 0), sn = Math.sin(h), cs = Math.cos(h);
    this._l.set(tp.pos.x - sn * o.ahead, tp.pos.y + o.up, tp.pos.z - cs * o.ahead);
    if (this.mode === 'follow') {
      this._t.set(tp.pos.x + sn * o.dist + cs * o.side, tp.pos.y + o.height, tp.pos.z + cs * o.dist - sn * o.side);
      if (o.minY != null) this._t.y = Math.max(this._t.y, o.minY);
      if (o.ground !== false) { const g = this.s.course.height(this._t.x, this._t.z, this._t.y + 3); if (g > -1e5) this._t.y = Math.max(this._t.y, g + 0.5); }
    } else this._t.copy(this.fpos);
    if (this.first) { this.pos.copy(this._t); this.look.copy(this._l); this.first = false; }
    else { const k = 1 - Math.exp(-o.stiff * dt), kl = 1 - Math.exp(-o.lookStiff * dt); if (this.mode === 'follow') this.pos.lerp(this._t, k); else this.pos.copy(this._t); this.look.lerp(this._l, kl); }
    c.position.copy(this.pos); c.up.set(Math.sin(this.roll), Math.cos(this.roll), 0); c.lookAt(this.look);
    const f = o.fov + this.fovKick; if (Math.abs(c.fov - f) > 0.05) { c.fov = damp(c.fov, f, 5, dt); c.updateProjectionMatrix(); }
  }
}

const _box = new THREE.Box3(), _v = new THREE.Vector3();

const KEEP_ROLLING = ['Keep rolling!', 'Keep going, keep going!', 'Do not stop!', 'Still rolling!'];
const CUT_LINES = ['Cut! Cut!', 'Cut! Medic!', 'Cut it!'];
const pickLine = a => a[Math.floor(Math.random() * a.length)];
// generic director advice from the wording of a failure; stunts pass their own `advice` when they can say more
// Break up big tiled ground: two octaves of world-space value noise darken/lighten the texture and mix in
// patches of a second colour (dry grass, wet sand, oil stains). Applied to ground() and terrain() by default.
const VARY_DEF = { tx_grass: { lo: 0.62, hi: 1.08, patch: 0xa89a62, amt: 0.45, tint: 0xb4c09a }, tx_sand: { lo: 0.78, hi: 1.06, patch: 0x9a8060, amt: 0.3 }, tx_dirt: { lo: 0.7, hi: 1.08, patch: 0x7a6248, amt: 0.3 },
  tx_asphalt: { lo: 0.75, hi: 1.05, patch: 0x404448, amt: 0.25 }, tx_concrete: { lo: 0.8, hi: 1.05, patch: 0x8a8678, amt: 0.2 }, tx_rock: { lo: 0.7, hi: 1.1, patch: 0x6a6a5a, amt: 0.25 }, tx_snow: { lo: 0.86, hi: 1.04, patch: 0xc8d4e4, amt: 0.3 },
  tx_jungle_floor: { lo: 0.65, hi: 1.08, patch: 0x5a4a2a, amt: 0.3 }, tx_cobble: { lo: 0.78, hi: 1.05, patch: 0x5a5448, amt: 0.2 } };
export function varyMaterial(m, o = {}) {
  const u = { uLo: { value: o.lo ?? 0.72 }, uHi: { value: o.hi ?? 1.08 }, uPatch: { value: new THREE.Color(o.patch ?? 0x9a8a60) }, uAmt: { value: o.amt ?? 0.3 }, uScale: { value: o.scale ?? 1 } };
  m.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPv;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPv = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vWPv; uniform float uLo, uHi, uAmt, uScale; uniform vec3 uPatch;
      float vh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(vh(i), vh(i + vec2(1, 0)), f.x), mix(vh(i + vec2(0, 1)), vh(i + vec2(1, 1)), f.x), f.y); }
      float vf(vec2 p){ return vn(p) * 0.55 + vn(p * 2.3 + 7.1) * 0.3 + vn(p * 5.1 + 3.3) * 0.15; }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
      { vec2 q = vWPv.xz * uScale; float n = vf(q * 0.018) * 0.65 + vf(q * 0.11) * 0.35; diffuseColor.rgb *= mix(uLo, uHi, n);
        float pt = smoothstep(0.5, 0.78, vf(q * 0.03 + 11.0)); diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * uPatch * 1.6, pt * uAmt); }`);
  };
  m.customProgramCacheKey = () => 'vary'; return m;
}
export function adviceFor(reason = '', def) {
  const r = reason.toLowerCase(), m = def?.mode;
  if (/short|swim|river|street|dropped it in|fell short|came up/.test(r)) return 'You ran out of speed before the gap. Watch the speed readout and be in the green zone before the ramp — then do not lift.';
  if (/nose|landing|rolled|flip|landed/.test(r)) return m === 'drive' ? 'In the air, feather W and S to keep the nose level with the landing. Land on all four wheels, not the bumper.' : 'Watch your body angle in the air and set up for the landing early.';
  if (/speed|mph|slow|fast|too hot|not enough/.test(r)) return 'It is all in the speed. Watch the MPH readout and hold it in the green — small throttle changes, early.';
  if (/late|early|timing|missed the|window|lightning/.test(r)) return 'Commit on the cue, not after it. Watch the marker and press as it hits the green.';
  if (/grip|let go|lost your|slipp/.test(r)) return 'Only brace when the warning appears and rest in between — stamina is what keeps your hands on.';
  if (/got away|lost (him|her|the)|too far|range/.test(r)) return 'Stay closer. Take the inside line and use the straights to make up the gap.';
  if (/caught|crushed|blast|boulder|train|truck/.test(r)) return 'You were a fraction slow. Sprint earlier and keep your line clean so nothing costs you speed.';
  if (/hit|crash|wreck|into|head-on|clipped|collect|scenery|wall|pillar|tree/.test(r)) return 'Look further ahead and pick your gap early. A smooth line beats a fast one.';
  if (/fell|fall|drop|metres|edge|off the/.test(r)) return 'Keep to the middle and do not rush the jumps — the take is won at the edge.';
  return 'Same marks, same speed — breathe, and go again.';
}

export class Stage {
  constructor(engine, input, audio, hud, def) {
    this.engine = engine; this.input = input; this.audio = audio; this.hud = hud; this.def = def;
    this.scene = new THREE.Scene(); this.camera = engine.camera; engine.setScene(this.scene);
    this.fx = new FX(this.scene); this.course = new Course(); this.cam = new CamRig(this);
    this.t = 0; this.started = false; this.ended = false; this.updaters = []; this.timers = []; this.chars = [];
    this.scores = new Map(); this.bonuses = []; this.result = null; this.slow = { s: 1, t: 0 };
    this.mats = new Map(); this.focus = new THREE.Vector3(); this.disposables = [];
    this.lookName = 'neutral';
    this.rec = new Recorder(this); this.audio = recordingAudio(audio, this); this.moments = []; this.flubs = []; this.subject = null; this.liveCine = true;
  }
  // called on ACTION
  begin() { this.started = true; this.t0 = this.t; this.rec.start(this.t); this.audio.space?.(this.soundSpace || 'open'); this.audio.ambience?.(this.ambience); this.audio.setIntensity?.(0.55); this.musicBoost = 0; }
  // ---------------------------------------------------------------- key moments (for the replay edit)
  // Mark the bit of the take worth showing again. w = how spectacular (highest wins); shots = ['wide','low','front',...] to match the film.
  moment(label, { t0 = this.t, t1, dur = 2.5, w = 1, subject, shots, kind } = {}) { const m = { label, t0, t1: t1 ?? t0 + dur, w, subject: subject || this.subject, shots: shots || this.def.cine, kind }; this.moments.push(m); if (this.started && !this.ended && w >= 1) { this.audio.sting?.(); this.musicBoost = 3; } return m; }
  bestMoment() {
    if (this.result && !this.result.ok) { const t = this.endT; return { label: 'the crash', t0: t - 2.4, t1: Math.min(this.rec.end, t + 1.6), w: 1e3, subject: this.subject, kind: 'fail', shots: null }; }
    let b = null; for (const m of this.moments) if (m.t1 > m.t0 && (!b || m.w >= b.w)) b = m;
    return b || { label: 'the finish', t0: Math.max(this.rec.t0, (this.endT ?? this.t) - 4), t1: Math.min(this.rec.end, (this.endT ?? this.t) + 0.8), w: 0, subject: this.subject, shots: this.def.cine };
  }
  // live multi-angle cut while the player keeps control (pts: predicted path [{t,p}]); returns restore fn
  cut(pts, type = 'wide', o = {}) { if (!this.liveCine || !this.subject) return () => { }; return liveCut(this, o.subject || this.subject, pts, type, o); }
  // ---------------------------------------------------------------- lifecycle helpers
  onUpdate(fn) { this.updaters.push(fn); return fn; }
  after(sec, fn) { this.timers.push({ t: this.t + sec, fn }); }
  slowmo(scale, dur) { this.slow.s = scale; this.slow.t = dur; }
  rate(label, v, w = 1) { this.scores.set(label, { label, v: clamp(v), w }); }
  bonus(label, amount) { const b = this.bonuses.find(b => b.label === label); if (b) b.amount += amount; else this.bonuses.push({ label, amount }); }
  msg(text, kind = '') { this.hud.pop(text, kind); }
  objective(text) { this.hud.objective(text); }
  quality() { let s = 0, w = 0; for (const r of this.scores.values()) { s += r.v * r.w; w += r.w; } return w ? s / w : 0; }
  // multiplier from mistakes the director let you roll through
  flubMult() { return clamp(1 - this.flubs.reduce((a, f) => a + f.penalty, 0), 0.2, 1); }
  // A recoverable mistake: the take keeps rolling, it just costs quality (stars). Use this instead of fail()
  // for anything the performer could carry on from: missed speed window, dropped item, scraped a wall, late cue...
  flub(reason, { penalty = 0.2, advice, label, quiet = false } = {}) {
    if (this.ended) return; const last = this.flubs.at(-1); if (last && last.reason === reason && this.t - last.t < 1.5) return;
    this.flubs.push({ reason, penalty, advice: advice || adviceFor(reason, this.def), label: label || reason, t: this.t });
    if (!quiet) { this.hud.pop(reason.toUpperCase(), 'bad small'); this.hud.director('Keep rolling!'); this.audio.say?.(pickLine(KEEP_ROLLING)); this.audio.bad(); }
  }
  _advice(extra) { const out = []; if (extra) out.push(extra); for (const f of this.flubs) if (f.advice && !out.includes(f.advice)) out.push(f.advice); return out.slice(0, 3); }
  wrap(delay = 1.6, note) {
    if (this.ended) return; this.ended = true; this.endT = this.t;
    this.result = { ok: true, scores: [...this.scores.values()], bonuses: this.bonuses, quality: this.quality() * this.flubMult(), note, flubs: this.flubs, advice: this._advice() };
    this.audio.good(); this._finish(delay);
  }
  // A take-ending failure (crash, fall, caught...). Scores so far are kept: if the production runs out of takes they "go with it".
  fail(reason, { injury = 0.5, delay = 2.4, advice } = {}) {
    if (this.ended) return; this.ended = true; this.endT = this.t;
    this.result = { ok: false, reason, injury, scores: [...this.scores.values()], bonuses: [], quality: this.quality() * this.flubMult() * 0.6, flubs: this.flubs, advice: this._advice(advice || adviceFor(reason, this.def)) };
    if (injury > 0.15) this.engine.hurt(Math.min(1, injury + 0.3));
    this.audio.say?.(pickLine(CUT_LINES)); this.slowmo(0.35, 1.2); this._finish(delay);
  }
  _finish(delay) { this.finishAt = this.t + delay; }
  update(dt) {
    if (this.slow.t > 0) { this.slow.t -= dt; if (this.slow.t <= 0) this.slow.s = 1; }
    this.engine.timeScale = damp(this.engine.timeScale, this.slow.s, 10, dt);
    const sdt = dt * this.engine.timeScale; this.dt = sdt; this.t += sdt;
    for (let i = this.timers.length - 1; i >= 0; i--) if (this.t >= this.timers[i].t) { const f = this.timers[i].fn; this.timers.splice(i, 1); f(); }
    for (const u of this.updaters) u(sdt, this.t);
    for (const c of this.chars) c.update(sdt);
    this.fx.update(sdt);
    this.cam.update(Math.min(dt, 0.05));
    this._updateEnv(sdt);
    this.rec.tick(this.t);
    // generic "never got going" watchdog: a performer who does not move off the mark eventually loses the light
    if (this.started && !this.ended && this.subject && (this.idleWatch ?? (this.def.mode === 'drive' || this.def.mode === 'run'))) {
      const w = this._idle ||= { p: null, t: 0, warned: false }; const p = this.subject.getWorldPosition(new THREE.Vector3());
      if (!w.p || p.distanceTo(w.p) > 4) { w.p = p; w.t = this.t; }
      const still = this.t - w.t, adv = 'The cameras are rolling the moment you hear ACTION — read THE SHOT card and get moving straight away.';
      if (still > 12 && !w.warned) { w.warned = true; this.flub('Sitting on the mark', { penalty: 0.15, advice: adv }); }
      if (still > 22) this.fail('Never got going — we lost the light', { injury: 0, advice: adv });
    }
    if (this.started && !this.ended) { this.musicBoost = Math.max(0, (this.musicBoost || 0) - dt); this.audio.setIntensity?.(this.slow.s < 0.7 || this.musicBoost > 0 ? 1 : 0.62); }
    if (this.ended && this.finishAt != null && this.t >= this.finishAt) { this.finishAt = null; this.onFinish?.(this.result); }
  }
  dispose() {
    this.audio.stopLoops(); this.audio.stopAmbience?.();
    this.scene.traverse(o => { if (o.geometry) o.geometry.dispose(); const m = o.material; if (m) (Array.isArray(m) ? m : [m]).forEach(x => { for (const k in x) { const v = x[k]; if (v && v.isTexture && v.userData.own) v.dispose(); } x.dispose(); }); });
    this.envRT?.dispose(); this.scene.environment = null;
  }
  // ---------------------------------------------------------------- environment
  env(preset = 'day', o = {}) {
    const E = this.E = { ...ENV[preset], ...o }; const sc = this.scene;
    const el = THREE.MathUtils.degToRad(E.sun[0]), az = THREE.MathUtils.degToRad(E.sun[1]);
    this.sunDir = V3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    const top = new THREE.Color(E.top), hor = new THREE.Color(E.hor);
    // optional photo backdrop decides horizon + fog colours
    let bd = E.backdrop && rawTex(E.backdrop), fogCol = hor.clone();
    if (bd) {
      const cv = document.createElement('canvas'); cv.width = 64; cv.height = 64; const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(bd.image, 0, 0, 64, 64);
      const avg = (y0, y1) => { const d = g.getImageData(0, y0, 64, y1 - y0).data; let r = 0, gg = 0, b = 0, n = d.length / 4; for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; } return new THREE.Color().setRGB(r / n / 255, gg / n / 255, b / n / 255, THREE.SRGBColorSpace); };
      const hz = E.hz ?? 0.5; const yh = Math.round((1 - hz) * 64);
      hor.copy(avg(0, 3)); fogCol.copy(avg(clamp(yh - 4, 0, 60), clamp(yh, 4, 64))).lerp(avg(clamp(yh, 0, 60), 64), E.fogMix ?? 0.35);
      if (!o.top) top.copy(hor).multiplyScalar(0.5).lerp(new THREE.Color(E.top), 0.6);
    }
    if (E.fogColor != null) fogCol.set(E.fogColor);
    this.skyU = { uTop: { value: top }, uHor: { value: hor }, uSun: { value: this.sunDir }, uSunCol: { value: new THREE.Color(E.sunCol) }, uStars: { value: E.stars || 0 }, uGain: { value: E.skyGain ?? 1 } };
    const sky = this.sky = new THREE.Mesh(new THREE.SphereGeometry(4500, 32, 16), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false, uniforms: this.skyU,
      vertexShader: 'varying vec3 vD; void main(){ vD=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
      fragmentShader: /* glsl */`varying vec3 vD; uniform vec3 uTop,uHor,uSun,uSunCol; uniform float uStars,uGain;
        float h(vec3 p){ p=fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
        void main(){ vec3 d=normalize(vD); float y=max(d.y,0.0); vec3 c=mix(uHor,uTop,pow(y,0.55));
          float s=max(dot(d,normalize(uSun)),0.0); c+=uSunCol*(pow(s,350.0)*6.0+pow(s,12.0)*0.25);
          if(uStars>0.0){ vec3 g=floor(d*220.0); float st=step(0.9975,h(g)); c+=vec3(st)*uStars*y*1.5; }
          if(d.y<0.0) c=mix(uHor,uHor*0.6,min(1.0,-d.y*3.0));
          gl_FragColor=vec4(c*uGain,1.0); }`,
    }));
    sky.renderOrder = -10; sky.frustumCulled = false; sc.add(sky);
    if (bd) {
      const R = 3800, hz = E.hz ?? 0.5, H = (2 * Math.PI * R / 2) / 4, t = bd.clone(); t.wrapS = THREE.MirroredRepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping; t.repeat.set(2, 1); t.needsUpdate = true;
      const m = this.backdrop = new THREE.Mesh(new THREE.CylinderGeometry(R, R, H, 64, 1, true), new THREE.ShaderMaterial({
        side: THREE.BackSide, transparent: true, depthWrite: false, fog: false,
        uniforms: { map: { value: t }, uFog: { value: fogCol }, uHz: { value: hz }, uGain: { value: E.bdGain ?? 1.0 }, uFade: { value: E.bdFade ?? 0.3 } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
        fragmentShader: /* glsl */`varying vec2 vUv; uniform sampler2D map; uniform vec3 uFog; uniform float uHz,uGain,uFade;
          void main(){ vec3 c=texture2D(map,vec2(vUv.x*2.0,vUv.y)).rgb*uGain; float a=smoothstep(1.0,1.0-uFade,vUv.y);
            c=mix(uFog,c,smoothstep(uHz-0.36,uHz-0.1,vUv.y)); gl_FragColor=vec4(c,a); }`,
      }));
      m.position.y = H * (0.5 - hz) + (E.bdY ?? 0); m.renderOrder = -9; m.rotation.y = (E.bdRot ?? 0) + Math.PI / 2; m.frustumCulled = false; sc.add(m); this.bdBase = m.position.y;
    }
    sc.fog = new THREE.FogExp2(fogCol, E.fog); this.fogCol = fogCol;
    const sun = this.sun = new THREE.DirectionalLight(E.sunCol, E.sunI); sun.castShadow = E.shadows !== false;
    const sh = E.shadowSize ?? 70; sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -sh, right: sh, top: sh, bottom: -sh, near: 1, far: 600 }); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05;
    sc.add(sun, sun.target);
    this.hemi = new THREE.HemisphereLight(hor.clone().lerp(top, 0.5), new THREE.Color(E.ground ?? 0x4a4035), E.amb * 0.55); sc.add(this.hemi);
    // image-based lighting from the sky itself
    const es = new THREE.Scene(); es.add(sky.clone()); if (this.backdrop) { const b = this.backdrop.clone(); es.add(b); }
    const floor = new THREE.Mesh(new THREE.CircleGeometry(4000, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(E.ground ?? 0x4a4035).multiplyScalar(0.8) })); floor.rotation.x = -Math.PI / 2; floor.position.y = -30; es.add(floor);
    this.envRT = this.engine.pmrem.fromScene(es, 0, 1, 6000); sc.environment = this.envRT.texture; sc.environmentIntensity = (E.envI ?? 0.75) * E.amb;
    this.engine.setLook(E.look || 'neutral', E.lookOver || {}); this.lookName = E.look || 'neutral';
    // sound of the place: reverb + ambience bed (stunts can override with o.space / o.ambience)
    const bdn = E.backdrop || '', CITY = /turin|sf|vegas|smalltown|la|chicago|gotham|abudhabi|paris|brooklyn|nyc|dubai|hk|kl|old_la|stpetersburg|miami|rotterdam|tokyo/;
    this.soundSpace = E.space || (preset === 'indoor' ? 'indoor' : preset === 'cave' ? 'cave' : CITY.test(bdn) ? 'city' : 'open');
    this.ambience = E.ambience ?? (preset === 'indoor' || preset === 'cave' ? 'indoor' : preset === 'storm' ? 'storm' : CITY.test(bdn) ? 'city' : /beach|ocean|bayou/.test(bdn) ? 'sea' : /desert|wasteland|canyon|monument|egypt|snow|clouds|dam|norway/.test(bdn) || preset === 'high' || preset === 'desert' || preset === 'snow' ? 'desert' : 'nature');
    return this;
  }
  _updateEnv() {
    const c = this.camera.position, f = this.focus;
    if (this.sky) this.sky.position.copy(c);
    if (this.backdrop) { this.backdrop.position.x = c.x; this.backdrop.position.z = c.z; this.backdrop.position.y = this.bdBase + c.y * (this.E.bdFollow ?? 0.85); }
    if (this.sun) { this.sun.target.position.copy(f); this.sun.position.copy(f).addScaledVector(this.sunDir, 220); }
    if (this.bigGround) { this.bigGround.position.x = Math.round(c.x / 50) * 50; this.bigGround.position.z = Math.round(c.z / 50) * 50; this.bigGround.material.map?.offset.set(this.bigGround.position.x / this.bigGround.userData.tile, -this.bigGround.position.z / this.bigGround.userData.tile); }
  }
  // ---------------------------------------------------------------- materials
  mat(o = {}) {
    if (typeof o === 'string') o = { tex: o };
    const key = JSON.stringify(o); if (this.mats.has(key)) return this.mats.get(key);
    const p = { color: o.color ?? 0xffffff, roughness: o.rough ?? 0.85, metalness: o.metal ?? 0 };
    if (o.tex) { const t = tex(o.tex, o.rep ?? 1, o.repY ?? o.rep ?? 1); if (t) { t.userData.own = true; p.map = t; } else p.color = o.fallback ?? 0x888888; }
    if (o.emissive != null) { p.emissive = new THREE.Color(o.emissive); p.emissiveIntensity = o.emI ?? 1; if (o.emMap && p.map) p.emissiveMap = p.map; }
    if (o.opacity != null) { p.transparent = true; p.opacity = o.opacity; p.depthWrite = false; }
    if (o.side) p.side = THREE.DoubleSide;
    let m;
    if (o.glass) m = new THREE.MeshPhysicalMaterial({ color: o.color ?? 0x9fc4d6, roughness: 0.05, metalness: 0.9, transparent: true, opacity: o.opacity ?? 0.35, envMapIntensity: 1.6, side: THREE.DoubleSide });
    else if (o.paint) m = new THREE.MeshPhysicalMaterial({ ...p, roughness: 0.35, metalness: 0.5, clearcoat: 1, clearcoatRoughness: 0.08 });
    else m = new THREE.MeshStandardMaterial(p);
    this.mats.set(key, m); return m;
  }
  // ---------------------------------------------------------------- primitives
  add(o) { this.scene.add(o); return o; }
  // Box with world-scaled UVs. o: {x,y,z (centre x/z, y=base), w,h,d, mat, tile, solid, ry, cast}
  box(o) {
    const { w = 1, h = 1, d = 1, tile = 6 } = o; const g = new THREE.BoxGeometry(w, h, d); const uv = g.attributes.uv;
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) { const tt = (f === 2 || f === 3) ? (o.tileTop ?? tile) : tile, ty = (f === 2 || f === 3) ? (o.tileTop ?? tile) : (o.tileY ?? tile); for (let i = 0; i < 4; i++) { const k = f * 4 + i; uv.setXY(k, uv.getX(k) * dims[f][0] / tt, uv.getY(k) * dims[f][1] / ty); } }
    const m = new THREE.Mesh(g, o.mats || (o.mat?.isMaterial ? o.mat : this.mat(o.mat || { color: o.color ?? 0x888888 })));
    m.position.set(o.x || 0, (o.y || 0) + h / 2, o.z || 0); if (o.ry) m.rotation.y = o.ry; if (o.rx) m.rotation.x = o.rx; if (o.rz) m.rotation.z = o.rz;
    m.castShadow = o.cast !== false; m.receiveShadow = true; (o.parent || this.scene).add(m);
    if (o.solid) m.userData.solid = this.course.addSolid({ x0: m.position.x - w / 2, x1: m.position.x + w / 2, y0: o.y || 0, y1: (o.y || 0) + h, z0: m.position.z - d / 2, z1: m.position.z + d / 2, type: o.solid === true ? 'solid' : o.solid, obj: m, ...(o.sol || {}) });
    if (o.top) this.course.addPiece({ x0: m.position.x - w / 2, x1: m.position.x + w / 2, z0: m.position.z - d / 2, z1: m.position.z + d / 2, fn: () => (o.y || 0) + h, step: o.step ?? 0.7, under: o.y > 0.5 ? () => o.y : undefined });
    return m;
  }
  cyl(o) { const m = new THREE.Mesh(new THREE.CylinderGeometry(o.r1 ?? o.r, o.r, o.h, o.seg || 16, 1, !!o.open), o.mat?.isMaterial ? o.mat : this.mat(o.mat || { color: o.color ?? 0x888888 })); m.position.set(o.x || 0, (o.y || 0) + (o.rx || o.rz ? 0 : o.h / 2), o.z || 0); if (o.rx) m.rotation.x = o.rx; if (o.rz) m.rotation.z = o.rz; m.castShadow = o.cast !== false; m.receiveShadow = true; (o.parent || this.scene).add(m); return m; }
  // Endless-looking textured ground that follows the camera
  ground(o = {}) {
    const size = o.size ?? 7000, tile = o.tile ?? ((o.tex ?? '') === 'tx_grass' ? 5 : 12), m = this.mat({ tex: o.tex ?? 'tx_asphalt', rep: size / tile, color: o.color, rough: o.rough ?? 0.95, fallback: o.fallback ?? 0x556055 });
    const V = o.vary === false ? null : { ...(VARY_DEF[o.tex ?? 'tx_asphalt'] || {}), ...(o.vary || {}) }; let gm = m;
    if (V) { gm = m.clone(); if (m.map) gm.map = m.map; if (o.color == null && V.tint != null) gm.color.set(V.tint); varyMaterial(gm, V); }
    const g = new THREE.Mesh(new THREE.PlaneGeometry(size, size), gm); g.rotation.x = -Math.PI / 2; g.position.y = o.y ?? 0; g.receiveShadow = true; g.userData.tile = tile; this.scene.add(g);
    if (o.follow !== false) this.bigGround = g; if (o.base !== false) { const y = o.y ?? 0; this.course.base = () => y; } return g;
  }
  water(o = {}) {
    const size = o.size ?? 7000; const N = 256, cv = document.createElement('canvas'); cv.width = cv.height = N; const c = cv.getContext('2d'); const id = c.createImageData(N, N);
    const H = new Float32Array(N * N); let sd = 9; const rr = () => { sd = (sd * 16807) % 2147483647; return sd / 2147483647; };
    for (const [P, amp] of [[8, 1], [16, 0.55], [32, 0.3], [64, 0.16]]) { const L = new Float32Array(P * P); for (let i = 0; i < P * P; i++) L[i] = rr(); const sm = t => t * t * (3 - 2 * t);
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const fx = x / N * P, fy = y / N * P, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = sm(fx - x0), ty = sm(fy - y0), g = (a, b) => L[(b % P) * P + (a % P)]; H[y * N + x] += amp * ((g(x0, y0) * (1 - tx) + g(x0 + 1, y0) * tx) * (1 - ty) + (g(x0, y0 + 1) * (1 - tx) + g(x0 + 1, y0 + 1) * tx) * ty); } }
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const i = (y * N + x) * 4, hx = H[y * N + (x + 1) % N] - H[y * N + (x + N - 1) % N], hy = H[((y + 1) % N) * N + x] - H[((y + N - 1) % N) * N + x]; id.data[i] = 128 - hx * 900; id.data[i + 1] = 128 - hy * 900; id.data[i + 2] = 255; id.data[i + 3] = 255; }
    c.putImageData(id, 0, 0); const n = new THREE.CanvasTexture(cv); n.wrapS = n.wrapT = THREE.RepeatWrapping; n.repeat.set(size / 16, size / 16); n.userData.own = true;
    const n2 = n.clone(); n2.repeat.set(size / 47, size / 47); n2.needsUpdate = true;
    const m = new THREE.MeshPhysicalMaterial({ color: o.color ?? 0x1d4a55, roughness: o.rough ?? 0.12, metalness: 0.0, normalMap: n, normalScale: new THREE.Vector2(0.3, 0.3), transparent: true, opacity: o.opacity ?? 0.93, envMapIntensity: 1.1 });
    const w = new THREE.Mesh(new THREE.PlaneGeometry(o.w ?? size, o.d ?? size), m); w.rotation.x = -Math.PI / 2; w.position.set(o.x ?? 0, o.y ?? 0, o.z ?? 0); w.receiveShadow = true; this.scene.add(w);
    this.onUpdate((dt, t) => { n.offset.set(t * 0.03 + (o.flow ?? 0) * t, t * 0.02); n2.offset.set(-t * 0.012, t * 0.017); });
    return w;
  }
  // Heightfield terrain; registers as the course base inside its rect
  terrain(o) {
    const { x0, x1, fn } = o, z0 = Math.min(o.z0, o.z1), z1 = Math.max(o.z0, o.z1), res = o.res ?? 4, nx = Math.ceil((x1 - x0) / res), nz = Math.ceil((z1 - z0) / res), tile = o.tile ?? 14;
    const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, nx, nz); g.rotateX(-Math.PI / 2); g.translate((x0 + x1) / 2, 0, (z0 + z1) / 2);
    const p = g.attributes.position, uv = g.attributes.uv; for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i); p.setY(i, fn(x, z)); uv.setXY(i, x / tile, z / tile); }
    g.computeVertexNormals(); let tm = o.mat?.isMaterial ? o.mat : this.mat(o.mat || { tex: o.tex ?? 'tx_dirt' }); const tk = o.mat?.tex ?? o.tex ?? (o.mat ? null : 'tx_dirt');
    if (o.vary !== false && tk && VARY_DEF[tk]) { const map = tm.map; tm = tm.clone(); tm.map = map; varyMaterial(tm, { ...VARY_DEF[tk], ...(o.vary || {}) }); }
    const m = new THREE.Mesh(g, tm); m.receiveShadow = true; m.castShadow = !!o.cast; this.scene.add(m);
    if (o.base !== false) { const prev = this.course.base; this.course.base = (x, z) => (x >= x0 && x <= x1 && z >= z0 && z <= z1) ? fn(x, z) : prev(x, z); }
    return m;
  }
  // Sloped slab between (z0,y0) and (z1,y1). Travel is toward -Z so normally z1 < z0. curve>1 = kicker.
  slope(o) {
    const { x = 0, w = 8, z0, z1, y0 = 0, y1 = 3, curve = 1, base = Math.min(o.y0 ?? 0, o.y1 ?? 3) - (o.thick ?? 0), seg = curve === 1 ? 1 : 10 } = o;
    const prof = t => y0 + (y1 - y0) * (curve === 1 ? t : curve > 0 ? Math.pow(t, curve) : 1 - Math.pow(1 - t, -curve));
    const sh = new THREE.Shape(); sh.moveTo(0, base - 0); for (let i = 0; i <= seg; i++) { const t = i / seg; sh.lineTo(t * Math.abs(z1 - z0), prof(t)); } sh.lineTo(Math.abs(z1 - z0), o.thick != null ? prof(1) - o.thick : base); if (o.thick != null) { for (let i = seg; i >= 0; i--) { const t = i / seg; sh.lineTo(t * Math.abs(z1 - z0), prof(t) - o.thick); } } else sh.lineTo(0, base);
    const g = new THREE.ExtrudeGeometry(sh, { depth: w, bevelEnabled: false }); g.translate(0, 0, -w / 2);
    const m = new THREE.Mesh(g, o.mat?.isMaterial ? o.mat : this.mat(o.mat || { tex: 'tx_wood', rep: 0.25, fallback: 0x8a6a45 }));
    m.rotation.y = z1 < z0 ? Math.PI / 2 : -Math.PI / 2; m.position.set(x, 0, z0); m.castShadow = true; m.receiveShadow = true; this.scene.add(m);
    const za = Math.min(z0, z1), zb = Math.max(z0, z1);
    const piece = this.course.addPiece({ x0: x - w / 2, x1: x + w / 2, z0: za, z1: zb, fn: (px, pz) => prof((pz - z0) / (z1 - z0)), step: o.step ?? 1.2, under: o.thick != null ? (px, pz) => prof((pz - z0) / (z1 - z0)) - o.thick : undefined });
    m.userData.piece = piece; return m;
  }
  ramp(o) { return this.slope({ curve: 1.6, y0: o.y ?? 0, y1: (o.y ?? 0) + (o.h ?? 2), z0: o.z, z1: o.z - (o.len ?? 10), mat: o.mat || { tex: 'tx_wood', rep: 0.25, fallback: 0x8a6a45 }, ...o }); }
  // Flat platform (bridge deck, rooftop). y is the top surface.
  deck(o) { const { x = 0, w = 10, z0, z1, y = 0, thick = 0.6 } = o; return this.box({ x, y: y - thick, z: (z0 + z1) / 2, w, h: thick, d: Math.abs(z1 - z0), mat: o.mat || 'tx_concrete', tile: o.tile ?? 6, top: true, step: o.step ?? 0.8, cast: o.cast }); }
  // Road ribbon following path cx(z) and course height. Adds lane markings.
  road(o) {
    const { z0, z1, width = 10, lanes = 2, path = () => o.x || 0, y, step = 6 } = o; const zs = []; for (let z = z0; z > z1; z -= step) zs.push(z); zs.push(z1);
    const pos = [], uv = [], idx = [], hy = (x, z) => y ?? (this.course.height(x, z) + 0.03);
    zs.forEach((z, i) => { const cx = path(z), yl = hy(cx - width / 2 + 0.2, z), yr = hy(cx + width / 2 - 0.2, z); pos.push(cx - width / 2, yl, z, cx + width / 2, yr, z); uv.push(0, -z / 8, width / 8, -z / 8); if (i) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
    const m = new THREE.Mesh(g, this.mat(o.mat || { tex: 'tx_asphalt', rough: 0.9, color: o.color })); m.receiveShadow = true; this.scene.add(m);
    if (o.marks !== false) {
      const dash = []; const lw = width / lanes;
      for (let z = z0; z > z1; z -= 9) for (let l = 1; l < lanes; l++) dash.push([path(z - 1.5) - width / 2 + l * lw, z - 1.5, l === lanes / 2 && o.double ? 1 : 0]);
      const dm = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.16, 3), new THREE.MeshBasicMaterial({ color: o.markColor ?? 0xd8d8c8, toneMapped: true }), dash.length + 2); const M = new THREE.Matrix4(), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0)), s = V3(1, 1, 1);
      dash.forEach((d, i) => { M.compose(V3(d[0], hy(d[0], d[1]) + 0.025, d[1]), q, d[2] ? s.set(1.5, 3, 1) : s.set(1, 1, 1)); dm.setMatrixAt(i, M); }); dm.count = dash.length; dm.frustumCulled = false; this.scene.add(dm);
      if (o.edges !== false) for (const sgn of [-1, 1]) { const ep = [], ei = []; zs.forEach((z, i) => { const cx = path(z) + sgn * (width / 2 - 0.35), yy = hy(cx, z) + 0.03; ep.push(cx - 0.08, yy, z, cx + 0.08, yy, z); if (i) { const a = (i - 1) * 2; ei.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } }); const eg = new THREE.BufferGeometry(); eg.setAttribute('position', new THREE.Float32BufferAttribute(ep, 3)); eg.setIndex(ei); this.scene.add(new THREE.Mesh(eg, new THREE.MeshBasicMaterial({ color: o.markColor ?? 0xd8d8c8 }))); }
    }
    return m;
  }
  // Building with facade texture. x,z centre; returns mesh. Registers solid + walkable roof.
  building(o) {
    const { w = 14, d = 14, h = 20, fac = 'tx_fac_office', facTile = 12 } = o;
    const side = this.mat({ tex: fac, rough: 0.8, ...(o.lit ? { emissive: 0xffd9a0, emI: o.lit, emMap: true } : {}), ...(o.tint ? { color: o.tint } : {}) }), roof = this.mat(o.roofMat || { tex: 'tx_roof', color: 0x999999 });
    const m = this.box({ ...o, w, h, d, tile: facTile, tileTop: o.roofTile ?? 7, mats: [side, side, roof, roof, side, side], solid: o.solid ?? true, top: o.top ?? false });
    if (o.parapet) { const p = this.mat({ color: 0x777066 }); for (const [dx, dz, ww, dd] of [[0, d / 2 - 0.15, w, 0.3], [0, -d / 2 + 0.15, w, 0.3], [w / 2 - 0.15, 0, 0.3, d], [-w / 2 + 0.15, 0, 0.3, d]]) this.box({ x: (o.x || 0) + dx, y: (o.y || 0) + h, z: (o.z || 0) + dz, w: ww, h: o.parapet, d: dd, mat: p }); }
    return m;
  }
  // Fill a street side with buildings. side: -1 left / +1 right, x = kerb line (inner face)
  row(o) {
    const { side = 1, x = 12, z0, z1, depth = [12, 18], height = [12, 30], width = [10, 22], fac = ['tx_fac_office'], gap = 0, seedv = 7 } = o; srand(seedv + (side > 0 ? 100 : 0));
    let z = z0; const out = [];
    while (z > z1) { const w = Math.min(sr(width[0], width[1]), z - z1 + 2), d = sr(depth[0], depth[1]), h = sr(height[0], height[1]); const f = Array.isArray(fac) ? fac[Math.floor(sr(fac.length))] : fac;
      out.push(this.building({ x: x * 1 + side * d / 2, z: z - w / 2, w: d, d: w, h, fac: f, lit: o.lit, solid: o.solid ?? true, tint: o.tints ? o.tints[Math.floor(sr(o.tints.length))] : undefined, y: o.yfn ? o.yfn(z - w / 2) : (o.y ?? 0), facTile: o.facTile })); z -= w + (gap ? sr(0, gap) : 0); }
    return out;
  }
  // Place a generated model. opts: x,y,z,ry,len,height,solid('solid'|'break'|false),hitScale
  put(id, o = {}) {
    const m = model(id, { len: o.len, height: o.height, yaw: 0, fit: o.fit }); m.position.set(o.x || 0, o.y ?? (o.onGround ? this.course.height(o.x || 0, o.z || 0) : 0), o.z || 0); m.rotation.y = o.ry || 0; if (o.rx) m.rotation.x = o.rx; if (o.rz) m.rotation.z = o.rz; (o.parent || this.scene).add(m);
    if (o.solid) { const s = m.userData.size, k = o.hitScale ?? 0.85, rot = Math.abs(Math.sin(o.ry || 0)) > 0.7, hw = (rot ? s.z : s.x) / 2 * k, hd = (rot ? s.x : s.z) / 2 * k; m.userData.solid = this.course.addSolid({ x0: m.position.x - hw, x1: m.position.x + hw, y0: m.position.y, y1: m.position.y + s.y * (o.hitH ?? 1), z0: m.position.z - hd, z1: m.position.z + hd, type: o.solid === true ? 'solid' : o.solid, obj: m, ...(o.sol || {}) }); }
    return m;
  }
  scatter(id, n, area, o = {}) { if (['pine_tree', 'oak_tree', 'palm_tree'].includes(id) || id.startsWith('tree:')) return this.forest(id, n, area, o); srand(o.seedv ?? 11); const out = []; for (let i = 0; i < n; i++) { const [x, z] = area(sr, i); const s = sr(o.h?.[0] ?? 4, o.h?.[1] ?? 7); out.push(this.put(id, { x, z, height: s, ry: sr(6.28), onGround: true, solid: o.solid, hitScale: o.hitScale ?? 0.25, ...o.each })); } return out; }
  // Many copies of one generated model drawn with instancing (forests, crowds of props). area(rand, i) -> [x, z]
  forest(id, n, area, o = {}) {
    if (id.startsWith('sp_')) return this.sprites(id, n, area, o);
    const TREE = { pine_tree: 'pine', oak_tree: 'oak', palm_tree: 'palm' }[id] || (id.startsWith('tree:') ? id.slice(5) : null);
    if (TREE) return this.trees(TREE, n, area, o);
    const src = model(id, { height: 1 }); let mesh = null; src.updateMatrixWorld(true); src.traverse(c => { if (c.isMesh && !mesh) mesh = c; }); if (!mesh || src.userData.placeholder) return null;
    const im = new THREE.InstancedMesh(mesh.geometry, mesh.material, n); im.castShadow = o.cast !== false; im.receiveShadow = true; im.frustumCulled = false;
    const M = new THREE.Matrix4(), T = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(); srand(o.seedv ?? 17); let k = 0;
    for (let i = 0; i < n; i++) { const a = area(sr, i); if (!a) continue; const [x, z] = a, h = sr(o.h?.[0] ?? 6, o.h?.[1] ?? 12), y = a[2] ?? this.course.height(x, z); if (y < -1e5) continue; T.compose(new THREE.Vector3(x, y - (o.sink ?? 0.1), z), q.setFromEuler(e.set(0, sr(6.28), 0)), new THREE.Vector3(h * sr(0.85, 1.15), h, h * sr(0.85, 1.15))); M.multiplyMatrices(T, mesh.matrixWorld); im.setMatrixAt(k++, M);
      if (o.solid && Math.abs(x) < (o.solidX ?? 1e9)) this.course.addSolid({ x0: x - 0.35, x1: x + 0.35, y0: y, y1: y + h, z0: z - 0.35, z1: z + 0.35, msg: o.msg || 'Wrapped it round a tree' }); }
    im.count = k; this.scene.add(im); return im;
  }
  // Procedural instanced trees: pine | oak | palm | bush | cypress | jungle | dead | snowpine
  trees(kind, n, area, o = {}) {
    const parts = [], col = (g, r, gg, b, grad = 0) => { g = g.index ? g.toNonIndexed() : g; const p = g.attributes.position, c = new Float32Array(p.count * 3); g.computeBoundingBox(); const y0 = g.boundingBox.min.y, y1 = g.boundingBox.max.y; for (let i = 0; i < p.count; i++) { const t = (p.getY(i) - y0) / Math.max(1e-5, y1 - y0), k = 1 - grad + grad * t * 1.6, h = ((Math.sin(p.getX(i) * 91.7 + p.getZ(i) * 53.3 + p.getY(i) * 37.1) * 43758.5) % 1 + 1) % 1 * 0.25 + 0.875; c[i * 3] = r * k * h; c[i * 3 + 1] = gg * k * h; c[i * 3 + 2] = b * k * h; } g.setAttribute('color', new THREE.BufferAttribute(c, 3)); parts.push(g); return g; };
    const jit = (g, a) => { const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), h = Math.sin(x * 37.3 + y * 71.7 + z * 53.1) * 43758.5453, f = 1 + ((h % 1 + 1) % 1 - 0.5) * a; p.setXYZ(i, x * f, y * (1 + (f - 1) * 0.5), z * f); } g.computeVertexNormals(); return g; };
    const blob = (x, y, z, r, c) => { const g = jit(new THREE.IcosahedronGeometry(r, 2), 0.28); g.translate(x, y, z); col(g, c[0], c[1], c[2], 0.45); };
    const trunk = (h, r0, r1, c = [0.22, 0.15, 0.1]) => { const g = new THREE.CylinderGeometry(r1, r0, h, 7); g.translate(0, h / 2, 0); col(g, c[0], c[1], c[2]); };
    if (kind === 'pine' || kind === 'snowpine') { trunk(0.3, 0.035, 0.022); const c = kind === 'pine' ? [0.07, 0.19, 0.09] : [0.75, 0.82, 0.86]; for (let i = 0; i < 6; i++) { const g = jit(new THREE.ConeGeometry(0.25 - i * 0.034, 0.3, 9, 2), 0.2); g.translate(0, 0.3 + i * 0.125, 0); g.rotateY(i * 1.1); col(g, c[0], c[1], c[2], 0.5); } }
    else if (kind === 'palm') { for (let i = 0; i < 6; i++) { const g = new THREE.CylinderGeometry(0.024, 0.032, 0.16, 6); g.translate(Math.sin(i * 0.35) * 0.05, 0.08 + i * 0.15, 0); col(g, 0.33, 0.27, 0.19); }
      // fronds: long arching blades that rise out of the crown and droop at the tips, folded along the spine
      for (let i = 0; i < 14; i++) { const L = 0.5 + (i % 3) * 0.06, W = 0.16, g = new THREE.PlaneGeometry(1, 1, 10, 2), p = g.attributes.position;
        for (let k = 0; k < p.count; k++) { const t = p.getX(k) + 0.5, u = p.getY(k) * 2, w = W * Math.sin(Math.PI * Math.min(1, t * 1.1)) * (1 - t * 0.35); p.setXYZ(k, t * L, Math.sin(t * Math.PI * 0.55) * 0.12 - t * t * (0.32 + (i % 2) * 0.1) - Math.abs(u) * 0.035, u * w); }
        g.rotateZ(-0.15 + (i % 4) * 0.12); g.rotateY(i * 2.39996); g.translate(0.08, 0.93, 0); g.computeVertexNormals(); col(g, 0.14, 0.32, 0.11, 0.15); } }
    else if (kind === 'bush') { for (const [x, y, z, r] of [[0, 0.3, 0, 0.34], [0.3, 0.24, 0.1, 0.26], [-0.26, 0.22, -0.12, 0.25], [0.05, 0.2, 0.3, 0.22]]) blob(x, y, z, r, [0.12, 0.27, 0.1]); }
    else if (kind === 'dead') { trunk(0.6, 0.04, 0.015, [0.3, 0.26, 0.22]); for (let i = 0; i < 5; i++) { const g = new THREE.CylinderGeometry(0.006, 0.016, 0.35, 5); g.translate(0, 0.175, 0); g.rotateZ(0.7 + (i % 2) * 0.4); g.rotateY(i * 1.3); g.translate(0, 0.35 + i * 0.07, 0); col(g, 0.3, 0.26, 0.22); } }
    else { const c = kind === 'cypress' ? [0.2, 0.27, 0.16] : kind === 'jungle' ? [0.06, 0.22, 0.07] : [0.13, 0.28, 0.09]; trunk(kind === 'jungle' ? 0.62 : 0.48, kind === 'cypress' ? 0.085 : 0.05, 0.03); const top = kind === 'jungle' ? 0.74 : 0.66;
      for (const [x, y, z, r] of [[0, top, 0, 0.24], [0.2, top - 0.08, 0.05, 0.19], [-0.19, top - 0.06, -0.06, 0.2], [0.03, top - 0.1, 0.21, 0.18], [-0.04, top - 0.07, -0.2, 0.18], [0.1, top + 0.14, -0.05, 0.17], [-0.12, top + 0.1, 0.1, 0.16]]) blob(x, y, z, r, c);
      if (kind === 'cypress') for (let i = 0; i < 9; i++) { const g = new THREE.PlaneGeometry(0.05, 0.3); g.translate(Math.cos(i * 0.7) * 0.25, top - 0.3, Math.sin(i * 0.7) * 0.25); g.rotateY(i); col(g, 0.42, 0.46, 0.38); } }
    for (const g of parts) for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
    const geo = mergeGeometries(parts); const leaf = kind === 'dead' || kind === 'palm' ? null : tex('tx_grass', 3, 3); const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide, ...(leaf ? { map: leaf, color: 0xffffff } : {}) }); if (leaf) { leaf.userData.own = true; m.color.setScalar(o.bright ?? 2.3); } // dead trees and palm trunks must not pick up the leaf texture
    const im = new THREE.InstancedMesh(geo, m, n); im.castShadow = o.cast !== false; im.receiveShadow = true; im.frustumCulled = false; const M = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(); srand(o.seedv ?? 17); let k = 0;
    for (let i = 0; i < n; i++) { const a = area(sr, i); if (!a) continue; const [x, z] = a, h = sr(o.h?.[0] ?? 6, o.h?.[1] ?? 12), y = a[2] ?? this.course.height(x, z); if (y < -1e5) continue; const wv = sr(0.8, 1.2) * (o.wide ?? 1); M.compose(new THREE.Vector3(x, y - (o.sink ?? 0.1), z), q.setFromEuler(e.set(sr(-0.05, 0.05), sr(6.28), sr(-0.05, 0.05))), new THREE.Vector3(h * wv, h, h * wv)); im.setMatrixAt(k++, M);
      if (o.solid && Math.abs(x) < (o.solidX ?? 1e9)) this.course.addSolid({ x0: x - 0.3, x1: x + 0.3, y0: y, y1: y + h, z0: z - 0.3, z1: z + 0.3, msg: o.msg || 'Wrapped it round a tree' }); }
    im.count = k; this.scene.add(im); return im;
  }
  // Photo cut-out trees / crowds as crossed alpha-tested cards, instanced.
  sprites(id, n, area, o = {}) {
    const t = rawTex(id); if (!t) return null; const asp = t.image.width / t.image.height, cross = o.cross !== false;
    const pos = [], uv = [], nor = [], idx = []; const quad = (ax, az) => { const b = pos.length / 3; for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) { pos.push((u - 0.5) * asp * ax, v, (u - 0.5) * asp * az); uv.push(u, v); nor.push(0.0, 1, 0.0); } idx.push(b, b + 1, b + 2, b, b + 2, b + 3); };
    quad(1, 0); if (cross) quad(0, 1);
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setIndex(idx);
    const m = new THREE.MeshStandardMaterial({ map: t, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1, metalness: 0, color: o.color ?? 0xd8d8d8 });
    const im = new THREE.InstancedMesh(g, m, n); im.castShadow = o.cast !== false; im.receiveShadow = false; im.frustumCulled = false; im.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: t, alphaTest: 0.5 });
    const M = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), c = new THREE.Color(); srand(o.seedv ?? 17); let k = 0;
    for (let i = 0; i < n; i++) { const a = area(sr, i); if (!a) continue; const [x, z] = a, h = sr(o.h?.[0] ?? 6, o.h?.[1] ?? 12), y = a[2] ?? this.course.height(x, z); if (y < -1e5) continue; M.compose(new THREE.Vector3(x, y - (o.sink ?? 0.15), z), q.setFromEuler(e.set(0, cross ? sr(6.28) : (o.ry ?? 0), 0)), new THREE.Vector3(h, h, h)); im.setMatrixAt(k, M); const b = sr(0.72, 1.05); im.setColorAt(k, c.setRGB(b, b * sr(0.95, 1.05), b * 0.95)); k++;
      if (o.solid && Math.abs(x) < (o.solidX ?? 1e9)) this.course.addSolid({ x0: x - 0.3, x1: x + 0.3, y0: y, y1: y + h, z0: z - 0.3, z1: z + 0.3, msg: o.msg || 'Wrapped it round a tree' }); }
    im.count = k; if (im.instanceColor) im.instanceColor.needsUpdate = true; this.scene.add(im); return im;
  }
  char(id, o = {}) { const c = new Character(id, o); c.root.position.set(o.x || 0, o.y || 0, o.z || 0); c.heading = o.heading ?? 0; (o.parent || this.scene).add(c.root); this.chars.push(c); if (o.pose) c.setPose(o.pose, 0); return c; }
  // Film crew dressing: camera on tripod, light, chair, crew figure
  crew(o = {}) {
    const { x = 0, z = 0, y = 0, ry = 0 } = o; const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = ry; this.scene.add(g); (this.camAvoid ||= []).push(g);
    this.put('camera_crew', { parent: g, x: 0, z: 0, height: 1.7 }); this.put('film_light', { parent: g, x: 2.2, z: 0.8, height: 3.2, ry: 0.4 }); this.put('director_chair', { parent: g, x: -1.6, z: 0.9, height: 1.15, ry: -0.5 });
    if (o.people !== false) { const c = this.char(o.who || 'ch_stunt', { parent: g, x: -0.2, z: 0.9, heading: 0 }); c.setPose('idle', 0); }
    const l = new THREE.SpotLight(0xfff2dd, o.light ?? 0, 60, 0.5, 0.6, 1.2); if (o.light) { l.position.set(2.2, 3, 0.8); l.target.position.set(2.2, 0.5, -14); g.add(l, l.target); }
    return g;
  }
  cones(list, o = {}) { const g = new THREE.ConeGeometry(0.22, 0.7, 10), m = this.mat({ color: 0xff5a10, rough: 0.6 }); for (const [x, z] of list) { const c = new THREE.Mesh(g, m); c.position.set(x, this.course.height(x, z) + 0.35, z); c.castShadow = true; this.scene.add(c); if (o.solid !== false) this.course.addSolid({ x0: x - 0.25, x1: x + 0.25, y0: c.position.y - 0.35, y1: c.position.y + 0.4, z0: z - 0.25, z1: z + 0.25, type: 'break', obj: c, soft: true, debris: 0xff5a10 }); } }
  light(o) { const l = new THREE.PointLight(o.color ?? 0xffc880, o.i ?? 30, o.dist ?? 30, o.decay ?? 1.6); l.position.set(o.x || 0, o.y ?? 4, o.z || 0); (o.parent || this.scene).add(l); if (o.bulb !== false) { const b = new THREE.Mesh(new THREE.SphereGeometry(o.r ?? 0.18, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(o.color ?? 0xffc880).multiplyScalar(o.glow ?? 4) })); b.position.copy(l.position); (o.parent || this.scene).add(b); l.userData.bulb = b; } return l; }
  // glowing marker ring on ground for marks / landing zones
  mark(o) { const r = o.r ?? 3; const m = new THREE.Mesh(new THREE.RingGeometry(r * 0.82, r, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(o.color ?? 0x40ff80).multiplyScalar(1.8), transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.set(o.x || 0, (o.y ?? this.course.height(o.x || 0, o.z || 0)) + 0.06, o.z || 0); this.scene.add(m); return m; }
  // line across the road (start/finish/mark)
  line(o) { const m = new THREE.Mesh(new THREE.PlaneGeometry(o.w ?? 10, o.d ?? 0.5), new THREE.MeshBasicMaterial({ color: new THREE.Color(o.color ?? 0xffe14a).multiplyScalar(o.glow ?? 1.4), transparent: true, opacity: 0.85, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.set(o.x || 0, (o.y ?? this.course.height(o.x || 0, o.z || 0)) + 0.05, o.z || 0); this.scene.add(m); return m; }
  bbox(obj) { _box.setFromObject(obj); return { min: _box.min.clone(), max: _box.max.clone(), size: _box.getSize(_v).clone() }; }
}
export { MODEL_META };
