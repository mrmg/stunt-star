import { Engine } from './core/engine.js';
import { Input } from './core/input.js';
import { Audio } from './core/audio.js';
import { preload, setAniso } from './core/assets.js';
import { Stage } from './world/stage.js';
import { Career } from './game/career.js';
import { Hud, Screens } from './game/ui.js';
import { STUNTS } from './stunts/index.js';

const q = new URLSearchParams(location.search);
const engine = new Engine(document.getElementById('game'));
setAniso(engine.renderer.capabilities.getMaxAnisotropy());
const input = new Input(), audio = new Audio(), hud = new Hud(), screens = new Screens(audio);
const career = new Career(STUNTS); if (q.has('unlock')) career.cheat = true;
const COMMON = { models: ['camera_crew', 'film_light', 'director_chair', 'ch_stunt'], tex: [] };

let state = 'menu', stage = null, def = null, take = 1, orbitT = 0, sceneNo = 1;
addEventListener('pointerdown', () => audio.init(), { once: false }); addEventListener('keydown', () => audio.init());

function menu() {
  state = 'menu'; hud.show(false); if (stage) { stage.dispose(); stage = null; } audio.stopLoops(); audio.music('menu');
  if (career.d.money < 0) { state = 'over'; screens.over(career, () => { career.reset(); menu(); }); return; }
  screens.menu(career, STUNTS, pickStunt, {
    quality: () => engine.quality,
    act: o => { if (o === 'mute') audio.toggleMute(); if (o === 'quality') engine.setQuality((engine.quality + 1) % 3); if (o === 'reset' && confirm('Abandon this career and start again as a Background Extra?')) career.reset(); menu(); },
  });
}
async function pickStunt(d, skipBrief = false) {
  def = d; take = (career.d.takes[d.id] || 0) + 1; sceneNo = 1 + (STUNTS.indexOf(d) * 7) % 96;
  state = 'loading'; screens.hideAll(); screens.loading(true, 0); audio.stopMusic(); audio.stopLoops(); hud.show(false); hud.clear();
  if (stage) { stage.dispose(); stage = null; }
  const A = d.assets || {};
  await preload({ models: [...COMMON.models, ...(A.models || [])], tex: [...COMMON.tex, ...(A.tex || [])] }, p => screens.loading(true, p));
  engine.fx.uBlur.value = 0; engine.fx.uFade.value = 0; engine.fx.uLetter.value = 0; engine.timeScale = 1; engine.camera.up.set(0, 1, 0); engine.camera.fov = 60;
  const s = stage = new Stage(engine, input, audio, hud, d);
  try { await d.build(s); } catch (e) { console.error('[ss] build failed', d.id, e); }
  if (!s.sky) s.env('day');
  s.onFinish = res => finish(res);
  s.update(0.016); engine.render(0.016); // compile shaders before the first visible frame
  screens.loading(false);
  if (skipBrief) return action();
  state = 'brief'; orbitT = 0; engine.fx.uLetter.value = 0.1;
  screens.brief(d, career, take, action, menu);
}
async function action() {
  if (state === 'slate' || state === 'play') return;
  state = 'slate'; input.enabled = false; hud.clear(); hud.show(true); hud.rec(`REC  ·  SC ${sceneNo}  ·  TK ${take}`);
  stage.cam.first = true; engine.fx.uLetter.value = 0;
  if (!q.has('auto')) await screens.slate(def, take, sceneNo);
  if (state !== 'slate') return;
  state = 'play'; input.enabled = true; stage.started = true; if (q.has('bot') && def.bot) { const st = stage, B = {}; input.auto = inp => { if (stage === st && state === 'play') def.bot(st, inp, B); }; } stage.t0 = stage.t; audio.music(def.music || 'tension'); stage.onAction?.();
}
function finish(res) {
  if (state !== 'play') return; state = 'result'; input.enabled = false; audio.stopMusic(); audio.stopLoops(); hud.show(false);
  const st = career.settle(def, res); window.__last = { res, st };
  screens.result(def, res, st, career, a => { if (a === 'retry') retry(); else menu(); });
}
function retry() { if (career.d.money < 0) return menu(); pickStunt(def, true); }
function pause(on) {
  if (on && state === 'play') { state = 'pause'; audio.ctx?.suspend(); screens.pause(true, a => { pause(false); if (a === 'retry') retry(); if (a === 'quit') menu(); }); }
  else if (!on && state === 'pause') { state = 'play'; audio.ctx?.resume(); screens.pause(false); }
}

let last = performance.now(), frames = 0; const SPEED = +(q.get('speed') || 1);
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000); last = now; input.poll();
  if (state === 'brief') { if (input.hit('a') || input.hit('start')) action(); else if (input.hit('pause')) menu(); }
  else if (state === 'play') { if (input.hit('pause')) pause(true); else if (input.hit('retry') && stage.t - (stage.t0 || 0) > 1) retry(); }
  else if (state === 'pause') { if (input.hit('pause')) pause(false); }
  else if (state === 'result') { if (input.hit('retry')) retry(); else if (input.hit('start')) menu(); }
  if (stage && state !== 'pause' && state !== 'menu' && state !== 'loading') {
    const N = state === 'play' || state === 'result' ? SPEED : 1; for (let i = 0; i < N; i++) { if (i) input.poll(); stage.update(N > 1 ? 1 / 60 : dt); if (state !== 'play') break; }
    if (state === 'brief') { // slow establishing orbit while the director talks
      orbitT += dt; const I = def.intro || {}, f = stage.introFocus || stage.focus, r = I.r ?? 13, a = (I.a0 ?? 0.6) + orbitT * (I.speed ?? 0.12);
      const c = engine.camera; c.position.set(f.x + Math.sin(a) * r, f.y + (I.h ?? 3.2), f.z + Math.cos(a) * r); c.up.set(0, 1, 0); c.lookAt(f.x, f.y + (I.up ?? 1), f.z); if (c.fov !== (I.fov ?? 42)) { c.fov = I.fov ?? 42; c.updateProjectionMatrix(); }
    }
    engine.render(dt);
  }
  if (++frames === 8) window.__ready = true;
}
window.__state = () => ({ state, id: def?.id, t: stage ? +stage.t.toFixed(2) : 0, ended: stage?.ended, res: stage?.result ? { ok: stage.result.ok, reason: stage.result.reason, q: +(stage.result.quality || 0).toFixed(2), scores: stage.result.scores?.map(s => s.label + ':' + s.v.toFixed(2)) } : null, focus: stage ? [stage.focus.x, stage.focus.y, stage.focus.z].map(v => +v.toFixed(1)) : null, dbg: stage?.dbg?.() });
window.__game = { get stage() { return stage; }, career, engine, input, STUNTS };

const direct = q.get('stunt') && STUNTS.find(s => s.id === q.get('stunt'));
if (direct) { career.cheat = true; pickStunt(direct, q.has('auto')); } else menu();
requestAnimationFrame(loop);
