import * as THREE from 'three';

// CPU particle system rendered as soft point sprites. Two layers: alpha-blended (smoke/dust/water) and additive (fire/sparks).
const VS = /* glsl */`
  attribute float aSize; attribute vec4 aColor; varying vec4 vColor; uniform float uScale;
  void main(){ vColor=aColor; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_Position=projectionMatrix*mv; gl_PointSize=aSize*uScale/max(0.1,-mv.z); }`;
const FS = /* glsl */`
  varying vec4 vColor; uniform float uSoft;
  void main(){ vec2 p=gl_PointCoord-0.5; float d=length(p)*2.0; float a=smoothstep(1.0,uSoft,d); if(a<0.01) discard; gl_FragColor=vec4(vColor.rgb,vColor.a*a); }`;

class Layer {
  constructor(n, additive) {
    this.n = n; this.i = 0; this.alive = 0;
    this.pos = new Float32Array(n * 3); this.col = new Float32Array(n * 4); this.size = new Float32Array(n);
    this.vel = new Float32Array(n * 3); this.life = new Float32Array(n); this.max = new Float32Array(n);
    this.p = new Array(n).fill(null);
    const g = this.geo = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, uniforms: { uScale: { value: 600 }, uSoft: { value: additive ? 0.0 : 0.25 } } });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false; this.points.renderOrder = additive ? 11 : 10;
  }
  emit(x, y, z, vx, vy, vz, o) {
    const i = this.i; this.i = (i + 1) % this.n;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z; this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = this.max[i] = o.life; this.p[i] = o;
  }
  update(dt) {
    const { pos, vel, life, max, col, size, p } = this; let any = false;
    for (let i = 0; i < this.n; i++) {
      if (life[i] <= 0) { if (size[i] !== 0) { size[i] = 0; col[i * 4 + 3] = 0; } continue; }
      any = true; const o = p[i]; life[i] -= dt; const t = 1 - Math.max(0, life[i]) / max[i];
      const d = Math.exp(-o.drag * dt); vel[i * 3] *= d; vel[i * 3 + 1] = vel[i * 3 + 1] * d - o.grav * dt; vel[i * 3 + 2] *= d;
      pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      if (o.floor != null && pos[i * 3 + 1] < o.floor) { pos[i * 3 + 1] = o.floor; vel[i * 3 + 1] *= -0.35; vel[i * 3] *= 0.6; vel[i * 3 + 2] *= 0.6; }
      size[i] = o.s0 + (o.s1 - o.s0) * t;
      const c0 = o.c0, c1 = o.c1 || o.c0; col[i * 4] = c0[0] + (c1[0] - c0[0]) * t; col[i * 4 + 1] = c0[1] + (c1[1] - c0[1]) * t; col[i * 4 + 2] = c0[2] + (c1[2] - c0[2]) * t;
      col[i * 4 + 3] = o.a * (t < o.fin ? t / o.fin : 1 - (t - o.fin) / (1 - o.fin));
    }
    if (any || this._dirty) { this.geo.attributes.position.needsUpdate = true; this.geo.attributes.aColor.needsUpdate = true; this.geo.attributes.aSize.needsUpdate = true; }
    this._dirty = any;
  }
}
const R = (a, b) => a + Math.random() * (b - a);
const P = o => ({ life: 1, s0: 0.5, s1: 1.5, c0: [1, 1, 1], a: 0.5, drag: 1, grav: 0, fin: 0.1, ...o });

