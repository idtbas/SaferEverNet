/* SaferEverNet – Abo „Pro“ (3,99 € pro Monat)
 *
 * Kostenlos ist absichtlich unbequem:
 *   - Passwort bleibt verschwommen, Ansehen nur nach Wartezeit (dann 15 s sichtbar)
 *   - Kopieren nur nach Wartezeit
 *   - Wartezeit wächst mit jeder Nutzung (8 s, 12 s, 16 s … bis 30 s, täglich zurückgesetzt)
 *   - höchstens 12 Zeichen, alle Voreinstellungen gesperrt
 *   - 5 Passwörter pro Tag ohne Wartezeit, danach wird jedes neue Flechten gesperrt
 *   - Banner, das nach dem Schließen wiederkommt, und Erinnerungen alle 45 s
 *
 * Bewusst NICHT eingebaut (in Deutschland unzulässig oder abmahnbar):
 * falsche Countdowns, erfundene Knappheit, versteckte Kündigung.
 *
 * WICHTIG: Das hier ist eine Komfort-Sperre im Browser, keine Sicherheitsgrenze.
 * Echte Abrechnung braucht einen Zahlungsanbieter (paymentLink) und eine
 * Lizenzprüfung. Bis dahin schaltet der Testmodus Pro lokal frei.
 */
