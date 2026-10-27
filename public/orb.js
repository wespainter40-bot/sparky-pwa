// Sparky's energy core (v3: true-3D look).
//  Layers, back to front:
//   #dust   (page-wide 2D)  depth-sorted ambient motes with parallax
//   #back   (2D)            ground glow + platform rings + floor ripples, far halves of orbit rings, sparks behind the core
//   #plasma (WebGL)         glass sphere: real normals, key/rim light, AO terminator, raymarched inner plasma, halo
//   #core   (2D, on top)    near halves of orbit rings, shockwave shell, lightning, sparks in front of the core
//  A small "camera" (touch / pointer / device-orientation + idle sway) orbits the whole scene with perspective.
const STATES = {
  //            energy, swirl speed, breathe speed (rad/s), breathe depth, ember rate/s, streak share, bolt every (s), ring speed, ripple every (s)
  ready:     { energy: 0.30, swirl: 0.40, breathe: 0.85, amp: 0.022, rate: 4.5, streak: 0.12, bolt: 3.4, ring: 0.25, ripple: 0 },
  listening: { energy: 0.78, swirl: 1.00, breathe: 2.60, amp: 0.034, rate: 11, streak: 0.22, bolt: 1.0, ring: 0.80, ripple: 0 },
  thinking:  { energy: 0.90, swirl: 2.40, breathe: 4.60, amp: 0.026, rate: 26, streak: 0.34, bolt: 0.32, ring: 2.20, ripple: 0 },
  speaking:  { energy: 0.86, swirl: 1.20, breathe: 4.00, amp: 0.045, rate: 12, streak: 0.20, bolt: 0.65, ring: 0.70, ripple: 0.95 },
};
const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const E0 = 0.30;       // camera elevation: looking slightly down on the core (rad)
const FLOOR = -1.30;   // ground plane height under the core, in core radii

const VS = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';
const FS = `
precision highp float;
uniform vec2 uRes, uC, uTilt;
uniform float uR, uT, uPh, uE, uP, uFlash;
uniform sampler2D uNoise;
float gCy, gSy, gCx, gSx;
float hash(vec3 p){ p=fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
// texture-backed value noise (one fetch instead of eight hashes)
float noise(vec3 x){
  vec3 i=floor(x), f=fract(x); f=f*f*(3.-2.*f);
  vec2 uv=(i.xy+vec2(37.,17.)*i.z)+f.xy;
  vec2 rg=texture2D(uNoise,(uv+.5)/256.).yx;
  return mix(rg.x,rg.y,f.z);
}
float sq(float x){ return x*x; }
vec3 toView(vec3 p){
  p=vec3(p.x*gCy+p.z*gSy, p.y, -p.x*gSy+p.z*gCy);
  return vec3(p.x, p.y*gCx+p.z*gSx, -p.y*gSx+p.z*gCx);
}
vec3 fromView(vec3 p){
  p=vec3(p.x, p.y*gCx-p.z*gSx, p.y*gSx+p.z*gCx);
  return vec3(p.x*gCy-p.z*gSy, p.y, p.x*gSy+p.z*gCy);
}

void main(){
  gCy=cos(uTilt.x); gSy=sin(uTilt.x); gCx=cos(uTilt.y); gSx=sin(uTilt.y);
  vec2 q=(gl_FragCoord.xy-uC)/uR;
  float px=1./uR;
  float rr=1.+uP;
  q/=rr; px/=rr;
  float d=length(q);

  // ---- halo: tight hot fringe + wide soft bloom, faded before the canvas edge
  float ex=max(d-1.,0.);
  float hb=(0.50+0.95*uE)*(1.+0.6*uP);
  vec3 halo = vec3(0.00,0.80,0.33)*(exp(-ex*2.6)*0.15+exp(-ex*5.5)*0.30)*hb
            + vec3(0.15,1.00,0.55)*exp(-ex*16.)*0.55*hb
            + vec3(0.55,1.00,0.75)*exp(-ex*60.)*0.45*(0.5+uE);
  float edge=min(min(gl_FragCoord.x,uRes.x-gl_FragCoord.x),min(gl_FragCoord.y,uRes.y-gl_FragCoord.y))/uR;
  halo*=smoothstep(0.0,0.55,edge);

  float cov=1.-smoothstep(1.-px,1.+px,d);
  vec3 col=halo; float alpha=0.;

  if(d<1.+px*2.){
    float z=sqrt(max(1.-d*d,0.));
    vec3 n=vec3(q,z);
    float fr=1.-z;

    // ---- lighting (key light upper-left-front, fixed in the world so it slides as the camera orbits)
    vec3 Lk=normalize(toView(normalize(vec3(-.58,.66,.52))));
    float ndl=dot(n,Lk);
    float lit=smoothstep(-.10,.90,ndl);
    float ao=mix(.30,1.,lit);                       // occlusion toward the terminator / lower right

    // ---- raymarched inner plasma: 6 slices through the glass, near slices bright and mint, far slices deep and teal
    vec3 p0=fromView(vec3(q,z));
    vec3 dw=fromView(vec3(0.,0.,-1.))*(2.*z);
    const int N=6;
    float stp=2.*z/float(N);
    float jit=(hash(vec3(gl_FragCoord.xy,7.1))-.5)*.22;
    vec3 acc=vec3(0.); float trans=1.;
    for(int i=0;i<N;i++){
      float tt=(float(i)+.5+jit)/float(N);
      vec3 s=p0+dw*tt;
      float r=length(s);
      float sw=uPh*(.28+(1.-clamp(r,0.,1.))*.95);   // the inside turns faster than the skin
      float cs=cos(sw), sn=sin(sw);
      vec3 p=vec3(s.x*cs+s.z*sn, s.y, -s.x*sn+s.z*cs)*1.55;
      vec3 w=vec3(noise(p*.9+vec3(0.,0.,uPh*.30)), noise(p*.9+vec3(5.2,1.3,-uPh*.25)), noise(p*.9+vec3(2.1,7.7,uPh*.2)));
      vec3 pp=p*1.25+(w-.5)*2.5;
      float n1=noise(pp+vec3(0.,-uPh*.2,0.));
      float n2=noise(pp*2.6+vec3(uPh*.3,3.1,0.));
      float fil=pow(1.-abs(n1*2.-1.),5.);
      float fil2=pow(1.-abs(n2*2.-1.),9.);
      float cloud=smoothstep(.34,.80,n1);
      float rad=mix(1.,.6,smoothstep(.25,1.,r));
      float wd=mix(1.55,.30,tt);                       // near slices carry the detail, far ones are faint depth
      vec3 em=(vec3(0.,.42,.16)*cloud*.34 + vec3(.14,1.,.50)*fil*(.80+.90*uE) + vec3(.80,1.,.90)*fil2*1.25*(.3+.7*uE))*rad*wd;
      em*=mix(vec3(1.),vec3(.25,.55,.70),tt);          // farther slices go cooler and dimmer
      acc+=em*trans*stp*1.5;
      trans*=exp(-(.16+cloud*.7)*stp);
    }
    vec3 c=mix(vec3(0.,.020,.012),vec3(0.,.075,.034),lit)*(.6+.8*z);   // glass body
    c+=acc*mix(.26,1.18,lit);

    // hot centre
    float k=mix(14.,7.,uE);
    c+=vec3(.02,.80,.32)*exp(-d*d*3.4)*(.12+.28*uE);
    c=mix(c,vec3(.90,1.0,.94),clamp(exp(-d*d*k)*(.42+.36*uE),0.,1.));
    c+=vec3(.55,1.,.75)*exp(-d*d*46.)*(.40+.5*uE);

    // inner glow from thickness + soft subsurface band hugging the terminator
    c+=vec3(0.,.55,.22)*z*z*.10*(.5+uE)*ao;
    float band=exp(-sq(ndl*2.5))*(.35+.65*fr);
    c+=vec3(.45,1.,.30)*band*.10*(.35+uE);

    // fresnel and rim lights: cool-mint key rim on the lit side, warm gold kicker low right
    vec2 qd=normalize(q+vec2(1e-4));
    float kr=max(dot(qd,normalize(Lk.xy+vec2(1e-4))),0.);
    c+=vec3(0.,.70,.28)*pow(fr,2.6)*(.22+.40*uE)*mix(.45,1.,lit);
    c+=vec3(.50,1.,.80)*pow(fr,3.4)*kr*.85;
    c+=vec3(.40,1.,.68)*pow(fr,8.)*.55;
    float warm=pow(max(dot(qd,vec2(.70,-.71)),0.),2.5)*pow(fr,2.8);
    c+=vec3(1.,.72,.22)*warm*.60;

    c*=1.+uFlash*.55;
    c=1.-exp(-c*1.15);

    // glass: specular from the key light, a soft-box reflection, thin crescents, green ground bounce
    vec3 Hh=normalize(Lk+vec3(0.,0.,1.));
    float nh=max(dot(n,Hh),0.);
    c+=vec3(.95,1.,.97)*pow(nh,320.)*.9 + vec3(.7,1.,.85)*pow(nh,24.)*.10;
    vec3 rf=2.*z*n-vec3(0.,0.,1.);
    vec2 br=rf.xy-Lk.xy*.95; br=vec2(br.x*.82+br.y*.57,-br.x*.57+br.y*.82);
    vec2 bq=abs(br)-vec2(.17,.075);
    float sdb=length(max(bq,0.))+min(max(bq.x,bq.y),0.);
    c+=vec3(.90,1.,.95)*smoothstep(.07,-.02,sdb)*smoothstep(.05,.35,z)*.26;
    c+=vec3(0.,.85,.38)*smoothstep(-.15,-.95,rf.y)*.16*(.5+uE)*smoothstep(0.,.3,z);
    float ang=atan(q.y,q.x);
    float da=abs(mod(ang-2.35+3.14159,6.28318)-3.14159);
    c+=vec3(.85,1.,.92)*exp(-sq((d-.915)/.011))*smoothstep(.80,.05,da)*.45;
    float db=abs(mod(ang+0.85+3.14159,6.28318)-3.14159);
    c+=vec3(1.,.9,.6)*exp(-sq((d-.925)/.010))*smoothstep(.55,.05,db)*.30;
    float rim=exp(-sq((d-1.+2.2*px)/(1.9*px)));
    float rimv=.40+.60*kr+.25*sin(ang*3.+uPh*.6)+uFlash*.5;
    c+=mix(vec3(.2,1.,.6),vec3(.85,1.,.92),.5)*rim*rimv*(.55+.4*uE);

    vec3 inner=c+halo*.25;
    col=mix(halo,inner,cov);
    alpha=cov*.94;
  }
  col+=(hash(vec3(gl_FragCoord.xy,uT))-.5)/200.;
  gl_FragColor=vec4(max(col,0.),alpha);
}`;

