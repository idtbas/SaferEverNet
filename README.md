# SaferEverNet

Eine schlichte Website für unnötig sichere Passwörter, erzeugt mit **TRIBRAID**,
einem Dreistrang-Geflecht-Verfahren.

- **Drei unabhängige Quellen:** Betriebssystem-Zufall, deine Handbewegung, CPU-Jitter
- **Drei Kryptofamilien:** roh / AES-256-CTR / HMAC-SHA-512
- **Zeichenweise Verflechtung** `(m + h + z) mod n`: so stark wie der *stärkste* Strang
- **Exakte Gleichverteilung** trotz Regeln, **exakte Entropie** per Inklusion–Exklusion
- **Selbsttest** mit NIST-/RFC-Testvektoren bei jedem Laden
- **Offline:** keine Abhängigkeiten, keine Netzwerkverbindungen (per CSP verboten)

Die vollständige Spezifikation mit Sicherheitsbeweis steht in [docs/METHODE.md](docs/METHODE.md).

## Benutzen

`index.html` per Doppelklick im Browser öffnen. Das war's.
Alternativ über einen lokalen Server:

```sh
npm start            # python3 -m http.server 8080
```

## Testen

```sh
npm test             # Node ≥ 19
```

## Struktur

```
index.html           Seite
css/style.css        Gestaltung (hell/dunkel, mobil)
js/tribraid.js       das Verfahren (Browser + Node)
js/app.js            Oberfläche, Entropie-Pools, Kritzel-Feld
tests/               Testsuite
docs/METHODE.md      Spezifikation, Beweis, Bedrohungsmodell
```
