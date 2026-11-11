import { TIERS, money, injuryName, starsFor } from './career.js';
const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const show = (id, on = true) => $('#' + id).classList.toggle('on', on);
const stars = n => '★'.repeat(n) + '<i>' + '★'.repeat(5 - n) + '</i>';
const strip = h => String(h).replace(/<[^>]+>/g, '');
const MODE_TAG = { drive: 'Driving', run: 'On foot', fall: 'High fall', grip: 'Hang on', fly: 'Aerial', fight: 'Fight', custom: 'Precision' };
export const goalsOf = def => def.goals || { shot: def.tips.map(strip), cut: [], stars: [] };
const takesText = def => def.takes === 1 ? 'ONE TAKE ONLY' : `${def.takes} takes`;

export class Hud {
  constructor() { this.root = $('#hud'); this.ro = {}; this.mt = {}; this.lane = $('.lane', this.root); this.bar2d = $('.bar2d', this.root); }
  show(on = true) { show('hud', on); }
  clear() { $('.obj', this.root).textContent = ''; $('.pops', this.root).innerHTML = ''; $('.read', this.root).innerHTML = ''; $('.meters', this.root).innerHTML = ''; $('.prompt', this.root).innerHTML = ''; $('.dir', this.root).className = 'dir'; $('.shotcard', this.root).className = 'shotcard'; this.ro = {}; this.mt = {}; this.bar2d.style.display = 'none'; this.lane.style.display = 'none'; this.lane.querySelectorAll('.bt').forEach(b => b.remove()); }
  rec(t) { $('.rec span', this.root).textContent = t; }
  objective(t) { const o = $('.obj', this.root); if (o.textContent !== t) o.textContent = t || ''; }
  prompt(html) { const p = $('.prompt', this.root); if (p._h !== html) { p.innerHTML = html || ''; p._h = html; } }
  pop(text, kind = '') { const p = el('div', 'pop ' + kind, text); const box = $('.pops', this.root); box.querySelectorAll(kind.includes('small') ? '.pop.small' : '.pop:not(.small)').forEach(x => x.remove()); box.appendChild(p); setTimeout(() => p.remove(), 1400); }
  // megaphone shout from the director (bottom centre)
  director(text) { const d = $('.dir', this.root); d.innerHTML = `<b>DIRECTOR:</b> “${text}”`; d.className = 'dir on'; clearTimeout(this._dt); this._dt = setTimeout(() => { d.className = 'dir'; }, 2200); }
  // big "THE SHOT" card shown for the first seconds of a take
  goalCard(def, sec = 4.5) { const c = $('.shotcard', this.root), g = goalsOf(def); c.innerHTML = `<h4>THE SHOT</h4><ol>${g.shot.slice(0, 4).map(x => `<li>${x}</li>`).join('')}</ol>`; c.className = 'shotcard on'; clearTimeout(this._ct); this._ct = setTimeout(() => { c.className = 'shotcard'; }, sec * 1000); }
  readout(id, label, value, cls = '') { let r = this.ro[id]; if (!r) { r = this.ro[id] = el('div', 'ro', '<b></b><span></span>'); $('.read', this.root).appendChild(r); } const b = r.firstChild; if (b.textContent !== String(value)) b.textContent = value; r.lastChild.textContent = label; r.className = 'ro ' + cls; }
  meter(id, label, v, { color, zone } = {}) { let m = this.mt[id]; if (!m) { m = this.mt[id] = el('div', 'mt', '<span></span><div class="b"><i></i></div>'); $('.meters', this.root).appendChild(m); if (zone) { const u = el('u'); u.style.left = zone[0] * 100 + '%'; u.style.width = (zone[1] - zone[0]) * 100 + '%'; $('.b', m).appendChild(u); } } m.firstChild.textContent = label; const i = $('i', m); i.style.width = Math.max(0, Math.min(1, v)) * 100 + '%'; if (color) i.style.background = color; }
  removeMeter(id) { this.mt[id]?.remove(); delete this.mt[id]; }
  // timing bar: v in 0..1, zone [a,b] good, perfect [a,b]
  bar(v, zone, perfect) { const b = this.bar2d; b.style.display = 'block'; const z = b.children[0], p = b.children[1], c = b.children[2]; if (zone) { z.style.left = zone[0] * 100 + '%'; z.style.width = (zone[1] - zone[0]) * 100 + '%'; } if (perfect) { p.style.display = 'block'; p.style.left = perfect[0] * 100 + '%'; p.style.width = (perfect[1] - perfect[0]) * 100 + '%'; } else p.style.display = 'none'; c.style.left = Math.max(0, Math.min(1, v)) * 100 + '%'; }
  hideBar() { this.bar2d.style.display = 'none'; }
}

