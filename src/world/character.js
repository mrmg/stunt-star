import * as THREE from 'three';
import { skinned } from '../core/assets.js';

// Rig-agnostic procedural animation. Poses are authored as limb directions in body space:
//   [out, up, fwd] where out = away from the body midline, fwd = the way the character faces.
// Whole-body orientation (flips, lying, diving) is `body:[pitch(fwd+), roll(right+), yaw]` about the hips.
const Q = () => new THREE.Quaternion(), V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const _e = new THREE.Euler(), _q1 = Q(), _q2 = Q(), _v1 = V(), _v2 = V(), _m = new THREE.Matrix4();
const _ik = Array.from({ length: 8 }, () => V()), _qp = Q();
const eq = (out, p, y, r) => out.setFromEuler(_e.set(-p, y, -r, 'YXZ'));

const BASE = {
  hip: [0, 0, 0, 0], sp: [0, 0, 0], hd: [0, 0, 0], body: [0, 0, 0],
  aR: [0.2, -1, 0.03, 0.12, -1, 0.18], aL: [0.2, -1, 0.03, 0.12, -1, 0.18],
  lR: [0.07, -1, 0.02, 0.04, -1, -0.04], lL: [0.07, -1, 0.02, 0.04, -1, -0.04], ft: [0, 0],
};
const P = o => ({ ...BASE, ...o });
export const POSES = {
  stand: P({}),
  idle: P({ aR: [0.18, -1, 0.0, 0.1, -1, 0.22], aL: [0.18, -1, 0.0, 0.1, -1, 0.22] }),
  ready: P({ hip: [-0.1, 0.12, 0, 0], sp: [0.15, 0, 0], aR: [0.3, -0.9, 0.15, 0.0, -0.4, 0.9], aL: [0.3, -0.9, 0.15, 0.0, -0.4, 0.9], lR: [0.15, -1, 0.2, 0.05, -1, -0.25], lL: [0.15, -1, -0.05, 0.05, -1, -0.3] }),
  jump: P({ sp: [0.1, 0, 0], aR: [0.35, 0.6, 0.6, 0.1, 1, 0.3], aL: [0.35, 0.2, 0.7, 0.1, 0.8, 0.5], lR: [0.08, -0.55, 0.85, 0.02, -1, -0.5], lL: [0.08, -1, -0.25, 0.02, -0.7, -0.75] }),
  leap: P({ body: [0.25, 0, 0], sp: [0.1, 0, 0], aR: [0.5, 0.5, 0.7, 0.2, 0.7, 0.7], aL: [0.5, 0.7, 0.3, 0.2, 1, 0.3], lR: [0.08, -0.5, 1, 0.02, -0.9, 0.3], lL: [0.08, -0.8, -0.7, 0.02, -0.3, -1] }),
  fall: P({ aR: [0.9, 0.5, 0.1, 0.4, 1, 0.2], aL: [0.9, 0.5, 0.1, 0.4, 1, 0.2], lR: [0.2, -1, 0.3, 0.05, -1, -0.4], lL: [0.2, -1, 0.0, 0.05, -1, -0.5] }),
  land: P({ hip: [-0.45, 0.35, 0, 0], sp: [0.4, 0, 0], aR: [0.5, -0.7, 0.5, 0.2, -0.6, 0.8], aL: [0.5, -0.7, 0.5, 0.2, -0.6, 0.8], lR: [0.2, -0.5, 0.9, 0.05, -1, -0.55], lL: [0.2, -0.5, 0.9, 0.05, -1, -0.55] }),
  slide: P({ hip: [-0.72, 0, 0, 0], body: [-1.15, 0, 0.25], sp: [0.35, 0, 0], hd: [0.5, 0, 0], aR: [0.7, -0.7, -0.4, 0.3, -0.9, -0.4], aL: [0.5, 0.3, 0.6, 0.2, 0.6, 0.7], lR: [0.06, -1, 0.1, 0.02, -1, 0.0], lL: [0.25, -0.75, 0.7, 0.05, -0.5, -1] }),
  dive: P({ hip: [0, 0, 0, 0], body: [1.45, 0, 0], hd: [-0.6, 0, 0], aR: [0.18, 1, 0.1, 0.05, 1, 0.1], aL: [0.18, 1, 0.1, 0.05, 1, 0.1], lR: [0.08, -1, -0.06, 0.03, -1, -0.1], lL: [0.08, -1, -0.06, 0.03, -1, -0.1] }),
  swan: P({ body: [1.2, 0, 0], hd: [-0.7, 0, 0], sp: [-0.25, 0, 0], aR: [1, 0.25, -0.15, 1, 0.2, -0.2], aL: [1, 0.25, -0.15, 1, 0.2, -0.2], lR: [0.06, -1, -0.2, 0.02, -1, -0.25], lL: [0.06, -1, -0.2, 0.02, -1, -0.25] }),
  freefall: P({ body: [1.5, 0, 0], sp: [-0.3, 0, 0], hd: [-0.7, 0, 0], aR: [1, 0.35, -0.25, 0.25, 1, -0.05], aL: [1, 0.35, -0.25, 0.25, 1, -0.05], lR: [0.4, -1, -0.3, 0.1, -0.5, -1], lL: [0.4, -1, -0.3, 0.1, -0.5, -1] }),
  track: P({ body: [2.35, 0, 0], hd: [-0.3, 0, 0], aR: [0.2, -1, -0.1, 0.12, -1, -0.12], aL: [0.2, -1, -0.1, 0.12, -1, -0.12], lR: [0.06, -1, -0.03, 0.03, -1, -0.05], lL: [0.06, -1, -0.03, 0.03, -1, -0.05] }),
  tuck: P({ hip: [-0.1, 0, 0, 0], sp: [0.9, 0, 0], hd: [0.4, 0, 0], aR: [0.25, -0.5, 0.9, -0.3, -0.5, 0.6], aL: [0.25, -0.5, 0.9, -0.3, -0.5, 0.6], lR: [0.12, 0.3, 1, 0.03, -1, -0.5], lL: [0.12, 0.3, 1, 0.03, -1, -0.5] }),
  hang: P({ aR: [0.22, 1, 0.08, 0.02, 1, 0.05], aL: [0.22, 1, 0.08, 0.02, 1, 0.05], hd: [-0.35, 0, 0], lR: [0.07, -1, 0.12, 0.03, -1, -0.25], lL: [0.07, -1, -0.02, 0.03, -1, -0.35] }),
  hang1: P({ sp: [0, 0, 0.15], aR: [0.15, 1, 0.08, 0.0, 1, 0.05], aL: [0.6, -0.7, 0.1, 0.3, -0.9, 0.3], hd: [-0.3, 0, 0], lR: [0.07, -1, 0.2, 0.03, -1, -0.3], lL: [0.12, -1, -0.1, 0.03, -1, -0.45] }),
  cling: P({ sp: [0.2, 0, 0], aR: [0.5, 0.8, 0.5, -0.1, 0.6, 0.8], aL: [0.5, 0.8, 0.5, -0.1, 0.6, 0.8], lR: [0.35, -0.6, 0.7, 0.05, -1, -0.5], lL: [0.35, -0.9, 0.4, 0.05, -1, -0.4] }),
  flag: P({ body: [1.35, 0, 0], hd: [-0.6, 0, 0], aR: [0.2, 1, 0.1, 0.03, 1, 0.08], aL: [0.2, 1, 0.1, 0.03, 1, 0.08], lR: [0.12, -1, -0.12, 0.05, -1, -0.2], lL: [0.12, -1, 0.02, 0.05, -1, -0.12] }),
  sit: P({ hip: [-0.42, 0, 0, 0], sp: [-0.08, 0, 0], aR: [0.22, -0.55, 0.8, -0.08, 0.05, 1], aL: [0.22, -0.55, 0.8, -0.08, 0.05, 1], lR: [0.16, -0.12, 1, 0.04, -1, 0.35], lL: [0.16, -0.12, 1, 0.04, -1, 0.35] }),
  drive: P({ hip: [-0.42, 0, 0, 0], sp: [-0.12, 0, 0], aR: [0.22, -0.55, 0.8, -0.08, 0.05, 1], aL: [0.22, -0.55, 0.8, -0.08, 0.05, 1], lR: [0.12, 0.08, 1, 0.03, -0.45, 0.9], lL: [0.12, 0.08, 1, 0.03, -0.45, 0.9] }),
  bike: P({ hip: [-0.2, 0.25, 0, 0], sp: [0.4, 0, 0], hd: [-0.5, 0, 0], aR: [0.28, -0.5, 0.9, 0.0, -0.25, 1], aL: [0.28, -0.5, 0.9, 0.0, -0.25, 1], lR: [0.3, -0.45, 0.9, 0.0, -1, -0.35], lL: [0.3, -0.45, 0.9, 0.0, -1, -0.35] }),
  bikeSport: P({ hip: [-0.2, 0.5, 0, 0], sp: [0.65, 0, 0], hd: [-1.0, 0, 0], lR: [0.3, -0.35, 0.9, 0.0, -1, -0.5], lL: [0.3, -0.35, 0.9, 0.0, -1, -0.5] }),
  bikeStand: P({ hip: [-0.05, 0.3, 0, 0], sp: [0.35, 0, 0], hd: [-0.5, 0, 0], aR: [0.28, -0.75, 0.7, 0.0, -0.6, 0.8], aL: [0.28, -0.75, 0.7, 0.0, -0.6, 0.8], lR: [0.28, -0.85, 0.5, 0.0, -1, -0.3], lL: [0.28, -0.85, 0.5, 0.0, -1, -0.3] }),
  ski: P({ hip: [-0.38, 0.5, 0, 0], sp: [0.55, 0, 0], hd: [-0.8, 0, 0], aR: [0.3, -0.6, 0.6, 0.1, -0.2, 0.9], aL: [0.3, -0.6, 0.6, 0.1, -0.2, 0.9], lR: [0.14, -0.55, 0.85, 0.03, -1, -0.55], lL: [0.14, -0.55, 0.85, 0.03, -1, -0.55] }),
  guard: P({ hip: [-0.08, 0.05, -0.3, 0], sp: [0.12, 0.25, 0], aR: [0.3, -0.75, 0.45, -0.25, 0.85, 0.5], aL: [0.25, -0.6, 0.65, -0.2, 0.8, 0.65], lR: [0.15, -1, -0.3, 0.05, -1, -0.3], lL: [0.12, -1, 0.35, 0.03, -1, -0.15] }),
  punchR: P({ hip: [-0.1, 0.1, 0.45, 0], sp: [0.15, 0.4, 0], aR: [0.0, 0.08, 1, 0.0, 0.05, 1], aL: [0.3, -0.7, 0.3, -0.2, 0.9, 0.4], lR: [0.12, -1, -0.5, 0.05, -0.8, -0.6], lL: [0.12, -0.9, 0.5, 0.03, -1, -0.2] }),
  punchL: P({ hip: [-0.1, 0.1, -0.45, 0], sp: [0.15, -0.4, 0], aL: [0.0, 0.08, 1, 0.0, 0.05, 1], aR: [0.3, -0.7, 0.3, -0.2, 0.9, 0.4], lL: [0.12, -1, -0.5, 0.05, -0.8, -0.6], lR: [0.12, -0.9, 0.5, 0.03, -1, -0.2] }),
  kick: P({ hip: [0, -0.3, 0.2, 0], sp: [-0.1, 0, 0], aR: [0.5, -0.7, -0.3, 0.2, -0.3, 0.8], aL: [0.6, -0.4, 0.3, 0.0, 0.8, 0.5], lR: [0.1, 0.22, 1, 0.0, 0.25, 1], lL: [0.1, -1, -0.15, 0.03, -1, -0.1] }),
  highkick: P({ hip: [0, -0.45, 0.3, 0.1], sp: [-0.15, 0, 0], aR: [0.6, -0.6, -0.4, 0.2, -0.3, 0.8], aL: [0.6, -0.2, 0.3, 0.0, 0.8, 0.5], lR: [0.15, 0.85, 1, 0.05, 0.9, 1], lL: [0.1, -1, -0.1, 0.03, -1, -0.1] }),
  block: P({ hip: [-0.1, 0, 0, 0], sp: [0.1, 0, 0], aR: [0.3, -0.3, 0.8, -0.35, 1, 0.25], aL: [0.3, -0.3, 0.8, -0.35, 1, 0.25], lR: [0.2, -1, -0.2, 0.05, -1, -0.3], lL: [0.2, -1, 0.3, 0.03, -1, -0.2] }),
  duck: P({ hip: [-0.5, 0.5, 0, 0], sp: [0.5, 0, 0], hd: [-0.5, 0, 0], aR: [0.4, -0.6, 0.6, -0.2, 0.5, 0.8], aL: [0.4, -0.6, 0.6, -0.2, 0.5, 0.8], lR: [0.25, -0.25, 1, 0.05, -1, -0.7], lL: [0.25, -0.25, 1, 0.05, -1, -0.7] }),
  lean: P({ hip: [-0.35, 0, 0, 0], body: [-1.15, 0, 0], sp: [-0.1, 0, 0], hd: [0.3, 0, 0], aR: [1, -0.3, -0.5, 0.6, -0.7, -0.4], aL: [1, -0.1, -0.4, 0.6, 0.3, -0.6], lR: [0.2, -1, 0.75, 0.05, -0.25, -1], lL: [0.2, -1, 0.75, 0.05, -0.25, -1] }),
  hit: P({ hip: [-0.05, -0.3, 0, 0], sp: [-0.35, 0.2, 0], hd: [-0.4, 0.3, 0], aR: [0.8, -0.3, 0.3, 0.4, 0.3, 0.6], aL: [0.9, 0.1, 0.1, 0.5, 0.6, 0.3], lR: [0.15, -1, 0.3, 0.05, -1, -0.2], lL: [0.15, -1, -0.3, 0.03, -1, -0.4] }),
  lie: P({ hip: [-0.86, 0, 0, 0], body: [-1.5, 0, 0], aR: [1, -0.4, -0.1, 0.8, -0.6, 0.1], aL: [0.9, 0.5, -0.1, 0.6, 0.8, 0.0], lR: [0.25, -1, 0.05, 0.1, -1, 0.0], lL: [0.12, -1, 0.15, 0.05, -1, -0.2] }),
  prone: P({ hip: [-0.84, 0, 0, 0], body: [1.5, 0, 0], hd: [-0.6, 0, 0], aR: [0.4, 1, 0.1, 0.1, 1, 0.1], aL: [0.4, 1, 0.1, 0.1, 1, 0.1], lR: [0.12, -1, -0.03, 0.05, -1, -0.03], lL: [0.12, -1, -0.03, 0.05, -1, -0.03] }),
  cheer: P({ sp: [-0.1, 0, 0], hd: [-0.2, 0, 0], aR: [0.5, 1, 0.1, 0.25, 1, 0.05], aL: [0.5, 1, 0.1, 0.25, 1, 0.05] }),
  point: P({ aR: [0.1, 0.1, 1, 0.05, 0.12, 1], sp: [0, 0.2, 0] }),
  wire: P({ body: [1.5, 0, 0], hd: [-0.7, 0, 0], sp: [-0.15, 0, 0], aR: [1, 0.15, 0.1, 1, 0.1, 0.15], aL: [1, 0.15, 0.1, 1, 0.1, 0.15], lR: [0.45, -1, -0.12, 0.3, -1, -0.3], lL: [0.45, -1, -0.12, 0.3, -1, -0.3] }),
  surf: P({ hip: [-0.25, 0.2, 1.2, 0], sp: [0.2, -0.9, 0], hd: [0, -0.3, 0], aR: [1, -0.1, 0.1, 1, 0.0, 0.2], aL: [1, -0.2, 0.0, 1, -0.1, 0.1], lR: [0.3, -1, 0.3, 0.1, -1, -0.4], lL: [0.3, -1, 0.3, 0.1, -1, -0.4] }),
  crouch: P({ hip: [-0.4, 0.3, 0, 0], sp: [0.35, 0, 0], hd: [-0.4, 0, 0], aR: [0.35, -0.8, 0.45, 0.0, -0.2, 0.9], aL: [0.35, -0.8, 0.45, 0.0, -0.2, 0.9], lR: [0.2, -0.3, 1, 0.05, -1, -0.65], lL: [0.2, -0.75, 0.3, 0.05, -0.35, -1] }),
  tray: P({ sp: [0.1, 0, 0], aR: [0.25, -0.75, 0.55, -0.15, 0.0, 1], aL: [0.25, -0.75, 0.55, -0.15, 0.0, 1] }),
  hoseswing: P({ body: [0.3, 0, 0], aR: [0.15, 1, 0.3, 0.0, 1, 0.2], aL: [0.15, 1, 0.3, 0.0, 1, 0.2], lR: [0.1, -0.8, 0.7, 0.03, -1, -0.2], lL: [0.1, -0.9, 0.5, 0.03, -1, -0.3] }),
  brace: P({ hip: [-0.25, 0.3, 0, 0], sp: [0.4, 0, 0], aR: [0.3, -0.2, 0.9, 0.1, -0.1, 1], aL: [0.3, -0.2, 0.9, 0.1, -0.1, 1], lR: [0.25, -0.8, 0.5, 0.05, -1, -0.5], lL: [0.25, -1, -0.2, 0.05, -0.8, -0.7] }),
};

