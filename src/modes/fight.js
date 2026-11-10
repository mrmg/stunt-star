import * as THREE from 'three';
import { clamp, damp, V3, rnd, pick } from '../world/stage.js';

// Choreographed fight: beats scroll into the hit box; press the matching key on the beat.
//  L / R = strike that side (A / D)   U = jump-kick (W)   D = duck (S)   B = block (SPACE)
const GLYPH = { L: '←', R: '→', U: '↑', D: '↓', B: '●' }, KEY = { L: 'left', R: 'right', U: 'up', D: 'down', B: 'a' };
export class Fight {
  constructor(s, o = {}) {
    this.s = s; this.o = o = { hp: 5, perfect: 0.075, good: 0.17, look: 1.7, enemies: ['ch_goon'], travel: 0, view: 'side', reach: 1.15, ...o };
    this.c = s.char(o.char || 'ch_kungfu', { x: o.x || 0, y: o.y || 0, z: o.z || 0 }); this.pos = this.c.root.position; this.face = 1; this.c.heading = -Math.PI / 2; this.c.setCycle('guard', 1);
    this.beats = (o.beats || []).map(b => ({ ...b })).sort((a, b) => a.t - b.t); this.i = 0; this.t = -(o.lead ?? 1.2); this.hp = o.hp; this.combo = 0; this.maxCombo = 0; this.hits = 0; this.perfects = 0; this.misses = 0; this.dead = false; this.done = false; this.poseT = 0; this.pool = {}; this.active = [];
    this.lane = s.hud.lane; this.focusP = V3().copy(this.pos); s.focus = this.focusP;
    if (o.view === 'side') s.cam.fixed(V3(this.pos.x, this.pos.y + 1.7, this.pos.z + (o.camDist ?? 7.5)), () => ({ pos: this.focusP, heading: 0 }), { fov: o.fov ?? 48, up: 1.1, lookStiff: 6 });
    s.onUpdate(dt => this.update(dt));
  }
  _enemy(b) {
    const id = b.who || pick(this.o.enemies); const list = (this.pool[id] ||= []); let e = list.find(e => !e.busy);
    if (!e) { e = { c: this.s.char(id, {}), busy: false }; list.push(e); }
    e.busy = true; e.c.root.visible = true; e.c.tumble(0, 0, 0); e.c.spinAng.set(0, 0, 0); return e;
  }
  update(dt) {
    const s = this.s, o = this.o, inp = s.input, ch = this.c; if (!s.started) { return; }
    if (this.dead) return; this.t += dt;
    if (o.travel) { this.pos.x += o.travel * dt; }
    this.focusP.set(this.pos.x, this.pos.y, this.pos.z); if (o.view === 'side') { s.cam.fpos.x = damp(s.cam.fpos.x, this.pos.x + (o.camLead ?? 0), 3, dt); }
    // spawn attackers ahead of their beat
    for (const b of this.beats) {
      if (b.sp || b.t - this.t > o.look) continue; b.sp = true; if (o.spawn && o.spawn(b, this) === true) continue;
      const side = b.dir === 'L' ? -1 : b.dir === 'R' ? 1 : (b.side ?? (Math.random() < 0.5 ? -1 : 1)); b.side = side; const e = b.e = this._enemy(b);
      e.side = side; e.x0 = this.pos.x + side * (o.reach + 7.5) + o.travel * (b.t - this.t); e.c.root.position.set(e.x0, this.pos.y, this.pos.z + rnd(-0.25, 0.25)); e.c.heading = side > 0 ? Math.PI / 2 : -Math.PI / 2; e.c.setCycle('run', 15, 1); e.state = 'in'; e.beat = b; this.active.push(e);
    }
    // enemies
    for (let i = this.active.length - 1; i >= 0; i--) {
      const e = this.active[i], b = e.beat, r = e.c.root.position;
      if (e.state === 'in') { const k = clamp(1 - (b.t - this.t) / o.look); const tx = this.pos.x + e.side * o.reach; r.x = e.x0 + (tx - e.x0) * k; if (b.t - this.t < 0.22) { e.c.setPose(b.dir === 'D' ? 'punchR' : b.dir === 'U' ? 'crouch' : 'punchL', 0.12); } }
      else if (e.state === 'hit') { e.vx *= Math.exp(-2.5 * dt); r.x += e.vx * dt; e.vy -= 20 * dt; r.y += e.vy * dt; if (r.y < this.pos.y) { r.y = this.pos.y; e.vy = 0; e.c.tumble(0, 0, 0); e.c.spinAng.set(0, 0, 0); e.c.setPose('lie', 0.1); if (!e.landed) { e.landed = true; s.fx.dust(r, 4, { a: 0.2 }); s.audio.thud(); } } e.life -= dt; if (e.life <= 0) { e.busy = false; e.landed = false; e.c.root.visible = false; this.active.splice(i, 1); } }
      else if (e.state === 'won') { e.life -= dt; if (e.life <= 0) { e.state = 'hit'; e.vx = e.side * 3; e.vy = 0; e.life = 0.9; e.c.setCycle('run', 12, 0.8); e.c.heading = e.side > 0 ? -Math.PI / 2 : Math.PI / 2; } }
    }
    // input
    let pressed = null; for (const d in KEY) if (inp.hit(KEY[d])) pressed = d;
    const nb = this.beats.find(b => !b.res && Math.abs(b.t - this.t) <= o.good + 0.1);
    if (pressed) {
      if (nb && nb.dir === pressed && Math.abs(nb.t - this.t) <= o.good) this._success(nb, Math.abs(nb.t - this.t) <= o.perfect);
      else if (nb && Math.abs(nb.t - this.t) <= o.good) this._miss(nb, 'WRONG MOVE');
      else { this._act(pressed, 1); this.combo = 0; s.audio.whoosh(0.5); }
    }
    for (const b of this.beats) if (!b.res && this.t - b.t > o.good) this._miss(b, 'TOO SLOW');
    if (this.poseT > 0) { this.poseT -= dt; if (this.poseT <= 0) ch.setCycle('guard', 1); }
    this._lane();
    s.hud.meter('hp', 'Health', this.hp / o.hp, { color: this.hp <= 1 ? '#e23b2e' : '#58d68d' }); s.hud.readout('combo', 'Combo', this.combo, this.combo >= 5 ? 'ok' : '');
    if (!this.done && this.beats.every(b => b.res) && this.t > (this.beats.at(-1)?.t ?? 0) + 0.9) { this.done = true; this.lane.style.display = 'none'; this.onDone?.(); }
  }
  _act(dir, side) {
    const ch = this.c, s = this.s; if (dir === 'L' || dir === 'R') { const sd = dir === 'L' ? -1 : 1; this.face = sd; ch.heading = sd > 0 ? -Math.PI / 2 : Math.PI / 2; ch.setPose(pick(['punchR', 'punchL', 'kick']), 0.06); }
    else if (dir === 'U') { ch.heading = side > 0 ? -Math.PI / 2 : Math.PI / 2; ch.setPose('highkick', 0.06); } else if (dir === 'D') ch.setPose('duck', 0.06); else ch.setPose('block', 0.06);
    this.poseT = 0.36;
  }
  _success(b, perfect) {
    const s = this.s, e = b.e; b.res = perfect ? 'perfect' : 'good'; this.hits++; if (perfect) this.perfects++; this.combo++; this.maxCombo = Math.max(this.maxCombo, this.combo);
    this._act(b.dir, b.side ?? 1); s.audio.punch(); s.engine.addShake(perfect ? 0.5 : 0.3); if (perfect) s.slowmo(0.35, 0.12);
    s.msg(perfect ? 'PERFECT' : 'GOOD', 'small');
    if (this.o.onHit && this.o.onHit(b, perfect, this) === true) return;
    if (e) { const r = e.c.root.position; e.state = 'hit'; e.vx = e.side * (b.dir === 'D' ? 2 : rnd(6, 10)); e.vy = b.dir === 'D' ? 0 : rnd(3, 6); e.life = 2.2; e.c.setCycle('flail', 1); e.c.tumble(-e.side * 0, 0, e.side * rnd(3, 6)); s.fx.sparks(V3(r.x, r.y + 1.3, r.z), 6, { speed: 4, color: [1, 1, 0.8] }); if (b.dir === 'D') { e.c.tumble(0, 0, 0); e.c.setPose('punchR', 0.1); e.state = 'won'; e.life = 0.35; } }
  }
  _miss(b, why) {
    const s = this.s; b.res = 'miss'; this.misses++; this.combo = 0; this.hp--; s.audio.punch(); s.audio.bad(); s.engine.addShake(0.9); s.engine.hurt(0.5); s.msg(why, 'bad'); this.c.setPose('hit', 0.06); this.poseT = 0.45;
    if (this.o.onMiss && this.o.onMiss(b, this) === true) return;
    if (b.e) { b.e.state = 'won'; b.e.life = 0.5; }
    if (this.hp <= 0 && !this.dead) { this.dead = true; this.c.setPose('lie', 0.25); this.lane.style.display = 'none'; s.fail(this.o.failMsg || 'Took one on the chin', { injury: this.o.injury ?? 0.4 }); }
  }
  _lane() {
    const L = this.lane, o = this.o; L.style.display = 'block'; const W = 640;
    for (const b of this.beats) {
      const dt = b.t - this.t; if (dt > o.look || dt < -0.5) { if (b.el) { b.el.remove(); b.el = null; } continue; }
      if (!b.el) { b.el = document.createElement('div'); b.el.className = 'bt'; b.el.textContent = GLYPH[b.dir]; L.appendChild(b.el); }
      b.el.style.left = (W / 2 + dt / o.look * (W / 2)) + 'px'; if (b.res) b.el.className = 'bt ' + (b.res === 'miss' ? 'miss' : 'ok'); b.el.style.opacity = dt < 0 ? Math.max(0, 1 + dt * 2.5) : 1;
    }
  }
  score() { const n = this.beats.length || 1; return { acc: (this.perfects + (this.hits - this.perfects) * 0.65) / n, combo: this.maxCombo / n, hp: this.hp / this.o.hp }; }
}
// helper to author beat charts: pattern string like "L R . U D LR" at a bpm
export function chart(str, { bpm = 100, start = 1.5, sub = 2 } = {}) {
  const step = 60 / bpm / sub, out = []; let t = start;
  for (const tok of str.trim().split(/\s+/)) { if (tok !== '.') for (const ch of tok) if (GLYPH[ch]) out.push({ t, dir: ch }); t += step; }
  return out;
}
