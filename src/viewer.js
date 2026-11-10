// Dev tool: contact sheets of models (?models=a,b) or character poses (?char=id&poses=a,b)
import * as THREE from 'three';
import { Engine } from './core/engine.js';
import { preload, model } from './core/assets.js';
import { Character, POSES, CYCLES } from './world/character.js';
const q = new URLSearchParams(location.search);
const eng = new Engine(document.getElementById('c'));
const scene = new THREE.Scene(); eng.setScene(scene); scene.background = new THREE.Color(0x8a8f96);
scene.add(new THREE.HemisphereLight(0xffffff, 0x555555, 1.6)); const sun = new THREE.DirectionalLight(0xffffff, 3); sun.position.set(-20, 40, 30); scene.add(sun);
const grid = new THREE.GridHelper(200, 200, 0x444444, 0x777777); scene.add(grid);
const items = []; const chars = [];
const label = (txt, x, z) => { const cv = document.createElement('canvas'); cv.width = 256; cv.height = 48; const g = cv.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, 256, 48); g.fillStyle = '#fff'; g.font = '26px monospace'; g.fillText(txt, 6, 33); const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv) })); s.scale.set(1.9, 0.36, 1); s.position.set(x, -0.25, z + 0.9); scene.add(s); };
const cam = eng.camera;
if (q.get('models')) {
  const ids = q.get('models').split(','); await preload({ models: ids });
  const cols = +(q.get('cols') || 5), sp = +(q.get('sp') || 8);
  ids.forEach((id, i) => { const m = model(id, { len: +(q.get('len') || 5) }); const x = (i % cols) * sp, z = Math.floor(i / cols) * sp; m.position.set(x, 0, z); scene.add(m);
    if (!q.get('one')) label(id, x, z + 2); const a = new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), new THREE.Vector3(x, 0.05, z - 2.6), 1.5, 0xff0000, 0.6, 0.4); scene.add(a); });
  const rows = Math.ceil(ids.length / cols); const cx = (Math.min(cols, ids.length) - 1) * sp / 2, cz = (rows - 1) * sp / 2;
  const d = Math.max(cols * sp * 0.62, rows * sp * 1.0) + 4; if (q.get('one')) { const sz = scene.children.find(c => c.userData.size)?.userData.size || { z: 5, y: 1.5 }; const L = Math.max(sz.z, sz.x * 1.6); cam.fov = 32; cam.position.set(L * 0.55, L * 0.42 + sz.y * 0.5, -L * 1.25); cam.lookAt(0, sz.y * 0.45, 0); grid.visible = false; } else if (q.get('front')) { cam.fov = 24; const hh = Math.max(rows * sp * 1.1, cols * sp * 0.58 / cam.aspect) / Math.tan(Math.PI / 15); cam.position.set(cx, hh * 0.55, cz - hh * 0.85); cam.lookAt(cx, 0, cz); } else if (q.get('top')) { cam.fov = 20; const hh = Math.max(rows * sp * 0.62, cols * sp * 0.62 / cam.aspect) / Math.tan(Math.PI / 18); cam.position.set(cx, hh, cz + hh * 0.35); cam.up.set(0, 0, -1); cam.lookAt(cx, 0, cz - 0.6); } else { cam.fov = 30; cam.position.set(cx + d * 0.25, d * 1.5, cz + d * 0.9); cam.lookAt(cx, 0.5, cz); } cam.updateProjectionMatrix();
} else {
  const id = q.get('char') || 'ch_adventurer'; await preload({ models: [id] });
  const poses = (q.get('poses') || Object.keys(POSES).join(',')).split(','); const cols = +(q.get('cols') || 8), sp = 2.6;
  poses.forEach((p, i) => { const c = new Character(id); const x = (i % cols) * sp, z = Math.floor(i / cols) * 3.6; c.root.position.set(x, 0, z); c.heading = +(q.get('h') || -2.4); if (CYCLES[p]) { c.setCycle(p, 6); c.phase = 1.2; } else c.setPose(p, 0); c.update(0.016); if (CYCLES[p]) for (let k = 0; k < 30; k++) c.update(0.016); scene.add(c.root); chars.push(c); label(p, x, z + 0.4); });
  const rows = Math.ceil(poses.length / cols); const cx = (Math.min(cols, poses.length) - 1) * sp / 2, cz = (rows - 1) * 3.6 / 2;
  const d = Math.max(cols * sp * 0.62, rows * 3.6) + 3; cam.fov = 32; cam.position.set(cx + d * 0.25, 2.6 + rows, cz + d * 1.05); cam.lookAt(cx, 0.8, cz); cam.updateProjectionMatrix();
}
eng.setLook('neutral', { grain: 0, vignette: 0 });
let n = 0; const loop = () => { eng.render(0.016); if (++n === 5) window.__ready = true; requestAnimationFrame(loop); }; loop();
