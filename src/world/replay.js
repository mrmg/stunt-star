import * as THREE from 'three';

// ------------------------------------------------------------------------------------------------
// Recorder: samples every moving Object3D in the scene (vehicles, props, character bones) at 30 Hz,
// plus particle-emit and sound events, so any part of a take can be played back from any camera.
// ------------------------------------------------------------------------------------------------
const EPS = 1e-5, _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;

export class Recorder {
  constructor(s) { this.s = s; this.tracks = []; this.map = new Map(); this.fx = []; this.sfx = []; this.on = false; this.prevT = -1; this.nextT = 0; this.scanT = 0; this.t0 = 0; this.end = 0; }
  skip(o) { const s = this.s, u = o.userData; return u.noRec || o === s.scene || o === s.sky || o === s.backdrop || o === s.bigGround || o === s.sun || o === s.sun?.target || o.isCamera; }
  start(t) { this.on = true; this.t0 = t; this.scan(); this.s.fx.rec = this.fx; this.s.fx.recT = () => this.s.t; this.capture(t); }
  stop() { if (!this.on) return; this.on = false; this.s.fx.rec = null; }
  scan() { this.s.scene.traverse(o => { if (!this.map.has(o) && !this.skip(o)) { const tr = { o, t: [], v: [], par: [[-1e9, o.parent]], parent: o.parent, last: null, lt: -1, ci: 0 }; this.map.set(o, tr); this.tracks.push(tr); } }); }
  tick(t) { if (!this.on) return; if (t >= this.scanT) { this.scanT = t + 0.25; this.scan(); } if (t >= this.nextT) { this.nextT = t + 1 / 30; this.capture(t); } }
  capture(t) {
    for (const tr of this.tracks) {
      const o = tr.o, p = o.position, q = o.quaternion, sc = o.scale, vis = o.visible && o.parent ? 1 : 0, L = tr.last;
      if (o.parent !== tr.parent) { tr.parent = o.parent; tr.par.push([t, o.parent]); }
      if (L && Math.abs(L[0] - p.x) < EPS && Math.abs(L[1] - p.y) < EPS && Math.abs(L[2] - p.z) < EPS && Math.abs(L[3] - q.x) < EPS && Math.abs(L[4] - q.y) < EPS && Math.abs(L[5] - q.z) < EPS && Math.abs(L[6] - q.w) < EPS && Math.abs(L[7] - sc.x) < EPS && Math.abs(L[8] - sc.y) < EPS && Math.abs(L[9] - sc.z) < EPS && L[10] === vis) continue;
      if (L && tr.lt < this.prevT) { tr.t.push(this.prevT); tr.v.push(...L); } // hold key so a long-static object does not drift
      const cur = [p.x, p.y, p.z, q.x, q.y, q.z, q.w, sc.x, sc.y, sc.z, vis]; tr.t.push(t); tr.v.push(...cur); tr.last = cur; tr.lt = t;
    }
    this.prevT = t; this.end = t;
  }
  // put every recorded object where it was at time t
  seek(t) {
    for (const tr of this.tracks) {
      const T = tr.t, n = T.length, o = tr.o; if (!n) continue;
      let par = tr.par[0][1]; for (const [pt, pp] of tr.par) if (pt <= t) par = pp; if (o.parent !== par) { if (par) par.add(o); else o.parent?.remove(o); }
      if (t < T[0]) { o.visible = false; continue; }
      let i = Math.min(tr.ci, n - 1); while (i > 0 && T[i] > t) i--; while (i < n - 1 && T[i + 1] <= t) i++; tr.ci = i;
      const V = tr.v, a = i * 11;
      if (i >= n - 1) { o.position.set(V[a], V[a + 1], V[a + 2]); o.quaternion.set(V[a + 3], V[a + 4], V[a + 5], V[a + 6]); o.scale.set(V[a + 7], V[a + 8], V[a + 9]); o.visible = !!V[a + 10]; continue; }
      const b = a + 11, k = clamp((t - T[i]) / Math.max(1e-6, T[i + 1] - T[i]));
      o.position.set(lerp(V[a], V[b], k), lerp(V[a + 1], V[b + 1], k), lerp(V[a + 2], V[b + 2], k));
      _q.set(V[a + 3], V[a + 4], V[a + 5], V[a + 6]); _q2.set(V[b + 3], V[b + 4], V[b + 5], V[b + 6]); o.quaternion.slerpQuaternions(_q, _q2, k);
      o.scale.set(lerp(V[a + 7], V[b + 7], k), lerp(V[a + 8], V[b + 8], k), lerp(V[a + 9], V[b + 9], k)); o.visible = !!V[a + 10];
    }
  }
}

