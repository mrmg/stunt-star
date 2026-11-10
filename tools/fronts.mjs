import puppeteer from 'puppeteer-core'; import sharp from 'sharp'; import fs from 'node:fs';
const ids = process.argv[2].split(','), out = process.argv[3], W = 300, H = 190, cols = +(process.argv[4] || 6);
const b = await puppeteer.launch({ executablePath: '/usr/local/bin/chromium', headless: true, args: ['--no-sandbox', '--use-angle=gl', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await b.newPage(); await p.setViewport({ width: W, height: H }); const tiles = [];
for (const id of ids) { await p.goto(`http://localhost:5173/viewer.html?models=${id}&one=1&len=5`, { waitUntil: 'domcontentloaded' }); try { await p.waitForFunction('window.__ready===true', { timeout: 20000 }); } catch { } await new Promise(r => setTimeout(r, 250)); const buf = await p.screenshot({ type: 'png' });
  const svg = Buffer.from(`<svg width="${W}" height="22"><rect width="${W}" height="22" fill="#000"/><text x="5" y="16" font-family="monospace" font-size="15" fill="#fff">${id}</text></svg>`); tiles.push(await sharp(buf).composite([{ input: svg, left: 0, top: 0 }]).toBuffer()); }
await b.close(); const rows = Math.ceil(ids.length / cols);
await sharp({ create: { width: cols * W, height: rows * H, channels: 3, background: '#333' } }).composite(tiles.map((t, i) => ({ input: t, left: (i % cols) * W, top: Math.floor(i / cols) * H }))).jpeg({ quality: 82 }).toFile(out);
