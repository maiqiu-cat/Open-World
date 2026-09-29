'use strict';
// Core: WebGL2 helpers, math, RNG. Everything hangs off the global OW namespace.
const OW = (window.OW = window.OW || {});

OW.createGL = function (canvas) {
  const gl = canvas.getContext('webgl2', {
    antialias: false, alpha: false, depth: false, stencil: false,
    powerPreference: 'high-performance', preserveDrawingBuffer: false,
  });
  if (!gl) throw new Error('WebGL2 is not available in this browser.');
  if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('EXT_color_buffer_float is required.');
  gl.getExtension('OES_texture_float_linear');
  gl.getExtension('EXT_float_blend');
  return gl;
};

const HEADER = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler3D;
precision highp sampler2DArray;
`;

function compile(gl, type, src, name) {
  const s = gl.createShader(type);
  gl.shaderSource(s, HEADER + src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    const lines = (HEADER + src).split('\n');
    const m = /ERROR: \d+:(\d+)/.exec(log || '');
    let ctx = '';
    if (m) {
      const ln = +m[1];
      for (let i = Math.max(1, ln - 3); i <= Math.min(lines.length, ln + 2); i++) ctx += `${i}: ${lines[i - 1]}\n`;
    }
    throw new Error(`[${name}] ${type === gl.VERTEX_SHADER ? 'VS' : 'FS'} compile error:\n${log}\n${ctx}`);
  }
  return s;
}

const SAMPLER_TARGET = {};
class Program {
  constructor(gl, vs, fs, name) {
    this.gl = gl; this.name = name;
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs, name));
    gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs, name));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`[${name}] link error: ${gl.getProgramInfoLog(p)}`);
    this.p = p;
    this.u = {};
    if (!SAMPLER_TARGET.init) {
      SAMPLER_TARGET.init = true;
      SAMPLER_TARGET[gl.SAMPLER_2D] = gl.TEXTURE_2D;
      SAMPLER_TARGET[gl.SAMPLER_3D] = gl.TEXTURE_3D;
      SAMPLER_TARGET[gl.SAMPLER_2D_ARRAY] = gl.TEXTURE_2D_ARRAY;
      SAMPLER_TARGET[gl.SAMPLER_CUBE] = gl.TEXTURE_CUBE_MAP;
    }
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    let unit = 0;
    gl.useProgram(p);
    for (let i = 0; i < n; i++) {
      const info = gl.getActiveUniform(p, i);
      const nm = info.name.replace(/\[0\]$/, '');
      const loc = gl.getUniformLocation(p, info.name);
      const u = { loc, type: info.type, size: info.size };
      if (SAMPLER_TARGET[info.type]) { u.unit = unit++; u.target = SAMPLER_TARGET[info.type]; gl.uniform1i(loc, u.unit); }
      this.u[nm] = u;
    }
  }
  use() { this.gl.useProgram(this.p); return this; }
  has(name) { return !!this.u[name]; }
  set(name, v) {
    const u = this.u[name]; if (!u) return this;
    const gl = this.gl, l = u.loc;
    switch (u.type) {
      case gl.FLOAT: u.size > 1 ? gl.uniform1fv(l, v) : gl.uniform1f(l, v); break;
      case gl.FLOAT_VEC2: gl.uniform2fv(l, v); break;
      case gl.FLOAT_VEC3: gl.uniform3fv(l, v); break;
      case gl.FLOAT_VEC4: gl.uniform4fv(l, v); break;
      case gl.INT: case gl.BOOL: u.size > 1 ? gl.uniform1iv(l, v) : gl.uniform1i(l, v); break;
      case gl.FLOAT_MAT4: gl.uniformMatrix4fv(l, false, v); break;
      case gl.FLOAT_MAT3: gl.uniformMatrix3fv(l, false, v); break;
    }
    return this;
  }
  setAll(obj) { for (const k in obj) this.set(k, obj[k]); return this; }
  tex(name, t) {
    const u = this.u[name]; if (!u || u.unit === undefined) return this;
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + u.unit);
    gl.bindTexture(u.target, t);
    return this;
  }
}
OW.Program = Program;

// Texture helpers ---------------------------------------------------------
OW.tex2D = function (gl, o) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  const f = o.filter === 'nearest' ? gl.NEAREST : gl.LINEAR;
  const w = o.wrap === 'repeat' ? gl.REPEAT : gl.CLAMP_TO_EDGE;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, o.mips ? gl.LINEAR_MIPMAP_LINEAR : f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, w);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, w);
  gl.texImage2D(gl.TEXTURE_2D, 0, o.internal, o.w, o.h, 0, o.format, o.type, o.data || null);
  if (o.mips) gl.generateMipmap(gl.TEXTURE_2D);
  t.w = o.w; t.h = o.h;
  return t;
};

OW.texArray = function (gl, w, h, layers, internal, mips) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, t);
  const levels = mips ? Math.floor(Math.log2(Math.max(w, h))) + 1 : 1;
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, levels, internal, w, h, layers);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, mips ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
  if (mips) {
    const ext = gl.getExtension('EXT_texture_filter_anisotropic');
    if (ext) gl.texParameterf(gl.TEXTURE_2D_ARRAY, ext.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(ext.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
  }
  t.w = w; t.h = h;
  return t;
};

OW.fbo = function (gl, attachments, depth) {
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  const bufs = [];
  attachments.forEach((a, i) => {
    const at = gl.COLOR_ATTACHMENT0 + i;
    if (a.layer !== undefined) gl.framebufferTextureLayer(gl.FRAMEBUFFER, at, a.tex, a.level || 0, a.layer);
    else if (a.rb) gl.framebufferRenderbuffer(gl.FRAMEBUFFER, at, gl.RENDERBUFFER, a.rb);
    else gl.framebufferTexture2D(gl.FRAMEBUFFER, at, gl.TEXTURE_2D, a.tex || a, a.level || 0);
    bufs.push(at);
  });
  if (depth) gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
  gl.drawBuffers(bufs);
  const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (st !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Framebuffer incomplete: 0x' + st.toString(16));
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return fb;
};

// Geometry ------------------------------------------------------------------
OW.mesh = function (gl, attribs, indices) {
  // attribs: [{loc, size, data(Float32Array), divisor}]
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);
  const bufs = [];
  for (const a of attribs) {
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, a.data, a.usage || gl.STATIC_DRAW);
    gl.enableVertexAttribArray(a.loc);
    gl.vertexAttribPointer(a.loc, a.size, gl.FLOAT, false, 0, 0);
    if (a.divisor) gl.vertexAttribDivisor(a.loc, a.divisor);
    bufs.push(b);
  }
  let count = attribs.length ? attribs[0].data.length / attribs[0].size : 0;
  let ib = null, indexType = 0;
  if (indices) {
    ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    count = indices.length;
    indexType = indices instanceof Uint32Array ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT;
  }
  gl.bindVertexArray(null);
  return {
    vao, count, ib, indexType, bufs,
    draw(mode, instances) {
      gl.bindVertexArray(vao);
      mode = mode === undefined ? gl.TRIANGLES : mode;
      if (ib) instances ? gl.drawElementsInstanced(mode, count, indexType, 0, instances) : gl.drawElements(mode, count, indexType, 0);
      else instances ? gl.drawArraysInstanced(mode, 0, count, instances) : gl.drawArrays(mode, 0, count);
    },
    dispose() { bufs.forEach((b) => gl.deleteBuffer(b)); if (ib) gl.deleteBuffer(ib); gl.deleteVertexArray(vao); },
  };
};

// Math ----------------------------------------------------------------------
const v3 = (OW.v3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
});

OW.m4 = {
  perspective(fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    return new Float32Array([f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
  },
  lookDir(eye, fwd, up) {
    const z = v3.norm(v3.scale(fwd, -1));
    const x = v3.norm(v3.cross(up, z));
    const y = v3.cross(z, x);
    return new Float32Array([
      x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
      -v3.dot(x, eye), -v3.dot(y, eye), -v3.dot(z, eye), 1,
    ]);
  },
  mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      o[c * 4 + r] = s;
    }
    return o;
  },
};

OW.clamp = (x, a, b) => Math.min(b, Math.max(a, x));
OW.lerp = (a, b, t) => a + (b - a) * t;
OW.smooth = (e0, e1, x) => { const t = OW.clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
OW.deg = Math.PI / 180;

OW.rng = function (seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.gauss = () => {
    const u = Math.max(next(), 1e-9), v = next();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  return next;
};

// Direction from a compass bearing (0 = north = -Z, 90 = east = +X) and elevation.
OW.dirFromBearing = function (bearingDeg, elevDeg) {
  const b = bearingDeg * OW.deg, e = elevDeg * OW.deg;
  return [Math.cos(e) * Math.sin(b), Math.sin(e), -Math.cos(e) * Math.cos(b)];
};
