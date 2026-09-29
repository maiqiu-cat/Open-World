'use strict';
// Scene objects: sailboat, gulls, fish school, island, sea floor, rain, marine snow.
(function () {
  // ---------------------------------------------------------------- builder
  class Builder {
    constructor() { this.p = []; this.n = []; this.c = []; this.x = []; this.uv = []; }
    vert(p, n, c, x, uv) { this.p.push(p[0], p[1], p[2]); this.n.push(n[0], n[1], n[2]); this.c.push(c[0], c[1], c[2], c[3]); this.x.push(x || 0); this.uv.push(uv ? uv[0] : 0, uv ? uv[1] : 0); }
    // Thin square tube from a to b (rigging, rails).
    segment(a, b, r, col) {
      const d = OW.v3.norm(OW.v3.sub(b, a));
      const up = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
      const s1 = OW.v3.scale(OW.v3.norm(OW.v3.cross(d, up)), r), s2 = OW.v3.scale(OW.v3.norm(OW.v3.cross(d, s1)), r);
      const c = (p, i, j) => OW.v3.add(p, OW.v3.add(OW.v3.scale(s1, i), OW.v3.scale(s2, j)));
      const ring = [[1, 1], [-1, 1], [-1, -1], [1, -1]];
      for (let k = 0; k < 4; k++) {
        const [i0, j0] = ring[k], [i1, j1] = ring[(k + 1) % 4];
        this.quad(c(a, i0, j0), c(a, i1, j1), c(b, i1, j1), c(b, i0, j0), col);
      }
    }
    tri(a, b, c, col, x) {
      const n = OW.v3.norm(OW.v3.cross(OW.v3.sub(b, a), OW.v3.sub(c, a)));
      this.vert(a, n, col, x); this.vert(b, n, col, x); this.vert(c, n, col, x);
    }
    quad(a, b, c, d, col, x) { this.tri(a, b, c, col, x); this.tri(a, c, d, col, x); }
    // Parametric surface with smooth normals. fn(u,v)->[x,y,z]; col(u,v,p)->[r,g,b,m]
    grid(nu, nv, fn, col, xfn) {
      const P = [], N = [];
      const e = 1e-3;
      for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
        const u = i / nu, v = j / nv;
        const p = fn(u, v);
        const du = OW.v3.sub(fn(Math.min(u + e, 1), v), fn(Math.max(u - e, 0), v));
        const dv = OW.v3.sub(fn(u, Math.min(v + e, 1)), fn(u, Math.max(v - e, 0)));
        let n = OW.v3.cross(du, dv);
        n = OW.v3.len(n) < 1e-12 ? [0, 1, 0] : OW.v3.norm(n);
        P.push(p); N.push(n);
      }
      const idx = (i, j) => j * (nu + 1) + i;
      for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
        const q = [idx(i, j), idx(i + 1, j), idx(i + 1, j + 1), idx(i, j + 1)];
        for (const k of [q[0], q[1], q[2], q[0], q[2], q[3]]) {
          const u = (k % (nu + 1)) / nu, v = Math.floor(k / (nu + 1)) / nv;
          this.vert(P[k], N[k], col(u, v, P[k]), xfn ? xfn(u, v) : 0, [u, v]);
        }
      }
    }
    box(c, s, col, x) {
      const [cx, cy, cz] = c, [sx, sy, sz] = [s[0] / 2, s[1] / 2, s[2] / 2];
      const v = (a, b, d) => [cx + a * sx, cy + b * sy, cz + d * sz];
      this.quad(v(-1, -1, 1), v(1, -1, 1), v(1, 1, 1), v(-1, 1, 1), col, x);
      this.quad(v(1, -1, -1), v(-1, -1, -1), v(-1, 1, -1), v(1, 1, -1), col, x);
      this.quad(v(-1, -1, -1), v(-1, -1, 1), v(-1, 1, 1), v(-1, 1, -1), col, x);
      this.quad(v(1, -1, 1), v(1, -1, -1), v(1, 1, -1), v(1, 1, 1), col, x);
      this.quad(v(-1, 1, 1), v(1, 1, 1), v(1, 1, -1), v(-1, 1, -1), col, x);
      this.quad(v(-1, -1, -1), v(1, -1, -1), v(1, -1, 1), v(-1, -1, 1), col, x);
    }
    build(gl, extraInstanced) {
      const a = [
        { loc: 0, size: 3, data: new Float32Array(this.p) },
        { loc: 1, size: 3, data: new Float32Array(this.n) },
        { loc: 2, size: 4, data: new Float32Array(this.c) },
        { loc: 3, size: 1, data: new Float32Array(this.x) },
        { loc: 6, size: 2, data: new Float32Array(this.uv) },
      ];
      if (extraInstanced) a.push(...extraInstanced);
      return OW.mesh(gl, a);
    }
  }

  // ---------------------------------------------------------------- shaders
  const LIT_FS = OW.GLSL.COMMON + `
in vec3 vP; in vec3 vN; in vec4 vC; in float vLogZ; in vec2 vUV; in vec3 vLocal;
uniform sampler2D uDome;
out vec4 fragColor;
vec2 domeUV(vec3 d){ d.y = max(d.y, 0.0); vec3 a = abs(d); d /= (a.x + a.y + a.z); return vec2(d.x + d.z, d.x - d.z) * 0.5 + 0.5; }
vec3 envRefl(vec3 R, float depth){
  if (uUnder > 0.5 || depth > 0.0)
    return mix(uwFogColor(max(depth, 0.0) + 6.0), uwLight() * uWaterUW * 2.2, clamp(R.y * 0.5 + 0.5, 0.0, 1.0));
  if (R.y < 0.0) return mix(fogColor(R), ambSky() * (uWaterDeep + uWaterScatter * 0.3) * 4.0, clamp(-R.y * 8.0, 0.0, 1.0));
  return texture(uDome, domeUV(R)).rgb;
}
float lineAA(float d, float w){ float f = fwidth(d) * 1.2 + 1e-5; return 1.0 - smoothstep(w, w + f, d); }
float ggx(float nh, float r){ float a = r * r; float a2 = a * a; float d = nh * nh * (a2 - 1.0) + 1.0; return a2 / (PI * d * d); }

void main(){
  gl_FragDepth = log2(vLogZ) * uLogF * 0.5;
  vec3 N = normalize(vN);
  if (!gl_FrontFacing) N = -N;
  vec3 V = uCamPos - vP; float dist = length(V); V /= dist;
  vec3 L = uKeyDir;
  float m = vC.a;
  vec3 alb = vC.rgb;
  vec3 keyC = uKeyColor * cloudShadow(vP);
  vec3 amb = ambSky();
  float depth = -vP.y;
  if (depth > 0.0){
    float ly = max(L.y, 0.2);
    keyC *= exp(-uWaterSigma * depth / ly);
    amb *= exp(-uWaterSigma * depth) * 0.8 + uWaterScatter * 0.5;
    keyC *= 0.35 + 2.0 * caustics(vP.xz + L.xz / ly * depth, uTime * 0.7);
  }
  float rough = 0.6, metal = 0.0, trans = 0.0, clearcoat = 0.0;
  vec3 irid = vec3(1.0);

  if (m < 0.5){                          // glossy gelcoat / paint
    rough = 0.32; clearcoat = 1.0;
    float grime = smoothstep(0.45, 0.08, vLocal.y) * smoothstep(-0.25, 0.1, vLocal.y);
    alb *= 1.0 - grime * (0.18 + 0.12 * vnoise(vec2(vLocal.z * 3.0, vLocal.y * 20.0)));
  } else if (m < 1.5){                   // sailcloth
    rough = 0.85; trans = 1.0;
    bool jib = m > 1.1;
    float u = vUV.x, v = vUV.y;
    float pv = v * (jib ? 10.0 : 15.0);
    float s = abs(fract(pv + 0.5) - 0.5);
    float seam = lineAA(s, 0.035);
    float stitch = lineAA(abs(s - 0.018), 0.004);
    alb *= 1.0 - seam * 0.07 - stitch * 0.12;
    trans *= 1.0 - seam * 0.35;
    float tape = max(max(1.0 - smoothstep(0.012, 0.022, u), smoothstep(0.972, 0.982, u)), 1.0 - smoothstep(0.012, 0.02, v));
    alb *= 1.0 - tape * 0.1; trans *= 1.0 - tape * 0.6;
    // reinforcement patches at tack, clew and head
    float patchM = max(max(1.0 - smoothstep(0.1, 0.12, length(vec2(u, v * 3.0))), 1.0 - smoothstep(0.1, 0.12, length(vec2(1.0 - u, v * 3.0)))),
                      1.0 - smoothstep(0.06, 0.075, 1.0 - v));
    alb *= 1.0 - patchM * 0.06; trans *= 1.0 - patchM * 0.55;
    if (!jib){
      float bat = 0.0;
      for (int i = 1; i <= 4; i++){
        float bv = float(i) * 0.19;
        bat = max(bat, lineAA(abs(v - bv), 0.006) * smoothstep(0.6 - bv * 0.35, 0.62 - bv * 0.35, u));
      }
      alb *= 1.0 - bat * 0.12; trans *= 1.0 - bat * 0.8;
      // class insignia: two stylised waves
      vec2 lp = vec2(u, v) - vec2(0.42, 0.72);
      float w1 = lineAA(abs(lp.y - 0.018 * sin(lp.x * 38.0)), 0.006);
      float w2 = lineAA(abs(lp.y + 0.03 - 0.018 * sin(lp.x * 38.0 + 1.5)), 0.006);
      float box = step(abs(lp.x), 0.1) * step(abs(lp.y + 0.01), 0.05);
      alb = mix(alb, vec3(0.04, 0.09, 0.22), max(w1, w2) * box);
    }
    alb *= 0.965 + 0.035 * vnoise(vUV * vec2(60.0, 150.0));
  } else if (m < 2.5){                   // stainless / anodised metal
    rough = 0.58; metal = 0.55;
  } else if (m < 3.5){                   // fish: countershaded silver with iridescence
    float yl = vLocal.y / 0.14;
    float counter = smoothstep(-0.3, 0.4, yl);
    vec3 back = vec3(0.025, 0.055, 0.085), belly = vec3(0.78, 0.8, 0.82);
    alb = mix(belly, back, counter);
    float bars = smoothstep(0.35, 0.9, sin(vLocal.z * 34.0 + yl * 3.0)) * smoothstep(0.1, 0.6, yl);
    alb = mix(alb, back * 0.4, bars * 0.55);
    alb = mix(alb, vec3(0.62, 0.55, 0.25), lineAA(abs(yl - 0.1), 0.05) * 0.45);
    float eye = 1.0 - smoothstep(0.022, 0.028, length(vec2(vLocal.z + 0.41, vLocal.y - 0.025)));
    float iris = 1.0 - smoothstep(0.012, 0.016, length(vec2(vLocal.z + 0.41, vLocal.y - 0.025)));
    alb = mix(alb, vec3(0.75, 0.68, 0.4), eye);
    alb = mix(alb, vec3(0.005), iris);
    rough = 0.22; metal = 0.75 * (1.0 - counter * 0.6) * (1.0 - eye);
    irid = 0.6 + 0.4 * cos(6.2831 * (max(dot(N, V), 0.0) * 1.7 + vec3(0.0, 0.33, 0.67)));
  } else if (m < 4.5){                   // island terrain
    float n1 = fbm2(vP.xz * 0.015), n2 = vnoise(vP.xz * 0.25);
    float slope = 1.0 - N.y;
    vec3 grass = mix(vec3(0.045, 0.08, 0.028), vec3(0.11, 0.13, 0.05), n1);
    vec3 rock = mix(vec3(0.2, 0.19, 0.17), vec3(0.34, 0.31, 0.27), n2) * (0.85 + 0.15 * sin(vP.y * 0.7 + n1 * 5.0));
    vec3 sand = vec3(0.66, 0.6, 0.46) * (0.9 + 0.1 * n2);
    sand *= mix(0.55, 1.0, smoothstep(0.3, 1.8, vP.y));
    alb = mix(grass, rock, smoothstep(0.22, 0.42, slope + (n1 - 0.5) * 0.25));
    alb = mix(sand, alb, smoothstep(3.0, 7.0, vP.y + n2 * 2.0));
    rough = 0.92;
  } else if (m < 5.25){                  // matte: antifouling, non-slip deck, rope
    rough = 0.9;
    alb *= 0.93 + 0.07 * vnoise(vLocal.xz * 40.0);
  } else {                               // teak deck planks
    rough = 0.7;
    float px = vLocal.x / 0.11;
    float gap = lineAA(abs(fract(px + 0.5) - 0.5), 0.06);
    float grain = vnoise(vec2(floor(px) * 7.3, vLocal.z * 2.5)) * 0.25 + vnoise(vec2(px * 3.0, vLocal.z * 30.0)) * 0.1;
    alb *= (0.85 + grain) * (1.0 - gap * 0.75);
  }

  float nv = max(dot(N, V), 1e-3);
  float ndl = dot(N, L);
  vec3 R = reflect(-V, N);
  vec3 diffuse = alb * (keyC * max(ndl, 0.0) / PI + amb * (0.6 + 0.4 * N.y) + amb * 0.12 * max(-N.y, 0.0));
  if (trans > 0.0){
    diffuse += alb * trans * keyC * max(-ndl, 0.0) / PI * 0.8;
    diffuse += alb * trans * keyC * pow(max(dot(-V, L), 0.0), 6.0) * 0.5 / PI;
  }
  vec3 H = normalize(L + V);
  vec3 F0 = mix(vec3(0.04), alb, metal);
  vec3 Fs = F0 + (1.0 - F0) * pow(1.0 - max(dot(H, V), 0.0), 5.0);
  vec3 spec = keyC * ggx(max(dot(N, H), 0.0), rough) * Fs * max(ndl, 0.0) * 0.25 / max(nv * 0.5 + 0.5, 0.1);
  vec3 Fe = F0 + (max(vec3(1.0 - rough), F0) - F0) * pow(1.0 - nv, 5.0);
  vec3 env = mix(envRefl(R, depth), amb, clamp(rough * 1.25, 0.0, 0.92)) * irid;
  vec3 col = diffuse * (1.0 - metal) + spec + env * Fe * (1.0 - rough * 0.6);
  if (clearcoat > 0.0){
    float Fc = (0.04 + 0.96 * pow(1.0 - nv, 5.0)) * 0.6;
    vec3 envC = mix(envRefl(R, depth), amb * 1.1, 0.35);
    col = col * (1.0 - Fc) + envC * Fc + keyC * ggx(max(dot(N, H), 0.0), 0.14) * Fc * max(ndl, 0.0) * 0.25;
  }
  if (uUnder > 0.5) col = applyUW(col, dist, 0.5 * (max(-uCamPos.y, 0.0) + max(depth, 0.0)));
  else col = aerial(col, -V, dist);
  fragColor = vec4(col, dist * 0.001);
}`;

  const BOAT_VS = OW.GLSL.COMMON + `
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNor; layout(location=2) in vec4 aCol;
uniform sampler2DArray uDisp; uniform vec3 uCascL;
uniform vec2 uBoatXZ; uniform float uBoatYaw, uHeel;
out vec3 vP; out vec3 vN; out vec4 vC; out float vLogZ; out vec2 vUV; out vec3 vLocal;
layout(location=6) in vec2 aUV;
vec3 dispAt(vec2 x){
  return textureLod(uDisp, vec3(x / uCascL[0], 0.0), 2.0).xyz + textureLod(uDisp, vec3(x / uCascL[1], 1.0), 3.5).xyz * 0.6;
}
mat3 rotX(float a){ float c = cos(a), s = sin(a); return mat3(1,0,0, 0,c,s, 0,-s,c); }
mat3 rotY(float a){ float c = cos(a), s = sin(a); return mat3(c,0,-s, 0,1,0, s,0,c); }
mat3 rotZ(float a){ float c = cos(a), s = sin(a); return mat3(c,s,0, -s,c,0, 0,0,1); }
void main(){
  vec2 fwd = vec2(sin(uBoatYaw), -cos(uBoatYaw));
  vec2 right = vec2(-fwd.y, fwd.x);
  right = vec2(cos(uBoatYaw), sin(uBoatYaw));
  vec3 dc = dispAt(uBoatXZ);
  float hb = dispAt(uBoatXZ + fwd * 5.0).y, hs = dispAt(uBoatXZ - fwd * 5.0).y;
  float hp = dispAt(uBoatXZ - right * 1.8).y, hr = dispAt(uBoatXZ + right * 1.8).y;
  float pitch = atan(hb - hs, 10.0) * 0.8;
  float roll = atan(hr - hp, 3.6) * 0.6 + uHeel + sin(uTime * 0.7) * 0.015;
  float h = (hb + hs + hp + hr + dc.y * 2.0) / 6.0;
  mat3 R = rotY(-uBoatYaw) * rotX(pitch) * rotZ(roll);
  vec3 P = R * aPos + vec3(uBoatXZ.x + dc.x * 0.6, h - 0.12, uBoatXZ.y + dc.z * 0.6);
  vP = P; vN = R * aNor; vC = aCol; vUV = aUV; vLocal = aPos;
  gl_Position = uViewProj * vec4(P, 1.0);
  vLogZ = 1.0 + gl_Position.w;
}`;

  const BIRD_VS = OW.GLSL.COMMON + `
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNor; layout(location=2) in vec4 aCol; layout(location=3) in float aWing;
layout(location=4) in vec4 iA; layout(location=5) in vec4 iB;
uniform vec3 uBirdC;
out vec3 vP; out vec3 vN; out vec4 vC; out float vLogZ; out vec2 vUV; out vec3 vLocal;
layout(location=6) in vec2 aUV;
void main(){
  float R = iA.x, w = iA.y, ph = iA.z, hgt = iA.w;
  float ang = ph + w * uTime;
  vec3 c = uBirdC + vec3(iB.x, hgt + sin(uTime * 0.31 + iB.w * 7.0) * 3.0, iB.y);
  vec3 pos = c + vec3(cos(ang) * R, 0.0, sin(ang) * R);
  vec3 fwd = normalize(vec3(-sin(ang), 0.0, cos(ang)) * sign(w));
  vec3 up0 = vec3(0.0, 1.0, 0.0);
  vec3 right = normalize(cross(fwd, up0));
  float bank = sign(w) * 0.32;
  vec3 up = up0 * cos(bank) + right * sin(bank);
  right = normalize(cross(fwd, up));
  float glide = smoothstep(0.1, 0.6, sin(uTime * 0.37 + iB.w * 11.0));
  float flap = sin(uTime * iB.z + iB.w * 20.0) * 0.55 * (1.0 - glide) + 0.08 * glide;
  vec3 lp = aPos;
  vec3 ln = aNor;
  if (aWing != 0.0){
    float s = abs(aWing);
    float a = flap * (0.7 + 0.6 * s) * sign(aWing);
    float c2 = cos(a), s2 = sin(a);
    lp = vec3(lp.x * c2 - lp.y * s2, lp.x * s2 + lp.y * c2, lp.z);
    ln = vec3(ln.x * c2 - ln.y * s2, ln.x * s2 + ln.y * c2, ln.z);
  }
  vec3 P = pos + right * lp.x + up * lp.y - fwd * lp.z;
  vP = P; vN = right * ln.x + up * ln.y - fwd * ln.z; vC = aCol; vUV = aUV; vLocal = aPos;
  gl_Position = uViewProj * vec4(P, 1.0);
  vLogZ = 1.0 + gl_Position.w;
}`;

  const FISH_VS = OW.GLSL.COMMON + `
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNor; layout(location=2) in vec4 aCol;
layout(location=4) in vec4 iA; layout(location=5) in vec4 iB;
uniform vec3 uSchool;
out vec3 vP; out vec3 vN; out vec4 vC; out float vLogZ; out vec2 vUV; out vec3 vLocal;
layout(location=6) in vec2 aUV;
void main(){
  float r = iA.x, w = iA.y, ph = iA.z, yo = iA.w;
  float ang = ph + w * uTime;
  float breathe = 1.0 + 0.12 * sin(uTime * 0.23 + iB.y * 3.0);
  vec3 off = vec3(cos(ang) * r * breathe, yo + sin(uTime * 0.6 + iB.y * 9.0) * 0.5, sin(ang) * r * 0.7 * breathe);
  off.y += sin(ang * 2.0 + iB.y) * 0.8;
  vec3 pos = uSchool + off;
  vec3 vel = normalize(vec3(-sin(ang) * r, cos(ang * 2.0 + iB.y) * 1.6, cos(ang) * r * 0.7) * sign(w));
  vec3 up0 = vec3(0.0, 1.0, 0.0);
  vec3 right = normalize(cross(vel, up0));
  vec3 up = cross(right, vel);
  float sc = iB.x;
  vec3 lp = aPos * sc;
  float wig = sin(uTime * 11.0 + iB.y * 20.0 + aPos.z * 5.0) * 0.12 * smoothstep(-0.2, 0.55, aPos.z);
  lp.x += wig * sc;
  vec3 P = pos + right * lp.x + up * lp.y - vel * lp.z;
  vP = P; vN = right * aNor.x + up * aNor.y - vel * aNor.z; vC = aCol; vUV = aUV; vLocal = aPos;
  gl_Position = uViewProj * vec4(P, 1.0);
  vLogZ = 1.0 + gl_Position.w;
}`;

  const STATIC_VS = OW.GLSL.COMMON + `
layout(location=0) in vec3 aPos; layout(location=1) in vec3 aNor; layout(location=2) in vec4 aCol;
uniform vec3 uOffset;
out vec3 vP; out vec3 vN; out vec4 vC; out float vLogZ; out vec2 vUV; out vec3 vLocal;
layout(location=6) in vec2 aUV;
void main(){
  vec3 P = aPos + uOffset;
  float r = length(P.xz - uCamPos.xz);
  P.y -= r * r / (2.0 * Rg);
  vP = aPos + uOffset; vN = aNor; vC = aCol; vUV = aUV; vLocal = aPos;
  gl_Position = uViewProj * vec4(P, 1.0);
  vLogZ = 1.0 + gl_Position.w;
}`;

  const FLOOR_VS = OW.GLSL.COMMON + `
layout(location=0) in vec2 aPos;
uniform vec2 uCenter; uniform float uFloorDepth;
out vec3 vP; out float vLogZ;
float floorH(vec2 p){ return -uFloorDepth + (fbm2(p * 0.03) - 0.5) * 1.6 + sin(p.x * 0.9 + fbm2(p * 0.2) * 5.0) * 0.06; }
void main(){
  vec2 xz = uCenter + aPos;
  vec3 P = vec3(xz.x, floorH(xz), xz.y);
  vP = P;
  gl_Position = uViewProj * vec4(P, 1.0);
  vLogZ = 1.0 + gl_Position.w;
}`;

  const FLOOR_FS = OW.GLSL.COMMON + `
in vec3 vP; in float vLogZ;
uniform vec3 uSandColor; uniform float uFloorDepth;
out vec4 fragColor;
void main(){
  gl_FragDepth = log2(vLogZ) * uLogF * 0.5;
  vec3 N = normalize(cross(dFdx(vP), dFdy(vP)));
  if (N.y < 0.0) N = -N;
  float dist = length(uCamPos - vP);
  float depth = -vP.y;
  vec3 L = uKeyDir;
  float ly = max(L.y, 0.2);
  float c = caustics(vP.xz + L.xz / ly * depth, uTime * 0.7);
  float weed = smoothstep(0.62, 0.72, fbm2(vP.xz * 0.05 + 3.0));
  float sand = 0.8 + 0.2 * fbm2(vP.xz * 0.35);
  vec3 alb = mix(uSandColor * sand, vec3(0.08, 0.12, 0.05), weed * 0.8);
  vec3 keyC = uKeyColor * cloudShadow(vP) * exp(-uWaterSigma * depth / ly) * (0.4 + 3.0 * c);
  vec3 amb = ambSky() * exp(-uWaterSigma * depth) * 0.9;
  vec3 col = alb * (keyC * max(dot(N, L), 0.0) / PI + amb);
  col = applyUW(col, dist, 0.5 * (max(-uCamPos.y, 0.0) + depth));
  fragColor = vec4(col, dist * 0.001);
}`;

  const RAIN_VS = OW.GLSL.COMMON + `
layout(location=0) in vec2 aCorner;
uniform vec3 uRainVel;
out float vA; out float vLogZ; out float vY;
void main(){
  float id = float(gl_InstanceID);
  vec3 h = hash33(vec3(id * 0.731, id * 1.379, id * 0.117));
  vec3 box = vec3(40.0, 26.0, 40.0);
  vec3 p = h * box + uRainVel * uTime * (0.85 + 0.3 * h.x);
  p = mod(p - uCamPos + box * 0.5, box) + uCamPos - box * 0.5;
  vec3 dir = normalize(uRainVel);
  vec3 toC = normalize(uCamPos - p);
  vec3 side = normalize(cross(dir, toC));
  float d = length(uCamPos - p);
  vec3 P = p + dir * 0.55 * aCorner.y + side * 0.0045 * aCorner.x * (1.0 + d * 0.05);
  vA = (1.0 - aCorner.y) * smoothstep(0.5, 3.0, d) * (1.0 - smoothstep(12.0, 20.0, d));
  vY = P.y;
  gl_Position = uViewProj * vec4(P, 1.0);
  vLogZ = 1.0 + gl_Position.w;
}`;

  const RAIN_FS = OW.GLSL.COMMON + `
in float vA; in float vLogZ; in float vY;
out vec4 fragColor;
void main(){
  if (vY < -0.2) discard;
  gl_FragDepth = log2(vLogZ) * uLogF * 0.5;
  vec3 c = (ambSky() * 0.9 + uKeyColor * 0.03 + vec3(0.6, 0.65, 0.8) * uFlash * 3.0) * vA * 0.22 * uRain;
  fragColor = vec4(c, 0.0);
}`;

  const SNOW_VS = OW.GLSL.COMMON + `
out float vA; out float vLogZ;
void main(){
  float id = float(gl_VertexID);
  vec3 h = hash33(vec3(id * 0.531, id * 1.173, id * 0.917));
  vec3 box = vec3(24.0);
  vec3 p = h * box + vec3(sin(uTime * 0.1 + id) * 0.3, -uTime * 0.05, cos(uTime * 0.13 + id) * 0.3);
  p = mod(p - uCamPos + box * 0.5, box) + uCamPos - box * 0.5;
  float d = length(uCamPos - p);
  vA = smoothstep(12.0, 3.0, d) * (0.4 + 0.6 * h.y) * step(p.y, -0.3);
  gl_Position = uViewProj * vec4(p, 1.0);
  gl_PointSize = clamp(3.0 * 1080.0 / (d * 300.0), 1.0, 5.0);
  vLogZ = 1.0 + gl_Position.w;
}`;

  const SNOW_FS = OW.GLSL.COMMON + `
in float vA; in float vLogZ;
out vec4 fragColor;
void main(){
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float a = smoothstep(1.0, 0.2, dot(q, q)) * vA;
  gl_FragDepth = log2(vLogZ) * uLogF * 0.5;
  fragColor = vec4(uwLight() * vec3(0.5, 0.7, 0.8) * a * 0.35, 0.0);
}`;

  // ---------------------------------------------------------------- meshes
  // rgb + material id (0 gloss gelcoat, 1 mainsail, 1.25 jib, 2 metal, 3 fish, 4 terrain, 5 matte, 5.5 teak)
  const WHITE = [0.86, 0.87, 0.86, 0], NAVY = [0.025, 0.045, 0.11, 0], RED = [0.26, 0.055, 0.045, 5];
  const DECK = [0.74, 0.73, 0.69, 5], TEAK = [0.42, 0.29, 0.17, 5.5], DARK = [0.012, 0.016, 0.02, 0];
  const KEEL = [0.05, 0.05, 0.055, 5], METAL = [0.72, 0.74, 0.77, 2], WIRE = [0.5, 0.52, 0.55, 2], BLACK = [0.03, 0.03, 0.035, 2];
  const SAIL = [0.94, 0.93, 0.89, 1], JIB = [0.94, 0.93, 0.89, 1.25], ROPE = [0.8, 0.78, 0.7, 5];

  function buildBoat(gl) {
    const B = new Builder();
    const w = (u) => 1.95 * (1 - Math.pow(Math.max(u - 0.42, 0) / 0.58, 1.7)) * (u < 0.42 ? 0.8 + 0.2 * Math.sin((u / 0.42) * Math.PI / 2) : 1);
    const ytop = (u) => 1.05 + 0.4 * u * u;
    const yb = (u) => -0.62 * Math.pow(Math.sin(Math.PI * (0.08 + 0.86 * u)), 0.6) + 0.25 * Math.pow(u, 6);
    const z = (u) => 6 - 12.2 * u;
    const hullCol = (u, v, p) => {
      const y = p[1];
      if (y > ytop(u) - 0.1) return NAVY;
      if (y > 0.2) return WHITE;
      if (y > 0.06) return NAVY;
      return RED;
    };
    for (const side of [1, -1]) {
      B.grid(40, 18, (u, v) => {
        const vv = Math.pow(v, 0.8);
        return [side * w(u) * (1 - Math.pow(v, 2.6)), ytop(u) + (yb(u) - ytop(u)) * vv, z(u)];
      }, hullCol);
    }
    // deck
    B.grid(30, 6, (u, v) => [(2 * v - 1) * w(u) * 0.999, ytop(u) + 0.02 - 0.06 * Math.abs(2 * v - 1), z(u)],
      (u, v) => (u < 0.33 && Math.abs(2 * v - 1) < 0.7 ? TEAK : DECK));
    // transom
    B.grid(8, 10, (u, v) => [(2 * u - 1) * w(0) * (1 - Math.pow(v, 2.6)), ytop(0) + (yb(0) - ytop(0)) * Math.pow(v, 0.8), 6.0],
      (u, v, p) => (p[1] > 0.2 ? WHITE : p[1] > 0.06 ? NAVY : RED));
    // cabin + windows
    B.box([0, 1.45, 0.3], [2.3, 0.62, 4.2], WHITE);
    B.box([0, 1.78, 0.2], [2.0, 0.06, 3.8], DECK);
    for (const s of [1, -1]) B.box([s * 1.16, 1.5, 0.3], [0.02, 0.16, 2.6], DARK);
    B.box([0, 1.48, -1.82], [1.6, 0.18, 0.02], DARK);
    // keel & rudder
    B.box([0, -1.2, 0.4], [0.18, 1.5, 1.6], KEEL);
    B.box([0, -1.95, 0.5], [0.4, 0.3, 2.0], KEEL);
    B.box([0, -0.7, 5.2], [0.1, 1.2, 0.6], KEEL);
    // mast, boom, pulpit
    B.box([0, 8.6, -1.1], [0.16, 15.2, 0.24], METAL);
    const boomAng = 0.28;
    const bc = Math.cos(boomAng), bs = Math.sin(boomAng);
    const rotMast = (p) => { const dz = p[2] + 1.1; return [p[0] * bc + dz * bs, p[1], -p[0] * bs + dz * bc - 1.1]; };
    {
      const B2 = new Builder();
      B2.box([0, 2.3, 1.35], [0.12, 0.14, 4.9], METAL);
      for (let i = 0; i < B2.p.length; i += 3) {
        const r = rotMast([B2.p[i], B2.p[i + 1], B2.p[i + 2]]);
        B.p.push(...r);
        const n = [B2.n[i], B2.n[i + 1], B2.n[i + 2]];
        B.n.push(n[0] * bc + n[2] * bs, n[1], -n[0] * bs + n[2] * bc);
      }
      B.c.push(...B2.c); B.x.push(...B2.x); B.uv.push(...B2.uv);
    }
    // stanchions / rails (thin boxes)
    for (let i = 0; i < 7; i++) {
      const u = 0.08 + i * 0.12;
      for (const s of [1, -1]) B.box([s * w(u) * 0.95, ytop(u) + 0.35, z(u)], [0.03, 0.7, 0.03], METAL);
    }
    // mainsail (grid in mast-local frame, swung to leeward)
    B.grid(14, 20, (u, v) => {
      const chord = 4.75 * (1 - Math.pow(v, 0.95)) + 0.25;
      const y = 2.4 + v * 13.6;
      const zz = -1.0 + u * chord;
      const x = Math.sin(Math.PI * Math.pow(u, 0.8)) * chord * 0.1 * (1 - v * 0.3);
      return rotMast([x, y, zz]);
    }, () => SAIL);
    // jib (JIB id)
    const tack = [0, 1.55, -6.0], head = [0, 13.8, -1.25], clew = [0.95, 1.95, -0.5];
    const jn = OW.v3.norm(OW.v3.cross(OW.v3.sub(head, tack), OW.v3.sub(clew, tack)));
    B.grid(12, 16, (u, v) => {
      const p = OW.v3.add(tack, OW.v3.add(OW.v3.scale(OW.v3.sub(head, tack), v), OW.v3.scale(OW.v3.sub(clew, tack), u * (1 - v))));
      const bulge = Math.sin(Math.PI * u) * (1 - v) * 0.45;
      return OW.v3.add(p, OW.v3.scale(jn, Math.abs(bulge) * Math.sign(jn[0] || 1))); // bulge to leeward (+x)
    }, () => JIB);

    // ---- standing rigging
    const top = [0, 16.05, -1.1], cap = [0, 13.95, -1.12], spY = 8.6;
    B.segment([0, 1.5, -6.05], cap, 0.011, WIRE);                        // forestay
    B.segment([0, 1.3, 5.95], top, 0.01, WIRE);                          // backstay
    B.box([0, spY, -1.1], [1.9, 0.05, 0.09], METAL);                     // spreaders
    for (const s of [1, -1]) {
      const chain = [s * 1.78, ytop(0.55) + 0.02, -0.75];
      const tip = [s * 0.95, spY, -1.1];
      B.segment(chain, tip, 0.01, WIRE);                                 // cap shroud (lower leg)
      B.segment(tip, [s * 0.06, 15.8, -1.1], 0.01, WIRE);                // cap shroud (upper leg)
      B.segment([s * 1.74, ytop(0.5) + 0.02, -0.2], [s * 0.07, spY - 0.1, -1.05], 0.009, WIRE);  // aft lower
      B.segment([s * 1.7, ytop(0.62) + 0.02, -1.6], [s * 0.07, spY - 0.1, -1.15], 0.009, WIRE);  // fwd lower
      // lifelines between stanchions
      for (const hgt of [0.38, 0.7]) {
        for (let i = 0; i < 6; i++) {
          const u0 = 0.08 + i * 0.12, u1 = u0 + 0.12;
          B.segment([s * w(u0) * 0.95, ytop(u0) + hgt, z(u0)], [s * w(u1) * 0.95, ytop(u1) + hgt, z(u1)], 0.006, WIRE);
        }
      }
      // winches on the cockpit coaming
      B.box([s * 1.25, ytop(0.1) + 0.12, 3.6], [0.2, 0.22, 0.2], BLACK);
      B.box([s * 1.25, ytop(0.1) + 0.24, 3.6], [0.14, 0.04, 0.14], METAL);
      B.box([s * 0.85, 1.92, 2.3], [0.16, 0.18, 0.16], BLACK);
      // cockpit coaming
      B.box([s * 1.2, ytop(0.1) + 0.05, 3.3], [0.08, 0.28, 3.2], WHITE);
    }
    // bow pulpit
    const pu = [[0.55, 0.9], [0.3, 0.97], [0, 1.0], [-0.3, 0.97], [-0.55, 0.9]];
    for (let i = 0; i < pu.length - 1; i++) B.segment([pu[i][0], ytop(1) + 0.62, -6.05 + (1 - pu[i][1]) * 3.2], [pu[i + 1][0], ytop(1) + 0.62, -6.05 + (1 - pu[i + 1][1]) * 3.2], 0.014, METAL);
    // stern pushpit
    for (const s of [1, -1]) B.segment([s * 1.5, ytop(0) + 0.7, 5.8], [s * 0.4, ytop(0) + 0.7, 6.0], 0.014, METAL);
    B.segment([0.4, ytop(0) + 0.7, 6.0], [-0.4, ytop(0) + 0.7, 6.0], 0.014, METAL);
    // hatch, handrails, mast base, boom vang
    B.box([0, 1.83, -0.9], [0.75, 0.05, 0.75], DARK);
    for (const s of [1, -1]) B.box([s * 0.75, 1.86, 0.4], [0.04, 0.05, 2.0], TEAK);
    B.box([0, 1.95, -1.1], [0.32, 0.25, 0.4], METAL);
    B.segment([0, 2.0, -0.95], rotMast([0, 2.25, 0.25]), 0.025, BLACK);
    // mainsheet (rope) from boom end to traveller
    B.segment(rotMast([0, 2.25, 3.5]), [0.3, ytop(0.05) + 0.1, 4.2], 0.008, ROPE);
    B.segment(rotMast([0, 2.25, 3.5]), [-0.1, ytop(0.05) + 0.1, 4.2], 0.008, ROPE);
    // jib sheet
    B.segment(clew, [1.3, ytop(0.12) + 0.3, 3.2], 0.007, ROPE);
    return B.build(gl);
  }

  function buildBird(gl) {
    const B = new Builder();
    const body = [0.93, 0.93, 0.92, 5], wing = [0.6, 0.62, 0.66, 5], tip = [0.06, 0.06, 0.07, 5], beak = [0.9, 0.7, 0.2, 5];
    B.grid(8, 6, (u, v) => {
      const a = v * Math.PI * 2, zz = -0.28 + u * 0.62;
      const r = 0.075 * Math.sin(Math.PI * Math.min(u * 1.1 + 0.05, 1)) + 0.005;
      return [Math.cos(a) * r, Math.sin(a) * r * 1.1, zz];
    }, () => body);
    B.tri([0, 0.01, -0.28], [0.015, 0, -0.36], [-0.015, 0, -0.36], beak);
    B.tri([0, 0, 0.3], [0.09, 0, 0.42], [-0.09, 0, 0.42], body);
    for (const s of [1, -1]) {
      // inner wing
      B.quad([s * 0.05, 0.01, -0.08], [s * 0.38, 0.03, -0.06], [s * 0.38, 0.02, 0.1], [s * 0.05, 0.01, 0.14], wing, s * 0.5);
      // outer wing, tapering, dark tip
      B.quad([s * 0.38, 0.03, -0.06], [s * 0.66, 0.02, 0.02], [s * 0.66, 0.02, 0.1], [s * 0.38, 0.02, 0.1], wing, s * 1.0);
      B.tri([s * 0.66, 0.02, 0.02], [s * 0.78, 0.01, 0.1], [s * 0.66, 0.02, 0.1], tip, s * 1.0);
    }
    // wing vertex flags: B.x holds signed span. Set proportional to |x|
    for (let i = 0; i < B.x.length; i++) if (B.x[i] !== 0) B.x[i] = Math.sign(B.x[i]) * Math.abs(B.p[i * 3]) / 0.78;
    return B;
  }

  function buildFish() {
    const B = new Builder();
    const back = [0.035, 0.05, 0.07, 3], belly = [0.45, 0.5, 0.52, 3];
    B.grid(12, 8, (u, v) => {
      const a = v * Math.PI * 2, zz = -0.5 + u * 0.95;
      const prof = Math.pow(Math.sin(Math.PI * Math.min(u * 0.95 + 0.04, 1)), 0.75);
      return [Math.cos(a) * 0.06 * prof, Math.sin(a) * 0.14 * prof, zz];
    }, (u, v, p) => (p[1] > 0.01 ? back : belly));
    const fin = [0.12, 0.17, 0.22, 3];
    B.tri([0, 0.02, 0.4], [0, 0.18, 0.62], [0, 0, 0.5], fin);
    B.tri([0, -0.02, 0.4], [0, 0, 0.5], [0, -0.18, 0.62], fin);
    B.tri([0, 0.12, -0.05], [0, 0.22, 0.12], [0, 0.12, 0.18], fin);
    return B;
  }

  function vnoiseJS() {
    const perm = new Uint8Array(512), r = OW.rng(99);
    for (let i = 0; i < 256; i++) perm[i] = i;
    for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [perm[i], perm[j]] = [perm[j], perm[i]]; }
    for (let i = 0; i < 256; i++) perm[i + 256] = perm[i];
    const h = (x, y) => perm[(perm[x & 255] + y) & 511] / 255;
    const n = (x, y) => {
      const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
      const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      return OW.lerp(OW.lerp(h(xi, yi), h(xi + 1, yi), u), OW.lerp(h(xi, yi + 1), h(xi + 1, yi + 1), u), v);
    };
    return (x, y) => { let s = 0, a = 0.5; for (let i = 0; i < 6; i++) { s += a * n(x, y); x = x * 2.03 + 7; y = y * 2.03 + 3; a *= 0.5; } return s; };
  }

  function buildIsland(gl) {
    const fbm = vnoiseJS();
    const S = 3400, n = 140, R = 1500;
    const H = (x, z) => {
      const r = Math.hypot(x * 1.0, z * 1.6) / R;
      const warp = fbm(x * 0.0012 + 3, z * 0.0012) * 0.5;
      const m = OW.smooth(1.05, 0.15, r + warp * 0.4 - 0.2);
      return m * (60 + 290 * Math.pow(fbm(x * 0.0009, z * 0.0009 + 5), 1.6)) * (0.7 + 0.5 * fbm(x * 0.004, z * 0.004)) - 18;
    };
    const B = new Builder();
    const P = [];
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
      const x = (i / n - 0.5) * S, z = (j / n - 0.5) * S;
      P.push([x, H(x, z), z]);
    }
    const at = (i, j) => P[j * (n + 1) + i];
    const nor = (i, j) => {
      const l = at(Math.max(i - 1, 0), j), r = at(Math.min(i + 1, n), j), d = at(i, Math.max(j - 1, 0)), u = at(i, Math.min(j + 1, n));
      return OW.v3.norm(OW.v3.cross(OW.v3.sub(u, d), OW.v3.sub(r, l)));
    };
    const colAt = (p, nn) => {
      const y = p[1], slope = 1 - nn[1];
      const noise = fbm(p[0] * 0.02, p[2] * 0.02);
      if (y < 4) return [0.62, 0.56, 0.43, 4];
      if (slope > 0.35) return [0.28 + noise * 0.1, 0.27 + noise * 0.08, 0.25, 4];
      const g = 0.6 + noise * 0.5;
      return [0.07 * g, 0.12 * g, 0.05 * g, 4];
    };
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const q = [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]];
      if (q.every(([a, b]) => at(a, b)[1] < -2)) continue;
      for (const [a, b] of [q[0], q[3], q[2], q[0], q[2], q[1]]) {
        const p = at(a, b), nn = nor(a, b);
        B.vert(p, nn, colAt(p, nn));
      }
    }
    return { mesh: B.build(gl), H, S };
  }

  function polarGrid(gl, segs, rMax, rMin) {
    const q = (2 * Math.PI) / segs;
    const rings = [0];
    let r = 0;
    while (r < rMax) { r += Math.max(rMin, r * q); rings.push(r); }
    const pos = new Float32Array(rings.length * segs * 2);
    for (let j = 0; j < rings.length; j++) for (let i = 0; i < segs; i++) {
      const a = i * q + (j % 2) * q * 0.5;
      pos[(j * segs + i) * 2] = Math.cos(a) * rings[j];
      pos[(j * segs + i) * 2 + 1] = Math.sin(a) * rings[j];
    }
    const idx = new Uint32Array((rings.length - 1) * segs * 6);
    let k = 0;
    for (let j = 0; j < rings.length - 1; j++) for (let i = 0; i < segs; i++) {
      const a = j * segs + i, b = j * segs + ((i + 1) % segs), c = (j + 1) * segs + i, d = (j + 1) * segs + ((i + 1) % segs);
      idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d;
    }
    return OW.mesh(gl, [{ loc: 0, size: 2, data: pos }], idx);
  }

  // ---------------------------------------------------------------- class
  class Objects {
    constructor(gl) {
      this.gl = gl;
      this.pBoat = new OW.Program(gl, BOAT_VS, LIT_FS, 'boat');
      this.pBird = new OW.Program(gl, BIRD_VS, LIT_FS, 'bird');
      this.pFish = new OW.Program(gl, FISH_VS, LIT_FS, 'fish');
      this.pStatic = new OW.Program(gl, STATIC_VS, LIT_FS, 'island');
      this.pFloor = new OW.Program(gl, FLOOR_VS, FLOOR_FS, 'floor');
      this.pRain = new OW.Program(gl, RAIN_VS, RAIN_FS, 'rain');
      this.pSnow = new OW.Program(gl, SNOW_VS, SNOW_FS, 'snow');
      this.boat = buildBoat(gl);
      const isl = buildIsland(gl);
      this.island = isl.mesh;
      this.islandPos = [OW.dirFromBearing(118, 0)[0] * 9500, 0, OW.dirFromBearing(118, 0)[2] * 9500];
      // Bake island heights so the ocean can draw shallows and breaking surf around it.
      const HN = 256, hd = new Float32Array(HN * HN);
      for (let j = 0; j < HN; j++) for (let i = 0; i < HN; i++) {
        hd[j * HN + i] = OW.clamp(isl.H(((i + 0.5) / HN - 0.5) * isl.S, ((j + 0.5) / HN - 0.5) * isl.S), -60, 400);
      }
      this.islandTex = OW.tex2D(gl, { w: HN, h: HN, internal: gl.R16F, format: gl.RED, type: gl.FLOAT, data: hd });
      this.islandRect = [this.islandPos[0] - isl.S / 2, this.islandPos[2] - isl.S / 2, isl.S];

      // gulls
      const rnd = OW.rng(7);
      this.birds = [];
      const NB = 7;
      const ia = new Float32Array(NB * 4), ib = new Float32Array(NB * 4);
      for (let i = 0; i < NB; i++) {
        const R = 22 + rnd() * 40, spd = 8 + rnd() * 4, dir = rnd() < 0.6 ? 1 : -1;
        const b = { R, w: (spd / R) * dir, ph: rnd() * 6.283, h: 14 + rnd() * 22, ox: (rnd() - 0.5) * 60, oz: (rnd() - 0.5) * 60, flap: 5 + rnd() * 1.5, seed: rnd() };
        this.birds.push(b);
        ia.set([b.R, b.w, b.ph, b.h], i * 4);
        ib.set([b.ox, b.oz, b.flap, b.seed], i * 4);
      }
      this.birdMesh = buildBird(gl).build(gl, [
        { loc: 4, size: 4, data: ia, divisor: 1 },
        { loc: 5, size: 4, data: ib, divisor: 1 },
      ]);
      this.nBirds = NB;

      // fish
      const NF = 650;
      const fa = new Float32Array(NF * 4), fb = new Float32Array(NF * 4);
      for (let i = 0; i < NF; i++) {
        const r = 2.0 + Math.pow(rnd(), 0.7) * 9.0;
        fa.set([r, (0.28 + rnd() * 0.12) * (1.0 - r * 0.02), rnd() * 6.283, (rnd() - 0.5) * 5.5 * (1 - r / 14)], i * 4);
        fb.set([0.55 + rnd() * 0.3, rnd(), 0, 0], i * 4);
      }
      this.fishMesh = buildFish().build(gl, [
        { loc: 4, size: 4, data: fa, divisor: 1 },
        { loc: 5, size: 4, data: fb, divisor: 1 },
      ]);
      this.nFish = NF;

      this.floor = polarGrid(gl, 160, 400, 0.4);
      this.rainQuad = OW.mesh(gl, [{ loc: 0, size: 2, data: new Float32Array([-1, 0, 1, 0, 1, 1, -1, 0, 1, 1, -1, 1]) }]);
      this.emptyVao = gl.createVertexArray();
    }

    birdPos(i, t, center) {
      const b = this.birds[i];
      const ang = b.ph + b.w * t;
      const c = [center[0] + b.ox, center[1] + b.h + Math.sin(t * 0.31 + b.seed * 7) * 3, center[2] + b.oz];
      const pos = [c[0] + Math.cos(ang) * b.R, c[1], c[2] + Math.sin(ang) * b.R];
      const fwd = OW.v3.norm(OW.v3.scale([-Math.sin(ang), 0, Math.cos(ang)], Math.sign(b.w)));
      return { pos, fwd };
    }

    drawOpaque(common, st, ocean) {
      const gl = this.gl;
      gl.disable(gl.CULL_FACE);
      // island
      common(this.pStatic.use());
      this.pStatic.set('uOffset', this.islandPos);
      this.island.draw();
      // boat
      const pb = this.pBoat.use();
      common(pb);
      ocean.bindDisp(pb);
      pb.set('uBoatXZ', st.boatXZ).set('uBoatYaw', st.boatYaw).set('uHeel', st.boatHeel);
      this.boat.draw();
      // gulls (daytime, above water)
      if (st.birds) {
        common(this.pBird.use());
        this.pBird.set('uBirdC', st.birdCenter);
        this.birdMesh.draw(gl.TRIANGLES, this.nBirds);
      }
      if (st.under) {
        common(this.pFish.use());
        this.pFish.set('uSchool', st.school);
        this.fishMesh.draw(gl.TRIANGLES, this.nFish);
        if (st.floorDepth > 0) {
          common(this.pFloor.use());
          this.pFloor.set('uCenter', [st.cam[0], st.cam[2]]).set('uFloorDepth', st.floorDepth).set('uSandColor', st.sandColor);
          this.floor.draw();
        }
      }
    }

    drawTransparent(common, st) {
      const gl = this.gl;
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.ONE, gl.ONE, gl.ZERO, gl.ONE);
      gl.depthMask(false);
      if (st.rain > 0.01 && !st.under) {
        common(this.pRain.use());
        this.pRain.set('uRainVel', st.rainVel);
        this.rainQuad.draw(gl.TRIANGLES, Math.floor(6000 * st.rain * st.particleScale));
      }
      if (st.under) {
        common(this.pSnow.use());
        gl.bindVertexArray(this.emptyVao);
        gl.drawArrays(gl.POINTS, 0, Math.floor(2500 * st.particleScale));
      }
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }
  }
  OW.Objects = Objects;
})();
