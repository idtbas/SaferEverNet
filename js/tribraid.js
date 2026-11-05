/*!
 * TRIBRAID v1 — Dreistrang-Geflecht-Passwortgenerator
 *
 * Idee in einem Satz:
 *   Drei unabhängige Entropiequellen laufen durch drei verschiedene
 *   Kryptofamilien, werden je unverzerrt auf das Alphabet abgebildet und
 *   zeichenweise per Addition modulo n verflochten. Danach wird das ganze Wort
 *   so lange verworfen, bis alle Regeln erfüllt sind (exakte Gleichverteilung).
 *
 * Stränge
 *   M  „Maschine“  rohe Bytes aus crypto.getRandomValues (OS-CSPRNG)
 *   H  „Hand“      Zeigerbewegungen → HKDF-SHA-256 → AES-256-CTR-Schlüsselstrom
 *   Z  „Zeit“      CPU-/Timer-Jitter → HMAC-SHA-512 (Extract) → HMAC-SHA-512-Zählermodus
 *
 * Geflecht-Satz (Begründung der Sicherheit)
 *   Seien M_i, H_i, Z_i ∈ Z_n unabhängig, und M_i gleichverteilt.
 *   Dann ist F_i = (M_i + H_i + Z_i) mod n gleichverteilt und unabhängig von
 *   (H_i, Z_i): Für jedes feste h, z ist m ↦ m + h + z eine Bijektion auf Z_n.
 *   Dasselbe gilt symmetrisch für H oder Z. → Das Passwort ist so stark wie
 *   der STÄRKSTE Strang, nicht wie der schwächste.
 *
 * Läuft im Browser (window.Tribraid) und in Node ≥ 19 (module.exports).
 */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Tribraid = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  const cryptoObj = root.crypto;
  const subtle = cryptoObj && cryptoObj.subtle;
  const te = new TextEncoder();
  const VERSION = 'TRIBRAID-1';

  /* ------------------------------------------------------------------ *
   * Alphabet
   * ------------------------------------------------------------------ */
  const CLASSES = [
    { id: 'lower',   chars: 'abcdefghijklmnopqrstuvwxyz' },
    { id: 'upper',   chars: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' },
    { id: 'digits',  chars: '0123456789' },
    { id: 'symbols', chars: '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~' },
  ];
  const AMBIGUOUS = new Set(['I', 'l', '1', '|', 'O', '0', 'o']);

  /** Baut das (disjunkte) Alphabet aus den gewählten Klassen. */
  function buildAlphabet(classIds, excludeAmbiguous) {
    const chosen = CLASSES.filter((c) => classIds.includes(c.id));
    const classes = chosen
      .map((c) => ({ id: c.id, chars: [...c.chars].filter((ch) => !(excludeAmbiguous && AMBIGUOUS.has(ch))) }))
      .filter((c) => c.chars.length > 0);
    const alphabet = classes.flatMap((c) => c.chars);
    if (alphabet.length < 2) throw new Error('Alphabet zu klein');
    if (alphabet.length > 256) throw new Error('Alphabet zu groß');
    // Index → Klassennummer, für die Regelprüfung
    const classOf = new Uint8Array(alphabet.length);
    let k = 0;
    classes.forEach((c, ci) => { for (let j = 0; j < c.chars.length; j++) classOf[k++] = ci; });
    return { alphabet, classes, classOf, sizes: classes.map((c) => c.chars.length) };
  }

  /* ------------------------------------------------------------------ *
   * Kleine Byte-Helfer
   * ------------------------------------------------------------------ */
  function concatBytes(...arrs) {
    const len = arrs.reduce((s, a) => s + a.length, 0);
    const out = new Uint8Array(len);
    let o = 0;
    for (const a of arrs) { out.set(a, o); o += a.length; }
    return out;
  }
  function u32be(n) { return new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]); }
  function wipe(...arrs) { for (const a of arrs) if (a && typeof a.fill === 'function') a.fill(0); }
  function hex(b) { return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(''); }
  function unhex(s) { const o = new Uint8Array(s.length / 2); for (let i = 0; i < o.length; i++) o[i] = parseInt(s.substr(i * 2, 2), 16); return o; }

  function randomBytes(n) {
    const out = new Uint8Array(n);
    for (let o = 0; o < n; o += 65536) cryptoObj.getRandomValues(out.subarray(o, Math.min(n, o + 65536)));
    return out;
  }

  async function sha(hash, data) { return new Uint8Array(await subtle.digest(hash, data)); }
  async function hmac(hash, key, data) {
    const k = await subtle.importKey('raw', key, { name: 'HMAC', hash }, false, ['sign']);
    return new Uint8Array(await subtle.sign('HMAC', k, data));
  }
  async function hkdf(hash, ikm, salt, info, len) {
    const k = await subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
    return new Uint8Array(await subtle.deriveBits({ name: 'HKDF', hash, salt, info }, k, len * 8));
  }

  /* ------------------------------------------------------------------ *
   * Byte-Ströme (einer pro Strang)
   * ------------------------------------------------------------------ */
  class ByteStream {
    constructor(name, refill) { this.name = name; this.refill = refill; this.buf = new Uint8Array(0); this.pos = 0; this.used = 0; }
    async byte() {
      if (this.pos >= this.buf.length) { wipe(this.buf); this.buf = await this.refill(); this.pos = 0; }
      this.used++;
      return this.buf[this.pos++];
    }
    destroy() { wipe(this.buf); this.buf = new Uint8Array(0); this.refill = null; }
  }

  /** Strang M: rohe Bytes vom Betriebssystem. Keine Nachbearbeitung, nichts, das schiefgehen kann. */
  function machineStream() {
    return new ByteStream('M', async () => randomBytes(1024));
  }

  /** Addiert n Blöcke auf die unteren 64 Bit eines 128-Bit-CTR-Zählers (wie WebCrypto mit length: 64). */
  function addCounter(iv, n) {
    const c = iv.slice();
    let carry = BigInt(n);
    for (let i = 15; i >= 8 && carry > 0n; i--) {
      const s = BigInt(c[i]) + (carry & 0xffn);
      c[i] = Number(s & 0xffn);
      carry = (carry >> 8n) + (s >> 8n);
    }
    return c;
  }

  /** Strang H: Bewegungsdaten → HKDF-SHA-256 → AES-256-CTR-Schlüsselstrom. */
  async function handStream(handEntropy, ctx) {
    const km = await hkdf('SHA-256', concatBytes(te.encode('hand:'), handEntropy), te.encode(VERSION + '/hand/salt'), ctx, 48);
    const key = await subtle.importKey('raw', km.subarray(0, 32), { name: 'AES-CTR' }, false, ['encrypt']);
    const iv = km.slice(32, 48);
    wipe(km);
    const CHUNK = 1024;
    let blocks = 0;
    return new ByteStream('H', async () => {
      const counter = addCounter(iv, blocks);
      blocks += CHUNK / 16;
      return new Uint8Array(await subtle.encrypt({ name: 'AES-CTR', counter, length: 64 }, key, new Uint8Array(CHUNK)));
    });
  }

  /** Strang Z: Jitter → HMAC-SHA-512-Extract → HMAC-SHA-512 im Zählermodus. */
  async function timeStream(timeEntropy, ctx) {
    const prk = await hmac('SHA-512', te.encode(VERSION + '/time/salt'), concatBytes(te.encode('time:'), timeEntropy));
    const key = await subtle.importKey('raw', prk, { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
    wipe(prk);
    const label = concatBytes(te.encode('stream|'), ctx);
    let i = 0;
    return new ByteStream('Z', async () => {
      const parts = [];
      for (let j = 0; j < 16; j++) parts.push(subtle.sign('HMAC', key, concatBytes(label, u32be(i++))));
      return concatBytes(...(await Promise.all(parts)).map((b) => new Uint8Array(b)));
    });
  }

  /** Unverzerrte Zahl aus [0, n) per Rejection Sampling (kein Modulo-Bias). */
  async function uniformIndex(stream, n) {
    let m = 1;
    while (m < n) m <<= 1;
    const mask = m - 1;
    for (;;) {
      const v = (await stream.byte()) & mask;
      if (v < n) return v;
    }
  }

  /* ------------------------------------------------------------------ *
   * Exakte Entropie per Inklusion–Exklusion
   *   |gültig| = Σ_{S ⊆ Klassen} (−1)^{|S|} · (n − Σ_{c∈S} |c|)^L
   * ------------------------------------------------------------------ */
  function countValid(sizes, L) {
    const n = sizes.reduce((a, b) => a + b, 0);
    const k = sizes.length;
    let total = 0n;
    for (let mask = 0; mask < (1 << k); mask++) {
      let removed = 0, bits = 0;
      for (let j = 0; j < k; j++) if (mask & (1 << j)) { removed += sizes[j]; bits++; }
      const term = BigInt(n - removed) ** BigInt(L);
      total += bits % 2 ? -term : term;
    }
    return total;
  }
  function log2Big(x) {
    if (x <= 0n) return -Infinity;
    const s = x.toString(2);
    if (s.length <= 53) return Math.log2(Number(x));
    return Math.log2(Number(BigInt('0b' + s.slice(0, 53)))) + (s.length - 53);
  }
  function entropyBits(sizes, L) { return log2Big(countValid(sizes, L)); }

  /* ------------------------------------------------------------------ *
   * Jitter-Sammler (Strang Z)
   *   Zählt, wie oft eine Schleife laufen muss, bis die Uhr weitertickt.
   *   Wie viele Durchläufe genau passen, hängt von Caches, Interrupts,
   *   Taktsprüngen und anderen Prozessen ab, also von echtem Rauschen.
   * ------------------------------------------------------------------ */
  async function collectJitter(samples) {
    const perf = root.performance;
    const out = new Uint32Array(samples * 3);
    for (let s = 0; s < samples; s++) {
      const t0 = perf.now();
      let t1 = t0, count = 0, acc = s;
      do { acc = (acc * 1103515245 + 12345) >>> 0; t1 = perf.now(); count++; } while (t1 === t0 && count < 1e6);
      out[3 * s] = count;
      out[3 * s + 1] = Math.floor((t1 - Math.floor(t1)) * 4294967295) >>> 0;
      out[3 * s + 2] = acc;
      if ((s & 127) === 127) await new Promise((r) => setTimeout(r, 0));
    }
    return new Uint8Array(out.buffer);
  }

  /* ------------------------------------------------------------------ *
   * Hauptfunktion
   * ------------------------------------------------------------------ */
  /**
   * @param {object} o
   * @param {number} o.length
   * @param {string[]} o.classes          z. B. ['lower','upper','digits','symbols']
   * @param {boolean} [o.excludeAmbiguous]
   * @param {Uint8Array} o.handEntropy    Rohdaten Strang H
   * @param {Uint8Array} o.timeEntropy    Rohdaten Strang Z
   * @param {number} [o.generation]       Zähler, trennt aufeinanderfolgende Passwörter
   */
  async function generate(o) {
    const L = o.length | 0;
    const { alphabet, classes, classOf, sizes } = buildAlphabet(o.classes, !!o.excludeAmbiguous);
    const n = alphabet.length;
    const k = classes.length;
    if (L < k) throw new Error('Länge kleiner als Anzahl der Pflicht-Zeichenarten');
    if (L > 1024) throw new Error('Länge zu groß');
    if (!o.handEntropy || o.handEntropy.length < 1 || !o.timeEntropy || o.timeEntropy.length < 1) throw new Error('Strang-Entropie fehlt');

    // Kontext bindet jeden Strang an genau diese Anfrage (Domänentrennung).
    const ctx = te.encode(`${VERSION}|n=${n}|L=${L}|cls=${classes.map((c) => c.id).join(',')}|g=${o.generation | 0}`);

    const M = machineStream();
    const H = await handStream(o.handEntropy, ctx);
    const Z = await timeStream(o.timeEntropy, ctx);

    const m = new Uint8Array(L), h = new Uint8Array(L), z = new Uint8Array(L), f = new Uint8Array(L);
    const seen = new Uint8Array(k);
    let attempts = 0;
    try {
      for (;;) {
        attempts++;
        if (attempts > 100000) throw new Error('Zu viele Versuche');
        seen.fill(0);
        for (let i = 0; i < L; i++) {
          m[i] = await uniformIndex(M, n);
          h[i] = await uniformIndex(H, n);
          z[i] = await uniformIndex(Z, n);
          f[i] = (m[i] + h[i] + z[i]) % n;     // ← die Verflechtung
          seen[classOf[f[i]]] = 1;
        }
        if (seen.every((x) => x === 1)) break;  // sonst: ganzes Wort verwerfen
      }
      const toStr = (arr) => Array.from(arr, (i) => alphabet[i]).join('');
      return {
        password: toStr(f),
        strands: { M: toStr(m), H: toStr(h), Z: toStr(z) },
        alphabet: alphabet.join(''),
        alphabetSize: n,
        attempts,
        bytesUsed: { M: M.used, H: H.used, Z: Z.used },
        entropyBits: entropyBits(sizes, L),
      };
    } finally {
      M.destroy(); H.destroy(); Z.destroy();
      wipe(m, h, z, f);
    }
  }

  /* ------------------------------------------------------------------ *
   * Selbsttest beim Start („Power-On Self-Test“)
   * ------------------------------------------------------------------ */
  async function selfTest() {
    const results = [];
    const check = async (name, fn) => {
      try { const ok = await fn(); results.push({ name, ok: !!ok }); }
      catch (e) { results.push({ name, ok: false, error: String(e && e.message || e) }); }
    };

    await check('SHA-256 (FIPS 180-4)', async () =>
      hex(await sha('SHA-256', te.encode('abc'))) ===
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');

    await check('HMAC-SHA-512 (RFC 4231)', async () =>
      hex(await hmac('SHA-512', te.encode('Jefe'), te.encode('what do ya want for nothing?'))) ===
      '164b7a7bfcf819e2e395fbe73b56e0a387bd64222e831fd610270cd7ea2505549758bf75c05a994a6d034f65f8f0e6fdcaeab1a34d4a6b4b636e070a38bce737');

    await check('HKDF-SHA-256 (RFC 5869)', async () =>
      hex(await hkdf('SHA-256', unhex('0b'.repeat(22)), unhex('000102030405060708090a0b0c'), unhex('f0f1f2f3f4f5f6f7f8f9'), 42)) ===
      '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865');

    await check('AES-256-CTR (NIST SP 800-38A)', async () => {
      const key = await subtle.importKey('raw', unhex('603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4'), { name: 'AES-CTR' }, false, ['encrypt']);
      const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-CTR', counter: unhex('f0f1f2f3f4f5f6f7f8f9fafbfcfdfeff'), length: 64 }, key,
        unhex('6bc1bee22e409f96e93d7e117393172aae2d8a571e03ac9c9eb76fac45af8e51')));
      return hex(ct) === '601ec313775789a5b7a7f504bbf3d228f443e3ca4d62b59aca84e990cacaf5c5';
    });

    await check('CTR-Zähler-Fortsetzung', async () => {
      // Zwei Hälften mit fortgesetztem Zähler müssen exakt dem Stück am Stück entsprechen.
      const kb = randomBytes(32), iv = randomBytes(16);
      iv.fill(255, 8); // erzwingt Überlauf der unteren 64 Bit
      const key = await subtle.importKey('raw', kb, { name: 'AES-CTR' }, false, ['encrypt']);
      const whole = new Uint8Array(await subtle.encrypt({ name: 'AES-CTR', counter: iv, length: 64 }, key, new Uint8Array(64)));
      const a = new Uint8Array(await subtle.encrypt({ name: 'AES-CTR', counter: iv, length: 64 }, key, new Uint8Array(32)));
      const b = new Uint8Array(await subtle.encrypt({ name: 'AES-CTR', counter: addCounter(iv, 2), length: 64 }, key, new Uint8Array(32)));
      return hex(whole) === hex(a) + hex(b);
    });

    await check('Zufall: Chi²-Gleichverteilung (65 536 Bytes)', async () => {
      const b = randomBytes(65536);
      const cnt = new Uint32Array(256);
      for (const x of b) cnt[x]++;
      const e = b.length / 256;
      let chi = 0;
      for (const c of cnt) chi += (c - e) ** 2 / e;
      // df = 255; Erwartung 255, σ ≈ 22,6 → Grenze bei > 7σ, Fehlalarm praktisch unmöglich
      return chi > 120 && chi < 420;
    });

    await check('Zufall: keine Wiederholung (4096 × 128 Bit)', async () => {
      const b = randomBytes(4096 * 16);
      const set = new Set();
      for (let i = 0; i < b.length; i += 16) set.add(hex(b.subarray(i, i + 16)));
      return set.size === 4096;
    });

    await check('Geflecht: Ergebnis gleichverteilt (Chi²)', async () => {
      const r = await generate({
        length: 1024, classes: ['lower', 'upper', 'digits', 'symbols'],
        handEntropy: te.encode('selbsttest-hand'), timeEntropy: te.encode('selbsttest-zeit'),
      });
      const alpha = buildAlphabet(['lower', 'upper', 'digits', 'symbols'], false).alphabet;
      const idx = new Map(alpha.map((c, i) => [c, i]));
      // Stichprobe aus drei Passwörtern = 3072 Zeichen, 94 Klassen, df = 93
      const r2 = await generate({ length: 1024, classes: ['lower', 'upper', 'digits', 'symbols'], handEntropy: te.encode('a'), timeEntropy: te.encode('b'), generation: 1 });
      const r3 = await generate({ length: 1024, classes: ['lower', 'upper', 'digits', 'symbols'], handEntropy: te.encode('a'), timeEntropy: te.encode('b'), generation: 2 });
      const all = r.password + r2.password + r3.password;
      const cnt = new Uint32Array(alpha.length);
      for (const ch of all) cnt[idx.get(ch)]++;
      const e = all.length / alpha.length;
      let chi = 0;
      for (const c of cnt) chi += (c - e) ** 2 / e;
      // Konsistenz: F = (M + H + Z) mod n an jeder Stelle
      const n = alpha.length;
      for (let i = 0; i < r.password.length; i++) {
        const s = (idx.get(r.strands.M[i]) + idx.get(r.strands.H[i]) + idx.get(r.strands.Z[i])) % n;
        if (s !== idx.get(r.password[i])) return false;
      }
      return chi < 93 + 7 * Math.sqrt(2 * 93);
    });

    await check('Exakte Entropie (Inklusion–Exklusion)', async () =>
      // 2 Klassen à 1 Zeichen, L = 3 → 2³ − 1 − 1 = 6 gültige Wörter
      countValid([1, 1], 3) === 6n &&
      // keine Regeln verletzt: L=1, eine Klasse mit 26 → 26
      countValid([26], 1) === 26n &&
      // 26+26+10+32, L=4 → bekannter Wert
      countValid([26, 26, 10, 32], 4) === 26n * 26n * 10n * 32n * 24n);

    return results;
  }

  return {
    VERSION, CLASSES, AMBIGUOUS,
    buildAlphabet, generate, selfTest, collectJitter,
    countValid, entropyBits, log2Big,
    // für Tests
    _internal: { addCounter, uniformIndex, ByteStream, concatBytes, sha, hmac, hkdf, hex, unhex, randomBytes },
  };
});
