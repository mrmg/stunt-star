import { Engine } from './core/engine.js';
import { Input } from './core/input.js';
import { Audio } from './core/audio.js';
import { preload, setAniso } from './core/assets.js';
import { Stage } from './world/stage.js';
import { ReplayPlayer } from './world/replay.js';
import { Career } from './game/career.js';
import { Hud, Screens } from './game/ui.js';
import { STUNTS } from './stunts/index.js';

const q = new URLSearchParams(location.search);
const engine = new Engine(document.getElementById('game'));
setAniso(engine.renderer.capabilities.getMaxAnisotropy());
const input = new Input(), audio = new Audio(), hud = new Hud(), screens = new Screens(audio);
const career = new Career(STUNTS); if (q.has('unlock')) career.cheat = true;
const COMMON = { models: ['camera_crew', 'film_light', 'director_chair', 'ch_stunt'], tex: [] };
const AUTO = q.has('auto');

// state: menu | loading | brief | slate | play | pause | replay | take | statement | over
let state = 'menu', stage = null, def = null, shoot = null, take = null, orbitT = 0, sceneNo = 1, player = null, afterReplay = null;
addEventListener('pointerdown', () => audio.init(), { once: false }); addEventListener('keydown', () => audio.init());

function menu() {
  state = 'menu'; hud.show(false); if (stage) { stage.dispose(); stage = null; } audio.stopLoops(); audio.music('menu'); engine.fx.uLetter.value = 0;
  if (career.d.money < 0) { state = 'over'; screens.over(career, () => { career.reset(); menu(); }); return; }
  screens.menu(career, STUNTS, pickStunt, {
    quality: () => engine.quality,
    act: o => { if (o === 'mute') audio.toggleMute(); if (o === 'voice') audio.toggleVoice(); if (o === 'quality') engine.setQuality((engine.quality + 1) % 3); if (o === 'reset' && confirm('Abandon this career and start again as a Background Extra?')) career.reset(); menu(); },
  });
}
// a new shoot day on this stunt
function pickStunt(d) { def = d; shoot = career.startShoot(d); sceneNo = 1 + (STUNTS.indexOf(d) * 7) % 96; loadTake(); }
async function loadTake() {
  state = 'loading'; screens.hideAll(); screens.loading(true, 0); audio.stopMusic(); audio.stopLoops(); hud.show(false); hud.clear();
  if (stage) { stage.dispose(); stage = null; }
  const A = def.assets || {};
  await preload({ models: [...COMMON.models, ...(A.models || [])], tex: [...COMMON.tex, ...(A.tex || [])] }, p => screens.loading(true, p));
  engine.fx.uBlur.value = 0; engine.fx.uFade.value = 0; engine.fx.uLetter.value = 0; engine.timeScale = 1; engine.camera.up.set(0, 1, 0); engine.camera.fov = 60;
  const s = stage = new Stage(engine, input, audio, hud, def);
  try { await def.build(s); } catch (e) { console.error('[ss] build failed', def.id, e); }
  if (!s.sky) s.env('day');
  s.onFinish = res => finish(res);
  s.update(0.016); engine.render(0.016); // compile shaders before the first visible frame
  screens.loading(false);
  if (AUTO) return action();
  state = 'brief'; orbitT = 0; engine.fx.uLetter.value = 0.1;
  screens.brief(def, career, shoot, action, () => leaveShoot());
}
async function action() {
  if (state === 'slate' || state === 'play') return;
  const n = shoot.takes.length + 1;
  state = 'slate'; input.enabled = false; hud.clear(); hud.show(true); hud.rec(`REC  ·  SC ${sceneNo}  ·  TK ${n}${def.takes > 1 ? ` / ${shoot.allowed}` : ''}`);
  stage.cam.first = true; engine.fx.uLetter.value = 0;
  if (!AUTO) await screens.slate(def, n, sceneNo);
  if (state !== 'slate') return;
  state = 'play'; input.enabled = true; stage.begin(); hud.goalCard(def);
  if (q.has('bot') && def.bot) { const st = stage, B = {}; input.auto = inp => { if (stage === st && state === 'play') def.bot(st, inp, B); }; }
  audio.music(def.music || 'tension'); stage.onAction?.();
}
function finish(res) {
  if (state !== 'play') return; input.enabled = false; input.auto = null; audio.stopMusic(); hud.show(false);
  take = career.recordTake(def, shoot, res); window.__last = { res, take };
  stage.rec.stop(); playReplay(showTake);
}
function playReplay(then) {
  const m = stage.bestMoment(); afterReplay = then;
  try { player = new ReplayPlayer(stage, m); } catch (e) { console.error('[ss] replay failed', e); player = null; }
  if (!player || player.done) return endReplay();
  state = 'replay'; audio.stopLoops(); audio.music('replay'); engine.fx.uLetter.value = 0.105; screens.hideAll();
  const title = stage.result?.ok ? (m.label && m.label !== 'the finish' ? '' : '') : '';
  player.onCut = (sh, i) => { screens.replay(true, { label: sh.label, type: sh.type, speed: sh.speed, title: i === 0 ? `${def.title.toUpperCase()} — TAKE ${take.n}` : '' }); audio.whoosh(0.8); };
}
function endReplay() { if (state === 'replay') { screens.replay(false); audio.stopMusic(); audio.stopLoops(); audio.slowmo(1); } player = null; const f = afterReplay; afterReplay = null; f?.(); }
function showTake() {
  state = 'take'; engine.fx.uLetter.value = 0.1;
  screens.take(def, take, shoot, career, a => takeAction(a));
}
function takeAction(a) {
  if (state !== 'take') return;
  if (a === 'watch') return playReplay(showTake);
  if (a === 'again' && career.takesLeft(shoot) > 0) return loadTake();
  if (a === 'print' || career.takesLeft(shoot) <= 0) return settle();
}
function settle(opts) {
  const st = career.settleShoot(def, shoot, opts); window.__last = { ...window.__last, st };
  state = 'statement'; screens.statement(def, shoot, st, career, a => { if (a === 'reshoot' && career.d.money >= 0) pickStunt(def); else menu(); });
}
// leaving the set: anything already in the can still gets settled
function leaveShoot() { if (shoot && shoot.takes.length && !shoot.done) return settle({ walkedOff: !shoot.takes.some(t => t.ok) }); menu(); }
function callCut() { // player hit R mid-take: it counts as a take, but nobody gets hurt
  if (state !== 'play' || stage.ended) return; stage.ended = true; stage.endT = stage.t;
  stage.result = { ok: false, reason: 'You called cut', injury: 0, scores: [...stage.scores.values()], bonuses: [], quality: stage.quality() * stage.flubMult() * 0.6, flubs: stage.flubs, advice: stage._advice('Reset. Take a breath and run it from the top.') };
  input.enabled = false; input.auto = null; audio.stopMusic(); hud.show(false); take = career.recordTake(def, shoot, stage.result); stage.rec.stop(); showTake();
}
function pause(on) {
  if (on && state === 'play') { state = 'pause'; audio.ctx?.suspend(); screens.pause(true, a => { pause(false); if (a === 'retry') callCut(); if (a === 'quit') { stage.ended = true; leaveShoot(); } }); }
  else if (!on && state === 'pause') { state = 'play'; audio.ctx?.resume(); screens.pause(false); }
}