const S = Math.sin, C = Math.cos;
export const CYCLES = {
  run(ph, k = 1) {
    const a = 0.85 * k * S(ph), b = 0.25 + 1.35 * k * Math.max(0, C(ph)), a2 = -a, b2 = 0.25 + 1.35 * k * Math.max(0, -C(ph)), s = 0.75 * k * S(ph);
    return { ...BASE, hip: [-0.05 + 0.05 * Math.abs(S(ph)), 0.16 + 0.1 * k, 0.12 * S(ph), 0], sp: [0.12 * k, -0.2 * S(ph), 0], hd: [-0.15, 0, 0],
      lR: [0.05, -C(a), S(a), 0.02, -C(a - b), S(a - b)], lL: [0.05, -C(a2), S(a2), 0.02, -C(a2 - b2), S(a2 - b2)],
      aR: [0.14, -C(-s), S(-s), -0.05, -C(-s + 1.5), S(-s + 1.5)], aL: [0.14, -C(s), S(s), -0.05, -C(s + 1.5), S(s + 1.5)] };
  },
  walk(ph) { return CYCLES.run(ph, 0.45); },
  climb(ph) {
    const u = S(ph), d = -u;
    return { ...BASE, sp: [0.1, 0.12 * u, 0], hd: [-0.4, 0, 0],
      aR: [0.3, 0.75 + 0.3 * u, 0.5, 0.0, 0.9 + 0.2 * u, 0.45], aL: [0.3, 0.75 + 0.3 * d, 0.5, 0.0, 0.9 + 0.2 * d, 0.45],
      lR: [0.3, -0.65 - 0.3 * d, 0.6 - 0.2 * d, 0.05, -1, -0.45], lL: [0.3, -0.65 - 0.3 * u, 0.6 - 0.2 * u, 0.05, -1, -0.45] };
  },
  flail(t) {
    return { ...BASE, sp: [0.3 * S(t * 7), 0.3 * S(t * 5), 0.2 * C(t * 6)], hd: [0.2 * S(t * 9), 0, 0],
      aR: [0.8 + 0.3 * S(t * 11), S(t * 9), C(t * 9), 0.5, S(t * 9 + 1), C(t * 9 + 1)], aL: [0.8 + 0.3 * C(t * 10), S(t * 8 + 2), C(t * 8 + 2), 0.5, S(t * 8 + 3), C(t * 8 + 3)],
      lR: [0.25, -0.8, 0.6 * S(t * 10), 0.05, -1, -0.6 + 0.5 * C(t * 10)], lL: [0.25, -0.8, 0.6 * S(t * 10 + 3), 0.05, -1, -0.6 + 0.5 * C(t * 10 + 3)] };
  },
  swim(t) { const p = POSES.freefall; return { ...p, aR: [1, 0.35 + 0.15 * S(t * 3), -0.25, 0.25, 1, -0.05 + 0.1 * S(t * 3)], aL: [1, 0.35 + 0.15 * C(t * 3), -0.25, 0.25, 1, -0.05 + 0.1 * C(t * 3)] }; },
  idle(t) { const p = POSES.idle; return { ...p, sp: [0.02 * S(t * 1.6), 0.03 * S(t * 0.7), 0], hip: [0.005 * S(t * 1.6), 0, 0, 0.02 * S(t * 0.5)] }; },
  guard(t) { const p = POSES.guard; return { ...p, hip: [p.hip[0] + 0.03 * S(t * 7), p.hip[1], p.hip[2], 0] }; },
  hang(t) { const p = POSES.hang; return { ...p, body: [0.12 * S(t * 2.2), 0.05 * S(t * 1.7), 0], lR: [0.07, -1, 0.12 + 0.2 * S(t * 2.2 + 1), 0.03, -1, -0.25], lL: [0.07, -1, -0.02 + 0.2 * S(t * 2.2 + 2), 0.03, -1, -0.35] }; },
  cheer(t) { const p = POSES.cheer; return { ...p, hip: [0.06 * Math.abs(S(t * 7)), 0, 0, 0], aR: [0.5 + 0.2 * S(t * 9), 1, 0.1, 0.25, 1, 0.05], aL: [0.5 + 0.2 * C(t * 9), 1, 0.1, 0.25, 1, 0.05] }; },
};

