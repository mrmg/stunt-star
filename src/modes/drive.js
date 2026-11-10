import * as THREE from 'three';
import { model } from '../core/assets.js';
import { clamp, damp, lerp, V3, rnd } from '../world/stage.js';

const G = 9.81;
export const KINDS = {
  car: { top: 52, accel: 11, brake: 22, grip: 7, steer: 2.3, w: 1.8, h: 1.35, wb: 2.6, nose: -0.22, air: 0.22, crashV: 13, hard: 9, cg: 0.5 },
  muscle: { top: 58, accel: 12.5, brake: 20, grip: 5.2, steer: 2.1, w: 1.95, h: 1.35, wb: 2.9, nose: -0.25, air: 0.22, crashV: 13, hard: 9, cg: 0.5 },
  mini: { top: 42, accel: 10, brake: 22, grip: 8.5, steer: 2.9, w: 1.45, h: 1.35, wb: 2.0, nose: -0.2, air: 0.25, crashV: 12, hard: 8.5, cg: 0.45 },
  super: { top: 78, accel: 17, brake: 28, grip: 9, steer: 2.2, w: 2.0, h: 1.15, wb: 2.7, nose: -0.15, air: 0.2, crashV: 15, hard: 9, cg: 0.4 },
  bike: { top: 56, accel: 13, brake: 20, grip: 9, steer: 2.6, w: 0.8, h: 1.5, wb: 1.45, nose: -0.1, air: 1.5, crashV: 9, hard: 8, cg: 0.55, lean: 0.6 },
  bus: { top: 34, accel: 4.5, brake: 12, grip: 6, steer: 1.0, w: 2.6, h: 3.1, wb: 7, nose: -0.12, air: 0.15, crashV: 22, hard: 12, cg: 1.2 },
  truck: { top: 38, accel: 5, brake: 13, grip: 6, steer: 1.1, w: 2.6, h: 3.4, wb: 6, nose: -0.1, air: 0.1, crashV: 24, hard: 13, cg: 1.3 },
  tank: { top: 19, accel: 6, brake: 16, grip: 14, steer: 1.4, w: 3.4, h: 2.4, wb: 5, nose: -0.05, air: 0, crashV: 99, hard: 99, cg: 0.9 },
  boat: { top: 34, accel: 8, brake: 5, grip: 2.4, steer: 1.5, w: 1.9, h: 1.2, wb: 3.2, nose: -0.18, air: 0.2, crashV: 12, hard: 10, cg: 0.4 },
  ski: { top: 44, accel: 0, brake: 6, grip: 5, steer: 1.9, w: 0.7, h: 1.8, wb: 1.2, nose: 0, air: 0.8, crashV: 10, hard: 12, cg: 0.9 },
  sled: { top: 40, accel: 0, brake: 3, grip: 2.5, steer: 1.2, w: 1.6, h: 0.8, wb: 2.2, nose: 0, air: 0.2, crashV: 12, hard: 14, cg: 0.3 },
};

