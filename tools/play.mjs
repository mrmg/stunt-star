// Bot playtest: node tools/play.mjs id[,id...] [speed] [shotSeconds(comma, sim-time)] -> screenshots in shots/, prints results
import puppeteer from 'puppeteer-core'; import fs from 'node:fs';
const [, , idsArg, speed = '3', shotsArg = '2,6', mode = 'bot'] = process.argv; const ids = idsArg.split(','); const shots = shotsArg.split(',').map(Number);
fs.mkdirSync('shots', { recursive: true });
const b = await puppeteer.launch({ executablePath: '/usr/local/bin/chromium', headless: true, args: ['--no-sandbox', '--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1280,720'] });
for (const id of ids) {
  const p = await b.newPage(); await p.setViewport({ width: 1280, height: 720 }); const errs = [];
  p.on('console', m => { const t = m.text(); if ((m.type() === 'error' || t.startsWith('[ss]')) && !t.includes('404')) errs.push(t.slice(0, 260)); if (m.type() === 'warn' && t.includes('missing')) errs.push(t); }); p.on('pageerror', e => errs.push('PAGEERROR ' + String(e.stack || e.message).slice(0, 500)));
  await p.goto(`http://localhost:5173/?stunt=${id}&auto=1&${mode}=1&speed=${speed}`, { waitUntil: 'domcontentloaded' });
  let st = null, si = 0; const t0 = Date.now();
  while (Date.now() - t0 < 90000) {
    await new Promise(r => setTimeout(r, 120)); try { st = await p.evaluate(() => window.__state?.()); } catch { continue; }
    if (!st) continue; if (si < shots.length && st.state !== 'loading' && st.t >= shots[si]) { await p.screenshot({ path: `shots/${id}_${si}.jpg`, type: 'jpeg', quality: 85 }); si++; }
    if (st.state === 'result') { await new Promise(r => setTimeout(r, 500)); await p.screenshot({ path: `shots/${id}_end.jpg`, type: 'jpeg', quality: 80 }); break; }
  }
  console.log(id.padEnd(18), st?.state, 't=' + st?.t, st?.res ? (st.res.ok ? 'OK q=' + st.res.q : 'FAIL: ' + st.res.reason) : '(no result)', st?.res?.scores?.join(' ') || '', st?.dbg ? JSON.stringify(st.dbg).slice(0,300) : '', errs.length ? '\n   ' + [...new Set(errs)].slice(0, 6).join('\n   ') : '');
  await p.close();
}
await b.close();
