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
  crocodile: { len: 4.2 }, bulldozer: { len: 7.5 },
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
export function model(id, { len, height, yaw = 0, shadow = true, fit } = {}) {
  const g = ready.glb.get(id);
  const holder = new THREE.Group(); holder.name = id;
  if (!g) { // placeholder so a missing asset never breaks a stunt
    const L = len || MODEL_META[id]?.len || height || 2;
    const m = new THREE.Mesh(new THREE.BoxGeometry(L * 0.4, L * 0.3, L), new THREE.MeshStandardMaterial({ color: 0x777777, roughness: 0.6 }));
    m.position.y = L * 0.15; m.castShadow = true; holder.add(m); holder.userData.size = new THREE.Vector3(L * 0.4, L * 0.3, L); holder.userData.placeholder = true; return holder;
  }
  if (TRIM[id] && !g.userData.trimmed) trimBelow(g.scene, TRIM[id]), g.userData.trimmed = true;
  const inner = g.scene.clone(true);
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
  inner.traverse(o => { if (o.isMesh) { o.castShadow = shadow; o.receiveShadow = true; if (o.material) { o.material.side = THREE.FrontSide; o.material.envMapIntensity = 1.0; } } });
  holder.add(inner); holder.userData.inner = inner; return holder;
}
export function skinned(id) {
  const g = ready.glb.get(id) || ready.glb.get(CHAR_FALLBACK[id]); if (!g) return null;
  return { scene: SkeletonUtils.clone(g.scene), animations: g.animations };
}
