// Career economy: money, prestige (stars), unlocks, persistence.
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
  offer(def) { const done = !!this.d.best[def.id]; return Math.round(def.pay * this.mult * (done ? 0.45 : 1) / 10) * 10; }
  expenses(def) { return Math.round((120 + def.pay * 0.07) / 10) * 10; }
  medical(def, injury) { return Math.round((def.medical ?? (400 + def.pay * 0.55)) * injury / 10) * 10; }
  // returns a statement for the result screen and applies it
  settle(def, res) {
    const d = this.d, take = (d.takes[def.id] = (d.takes[def.id] || 0) + 1), st = { rows: [], stars: 0, firstWrap: false, rankUp: null };
    const before = this.tier, offer = this.offer(def), exp = this.expenses(def);
    let net = 0;
    if (res.ok) {
      const q = res.quality; st.stars = starsFor(q); const fee = Math.round(offer * (0.12 + 0.88 * Math.pow(q, 1.4)) / 10) * 10;
      st.rows.push({ lb: `Stunt fee (${Math.round(q * 100)}% of ${money(offer)})`, v: fee }); net += fee;
      for (const b of res.bonuses) { const a = Math.round(b.amount * this.mult / 10) * 10; if (a) { st.rows.push({ lb: 'Bonus — ' + b.label, v: a }); net += a; } }
      if (take === 1 && st.stars >= 4) { const a = Math.round(offer * 0.2 / 10) * 10; st.rows.push({ lb: 'Bonus — nailed it on the first take', v: a }); net += a; }
      const prev = d.best[def.id]; if (!prev) st.firstWrap = true;
      if (!prev || st.stars > prev.stars || q > prev.q) d.best[def.id] = { stars: Math.max(st.stars, prev?.stars || 0), q: Math.max(q, prev?.q || 0) };
    } else {
      const dayRate = Math.round(offer * 0.04 / 10) * 10; st.rows.push({ lb: 'Day rate (shot unusable)', v: dayRate }); net += dayRate;
      const med = this.medical(def, res.injury || 0); if (med) { st.rows.push({ lb: 'Medical bills — ' + injuryName(res.injury), v: -med }); net -= med; d.bills += med; }
    }
    st.rows.push({ lb: 'Agent, insurance & rent', v: -exp }); net -= exp;
    d.money += net; d.total++; if (net > 0) d.earned += net; st.net = net; st.balance = d.money; st.take = take;
    if (this.tier > before) st.rankUp = TIERS[this.tier];
    st.bankrupt = d.money < 0; this.save(); return st;
  }
}
export const injuryName = i => i >= 0.85 ? 'intensive care' : i >= 0.65 ? 'multiple fractures' : i >= 0.45 ? 'broken bones' : i >= 0.25 ? 'sprains & stitches' : i > 0 ? 'bruises & ice packs' : 'none';
