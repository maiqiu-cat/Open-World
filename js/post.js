'use strict';
// Post: MSAA HDR scene target, underwater light shafts, bloom chain, final composite.
(function () {
  const PRE_FS = OW.GLSL.COMMON + `
in vec2 vUV; uniform sampler2D uSrc; uniform vec2 uTexel; uniform float uThresh, uExposure;
out vec4 o;
void main(){
  vec3 a = texture(uSrc, vUV + uTexel * vec2(-1.0, -1.0)).rgb;
  vec3 b = texture(uSrc, vUV + uTexel * vec2( 1.0, -1.0)).rgb;
  vec3 c = texture(uSrc, vUV + uTexel * vec2(-1.0,  1.0)).rgb;
  vec3 d = texture(uSrc, vUV + uTexel * vec2( 1.0,  1.0)).rgb;
  float wa = 1.0 / (1.0 + luma(a) * uExposure), wb = 1.0 / (1.0 + luma(b) * uExposure);
  float wc = 1.0 / (1.0 + luma(c) * uExposure), wd = 1.0 / (1.0 + luma(d) * uExposure);
  vec3 col = (a * wa + b * wb + c * wc + d * wd) / (wa + wb + wc + wd) * uExposure;
  col = min(col, vec3(200.0));
  float br = max(col.r, max(col.g, col.b));
  float knee = 0.6;
  float soft = clamp(br - uThresh + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee + 1e-4);
  float contrib = max(soft, br - uThresh) / max(br, 1e-4);
  o = vec4(col * contrib, 1.0);
}`;

  const DOWN_FS = `
in vec2 vUV; uniform sampler2D uSrc; uniform vec2 uTexel;
out vec4 o;
vec3 s(float x, float y){ return texture(uSrc, vUV + vec2(x, y) * uTexel).rgb; }
void main(){
  vec3 a = s(-2.,-2.), b = s(0.,-2.), c = s(2.,-2.), d = s(-1.,-1.), e = s(1.,-1.);
  vec3 f = s(-2.,0.), g = s(0.,0.), h = s(2.,0.), i = s(-1.,1.), j = s(1.,1.);
  vec3 k = s(-2.,2.), l = s(0.,2.), m = s(2.,2.);
  vec3 col = (d + e + i + j) * 0.125 + (a + b + f + g) * 0.03125 + (b + c + g + h) * 0.03125
           + (f + g + k + l) * 0.03125 + (g + h + l + m) * 0.03125;
  o = vec4(col, 1.0);
}`;

  const UP_FS = `
in vec2 vUV; uniform sampler2D uSrc; uniform vec2 uTexel; uniform float uWeight;
out vec4 o;
vec3 s(float x, float y){ return texture(uSrc, vUV + vec2(x, y) * uTexel).rgb; }
void main(){
  vec3 col = s(-1.,-1.) + 2.0*s(0.,-1.) + s(1.,-1.) + 2.0*s(-1.,0.) + 4.0*s(0.,0.) + 2.0*s(1.,0.)
           + s(-1.,1.) + 2.0*s(0.,1.) + s(1.,1.);
  o = vec4(col / 16.0 * uWeight, 1.0);
}`;

  const RAYS_FS = OW.GLSL.COMMON + `
in vec2 vUV; uniform sampler2D uHDR;
out vec4 o;
void main(){
  vec3 d = viewRay(vUV);
  float sceneD = texture(uHDR, vUV).a * 1000.0;
  float maxD = min(sceneD, 60.0);
  vec3 down = refract(-uKeyDir, vec3(0.0, 1.0, 0.0), 1.0 / 1.333);
  if (dot(down, down) < 1e-4 || uKeyDir.y < 0.0) down = vec3(0.0, -1.0, 0.0);
  vec3 Ld = -down;
  float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  const int N = 22;
  float dt = maxD / float(N);
  vec3 acc = vec3(0.0);
  for (int i = 0; i < N; i++){
    float t = (float(i) + jit) * dt;
    vec3 p = uCamPos + d * t;
    float depth = max(-p.y, 0.0);
    vec2 s = p.xz + Ld.xz / max(Ld.y, 0.2) * depth;
    float n = fbm2(s * 0.16 + vec2(uTime * 0.06, uTime * 0.035));
    float shaft = smoothstep(0.48, 0.78, n) * (0.4 + 0.6 * caustics(s * 0.4, uTime * 0.4));
    acc += shaft * exp(-uWaterSigma * (depth / max(Ld.y, 0.2) + t)) * dt;
  }
  float mu = dot(d, Ld);
  vec3 rays = acc * luma(uKeyColor) * uWaterUW * (0.15 + 2.5 * hg(mu, 0.7)) * 0.03;
  o = vec4(rays, 1.0);
}`;

  const FINAL_FS = OW.GLSL.COMMON + `
in vec2 vUV;
uniform sampler2D uHDR, uBloom, uRays;
uniform float uExposure, uGlow, uFade, uAspect, uHasRays;
out vec4 o;
vec3 agxContrast(vec3 x){
  vec3 x2 = x * x, x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
vec3 agx(vec3 v){
  const mat3 M = mat3(0.842479062253094, 0.0423282422610123, 0.0423756549057051,
                      0.0784335999999992, 0.878468636469772, 0.0784336,
                      0.0792237451477643, 0.0791661274605434, 0.879142973793104);
  const mat3 Mi = mat3(1.19687900512017, -0.0528968517574562, -0.0529716355144438,
                       -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
                       -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
  const float mn = -12.47393, mx = 4.026069;
  v = M * max(v, vec3(1e-10));
  v = clamp(log2(v), mn, mx);
  v = (v - mn) / (mx - mn);
  v = agxContrast(v);
  // gentle 'punchy' look: a touch more contrast and saturation
  float l = dot(v, vec3(0.2126, 0.7152, 0.0722));
  v = mix(vec3(l), v, 1.12);
  v = pow(max(v, vec3(0.0)), vec3(1.06));
  return clamp(Mi * v, 0.0, 1.0);
}
vec3 lensDrops(vec2 uv, float t){
  vec3 res = vec3(0.0);
  for (int l = 0; l < 2; l++){
    float sc = l == 0 ? 6.0 : 11.0;
    vec2 q = uv * vec2(uAspect, 1.0) * sc + float(l) * 13.1;
    vec2 id = floor(q);
    vec2 f = fract(q) - 0.5;
    vec2 h = hash22(id + float(l) * 7.0);
    if (hash12(id + 3.3 + float(l)) > 0.16 * uRain) continue;
    float life = fract(t * (0.05 + 0.08 * h.x) + h.y);
    vec2 c = (h - 0.5) * 0.55;
    c.y += life * life * 0.35 * step(0.75, h.x);
    float r = 0.1 + 0.16 * h.y;
    vec2 dv = f - c;
    dv.y *= 1.0 + 0.4 * step(0.75, h.x);
    float dd = length(dv);
    float m = smoothstep(r, r * 0.6, dd) * smoothstep(1.0, 0.75, life) * smoothstep(0.0, 0.08, life);
    res.xy += dv / max(r, 1e-3) * m * 0.035 / sc * 5.0;
    res.z = max(res.z, m);
  }
  return res;
}
void main(){
  vec2 uv = vUV;
  vec3 ld = vec3(0.0);
  if (uRain > 0.01 && uUnder < 0.5) { ld = lensDrops(vUV, uTime) * uRain; uv += ld.xy; }
  if (uUnder > 0.5) uv += vec2(sin(vUV.y * 23.0 + uTime * 1.3), cos(vUV.x * 19.0 + uTime * 1.1)) * 0.0012;
  vec3 col = texture(uHDR, uv).rgb * uExposure;
  if (uHasRays > 0.5) col += texture(uRays, uv).rgb * uExposure;
  vec3 bl = texture(uBloom, uv).rgb;
  col += bl * uGlow * 1.8;
  vec3 refr = texture(uHDR, vUV - ld.xy * 6.0).rgb * uExposure;
  col = mix(col, refr * 1.1 + bl * 0.9 + 0.015, ld.z * 0.55);
  col = agx(col);
  float v = length((vUV - 0.5) * vec2(uAspect, 1.0) / sqrt(uAspect * uAspect + 1.0) * 2.0);
  col *= 1.0 - 0.3 * pow(v, 2.6);
  col += (hash12(gl_FragCoord.xy + fract(uTime * 7.13) * 571.0) - 0.5) * 0.018;
  col *= uFade;
  o = vec4(col, 1.0);
}`;

  class Post {
    constructor(gl) {
      this.gl = gl;
      this.pPre = new OW.Program(gl, OW.GLSL.FSQ_VS, PRE_FS, 'bloom-pre');
      this.pDown = new OW.Program(gl, OW.GLSL.FSQ_VS, DOWN_FS, 'bloom-down');
      this.pUp = new OW.Program(gl, OW.GLSL.FSQ_VS, UP_FS, 'bloom-up');
      this.pRays = new OW.Program(gl, OW.GLSL.FSQ_VS, RAYS_FS, 'rays');
      this.pFinal = new OW.Program(gl, OW.GLSL.FSQ_VS, FINAL_FS, 'final');
      this.w = 0; this.h = 0; this.samples = -1;
      this.maxSamples = gl.getParameter(gl.MAX_SAMPLES);
    }

    resize(w, h, samples) {
      samples = Math.min(samples, this.maxSamples);
      if (w === this.w && h === this.h && samples === this.samples) return;
      const gl = this.gl;
      this.w = w; this.h = h; this.samples = samples;
      const h16 = { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT };
      // cleanup
      (this.textures || []).forEach((t) => gl.deleteTexture(t));
      (this.rbs || []).forEach((r) => gl.deleteRenderbuffer(r));
      this.textures = []; this.rbs = [];
      const T = (o) => { const t = OW.tex2D(gl, { ...h16, ...o }); this.textures.push(t); return t; };
      const RB = (fmt, s) => {
        const rb = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
        if (s > 0) gl.renderbufferStorageMultisample(gl.RENDERBUFFER, s, fmt, w, h);
        else gl.renderbufferStorage(gl.RENDERBUFFER, fmt, w, h);
        this.rbs.push(rb);
        return rb;
      };
      this.hdr = T({ w, h });
      if (samples > 0) {
        this.msColor = RB(gl.RGBA16F, samples);
        this.depth = RB(gl.DEPTH_COMPONENT24, samples);
        this.sceneFbo = OW.fbo(gl, [{ rb: this.msColor }], this.depth);
        this.hdrFbo = OW.fbo(gl, [this.hdr]);
      } else {
        this.depth = RB(gl.DEPTH_COMPONENT24, 0);
        this.sceneFbo = OW.fbo(gl, [this.hdr], this.depth);
        this.hdrFbo = this.sceneFbo;
      }
      const hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1);
      this.rays = T({ w: hw, h: hh });
      this.raysFbo = OW.fbo(gl, [this.rays]);
      this.bloom = [];
      let bw = hw, bh = hh;
      for (let i = 0; i < 7 && bw > 4 && bh > 4; i++) {
        const t = T({ w: bw, h: bh });
        this.bloom.push({ t, fbo: OW.fbo(gl, [t]), w: bw, h: bh });
        bw = Math.max(1, bw >> 1); bh = Math.max(1, bh >> 1);
      }
    }

    begin() {
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo);
      gl.viewport(0, 0, this.w, this.h);
      gl.clearColor(0, 0, 0, 60);
      gl.clearDepth(1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    }

    resolve() {
      const gl = this.gl;
      if (this.samples > 0) {
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.sceneFbo);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.hdrFbo);
        gl.blitFramebuffer(0, 0, this.w, this.h, 0, 0, this.w, this.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      }
    }

    renderRays(common) {
      const gl = this.gl;
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.raysFbo);
      gl.viewport(0, 0, this.rays.w, this.rays.h);
      common(this.pRays.use());
      this.pRays.tex('uHDR', this.hdr);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    renderBloom(exposure) {
      const gl = this.gl, L = this.bloom;
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
      gl.bindFramebuffer(gl.FRAMEBUFFER, L[0].fbo);
      gl.viewport(0, 0, L[0].w, L[0].h);
      this.pPre.use().tex('uSrc', this.hdr).set('uTexel', [0.5 / this.w, 0.5 / this.h]).set('uThresh', 1.1).set('uExposure', exposure);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      this.pDown.use();
      for (let i = 1; i < L.length; i++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, L[i].fbo);
        gl.viewport(0, 0, L[i].w, L[i].h);
        this.pDown.tex('uSrc', L[i - 1].t).set('uTexel', [1 / L[i - 1].w, 1 / L[i - 1].h]);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      this.pUp.use();
      for (let i = L.length - 2; i >= 0; i--) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, L[i].fbo);
        gl.viewport(0, 0, L[i].w, L[i].h);
        this.pUp.tex('uSrc', L[i + 1].t).set('uTexel', [1 / L[i + 1].w, 1 / L[i + 1].h]).set('uWeight', 0.9);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.disable(gl.BLEND);
    }

    composite(common, cw, ch, o) {
      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, cw, ch);
      common(this.pFinal.use());
      this.pFinal.tex('uHDR', this.hdr).tex('uBloom', this.bloom[0].t).tex('uRays', this.rays)
        .setAll({ uExposure: o.exposure, uGlow: o.glow, uFade: o.fade, uAspect: cw / ch, uHasRays: o.rays ? 1 : 0 });
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
  }
  OW.Post = Post;
})();
