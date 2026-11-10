// force a slow approach on great_escape to hit the wire, then grab the take screen
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: '/usr/local/bin/chromium', headless: true, args: ['--no-sandbox', '--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage(); await p.setViewport({ width: 1600, height: 900 }); p.on('pageerror', e => console.log('PAGEERROR', String(e.stack || e).slice(0, 400)));
await p.goto('http://localhost:5173/?stunt=great_escape&auto=1', { waitUntil: 'domcontentloaded' });
await p.waitForFunction("window.__state && window.__state().state==='play'", { timeout: 40000 });
await p.evaluate(() => { const s = window.__game.stage; s.car.pos.set(0, 0, -250); s.car.heading = 0; s.car.v = 14; s.car.vel.set(0, 0, -14); window.__game.input.auto = i => { i.y = 0.15; i.x = 0; }; });
await p.waitForFunction("window.__state().state==='take'", { timeout: 60000 }); await new Promise(r => setTimeout(r, 1200));
await p.screenshot({ path: 'shots/v2_failtake.jpg', type: 'jpeg', quality: 85 }); console.log(JSON.stringify((await p.evaluate(() => window.__state())).res)); await b.close();
