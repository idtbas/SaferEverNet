/* SaferEverNet – Oberfläche für TRIBRAID */
(function () {
  'use strict';
  const T = window.Tribraid;
  const FX = window.FX;
  const $ = (id) => document.getElementById(id);
  const te = new TextEncoder();
  const NS = 'http://www.w3.org/2000/svg';
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const fmtInt = (x) => x.toLocaleString('de-DE');
  const fmtBits = (b) => b.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const isField = (t) => !!(t && t.closest && t.closest('input, textarea, select, [contenteditable="true"]'));

  /* ------------------------------------------------------------ Zustand */
  const state = {
    ready: false,
    phase: 'collect',       // 'collect' | 'rope'
    busy: false,
    again: false,
    generation: 0,
    handPool: null,         // 64 Byte, SHA-512-Kette über alle Bewegungen
    timePool: null,         // 64 Byte, SHA-512-Kette über allen Jitter
    events: [],
    eventsTotal: 0,
    score: 0,
    masked: false,
    locked: false,          // kostenlose Version: Passwort verschwommen (siehe abo.js)
    current: null,
    activeIdx: -1,
    lastBits: 0,
  };
  const TARGET = 160;       // so viele Bewegungspunkte füllen den Ring
  // Verdeckt = verborgen ODER (kostenlos) verschwommen. Dann zeigen auch Seil,
  // Tooltip, Geflecht-Ansicht und Geflecht-Satz keine Zeichen, die das Passwort verraten.
  const veiled = () => state.masked || state.locked;
  let inited = false;
  let stage = null;
  let readyPromise = Promise.resolve(false);

  /* ------------------------------------------------------------ DOM-Helfer */
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function svgPath(d, cls) {
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('viewBox', '0 0 24 24');
    s.setAttribute('class', cls || 'ic');
    s.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    s.appendChild(p);
    return s;
  }
  function useIcon(id) {
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('class', 'ic');
    s.setAttribute('aria-hidden', 'true');
    const u = document.createElementNS(NS, 'use');
    u.setAttribute('href', '#' + id);
    s.appendChild(u);
    return s;
  }
  function pow10(node, exp) {
    node.append('10');
    const sup = el('sup', '', String(exp));
    node.appendChild(sup);
    return node;
  }
  const glyph = (cls, ch) => el('span', 'g ' + cls, ch);
  const op = (ch) => el('span', 'op', ch);

  /* ------------------------------------------------------------ Entropie-Pools */
  async function sha512(...parts) {
    const len = parts.reduce((s, p) => s + p.length, 0);
    const buf = new Uint8Array(len);
    let o = 0;
    for (const p of parts) { buf.set(p, o); o += p.length; }
    const out = new Uint8Array(await crypto.subtle.digest('SHA-512', buf));
    buf.fill(0);
    return out;
  }
  const f64 = (arr) => new Uint8Array(new Float64Array(arr).buffer);

  // Einmischungen laufen strikt nacheinander, damit keine Bewegungsdaten verloren gehen.
  let handChain = Promise.resolve();
  function mixHand() {
    handChain = handChain.then(async () => {
      const ev = state.events;
      state.events = [];
      const old = state.handPool;
      state.handPool = await sha512(old, te.encode('|hand|'), f64(ev), f64([performance.now(), Date.now()]));
      old.fill(0);
    });
    return handChain;
  }
  async function mixTime(samples) {
    const j = await T.collectJitter(samples);
    const old = state.timePool;
    state.timePool = await sha512(old, te.encode('|time|'), j);
    old.fill(0);
    j.fill(0);
  }
  function recordPointer(e) {
    const list = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
    for (const p of (list.length ? list : [e])) {
      state.events.push(p.clientX, p.clientY, p.timeStamp, performance.now(), p.pressure || 0, p.tiltX || 0, p.tiltY || 0, p.width || 0);
    }
    state.eventsTotal++;
    if (state.events.length > 8 * 4096) mixHand();
  }
  function recordKey(e) {
    // Nur Zeitpunkt und Tastenposition, gehasht in den Pool. Nichts davon wird gespeichert.
    let h = 2166136261;
    const s = e.code || e.key || '';
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    state.events.push(e.timeStamp, performance.now(), h, e.repeat ? 1 : 0, 0, 0, 0, 0);
    state.eventsTotal++;
  }

  /* ------------------------------------------------------------ Selbsttest */
  async function runSelfTest() {
    const btn = $('status'), txt = $('statusText'), list = $('spList');
    btn.dataset.state = 'run';
    txt.textContent = 'Prüfe Kryptographie …';
    let res, ms = 0;
    try {
      const t0 = performance.now();
      res = await T.selfTest();
      ms = performance.now() - t0;
    } catch (e) {
      res = [{ name: 'Web Crypto im Browser', ok: false, error: String((e && e.message) || e) }];
    }
    const ok = res.filter((r) => r.ok).length;
    const all = ok === res.length;
    list.textContent = '';
    res.forEach((r, i) => {
      const li = el('li', r.ok ? 'ok' : 'bad');
      li.style.setProperty('--i', i);
      li.append(svgPath(r.ok ? 'M5 12.5l4.5 4.5L19 7.5' : 'M6 6l12 12M18 6L6 18'), el('span', '', r.name + (r.error ? ` (${r.error})` : '')));
      list.append(li);
    });
    $('spTime').textContent = `${ok}/${res.length} · ${Math.max(1, Math.round(ms))} ms`;
    // Die Ergebnisse sind echt, die Anzeige läuft nur zum Mitlesen gestaffelt durch.
    if (!FX.reduced()) for (const r of res) { txt.textContent = r.name; await wait(60); }
    btn.dataset.state = all ? 'ok' : 'bad';
    txt.textContent = '';
    txt.append(
      el('span', 'st-long', all ? `${ok}/${res.length} Tests bestanden` : `${ok}/${res.length} · Erzeugung gesperrt`),
      el('span', 'st-short', all ? `${ok}/${res.length} geprüft` : 'Gesperrt'),
    );
    if (all) FX.restart(btn, 'verified');
    return all;
  }
  function setupStatus() {
    const btn = $('status'), panel = $('statusPanel');
    const close = () => { panel.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = panel.hidden;
      panel.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', (e) => { if (!panel.hidden && !e.target.closest('.status-wrap')) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) { close(); btn.focus(); } });
  }

  /* ------------------------------------------------------------ Überschrift */
  function splitHeadline() {
    const h = $('headline');
    const words = h.textContent.trim().split(/\s+/);
    h.textContent = '';
    words.forEach((w, i) => {
      const s = el('span', 'w' + (w.startsWith('niemand') ? ' em' : ''), w);
      s.style.setProperty('--i', i);
      h.append(s);
      if (i < words.length - 1) h.append(' ');
    });
  }

  /* ------------------------------------------------------------ Bühne: Bewegung sammeln */
  function setupStage() {
    const st = $('stage');
    stage = new FX.Stage(st, $('stageCanvas'), { ring: $('ring') });
    let lastBump = 0;
    stage.onAbsorb = () => {
      const now = performance.now();
      if (now - lastBump > 150) { lastBump = now; FX.restart($('ring'), 'bump'); }
    };
    let last = null;
    const local = (e) => { const r = st.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    st.addEventListener('pointermove', (e) => {
      if (state.phase !== 'collect') return;
      const p = local(e);
      stage.hover(p.x, p.y);
      recordPointer(e);
      st.classList.add('active');
      if (last && Math.hypot(p.x - last.x, p.y - last.y) < 5) return;
      last = p;
      addScore(1, p);
    });
    st.addEventListener('pointerdown', (e) => {
      if (state.phase !== 'collect' || e.target.closest('button')) return;
      try { st.setPointerCapture(e.pointerId); } catch (_) { /* egal */ }
      const p = local(e);
      stage.hover(p.x, p.y);
      recordPointer(e);
    });
    st.addEventListener('pointerleave', () => { stage.leave(); last = null; });
    st.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') { stage.leave(); last = null; } });
    document.addEventListener('keydown', (e) => {
      if (state.phase !== 'collect' || finishing) return;
      if (e.ctrlKey || e.metaKey || e.altKey || isField(e.target)) return;
      if (e.target.closest && e.target.closest('button, a, summary')) return;
      if (['Tab', 'Shift', 'Escape', 'CapsLock', 'Enter'].includes(e.key)) return;
      if (e.key === ' ' || e.key.startsWith('Arrow')) { if (e.target === st) e.preventDefault(); else return; }
      recordKey(e);
      addScore(3, null);
    });
    $('skipBtn').addEventListener('click', () => finishCollect());
  }
  function addScore(n, p) {
    if (finishing) return;
    state.score += n;
    const prog = Math.min(1, state.score / TARGET);
    if (p) stage.sample(p.x, p.y, prog); else stage.burst(prog);
    setRing(prog);
    if (prog >= 1) finishCollect();
  }
  let ringShown = -1;
  function setRing(prog) {
    $('ringFill').style.strokeDashoffset = (326.73 * (1 - prog)).toFixed(2);
    const pct = Math.floor(prog * 100);
    if (pct !== ringShown) {
      ringShown = pct;
      $('ringPct').textContent = pct;
      if (pct % 10 === 0) $('ring').setAttribute('aria-valuenow', String(pct));
    }
  }

  let finishing = false;
  async function finishCollect() {
    if (finishing) return;
    finishing = true;
    setRing(1);
    const st = $('stage');
    st.classList.remove('active');
    $('collectTitle').textContent = state.ready ? 'Verflechte …' : 'Warte auf den Selbsttest …';
    await readyPromise;
    if (!state.ready) {
      $('collectTitle').textContent = 'Selbsttest fehlgeschlagen';
      $('collectSub').textContent = 'Die Erzeugung bleibt gesperrt, weil dein Browser nicht alle Prüfwerte erreicht hat.';
      return;
    }
    const hadFocus = document.activeElement === st;
    state.phase = 'rope';
    state.busy = true;
    st.dataset.phase = 'implode';
    st.tabIndex = -1;
    st.removeAttribute('aria-describedby');
    st.setAttribute('aria-label', 'Dreistrang-Seil aus Maschine, Hand und Zeit');
    // Ab jetzt fließt jede Bewegung auf der Seite weiter in den Hand-Strang.
    document.addEventListener('pointermove', recordPointer, { passive: true });
    const result = compute();                 // rechnet parallel zur Animation
    await stage.implode();
    st.dataset.phase = 'rope';
    try { reveal(await result); } catch (e) { showError(e); }
    setActions(true);
    setHint();
    if (hadFocus) $('copyBtn').focus({ preventScroll: true });
    bringIntoView();
    if (window.Abo) window.Abo.onFirstPassword();
    state.busy = false;
    if (state.again) { state.again = false; regenerate(); }
  }

  // Nach dem ersten Passwort sanft so weit scrollen, dass Passwort und Kopieren-Knopf sichtbar sind.
  function bringIntoView() {
    const r = document.querySelector('.actions').getBoundingClientRect();
    const overflow = r.bottom + 24 - window.innerHeight;
    if (overflow > 0) window.scrollBy({ top: overflow, behavior: FX.reduced() ? 'auto' : 'smooth' });
  }

  /* ------------------------------------------------------------ Erzeugen */
  function readOptions() {
    const classes = [...document.querySelectorAll('input[name="cls"]:checked')].map((i) => i.value);
    return { length: +$('len').value, classes, excludeAmbiguous: $('amb').checked };
  }
  async function compute() {
    const o = readOptions();
    await Promise.all([mixHand(), mixTime(256)]);
    state.generation++;
    const hand = state.handPool.slice(), time = state.timePool.slice();
    try {
      return await T.generate({ ...o, handEntropy: hand, timeEntropy: time, generation: state.generation });
    } finally {
      hand.fill(0);
      time.fill(0);
    }
  }
  async function regenerate(force) {
    if (!state.ready || state.phase !== 'rope') return;
    if (state.busy) { state.again = true; return; }
    if (force !== true && window.Abo && window.Abo.needsGateForGenerate()) {
      window.Abo.gate('generate', () => regenerate(true));
      return;
    }
    state.busy = true;
    FX.restart($('newBtn'), 'turn');
    try {
      reveal(await compute());
      if (window.Abo) window.Abo.countGeneration();
    } catch (e) { showError(e); }
    finally {
      state.busy = false;
      if (state.again) { state.again = false; regenerate(); }
    }
  }
  let regenTimer = 0;
  function scheduleRegen(ms) { clearTimeout(regenTimer); regenTimer = setTimeout(regenerate, ms); }

  function reveal(r) {
    state.current = r;
    hideTip();
    stage.spin(veiled() ? null : r.strands);
    FX.restart($('mark'), 'pulse');
    if (state.masked) renderMasked(r); else renderReels(r);
    ledgerDirty = true;
    renderLedger();
    updateTheorem();
  }
  function showError(e) {
    const out = $('password');
    out.classList.remove('spinning', 'placeholder', 'masked', 'sealed');
    out.classList.add('error');
    out.textContent = 'Das hat nicht geklappt: ' + ((e && e.message) || e);
  }
  function setActions(on) { ['copyBtn', 'newBtn', 'eyeBtn'].forEach((id) => { $(id).disabled = !on; }); }

  /* ------------------------------------------------------------ Passwort-Darstellung */
  const kindOf = (ch) => (/[0-9]/.test(ch) ? 'cd' : /[A-Za-z]/.test(ch) ? '' : 'cs');
  let revealToken = 0, revealTimer = 0;

  function groups(L, makeChar) {
    const frag = document.createDocumentFragment();
    for (let g = 0; g < L; g += 5) {
      const grp = el('span', 'grp');
      for (let i = g; i < Math.min(L, g + 5); i++) grp.append(makeChar(i));
      frag.append(grp, document.createElement('wbr'));
    }
    return frag;
  }
  function stopReveal() { revealToken++; clearTimeout(revealTimer); }

  function renderPlaceholder(L) {
    const out = $('password');
    out.className = 'pw placeholder';
    out.textContent = '';
    out.append(groups(L, (i) => { const s = el('span', 'ph', '•'); s.style.setProperty('--i', i % 40); return s; }));
    out.setAttribute('aria-label', 'Noch kein Passwort');
  }

  // Walzen: jede Stelle rollt durch M, H und Z und rastet beim Endzeichen ein.
  function renderReels(r) {
    const out = $('password'), L = r.password.length;
    stopReveal();
    const token = revealToken;
    out.className = 'pw';
    $('seal').hidden = true;
    if (FX.reduced()) { renderStatic(r); seal(r); return; }
    out.classList.add('spinning');
    out.setAttribute('aria-busy', 'true');
    const stagger = Math.max(5, Math.min(24, 900 / L)), dur = 780;
    out.textContent = '';
    out.append(groups(L, (i) => {
      const cell = el('span', 'cell');
      const strip = el('span', 'strip');
      strip.style.setProperty('--d', Math.round(i * stagger) + 'ms');
      const k = kindOf(r.password[i]);
      strip.append(el('i', 'm', r.strands.M[i]), el('i', 'h', r.strands.H[i]), el('i', 'z', r.strands.Z[i]), el('i', 'f' + (k ? ' ' + k : ''), r.password[i]));
      cell.append(strip);
      return cell;
    }));
    revealTimer = setTimeout(() => {
      if (token !== revealToken) return;
      renderStatic(r);
      seal(r);
    }, (L - 1) * stagger + dur + 650);
  }
  function renderStatic(r, unveil) {
    const out = $('password'), L = r.password.length;
    out.className = 'pw';
    out.textContent = '';
    out.append(groups(L, (i) => {
      const k = kindOf(r.password[i]);
      const s = el('span', 'ch' + (k ? ' ' + k : '') + (unveil ? ' unveil' : ''), r.password[i]);
      s.dataset.i = i;
      if (unveil) s.style.setProperty('--i', i);
      return s;
    }));
    out.setAttribute('aria-busy', 'false');
    out.setAttribute('aria-label', `Passwort mit ${L} Zeichen`);
  }
  function renderMasked(r) {
    const out = $('password');
    stopReveal();
    out.className = 'pw masked';
    out.textContent = '';
    out.append(groups(r.password.length, (i) => { const s = el('span', 'mk-dot', '•'); s.style.setProperty('--i', i); return s; }));
    out.setAttribute('aria-busy', 'false');
    out.setAttribute('aria-label', 'Passwort verborgen');
    $('seal').hidden = true;
  }
  function seal(r) {
    FX.restart($('password'), 'sealed');
    const s = $('seal');
    s.hidden = false;
    $('sealText').textContent = `Verflochten · ${fmtBits(r.entropyBits)} Bit`;
    FX.restart(s, 'go');
  }

  /* ------------------------------------------------------------ Tooltip: Rechnung einer Stelle */
  function indices(r, i) {
    const A = r.alphabet, n = A.length;
    const m = A.indexOf(r.strands.M[i]), h = A.indexOf(r.strands.H[i]), z = A.indexOf(r.strands.Z[i]);
    return { m, h, z, n, f: (m + h + z) % n };
  }
  function showTip(i) {
    const r = state.current;
    if (!r || veiled()) return;
    const out = $('password');
    const c = out.querySelector(`.ch[data-i="${i}"]`);
    if (!c) return;
    state.activeIdx = i;
    out.querySelectorAll('.ch.active').forEach((x) => x.classList.remove('active'));
    c.classList.add('active');
    const { m, h, z, n, f } = indices(r, i);
    const tip = $('tip');
    tip.textContent = '';
    const eq = el('div', 'tip-eq');
    eq.append(glyph('m', r.strands.M[i]), op('+'), glyph('h', r.strands.H[i]), op('+'), glyph('z', r.strands.Z[i]), op('='), glyph('f', r.password[i]));
    tip.append(eq, el('div', 'tip-math', `(${m} + ${h} + ${z}) mod ${n} = ${f}`), el('div', 'tip-pos', `Stelle ${i + 1} von ${r.password.length}`));
    tip.hidden = false;
    const wrap = $('pwWrap').getBoundingClientRect(), cr = c.getBoundingClientRect();
    const tw = tip.offsetWidth;
    const x = cr.left - wrap.left + cr.width / 2;
    const cx = Math.max(tw / 2 + 4, Math.min(wrap.width - tw / 2 - 4, x));
    tip.style.left = cx + 'px';
    tip.style.top = (cr.top - wrap.top) + 'px';
    tip.style.setProperty('--ax', (50 + ((x - cx) / tw) * 100).toFixed(1) + '%');
    syncLedger(i);
  }
  function hideTip() {
    state.activeIdx = -1;
    $('tip').hidden = true;
    $('password').querySelectorAll('.ch.active').forEach((x) => x.classList.remove('active'));
    syncLedger(-1);
  }
  function setupTip() {
    const out = $('password');
    out.addEventListener('pointerover', (e) => {
      const c = e.target.closest('.ch');
      if (c && e.pointerType === 'mouse') showTip(+c.dataset.i);
    });
    out.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hideTip(); });
    out.addEventListener('click', (e) => {
      const c = e.target.closest('.ch');
      if (!c) return;
      const i = +c.dataset.i;
      if (state.activeIdx === i && e.pointerType !== 'mouse') hideTip(); else showTip(i);
    });
    out.addEventListener('keydown', (e) => {
      const r = state.current;
      if (!r || veiled()) return;
      const L = r.password.length;
      let i = state.activeIdx;
      if (e.key === 'ArrowRight') i = i < 0 ? 0 : Math.min(L - 1, i + 1);
      else if (e.key === 'ArrowLeft') i = i < 0 ? 0 : Math.max(0, i - 1);
      else if (e.key === 'Home') i = 0;
      else if (e.key === 'End') i = L - 1;
      else if (e.key === 'Escape') { hideTip(); return; }
      else return;
      e.preventDefault();
      showTip(i);
    });
    out.addEventListener('blur', hideTip);
    document.addEventListener('pointerdown', (e) => { if (!e.target.closest('#password, #ledger')) hideTip(); });
    window.addEventListener('resize', hideTip);
  }

  /* ------------------------------------------------------------ Geflecht im Detail */
  let ledgerDirty = true;
  function renderLedger() {
    const r = state.current, box = $('ledger');
    if (!r || !$('braid').open) return;
    ledgerDirty = false;
    box.textContent = '';
    if (veiled()) { $('ledgerNote').textContent = 'Verborgen, solange das Passwort nicht sichtbar ist.'; return; }
    const L = r.password.length;
    const rows = [['m', r.strands.M], ['h', r.strands.H], ['z', r.strands.Z], ['f', r.password]];
    const frag = document.createDocumentFragment();
    for (let g = 0, b = 0; g < L; g += 5, b++) {
      const blk = el('div', 'lblock');
      blk.style.setProperty('--i', b);
      for (const [cls, str] of rows) {
        const row = el('span', 'lrow ' + cls);
        for (let i = g; i < Math.min(L, g + 5); i++) { const s = el('span', '', str[i]); s.dataset.i = i; row.append(s); }
        blk.append(row);
      }
      frag.append(blk);
    }
    box.append(frag);
    $('ledgerNote').textContent =
      `Jede Spalte: (M + H + Z) mod ${r.alphabetSize}. Versuch ${fmtInt(r.attempts)} hat alle Regeln erfüllt. ` +
      `Verbraucht: M ${fmtInt(r.bytesUsed.M)} B, H ${fmtInt(r.bytesUsed.H)} B, Z ${fmtInt(r.bytesUsed.Z)} B. ` +
      `Bewegungen und Tasten im Hand-Strang bisher: ${fmtInt(state.eventsTotal)}.`;
  }
  function syncLedger(i) {
    const box = $('ledger');
    box.querySelectorAll('span.active').forEach((x) => x.classList.remove('active'));
    if (i >= 0) box.querySelectorAll(`.lrow span[data-i="${i}"]`).forEach((x) => x.classList.add('active'));
  }
  function setupLedger() {
    $('braid').addEventListener('toggle', () => { if ($('braid').open && ledgerDirty) renderLedger(); });
    $('ledger').addEventListener('pointerover', (e) => {
      const s = e.target.closest('.lrow span');
      if (s && e.pointerType === 'mouse') showTip(+s.dataset.i);
    });
    $('ledger').addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hideTip(); });
  }

  /* ------------------------------------------------------------ Geflecht-Satz: Beispiel aus dem eigenen Passwort */
  function updateTheorem() {
    const r = state.current;
    const eq = $('thmEq');
    if (!r || veiled()) {
      $('thmCap').textContent = 'Beispiel';
      eq.textContent = '';
      eq.append(glyph('m', 'k'), op('+'), glyph('h', '$'), op('+'), glyph('z', 'r'), op('='), glyph('f', '}'));
      $('thmMath').textContent = '(10 + 65 + 17) mod 94 = 92';
      return;
    }
    const { m, h, z, n, f } = indices(r, 0);
    $('thmCap').textContent = 'Erste Stelle deines Passworts';
    eq.textContent = '';
    eq.append(glyph('m', r.strands.M[0]), op('+'), glyph('h', r.strands.H[0]), op('+'), glyph('z', r.strands.Z[0]), op('='), glyph('f', r.password[0]));
    FX.restart(eq, 'swap');
    $('thmMath').textContent = `(${m} + ${h} + ${z}) mod ${n} = ${f}`;
  }

  /* ------------------------------------------------------------ Kopieren & Zwischenablage */
  let copyTimer = 0, clipTimer = 0, clipLeft = 0, clipPending = false;
  const CLIP_SECONDS = 60;
  function copyPassword(e) {
    if (!state.current) return;
    FX.ripple($('copyBtn'), e);
    // Die Aktion läuft im Klick auf „Weiter“, damit der Browser das Kopieren erlaubt.
    if (window.Abo) window.Abo.gate('copy', doCopy); else doCopy();
  }
  async function doCopy() {
    const r = state.current;
    if (!r) return;
    const btn = $('copyBtn');
    try {
      await navigator.clipboard.writeText(r.password);
      btn.classList.add('done');
      $('copyLabel').textContent = 'Kopiert';
      startClip();
      try { if (navigator.vibrate && !FX.reduced()) navigator.vibrate(8); } catch (_) { /* egal */ }
    } catch (_) {
      selectPassword();
      $('copyLabel').textContent = 'Markiert, jetzt Strg+C';
    }
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => { btn.classList.remove('done'); $('copyLabel').textContent = 'Kopieren'; }, 1900);
  }
  function selectPassword() {
    if (state.masked) toggleMask(false);
    if ($('password').classList.contains('spinning')) { stopReveal(); renderStatic(state.current); }
    const range = document.createRange();
    range.selectNodeContents($('password'));
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
  function startClip() {
    clearInterval(clipTimer);
    clipLeft = CLIP_SECONDS;
    clipPending = false;
    $('clip').hidden = false;
    $('clipNow').hidden = false;
    $('clipKeep').hidden = false;
    renderClip();
    clipTimer = setInterval(() => {
      clipLeft--;
      renderClip();
      if (clipLeft <= 0) clearClipboard();
    }, 1000);
  }
  function renderClip() {
    const t = $('clipText');
    t.textContent = '';
    const b = el('b', '', `${Math.max(0, clipLeft)} s`);
    t.append('In der Zwischenablage. Wird in ', b, ' geleert.');
    $('clipRing').style.strokeDashoffset = (94.25 * (1 - Math.max(0, clipLeft) / CLIP_SECONDS)).toFixed(2);
  }
  async function clearClipboard() {
    clearInterval(clipTimer);
    clipLeft = 0;
    try {
      if (!document.hasFocus()) throw new Error('nicht im Fokus');
      await navigator.clipboard.writeText('');
      clipPending = false;
      $('clipText').textContent = 'Zwischenablage geleert.';
      $('clipRing').style.strokeDashoffset = '94.25';
      $('clipNow').hidden = true;
      $('clipKeep').hidden = true;
      setTimeout(() => { if (!clipPending && clipLeft <= 0) $('clip').hidden = true; }, 2600);
    } catch (_) {
      clipPending = true;
      $('clipText').textContent = 'Wird geleert, sobald du zu dieser Seite zurückkehrst.';
    }
  }
  function cancelClip() {
    clearInterval(clipTimer);
    clipPending = false;
    clipLeft = 0;
    $('clip').hidden = true;
  }

  /* ------------------------------------------------------------ Verbergen */
  function toggleMask(force) {
    state.masked = typeof force === 'boolean' ? force : !state.masked;
    const b = $('eyeBtn');
    const label = state.masked ? 'Passwort zeigen' : 'Passwort verbergen';
    b.setAttribute('aria-pressed', String(state.masked));
    b.setAttribute('aria-label', label);
    b.title = label;
    stage.setMasked(veiled());
    hideTip();
    $('braid').hidden = veiled();
    updateTheorem();
    if (!state.current) return;
    if (state.masked) renderMasked(state.current);
    else { renderStatic(state.current, true); seal(state.current); }
  }

  /* ------------------------------------------------------------ Einstellungen */
  function setupSettings() {
    const len = $('len');
    len.addEventListener('input', () => setLen(+len.value));
    len.addEventListener('change', () => scheduleRegen(0));
    document.querySelectorAll('input[name="preset"]').forEach((p) => {
      p.addEventListener('change', () => { if (p.checked) { setLen(+p.value); scheduleRegen(0); } });
    });
    document.querySelectorAll('input[name="cls"]').forEach((cb) => {
      cb.addEventListener('change', () => {
        if (!readOptions().classes.length) {
          cb.checked = true;
          FX.restart(cb.closest('.chip'), 'shake');
          $('optsHint').textContent = 'Mindestens eine Zeichenart muss aktiv bleiben.';
          return;
        }
        $('optsHint').textContent = '';
        updateStrength();
        scheduleRegen(60);
      });
    });
    $('amb').addEventListener('change', () => { updateStrength(); scheduleRegen(60); });
    $('opts').addEventListener('submit', (e) => e.preventDefault());
    window.addEventListener('resize', moveSeg);
    setLen(+len.value, true);
  }
  function setLen(v, silent) {
    const len = $('len');
    if (window.Abo && v > window.Abo.maxLength()) {
      v = window.Abo.maxLength();
      if (!silent) window.Abo.offer('length');
    }
    len.value = v;
    const pct = ((v - +len.min) / (+len.max - +len.min)) * 100;
    len.style.setProperty('--p', pct.toFixed(2) + '%');
    const lv = $('lenVal');
    if (lv.textContent !== String(v)) { lv.textContent = v; if (!silent) FX.restart(lv, 'tick'); }
    document.querySelectorAll('input[name="preset"]').forEach((p) => { p.checked = +p.value === v; });
    moveSeg();
    updateStrength();
    if (!state.current) renderPlaceholder(v);
  }
  function moveSeg() {
    const ind = $('segInd');
    const checked = document.querySelector('input[name="preset"]:checked');
    if (!checked) { ind.style.opacity = '0'; return; }
    const lab = checked.nextElementSibling;
    ind.style.opacity = '1';
    ind.style.width = lab.offsetWidth + 'px';
    ind.style.transform = `translateX(${lab.offsetLeft}px)`;
  }

  /* ------------------------------------------------------------ Stärke & kosmische Leiter */
  // Landauer-Grenze: Jede irreversible Bit-Operation kostet mindestens k·T·ln 2.
  // T = 2,725 K (kosmischer Mikrowellenhintergrund).
  const LOG10_KTLN2 = Math.log10(1.380649e-23 * 2.725 * Math.LN2);
  const BENCH = [ // von oben nach unten
    { log: 70.13, icon: 'i-universe', name: 'Beobachtbares Universum', sub: 'gesamte Masse-Energie, E = mc²', long: 'die gesamte Masse-Energie des beobachtbaren Universums' },
    { log: 59.43, icon: 'i-galaxy', name: 'Milchstraße', sub: 'gesamte Masse-Energie, E = mc²', long: 'die gesamte Masse-Energie der Milchstraße' },
    { log: 44.08, icon: 'i-sunlife', name: 'Sonne, ganzes Leben', sub: 'Strahlung in 10 Mrd. Jahren', long: 'alles, was die Sonne in 10 Milliarden Jahren abstrahlt' },
    { log: 34.08, icon: 'i-sun', name: 'Sonne, ein Jahr', sub: 'Strahlung in einem Jahr', long: 'alles, was die Sonne in einem Jahr abstrahlt' },
    { log: 20.78, icon: 'i-bolt', name: 'Menschheit, ein Jahr', sub: 'gesamter Energieverbrauch', long: 'der gesamte Energieverbrauch der Menschheit in einem Jahr' },
  ];
  const UNIVERSE_BITS = (BENCH[0].log - LOG10_KTLN2) / Math.log10(2);
  const LEVELS = [
    { min: -Infinity, name: 'Zu schwach' },
    { min: 64, name: 'Mittel' },
    { min: 100, name: 'Stark' },
    { min: 128, name: 'Extrem stark' },
    { min: UNIVERSE_BITS, name: 'Unnötig sicher' },
  ];

  function buildLadder() {
    const list = $('rungs');
    list.textContent = '';
    for (const b of BENCH) {
      const li = el('li', 'rung');
      li.dataset.log = b.log;
      const ico = el('span', 'ico'); ico.append(useIcon(b.icon));
      const nm = el('span', 'nm', b.name); nm.append(el('small', '', b.sub));
      const ev = el('span', 'ev'); ev.append('≈ '); pow10(ev, Math.round(b.log)); ev.append(' J');
      li.append(ico, nm, ev);
      list.append(li);
    }
    const you = el('li', 'you'); you.id = 'you';
    const ico = el('span', 'ico'); ico.append(useIcon('i-shield'));
    const nm = el('span', 'nm', 'Dein Passwort'); const sub = el('small', '', 'Energie zum Durchzählen'); nm.append(sub);
    const ev = el('span', 'ev'); ev.id = 'youEv';
    you.append(ico, nm, ev);
    list.append(you);
  }
  function placeLadder(lg) {
    const list = $('rungs'), you = $('you');
    const rows = [...list.children];
    const rungs = rows.filter((x) => x !== you);
    const ref = rungs.find((r) => +r.dataset.log <= lg) || null;
    if (you.nextElementSibling !== ref || (ref === null && list.lastElementChild !== you)) {
      FX.flip(rows, () => list.insertBefore(you, ref));
    }
    const below = rungs.filter((r) => +r.dataset.log <= lg);
    rungs.forEach((r) => {
      const on = +r.dataset.log <= lg;
      const fromBottom = below.length - 1 - below.indexOf(r);
      r.style.setProperty('--delay', (on ? 0.12 + fromBottom * 0.1 : 0).toFixed(2) + 's');
      r.classList.toggle('on', on);
    });
    const ladder = $('ladder');
    const center = you.offsetTop + you.offsetHeight / 2;
    const fill = Math.max(0, ladder.clientHeight - center);
    $('railFill').style.height = fill + 'px';
    $('railHead').style.bottom = fill + 'px';
    ladder.classList.toggle('beyond', lg >= BENCH[0].log);
    const ev = $('youEv');
    ev.textContent = '';
    if (lg < 3) ev.append(`≈ ${fmtInt(Math.max(1, Math.round(Math.pow(10, lg))))}`);
    else pow10(ev, Math.floor(lg));
    ev.append(' J');
  }

  function timePhrase(log10s) {
    if (log10s < 0) return 'unter einer Sekunde';
    const s = Math.pow(10, log10s);
    if (s < 120) return `${Math.round(s)} Sekunden`;
    if (s < 7200) return `${Math.round(s / 60)} Minuten`;
    if (s < 172800) return `${Math.round(s / 3600)} Stunden`;
    const ly = log10s - Math.log10(31557600);
    if (ly < 0) return `${Math.round(s / 86400)} Tage`;
    const y = Math.pow(10, ly);
    if (y < 1e6) return `${fmtInt(Math.round(y))} Jahre`;
    if (y < 1e9) return `${(y / 1e6).toLocaleString('de-DE', { maximumFractionDigits: 1 })} Millionen Jahre`;
    if (y < 1.38e10) return `${(y / 1e9).toLocaleString('de-DE', { maximumFractionDigits: 1 })} Milliarden Jahre`;
    return null;
  }
  // Faktor als Element: unter 1.000 als echte Zahl („35-mal“), darüber als Zehnerpotenz.
  function factorNode(log10f, suffix) {
    const b = el('b');
    if (log10f < 3) b.append(fmtInt(Math.max(1, Math.floor(Math.pow(10, log10f)))));
    else pow10(b, Math.floor(log10f));
    b.append(suffix);
    return b;
  }
  function energyText(bits, lg) {
    const box = $('energyText');
    box.textContent = '';
    if (bits < 64) {
      box.append(el('p', 'warnline', 'Das ist zu wenig. Mit ein paar Grafikkarten lässt sich so ein Passwort in kurzer Zeit durchprobieren. Nimm mehr Zeichen.'));
    }
    // Energie (Landauer)
    const passed = BENCH.find((b) => lg >= b.log);
    if (passed) {
      const p = el('p');
      p.append('Allein um alle Möglichkeiten durchzuzählen, bräuchte ein physikalisch perfekter Computer mindestens ');
      const b = el('b'); pow10(b, Math.floor(lg)); b.append(' Joule');
      p.append(b, '. ');
      if (lg - passed.log >= Math.log10(2)) {
        p.append('Das ist ', factorNode(lg - passed.log, '-mal'), ' so viel wie ' + passed.long + '.');
      } else {
        p.append('Das ist mehr als ' + passed.long + '.');
      }
      box.append(p);
    }
    // Zeit bei einer Billion Versuchen pro Sekunde (im Mittel die Hälfte des Raums)
    const log10s = (bits - 1) * Math.log10(2) - 12;
    const q = el('p');
    q.append('Selbst mit einer Billion Versuchen pro Sekunde dauert das Erraten im Schnitt ');
    const phrase = timePhrase(log10s);
    if (phrase) {
      q.append(el('b', '', phrase), '.');
    } else {
      q.append(factorNode(log10s - Math.log10(31557600) - Math.log10(1.38e10), '-mal so lange, wie das Universum alt ist'), '.');
    }
    box.append(q);
  }
  function setRating(bits) {
    let lvl = 0;
    LEVELS.forEach((L, i) => { if (bits >= L.min) lvl = i; });
    const r = $('rating');
    if (r.textContent !== LEVELS[lvl].name) {
      r.textContent = LEVELS[lvl].name;
      r.dataset.level = String(lvl + 1);
      FX.restart(r, 'changed');
    }
  }
  function updateStrength() {
    const o = readOptions();
    let bits = NaN;
    try {
      const { sizes } = T.buildAlphabet(o.classes, o.excludeAmbiguous);
      if (o.length >= sizes.length) bits = T.entropyBits(sizes, o.length);
    } catch (_) { /* ungültige Auswahl */ }
    if (!isFinite(bits)) { $('bits').textContent = '–'; return; }
    FX.countTo($('bits'), state.lastBits, bits, { dur: 750, fmt: fmtBits });
    state.lastBits = bits;
    const lg = bits * Math.log10(2) + LOG10_KTLN2;   // log10(Joule)
    setRating(bits);
    energyText(bits, lg);
    placeLadder(lg);
  }

  /* ------------------------------------------------------------ Knöpfe, Kürzel, Thema */
  function setupActions() {
    $('copyBtn').addEventListener('click', copyPassword);
    $('newBtn').addEventListener('click', (e) => { FX.ripple($('newBtn'), e); regenerate(); });
    $('eyeBtn').addEventListener('click', () => toggleMask());
    $('clipNow').addEventListener('click', () => clearClipboard());
    $('clipKeep').addEventListener('click', cancelClip);
    window.addEventListener('focus', () => { if (clipPending) clearClipboard(); });
    document.addEventListener('keydown', (e) => {
      if (state.phase !== 'rope' || e.ctrlKey || e.metaKey || e.altKey || isField(e.target)) return;
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); FX.ripple($('newBtn')); regenerate(); }
    });
  }
  function setupTheme() {
    const refresh = () => stage && stage.refreshTheme();
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    if (mq.addEventListener) mq.addEventListener('change', refresh);
    new MutationObserver(refresh).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  function setHint() {
    if (!state.current) return;
    $('pwHint').textContent = state.locked
      ? 'Kostenlos bleibt das Passwort verschwommen. Klick darauf, um es nach einer Wartezeit kurz zu sehen.'
      : window.matchMedia('(hover: none)').matches
        ? 'Tipp: Tippe auf ein Zeichen, um seine Verflechtung zu sehen.'
        : 'Tipp: Fahr über ein Zeichen oder wähle es mit den Pfeiltasten, um seine Verflechtung zu sehen.';
  }

  /* ------------------------------------------------------------ Schnittstelle für abo.js */
  function setLocked(on) {
    state.locked = !!on;
    $('pwWrap').classList.toggle('locked', state.locked);
    $('password').setAttribute('aria-hidden', state.locked ? 'true' : 'false');
    setHint();
    if (!stage) return;
    stage.setMasked(veiled());
    hideTip();
    $('braid').hidden = veiled();
    updateTheorem();
    if (!veiled()) { ledgerDirty = true; renderLedger(); }
  }
  window.App = {
    setLocked,
    applyLimits() { if (inited) setLen(+$('len').value, true); },
  };

  /* ------------------------------------------------------------ Start */
  async function init() {
    splitHeadline();
    state.handPool = await sha512(te.encode(T.VERSION + '/hand/init'), f64([performance.now(), Date.now()]));
    state.timePool = await sha512(te.encode(T.VERSION + '/time/init'), f64([performance.now()]));
    buildLadder();
    setupStatus();
    setupStage();
    setupTip();
    setupLedger();
    setupSettings();
    setupActions();
    setupTheme();
    if (window.Abo) setLocked(!window.Abo.isPro());
    inited = true;
    readyPromise = (async () => {
      const ok = await runSelfTest();
      if (ok) await mixTime(2048);   // kräftige Grundfüllung des Zeit-Strangs
      state.ready = ok;
      return ok;
    })();
  }
  init();
})();