function makeSprite(stops, size = 64) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const x = c.getContext('2d'), g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  stops.forEach(([o, col]) => g.addColorStop(o, col));
  x.fillStyle = g; x.fillRect(0, 0, size, size);
  return c;
}

// ---------- ambient dust: page-wide motes at many depths (far = tiny and crisp, near = big soft bokeh) ----------
class Dust {
  constructor(canvas, count) {
    this.c = canvas; this.x = canvas.getContext('2d');
    this.sprites = {
      green: makeSprite([[0, 'rgba(210,255,230,1)'], [0.22, 'rgba(90,255,170,.5)'], [1, 'rgba(0,200,83,0)']]),
      gold: makeSprite([[0, 'rgba(255,240,190,1)'], [0.22, 'rgba(255,200,80,.5)'], [1, 'rgba(255,160,20,0)']]),
      bokeh: makeSprite([[0, 'rgba(120,255,190,.34)'], [0.78, 'rgba(120,255,190,.46)'], [0.9, 'rgba(190,255,220,.85)'], [1, 'rgba(120,255,190,0)']]),
    };
    this.p = [];
    for (let i = 0; i < count; i++) this.p.push(this.make(true));
    this.shock = null; this.shockId = 0; this.t = 0; this.cx = 200; this.cy = 400;
    this.resize();
  }
  make(init) {
    const d = Math.pow(Math.random(), 1.25); // 0 far .. 1 near
    return {
      d, x: Math.random() * (this.w || 400), y: init ? Math.random() * (this.h || 800) : (this.h || 800) + 20,
      vx: rand(-4, 4), vy: -rand(2, 8) * (0.35 + d), sway: rand(0, TAU), sw: rand(0.2, 0.6),
      tw: rand(0, TAU), ts: rand(0.6, 2.2), gold: Math.random() < 0.18, hit: 0,
    };
  }
  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.w = this.c.clientWidth || innerWidth; this.h = this.c.clientHeight || innerHeight;
    this.c.width = Math.round(this.w * dpr); this.c.height = Math.round(this.h * dpr);
    this.x.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  push(s) { this.shock = { r: 0, s, id: ++this.shockId }; }
  draw(dt, tx, ty, e, glowOn) {
    const c = this.x; this.t += dt;
    c.clearRect(0, 0, this.w, this.h);
    c.globalCompositeOperation = 'lighter';
    const boost = 1 + e * 1.4;
    if (this.shock) { this.shock.r += 540 * dt; if (this.shock.r > 900) this.shock = null; }
    for (const p of this.p) {
      const drag = Math.exp(-1.3 * dt);
      p.vx = p.vx * drag + Math.sin(this.t * p.sw + p.sway) * 2.8 * dt;
      const base = -(3 + p.d * 7) * boost;
      p.vy += (base - p.vy) * Math.min(1, dt * 0.9);
      if (this.shock) {
        const dx = p.x - this.cx, dy = p.y - this.cy, dist = Math.hypot(dx, dy) || 1;
        if (p.hit !== this.shock.id && Math.abs(dist - this.shock.r) < 34) {
          p.hit = this.shock.id; const f = this.shock.s * (28 + 70 * p.d) / dist;
          p.vx += dx * f; p.vy += dy * f;
        }
      }
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.y < -30) { p.y = this.h + 24; p.x = Math.random() * this.w; }
      if (p.x < -30) p.x = this.w + 24; else if (p.x > this.w + 30) p.x = -24;
      const sx = p.x + tx * (p.d - 0.35) * 46, sy = p.y - ty * (p.d - 0.35) * 28;
      const tw = 0.62 + 0.38 * Math.sin(this.t * p.ts * boost + p.tw);
      const spr = p.gold ? this.sprites.gold : this.sprites.green;
      if (p.d > 0.78) { // near: out-of-focus bokeh discs
        const s = 9 + p.d * 15;
        c.globalAlpha = 0.075 * tw * (0.8 + e * 0.5);
        c.drawImage(this.sprites.bokeh, sx - s, sy - s, s * 2, s * 2);
      } else if (p.d > 0.45) { // mid: soft glow
        const s = 3 + p.d * 5;
        c.globalAlpha = 0.28 * tw * (0.7 + e * 0.6);
        c.drawImage(spr, sx - s * 2, sy - s * 2, s * 4, s * 4);
      } else { // far: small, crisp, dimmer
        const s = 1.3 + p.d * 2.4;
        c.globalAlpha = (0.30 + p.d * 0.5) * tw * (0.7 + e * 0.6);
        c.drawImage(spr, sx - s * 2, sy - s * 2, s * 4, s * 4);
      }
    }
    c.globalAlpha = 1;
  }
}