export class Drive {
  constructor(s, o = {}) {
    this.s = s; const K = this.k = { ...KINDS[o.kind || 'car'], ...o }; this.o = o; this.kind = o.kind || 'car';
    this.obj = new THREE.Group(); this.body = new THREE.Group(); this.obj.add(this.body); this.body.position.y = K.cg; this.obj.rotation.order = 'YXZ';
    if (o.model) { this.mesh = model(o.model, { len: o.len }); this.mesh.position.y = -K.cg + (o.ride ?? 0); this.body.add(this.mesh); const sz = this.mesh.userData.size; K.len = sz.z; K.w = o.w ?? sz.x * 0.92; K.h = o.h ?? sz.y; K.wb = o.wb ?? sz.z * 0.6; }
    else K.len = o.len ?? 1.2;
    if (o.driver) { this.driver = s.char(o.driver, { parent: this.body }); this.driver.root.position.set(...(o.driverPos || [0, 0.25 - K.cg, 0.1])); this.driver.setPose(o.driverPose || (this.kind === 'bike' ? 'bike' : 'sit'), 0); }
    s.scene.add(this.obj);
    this.pos = this.obj.position; this.pos.set(o.x || 0, 0, o.z || 0); this.pos.y = s.course.height(this.pos.x, this.pos.z); if (this.pos.y < -1e5) this.pos.y = o.y ?? 0; if (o.y != null) this.pos.y = o.y;
    this.heading = o.heading || 0; this.vel = V3(); this.v = o.speed0 || 0; this.lat = 0; this.vy = 0; this.grounded = true; this.pitch = 0; this.roll = 0; this.pitchRate = 0; this.rollRate = 0; this.yawRate = 0;
    this.vel.set(-Math.sin(this.heading) * this.v, 0, -Math.cos(this.heading) * this.v);
    this.airTime = 0; this.damage = 0; this.dead = false; this.frozen = false; this.control = true; this.throttleLock = null; this.steerScale = 1;
    this.stats = { maxSpeed: 0, air: 0, maxAir: 0, jumps: 0, hits: 0, smashed: 0, near: 0, drift: 0, scrapes: 0, dist: 0 };
    this.vis = { roll: 0, pitch: 0 }; this.camHead = this.heading; this._n = V3(); this._p = V3(); this.takeoff = null; this.gear = 0; this.offroad = false; this.movers = [];
    this.camO = { dist: Math.max(6.5, K.len * 1.55), height: Math.max(2.3, K.h * 1.45), ahead: 5, up: 1.0, stiff: 7, fov: 62, ...(o.cam || {}) };
    s.cam.follow(() => this._camT(), { ...this.camO, snap: true });
    s.onUpdate(dt => this.update(dt)); s.focus = this.pos;
  }
  _camT() { return { pos: this.pos, heading: this.camHead }; }
  get kmh() { return Math.abs(this.v) * 3.6; } get mph() { return Math.abs(this.v) * 2.237; }
  fwd(out = V3()) { return out.set(-Math.sin(this.heading), 0, -Math.cos(this.heading)); }
  update(dt) {
    const s = this.s, K = this.k, c = s.course, inp = s.input, p = this.pos;
    if (this.frozen) { this._visual(dt, 0, 0); return; }
    const live = s.started && !this.dead && this.control;
    let thr = live ? Math.max(0, inp.y) : 0, brk = live ? Math.max(0, -inp.y) : 0, steer = live ? inp.x * this.steerScale : 0, hb = live && inp.a && K.handbrake !== false;
    if (this.throttleLock != null && s.started && !this.dead) thr = this.throttleLock;
    if (this.ai) { const a = this.ai(dt); if (a) { thr = a.thr ?? thr; brk = a.brk ?? brk; steer = a.steer ?? steer; } }
    this.inThr = thr; this.inSteer = steer; this.inBrk = brk;
    const sn = Math.sin(this.heading), cs = Math.cos(this.heading);
    // forward / lateral decomposition of world velocity
    let vf = -this.vel.x * sn - this.vel.z * cs, vl = this.vel.x * cs - this.vel.z * sn;
    const gNow = c.height(p.x, p.z, p.y + 0.6);
    if (this.grounded) {
      // slope
      const hf = c.height(p.x - sn * K.wb / 2, p.z - cs * K.wb / 2, p.y + 1.2), hr = c.height(p.x + sn * K.wb / 2, p.z + cs * K.wb / 2, p.y + 1.2);
      const slope = hf < gNow - 0.8 ? (hr > -1e5 && hr < gNow + 0.2 ? Math.atan2(gNow - hr, K.wb / 2) : this.pitch) : (hf > -1e5 && hr > -1e5 && hr > gNow - 0.8) ? Math.atan2(hf - hr, K.wb) : this.pitch; this.slope = slope;
      const hl = c.height(p.x - cs * K.w / 2, p.z + sn * K.w / 2, p.y + 1.2), hrr = c.height(p.x + cs * K.w / 2, p.z - sn * K.w / 2, p.y + 1.2);
      const bank = (hl > -1e5 && hrr > -1e5) ? Math.atan2(hl - hrr, K.w) : 0;
      this.pitch = damp(this.pitch, slope, 14, dt); this.roll = damp(this.roll, -bank, 12, dt);
      const top = K.top * (this.boost || 1) * (1 - this.damage * 0.35) * (this.offroad ? (K.offroadTop ?? 0.75) : 1);
      let a = thr * K.accel * (this.boost || 1) * clamp(1 - vf / top, -0.2, 1) - G * Math.sin(slope) * (K.slopeK ?? 1);
      a -= ((K.rollDrag ?? 0.35) * clamp(vf * 2, -1, 1)) + (K.airDrag ?? 0.0006) * vf * vf * Math.sign(vf);
      if (brk) a -= (vf > 0.5 ? K.brake : (K.reverse === false ? 0 : K.accel * 0.5));
      if (hb) a -= Math.sign(vf) * K.brake * 0.35;
      vf += a * dt; if (K.reverse === false && vf < 0) vf = 0; if (vf < -10) vf = -10;
      const grip = K.grip * (hb ? 0.18 : 1) * (this.gripK ?? 1); vl *= Math.exp(-grip * dt);
      const sf = clamp(vf / 7, -1, 1) / (1 + Math.abs(vf) / (K.steerRef ?? 42));
      const yaw = -steer * K.steer * sf * (hb ? 1.5 : 1); this.heading += yaw * dt; this.yawRate = yaw;
      if (Math.abs(vl) > 3.2 && Math.abs(vf) > 6) { this.stats.drift += dt; this.skid = 1; } else this.skid = hb && Math.abs(vf) > 6 ? 0.8 : 0;
    } else {
      this.airTime += dt; vf -= (K.airDrag ?? 0.0006) * vf * vf * dt * 0.5;
      this.heading += this.yawRate * dt * 0.6; this.yawRate *= Math.exp(-1.5 * dt);
      this.pitchRate += ((live ? (inp.y > 0 ? inp.y : inp.y * 0.5) : 0) * K.air * 1.6 + K.nose * (this.airTime > 0.25 ? 1 : 0)) * dt * (this.airCtl ?? 1);
      this.pitch += this.pitchRate * dt; this.roll += this.rollRate * dt; this.skid = 0;
      if (K.lean && live) this.rollRate = damp(this.rollRate, -inp.x * 0.5, 3, dt);
    }
    const sn2 = Math.sin(this.heading), cs2 = Math.cos(this.heading);
    this.vel.x = -sn2 * vf + cs2 * vl; this.vel.z = -cs2 * vf - sn2 * vl; this.v = vf; this.lat = vl;
    // integrate + vertical
    const px = p.x, pz = p.z; p.x += this.vel.x * dt; p.z += this.vel.z * dt; this.stats.dist += Math.hypot(this.vel.x, this.vel.z) * dt;
    const g = c.height(p.x, p.z, p.y + 0.9);
    const yb = p.y + this.vy * dt - 0.5 * G * dt * dt * (this.gravK ?? 1);
    if (this.grounded) {
      if (g >= yb - 0.04 && g > -1e5) { const vyG = clamp((g - p.y) / dt, -30, Math.abs(vf) * 0.9 + 2); this.vy = lerp(this.vy, vyG, 0.6); p.y = g; }
      else { this.grounded = false; this.airTime = 0; p.y = yb; this.vy -= G * dt; this.pitchRate = K.nose * 0.3; this.rollRate = this.twist ?? 0; this.takeoff = { x: px, z: pz, y: p.y, v: vf }; this.stats.jumps++; this.onAir?.(this.takeoff); }
    } else {
      this.vy -= G * dt * (this.gravK ?? 1);
      if (g > -1e5 && yb <= g) { p.y = g; this._land(g, px, pz); } else p.y = yb;
    }
    if (p.y < c.kill && !this.dead) { this.dead = true; this.onFall?.() ?? s.fail('Fell out of the shot', { injury: 0.8 }); }
    this.stats.maxSpeed = Math.max(this.stats.maxSpeed, Math.abs(vf));
    if (!this.dead || this.wreck) this._collide(dt);
    this._visual(dt, steer, thr - brk);
  }
  _land(g, px, pz) {
    const s = this.s, K = this.k, c = s.course, p = this.pos; const sn = Math.sin(this.heading), cs = Math.cos(this.heading);
    const hf = c.height(p.x - sn * K.wb / 2, p.z - cs * K.wb / 2, p.y + 1.2), hr = c.height(p.x + sn * K.wb / 2, p.z + cs * K.wb / 2, p.y + 1.2);
    const slope = (hf > -1e5 && hr > -1e5) ? Math.atan2(hf - hr, K.wb) : 0;
    const vSlope = -this.v * Math.sin(-slope); const impact = Math.max(0, -(this.vy - this.v * Math.tan(slope)) * Math.cos(slope));
    const rollN = ((this.roll + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI, pitchErr = this.pitch - slope;
    const pn = ((pitchErr + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
    const info = { impact, airTime: this.airTime, pitchErr: pn, roll: rollN, rolls: this.roll / (2 * Math.PI), flips: this.pitch / (2 * Math.PI), dist: this.takeoff ? Math.hypot(p.x - this.takeoff.x, p.z - this.takeoff.z) : 0, drop: this.takeoff ? this.takeoff.y - p.y : 0, x: p.x, z: p.z, clean: 1 };
    this.lastLand = { ...info, pitch: +this.pitch.toFixed(2), slope: +slope.toFixed(2), vy: +this.vy.toFixed(1), v: +this.v.toFixed(1) }; (this.lands ||= []).push([+this.pos.z.toFixed(0), +this.airTime.toFixed(2), +pn.toFixed(2), +rollN.toFixed(2), +impact.toFixed(1), +this.pitch.toFixed(2), +slope.toFixed(2), this.dead ? 1 : 0]); this.s.dbg = () => this.lands;
    this.grounded = true; this.stats.air += this.airTime; this.stats.maxAir = Math.max(this.stats.maxAir, this.airTime);
    { const pt = K.pitchTol ?? 0.55, rt = K.rollTol ?? 0.6; info.clean = clamp(1 - (Math.abs(pn) - 0.1) / (pt - 0.1)) * clamp(1 - (Math.abs(rollN) - 0.08) / (rt - 0.08)) * clamp(1.4 - impact / (K.hard * 2.6)); }
    const bad = Math.abs(pn) > (K.pitchTol ?? 0.55) || Math.abs(rollN) > (K.rollTol ?? 0.6) || impact > K.hard * 2.3;
    this.vy = this.dead ? 0 : this.v * Math.tan(slope); this.pitchRate = 0; this.rollRate = 0;
    if (this.dead) { this.roll = rollN * 0.5; return; }
    if (this.airTime > 0.25) {
      s.engine.addShake(clamp(impact / 9, 0.15, 1.6)); s.audio.impact(clamp(impact / 10, 0.3, 1.3)); s.fx.dust(p, 10, { spread: 2, color: this.dustColor });
      if (impact > K.hard) { this.damage = clamp(this.damage + (impact - K.hard) / 22); s.fx.sparks(p, 16); }
    }
    this.roll = rollN; this.pitch = slope + pn * 0.3;
    const handled = this.onLand?.(info);
    if (bad && handled !== true && !this.dead) this.crash(Math.abs(rollN) > 0.6 ? 'Rolled it on landing' : 'Nose-dived the landing', { injury: clamp(0.35 + impact / 40, 0.3, 0.9) });
    this.v *= bad ? 0.5 : (1 - clamp(impact / 60, 0, 0.25)); const sn2 = Math.sin(this.heading), cs2 = Math.cos(this.heading); this.vel.x = -sn2 * this.v; this.vel.z = -cs2 * this.v;
  }
  _collide(dt) {
    const s = this.s, K = this.k, p = this.pos, ah = Math.abs(Math.sin(this.heading));
    const hw = lerp(K.w / 2, K.len / 2, ah) * 0.92, hd = lerp(K.len / 2, K.w / 2, ah) * 0.92, hh = K.h / 2;
    s.course.hit(p.x, p.y + hh + 0.25, p.z, hw, hh, hd, sol => {
      if (sol.type === 'trigger') { if (!sol.fired || sol.repeat) { sol.fired = true; sol.on?.(this, sol); } return; }
      if (sol.type === 'break' || (sol.type === 'weak' && Math.abs(this.v) > (sol.minV ?? 0))) {
        sol.dead = true; if (sol.obj) sol.obj.visible = false; this.stats.smashed++;
        const cpos = this._p.set((sol.x0 + sol.x1) / 2, (sol.y0 + sol.y1) / 2, (sol.z0 + sol.z1) / 2);
        if (sol.glass) { s.fx.glass(cpos, 60, { dir: this.fwd(), speed: Math.abs(this.v) * 0.5 }); s.audio.glass(); }
        else { s.fx.debris(cpos, sol.soft ? 4 : 14, { color: sol.debris ?? 0x8a6a40, dir: this.fwd(), speed: Math.abs(this.v) * 0.45, size: sol.soft ? 0.2 : 0.45, floor: sol.y0 }); if (!sol.soft) { s.audio.impact(0.7); s.engine.addShake(0.35); } else s.audio.thud(); }
        if (!this.dead) { this.v *= sol.soft ? 0.985 : (sol.slow ?? 0.9); this.vel.multiplyScalar(sol.soft ? 0.985 : (sol.slow ?? 0.9)); }
        sol.on?.(this, sol); this.onSmash?.(sol); return;
      }
      // solid: resolve along least penetration
      const ox = Math.min(p.x + hw - sol.x0, sol.x1 - (p.x - hw)), oz = Math.min(p.z + hd - sol.z0, sol.z1 - (p.z - hd));
      let nx = 0, nz = 0; if (ox < oz) nx = p.x < (sol.x0 + sol.x1) / 2 ? -1 : 1; else nz = p.z < (sol.z0 + sol.z1) / 2 ? -1 : 1;
      const rvx = this.vel.x - (sol.vx || 0), rvz = this.vel.z - (sol.vz || 0); const vn = rvx * nx + rvz * nz;
      p.x += nx * (ox + 0.02) * (nx ? 1 : 0); p.z += nz * (oz + 0.02) * (nz ? 1 : 0);
      if (vn >= 0) return;
      const imp = -vn; this.stats.hits++;
      const cp = this._p.set(p.x - nx * hw, p.y + 0.6, p.z - nz * hd);
      if (this.dead) { this.vel.x -= nx * vn * 1.3; this.vel.z -= nz * vn * 1.3; return; }
      if (imp > K.crashV * (sol.hardK ?? 1)) { s.fx.sparks(cp, 30); sol.on?.(this, sol, imp); if (this.onHit?.(sol, imp) !== true) this.crash(sol.msg || 'Wrecked the car', { injury: clamp(0.3 + imp / 45, 0.3, 1) }); this.vel.x -= nx * vn * 1.4; this.vel.z -= nz * vn * 1.4; return; }
      // scrape / bump
      this.vel.x -= nx * vn * 1.25; this.vel.z -= nz * vn * 1.25; this.vel.multiplyScalar(1 - clamp(imp / 40, 0.02, 0.3));
      this.damage = clamp(this.damage + imp / 55); this.stats.scrapes++; s.fx.sparks(cp, Math.round(4 + imp), { dir: this.fwd() }); if (imp > 2.5) { s.audio.impact(clamp(imp / 12, 0.2, 0.9)); s.engine.addShake(clamp(imp / 14, 0.1, 0.8)); }
      sol.on?.(this, sol, imp); this.onHit?.(sol, imp);
      // nudge heading away from wall
      const fx = -Math.sin(this.heading), fz = -Math.cos(this.heading); const side = fx * nz - fz * nx; this.heading += clamp(side, -1, 1) * 0.04 * (nx ? -1 : 1) * 0;
    });
  }
  crash(reason = 'Wrecked', { injury = 0.6, fire = false, silent = false } = {}) {
    if (this.dead) return; this.dead = true; this.wreck = true; const s = this.s;
    s.audio.crash(); s.engine.addShake(1.4); s.fx.sparks(this.pos, 40); s.fx.smokePuff(this.pos, 10);
    if (!this.grounded || Math.abs(this.v) > 12) { this.grounded = false; this.vy = Math.max(this.vy, 3 + Math.abs(this.v) * 0.12); this.rollRate = rnd(-1, 1) > 0 ? 5 : -5; this.pitchRate = rnd(-2, 2); this.yawRate = rnd(-2, 2); }
    if (fire) { s.fx.explosion(this.pos, 1.2); s.audio.explosion(); }
    this.burning = fire || this.damage > 0.6;
    if (!silent) s.fail(reason, { injury });
  }
  _visual(dt, steer, drive) {
    const s = this.s, K = this.k, p = this.pos, o = this.obj;
    const lean = K.lean ? clamp(-this.yawRate * Math.abs(this.v) / 22, -0.75, 0.75) * K.lean / 0.6 : clamp(this.yawRate * Math.abs(this.v) / 260, -0.07, 0.07);
    this.vis.roll = damp(this.vis.roll, this.grounded ? lean : 0, 8, dt); this.vis.pitch = damp(this.vis.pitch, this.grounded ? clamp(drive, -1, 1) * (K.squat ?? 0.025) : 0, 6, dt);
    o.rotation.set((this.pitchOverride ?? this.pitch) + this.vis.pitch, this.heading + (this.grounded ? clamp(this.lat / Math.max(8, Math.abs(this.v)), -0.5, 0.5) * (K.slipVis ?? 0.6) : 0), (this.rollOverride ?? this.roll) + this.vis.roll);
    this.camHead = damp(this.camHead, this.heading, this.dead ? 1 : (this.camK ?? 5), dt); s.cam.fovKick = clamp(Math.abs(this.v) / K.top, 0, 1.3) * (this.fovK ?? 13);
    s.engine.fx.uBlur.value = damp(s.engine.fx.uBlur.value, clamp((Math.abs(this.v) - 22) / 55, 0, 0.75) * (this.blurK ?? 1), 4, dt);
    // fx + audio
    const sp = Math.abs(this.v);
    if (this.grounded && (this.skid || this.offroad || K.dusty) && sp > 5 && Math.random() < 0.5) s.fx.dust(this._p.set(p.x + Math.sin(this.heading) * K.len * 0.4, p.y + 0.1, p.z + Math.cos(this.heading) * K.len * 0.4), 1, { color: this.skid && !this.offroad && !K.dusty ? [0.85, 0.85, 0.85] : this.dustColor, size: 1.3, a: 0.28 });
    if (this.kind === 'boat' && this.grounded && sp > 4) s.fx.spray(this._p.set(p.x + Math.sin(this.heading) * K.len * 0.45 + rnd(-.6, .6), p.y + 0.1, p.z + Math.cos(this.heading) * K.len * 0.45), V3(-this.vel.x * 0.1, 2, -this.vel.z * 0.1), 2, [0.9, 0.95, 1], 1.4);
    if ((this.burning || this.damage > 0.55) && Math.random() < 0.6) { this._p.set(p.x - Math.sin(this.heading) * K.len * 0.35, p.y + K.h * 0.6, p.z - Math.cos(this.heading) * K.len * 0.35); this.burning ? s.fx.flame(this._p, 1.2) : s.fx.smokePuff(this._p, 1, { size: 1.2, a: 0.35 }); }
    if (this.silent) return;
    const span = K.top / (K.gears ?? 4), gear = Math.min((K.gears ?? 4) - 1, Math.floor(sp / span)), rpm = clamp(0.25 + (sp - gear * span) / span * 0.7 + (this.inThr || 0) * 0.08 + (!this.grounded ? 0.2 : 0), 0.15, 1.15);
    if (this.kind === 'ski' || this.kind === 'sled') s.audio.set('veh', 'wind', sp / K.top, this.dead ? 0 : 0.15 + sp / K.top * 0.35);
    else s.audio.set('veh', 'engine', rpm * (K.pitchK ?? 1) * (0.75 + gear * 0.07), this.dead ? 0 : 0.5 + (this.inThr || 0) * 0.5);
    s.audio.set('skid', 'skid', 0.2, this.skid && this.grounded && this.kind !== 'boat' && this.kind !== 'ski' ? 0.22 : 0);
    s.audio.set('windv', 'wind', sp / 60, clamp(sp / 70, 0, 0.5));
  }
}

// Simple scripted vehicles: traffic, rivals, trains. Each registers a moving solid the player can hit.
export class Movers {
  constructor(s, player) { this.s = s; this.player = player; this.list = []; s.onUpdate(dt => this.update(dt)); }
  // o: {model,len, x|path(z), z, v (m/s, + = travelling toward -Z), y, solid, type}
  add(o) {
    const m = o.obj || model(o.model, { len: o.len }); const sz = m.userData.size || V3(2, 1.5, 4.5); this.s.scene.add(m);
    const e = { m, z: o.z, v: o.v ?? 0, path: o.path || (() => o.x || 0), y: o.y, hw: (o.hw ?? sz.x / 2) * 0.9, hd: (o.hd ?? sz.z / 2) * 0.92, h: o.h ?? sz.y, o, near: false, alive: true, x: 0, yaw: 0, t: 0 };
    e.x = e.path(e.z); if (o.solid !== false) e.sol = this.s.course.addSolid({ x0: 0, x1: 0, y0: 0, y1: 0, z0: 0, z1: 0, type: o.type || 'solid', obj: null, mover: e, msg: o.msg, hardK: o.hardK, on: o.on });
    this.list.push(e); this._place(e, 0); return e;
  }
  _place(e, dt) {
    const s = this.s; const x = e.path(e.z, e), dx = x - e.x; e.x = x; const y = e.y ?? s.course.height(x, e.z, 1e9);
    if (e.free) { e.m.position.y += e.vy * dt; e.vy -= 9.8 * dt; e.m.rotation.x += e.spin * dt; e.m.rotation.z += e.spin * 0.6 * dt; e.m.position.z -= e.v * dt; if (e.m.position.y < (e.floor ?? 0)) { e.m.position.y = e.floor ?? 0; e.vy *= -0.3; e.spin *= 0.5; e.v *= 0.7; } }
    else { e.m.position.set(x, y > -1e5 ? y : 0, e.z); const dir = e.v >= 0 ? 0 : Math.PI; if (dt > 0 && Math.abs(e.v) > 1) e.yaw = damp(e.yaw, Math.atan2(-dx, Math.abs(e.v) * dt), 6, dt); e.m.rotation.y = dir + (e.v >= 0 ? e.yaw : -e.yaw) + (e.o.ry || 0); }
    if (e.sol) { const p = e.m.position; Object.assign(e.sol, { x0: p.x - e.hw, x1: p.x + e.hw, y0: p.y, y1: p.y + e.h, z0: p.z - e.hd, z1: p.z + e.hd, vx: dt > 0 ? dx / dt : 0, vz: -e.v, dead: !e.alive }); }
  }
  // knock a mover flying (after being hit / blown up)
  fling(e, vy = 6) { e.free = true; e.vy = vy; e.spin = rnd(-4, 4); e.alive = false; if (e.sol) e.sol.dead = true; }
  update(dt) {
    const pl = this.player;
    for (const e of this.list) {
      e.t += dt; if (e.o.ai) e.o.ai(e, dt, pl); if (!e.free) e.z -= e.v * dt; this._place(e, dt);
      if (pl && e.alive && !pl.dead && e.o.nearMiss !== false) {
        const dz = Math.abs(e.m.position.z - pl.pos.z), dx = Math.abs(e.m.position.x - pl.pos.x) - e.hw - pl.k.w / 2;
        if (dz < e.hd + 1 && dx < 1.3 && dx > 0 && Math.abs(pl.v - e.v) > 9 && pl.grounded) { if (!e.near) { e.near = true; pl.stats.near++; this.s.bonus('Near misses', this.nearPay ?? 150); this.s.msg('NEAR MISS', 'small'); this.s.audio.whoosh(); } } else if (dz > e.hd + 6) e.near = false;
      }
      if (e.o.recycle && pl && e.alive && e.z - pl.pos.z > e.o.recycle[0]) { e.z = pl.pos.z - rnd(e.o.recycle[1], e.o.recycle[2]); e.near = false; if (e.o.zEnd != null && e.z < e.o.zEnd) { e.alive = false; e.m.visible = false; } }
    }
  }
}

// Formation followers that replay the lead vehicle's exact path with a time delay (convoys, pursuers).
export class Convoy {
  constructor(s, lead, list, { delay = 0.6, gap = 5 } = {}) {
    this.s = s; this.lead = lead; this.delay = delay; this.hist = []; this.t = 0; this.cars = [];
    const back = V3(Math.sin(lead.heading), 0, Math.cos(lead.heading)), n = list.length, D = delay * n, vf = gap / delay;
    for (let k = 0; k <= 40; k++) { const t = -D + D * k / 40; this.hist.push({ t, p: lead.pos.clone().addScaledVector(back, -t * vf), q: lead.obj.quaternion.clone() }); }
    list.forEach((o, i) => { const g = new THREE.Group(); const m = model(o.model, { len: o.len }); m.position.y = (o.ride ?? 0); g.add(m); s.scene.add(g); this.cars.push({ g, d: delay * (i + 1), i: 0, ...o }); });
    s.onUpdate(dt => this.update(dt)); this.update(0);
  }
  update(dt) {
    const L = this.lead, H = this.hist; if (this.s.started && !this.stop) { this.t += dt; H.push({ t: this.t, p: L.pos.clone(), q: L.obj.quaternion.clone() }); if (H.length > 900) H.splice(0, 300); }
    for (const c of this.cars) {
      if (c.free) { c.g.position.addScaledVector(c.vel, dt); c.vel.y -= 9.8 * dt; c.g.rotation.x += dt * 2; continue; }
      const tt = this.t - c.d; let i = Math.min(c.i, H.length - 2); if (H[i].t > tt) i = 0; while (i < H.length - 2 && H[i + 1].t < tt) i++; c.i = i;
      const a = H[i], b = H[i + 1], f = clamp((tt - a.t) / Math.max(1e-4, b.t - a.t)); c.g.position.lerpVectors(a.p, b.p, f); c.g.quaternion.slerpQuaternions(a.q, b.q, f);
      if (c.dx) c.g.position.x += c.dx;
    }
  }
}
