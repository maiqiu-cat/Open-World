'use strict';
// Sky: atmosphere LUT, ambient probe, 3D cloud noise, volumetric clouds, reflection dome, sky pass.
(function () {
  const NOISE_FS = `
uniform float uZ; uniform float uSize;
out vec4 o;
vec3 hashg(vec3 p){
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}
float gradNoise(vec3 x, float freq){
  vec3 p = floor(x), w = fract(x);
  vec3 u = w*w*w*(w*(w*6.0 - 15.0) + 10.0);
  vec3 ga = hashg(mod(p + vec3(0,0,0), freq)), gb = hashg(mod(p + vec3(1,0,0), freq));
  vec3 gc = hashg(mod(p + vec3(0,1,0), freq)), gd = hashg(mod(p + vec3(1,1,0), freq));
  vec3 ge = hashg(mod(p + vec3(0,0,1), freq)), gf = hashg(mod(p + vec3(1,0,1), freq));
  vec3 gg = hashg(mod(p + vec3(0,1,1), freq)), gh = hashg(mod(p + vec3(1,1,1), freq));
  float va = dot(ga, w - vec3(0,0,0)), vb = dot(gb, w - vec3(1,0,0));
  float vc = dot(gc, w - vec3(0,1,0)), vd = dot(gd, w - vec3(1,1,0));
  float ve = dot(ge, w - vec3(0,0,1)), vf = dot(gf, w - vec3(1,0,1));
  float vg = dot(gg, w - vec3(0,1,1)), vh = dot(gh, w - vec3(1,1,1));
  return va + u.x*(vb-va) + u.y*(vc-va) + u.z*(ve-va) + u.x*u.y*(va-vb-vc+vd) + u.y*u.z*(va-vc-ve+vg)
       + u.z*u.x*(va-vb-ve+vf) + u.x*u.y*u.z*(-va+vb+vc-vd+ve-vf-vg+vh);
}
float worley(vec3 uv, float freq){
  vec3 id = floor(uv * freq), p = fract(uv * freq);
  float md = 1e4;
  for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++){
    vec3 off = vec3(float(x), float(y), float(z));
    vec3 h = hashg(mod(id + off, vec3(freq))) * 0.5 + 0.5;
    vec3 d = p - (h + off);
    md = min(md, dot(d, d));
  }
  return 1.0 - md;
}
float worleyFbm(vec3 p, float f){ return worley(p, f) * 0.625 + worley(p, f * 2.0) * 0.25 + worley(p, f * 4.0) * 0.125; }
float perlinFbm(vec3 p, float freq){
  float G = exp2(-0.85), amp = 1.0, n = 0.0;
  for (int i = 0; i < 6; i++){ n += amp * gradNoise(p * freq, freq); freq *= 2.0; amp *= G; }
  return n;
}
void main(){
  vec3 uvw = vec3(gl_FragCoord.xy, uZ + 0.5) / uSize;
  float pf = mix(1.0, perlinFbm(uvw, 4.0), 0.5);
  pf = abs(pf * 2.0 - 1.0);
  float g = worleyFbm(uvw, 4.0), b = worleyFbm(uvw, 8.0), a = worleyFbm(uvw, 16.0);
  float pw = g + (pf - 0.0) * (1.0 - g);
  o = vec4(clamp(pw, 0.0, 1.0), g, b, a);
}`;

  const LUT_FS = `
#define PI 3.14159265359
uniform vec3 uSunDir; uniform float uHaze, uSunI; uniform vec3 uNightSky;
out vec4 o;
const float Rg = 6360e3, Rt = 6420e3;
const vec3 bR = vec3(5.802e-6, 13.558e-6, 33.1e-6);
const vec3 bOz = vec3(0.650e-6, 1.881e-6, 0.085e-6);
vec2 raySphere(vec3 ro, vec3 rd, float r){ float b = dot(ro, rd); float c = dot(ro, ro) - r*r; float d = b*b - c; if (d < 0.0) return vec2(-1.0); d = sqrt(d); return vec2(-b - d, -b + d); }
vec3 dens(float h){ return vec3(exp(-h / 8000.0), exp(-h / 1200.0), max(0.0, 1.0 - abs(h - 25e3) / 15e3)); }
vec3 ext(vec3 d){ float bM = 3.996e-6 * uHaze; return bR * d.x + vec3(bM * 1.11) * d.y + bOz * d.z; }
vec3 trans(vec3 p, vec3 L){
  vec2 g = raySphere(p, L, Rg);
  if (g.x > 0.0) return vec3(0.0);
  float len = raySphere(p, L, Rt).y;
  float dt = len / 10.0; vec3 od = vec3(0.0);
  for (int i = 0; i < 10; i++){ vec3 q = p + L * (float(i) + 0.5) * dt; od += ext(dens(length(q) - Rg)) * dt; }
  return exp(-od);
}
void main(){
  vec2 uv = gl_FragCoord.xy / vec2(256.0, 128.0);
  float az = (uv.x - 0.5) * 2.0 * PI;
  float v = uv.y * 2.0 - 1.0;
  float el = sign(v) * v * v * 0.5 * PI;
  vec3 rd = vec3(cos(el) * cos(az), sin(el), cos(el) * sin(az));
  vec3 ro = vec3(0.0, Rg + 2.0, 0.0);
  float tmax = raySphere(ro, rd, Rt).y;
  vec2 tg = raySphere(ro, rd, Rg);
  if (tg.x > 0.0) tmax = tg.x;
  const int STEPS = 36;
  float dt = tmax / float(STEPS);
  vec3 sR = vec3(0.0), sM = vec3(0.0), od = vec3(0.0);
  for (int i = 0; i < STEPS; i++){
    vec3 q = ro + rd * (float(i) + 0.5) * dt;
    vec3 d = dens(length(q) - Rg);
    od += ext(d) * dt;
    vec3 Tl = trans(q, uSunDir);
    vec3 Tv = exp(-od);
    sR += d.x * Tv * Tl * dt;
    sM += d.y * Tv * Tl * dt;
  }
  float mu = dot(rd, uSunDir);
  float pR = 3.0 / (16.0 * PI) * (1.0 + mu*mu);
  float g = 0.78;
  float pM = 3.0 / (8.0 * PI) * ((1.0 - g*g) * (1.0 + mu*mu)) / ((2.0 + g*g) * pow(1.0 + g*g - 2.0*g*mu, 1.5));
  float bM = 3.996e-6 * uHaze;
  vec3 mie = sM * bM * pM;
  mie = mix(mie, vec3(dot(mie, vec3(0.2126, 0.7152, 0.0722))), 0.45);
  vec3 L = uSunI * (sR * bR * pR + mie);
  // cheap multiple-scattering lift + night airglow
  L += uSunI * bR * 2.5e3 * max(uSunDir.y + 0.1, 0.0) * 0.004;
  L += uNightSky * (1.0 + 2.0 * pow(1.0 - abs(rd.y), 4.0));
  o = vec4(L, 1.0);
}`;

  const AMB_FS = OW.GLSL.COMMON + `
out vec4 o;
void main(){
  int x = int(gl_FragCoord.x);
  vec3 acc = vec3(0.0); float ws = 0.0;
  if (x == 0){
    for (int i = 0; i < 12; i++) for (int j = 0; j < 5; j++){
      float az = float(i) / 12.0 * 2.0 * PI, el = (float(j) + 0.5) / 5.0 * 0.5 * PI;
      vec3 d = vec3(cos(el) * cos(az), sin(el), cos(el) * sin(az));
      float w = sin(el) * cos(el);
      acc += skyL(d) * w; ws += w;
    }
  } else {
    for (int i = 0; i < 16; i++){
      float az = float(i) / 16.0 * 2.0 * PI;
      acc += skyL(normalize(vec3(cos(az), 0.05, sin(az)))); ws += 1.0;
    }
  }
  vec3 clear = acc / ws;
  float cov = smoothstep(0.2, 0.92, uCloudCover);
  // Overcast: the cloud deck re-radiates a fraction of the clear-sky global illuminance.
  vec3 zen = skyL(vec3(0.0, 1.0, 0.0));
  float E = luma(uSunColor) * max(uSunDir.y, 0.0) + luma(zen) * PI * 1.4 + 0.004;
  float ovc = E / PI * mix(0.42, 0.1, uStorm);
  vec3 grey = vec3(ovc) * vec3(0.9, 0.96, 1.05) * (x == 0 ? 1.0 : 0.85);
  vec3 c = mix(clear, grey, cov);
  c += vec3(0.55, 0.6, 0.8) * uFlash * 0.12;
  o = vec4(c, 1.0);
}`;

  const CLOUD_LIB = `
vec2 raySph(vec3 ro, vec3 rd, float r){ float b = dot(ro, rd); float c = dot(ro, ro) - r*r; float d = b*b - c; if (d < 0.0) return vec2(-1.0); d = sqrt(d); return vec2(-b - d, -b + d); }
vec4 marchClouds(vec3 ro, vec3 rd, int STEPS, int LSTEPS, float jit, float pix){
  vec3 C = vec3(0.0, -Rg, 0.0);
  vec3 o = ro - C;
  float rb = Rg + uCloudBottom, rt = Rg + uCloudTop;
  vec2 ib = raySph(o, rd, rb), it = raySph(o, rd, rt);
  float r0 = length(o);
  float t0, t1;
  if (r0 < rb){ t0 = ib.y; t1 = it.y; }
  else if (r0 < rt){ t0 = 0.0; t1 = ib.x > 0.0 ? ib.x : it.y; }
  else { if (it.x < 0.0) return vec4(0.0, 0.0, 0.0, 1.0); t0 = it.x; t1 = ib.x > 0.0 ? ib.x : it.y; }
  t1 = min(t1, t0 + 55000.0);
  if (t1 <= t0 || t0 > 120000.0) return vec4(0.0, 0.0, 0.0, 1.0);
  float dt = (t1 - t0) / float(STEPS);
  float t = t0 + dt * jit;
  vec3 L = uKeyDir;
  float mu = dot(rd, L);
  float phase = mix(hg(mu, 0.7), hg(mu, -0.2), 0.3) + hg(mu, 0.93) * 0.12 + 0.03;
  vec3 amb = ambSky();
  vec3 col = vec3(0.0);
  float T = 1.0, tw = 0.0, wsum = 0.0;
  float thick = uCloudTop - uCloudBottom;
  for (int i = 0; i < 160; i++){
    if (i >= STEPS) break;
    vec3 p = ro + rd * t;
    float hf = (length(p - C) - rb) / thick;
    float fp = max(t * pix, dt * 0.25);
    float d = cloudDensity(p, hf, false, fp);
    if (d > 0.002){
      d = cloudDensity(p, hf, true, fp);
      if (d > 0.002){
        float sig = d * 0.03;
        float lod = 0.0, ls = thick * 0.045;
        vec3 lp = p;
        for (int j = 0; j < 8; j++){
          if (j >= LSTEPS) break;
          lp += L * ls;
          float lh = (length(lp - C) - rb) / thick;
          lod += cloudDensity(lp, lh, j < 2, max(fp, ls * 0.5)) * ls;
          ls *= 1.7;
        }
        float od = lod * 0.03;
        float beer = max(exp(-od), max(exp(-od * 0.25) * 0.5, exp(-od * 0.08) * 0.22));
        float powder = 1.0 - exp(-sig * 90.0);
        vec3 Sl = uKeyColor * phase * beer * mix(0.55, 1.0, powder);
        vec3 Sa = amb * mix(0.6, 1.25, smoothstep(0.0, 1.0, hf)) * (0.8 + 0.2 * powder);
        Sa += vec3(0.7, 0.75, 1.0) * uFlash * 1.2 * smoothstep(0.3, 0.7, hash13(floor(p * 0.0004)));
        vec3 S = (Sl + Sa) * sig;
        float Ts = exp(-sig * dt);
        col += T * (S - S * Ts) / sig;
        float a = T * (1.0 - Ts);
        tw += a * t; wsum += a;
        T *= Ts;
        if (T < 0.01) break;
      }
    }
    t += dt;
  }
  T = clamp((T - 0.012) / 0.988, 0.0, 1.0);
  if (wsum > 0.0){
    float dist = tw / wsum;
    float fade = exp(-dist * uFogDensity * 0.55);
    col = col * fade + (1.0 - T) * fogColor(rd) * (1.0 - fade);
  }
  return vec4(col, T);
}
vec3 stars(vec3 d){
  vec3 p = d * 380.0;
  vec3 id = floor(p);
  float h = hash13(id);
  if (h < 0.992) return vec3(0.0);
  vec3 c = hash33(id + 7.0) * 0.6 + 0.2;
  float s = smoothstep(0.14, 0.0, length(fract(p) - c)) * (h - 0.992) / 0.008;
  float tw = 0.65 + 0.35 * sin(uTime * 2.5 + h * 300.0);
  return mix(vec3(0.75, 0.82, 1.0), vec3(1.0, 0.88, 0.72), hash13(id + 3.0)) * s * s * tw * 0.35;
}
vec3 moon(vec3 d){
  float dm = acos(clamp(dot(d, uMoonDir), -1.0, 1.0));
  float r = 0.0075;
  float disk = smoothstep(r, r * 0.9, dm);
  vec3 tang = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
  vec2 mp = vec2(dot(d - uMoonDir, tang), dot(d - uMoonDir, cross(tang, uMoonDir))) / r;
  float mare = 0.75 + 0.25 * vnoise(mp * 3.0 + 4.0) - 0.15 * smoothstep(0.5, 0.7, vnoise(mp * 1.6 + 1.0));
  return vec3(0.85, 0.88, 0.95) * disk * mare * 3.0 * uNight + vec3(0.15, 0.2, 0.3) * exp(-dm * 40.0) * 0.05 * uNight;
}`;

  const DOME_FS = OW.GLSL.COMMON + CLOUD_LIB + `
uniform float uSize; uniform int uSteps;
out vec4 o;
void main(){
  vec2 uv = gl_FragCoord.xy / uSize * 2.0 - 1.0;
  vec2 pxz = vec2(uv.x + uv.y, uv.x - uv.y) * 0.5;
  float y = 1.0 - abs(pxz.x) - abs(pxz.y);
  vec3 d = normalize(vec3(pxz.x, max(y, 0.0) + 0.0005, pxz.y));
  vec3 col = skyL(d);
  col += stars(d) * uNight + moon(d);
  vec3 ro = vec3(uCamPos.x, max(uCamPos.y, 2.0), uCamPos.z);
  float jit = hash12(gl_FragCoord.xy);
  vec4 c = marchClouds(ro, d, uSteps, 3, jit, 3.3 / uSize);
  col = col * c.a + c.rgb;
  o = vec4(col, 1.0);
}`;

  const CLOUDS_FS = OW.GLSL.COMMON + CLOUD_LIB + `
in vec2 vUV;
uniform int uSteps, uLSteps; uniform float uCloudPix, uFrame;
out vec4 o;
void main(){
  vec3 d = viewRay(vUV);
  if (d.y < -0.04){ o = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))) + uFrame * 0.61803398);
  d.y = max(d.y, -0.02);
  o = marchClouds(uCamPos, normalize(d), uSteps, uLSteps, jit, uCloudPix);
}`;

  const TAA_FS = OW.GLSL.COMMON + `
in vec2 vUV;
uniform sampler2D uCur, uHist;
uniform vec3 uPrevFwd, uPrevRight, uPrevUp; uniform vec2 uPrevTan, uTexel; uniform float uBlend;
out vec4 o;
void main(){
  vec4 c = texture(uCur, vUV);
  vec4 mn = c, mx = c;
  for (int i = 0; i < 4; i++){
    vec2 off = i == 0 ? vec2(uTexel.x, 0.0) : i == 1 ? vec2(-uTexel.x, 0.0) : i == 2 ? vec2(0.0, uTexel.y) : vec2(0.0, -uTexel.y);
    vec4 s = texture(uCur, vUV + off);
    mn = min(mn, s); mx = max(mx, s);
  }
  vec3 d = viewRay(vUV);
  float z = dot(d, uPrevFwd);
  vec2 puv = vec2(dot(d, uPrevRight) / (z * uPrevTan.x), dot(d, uPrevUp) / (z * uPrevTan.y)) * 0.5 + 0.5;
  float valid = (z > 0.0 && puv.x > 0.0 && puv.y > 0.0 && puv.x < 1.0 && puv.y < 1.0) ? 1.0 : 0.0;
  vec4 h = texture(uHist, puv);
  vec4 ext = (mx - mn) * 0.35 + 0.002;
  h = clamp(h, mn - ext, mx + ext);
  o = mix(c, h, uBlend * valid);
}`;

  const SKY_FS = OW.GLSL.COMMON + CLOUD_LIB + `
in vec2 vUV;
uniform sampler2D uClouds;
out vec4 o;
void main(){
  vec3 d = viewRay(vUV);
  vec3 col;
  if (uUnder > 0.5){
    float camDepth = max(-uCamPos.y, 0.0);
    col = uwFogColor(camDepth + 40.0 * max(-d.y, 0.0) + 2.0);
  } else if (d.y < -0.002){
    col = fogColor(d);
  } else {
    col = skyL(d);
    float cs = dot(d, uSunDir);
    float ds = acos(clamp(cs, -1.0, 1.0));
    float sr = 0.0052;
    float disk = smoothstep(sr, sr * 0.8, ds);
    float rr = clamp(ds / sr, 0.0, 1.0);
    float limb = 1.0 - 0.55 * (1.0 - sqrt(max(1.0 - rr*rr, 0.0)));
    col += uSunColor * disk * limb * 260.0;
    col += stars(d) * uNight * smoothstep(0.0, 0.1, d.y) + moon(d);
    vec4 c = texture(uClouds, vUV);
    col = col * c.a + c.rgb;
    col = mix(col, fogColor(d), smoothstep(0.05, -0.002, d.y) * 0.4);
  }
  o = vec4(col, 60.0);
}`;

  class Sky {
    constructor(gl) {
      this.gl = gl;
      this.pNoise = new OW.Program(gl, OW.GLSL.FSQ_VS, NOISE_FS, 'noise');
      this.pLUT = new OW.Program(gl, OW.GLSL.FSQ_VS, LUT_FS, 'skylut');
      this.pAmb = new OW.Program(gl, OW.GLSL.FSQ_VS, AMB_FS, 'ambient');
      this.pDome = new OW.Program(gl, OW.GLSL.FSQ_VS, DOME_FS, 'dome');
      this.pClouds = new OW.Program(gl, OW.GLSL.FSQ_VS, CLOUDS_FS, 'clouds');
      this.pSky = new OW.Program(gl, OW.GLSL.FSQ_VS, SKY_FS, 'sky');
      this.pTAA = new OW.Program(gl, OW.GLSL.FSQ_VS, TAA_FS, 'cloud-taa');
      this.frame = 0; this.histIdx = 0; this.prev = null;
      const h16 = { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT };
      this.lut = OW.tex2D(gl, { ...h16, w: 256, h: 128, wrap: 'repeat' });
      gl.bindTexture(gl.TEXTURE_2D, this.lut);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.lutFbo = OW.fbo(gl, [this.lut]);
      this.amb = OW.tex2D(gl, { ...h16, w: 2, h: 1, filter: 'nearest' });
      this.ambFbo = OW.fbo(gl, [this.amb]);
      this.domeSize = 0;
      this.cloudW = 0; this.cloudH = 0;
    }

    genNoise() {
      const gl = this.gl, S = 128;
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_3D, t);
      gl.texStorage3D(gl.TEXTURE_3D, Math.log2(S) + 1, gl.RGBA8, S, S, S);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      for (const w of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, w, gl.REPEAT);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.viewport(0, 0, S, S);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
      this.pNoise.use().set('uSize', S);
      for (let z = 0; z < S; z++) {
        gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, t, 0, z);
        this.pNoise.set('uZ', z);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(fb);
      gl.bindTexture(gl.TEXTURE_3D, t);
      gl.generateMipmap(gl.TEXTURE_3D);
      this.noise = t;
    }

    resize(domeSize, cw, ch) {
      const gl = this.gl;
      const h16 = { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT };
      if (domeSize !== this.domeSize) {
        this.domeSize = domeSize;
        if (this.dome) gl.deleteTexture(this.dome);
        this.dome = OW.tex2D(gl, { ...h16, w: domeSize, h: domeSize });
        this.domeFbo = OW.fbo(gl, [this.dome]);
      }
      if (cw !== this.cloudW || ch !== this.cloudH) {
        this.cloudW = cw; this.cloudH = ch;
        if (this.cloudsRaw) [this.cloudsRaw, ...this.hist].forEach((t) => gl.deleteTexture(t));
        this.cloudsRaw = OW.tex2D(gl, { ...h16, w: cw, h: ch });
        this.cloudFbo = OW.fbo(gl, [this.cloudsRaw]);
        this.hist = [0, 1].map(() => OW.tex2D(gl, { ...h16, w: cw, h: ch }));
        this.histFbo = this.hist.map((t) => OW.fbo(gl, [t]));
        this.prev = null;
      }
    }

    updateLUT(sunDir, haze, nightSky) {
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.lutFbo);
      gl.viewport(0, 0, 256, 128);
      this.pLUT.use().set('uSunDir', sunDir).set('uHaze', haze).set('uSunI', 20).set('uNightSky', nightSky);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    updateAmbient(common) {
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.ambFbo);
      gl.viewport(0, 0, 2, 1);
      common(this.pAmb.use(), { noAmb: true });
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    renderDome(common, steps) {
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.domeFbo);
      gl.viewport(0, 0, this.domeSize, this.domeSize);
      common(this.pDome.use());
      this.pDome.set('uSize', this.domeSize).set('uSteps', steps);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // cam = {fwd, right, up, tan:[x,y], pos}
    renderClouds(common, steps, lsteps, cam) {
      const gl = this.gl;
      this.frame = (this.frame + 1) % 4096;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.cloudFbo);
      gl.viewport(0, 0, this.cloudW, this.cloudH);
      common(this.pClouds.use());
      this.pClouds.set('uSteps', steps).set('uLSteps', lsteps).set('uCloudPix', 2 * this.tanHalf / this.cloudH).set('uFrame', this.frame);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      // temporal accumulation
      const prev = this.prev || cam;
      const cut = !this.prev || OW.v3.dot(prev.fwd, cam.fwd) < 0.9 || OW.v3.len(OW.v3.sub(prev.pos, cam.pos)) > 60;
      const src = this.histIdx, dst = 1 - this.histIdx;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.histFbo[dst]);
      common(this.pTAA.use());
      this.pTAA.tex('uCur', this.cloudsRaw).tex('uHist', this.hist[src])
        .setAll({ uPrevFwd: prev.fwd, uPrevRight: prev.right, uPrevUp: prev.up, uPrevTan: prev.tan, uTexel: [1 / this.cloudW, 1 / this.cloudH], uBlend: cut ? 0 : 0.88 });
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.histIdx = dst;
      this.clouds = this.hist[dst];
      this.prev = { fwd: cam.fwd.slice(), right: cam.right.slice(), up: cam.up.slice(), tan: cam.tan.slice(), pos: cam.pos.slice() };
    }

    drawSky(common) {
      const gl = this.gl;
      common(this.pSky.use());
      this.pSky.tex('uClouds', this.clouds);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  }

  // CPU-side transmittance for the sun colour (matches LUT_FS).
  Sky.sunTransmittance = function (elevDeg, haze) {
    const Rg = 6360e3, Rt = 6420e3;
    const e = Math.max(elevDeg, 0.15) * OW.deg;
    const ro = [0, Rg + 2, 0], rd = [Math.cos(e), Math.sin(e), 0];
    const b = OW.v3.dot(ro, rd), c = OW.v3.dot(ro, ro) - Rt * Rt;
    const len = -b + Math.sqrt(b * b - c);
    const n = 64, dt = len / n;
    const bR = [5.802e-6, 13.558e-6, 33.1e-6], bOz = [0.65e-6, 1.881e-6, 0.085e-6];
    const bM = 3.996e-6 * haze * 1.11;
    const od = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) * dt;
      const q = [ro[0] + rd[0] * t, ro[1] + rd[1] * t, 0];
      const h = Math.hypot(q[0], q[1]) - Rg;
      const dr = Math.exp(-h / 8000), dm = Math.exp(-h / 1200), dz = Math.max(0, 1 - Math.abs(h - 25e3) / 15e3);
      for (let k = 0; k < 3; k++) od[k] += (bR[k] * dr + bM * dm + bOz[k] * dz) * dt;
    }
    const fade = OW.smooth(-1.4, 0.3, elevDeg);
    return od.map((x) => Math.exp(-x) * fade);
  };

  OW.Sky = Sky;
})();