// sound calls that are replayed during playback (loops are recorded separately at 10 Hz)
export const ONESHOT = new Set(['tune', 'cheer', 'sting', 'impact', 'crash', 'glass', 'explosion', 'thud', 'punch', 'whoosh', 'splash', 'thunder', 'gun', 'horn', 'bell', 'clap', 'skidHit', 'metal', 'roar']);
export function recordingAudio(audio, s) {
  const lastSet = new Map();
  return new Proxy(audio, {
    get(target, k) {
      const v = target[k]; if (typeof v !== 'function') return v;
      if (ONESHOT.has(k)) return (...a) => { const R = s.rec; if (R?.on) R.sfx.push({ t: s.t, k, a }); return v.apply(target, a); };
      if (k === 'set') return (name, kind, p, vol) => { const R = s.rec; if (R?.on) { const L = lastSet.get(name); if (!L || s.t - L.t > 0.1 || Math.abs(L.vol - vol) > 0.08) { const e = { t: s.t, k: 'set', a: [name, kind, p, vol] }; R.sfx.push(e); lastSet.set(name, e); } } return v.call(target, name, kind, p, vol); };
      return v.bind(target);
    },
  });
}

// ------------------------------------------------------------------------------------------------
// Shot planning. A "moment" is a window [t0,t1] around a subject. Shots are film-grammar camera rigs
// built from the subject's recorded path: wide static pan, low ground cam, tracking dolly, head-on,
// overhead crane, chase and a bullet-time orbit.
// ------------------------------------------------------------------------------------------------
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z), _v = V3(), _w = V3();
const box = new THREE.Box3();
export const SHOTS = ['wide', 'low', 'track', 'front', 'top', 'chase', 'orbit', 'rear'];

// sample a subject's world path from a recorder (or from live predicted points)
export function samplePath(rec, subject, t0, t1, n = 28) {
  const pts = [];
  for (let i = 0; i <= n; i++) { const t = lerp(t0, t1, i / n); rec.seek(t); subject.updateWorldMatrix(true, false); pts.push({ t, p: subject.getWorldPosition(V3()) }); }
  return pts;
}
export function sizeOf(subject) { box.setFromObject(subject); const s = box.getSize(_v); return clamp(Math.max(s.x, s.y, s.z) / 2, 0.9, 30); }
function pathAt(pts, t) { if (t <= pts[0].t) return pts[0].p.clone(); for (let i = 0; i < pts.length - 1; i++) if (t <= pts[i + 1].t) { const k = (t - pts[i].t) / Math.max(1e-6, pts[i + 1].t - pts[i].t); return pts[i].p.clone().lerp(pts[i + 1].p, k); } return pts.at(-1).p.clone(); }