export class Orb {
  /** @param canvas front 2D layer, @param glCanvas plasma WebGL layer, @param extra {back, dust} optional layers */
  constructor(canvas, glCanvas, extra = {}) {
    this.canvas = canvas; this.glc = glCanvas;
    this.ctx = canvas.getContext('2d');                          // front
    this.bc = extra.back ? extra.back.getContext('2d') : null;   // back
    this.backCanvas = extra.back || null;
    if (!this.bc) this.bc = this.ctx;                            // single-layer fallback
    const small = matchMedia('(max-width: 600px), (pointer: coarse)').matches;
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.calm = calm;
    this.maxParticles = small ? 90 : 170;
    if (calm) this.maxParticles = Math.floor(this.maxParticles / 3);
    this.dprCap = 3;
    const qs = new URLSearchParams(location.search);
    this.adaptive = qs.get('q') !== 'max';
    this.glScale = 1; this.slowFrames = 0;
    this.gl = this.initGL();
    this.dust = extra.dust ? new Dust(extra.dust, calm ? 18 : small ? 46 : 70) : null;
    this.sprites = {
      gold: makeSprite([[0, 'rgba(255,236,170,1)'], [0.25, 'rgba(255,196,60,.55)'], [1, 'rgba(255,150,20,0)']]),
      green: makeSprite([[0, 'rgba(235,255,240,1)'], [0.3, 'rgba(60,255,150,.45)'], [1, 'rgba(0,200,83,0)']]),
    };
    // 3D orbit rings: radius (core radii), inclination, roll, precession speed, comet tail, colours
    this.rings = [
      { rad: 1.40, ix: 0.34, roll: -0.36, prec: 0.0, ps: 0.06, wob: 0.09, dir: 1, head: rand(0, TAU), tail: 2.3, col: [92, 242, 160], bead: [255, 214, 90], a: 1 },
      { rad: 1.31, ix: -0.40, roll: 0.52, prec: 1.2, ps: -0.05, wob: 0.08, dir: -1, head: rand(0, TAU), tail: 1.8, col: [255, 200, 61], bead: [200, 255, 225], a: 0.95 },
      { rad: 1.20, ix: 1.12, roll: 0.95, prec: 0.4, ps: 0.08, wob: 0.07, dir: 1, head: rand(0, TAU), tail: 1.4, col: [190, 255, 225], bead: [255, 236, 170], a: 0.62 },
    ];
    this.bolts = []; this.parts = []; this.waves = [];
    this.state = 'ready'; this.energy = 0.3; this.swirl = 0.4; this.ringSpeed = 0.25;
    this.phase = 0; this.breathe = 0; this.t = 0; this.last = 0; this.acc = 0; this.boltT = 1.2; this.rippleT = 0;
    this.flash = 0; this.kick = 0; this.press = 0; this.level = 0; this.levelT = 0; this.levelTarget = 0; this.levelProvider = null; this.waveT = 0;
    // camera: touch/pointer spring + device orientation + idle sway
    this.touchT = { x: 0, y: 0 }; this.touch = { x: 0, y: 0, vx: 0, vy: 0 }; this.touching = false;
    this.motionT = { x: 0, y: 0 }; this.motion = { x: 0, y: 0 }; this.hasMotion = false;
    this.cam = { yaw: 0, pitch: -E0 }; this.camT = { cy: 1, sy: 0, cx: Math.cos(E0), sx: -Math.sin(E0) };
    this.user = { x: 0, y: 0 }; this.onTilt = null; this._lastTilt = [9, 9];
    this._p = [0, 0, 0, 1]; this._xs = new Float32Array(100); this._ys = new Float32Array(100); this._zs = new Float32Array(100); this._ss = new Float32Array(100);
    this.bob = 0; this.rect = { cx: 200, cy: 300 };
    this.resize();
    new ResizeObserver(() => this.resize()).observe(canvas);
    addEventListener('resize', () => this.resize());
    this.bindInput();
    requestAnimationFrame((t) => this.frame(t));
  }

