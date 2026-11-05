// Ausführen: node --test tests/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../js/tribraid.js');

const ALL = ['lower', 'upper', 'digits', 'symbols'];
const te = new TextEncoder();

test('Selbsttest: alle Prüfungen bestehen', async () => {
  const r = await T.selfTest();
  for (const x of r) assert.ok(x.ok, `${x.name} ${x.error || ''}`);
  assert.equal(r.length, 9);
});

test('Inklusion–Exklusion stimmt mit Brute-Force-Abzählung überein', () => {
  const cases = [[[2, 1, 1], 1], [[2, 1, 1], 3], [[2, 1, 1], 5], [[3, 2], 4], [[1, 1, 1, 1], 4], [[2, 2, 2, 1], 5], [[5], 3]];
  for (const [sizes, L] of cases) {
    const n = sizes.reduce((a, b) => a + b, 0);
    const classOf = sizes.flatMap((s, ci) => Array(s).fill(ci));
    let brute = 0;
    const word = new Array(L).fill(0);
    const total = n ** L;
    for (let w = 0; w < total; w++) {
      let x = w;
      for (let i = 0; i < L; i++) { word[i] = x % n; x = Math.floor(x / n); }
      const seen = new Set(word.map((i) => classOf[i]));
      if (seen.size === sizes.length) brute++;
    }
    assert.equal(T.countValid(sizes, L), BigInt(brute), `sizes=${sizes} L=${L}`);
  }
});

test('Geflecht-Satz: Addition mod n ist für jedes feste (h, z) eine Bijektion', () => {
  for (const n of [2, 7, 62, 94]) {
    for (let h = 0; h < n; h += Math.max(1, n >> 3)) for (let z = 0; z < n; z += Math.max(1, n >> 3)) {
      const img = new Set();
      for (let m = 0; m < n; m++) img.add((m + h + z) % n);
      assert.equal(img.size, n);
    }
  }
});

test('Jedes Zeichen ist exakt die Verflechtung der drei Stränge', async () => {
  const r = await T.generate({ length: 128, classes: ALL, handEntropy: te.encode('h'), timeEntropy: te.encode('z') });
  const { alphabet } = T.buildAlphabet(ALL, false);
  const idx = new Map(alphabet.map((c, i) => [c, i]));
  for (let i = 0; i < 128; i++) {
    assert.equal((idx.get(r.strands.M[i]) + idx.get(r.strands.H[i]) + idx.get(r.strands.Z[i])) % alphabet.length, idx.get(r.password[i]));
  }
});

test('Regeln: jede gewählte Zeichenart kommt vor, nichts außerhalb des Alphabets', async () => {
  for (let g = 0; g < 200; g++) {
    const r = await T.generate({ length: 8, classes: ALL, excludeAmbiguous: true, handEntropy: te.encode('h'), timeEntropy: te.encode('z'), generation: g });
    assert.match(r.password, /[a-z]/); assert.match(r.password, /[A-Z]/);
    assert.match(r.password, /[0-9]/); assert.match(r.password, /[^a-zA-Z0-9]/);
    assert.doesNotMatch(r.password, /[Il1|O0o]/);
  }
});

test('Gleichverteilung über die gültigen Wörter (Ziffern + Symbole, L = 2)', async () => {
  // Gültig sind genau 2 · 10 · 32 = 640 Wörter. Erwartung: Ziffer vorne in 50 %.
  const N = 4000;
  let digitFirst = 0;
  for (let g = 0; g < N; g++) {
    const r = await T.generate({ length: 2, classes: ['digits', 'symbols'], handEntropy: te.encode('h'), timeEntropy: te.encode('z'), generation: g });
    const d0 = /[0-9]/.test(r.password[0]), d1 = /[0-9]/.test(r.password[1]);
    assert.notEqual(d0, d1);
    if (d0) digitFirst++;
  }
  const sd = Math.sqrt(N * 0.25);
  assert.ok(Math.abs(digitFirst - N / 2) < 6 * sd, `digitFirst=${digitFirst}`);
});

test('Kompromittierte Stränge H und Z (konstant, bekannt) → Ausgabe trotzdem unvorhersagbar', async () => {
  const seen = new Set();
  for (let i = 0; i < 50; i++) {
    const r = await T.generate({ length: 20, classes: ALL, handEntropy: te.encode('bekannt'), timeEntropy: te.encode('bekannt') });
    seen.add(r.password);
  }
  assert.equal(seen.size, 50);
});

test('Ungültige Eingaben werden abgelehnt', async () => {
  await assert.rejects(T.generate({ length: 3, classes: ALL, handEntropy: te.encode('h'), timeEntropy: te.encode('z') }));
  await assert.rejects(T.generate({ length: 10, classes: [], handEntropy: te.encode('h'), timeEntropy: te.encode('z') }));
  await assert.rejects(T.generate({ length: 10, classes: ALL, handEntropy: new Uint8Array(0), timeEntropy: te.encode('z') }));
});

test('Entropie: 40 Zeichen aus 94 ≈ 262 Bit, 80 Zeichen > 524 Bit', () => {
  const s = T.buildAlphabet(ALL, false).sizes;
  const b40 = T.entropyBits(s, 40), b80 = T.entropyBits(s, 80);
  assert.ok(b40 > 262 && b40 < 262.2, String(b40));
  assert.ok(b80 > 524, String(b80));
  assert.ok(b40 < 40 * Math.log2(94)); // Regeln kosten minimal Entropie, nie mehr
});
