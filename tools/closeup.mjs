// Close-up of the player vehicle/rider on the brief screen: node tools/closeup.mjs id[,id] [angles=1.57,0.6] [r=3.2] [h=0.9]
import puppeteer from 'puppeteer-core'; import fs from 'node:fs';
const [, , ids, angles = '1.57,0.6', r = '3.2', h = '0.9'] = process.argv; fs.mkdirSync('shots', { recursive: true });
const b = await puppeteer.launch({ executablePath: '/usr/local/bin/chromium', headless: true, args: ['--no-sandbox', '--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1280,720'] });
for (const id of ids.split(',')) {
  const p = await b.newPage(); await p.setViewport({ width: 1280, height: 720 }); const errs = []; p.on('pageerror', e => errs.push(String(e.message)));
  if (process.env.HIDE) await p.evaluateOnNewDocument(() => { window.HIDE = 1; });
  await p.goto(`${process.env.BASE || 'http://localhost:5173/'}?stunt=${id}`, { waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => window.__state?.().state === 'brief', { timeout: 60000 });
  await p.evaluate(() => { document.querySelectorAll('#brief,.screen,.overlay').forEach(e => e.style.display = 'none'); });
  for (const [i, a] of angles.split(',').entries()) {
    await p.evaluate((a, r, h) => { const g = window.__game, s = g.stage, d = g.STUNTS.find(x => x.id === window.__state().id); s.introFocus = s.car.pos.clone(); if (window.HIDE && s.car.driver) s.car.driver.root.visible = false; d.intro = { r, h, a0: a, speed: 0, up: 0.6, fov: 40 }; }, +a, +r, +h);
    await new Promise(r => setTimeout(r, 600)); await p.screenshot({ path: `shots/cu_${id}_${i}.jpg`, type: 'jpeg', quality: 85 });
  }
  console.log(id, errs.join(' | ') || 'ok'); await p.close();
}
await b.close();
