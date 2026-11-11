// Menu card capture: one iconic in-engine frame per stunt, taken from its own signature replay cameras.
//   node tools/cards.mjs [--only id,id] [--force]        capture candidates -> shots/cards/<id>_rN.jpg (+ _a action frame)
//   node tools/cards.mjs --export [--pick id:rN,...]     export picks -> public/cards/<id>.jpg (848px, letterbox trimmed)
//   node tools/cards.mjs --sheet                          contact sheets of current picks -> shots/cards_sheet_N.jpg
// Picks default to r0 (the first replay cut is the stunt's signature angle); override per stunt in PICKS below
// after reviewing the sheets. Dev server must be running on :5173.
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { ORDER } from '../src/stunts/order.js';

// hand-picked after reviewing shots/cands_sheet_*.jpg: the frame that reads as the film's iconic shot at card size.
// (rN = replay cut N late in the shot, rNb = later still, a = live action frame.) Rerun --export after changing.
const PICKS = {
  smokey: 'r1', general_lee: 'r2', great_escape: 'r2', steamboat: 'a', butch_cliff: 'r1', italian_job: 'r1', boat_jump: 'r0',
  golden_gun: 'r1b', lethal_weapon: 'r0', blues_brothers: 'a', safety_last: 'r0b', enter_dragon: 'r2', temple_door: 'r1', croc_run: 'a',
  bullitt: 'r0b', raiders_boulder: 'a', thelma: 'r1', french_connection: 'r1', police_story: 'r0', diamonds: 'r0b', rumble_bronx: 'r1',
  gone60: 'r1', bttf: 'r2b', oldboy: 'a', t2_canal: 'r1', goldeneye_dam: 'r1b', raiders_truck: 'r0b', die_hard: 'r0',
  who_am_i: 'r2', ronin: 'r0b', matrix_dodge: 'r1', casino_crane: 'r2', mi_vault: 'r0', kill_bill: 'r1', fast_train: 'r1',
  matrix_freeway: 'r1b', point_break: 'r0', spy_ski: 'r1', supercop: 'r1b', spiderman_tray: 'r1', bourne: 'r1', inception: 'r1',
  death_proof: 'r1b', speed_bus: 'r2b', casino_roll: 'r1b', road_warrior: 'r2', goldeneye_tank: 'r0b', hooper: 'r3', octopussy: 'r0',
  mi_burj: 'r1', t2_heli: 'r1b', dark_knight: 'r2', top_gun: 'r2b', fury_road: 'r1b', fall_guy: 'r0', furious7: 'r2b',
  mi_halo: 'r0b', mi_a400: 'r0', maverick: 'r1b', cliffhanger: 'a', mi_cliff: 'r2b',
};

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
const force = args.includes('--force');
const pickArg = {};
if (args.includes('--pick')) for (const p of args[args.indexOf('--pick') + 1].split(',')) { const [id, s] = p.split(':'); pickArg[id] = s; }
const ids = only || ORDER;
const DIR = 'shots/cards'; fs.mkdirSync(DIR, { recursive: true }); fs.mkdirSync('public/cards', { recursive: true });

async function capture() {
  const b = await puppeteer.launch({ executablePath: '/usr/local/bin/chromium', headless: true, args: ['--no-sandbox', '--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1280,720'] });
  for (const id of ids) {
    if (!force && fs.existsSync(`${DIR}/${id}_r0.jpg`)) { console.log(id.padEnd(18), 'skip (have candidates)'); continue; }
    const p = await b.newPage(); await p.setViewport({ width: 1280, height: 720 }); const errs = [];
    p.on('pageerror', e => errs.push(String(e.message).slice(0, 200)));
    await p.goto(`http://localhost:5173/?stunt=${id}&auto=1&bot=1&speed=3`, { waitUntil: 'domcontentloaded' });
    // clean poster frames: no HUD, no replay captions — just the engine image (letterbox stays, it is trimmed on export)
    await p.addStyleTag({ content: '.layer{display:none!important}' }).catch(() => {});
    let st = null, gotA = false; const rs = new Set(); const t0 = Date.now();
    while (Date.now() - t0 < 110000) {
      await new Promise(r => setTimeout(r, 90)); try { st = await p.evaluate(() => window.__state?.()); } catch { continue; }
      if (!st) continue;
      if (!gotA && st.state !== 'loading' && st.t >= 5) { gotA = true; await p.screenshot({ path: `${DIR}/${id}_a.jpg`, type: 'jpeg', quality: 88 }); }
      if (st.state === 'replay' && st.replay) {
        // shoot late in each cut (subject large in frame), twice: ~62% and ~88% through the shot
        const pr = await p.evaluate(() => { const pl = window.__game?.player, sh = pl?.shot; return sh && pl.simT != null ? (pl.simT - sh.ta) / Math.max(0.1, sh.tb - sh.ta) : -1; }).catch(() => -1);
        for (const [at, sfx] of [[0.62, ''], [0.88, 'b']]) { const k = 'r' + st.replay.shot + sfx; if (pr >= at && !rs.has(k)) { rs.add(k); await p.screenshot({ path: `${DIR}/${id}_${k}.jpg`, type: 'jpeg', quality: 90 }); } }
      }
      if (st.state === 'take' || st.state === 'result' || st.state === 'statement') break;
    }
    console.log(id.padEnd(18), st?.res ? (st.res.ok ? 'OK q=' + st.res.q : 'FAIL ' + st.res.reason) : '(no result)', 'cands=' + [...rs].join(',') + (gotA ? ',a' : ''), errs[0] ? 'ERR ' + errs[0] : '');
    await p.close();
  }
  await b.close();
}

