// node tools/eval.mjs "<url query>" "<js expr>" [waitMs]
import puppeteer from 'puppeteer-core';
const [, , url, expr, wait = '2500'] = process.argv;
const b = await puppeteer.launch({ executablePath: '/usr/local/bin/chromium', headless: true, args: ['--no-sandbox', '--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage(); p.on('pageerror', e => console.log('PAGEERROR', String(e.stack || e).slice(0, 500))); p.on('console', m => { if (m.type() === 'error' && !m.text().includes('404')) console.log('ERR', m.text().slice(0, 300)); });
await p.goto('http://localhost:5173/' + url, { waitUntil: 'domcontentloaded' }); await new Promise(r => setTimeout(r, +wait));
console.log(JSON.stringify(await p.evaluate(expr), null, 0)); await b.close();