const KEYS = ['hip', 'sp', 'hd', 'body', 'aR', 'aL', 'lR', 'lL', 'ft'];
const LIMB = { aR: ['RightArm', 'RightForeArm', 'RightHand', 1], aL: ['LeftArm', 'LeftForeArm', 'LeftHand', -1], lR: ['RightUpLeg', 'RightLeg', 'RightFoot', 1], lL: ['LeftUpLeg', 'LeftLeg', 'LeftFoot', -1] };

export class Character {
  constructor(id, { height = 1.8, shadow = true } = {}) {
    this.id = id; this.root = new THREE.Group(); this.pivot = new THREE.Group(); this.root.add(this.pivot);
    this.heading = 0; this.cur = JSON.parse(JSON.stringify(BASE)); this.target = BASE; this.cycle = null; this.phase = 0; this.rate = 0; this.k = 12; this.t = Math.random() * 10;
    this.spin = V(); this.spinAng = V(); this.bones = {}; this.ok = false; this.height = height;
    const sk = skinned(id) || skinned('ch_stunt');
    if (!sk) { // capsule fallback
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, height - 0.56, 6, 12), new THREE.MeshStandardMaterial({ color: 0xcc3333, roughness: 0.6 })); m.castShadow = true; m.position.y = 0; this.hipH = height * 0.53; this.pivot.position.y = this.hipH; this.pivot.add(m); m.position.y = height / 2 - this.hipH; return;
    }
    const inner = this.inner = sk.scene; inner.rotation.y = Math.PI; // generated rigs face +Z; game forward is -Z
    inner.traverse(o => { if (o.isMesh) { o.castShadow = shadow; o.receiveShadow = true; o.frustumCulled = false; } if (o.isBone) this.bones[o.name] = o; });
    const holder = new THREE.Group(); holder.add(inner); holder.updateMatrixWorld(true);
    const B = this.bones; if (!B.Hips) { this.pivot.add(holder); return; }
    // normalise height using head bone
    const hp = V(), tp = V(); (B.head_end || B.Head).getWorldPosition(hp); const footY = Math.min(B.LeftFoot.getWorldPosition(tp).y, B.RightFoot.getWorldPosition(_v1).y);
    const top = hp.y, s = height / Math.max(0.2, top * 1.0); inner.scale.multiplyScalar(s); holder.updateMatrixWorld(true);
    // rest data in character space
    this.rest = {}; for (const n in B) { const b = B[n]; const q = Q(); b.getWorldQuaternion(q); const p = V(); b.getWorldPosition(p); this.rest[n] = { q, p, b }; }
    const dirTo = (a, b) => this.rest[b].p.clone().sub(this.rest[a].p).normalize();
    for (const k in LIMB) { const [u, f, h] = LIMB[k]; this.rest[u].dir = dirTo(u, f); this.rest[f].dir = dirTo(f, h); }
    this.rest.LeftFoot.dir = dirTo('LeftFoot', 'LeftToeBase'); this.rest.RightFoot.dir = dirTo('RightFoot', 'RightToeBase');
    this.hipH = this.rest.Hips.p.y; this.hipParentQ = Q(); B.Hips.parent.getWorldQuaternion(this.hipParentQ); this.hipParentInv = new THREE.Matrix4().copy(B.Hips.parent.matrixWorld).invert();
    this.legLen = this.hipH - this.rest.LeftFoot.p.y;
    // pivot sits at hip height; holder shifted back down so pivot rotation spins about the hips
    this.pivot.position.y = this.hipH; holder.position.y = -this.hipH; this.pivot.add(holder); this.ok = true;
    this.world = {}; for (const n in B) this.world[n] = Q();
    this.apply(1);
  }
  setPose(p, blend = 0.15) { this.cycle = null; this.target = typeof p === 'string' ? (POSES[p] || BASE) : { ...BASE, ...p }; this.k = blend <= 0 ? 1e6 : 2.5 / blend; if (blend <= 0) this.snap(); return this; }
  setCycle(name, rate = 1, arg) { if (this.cycle !== name) { this.k = 14; } this.cycle = name; this.rate = rate; this.cycleArg = arg; return this; }
  snap() { for (const k of KEYS) { const t = this.target[k] || BASE[k]; for (let i = 0; i < t.length; i++) this.cur[k][i] = t[i]; } }
  tumble(x = 0, y = 0, z = 0) { this.spin.set(x, y, z); return this; }
  update(dt) {
    this.t += dt; this.root.rotation.y = this.heading;
    let T = this.target;
    if (this.cycle) { this.phase += this.rate * dt; const f = CYCLES[this.cycle]; T = f(this.cycle === 'run' || this.cycle === 'walk' || this.cycle === 'climb' ? this.phase : this.t * (this.rate || 1), this.cycleArg); if (this.over) T = { ...T, ...this.over }; }
    const a = 1 - Math.exp(-this.k * dt);
    for (const k of KEYS) { const t = T[k] || BASE[k], c = this.cur[k]; for (let i = 0; i < t.length; i++) c[i] += (t[i] - c[i]) * a; }
    if (this.spin.lengthSq() > 0) this.spinAng.addScaledVector(this.spin, dt); else if (this.spinAng.lengthSq() > 0 && this.settle) this.spinAng.multiplyScalar(Math.exp(-8 * dt));
    this.apply(); if (this.ik) this.solveIK(); this.post?.(dt); // post: attach props to bones after the pose is final
  }
  // Two-bone arm IK: after the pose is applied, pull each hand onto a world-space target (e.g. handlebar grips).
  // ik = { aR: Object3D, aL: Object3D, pole?: [out, up, fwd] }. Targets parented to the same vehicle body, so no lag.
  solveIK() {
    const ik = this.ik; if (!this.ok || !this.root.visible) return;
    this.root.updateWorldMatrix(true, true);
    const pl = ik.pole || [0.7, -0.75, -0.25];
    for (const k of ['aR', 'aL']) {
      const tgt = ik[k]; if (!tgt) continue; const [u, f, h, side] = LIMB[k], U = this.bones[u], F = this.bones[f], H = this.bones[h]; if (!U || !F || !H) continue;
      const S = U.getWorldPosition(_ik[0]), E0 = F.getWorldPosition(_ik[1]), H0 = H.getWorldPosition(_ik[2]), T = tgt.getWorldPosition(_ik[3]);
      const L1 = S.distanceTo(E0), L2 = E0.distanceTo(H0), dir = _ik[4].subVectors(T, S); let d = dir.length(); if (d < 1e-4) continue; dir.divideScalar(d);
      d = Math.min(d, (L1 + L2) * 0.999); d = Math.max(d, Math.abs(L1 - L2) + 1e-3);
      const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d), hh = Math.sqrt(Math.max(0, L1 * L1 - a * a));
      const pole = _ik[5].set(side * pl[0], pl[1], -pl[2]).transformDirection(this.root.matrixWorld); pole.addScaledVector(dir, -pole.dot(dir)).normalize();
      const E = _ik[6].copy(S).addScaledVector(dir, a).addScaledVector(pole, hh), Tc = _ik[7].copy(S).addScaledVector(dir, d);
      const aim = (bone, from, curTip, want) => { // rotate bone so (curTip-from) points along (want-from)
        _v1.subVectors(curTip, from).normalize(); _v2.subVectors(want, from).normalize();
        const dq = _q1.setFromUnitVectors(_v1, _v2), wq = bone.getWorldQuaternion(_q2); wq.premultiply(dq);
        bone.quaternion.copy(bone.parent.getWorldQuaternion(_qp).invert().multiply(wq)); bone.updateMatrixWorld(true);
      };
      aim(U, S, E0, E); const E1 = F.getWorldPosition(_ik[1]), H1 = H.getWorldPosition(_ik[2]); aim(F, E1, H1, Tc);
    }
  }
  apply() {
    const c = this.cur, sa = this.spinAng;
    this.pivot.position.y = (this.hipH || 0.95) + c.hip[0];
    eq(this.pivot.quaternion, c.body[0] + sa.x, c.body[2] + sa.y, c.body[1] + sa.z);
    if (!this.ok) return;
    const R = this.rest, W = this.world, B = this.bones;
    const Dh = eq(Q(), c.hip[1], c.hip[2], c.hip[3]), Dc = Dh.clone().multiply(eq(_q1, c.sp[0], c.sp[1], c.sp[2])), Dhd = Dc.clone().multiply(eq(_q1, c.hd[0], c.hd[1], c.hd[2]));
    const setW = (n, D) => { if (W[n]) W[n].copy(D).multiply(R[n].q); };
    setW('Hips', Dh); setW('Spine', _q2.copy(Dh).slerp(Dc, 0.34)); setW('Spine01', _q2.copy(Dh).slerp(Dc, 0.67)); setW('Spine02', Dc);
    setW('neck', _q2.copy(Dc).slerp(Dhd, 0.5)); setW('Head', Dhd); setW('headfront', Dhd); setW('head_end', Dhd); setW('LeftShoulder', Dc); setW('RightShoulder', Dc);
    for (const k in LIMB) {
      const [u, f, h, side] = LIMB[k], p = c[k], base = k[0] === 'a' ? Dc : Dh;
      _v1.set(side * p[0], p[1], -p[2]).normalize(); const Du = Q().copy(base).multiply(_q1.setFromUnitVectors(R[u].dir, _v1)); setW(u, Du);
      _v1.set(side * p[3], p[4], -p[5]).normalize(); const Df = Q().copy(base).multiply(_q1.setFromUnitVectors(R[f].dir, _v1)); setW(f, Df);
      if (k[0] === 'l') { // keep feet roughly level relative to hips frame unless shin is far from vertical
        _v2.copy(R[h].dir); _v2.y += c.ft[side > 0 ? 0 : 1]; _v2.normalize(); const lvl = Q().copy(Dh).multiply(_q1.setFromUnitVectors(R[h].dir, _v2)); const bend = Math.max(0, -p[4]); setW(h, _q2.copy(Df).slerp(lvl, bend * bend * 0.8)); setW(side > 0 ? 'RightToeBase' : 'LeftToeBase', W[h]);
      } else setW(h, Df);
    }
    // world -> local, walking the hierarchy from the hips
    const hips = B.Hips; hips.quaternion.copy(_q1.copy(this.hipParentQ).invert()).multiply(W.Hips);
    const walk = b => { for (const ch of b.children) { if (!ch.isBone) continue; const w = W[ch.name], pw = W[b.name]; if (w && pw) ch.quaternion.copy(_q1.copy(pw).invert()).multiply(w); walk(ch); } };
    walk(hips);
  }
  bonePos(name, out) { return this.bones[name] ? this.bones[name].getWorldPosition(out) : out.copy(this.root.position); }
  setVisible(v) { this.root.visible = v; }
}
