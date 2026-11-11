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
  // interaction poses: the IK/reach solver does the precise contact, these give the body the right shape around it
  wheel: P({ hip: [-0.42, 0, 0, 0], sp: [-0.1, 0, 0], aR: [0.42, -0.28, 0.86, 0.1, 0.08, 1], aL: [0.42, -0.28, 0.86, 0.1, 0.08, 1], lR: [0.14, 0.05, 1, 0.03, -0.5, 0.85], lL: [0.14, 0.05, 1, 0.03, -0.5, 0.85] }), // 9-and-3 on a steering wheel
  reachR: P({ sp: [0.18, 0.3, 0], aR: [0.05, 0.12, 1, 0.02, 0.1, 1], aL: [0.3, -0.8, 0.2, 0.0, -0.3, 0.9] }),
  reachL: P({ sp: [0.18, -0.3, 0], aL: [0.05, 0.12, 1, 0.02, 0.1, 1], aR: [0.3, -0.8, 0.2, 0.0, -0.3, 0.9] }),
  reachUpR: P({ sp: [0.05, 0.25, 0], hd: [-0.4, 0, 0], aR: [0.25, 0.95, 0.35, 0.05, 1, 0.3], aL: [0.4, -0.8, 0.2, 0.1, -0.4, 0.8] }),
  carryR: P({ aR: [0.32, -0.72, 0.5, 0.05, 0.18, 1] }), // forearm up, fist closed round a held prop (idol, hat brim)
  carryBoth: P({ sp: [0.12, 0, 0], aR: [0.3, -0.55, 0.75, -0.1, 0.12, 1], aL: [0.3, -0.55, 0.75, -0.1, 0.12, 1] }),
  vault: P({ hip: [-0.1, 0.3, 0.1, 0], sp: [0.3, 0.15, 0], aR: [0.4, -0.6, 0.8, 0.1, -0.4, 0.9], aL: [0.5, -0.3, -0.6, 0.3, -0.6, -0.6], lR: [0.1, -0.4, 1, 0.02, -1, 0.2], lL: [0.1, -0.7, -0.8, 0.02, -0.4, -1] }),
  pullup: P({ hip: [-0.25, 0.15, 0, 0], sp: [0.25, 0, 0], hd: [-0.2, 0, 0], aR: [0.3, 0.75, 0.55, 0.0, 0.55, 0.85], aL: [0.3, 0.75, 0.55, 0.0, 0.55, 0.85], lR: [0.2, -0.55, 0.8, 0.04, -1, -0.6], lL: [0.2, -1, 0.1, 0.04, -1, -0.5] }),
  risers: P({ sp: [-0.05, 0, 0], hd: [-0.45, 0, 0], aR: [0.45, 0.7, 0.25, 0.1, 0.95, 0.15], aL: [0.45, 0.7, 0.25, 0.1, 0.95, 0.15], lR: [0.08, -1, 0.18, 0.03, -1, -0.3], lL: [0.08, -1, 0.05, 0.03, -1, -0.4] }), // hands up on parachute toggles
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
    // interaction state: IK fade + smoothed targets, reach-to-grab tweens, held props, head look, secondary sway
    this._ikW = 0; this._ikSm = { aR: V(), aL: V(), lR: V(), lL: V() }; this._ikInit = false;
    this._reach = {}; this._held = {}; this.look = null; this.lookW = 0; this._lookSm = [0, 0];
    this.breathe = 1; this.lean = V(); this._plantK = 0;
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
  setPose(p, blend = 0.15) { this.cycle = null; this.target = typeof p === 'string' ? (POSES[p] || BASE) : { ...BASE, ...p }; this.k = blend <= 0 ? 1e6 : 2.5 / Math.max(0.04, blend); if (blend <= 0) this.snap(); return this; }
  setCycle(name, rate = 1, arg) { if (this.cycle !== name) { this.k = 14; } this.cycle = name; this.rate = rate; this.cycleArg = arg; return this; }
  snap() { for (const k of KEYS) { const t = this.target[k] || BASE[k]; for (let i = 0; i < t.length; i++) this.cur[k][i] = t[i]; } }
  tumble(x = 0, y = 0, z = 0) { this.spin.set(x, y, z); return this; }
  // ---- reach / grab: move one hand smoothly onto a world target instead of snapping ----
  // reach('aR', target, {dur, arc, pose}) target = Object3D | Vector3 | (()=>Vector3). Returns a promise resolved on contact.
  // grabProp(prop, 'aR', {dur, off:[fwd,down]}) reaches, then pins the prop to the hand every frame until dropProp().
  reach(hand, target, { dur = 0.35, arc = 0.14, pose } = {}) {
    if (!this.ok) return Promise.resolve(this);
    const proxy = this._reach[hand]?.proxy || new THREE.Object3D();
    const bone = this.bones[LIMB[hand][2]]; bone.getWorldPosition(proxy.position);
    if (pose !== false) this.over = { ...(this.over || {}), ...(pose ? { [hand]: (POSES[pose] || {})[hand] } : (POSES[hand === 'aR' ? 'reachR' : 'reachL'] || {})) };
    if (!this.cycle && !pose) { /* keep current body pose; arm shape comes from the override above */ }
    this.ik = { ...(this.ik || {}), [hand]: proxy };
    return new Promise(res => { this._reach[hand] = { proxy, from: proxy.position.clone(), target, t: 0, dur: Math.max(0.08, dur), arc, res }; });
  }
  release(hand, { dur = 0.3 } = {}) { // let go: hand eases back to wherever the pose wants it
    const r = this._reach[hand]; if (r?.res) r.res(this); delete this._reach[hand]; this.unhold(hand);
    if (this.ik?.[hand]) { const ik = { ...this.ik }; delete ik[hand]; this.ik = Object.keys(ik).some(k => LIMB[k]) ? ik : (ik.pole || ik.legPole ? ik : null); }
    if (this.over) { const o = { ...this.over }; delete o[hand]; this.over = Object.keys(o).length ? o : null; }
    return this;
  }
  grabProp(prop, hand = 'aR', { dur = 0.35, fwd = 0.08, down = 0.06, spin = 0 } = {}) {
    const held = this._held[hand] = { prop, fwd, down, spin, on: false };
    const parent = prop.parent; if (parent) parent.updateWorldMatrix(true, false);
    return this.reach(hand, prop, { dur, pose: 'carryR' }).then(() => { held.on = true; return this; });
  }
  unhold(hand = 'aR') { const h = this._held[hand]; if (h) h.on = false; return this; }
  dropProp(hand = 'aR', opts) { this.unhold(hand); return this.release(hand, opts); }
  _stepReach(dt) {
    for (const hand in this._reach) {
      const r = this._reach[hand]; r.t += dt; const k = Math.min(1, r.t / r.dur), e = k * k * (3 - 2 * k); // smoothstep: fast out, soft landing — reads as a grab, not a teleport
      const to = typeof r.target === 'function' ? r.target(_v1) : r.target?.isVector3 ? _v1.copy(r.target) : r.target.getWorldPosition(_v1);
      r.proxy.position.lerpVectors(r.from, to, e); r.proxy.position.y += Math.sin(e * Math.PI) * r.arc * (1 - e * 0.4);
      if (k >= 1 && !r.done) { r.done = true; r.res?.(this); } // keep tracking a moving target after contact
      if (r.done) r.proxy.position.copy(to);
    }
    // held props ride the hand bone (forward of the fist, hanging slightly)
    for (const hand in this._held) {
      const h = this._held[hand]; if (!h.on) continue; const hb = this.bones[LIMB[hand][2]], fa = this.bones[LIMB[hand][1]]; if (!hb) continue;
      hb.getWorldPosition(_v1); if (fa) _v1.addScaledVector(_v2.subVectors(_v1, fa.getWorldPosition(_ik[0])).normalize(), h.fwd);
      h.prop.position.copy(_v1); h.prop.position.y -= h.down; this.root.getWorldQuaternion(h.prop.quaternion); if (h.spin) h.prop.rotateY(h.spin);
    }
  }
  update(dt) {
    this.t += dt; this.root.rotation.y = this.heading;
    let T = this.target;
    if (this.cycle) { this.phase += this.rate * dt; const f = CYCLES[this.cycle]; T = f(this.cycle === 'run' || this.cycle === 'walk' || this.cycle === 'climb' ? this.phase : this.t * (this.rate || 1), this.cycleArg); if (this.over) T = { ...T, ...this.over }; }
    else if (this.over) T = { ...T, ...this.over };
    const a = 1 - Math.exp(-this.k * dt);
    for (const k of KEYS) { const t = T[k] || BASE[k], c = this.cur[k]; for (let i = 0; i < t.length; i++) c[i] += (t[i] - c[i]) * a; }
    // secondary life (kept tiny so stunt poses always win): breathing + head look + velocity lean
    if (this.ok && !this.spin.lengthSq()) {
      const br = this.breathe * (this.cycle === 'run' ? 1.6 : 1); this.cur.sp[0] += 0.014 * br * Math.sin(this.t * (this.cycle === 'run' ? 5.5 : 1.5));
      this.cur.body[0] += this.lean.x; this.cur.body[1] += this.lean.z;
      this.lookW += ((this.look ? 1 : 0) - this.lookW) * Math.min(1, dt * 5);
      if (this.look && this.lookW > 0.01) {
        const hp = this.bones.Head?.getWorldPosition(_v1) || _v1.copy(this.root.position).setY(this.root.position.y + 1.6);
        _v2.subVectors(this.look, hp); const yaw = Math.atan2(-_v2.x * Math.cos(this.heading) + _v2.z * Math.sin(this.heading), -_v2.z * Math.cos(this.heading) - _v2.x * Math.sin(this.heading));
        const pit = Math.atan2(_v2.y, Math.hypot(_v2.x, _v2.z));
        const cl = (v, m) => Math.max(-m, Math.min(m, v)); const sm = Math.min(1, dt * 8);
        this._lookSm[0] += (cl(pit, 0.55) * -1 - this._lookSm[0]) * sm; this._lookSm[1] += (cl(yaw, 0.9) - this._lookSm[1]) * sm;
        this.cur.hd[0] += this._lookSm[0] * this.lookW * 0.7; this.cur.hd[1] += this._lookSm[1] * this.lookW * 0.7;
      }
    }
    if (this.spin.lengthSq() > 0) this.spinAng.addScaledVector(this.spin, dt); else if (this.spinAng.lengthSq() > 0 && this.settle) this.spinAng.multiplyScalar(Math.exp(-8 * dt));
    this._stepReach(dt);
    this.apply(); if (this.ik) this.solveIK(dt); else this._ikW = Math.max(0, this._ikW - dt * 4);
    this._stepReach(0); // re-pin held props against the final bone matrices
    this.post?.(dt); // post: attach props to bones after the pose is final
  }
  // Two-bone IK for arms AND legs: after the pose is applied, pull each end-effector onto a world-space target
  // (handlebar grips, foot pegs, steering-wheel rim, ledge edge, parachute toggles...).
  // ik = { aR, aL, lR, lL: Object3D|Vector3, pole:[out,up,fwd] (arms), legPole:[out,up,fwd] (knees forward),
  //        w: 0..1 weight (default 1), orient: align hand/foot to the target's quaternion when it has one }.
  // Targets parented to the same vehicle body move with zero lag; world targets are smoothed so engagement never pops.
  solveIK(dt = 0.016) {
    const ik = this.ik; if (!this.ok || !this.root.visible) return;
    this._ikW = Math.min(ik.w ?? 1, this._ikW + dt * 5); // fade IK in over ~0.2 s instead of snapping the limb
    const W = this._ikW; if (W <= 0.001) return;
    this.root.updateWorldMatrix(true, true);
    const aim = (bone, from, curTip, want, w) => {
      _v1.subVectors(curTip, from).normalize(); _v2.subVectors(want, from).normalize();
      const dq = _q1.setFromUnitVectors(_v1, _v2); if (w < 1) _q1.slerp(new THREE.Quaternion(), 1 - w);
      const wq = bone.getWorldQuaternion(_q2); wq.premultiply(_q1);
      bone.quaternion.copy(bone.parent.getWorldQuaternion(_qp).invert().multiply(wq)); bone.updateMatrixWorld(true);
    };
    for (const k of ['aR', 'aL', 'lR', 'lL']) {
      const tgt = ik[k]; if (!tgt) continue; const [u, f, h, side] = LIMB[k], U = this.bones[u], F = this.bones[f], H = this.bones[h]; if (!U || !F || !H) continue;
      const isLeg = k[0] === 'l', pl = isLeg ? (ik.legPole || [0.08, 0.1, 1]) : (ik.pole || [0.7, -0.75, -0.25]);
      const S = U.getWorldPosition(_ik[0]).clone(), E0 = F.getWorldPosition(_ik[1]).clone(), H0 = H.getWorldPosition(_ik[2]).clone();
      const Traw = tgt.isVector3 ? _ik[3].copy(tgt) : tgt.getWorldPosition(_ik[3]);
      const sm = this._ikSm[k]; if (!this._ikInit) sm.copy(H0);
      // blend goal between the posed hand/foot and the true target by weight, then damp: no pops, no jitter
      _ik[7].copy(H0).lerp(Traw, W); sm.lerp(_ik[7], 1 - Math.exp(-22 * dt)); const T = _ik[3].copy(sm);
      const L1 = S.distanceTo(E0), L2 = E0.distanceTo(H0), dir = _ik[4].subVectors(T, S); let d = dir.length(); if (d < 1e-4) continue; dir.divideScalar(d);
      d = Math.min(d, (L1 + L2) * 0.999); d = Math.max(d, Math.abs(L1 - L2) + 1e-3);
      const a = (L1 * L1 - L2 * L2 + d * d) / (2 * d), hh = Math.sqrt(Math.max(0, L1 * L1 - a * a));
      const pole = _ik[5].set(side * pl[0], pl[1], -pl[2]).transformDirection(this.root.matrixWorld); pole.addScaledVector(dir, -pole.dot(dir));
      if (pole.lengthSq() < 1e-6) pole.set(0, isLeg ? 0 : -1, isLeg ? -1 : 0); pole.normalize();
      const E = _ik[6].copy(S).addScaledVector(dir, a).addScaledVector(pole, hh), Tc = _ik[7].copy(S).addScaledVector(dir, d);
      aim(U, S, E0, E, 1); const E1 = F.getWorldPosition(_ik[1]).clone(), H1 = H.getWorldPosition(_ik[2]).clone(); aim(F, E1, H1, Tc, 1);
      // wrap the hand/foot onto the grip: orient the end bone to the target frame (bar/wheel/peg direction)
      if (ik.orient !== false && tgt.quaternion) {
        const want = tgt.getWorldQuaternion(_q1), have = H.getWorldQuaternion(_q2); have.slerp(want, 0.55 * W);
        H.quaternion.copy(H.parent.getWorldQuaternion(_qp).invert().multiply(have)); H.updateMatrixWorld(true);
      }
    }
    this._ikInit = true;
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
  // Generated performers have their hat baked into the body mesh. Split the hat triangles (above the brim, measured
  // along the head axis) into their own SkinnedMesh so it can come off, and add a hair cap to close the crown.
  splitHat({ t0 = 0.5, t1 = 0.2, rBrim = 0.46, capT = 0.33, hair = 0x4a3424 } = {}) {
    const B = this.bones; if (!this.ok || !B.Head || !B.head_end || this.hatMesh) return false;
    this.root.updateWorldMatrix(true, true); const inv = this.root.matrixWorld.clone().invert();
    const hp = B.Head.getWorldPosition(V()).applyMatrix4(inv), he = B.head_end.getWorldPosition(V()).applyMatrix4(inv), ax = he.clone().sub(hp), L = ax.length(); ax.normalize();
    let mesh = null; this.inner.traverse(o => { if (o.isSkinnedMesh && (!mesh || o.geometry.attributes.position.count > mesh.geometry.attributes.position.count)) mesh = o; }); if (!mesh) return false;
    const g = mesh.geometry = mesh.geometry.clone(), P = g.attributes.position, n = P.count, hat = new Uint8Array(n), v = V(), d = V(); // own copy: the loaded geometry is shared by every clone of this performer
    const rs = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld).applyMatrix4(inv); v.toArray(rs, i * 3); d.subVectors(v, hp); const t = d.dot(ax) / L, r = d.addScaledVector(ax, -t * L).length() / L; hat[i] = t > t0 || (t > t1 && r > rBrim) ? 1 : 0; }
    const idx = g.index ? g.index.array : Array.from({ length: n }, (_, i) => i), body = [], top = [];
    for (let k = 0; k < idx.length; k += 3) { const a = idx[k], b = idx[k + 1], c = idx[k + 2]; (hat[a] + hat[b] + hat[c] >= 2 ? top : body).push(a, b, c); }
    if (top.length < 30) return false;
    g.setIndex(body); const g2 = new THREE.BufferGeometry(); for (const k in g.attributes) g2.setAttribute(k, g.attributes[k]); g2.setIndex(top);
    const hm = this.hatMesh = new THREE.SkinnedMesh(g2, mesh.material); hm.castShadow = true; hm.frustumCulled = false; hm.position.copy(mesh.position); hm.quaternion.copy(mesh.quaternion); hm.scale.copy(mesh.scale); mesh.parent.add(hm); hm.bind(mesh.skeleton, mesh.bindMatrix);
    // hair cap where the crown was: a flattened half-sphere on the head bone
    const cap = this.hatCap = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: hair, roughness: 0.85 }));
    cap.scale.set(L * 0.37, L * 0.3, L * 0.37); cap.position.copy(hp).addScaledVector(ax, L * capT); cap.position.z += L * 0.06; cap.quaternion.setFromUnitVectors(V(0, 1, 0), ax); cap.castShadow = true; cap.visible = false;
    this.root.add(cap); cap.updateWorldMatrix(true, false); B.Head.attach(cap);
    // a loose copy of the same hat (static, upright, pivot at the brim) for when it flies off and gets picked up
    const map = new Map(), pos = [], uv = [], UV = g.attributes.uv, ix = [], up = new THREE.Quaternion().setFromUnitVectors(ax, V(0, 1, 0));
    for (const i of top) { if (!map.has(i)) { map.set(i, map.size); v.fromArray(rs, i * 3).sub(hp).applyQuaternion(up); pos.push(v.x, v.y, v.z); if (UV) uv.push(UV.getX(i), UV.getY(i)); } ix.push(map.get(i)); }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); if (UV) sg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); sg.setIndex(ix); sg.computeBoundingBox();
    const bb = sg.boundingBox; sg.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2); sg.computeVertexNormals();
    this.hatProp = new THREE.Mesh(sg, mesh.material); this.hatProp.castShadow = true; return true;
  }
  setHat(on) { if (this.hatMesh) { this.hatMesh.visible = on; this.hatCap.visible = !on; } }
  bonePos(name, out) { return this.bones[name] ? this.bones[name].getWorldPosition(out) : out.copy(this.root.position); }
  setVisible(v) { this.root.visible = v; }
}
