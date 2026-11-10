// Career economy: money, prestige (stars), unlocks, persistence, and per-shoot take budgets.
const KEY = 'stuntstar_save_v1';
export const TIERS = [
  { name: 'Background Extra', need: 0, blurb: 'Nobody knows your name. Yet.' },
  { name: 'Stunt Trainee', need: 10, blurb: 'The coordinator has stopped calling you "kid".' },
  { name: 'Stunt Performer', need: 26, blurb: 'You have a union card and a chiropractor.' },
  { name: 'Stunt Double', need: 48, blurb: 'The star takes the credit. You take the hits.' },
  { name: 'Stunt Coordinator', need: 76, blurb: 'Studios insure the picture around you.' },
  { name: 'Living Legend', need: 108, blurb: 'They will name the award after you.' },
];
export const starsFor = q => q >= 0.93 ? 5 : q >= 0.8 ? 4 : q >= 0.62 ? 3 : q >= 0.42 ? 2 : 1;
export const money = n => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');
const r10 = n => Math.round(n / 10) * 10;
// A failed take still has usable footage; "we go with it" pays on this fraction of its partial quality.
export const SALVAGE = 0.5;

export class Career {
  constructor(stunts) { this.stunts = stunts; this.load(); }
  fresh() { return { money: 1500, best: {}, takes: {}, total: 0, earned: 0, bills: 0, careers: (this.d?.careers || 0) + 1 }; }
  load() { try { this.d = JSON.parse(localStorage.getItem(KEY)) || this.fresh(); } catch { this.d = this.fresh(); } }
  save() { localStorage.setItem(KEY, JSON.stringify(this.d)); }
  reset() { this.d = this.fresh(); this.save(); }
  get stars() { return Object.values(this.d.best).reduce((a, b) => a + b.stars, 0); }
  get tier() { let t = 0; TIERS.forEach((T, i) => { if (this.stars >= T.need) t = i; }); return t; }
  get rank() { return TIERS[this.tier]; }
  get nextRank() { return TIERS[this.tier + 1] || null; }
  get mult() { return 1 + this.stars * 0.012; }
  unlocked(def) { return this.cheat || this.stars >= TIERS[def.tier - 1].need; }
  // the first stunt in order you have not wrapped yet (menu highlights it)
  next() { return this.stunts.find(s => this.unlocked(s) && !this.d.best[s.id]) || null; }
  offer(def) { const done = !!this.d.best[def.id]; return r10(def.pay * this.mult * (done ? 0.45 : 1)); }
  expenses(def) { return r10(80 + def.pay * 0.05); }
  medical(def, injury) { return r10((def.medical ?? (150 + def.pay * 0.25)) * injury); }
  // ---- shoots: one visit to a set, up to def.takes takes, paid on the best one
  startShoot(def) { return { id: def.id, allowed: def.takes, takes: [], done: false }; }
  takesLeft(shoot) { return shoot.allowed - shoot.takes.length; }
  recordTake(def, shoot, res) {
    const ok = !!res.ok, q = ok ? res.quality : res.quality * SALVAGE;
    const t = { n: shoot.takes.length + 1, ok, q, rawQ: res.quality, stars: ok ? starsFor(q) : Math.min(2, starsFor(q)), reason: res.reason, injury: ok ? 0 : (res.injury || 0), scores: res.scores || [], bonuses: ok ? res.bonuses || [] : [], flubs: res.flubs || [], advice: res.advice || [] };
    t.med = this.medical(def, t.injury); shoot.takes.push(t);
    this.d.takes[def.id] = (this.d.takes[def.id] || 0) + 1; this.d.total++; this.save();
    return t;
  }
  bestTake(shoot) { return shoot.takes.reduce((b, t) => (!b || (t.ok && !b.ok) || (t.ok === b.ok && t.q > b.q)) ? t : b, null); }
  // walkedOff: player left mid-shoot without printing anything (no fee for a failed best take)
  settleShoot(def, shoot, { walkedOff = false } = {}) {
    const d = this.d, before = this.tier, offer = this.offer(def), st = { rows: [], stars: 0, firstWrap: false, rankUp: null };
    const best = this.bestTake(shoot); let net = 0;
    if (best && (best.ok || !walkedOff)) {
      const k = 0.12 + 0.88 * Math.pow(best.q, 1.4), fee = r10(offer * k);
      st.rows.push({ lb: best.ok ? `Stunt fee — take ${best.n} (${Math.round(best.q * 100)}% of ${money(offer)})` : `We go with take ${best.n} anyway (${Math.round(best.q * 100)}%)`, v: fee }); net += fee;
      for (const b of best.bonuses) { const a = r10(b.amount * this.mult); if (a) { st.rows.push({ lb: 'Bonus — ' + b.label, v: a }); net += a; } }
      if (best.ok && best.n === 1 && best.stars >= 4) { const a = r10(offer * 0.2); st.rows.push({ lb: 'Bonus — nailed it on the first take', v: a }); net += a; }
      st.stars = best.stars; st.ok = best.ok;
      const prev = d.best[def.id]; if (!prev) st.firstWrap = true;
      if (!prev || best.stars > prev.stars || best.q > prev.q) d.best[def.id] = { stars: Math.max(best.stars, prev?.stars || 0), q: Math.max(best.q, prev?.q || 0) };
    } else st.rows.push({ lb: 'No usable take — no fee', v: 0 });
    const resets = Math.max(0, shoot.takes.length - 1); if (resets) { const c = resets * def.resetCost; st.rows.push({ lb: `Resets (${resets} × ${money(def.resetCost)})`, v: -c }); net -= c; }
    for (const t of shoot.takes) if (t.med) { st.rows.push({ lb: `Medical — take ${t.n}: ${injuryName(t.injury)}`, v: -t.med }); net -= t.med; d.bills += t.med; }
    const exp = this.expenses(def); st.rows.push({ lb: 'Agent, insurance & rent', v: -exp }); net -= exp;
    d.money += net; if (net > 0) d.earned += net; st.net = net; st.balance = d.money; st.best = best; st.takes = shoot.takes.length;
    if (this.tier > before) st.rankUp = TIERS[this.tier];
    st.bankrupt = d.money < 0; shoot.done = true; this.save(); return st;
  }
}
export const injuryName = i => i >= 0.85 ? 'intensive care' : i >= 0.65 ? 'multiple fractures' : i >= 0.45 ? 'broken bones' : i >= 0.25 ? 'sprains & stitches' : i > 0 ? 'bruises & ice packs' : 'none';