// line-of-sight test: ray casts against everything rendered (terrain, buildings, instanced forests),
// ignoring the subject itself. Returns 1 if the view of the subject is blocked, plus a ground check.
const ray = new THREE.Raycaster(), _dir = V3();
let occl = null, occlSubj = null, occlScene = null;
function occluders(s, subject) {
  if (occlScene === s.scene && occlSubj === subject && occl) return occl;
  const skip = new Set([s.sky, s.backdrop, s.bigGround]); occl = s.scene.children.filter(o => !skip.has(o) && !o.isLight && !o.userData.noRec && o !== subject && (o.isMesh || o.isGroup || o.isInstancedMesh || o.children.length));
  occlSubj = subject; occlScene = s.scene; return occl;
}
// never put a camera inside the crew's own kit (it's parked right by the action)
function inAvoid(s, p) { for (const g of s.camAvoid || []) { if (!g.userData.box) g.userData.box = new THREE.Box3().setFromObject(g).expandByScalar(0.8); if (g.userData.box.containsPoint(p)) return true; } return false; }
function blockedFrac(s, a, b, subject) {
  const c = s.course, g = c.height(a.x, a.z, a.y); if (g > -1e5 && a.y < g + 0.2) return 1;
  const d = _dir.subVectors(b, a), L = d.length(); if (L < 0.5) return 0; d.multiplyScalar(1 / L);
  if (inAvoid(s, a)) return 1;
  ray.set(a, d); ray.near = 0.05; ray.far = L - 1.2; const list = occluders(s, subject);
  for (const h of ray.intersectObjects(list, true)) { let o = h.object, mine = false; while (o) { if (o === subject) { mine = true; break; } o = o.parent; } if (!mine && h.object.visible !== false) return 1; }
  return 0;
}
function groundAt(s, x, z, y) { const g = s.course.height(x, z, y ?? 1e9); return g > -1e5 ? g : (y ?? 0) - 50; }

