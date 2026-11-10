// Asset generation pipeline: prompt -> image (fal) -> 3D GLB (fal) -> optimised GLB in public/models
// usage: node tools/gen.mjs [--only id,id] [--kind vehicle] [--engine hunyuan|trellis|meshy] [--force] [--conc 3]
import { fal } from '@fal-ai/client';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ASSETS } from './manifest.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
const key = env.match(/^FAL_KEY=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '');
fal.config({ credentials: key });

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? (args[i + 1] ?? true) : d; };
const only = opt('only') ? String(opt('only')).split(',') : null;
const kind = opt('kind');
const force = args.includes('--force');
const conc = +opt('conc', 3);
const engineOverride = opt('engine');

const D = { img: 'assets-src/img', raw: 'assets-src/raw', models: 'public/models', tex: 'public/tex' };
for (const d of Object.values(D)) fs.mkdirSync(path.join(ROOT, d), { recursive: true });
const P = (d, f) => path.join(ROOT, D[d], f);

async function download(url, file) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('download ' + r.status + ' ' + url);
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
}
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const STYLE = {
  vehicle: 'Studio product photograph, three-quarter front view from slightly above, of {p}. Entire vehicle fully in frame, centered, isolated on a plain flat light-grey background, soft even diffuse lighting, no cast shadow, no people, no text, no logos, photorealistic, sharp detail.',
  character: 'Full body photograph of {p}. Standing in a neutral A-pose with arms held straight out about 40 degrees away from the body, hands open, legs slightly apart, facing the camera straight on, the person is an anonymous professional stunt double with an ordinary face who does not resemble any actor, celebrity or famous person, entire body from head to feet in frame, isolated on a plain flat light-grey background, soft even diffuse lighting, no cast shadow, photorealistic game character reference.',
  prop: 'Studio product photograph of {p}. Entire object fully in frame, centered, isolated on a plain flat light-grey background, soft even diffuse lighting, no cast shadow, no text, photorealistic, sharp detail.',
};

async function genImage(a) {
  const file = P('img', a.id + '.png');
  if (fs.existsSync(file) && !force) return file;
  const prompt = a.rawPrompt || STYLE[a.kind].replace('{p}', a.prompt);
  const input = { prompt, num_images: 1, output_format: 'png', aspect_ratio: a.aspect || (a.kind === 'character' ? '3:4' : '4:3') };
  if (a.resolution) input.resolution = a.resolution;
  const r = await fal.subscribe(a.imgModel || 'fal-ai/nano-banana-2', { input });
  await download(r.data.images[0].url, file);
  log('img ok', a.id);
  return file;
}

async function gen3d(a, imgFile) {
  const raw = P('raw', a.id + '.glb');
  if (fs.existsSync(raw) && !force) return raw;
  const url = await fal.storage.upload(new Blob([fs.readFileSync(imgFile)], { type: 'image/png' }));
  const engine = engineOverride || a.engine || (a.kind === 'character' ? 'meshy' : 'hunyuan');
  let r, glb;
  if (engine === 'meshy') {
    const rig = a.kind === 'character';
    r = await fal.subscribe('meshy/v7.1/image-to-3d', { input: {
      image_url: url, enable_pbr: true, should_remesh: true, target_polycount: a.polys || 30000,
      topology: 'triangle', symmetry_mode: 'auto', enable_safety_checker: false,
      ...(rig ? { enable_rigging: true, pose_mode: 'a-pose', rigging_height_meters: 1.8 } : {}),
    } });
    glb = rig ? r.data.rigged_character_glb?.url : r.data.model_glb?.url;
    if (!glb) throw new Error('no glb in ' + JSON.stringify(r.data).slice(0, 400));
    if (rig) fs.writeFileSync(P('raw', a.id + '.json'), JSON.stringify(r.data, null, 1));
  } else if (engine === 'trellis') {
    r = await fal.subscribe('fal-ai/trellis-2', { input: { image_url: url, resolution: 1024, decimation_target: 40000, texture_size: 2048 } });
    glb = r.data.model_glb.url;
  } else {
    r = await fal.subscribe('fal-ai/hunyuan-3d/v3.1/pro/image-to-3d', { input: { input_image_url: url, face_count: a.polys || 60000, enable_pbr: true, generate_type: 'Normal' } });
    glb = r.data.model_glb.url;
  }
  await download(glb, raw);
  log('3d ok', a.id, engine, (fs.statSync(raw).size / 1e6).toFixed(1) + 'MB');
  return raw;
}

