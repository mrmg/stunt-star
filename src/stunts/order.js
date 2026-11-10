// Career order: small, straight-line stunts first; complex and big-spectacle shoots (trucks, tanks, aircraft) last.
// Pay, tier and the production's take budget are derived from position here, so stunt files only need gameplay.
export const ORDER = [
  // Tier 1 — Background Extra: hold a speed, go straight, one simple skill
  'smokey', 'general_lee', 'great_escape', 'steamboat', 'butch_cliff', 'italian_job', 'boat_jump', 'raiders_boulder', 'lethal_weapon', 'blues_brothers',
  // Tier 2 — Stunt Trainee: steering, traffic, first timing tests
  'safety_last', 'enter_dragon', 'temple_door', 'croc_run', 'bullitt', 'golden_gun', 'thelma', 'french_connection', 'police_story', 'diamonds',
  // Tier 3 — Stunt Performer: precision and nerve
  'rumble_bronx', 'gone60', 'bttf', 'oldboy', 't2_canal', 'goldeneye_dam', 'raiders_truck', 'die_hard', 'who_am_i', 'ronin',
  // Tier 4 — Stunt Double: hard skills, tight windows
  'matrix_dodge', 'casino_crane', 'mi_vault', 'kill_bill', 'fast_train', 'matrix_freeway', 'point_break', 'spy_ski', 'supercop', 'spiderman_tray',
  // Tier 5 — Stunt Coordinator: big rigs, big sets, big money
  'bourne', 'inception', 'death_proof', 'speed_bus', 'casino_roll', 'road_warrior', 'goldeneye_tank', 'hooper', 'octopussy', 'mi_burj', 't2_heli',
  // Tier 6 — Living Legend: the most famous (and most expensive) stunts ever filmed
  'dark_knight', 'top_gun', 'fury_road', 'fall_guy', 'furious7', 'mi_halo', 'mi_a400', 'maverick', 'cliffhanger', 'mi_cliff',
];
const TIER_AT = [0, 10, 20, 30, 40, 51];
// How many takes the production can afford. Cheap early stunts: plenty; destroyed-in-the-shot hardware: one and done.
const TAKES_BY_TIER = [5, 4, 3, 3, 2, 1];
const TAKES = { bttf: 4, dark_knight: 1, fall_guy: 1, furious7: 1, hooper: 1, mi_cliff: 1, mi_halo: 1, mi_a400: 1, cliffhanger: 1,
  top_gun: 2, maverick: 2, fury_road: 2, casino_roll: 2, road_warrior: 2, goldeneye_tank: 2, speed_bus: 2, t2_heli: 2, octopussy: 2, mi_burj: 2, inception: 2, death_proof: 2, bourne: 3 };
const RESET_K = [0.03, 0.04, 0.06, 0.08, 0.12, 0.16];

export function applyOrder(stunts) {
  const byId = new Map(stunts.map(s => [s.id, s])), out = [];
  ORDER.forEach((id, i) => {
    const d = byId.get(id); if (!d) return; byId.delete(id);
    const tier = TIER_AT.filter(a => i >= a).length;
    d.order = i + 1; d.tier = tier;
    d.pay = Math.round(1500 * Math.pow(1.066, i) / 100) * 100;
    d.takes = d.takes ?? TAKES[id] ?? TAKES_BY_TIER[tier - 1];
    d.resetCost = d.resetCost ?? Math.max(50, Math.round(d.pay * RESET_K[tier - 1] / 10) * 10);
    out.push(d);
  });
  for (const d of byId.values()) { d.order = out.length + 1; d.tier = 6; d.takes ??= 1; d.resetCost ??= Math.round(d.pay * 0.15); out.push(d); console.warn('[ss] stunt missing from ORDER', d.id); }
  return out;
}
