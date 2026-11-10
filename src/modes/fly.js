import * as THREE from 'three';
import { clamp, damp, V3, rnd } from '../world/stage.js';
import { model } from '../core/assets.js';

// Arcade flight toward -Z. A/D bank, W climb, S dive, SHIFT afterburner, SPACE = special (canInvert: toggle inverted; knife: hold for a 90° knife-edge).
// Extra options: yaw (model yaw fix), len, knife, agility/climb (max lateral/vertical m/s), resp (control response), invertPitch, floorMsg/ceilMsg/wallMsg
// (+ floorAdvice/ceilAdvice/wallAdvice), idleSpeed, engines/engGap, exhaust:false.
// Hit box: half-width .hw / half-height .hh swap as the aircraft rolls (knife-edge = narrow and tall). Nothing moves until s.started.
// v2 leeway: solids are tested with a slightly forgiving box (hitK, default 0.88). A shallow overlap (< graze m, default 0.6) is a GRAZE,
// not a crash: sparks, a shove away, damage (.dmg 0..1, grazeDmg per hit) and an s.flub(). floorGraze / wallGraze (m) do the same for
// the floor / side-wall limits. Damage >= 1 is a crash. A solid with `graze:false` always kills. onGraze(sol|kind, depth) may return true to veto.
// Close passes (< closePass m, default 2.6, from solids and walls) are auto-marked as small replay moments (w < 1, so the stunt's own beat wins).
// per-model yaw fixes for aircraft whose generated mesh does not face -Z (checked in screenshots)
const FLY_YAW = { fa18: -Math.PI / 2 };
export class Fly {
  constructor(s, o = {}) {
    this.s = s; this.o = o = { speed: 90, boost: 1.35, agility: 34, climb: 26, kind: 'jet', r: 2.5, canInvert: false, minY: -1e9, hitK: 0.88, graze: 0.6, grazeDmg: 0.34, grazePenalty: 0.12, closePass: 2.6, ...o };
    this.obj = new THREE.Group(); this.obj.rotation.order = 'YXZ'; this.mesh = model(o.model, { len: o.len, yaw: o.yaw ?? FLY_YAW[o.model] ?? 0 }); const sz = this.mesh.userData.size; this.mesh.position.y = -sz.y / 2; this.obj.add(this.mesh); s.scene.add(this.obj); this.size = sz;
    this.pos = this.obj.position; this.pos.set(o.x || 0, o.y ?? 100, o.z || 0); this.vx = 0; this.vy = 0; this.v = o.speed; this.roll = 0; this.pitch = 0; this.inv = 0; this.inverted = false; this.dead = false; this.control = true; this.frozen = false;
    this.knifeK = 0; this.hw = o.r; this.hh = o.r * 0.45; this.clear = { floor: 1e9, ceil: 1e9, left: 1e9, right: 1e9 }; this.stats = { lowT: 0, t: 0, minClear: 1e9, grazes: 0 }; this._p = V3(); this._v = V3();
    this.dmg = 0; this._grazed = new Set(); this._gT = -9; this._near = null; this._lastPass = -9;
    if (o.kind === 'heli') { // rotor disc
      const r = this.rotor = new THREE.Mesh(new THREE.CylinderGeometry(sz.z * 0.48, sz.z * 0.48, 0.05, 24), new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.35, depthWrite: false })); r.position.y = sz.y / 2 + 0.05; this.obj.add(r);
    }
    s.cam.follow(() => ({ pos: this.pos, heading: 0 }), { dist: Math.max(14, sz.z * 1.35), height: Math.max(3.2, sz.y * 1.1), ahead: 30, up: 0.5, stiff: 9, lookStiff: 14, fov: 66, ground: false, ...(o.cam || {}), snap: true });
    s.onUpdate(dt => this.update(dt)); s.focus = this.pos; s.subject ??= this.obj;
  }
  // crash(reason, injury, advice) — or crash(reason, { injury, advice })
  crash(reason = 'Flew it into the ground', injury = 1, advice) {
    if (this.dead) return; if (typeof injury === 'object') ({ injury = 1, advice } = injury);
    this.dead = true; const s = this.s; s.fx.explosion(this.pos, 2.2); s.audio.explosion(1.2); s.engine.addShake(2.2); s.engine.flash(0.8); this.mesh.visible = false; if (this.rotor) this.rotor.visible = false;
    s.fx.debris(this.pos, 40, { color: 0x555555, speed: 26, size: 0.8, dir: V3(0, 0, -1), floor: this.pos.y - 30 }); s.fail(reason, { injury, advice });
  }
  // a survivable scrape: sparks, a shove back on course, damage and a flub. Returns true if it was absorbed (false = crash instead).
  graze(what, depth, reason, advice, push) {
    const s = this.s, o = this.o; if (this.dead) return false;
    if (this.onGraze?.(what, depth) === true) return true;
    if (s.t - this._gT < 0.25) { if (push) push(); return true; } // same scrape, still in contact
    this._gT = s.t; this.dmg += o.grazeDmg; this.stats.grazes++;
    if (this.dmg >= 1) { this.crash('Too many scrapes — the airframe gave up', 1, 'Each scrape costs about a third of the airframe. Give the obstacles a wider berth — a metre more is plenty.'); return false; }
    if (push) push(); s.fx.sparks(this.pos, 30); s.fx.debris(this.pos, 10, { color: 0x666666, speed: 14, size: 0.3 }); s.audio.metal?.(0.8); s.audio.impact(0.7); s.engine.addShake(0.9); s.engine.hurt?.(0.25);
    s.flub(reason, { penalty: o.grazePenalty, advice: advice || o.grazeAdvice || 'Pick your gap earlier and aim for the middle of it — you only clipped it, a metre more and it is clean.' });
    return true;
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
    const C = this.clear; C.floor = C.ceil = C.left = C.right = 1e9; let w = null;
    if (o.floor) C.floor = p.y - this.hh - o.floor(p.x, p.z); if (o.ceil) C.ceil = o.ceil(p.x, p.z) - p.y - this.hh;
    if (o.walls) { w = o.walls(p.z, p.y); if (w) { C.left = p.x - this.hw - w[0]; C.right = w[1] - p.x - this.hw; } }
    const mc = Math.min(C.floor, C.ceil, C.left, C.right); this.stats.minClear = Math.min(this.stats.minClear, mc); this.stats.t += dt;
    let near = Math.min(C.left, C.right);
    if (!this.dead && s.started) {
      if (C.floor < 0) { const d = -C.floor; if (!(d < (o.floorGraze ?? 0) && this.graze('floor', d, o.floorScrape || 'Scraped the ground', o.floorAdvice, () => { p.y += d + 0.4; this.vy = Math.max(this.vy, o.climb * 0.5); }))) return this.crash(o.floorMsg || 'Flew it into the deck', 1, o.floorAdvice); }
      if (C.ceil < 0) return this.crash(o.ceilMsg || 'Hit the roof', 1, o.ceilAdvice);
      if (C.left < 0 || C.right < 0) { const l = C.left < 0, d = -(l ? C.left : C.right); if (!(d < (o.wallGraze ?? 0) && this.graze('wall', d, o.wallScrape || 'Scraped the edge', o.wallAdvice, () => { p.x += (l ? 1 : -1) * (d + 0.5); this.vx = (l ? 1 : -1) * o.agility * 0.5; }))) return this.crash(o.wallMsg || 'Clipped the wall', 1, o.wallAdvice); }
      const k = o.hitK, hw = this.hw * k, hh = this.hh * k, hd = this.size.z * 0.4, cp = o.closePass;
      s.course.hit(p.x, p.y, p.z, hw + cp, hh + cp, hd, sol => {
        if (sol.type === 'trigger') { if (!sol.fired && p.x + hw >= sol.x0 && p.x - hw <= sol.x1 && p.y + hh >= sol.y0 && p.y - hh <= sol.y1) { sol.fired = true; sol.on?.(this, sol); } return; }
        const gx = Math.max(sol.x0 - (p.x + hw), (p.x - hw) - sol.x1), gy = Math.max(sol.y0 - (p.y + hh), (p.y - hh) - sol.y1), gap = Math.max(gx, gy);
        if (gap > 0) { if (!this._grazed.has(sol)) near = Math.min(near, gap); return; } // close, not touching
        if (this._grazed.has(sol)) return;
        if (this.onHit?.(sol) === true) return true;
        const depth = -gap; // smallest penetration across the two axes we can be shoved along
        if (sol.graze !== false && depth < o.graze && this.graze(sol, depth, sol.scrape || (sol.msg ? sol.msg.replace(/^(Flew into|Hit|Clipped|Flew it into)/i, 'Clipped') : 'Clipped the scenery'), sol.advice, () => { this._grazed.add(sol); const cx = (sol.x0 + sol.x1) / 2, cy = (sol.y0 + sol.y1) / 2; if (gx >= gy) this.vx += Math.sign(p.x - cx || 1) * o.agility * 0.6; else this.vy += Math.sign(p.y - cy || 1) * o.climb * 0.5; })) return;
        this.crash(sol.msg || 'Flew into the set', 1, sol.advice); return true;
      });
      // auto replay moment for the closest passes (small weight: the stunt's own big beat still wins)
      if (this.dead) return;
      if (near < cp && this.v > 15) { if (!this._near || near < this._near.c) this._near = { c: near, t: s.t }; this._nearOff = 0; }
      else if (this._near && (this._nearOff = (this._nearOff || 0) + dt) > 0.3) { const n = this._near; this._near = null; if (n.t - this._lastPass > 2.5) { this._lastPass = n.t; s.moment('close pass', { t0: n.t - 1.4, t1: n.t + 0.9, w: 0.5 + 0.45 * clamp(1 - n.c / cp), kind: 'pass' }); } }
    }
    if (this.dmg > 0) { s.hud.meter('dmg', 'Damage', this.dmg, { color: '#ff7040' }); if (this.dmg > 0.3 && Math.random() < this.dmg) s.fx.smokePuff(this._p.set(0, 0, this.size.z * 0.3).applyEuler(this.obj.rotation).add(p), 1, { color: [0.25, 0.25, 0.25], size: 0.8 + this.dmg, up: 0.3, life: 1.2, a: 0.45 }); }
    // fx / audio
    if (o.kind === 'jet' && o.exhaust !== false) { const n = o.engines ?? 2; for (let i = 0; i < n; i++) { const ex = (i - (n - 1) / 2) * (o.engGap ?? 1.4); this._p.set(ex, 0, this.size.z * 0.5).applyEuler(this.obj.rotation).add(p); s.fx.exhaust(this._p, this._v.set(this.vx, this.vy, -this.v * 0.93), (o.exSize ?? clamp(this.size.z * 0.045, 0.2, 1)) * (boost ? 1.8 : 1), true); } }
    s.audio.set('jet', o.kind === 'heli' ? 'rotor' : o.kind === 'prop' ? 'engine' : 'jet', o.kind === 'prop' ? 0.8 : (boost ? 1 : 0.55), 0.5);
    s.audio.set('windv', 'wind', 0.8, clamp(0.25 + (mc < 12 ? 0.3 : 0), 0, 0.6));
    s.cam.fovKick = (boost ? 12 : 0) + clamp(10 - mc, 0, 10) * 0.6; s.engine.fx.uBlur.value = damp(s.engine.fx.uBlur.value, (boost ? 0.7 : 0.35) * (o.blur ?? 1), 4, dt);
  }
}
