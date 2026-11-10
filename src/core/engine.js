import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// Final "film" pass: grade, vignette, grain, chromatic aberration, speed blur, letterbox, old-film damage.
const FilmShader = {
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uAspect: { value: 1.7 },
    uTint: { value: new THREE.Vector3(1, 1, 1) }, uLift: { value: new THREE.Vector3(0, 0, 0) },
    uSat: { value: 1 }, uContrast: { value: 1 }, uVignette: { value: 0.35 }, uGrain: { value: 0.035 },
    uCA: { value: 0.0022 }, uBlur: { value: 0 }, uMono: { value: 0 }, uSepia: { value: 0 },
    uFade: { value: 0 }, uFlash: { value: 0 }, uLetter: { value: 0 }, uOld: { value: 0 }, uHurt: { value: 0 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime,uAspect,uSat,uContrast,uVignette,uGrain,uCA,uBlur,uMono,uSepia,uFade,uFlash,uLetter,uOld,uHurt;
    uniform vec3 uTint,uLift; varying vec2 vUv;
    float hash(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
    void main(){
      vec2 uv=vUv; vec2 c=uv-0.5; float r2=dot(c,c);
      if(uOld>0.0){ uv.y+=uOld*0.004*sin(uTime*37.0)*step(0.93,hash(vec2(floor(uTime*18.0),1.0))); uv.x+=uOld*0.0015*sin(uTime*23.0); }
      vec3 col; float ca=uCA*(0.4+r2*5.0); vec2 sh=uv-vUv;
      if(uBlur>0.001){
        vec3 acc=vec3(0.0); float tw=0.0; float jit=hash(vUv*vec2(913.0,517.0)+fract(uTime)*7.0);
        float amt=uBlur*smoothstep(0.02,0.42,r2)*0.16;
        for(int i=0;i<12;i++){ float t=(float(i)+jit)/12.0; float w=1.0-t*0.5; vec2 o=c*(1.0-amt*t);
          acc+=vec3(texture2D(tDiffuse,0.5+o*(1.0+ca)+sh).r,texture2D(tDiffuse,0.5+o+sh).g,texture2D(tDiffuse,0.5+o*(1.0-ca)+sh).b)*w; tw+=w; }
        col=acc/tw;
      } else col=vec3(texture2D(tDiffuse,uv+c*ca).r,texture2D(tDiffuse,uv).g,texture2D(tDiffuse,uv-c*ca).b);
      col=col*uTint+uLift*(1.0-col);
      float l=dot(col,vec3(0.2126,0.7152,0.0722));
      col=mix(vec3(l),col,uSat);
      col=(col-0.5)*uContrast+0.5;
      vec3 mono=vec3(l); mono=(mono-0.5)*1.25+0.5;
      vec3 sep=mono*vec3(1.08,0.96,0.78);
      col=mix(col,mix(mono,sep,uSepia),uMono);
      float v=smoothstep(0.85,0.15,r2*(1.0+uVignette*2.2)); col*=mix(1.0,v,min(1.0,uVignette*1.6));
      float g=hash(uv*vec2(1920.0,1080.0)+fract(uTime)*91.7)-0.5; col+=g*uGrain*(1.2-l);
      if(uOld>0.0){
        float fl=1.0+uOld*0.10*(hash(vec2(floor(uTime*24.0),3.0))-0.5); col*=fl;
        float sx=hash(vec2(floor(uTime*9.0),7.0)); float sc=smoothstep(0.0015,0.0,abs(uv.x-sx))*step(0.6,hash(vec2(floor(uTime*9.0),11.0)));
        col+=sc*0.25*uOld;
        vec2 dp=floor(uv*vec2(90.0,50.0)); float d=step(0.9993,hash(dp+floor(uTime*14.0))); col-=d*0.5*uOld;
        float rr=length(c*vec2(uAspect,1.0)); col*=mix(1.0,smoothstep(0.95,0.45,rr),uOld*0.8);
      }
      col=mix(col,vec3(0.55,0.0,0.0),uHurt*smoothstep(0.05,0.5,r2)*0.85);
      col=mix(col,vec3(1.0),clamp(uFlash,0.0,1.0));
      col*=1.0-clamp(uFade,0.0,1.0);
      float bar=step(uLetter,vUv.y)*step(vUv.y,1.0-uLetter); col*=bar;
      gl_FragColor=vec4(clamp(col,0.0,1.0),1.0);
    }`,
};

export const LOOKS = {
  neutral: { tint: [1, 1, 1], lift: [0, 0, 0], sat: 1.05, contrast: 1.06, vignette: 0.26, grain: 0.03, bloom: 0.3 },
  warm60s: { tint: [1.06, 1.0, 0.9], lift: [0.03, 0.02, 0.0], sat: 0.95, contrast: 1.04, vignette: 0.4, grain: 0.06, bloom: 0.3 },
  teal_orange: { tint: [1.08, 1.0, 0.92], lift: [0.0, 0.03, 0.05], sat: 1.2, contrast: 1.12, vignette: 0.4, grain: 0.035, bloom: 0.4 },
  matrix: { tint: [0.86, 1.06, 0.84], lift: [0.0, 0.035, 0.0], sat: 0.75, contrast: 1.15, vignette: 0.45, grain: 0.04, bloom: 0.45 },
  wasteland: { tint: [1.15, 0.98, 0.78], lift: [0.0, 0.02, 0.05], sat: 1.3, contrast: 1.18, vignette: 0.4, grain: 0.05, bloom: 0.4 },
  cold: { tint: [0.92, 0.98, 1.08], lift: [0.0, 0.01, 0.03], sat: 0.85, contrast: 1.08, vignette: 0.38, grain: 0.035, bloom: 0.3 },
  night: { tint: [0.9, 0.97, 1.1], lift: [0.0, 0.01, 0.03], sat: 1.05, contrast: 1.12, vignette: 0.5, grain: 0.05, bloom: 0.7 },
  neon: { tint: [1.02, 0.96, 1.08], lift: [0.02, 0.0, 0.04], sat: 1.25, contrast: 1.1, vignette: 0.45, grain: 0.04, bloom: 0.8 },
  silent: { tint: [1, 1, 1], lift: [0, 0, 0], sat: 1, contrast: 1.1, vignette: 0.5, grain: 0.12, bloom: 0.15, mono: 1, sepia: 0.35, old: 1 },
  noir: { tint: [1, 1, 1], lift: [0, 0, 0], sat: 1, contrast: 1.2, vignette: 0.5, grain: 0.07, bloom: 0.3, mono: 1, sepia: 0 },
  bleach: { tint: [1.0, 1.0, 0.97], lift: [0.01, 0.01, 0.01], sat: 0.7, contrast: 1.2, vignette: 0.42, grain: 0.05, bloom: 0.3 },
  golden: { tint: [1.12, 1.0, 0.85], lift: [0.03, 0.01, 0.0], sat: 1.15, contrast: 1.08, vignette: 0.4, grain: 0.035, bloom: 0.5 },
  jungle: { tint: [0.98, 1.04, 0.9], lift: [0.01, 0.02, 0.0], sat: 1.12, contrast: 1.1, vignette: 0.45, grain: 0.04, bloom: 0.4 },
  vhs80s: { tint: [1.04, 1.0, 0.96], lift: [0.03, 0.02, 0.03], sat: 1.15, contrast: 1.0, vignette: 0.35, grain: 0.07, bloom: 0.35 },
};

export class Engine {
  constructor(canvas) {
    this.canvas = canvas;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
    this.quality = +(localStorage.getItem('ss_quality') ?? 1);
    r.shadowMap.enabled = true; r.shadowMap.type = THREE.PCFShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.0;
    r.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.15, 6000);
    this.composer = new EffectComposer(r, new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 }));
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.3, 0.7, 0.92);
    this.output = new OutputPass();
    this.film = new ShaderPass(FilmShader);
    this.composer.addPass(this.renderPass); this.composer.addPass(this.bloom); this.composer.addPass(this.output); this.composer.addPass(this.film);
    this.fx = this.film.uniforms;
    this.time = 0; this.timeScale = 1; this.shake = 0; this.shakeOff = new THREE.Vector3();
    this.pmrem = new THREE.PMREMGenerator(r);
    this.resize(); addEventListener('resize', () => this.resize());
    this.setLook('neutral');
  }
  setQuality(q) { this.quality = q; localStorage.setItem('ss_quality', q); this.resize(); }
  resize() {
    const w = innerWidth, h = innerHeight, pr = Math.min(devicePixelRatio || 1, [0.75, 1, 1.5][this.quality] ?? 1);
    this.renderer.setPixelRatio(pr); this.renderer.setSize(w, h, false);
    this.composer.setPixelRatio(pr); this.composer.setSize(w, h);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.fx.uAspect.value = w / h;
  }
  setScene(scene) { this.scene = scene; this.renderPass.scene = scene; }
  setLook(name, over = {}) {
    const L = { mono: 0, sepia: 0, old: 0, ...LOOKS.neutral, ...(LOOKS[name] || {}), ...over };
    this.look = L; const u = this.fx;
    u.uTint.value.fromArray(L.tint); u.uLift.value.fromArray(L.lift); u.uSat.value = L.sat; u.uContrast.value = L.contrast;
    u.uVignette.value = L.vignette; u.uGrain.value = L.grain; u.uMono.value = L.mono; u.uSepia.value = L.sepia; u.uOld.value = L.old;
    this.bloom.strength = L.bloom; this.renderer.toneMappingExposure = L.exposure ?? 1;
  }
  addShake(a) { this.shake = Math.min(2.5, this.shake + a); }
  flash(a = 1) { this.fx.uFlash.value = Math.max(this.fx.uFlash.value, a); }
  hurt(a = 1) { this.fx.uHurt.value = Math.max(this.fx.uHurt.value, a); }
  render(dtReal) {
    const u = this.fx; this.time += dtReal; u.uTime.value = this.time;
    u.uFlash.value = Math.max(0, u.uFlash.value - dtReal * 2.2);
    u.uHurt.value = Math.max(0, u.uHurt.value - dtReal * 0.9);
    // camera shake applied just for the render
    const c = this.camera, s = this.shake; this.shake = Math.max(0, s - dtReal * (1.5 + s * 2.5));
    if (s > 0.001) {
      const t = this.time * 38; this.shakeOff.set(Math.sin(t * 1.3) + Math.sin(t * 2.9), Math.sin(t * 1.7 + 1) + Math.sin(t * 3.3), 0).multiplyScalar(0.06 * s);
      c.position.add(this.shakeOff); c.rotation.z += Math.sin(t * 2.1) * 0.012 * s;
    }
    this.composer.render(dtReal);
    if (s > 0.001) c.position.sub(this.shakeOff);
  }
}
