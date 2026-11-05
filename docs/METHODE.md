# TRIBRAID v1: Spezifikation

**TRIBRAID** („Dreistrang-Geflecht“) ist ein Verfahren zur Passworterzeugung.
Es verlässt sich auf **keine einzelne** Zufallsquelle und auf **keine einzelne**
Kryptofamilie. Das Passwort ist gleichverteilt, sobald *mindestens einer* von drei
Strängen gleichverteilt und von den anderen unabhängig ist.

Referenz-Implementierung: [`js/tribraid.js`](../js/tribraid.js) · Tests: [`tests/`](../tests)

---

## 1. Überblick

```
 Strang M  OS-CSPRNG (getRandomValues) ──────────────────────────────┐
                                                                     │  je Position i:
 Strang H  Zeigerbewegungen ─ SHA-512-Pool ─ HKDF-SHA-256 ─ AES-256-CTR ─┼─▶ F_i = (M_i + H_i + Z_i) mod n
                                                                     │
 Strang Z  CPU-Jitter ─ SHA-512-Pool ─ HMAC-SHA-512 (Extract) ─ HMAC-SHA-512-CTR ─┘
                                                                     │
                                         Wort verwerfen, falls eine Pflicht-Zeichenart fehlt
                                                                     ▼
                                                                 Passwort
```

## 2. Parameter

| Symbol | Bedeutung |
|---|---|
| Σ | Alphabet, disjunkte Vereinigung der gewählten Zeichenklassen C₁ … C_k |
| n | \|Σ\|, 2 ≤ n ≤ 256 |
| L | Länge, k ≤ L ≤ 1024 |
| g | Generationszähler (jede Erzeugung bekommt einen neuen) |
| ctx | `"TRIBRAID-1|n=…|L=…|cls=…|g=…"`, Domänentrennung je Anfrage |

Zeichenklassen: `a–z` (26), `A–Z` (26), `0–9` (10), ASCII-Sonderzeichen (32), zusammen 94.
Option „ohne Verwechselbare“ entfernt `I l 1 | O 0 o`.

## 3. Die drei Stränge

### Strang M: Maschine
Rohe Bytes aus `crypto.getRandomValues`. Bewusst **ohne** jede Nachbearbeitung:
Was nicht verarbeitet wird, kann auch nicht falsch verarbeitet werden.

### Strang H: Hand
1. Jede Zeigerbewegung liefert `(clientX, clientY, timeStamp, performance.now(), pressure, tiltX, tiltY, width)` als Float64.
   Gebündelte Zwischenereignisse (`getCoalescedEvents`) werden mitgenommen.
2. Pool-Fortschreibung: `pool ← SHA-512(pool ‖ "|hand|" ‖ events ‖ now)`. Der alte Pool wird genullt.
3. `km ← HKDF-SHA-256(ikm = "hand:" ‖ pool, salt = "TRIBRAID-1/hand/salt", info = ctx, 48 Byte)`
4. Schlüsselstrom: `AES-256-CTR(key = km[0..32], counter = km[32..48])` über Nullbytes.

### Strang Z: Zeit
1. Jitter-Probe: Wie viele Schleifendurchläufe passen, bis `performance.now()` weitertickt?
   Das hängt von Caches, Interrupts, Frequenzsprüngen und anderen Prozessen ab.
   Pro Probe werden Zähler, Nachkommabits des Zeitstempels und ein Akkumulator gespeichert.
2. Pool: `pool ← SHA-512(pool ‖ "|time|" ‖ samples)`. Beim Start 2048 Proben, danach 256 pro Passwort.
3. `prk ← HMAC-SHA-512(key = "TRIBRAID-1/time/salt", "time:" ‖ pool)` (HKDF-Extract)
4. Schlüsselstrom: Block_j = `HMAC-SHA-512(prk, "stream|" ‖ ctx ‖ u32be(j))`.

**Warum drei verschiedene Familien?** M hängt nur am Betriebssystem. H hängt an AES und SHA-256,
Z an SHA-512/HMAC. Ein hypothetischer Durchbruch gegen eine Familie oder ein fehlerhafter
Betriebssystem-Generator betrifft höchstens einen Strang.