function optimise(a, raw) {
  const out = P('models', a.id + '.glb');
  if (fs.existsSync(out) && !force) return out;
  const bin = path.join(ROOT, 'node_modules/.bin/gltf-transform');
  const tmp = raw.replace(/\.glb$/, '.tmp.glb');
  try {
    let src = raw;
    if (a.kind !== 'character') { // never simplify skinned meshes
      execFileSync(bin, ['simplify', raw, tmp, '--ratio', '0', '--error', '0.0015'], { stdio: 'pipe' });
      src = tmp;
    }
    execFileSync(bin, ['resize', src, tmp, '--width', String(a.texSize || 1024), '--height', String(a.texSize || 1024)], { stdio: 'pipe' });
    execFileSync(bin, ['webp', tmp, out, '--quality', '86'], { stdio: 'pipe' });
  } catch (e) {
    log('optimise failed, copying raw', a.id, String(e.stderr || e.message).slice(0, 300));
    fs.copyFileSync(raw, out);
  }
  fs.rmSync(tmp, { force: true });
  log('opt ok', a.id, (fs.statSync(out).size / 1e6).toFixed(2) + 'MB');
  return out;
}

async function run(a) {
  try {
    if (a.kind === 'sprite') {
      const out = P('tex', a.id + '.png'); if (fs.existsSync(out) && !force) return;
      const img = await genImage(a); const sharp = (await import('sharp')).default;
      const { data, info } = await sharp(img).resize({ width: 768 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      let minX = info.width, maxX = 0, minY = info.height, maxY = 0;
      for (let i = 0, n = 0; i < data.length; i += 4, n++) { const r = data[i], g = data[i + 1], b = data[i + 2]; const m = Math.min(r, b) - g; const al = m <= 28 ? 255 : m >= 95 ? 0 : Math.round(255 * (1 - (m - 28) / 67)); if (m > 0) { const k = Math.min(1, m / 60); data[i] = Math.round(r - (r - g) * k); data[i + 2] = Math.round(b - (b - g) * k); } data[i + 3] = al; if (al > 128) { const x = n % info.width, y = (n / info.width) | 0; if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; } }
      await sharp(data, { raw: info }).extract({ left: minX, top: minY, width: Math.max(1, maxX - minX + 1), height: Math.max(1, maxY - minY + 1) }).png().toFile(out);
      log('sprite ok', a.id); return;
    }
    if (a.kind === 'backdrop' || a.kind === 'texture') {
      const out = P('tex', a.id + '.jpg');
      if (fs.existsSync(out) && !force) return;
      const img = await genImage(a);
      const sharp = (await import('sharp')).default;
      let s = sharp(img);
      if (a.size) s = s.resize(a.size[0], a.size[1], { fit: 'cover' });
      await s.jpeg({ quality: 88 }).toFile(out);
      log('tex ok', a.id);
      return;
    }
    const img = await genImage(a);
    if (args.includes('--img-only')) return;
    const raw = await gen3d(a, img);
    optimise(a, raw);
  } catch (e) { log('FAIL', a.id, e?.body ? JSON.stringify(e.body).slice(0, 400) : e.message); }
}

let list = ASSETS.filter(a => (!only || only.includes(a.id)) && (!kind || a.kind === kind));
log('generating', list.length, 'assets');
const queue = [...list];
await Promise.all(Array.from({ length: conc }, async () => { while (queue.length) await run(queue.shift()); }));
log('done');
