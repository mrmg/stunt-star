import fs from 'node:fs'; import { ASSETS } from './manifest.mjs';
const has = a => fs.existsSync('public/models/' + a.id + '.glb') || fs.existsSync('public/tex/' + a.id + '.jpg') || fs.existsSync('public/tex/' + a.id + '.png');
console.log(ASSETS.filter(a => !has(a)).map(a => a.id + (fs.existsSync('assets-src/img/' + a.id + '.png') ? '(img)' : '')).join(' '));
