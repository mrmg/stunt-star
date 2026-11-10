// node tools/evalwhen.mjs "<query>" "<condition expr>" "<expr>" [timeoutMs]
import puppeteer from 'puppeteer-core';
const [, , url, cond, expr, to = '90000'] = process.argv;
const b = await puppeteer.launch({ executablePath: '/usr/local/bin/chromium', headless: true, args: ['--no-sandbox', '--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage(); p.on('pageerror', e => console.log('PAGEERROR', String(e.stack || e).slice(0, 500)));
await p.goto('http://localhost:5173/' + url, { waitUntil: 'domcontentloaded' });
try { await p.waitForFunction(cond, { timeout: +to, polling: 100 }); } catch { console.log('timeout; state=', await p.evaluate(() => JSON.stringify(window.__state?.()))); }
console.log(JSON.stringify(await p.evaluate(expr))); await b.close();
