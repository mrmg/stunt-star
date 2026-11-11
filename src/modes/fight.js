import * as THREE from 'three';
import { clamp, damp, V3, rnd, pick } from '../world/stage.js';

// Choreographed fight: beats scroll into the hit box; press the matching key on the beat.
//  L / R = strike that side (A / D)   U = jump-kick (W)   D = duck (S)   B = block (SPACE)
// v2 leeway: 8 health; a missed beat costs the combo, score and 1 health. Running out of health ends the fight early
// (a low-score take, not a failure). Each lane marker shows its key and colour; the next move is spelt out under the lane.
const GLYPH = { L: '←', R: '→', U: '↑', D: '↓', B: '●' }, KEY = { L: 'left', R: 'right', U: 'up', D: 'down', B: 'a' };
const KEYNAME = { L: 'A', R: 'D', U: 'W', D: 'S', B: 'SPACE' }, KCOL = { L: '#4fb4ff', R: '#ff9a3c', U: '#7dff6a', D: '#d68cff', B: '#ffe14a' };
export const MOVE = { L: 'strike left', R: 'strike right', U: 'jump kick', D: 'duck', B: 'block' };
export class Fight {
  constructor(s, o = {}) {
    this.s = s; this.o = o = { hp: 8, perfect: 0.085, good: 0.2, look: 1.8, enemies: ['ch_goon'], travel: 0, view: 'side', reach: 1.15, backZ: -0.65, names: MOVE, autoMoments: true, ...o };
    this.c = s.char(o.char || 'ch_kungfu', { x: o.x || 0, y: o.y || 0, z: o.z || 0 }); this.pos = this.c.root.position; this.face = 1; this.c.heading = -Math.PI / 2; this.c.setCycle('guard', 1);
    this.beats = (o.beats || []).map(b => ({ ...b })).sort((a, b) => a.t - b.t); this.i = 0; this.t = -(o.lead ?? 1.2); this.hp = o.hp; this.combo = 0; this.maxCombo = 0; this.hits = 0; this.perfects = 0; this.misses = 0; this.late = 0; this.wrong = 0; this.whiffs = 0; this.dead = false; this.done = false; this.poseT = 0; this.pool = {}; this.active = [];
    this.lane = s.hud.lane; this.focusP = V3().copy(this.pos); s.focus = this.focusP;
    if (o.view === 'side') s.cam.fixed(V3(this.pos.x, this.pos.y + 1.7, this.pos.z + (o.camDist ?? 7.5)), () => ({ pos: this.focusP, heading: 0 }), { fov: o.fov ?? 48, up: 1.1, lookStiff: 6 });
    s.onUpdate(dt => this.update(dt)); s.subject ??= this.c.root;
  }
  _enemy(b) {
    const id = b.who || pick(this.o.enemies); const list = (this.pool[id] ||= []); let e = list.find(e => !e.busy);
    if (!e) { e = { c: this.s.char(id, {}), busy: false }; list.push(e); }
    e.busy = true; e.c.root.visible = true; e.c.tumble(0, 0, 0); e.c.spinAng.set(0, 0, 0); return e;
  }
  update(dt) {
    const s = this.s, o = this.o, inp = s.input, ch = this.c; if (!s.started) { return; }
    this.t += dt;
    if (o.travel && !this.dead) { this.pos.x += o.travel * dt; }
    this.focusP.set(this.pos.x, this.pos.y, this.pos.z); if (o.view === 'side') { s.cam.fpos.x = damp(s.cam.fpos.x, this.pos.x + (o.camLead ?? 0), 3, dt); }
    // spawn attackers ahead of their beat
    for (const b of this.beats) {
      if (b.sp || this.dead || b.t - this.t > o.look) continue; b.sp = true; if (o.spawn && o.spawn(b, this) === true) continue;
      const side = b.dir === 'L' ? -1 : b.dir === 'R' ? 1 : (b.side ?? (Math.random() < 0.5 ? -1 : 1)); b.side = side; const e = b.e = this._enemy(b);
      e.side = side; e.x0 = this.pos.x + side * (o.reach + 7.5) + o.travel * (b.t - this.t); e.c.root.position.set(e.x0, this.pos.y, this.pos.z + rnd(-0.12, 0.12)); e.hop = 0; e.c.heading = side > 0 ? Math.PI / 2 : -Math.PI / 2; e.c.setCycle('run', 15, 1); e.state = 'in'; e.beat = b; this.active.push(e);
    }
    // enemies
    for (let i = this.active.length - 1; i >= 0; i--) {
      const e = this.active[i], b = e.beat, r = e.c.root.position;
      if (e.state === 'in') { const k = clamp(1 - (b.t - this.t) / o.look); const tx = this.pos.x + e.side * o.reach; r.x = e.x0 + (tx - e.x0) * k; if (b.t - this.t < 0.22) { e.c.setPose(b.dir === 'D' ? 'punchR' : b.dir === 'U' ? 'crouch' : 'punchL', 0.12); }
        // vault anything lying on the runner's line instead of running through it
        let over = false; for (const q of this.active) if (q !== e && q.state !== 'in' && Math.abs(q.c.root.position.x - r.x) < 0.9 && Math.abs(q.c.root.position.z - r.z) < 0.45) over = true;
        e.hop = over ? Math.min(1, e.hop + dt * 6) : Math.max(0, e.hop - dt * 5); r.y = this.pos.y + Math.sin(e.hop * Math.PI / 2) * 0.55; }
      else if (e.state === 'hit') { e.vx *= Math.exp(-2.5 * dt); r.z = damp(r.z, this.pos.z + o.backZ, 7, dt);
        for (const q of this.active) if (q.state === 'in' && q.side === e.side && Math.abs(q.c.root.position.x - (r.x + e.vx * dt)) < 0.55 && Math.abs(q.c.root.position.z - r.z) < 0.45 && Math.sign(q.c.root.position.x - r.x) === Math.sign(e.vx)) e.vx *= -0.25; // bounce off, never through
        r.x += e.vx * dt; e.vy -= 20 * dt; r.y += e.vy * dt; if (r.y < this.pos.y) { r.y = this.pos.y; e.vy = 0; e.c.tumble(0, 0, 0); e.c.spinAng.set(0, 0, 0); e.c.setPose('lie', 0.1); if (!e.landed) { e.landed = true; s.fx.dust(r, 4, { a: 0.2 }); s.audio.thud(); } } e.life -= dt; if (e.life <= 0) { e.busy = false; e.landed = false; e.c.root.visible = false; this.active.splice(i, 1); } }
      else if (e.state === 'won') { e.life -= dt; if (e.life <= 0) { e.state = 'hit'; e.vx = e.side * 3; e.vy = 0; e.life = 0.9; e.c.setCycle('run', 12, 0.8); e.c.heading = e.side > 0 ? -Math.PI / 2 : Math.PI / 2; } }
    }
    // input
    let pressed = null; for (const d in KEY) if (inp.hit(KEY[d])) pressed = d;
    const nb = this.beats.find(b => !b.res && Math.abs(b.t - this.t) <= o.good + 0.1);
    if (pressed && !this.dead) {
      if (nb && nb.dir === pressed && Math.abs(nb.t - this.t) <= o.good) this._success(nb, Math.abs(nb.t - this.t) <= o.perfect);
      else if (nb && Math.abs(nb.t - this.t) <= o.good) { this.wrong++; this._miss(nb, `WRONG KEY — ${KEYNAME[nb.dir]}`); }
      else { this._act(pressed, 1); if (this.combo) s.msg('TOO EARLY', 'small'); this.combo = 0; this.whiffs++; s.audio.whoosh(0.5); }
    }
    for (const b of this.beats) if (!b.res && this.t - b.t > o.good) { this.late++; this._miss(b, 'TOO SLOW'); if (this.dead) break; }
    if (this.dead) return;
    const nx = this.beats.find(b => !b.res); s.hud.prompt(nx && nx.t - this.t < o.look ? `next: <kbd>${KEYNAME[nx.dir]}</kbd> ${o.names[nx.dir]}` : '');
    if (this.poseT > 0) { this.poseT -= dt; if (this.poseT <= 0) { ch.setCycle('guard', 1); this.lunge = 0; } }
    // lunge + track the next attacker with the head, so strikes land on a person instead of in space
    const lk = this.poseT > 0 ? Math.sin((1 - this.poseT / 0.36) * Math.PI) : 0; ch.lean.set(0.1 * lk, 0, (this.lunge || 0) * 0.1 * lk);
    const inc = this.active.find(e => e.state === 'in'); if (inc) (ch.look ||= V3()).copy(inc.c.root.position).setY(inc.c.root.position.y + 1.5);
    this._lane();
    s.hud.meter('hp', 'Health', this.hp / o.hp, { color: this.hp <= 1 ? '#e23b2e' : '#58d68d' }); s.hud.readout('combo', 'Combo', this.combo, this.combo >= 5 ? 'ok' : '');
    if (!this.done && this.beats.every(b => b.res) && this.t > (this.beats.at(-1)?.t ?? 0) + 0.9) this._end();
  }
  // stage time of a beat (fight time runs from -lead at ACTION)
  st(b) { return this.s.t - (this.t - b.t); }
  _end() {
    if (this.done) return; this.done = true; const s = this.s; this.lane.style.display = 'none'; s.hud.prompt(''); this._legend?.remove(); this._legend = null;
    if (this.late >= 2) s.flub(`Late on ${this.late} moves`, { penalty: 0.04, quiet: true, advice: 'Press as the marker slides INTO the white box — not once it has passed. Watch the lane, not the fighters.' });
    if (this.wrong >= 2) s.flub(`Wrong key ${this.wrong} times`, { penalty: 0.04, quiet: true, advice: 'Read the letter on each marker before it arrives: A strike left, D strike right, W jump kick, S duck, SPACE block.' });
    if (this.whiffs >= 3) s.flub('Swinging at nothing', { penalty: 0.04, quiet: true, advice: 'Do not mash keys between moves — every early press breaks your combo. Wait for the marker to reach the box.' });
    this.onDone?.();
  }
  _act(dir, side) {
    const ch = this.c, s = this.s; if (dir === 'L' || dir === 'R') { const sd = dir === 'L' ? -1 : 1; this.face = sd; ch.heading = sd > 0 ? -Math.PI / 2 : Math.PI / 2; ch.setPose(pick(['punchR', 'punchL', 'kick']), 0.06); }
    else if (dir === 'U') { ch.heading = side > 0 ? -Math.PI / 2 : Math.PI / 2; ch.setPose('highkick', 0.06); } else if (dir === 'D') ch.setPose('duck', 0.06); else ch.setPose('block', 0.06);
    this.poseT = 0.36; this.lunge = dir === 'D' || dir === 'B' ? 0 : (dir === 'L' ? -1 : dir === 'R' ? 1 : (side || 1)); // weight drives through the strike, then settles back to guard
  }
  _success(b, perfect) {
    const s = this.s, e = b.e; b.res = perfect ? 'perfect' : 'good'; this.hits++; if (perfect) this.perfects++; this.combo++; this.maxCombo = Math.max(this.maxCombo, this.combo);
    this._act(b.dir, b.side ?? 1); s.audio.punch(); s.engine.addShake(perfect ? 0.5 : 0.3); if (perfect) s.slowmo(0.35, 0.12);
    s.msg(perfect ? 'PERFECT' : 'GOOD', 'small');
    if (this.o.autoMoments) { const last = this.beats.at(-1) === b, i = this.beats.indexOf(b);
      if (last) s.moment('The last flurry', { t0: this.st(this.beats[Math.max(0, i - 4)]) - 0.4, t1: s.t + 1.1, w: 1.6 });
      else if (this.combo >= 6 && this.combo % 6 === 0) s.moment(`${this.combo}-hit combo`, { t0: this.st(this.beats[Math.max(0, i - 5)]) - 0.3, t1: s.t + 0.7, w: Math.min(1.5, 0.7 + this.combo * 0.04) }); }
    if (this.o.onHit && this.o.onHit(b, perfect, this) === true) return;
    if (e) { const r = e.c.root.position; e.state = 'hit'; e.vx = e.side * (b.dir === 'D' ? 2 : rnd(6, 10)); e.vy = b.dir === 'D' ? 0 : rnd(3, 6); e.life = 2.2; e.c.setCycle('flail', 1); e.c.tumble(-e.side * 0, 0, e.side * rnd(3, 6)); s.fx.sparks(V3(r.x, r.y + 1.3, r.z), 6, { speed: 4, color: [1, 1, 0.8] }); if (b.dir === 'D') { e.c.tumble(0, 0, 0); e.c.setPose('punchR', 0.1); e.state = 'won'; e.life = 0.35; } }
  }
  _miss(b, why) {
    const s = this.s; b.res = 'miss'; this.misses++; this.combo = 0; this.hp--; s.audio.punch(); s.audio.bad(); s.engine.addShake(0.9); s.engine.hurt(0.5); s.msg(why, 'bad'); this.c.setPose('hit', 0.06); this.poseT = 0.45;
    if (this.o.onMiss && this.o.onMiss(b, this) === true) return;
    if (b.e) { b.e.state = 'won'; b.e.life = 0.5; }
    if (this.hp <= 0 && !this.dead) this._ko();
  }
  // out of health: the director calls it early — the take keeps what you landed (low score), it is not a failure
  _ko() {
    const s = this.s; this.dead = true; this.c.setPose('lie', 0.25); s.engine.hurt(0.7); s.audio.thud?.(1);
    for (const b of this.beats) if (!b.res) { b.res = 'miss'; this.misses++; } this._lane(); this.lane.style.display = 'none'; s.hud.prompt('');
    s.flub(this.o.failMsg || 'Knocked down — the director called it early', { penalty: 0.15, advice: this.o.koAdvice || 'You ran out of health. Fewer misses beats more presses: watch the key letter on each marker and press once, as it enters the white box.' });
    s.after(1.6, () => this._end());
  }
  _lane() {
    const L = this.lane, o = this.o; L.style.display = 'block'; const W = 640;
    if (!this._legend) { const d = this._legend = document.createElement('div'); d.style.cssText = 'position:absolute;left:0;right:0;top:80px;text-align:center;font:600 13px/18px sans-serif;color:#fff;text-shadow:0 1px 3px #000;white-space:nowrap';
      d.innerHTML = Object.keys(GLYPH).map(k => `<span style="margin:0 7px"><b style="color:${KCOL[k]}">${GLYPH[k]} ${KEYNAME[k]}</b> ${o.names[k]}</span>`).join(''); L.appendChild(d); }
    for (const b of this.beats) {
      const dt = b.t - this.t; if (dt > o.look || dt < -0.5) { if (b.el) { b.el.remove(); b.el = null; } continue; }
      if (!b.el) { b.el = document.createElement('div'); b.el.className = 'bt'; b.el.style.borderColor = b.el.style.color = KCOL[b.dir]; b.el.innerHTML = `<div style="line-height:40px">${GLYPH[b.dir]}</div><div style="font:700 ${b.dir === 'B' ? 11 : 15}px/14px sans-serif;color:#fff">${KEYNAME[b.dir]}</div>`; L.appendChild(b.el); }
      b.el.style.left = (W / 2 + dt / o.look * (W / 2)) + 'px'; if (b.res && !b.elRes) { b.elRes = 1; b.el.className = 'bt ' + (b.res === 'miss' ? 'miss' : 'ok'); b.el.style.color = b.el.style.borderColor = ''; } b.el.style.opacity = dt < 0 ? Math.max(0, 1 + dt * 2.5) : 1;
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
