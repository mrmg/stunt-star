import * as THREE from 'three';
import { clamp, damp, V3, rnd } from '../world/stage.js';

// Hang on / climb. The performer clings to an anchor (wall, aircraft, truck, rope).
// Move with WASD (optional), hold SPACE to BRACE against telegraphed hits. Bracing and moving burn stamina; losing all grip = fall.
// Movement is either free inside `range:{u:[a,b],v:[a,b]}` or along `rail:[[u,v,w?],...]` (polyline; input is projected on the current segment,
// w = offset out of the plane). Planes: 'xy' (u=+X, v=+Y), 'xz' (u=+X, v=-Z), 'zy' (u=-Z i.e. forward, v=+Y).
// flipU:true mirrors A/D (for cameras that look back at the performer).
// The mode does NOT set the camera: use s.cam.follow(g.camTarget(heading), {...}).
export class Grip {
  constructor(s, o = {}) {
    this.s = s; this.o = o = { speed: 1.6, stamina: 1, drainMove: 0.055, drainBrace: 0.16, drainIdle: 0.0, regen: 0.11, warn: 0.75, range: null, pose: 'cling', movePose: 'climb', bracePose: 'brace', slipPose: 'hang1', plane: 'xy', hud: true, ...o };
    this.anchor = o.anchor || s.scene; this.c = s.char(o.char || 'ch_stunt', { parent: this.anchor }); this.c.heading = o.heading ?? 0; this.c.setPose(o.pose, 0);
    this.u = o.u ?? 0; this.v = o.v ?? 0; this.w = 0; this.off = V3(...(o.offset || [0, 0, 0])); this.grip = 1; this.stam = o.stamina; this.braced = false; this.events = []; this.hazards = []; this.dead = false; this.done = false; this.control = true; this.moving = false; this.t = 0;
    this.kick = V3(); this.tired = false; this.seg = 0;
    this.stats = { hits: 0, braced: 0, perfect: 0, events: 0, wasted: 0 }; this._w = V3(); this.world = V3();
    if (o.rail) this.setRail(o.rail, o.p ?? 0);
    this._place(); s.onUpdate(dt => this.update(dt)); s.focus = this.world;
  }
  // ------------------------------------------------------------ rail
  setRail(pts, p = 0) { const R = this.rail = pts.map(a => [a[0], a[1], a[2] || 0]); const L = this.railL = [0]; for (let i = 1; i < R.length; i++) L.push(L[i - 1] + Math.hypot(R[i][0] - R[i - 1][0], R[i][1] - R[i - 1][1], R[i][2] - R[i - 1][2])); this.railLen = L[L.length - 1]; this.pMin = 0; this.pMax = this.railLen; this.p = p; this._rail(); }
  railSeg(p) { const L = this.railL; let i = 0; while (i < L.length - 2 && p >= L[i + 1]) i++; return i; }
  // distance along the rail of waypoint i
  railP(i) { return this.railL[i]; }
  _rail() { const R = this.rail, L = this.railL, i = this.seg = this.railSeg(this.p), k = clamp((this.p - L[i]) / Math.max(1e-6, L[i + 1] - L[i])), a = R[i], b = R[i + 1]; this.u = a[0] + (b[0] - a[0]) * k; this.v = a[1] + (b[1] - a[1]) * k; this.w = a[2] + (b[2] - a[2]) * k; }
  _railIn(p, mx, my) { const R = this.rail, i = this.railSeg(clamp(p, 0, this.railLen - 1e-4)), du = R[i + 1][0] - R[i][0], dv = R[i + 1][1] - R[i][1], m = Math.max(Math.abs(du), Math.abs(dv), 1e-6); return clamp((mx * du + my * dv) / m, -1, 1); }
  local(u, v, w, out) { const f = this.off; if (this.o.plane === 'xy') out.set(f.x + u, f.y + v, f.z + w); else if (this.o.plane === 'xz') out.set(f.x + u, f.y + w, f.z - v); else out.set(f.x + w, f.y + v, f.z - u); return out; }
  _place() { const p = this.c.root.position; this.local(this.u, this.v, this.w, p).add(this.kick); this.c.root.getWorldPosition(this.world); }
  camTarget(heading = 0) { const t = { pos: this.world, heading }; return () => t; }
  // seconds until the next hit that has to be braced (Infinity if none) - handy for bots
  incoming() { let m = Infinity; for (const e of this.events) if (!e.fired) m = Math.min(m, e.t - this.t); return m; }
  // schedule a hit that must be braced. Returns event.
  gust(inSec, o = {}) { const e = { t: this.t + inSec, dur: o.dur ?? 0.5, power: o.power ?? 0.34, label: o.label || 'BRACE!', fired: false, done: false, on: o.on, onHit: o.onHit, onHeld: o.onHeld, shake: o.shake ?? 0.8, sfx: o.sfx || 'whoosh', failLabel: o.failLabel, kick: o.kick }; this.events.push(e); return e; }
  // moving hazard in (u,v) space. obj (optional, parented to the anchor) is moved with it.
  hazard(o) { const h = { u: o.u, v: o.v, vu: o.vu || 0, vv: o.vv || 0, r: o.r ?? 0.6, power: o.power ?? 0.3, obj: o.obj, life: o.life ?? 30, on: o.on, msg: o.msg, upd: o.upd, w: o.w ?? 0, spin: o.spin || 0 }; this.hazards.push(h); if (h.obj) this.local(h.u, h.v, h.w, h.obj.position); return h; }
  lose(power, why) { if (this.dead || this.done) return; this.grip = clamp(this.grip - power); this.stats.hits++; this.s.engine.addShake(0.9); this.s.engine.hurt(0.35); this.s.audio.impact(0.6); this.s.msg(why || 'SLIPPING!', 'bad'); if (this.o.slipPose) this.c.setPose(this.o.slipPose, 0.1); this._slipT = 0.5; this.onSlip?.(power); if (this.grip <= 0) this.fall(); }
  fall() { if (this.dead) return; this.dead = true; this.s.hud.prompt(''); this.s.audio.whoosh(1.2); if (this.onFall?.() === true) return; this.detach(this.carry); this.s.fail(this.o.fallMsg || 'Lost your grip', { injury: this.o.injury ?? 0.8 }); }
  // release the performer into the world as a tumbling body (vel = world velocity to inherit)
  detach(vel) { const r = this.c.root; r.getWorldPosition(this._w); this.s.scene.attach(r); this.free = { v: vel ? vel.clone() : V3() }; this.c.setCycle('flail', 1); this.c.tumble(4, 1, 2); }
  update(dt) {
    const s = this.s, o = this.o, inp = s.input, ch = this.c;
    if (this.free) { const f = this.free; f.v.y -= 9.81 * dt; ch.root.position.addScaledVector(f.v, dt); ch.root.getWorldPosition(this.world); const g = s.course.height(this.world.x, this.world.z, this.world.y + 0.5); if (g > -1e5 && this.world.y <= g) { ch.root.position.y += g - this.world.y; f.v.y = 0; const k = Math.exp(-3 * dt); f.v.x *= k; f.v.z *= k; if (!f.hit) { f.hit = true; ch.tumble(0, 0, 0); ch.spinAng.set(0, 0, 0); ch.root.rotation.set(0, ch.heading, 0); ch.setPose('lie', 0.1); s.audio.impact(1); s.engine.addShake(1); s.fx.dust(this.world, 10); } else if (f.v.lengthSq() > 4 && Math.random() < 0.5) s.fx.dust(this.world, 1); } return; }
    if (this.done || this.dead) { this._place(); return; }
    if (!s.started) { this._place(); return; }
    this.t += dt; this.kick.multiplyScalar(Math.exp(-6 * dt));
    const live = this.control;
    if (this.stam <= 0.02) this.tired = true; else if (this.stam > 0.15) this.tired = false;
    this.braced = live && inp.a && !this.tired;
    let mx = 0, my = 0; if (live && !this.braced) { mx = o.flipU ? -inp.x : inp.x; my = inp.y; }
    const sp = o.speed * (0.45 + 0.55 * clamp(this.stam * 2)) * (this.speedK ?? 1);
    this.moving = false;
    if (this.rail) {
      if (mx || my) { const f = this._railIn(this.p + 0.02, mx, my), b = this._railIn(this.p - 0.02, mx, my), m = f > 0.05 ? f : b < -0.05 ? b : 0, p0 = this.p; this.p = clamp(this.p + m * sp * dt, Math.min(this.pMin, this.p), Math.max(this.pMax, this.p)); this.moving = Math.abs(this.p - p0) > 1e-5; }
      this._rail();
    } else if (o.range && (mx || my)) { const R = o.range, u0 = this.u, v0 = this.v; this.u = clamp(this.u + mx * sp * dt, R.u[0], R.u[1]); this.v = clamp(this.v + my * sp * (o.vK ?? 1) * dt, R.v[0], R.v[1]); this.moving = this.u !== u0 || this.v !== v0; }
    // stamina
    const drain = this.braced ? o.drainBrace : this.moving ? o.drainMove : -o.regen + o.drainIdle;
    this.stam = clamp(this.stam - drain * dt * (drain > 0 ? (this.drainK ?? 1) : 1), 0, o.stamina);
    if (this.stam <= 0.001 && !this.braced) { this.grip = clamp(this.grip - (o.tiredDrain ?? 0.12) * dt); if (this.grip <= 0) return this.fall(); }
    if (this.grip < 1 && !this.braced && !this.moving && this.stam > 0.3) this.grip = clamp(this.grip + (o.gripRegen ?? 0.035) * dt);
    // scheduled hits
    let warn = null;
    for (const e of this.events) {
      if (e.done) continue; const tt = e.t - this.t;
      if (tt < o.warn && tt > 0 && (!warn || e.t < warn.t)) warn = e;
      if (tt <= 0 && !e.fired) {
        e.fired = true; this.stats.events++; s.audio[e.sfx]?.(1.3); s.engine.addShake(e.shake); if (e.kick) this.kick.set(e.kick[0] || 0, e.kick[1] || 0, e.kick[2] || 0); e.on?.(e); e.ok = this.braced;
        if (this.braced) { this.stats.braced++; s.msg('HELD ON', 'small'); e.onHeld?.(e); } else { e.onHit?.(e); this.lose(e.power, e.failLabel); if (this.dead) return; }
      }
      if (tt < -e.dur) e.done = true;
    }
    if (this.events.length > 24) this.events = this.events.filter(e => !e.done);
    if (warn && this._warned !== warn) { s.audio.tick(); this._warned = warn; } if (!warn) this._warned = null;
    this.warning = warn;
    s.hud.prompt(warn ? `<span style="color:#ffcf40">${warn.label}</span> &nbsp;hold <kbd>SPACE</kbd>` : this.tired ? '<span style="color:#ff6a5a">EXHAUSTED</span> — let go of SPACE and rest' : (this.promptText || ''));
    if (this.braced && !warn && !this.events.some(e => e.fired && !e.done)) this.stats.wasted += dt;
    // hazards
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i]; h.u += h.vu * dt; h.v += h.vv * dt; h.life -= dt; h.upd?.(h, dt);
      if (h.obj) { this.local(h.u, h.v, h.w, h.obj.position); if (h.spin) h.obj.rotation.z += h.spin * dt; }
      if (!h.hit && Math.hypot(h.u - this.u, h.v - (this.v + (o.hazY ?? 0.9))) < h.r) { h.hit = true; h.on?.(h); if (h.power) this.lose(h.power, h.msg); if (this.dead) return; }
      if (h.life <= 0) { h.obj && (h.obj.visible = false); this.hazards.splice(i, 1); }
    }
    // pose
    if (this._slipT > 0) this._slipT -= dt; else if (this.braced) ch.setPose(o.bracePose, 0.12); else if (this.moving && o.movePose) ch.setCycle(o.movePose, o.moveRate ?? 7); else if (o.idleCycle) ch.setCycle(o.idleCycle, 1); else ch.setPose(o.pose, 0.2);
    this._place();
    if (o.hud) { s.hud.meter('grip', 'Grip', this.grip, { color: this.grip < 0.35 ? '#e23b2e' : '#f2c14e' }); s.hud.meter('stam', 'Stamina', this.stam / o.stamina, { color: this.tired ? '#e23b2e' : '#58d68d' }); }
  }
}
