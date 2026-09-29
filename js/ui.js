'use strict';
// Control panel + presets.
(function () {
  const P = (OW.PRESETS = {
    sea: {
      glassy: { label: '镜面', wind: 2.0, swell: 0.3, choppiness: 0.6, waveHeight: 1.0, foam: 0.4 },
      calm: { label: '平静', wind: 5.0, swell: 0.5, choppiness: 0.9, waveHeight: 1.0, foam: 0.6 },
      breeze: { label: '微风', wind: 8.0, swell: 0.6, choppiness: 1.05, waveHeight: 1.0, foam: 0.8 },
      fresh: { label: '清劲', wind: 11.5, swell: 0.8, choppiness: 1.2, waveHeight: 1.0, foam: 1.0 },
      rough: { label: '汹涌', wind: 16.0, swell: 1.4, choppiness: 1.35, waveHeight: 1.0, foam: 1.2 },
      storm: { label: '风暴', wind: 23.0, swell: 2.6, choppiness: 1.5, waveHeight: 1.0, foam: 1.5 },
    },
    time: {
      sunrise: { label: '日出', sunHeight: 1.5, sunBearing: 84 },
      morning: { label: '上午', sunHeight: 18, sunBearing: 105 },
      noon: { label: '正午', sunHeight: 58, sunBearing: 165 },
      golden: { label: '黄金时刻', sunHeight: 6, sunBearing: 73 },
      sunset: { label: '日落', sunHeight: 0.8, sunBearing: 70 },
      dusk: { label: '黄昏', sunHeight: -5, sunBearing: 67 },
      night: { label: '夜晚', sunHeight: -22, sunBearing: 60 },
    },
    weather: {
      clear: { label: '晴朗', cloudCover: 6, cloudWind: 6, rain: 0 },
      fair: { label: '少云', cloudCover: 42, cloudWind: 9, rain: 0 },
      cloudy: { label: '多云', cloudCover: 66, cloudWind: 9, rain: 0 },
      overcast: { label: '阴天', cloudCover: 88, cloudWind: 12, rain: 0 },
      rain: { label: '下雨', cloudCover: 92, cloudWind: 16, rain: 0.65 },
      storm: { label: '暴风雨', cloudCover: 95, cloudWind: 29, rain: 1.0 },
    },
    water: {
      open: { label: '远洋', uw: [0.008, 0.11, 0.26], deep: [0.0022, 0.0085, 0.02], scatter: [0.006, 0.055, 0.1], sigma: [0.42, 0.075, 0.045], sand: [0.7, 0.64, 0.5] },
      tropical: { label: '热带', uw: [0.015, 0.21, 0.26], deep: [0.0015, 0.016, 0.028], scatter: [0.012, 0.19, 0.2], sigma: [0.4, 0.05, 0.038], sand: [0.86, 0.8, 0.66] },
      coastal: { label: '近岸绿', uw: [0.03, 0.15, 0.1], deep: [0.005, 0.016, 0.012], scatter: [0.03, 0.11, 0.065], sigma: [0.36, 0.1, 0.15], sand: [0.52, 0.48, 0.36] },
      arctic: { label: '极地', uw: [0.02, 0.1, 0.13], deep: [0.005, 0.012, 0.016], scatter: [0.025, 0.075, 0.085], sigma: [0.3, 0.08, 0.07], sand: [0.42, 0.42, 0.4] },
    },
    depth: {
      deep: { label: '深海', floor: 0, clarity: 69, nightGlow: 1.0 },
      lagoon: { label: '泻湖', floor: 7, clarity: 94, nightGlow: 1.5 },
      shallows: { label: '浅滩', floor: 2.6, clarity: 88, nightGlow: 1.2 },
    },
    quality: {
      low: { label: '低', scale: 0.55, N: 64, segs: 240, msaa: 0, cloudSteps: 30, lSteps: 4, cloudRes: 0.34, dome: 256, domeSteps: 16, particles: 0.45 },
      medium: { label: '中', scale: 0.78, N: 128, segs: 360, msaa: 2, cloudSteps: 46, lSteps: 5, cloudRes: 0.42, dome: 384, domeSteps: 22, particles: 0.7 },
      high: { label: '高', scale: 1.0, N: 256, segs: 512, msaa: 4, cloudSteps: 64, lSteps: 6, cloudRes: 0.5, dome: 512, domeSteps: 30, particles: 1 },
    },
  });

  OW.defaultState = () => ({
    camera: 'tour',
    sea: 'fresh', wind: 11.5, swell: 0.8, direction: 29, choppiness: 1.2, waveHeight: 1.0, foam: 1.0,
    time: 'golden', sunHeight: 6, sunBearing: 73,
    weather: 'fair', cloudCover: 42, cloudWind: 9, rain: 0,
    water: 'open', depth: 'deep', nightGlow: 1.0, clarity: 69,
    sound: false, quality: 'high', exposure: 0, glow: 0.09, fov: 60,
  });

  const fmt = {
    ms: (v) => `${v.toFixed(1)}<br>m/s`, m: (v) => `${v.toFixed(1)} m`, deg: (v) => `${Math.round(v)}°`,
    f2: (v) => v.toFixed(2), x: (v) => `×${v.toFixed(2)}`, pct: (v) => `${Math.round(v)}%`,
    msi: (v) => (v >= 10 ? `${Math.round(v)}<br>m/s` : `${Math.round(v)} m/s`), f1: (v) => v.toFixed(1),
    ev: (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}`,
  };

  class UI {
    constructor(root, state, cb) {
      this.S = state; this.cb = cb; this.controls = [];
      const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
      this.el = el;
      const panel = (this.panel = el('div', 'panel'));
      root.appendChild(panel);
      const section = (title) => { const s = el('div', 'sec'); s.appendChild(el('div', 'sec-t', title)); panel.appendChild(s); return s; };
      const pills = (parent, items, isActive, onClick) => {
        const row = el('div', 'pills');
        for (const it of items) {
          const b = el('button', 'pill', it.label);
          b.addEventListener('click', () => { onClick(it.id); this.refresh(); });
          row.appendChild(b);
          this.controls.push(() => b.classList.toggle('on', isActive(it.id)));
        }
        parent.appendChild(row);
      };
      const slider = (parent, label, key, min, max, step, f, group) => {
        const row = el('div', 'sl');
        row.appendChild(el('label', null, label));
        const inp = el('input');
        inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step;
        const val = el('span', 'v');
        inp.addEventListener('input', () => {
          this.S[key] = parseFloat(inp.value);
          if (group) this.S[group] = null;
          this.cb.change(key);
          this.refresh();
        });
        row.appendChild(inp); row.appendChild(val);
        parent.appendChild(row);
        this.controls.push(() => { if (document.activeElement !== inp) inp.value = this.S[key]; val.innerHTML = f(this.S[key]); });
      };
      const opts = (obj) => Object.keys(obj).map((id) => ({ id, label: obj[id].label }));

      let s = section('镜头');
      pills(s, [{ id: 'tour', label: '巡游' }, { id: 'free', label: '自由飞行' }], (id) => this.S.camera === id, (id) => { this.S.camera = id; this.cb.change('camera'); });
      const ns = el('div', 'pills');
      const nb = el('button', 'pill', '下一镜头');
      nb.addEventListener('click', () => this.cb.nextShot());
      ns.appendChild(nb); s.appendChild(ns);

      s = section('海况');
      pills(s, opts(P.sea), (id) => this.S.sea === id, (id) => { this.S.sea = id; Object.assign(this.S, strip(P.sea[id])); this.cb.change('sea'); });
      slider(s, '风速', 'wind', 0, 30, 0.1, fmt.ms, 'sea');
      slider(s, '涌浪', 'swell', 0, 4, 0.1, fmt.m, 'sea');
      slider(s, '风向', 'direction', 0, 360, 1, fmt.deg);
      slider(s, '浪尖锐度', 'choppiness', 0, 2.5, 0.01, fmt.f2, 'sea');
      slider(s, '浪高', 'waveHeight', 0.2, 2.5, 0.01, fmt.x);
      slider(s, '白沫', 'foam', 0, 2, 0.01, fmt.f2);

      s = section('天空');
      pills(s, opts(P.time), (id) => this.S.time === id, (id) => { this.S.time = id; Object.assign(this.S, strip(P.time[id])); this.cb.change('time'); });
      slider(s, '太阳高度', 'sunHeight', -30, 90, 0.5, fmt.deg, 'time');
      slider(s, '太阳方位', 'sunBearing', 0, 360, 1, fmt.deg, 'time');
      pills(s, opts(P.weather), (id) => this.S.weather === id, (id) => { this.S.weather = id; Object.assign(this.S, strip(P.weather[id])); this.cb.change('weather'); });
      slider(s, '云量', 'cloudCover', 0, 100, 1, fmt.pct);
      slider(s, '云速', 'cloudWind', 0, 40, 1, fmt.msi);

      s = section('水体');
      pills(s, opts(P.water), (id) => this.S.water === id, (id) => { this.S.water = id; this.cb.change('water'); });
      pills(s, opts(P.depth), (id) => this.S.depth === id, (id) => { this.S.depth = id; this.S.clarity = P.depth[id].clarity; this.S.nightGlow = P.depth[id].nightGlow; this.cb.change('depth'); });
      slider(s, '夜光', 'nightGlow', 0, 2, 0.1, fmt.f1);
      slider(s, '清澈度', 'clarity', 0, 100, 1, fmt.pct);

      s = section('画面与声音');
      pills(s, [{ id: false, label: '关闭声音' }, { id: true, label: '开启声音' }], (id) => this.S.sound === id, (id) => { this.S.sound = id; this.cb.change('sound'); });
      pills(s, opts(P.quality), (id) => this.S.quality === id, (id) => { this.S.quality = id; this.cb.change('quality'); });
      slider(s, '曝光', 'exposure', -3, 3, 0.1, fmt.ev);
      slider(s, '辉光', 'glow', 0, 0.5, 0.01, fmt.f2);
      slider(s, '视野', 'fov', 30, 100, 1, fmt.deg);

      this.refresh();
    }
    refresh() { for (const c of this.controls) c(); }
  }
  function strip(o) { const r = { ...o }; delete r.label; return r; }
  OW.UI = UI;
})();