// Build one shot rig. Returns {type, cam(t) => {pos, look, fov}} using the sampled path pts.
export function makeShot(s, type, pts, R, o = {}) {
  const A = pts[0].p, B = pts.at(-1).p, mid = pathAt(pts, lerp(pts[0].t, pts.at(-1).t, 0.5));
  let D = V3(B.x - A.x, 0, B.z - A.z); const L = D.length(); if (L < 0.5) D.set(-Math.sin(o.heading || 0), 0, -Math.cos(o.heading || 0)); D.normalize();
  const N = V3(D.z, 0, -D.x), up = R * 0.45, span = Math.max(L, R * 4);
  let peak = -1e9; for (const q of pts) peak = Math.max(peak, q.p.y);
  const look = t => pathAt(pts, t).add(_v.set(0, up, 0));
  const subj = o.subject, tryBest = (cands, f) => { let best = null, bs = 1e9; for (const c of cands) { let sc = 0; const W = [0.4, 1, 2.5, 1.5, 0.8]; for (let i = 0; i <= 4; i++) sc += W[i] * blockedFrac(s, f(c, lerp(pts[0].t, pts.at(-1).t, i / 4)), look(lerp(pts[0].t, pts.at(-1).t, i / 4)), subj); sc = sc / 6.2 + (c.pen || 0) + (inAvoid(s, f(c, lerp(pts[0].t, pts.at(-1).t, 0.5))) ? 5 : 0); if (sc < bs) { bs = sc; best = c; } if (sc === 0 && !c.pen) break; } return best; };
  const side = o.side;
  if (type === 'wide' || type === 'front' || type === 'low' || type === 'top') {
    let pos;
    if (type === 'wide') { const C = []; for (const dk of [0.6, 1, 0.4, 0.25, 1.4]) for (const sd of side ? [side] : [1, -1]) for (const h of [0.08, 0.35, 0.8, 1.4]) C.push({ sd, h, dk, d: clamp(span * 0.5, Math.max(12, R * 5), 50) * dk * (o.dist ?? 1), pen: h * 0.06 + Math.abs(dk - 0.8) * 0.08 }); const P = c => { const q = mid.clone().addScaledVector(N, c.sd * c.d); q.y = Math.max(groundAt(s, q.x, q.z, q.y + 50) + 1.6, lerp(mid.y, peak, 0.3) + 1.6) + c.h * c.d; return q; }; const c = tryBest(C, P); pos = P(c); }
    else if (type === 'front') { const d = Math.max(12, R * 6) + span * 0.25; const C = []; for (const sd of [0.12, -0.12, 0.35, -0.35]) for (const h of [0.6, 2.5]) C.push({ sd, h }); const c = tryBest(C, c => B.clone().addScaledVector(D, d).addScaledVector(N, c.sd * d).setY(groundAt(s, B.x + D.x * d, B.z + D.z * d, B.y + 3) + c.h)); pos = B.clone().addScaledVector(D, d).addScaledVector(N, c.sd * d); pos.y = groundAt(s, pos.x, pos.z, B.y + 3) + c.h; }
    else if (type === 'low') { const at = pathAt(pts, lerp(pts[0].t, pts.at(-1).t, o.at ?? 0.62)); const C = []; for (const f of [1, 0.6, 2, 1.4]) for (const fw of [2.5, 1.2, 4]) for (const sd of side ? [side] : [1, -1]) C.push({ sd, f, fw, pen: Math.abs(f - 1) * 0.04 + Math.abs(fw - 2.5) * 0.02 }); const LP = c => at.clone().addScaledVector(N, c.sd * R * 2.2 * c.f).addScaledVector(D, R * c.fw); const c = tryBest(C, c => { const q = LP(c); return q.setY(groundAt(s, q.x, q.z, at.y) + 0.35); }); pos = LP(c); pos.y = groundAt(s, pos.x, pos.z, at.y) + 0.35; if (pos.y < at.y - 25) pos.y = at.y - 3; }
    else { pos = mid.clone().addScaledVector(N, span * 0.15); pos.y = peak + Math.max(20, span * 0.7); }
    const fov = type === 'wide' ? clamp(2 * Math.atan(span * 0.6 / pos.distanceTo(mid)) * 57.3, 24, 68) : type === 'low' ? 74 : type === 'front' ? 34 : 46;
    if (type === 'wide' || type === 'front') { const fr = R * (type === 'wide' ? 5.5 : 4.5) + 3; return { type, cam: t => { const lk = look(t); return { pos, look: lk, fov: o.fov ?? clamp(2 * Math.atan(fr / Math.max(1, pos.distanceTo(lk))) * 57.3, 16, type === 'wide' ? 58 : 45) }; } }; }
    return { type, cam: t => ({ pos, look: look(t), fov: o.fov ?? fov }) };
  }
  if (type === 'track' || type === 'rear' || type === 'chase') {
    const sd = side ?? (blockedFrac(s, mid.clone().addScaledVector(N, R * 4.2), mid, subj) <= blockedFrac(s, mid.clone().addScaledVector(N, -R * 4.2), mid, subj) ? 1 : -1);
    return { type, cam: t => { const p = pathAt(pts, t), ld = pathAt(pts, t + 0.25).sub(pathAt(pts, t - 0.25)); ld.y = 0; if (ld.lengthSq() < 1e-4) ld.copy(D); ld.normalize(); const n = V3(ld.z, 0, -ld.x);
      const pos = type === 'track' ? p.clone().addScaledVector(n, sd * R * 4.2).add(V3(0, R * 0.5, 0)) : type === 'rear' ? p.clone().addScaledVector(ld, -R * 1.2).addScaledVector(n, sd * R * 0.9).add(V3(0, R * 0.25, 0)) : p.clone().addScaledVector(ld, -R * 4).add(V3(0, R * 1.1, 0));
      pos.y = Math.max(pos.y, groundAt(s, pos.x, pos.z, pos.y) + 0.4); return { pos, look: look(t).addScaledVector(ld, type === 'rear' ? R * 3 : R * 0.6), fov: o.fov ?? (type === 'track' ? 40 : type === 'rear' ? 62 : 55) }; } };
  }
  if (type === 'orbit') {
    const r = R * 4.2, a0 = Math.atan2(N.x, N.z);
    return { type, cam: t => { const k = (t - pts[0].t) / Math.max(0.1, pts.at(-1).t - pts[0].t), a = a0 + k * 2.2, c = look(t); const pos = c.clone().add(V3(Math.sin(a) * r, R * 0.3, Math.cos(a) * r)); pos.y = Math.max(pos.y, groundAt(s, pos.x, pos.z, pos.y) + 0.4); return { pos, look: c, fov: o.fov ?? 42 }; } };
  }
  return makeShot(s, 'wide', pts, R, o);
}

