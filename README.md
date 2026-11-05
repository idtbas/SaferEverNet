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

## Oberfläche

- **Energiefeld:** Punkte weichen dem Zeiger aus, jede Bewegung schickt Partikel in einen Ring.
  Tastatur geht auch. Bei 100 % implodiert das Feld zu einem rotierenden Dreistrang-Seil.
- **Tresor-Walzen:** Jede Stelle rollt sichtbar durch das echte Maschinen-, Hand- und
  Zeit-Zeichen und rastet dann beim Endzeichen ein.
- **Rechnung pro Zeichen:** Maus darüber (oder Pfeiltasten) zeigt `(m + h + z) mod n`.
- **Kosmische Leiter:** Die Stärke wird an der Landauer-Grenze gemessen, von der Menschheit bis
  zum beobachtbaren Universum.
- **Zwischenablage:** wird 60 Sekunden nach dem Kopieren automatisch geleert.
- Hell/Dunkel nach Systemeinstellung, mobil, „Bewegung reduzieren“ wird respektiert.

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
css/style.css        Gestaltung (Design-Tokens, hell/dunkel, mobil)
js/tribraid.js       das Verfahren (Browser + Node)
js/fx.js             Canvas-Bühne (Energiefeld, Implosion, Seil) und Animationshelfer
js/app.js            Oberfläche, Entropie-Pools, Interaktionen
fonts/               Mona Sans und JetBrains Mono (lokal, SIL Open Font License)
tests/               Testsuite
docs/METHODE.md      Spezifikation, Beweis, Bedrohungsmodell
```
