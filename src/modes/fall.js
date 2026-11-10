import * as THREE from 'three';
import { clamp, damp, V3, rnd } from '../world/stage.js';
import { model } from '../core/assets.js';

// Freefall / high fall. WASD steer, hold SPACE to tuck & dive faster, E = action (chute / grapple / grab).
// Options: char,x,y,z, vy0 (downward m/s), vx0,vz0 (carried momentum, bleeds off with carryDrag), spread/tuck (terminal m/s),
//   steer (m/s), chuteV, view 'chase|top|side' + cam overrides, yaw (control/camera frame), pose, tuckPose, canTuck, clouds, cloudBase,
//   camSnap:false (blend from the previous camera, e.g. Drive -> Fall hand-over), aim {r,color,ref,max} (drop-shadow ring on the ground directly below), waterY (water surface counts as ground), groundY (fallback), frozen (start held; call launch()), bounds(p), wind (streaks).
// State: pos vel(steer+vertical) carry alt speed tucked chute done dead frozen control poseLock termK steerK windX windZ.
// Hooks: onLand(info{speed,x,z,chute,water}) onHit(sol) onDeploy().
// v2: path(dur) predicts the fall for s.cut(); cine(type, dur, o) = timed live cut; launch()/deploy() auto-mark low-weight replay moments
//   ('the drop' w0.9, 'canopy' w1.1; autoMoments:false disables, deployShots sets the canopy edit); hitAdvice / groundAdvice for the default fails.
export const FALL_VIEWS = {
  chase: { dist: 7.5, height: 5.5, side: 0, yaw: 0, ahead: 0, up: -1.5, stiff: 9, fov: 68, ground: false },
  top: { dist: 3.2, height: 12, side: 0, yaw: 0, ahead: 2.5, up: -4, stiff: 9, fov: 70, ground: false },
  side: { dist: 9, height: 1.5, side: 0, yaw: Math.PI / 2, ahead: 0, up: -1, stiff: 9, fov: 60, ground: false },
};
export class Fall {
  constructor(s, o = {}) {
    this.s = s; this.o = o = { spread: 52, tuck: 84, steer: 16, chuteV: 6, grav: 9.81, groundY: 0, view: 'chase', wind: true, clouds: false, carryDrag: 0.45, openRate: 1.8, ...o };
    this.c = s.char(o.char || 'ch_skydiver', { x: o.x || 0, y: o.y ?? 1000, z: o.z || 0, heading: o.heading ?? o.yaw ?? 0 }); this.pos = this.c.root.position; this.c.setPose(o.pose || 'freefall', 0); this._pose = o.pose || 'freefall';
    this.vel = V3(0, -(o.vy0 ?? 0), 0); this.carry = V3(o.vx0 || 0, 0, o.vz0 || 0);
    this.tucked = false; this.chute = false; this.chuteT = 0; this.dead = false; this.done = false; this.frozen = !!o.frozen; this.control = true; this.t = 0; this.bodies = [];
    this._p = V3(); this._v = V3(); this.yaw = o.yaw ?? 0;
    s.cam.follow(() => ({ pos: this.pos, heading: this.yaw }), { ...(FALL_VIEWS[o.view] || FALL_VIEWS.chase), ...(o.cam || {}), snap: o.camSnap !== false });
    if (o.aim) { const r = o.aim.r ?? 1.2; const m = this.aim = new THREE.Mesh(new THREE.RingGeometry(r * 0.72, r, 28), new THREE.MeshBasicMaterial({ color: new THREE.Color(o.aim.color ?? 0xff3322).multiplyScalar(1.6), transparent: true, opacity: 0.85, depthWrite: false, depthTest: false, side: THREE.DoubleSide })); m.rotation.x = -Math.PI / 2; m.renderOrder = 8; m.visible = false; s.scene.add(m); }
    s.onUpdate(dt => this.update(dt)); s.focus = this.pos; s.subject ??= this.c.root;
  }
  get alt() { return this.pos.y - this.ground(); }
  get speed() { return -this.vel.y; }
  ground() { let g = this.s.course.height(this.pos.x, this.pos.z, this.pos.y + 1); if (!(g > -1e5)) g = this.o.groundY; if (this.o.waterY != null && g < this.o.waterY) g = this.o.waterY; return g; }
  // switch camera view smoothly (name from FALL_VIEWS and/or overrides)
  view(name, over = {}) { this.s.cam.set({ ...(FALL_VIEWS[name] || {}), ...over }); return this; }
  // v2: predicted path [{t,p}] (no steering input) for live cinematic cuts — s.cut(f.path(2), 'wide')
  path(dur = 3, dt = 0.1) {
    const s = this.s, o = this.o, p = this.pos, pts = [{ t: s.t, p: p.clone() }]; if (this.frozen || this.done) { pts.push({ t: s.t + dur, p: p.clone() }); return pts; }
    const term = this.chute ? o.chuteV : (this.tucked ? o.tuck : o.spread) * (this.termK ?? 1), g = this.ground(), cd = this.chute ? 1.5 : o.carryDrag;
    let x = p.x, y = p.y, z = p.z, vy = -this.vel.y, cx = this.carry.x, cz = this.carry.z; const vx = this.vel.x, vz = this.vel.z;
    for (let t = dt; t <= dur + 1e-6; t += dt) {
      if (vy > term && this.chute) vy = term + (vy - term) * Math.exp(-o.openRate * dt); else vy += o.grav * (1 - (vy > 0 ? vy * vy / (term * term) : 0)) * (vy > term ? 2.2 : 1) * dt;
      const k = Math.exp(-cd * dt); cx *= k; cz *= k; x += (vx + cx) * dt; z += (vz + cz) * dt; y = Math.max(g, y - vy * dt); pts.push({ t: s.t + t, p: V3(x, y, z) });
    }
    return pts;
  }
  // live cut to a cinematic angle for `dur` sim-seconds (the player keeps control), then back to the game camera
  cine(type = 'wide', dur = 1.5, o = {}) { const s = this.s, done = s.cut(this.path(dur + 1), type, { subject: this.c.root, ...o }); s.after(dur, done); return done; }
  // release a frozen performer with an initial velocity (vyUp = upward m/s)
  launch(vx = 0, vyUp = 0, vz = 0) { this.frozen = false; this.carry.set(vx, 0, vz); this.vel.set(0, vyUp, 0); this._dropMoment(); return this; }
  // v2: the drop and the canopy are marked as (low-weight) replay moments; stunts mark their own signature beat with w >= 2
  _dropMoment() { const s = this.s; if (this._dropM || !s.started || this.o.autoMoments === false) return; this._dropM = s.moment('the drop', { t0: s.t - 0.5, dur: 3.4, w: 0.9 }); }
  deploy(modelId = 'parachute') {
    if (this.chute || this.dead || this.done) return false; this.chute = true; this.chuteT = 0; this.tucked = false; this.s.audio.whoosh(1.4); this.s.audio.thud(); this.s.engine.addShake(0.7);
    const m = this.canopy = model(modelId, { height: this.o.canopyH ?? 7 }); m.position.y = this.o.canopyY ?? 1.5; m.scale.multiplyScalar(0.05); this.c.root.add(m);
    this.c.setPose('hang', 0.3); this.c.tumble(0, 0, 0); this.c.spinAng.set(0, 0, 0); this.poseLock = true;
    if (this.o.autoMoments !== false && this.s.started) this.s.moment('canopy', { t0: this.s.t - 1.8, dur: 4, w: 1.1, shots: this.o.deployShots });
    this.onDeploy?.(); return true;
  }
  addBody(char, o = {}) {
    const c = this.s.char(char, { x: o.x || 0, y: o.y ?? this.pos.y, z: o.z || 0, heading: o.heading ?? 0 }); c.setPose(o.pose || 'freefall', 0);
    const b = { ...o, c, pos: c.root.position, vy: o.vy ?? this.vel.y, vx: o.vx || 0, vz: o.vz || 0, landed: false }; this.bodies.push(b); return b;
  }
  die(spin = true) { if (this.dead) return; this.dead = true; this.poseLock = true; if (spin) { this.c.setCycle('flail', 1); this.c.tumble(5, 1, 2); } }
  update(dt) {
    const s = this.s, o = this.o, p = this.pos, inp = s.input, ch = this.c; this.t += dt;
    if (!s.started && o.holdUntilAction !== false) return;
    this._bodies(dt);
    if (this.frozen || this.done) { if (this.done) s.audio.set('wind', 'wind', 0.3, 0.05); return; }
    this._dropMoment();
    const live = s.started && !this.dead && this.control && !s.ended;
    this.tucked = live && inp.a && !this.chute && o.canTuck !== false;
    const term = this.chute ? o.chuteV : (this.tucked ? o.tuck : o.spread) * (this.termK ?? 1);
    // quadratic drag toward terminal velocity (drag only opposes a descent)
    const vy = -this.vel.y; const acc = o.grav * (1 - (vy > 0 ? (vy * vy) / (term * term) : 0)) * (vy > term ? 2.2 : 1); this.vel.y -= acc * dt;
    if (this.chute) { this.chuteT += dt; if (this.canopy) this.canopy.scale.setScalar(damp(this.canopy.scale.x, 1, 5, dt)); if (-this.vel.y > o.chuteV) this.vel.y = damp(this.vel.y, -o.chuteV, o.openRate, dt); }
    const st = (this.chute ? (o.chuteSteer ?? o.steer * 0.55) : o.steer * (this.tucked ? 0.55 : 1)) * (this.steerK ?? 1);
    const ix = live ? inp.x : 0, iy = live ? inp.y : 0, sn = Math.sin(this.yaw), cs = Math.cos(this.yaw);
    const wx = ix * cs - iy * sn, wz = -ix * sn - iy * cs;
    this.vel.x = damp(this.vel.x, wx * st + (this.windX || 0), o.respond ?? 2.6, dt); this.vel.z = damp(this.vel.z, wz * st + (this.windZ || 0) + (o.drift || 0), o.respond ?? 2.6, dt);
    this.carry.multiplyScalar(Math.exp(-(this.chute ? 1.5 : o.carryDrag) * dt));
    p.x += (this.vel.x + this.carry.x) * dt; p.y += this.vel.y * dt; p.z += (this.vel.z + this.carry.z) * dt;
    if (o.bounds) o.bounds(p, this);
    // pose
    if (!this.dead && !this.chute && !this.poseLock) { const want = this.tucked ? (o.tuckPose || 'track') : (o.pose || 'freefall'); if (this._pose !== want) { this._pose = want; ch.setPose(want, 0.3); } ch.heading = damp(ch.heading, this.yaw, 6, dt); ch.cur.body[1] += (clamp(-(this.vel.x * cs - this.vel.z * sn) / 30, -0.5, 0.5) - ch.cur.body[1]) * 0.1; }
    if (this.chute && !this.dead) { ch.heading = damp(ch.heading, this.yaw, 4, dt); if (this.canopy) { this.canopy.rotation.z = damp(this.canopy.rotation.z, clamp(-(this.vel.x * cs - this.vel.z * sn) / 40, -0.3, 0.3), 3, dt); this.canopy.rotation.x = damp(this.canopy.rotation.x, clamp((this.vel.x * sn + this.vel.z * cs) / 40, -0.3, 0.3), 3, dt); } }
    // solids (cliff ledges, antenna...)
    s.course.hit(p.x, p.y + 0.9, p.z, 0.45, 0.8, 0.45, sol => { if (sol.dead) return; if (sol.type === 'trigger') { if (!sol.fired) { sol.fired = true; sol.on?.(this, sol); } return; } if (this.onHit?.(sol) === true) return true; if (!this.dead) { this.die(); s.audio.impact(1); s.engine.addShake(1); s.fail(sol.msg || 'Clipped the scenery on the way down', { injury: 0.85, advice: sol.advice || o.hitAdvice || 'Steer away from the walls early with WASD — they are closer than they look from above.' }); } return true; });
    // ground
    const g = this.ground();
    if (this.aim) { const a = p.y - g; this.aim.visible = a > 1.5 && !this.dead && !this.aimOff; this.aim.position.set(p.x, g + 0.12, p.z); this.aim.scale.setScalar(clamp(a / (o.aim.ref ?? 45), 1, o.aim.max ?? 5)); }
    if (p.y <= g) {
      p.y = g; const speed = -this.vel.y, water = o.waterY != null && g <= o.waterY + 1e-6; this.done = true; this.vel.set(0, 0, 0); this.carry.set(0, 0, 0); this.tucked = false;
      if (this.canopy) this.canopy.visible = false; if (this.aim) this.aim.visible = false; ch.tumble(0, 0, 0); s.cam.fovKick = 0;
      if (this.onLand) this.onLand({ speed, x: p.x, z: p.z, chute: this.chute, water });
      else if (speed > 11 && !this.dead) { this.dead = true; ch.setPose('lie', 0.1); ch.spinAng.set(0, 0, 0); s.audio.impact(1.2); s.engine.addShake(1.5); s.fail('Hit the ground at ' + Math.round(speed * 3.6) + ' km/h', { injury: 1, advice: o.groundAdvice || 'You hit the ground at freefall speed — open the parachute (E) inside the green zone of the timing bar.' }); }
      else { ch.spinAng.set(0, 0, 0); ch.setPose('land', 0.12); }
      return;
    }
    // atmosphere
    const sp = -this.vel.y;
    if (o.wind && sp > 12) { const n = sp > 45 ? 2 : 1; for (let i = 0; i < n; i++) s.fx.streak(this._p.set(p.x + rnd(-10, 10), p.y - rnd(6, 30), p.z + rnd(-10, 10)), this._v.set(0, sp * 0.35, 0), [1, 1, 1], 0.4, 0.1, 0.3); }
    if (o.clouds && Math.random() < dt * 5 && p.y > (o.cloudBase ?? 600)) s.fx.cloudPuff(this._p.set(p.x + rnd(-70, 70), p.y - rnd(60, 140), p.z + rnd(-70, 70)), this._v.set(0, 0, 0), rnd(25, 60));
    s.audio.set('wind', 'wind', clamp(sp / 70, 0, 1.2), clamp(sp / 70, 0.05, 0.75));
    s.cam.fovKick = clamp(sp / 80, 0, 1) * (this.tucked ? 14 : 7); s.engine.fx.uBlur.value = damp(s.engine.fx.uBlur.value, this.tucked ? 0.4 : clamp(sp / 200, 0, 0.3), 4, dt);
  }
  _bodies(dt) {
    for (const b of this.bodies) {
      if (b.landed || b.frozen) continue; if (b.ai) b.ai(b, dt, this);
      b.pos.x += b.vx * dt; b.pos.z += b.vz * dt; b.pos.y += b.vy * dt;
      let g = this.s.course.height(b.pos.x, b.pos.z, b.pos.y + 1); if (!(g > -1e5)) g = this.o.groundY; if (this.o.waterY != null && g < this.o.waterY) g = this.o.waterY;
      if (b.pos.y <= g) { b.pos.y = g; b.landed = true; b.c.tumble(0, 0, 0); b.onLand?.(b, this); }
    }
  }
}
