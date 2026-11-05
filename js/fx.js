/* SaferEverNet – Effekte
 *
 * Die Bühne hat drei Zustände:
 *   collect  Energiefeld: Punkteraster weicht dem Zeiger aus, jede Bewegung
 *            schickt Partikel in den Ring.
 *   implode  Das Feld stürzt in die Mitte, drei Schockwellen laufen nach außen.
 *   rope     Ein rotierendes Dreistrang-Seil (Maschine, Hand, Zeit). Bei jedem
 *            neuen Passwort reisen dessen echte Strang-Zeichen am Seil entlang.
 *
 * Math.random() wird hier ausschließlich für Optik benutzt (Partikelrichtungen),
 * nie für das Passwort.
 */
(function (root) {
  'use strict';
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  const outCubic = (t) => 1 - Math.pow(1 - t, 3);
  const mq = root.matchMedia('(prefers-reduced-motion: reduce)');
  const reduced = () => mq.matches;

  function toRgb(c) {
    c = (c || '').trim();
    if (c[0] === '#') {
      let h = c.slice(1);
      if (h.length === 3) h = h.split('').map((x) => x + x).join('');
      const n = parseInt(h.slice(0, 6), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (m) { const p = m[1].split(',').map(parseFloat); return [p[0], p[1], p[2]]; }
    return [128, 128, 128];
  }
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a < 0 ? 0 : a > 1 ? 1 : a.toFixed(3)})`;

  function readTheme() {
    const cs = getComputedStyle(document.documentElement);
    const g = (n) => toRgb(cs.getPropertyValue(n));
    const bg = g('--bg');
    const lum = (0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2]) / 255;
    return {
      s: [g('--m'), g('--h'), g('--z')],
      ink: g('--ink'), ink3: g('--ink-3'), stage: g('--stage'),
      dark: lum < 0.4,
      mono: cs.getPropertyValue('--font-mono').trim() || 'monospace',
    };
  }

  class Stage {
    constructor(el, canvas, opts) {
      this.el = el;
      this.cv = canvas;
      this.ctx = canvas.getContext('2d');
      this.ringEl = opts && opts.ring;
      this.mode = 'collect';
      this.t = 0; this.last = 0; this.running = false; this.visible = true;
      this.dots = []; this.parts = []; this.trail = []; this.glyphs = []; this.waves = [];
      this.pointer = { x: 0, y: 0, on: false };
      this.progress = 0; this.calm = false;
      this.onAbsorb = null;
      this.theta = 0; this.omega = 1.15; this.ampPulse = 0; this.intro = 0; this.implodeT = 0;
      this.masked = false;
      this.theme = readTheme();
      this.loop = this.loop.bind(this);
      this.resize();
      if ('ResizeObserver' in root) new ResizeObserver(() => this.resize()).observe(el);
      else root.addEventListener('resize', () => this.resize());
      if ('IntersectionObserver' in root) {
        new IntersectionObserver((es) => { this.visible = es[es.length - 1].isIntersecting; this.kick(); }).observe(el);
      }
      document.addEventListener('visibilitychange', () => this.kick());
      this.kick();
    }

    /* ------------------------------------------------ Größe & Takt */
    resize() {
      const r = this.el.getBoundingClientRect();
      const d = Math.min(2, root.devicePixelRatio || 1);
      this.w = Math.max(1, r.width); this.h = Math.max(1, r.height);
      this.cv.width = Math.round(this.w * d); this.cv.height = Math.round(this.h * d);
      this.ctx.setTransform(d, 0, 0, d, 0, 0);
      if (this.mode === 'collect') {
        this.measureRing();
        if (Math.abs((this.dotsW || 0) - this.w) > 1 || Math.abs((this.dotsH || 0) - this.h) > 1) this.buildDots();
      }
      this.draw();
      this.kick();
    }
    measureRing() {
      if (!this.ringEl) { this.cx = this.w / 2; this.cy = this.h / 2; this.ringR = 50; return; }
      const r = this.el.getBoundingClientRect(), q = this.ringEl.getBoundingClientRect();
      this.cx = q.left - r.left + q.width / 2; this.cy = q.top - r.top + q.height / 2; this.ringR = q.width / 2 || 50;
    }
    buildDots() {
      const gap = this.w < 520 ? 21 : 24;
      const cols = Math.max(1, Math.floor(this.w / gap)), rows = Math.max(1, Math.floor(this.h / gap));
      const ox = (this.w - (cols - 1) * gap) / 2, oy = (this.h - (rows - 1) * gap) / 2;
      this.dots = [];
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          const x = ox + i * gap, y = oy + j * gap;
          this.dots.push({ bx: x, by: y, x, y, g: 0, k: 0.55 + ((i * 7 + j * 13) % 10) / 22, c: (i + j * 2) % 3 });
        }
      }
      this.dotsW = this.w; this.dotsH = this.h;
    }
    kick() {
      if (this.running || !this.visible || document.hidden) return;
      if (reduced() && this.mode !== 'implode') { this.draw(); return; }
      this.running = true;
      this.last = performance.now();
      requestAnimationFrame(this.loop);
    }
    loop(now) {
      if (!this.visible || document.hidden) { this.running = false; return; }
      const dt = clamp((now - this.last) / 1000, 0, 0.05);
      this.last = now; this.t += dt;
      this.update(dt);
      this.draw();
      const idle = this.mode === 'collect' && this.calm && !this.pointer.on && !this.parts.length && !this.trail.length && !this.waves.length;
      if (idle || (reduced() && this.mode !== 'implode')) { this.running = false; return; }
      requestAnimationFrame(this.loop);
    }

    /* ------------------------------------------------ Eingaben */
    hover(x, y) { this.pointer.x = x; this.pointer.y = y; this.pointer.on = true; this.kick(); }
    leave() { this.pointer.on = false; this.kick(); }
    sample(x, y, p) {
      this.progress = p;
      const c = Math.min(2, Math.floor(p * 3));
      this.trail.push({ x, y, t: this.t, c });
      if (this.parts.length < 260) {
        const a = Math.random() * TAU, sp = 60 + Math.random() * 150;
        this.parts.push({ x, y, px: x, py: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, c, life: 0, spin: Math.random() < 0.5 ? -1 : 1, r: 1.2 + Math.random() * 1.5 });
      }
      this.kick();
    }
    burst(p) {
      this.progress = p;
      const c = Math.min(2, Math.floor(p * 3));
      const e = (Math.random() * 4) | 0, w = this.w, h = this.h;
      const x = e === 1 ? w - 8 : e === 3 ? 8 : Math.random() * w;
      const y = e === 0 ? 8 : e === 2 ? h - 8 : Math.random() * h;
      for (let i = 0; i < 6 && this.parts.length < 260; i++) {
        const a = Math.random() * TAU, sp = 40 + Math.random() * 120;
        this.parts.push({ x: x + Math.cos(a) * 6, y: y + Math.sin(a) * 6, px: x, py: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, c, life: 0, spin: Math.random() < 0.5 ? -1 : 1, r: 1.3 + Math.random() * 1.4 });
      }
      this.kick();
    }

    /* ------------------------------------------------ Übergänge */
    implode() {
      return new Promise((resolve) => {
        this.mode = 'implode';
        this.implodeT = 0; this.waveDone = false; this.intro = 0;
        this.onImplodeDone = resolve;
        this.pointer.on = false;
        if (reduced()) { this.finishImplode(); return; }
        this.kick();
      });
    }
    finishImplode() {
      this.mode = 'rope';
      this.dots = []; this.parts = []; this.trail = [];
      this.intro = 1;
      const r = this.onImplodeDone; this.onImplodeDone = null;
      this.draw();
      this.kick();
      if (r) r();
    }
    spin(strands) {
      this.omega = 15;
      this.ampPulse = 1;
      this.glyphs = [];
      if (strands && !this.masked && !reduced()) {
        const keys = ['M', 'H', 'Z'];
        const per = Math.min(28, strands.M.length);
        for (let s = 0; s < 3; s++) {
          for (let i = 0; i < per; i++) {
            this.glyphs.push({ s, ch: strands[keys[s]][i], x: -24 - i * 30 - s * 10, life: 0 });
          }
        }
      }
      this.el.classList.remove('flash');
      void this.el.getBoundingClientRect();
      this.el.classList.add('flash');
      this.kick();
    }
    setMasked(m) { this.masked = m; if (m) this.glyphs = []; this.draw(); }
    refreshTheme() { this.theme = readTheme(); this.draw(); }

    /* ------------------------------------------------ Simulation */
    update(dt) {
      if (this.mode === 'collect') this.updCollect(dt);
      else if (this.mode === 'implode') this.updImplode(dt);
      else this.updRope(dt);
      if (this.waves.length) {
        for (const w of this.waves) w.t += dt;
        this.waves = this.waves.filter((w) => w.t < w.life);
      }
    }
    updCollect(dt) {
      const p = this.pointer, R = 120, k = Math.min(1, dt * 12), kg = Math.min(1, dt * 9);
      let calm = true;
      for (const d of this.dots) {
        let tx = d.bx, ty = d.by, g = 0;
        if (p.on) {
          const dx = d.bx - p.x, dy = d.by - p.y, dist = Math.hypot(dx, dy);
          if (dist < R) {
            const f = 1 - dist / R, push = f * f * 16, inv = 1 / (dist || 1);
            tx += dx * inv * push; ty += dy * inv * push; g = f;
          }
        }
        d.x += (tx - d.x) * k; d.y += (ty - d.y) * k; d.g += (g - d.g) * kg;
        if (Math.abs(d.x - tx) > 0.05 || Math.abs(d.y - ty) > 0.05 || d.g > 0.01) calm = false;
      }
      this.calm = calm;
      this.updParts(dt, 1);
      const now = this.t;
      if (this.trail.length) this.trail = this.trail.filter((q) => now - q.t < 0.45);
    }
    updParts(dt, pull) {
      const cx = this.cx, cy = this.cy, absorbR = this.ringR * 0.62;
      let dead = false;
      for (const q of this.parts) {
        const dx = cx - q.x, dy = cy - q.y, dist = Math.hypot(dx, dy) || 1, ux = dx / dist, uy = dy / dist;
        const a = 650 * pull + 1500 * smooth(0, 1.2, q.life);
        q.vx += (ux * a - uy * 430 * q.spin) * dt;
        q.vy += (uy * a + ux * 430 * q.spin) * dt;
        const drag = Math.pow(0.16, dt);
        q.vx *= drag; q.vy *= drag;
        q.px = q.x; q.py = q.y;
        q.x += q.vx * dt; q.y += q.vy * dt;
        q.life += dt;
        if (dist < absorbR || q.life > 3.2) {
          q.dead = dead = true;
          if (this.mode === 'collect' && this.onAbsorb) this.onAbsorb(q.c);
        }
      }
      if (dead) this.parts = this.parts.filter((q) => !q.dead);
    }
    updImplode(dt) {
      this.implodeT += dt;
      const t = this.implodeT, cx = this.w / 2, cy = this.h / 2;
      const pull = Math.min(1, dt * (3 + t * 16));
      for (const d of this.dots) {
        d.x += (cx - d.x) * pull * d.k;
        d.y += (cy - d.y) * pull * d.k;
        d.g = Math.min(1, d.g + dt * 2.5);
      }
      this.cx = cx; this.cy = cy;
      this.updParts(dt, 3);
      if (!this.waveDone && t > 0.36) {
        this.waveDone = true;
        [0, 0.08, 0.16].forEach((delay, i) => this.waves.push({ t: -delay, life: 0.95, c: i }));
      }
      if (t > 0.5) this.intro = Math.min(1, (t - 0.5) / 0.85);
      this.updRope(dt);
      if (t >= 1.38) this.finishImplode();
    }
    lambda() { return clamp(this.w / 4.2, 120, 230); }
    updRope(dt) {
      this.omega += (1.15 - this.omega) * (1 - Math.exp(-dt * 1.4));
      this.theta += this.omega * dt;
      this.ampPulse *= Math.exp(-dt * 2.4);
      if (this.glyphs.length) {
        const k = TAU / this.lambda();
        const v = Math.max(130, (this.omega / k) * 0.62);
        for (const g of this.glyphs) { g.x += v * dt; g.life += dt; }
        this.glyphs = this.glyphs.filter((g) => g.x < this.w + 30 && g.life < 7);
      }
    }

    /* ------------------------------------------------ Zeichnen */
    draw() {
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.w, this.h);
      if (this.mode === 'collect') this.drawCollect();
      else {
        if (this.mode === 'implode') this.drawImplode();
        this.drawRope();
      }
      this.drawWaves();
    }
    drawCollect() {
      const ctx = this.ctx, th = this.theme, p = this.pointer;
      const c = Math.min(2, Math.floor(this.progress * 3));
      if (p.on) {
        const R = 110, gr = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, R);
        gr.addColorStop(0, rgba(th.s[c], th.dark ? 0.18 : 0.11));
        gr.addColorStop(1, rgba(th.s[c], 0));
        ctx.fillStyle = gr;
        ctx.fillRect(p.x - R, p.y - R, R * 2, R * 2);
      }
      ctx.fillStyle = rgba(th.ink3, th.dark ? 0.32 : 0.38);
      ctx.beginPath();
      for (const d of this.dots) if (d.g < 0.03) { ctx.moveTo(d.x + 1.15, d.y); ctx.arc(d.x, d.y, 1.15, 0, TAU); }
      ctx.fill();
      for (const d of this.dots) {
        if (d.g < 0.03) continue;
        ctx.fillStyle = rgba(th.s[c], 0.25 + d.g * 0.75);
        ctx.beginPath(); ctx.arc(d.x, d.y, 1.15 + d.g * 1.9, 0, TAU); ctx.fill();
      }
      ctx.save();
      if (th.dark) ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      for (let i = 1; i < this.trail.length; i++) {
        const a = this.trail[i - 1], b = this.trail[i];
        if (Math.abs(b.x - a.x) + Math.abs(b.y - a.y) > 90) continue;
        const al = Math.max(0, 1 - (this.t - b.t) / 0.45);
        ctx.strokeStyle = rgba(th.s[b.c], 0.9 * al);
        ctx.lineWidth = 1 + 3.2 * al;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      this.drawParts(1);
      ctx.restore();
    }
    drawParts(fade) {
      const ctx = this.ctx, th = this.theme;
      for (const q of this.parts) {
        const al = Math.min(1, q.life * 5) * (1 - smooth(2.4, 3.2, q.life)) * fade;
        if (al <= 0.01) continue;
        ctx.strokeStyle = rgba(th.s[q.c], 0.85 * al);
        ctx.lineWidth = q.r;
        ctx.beginPath(); ctx.moveTo(q.px, q.py); ctx.lineTo(q.x, q.y); ctx.stroke();
        ctx.fillStyle = rgba(th.s[q.c], al);
        ctx.beginPath(); ctx.arc(q.x, q.y, q.r, 0, TAU); ctx.fill();
      }
    }
    drawImplode() {
      const ctx = this.ctx, th = this.theme, fade = Math.max(0, 1 - this.implodeT / 0.62);
      ctx.save();
      if (th.dark) ctx.globalCompositeOperation = 'lighter';
      if (fade > 0) {
        for (const d of this.dots) {
          ctx.fillStyle = rgba(th.s[d.c], fade * (0.3 + d.g * 0.55));
          ctx.beginPath(); ctx.arc(d.x, d.y, 1.1 + d.g * 1.2, 0, TAU); ctx.fill();
        }
      }
      this.drawParts(fade);
      ctx.restore();
    }
    drawWaves() {
      if (!this.waves.length) return;
      const ctx = this.ctx, th = this.theme, cx = this.w / 2, cy = this.h / 2;
      const maxR = Math.hypot(this.w, this.h) / 2 + 20;
      ctx.save();
      if (th.dark) ctx.globalCompositeOperation = 'lighter';
      for (const w of this.waves) {
        if (w.t < 0) continue;
        const p = w.t / w.life, r = 16 + outCubic(p) * maxR;
        ctx.strokeStyle = rgba(th.s[w.c], (1 - p) * 0.85);
        ctx.lineWidth = 1.5 + 6 * (1 - p);
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.stroke();
      }
      ctx.restore();
    }
    drawRope() {
      const intro = outCubic(this.intro);
      if (intro <= 0.001) return;
      const ctx = this.ctx, th = this.theme, w = this.w, h = this.h, cy = h / 2;
      const A = Math.min(h * 0.24, 27) * (0.92 + 0.08 * Math.sin(this.t * 1.3)) * (1 + 0.3 * this.ampPulse);
      const k = TAU / this.lambda();
      const half = (w / 2) * intro, x0 = w / 2 - half, x1 = w / 2 + half;
      const edge = Math.max(40, w * 0.12);
      const NB = 7, step = 3;
      const paths = [];
      for (let b = 0; b < NB; b++) paths.push([new Path2D(), new Path2D(), new Path2D()]);
      for (let s = 0; s < 3; s++) {
        let px = null, py = 0, pb = -1;
        for (let x = x0; x <= x1 + 0.001; x += step) {
          const env = smooth(0, edge, x) * smooth(0, edge, w - x) * intro;
          const ph = k * x - this.theta + (s * TAU) / 3;
          const y = cy + A * env * Math.sin(ph);
          const b = clamp(Math.floor(((Math.cos(ph) + 1) / 2) * NB), 0, NB - 1);
          if (px !== null) {
            const P = paths[b][s];
            if (b !== pb) P.moveTo(px, py);
            P.lineTo(x, y);
          }
          px = x; py = y; pb = b;
        }
      }
      ctx.save();
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (let b = 0; b < NB; b++) {
        const f = b / (NB - 1);
        for (let s = 0; s < 3; s++) {
          if (th.dark && f > 0.6) {
            ctx.globalCompositeOperation = 'lighter';
            ctx.strokeStyle = rgba(th.s[s], 0.09 * f);
            ctx.lineWidth = 9 + 7 * f;
            ctx.stroke(paths[b][s]);
            ctx.globalCompositeOperation = 'source-over';
          }
          ctx.strokeStyle = rgba(th.s[s], 0.26 + 0.74 * f);
          ctx.lineWidth = 1.6 + 2.8 * f;
          ctx.stroke(paths[b][s]);
        }
      }
      if (this.glyphs.length && !this.masked) {
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        for (const g of this.glyphs) {
          if (g.x < x0 || g.x > x1) continue;
          const env = smooth(0, edge, g.x) * smooth(0, edge, w - g.x) * intro;
          const ph = k * g.x - this.theta + (g.s * TAU) / 3;
          const y = cy + A * env * Math.sin(ph), z = (Math.cos(ph) + 1) / 2;
          const al = smooth(0, edge, g.x) * (1 - smooth(w * 0.78, w * 0.96, g.x)) * (0.3 + 0.7 * z);
          if (al <= 0.02) continue;
          const size = 10 + 5 * z;
          ctx.fillStyle = rgba(th.stage, 0.78 * al);
          ctx.beginPath(); ctx.arc(g.x, y, size * 0.66, 0, TAU); ctx.fill();
          ctx.font = `700 ${size.toFixed(1)}px ${th.mono}`;
          ctx.fillStyle = rgba(th.s[g.s], al);
          ctx.fillText(g.ch, g.x, y + 0.5);
        }
      }
      ctx.restore();
    }
  }

  /* ------------------------------------------------ Kleine Helfer */
  function restart(el, cls) {
    el.classList.remove(cls);
    void el.getBoundingClientRect();
    el.classList.add(cls);
  }
  function countTo(el, from, to, opts) {
    const dur = (opts && opts.dur) || 700;
    const fmt = (opts && opts.fmt) || ((v) => String(Math.round(v)));
    if (el._raf) cancelAnimationFrame(el._raf);
    if (reduced() || !isFinite(from) || from === to) { el.textContent = fmt(to); return; }
    const t0 = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      el.textContent = fmt(from + (to - from) * outCubic(p));
      el._raf = p < 1 ? requestAnimationFrame(tick) : 0;
    };
    el._raf = requestAnimationFrame(tick);
  }
  function ripple(btn, e) {
    if (reduced()) return;
    const r = btn.getBoundingClientRect();
    const fromPointer = e && e.detail !== 0 && typeof e.clientX === 'number' && e.clientX !== 0;
    const s = document.createElement('span');
    s.className = 'ripple';
    s.style.left = (fromPointer ? e.clientX - r.left : r.width / 2) + 'px';
    s.style.top = (fromPointer ? e.clientY - r.top : r.height / 2) + 'px';
    btn.appendChild(s);
    setTimeout(() => s.remove(), 760);
  }
  /* FLIP: Elemente gleiten von der alten an die neue Position. */
  function flip(els, mutate, dur) {
    const first = els.map((el) => el.getBoundingClientRect().top);
    mutate();
    if (reduced()) return;
    els.forEach((el, i) => {
      const dy = first[i] - el.getBoundingClientRect().top;
      if (Math.abs(dy) > 0.5 && el.animate) {
        el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: dur || 700, easing: 'cubic-bezier(.2,.8,.2,1)' });
      }
    });
  }

  root.FX = { Stage, restart, countTo, ripple, flip, reduced };
})(typeof globalThis !== 'undefined' ? globalThis : this);
