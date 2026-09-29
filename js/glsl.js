'use strict';
// Shared GLSL chunks.
OW.GLSL = {};

OW.GLSL.FSQ_VS = `
out vec2 vUV;
void main(){
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUV = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

OW.GLSL.COMMON = `
#define PI 3.14159265359
const float Rg = 6360e3;
uniform float uTime;
uniform vec3 uCamPos;
uniform mat4 uViewProj;
uniform vec3 uCamFwd, uCamRight, uCamUp;
uniform vec2 uTanFov;
uniform vec3 uSunDir, uSunColor, uMoonDir, uMoonColor, uKeyDir, uKeyColor;
uniform float uNight, uCloudCover, uFogDensity, uUnder, uCamWaterH, uFlash, uRain, uStorm, uLogF;
uniform vec3 uWaterDeep, uWaterScatter, uWaterSigma, uWaterUW;
uniform float uCloudBottom, uCloudTop, uCloudDensity;
uniform vec2 uCloudOffset;
uniform sampler2D uSkyLUT;
uniform sampler2D uAmbTex;
uniform sampler3D uNoise;

float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3){ p3 = fract(p3 * .1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
vec3 hash33(vec3 p3){ p3 = fract(p3 * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yxx) * p3.zyx); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), u.x), mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), u.x), u.y); }
float fbm2(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a * vnoise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; } return s; }
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float remap(float v, float a, float b, float c, float d){ return c + (v - a) / (b - a) * (d - c); }
float hg(float mu, float g){ float g2 = g*g; return (1.0 - g2) / (4.0*PI*pow(max(1.0 + g2 - 2.0*g*mu, 1e-4), 1.5)); }

vec3 viewRay(vec2 uv){
  vec2 n = uv * 2.0 - 1.0;
  return normalize(uCamFwd + n.x * uTanFov.x * uCamRight + n.y * uTanFov.y * uCamUp);
}

vec2 skyUV(vec3 d){
  float az = atan(d.z, d.x);
  float el = asin(clamp(d.y, -1.0, 1.0));
  return vec2(az / (2.0*PI) + 0.5, 0.5 + 0.5 * sign(el) * sqrt(abs(el) / (0.5*PI)));
}
// Never sample the below-horizon rows: the ocean always covers them and they are darker.
vec3 skyL(vec3 d){ d.y = max(d.y, 0.0025); return texture(uSkyLUT, skyUV(normalize(d))).rgb; }
vec3 ambSky(){ return texelFetch(uAmbTex, ivec2(0, 0), 0).rgb; }
vec3 ambHorizon(){ return texelFetch(uAmbTex, ivec2(1, 0), 0).rgb; }
vec3 fogColor(vec3 d){
  vec3 h = skyL(normalize(vec3(d.x, 0.03, d.z)));
  return mix(h, ambHorizon(), smoothstep(0.35, 0.88, uCloudCover));
}
vec3 aerial(vec3 col, vec3 d, float dist){
  float T = exp(-dist * uFogDensity);
  return col * T + fogColor(d) * (1.0 - T);
}

// Underwater participating medium.
vec3 uwLight(){ return ambSky() * 0.6 + uKeyColor * max(uKeyDir.y, 0.0) * 0.3 + vec3(0.02, 0.05, 0.08) * uNight * 0.02; }
vec3 uwFogColor(float depth){
  return uWaterUW * luma(uwLight()) * 1.6 * exp(-uWaterSigma * max(depth, 0.0) * 0.45);
}
vec3 applyUW(vec3 col, float dist, float depth){
  vec3 T = exp(-uWaterSigma * dist);
  return col * T + uwFogColor(depth) * (1.0 - T);
}

// Tileable animated caustic pattern (period 8 m).
float caustics(vec2 p, float t){
  vec2 q = mod(p * (6.28318 / 8.0), 6.28318) - 250.0;
  vec2 i = q;
  float c = 1.0, inten = 0.005;
  for (int n = 0; n < 4; n++){
    float tt = t * (1.0 - (3.5 / float(n + 1)));
    i = q + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0 / length(vec2(q.x / (sin(i.x + tt) / inten), q.y / (cos(i.y + tt) / inten)));
  }
  c /= 4.0;
  c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 8.0);
}

// Clouds ---------------------------------------------------------------
// Noise stats (measured): perlin-worley R median .77 (5%..95% = .58...91); worley fBm GBA median .71.
float weatherMap(vec2 xz){
  vec2 p = (xz + uCloudOffset) * 0.000028;
  float w = textureLod(uNoise, vec3(p, 0.37), 0.0).r * 0.65 + textureLod(uNoise, vec3(p * 3.1, 0.71), 0.0).g * 0.35;
  return clamp((w - 0.6) / 0.28, 0.0, 1.0);
}
float cloudDensity(vec3 p, float hf, bool detail, float fp){
  if (hf < 0.0 || hf > 1.0) return 0.0;
  float wm = weatherMap(p.xz);
  vec3 q = (p + vec3(uCloudOffset.x, 0.0, uCloudOffset.y)) * 0.00016;
  vec4 n = textureLod(uNoise, q, log2(max(fp / 48.8, 1.0)));
  float wf = n.g * 0.625 + n.b * 0.25 + n.a * 0.125;
  float base = clamp((n.r - 0.58) / 0.34, 0.0, 1.0);
  base = clamp(remap(base, (1.0 - wf) * 0.5, 1.0, 0.0, 1.0), 0.0, 1.0);
  float topH = mix(0.5, 1.0, wm);
  float grad = smoothstep(0.0, 0.1, hf) * smoothstep(topH, topH * 0.5, hf);
  base *= grad;
  float cov = clamp(uCloudCover * (0.3 + 1.3 * wm), 0.0, 1.0);
  base = clamp(remap(base, 1.0 - cov, 1.0, 0.0, 1.0), 0.0, 1.0);
  if (base <= 0.0) return 0.0;
  if (detail){
    vec4 d = textureLod(uNoise, q * 5.3 + vec3(0.0, uTime * 0.004, 0.0), log2(max(fp / 9.2, 1.0)));
    float df = d.g * 0.625 + d.b * 0.25 + d.a * 0.125;
    df = mix(df, 1.0 - df, clamp(hf * 4.0, 0.0, 1.0));
    base = remap(base, df * 0.22, 1.0, 0.0, 1.0);
  }
  return max(base, 0.0) * uCloudDensity * (0.6 + 0.4 * cov);
}
float cloudShadow(vec3 p){
  if (uCloudCover < 0.01) return 1.0;
  float h = mix(uCloudBottom, uCloudTop, 0.3);
  vec3 q = p + uKeyDir * ((h - p.y) / max(uKeyDir.y, 0.06));
  float d = cloudDensity(q, 0.3, false, 120.0);
  return exp(-d * 10.0);
}
`;

OW.GLSL.LOGDEPTH_VS = `out float vLogZ;`;
OW.GLSL.LOGDEPTH_FS = `in float vLogZ;`;