  initGL() {
    let gl;
    try { gl = this.glc.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: false, powerPreference: 'high-performance' }); } catch { /* none */ }
    if (!gl) return null;
    const sh = (type, src) => {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.error('Sparky shader:', gl.getShaderInfoLog(s)); return null; }
      return s;
    };
    const vs = sh(gl.VERTEX_SHADER, VS), fs = sh(gl.FRAGMENT_SHADER, FS);
    if (!vs || !fs) return null;
    const pr = gl.createProgram(); gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { console.error('Sparky link:', gl.getProgramInfoLog(pr)); return null; }
    gl.useProgram(pr);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, 'a'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this.u = {};
    for (const n of ['uRes', 'uC', 'uTilt', 'uR', 'uT', 'uPh', 'uE', 'uP', 'uFlash', 'uNoise']) this.u[n] = gl.getUniformLocation(pr, n);
    // 256x256 noise: R = field(x+37,y+17), G = field(x,y), so one bilinear fetch gives two z-slices of 3D value noise
    const N = 256, B = new Uint8Array(N * N), data = new Uint8Array(N * N * 4);
    for (let i = 0; i < B.length; i++) B[i] = (Math.random() * 256) | 0;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const o = (y * N + x) * 4;
      data[o] = B[((y + 17) & 255) * N + ((x + 37) & 255)]; data[o + 1] = B[y * N + x]; data[o + 2] = 0; data[o + 3] = 255;
    }
    const tex = gl.createTexture(); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, N, N, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.uniform1i(this.u.uNoise, 0);
    gl.clearColor(0, 0, 0, 0);
    return gl;
  }

  setState(s) { this.state = STATES[s] ? s : 'ready'; }
  /** Real mic level provider: () => 0..1, or null for the simulated level. */
  setLevelProvider(fn) { this.levelProvider = fn || null; }

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, this.dprCap);
    this.dpr = dpr;
    this.w = this.canvas.clientWidth; this.h = this.canvas.clientHeight;
    this.canvas.width = Math.round(this.w * dpr); this.canvas.height = Math.round(this.h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.backCanvas) {
      this.bdpr = Math.min(dpr, 2);
      this.backCanvas.width = Math.round(this.w * this.bdpr); this.backCanvas.height = Math.round(this.h * this.bdpr);
      this.bc.setTransform(this.bdpr, 0, 0, this.bdpr, 0, 0);
    }
    this.applyGLSize();
    this.cx = this.w / 2; this.cy = this.h * 0.44; this.R = Math.min(this.w * 0.27, this.h * 0.31);
    this.F = this.R * 6.5;
    this.ccx = this.cx; this.ccy = this.cy;
    if (this.dust) {
      this.dust.resize();
      const r = this.canvas.getBoundingClientRect();
      this.rect = { cx: r.left + this.cx, cy: r.top + this.cy };
      this.dust.cx = this.rect.cx; this.dust.cy = this.rect.cy;
    } else {
      const r = this.canvas.getBoundingClientRect(); this.rect = { cx: r.left + this.cx, cy: r.top + this.cy };
    }
  }

  applyGLSize() {
    this.glk = this.dpr * this.glScale;
    this.glc.width = Math.max(2, Math.round(this.w * this.glk)); this.glc.height = Math.max(2, Math.round(this.h * this.glk));
    if (this.gl) this.gl.viewport(0, 0, this.glc.width, this.glc.height);
  }

  // ---------- input: pointer / touch springs, device tilt ----------
  bindInput() {
    const move = (e, down) => {
      const x = clamp((e.clientX - this.rect.cx) / (this.R * 2.3), -1, 1);
      const y = clamp(-(e.clientY - this.rect.cy) / (this.R * 2.8), -1, 1);
      this.touchT.x = x; this.touchT.y = y;
      if (down) { this.touching = true; this.press = 1; }
    };
    addEventListener('pointerdown', (e) => move(e, true), { passive: true });
    addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' || this.touching) move(e, false); }, { passive: true });
    const up = () => { this.touching = false; this.touchT.x = 0; this.touchT.y = 0; };
    addEventListener('pointerup', up, { passive: true });
    addEventListener('pointercancel', up, { passive: true });
    document.documentElement.addEventListener('pointerleave', up, { passive: true });
    // device orientation: only once the user has tapped (iOS needs a gesture + permission)
    const ask = async () => {
      if (this.hasMotion || typeof DeviceOrientationEvent === 'undefined' || !matchMedia('(pointer: coarse)').matches || this.calm) return;
      try {
        if (typeof DeviceOrientationEvent.requestPermission === 'function') {
          if (localStorage.getItem('sparkyMotion') === 'no') return;
          const r = await DeviceOrientationEvent.requestPermission();
          if (r !== 'granted') { localStorage.setItem('sparkyMotion', 'no'); return; }
        }
      } catch { return; }
      let base = null;
      addEventListener('deviceorientation', (ev) => {
        if (ev.gamma == null || ev.beta == null) return;
        if (!base) base = { g: ev.gamma, b: ev.beta };
        base.g += (ev.gamma - base.g) * 0.01; base.b += (ev.beta - base.b) * 0.01; // slowly re-centre
        this.motionT.x = clamp((ev.gamma - base.g) / 28, -1, 1);
        this.motionT.y = clamp(-(ev.beta - base.b) / 28, -1, 1);
        this.hasMotion = true;
      }, { passive: true });
      this.hasMotion = true;
    };
    document.addEventListener('click', ask, { once: true, capture: true });
  }

  /** Burst of gold sparks (mostly embers, a few bright streaks) from the core edge. */
  burst(n = 16) {
    for (let i = 0; i < n; i++) this.emit(Math.random() < 0.35 ? 'streak' : 'ember', rand(0, TAU), 1.3);
  }

  /** Shockwave: expanding shell, equator ring and floor ring, a flash, a squash-and-stretch kick, and dust blown outward. */
  shockwave(s = 1) {
    this.waves.push({ kind: 'eq', t: 0, ttl: 1.25, s, shell: true });
    this.waves.push({ kind: 'floor', t: 0, ttl: 1.6, s: s * 0.9 });
    this.kick = Math.min(1.3, this.kick + 1); this.flash = Math.min(1, this.flash + 0.8);
    if (this.dust) this.dust.push(s);
    this.burst(10);
  }

  emit(kind, ang, power = 1) {
    if (this.parts.length >= this.maxParticles) return;
    const R = this.R, streak = kind === 'streak';
    // direction on the unit sphere: mostly around the silhouette, some towards the camera, some away
    const zz = Math.pow(Math.random(), 1.9) * (Math.random() < 0.5 ? 1 : -1) * 0.92, k = Math.sqrt(1 - zz * zz);
    const ux = Math.cos(ang) * k, uy = Math.sin(ang) * k, r = R * rand(0.99, 1.04);
    const sp = (streak ? rand(170, 420) : rand(25, 110)) * power;
    const tang = rand(-0.35, 0.35) * sp;
    this.parts.push({
      streak, x: ux * r, y: uy * r, z: zz * r,
      vx: ux * sp - uy * tang, vy: uy * sp + ux * tang, vz: zz * sp * 0.8,
      life: 0, ttl: streak ? rand(0.35, 0.8) : rand(0.9, 2.2),
      size: streak ? rand(1.1, 1.9) : rand(0.7, 1.7), seed: rand(0, 100),
    });
  }

  // lightning: midpoint displacement with a few thin branches
  jag(x1, y1, x2, y2, disp, depth, out) {
    if (depth === 0) { out.push([x2, y2]); return; }
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, dx = x2 - x1, dy = y2 - y1, l = Math.hypot(dx, dy) || 1;
    const o = rand(-1, 1) * disp, nx = mx - (dy / l) * o, ny = my + (dx / l) * o;
    this.jag(x1, y1, nx, ny, disp * 0.55, depth - 1, out);
    this.jag(nx, ny, x2, y2, disp * 0.55, depth - 1, out);
  }

  buildBolt(b) {
    const paths = [], main = [[b.sx, b.sy]];
    this.jag(b.sx, b.sy, b.ex, b.ey, b.len * 0.2, 4, main);
    paths.push({ pts: main, w: 1 });
    const nb = b.long ? 2 : (Math.random() < 0.7 ? 1 : 2);
    for (let i = 0; i < nb; i++) {
      const k = Math.floor(rand(3, main.length - 3)), [bx, by] = main[k];
      const a = Math.atan2(b.ey - b.sy, b.ex - b.sx) + rand(0.45, 0.9) * (Math.random() < 0.5 ? -1 : 1);
      const bl = b.len * rand(0.18, 0.34), pts = [[bx, by]];
      this.jag(bx, by, bx + Math.cos(a) * bl, by + Math.sin(a) * bl, bl * 0.2, 3, pts);
      paths.push({ pts, w: 0.55 });
    }
    b.paths = paths;
  }

  makeBolt(e) {
    const R = this.R, ang = rand(0, TAU), long = Math.random() < 0.25 && e > 0.5;
    const len = R * (long ? rand(1.2, 1.45) : 0.97);
    const b = {
      sx: this.cx + rand(-0.06, 0.06) * R, sy: this.cy + rand(-0.06, 0.06) * R,
      ex: this.cx + Math.cos(ang) * len, ey: this.cy + Math.sin(ang) * len,
      ang, long, len, life: 0, ttl: rand(0.22, 0.42), rebuilt: false,
    };
    this.buildBolt(b);
    this.bolts.push(b);
    this.flash = Math.min(1, this.flash + 0.55);
  }

  // ---------- camera projection (core radii, y up, +z towards the viewer) ----------
  proj(x, y, z, o) {
    const m = this.camT;
    let X = x * m.cy + z * m.sy, Z = -x * m.sy + z * m.cy;
    const Y = y * m.cx + Z * m.sx; Z = -y * m.sx + Z * m.cx;
    const s = this.F / (this.F - Z * this.R);
    o[0] = this.ccx + X * this.R * s; o[1] = this.ccy - Y * this.R * s; o[2] = Z; o[3] = s;
  }

  frame(now) {
    requestAnimationFrame((t) => this.frame(t));
    if (document.hidden) { this.last = 0; return; }
    const dt = Math.min(0.05, this.last ? (now - this.last) / 1000 : 0.016);
    this.last = now; this.t += dt;
    this.adapt(dt);
    const cfg = STATES[this.state], k = Math.min(1, dt * 2.5);
    this.energy += (cfg.energy - this.energy) * k;
    this.swirl += (cfg.swirl - this.swirl) * k;
    this.ringSpeed += (cfg.ring - this.ringSpeed) * k;
    this.amp = (this.amp ?? cfg.amp); this.amp += (cfg.amp - this.amp) * k;
    this.bre = (this.bre ?? cfg.breathe); this.bre += (cfg.breathe - this.bre) * k;
    this.phase += this.swirl * dt;
    this.breathe += this.bre * dt;
    this.flash *= Math.exp(-dt * 7);
    this.kick *= Math.exp(-dt * 4.2);
    this.press *= Math.exp(-dt * 5);

    // ---- camera: spring-follow the touch, ease device tilt, add a gentle idle sway
    const T = this.touch, K = 120, D = this.touching ? 16 : 9;
    T.vx += ((this.touchT.x - T.x) * K - T.vx * D) * dt; T.vy += ((this.touchT.y - T.y) * K - T.vy * D) * dt;
    T.x += T.vx * dt; T.y += T.vy * dt;
    if (this.hasMotion) {
      const m = this.motion, mk = Math.min(1, dt * 5);
      m.x += (this.motionT.x - m.x) * mk; m.y += (this.motionT.y - m.y) * mk;
    }
    const ux = clamp(T.x + this.motion.x, -1.2, 1.2), uy = clamp(T.y + this.motion.y, -1.2, 1.2);
    this.user.x = ux; this.user.y = uy;
    const swayK = (this.calm ? 0.25 : 1) * (1 - 0.5 * Math.min(1, Math.hypot(ux, uy)));
    const yaw = ux * 0.46 + swayK * (0.10 * Math.sin(this.t * 0.37) + 0.05 * Math.sin(this.t * 0.93 + 1.3));
    const pitch = uy * 0.26 + swayK * 0.05 * Math.sin(this.t * 0.53 + 2.1) - E0;
    this.cam.yaw = yaw; this.cam.pitch = pitch;
    this.camT.cy = Math.cos(yaw); this.camT.sy = Math.sin(yaw); this.camT.cx = Math.cos(pitch); this.camT.sx = Math.sin(pitch);
    // floating: the core bobs; the ground glow answers
    this.bob = (this.calm ? 0.3 : 1) * (Math.sin(this.t * 0.95) * 0.045 + Math.sin(this.t * 1.7 + 0.8) * 0.012);
    this.ccx = this.cx + yaw * this.R * 0.05; this.ccy = this.cy - this.bob * this.R * 1.0 - this.press * this.R * 0.02;
    if (this.onTilt) {
      const l = this._lastTilt;
      if (Math.abs(l[0] - ux) > 0.004 || Math.abs(l[1] - uy) > 0.004) { l[0] = ux; l[1] = uy; this.onTilt(ux, uy); }
    }

    // ---- level: real mic when available, otherwise a lively, smoothed random stand-in
    let lvlRaw = 0;
    if (this.state === 'listening') {
      const real = this.levelProvider ? this.levelProvider() : null;
      if (real != null) lvlRaw = real;
      else {
        this.levelT -= dt;
        if (this.levelT <= 0) { this.levelT = rand(0.08, 0.2); this.levelTarget = Math.random() < 0.3 ? rand(0, 0.25) : rand(0.35, 1); }
        lvlRaw = this.levelTarget;
      }
    } else this.levelTarget = 0;
    this.level += (lvlRaw - this.level) * Math.min(1, dt * (lvlRaw > this.level ? 14 : 7));

    let pulse = Math.sin(this.breathe);
    if (this.state === 'speaking') pulse *= 0.55 + 0.45 * Math.sin(this.t * 9.1) * Math.sin(this.t * 3.7);
    pulse += this.level * 0.9;
    const e = Math.min(1.25, this.energy + this.level * 0.2 + this.kick * 0.12);
    const P = this.amp * pulse + this.kick * 0.07 - this.press * 0.025;

    // ambient sparks
    this.acc += dt * (cfg.rate + this.level * 14);
    while (this.acc >= 1) {
      this.acc -= 1;
      this.emit(Math.random() < cfg.streak ? 'streak' : 'ember', rand(0, TAU), 0.8 + e * 0.5);
    }
    // lightning, sparingly
    this.boltT -= dt;
    if (this.boltT <= 0) {
      this.boltT = cfg.bolt * rand(0.6, 1.4);
      if (this.bolts.length < 3) this.makeBolt(e);
    }
    // ripples: speaking has a steady cadence; listening is driven by the mic level (peaks make bigger rings)
    this.waveT -= dt;
    if (this.state === 'speaking') {
      if (this.waveT <= 0) { this.waveT = cfg.ripple; this.waves.push({ kind: 'both', t: 0, ttl: 1.7, s: 0.55 }); }
    } else if (this.state === 'listening') {
      if (this.waveT <= 0 && this.level > 0.14) {
        this.waveT = Math.max(0.16, 0.62 - this.level * 0.5);
        this.waves.push({ kind: this.level > 0.4 ? 'both' : 'floor', t: 0, ttl: 1.5 + this.level * 0.4, s: clamp(this.level * 1.05, 0.25, 1) });
      }
    } else this.waveT = 0.2;
    if (this.waves.length > 14) this.waves.splice(0, this.waves.length - 14);

    if (this.gl) this.drawPlasma(P, e);
    const f = this.ctx, b = this.bc;
    f.clearRect(0, 0, this.w, this.h);
    if (b !== f) b.clearRect(0, 0, this.w, this.h);
    if (!this.gl) this.drawFallback(f, P, e);
    this.drawFloor(b, e);
    this.drawWaves(b, f, dt);
    this.drawRings(b, f, dt, P, e);
    this.drawBolts(f, dt);
    this.drawParticles(b, f, dt);
    if (this.dust && !(this._df = !this._df)) this.dust.draw(dt * 2, ux, uy, e);
  }

  // dynamic resolution: if the GPU can't hold ~50fps for a couple of seconds, render the plasma a bit smaller
  adapt(dt) {
    if (!this.adaptive || !this.gl) return;
    this.avg = this.avg ? this.avg + (dt - this.avg) * 0.05 : dt;
    if (this.avg > 0.0215 && this.glScale > 0.6) {
      if (++this.slowFrames > 90) { this.slowFrames = 0; this.glScale = Math.max(0.6, this.glScale * 0.85); this.avg = 0.016; this.applyGLSize(); }
    } else this.slowFrames = Math.max(0, this.slowFrames - 2);
  }

  drawPlasma(P, e) {
    const gl = this.gl, d = this.glk, u = this.u;
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(u.uRes, this.glc.width, this.glc.height);
    gl.uniform2f(u.uC, this.ccx * d, (this.h - this.ccy) * d);
    gl.uniform1f(u.uR, this.R * d);
    gl.uniform1f(u.uT, this.t % 100);
    gl.uniform1f(u.uPh, this.phase);
    gl.uniform1f(u.uE, e);
    gl.uniform1f(u.uP, P);
    gl.uniform1f(u.uFlash, this.flash);
    gl.uniform2f(u.uTilt, this.cam.yaw, this.cam.pitch);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  drawFallback(c, P, e) { // no WebGL: a simple glowing disc
    const r = this.R * (1 + P);
    c.globalCompositeOperation = 'lighter';
    const g = c.createRadialGradient(this.ccx, this.ccy, 0, this.ccx, this.ccy, r * 1.8);
    g.addColorStop(0, 'rgba(220,255,235,.95)'); g.addColorStop(0.35, `rgba(0,200,83,${0.5 + e * 0.3})`);
    g.addColorStop(0.56, 'rgba(0,120,50,.5)'); g.addColorStop(1, 'rgba(0,200,83,0)');
    c.fillStyle = g; c.fillRect(0, 0, this.w, this.h);
    c.globalCompositeOperation = 'source-over';
  }

  // ---------- ground: soft light pool, reflection column and a slow hologram platform ----------
  drawFloor(c, e) {
    const p = this._p, R = this.R, fy = FLOOR - this.bob;
    this.proj(0, fy, 0, p); const gx = p[0], gy = p[1];
    this.proj(1, fy, 0, p); const rx = Math.max(1, Math.abs(p[0] - gx));
    this.proj(0, fy, 1, p); const ry = Math.max(1, Math.abs(p[1] - gy)), rat = ry / rx;
    const hi = 1 - clamp(this.bob * 5, -1, 1) * 0.12; // core rises: pool shrinks and dims a touch
    const en = 0.55 + e * 0.75 + this.kick * 0.4;
    c.save(); c.globalCompositeOperation = 'lighter';
    c.translate(gx, gy); c.scale(1, rat);
    let g = c.createRadialGradient(0, 0, 0, 0, 0, rx * 1.75);
    g.addColorStop(0, `rgba(30,255,150,${0.34 * en / hi})`); g.addColorStop(0.28, `rgba(0,220,110,${0.17 * en})`);
    g.addColorStop(0.62, `rgba(0,170,80,${0.06 * en})`); g.addColorStop(1, 'rgba(0,150,70,0)');
    c.fillStyle = g; c.beginPath(); c.arc(0, 0, rx * 1.75, 0, TAU); c.fill();
    g = c.createRadialGradient(0, 0, 0, 0, 0, rx * 0.75);
    g.addColorStop(0, `rgba(190,255,225,${0.40 * en / hi})`); g.addColorStop(0.45, `rgba(60,255,160,${0.16 * en})`); g.addColorStop(1, 'rgba(0,200,100,0)');
    c.fillStyle = g; c.beginPath(); c.arc(0, 0, rx * 0.75, 0, TAU); c.fill();
    c.restore();
    // reflection column: a soft vertical smear of the core's light on the glossy floor
    c.save(); c.globalCompositeOperation = 'lighter'; c.translate(this.ccx, gy + ry * 0.45); c.scale(1, 1.5);
    g = c.createRadialGradient(0, 0, 0, 0, 0, R * 0.62);
    g.addColorStop(0, `rgba(150,255,210,${0.20 * en})`); g.addColorStop(0.5, `rgba(40,240,140,${0.07 * en})`); g.addColorStop(1, 'rgba(0,200,100,0)');
    c.fillStyle = g; c.beginPath(); c.arc(0, 0, R * 0.62, 0, TAU); c.fill();
    c.restore();
    // platform rings: thin, slowly turning arcs, brighter when busy
    c.globalCompositeOperation = 'lighter'; c.lineCap = 'round';
    const ph = this.t * (0.12 + this.ringSpeed * 0.12), a = (0.16 + e * 0.22);
    this.ringOnFloor(c, fy, 1.05, 0, 1, `rgba(120,255,190,${a * 0.8})`, 1.1);
    for (let i = 0; i < 3; i++) this.arcOnFloor(c, fy, 1.5, ph + i * 2.09, 1.15, `rgba(255,205,90,${a})`, 1.3);
    this.arcOnFloor(c, fy, 1.24, -ph * 1.4, 2.6, `rgba(120,255,190,${a * 0.55})`, 0.9);
    c.globalCompositeOperation = 'source-over';
  }
  ringOnFloor(c, y, rad, a0, len, style, lw) { this.arcOnFloor(c, y, rad, a0, len * TAU, style, lw); }
  arcOnFloor(c, y, rad, a0, len, style, lw) {
    const p = this._p, n = Math.max(6, Math.round(len * 14));
    c.strokeStyle = style; c.lineWidth = lw; c.beginPath();
    for (let i = 0; i <= n; i++) {
      const t = a0 + (i / n) * len;
      this.proj(Math.cos(t) * rad, y, Math.sin(t) * rad, p);
      i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]);
    }
    c.stroke();
  }

  // a horizontal ring in 3D at height y, radius rad: far half to the back canvas, near half to the front canvas
  loopRing(b, f, y, rad, layers) {
    const N = 64, xs = this._xs, ys = this._ys, zs = this._zs, p = this._p;
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * TAU; this.proj(Math.cos(t) * rad, y, Math.sin(t) * rad, p);
      xs[i] = p[0]; ys[i] = p[1]; zs[i] = p[2];
    }
    for (let pass = 0; pass < 2; pass++) {
      const c = pass ? f : b;
      for (const [style, lw] of layers) {
        c.strokeStyle = style; c.lineWidth = lw; c.beginPath();
        let pen = false;
        for (let i = 0; i <= N; i++) {
          const front = zs[i] >= 0;
          if (front === (pass === 1)) { pen ? c.lineTo(xs[i], ys[i]) : c.moveTo(xs[i], ys[i]); pen = true; }
          else if (pen) { c.lineTo(xs[i], ys[i]); pen = false; }
        }
        c.stroke();
      }
    }
  }

  drawWaves(b, f, dt) {
    const rmax = Math.min(2.25, (this.w / 2 - 6) / this.R);
    b.globalCompositeOperation = 'lighter'; f.globalCompositeOperation = 'lighter';
    b.lineCap = f.lineCap = 'round';
    this.waves = this.waves.filter((w) => {
      w.t += dt; if (w.t >= w.ttl) return false;
      const p = w.t / w.ttl, ease = 1 - Math.pow(1 - p, 2.4), a = Math.pow(1 - p, 1.5) * w.s;
      const g = Math.round(255 - 40 * p), bl = Math.round(150 - 80 * p), r = Math.round(70 + 185 * p);
      if (w.kind === 'floor' || w.kind === 'both') {
        const rad = 0.45 + ease * (rmax - 0.45);
        this.loopRing(b, f, FLOOR - this.bob, rad, [[`rgba(${r},${g},${bl},${0.14 * a})`, 6 * (1 - p * 0.5)], [`rgba(${r},${g},${bl},${0.85 * a})`, 1.6 * (1 - p * 0.5)]]);
      }
      if (w.kind === 'eq' || w.kind === 'both') {
        const rad = 1.08 + ease * (rmax - 1.08) * (w.shell ? 1 : 0.85);
        const sc = w.shell ? 1 : 0.55;
        this.loopRing(b, f, 0, rad, [[`rgba(${r},${g},${bl},${0.14 * a * sc})`, 7 * (1 - p * 0.6)], [`rgba(${Math.min(255, r + 80)},255,${bl + 60},${0.75 * a * sc})`, 1.5 * (1 - p * 0.6)]]);
      }
      if (w.shell) { // spherical shock shell, facing the camera
        const sr = this.R * (1.02 + ease * 0.5);
        f.strokeStyle = `rgba(200,255,225,${0.5 * a})`; f.lineWidth = 2.2 * (1 - p);
        f.beginPath(); f.arc(this.ccx, this.ccy, sr, 0, TAU); f.stroke();
        const g2 = f.createRadialGradient(this.ccx, this.ccy, sr * 0.8, this.ccx, this.ccy, sr * 1.18);
        g2.addColorStop(0, 'rgba(0,255,150,0)'); g2.addColorStop(0.6, `rgba(0,255,150,${0.16 * a})`); g2.addColorStop(1, 'rgba(0,255,150,0)');
        f.fillStyle = g2; f.beginPath(); f.arc(this.ccx, this.ccy, sr * 1.18, 0, TAU); f.fill();
      }
      return true;
    });
  }

  // true 3D orbit rings (inclination, roll, precession, perspective); near halves pass in front of the core, far halves behind it
  drawRings(b, f, dt, P, e) {
    const N = 72, p = this._p, xs = this._xs, ys = this._ys, zs = this._zs, ss = this._ss, Rr = 1 + P * 0.6;
    b.globalCompositeOperation = 'lighter'; f.globalCompositeOperation = 'lighter';
    b.lineCap = f.lineCap = 'round';
    for (const ring of this.rings) {
      ring.head = (ring.head + ring.dir * this.ringSpeed * dt) % TAU;
      ring.prec += ring.ps * dt;
      const ix = ring.ix + ring.wob * Math.sin(this.t * 0.45 + ring.roll * 3);
      const cxr = Math.cos(ix), sxr = Math.sin(ix), czr = Math.cos(ring.roll), szr = Math.sin(ring.roll), cyr = Math.cos(ring.prec), syr = Math.sin(ring.prec);
      const rad = ring.rad * Rr;
      const place = (t, o) => {
        const x0 = Math.cos(t) * rad, z0 = Math.sin(t) * rad;
        const y1 = z0 * sxr, z1 = z0 * cxr;                 // inclination
        const x2 = x0 * czr - y1 * szr, y2 = x0 * szr + y1 * czr; // roll
        this.proj(x2 * cyr + z1 * syr, y2, -x2 * syr + z1 * cyr, o);  // precession, then camera
      };
      for (let i = 0; i <= N; i++) { place((i / N) * TAU, p); xs[i] = p[0]; ys[i] = p[1]; zs[i] = p[2]; ss[i] = p[3]; }
      const [cr, cg, cb] = ring.col;
      // soft occlusion: the near arc darkens the glass it crosses
      f.save();
      f.beginPath(); f.arc(this.ccx, this.ccy, this.R * 0.985, 0, TAU); f.clip();
      f.globalCompositeOperation = 'source-over'; f.strokeStyle = 'rgba(0,10,5,.11)'; f.lineWidth = 4.5; f.beginPath();
      for (let i = 0; i < N; i++) if (zs[i] + zs[i + 1] > 0.15) { f.moveTo(xs[i] + 2, ys[i] + 3.5); f.lineTo(xs[i + 1] + 2, ys[i + 1] + 3.5); }
      f.stroke(); f.restore();
      for (let i = 0; i < N; i++) {
        const t = ((i + 0.5) / N) * TAU, zm = (zs[i] + zs[i + 1]) * 0.5, sm = (ss[i] + ss[i + 1]) * 0.5;
        let s = ring.dir * (ring.head - t); s = ((s % TAU) + TAU) % TAU;
        const tail = s < ring.tail ? Math.pow(1 - s / ring.tail, 2) : 0;
        const depthA = 0.45 + 0.55 * clamp((zm / ring.rad + 1) * 0.5, 0, 1);
        const front = zm >= 0, c = front ? f : b;
        const a = (0.34 + 0.66 * tail) * (0.6 + 0.45 * e) * depthA * ring.a * (front ? 1.35 : 0.85);
        if (front) { c.globalCompositeOperation = 'source-over'; c.strokeStyle = `rgba(${Math.min(255, cr + 40)},${Math.min(255, cg + 20)},${Math.min(255, cb + 40)},${Math.min(1, a)})`; }
        else { c.globalCompositeOperation = 'lighter'; c.strokeStyle = `rgba(${cr},${cg},${cb},${a})`; }
        c.lineWidth = (1.1 + tail * 1.2) * sm * sm;
        c.beginPath(); c.moveTo(xs[i], ys[i]); c.lineTo(xs[i + 1], ys[i + 1]); c.stroke();
      }
      f.globalCompositeOperation = 'lighter';
      place(ring.head, p);
      const [hx, hy, hz, hs] = p, [br, bg, bb] = ring.bead, c = hz >= 0 ? f : b, sz = 18 * hs * (0.8 + 0.3 * ring.a);
      c.globalAlpha = 0.9; c.drawImage(this.sprites.gold, hx - sz / 2, hy - sz / 2, sz, sz);
      c.globalAlpha = 1; c.fillStyle = `rgb(${br},${bg},${bb})`;
      c.beginPath(); c.arc(hx, hy, 1.5 * hs, 0, TAU); c.fill();
    }
  }

  drawBolts(c, dt) {
    c.globalCompositeOperation = 'lighter';
    c.lineJoin = 'round'; c.lineCap = 'round';
    c.save(); c.translate(this.ccx - this.cx, this.ccy - this.cy);
    this.bolts = this.bolts.filter((b) => {
      b.life += dt;
      if (b.life >= b.ttl) {
        for (let i = 0; i < (b.long ? 5 : 3); i++) if (Math.random() < 0.8) this.emit(Math.random() < 0.5 ? 'streak' : 'ember', b.ang + rand(-0.3, 0.3), 1);
        return false;
      }
      if (!b.rebuilt && b.life > b.ttl * 0.45 && Math.random() < 0.35) { b.rebuilt = true; this.buildBolt(b); } // re-strike for flicker
      const a = (1 - b.life / b.ttl) * rand(0.55, 1);
      for (const p of b.paths) {
        c.beginPath(); p.pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
        c.strokeStyle = `rgba(0,255,140,${0.10 * a})`; c.lineWidth = 9 * p.w; c.stroke();
        c.strokeStyle = `rgba(90,255,175,${0.42 * a})`; c.lineWidth = 3.2 * p.w; c.stroke();
        c.strokeStyle = `rgba(240,255,245,${0.95 * a})`; c.lineWidth = Math.max(0.7, 1.4 * p.w); c.stroke();
      }
      c.globalAlpha = a; c.drawImage(this.sprites.green, b.ex - 14, b.ey - 14, 28, 28); c.globalAlpha = 1;
      return true;
    });
    c.restore();
  }

  // sparks live in 3D: perspective size, depth fade, and a focus blur away from the core's depth; far ones render behind the sphere
  drawParticles(b, f, dt) {
    b.globalCompositeOperation = 'lighter'; f.globalCompositeOperation = 'lighter';
    b.lineCap = f.lineCap = 'round';
    const R = this.R, F = this.F, yaw = this.cam.yaw, pit = this.cam.pitch + E0;
    this.parts = this.parts.filter((p) => {
      p.life += dt;
      if (p.life >= p.ttl) return false;
      const drag = Math.exp(-(p.streak ? 2.2 : 1.1) * dt);
      p.vx *= drag; p.vy *= drag; p.vz *= drag;
      p.vy += (p.streak ? 130 : 28) * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      const f01 = p.life / p.ttl, a0 = Math.pow(1 - f01, 1.3);
      const z = clamp(p.z, -R * 1.5, F * 0.5), sc = F / (F - z);
      const sx = this.ccx + (p.x + z * Math.sin(yaw)) * sc, sy = this.ccy + (p.y - z * Math.sin(pit)) * sc;
      const zn = z / R, blur = clamp(Math.abs(zn - 0.15) / 1.5, 0, 1), c = z >= 0 ? f : b;
      const depthA = clamp(0.62 + zn * 0.3, 0.3, 1.1) * (1 - blur * 0.45), a = a0 * depthA;
      if (p.streak) {
        const tl = 0.075, tx = sx - p.vx * tl * sc, ty = sy - p.vy * tl * sc;
        const g = c.createLinearGradient(sx, sy, tx, ty);
        g.addColorStop(0, `rgba(255,244,200,${a})`); g.addColorStop(0.35, `rgba(255,200,70,${a * 0.7})`); g.addColorStop(1, 'rgba(255,150,20,0)');
        c.strokeStyle = g; c.lineWidth = p.size * (0.6 + a0 * 0.6) * sc * (1 + blur);
        c.beginPath(); c.moveTo(sx, sy); c.lineTo(tx, ty); c.stroke();
        const s = 8 * sc * (1 + blur * 1.6);
        c.globalAlpha = a * 0.7; c.drawImage(this.sprites.gold, sx - s / 2, sy - s / 2, s, s); c.globalAlpha = 1;
      } else {
        const fl = 0.65 + 0.35 * Math.sin(p.seed + p.life * 24), s = p.size * (1 - f01 * 0.5) * sc, gs = s * 6.4 * (1 + blur * 1.8);
        c.globalAlpha = a * fl * 0.85 * (1 - blur * 0.35); c.drawImage(this.sprites.gold, sx - gs / 2, sy - gs / 2, gs, gs);
        c.globalAlpha = a * fl * (1 - blur * 0.7); c.fillStyle = 'rgb(255,226,140)';
        c.beginPath(); c.arc(sx, sy, Math.max(0.3, s * 0.7 * (1 - blur * 0.4)), 0, TAU); c.fill();
        c.globalAlpha = 1;
      }
      return true;
    });
  }
}
