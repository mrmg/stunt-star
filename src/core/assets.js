import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const gltfLoader = new GLTFLoader();
const texLoader = new THREE.TextureLoader();
const cache = { glb: new Map(), tex: new Map() };
let maxAniso = 8;
export const setAniso = a => { maxAniso = a; };

// Real-world length (m) along travel axis, yaw correction (radians) so that the model's FRONT faces -Z, optional y offset.
// Models not listed fall back to sensible defaults by kind.
export const MODEL_META = {
  mini_red: { len: 3.05 }, mini_white: { len: 3.05 }, mini_blue: { len: 3.05 },
  mustang_green: { len: 4.66 }, charger_black: { len: 5.28 }, db5: { len: 4.57 }, dbs: { len: 4.72 }, delorean: { len: 4.4 },
  hornet: { len: 4.55 }, mach1: { len: 4.8 }, transam: { len: 5.0 }, bluesmobile: { len: 5.7 }, thunderbird: { len: 5.2 },
  city_bus: { len: 12.2 }, general_lee: { len: 5.28 }, eleanor: { len: 4.7 }, lykan: { len: 4.48 }, charger_dom: { len: 5.3 },
  supra: { len: 4.52 }, wrx: { len: 4.46 }, peugeot406: { len: 4.56 }, bmw_m5: { len: 4.72 }, lemans: { len: 5.3 }, cv2: { len: 3.83 },
  challenger_white: { len: 4.86 }, police_car: { len: 5.4 }, taxi: { len: 5.2 }, sedan_grey: { len: 4.6 }, wagon_brown: { len: 5.5 },
  van_white: { len: 5.2 }, semi_truck: { len: 7.5 }, joker_truck: { len: 17 }, tanker: { len: 16 }, ww2_truck: { len: 6.2 },
  t55_tank: { len: 8.6 }, jeep_gc: { len: 4.83 }, rocket_car: { len: 5.3 },
  triumph: { len: 2.15 }, fatboy: { len: 2.4 }, ducati: { len: 2.05 }, enduro_bike: { len: 2.15 }, bmw_bike: { len: 2.35 },
  speedboat: { len: 4.6 }, helicopter: { len: 12 }, f14: { len: 19 }, mig: { len: 14.5 }, fa18: { len: 18.3 }, acrostar: { len: 3.9 },
  a400m: { len: 45 }, learjet: { len: 14.8 }, steam_loco: { len: 16 }, mine_cart: { len: 1.9 }, raft: { len: 3.2 }, snowmobile: { len: 2.9 },
  crocodile: { len: 4.2 }, bulldozer: { len: 7.5 }, fire_hydrant: { len: 0.52 },
};
// yaw overrides filled in after visually checking generated models (tools/sheet)
export const MODEL_YAW = { bmw_bike: 0, ducati: 0, enduro_bike: 0, fatboy: 0, triumph: 0, snowmobile: 0, speedboat: 0, wagon_brown: 0, mig: 0 };
// costume doubles that were not generated fall back to the closest available performer
export const CHAR_FALLBACK = { ch_cop: 'ch_agent', ch_bride: 'ch_stunt', ch_silent: 'ch_spy', ch_keaton: 'ch_spy', ch_thug: 'ch_goon', ch_hk: 'ch_agent', ch_pilot: 'ch_skydiver', ch_roadwarrior: 'ch_biker', ch_skier: 'ch_skydiver', ch_suit: 'ch_spy', ch_hammer: 'ch_spy' };

