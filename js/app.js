/* SaferEverNet – Oberfläche für TRIBRAID */
(function () {
  'use strict';
  const T = window.Tribraid;
  const $ = (id) => document.getElementById(id);
  const te = new TextEncoder();
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------------- Zustand ---------------- */
  const state = {
    ready: false,          // Selbsttest bestanden
    phase: 'pad',          // 'pad' | 'result'
    busy: false,
    generation: 0,
    handPool: null,        // 64 Byte, SHA-512-Kette über alle Bewegungen
    timePool: null,        // 64 Byte, SHA-512-Kette über allen Jitter
    events: [],            // noch nicht eingemischte Bewegungsdaten
    eventsTotal: 0,
    padScore: 0,
    masked: false,
    current: null,
  };
  const PAD_TARGET = 180;   // so viele „echte“ Bewegungspunkte füllen den Balken

  /* ---------------- Entropie-Pools ---------------- */
  async function sha512(...parts) {
    const len = parts.reduce((s, p) => s + p.length, 0);
    const buf = new Uint8Array(len);
    let o = 0;
    for (const p of parts) { buf.set(p, o); o += p.length; }
    const out = new Uint8Array(await crypto.subtle.digest('SHA-512', buf));
    buf.fill(0);
    return out;
  }
  function f64bytes(arr) { return new Uint8Array(new Float64Array(arr).buffer); }

  // Einmischungen laufen strikt nacheinander, damit keine Bewegungsdaten verloren gehen.
  let handChain = Promise.resolve();
  function mixHand() {
    handChain = handChain.then(async () => {
      const ev = state.events;
      state.events = [];
      const old = state.handPool;
      state.handPool = await sha512(old, te.encode('|hand|'), f64bytes(ev), f64bytes([performance.now(), Date.now()]));
      old.fill(0);
    });
    return handChain;
  }
  async function mixTime(samples) {
    const j = await T.collectJitter(samples);
    const old = state.timePool;
    state.timePool = await sha512(old, te.encode('|time|'), j);
    old.fill(0); j.fill(0);
  }

  function recordPointer(e, weight) {
    const list = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const p of (list.length ? list : [e])) {
      state.events.push(p.clientX, p.clientY, p.timeStamp, performance.now(), p.pressure || 0, p.tiltX || 0, p.tiltY || 0, p.width || 0);
    }
    state.eventsTotal += weight;
    if (state.events.length > 8 * 4096) mixHand(); // Puffer klein halten
  }

  /* ---------------- Selbsttest ---------------- */
  async function runSelfTest() {
    const chip = $('selftest');
    try {
      const t0 = performance.now();
      const res = await T.selfTest();
      const ms = Math.round(performance.now() - t0);
      const ok = res.filter((r) => r.ok).length;
      const list = $('testList');
      for (const r of res) {
        const li = document.createElement('li');
        li.className = r.ok ? 'ok' : 'bad';
        li.textContent = r.name + (r.error ? ' (' + r.error + ')' : '');
        list.appendChild(li);
      }
      const meta = document.createElement('li');
      meta.className = 'meta';
      meta.textContent = `Beim Laden geprüft in ${ms} ms. Testvektoren aus NIST- und RFC-Standards.`;
      list.appendChild(meta);
      chip.title = res.map((r) => (r.ok ? '✓ ' : '✗ ') + r.name).join('\n');
      if (ok === res.length) {
        chip.textContent = `✓ Selbsttest ${ok}/${res.length}`;
        chip.classList.add('ok');
        return true;
      }
      chip.textContent = `✗ Selbsttest ${ok}/${res.length}, Generierung gesperrt`;
      chip.classList.add('bad');
      return false;
    } catch (e) {
      chip.textContent = '✗ Krypto im Browser nicht verfügbar';
      chip.classList.add('bad');
      return false;
    }
  }

  /* ---------------- Kritzel-Feld ---------------- */
  function setupPad() {
    const pad = $('pad'), cv = $('padCanvas'), ctx = cv.getContext('2d');
    const css = getComputedStyle(document.documentElement);
    const colors = ['--m', '--h', '--z'].map((v) => css.getPropertyValue(v).trim());
    let last = null;

    function resize() {
      const r = pad.getBoundingClientRect(), d = window.devicePixelRatio || 1;
      cv.width = Math.round(r.width * d); cv.height = Math.round(r.height * d);
      ctx.setTransform(d, 0, 0, d, 0, 0);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    }
    resize();
    window.addEventListener('resize', resize);

    function move(e) {
      if (state.phase !== 'pad') return;
      const r = pad.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      if (last) {
        const d = Math.hypot(x - last.x, y - last.y);
        if (d < 2) return;
        const prog = Math.min(1, state.padScore / PAD_TARGET);
        ctx.strokeStyle = colors[Math.floor(prog * 2.999)];
        ctx.globalAlpha = 0.85;
        ctx.lineWidth = 2.4;
        ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(x, y); ctx.stroke();
        state.padScore++;
      }
      last = { x, y };
      pad.classList.add('active');
      recordPointer(e, 1);
      const p = Math.min(1, state.padScore / PAD_TARGET);
      $('padMeter').style.width = (p * 100).toFixed(1) + '%';
      $('padStatus').textContent = Math.floor(p * 100) + ' %';
      if (p >= 1) finishPad();
    }
    pad.addEventListener('pointermove', move);
    pad.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return; // sonst „schluckt“ die Zeigererfassung den Klick auf „ohne Kritzeln weiter“
      last = null;
      if (pad.setPointerCapture) pad.setPointerCapture(e.pointerId);
      move(e);
    });
    pad.addEventListener('pointerleave', () => { last = null; });
    $('skipPad').addEventListener('click', finishPad);
  }

  let finishing = false;
  async function finishPad() {
    if (finishing || state.phase !== 'pad') return;
    finishing = true;
    $('padStatus').textContent = state.ready ? 'Flechte …' : 'Warte auf Selbsttest …';
    await readyPromise;
    if (!state.ready) return;
    state.phase = 'result';
    $('pad').hidden = true;
    $('result').hidden = false;
    // Ab jetzt fließt jede Bewegung auf der Seite weiter in den Hand-Strang.
    document.addEventListener('pointermove', (e) => recordPointer(e, 0), { passive: true });
    await regenerate();
  }

  /* ---------------- Optionen ---------------- */
  function readOptions() {
    const classes = [...document.querySelectorAll('input[name="cls"]:checked')].map((i) => i.value);
    return { length: +$('len').value, classes, excludeAmbiguous: $('amb').checked };
  }

  function validOptions(o) {
    if (!o.classes.length) return 'Wähle mindestens eine Zeichenart.';
    return null;
  }

  /* ---------------- Generieren ---------------- */
  async function regenerate() {
    if (!state.ready || state.phase !== 'result') return;
    if (state.busy) { state.again = true; return; }
    const o = readOptions();
    if (validOptions(o)) return;
    state.busy = true;
    $('newBtn').disabled = true;
    try {
      await Promise.all([mixHand(), mixTime(256)]);
      state.generation++;
      const r = await T.generate({
        ...o,
        handEntropy: state.handPool.slice(),
        timeEntropy: state.timePool.slice(),
        generation: state.generation,
      });
      state.current = r;
      showPassword(r);
      showBraid(r);
    } catch (e) {
      $('password').textContent = 'Fehler: ' + (e && e.message || e);
    } finally {
      state.busy = false;
      $('newBtn').disabled = false;
      if (state.again) { state.again = false; regenerate(); }
    }
  }

  let animToken = 0;
  function showPassword(r) {
    const out = $('password');
    out.classList.toggle('masked', state.masked);
    if (state.masked) { out.textContent = '•'.repeat(r.password.length); return; }
    if (reduceMotion) { out.textContent = r.password; return; }
    // Kleine Web-Animation: an jeder Stelle erscheinen nacheinander die echten
    // Zeichen von M, H, Z, bevor sich das verflochtene Endzeichen setzt.
    const token = ++animToken;
    out.setAttribute('aria-busy', 'true'); // Screenreader liest erst das fertige Passwort
    const L = r.password.length, seq = [r.strands.M, r.strands.H, r.strands.Z, r.password];
    const t0 = performance.now(), STEP = 70, STAGGER = Math.min(14, 520 / L);
    out.textContent = '';
    const spans = [];
    for (let i = 0; i < L; i++) { const s = document.createElement('span'); s.className = 'c fresh'; spans.push(s); out.appendChild(s); }
    (function frame(now) {
      if (token !== animToken) return;
      let done = true;
      for (let i = 0; i < L; i++) {
        const k = Math.floor((now - t0 - i * STAGGER) / STEP);
        const stage = Math.max(0, Math.min(3, k));
        if (stage < 3) done = false;
        const ch = seq[stage][i];
        if (spans[i].textContent !== ch) spans[i].textContent = ch;
        spans[i].className = stage === 3 ? 'c' : 'c fresh s' + stage;
      }
      if (!done) requestAnimationFrame(frame);
      else { out.textContent = r.password; out.setAttribute('aria-busy', 'false'); } // sauberer Text für Auswahl/Kopieren
    })(t0);
  }

  function showBraid(r) {
    $('rowM').textContent = r.strands.M;
    $('rowH').textContent = r.strands.H;
    $('rowZ').textContent = r.strands.Z;
    $('rowF').textContent = r.password;
    const fmt = (x) => x.toLocaleString('de-DE');
    $('braidNote').textContent =
      `Jede Stelle: (M + H + Z) mod ${r.alphabetSize}. ` +
      `Versuch ${fmt(r.attempts)} hat alle Regeln erfüllt. ` +
      `Verbraucht: M ${fmt(r.bytesUsed.M)} B, H ${fmt(r.bytesUsed.H)} B, Z ${fmt(r.bytesUsed.Z)} B. ` +
      `Bewegungspunkte bisher: ${fmt(state.eventsTotal)}.`;
  }

  /* ---------------- Stärke & Energie ---------------- */
  // Landauer-Grenze: Jede irreversible Bit-Operation kostet mindestens k·T·ln2.
  // T = 2,725 K (kosmischer Hintergrund, kälter geht im Universum nicht dauerhaft).
  const LOG10_KTLN2 = Math.log10(1.380649e-23 * 2.725 * Math.LN2);
  const BENCH = [
    { log: 20.78, short: 'Menschheit\n1 Jahr', long: 'den gesamten Energieverbrauch der Menschheit in einem Jahr' },
    { log: 34.08, short: 'Sonne\n1 Jahr', long: 'alles, was die Sonne in einem Jahr abstrahlt' },
    { log: 44.08, short: 'Sonne\nganzes Leben', long: 'alles, was die Sonne in 10 Milliarden Jahren abstrahlt' },
    { log: 59.43, short: 'Milchstraße\nE = mc²', long: 'die komplette Masse-Energie der Milchstraße' },
    { log: 70.13, short: 'Universum\nE = mc²', long: 'die gesamte Masse-Energie des beobachtbaren Universums' },
  ];
  const SCALE_MIN = 10, SCALE_MAX = 78;
  const pos = (lg) => Math.max(0, Math.min(100, ((lg - SCALE_MIN) / (SCALE_MAX - SCALE_MIN)) * 100));

  function buildScale() {
    const box = $('scaleMarks');
    for (const b of BENCH) {
      const s = document.createElement('span');
      s.textContent = b.short;
      s.style.left = pos(b.log) + '%';
      box.appendChild(s);
    }
  }

  function powerOfTen(el, base, exp) {
    el.append(base + '10');
    const sup = document.createElement('sup');
    sup.textContent = String(exp);
    el.appendChild(sup);
  }

  function updateStrength() {
    const o = readOptions();
    const err = validOptions(o);
    const bitsEl = $('bits'), txt = $('energyText');
    txt.textContent = '';
    if (err) { bitsEl.textContent = '–'; txt.textContent = err; $('scaleFill').style.width = '0'; return; }
    let bits;
    try {
      const { sizes } = T.buildAlphabet(o.classes, o.excludeAmbiguous);
      if (o.length < sizes.length) { bitsEl.textContent = '–'; txt.textContent = 'Zu kurz für alle gewählten Zeichenarten.'; return; }
      bits = T.entropyBits(sizes, o.length);
    } catch (e) { bitsEl.textContent = '–'; return; }

    bitsEl.textContent = bits.toLocaleString('de-DE', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
    const lg = bits * Math.log10(2) + LOG10_KTLN2; // log10(Joule)
    $('scaleFill').style.width = pos(lg) + '%';
    const marks = $('scaleMarks').children;
    BENCH.forEach((b, i) => marks[i].classList.toggle('passed', lg >= b.log));

    if (bits < 80) {
      txt.textContent = 'Zu schwach für entschlossene Angreifer. Nimm mehr Zeichen.';
      return;
    }
    if (bits < 128) {
      txt.textContent = 'Solide, aber noch nicht „unnötig sicher“. Schieb den Regler weiter nach rechts.';
      return;
    }
    const passed = BENCH.filter((b) => lg >= b.log).pop();
    txt.append('Selbst ein physikalisch perfekter Computer bräuchte allein zum Durchzählen aller Möglichkeiten mindestens ');
    powerOfTen(txt, '', Math.floor(lg));
    txt.append(' Joule. ');
    if (passed) {
      const factor = Math.floor(lg - passed.log);
      if (factor >= 1) {
        txt.append('Das ist ');
        powerOfTen(txt, '', factor);
        txt.append('-mal ' + passed.long + '.');
      } else {
        txt.append('Das ist mehr als ' + passed.long + '.');
      }
    }
    if (passed === BENCH[BENCH.length - 1]) txt.append(' Unnötig sicher. ✓');
    const note = document.createElement('small');
    note.className = 'energy-note';
    note.textContent = 'Landauer-Grenze bei 2,7 K: Jede Bit-Operation kostet mindestens k·T·ln 2 Energie, egal wie gut die Technik wird.';
    txt.appendChild(note);
  }

  /* ---------------- Buttons ---------------- */
  function setupButtons() {
    $('selftest').addEventListener('click', () => {
      const l = $('testList');
      l.hidden = !l.hidden;
      $('selftest').setAttribute('aria-expanded', String(!l.hidden));
    });
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#selftest, #testList')) { $('testList').hidden = true; $('selftest').setAttribute('aria-expanded', 'false'); }
    });
    $('overkill').addEventListener('click', () => {
      $('len').value = 100;
      $('opts').dispatchEvent(new Event('input'));
    });
    $('newBtn').addEventListener('click', regenerate);
    $('copyBtn').addEventListener('click', async () => {
      if (!state.current) return;
      const btn = $('copyBtn');
      try {
        await navigator.clipboard.writeText(state.current.password);
        btn.textContent = 'Kopiert ✓';
      } catch (e) {
        // Rückfall: Text markieren, damit Strg/Cmd+C funktioniert
        const out = $('password');
        out.textContent = state.current.password;
        const range = document.createRange(); range.selectNodeContents(out);
        const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
        btn.textContent = 'Markiert, Strg+C';
      }
      setTimeout(() => { btn.textContent = 'Kopieren'; }, 1800);
    });
    $('eyeBtn').addEventListener('click', () => {
      state.masked = !state.masked;
      $('eyeBtn').setAttribute('aria-pressed', String(state.masked));
      $('eyeBtn').textContent = state.masked ? 'Zeigen' : 'Verbergen';
      $('braid').hidden = state.masked;
      if (state.current) {
        animToken++;
        $('password').setAttribute('aria-busy', 'false');
        $('password').classList.toggle('masked', state.masked);
        $('password').textContent = state.masked ? '•'.repeat(state.current.password.length) : state.current.password;
      }
    });

    let deb;
    const onOpt = () => {
      $('lenOut').textContent = $('len').value;
      updateStrength();
      clearTimeout(deb);
      deb = setTimeout(regenerate, 140);
    };
    $('opts').addEventListener('input', onOpt);
    $('opts').addEventListener('change', onOpt);
    $('opts').addEventListener('submit', (e) => e.preventDefault());
  }

  /* ---------------- Start ---------------- */
  let readyPromise;
  async function init() {
    state.handPool = await sha512(te.encode(T.VERSION + '/hand/init'), f64bytes([performance.now(), Date.now(), Math.random()]));
    state.timePool = await sha512(te.encode(T.VERSION + '/time/init'), f64bytes([performance.now()]));
    buildScale();
    updateStrength();
    setupButtons();
    setupPad();
    readyPromise = (async () => {
      const ok = await runSelfTest();
      if (ok) await mixTime(2048); // kräftige Grundfüllung des Zeit-Strangs
      state.ready = ok;
      if (!ok) $('padStatus').textContent = 'Selbsttest fehlgeschlagen: Generierung gesperrt.';
    })();
    await readyPromise;
  }
  init();
})();