let last = performance.now(), frames = 0; const SPEED = +(q.get('speed') || 1);
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000); last = now; input.poll();
  if (state === 'menu') { if (input.hit('start') && screens.onEnter) screens.onEnter(); }
  else if (state === 'brief') { if (input.hit('a') || input.hit('start')) action(); else if (input.hit('pause')) leaveShoot(); }
  else if (state === 'play') { if (input.hit('pause')) pause(true); else if (input.hit('retry') && stage.t - (stage.t0 || 0) > 1) callCut(); }
  else if (state === 'pause') { if (input.hit('pause')) pause(false); }
  else if (state === 'replay') { if (input.hit('a') || input.hit('start') || input.hit('pause')) endReplay(); }
  else if (state === 'take') { if (input.hit('retry')) takeAction('again'); else if (input.hit('start')) takeAction('print'); else if (input.hit('v')) takeAction('watch'); }
  else if (state === 'statement') { if (input.hit('start')) menu(); else if (input.hit('retry')) pickStunt(def); }
  if (state === 'replay' && player) { player.update(dt); engine.render(dt); if (player.done) endReplay(); }
  else if (stage && state !== 'pause' && state !== 'menu' && state !== 'loading' && state !== 'take' && state !== 'statement') {
    const N = state === 'play' ? SPEED : 1; for (let i = 0; i < N; i++) { if (i) input.poll(); stage.update(N > 1 ? 1 / 60 : dt); if (state !== 'play') break; }
    if (state === 'brief') { // slow establishing orbit while the director talks
      orbitT += dt; const I = def.intro || {}, f = stage.introFocus || stage.focus, r = I.r ?? 13, a = (I.a0 ?? 0.6) + orbitT * (I.speed ?? 0.12);
      const c = engine.camera; c.position.set(f.x + Math.sin(a) * r, f.y + (I.h ?? 3.2), f.z + Math.cos(a) * r); c.up.set(0, 1, 0); c.lookAt(f.x, f.y + (I.up ?? 1), f.z); if (c.fov !== (I.fov ?? 42)) { c.fov = I.fov ?? 42; c.updateProjectionMatrix(); }
    }
    engine.render(dt);
  } else if (stage && (state === 'take' || state === 'statement')) engine.render(dt);
  if (++frames === 8) window.__ready = true;
}
window.__state = () => ({ state, id: def?.id, t: stage ? +stage.t.toFixed(2) : 0, ended: stage?.ended, takes: shoot ? `${shoot.takes.length}/${shoot.allowed}` : null, res: stage?.result ? { ok: stage.result.ok, reason: stage.result.reason, q: +(stage.result.quality || 0).toFixed(2), scores: stage.result.scores?.map(s => s.label + ':' + s.v.toFixed(2)), flubs: stage.result.flubs?.map(f => f.reason) } : null, replay: player ? { shot: player.i, of: player.shots.length } : null, focus: stage ? [stage.focus.x, stage.focus.y, stage.focus.z].map(v => +v.toFixed(1)) : null, dbg: stage?.dbg?.() });
window.__game = { get stage() { return stage; }, career, engine, input, STUNTS, takeAction, get player() { return player; } };

const direct = q.get('stunt') && STUNTS.find(s => s.id === q.get('stunt'));
if (direct) { career.cheat = true; pickStunt(direct); } else menu();
requestAnimationFrame(loop);