export function loadGLB(id) {
  if (!cache.glb.has(id)) cache.glb.set(id, new Promise(res => gltfLoader.load(`models/${id}.glb`, g => res(g), undefined, e => { console.warn('model missing', id); res(null); })));
  return cache.glb.get(id);
}
export function loadTex(id, { srgb = true, repeat } = {}) {
  const key = id; if (!cache.tex.has(key)) {
    cache.tex.set(key, new Promise(res => texLoader.load(`tex/${id}.${id.startsWith('sp_') ? 'png' : 'jpg'}`, t => {
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = maxAniso; res(t);
    }, undefined, () => { console.warn('tex missing', id); res(null); })));
  }
  return cache.tex.get(key);
}
const ready = { glb: new Map(), tex: new Map() };
export async function preload({ models = [], tex = [] }, onProgress) {
  models = [...new Set([...models, ...models.filter(m => CHAR_FALLBACK[m]).map(m => CHAR_FALLBACK[m])])];
  const all = [...models.map(m => ['glb', m]), ...tex.map(t => ['tex', t])]; let n = 0;
  await Promise.all(all.map(async ([k, id]) => { const r = await (k === 'glb' ? loadGLB(id) : loadTex(id)); ready[k].set(id, r); onProgress?.(++n / all.length); }));
}
export const hasModel = id => !!ready.glb.get(id);
export const getGLTF = id => ready.glb.get(id) || null;

// Returns a fresh texture instance sharing the image (so repeat can differ per use)
export function tex(id, rx = 1, ry = rx) {
  const t = ready.tex.get(id); if (!t) return null;
  const c = t.clone(); c.repeat.set(rx, ry); c.needsUpdate = true; return c;
}
export const rawTex = id => ready.tex.get(id) || null;

