import * as THREE from 'three';
import { clamp, damp, V3 } from '../world/stage.js';

const JUMP = { sp: [0.15, 0, 0], aR: [0.25, -0.3, 0.9, 0.0, 0.5, 0.8], aL: [0.3, -0.6, -0.6, 0.1, -0.9, 0.1], lR: [0.08, -0.5, 0.9, 0.02, -1, -0.3], lL: [0.08, -0.9, -0.5, 0.02, -0.5, -0.9] }; // running take-off
// On-foot runner: auto-runs toward -Z. W sprint, A/D strafe, SPACE jump, S / SHIFT slide. Ledge grabs save short jumps.
// v2 leniency: a solid lower than `tripH` (1 m) that is not `deadly` makes you trip over it (stumble + flub) instead of killing you;
// solids flagged `bump` (or every solid with o.bump) knock you back and sidestep you round them with a flub; landings up to
// `hardBand` metres past fallDeath are a hard landing (flub) rather than a death. Solid fields: deadly, bump, trip (flub text),
// penalty, advice, quiet. Hooks: onTrip(sol) onBump(sol). Big jumps (> 0.75 s of air) are marked as replay moments.
export class Run {
  constructor(s, o = {}) {
    this.s = s; this.o = o = { speed: 7.2, sprint: 9.6, strafe: 6.5, jumpV: 7.4, grav: 21, slideT: 0.85, fallDeath: 7, auto: true, width: 0.35, grab: true, air: 0.6, accel: 9, airAccel: 0, cadence: 3.45, ...o }; // cadence: phase rad/s per (m/s) — 2π/3.45 ≈ 1.8 m stride, so feet match the ground instead of skating
    this.c = s.char(o.char || 'ch_stunt', { x: o.x || 0, z: o.z || 0 }); this.pos = this.c.root.position; this.pos.y = o.y ?? s.course.height(this.pos.x, this.pos.z);
    this.v = 0; this.vx = 0; this.vy = 0; this.grounded = true; this.slide = 0; this.stun = 0; this.dead = false; this.frozen = false; this.grabT = 0; this.airT = 0; this.mirror = o.mirror ? -1 : 1; this.control = true; this.speedK = 1;
    this.stats = { jumps: 0, slides: 0, grabs: 0, stumbles: 0, maxDrop: 0 }; this._p = V3(); this.takeY = this.pos.y; this.takeZ = this.pos.z; this.stepT = 0;
    this.c.setPose('ready', 0);
    this.camO = { dist: 6.2, height: 2.7, ahead: 3.5, up: 1.2, stiff: 7, fov: 62, ground: false, ...(o.cam || {}) };
    s.cam.follow(() => ({ pos: this.camPos(), heading: 0 }), { ...this.camO, snap: true }); this._cp = V3(); this.camY = this.pos.y;
    s.onUpdate(dt => this.update(dt)); s.focus = this.pos; s.subject ??= this.c.root; s.blobR = 1.15;
  }
  camPos() { return this._cp.set(this.pos.x * (this.o.camX ?? 0.7), this.camY, this.pos.z); }
  get h() { return this.slide > 0 ? 0.75 : 1.75; }
  jump(v) { if (!this.grounded || this.slide > 0.25 || this.stun > 0) return false; this.vy = v ?? this.o.jumpV; this.grounded = false; this.airT = 0; this.takeY = this.pos.y; this.takeZ = this.pos.z; this.slide = 0; this.stats.jumps++; this.s.audio.whoosh(0.6); this.onJump?.(); return true; }
  stumble(t = 0.7, slow = 0.45) { if (this.stun > 0) return; this.stun = t; this.v *= slow; this.stats.stumbles++; this.s.audio.thud(); this.s.engine.addShake(0.4); this.c.setPose('hit', 0.08); this.onStumble?.(); }
  die(reason, injury = 0.6, tumble = true, advice) { if (this.dead) return; this.dead = true; if (tumble) { this.c.setCycle('flail', 1); this.c.tumble(-5, 0, 1); } this.s.audio.impact(0.9); this.s.fail(reason, { injury, advice: advice || this.o.advice?.(reason) }); }
  // ignore a solid for a moment (you got past it the hard way)
  pass(sol, sec = 0.9) { sol._pass = this.s.t + sec; }
  // tripped over something low: stumble, hop over it, keep rolling
  trip(sol) {
    const s = this.s; this.pass(sol); this.stumble(0.55, 0.55); if (this.grounded) { this.vy = 4.2; this.grounded = false; this.airT = 0; this.takeY = this.pos.y; this.takeZ = this.pos.z; }
    s.fx.dust(this.pos, 4, { color: this.dust }); if (this.onTrip?.(sol) === true || sol.quiet) return;
    s.flub(sol.trip || 'Tripped over the scenery', { penalty: sol.penalty ?? 0.08, advice: sol.advice || 'Watch the prompt at the bottom of the screen: SPACE to jump low obstacles, S to slide under high ones, A/D around the rest.' });
  }
  // ran into something big: knocked back and round it, keep rolling
  bump(sol) {
    const s = this.s, p = this.pos, o = this.o; this.stumble(0.8, 0); this.v = 0; this.vx = 0; p.z = Math.max(p.z, sol.z1 + 0.45);
    const l = sol.x0 - o.width - 0.15, r = sol.x1 + o.width + 0.15, okL = o.xmin == null || l >= o.xmin, okR = o.xmax == null || r <= o.xmax;
    this.sideTo = okL && (!okR || p.x - l < r - p.x) ? l : okR ? r : p.x; this.pass(sol, 0.25);
    s.engine.addShake(0.5); s.audio.impact(0.6); if (this.onBump?.(sol) === true || sol.quiet) return;
    s.flub(sol.trip || sol.msg || 'Ran into the scenery', { penalty: sol.penalty ?? 0.15, advice: sol.advice || 'Look further ahead and pick your side early — A/D to get round it.' });
  }
  update(dt) {
    const s = this.s, o = this.o, c = s.course, p = this.pos, inp = s.input, ch = this.c;
    if (this.frozen) return;
    const live = s.started && !this.dead && this.control && this.stun <= 0 && this.grabT <= 0;
    if (this.stun > 0) { this.stun -= dt; if (this.stun <= 0 && !this.dead) ch.setCycle('run', 0); }
    if (this.dead) { // ragdoll-ish fall
      if (!this.grounded) { this.vy -= o.grav * dt; p.y += this.vy * dt; p.z -= this.v * dt * 0.5; const g = c.height(p.x, p.z, p.y + 0.3); if (g > -1e5 && p.y <= g) { p.y = g; this.grounded = true; ch.tumble(0, 0, 0); ch.spinAng.set(0, 0, 0); ch.setPose('lie', 0.1); s.fx.dust(p, 8); } }
      else { this.v = damp(this.v, 0, 4, dt); p.z -= this.v * dt * 0.3; }
      this.camY = damp(this.camY, p.y, 4, dt); return;
    }
    if (this.grabT > 0) { // hanging on a ledge then pulling up: hands pinned to the edge by IK, body swings then vaults
      this.grabT -= dt; const k = 1 - this.grabT / this.grabDur, pull = clamp((k - 0.32) / 0.68), e = pull * pull * (3 - 2 * pull);
      p.y = this.grabY - 1.75 + 1.75 * e + Math.sin(Math.min(1, pull) * Math.PI) * 0.12; // ease + a little hop over the lip
      p.z = this.grabZ - 0.85 * clamp((k - 0.5) / 0.5) ** 1.4 - Math.sin(k * 6.5) * 0.03 * (1 - k); // dangle sway dying out as he climbs
      if (k < 0.32) ch.setCycle('hang', 1.4); else if (k < 0.72) ch.setPose('pullup', 0.12); else ch.setPose('vault', 0.12);
      if (this.grabT <= 0) { this.grounded = true; this.vy = 0; this.v = o.speed * 0.65; ch.ik = null; this._grabTgts?.forEach(t => t.removeFromParent()); this._grabTgts = null; ch.setCycle('run', 0); }
      this.camY = damp(this.camY, p.y, 5, dt); return;
    }
    // speed
    const want = !s.started ? 0 : (o.auto ? (live && inp.y > 0 ? o.sprint : o.speed) : (live ? Math.max(0, inp.y) * o.sprint : 0)) * this.speedK;
    if (!this.grounded && o.airAccel && live) this.v = damp(this.v, want, o.airAccel, dt);
    if (this.grounded && this.slide <= 0) this.v = damp(this.v, this.stun > 0 ? this.v : want, this.stun > 0 ? 0 : o.accel * 0.35, dt);
    if (this.slide > 0) { this.slide -= dt; this.v = Math.max(o.speed * 0.6, this.v - 2.2 * dt); if (Math.random() < 0.5) s.fx.dust(p, 1, { color: this.dust, size: 0.8, a: 0.25 }); if (this.slide <= 0) ch.setCycle('run', 0); }
    const sx = live ? inp.x * this.mirror : 0; this.vx = damp(this.vx, sx * o.strafe * (this.grounded ? 1 : o.air) * (this.slide > 0 ? 0.35 : 1), 12, dt);
    if (live) {
      if (inp.hit('a')) { if (this.jump()) ch.setPose(o.jumpPose || JUMP, 0.1); }
      else if ((inp.hit('down') || inp.hit('b')) && this.grounded && this.slide <= 0 && this.v > 3 && o.slide !== false) { this.slide = o.slideT; this.v *= 1.08; this.stats.slides++; ch.setPose('slide', 0.1); s.audio.whoosh(0.4); this.onSlide?.(); }
      if (!this.grounded && this.vy > 0 && !inp.a && this.airT > 0.08) this.vy -= o.grav * 0.9 * dt; // short hop when released early
    }
    // move
    const nx = p.x + this.vx * dt, nz = p.z - this.v * dt;
    // obstacles
    const hh = this.h / 2; let blocked = false;
    c.hit(nx, p.y + hh + 0.12, nz, o.width, hh - 0.1, 0.3, sol => {
      if (sol._pass > s.t) return;
      if (sol.type === 'trigger') { if (!sol.fired || sol.repeat) { sol.fired = true; sol.on?.(this, sol); } return; }
      if (sol.type === 'break') { sol.dead = true; if (sol.obj) sol.obj.visible = false; const cp = this._p.set((sol.x0 + sol.x1) / 2, (sol.y0 + sol.y1) / 2, (sol.z0 + sol.z1) / 2); if (sol.glass) { s.fx.glass(cp, 60, { dir: V3(0, 0, -1), speed: this.v * 0.7 }); s.audio.glass(); } else { s.fx.debris(cp, 10, { color: sol.debris ?? 0x8a6a40, dir: V3(0, 0, -1), speed: this.v * 0.5, floor: sol.y0 }); s.audio.impact(0.5); } sol.on?.(this, sol); return; }
      // ledge grab: front face of something whose top is reachable
      const top = sol.y1 - p.y;
      if (!this.grounded && o.grab && sol.grab !== false && top > 0.4 && top < (o.grabH ?? 2.8) && this.v > 1 && nz - 0.3 <= sol.z1 && p.z >= sol.z1 - 0.35) { this.grabT = this.grabDur = sol.grabT ?? 1.05; this.grabY = sol.y1; this.grabZ = sol.z1 + 0.32; p.z = this.grabZ; p.x = nx; this.vy = 0; this.v = 0; this.stats.grabs++;
        // pin both hands to the actual ledge edge (world targets just over the lip) so the grab reads as contact, not hovering
        if (ch.ok) { const mkT = dx => { const t = new THREE.Object3D(); t.position.set(p.x + dx, sol.y1 + 0.02, sol.z1 - 0.06); s.scene.add(t); return t; }; const tR = mkT(0.27 * this.mirror), tL = mkT(-0.27 * this.mirror); this._grabTgts = [tR, tL]; ch.ik = { aR: tR, aL: tL, pole: [0.55, -0.35, -0.5] }; ch.setPose('hang', 0.07); }
        s.audio.thud(); s.engine.addShake(0.3); this.onGrab?.(sol); blocked = true; return true; }
      if (top <= (this.grounded ? 0.45 : 0.5)) return; // step up / land on top
      blocked = true; const r = sol.on?.(this, sol); if (r === true) return true;
      if (this.onHit?.(sol) === true) return true;
      if (sol.soft) { this.stumble(); sol.dead = !!sol.once; return true; }
      if (!sol.deadly && sol.type === 'solid' && top < (o.tripH ?? 1.0)) { this.trip(sol); return true; }
      // sideways hit against a wall just blocks strafing
      if (Math.abs(this.vx) > 0.5 && p.z - 0.3 < sol.z1 && p.z + 0.3 > sol.z0 && !(p.x + o.width > sol.x0 && p.x - o.width < sol.x1)) { this.vx = 0; blocked = 'x'; return true; }
      if (!sol.deadly && (sol.bump || (o.bump && sol.bump !== false)) && this.grounded) { this.bump(sol); return true; }
      if (!this.grounded) this.v = 0; this.die(sol.msg || 'Ran straight into the set', sol.injury ?? 0.45, true, sol.advice); return true;
    });
    if (blocked !== true) { if (blocked !== 'x') p.x = nx; p.z = nz; }
    if (this.sideTo != null) { p.x = damp(p.x, this.sideTo, 9, dt); if (Math.abs(p.x - this.sideTo) < 0.05 || this.stun <= 0) this.sideTo = null; }
    if (o.xmin != null) p.x = clamp(p.x, o.xmin, o.xmax);
    // vertical
    const g = c.height(p.x, p.z, p.y - (this.grounded ? 0.25 : 0.2)); // default piece step 0.7 -> 0.45 m step-up, 0.5 m catch when airborne
    if (this.grounded) {
      if (g > -1e5 && g >= p.y - 0.35) p.y = damp(p.y, g, 30, dt);
      else { this.grounded = false; this.vy = 0; this.airT = 0; this.takeY = p.y; this.takeZ = p.z; ch.setPose('fall', 0.2); }
    } else {
      this.airT += dt; this.vy -= o.grav * dt; p.y += this.vy * dt;
      if (this.vy < -2 && this.airT > 0.25 && ch.target !== undefined && !ch.cycle) ch.setPose(this.vy < -9 ? 'fall' : (o.airPose || 'leap'), 0.25);
      if (g > -1e5 && p.y <= g && this.vy <= 0) {
        p.y = g; this.grounded = true; const drop = this.takeY - g, imp = -this.vy; this.stats.maxDrop = Math.max(this.stats.maxDrop, drop); this.vy = 0;
        const info = { drop, impact: imp, dist: Math.abs(this.takeZ - p.z), airT: this.airT };
        if (s.started && !this.dead && this.airT > 0.75 && this.autoMoments !== false) s.moment('leap', { t0: s.t - this.airT - 0.6, t1: s.t + 0.9, w: clamp(this.airT * 1.1, 0.8, 1.6) });
        if (this.onLand?.(info) !== true) { if (drop > o.fallDeath && drop < o.fallDeath + (o.hardBand ?? 1.5)) { this.stun = 1; ch.setPose('land', 0.06); s.audio.impact(0.7); s.engine.addShake(0.7); s.fx.dust(p, 8, { color: this.dust }); s.flub('Hard landing', { penalty: 0.15, advice: o.hardAdvice || 'That drop was too big to take standing. Jump earlier and aim for the higher ground.' }); } else if (drop > o.fallDeath) { this.die('Fell ' + Math.round(drop) + ' metres', clamp(0.3 + drop / 25, 0.3, 1), false, o.fallAdvice || 'Do not run off the drops — jump the gaps with SPACE from the last metre so you land on the next level.'); ch.setPose('lie', 0.1); } else if (drop > 2.2) { this.stun = 0.35; ch.setPose('land', 0.06); s.audio.thud(); s.engine.addShake(0.35); s.fx.dust(p, 5, { color: this.dust }); } else { ch.setCycle('run', 0); if (this.airT > 0.3) { s.audio.thud(); s.fx.dust(p, 3, { color: this.dust, a: 0.2 }); } } }
      }
      if (p.y < c.kill) this.die(o.fallMsg || 'Fell out of frame', 0.9, true, o.fallAdvice);
    }
    // animate
    if (this.grounded && this.slide <= 0 && this.stun <= 0 && !this.dead) { if (this.v > 0.6) { ch.setCycle('run', this.v * o.cadence, clamp(this.v / 8.5, 0.5, 1.15)); this.stepT -= dt * this.v; if (this.stepT <= 0) { this.stepT = 1.25; if (this.o.steps !== false) s.audio._noise(0.05, { f: 500, g: 0.12 }); } } else if (ch.cycle !== 'idle') ch.setPose(s.started ? 'ready' : 'ready', 0.2); }
    ch.heading = damp(ch.heading, -this.vx * 0.06, 10, dt);
    // bank into strafes, pitch with the jump arc, look where you're going (down at the landing on the way down)
    ch.lean.set(this.grounded ? clamp((this.v - o.speed) * 0.008, -0.06, 0.1) : clamp(-this.vy * 0.012, -0.12, 0.18), 0, clamp(-this.vx * 0.028, -0.2, 0.2));
    if (!this.dead) (ch.look ||= V3()).set(p.x + this.vx * 0.7, p.y + (this.grounded ? 1.4 : this.vy < 0 ? -1.5 : 1.2), p.z - 12);
    this.camY = damp(this.camY, this.grounded ? p.y : Math.max(p.y - 0.5, this.camY - 14 * dt), 6, dt);
    s.cam.fovKick = clamp((this.v - o.speed) / 4, 0, 1) * 6;
  }
}
