// Fully procedural WebAudio: engines, wind, skids, impacts, explosions, slate clap, stings and a tension-music sequencer.
export class Audio {
  constructor() { this.ctx = null; this.loops = {}; this.muted = localStorage.getItem('ss_mute') === '1'; }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : 0.8;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 5;
    this.master.connect(comp); comp.connect(c.destination);
    this.sfx = c.createGain(); this.sfx.connect(this.master);
    this.mus = c.createGain(); this.mus.gain.value = 0.5; this.mus.connect(this.master);
    const n = c.sampleRate * 2, b = this.noiseBuf = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
  }
  toggleMute() { this.muted = !this.muted; localStorage.setItem('ss_mute', this.muted ? '1' : '0'); if (this.master) this.master.gain.value = this.muted ? 0 : 0.8; return this.muted; }
  get t() { return this.ctx.currentTime; }
  _noise(dur, { f = 1000, q = 1, type = 'lowpass', g = 0.5, f2, attack = 0.002, when = 0 } = {}) {
    if (!this.ctx) return; const c = this.ctx, t = this.t + when;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true;
    const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur); fl.Q.value = q;
    const gn = c.createGain(); gn.gain.setValueAtTime(0, t); gn.gain.linearRampToValueAtTime(g, t + attack); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl); fl.connect(gn); gn.connect(this.sfx); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  _tone(dur, { f = 440, f2, type = 'sine', g = 0.3, attack = 0.005, when = 0, dest } = {}) {
    if (!this.ctx) return; const c = this.ctx, t = this.t + when;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(1, f2), t + dur);
    const gn = c.createGain(); gn.gain.setValueAtTime(0, t); gn.gain.linearRampToValueAtTime(g, t + attack); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(gn); gn.connect(dest || this.sfx); o.start(t); o.stop(t + dur + 0.05);
  }
  // ---- one shots
  impact(p = 1) { this._noise(0.25 + 0.25 * p, { f: 900 + 1400 * p, f2: 120, g: 0.5 * p + 0.2 }); this._tone(0.3, { f: 110, f2: 38, g: 0.55 * p + 0.15 }); }
  crash() { this.impact(1.2); this._noise(0.9, { f: 4200, f2: 700, type: 'bandpass', q: 0.7, g: 0.5 }); for (let i = 0; i < 5; i++) this._tone(0.12, { f: 1800 + Math.random() * 3000, type: 'triangle', g: 0.08, when: 0.05 + i * 0.07 }); }
  glass() { this._noise(0.5, { f: 6500, type: 'highpass', g: 0.45 }); for (let i = 0; i < 9; i++) this._tone(0.15 + Math.random() * 0.2, { f: 2200 + Math.random() * 5000, type: 'sine', g: 0.07, when: Math.random() * 0.3 }); }
  explosion(p = 1) { this._noise(1.6 * p, { f: 1800, f2: 60, g: 0.95 }); this._tone(1.1 * p, { f: 90, f2: 22, g: 0.9 }); this._noise(2.5 * p, { f: 300, f2: 50, g: 0.5, when: 0.1 }); }
  thud() { this._tone(0.2, { f: 85, f2: 40, g: 0.5 }); this._noise(0.1, { f: 500, g: 0.25 }); }
  punch() { this._noise(0.09, { f: 1500, f2: 300, g: 0.6 }); this._tone(0.12, { f: 160, f2: 60, g: 0.5 }); }
  whoosh(p = 1) { this._noise(0.35, { f: 500, f2: 2600 * p, type: 'bandpass', q: 1.4, g: 0.3, attack: 0.12 }); }
  splash() { this._noise(1.0, { f: 3500, f2: 500, type: 'bandpass', q: 0.5, g: 0.6, attack: 0.02 }); this._tone(0.35, { f: 140, f2: 50, g: 0.4 }); }
  clap() { this._noise(0.07, { f: 2600, type: 'bandpass', q: 0.8, g: 1.0 }); this._tone(0.05, { f: 900, f2: 300, type: 'square', g: 0.3 }); }
  click() { this._tone(0.04, { f: 880, type: 'square', g: 0.08 }); }
  blip(f = 660) { this._tone(0.09, { f, type: 'triangle', g: 0.18 }); }
  good() { this._tone(0.1, { f: 660, type: 'triangle', g: 0.2 }); this._tone(0.16, { f: 990, type: 'triangle', g: 0.2, when: 0.08 }); }
  bad() { this._tone(0.25, { f: 180, f2: 90, type: 'sawtooth', g: 0.2 }); }
  cash() { for (let i = 0; i < 4; i++) this._tone(0.12, { f: 1320 + i * 220, type: 'square', g: 0.07, when: i * 0.06 }); }
  thunder() { this._noise(2.8, { f: 900, f2: 50, g: 0.9, attack: 0.03 }); this._tone(1.8, { f: 60, f2: 25, g: 0.6 }); }
  gun() { this._noise(0.18, { f: 3000, f2: 300, g: 0.7 }); this._tone(0.1, { f: 200, f2: 50, g: 0.5 }); }
  tick() { this._tone(0.03, { f: 1500, type: 'square', g: 0.12 }); }
  horn(f = 300) { this._tone(0.7, { f, type: 'sawtooth', g: 0.18 }); this._tone(0.7, { f: f * 1.26, type: 'sawtooth', g: 0.14 }); }
  bell() { this._tone(1.5, { f: 620, type: 'sine', g: 0.3 }); this._tone(1.2, { f: 1243, type: 'sine', g: 0.12 }); }
  megaphone() { for (let i = 0; i < 3; i++) this._tone(0.07, { f: 420 + i * 60, type: 'sawtooth', g: 0.12, when: i * 0.08 }); }
  fanfare(ok = true) {
    const n = ok ? [392, 523, 659, 784, 1047] : [330, 294, 262, 220];
    n.forEach((f, i) => { this._tone(ok ? 0.5 : 0.6, { f, type: 'sawtooth', g: 0.1, when: i * (ok ? 0.11 : 0.22), dest: this.mus }); this._tone(0.5, { f: f / 2, type: 'triangle', g: 0.14, when: i * (ok ? 0.11 : 0.22), dest: this.mus }); });
  }
  // ---- sustained loops with live params
  loop(name, kind) {
    if (!this.ctx) return null; if (this.loops[name]) return this.loops[name];
    const c = this.ctx, g = c.createGain(); g.gain.value = 0; g.connect(this.sfx); const L = { g, nodes: [] };
    if (kind === 'engine') {
      const o1 = c.createOscillator(), o2 = c.createOscillator(), f = c.createBiquadFilter(), sh = c.createWaveShaper();
      o1.type = 'sawtooth'; o2.type = 'square'; f.type = 'lowpass'; f.frequency.value = 600; f.Q.value = 2;
      const curve = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 3); } sh.curve = curve;
      const g2 = c.createGain(); g2.gain.value = 0.5; o1.connect(sh); o2.connect(g2); g2.connect(sh); sh.connect(f); f.connect(g); o1.start(); o2.start();
      L.nodes = [o1, o2]; L.set = (rpm, vol) => { const t = this.t, fr = 38 + rpm * 150; o1.frequency.setTargetAtTime(fr, t, 0.05); o2.frequency.setTargetAtTime(fr * 0.502, t, 0.05); f.frequency.setTargetAtTime(350 + rpm * 2600, t, 0.08); g.gain.setTargetAtTime(vol * 0.22, t, 0.08); };
    } else if (kind === 'jet' || kind === 'wind' || kind === 'skid' || kind === 'rotor' || kind === 'water' || kind === 'rumble' || kind === 'rain') {
      const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true; const f = c.createBiquadFilter();
      f.type = kind === 'skid' ? 'bandpass' : kind === 'rumble' ? 'lowpass' : kind === 'rain' ? 'highpass' : 'bandpass';
      f.Q.value = kind === 'skid' ? 6 : 0.7; f.frequency.value = { jet: 1400, wind: 500, skid: 1900, rotor: 240, water: 900, rumble: 90, rain: 3000 }[kind];
      s.connect(f); let out = f;
      if (kind === 'rotor') { const lfo = c.createOscillator(), lg = c.createGain(), am = c.createGain(); lfo.type = 'square'; lfo.frequency.value = 13; lg.gain.value = 0.5; am.gain.value = 0.5; lfo.connect(lg); lg.connect(am.gain); f.connect(am); out = am; lfo.start(); L.nodes.push(lfo); }
      out.connect(g); s.start(); L.nodes.push(s);
      L.set = (p, vol) => { const t = this.t, base = { jet: 900, wind: 250, skid: 1700, rotor: 200, water: 600, rumble: 60, rain: 2500 }[kind]; f.frequency.setTargetAtTime(base * (1 + p * 1.8), t, 0.1); g.gain.setTargetAtTime(vol, t, 0.1); };
    }
    this.loops[name] = L; return L;
  }
  set(name, kind, p, vol) { const L = this.loop(name, kind); if (L) L.set(p, vol); }
  stopLoops() { for (const k in this.loops) { const L = this.loops[k]; try { L.g.gain.setTargetAtTime(0, this.t, 0.05); L.nodes.forEach(n => n.stop(this.t + 0.3)); } catch { } } this.loops = {}; }
  // ---- music: simple step sequencer; style picks scale/tempo/timbre
  music(style = 'tension') {
    this.stopMusic(); if (!this.ctx) return;
    const S = {
      tension: { bpm: 126, bass: [0, 0, 3, 0, 5, 0, 3, -2], root: 55, lead: [12, null, 15, null, 19, 15, null, 14], wave: 'sawtooth' },
      spy: { bpm: 138, bass: [0, 0, 7, 0, 8, 8, 7, 0], root: 49, lead: [12, 14, 15, null, 14, null, 12, null], wave: 'square' },
      chase: { bpm: 152, bass: [0, 0, 0, 7, 0, 0, 10, 7], root: 58, lead: [null, 12, null, 15, null, 17, 15, 12], wave: 'sawtooth' },
      western: { bpm: 104, bass: [0, 7, 0, 7, 5, 7, 0, 7], root: 62, lead: [12, null, 16, 19, null, 16, 12, null], wave: 'triangle' },
      silent: { bpm: 176, bass: [0, 7, 4, 7, 0, 7, 5, 7], root: 98, lead: [12, 16, 19, 16, 17, 21, 19, 16], wave: 'triangle' },
      kungfu: { bpm: 118, bass: [0, 0, 5, 0, 7, 0, 5, 3], root: 55, lead: [12, 15, 17, null, 19, 17, 15, null], wave: 'square' },
      synth: { bpm: 120, bass: [0, 0, 0, 0, 3, 3, 5, 5], root: 46, lead: [12, 19, 15, 19, 12, 19, 17, 19], wave: 'sawtooth' },
      epic: { bpm: 96, bass: [0, 0, 0, 0, -4, -4, -2, -2], root: 49, lead: [12, null, null, 15, 14, null, 10, null], wave: 'sawtooth' },
      menu: { bpm: 92, bass: [0, null, 7, null, 5, null, 3, null], root: 55, lead: [null, 15, null, 19, null, 17, null, 12], wave: 'triangle' },
    }[style] || null;
    if (!S) return;
    const step = 60 / S.bpm / 2; let i = 0, next = this.t + 0.1;
    const f = n => S.root * Math.pow(2, n / 12);
    this._mus = setInterval(() => {
      if (!this.ctx) return;
      while (next < this.t + 0.25) {
        const w = next - this.t, k = i % 8, bar = Math.floor(i / 8) % 4, tr = bar === 3 ? 5 : bar === 2 ? 3 : 0;
        const b = S.bass[k]; if (b != null) this._tone(step * 0.9, { f: f(b + tr), type: S.wave, g: 0.13, when: w, dest: this.mus });
        const l = S.lead[k]; if (l != null && Math.floor(i / 16) % 2 === 1) this._tone(step * 1.4, { f: f(l + tr) * 2, type: 'triangle', g: 0.07, when: w, dest: this.mus });
        if (k % 2 === 0 && style !== 'menu') this._noiseTo(0.04, 7000, 0.05, w); if (k % 4 === 0 && style !== 'menu' && style !== 'silent') this._tone(0.12, { f: 120, f2: 40, g: 0.22, when: w, dest: this.mus });
        i++; next += step;
      }
    }, 60);
  }
  _noiseTo(dur, f, g, when) { const c = this.ctx, t = this.t + when, s = c.createBufferSource(); s.buffer = this.noiseBuf; const fl = c.createBiquadFilter(); fl.type = 'highpass'; fl.frequency.value = f; const gn = c.createGain(); gn.gain.setValueAtTime(g, t); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur); s.connect(fl); fl.connect(gn); gn.connect(this.mus); s.start(t, Math.random()); s.stop(t + dur + 0.02); }
  stopMusic() { clearInterval(this._mus); this._mus = null; }
}
