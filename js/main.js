'use strict';
// Main: wiring, per-frame state, render graph.
(function () {
  const $ = (id) => document.getElementById(id);
  const canvas = $('c');
  let failed = false;
  function fail(e) {
    if (failed) return;
    failed = true;
    const d = document.createElement('div');
    d.className = 'err';
    d.textContent = '开放水域无法启动。\n\n' + ((e && e.message) || e);
    document.body.appendChild(d);
    console.error(e);
  }

  let gl;
  try { gl = OW.createGL(canvas); } catch (e) { fail(e); return; }

  const S = OW.defaultState();
  const PR = OW.PRESETS;
  // URL overrides, e.g. ?time=noon&weather=storm&sea=rough&shot=3&camera=free
  const qp = new URLSearchParams(location.search);
  for (const [k, v] of qp) {
    if (PR[k] && PR[k][v]) {
      S[k] = v;
      const o = { ...PR[k][v] }; delete o.label;
      if (k === 'sea' || k === 'time' || k === 'weather') Object.assign(S, o);
      if (k === 'depth') { S.clarity = o.clarity; S.nightGlow = o.nightGlow; }
    } else if (k in S && k !== 'camera') {
      S[k] = v === 'true' ? true : v === 'false' ? false : isNaN(+v) ? v : +v;
    } else if (k === 'camera') S.camera = v;
  }

  let ocean, sky, objs, post;
  try {
    ocean = new OW.Ocean(gl);
    sky = new OW.Sky(gl);
    objs = new OW.Objects(gl);
    post = new OW.Post(gl);
  } catch (e) { fail(e); return; }
  const cam = new OW.CameraRig(canvas);
  const audio = new OW.Soundscape();
  if (qp.has('shot')) { cam.shot = +qp.get('shot') % OW.CameraRig.SHOTS.length; cam.shotT = +(qp.get('shotT') || 0); }
  if (qp.has('hold')) cam.hold = true;
  cam.setMode(S.camera);

  const ui = new OW.UI(document.body, S, {
    change(key) {
      if (key === 'camera') cam.setMode(S.camera);
      if (key === 'sound') S.sound ? audio.enable() : audio.disable();
      updateHelp();
    },
    nextShot() { if (S.camera !== 'tour') { S.camera = 'tour'; cam.setMode('tour'); ui.refresh(); } cam.nextShot(); },
  });

  const closeBtn = $('close');
  const togglePanel = () => {
    const hid = ui.panel.classList.toggle('hidden');
    closeBtn.textContent = hid ? '控制面板' : '关闭';
  };
  closeBtn.addEventListener('click', togglePanel);
  window.addEventListener('keydown', (e) => { if (e.code === 'KeyH' && e.target.tagName !== 'INPUT') togglePanel(); });
  if (qp.get('panel') === '0') togglePanel();
  function updateHelp() {
    $('help').textContent = S.camera === 'free' ? '拖动转视角 · WASD 移动 · E / Q 上升 / 下降 · Shift 加速 · 滚轮调速 · H 隐藏面板' : '';
  }
  updateHelp();

  // ------------------------------------------------------------------ state
  let T = +(qp.get('t') || 0), last = performance.now();
  let fpsAcc = 0, fpsN = 0, fpsT = 0;
  const cloudOff = [0, 0];
  let expSmooth = 0;
  let heights = [0, 0, 0, 0];
  let flash = 0, lightningT = qp.has('hold') ? 1e9 : 9 + Math.random() * 6, pulses = [];
  const U = {};
  const LOGF = 2 / Math.log2(200000 + 1);
  const BOAT_YAW = 160;

  function autoExposure(sunH, cover, storm, rain) {
    const tbl = [[-30, 9], [-14, 8], [-8, 5], [-4, 3.4], [-1, 2.5], [1, 1.9], [3, 1.5], [6, 1.2], [15, 0.95], [30, 0.8], [60, 0.68], [90, 0.66]];
    let e = tbl[tbl.length - 1][1];
    for (let i = 0; i < tbl.length - 1; i++) {
      if (sunH <= tbl[i + 1][0]) {
        const t = (sunH - tbl[i][0]) / (tbl[i + 1][0] - tbl[i][0]);
        e = Math.exp(OW.lerp(Math.log(tbl[i][1]), Math.log(tbl[i + 1][1]), OW.clamp(t, 0, 1)));
        break;
      }
    }
    return e * (1 + cover * 0.25);
  }

  function common(p, opt) {
    p.setAll(U);
    p.tex('uSkyLUT', sky.lut).tex('uNoise', sky.noise).tex('uDome', sky.dome);
    if (!opt || !opt.noAmb) p.tex('uAmbTex', sky.amb);
    return p;
  }

  function sizes() {
    const q = PR.quality[S.quality];
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(64, Math.round(canvas.clientWidth * dpr * q.scale));
    const h = Math.max(64, Math.round(canvas.clientHeight * dpr * q.scale));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    post.resize(w, h, q.msaa);
    sky.resize(q.dome, Math.max(8, Math.round(w * q.cloudRes)), Math.max(8, Math.round(h * q.cloudRes)));
    ocean.setQuality(q.N, q.segs);
    return q;
  }

  function frame(now) {
    if (failed) return;
    requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    T += dt;
    try { step(dt); } catch (e) { fail(e); }
    fpsAcc += dt; fpsN++;
    if (now - fpsT > 500) {
      fpsT = now;
      $('stat').textContent = `${Math.round(fpsN / fpsAcc)} fps · ${canvas.width}×${canvas.height}`;
      fpsAcc = 0; fpsN = 0;
    }
  }

  function step(dt) {
    const q = sizes();
    const W = PR.water[S.water], Dp = PR.depth[S.depth];
    const cover = S.cloudCover / 100;
    const storm = OW.smooth(0.82, 0.96, cover) * OW.smooth(8, 22, S.cloudWind);
    const rain = S.rain * OW.smooth(0.55, 0.85, cover);
    const sunDir = OW.dirFromBearing(S.sunBearing, S.sunHeight);
    const haze = 0.8 + cover * 0.7 + rain * 3 + storm * 2;
    const sunT = OW.Sky.sunTransmittance(S.sunHeight, haze);
    const sunL = 0.2126 * sunT[0] + 0.7152 * sunT[1] + 0.0722 * sunT[2];
    const sunColor = sunT.map((x) => OW.lerp(x, sunL, 0.4) * 20);
    const night = OW.smooth(-1.5, -10, S.sunHeight);
    const moonDir = OW.dirFromBearing(S.sunBearing + 175, 34);
    const moonColor = [0.05, 0.065, 0.1].map((x) => x * night * (1 - cover * 0.6));
    const useSun = S.sunHeight > -2.5;
    const cloudBottom = OW.lerp(1500, 800, storm);
    const cloudTop = cloudBottom + OW.lerp(1600, 4200, Math.max(storm, Math.pow(cover, 3) * 0.5));
    const windDir = OW.dirFromBearing(S.direction, 0);
    cloudOff[0] -= windDir[0] * S.cloudWind * dt;
    cloudOff[1] -= windDir[2] * S.cloudWind * dt;

    // lightning
    if (storm > 0.4 && rain > 0.4) {
      lightningT -= dt;
      if (lightningT <= 0) {
        lightningT = 6 + Math.random() * 12;
        const n = 1 + Math.floor(Math.random() * 3);
        for (let i = 0; i < n; i++) pulses.push({ t: T + i * (0.08 + Math.random() * 0.15), a: 0.5 + Math.random() * 0.5 });
        audio.thunder(0.8 + Math.random() * 3, 0.5 + Math.random() * 0.5);
      }
    }
    flash = 0;
    pulses = pulses.filter((p) => T - p.t < 1.5);
    for (const p of pulses) if (T >= p.t) flash += p.a * Math.exp(-(T - p.t) * 16);

    // boat, fish, birds
    const bf = OW.dirFromBearing(BOAT_YAW, 0), br = OW.dirFromBearing(BOAT_YAW + 90, 0);
    const boatDist = 2.3 * T;
    const boatP = [bf[0] * boatDist, 0, bf[2] * boatDist];
    // In shallow water keep the school (and the dive camera) above the sand.
    const maxDepth = Dp.floor > 0 ? Dp.floor : 1e9;
    const school = OW.v3.add(boatP, OW.v3.add(OW.v3.scale(br, -14), OW.v3.add(OW.v3.scale(bf, -22), [0, -Math.min(11, maxDepth * 0.5), 0])));
    const birdCenter = boatP;

    // camera
    cam.update(dt, {
      sunB: S.sunBearing, boat: { p: boatP, fwd: bf, right: br }, waterAtCam: heights[0], school, maxDepth,
      bird: (i) => objs.birdPos(i, T, birdCenter), island: objs.islandPos,
    }, S.fov);
    const aspect = canvas.width / canvas.height;
    const fwd = cam.fwd;
    const right = OW.v3.norm(OW.v3.cross(fwd, [0, 1, 0]));
    const up = OW.v3.cross(right, fwd);
    const fovR = cam.fov * OW.deg;
    const view = OW.m4.lookDir(cam.pos, fwd, up);
    const proj = OW.m4.perspective(fovR, aspect, 0.05, 200000);
    const vp = OW.m4.mul(proj, view);

    heights = ocean.query([[cam.pos[0], cam.pos[2]], [boatP[0], boatP[2]]]);
    const under = cam.pos[1] < heights[0] - 0.02;

    const clar = S.clarity / 100;
    const sig = W.sigma.map((s) => s * OW.lerp(3.0, 0.4, clar));
    let expTarget = autoExposure(S.sunHeight, cover, storm, rain);
    if (under) {
      const lumK = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      const kc = useSun ? sunColor : moonColor;
      const uwLum = lumK(kc) * Math.max(useSun ? sunDir[1] : moonDir[1], 0) * 0.3 * (1 - 0.85 * storm) + 0.1 + lumK(kc) * 0.02 + 0.002;
      expTarget = OW.clamp(1.2 * Math.pow(0.43 / uwLum, 0.85), 0.12, 12);
    }
    expSmooth = expSmooth ? expSmooth + (expTarget - expSmooth) * Math.min(1, dt * 4) : expTarget;
    const exposure = expSmooth * Math.pow(2, S.exposure);

    Object.assign(U, {
      uTime: T, uCamPos: cam.pos, uViewProj: vp, uCamFwd: fwd, uCamRight: right, uCamUp: up,
      uTanFov: [Math.tan(fovR / 2) * aspect, Math.tan(fovR / 2)],
      uSunDir: sunDir, uSunColor: sunColor, uMoonDir: moonDir, uMoonColor: moonColor,
      uKeyDir: useSun ? sunDir : moonDir, uKeyColor: (useSun ? sunColor : moonColor).map((x) => x * (1 - 0.85 * storm)),
      uNight: night, uCloudCover: cover, uFogDensity: 1 / 38000 + cover / 90000 + rain / 2600 + storm / 3200,
      uUnder: under ? 1 : 0, uCamWaterH: heights[0], uFlash: flash, uRain: rain, uStorm: storm, uLogF: LOGF,
      uWaterDeep: W.deep, uWaterScatter: W.scatter, uWaterSigma: sig, uWaterUW: W.uw,
      uCloudBottom: cloudBottom, uCloudTop: cloudTop, uCloudDensity: OW.lerp(0.9, 1.7, storm), uCloudOffset: cloudOff,
      uFoamAmt: S.foam, uNightGlow: S.nightGlow, uFloorDepth: Dp.floor, uWind: S.wind, uSandColor: W.sand,
      uBoatXZ: [boatP[0], boatP[2]], uBoatFwd: [bf[0], bf[2]],
    });

    sky.tanHalf = Math.tan(fovR / 2);
    // simulate
    ocean.update(T, dt, S);
    const nightSky = [0.0011, 0.002, 0.0042].map((x) => x * (0.25 + night) * (1 - cover * 0.5));
    sky.updateLUT(sunDir, haze, nightSky);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.depthMask(true);
    sky.updateAmbient(common);
    sky.renderDome(common, q.domeSteps);
    if (!under) sky.renderClouds(common, q.cloudSteps, q.lSteps, { fwd, right, up, tan: U.uTanFov, pos: cam.pos });

    // scene
    post.begin();
    gl.disable(gl.DEPTH_TEST); gl.depthMask(false);
    sky.drawSky(common);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
    const st = {
      boatXZ: [boatP[0], boatP[2]], boatYaw: BOAT_YAW * OW.deg, boatHeel: -0.13,
      birds: S.sunHeight > -3 && rain < 0.5, birdCenter, under, school, cam: cam.pos,
      floorDepth: Dp.floor, sandColor: W.sand, rain, rainVel: [windDir[0] * S.wind * 0.35, -9, windDir[2] * S.wind * 0.35],
      particleScale: q.particles,
    };
    objs.drawOpaque(common, st, ocean);
    ocean.draw(common, { uniforms: { uIslandRect: objs.islandRect }, textures: { uDome: sky.dome, uIsland: objs.islandTex }, center: [cam.pos[0], cam.pos[2]] });
    objs.drawTransparent(common, st);
    gl.disable(gl.DEPTH_TEST);
    post.resolve();
    if (under) post.renderRays(common);
    post.renderBloom(exposure);
    post.composite(common, canvas.width, canvas.height, { exposure, glow: S.glow, fade: cam.fade, rays: under });

    // HUD & audio
    const seaL = S.sea ? PR.sea[S.sea].label : '自定义';
    const wL = S.weather ? PR.weather[S.weather].label : '自定义';
    const parts = [];
    const SHOT_ZH = { Horizon: '海平线', Sail: '帆船', Skim: '贴浪', Dive: '潜水', Aerial: '航拍', Gulls: '海鸥', Sky: '云天', Coast: '海岸', Detail: '船舷' };
    if (S.camera === 'tour') parts.push(SHOT_ZH[cam.label === 'Dive' || under ? 'Dive' : cam.label] || cam.label);
    parts.push(seaL, wL, `太阳 ${Math.round(S.sunHeight)}°`);
    $('sub').textContent = parts.join(' · ');
    audio.update(dt, { wind: S.wind, rain, under, birds: st.birds, time: T, camHeight: cam.pos[1] - heights[0] });
  }

  window.OWApp = { S, cam, ui, gl, sky, ocean, post, objs, U, get T() { return T; }, set T(v) { T = v; } };

  // Let the loading overlay paint, then build the noise volume and start.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    try { sky.genNoise(); } catch (e) { fail(e); return; }
    last = performance.now();
    requestAnimationFrame((t) => {
      frame(t);
      setTimeout(() => $('loading').classList.add('gone'), 150);
    });
  }));
})();