const box = new THREE.Box3(), v = new THREE.Vector3();
// Static model normalised: centred on x/z, sitting on y=0, front toward -Z, scaled to length (len) or height.
// Bits of generated models that shouldn't be there (e.g. the trailer chocks under the speedboat's hull):
// drop any triangle with a vertex below y (fraction of model height) whose centre lies inside the z range (raw model units).
const TRIM = { speedboat: { y: 0.105, z: [-9, 0.37] } };
function trimBelow(scene, { y, z }) {
  scene.updateMatrixWorld(true); const bb = new THREE.Box3().setFromObject(scene), thr = bb.min.y + y * (bb.max.y - bb.min.y), w = new THREE.Vector3();
  scene.traverse(o => {
    if (!o.isMesh) return; const g = o.geometry, P = g.attributes.position, idx = g.index ? g.index.array : [...Array(P.count).keys()], keep = [];
    const wy = new Float32Array(P.count), wz = new Float32Array(P.count); for (let i = 0; i < P.count; i++) { w.fromBufferAttribute(P, i).applyMatrix4(o.matrixWorld); wy[i] = w.y; wz[i] = w.z; }
    for (let t = 0; t < idx.length; t += 3) { const a = idx[t], b = idx[t + 1], c = idx[t + 2], cz = (wz[a] + wz[b] + wz[c]) / 3; if (Math.min(wy[a], wy[b], wy[c]) < thr && cz > z[0] && cz < z[1]) continue; keep.push(a, b, c); }
    g.setIndex(keep);
  });
}
// Detailed procedural stand-ins for the props the generation budget never reached. They build at ~unit size and run
// through the same normalisation as generated models, so a future .glb drop-in replaces them with zero stunt edits.
function stripeTex(a, b) { const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64; const g = cv.getContext('2d'); for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? a : b; g.fillRect(i * 32, 0, 32, 64); } const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t; }
function labelTex() { const cv = document.createElement('canvas'); cv.width = cv.height = 256; const g = cv.getContext('2d'); g.fillStyle = '#b08a55'; g.fillRect(0, 0, 256, 256); g.fillStyle = 'rgba(0,0,0,0.08)'; for (let i = 0; i < 40; i++) g.fillRect(Math.random() * 256, Math.random() * 256, 30, 3); g.strokeStyle = '#8a6a3a'; g.lineWidth = 10; g.strokeRect(120, 0, 16, 256); g.fillStyle = '#5a3a18'; g.font = 'bold 34px sans-serif'; g.textAlign = 'center'; g.fillText('FRAGILE', 128, 92); g.font = 'bold 44px sans-serif'; g.fillText('↑ ↑', 128, 150); g.font = 'bold 22px sans-serif'; g.fillText('THIS SIDE UP', 128, 196); const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t; }
const PROCEDURAL = {
  fruit_cart() {
    const g = new THREE.Group(), wood = new THREE.MeshStandardMaterial({ color: 0x7a5a34, roughness: 0.85 }), dark = new THREE.MeshStandardMaterial({ color: 0x3a2c1a, roughness: 0.8 });
    const bed = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.1, 1.0), wood); bed.position.y = 0.72; g.add(bed);
    for (const sx of [-1, 1]) { const side = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.28, 1.0), wood); side.position.set(sx * 0.85, 0.9, 0); g.add(side);
      const wheel = new THREE.Group(); const rim = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.035, 8, 20), dark); wheel.add(rim);
      for (let i = 0; i < 6; i++) { const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.64, 5), wood); sp.rotation.z = i * Math.PI / 3; wheel.add(sp); }
      wheel.position.set(sx * 0.62, 0.36, 0.52); wheel.rotation.y = Math.PI / 2; g.add(wheel);
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.72, 0.06), dark); leg.position.set(sx * 0.7, 0.36, -0.42); g.add(leg);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.1, 6), dark); post.position.set(sx * 0.8, 1.3, -0.42); g.add(post);
      const post2 = post.clone(); post2.position.z = 0.42; g.add(post2); }
    const awn = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.04, 1.15), new THREE.MeshStandardMaterial({ map: stripeTex('#e8e0cc', '#c03028'), roughness: 0.9, side: THREE.DoubleSide })); awn.position.y = 1.88; awn.rotation.x = 0.1; g.add(awn);
    // crates of produce: instanced fruit spheres in three colour piles + watermelons
    const crateM = new THREE.MeshStandardMaterial({ color: 0xa87f4c, roughness: 0.9 });
    [[-0.48, 0xff8a1a], [0.02, 0xc8202a], [0.52, 0x7ec850]].forEach(([cx, col]) => {
      const crate = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.16, 0.8), crateM); crate.position.set(cx, 0.85, 0); g.add(crate);
      const fr = new THREE.InstancedMesh(new THREE.SphereGeometry(0.055, 8, 6), new THREE.MeshStandardMaterial({ color: col, roughness: 0.45 }), 18); const M = new THREE.Matrix4(); let n = 0;
      for (let i = 0; i < 18; i++) { M.setPosition(cx + (Math.random() - 0.5) * 0.34, 0.96 + (i > 11 ? 0.08 : 0) + Math.random() * 0.02, (Math.random() - 0.5) * 0.64); fr.setMatrixAt(n++, M); } g.add(fr); });
    const mel = new THREE.MeshStandardMaterial({ color: 0x2e6a2e, roughness: 0.5 });
    for (let i = 0; i < 3; i++) { const w = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), mel); w.scale.set(1, 0.8, 1.5); w.position.set(-0.35 + i * 0.35, 0.62, -0.32); g.add(w); }
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); return g;
  },
  cardboard_boxes() {
    const g = new THREE.Group(), lt = labelTex(), plain = new THREE.MeshStandardMaterial({ color: 0xb08a55, roughness: 0.95 }), faced = new THREE.MeshStandardMaterial({ map: lt, roughness: 0.95 });
    const specs = [[-0.32, 0.22, -0.15, 0.62, 0.44, 0.55, 0.1], [0.3, 0.22, 0.05, 0.58, 0.44, 0.6, -0.12], [0, 0.22, 0.42, 0.7, 0.44, 0.4, 0.04], [-0.18, 0.64, 0.05, 0.55, 0.4, 0.5, 0.2], [0.26, 0.64, -0.1, 0.5, 0.4, 0.45, -0.06], [0.02, 0.99, 0.02, 0.52, 0.36, 0.48, 0.14]];
    specs.forEach(([x, y, z, w, h, d, r], i) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), i % 2 ? faced : plain); b.position.set(x, y, z); b.rotation.y = r; b.castShadow = b.receiveShadow = true; g.add(b);
      const tape = new THREE.Mesh(new THREE.BoxGeometry(w * 1.01, 0.015, 0.09), new THREE.MeshStandardMaterial({ color: 0x8a6a3a, roughness: 0.8 })); tape.position.set(x, y + h / 2, z); tape.rotation.y = r; g.add(tape); });
    return g;
  },
  fire_hydrant() {
    const g = new THREE.Group(), red = new THREE.MeshStandardMaterial({ color: 0xc02820, roughness: 0.42, metalness: 0.25 }), metal = new THREE.MeshStandardMaterial({ color: 0x8a8f94, roughness: 0.35, metalness: 0.8 });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.21, 0.24, 0.09, 14), red); base.position.y = 0.045; g.add(base);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.52, 14), red); body.position.y = 0.35; g.add(body);
    const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.175, 0.175, 0.07, 14), red); collar.position.y = 0.6; g.add(collar);
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), red); dome.position.y = 0.63; g.add(dome);
    const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.09, 6), metal); nut.position.y = 0.8; g.add(nut);
    for (const a of [0, 2.2, 4.2]) { const noz = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.12, 10), red); noz.position.set(Math.sin(a) * 0.18, 0.42, Math.cos(a) * 0.18); noz.rotation.set(Math.cos(a) * 1.2, 0, -Math.sin(a) * 1.2); g.add(noz);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.04, 10), metal); cap.position.set(Math.sin(a) * 0.24, 0.42, Math.cos(a) * 0.24); cap.rotation.copy(noz.rotation); g.add(cap); }
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); return g;
  },
};
export function model(id, { len, height, yaw = 0, shadow = true, fit } = {}) {
  const g = ready.glb.get(id);
  const holder = new THREE.Group(); holder.name = id;
  if (!g && !PROCEDURAL[id]) { // placeholder so a missing asset never breaks a stunt
    const L = len || MODEL_META[id]?.len || height || 2;
    const m = new THREE.Mesh(new THREE.BoxGeometry(L * 0.4, L * 0.3, L), new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 0.6 }));
    m.position.y = L * 0.15; m.castShadow = true; holder.add(m); holder.userData.size = new THREE.Vector3(L * 0.4, L * 0.3, L); holder.userData.placeholder = true; return holder;
  }
  if (g && TRIM[id] && !g.userData.trimmed) trimBelow(g.scene, TRIM[id]), g.userData.trimmed = true;
  const inner = g ? g.scene.clone(true) : PROCEDURAL[id](); if (!g) holder.userData.procedural = true;
  const meta = MODEL_META[id] || {};
  inner.updateMatrixWorld(true); box.setFromObject(inner); box.getSize(v);
  // generated vehicles come out with their long axis on either X or Z: put it on Z, then apply the per-model front flip
  const auto = meta.len && v.x > v.z * 1.15 ? Math.PI / 2 : 0;
  inner.rotation.y = auto + (MODEL_YAW[id] ?? (meta.len ? Math.PI : 0)) + yaw; inner.updateMatrixWorld(true);
  box.setFromObject(inner); box.getSize(v);
  let s = 1;
  if (height) s = height / v.y; else if (fit === 'max') s = (len || meta.len || 1) / Math.max(v.x, v.y, v.z); else s = (len || meta.len || 1) / Math.max(v.z, 1e-6);
  inner.scale.multiplyScalar(s); inner.updateMatrixWorld(true); box.setFromObject(inner);
  inner.position.x -= (box.min.x + box.max.x) / 2; inner.position.z -= (box.min.z + box.max.z) / 2; inner.position.y -= box.min.y;
  box.getSize(v); holder.userData.size = v.clone();
  // canopies/rafts are shells seen from both sides; everything else keeps single-sided faces for clean shadows
  const DS = id === 'parachute' || id === 'parachute_uj' || id === 'raft' || id.startsWith('ch_');
  inner.traverse(o => { if (o.isMesh) { o.castShadow = shadow; o.receiveShadow = true; if (o.material) { o.material.side = DS ? THREE.DoubleSide : THREE.FrontSide; o.material.envMapIntensity = 1.0;
    // generated PBR often lands chalk-flat (roughness ~1 everywhere): give paint/chrome back a specular life without touching authored roughness maps
    if (!o.material.roughnessMap && o.material.roughness > 0.85 && !id.startsWith('ch_')) o.material.roughness = 0.68; } } });
  holder.add(inner); holder.userData.inner = inner; return holder;
}
export function skinned(id) {
  const g = ready.glb.get(id) || ready.glb.get(CHAR_FALLBACK[id]); if (!g) return null;
  return { scene: SkeletonUtils.clone(g.scene), animations: g.animations };
}