(function () {
  'use strict';

  const CONFIG = {
    price: '3,99 €',
    paymentLink: '',          // z. B. ein Stripe Payment Link. Leer = noch keine Zahlung möglich.
    testMode: true,           // erlaubt Freischalten ohne Zahlung, nur für Tests
    freeMaxLength: 12,
    freeGenerationsPerDay: 5,
    waitBase: 8, waitStep: 4, waitMax: 30,
    reminderSeconds: 45,
    bannerReturnSeconds: 90,
    peekSeconds: 15,
  };

  const KEY = 'sen.abo.v1';
  const $ = (id) => document.getElementById(id);
  const today = () => new Date().toISOString().slice(0, 10);
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function load() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (_) { return {}; } }
  const S = Object.assign({ pro: false, test: false, day: '', uses: 0, gens: 0, waited: 0 }, load());
  function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (_) { /* privates Fenster o. Ä. */ } }
  function rollDay() { if (S.day !== today()) { S.day = today(); S.uses = 0; S.gens = 0; S.waited = 0; save(); } }
  rollDay();

  const nextWait = () => Math.min(CONFIG.waitMax, CONFIG.waitBase + CONFIG.waitStep * S.uses);
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ------------------------------------------------------------ Texte */
  const REASONS = {
    copy: ['Kopieren ist ein Pro-Feature', 'In der kostenlosen Version wartest du vor jedem Kopieren. Und die Wartezeit wird mit jeder Nutzung länger.'],
    view: ['Klare Sicht gibt es mit Pro', `Kostenlos bleibt dein Passwort verschwommen. Nach der Wartezeit siehst du es ${CONFIG.peekSeconds} Sekunden lang.`],
    generate: ['Dein Tageskontingent ist aufgebraucht', `Kostenlos flechtest du ${CONFIG.freeGenerationsPerDay} Passwörter pro Tag ohne Pause. Ab jetzt heißt es vor jedem neuen: warten.`],
    length: [`Mehr als ${CONFIG.freeMaxLength} Zeichen gibt es nur mit Pro`, `Kostenlos ist bei ${CONFIG.freeMaxLength} Zeichen Schluss, das sind rund 78 Bit. Mit Pro bis 128 Zeichen und über 800 Bit.`],
    welcome: ['Dein erstes Passwort ist fertig', 'Leider verschwommen. Mit Pro siehst und kopierst du es sofort, ohne Wartezeit.'],
    banner: ['Hol dir SaferEverNet Pro', 'Alles sofort, alles unbegrenzt, keine Erinnerungen mehr.'],
  };
  const NAGS = [
    () => `Du nutzt die kostenlose Version. Pro kostet nur ${CONFIG.price} im Monat.`,
    () => `Pro-Nutzer haben heute 0 Sekunden gewartet. Du: ${S.waited} Sekunden.`,
    () => 'Dein Passwort ist übrigens immer noch verschwommen.',
    () => `${CONFIG.freeMaxLength} Zeichen sind okay. 40 wären besser. Mit Pro.`,
    () => `Nächste Wartezeit: ${nextWait()} Sekunden. Mit Pro: keine.`,
    () => 'Diese Erinnerung gibt es mit Pro nicht mehr.',
  ];

  /* ------------------------------------------------------------ Dialog */
  let back, box, waitBtn, waitText, waitRing, nextNote, testNote, buyBtn;
  let timer = 0, pending = null, mode = null, lastFocus = null;

  function buildModal() {
    back = el('div', 'abo-back');
    back.hidden = true;
    box = el('div', 'abo-modal');
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'aboTitle');
    box.setAttribute('aria-describedby', 'aboSub');
    box.tabIndex = -1;

    const x = el('button', 'abo-x', '×');
    x.type = 'button';
    x.setAttribute('aria-label', 'Schließen');
    x.addEventListener('click', () => close(false));

    const kick = el('p', 'abo-kicker');
    kick.append(el('span', 'abo-badge', 'PRO'), 'SaferEverNet Pro');
    const title = el('h2', 'abo-title'); title.id = 'aboTitle';
    const sub = el('p', 'abo-sub'); sub.id = 'aboSub';

    const price = el('div', 'abo-price');
    price.append(el('b', '', CONFIG.price), el('span', '', 'pro Monat · jederzeit monatlich kündbar'));

    const feat = el('ul', 'abo-feat');
    ['Passwort sofort sehen, ohne Unschärfe', 'Sofort kopieren, ohne Wartezeit', 'Bis 128 Zeichen und „Unnötig sicher“',
      'Unbegrenzt neu flechten', 'Keine Banner, keine Erinnerungen'].forEach((t) => feat.append(el('li', '', t)));

    buyBtn = el('button', 'btn primary abo-buy', `Pro holen · ${CONFIG.price}/Monat`);
    buyBtn.type = 'button';
    buyBtn.addEventListener('click', buy);

    testNote = el('p', 'abo-test');
    testNote.hidden = true;
    testNote.append('Die Zahlung ist noch nicht eingerichtet. Zum Testen kannst du Pro hier lokal freischalten. ');
    const unlock = el('button', 'ghost-link abo-unlock', 'Pro im Testmodus freischalten');
    unlock.type = 'button';
    unlock.addEventListener('click', () => { setPro(true, true); close(false); toast('Pro ist aktiv (Testmodus). Keine Wartezeiten mehr.', false); });
    testNote.append(unlock);

    waitBtn = el('button', 'abo-wait');
    waitBtn.type = 'button';
    waitRing = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    waitRing.setAttribute('viewBox', '0 0 36 36');
    waitRing.setAttribute('class', 'abo-ring');
    waitRing.innerHTML = '<circle cx="18" cy="18" r="15" class="ar-track"/><circle cx="18" cy="18" r="15" class="ar-fill"/>';
    waitText = el('span', '');
    waitBtn.append(waitRing, waitText);
    waitBtn.addEventListener('click', () => { if (!waitBtn.disabled) close(true); });

    nextNote = el('p', 'abo-next');

    box.append(x, kick, title, sub, price, feat, buyBtn, testNote, waitBtn, nextNote);
    back.append(box);
    document.body.append(back);

    back.addEventListener('click', (e) => {
      if (e.target !== back) return;
      if (mode === 'gate') { box.classList.remove('shake'); void box.offsetWidth; box.classList.add('shake'); }
      else close(false);
    });
    document.addEventListener('keydown', (e) => {
      if (back.hidden) return;
      if (e.key === 'Escape') { e.preventDefault(); close(false); }
      if (e.key === 'Tab') trapFocus(e);
    });
  }
  function trapFocus(e) {
    const f = [...box.querySelectorAll('button:not([disabled]), a[href]')].filter((n) => n.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function open(reason, m) {
    mode = m;
    const [t, s] = REASONS[reason] || REASONS.banner;
    $('aboTitle').textContent = t;
    $('aboSub').textContent = s;
    testNote.hidden = true;
    lastFocus = document.activeElement;
    back.hidden = false;
    box.classList.remove('shake');
    setTimeout(() => box.focus(), 30);
  }
  function close(proceed) {
    clearInterval(timer);
    back.hidden = true;
    const action = pending;
    pending = null;
    mode = null;
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
    if (proceed && action) action();
  }

  /** Erst warten, dann darf die Aktion laufen. Pro: sofort. */
  function gate(reason, action) {
    if (S.pro) { action(); return; }
    if (!back.hidden) return;               // schon ein Dialog offen
    rollDay();
    const secs = nextWait();
    S.uses++;
    S.waited += secs;
    save();
    pending = action;
    open(reason, 'gate');
    waitBtn.hidden = false;
    let left = secs;
    const C = 94.25;
    const fill = waitRing.querySelector('.ar-fill');
    const render = () => {
      waitBtn.disabled = left > 0;
      waitText.textContent = left > 0 ? `Ohne Pro weiter in ${left} s` : 'Ohne Pro weiter';
      fill.style.strokeDashoffset = (C * (left / secs)).toFixed(2);
    };
    render();
    nextNote.textContent = `Heute schon ${S.uses}-mal gewartet. Nächstes Mal: ${nextWait()} Sekunden.`;
    clearInterval(timer);
    timer = setInterval(() => { left--; render(); if (left <= 0) clearInterval(timer); }, 1000);
  }

  /** Nur das Angebot zeigen, ohne Wartezeit. */
  function offer(reason) {
    if (S.pro || !back.hidden) return;
    pending = null;
    open(reason, 'offer');
    waitBtn.hidden = true;
    nextNote.textContent = '';
  }

  function buy() {
    if (CONFIG.paymentLink) {
      const a = el('a');
      a.href = CONFIG.paymentLink;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      document.body.append(a);
      a.click();
      a.remove();
      return;
    }
    if (CONFIG.testMode) { testNote.hidden = false; return; }
    toast('Die Zahlung ist noch nicht eingerichtet.', false);
  }

  /* ------------------------------------------------------------ Kündigen */
  function cancelFlow() {
    if (!S.pro || !back.hidden) return;
    pending = () => { setPro(false, false); toast('Dein Abo ist gekündigt. Ab jetzt wieder kostenlos.', false); };
    open('banner', 'cancel');
    $('aboTitle').textContent = 'Abo kündigen?';
    $('aboSub').textContent = 'Du kannst monatlich kündigen. Danach gelten wieder die Einschränkungen der kostenlosen Version.';
    waitBtn.hidden = false;
    waitBtn.disabled = false;
    waitRing.querySelector('.ar-fill').style.strokeDashoffset = '94.25';
    waitText.textContent = 'Jetzt kündigen';
    nextNote.textContent = S.test ? 'Testmodus: Es wurde nie Geld abgebucht.' : '';
  }

  /* ------------------------------------------------------------ Zustand anwenden */
  let peekTimer = 0, peekLeft = 0, savedHint = '';
  function setPro(pro, test) {
    S.pro = pro;
    S.test = !!(pro && test);
    save();
    apply();
  }
  function apply() {
    const pro = S.pro;
    document.documentElement.classList.toggle('is-pro', pro);
    stopPeek();
    if (window.App) {
      window.App.setLocked(!pro);
      if (!pro) window.App.applyLimits();
    }
    const pill = $('aboPill');
    pill.textContent = pro ? (S.test ? 'Pro · Test' : 'Pro') : 'Pro holen';
    pill.classList.toggle('pro', pro);
    $('aboStrip').hidden = pro;
    document.querySelectorAll('input[name="preset"]').forEach((p) => {
      p.nextElementSibling.classList.toggle('pro-only', !pro && +p.value > CONFIG.freeMaxLength);
    });
    $('aboNote').hidden = pro;
    const foot = $('aboFoot');
    foot.textContent = '';
    const b = el('button', 'ghost-link');
    b.type = 'button';
    if (pro) {
      foot.append(S.test ? 'Abo: Pro (Testmodus) · ' : 'Abo: Pro · ');
      b.textContent = 'Abo kündigen';
      b.addEventListener('click', cancelFlow);
    } else {
      foot.append('Abo: Kostenlos · ');
      b.textContent = `Pro für ${CONFIG.price}/Monat`;
      b.addEventListener('click', () => offer('banner'));
    }
    foot.append(b);
  }

  /* „Ansehen“: nach der Wartezeit kurz scharf, dann wieder verschwommen. */
  function peek() {
    if (S.pro || !window.App) return;
    window.App.setLocked(false);
    peekLeft = CONFIG.peekSeconds;
    const hint = $('pwHint');
    savedHint = savedHint || hint.textContent;
    const render = () => { hint.textContent = `Sichtbar noch ${peekLeft} s. Danach wird es wieder verschwommen.`; };
    render();
    clearInterval(peekTimer);
    peekTimer = setInterval(() => { peekLeft--; if (peekLeft <= 0) stopPeek(); else render(); }, 1000);
  }
  function stopPeek() {
    clearInterval(peekTimer);
    peekTimer = 0;
    if (savedHint) { $('pwHint').textContent = savedHint; savedHint = ''; }
    if (!S.pro && window.App) window.App.setLocked(true);
  }

  /* ------------------------------------------------------------ Banner, Pille, Toasts */
  let toastBox;
  function toast(text, withButton) {
    const t = el('div', 'abo-toast');
    t.setAttribute('role', 'status');
    t.append(el('span', 'abo-badge', 'PRO'), el('p', '', text));
    if (withButton) {
      const b = el('button', 'btn primary abo-toast-btn', 'Upgrade');
      b.type = 'button';
      b.addEventListener('click', () => { t.remove(); offer('banner'); });
      t.append(b);
    }
    toastBox.append(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 350); }, 6500);
  }
  let nagIndex = 0;
  function remind() {
    if (S.pro || document.hidden || !back.hidden) return;
    toast(NAGS[nagIndex++ % NAGS.length](), true);
    const pill = $('aboPill');
    if (!reduced()) { pill.classList.remove('wiggle'); void pill.offsetWidth; pill.classList.add('wiggle'); }
  }

  function buildChrome() {
    // Pille im Kopf
    const pill = el('button', 'abo-pill', 'Pro holen');
    pill.type = 'button';
    pill.id = 'aboPill';
    pill.addEventListener('click', () => { if (!S.pro) offer('banner'); });
    const statusWrap = document.querySelector('.status-wrap');
    statusWrap.parentNode.insertBefore(pill, statusWrap);

    // Banner unter dem Kopf
    const strip = el('div', 'abo-strip');
    strip.id = 'aboStrip';
    const inner = el('div', 'abo-strip-in');
    const p = el('p');
    p.append(el('b', '', 'Kostenlose Version: '), `verschwommenes Passwort, Wartezeiten, höchstens ${CONFIG.freeMaxLength} Zeichen.`);
    const go = el('button', 'abo-strip-go', `Pro für ${CONFIG.price}/Monat`);
    go.type = 'button';
    go.addEventListener('click', () => offer('banner'));
    const x = el('button', 'abo-strip-x', '×');
    x.type = 'button';
    x.setAttribute('aria-label', 'Banner ausblenden');
    x.title = `Kommt nach ${CONFIG.bannerReturnSeconds} Sekunden wieder`;
    x.addEventListener('click', () => {
      strip.hidden = true;
      setTimeout(() => { if (!S.pro) strip.hidden = false; }, CONFIG.bannerReturnSeconds * 1000);
    });
    inner.append(p, go, x);
    strip.append(inner);
    document.querySelector('.bar').append(strip);

    // Schleier über dem Passwort
    const veil = el('button', 'pw-veil');
    veil.type = 'button';
    veil.innerHTML = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/><rect x="5" y="10.5" width="14" height="10" rx="2.5"/></svg>';
    veil.append(el('span', '', 'Verschwommen · Zum Ansehen klicken'));
    veil.addEventListener('click', () => gate('view', peek));
    $('password').after(veil);

    // Hinweis im Stärke-Panel
    const note = el('p', 'abo-note');
    note.id = 'aboNote';
    note.append(`Kostenlos höchstens ${CONFIG.freeMaxLength} Zeichen. Mit Pro bis 128 Zeichen. `);
    const nb = el('button', 'ghost-link', 'Mehr erfahren');
    nb.type = 'button';
    nb.addEventListener('click', () => offer('length'));
    note.append(nb);
    document.querySelector('.power-head').after(note);

    // Abo-Zeile im Fuß
    const foot = el('span', 'abo-foot');
    foot.id = 'aboFoot';
    document.querySelector('.foot-in').append(foot);

    toastBox = el('div', 'abo-toasts');
    toastBox.setAttribute('aria-live', 'polite');
    document.body.append(toastBox);
  }

  /* ------------------------------------------------------------ Schnittstelle für app.js */
  window.Abo = {
    isPro: () => S.pro,
    maxLength: () => (S.pro ? 128 : CONFIG.freeMaxLength),
    gate,
    offer,
    needsGateForGenerate() { rollDay(); return !S.pro && S.gens >= CONFIG.freeGenerationsPerDay; },
    countGeneration() { rollDay(); S.gens++; save(); },
    onFirstPassword() { if (!S.pro) setTimeout(() => offer('welcome'), 2600); },
  };

  buildModal();
  buildChrome();
  apply();
  setInterval(remind, CONFIG.reminderSeconds * 1000);
})();