// default edits: which shots, at what speed, over which part of the window
export function defaultEdit(kind) {
  if (kind === 'fail') return [{ type: 'wide', speed: 1, a: -0.6, b: 1.2 }, { type: 'low', speed: 0.4, a: 0.25, b: 1.05 }];
  if (kind === 'long') return [{ type: 'wide', speed: 1, a: -0.05, b: 0.55 }, { type: 'track', speed: 0.8, a: 0.4, b: 0.85 }, { type: 'front', speed: 0.5, a: 0.75, b: 1.1 }];
  return [{ type: 'wide', speed: 1, a: -0.35, b: 1.15 }, { type: 'low', speed: 0.35, a: 0.2, b: 0.95 }, { type: 'front', speed: 0.6, a: 0.0, b: 1.1 }];
}

// ------------------------------------------------------------------------------------------------
// Playback of an edit (list of shots) through the recorder.
// ------------------------------------------------------------------------------------------------
export class ReplayPlayer {
  constructor(s, moment) {
    this.s = s; const rec = this.rec = s.rec; const m = this.m = moment; const subj = m.subject || s.subject;
    const T0 = rec.t0, T1 = rec.end, dur = Math.max(0.6, m.t1 - m.t0);
    const edit = (m.shots && m.shots.length ? m.shots.map(x => typeof x === 'string' ? { type: x } : x) : defaultEdit(m.kind || (dur > 6 ? 'long' : 'jump')));
    const dflt = defaultEdit(m.kind || (dur > 6 ? 'long' : 'jump'));
    this.shots = []; let total = 0;
    const R = subj ? (rec.seek(lerp(m.t0, m.t1, 0.5)), sizeOf(subj)) : 2;
    edit.forEach((e, i) => {
      const d = dflt[Math.min(i, dflt.length - 1)], a = e.a ?? d.a, b = e.b ?? d.b, speed = e.speed ?? d.speed;
      let ta = clamp(m.t0 + a * dur, T0, T1), tb = clamp(m.t0 + b * dur, T0, T1); if (tb - ta < 0.4) return;
      if ((tb - ta) / speed > 6.5) { const mid = (ta + tb) / 2, h = 3.25 * speed; ta = Math.max(ta, mid - h); tb = Math.min(tb, mid + h); }
      const pts = subj ? samplePath(rec, subj, ta, tb, 24) : [{ t: ta, p: V3() }, { t: tb, p: V3(0, 0, -1) }];
      const shot = makeShot(s, e.type, pts, R, { ...e, subject: subj }); shot.ta = ta; shot.tb = tb; shot.speed = speed; shot.label = String.fromCharCode(65 + this.shots.length); this.shots.push(shot); total += (tb - ta) / speed;
    });
    this.total = total; this.i = 0; this.st = 0; this.simT = null; this.sfxI = 0; this.done = !this.shots.length;
    this.focus = V3(); s.focus = this.focus; this.subj = subj; this._lp = V3(); this.freeze = m.kind !== 'fail' && s.result?.ok ? (m.freeze || s.def.freeze) : null;
    s.engine.fx.uBlur.value = 0; s.engine.fx.uHurt.value = 0; s.engine.timeScale = 1;
    s.audio.stopLoops?.();
  }
  get shot() { return this.shots[this.i]; }
  // fast-forward particles to the start of a shot so smoke and fire already exist when it begins
  _primeFx(t) {
    const fx = this.s.fx, ev = this.rec.fx; fx.clear(); const t0 = t - 1.6; let j = 0; while (j < ev.length && ev[j].t < t0) j++;
    for (let tt = t0; tt < t; tt += 1 / 30) { while (j < ev.length && ev[j].t <= tt) fx.replay(ev[j++]); fx.update(1 / 30); }
    this.fxI = j; this.sfxI = this.rec.sfx.findIndex(e => e.t >= t); if (this.sfxI < 0) this.sfxI = this.rec.sfx.length;
  }
  update(dt) {
    if (this.done) return; const s = this.s, sh = this.shot;
    if (this.hold > 0) { this.hold -= dt; if (this.hold <= 0) { s.engine.setLook(s.lookName); this.onFreeze?.(null); } return; }
    if (this.simT == null) { this.simT = sh.ta; this._primeFx(sh.ta); this.onCut?.(sh, this.i); }
    const prev = this.simT; this.simT = Math.min(sh.tb, this.simT + dt * sh.speed); const sdt = this.simT - prev;
    this.rec.seek(this.simT);
    const ev = this.rec.fx; while (this.fxI < ev.length && ev[this.fxI].t <= this.simT) s.fx.replay(ev[this.fxI++]); s.fx.update(sdt);
    const sf = this.rec.sfx; while (this.sfxI < sf.length && sf[this.sfxI].t <= this.simT) { const e = sf[this.sfxI++]; try { if (e.k === 'set') { const [n, kd, p, v] = e.a; s.audio.set('rp_' + n, kd, p * (sh.speed < 0.7 ? 0.75 : 1), v * 0.8); } else s.audio[e.k]?.(...e.a); } catch { } }
    if (this.subj) { this.subj.updateWorldMatrix(true, false); this.subj.getWorldPosition(this.focus); }
    const c = sh.cam(this.simT), cam = s.camera; cam.up.set(0, 1, 0); cam.position.copy(c.pos); cam.lookAt(c.look); if (Math.abs(cam.fov - c.fov) > 0.01) { cam.fov = c.fov; cam.updateProjectionMatrix(); }
    s._updateEnv(0); s.engine.timeScale = sh.speed; s.audio.slowmo?.(sh.speed);
    const F = this.freeze; if (F && !this.froze && this.i === (F.shot ?? 1) && this.simT >= lerp(sh.ta, sh.tb, F.at ?? 0.45)) { this.froze = true; this.hold = F.dur ?? 2.6; s.engine.setLook(s.lookName, { mono: 1, sepia: 0.9, grain: 0.09, vignette: 0.6 }); s.engine.flash(0.35); s.audio.clap?.(); s.audio.say?.(F.line, { rate: 0.95, pitch: 0.75 }); this.onFreeze?.(F.line); }
    if (this.simT >= sh.tb - 1e-4) { this.i++; this.simT = null; if (this.i >= this.shots.length) { this.done = true; s.audio.slowmo?.(1); } }
  }
}

// ------------------------------------------------------------------------------------------------
// Live cinematic cut during play, from a predicted path (e.g. a car's ballistic arc off a ramp).
// The player keeps control; only the camera changes. Returns a function that restores the game cam.
// ------------------------------------------------------------------------------------------------
export function liveCut(s, subject, pts, type = 'wide', o = {}) {
  const R = o.R ?? sizeOf(subject), shot = makeShot(s, type, pts, R, { ...o, subject }), cam = s.cam, saved = { mode: cam.mode, target: cam.target, o: cam.o, fpos: cam.fpos };
  const tStart = s.t, wp = V3();
  cam.mode = 'cine'; cam.cineFn = () => { subject.updateWorldMatrix(true, false); subject.getWorldPosition(wp); const c = shot.cam(s.t); c.look = wp.clone().add(V3(0, R * 0.45, 0)); return c; };
  return () => { if (cam.mode !== 'cine') return; Object.assign(cam, saved); cam.first = true; };
}