## 4. Unverzerrte Indizes

Jeder Strang liefert Indizes in `[0, n)` per Rejection Sampling:
`m = 2^⌈log₂ n⌉`, `v = byte & (m−1)`, verwerfen, falls `v ≥ n`.
Kein Modulo-Bias. Bei n = 94 wird im Mittel 128/94 ≈ 1,36 Byte pro Index verbraucht.

## 5. Die Verflechtung

```
F_i = (M_i + H_i + Z_i) mod n
```

**Satz (Geflecht).** Seien M, H, Z unabhängige Zufallsvariablen auf ℤ_n und eine davon
gleichverteilt. Dann ist F = M + H + Z mod n gleichverteilt.

*Beweis.* O. B. d. A. ist M gleichverteilt. Für feste Werte h, z ist m ↦ m + h + z eine
Bijektion auf ℤ_n. Also gilt `P(F = f | H = h, Z = z) = P(M = f − h − z) = 1/n` für alle
f, h, z. Damit ist F gleichverteilt und sogar unabhängig von (H, Z). ∎

Folgerung: Ein Angreifer, der zwei der drei Stränge **vollständig kennt oder sogar wählt**,
lernt über das Passwort nichts. Das gilt, solange der dritte Strang unabhängig von den beiden
anderen ist. Die Positionen sind untereinander unabhängig, weil jeder Strang fortlaufend
neue Bytes liefert.

> Der Test `Kompromittierte Stränge H und Z` setzt H und Z auf bekannte Konstanten
> und prüft, dass die Ausgabe trotzdem unvorhersagbar bleibt.

## 6. Regeln ohne Struktur-Leck

Üblich ist „ziehe L−k Zeichen frei und füge je ein Zeichen jeder Pflichtklasse ein“.
Das erzeugt eine *nicht* gleichverteilte Ausgabe, denn Wörter mit genau einem Vertreter
einer Klasse werden übergewichtet.

TRIBRAID verwirft stattdessen das **ganze Wort**, solange nicht jede gewählte Klasse
vorkommt. Da F vor der Prüfung gleichverteilt über Σ^L ist, ist das Ergebnis exakt
gleichverteilt über die Menge V der gültigen Wörter.

## 7. Exakte Entropie

```
|V| = Σ_{S ⊆ {1..k}} (−1)^{|S|} · (n − Σ_{j∈S} |C_j|)^L         (Inklusion–Exklusion)
H   = log₂ |V|
```

Die Rechnung läuft mit `BigInt`, ist also exakt. Erst der Logarithmus wird gerundet.
Der Test `Inklusion–Exklusion stimmt mit Brute-Force-Abzählung überein` vergleicht
die Formel mit vollständiger Aufzählung.

| Einstellung | Entropie |
|---|---|
| 16 Zeichen, alle Klassen | ≈ 104,6 Bit |
| 40 Zeichen, alle Klassen (Standard) | ≈ 262,2 Bit |
| 100 Zeichen, alle Klassen („Unnötig sicher“) | ≈ 655,5 Bit |

## 8. Physikalische Einordnung (Landauer-Grenze)

Jede irreversible Bit-Operation kostet mindestens `k_B · T · ln 2` Energie.
Bei T = 2,725 K (kosmischer Mikrowellenhintergrund) sind das ≈ 2,6 · 10⁻²³ J.
Allein ein Zähler, der 2^H Zustände durchläuft, braucht also mindestens
`2^H · k_B · T · ln 2` Joule.

| Vergleich | Energie |
|---|---|
| Menschheit, 1 Jahr | ≈ 6 · 10²⁰ J |
| Sonne, 1 Jahr | ≈ 1,2 · 10³⁴ J |
| Sonne, 10 Mrd. Jahre | ≈ 1,2 · 10⁴⁴ J |
| Milchstraße, E = mc² | ≈ 2,7 · 10⁵⁹ J |
| beobachtbares Universum (gewöhnliche Materie), E = mc² | ≈ 1,4 · 10⁷⁰ J |

