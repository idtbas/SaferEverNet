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

## Abo „Pro“ (3,99 € pro Monat)

Die kostenlose Version ist absichtlich unbequem: verschwommenes Passwort (Ansehen erst
nach einer Wartezeit, dann 15 s), Wartezeit vor jedem Kopieren (8 s, wächst bis 30 s,
täglich zurückgesetzt), höchstens 12 Zeichen, 5 Passwörter pro Tag ohne Wartezeit,
ein wiederkehrendes Banner und Erinnerungen alle 45 s.
Kündigen geht jederzeit mit einem Klick im Fuß der Seite.

Einstellungen stehen oben in `js/abo.js` (`CONFIG`):

- `paymentLink`: Link zum Zahlungsanbieter, z. B. ein Stripe Payment Link. Leer heißt:
  Es kann noch nicht bezahlt werden.
- `testMode`: erlaubt das lokale Freischalten von Pro ohne Zahlung. **Vor dem echten
  Start auf `false` setzen.**

Wichtig: Die Sperren laufen im Browser und sind mit den Entwicklerwerkzeugen umgehbar.
Für echte Einnahmen braucht es zusätzlich eine Lizenzprüfung (z. B. signierte
Lizenzschlüssel) und die rechtlichen Pflichtangaben (Impressum, AGB,
Widerrufsbelehrung, Kündigungsbutton nach § 312k BGB).

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
js/abo.js            Abo „Pro“: Sperren, Wartezeiten, Dialoge, Erinnerungen
fonts/               Mona Sans und JetBrains Mono (lokal, SIL Open Font License)
tests/               Testsuite
docs/METHODE.md      Spezifikation, Beweis, Bedrohungsmodell
```
