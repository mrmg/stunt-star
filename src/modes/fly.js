import * as THREE from 'three';
import { clamp, damp, V3, rnd } from '../world/stage.js';
import { model } from '../core/assets.js';

// Arcade flight toward -Z. A/D bank, W climb, S dive, SHIFT afterburner, SPACE = special (canInvert: toggle inverted; knife: hold for a 90° knife-edge).
// Extra options: yaw (model yaw fix), len, knife, agility/climb (max lateral/vertical m/s), resp (control response), invertPitch, floorMsg/ceilMsg/wallMsg, idleSpeed, engines/engGap, exhaust:false.
// Hit box: half-width .hw / half-height .hh swap as the aircraft rolls (knife-edge = narrow and tall). Nothing moves until s.started.
// per-model yaw fixes for aircraft whose generated mesh does not face -Z (checked in screenshots)
const FLY_YAW = { fa18: -Math.PI / 2 };
export class Fly {
  constructor(s, o = {}) {
    this.s = s; this.o = o = { speed: 90, boost: 1.35, agility: 34, climb: 26, kind: 'jet', r: 2.5, canInvert: false, minY: -1e9, ...o };
    this.obj = new THREE.Group(); this.obj.rotation.order = 'YXZ'; this.mesh = model(o.model, { len: o.len, yaw: o.yaw ?? FLY_YAW[o.model] ?? 0 }); const sz = this.mesh.userData.size; this.mesh.position.y = -sz.y / 2; this.obj.add(this.mesh); s.scene.add(this.obj); this.size = sz;
    this.pos = this.obj.position; this.pos.set(o.x || 0, o.y ?? 100, o.z || 0); this.vx = 0; this.vy = 0; this.v = o.speed; this.roll = 0; this.pitch = 0; this.inv = 0; this.inverted = false; this.dead = false; this.control = true; this.frozen = false;
    this.knifeK = 0; this.hw = o.r; this.hh = o.r * 0.45; this.clear = { floor: 1e9, ceil: 1e9, left: 1e9, right: 1e9 }; this.stats = { lowT: 0, t: 0, minClear: 1e9 }; this._p = V3(); this._v = V3();
    if (o.kind === 'heli') { // rotor disc
      const r = this.rotor = new THREE.Mesh(new THREE.CylinderGeometry(sz.z * 0.48, sz.z * 0.48, 0.05, 24), new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.35, depthWrite: false })); r.position.y = sz.y / 2 + 0.05; this.obj.add(r);
    }
    s.cam.follow(() => ({ pos: this.pos, heading: 0 }), { dist: Math.max(14, sz.z * 1.35), height: Math.max(3.2, sz.y * 1.1), ahead: 30, up: 0.5, stiff: 9, lookStiff: 14, fov: 66, ground: false, ...(o.cam || {}), snap: true });
    s.onUpdate(dt => this.update(dt)); s.focus = this.pos; s.subject ??= this.obj;
  }
  crash(reason = 'Flew it into the ground', injury = 1) {
    if (this.dead) return; this.dead = true; const s = this.s; s.fx.explosion(this.pos, 2.2); s.audio.explosion(1.2); s.engine.addShake(2.2); s.engine.flash(0.8); this.mesh.visible = false; if (this.rotor) this.rotor.visible = false;
    s.fx.debris(this.pos, 40, { color: 0x555555, speed: 26, size: 0.8, dir: V3(0, 0, -1), floor: this.pos.y - 30 }); s.fail(reason, { injury });
  }
  update(dt) {
    const s = this.s, o = this.o, p = this.pos, inp = s.input; if (this.frozen) return;
    const live = s.started && !this.dead && this.control;
    if (!s.started) { if (this.rotor) this.rotor.rotation.y += dt * 40; this.obj.rotation.set(o.kind === 'heli' ? -0.14 : 0, 0, this.inv + (this.extraRoll || 0)); return; }
    if (this.dead) { s.audio.set('jet', o.kind === 'heli' ? 'rotor' : 'jet', 0, 0); return; }
    const ix = live ? inp.x : 0, iy = live ? inp.y : 0, boost = live && inp.b && o.boost > 1;
    this.v = damp(this.v, (s.started ? o.speed : (o.idleSpeed ?? o.speed)) * (boost ? o.boost : 1) * (this.speedK ?? 1), 1.4, dt);
    const rk = o.resp ?? 3.6; this.vx = damp(this.vx, ix * o.agility, rk, dt); this.vy = damp(this.vy, iy * o.climb * (this.inverted && o.invertPitch ? -1 : 1) + (this.liftBias || 0), rk, dt);
    p.x += this.vx * dt; p.y += this.vy * dt; p.z -= this.v * dt;
    if (o.canInvert && live && inp.hit('a')) { this.inverted = !this.inverted; s.audio.whoosh(1.5); }
    this.inv = damp(this.inv, this.inverted ? Math.PI : 0, 5, dt);
    if (o.knife) this.knifeK = damp(this.knifeK, live && inp.a ? 1 : 0, 9, dt);
    this.roll = damp(this.roll, -this.vx / o.agility * (o.bank ?? (o.kind === 'heli' ? 0.45 : 1.05)), 7, dt); this.pitch = damp(this.pitch, this.vy / o.climb * (o.kind === 'heli' ? 0.18 : 0.42) + (o.kind === 'heli' ? -0.14 : 0), 7, dt);
    const rz = this.roll * (1 - this.knifeK) + this.inv + (this.extraRoll || 0) - this.knifeK * Math.PI / 2; this.obj.rotation.set(this.pitch, -this.vx / o.agility * 0.12, rz);
    const kk = Math.abs(Math.sin(rz)); this.hw = o.r * (1 - 0.62 * kk); this.hh = o.r * (0.45 + 0.55 * kk);
    if (this.rotor) this.rotor.rotation.y += dt * 40;
    // environment limits supplied by the stunt
    const C = this.clear; C.floor = C.ceil = C.left = C.right = 1e9;
    if (o.floor) C.floor = p.y - this.hh - o.floor(p.x, p.z); if (o.ceil) C.ceil = o.ceil(p.x, p.z) - p.y - this.hh;
    if (o.walls) { const w = o.walls(p.z, p.y); if (w) { C.left = p.x - this.hw - w[0]; C.right = w[1] - p.x - this.hw; } }
    const mc = Math.min(C.floor, C.ceil, C.left, C.right); this.stats.minClear = Math.min(this.stats.minClear, mc); this.stats.t += dt;
    if (!this.dead && s.started) {
      if (C.floor < 0) return this.crash(o.floorMsg || 'Flew it into the deck'); if (C.ceil < 0) return this.crash(o.ceilMsg || 'Hit the roof'); if (C.left < 0 || C.right < 0) return this.crash(o.wallMsg || 'Clipped the wall');
      s.course.hit(p.x, p.y, p.z, this.hw, this.hh, this.size.z * 0.4, sol => { if (sol.type === 'trigger') { if (!sol.fired) { sol.fired = true; sol.on?.(this, sol); } return; } if (this.onHit?.(sol) === true) return true; this.crash(sol.msg || 'Flew into the set'); return true; });
    }
    // fx / audio
    if (o.kind === 'jet' && o.exhaust !== false) { const n = o.engines ?? 2; for (let i = 0; i < n; i++) { const ex = (i - (n - 1) / 2) * (o.engGap ?? 1.4); this._p.set(ex, 0, this.size.z * 0.5).applyEuler(this.obj.rotation).add(p); s.fx.exhaust(this._p, this._v.set(this.vx, this.vy, -this.v * 0.93), (o.exSize ?? clamp(this.size.z * 0.045, 0.2, 1)) * (boost ? 1.8 : 1), true); } }
    s.audio.set('jet', o.kind === 'heli' ? 'rotor' : o.kind === 'prop' ? 'engine' : 'jet', o.kind === 'prop' ? 0.8 : (boost ? 1 : 0.55), 0.5);
    s.audio.set('windv', 'wind', 0.8, clamp(0.25 + (mc < 12 ? 0.3 : 0), 0, 0.6));
    s.cam.fovKick = (boost ? 12 : 0) + clamp(10 - mc, 0, 10) * 0.6; s.engine.fx.uBlur.value = damp(s.engine.fx.uBlur.value, (boost ? 0.7 : 0.35) * (o.blur ?? 1), 4, dt);
  }
}
