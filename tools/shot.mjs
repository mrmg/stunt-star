// node tools/shot.mjs <url-path> <out.png> [waitMs] [w] [h] [keysJson]
import puppeteer from 'puppeteer-core';
const [, , url, out, wait = '1500', w = '1280', h = '720', keys] = process.argv;
const b = await puppeteer.launch({ executablePath: '/usr/local/bin/chromium', headless: true, args: ['--no-sandbox', '--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', `--window-size=${w},${h}`, '--autoplay-policy=no-user-gesture-required'] });
const p = await b.newPage(); await p.setViewport({ width: +w, height: +h });
const errs = []; p.on('console', m => { const t = m.text(); if (m.type() === 'error' || m.type() === 'warn' || t.startsWith('[ss]')) errs.push(m.type() + ': ' + t.slice(0, 300)); }); p.on('pageerror', e => errs.push('PAGEERROR: ' + String(e.stack || e.message).slice(0, 600)));
await p.goto('http://localhost:5173/' + url, { waitUntil: 'domcontentloaded' });
try { await p.waitForFunction('window.__ready===true', { timeout: 45000 }); } catch { errs.push('timeout waiting for __ready'); }
if (keys) { for (const [k, ms, hold] of JSON.parse(keys)) { await new Promise(r => setTimeout(r, ms)); if (hold === 'up') await p.keyboard.up(k); else if (hold) await p.keyboard.down(k); else await p.keyboard.press(k); } }
await new Promise(r => setTimeout(r, +wait));
const outs = out.split(','); await p.screenshot({ path: outs[0], type: outs[0].endsWith('.jpg') ? 'jpeg' : 'png', ...(outs[0].endsWith('.jpg') ? { quality: 88 } : {}) });
const st = await p.evaluate(() => window.__state ? JSON.stringify(window.__state()) : ''); if (st) console.log('state', st);
console.log([...new Set(errs)].slice(0, 12).join('\n') || 'no errors'); await b.close();
