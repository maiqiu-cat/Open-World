'use strict';
// Camera rig: cinematic tour shots + free fly.
(function () {
  const { v3 } = OW;
  const D = OW.deg;
  const ss = OW.smooth;

  function lookFromTo(pos, target) {
    const d = v3.norm(v3.sub(target, pos));
    return { pos, dir: d };
  }
  const flat = (b) => OW.dirFromBearing(b, 0);

  // Each shot: (c) => {pos, dir, fov?}. c = {t, sunB, boat:{p,fwd,right}, water, school, bird(i), island}
  const SHOTS = [
    {
      name: 'Horizon', dur: 11,
      f(c) {
        const d = flat(c.sunB + 6), side = flat(c.sunB + 96);
        let p = v3.add(c.boat.p, v3.add(v3.scale(d, -70 + c.t * 3.2), v3.scale(side, -38)));
        p[1] = Math.max(c.water + 3.4 + Math.sin(c.t * 0.45) * 0.25, c.waterNow + 1.5);
        const dir = v3.norm([d[0], -0.03 + Math.sin(c.t * 0.2) * 0.01, d[2]]);
        return { pos: p, dir, fov: 60 };
      },
    },
    {
      name: 'Sail', dur: 12,
      f(c) {
        const a = c.sunB + 180 + 35 - c.t * 3.5;
        const o = flat(a);
        const tgt = v3.add(c.boat.p, [0, 4.8, 0]);
        const p = v3.add(c.boat.p, v3.scale(o, 26 - c.t * 0.4));
        p[1] = Math.max(c.water + 2.2, 3.6 + Math.sin(c.t * 0.3) * 0.4);
        return { ...lookFromTo(p, tgt), fov: 55 };
      },
    },
    {
      name: 'Detail', dur: 10,
      f(c) {
        const f = c.boat.fwd, r = c.boat.right;
        const p = v3.add(c.boat.p, v3.add(v3.scale(r, -8.5 + c.t * 0.12), v3.scale(f, -4.5 + c.t * 0.75)));
        p[1] = Math.max(c.water + 2.6, c.waterNow + 1.6);
        const tgt = v3.add(c.boat.p, v3.add(v3.scale(f, -0.5 + c.t * 0.35), [0, 3.4 + c.t * 0.35, 0]));
        return { ...lookFromTo(p, tgt), fov: 58 };
      },
    },
    {
      name: 'Skim', dur: 9,
      f(c) {
        const d = flat(c.sunB - 40), side = flat(c.sunB + 50);
        let p = v3.add(c.boat.p, v3.add(v3.scale(d, -60 + c.t * 9), v3.scale(side, 45)));
        p[1] = Math.max(c.water + 1.25, c.waterNow + 0.9);
        const dir = v3.norm([d[0], -0.06, d[2]]);
        return { pos: p, dir, fov: 68 };
      },
    },
    {
      name: 'Dive', dur: 12,
      f(c) {
        const d = flat(c.sunB + 20);
        const s = c.school;
        let p = v3.add(s, v3.scale(d, -26 + c.t * 1.5));
        const k = ss(2.0, 6.5, c.t);
        p[1] = OW.lerp(c.water + 2.4, -Math.min(7.5, c.maxDepth * 0.6), k);
        const lookFwd = v3.norm([d[0], OW.lerp(-0.12, 0.0, k), d[2]]);
        const toSchool = v3.norm(v3.sub(s, p));
        const dir = v3.norm(v3.lerp(lookFwd, toSchool, ss(5.5, 9.0, c.t)));
        return { pos: p, dir, fov: 60 };
      },
    },
    {
      name: 'Dive', dur: 11,
      f(c) {
        const a = c.sunB + 120 + c.t * 4;
        const o = flat(a);
        const p = v3.add(c.boat.p, v3.add(v3.scale(o, 7), [0, -Math.min(9.5, c.maxDepth * 0.75) + Math.sin(c.t * 0.3) * 0.4, 0]));
        const tgt = v3.add(c.boat.p, [0, -0.5, 0]);
        return { ...lookFromTo(p, tgt), fov: 70 };
      },
    },
    {
      name: 'Aerial', dur: 11,
      f(c) {
        const o = flat(c.sunB + 155 + c.t * 2.2);
        const p = v3.add(c.boat.p, v3.scale(o, 170 - c.t * 4));
        p[1] = 62 + c.t * 2.5;
        const tgt = v3.add(c.boat.p, v3.scale(flat(c.sunB), 60));
        return { ...lookFromTo(p, tgt), fov: 55 };
      },
    },
    {
      name: 'Gulls', dur: 10,
      f(c) {
        const b = c.bird(0);
        const up = [0, 1, 0];
        const side = v3.norm(v3.cross(b.fwd, up));
        const p = v3.add(v3.add(b.pos, v3.scale(b.fwd, -3.6)), v3.add(v3.scale(up, 0.9), v3.scale(side, 0.8)));
        const tgt = v3.add(b.pos, v3.scale(b.fwd, 20));
        tgt[1] += 1.5;
        return { ...lookFromTo(p, tgt), fov: 54 };
      },
    },
    {
      name: 'Sky', dur: 10,
      f(c) {
        const b = c.sunB - 25 + c.t * 2.0;
        const p = v3.add(c.boat.p, v3.scale(flat(c.sunB + 100), 60));
        p[1] = c.water + 4.5;
        const el = OW.lerp(-2, 34, ss(1, 9, c.t));
        return { pos: p, dir: OW.dirFromBearing(b, el), fov: 64 };
      },
    },
    {
      name: 'Coast', dur: 11,
      f(c) {
        const toI = v3.sub(c.island, c.boat.p);
        const bI = Math.atan2(toI[0], -toI[2]) / D;
        const p = v3.add(c.boat.p, v3.add(v3.scale(flat(bI + 180), 40), v3.scale(flat(bI + 90), 30)));
        p[1] = 11 + c.t * 0.3;
        return { pos: p, dir: OW.dirFromBearing(bI - 12 + c.t * 2.2, -1.2), fov: 50 };
      },
    },
  ];

  class CameraRig {
    constructor(canvas) {
      this.mode = 'tour';
      this.shot = 0;
      this.shotT = 0;
      this.pos = [0, 5, 30];
      this.yaw = 0; this.pitch = 0;
      this.fov = 60;
      this.fovTour = 60;
      this.fade = 0;
      this.keys = {};
      this.speed = 10;
      this.waterSmooth = 0;
      this.label = SHOTS[0].name;
      this.bindInput(canvas);
    }

    bindInput(el) {
      let drag = null;
      el.addEventListener('pointerdown', (e) => {
        if (this.mode !== 'free') return;
        drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
        el.setPointerCapture(e.pointerId);
      });
      el.addEventListener('pointermove', (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        drag.x = e.clientX; drag.y = e.clientY;
        const k = (this.fov / 60) * 0.15;
        this.yaw += dx * k;
        this.pitch = OW.clamp(this.pitch - dy * k, -85, 85);
      });
      const end = () => { drag = null; };
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
      el.addEventListener('wheel', (e) => {
        if (this.mode !== 'free') return;
        e.preventDefault();
        this.speed = OW.clamp(this.speed * Math.pow(1.0015, -e.deltaY), 1, 200);
      }, { passive: false });
      window.addEventListener('keydown', (e) => {
        if (e.target && (e.target.tagName === 'INPUT')) return;
        this.keys[e.code] = true;
        if (this.mode === 'tour' && e.code === 'KeyN') this.nextShot();
      });
      window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
      // two-finger touch = move forward
      this.touches = 0;
      el.addEventListener('touchstart', (e) => { this.touches = e.touches.length; }, { passive: true });
      el.addEventListener('touchend', (e) => { this.touches = e.touches.length; }, { passive: true });
    }

    setMode(m) {
      if (m === this.mode) return;
      this.mode = m;
      if (m === 'tour') { this.shotT = 0; this.fade = 0; }
      this.fade = 1;
    }

    nextShot() {
      this.shot = (this.shot + 1) % SHOTS.length;
      this.shotT = 0;
    }

    get fwd() { return OW.dirFromBearing(this.yaw, this.pitch); }

    update(dt, c, fovSetting) {
      this.waterSmooth += (c.waterAtCam - this.waterSmooth) * Math.min(1, dt * 3);
      if (this.mode === 'tour') {
        if (!this.hold) this.shotT += dt;
        const S = SHOTS[this.shot];
        if (this.shotT > S.dur) this.nextShot();
        const sh = SHOTS[this.shot];
        const r = sh.f({ ...c, t: this.shotT, water: this.waterSmooth, waterNow: c.waterAtCam });
        this.pos = r.pos;
        this.yaw = Math.atan2(r.dir[0], -r.dir[2]) / D;
        this.pitch = Math.asin(OW.clamp(r.dir[1], -1, 1)) / D;
        this.fov = (r.fov || 60) * (fovSetting / 60);
        this.label = sh.name;
        const fin = ss(0, 0.5, this.shotT), fout = ss(sh.dur, sh.dur - 0.5, this.shotT);
        this.fade = Math.min(fin, fout);
      } else {
        this.fov = fovSetting;
        const f = this.fwd;
        const right = v3.norm(v3.cross(f, [0, 1, 0]));
        let mv = [0, 0, 0];
        const k = this.keys;
        if (k.KeyW || k.ArrowUp || this.touches >= 2) mv = v3.add(mv, f);
        if (k.KeyS || k.ArrowDown) mv = v3.sub(mv, f);
        if (k.KeyD || k.ArrowRight) mv = v3.add(mv, right);
        if (k.KeyA || k.ArrowLeft) mv = v3.sub(mv, right);
        if (k.KeyE || k.Space) mv[1] += 1;
        if (k.KeyQ || k.KeyC) mv[1] -= 1;
        const sp = this.speed * (k.ShiftLeft || k.ShiftRight ? 4 : 1);
        if (v3.len(mv) > 0) this.pos = v3.add(this.pos, v3.scale(v3.norm(mv), sp * dt));
        this.pos[1] = OW.clamp(this.pos[1], -60, 3000);
        this.fade = Math.min(1, this.fade + dt * 3);
      }
    }
  }
  CameraRig.SHOTS = SHOTS;
  OW.CameraRig = CameraRig;
})();