// trim near-black letterbox rows, then resize to card width
async function exportOne(sharp, id) {
  const pick = pickArg[id] || PICKS[id] || 'r0';
  let src = `${DIR}/${id}_${pick}.jpg`; if (!fs.existsSync(src)) src = `${DIR}/${id}_r0.jpg`; if (!fs.existsSync(src)) src = `${DIR}/${id}_a.jpg`;
  if (!fs.existsSync(src)) { console.log(id, 'NO CANDIDATE'); return false; }
  const img = sharp(src); const { width: W, height: H } = await img.metadata();
  const { data, info } = await sharp(src).greyscale().raw().toBuffer({ resolveWithObject: true });
  const rowMean = y => { let s = 0; for (let x = 0; x < info.width; x += 4) s += data[y * info.width + x]; return s / (info.width / 4); };
  let top = 0, bot = H - 1; while (top < H * 0.3 && rowMean(top) < 14) top++; while (bot > H * 0.7 && rowMean(bot) < 14) bot--;
  await sharp(src).extract({ left: 0, top, width: W, height: bot - top + 1 }).resize({ width: 848 }).jpeg({ quality: 82, mozjpeg: true }).toFile(`public/cards/${id}.jpg`);
  console.log(id.padEnd(18), path.basename(src), `crop ${top}..${bot}`, (fs.statSync(`public/cards/${id}.jpg`).size / 1024).toFixed(0) + 'KB');
  return true;
}

async function sheet(sharp) {
  const have = ORDER.filter(id => fs.existsSync(`public/cards/${id}.jpg`));
  const per = 12, cw = 420, chh = 236;
  for (let s = 0; s * per < have.length; s++) {
    const batch = have.slice(s * per, s * per + per), tiles = [];
    for (let i = 0; i < batch.length; i++) { const buf = await sharp(`public/cards/${batch[i]}.jpg`).resize(cw, chh, { fit: 'cover' }).jpeg().toBuffer(); tiles.push({ input: buf, left: (i % 3) * (cw + 6), top: Math.floor(i / 3) * (chh + 22) });
      const lb = await sharp({ create: { width: cw, height: 20, channels: 3, background: '#111' } }).composite([{ input: Buffer.from(`<svg width="${cw}" height="20"><text x="6" y="15" font-family="monospace" font-size="14" fill="#ffd75e">${batch[i]}</text></svg>`), left: 0, top: 0 }]).jpeg().toBuffer(); tiles.push({ input: lb, left: (i % 3) * (cw + 6), top: Math.floor(i / 3) * (chh + 22) + chh + 1 }); }
    await sharp({ create: { width: 3 * cw + 12, height: 4 * (chh + 22), channels: 3, background: '#222' } }).composite(tiles).jpeg({ quality: 82 }).toFile(`shots/cards_sheet_${s}.jpg`);
    console.log('sheet', s, batch.join(' '));
  }
  console.log('cards exported:', have.length, '/', ORDER.length, 'missing:', ORDER.filter(id => !have.includes(id)).join(' ') || 'none');
}

// candidate review sheets: one row per stunt, every candidate labelled, so picks are made by eye
async function candSheets(sharp) {
  const per = 7, cw = 300, chh = 169;
  for (let s = 0; s * per < ORDER.length; s++) {
    const batch = ORDER.slice(s * per, s * per + per), tiles = []; let W = 0;
    const rows = [];
    for (const id of batch) { const cands = fs.readdirSync(DIR).filter(f => f.startsWith(id + '_') && f.endsWith('.jpg')).sort(); rows.push(cands); W = Math.max(W, cands.length); }
    for (let r = 0; r < batch.length; r++) {
      const lb = await sharp({ create: { width: W * cw, height: 20, channels: 3, background: '#111' } }).composite([{ input: Buffer.from(`<svg width="${W * cw}" height="20"><text x="6" y="15" font-family="monospace" font-size="15" fill="#ffd75e">${batch[r]} — ${rows[r].map(f => f.replace(batch[r] + '_', '').replace('.jpg', '')).join('  ')}</text></svg>`), left: 0, top: 0 }]).jpeg().toBuffer();
      tiles.push({ input: lb, left: 0, top: r * (chh + 20) });
      for (let i = 0; i < rows[r].length; i++) tiles.push({ input: await sharp(`${DIR}/${rows[r][i]}`).resize(cw, chh, { fit: 'cover' }).jpeg().toBuffer(), left: i * cw, top: r * (chh + 20) + 20 });
    }
    await sharp({ create: { width: W * cw, height: batch.length * (chh + 20), channels: 3, background: '#222' } }).composite(tiles).jpeg({ quality: 80 }).toFile(`shots/cands_sheet_${s}.jpg`);
    console.log('cands sheet', s, batch.join(' '));
  }
}

if (args.includes('--export') || args.includes('--sheet') || args.includes('--cands')) {
  const sharp = (await import('sharp')).default;
  if (args.includes('--export')) { let n = 0; for (const id of ids) if (await exportOne(sharp, id)) n++; console.log('exported', n); }
  else if (args.includes('--cands')) await candSheets(sharp);
  else await sheet(sharp);
} else await capture();