262 Bit → ≈ 10⁵⁶ J (10¹²-mal die Lebensenergie der Sonne).
655 Bit → ≈ 10¹⁷⁴ J (10¹⁰⁴-mal das Universum).

Ehrlicher Hinweis: Ab etwa 128 Bit ist ein Passwort gegen Durchprobieren bereits
praktisch unangreifbar. Alles darüber ist, wie der Name sagt, *unnötig*. Es schadet aber nicht.
Gegen Quantencomputer (Grover) halbiert sich die effektive Bitzahl. 262 Bit bleiben auch
dann weit über 128.

## 9. Selbsttest beim Start

Bevor ein Passwort erzeugt wird, prüft die Seite den Browser:

| Prüfung | Quelle |
|---|---|
| SHA-256("abc") | FIPS 180-4 |
| HMAC-SHA-512 Testfall 2 | RFC 4231 |
| HKDF-SHA-256 Testfall 1 | RFC 5869 |
| AES-256-CTR F.5.5 (2 Blöcke) | NIST SP 800-38A |
| CTR-Zähler-Fortsetzung inkl. 64-Bit-Überlauf | eigen |
| χ²-Test über 65 536 CSPRNG-Bytes | eigen |
| keine Wiederholung in 4096 × 128 Bit | eigen |
| χ²-Test über 3072 verflochtene Zeichen + Konsistenz F = M+H+Z | eigen |
| Inklusion–Exklusion gegen bekannte Werte | eigen |

Schlägt ein Test fehl, bleibt die Erzeugung gesperrt.

## 10. Speicherhygiene

Zwischenpuffer (Strang-Bytes, Indizes, Schlüsselmaterial, alte Pools) werden nach Gebrauch
mit `fill(0)` überschrieben. JavaScript-Strings sind unveränderlich und können nicht
gelöscht werden. Das ist eine Grenze jeder Browser-Anwendung.

## 11. Bedrohungsmodell

**Schützt gegen:**
- einen schwachen oder manipulierten Zufallsgenerator des Betriebssystems (H und Z übernehmen),
- vorhersagbare oder gefälschte Bewegungsdaten (M und Z übernehmen),
- einen kryptanalytischen Durchbruch gegen *eine* Primitivfamilie,
- Modulo-Bias und Struktur-Lecks durch Pflichtzeichen,
- Datenabfluss über das Netz: Die Content-Security-Policy verbietet jede Verbindung (`connect-src 'none'`).

**Schützt nicht gegen** (das kann keine Webseite):
- Schadsoftware, Keylogger oder bösartige Browser-Erweiterungen auf dem Gerät,
- Zwischenablage-Manager, die kopierte Passwörter speichern,
- eine manipulierte Auslieferung der Seite selbst. Deshalb läuft sie auch lokal als Datei,
  und der Code ist klein genug, um ihn selbst zu lesen,
- Passwort-Wiederverwendung. Ein Passwort pro Dienst, gespeichert in einem Passwort-Manager.

## 12. Was ist neu, was nicht?

Bewusst **nicht** neu sind die Primitive (SHA-2, HMAC, HKDF, AES). Eigene Primitive zu
erfinden wäre unseriös. Die Idee, mehrere Quellen zu kombinieren, ist in der Kryptographie
ebenfalls bekannt (z. B. Entropie-Pools, Combiner).

Neu an TRIBRAID ist die Kombination als Passwortverfahren:
1. Drei Stränge aus drei unterschiedlichen Quellen **und** drei unterschiedlichen Primitivfamilien.
2. Kombination **auf Zeichenebene** im Alphabet-Ring ℤ_n statt auf Bit-Ebene. Dadurch wird die
   Verflechtung sichtbar und nachprüfbar: Die Seite zeigt alle drei Stränge und ihre Summe.
3. Regel-Erfüllung durch Verwerfen ganzer Wörter, dadurch exakte Gleichverteilung über die gültigen Wörter.
4. Exakte statt geschätzte Entropie, mit physikalischer Einordnung über die Landauer-Grenze.
5. Ein Selbsttest mit offiziellen Testvektoren direkt im Browser, bevor irgendetwas erzeugt wird.