export class Screens {
  constructor(audio) { this.audio = audio; }
  loading(on, p = 0) { show('load', on); $('#load .bar i').style.width = Math.round(p * 100) + '%'; }
  hideAll() { ['menu', 'brief', 'slate', 'result', 'pause', 'over', 'replay'].forEach(i => show(i, false)); }
  menu(career, stunts, onPick, opts) {
    this.hideAll(); const m = $('#menu'); const keep = m.scrollTop; m.innerHTML = ''; show('menu');
    const c = career, nx = c.nextRank, prog = nx ? (c.stars - c.rank.need) / (nx.need - c.rank.need) : 1, next = c.next();
    const top = el('div', 'top', `<div class="logo">STUNT STAR<small>EVERY GREAT SHOT NEEDS SOMEONE TO FALL</small></div>
      <div class="stats"><div class="stat"><b>${c.rank.name}</b><span>${nx ? `${nx.need - c.stars} ★ to ${nx.name}` : 'Top of the call sheet'}</span><div class="rankbar"><i style="width:${Math.round(prog * 100)}%"></i></div></div>
      <div class="stat"><b>${c.stars} ★</b><span>Prestige</span></div><div class="stat"><b>×${c.mult.toFixed(2)}</b><span>Pay rate</span></div>
      <div class="stat money ${c.d.money < 400 ? 'neg' : ''}"><b>${money(c.d.money)}</b><span>Bank balance</span></div>
      <div class="opts"><button data-o="mute">${this.audio.muted ? 'Sound off' : 'Sound on'}</button><button data-o="voice">${this.audio.voice ? 'Director voice on' : 'Director voice off'}</button><button data-o="quality">Quality: ${['Low', 'Medium', 'High'][opts.quality()]}</button><button data-o="reset">New career</button></div></div>`);
    m.appendChild(top);
    top.querySelector('.opts').onclick = e => { const o = e.target.dataset.o; if (o) opts.act(o); };
    if (next) { const b = el('div', 'nextup', `<span>NEXT ON THE CALL SHEET</span><b>#${next.order} ${next.title}</b><em>${next.film} · ${takesText(next)}</em><button class="go">Go to set <kbd>ENTER</kbd></button>`); b.querySelector('button').onclick = () => { this.audio.click(); onPick(next); }; m.appendChild(b); this.onEnter = () => onPick(next); } else this.onEnter = null;
    TIERS.forEach((T, i) => {
      const list = stunts.filter(s => s.tier === i + 1); if (!list.length) return; const open = c.cheat || c.stars >= T.need;
      const sec = el('div', 'tier' + (open ? '' : ' locked'), `<h2>${T.name}<em>${open ? T.blurb : `Locked — earn ${T.need} ★ prestige`}</em></h2>`); const cards = el('div', 'cards');
      for (const s of list) {
        const b = c.d.best[s.id]; const cd = el('div', 'card' + (open ? '' : ' lock') + (s === next ? ' next' : ''));
        // every level's own iconic in-engine still (tools/cards.mjs); the location backdrop layers underneath as fallback
        cd.style.backgroundImage = `url(cards/${s.id}.jpg)${s.art ? `,url(tex/${s.art}.jpg)` : ''}`;
        cd.innerHTML = `<span class="yr">#${s.order} · ${s.year}</span><span class="pay">${money(c.offer(s))}</span><div class="info"><div class="t">${s.title}</div><div class="m">${open ? s.film : '???'}</div><div class="stars">${b ? stars(b.stars) : '<i>★★★★★</i>'}</div></div><span class="tag">${MODE_TAG[s.mode] || s.mode} · ${s.takes === 1 ? '1 take' : s.takes + ' takes'}</span>`;
        if (open) cd.onclick = () => { this.audio.click(); onPick(s); };
        cards.appendChild(cd);
      }
      sec.appendChild(cards); m.appendChild(sec);
    });
    m.appendChild(el('div', 'foot', `${stunts.length} stunts · Careers attempted: ${c.d.careers} · Takes shot: ${c.d.total} · Lifetime medical bills: ${money(c.d.bills)} · An affectionate homage to the stunt performers who did it for real.`));
    m.scrollTop = keep;
  }
  brief(def, career, shoot, onGo, onBack) {
    this.hideAll(); show('brief'); const p = $('#brief .panel'), g = goalsOf(def), left = career.takesLeft(shoot), n = shoot.takes.length + 1;
    const last = shoot.takes.at(-1);
    p.innerHTML = `<div class="film">#${def.order} · ${def.film} · ${def.year}</div><h1>${def.title}</h1><div class="role">${def.role || ''}</div>
      <div class="dir"><b>DIRECTOR:</b> “${last ? (last.advice[0] || 'Again. Same marks.') : def.brief}”</div>
      <div class="goals"><h4>THE SHOT</h4><ol>${g.shot.map(x => `<li>${x}</li>`).join('')}</ol>
      ${g.cut?.length ? `<h4 class="cut">CUT IF</h4><ul class="cut">${g.cut.map(x => `<li>${x}</li>`).join('')}</ul>` : ''}
      ${g.stars?.length ? `<h4 class="st">STARS FOR</h4><div class="st">${g.stars.join(' · ')}</div>` : ''}</div>
      <div class="ctl">${def.controls}</div>
      <div class="deal"><div>Fee offered<b>${money(career.offer(def))}</b></div><div class="take">Take<b>${n} / ${shoot.allowed}</b></div><div class="take">Reset cost<b>${def.takes === 1 ? '—' : money(def.resetCost)}</b></div><div class="risk">Worst case<b>-${money(career.medical(def, 0.9)).slice(1)}</b></div></div>
      ${def.takes === 1 ? '<div class="onetake">ONE TAKE ONLY — the set is destroyed in the shot. If it goes wrong, we print what we got.</div>' : left < def.takes ? `<div class="onetake soft">${left} take${left === 1 ? '' : 's'} left in the budget today.</div>` : ''}
      <button class="go" data-a="go">Ready on set &nbsp;<kbd>SPACE</kbd></button><button class="go sec" data-a="back">Back <kbd>ESC</kbd></button>`;
    const tips = $('#brief .tips'); tips.innerHTML = `<h4>COORDINATOR'S TIPS</h4><ul>${def.tips.map((t, i) => `<li style="animation-delay:${0.4 + i * 0.35}s">${t}</li>`).join('')}</ul>`;
    p.onclick = e => { const a = e.target.closest('button')?.dataset.a; if (a === 'go') onGo(); if (a === 'back') onBack(); };
    this.audio.megaphone();
  }
  slate(def, take, scene) {
    this.hideAll(); show('slate'); const st = $('#slate .stick'), ac = $('#slate .action'), board = $('#slate .board');
    board.style.display = 'block'; st.classList.remove('shut'); ac.classList.remove('on');
    $('#slate .body').innerHTML = `<div class="f w"><small>PRODUCTION</small>${def.film}</div><div class="f n"><small>SCENE</small>${scene}</div><div class="f n"><small>TAKE</small>${take}</div><div class="f n"><small>ROLL</small>A${(take * 7) % 90 + 10}</div><div class="f w" style="font-size:16px"><small>STUNT</small>${def.title}</div>`;
    this.audio.say?.('Roll camera… speed… mark it.');
    return new Promise(res => {
      setTimeout(() => { st.classList.add('shut'); this.audio.clap(); }, 900);
      setTimeout(() => { board.style.display = 'none'; ac.classList.add('on'); this.audio.megaphone(); this.audio.say?.('ACTION!', { rate: 1.1, pitch: 0.8 }); res(); }, 1400);
      setTimeout(() => show('slate', false), 2350);
    });
  }
  replay(on, info) { show('replay', on); if (on && info) $('#replay .cam').innerHTML = `<i></i>REPLAY · CAM ${info.label} · ${info.type.toUpperCase()}${info.speed < 0.95 ? ` · ${info.speed.toFixed(2)}×` : ''}`; if (on && info?.title) $('#replay .ttl').textContent = info.title; }
  // after every take: how it went, the director's notes, and what the budget allows next
  take(def, take, shoot, career, cb) {
    this.hideAll(); show('result'); const r = $('#result'), left = career.takesLeft(shoot), ok = take.ok;
    const scores = take.scores.map(s => `<div class="row"><span class="lb">${s.label}</span><span class="bar"><i style="width:${Math.round(s.v * 100)}%"></i></span><b>${Math.round(s.v * 100)}</b></div>`).join('');
    const flubs = take.flubs.map(f => `<div class="row neg"><span class="lb">✗ ${f.label}</span><b>-${Math.round(f.penalty * 100)}%</b></div>`).join('');
    const notes = take.advice.length ? take.advice : ok ? (take.stars >= 4 ? ['That is the one. Check the gate.'] : ['Good — but I know you have a better one in you.']) : ['Again, please.'];
    const btns = [];
    if (ok) { btns.push(`<button class="go" data-a="print">Print it — back to the trailer <kbd>ENTER</kbd></button>`); if (left > 0) btns.push(`<button class="go sec" data-a="again">Go again for a better one (${left} left · -${money(def.resetCost).slice(1)}) <kbd>R</kbd></button>`); }
    else if (left > 0) { btns.push(`<button class="go" data-a="again">Reset — go again (${left} left · -${money(def.resetCost).slice(1)}) <kbd>R</kbd></button>`); btns.push(`<button class="go sec" data-a="print">Wrap the day — use what we got <kbd>ENTER</kbd></button>`); }
    else btns.push(`<button class="go" data-a="print">Out of takes — we go with it <kbd>ENTER</kbd></button>`);
    btns.push(`<button class="go sec" data-a="watch">Watch the replay <kbd>V</kbd></button>`);
    r.innerHTML = `<div class="cut ${ok ? 'ok' : 'bad'}">${ok ? (take.stars >= 4 ? 'CUT! CHECK THE GATE!' : 'CUT! WE CAN USE THAT.') : 'CUT! CUT! CUT!'}</div>
      <div class="sub">Take ${take.n} of ${shoot.allowed}${ok ? '' : ` — <span style="color:#ff8a80">${take.reason}.</span>`}${take.injury ? ` Injury: ${injuryName(take.injury)}.` : ''}</div>
      <div class="box">${ok ? `<div class="stars">${stars(take.stars)}</div>` : `<div class="stars small">Footage worth keeping: ${stars(take.stars)}</div>`}${scores}${flubs}
        <div class="notes"><h4>DIRECTOR'S NOTES</h4>${notes.map(n => `<p>“${n}”</p>`).join('')}</div>
        <div class="btns">${btns.join('')}</div></div>`;
    r.onclick = e => { const a = e.target.closest('button')?.dataset.a; if (a) cb(a); };
    if (ok) this.audio.fanfare(take.stars >= 3); else this.audio.fanfare(false);
    this.audio.say?.(ok ? (take.stars >= 4 ? 'Cut! Check the gate. Beautiful.' : 'Cut. We can use that.') : notes[0], { rate: 1.02 });
    return { ok, left };
  }
  // end of shoot: the pay statement
  statement(def, shoot, st, career, cb) {
    this.hideAll(); show('result'); const r = $('#result'), best = st.best;
    const rows = st.rows.map(x => `<div class="row ${x.v >= 0 ? 'pos' : 'neg'}"><span class="lb">${x.lb}</span><b>${x.v >= 0 ? '+' : ''}${money(x.v)}</b></div>`).join('');
    r.innerHTML = `<div class="cut ${best?.ok ? 'ok' : 'bad'}">${best?.ok ? "THAT'S A WRAP!" : best ? 'WE GO WITH IT.' : 'NOTHING IN THE CAN.'}</div>
      <div class="sub">${def.title} — ${shoot.takes.length} take${shoot.takes.length === 1 ? '' : 's'}${best ? `, best was take ${best.n}` : ''}</div>
      <div class="box">${best ? `<div class="stars">${stars(st.stars)}</div>` : ''}${rows}
        <div class="row tot ${st.net >= 0 ? 'pos' : 'neg'}"><span class="lb">Shoot total</span><b>${st.net >= 0 ? '+' : ''}${money(st.net)}</b></div>
        <div class="row"><span class="lb">Bank balance</span><b style="color:${st.balance < 0 ? 'var(--red)' : '#fff'}">${money(st.balance)}</b></div>
        ${st.rankUp ? `<div class="note" style="color:var(--gold);font-size:18px">★ PROMOTED: ${st.rankUp.name.toUpperCase()} — new roles are calling ★</div>` : ''}
        <div class="btns"><button class="go" data-a="menu">Back to the trailer <kbd>ENTER</kbd></button><button class="go sec" data-a="reshoot">Book another shoot day <kbd>R</kbd></button></div>
        <div class="note">${st.firstWrap ? 'First wrap on this stunt — full fee.' : 'Repeat shoots pay 45% — but a better take still raises your prestige.'}</div></div>`;
    r.onclick = e => { const a = e.target.closest('button')?.dataset.a; if (a) cb(a); };
    if (best?.ok) setTimeout(() => this.audio.cash(), 400);
  }
  pause(on, cb) { show('pause', on); if (on) $('#pause').onclick = e => { const a = e.target.dataset.a; if (a) cb(a); }; }
  over(career, cb) {
    this.hideAll(); show('over'); const o = $('#over');
    o.innerHTML = `<h1>WASHED UP</h1><p>The hospital has your car. The bank has your house. Your agent has stopped returning calls.<br><br>You wrapped ${Object.keys(career.d.best).length} stunts, earned ${career.stars} ★ of prestige and ran up ${money(career.d.bills)} in medical bills.</p><button class="go" data-a="new">Start a new career</button>`;
    o.onclick = e => { if (e.target.dataset.a) cb(); };
  }
}
