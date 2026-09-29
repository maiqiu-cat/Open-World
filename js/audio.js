'use strict';
// Procedural soundscape (Web Audio): surf, foam wash, wind, rain, underwater, gulls, thunder.
(function () {
  class Soundscape {
    constructor() { this.ctx = null; this.on = false; this.nextGull = 4; }

    enable() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.build();
      }
      this.ctx.resume();
      this.on = true;
      this.master.gain.setTargetAtTime(0.85, this.ctx.currentTime, 0.4);
    }

    disable() {
      this.on = false;
      if (!this.ctx) return;
      this.master.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
      clearTimeout(this.susp);
      this.susp = setTimeout(() => { if (!this.on) this.ctx.suspend(); }, 800);
    }

    noiseBuffer(kind, seconds) {
      const ctx = this.ctx, n = Math.floor(ctx.sampleRate * seconds);
      const buf = ctx.createBuffer(2, n, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = buf.getChannelData(ch);
        let b = 0, p0 = 0, p1 = 0, p2 = 0;
        for (let i = 0; i < n; i++) {
          const w = Math.random() * 2 - 1;
          if (kind === 'brown') { b = (b + 0.02 * w) / 1.02; d[i] = b * 3.5; }
          else if (kind === 'pink') { p0 = 0.99765 * p0 + w * 0.099046; p1 = 0.963 * p1 + w * 0.2965164; p2 = 0.57 * p2 + w * 1.0526913; d[i] = (p0 + p1 + p2 + w * 0.1848) * 0.2; }
          else d[i] = w;
        }
      }
      return buf;
    }

    loop(buf) {
      const s = this.ctx.createBufferSource();
      s.buffer = buf; s.loop = true;
      s.start(0, Math.random() * buf.duration);
      return s;
    }

    build() {
      const ctx = this.ctx;
      this.master = ctx.createGain(); this.master.gain.value = 0;
      this.uw = ctx.createBiquadFilter(); this.uw.type = 'lowpass'; this.uw.frequency.value = 18000; this.uw.Q.value = 0.5;
      const comp = ctx.createDynamicsCompressor();
      this.master.connect(this.uw); this.uw.connect(comp); comp.connect(ctx.destination);
      this.bus = ctx.createGain(); this.bus.connect(this.master);

      const white = this.noiseBuffer('white', 4), brown = this.noiseBuffer('brown', 6), pink = this.noiseBuffer('pink', 5);
      this.white = white;
      const chain = (src, nodes, gainVal) => {
        let cur = src;
        for (const n of nodes) { cur.connect(n); cur = n; }
        const g = ctx.createGain(); g.gain.value = gainVal || 0;
        cur.connect(g); g.connect(this.bus);
        return g;
      };
      // surf (low roar) + foam wash (hiss) with separate slow modulation
      this.surfLP = ctx.createBiquadFilter(); this.surfLP.type = 'lowpass'; this.surfLP.frequency.value = 500;
      this.surf = chain(this.loop(brown), [this.surfLP], 0);
      this.washBP = ctx.createBiquadFilter(); this.washBP.type = 'bandpass'; this.washBP.frequency.value = 1400; this.washBP.Q.value = 0.5;
      this.wash = chain(this.loop(pink), [this.washBP], 0);
      // wind
      this.windBP = ctx.createBiquadFilter(); this.windBP.type = 'bandpass'; this.windBP.frequency.value = 500; this.windBP.Q.value = 2.5;
      this.wind = chain(this.loop(white), [this.windBP], 0);
      this.windLP = ctx.createBiquadFilter(); this.windLP.type = 'lowpass'; this.windLP.frequency.value = 250;
      this.windLow = chain(this.loop(brown), [this.windLP], 0);
      // rain
      this.rainHP = ctx.createBiquadFilter(); this.rainHP.type = 'highpass'; this.rainHP.frequency.value = 1800;
      this.rain = chain(this.loop(white), [this.rainHP], 0);
      // underwater rumble
      this.uwLP = ctx.createBiquadFilter(); this.uwLP.type = 'lowpass'; this.uwLP.frequency.value = 160;
      this.uwGain = chain(this.loop(brown), [this.uwLP], 0);
    }

    gull() {
      const ctx = this.ctx, t0 = ctx.currentTime;
      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      const out = ctx.createGain(); out.gain.value = 0.0;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1900; bp.Q.value = 2.5;
      const osc = ctx.createOscillator(); osc.type = 'sawtooth';
      const fm = ctx.createOscillator(); fm.frequency.value = 38;
      const fmg = ctx.createGain(); fmg.gain.value = 60;
      fm.connect(fmg); fmg.connect(osc.frequency);
      osc.connect(bp); bp.connect(out);
      if (pan) { pan.pan.value = Math.random() * 1.6 - 0.8; out.connect(pan); pan.connect(this.bus); } else out.connect(this.bus);
      const n = 2 + Math.floor(Math.random() * 3);
      let t = t0;
      const vol = 0.05 + Math.random() * 0.05;
      for (let i = 0; i < n; i++) {
        const len = 0.22 + Math.random() * 0.12;
        osc.frequency.setValueAtTime(1500 + Math.random() * 200, t);
        osc.frequency.exponentialRampToValueAtTime(950, t + len);
        out.gain.setValueAtTime(0, t);
        out.gain.linearRampToValueAtTime(vol, t + 0.03);
        out.gain.exponentialRampToValueAtTime(0.001, t + len);
        t += len + 0.08 + Math.random() * 0.1;
      }
      osc.start(t0); fm.start(t0); osc.stop(t + 0.1); fm.stop(t + 0.1);
    }

    thunder(delay, strength) {
      if (!this.on) return;
      const ctx = this.ctx, t0 = ctx.currentTime + delay;
      const src = ctx.createBufferSource(); src.buffer = this.white;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 140 + strength * 200;
      lp.frequency.setValueAtTime(900, t0); lp.frequency.exponentialRampToValueAtTime(80, t0 + 3.5);
      const g = ctx.createGain(); g.gain.value = 0;
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.9 * strength, t0 + 0.08);
      g.gain.exponentialRampToValueAtTime(0.35 * strength, t0 + 0.6);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 4.5 + Math.random() * 2);
      src.connect(lp); lp.connect(g); g.connect(this.bus);
      src.start(t0, Math.random() * 2); src.stop(t0 + 7);
    }

    update(dt, s) {
      if (!this.ctx || !this.on) return;
      const now = this.ctx.currentTime, tc = 0.25;
      const w = OW.clamp(s.wind / 25, 0, 1.4);
      const swellMod = 0.55 + 0.45 * Math.sin(s.time * 0.55) * Math.sin(s.time * 0.17 + 1.3);
      const wave = OW.clamp(0.15 + 0.6 * w, 0, 1) * (0.6 + 0.4 * swellMod);
      const air = s.under ? 0 : 1;
      const heightAtten = 1 / (1 + Math.max(0, s.camHeight - 5) / 25);
      this.surf.gain.setTargetAtTime(0.55 * wave * air * heightAtten, now, tc);
      this.surfLP.frequency.setTargetAtTime(300 + 500 * wave, now, tc);
      this.wash.gain.setTargetAtTime(0.09 * wave * wave * (0.4 + 0.6 * Math.max(0, Math.sin(s.time * 0.9 + Math.sin(s.time * 0.31) * 2))) * air * heightAtten, now, tc);
      const gust = 0.7 + 0.3 * Math.sin(s.time * 0.23) * Math.sin(s.time * 0.61 + 2);
      this.wind.gain.setTargetAtTime(0.12 * w * w * gust * air, now, tc);
      this.windBP.frequency.setTargetAtTime(350 + 45 * s.wind * gust, now, tc);
      this.windLow.gain.setTargetAtTime(0.25 * w * gust * air, now, tc);
      this.rain.gain.setTargetAtTime(0.16 * s.rain * air, now, tc);
      this.uwGain.gain.setTargetAtTime(s.under ? 0.5 : 0, now, tc);
      this.uw.frequency.setTargetAtTime(s.under ? 420 : 18000, now, 0.08);
      this.nextGull -= dt;
      if (this.nextGull <= 0) {
        this.nextGull = 3 + Math.random() * 8;
        if (s.birds && !s.under) this.gull();
      }
    }
  }
  OW.Soundscape = Soundscape;
})();
