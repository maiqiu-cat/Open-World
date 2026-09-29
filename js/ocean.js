'use strict';
// Ocean: JONSWAP spectrum -> GPU FFT (3 cascades) -> displacement / derivative / foam arrays.
(function () {
  const G = 9.81;
  const CASCADES = [521.3, 83.7, 13.73];
  const CUTS = [0, (2 * Math.PI / CASCADES[1]) * 4, (2 * Math.PI / CASCADES[2]) * 4, 1e9];

  function lgamma(x) {
    const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
      -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
    x -= 1;
    let a = c[0];
    const t = x + 7.5;
    for (let i = 1; i < 9; i++) a += c[i] / (x + i);
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
  }
  const spreadQ = (s) => Math.exp((2 * s - 1) * Math.LN2 - Math.log(Math.PI) + 2 * lgamma(s + 1) - lgamma(2 * s + 1));

  function jonswap(w, U, F, gamma) {
    const alpha = 0.076 * Math.pow((U * U) / (F * G), 0.22);
    const wp = 22 * Math.pow((G * G) / (U * F), 1 / 3);
    const sigma = w <= wp ? 0.07 : 0.09;
    const r = Math.exp(-((w - wp) ** 2) / (2 * sigma * sigma * wp * wp));
    return { S: ((alpha * G * G) / Math.pow(w, 5)) * Math.exp(-1.25 * Math.pow(wp / w, 4)) * Math.pow(gamma, r), wp };
  }

  function genSpectrum(N, L, kmin, kmax, P, seed, withSwell) {
    const rnd = OW.rng(seed);
    const out = new Float32Array(N * N * 4);
    const swell = withSwell ? new Float32Array(N * N * 2) : null;
    const dk = (2 * Math.PI) / L;
    const U = Math.max(P.wind, 0.5);
    const F = 50000;
    const dirB = P.direction * OW.deg;
    const thW = Math.atan2(-Math.cos(dirB), Math.sin(dirB));
    const thS = thW - 0.62;
    const wpS = (2 * Math.PI) / 12.5;
    let swellVar = 0;
    const amp = new Float32Array(N * N);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const i = y * N + x;
        const g1 = rnd.gauss(), g2 = rnd.gauss(), g3 = rnd.gauss(), g4 = rnd.gauss();
        const mx = x < N / 2 ? x : x - N, my = y < N / 2 ? y : y - N;
        const kx = mx * dk, kz = my * dk, k = Math.hypot(kx, kz);
        if (k === 0 || k < kmin || k >= kmax) continue;
        const w = Math.sqrt(G * k);
        const dwdk = G / (2 * w);
        const th = Math.atan2(kz, kx);
        const js = jonswap(w, U, F, 3.3);
        let s = w <= js.wp ? 6.97 * Math.pow(w / js.wp, 4.06) : 9.77 * Math.pow(w / js.wp, -2.33 - 1.45 * ((U * js.wp) / G - 1.17));
        s = OW.clamp(s, 0.6, 30);
        const D = spreadQ(s) * Math.pow(Math.abs(Math.cos((th - thW) / 2)), 2 * s);
        let S = js.S * D;
        S *= Math.exp(-k * k * 0.0004); // tame capillary tail
        const a = Math.sqrt((2 * S * dwdk / k) * dk * dk) * P.waveHeight;
        out[i * 4] = (a * g1) / Math.SQRT2;
        out[i * 4 + 1] = (a * g2) / Math.SQRT2;
        if (swell) {
          // Narrow-band, long-period swell arriving off-axis from the wind sea.
          const ss = 22;
          const Ds = spreadQ(ss) * Math.pow(Math.abs(Math.cos((th - thS) / 2)), 2 * ss);
          const shape = Math.exp(-((w - wpS) ** 2) / (2 * (0.12 * wpS) ** 2));
          const as = Math.sqrt((2 * shape * Ds * dwdk / k) * dk * dk);
          swell[i * 2] = (as * g3) / Math.SQRT2;
          swell[i * 2 + 1] = (as * g4) / Math.SQRT2;
          swellVar += as * as * (g3 * g3 + g4 * g4); // = 2|h0|^2 (mode + its mirror)
        }
        amp[i] = a;
      }
    }
    if (swell && swellVar > 0) {
      const target = (P.swell / 4) ** 2;
      const sc = Math.sqrt(target / swellVar) * P.waveHeight;
      for (let i = 0; i < N * N; i++) {
        out[i * 4] += swell[i * 2] * sc;
        out[i * 4 + 1] += swell[i * 2 + 1] * sc;
      }
    }
    // conj(h0(-k)) in zw
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const i = y * N + x, j = ((N - y) % N) * N + ((N - x) % N);
      out[i * 4 + 2] = out[j * 4];
      out[i * 4 + 3] = -out[j * 4 + 1];
    }
    return out;
  }

  const EVOLVE_FS = `
uniform sampler2D uH0; uniform float uL; uniform int uN; uniform float uT;
layout(location=0) out vec4 o0; layout(location=1) out vec4 o1;
vec2 cmul(vec2 a, vec2 b){ return vec2(a.x*b.x - a.y*b.y, a.x*b.y + a.y*b.x); }
vec2 mulI(vec2 a){ return vec2(-a.y, a.x); }
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy);
  int hn = uN / 2;
  vec2 m = vec2(float(p.x < hn ? p.x : p.x - uN), float(p.y < hn ? p.y : p.y - uN));
  vec2 k = m * (6.28318530718 / uL);
  float kl = length(k);
  if (kl < 1e-6){ o0 = vec4(0.0); o1 = vec4(0.0); return; }
  vec4 h0 = texelFetch(uH0, p, 0);
  float w = sqrt(9.81 * kl);
  float ph = mod(w * uT, 6.28318530718);
  vec2 e = vec2(cos(ph), sin(ph));
  vec2 h = cmul(h0.xy, e) + cmul(h0.zw, vec2(e.x, -e.y));
  vec2 ih = mulI(h);
  vec2 kn = k / kl;
  vec2 Dx = kn.x * ih, Dz = kn.y * ih;
  vec2 hx = k.x * ih, hz = k.y * ih;
  vec2 dxx = -(k.x * k.x / kl) * h;
  vec2 dzz = -(k.y * k.y / kl) * h;
  vec2 dxz = -(k.x * k.y / kl) * h;
  o0 = vec4(Dx + mulI(h), Dz + mulI(hx));
  o1 = vec4(hz + mulI(dxx), dzz + mulI(dxz));
}`;

  const FFT_FS = `
uniform sampler2D uIn0, uIn1; uniform int uS, uHoriz, uN;
layout(location=0) out vec4 o0; layout(location=1) out vec4 o1;
vec2 cmul(vec2 a, vec2 b){ return vec2(a.x*b.x - a.y*b.y, a.x*b.y + a.y*b.x); }
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy);
  int j = uHoriz == 1 ? p.x : p.y;
  int hs = uS / 2;
  int ev = (j / uS) * hs + (j % hs);
  int od = ev + uN / 2;
  ivec2 pe = uHoriz == 1 ? ivec2(ev, p.y) : ivec2(p.x, ev);
  ivec2 po = uHoriz == 1 ? ivec2(od, p.y) : ivec2(p.x, od);
  float ang = 6.28318530718 * float(j % uS) / float(uS);
  vec2 w = vec2(cos(ang), sin(ang));
  vec4 e0 = texelFetch(uIn0, pe, 0), q0 = texelFetch(uIn0, po, 0);
  vec4 e1 = texelFetch(uIn1, pe, 0), q1 = texelFetch(uIn1, po, 0);
  o0 = vec4(e0.xy + cmul(w, q0.xy), e0.zw + cmul(w, q0.zw));
  o1 = vec4(e1.xy + cmul(w, q1.xy), e1.zw + cmul(w, q1.zw));
}`;

  const MERGE_FS = `
uniform sampler2D uA, uB; uniform sampler2DArray uPrev; uniform int uLayer;
uniform float uLambda, uDt, uDecay, uBias, uGain;
layout(location=0) out vec4 oDisp; layout(location=1) out vec4 oDeriv;
void main(){
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 a = texelFetch(uA, p, 0), b = texelFetch(uB, p, 0);
  float dxx = uLambda * b.y, dzz = uLambda * b.z, dxz = uLambda * b.w;
  float J = (1.0 + dxx) * (1.0 + dzz) - dxz * dxz;
  float prev = texelFetch(uPrev, ivec3(p, uLayer), 0).w;
  float f = max(prev * exp(-uDt * uDecay), clamp((uBias - J) * uGain, 0.0, 1.0));
  oDisp = vec4(uLambda * a.x, a.y, uLambda * a.z, f);
  oDeriv = vec4(a.w, b.x, dxx, dzz);
}`;

  const QUERY_FS = `
uniform sampler2DArray uDisp; uniform vec3 uCascL; uniform vec2 uQ[4];
out vec4 o;
vec3 dsum(vec2 x){ vec3 d = vec3(0.0); for (int i = 0; i < 3; i++) d += textureLod(uDisp, vec3(x / uCascL[i], float(i)), 1.0).xyz; return d; }
void main(){
  int i = int(gl_FragCoord.x);
  vec2 q = uQ[i];
  vec2 x = q;
  for (int it = 0; it < 4; it++){ vec3 d = dsum(x); x = q - d.xz; }
  vec3 d = dsum(x);
  o = vec4(d.y, 0.0, 0.0, 1.0);
}`;

  const WATER_VS = OW.GLSL.COMMON + `
layout(location=0) in vec2 aPos;
uniform vec2 uCenter; uniform vec3 uCascL; uniform float uNfft, uSpacingQ, uSpacingMin;
uniform sampler2DArray uDisp;
out vec3 vWorld; out vec2 vXZ; out float vLogZ; out float vSp;
void main(){
  vec2 xz = uCenter + aPos;
  float r = length(aPos);
  float sp = max(uSpacingMin, r * uSpacingQ);
  vec3 d = vec3(0.0);
  for (int i = 0; i < 3; i++){
    float L = uCascL[i];
    float lod = log2(max(sp * 1.5 / (L / uNfft), 1.0));
    float fade = 1.0 - smoothstep(L * 0.25, L * 1.0, sp * 4.0);
    d += textureLod(uDisp, vec3(xz / L, float(i)), lod).xyz * fade;
  }
  vec3 P = vec3(xz.x + d.x, d.y, xz.y + d.z);
  P.y -= r * r / (2.0 * Rg);
  vWorld = P; vXZ = xz; vSp = sp;
  gl_Position = uViewProj * vec4(P, 1.0);
  vLogZ = 1.0 + gl_Position.w;
}`;

  const WATER_FS = OW.GLSL.COMMON + `
in vec3 vWorld; in vec2 vXZ; in float vLogZ; in float vSp;
uniform sampler2DArray uDisp, uDeriv;
uniform sampler2D uDome;
uniform vec3 uCascL;
uniform float uFoamAmt, uNightGlow, uFloorDepth, uWind;
uniform vec3 uSandColor;
uniform vec2 uBoatXZ, uBoatFwd;
uniform sampler2D uIsland; uniform vec3 uIslandRect;
out vec4 fragColor;
float islandH(vec2 xz){
  vec2 uv = (xz - uIslandRect.xy) / uIslandRect.z;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return -100.0;
  return texture(uIsland, uv).r;
}
// Cellular edge distance: small at cell borders -> lacy foam networks.
float voroEdge(vec2 p, float t){
  vec2 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
    vec2 g = vec2(float(x), float(y));
    vec2 o = hash22(i + g);
    o = 0.5 + 0.38 * sin(t + 6.2831 * o);
    float d = dot(g + o - f, g + o - f);
    if (d < d1){ d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return sqrt(d2) - sqrt(d1);
}

vec2 domeUV(vec3 d){ d.y = max(d.y, 0.0); vec3 a = abs(d); d /= (a.x + a.y + a.z); return vec2(d.x + d.z, d.x - d.z) * 0.5 + 0.5; }
vec3 dome(vec3 d){ return texture(uDome, domeUV(d)).rgb; }
float ggxD(float NdH, float a){ float a2 = a*a; float d = NdH*NdH*(a2 - 1.0) + 1.0; return a2 / (PI*d*d); }
float smithV(float NdV, float NdL, float a){ float k = a * 0.5; return 0.25 / ((NdV*(1.0-k)+k) * (NdL*(1.0-k)+k)); }

float wakeFoam(vec2 xz, out float kelvin, out float hull){
  vec2 rel = xz - uBoatXZ;
  float along = dot(rel, uBoatFwd);
  vec2 side = vec2(-uBoatFwd.y, uBoatFwd.x);
  float lat = dot(rel, side);
  float behind = -along;
  kelvin = 0.0; hull = 0.0;
  if (behind < -7.0 || behind > 600.0 || abs(lat) > 250.0) return 0.0;
  float b = max(behind - 5.5, 0.0);
  float w = 0.9 + b * 0.035;
  float turb = exp(-lat*lat / (w*w)) * exp(-b / 38.0) * smoothstep(-6.0, 5.0, behind);
  float arm = abs(abs(lat) - b * 0.34 - 1.6);
  kelvin = exp(-arm*arm / (0.5 + b * 0.03)) * exp(-b / 240.0) * smoothstep(0.0, 6.0, b) * 0.7;
  float hw = 1.85 * sqrt(max(1.0 - pow(clamp(along / 6.2, -1.0, 1.0), 2.0), 0.0));
  float hd = abs(lat) - hw;
  hull = exp(-hd*hd / 0.25) * step(-6.2, along) * step(along, 6.4) * smoothstep(-0.5, 0.3, hd + 0.3);
  hull += exp(-dot(rel - uBoatFwd * 6.3, rel - uBoatFwd * 6.3) / 1.5) * 0.8;
  return turb;
}

vec2 rainRipples(vec2 p, float t){
  vec2 acc = vec2(0.0);
  for (int l = 0; l < 2; l++){
    vec2 q = p * (l == 0 ? 2.3 : 4.1) + float(l) * 17.0;
    vec2 id = floor(q);
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++){
      vec2 cid = id + vec2(float(i), float(j));
      vec2 h = hash22(cid + float(l) * 31.0);
      float tt = fract(t * 1.1 + h.x);
      vec2 c = cid + 0.5 + (h - 0.5) * 0.7;
      vec2 d = q - c;
      float r = length(d);
      float ring = r - tt * 0.8;
      float wv = sin(ring * 30.0) * exp(-ring*ring * 70.0) * (1.0 - tt);
      acc += d / max(r, 1e-3) * wv;
    }
  }
  return acc;
}

float foamPattern(vec2 p){
  float a = fbm2(p * 0.55 + vec2(uTime * 0.03, 0.0));
  float b = vnoise(p * 3.7 - uTime * 0.08);
  float c = vnoise(p * 11.0 + uTime * 0.05);
  return a * 0.7 + b * 0.35 + c * 0.25;
}

void main(){
  gl_FragDepth = log2(vLogZ) * uLogF * 0.5;
  vec3 P = vWorld;
  vec3 toC = uCamPos - P;
  float dist = length(toC);
  vec3 V = toC / dist;
  vec4 der = vec4(0.0);
  float foam = 0.0, h = 0.0;
  for (int i = 0; i < 3; i++){
    vec3 uvw = vec3(vXZ / uCascL[i], float(i));
    der += texture(uDeriv, uvw);
    vec4 dd = texture(uDisp, uvw);
    foam += dd.w * (i == 0 ? 0.7 : (i == 1 ? 0.55 : 0.12));
    h += dd.y;
  }
  vec3 N = normalize(vec3(-der.x / max(1.0 + der.z, 0.25), 1.0, -der.y / max(1.0 + der.w, 0.25)));
  float kel, hullF;
  float wk = wakeFoam(vXZ, kel, hullF);
  if (uRain > 0.01 && dist < 45.0){
    vec2 rr = rainRipples(vXZ, uTime) * uRain * (1.0 - dist / 45.0);
    N = normalize(N + vec3(rr.x, 0.0, rr.y) * 0.3);
  }
  float windFoam = smoothstep(6.0, 22.0, uWind);
  float fp = foamPattern(vXZ);
  float ih = islandH(vXZ);
  float surf = 0.0;
  if (ih > -30.0){
    // breaking surf on the reef/beach line, pulsing with the swell
    float band = exp(-abs(ih + 1.2) * 0.35);
    surf = band * smoothstep(0.35, 0.85, fp + 0.35 * sin(uTime * 0.9 + ih * 0.8));
  }
  float cov = clamp(foam * uFoamAmt * (0.6 + windFoam) + wk * 0.9 + kel * 0.5 + hullF * 0.8 + surf, 0.0, 1.5);
  float f = 0.0;
  if (cov > 0.01 && dist < 3000.0){
    float lace = 1.0 - smoothstep(0.02, 0.2, voroEdge(vXZ * 1.1 + fp * 0.8, uTime * 0.35));
    float fine = 1.0 - smoothstep(0.0, 0.12, voroEdge(vXZ * 4.3, uTime * 0.6));
    float net = max(lace, fine * 0.6);
    // dense foam fills in, thin foam leaves only the lacy network
    f = smoothstep(0.0, 1.0, cov * 1.15 - (1.0 - net) * (1.05 - cov * 0.7));
    f = mix(f, clamp(cov, 0.0, 1.0) * 0.6, smoothstep(300.0, 3000.0, dist));
  } else {
    f = clamp(cov, 0.0, 1.0) * 0.6 * smoothstep(0.35, 1.0, fp + cov * 0.6);
  }
  f = clamp(f, 0.0, 1.0) * (1.0 - smoothstep(4000.0, 14000.0, dist));
  float aerated = smoothstep(0.0, 0.7, cov);

  if (gl_FrontFacing){
    vec3 L = uKeyDir;
    float NdV = max(dot(N, V), 1e-3);
    float rough = mix(0.11, 0.24, smoothstep(30.0, 6000.0, dist)) + uRain * 0.04;
    float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
    vec3 R = reflect(-V, N);
    R.y = abs(R.y) + 0.002;
    vec3 refl = dome(normalize(R));
    float shadow = cloudShadow(P);
    vec3 sunC = uKeyColor * shadow;
    vec3 H = normalize(L + V);
    float NdL = max(dot(N, L), 0.0), NdH = max(dot(N, H), 0.0);
    float Fs = 0.02 + 0.98 * pow(1.0 - max(dot(H, V), 0.0), 5.0);
    vec3 spec = sunC * ggxD(NdH, rough) * smithV(NdV, NdL, rough) * Fs * NdL;
    vec3 amb = ambSky();
    float wh = max(h + 0.3, 0.0);
    float k1 = 2.6 * wh * pow(max(dot(L, -V), 0.0), 4.0) * pow(0.5 - 0.5 * dot(L, N), 3.0);
    float k2 = 0.35 * NdV * NdV;
    vec3 sss = (k1 + k2) * uWaterScatter * sunC / PI + 0.1 * NdL * uWaterScatter * sunC / PI;
    sss += amb * (uWaterDeep + uWaterScatter * 0.3);
    // bubbles under whitecaps / wake scatter light back up: milky turquoise halo
    sss += (uWaterScatter * 2.5 + vec3(0.02, 0.05, 0.05)) * (amb + sunC * max(L.y, 0.0) / PI) * aerated * 0.35;
    if (ih > -40.0){
      float sh = smoothstep(-35.0, -0.5, ih);
      vec3 shallow = (uWaterScatter * 3.0 + vec3(0.03, 0.06, 0.04)) * (amb * 0.8 + sunC * max(L.y, 0.0) / PI * 0.6);
      sss = mix(sss, shallow, sh * 0.75);
    }
    if (uFloorDepth > 0.0){
      vec3 T = refract(-V, N, 1.0 / 1.333);
      float tt = (h + uFloorDepth) / max(-T.y, 0.08);
      vec3 Fp = vec3(vXZ.x, h, vXZ.y) + T * tt;
      float c = caustics(Fp.xz, uTime * 0.7);
      float sand = 0.8 + 0.2 * fbm2(Fp.xz * 0.35) + 0.08 * sin(Fp.x * 2.3 + fbm2(Fp.xz) * 6.0);
      float weed = smoothstep(0.62, 0.72, fbm2(Fp.xz * 0.05 + 3.0));
      vec3 alb = mix(uSandColor * sand, vec3(0.08, 0.12, 0.05), weed * 0.8);
      float lDown = max(L.y, 0.15);
      vec3 floorLight = sunC * lDown * (0.35 + 1.6 * c) * exp(-uWaterSigma * uFloorDepth / lDown) / PI * 0.55 + amb * exp(-uWaterSigma * uFloorDepth) * 0.6;
      vec3 Tr = exp(-uWaterSigma * tt);
      Tr *= 1.0 - smoothstep(1500.0, 5000.0, dist);
      sss = alb * floorLight * Tr + sss * (1.0 - Tr);
    }
    vec3 col = sss * (1.0 - F) + refl * F + spec;
    float thick = smoothstep(0.3, 1.0, f);
    vec3 foamCol = mix(vec3(0.72, 0.82, 0.84), vec3(0.93, 0.95, 0.96), thick) * (sunC * (0.35 + 0.65 * NdL) / PI + amb * 0.95);
    col = mix(col, foamCol, f);
    float glow = uNightGlow * uNight * (f * 0.8 + wk * 0.6 + hullF * 1.0 + kel * 0.35);
    glow *= 0.7 + 0.3 * sin(uTime * 3.0 + vXZ.x * 0.7 + vXZ.y * 0.3);
    col += vec3(0.05, 0.6, 0.95) * glow * 0.025;
    col = aerial(col, -V, dist);
    fragColor = vec4(col, dist * 0.001);
  } else {
    vec3 n = -N;
    vec3 T = refract(-V, n, 1.333);
    float camDepth = max(-uCamPos.y, 0.0);
    vec3 inner = uwFogColor(4.0);
    vec3 col;
    if (dot(T, T) < 1e-4){
      col = inner * 0.9;
    } else {
      float cosT = max(T.y, 0.0);
      float F = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
      vec3 sky = dome(T);
      sky += uSunColor * pow(max(dot(T, uSunDir), 0.0), 600.0) * 25.0 * cloudShadow(P);
      col = sky * (1.0 - F) * 0.95 + inner * F;
    }
    float c = caustics(vXZ * 0.9, uTime);
    col += uwLight() * uWaterScatter * c * 0.6;
    col = mix(col, uwLight() * 0.35, clamp(f * 0.8, 0.0, 1.0));
    col = applyUW(col, dist, camDepth * 0.5);
    fragColor = vec4(col, dist * 0.001);
  }
}`;

  class Ocean {
    constructor(gl) {
      this.gl = gl;
      this.pEvolve = new OW.Program(gl, OW.GLSL.FSQ_VS, EVOLVE_FS, 'evolve');
      this.pFFT = new OW.Program(gl, OW.GLSL.FSQ_VS, FFT_FS, 'fft');
      this.pMerge = new OW.Program(gl, OW.GLSL.FSQ_VS, MERGE_FS, 'merge');
      this.pQuery = new OW.Program(gl, OW.GLSL.FSQ_VS, QUERY_FS, 'query');
      this.pWater = new OW.Program(gl, WATER_VS, WATER_FS, 'water');
      this.cascL = new Float32Array(CASCADES);
      this.params = null;
      this.cur = 0;
      this.N = 0;
      this.segs = 0;
      this.heights = [0, 0, 0, 0];
      this.queryPts = new Float32Array(8);
      this.pending = null;
      // Query target
      this.qTex = OW.tex2D(gl, { w: 4, h: 1, internal: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT, filter: 'nearest' });
      this.qFbo = OW.fbo(gl, [this.qTex]);
      this.pbo = gl.createBuffer();
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, 64, gl.STREAM_READ);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      this.qResult = new Float32Array(16);
    }

    setQuality(N, segs) {
      const gl = this.gl;
      if (N !== this.N) {
        this.N = N;
        const f32 = { w: N, h: N, internal: gl.RGBA32F, format: gl.RGBA, type: gl.FLOAT, filter: 'nearest' };
        if (this.scratch) this.scratch.forEach((t) => gl.deleteTexture(t));
        this.scratch = [0, 1, 2, 3].map(() => OW.tex2D(gl, f32));
        this.fboPing = OW.fbo(gl, [this.scratch[0], this.scratch[1]]);
        this.fboPong = OW.fbo(gl, [this.scratch[2], this.scratch[3]]);
        if (this.h0) this.h0.forEach((t) => gl.deleteTexture(t));
        this.h0 = CASCADES.map(() => OW.tex2D(gl, f32));
        if (this.disp) this.disp.forEach((t) => gl.deleteTexture(t));
        if (this.deriv) gl.deleteTexture(this.deriv);
        this.disp = [0, 1].map(() => OW.texArray(gl, N, N, 3, gl.RGBA16F, true));
        this.deriv = OW.texArray(gl, N, N, 3, gl.RGBA16F, true);
        this.mergeFbo = [0, 1].map((c) => [0, 1, 2].map((l) => OW.fbo(gl, [{ tex: this.disp[c], layer: l }, { tex: this.deriv, layer: l }])));
        for (const c of [0, 1]) for (const l of [0, 1, 2]) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, this.mergeFbo[c][l]);
          gl.clearColor(0, 0, 0, 0);
          gl.clear(gl.COLOR_BUFFER_BIT);
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        if (this.params) this.regen(this.params);
      }
      if (segs !== this.segs) {
        this.segs = segs;
        this.buildMesh(segs);
      }
    }

    buildMesh(segs) {
      const q = (2 * Math.PI) / segs;
      this.spacingQ = q;
      this.spacingMin = 0.05;
      const rings = [0];
      let r = 0;
      while (r < 32000) { r += Math.max(this.spacingMin, r * q); rings.push(r); }
      rings.push(60000, 120000);
      const nv = rings.length * segs;
      const pos = new Float32Array(nv * 2);
      for (let j = 0; j < rings.length; j++) for (let i = 0; i < segs; i++) {
        const a = i * q + (j % 2) * q * 0.5;
        pos[(j * segs + i) * 2] = Math.cos(a) * rings[j];
        pos[(j * segs + i) * 2 + 1] = Math.sin(a) * rings[j];
      }
      const idx = new Uint32Array((rings.length - 1) * segs * 6);
      let k = 0;
      for (let j = 0; j < rings.length - 1; j++) for (let i = 0; i < segs; i++) {
        const a = j * segs + i, b = j * segs + ((i + 1) % segs);
        const c = (j + 1) * segs + i, d = (j + 1) * segs + ((i + 1) % segs);
        // Winding: counter-clockwise when seen from +Y.
        idx[k++] = a; idx[k++] = c; idx[k++] = b;
        idx[k++] = b; idx[k++] = c; idx[k++] = d;
      }
      // Check orientation of first real quad and flip if needed.
      const j0 = 2 * segs;
      const A = [pos[j0 * 2], 0, pos[j0 * 2 + 1]], C = [pos[(j0 + segs) * 2], 0, pos[(j0 + segs) * 2 + 1]], B = [pos[(j0 + 1) * 2], 0, pos[(j0 + 1) * 2 + 1]];
      const cr = OW.v3.cross(OW.v3.sub(C, A), OW.v3.sub(B, A));
      if (cr[1] < 0) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
      if (this.mesh) this.mesh.dispose();
      this.mesh = OW.mesh(this.gl, [{ loc: 0, size: 2, data: pos }], idx);
    }

    regen(P) {
      this.params = { ...P };
      const gl = this.gl, N = this.N;
      for (let c = 0; c < 3; c++) {
        const data = genSpectrum(N, CASCADES[c], CUTS[c], CUTS[c + 1], P, 1234 + c * 7919, c === 0);
        gl.bindTexture(gl.TEXTURE_2D, this.h0[c]);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, N, N, gl.RGBA, gl.FLOAT, data);
      }
    }

    update(t, dt, P) {
      const gl = this.gl, N = this.N;
      const key = `${P.wind}|${P.swell}|${P.direction}|${P.waveHeight}|${N}`;
      if (key !== this.key) { this.key = key; this.regen(P); }
      this.lambda = P.choppiness;
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
      gl.viewport(0, 0, N, N);
      const prev = this.cur, next = 1 - this.cur;
      const stages = Math.log2(N);
      for (let c = 0; c < 3; c++) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboPing);
        this.pEvolve.use().tex('uH0', this.h0[c]).set('uL', CASCADES[c]).set('uN', N).set('uT', t);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        let src = 0;
        this.pFFT.use().set('uN', N);
        for (let pass = 0; pass < 2; pass++) {
          this.pFFT.set('uHoriz', pass === 0 ? 1 : 0);
          for (let s = 0; s < stages; s++) {
            gl.bindFramebuffer(gl.FRAMEBUFFER, src === 0 ? this.fboPong : this.fboPing);
            this.pFFT.tex('uIn0', this.scratch[src * 2]).tex('uIn1', this.scratch[src * 2 + 1]).set('uS', 2 << s);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            src = 1 - src;
          }
        }
        gl.bindFramebuffer(gl.FRAMEBUFFER, this.mergeFbo[next][c]);
        this.pMerge.use().tex('uA', this.scratch[src * 2]).tex('uB', this.scratch[src * 2 + 1]).tex('uPrev', this.disp[prev])
          .setAll({ uLayer: c, uLambda: P.choppiness, uDt: Math.min(dt, 0.1), uDecay: 0.6, uBias: 0.56 + 0.12 * (Math.min(P.foam, 2) - 1), uGain: 1.8 });
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      this.cur = next;
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.disp[next]);
      gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.deriv);
      gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    get dispTex() { return this.disp[this.cur]; }

    // Async GPU -> CPU readback of water heights at up to 4 xz points.
    query(points) {
      const gl = this.gl;
      if (this.pending) {
        const st = gl.clientWaitSync(this.pending.sync, 0, 0);
        if (st === gl.TIMEOUT_EXPIRED) return this.heights;
        gl.deleteSync(this.pending.sync);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
        gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.qResult);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        for (let i = 0; i < 4; i++) this.heights[i] = this.qResult[i * 4];
        this.pending = null;
      }
      for (let i = 0; i < 4; i++) { this.queryPts[i * 2] = points[i] ? points[i][0] : 0; this.queryPts[i * 2 + 1] = points[i] ? points[i][1] : 0; }
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.qFbo);
      gl.viewport(0, 0, 4, 1);
      this.pQuery.use().tex('uDisp', this.dispTex).set('uCascL', this.cascL).set('uQ', this.queryPts);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
      gl.readPixels(0, 0, 4, 1, gl.RGBA, gl.FLOAT, 0);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.pending = { sync: gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) };
      gl.flush();
      return this.heights;
    }

    bindDisp(prog) {
      prog.tex('uDisp', this.dispTex).tex('uDeriv', this.deriv).set('uCascL', this.cascL).set('uNfft', this.N);
    }

    draw(common, extra) {
      const gl = this.gl, p = this.pWater.use();
      common(p);
      this.bindDisp(p);
      p.setAll(extra.uniforms);
      for (const k in extra.textures) p.tex(k, extra.textures[k]);
      p.set('uCenter', extra.center).set('uSpacingQ', this.spacingQ).set('uSpacingMin', this.spacingMin);
      gl.disable(gl.CULL_FACE);
      this.mesh.draw();
    }
  }
  OW.Ocean = Ocean;
  OW.CASCADES = CASCADES;
})();