export class FX {
  constructor(scene) {
    this.scene = scene; this.smoke = new Layer(2600, false); this.fire = new Layer(1800, true);
    scene.add(this.smoke.points, this.fire.points);
    // debris: instanced boxes
    const N = this.dn = 260; this.deb = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.1 }), N);
    this.deb.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.deb.castShadow = true; this.deb.frustumCulled = false;
    this.dd = Array.from({ length: N }, () => ({ life: 0, p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3(), s: new THREE.Vector3(), floor: 0 }));
    this.di = 0; this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._c = new THREE.Color();
    for (let i = 0; i < N; i++) { this._m.makeScale(0, 0, 0); this.deb.setMatrixAt(i, this._m); this.deb.setColorAt(i, this._c.set(0xffffff)); }
    scene.add(this.deb);
    this.lights = [];
  }
  setHeight(h) { const s = h * 0.9; this.smoke.mat.uniforms.uScale.value = s; this.fire.mat.uniforms.uScale.value = s; }
  dust(p, n = 6, { color = [0.72, 0.62, 0.48], spread = 1, up = 1.5, size = 1.6, a = 0.35, vel } = {}) {
    for (let i = 0; i < n; i++) this.smoke.emit(p.x + R(-.4, .4) * spread, p.y + R(0, .3), p.z + R(-.4, .4) * spread, (vel?.x || 0) + R(-1, 1) * spread, R(0.2, up), (vel?.z || 0) + R(-1, 1) * spread, P({ life: R(0.7, 1.6), s0: size * 0.4, s1: size * R(1.8, 3), c0: color, a, drag: 1.6, grav: -0.3, fin: 0.15 }));
  }
  smokePuff(p, n = 8, { color = [0.2, 0.2, 0.2], size = 2, a = 0.5, up = 3, spread = 1, life = 2.2 } = {}) {
    for (let i = 0; i < n; i++) this.smoke.emit(p.x + R(-.5, .5) * spread, p.y + R(0, .5), p.z + R(-.5, .5) * spread, R(-1, 1) * spread, R(up * 0.4, up), R(-1, 1) * spread, P({ life: R(life * 0.6, life), s0: size * 0.5, s1: size * R(2, 3.5), c0: color, c1: [color[0] * 1.6 + .1, color[1] * 1.6 + .1, color[2] * 1.6 + .1], a, drag: 0.9, grav: -0.8, fin: 0.12 }));
  }
  sparks(p, n = 20, { speed = 9, color = [1, 0.75, 0.3], dir } = {}) {
    for (let i = 0; i < n; i++) this.fire.emit(p.x, p.y, p.z, (dir?.x || 0) * speed * 0.6 + R(-1, 1) * speed, R(0, 1) * speed, (dir?.z || 0) * speed * 0.6 + R(-1, 1) * speed, P({ life: R(0.25, 0.8), s0: 0.22, s1: 0.05, c0: color, c1: [1, 0.2, 0], a: 1, drag: 1.2, grav: 14, fin: 0.02, floor: p.y - 0.6 }));
  }
  fireBurst(p, n = 30, { size = 3, speed = 8, life = 1 } = {}) {
    for (let i = 0; i < n; i++) { const a = R(0, 6.28), e = R(0, 1.3), s = R(0.2, 1) * speed; this.fire.emit(p.x + R(-.5, .5), p.y + R(0, .8), p.z + R(-.5, .5), Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s * 0.8 + 1.5, Math.sin(a) * Math.cos(e) * s, P({ life: R(0.4, 1) * life, s0: size * R(0.6, 1), s1: size * R(1.6, 2.6), c0: [1, 0.72, 0.25], c1: [0.8, 0.12, 0.0], a: 0.75, drag: 2.2, grav: -3, fin: 0.08 })); }
  }
  explosion(p, scale = 1) {
    this.fireBurst(p, Math.round(46 * Math.min(2, scale)), { size: 3.2 * scale, speed: 11 * scale, life: 1.1 });
    this.smokePuff(p, Math.round(26 * Math.min(2, scale)), { size: 3.5 * scale, up: 7 * scale, spread: 2.5 * scale, life: 3.5, a: 0.6, color: [0.08, 0.07, 0.07] });
    this.sparks(p, 40, { speed: 16 * scale });
    this.debris(p, 24, { color: 0x222222, speed: 12 * scale, size: 0.25 * scale });
    this.light(p, 0xffa040, 60 * scale * scale, 0.5, 40 * scale);
  }
  flame(p, size = 1) { // continuous fire - call each frame
    this.fire.emit(p.x + R(-.3, .3) * size, p.y, p.z + R(-.3, .3) * size, R(-.4, .4), R(1.5, 3.5) * size, R(-.4, .4), P({ life: R(0.3, 0.7), s0: 1.3 * size, s1: 0.3 * size, c0: [1, 0.7, 0.25], c1: [0.9, 0.15, 0], a: 0.7, drag: 0.5, grav: -2, fin: 0.15 }));
    if (Math.random() < 0.25) this.smoke.emit(p.x, p.y + size, p.z, R(-.3, .3), R(2, 4), R(-.3, .3), P({ life: R(1.2, 2.2), s0: size, s1: size * 3, c0: [0.1, 0.1, 0.1], a: 0.35, drag: 0.5, grav: -0.6, fin: 0.2 }));
  }
  exhaust(p, dir, size = 1, hot = true) { (hot ? this.fire : this.smoke).emit(p.x, p.y, p.z, dir.x + R(-.5, .5), dir.y + R(-.5, .5), dir.z + R(-.5, .5), P({ life: R(0.15, 0.35), s0: size, s1: size * 0.3, c0: hot ? [0.6, 0.75, 1] : [0.5, 0.5, 0.5], c1: hot ? [1, 0.5, 0.1] : [0.8, 0.8, 0.8], a: hot ? 0.8 : 0.3, drag: 0.5, fin: 0.1 })); }
  splash(p, n = 40, scale = 1) {
    for (let i = 0; i < n; i++) { const a = R(0, 6.28), s = R(1, 6) * scale; this.smoke.emit(p.x, p.y, p.z, Math.cos(a) * s, R(4, 13) * scale, Math.sin(a) * s, P({ life: R(0.7, 1.5), s0: 0.5 * scale, s1: 1.6 * scale, c0: [0.85, 0.93, 1], a: 0.6, drag: 0.6, grav: 16, fin: 0.05 })); }
  }
  spray(p, vel, n = 2, color = [0.9, 0.95, 1], size = 1) { for (let i = 0; i < n; i++) this.smoke.emit(p.x + R(-.3, .3), p.y, p.z + R(-.3, .3), vel.x + R(-1.5, 1.5), vel.y + R(0.5, 3), vel.z + R(-1.5, 1.5), P({ life: R(0.5, 1.1), s0: 0.5 * size, s1: 2.2 * size, c0: color, a: 0.4, drag: 1, grav: 7, fin: 0.1 })); }
  cloudPuff(p, vel, size = 30) { this.smoke.emit(p.x, p.y, p.z, vel.x, vel.y, vel.z, P({ life: R(1.2, 2.2), s0: size, s1: size * 1.4, c0: [1, 1, 1], a: 0.22, drag: 0, fin: 0.3 })); }
  streak(p, vel, color = [1, 1, 1], life = 0.5, size = 0.25, a = 0.5) { this.smoke.emit(p.x, p.y, p.z, vel.x, vel.y, vel.z, P({ life, s0: size, s1: size, c0: color, a, drag: 0, fin: 0.2 })); }
  glass(p, n = 50, { speed = 7, dir } = {}) {
    this.debris(p, Math.min(n, 60), { color: 0xcfe8ef, speed, size: 0.14, dir, flat: true });
    for (let i = 0; i < n; i++) this.fire.emit(p.x + R(-1, 1), p.y + R(-1, 1), p.z + R(-.3, .3), (dir?.x || 0) * speed + R(-1, 1) * speed * 0.5, R(-1, 3), (dir?.z || 0) * speed + R(-1, 1) * speed * 0.5, P({ life: R(0.5, 1.2), s0: 0.12, s1: 0.04, c0: [0.8, 0.95, 1], a: 0.9, drag: 0.6, grav: 12, fin: 0.02 }));
  }
  debris(p, n = 12, { color = 0x8a6a40, speed = 7, size = 0.3, dir, flat = false, floor, spread = 0.6 } = {}) {
    for (let k = 0; k < n; k++) {
      const d = this.dd[this.di]; const i = this.di; this.di = (this.di + 1) % this.dn;
      d.life = R(1.5, 3); d.p.set(p.x + R(-1, 1) * spread, p.y + R(-.5, .8) * spread, p.z + R(-1, 1) * spread);
      d.v.set((dir?.x || 0) * speed + R(-1, 1) * speed * 0.6, R(0.2, 1) * speed * 0.8, (dir?.z || 0) * speed + R(-1, 1) * speed * 0.6);
      d.w.set(R(-9, 9), R(-9, 9), R(-9, 9)); d.r.set(R(0, 6), R(0, 6), R(0, 6));
      const s = size * R(0.5, 1.5); d.s.set(s * R(0.6, 1.6), flat ? s * 0.12 : s * R(0.3, 1), s * R(0.6, 1.6)); d.floor = floor ?? (p.y - 1.2);
      this._c.set(color).multiplyScalar(R(0.7, 1.15)); this.deb.setColorAt(i, this._c);
    }
    this.deb.instanceColor.needsUpdate = true;
  }
  light(p, color = 0xffaa55, intensity = 40, life = 0.4, dist = 30) {
    const l = new THREE.PointLight(color, intensity, dist, 1.6); l.position.copy(p); l.position.y += 1; this.scene.add(l); this.lights.push({ l, life, max: life, i: intensity });
  }
  update(dt) {
    this.smoke.update(dt); this.fire.update(dt);
    let any = false;
    for (let i = 0; i < this.dn; i++) {
      const d = this.dd[i]; if (d.life <= 0) continue; any = true; d.life -= dt;
      d.v.y -= 20 * dt; d.p.addScaledVector(d.v, dt);
      if (d.p.y < d.floor + d.s.y / 2) { d.p.y = d.floor + d.s.y / 2; d.v.y *= -0.3; d.v.x *= 0.7; d.v.z *= 0.7; d.w.multiplyScalar(0.6); }
      d.r.x += d.w.x * dt; d.r.y += d.w.y * dt; d.r.z += d.w.z * dt;
      const k = d.life < 0.3 ? Math.max(0, d.life / 0.3) : 1;
      this._m.compose(d.p, this._q.setFromEuler(d.r), this._v.copy(d.s).multiplyScalar(k)); this.deb.setMatrixAt(i, this._m);
    }
    if (any || this._dAny) this.deb.instanceMatrix.needsUpdate = true; this._dAny = any;
    for (let i = this.lights.length - 1; i >= 0; i--) { const L = this.lights[i]; L.life -= dt; L.l.intensity = L.i * Math.max(0, L.life / L.max); if (L.life <= 0) { this.scene.remove(L.l); L.l.dispose(); this.lights.splice(i, 1); } }
  }
  _v = new THREE.Vector3();
}
