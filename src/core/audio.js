// Fully procedural WebAudio: engines, wind, skids, impacts, explosions, slate clap, stings, a director's voice
// (browser speech synthesis), location reverb, ambience beds and a layered music sequencer with drums.
const LS = (k, d) => { try { return localStorage.getItem(k) ?? d; } catch { return d; } };
export class Audio {
  constructor() { this.ctx = null; this.loops = {}; this.muted = LS('ss_mute', '0') === '1'; this.voice = LS('ss_voice', '1') === '1'; this.intensity = 0.4; }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : 0.85;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -12; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
    this.lp = c.createBiquadFilter(); this.lp.type = 'lowpass'; this.lp.frequency.value = 20000; this.lp.Q.value = 0.5; // slow-motion filter
    this.master.connect(this.lp); this.lp.connect(comp); comp.connect(c.destination);
    this.sfx = c.createGain(); this.sfx.connect(this.master);
    this.mus = c.createGain(); this.mus.gain.value = 0.42; this.mus.connect(this.master);
    this.amb = c.createGain(); this.amb.gain.value = 0.5; this.amb.connect(this.master);
    // reverb send (generated impulse response)
    this.verb = c.createConvolver(); this.verbSend = c.createGain(); this.verbSend.gain.value = 0.18; this.sfx.connect(this.verbSend); this.verbSend.connect(this.verb); this.verb.connect(this.master); this._ir(2.2, 2.6);
    const n = c.sampleRate * 2, b = this.noiseBuf = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const bn = this.brownBuf = c.createBuffer(1, n, c.sampleRate), bd = bn.getChannelData(0); let last = 0;
    for (let i = 0; i < n; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; bd[i] = last * 3.5; }
  }
  _ir(sec, decay) { const c = this.ctx, n = Math.floor(c.sampleRate * sec), b = c.createBuffer(2, n, c.sampleRate); for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay); } this.verb.buffer = b; }
  // acoustic space: open | city | indoor | cave | hall
  space(kind = 'open') { if (!this.ctx) return; const P = { open: [0.9, 4, 0.08], city: [1.6, 3, 0.16], indoor: [1.1, 2.5, 0.22], cave: [3.2, 2, 0.4], hall: [2.4, 2.2, 0.3] }[kind] || [1.2, 3, 0.15]; this._ir(P[0], P[1]); this.verbSend.gain.value = this._vs = P[2]; }
  toggleMute() { this.muted = !this.muted; try { localStorage.setItem('ss_mute', this.muted ? '1' : '0'); } catch { } if (this.master) this.master.gain.value = this.muted ? 0 : 0.85; if (this.muted) speechSynthesis?.cancel(); return this.muted; }
  toggleVoice() { this.voice = !this.voice; try { localStorage.setItem('ss_voice', this.voice ? '1' : '0'); } catch { } if (!this.voice) speechSynthesis?.cancel(); return this.voice; }
  // the director, through a megaphone-ish voice
  say(text, { rate = 1.05, pitch = 0.85, interrupt = true } = {}) {
    if (this.muted || !this.voice || !window.speechSynthesis || !text) return;
    try {
      const ss = window.speechSynthesis; if (interrupt) ss.cancel();
      const u = new SpeechSynthesisUtterance(String(text).replace(/<[^>]+>/g, '').slice(0, 220)); u.rate = rate; u.pitch = pitch; u.volume = 0.9;
      const vs = ss.getVoices(); this._v ??= vs.find(v => /en-GB/i.test(v.lang) && /male|daniel|arthur|george/i.test(v.name)) || vs.find(v => /en-(US|GB)/i.test(v.lang) && /male|david|alex|fred/i.test(v.name)) || vs.find(v => /^en/i.test(v.lang)) || null;
      if (this._v) u.voice = this._v; ss.speak(u);
    } catch { }
  }
  // 1 = normal, <1 = slow motion (muffled, more reverb)
  slowmo(k = 1) { if (!this.ctx) return; const t = this.t; this.lp.frequency.setTargetAtTime(k >= 0.95 ? 20000 : 700 + k * 3500, t, 0.08); this.verbSend.gain.setTargetAtTime(k >= 0.95 ? (this._vs ?? 0.18) : 0.45, t, 0.1); }
  get t() { return this.ctx.currentTime; }
  _noise(dur, { f = 1000, q = 1, type = 'lowpass', g = 0.5, f2, attack = 0.002, when = 0, dest, brown } = {}) {
    if (!this.ctx) return; const c = this.ctx, t = this.t + when;
    const s = c.createBufferSource(); s.buffer = brown ? this.brownBuf : this.noiseBuf; s.loop = true;
    const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur); fl.Q.value = q;
    const gn = c.createGain(); gn.gain.setValueAtTime(0, t); gn.gain.linearRampToValueAtTime(g, t + attack); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl); fl.connect(gn); gn.connect(dest || this.sfx); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }
  _tone(dur, { f = 440, f2, type = 'sine', g = 0.3, attack = 0.005, when = 0, dest, detune = 0 } = {}) {
    if (!this.ctx) return; const c = this.ctx, t = this.t + when;
    const o = c.createOscillator(); o.type = type; o.detune.value = detune; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(1, f2), t + dur);
    const gn = c.createGain(); gn.gain.setValueAtTime(0, t); gn.gain.linearRampToValueAtTime(g, t + attack); gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(gn); gn.connect(dest || this.sfx); o.start(t); o.stop(t + dur + 0.05);
  }
  // ---- one shots
  impact(p = 1) { this._noise(0.25 + 0.25 * p, { f: 900 + 1400 * p, f2: 120, g: 0.5 * p + 0.2 }); this._tone(0.3, { f: 110, f2: 38, g: 0.55 * p + 0.15 }); this._noise(0.4 * p, { f: 180, g: 0.4 * p, brown: true }); if (p > 0.6) this.metal(p * 0.6); }
  metal(p = 1) { for (let i = 0; i < 4; i++) this._tone(0.25 + Math.random() * 0.4, { f: 300 + Math.random() * 1400, type: 'triangle', g: 0.05 * p, when: Math.random() * 0.12, detune: Math.random() * 30 }); this._noise(0.3, { f: 3200, type: 'bandpass', q: 3, g: 0.2 * p }); }
  crash() { this.impact(1.2); this._noise(0.9, { f: 4200, f2: 700, type: 'bandpass', q: 0.7, g: 0.5 }); for (let i = 0; i < 6; i++) this._tone(0.12, { f: 1800 + Math.random() * 3000, type: 'triangle', g: 0.08, when: 0.05 + i * 0.07 }); this.metal(1.2); }
  glass() { this._noise(0.5, { f: 6500, type: 'highpass', g: 0.45 }); for (let i = 0; i < 12; i++) this._tone(0.15 + Math.random() * 0.25, { f: 2200 + Math.random() * 5000, type: 'sine', g: 0.07, when: Math.random() * 0.35 }); }
  explosion(p = 1) { this._noise(1.6 * p, { f: 1800, f2: 60, g: 0.95 }); this._tone(1.1 * p, { f: 90, f2: 22, g: 0.9 }); this._noise(2.8 * p, { f: 320, f2: 40, g: 0.6, when: 0.08, brown: true }); this._noise(0.12, { f: 5000, type: 'highpass', g: 0.5 }); for (let i = 0; i < 6; i++) this._noise(0.2, { f: 2000, type: 'bandpass', g: 0.15, when: 0.3 + Math.random() * 1.4 }); }
  thud() { this._tone(0.2, { f: 85, f2: 40, g: 0.5 }); this._noise(0.1, { f: 500, g: 0.25 }); }
  punch() { this._noise(0.09, { f: 1500, f2: 300, g: 0.6 }); this._tone(0.12, { f: 160, f2: 60, g: 0.5 }); this._noise(0.06, { f: 6000, type: 'highpass', g: 0.25 }); }
  whoosh(p = 1) { this._noise(0.35 + 0.1 * p, { f: 400, f2: 2600 * p, type: 'bandpass', q: 1.4, g: 0.3, attack: 0.12 }); }
  roar() { this._noise(1.2, { f: 200, f2: 900, type: 'bandpass', q: 1, g: 0.5, attack: 0.2, brown: true }); }
  splash() { this._noise(1.0, { f: 3500, f2: 500, type: 'bandpass', q: 0.5, g: 0.6, attack: 0.02 }); this._tone(0.35, { f: 140, f2: 50, g: 0.4 }); this._noise(1.6, { f: 1200, f2: 300, g: 0.3, when: 0.15, brown: true }); }
  clap() { this._noise(0.07, { f: 2600, type: 'bandpass', q: 0.8, g: 1.0 }); this._tone(0.05, { f: 900, f2: 300, type: 'square', g: 0.3 }); }
  click() { this._tone(0.04, { f: 880, type: 'square', g: 0.08 }); }
  blip(f = 660) { this._tone(0.09, { f, type: 'triangle', g: 0.18 }); }
  good() { this._tone(0.1, { f: 660, type: 'triangle', g: 0.2 }); this._tone(0.16, { f: 990, type: 'triangle', g: 0.2, when: 0.08 }); }
  bad() { this._tone(0.25, { f: 180, f2: 90, type: 'sawtooth', g: 0.16 }); }
  cash() { for (let i = 0; i < 4; i++) this._tone(0.12, { f: 1320 + i * 220, type: 'square', g: 0.07, when: i * 0.06 }); }
  thunder() { this._noise(2.8, { f: 900, f2: 50, g: 0.9, attack: 0.03 }); this._tone(1.8, { f: 60, f2: 25, g: 0.6 }); this._noise(3.5, { f: 200, f2: 40, g: 0.5, when: 0.2, brown: true }); }
  gun() { this._noise(0.18, { f: 3000, f2: 300, g: 0.7 }); this._tone(0.1, { f: 200, f2: 50, g: 0.5 }); this._noise(0.6, { f: 800, f2: 200, g: 0.15, when: 0.05 }); }
  tick() { this._tone(0.03, { f: 1500, type: 'square', g: 0.12 }); }
  horn(f = 300) { this._tone(0.7, { f, type: 'sawtooth', g: 0.18 }); this._tone(0.7, { f: f * 1.26, type: 'sawtooth', g: 0.14 }); }
  bell() { this._tone(1.5, { f: 620, type: 'sine', g: 0.3 }); this._tone(1.2, { f: 1243, type: 'sine', g: 0.12 }); }
  megaphone() { this._noise(0.08, { f: 2200, type: 'bandpass', q: 6, g: 0.25 }); this._tone(0.2, { f: 1760, f2: 1500, type: 'square', g: 0.04, when: 0.02 }); }
  // the crew applauds a wrap
  cheer(p = 1) { for (let i = 0; i < 40 * p; i++) this._noise(0.05, { f: 1500 + Math.random() * 2500, type: 'bandpass', q: 1.5, g: 0.08 + Math.random() * 0.08, when: Math.random() * 2.2 }); this._noise(2.4, { f: 900, type: 'bandpass', q: 0.6, g: 0.12, attack: 0.3 }); }
  // dramatic hit for a key moment (music layer)
  sting() { if (!this.ctx) return; this._tone(2.2, { f: 55, f2: 40, type: 'sawtooth', g: 0.22, dest: this.mus }); this._tone(2.2, { f: 82.4, type: 'sawtooth', g: 0.12, dest: this.mus, detune: 7 }); this._noise(1.4, { f: 120, g: 0.5, dest: this.mus, brown: true }); this._noise(0.9, { f: 8000, f2: 2000, type: 'highpass', g: 0.12, dest: this.mus }); }
  fanfare(ok = true) {
    const n = ok ? [392, 523, 659, 784, 1047] : [330, 294, 262, 220];
    n.forEach((f, i) => { this._tone(ok ? 0.5 : 0.6, { f, type: 'sawtooth', g: 0.09, when: i * (ok ? 0.11 : 0.22), dest: this.mus }); this._tone(0.5, { f: f / 2, type: 'triangle', g: 0.13, when: i * (ok ? 0.11 : 0.22), dest: this.mus }); });
    if (ok) this.cheer(0.8);
  }
  // ---- sustained loops with live params
  loop(name, kind) {
    if (!this.ctx) return null; if (this.loops[name]) return this.loops[name];
    const c = this.ctx, g = c.createGain(); g.gain.value = 0; g.connect(this.sfx); const L = { g, nodes: [] };
    if (kind === 'engine') {
      // two detuned saws + sub + combustion noise, waveshaped, with a lumpy-cam LFO on the amplitude
      const o1 = c.createOscillator(), o2 = c.createOscillator(), sub = c.createOscillator(), f = c.createBiquadFilter(), sh = c.createWaveShaper(), lfo = c.createOscillator(), lg = c.createGain(), am = c.createGain();
      o1.type = 'sawtooth'; o2.type = 'sawtooth'; o2.detune.value = 18; sub.type = 'sine'; f.type = 'lowpass'; f.frequency.value = 600; f.Q.value = 3;
      const curve = new Float32Array(256); for (let i = 0; i < 256; i++) { const x = i / 128 - 1; curve[i] = Math.tanh(x * 3.2); } sh.curve = curve;
      const ns = c.createBufferSource(); ns.buffer = this.noiseBuf; ns.loop = true; const nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 300; nf.Q.value = 2; const ng = c.createGain(); ng.gain.value = 0.25;
      const g2 = c.createGain(); g2.gain.value = 0.55; const gs = c.createGain(); gs.gain.value = 0.6;
      o1.connect(sh); o2.connect(g2); g2.connect(sh); ns.connect(nf); nf.connect(ng); ng.connect(sh); sh.connect(f); sub.connect(gs); gs.connect(am); f.connect(am); am.connect(g);
      lfo.type = 'sine'; lfo.frequency.value = 7; lg.gain.value = 0.18; am.gain.value = 0.82; lfo.connect(lg); lg.connect(am.gain);
      [o1, o2, sub, lfo, ns].forEach(n => n.start()); L.nodes = [o1, o2, sub, lfo, ns];
      L.set = (rpm, vol) => { const t = this.t, fr = 34 + rpm * 150; o1.frequency.setTargetAtTime(fr, t, 0.05); o2.frequency.setTargetAtTime(fr * 0.5, t, 0.05); sub.frequency.setTargetAtTime(fr * 0.5, t, 0.05); lfo.frequency.setTargetAtTime(fr / 6, t, 0.05); nf.frequency.setTargetAtTime(200 + rpm * 900, t, 0.08); f.frequency.setTargetAtTime(320 + rpm * 2800, t, 0.08); g.gain.setTargetAtTime(vol * 0.2, t, 0.08); };
    } else if (kind === 'skid') {
      const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.loop = true; const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 7; f.frequency.value = 1800;
      const sq = c.createOscillator(), sg = c.createGain(), vib = c.createOscillator(), vg = c.createGain(); sq.type = 'sine'; sq.frequency.value = 880; sg.gain.value = 0.18; vib.frequency.value = 23; vg.gain.value = 40; vib.connect(vg); vg.connect(sq.frequency);
      s.connect(f); f.connect(g); sq.connect(sg); sg.connect(g); s.start(); sq.start(); vib.start(); L.nodes = [s, sq, vib];
      L.set = (p, vol) => { const t = this.t; f.frequency.setTargetAtTime(1500 + p * 900, t, 0.1); sq.frequency.setTargetAtTime(780 + p * 260, t, 0.1); g.gain.setTargetAtTime(vol, t, 0.06); };
    } else {
      const s = c.createBufferSource(); s.buffer = (kind === 'rumble' || kind === 'wind') ? this.brownBuf : this.noiseBuf; s.loop = true; const f = c.createBiquadFilter();
      f.type = kind === 'rumble' ? 'lowpass' : kind === 'rain' ? 'highpass' : 'bandpass';
      f.Q.value = 0.7; f.frequency.value = { jet: 1400, wind: 500, rotor: 240, water: 900, rumble: 90, rain: 3000 }[kind] ?? 600;
      s.connect(f); let out = f;
      if (kind === 'rotor') { const lfo = c.createOscillator(), lg = c.createGain(), am = c.createGain(); lfo.type = 'square'; lfo.frequency.value = 13; lg.gain.value = 0.5; am.gain.value = 0.5; lfo.connect(lg); lg.connect(am.gain); f.connect(am); out = am; lfo.start(); L.nodes.push(lfo); }
      if (kind === 'jet') { const w = c.createOscillator(), wg = c.createGain(); w.type = 'sawtooth'; w.frequency.value = 900; wg.gain.value = 0.04; w.connect(wg); wg.connect(g); w.start(); L.nodes.push(w); L.whine = w; }
      out.connect(g); s.start(); L.nodes.push(s);
      L.set = (p, vol) => { const t = this.t, base = { jet: 900, wind: 250, rotor: 200, water: 600, rumble: 60, rain: 2500 }[kind] ?? 500; f.frequency.setTargetAtTime(base * (1 + p * 1.8), t, 0.1); if (L.whine) L.whine.frequency.setTargetAtTime(700 + p * 1500, t, 0.1); g.gain.setTargetAtTime(vol, t, 0.1); };
    }
    this.loops[name] = L; return L;
  }
  set(name, kind, p, vol) { const L = this.loop(name, kind); if (L) L.set(p, vol); }
  stopLoops() { if (!this.ctx) return; for (const k in this.loops) { const L = this.loops[k]; try { L.g.gain.setTargetAtTime(0, this.t, 0.05); L.nodes.forEach(n => n.stop(this.t + 0.3)); } catch { } } this.loops = {}; }
  // ambience bed: city | nature | desert | indoor | crowd | sea | storm
  ambience(kind) {
    if (!this.ctx) return; this.stopAmbience(); if (!kind) return; const c = this.ctx, nodes = [], g = c.createGain(); g.gain.value = 0; g.gain.setTargetAtTime(1, this.t, 1.2); g.connect(this.amb);
    const bed = (f, q, type, v, brown) => { const s = c.createBufferSource(); s.buffer = brown ? this.brownBuf : this.noiseBuf; s.loop = true; const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const gg = c.createGain(); gg.gain.value = v; s.connect(fl); fl.connect(gg); gg.connect(g); s.start(this.t, Math.random()); nodes.push(s); };
    const P = { city: () => { bed(180, 0.7, 'lowpass', 0.35, true); bed(1200, 0.5, 'bandpass', 0.03); }, nature: () => { bed(600, 0.6, 'bandpass', 0.08, true); }, desert: () => { bed(400, 0.8, 'bandpass', 0.2, true); }, indoor: () => { bed(120, 0.7, 'lowpass', 0.12, true); }, crowd: () => { bed(700, 0.8, 'bandpass', 0.18); }, sea: () => { bed(500, 0.5, 'lowpass', 0.4, true); }, storm: () => { bed(300, 0.6, 'lowpass', 0.5, true); bed(3000, 0.5, 'highpass', 0.05); } }[kind];
    P?.(); this._amb = { g, nodes, kind };
    if (kind === 'nature') this._birds = setInterval(() => { if (Math.random() < 0.5) { const f = 2200 + Math.random() * 1800; for (let i = 0; i < 3; i++) this._tone(0.08, { f: f * (1 + i * 0.08), f2: f * 1.3, g: 0.025, when: i * 0.11, dest: this.amb }); } }, 900);
    if (kind === 'city') this._birds = setInterval(() => { if (Math.random() < 0.18) this._tone(0.4, { f: 380 + Math.random() * 120, type: 'sawtooth', g: 0.012, dest: this.amb }); }, 1200);
  }
  stopAmbience() { clearInterval(this._birds); if (this._amb) { const A = this._amb; try { A.g.gain.setTargetAtTime(0, this.t, 0.3); A.nodes.forEach(n => n.stop(this.t + 1.2)); } catch { } this._amb = null; } }
  // ---- music: layered step sequencer (drums, bass, chord pad, arpeggio) driven by an intensity value 0..1
  music(style = 'tension') {
    this.stopMusic(); if (!this.ctx) return;
    const S = {
      tension: { bpm: 126, root: 55, minor: true, prog: [0, 0, 3, -2], kick: 'x...x...x...x...', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.', bass: 'x..x..x.x..x..x.', arp: [0, 7, 12, 7], wave: 'sawtooth' },
      spy: { bpm: 138, root: 49, minor: true, prog: [0, 1, 0, -1], kick: 'x.....x...x.....', snare: '....x.......x...', hat: '..x...x...x...x.', bass: 'x.xx.x.xx.x.x.x.', arp: [0, 3, 7, 10, 7, 3], wave: 'square', brass: true },
      chase: { bpm: 156, root: 58, minor: true, prog: [0, -2, -4, -2], kick: 'x..x..x.x..x..x.', snare: '....x.......x..x', hat: 'xxxxxxxxxxxxxxxx', bass: 'x.x.x.x.x.x.x.x.', arp: [0, 12, 7, 12], wave: 'sawtooth' },
      western: { bpm: 104, root: 62, minor: false, prog: [0, 5, 0, 7], kick: 'x.......x.......', snare: '....x.......x...', hat: 'x..x..x.x..x..x.', bass: 'x...x...x...x...', arp: [0, 4, 7, 12], wave: 'triangle', twang: true },
      silent: { bpm: 176, root: 98, minor: false, prog: [0, 5, 7, 0], kick: '', snare: '', hat: '', bass: 'x.x.x.x.x.x.x.x.', arp: [0, 4, 7, 12, 7, 4], wave: 'triangle', piano: true },
      kungfu: { bpm: 118, root: 55, minor: true, prog: [0, 0, 5, 3], kick: 'x...x.x.x...x...', snare: '....x.......x...', hat: 'x.xxx.xxx.xxx.xx', bass: 'x..x.x..x..x.x..', arp: [0, 3, 5, 7, 10], wave: 'square', gong: true },
      synth: { bpm: 120, root: 46, minor: true, prog: [0, -4, -2, -5], kick: 'x...x...x...x...', snare: '....x.......x...', hat: '..x...x...x...x.', bass: 'xxxxxxxxxxxxxxxx', arp: [0, 7, 3, 7, 10, 7], wave: 'sawtooth' },
      epic: { bpm: 96, root: 49, minor: true, prog: [0, -4, -2, -7], kick: 'x.......x.x.....', snare: '........x.......', hat: '', bass: 'x.......x.......', arp: [0, 7, 12, 15], wave: 'sawtooth', brass: true },
      replay: { bpm: 84, root: 46, minor: true, prog: [0, -4, 3, -2], kick: 'x...............', snare: '', hat: '', bass: 'x.......x.......', arp: [12, 15, 19, 22], wave: 'sawtooth', pad: 1 },
      menu: { bpm: 92, root: 55, minor: true, prog: [0, -4, 3, -2], kick: '', snare: '', hat: '', bass: 'x.......x.......', arp: [0, 7, 12, 15], wave: 'triangle', pad: 1 },
    }[style];
    if (!S) return; this.style = style;
    const c = this.ctx, step = 60 / S.bpm / 4; let i = 0, next = this.t + 0.12; const f = n => S.root * Math.pow(2, n / 12), chord = S.minor ? [0, 3, 7] : [0, 4, 7], M = this.mus;
    const hit = (pat, k) => pat && pat[k % pat.length] === 'x';
    const kick = w => { this._tone(0.22, { f: 140, f2: 42, g: 0.42, when: w, dest: M }); this._noise(0.03, { f: 2500, g: 0.08, when: w, dest: M }); };
    const snare = w => { this._noise(0.16, { f: 2600, type: 'bandpass', q: 0.7, g: 0.24, when: w, dest: M }); this._tone(0.08, { f: 220, f2: 160, type: 'triangle', g: 0.14, when: w, dest: M }); };
    const hat = (w, open) => this._noise(open ? 0.12 : 0.03, { f: 8000, type: 'highpass', g: 0.05, when: w, dest: M });
    this._mus = setInterval(() => {
      if (!this.ctx) return; const I = this.intensity;
      while (next < this.t + 0.25) {
        const w = next - this.t, k = i % 16, bar = Math.floor(i / 16), tr = S.prog[bar % S.prog.length];
        if (k === 0 && (S.pad || I > 0.2)) for (const n of chord) { this._tone(step * 16 * 0.95, { f: f(n + tr) * 2, type: 'sawtooth', g: 0.018 + 0.012 * (S.pad || 0), attack: 0.3, when: w, dest: M, detune: -8 }); this._tone(step * 16 * 0.95, { f: f(n + tr) * 2, type: 'sawtooth', g: 0.014, attack: 0.3, when: w, dest: M, detune: 9 }); }
        if (hit(S.kick, k) && I > 0.15) kick(w); if (hit(S.snare, k) && I > 0.3) snare(w); if (hit(S.hat, k) && I > 0.45) hat(w, k % 8 === 6);
        if (hit(S.bass, k)) this._tone(step * 1.8, { f: f(tr), type: S.wave, g: 0.12, when: w, dest: M });
        if (I > 0.55 && k % 2 === 0) { const a = S.arp[(k / 2 + bar) % S.arp.length]; this._tone(step * 1.6, { f: f(a + tr) * (S.piano ? 4 : 2), type: S.piano ? 'triangle' : 'square', g: 0.035, when: w, dest: M }); }
        if (S.brass && k === 0 && bar % 2 === 0 && I > 0.5) for (const n of chord) this._tone(step * 6, { f: f(n + tr), type: 'sawtooth', g: 0.05, attack: 0.04, when: w, dest: M });
        if (S.gong && k === 0 && bar % 4 === 0) this._tone(3, { f: 98, f2: 92, type: 'sine', g: 0.2, when: w, dest: M });
        if (S.twang && k % 4 === 2 && I > 0.4) this._tone(step * 3, { f: f(S.arp[(bar + k) % 4] + tr) * 2, f2: f(S.arp[(bar + k) % 4] + tr) * 1.97, type: 'triangle', g: 0.06, when: w, dest: M });
        i++; next += step;
      }
    }, 50);
  }
  setIntensity(v) { this.intensity = Math.max(0, Math.min(1, v)); }
  stopMusic() { clearInterval(this._mus); this._mus = null; }
}
