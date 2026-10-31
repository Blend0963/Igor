// Igor on a wall tablet: what the voice satellite hears and answers, full
// screen, in Igor's style.
//
// Home Assistant loads this on every page (frontend.add_extra_js_url); it
// does nothing until switched on for the device, by opening Home Assistant
// once with ?igor_tablet=1 (any satellite) or ?igor_tablet=assist_satellite.x
// (that one only); ?igor_tablet=0 switches it off. The choice is kept in this
// browser only.
//
// Everything comes from the states this page already has: the satellite's
// own state (listening, processing, responding, idle) and the "Igor Assist"
// sensor the integration fills while Igor answers (question, answer, chips).
// The iris may also follow the room's loudness, from this tablet's own
// microphone, measured in the browser only (?igor_tablet_mic=0 to stop).
(function () {
  "use strict";
  if (window.__igorTablet) return;
  window.__igorTablet = true;

  var KEY = "igor-tablet";
  // Before the rename to Igor the switch was ?mado_tablet and "mado-tablet":
  // both still work, so a tablet set up then keeps its display.
  var OLD_KEY = "mado-tablet";
  function readSetting() {
    var param = null;
    try {
      var query = new URLSearchParams(window.location.search);
      param = query.get("igor_tablet") || query.get("mado_tablet");
    } catch (e) { param = null; }
    try {
      var old = window.localStorage.getItem(OLD_KEY);
      if (old !== null) {
        if (window.localStorage.getItem(KEY) === null) window.localStorage.setItem(KEY, old);
        window.localStorage.removeItem(OLD_KEY);
      }
    } catch (e) { /* storage blocked: the URL alone decides */ }
    try {
      if (param === "0" || param === "off") { window.localStorage.removeItem(KEY); return null; }
      if (param) { window.localStorage.setItem(KEY, param); return param; }
      return window.localStorage.getItem(KEY);
    } catch (e) {
      return param && param !== "0" && param !== "off" ? param : null;
    }
  }
  var setting = readSetting();
  if (!setting) return;
  var onlySatellite = /^assist_satellite\./.test(setting) ? setting : null;

  // ----- phrases while Igor works (as in the Igor panel) -----
  var PHRASES = {
    act: ["Je m'en occupe…", "Je fais le nécessaire…", "Je passe dans la pièce…", "J'actionne cela pour vous…"],
    look: ["Je fais le tour des pièces…", "Je consulte la maison…", "Je vérifie pour vous…"],
    history: ["Je consulte les registres…", "Je remonte le fil du temps…", "Je fais les comptes…"],
    remind: ["Je le note dans l'agenda…", "Je prends note…", "Je réserve le créneau…"],
    automation: ["Je rédige la consigne…", "Je prépare le protocole…", "Je règle les détails…"],
    camera: ["Je jette un œil…", "Je regarde discrètement…"],
    memory: ["Je consulte mes carnets…", "Je fouille ma mémoire…"],
    general: ["Un instant, je vous prie…", "Je prépare la réponse…", "Je rassemble mes idées…", "Je rajuste mon nœud papillon…"],
    thinking: ["Je pèse le pour et le contre…", "Je réfléchis à la meilleure façon de faire…", "Je rassemble mes idées…"],
    long: ["Cela demande un peu de soin…", "Je peaufine…", "Encore un instant…"],
    veryLong: ["Merci de votre patience…", "J'y mets tout mon soin…"]
  };
  var W = "(?:^|[^\\wÀ-ÿ])";
  var KINDS = [
    ["memory", new RegExp(W + "(souviens|souvenir|retiens|mémorise|oublie|rappelles?-toi)", "i")],
    ["remind", new RegExp(W + "(rappel|rappelle|préviens|alerte|réveille)|" + W + "dans \\d+ ?(min|h|heure|jour)", "i")],
    ["automation", new RegExp(W + "(automatisation|scénario|routine|chaque (soir|matin|jour)|tous les (soirs|matins|jours))", "i")],
    ["camera", new RegExp(W + "(caméra|camera|sonnette|qui est (à|devant))", "i")],
    ["history", new RegExp(W + "(hier|historique|consommation|semaine|mois|depuis|moyenne|kwh)", "i")],
    ["act", new RegExp(W + "(allume|éteins|eteins|éteindre|allumer|ouvre|ferme|monte|baisse|lance|démarre|arrête|mets|règle|active|désactive|verrouille|augmente|diminue)", "i")],
    ["look", new RegExp(W + "(est-ce que|est ce que|quel(le)?s? (est|sont)|combien|température|humidité|état)", "i")]
  ];
  function kindOf(text) {
    for (var i = 0; i < KINDS.length; i++) if (KINDS[i][1].test(text || "")) return KINDS[i][0];
    return "general";
  }
  function shuffled(list) {
    var out = list.slice();
    for (var i = out.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = out[i]; out[i] = out[j]; out[j] = t; }
    return out;
  }
  function elapsed(ms) {
    var s = Math.floor(ms / 1000);
    if (s < 60) return s + " s";
    var r = s % 60;
    return Math.floor(s / 60) + " min " + (r < 10 ? "0" : "") + r + " s";
  }

  // ----- the overlay -----
  // Igor's eye, in every phase: a black glass lens in a steel ring, a blue
  // iris with the bow tie etched in its centre. The iris opens at its name,
  // follows the voice in the room while Igor listens and while it speaks,
  // narrows and is circled by turning arcs while it thinks, settles when it
  // is done, and flickers on an error.
  var EYE = '<svg viewBox="0 0 120 120" aria-hidden="true"><defs>' +
    '<radialGradient id="igor-lens" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#E1F5FE"/><stop offset="0.25" stop-color="#4FC3F7"/><stop offset="0.6" stop-color="#0277BD"/><stop offset="1" stop-color="#01325A" stop-opacity="0"/></radialGradient>' +
    '<radialGradient id="igor-glass" cx="50%" cy="50%" r="50%"><stop offset="0.55" stop-color="#05080B"/><stop offset="1" stop-color="#16202A"/></radialGradient></defs>' +
    '<circle class="halo" cx="60" cy="60" r="58" fill="none" stroke="#03A9F4" stroke-width="2"/>' +
    '<circle cx="60" cy="60" r="54" fill="#0B1117" stroke="#3B4A56" stroke-width="3"/>' +
    '<circle cx="60" cy="60" r="44" fill="url(#igor-glass)" stroke="#202C36" stroke-width="2"/>' +
    '<g class="arc a1"><circle cx="60" cy="60" r="40" fill="none" stroke="#4FC3F7" stroke-width="1.6" stroke-dasharray="34 92" stroke-linecap="round"/></g>' +
    '<g class="arc a2"><circle cx="60" cy="60" r="40" fill="none" stroke="#B3E5FC" stroke-width="1" stroke-dasharray="2 6" opacity="0.7"/></g>' +
    '<g class="voice"><circle class="iris" cx="60" cy="60" r="34" fill="url(#igor-lens)"/></g>' +
    '<svg x="49" y="53" width="22" height="14" viewBox="0 0 64 40"><path d="M27 15.5 L8 6 Q5 4.5 5 8 V32 Q5 35.5 8 34 L27 24.5 Z M37 15.5 L56 6 Q59 4.5 59 8 V32 Q59 35.5 56 34 L37 24.5 Z" fill="#04090E"/><rect x="26" y="13" width="12" height="14" rx="3.5" fill="#fff"/></svg>' +
    '<ellipse cx="44" cy="38" rx="14" ry="7" fill="#fff" opacity="0.18" transform="rotate(-30 44 38)"/></svg>';
  var CSS = [
    ":host { all: initial; }",
    ".veil { --lvl: 0; position: fixed; inset: 0; z-index: 2147483000; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 28px; padding: 6vh 6vw; box-sizing: border-box;",
    "  background: radial-gradient(ellipse at 50% 30%, rgba(3,169,244,0.28), rgba(0,0,0,0) 60%), rgba(6,14,22,0.82); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);",
    "  font-family: var(--paper-font-body1_-_font-family, Roboto, 'Noto Sans', system-ui, sans-serif); color: #fff; opacity: 0; transition: opacity 0.35s ease; pointer-events: none; }",
    ".veil.on { opacity: 1; pointer-events: auto; }",
    ".head { position: relative; display: flex; align-items: center; justify-content: center; width: 170px; height: 170px; }",
    ".eye { width: 170px; height: 170px; filter: drop-shadow(0 0 calc(18px + var(--lvl) * 34px) rgba(3,169,244,0.5)); transition: filter 0.3s ease; }",
    ".eye > svg { width: 100%; height: 100%; overflow: visible; }",
    ".eye .iris, .eye .voice, .eye .arc { transform-box: fill-box; transform-origin: center; }",
    ".eye .iris { transform: scale(0.35); opacity: 0.35; }",
    ".eye .halo { opacity: 0.15; filter: drop-shadow(0 0 8px #03A9F4); transition: opacity 0.4s ease; }",
    ".eye .arc { opacity: 0; transition: opacity 0.4s ease; }",
    // Listening: the iris opens at the name, then breathes; the room's voice swells it (.voice, set by script).
    ".veil[data-phase=listening] .iris { animation: awaken 0.9s cubic-bezier(0.4,0,0.2,1) both, breathe 2.6s ease-in-out 0.9s infinite; }",
    ".veil[data-phase=listening] .halo { animation: halo-on 0.9s ease-out both, halo-breathe 2.6s ease-in-out 0.9s infinite; }",
    // The words are on their way: the iris draws in to a bright point, one arc races round.
    ".veil[data-phase=transcribing] .iris { animation: focus 0.6s ease-out both; }",
    ".veil[data-phase=transcribing] .a1 { opacity: 1; animation: spin 0.9s linear infinite; }",
    ".veil[data-phase=transcribing] .halo { opacity: 0.6; }",
    // Thinking: a narrower iris pulsing slowly, two arcs turning the other way.
    ".veil[data-phase=thinking] .iris { animation: ponder 2.4s ease-in-out infinite; }",
    ".veil[data-phase=thinking] .a1 { opacity: 1; animation: spin 2.8s linear infinite; }",
    ".veil[data-phase=thinking] .a2 { opacity: 1; animation: spin 7s linear infinite reverse; }",
    ".veil[data-phase=thinking] .halo { animation: halo-breathe 2.4s ease-in-out infinite; }",
    // Answering: wide open; it pulses as if speaking until the room's sound drives it (.live).
    ".veil[data-phase=answering] .iris { animation: speak 1.3s ease-in-out infinite; }",
    ".veil.live[data-phase=answering] .iris { animation: none; transform: scale(0.95); opacity: 1; }",
    ".veil[data-phase=answering] .halo { opacity: 0.9; }",
    // Done: it settles half open and breathes slowly while the answer stays on screen.
    ".veil[data-phase=done] .iris { animation: settle 0.8s ease-out both, rest 4s ease-in-out 0.8s infinite; }",
    ".veil[data-phase=done] .halo { opacity: 0.45; }",
    // Error: a dimmer, greyer iris that flickers.
    ".veil[data-phase=error] .iris { animation: flicker 1.6s steps(1) infinite; filter: grayscale(0.7); }",
    ".veil[data-phase=error] .halo { opacity: 0.25; }",
    ".label { font-size: clamp(18px, 2.4vw, 26px); letter-spacing: 0.04em; color: #B3E5FC; min-height: 1.4em; text-align: center; transition: opacity 0.2s; }",
    ".label .time { opacity: 0.75; font-variant-numeric: tabular-nums; margin-left: 8px; }",
    ".label.swap { opacity: 0; }",
    ".talk { width: min(900px, 100%); display: flex; flex-direction: column; gap: 16px; }",
    ".bubble { padding: 16px 22px; border-radius: 22px; font-size: clamp(20px, 2.8vw, 32px); line-height: 1.35; animation: msg 0.34s cubic-bezier(0.2,0.8,0.2,1) both; max-height: 38vh; overflow: hidden; }",
    ".q { align-self: flex-end; background: linear-gradient(135deg, #29B6F6, #0288D1); border-bottom-right-radius: 8px; box-shadow: 0 10px 30px rgba(2,136,209,0.35); }",
    ".a { align-self: flex-start; background: rgba(255,255,255,0.1); border: 1px solid rgba(179,229,252,0.35); border-bottom-left-radius: 8px; }",
    ".chips { display: flex; flex-wrap: wrap; gap: 8px; align-self: flex-start; }",
    ".chip { font-size: clamp(14px, 1.8vw, 18px); padding: 6px 14px; border-radius: 999px; background: rgba(3,169,244,0.18); border: 1px solid rgba(129,212,250,0.55); animation: chip 0.42s cubic-bezier(0.2,0.9,0.3,1.3) both; }",
    ".chip.off { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.3); }",
    ".hint { position: absolute; bottom: 3vh; font-size: 13px; opacity: 0.45; }",
    "@keyframes awaken { 0% { transform: scale(0.35); opacity: 0.35; } 60% { transform: scale(1.12); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }",
    "@keyframes breathe { 0%,100% { transform: scale(1); opacity: 1; } 50% { transform: scale(0.94); opacity: 0.88; } }",
    "@keyframes focus { to { transform: scale(0.42); opacity: 1; } }",
    "@keyframes ponder { 0%,100% { transform: scale(0.66); opacity: 0.8; } 50% { transform: scale(0.76); opacity: 1; } }",
    "@keyframes speak { 0%,100% { transform: scale(0.9); } 18% { transform: scale(1.02); } 34% { transform: scale(0.93); } 52% { transform: scale(1.05); } 70% { transform: scale(0.91); } 84% { transform: scale(0.99); } }",
    "@keyframes settle { from { transform: scale(1); opacity: 1; } to { transform: scale(0.8); opacity: 0.9; } }",
    "@keyframes rest { 0%,100% { transform: scale(0.8); opacity: 0.9; } 50% { transform: scale(0.76); opacity: 0.75; } }",
    "@keyframes flicker { 0%,100% { transform: scale(0.7); opacity: 0.6; } 10% { opacity: 0.2; } 14% { opacity: 0.65; } 50% { opacity: 0.45; } 54% { opacity: 0.15; } 58% { opacity: 0.6; } }",
    "@keyframes spin { to { transform: rotate(360deg); } }",
    "@keyframes halo-on { from { opacity: 0.15; } to { opacity: 1; } }",
    "@keyframes halo-breathe { 0%,100% { opacity: 1; } 50% { opacity: 0.6; } }",
    "@keyframes msg { from { opacity: 0; transform: translateY(14px) scale(0.98); } to { opacity: 1; transform: none; } }",
    "@keyframes chip { from { opacity: 0; transform: translateY(5px) scale(0.7); } 70% { transform: scale(1.06); } to { opacity: 1; transform: none; } }",
    "@media (prefers-reduced-motion: reduce) { .veil *, .veil { animation: none !important; transition: none !important; } }"
  ].join("\n");

  // ----- the room's voice, from this tablet's own microphone -----
  // Measured here only, never recorded or sent: a loudness, 60 times a
  // second, while the overlay shows (the microphone is let go a minute after
  // it hides). It swells the iris while Igor listens to you and while it
  // speaks. ?igor_tablet_mic=0 turns it off; without it (no permission, an
  // insecure page, a browser that waits for a touch) the iris keeps its own
  // animations.
  var MIC_KEY = "igor-tablet-mic";
  var micWanted = (function () {
    var param = null;
    try { param = new URLSearchParams(window.location.search).get("igor_tablet_mic"); } catch (e) { param = null; }
    try {
      if (param === "0" || param === "1") window.localStorage.setItem(MIC_KEY, param);
      return window.localStorage.getItem(MIC_KEY) !== "0";
    } catch (e) { return param !== "0"; }
  })();
  var mic = { stream: null, ctx: null, an: null, buf: null, lvl: 0, raf: 0, pending: false, stopTimer: null };
  var voiceEl = null;
  function micStart() {
    if (mic.stopTimer) { clearTimeout(mic.stopTimer); mic.stopTimer = null; }
    if (!micWanted || mic.stream || mic.pending || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return;
    var Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    mic.pending = true;
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } }).then(function (stream) {
      mic.pending = false;
      mic.stream = stream;
      mic.ctx = new Ctx();
      mic.an = mic.ctx.createAnalyser();
      mic.an.fftSize = 1024;
      mic.ctx.createMediaStreamSource(stream).connect(mic.an);
      mic.buf = new Float32Array(mic.an.fftSize);
      if (mic.ctx.state !== "running") {
        mic.ctx.resume().catch(function () {});
        // Some browsers start audio only after a touch on the page.
        document.addEventListener("pointerdown", function once() { if (mic.ctx) mic.ctx.resume().catch(function () {}); document.removeEventListener("pointerdown", once, true); }, true);
      }
      micLoop();
    }).catch(function () { mic.pending = false; micWanted = false; });
  }
  function micStop() {
    mic.stopTimer = null;
    if (mic.raf) cancelAnimationFrame(mic.raf);
    mic.raf = 0;
    if (mic.stream) mic.stream.getTracks().forEach(function (t) { t.stop(); });
    if (mic.ctx) mic.ctx.close().catch(function () {});
    mic.stream = mic.ctx = mic.an = mic.buf = null;
    mic.lvl = 0;
    applyLevel(false);
  }
  function applyLevel(live) {
    if (!veil) return;
    veil.classList.toggle("live", live);
    veil.style.setProperty("--lvl", live ? mic.lvl.toFixed(3) : "0");
    if (voiceEl) voiceEl.style.transform = live ? "scale(" + (1 + mic.lvl * 0.32).toFixed(3) + ")" : "";
  }
  function micLoop() {
    mic.raf = requestAnimationFrame(micLoop);
    if (!mic.an || !veil) return;
    var phase = veil.dataset.phase;
    var listen = veil.classList.contains("on") && (phase === "listening" || phase === "answering") && mic.ctx.state === "running";
    if (!listen) { if (mic.lvl) { mic.lvl = 0; applyLevel(false); } return; }
    mic.an.getFloatTimeDomainData(mic.buf);
    var sum = 0;
    for (var i = 0; i < mic.buf.length; i++) sum += mic.buf[i] * mic.buf[i];
    var db = 20 * Math.log10(Math.sqrt(sum / mic.buf.length) + 1e-9);
    // -58 dB (a quiet room) to -18 dB (a voice close by) as 0 to 1; quick to rise, slow to fall.
    var target = Math.min(1, Math.max(0, (db + 58) / 40));
    mic.lvl += (target > mic.lvl ? 0.45 : 0.1) * (target - mic.lvl);
    applyLevel(true);
  }

  var host, veil, labelEl, talk, qEl, aEl, chipsEl;
  function build() {
    host = document.createElement("igor-tablet");
    var root = host.attachShadow({ mode: "open" });
    var style = document.createElement("style");
    style.textContent = CSS;
    root.appendChild(style);
    veil = document.createElement("div");
    veil.className = "veil";
    veil.setAttribute("role", "status");
    veil.setAttribute("aria-live", "polite");
    var head = document.createElement("div");
    head.className = "head";
    var eye = document.createElement("div");
    eye.className = "eye";
    eye.innerHTML = EYE;
    head.appendChild(eye);
    voiceEl = eye.querySelector(".voice");
    labelEl = document.createElement("div");
    labelEl.className = "label";
    talk = document.createElement("div");
    talk.className = "talk";
    var hint = document.createElement("div");
    hint.className = "hint";
    hint.textContent = "Touchez l'écran pour fermer";
    veil.appendChild(head);
    veil.appendChild(labelEl);
    veil.appendChild(talk);
    veil.appendChild(hint);
    veil.addEventListener("click", function () { dismissed = view.turnKey; hide(); });
    root.appendChild(veil);
    document.body.appendChild(host);
  }

  // ----- what is shown -----
  var view = { phase: "", turnKey: "", doneKey: "", question: "", answer: "", chips: "", kind: "general", start: 0, queue: [], phrase: "", shown: 0, seen: {}, thinking: false, hint: "" };
  var dismissed = null;
  var hideTimer = null;

  function show() {
    if (!host) build();
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    veil.classList.add("on");
    micStart();
  }
  function hide() {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    if (veil) veil.classList.remove("on");
    view.phase = "";
    if (mic.stream && !mic.stopTimer) mic.stopTimer = setTimeout(micStop, 60000);
  }
  function hideSoon(ms) {
    if (hideTimer) return;
    hideTimer = setTimeout(function () { hideTimer = null; hide(); }, ms);
  }

  function setLabel(text, withTime) {
    if (labelEl.dataset.text === text && labelEl.dataset.time === String(!!withTime)) { tickTime(); return; }
    var first = !labelEl.dataset.text;
    labelEl.dataset.text = text;
    labelEl.dataset.time = String(!!withTime);
    function paint() {
      labelEl.textContent = text;
      if (withTime) {
        var t = document.createElement("span");
        t.className = "time";
        labelEl.appendChild(t);
        tickTime();
      }
      labelEl.classList.remove("swap");
    }
    if (first) { paint(); return; }
    labelEl.classList.add("swap");
    setTimeout(paint, 200);
  }
  function tickTime() {
    var t = labelEl.querySelector(".time");
    if (t) t.textContent = "· " + elapsed(Date.now() - view.start);
  }

  function nextPhrase() {
    var ms = Date.now() - view.start;
    if (!view.queue.length || (ms >= 30000 && !view.seen.long) || (ms >= 60000 && !view.seen.veryLong)) {
      var pool = ms >= 60000 && !view.seen.veryLong ? (view.seen.veryLong = view.seen.long = true, PHRASES.veryLong)
        : ms >= 30000 && !view.seen.long ? (view.seen.long = true, PHRASES.long)
        : view.thinking ? PHRASES.thinking.concat(PHRASES[view.kind]) : PHRASES[view.kind].concat(PHRASES.general);
      view.queue = shuffled(pool);
    }
    var next = view.queue.shift();
    if (next === view.phrase && view.queue.length) next = view.queue.shift();
    view.phrase = next;
    view.shown = Date.now();
  }

  function setBubble(which, text) {
    var el = which === "q" ? qEl : aEl;
    if (!text) { if (el && el.parentNode) el.parentNode.removeChild(el); if (which === "q") qEl = null; else aEl = null; return; }
    if (!el) {
      el = document.createElement("div");
      el.className = "bubble " + which;
      if (which === "q") { talk.insertBefore(el, talk.firstChild); qEl = el; }
      else { talk.insertBefore(el, chipsEl && chipsEl.parentNode ? chipsEl : null); aEl = el; }
    }
    if (el.textContent !== text) el.textContent = text;
    if (which === "a") el.scrollTop = el.scrollHeight;
  }
  function setChips(list) {
    var key = JSON.stringify(list || []);
    if (key === view.chips) return;
    view.chips = key;
    if (chipsEl && chipsEl.parentNode) chipsEl.parentNode.removeChild(chipsEl);
    chipsEl = null;
    if (!list || !list.length) return;
    chipsEl = document.createElement("div");
    chipsEl.className = "chips";
    list.forEach(function (c, i) {
      var chip = document.createElement("span");
      chip.className = "chip" + (c.kind === "off" ? " off" : "");
      chip.style.animationDelay = (i * 0.06) + "s";
      chip.textContent = c.label;
      chipsEl.appendChild(chip);
    });
    talk.appendChild(chipsEl);
  }
  function clearTalk() {
    setBubble("q", ""); setBubble("a", ""); setChips([]);
  }

  // ----- reading Home Assistant -----
  function hassObj() {
    var ha = document.querySelector("home-assistant");
    return ha && ha.hass;
  }
  function findSensor(states) {
    if (view.sensorId && states[view.sensorId]) return states[view.sensorId];
    for (var id in states) {
      if (id.indexOf("sensor.") === 0 && states[id].attributes && states[id].attributes.igor_voice) { view.sensorId = id; return states[id]; }
    }
    return null;
  }
  // A state held far longer than any real exchange is a stuck satellite, or
  // one that reports "listening" all the time (wake word handled in Home
  // Assistant): ignored, or the overlay would never leave the screen.
  var STALE_MS = { listening: 30000, processing: 90000, responding: 180000 };
  var seen = {};
  function fresh(id, state) {
    var now = Date.now();
    if (!seen[id] || seen[id].state !== state) seen[id] = { state: state, since: now };
    return !(STALE_MS[state] && now - seen[id].since > STALE_MS[state]);
  }
  function satelliteState(states, wanted) {
    if (wanted) {
      var w = states[wanted] ? states[wanted].state : "";
      return w && fresh(wanted, w) ? w : "";
    }
    // Any satellite busy counts: listening first, then the others.
    var best = "";
    for (var id in states) {
      if (id.indexOf("assist_satellite.") !== 0) continue;
      var s = states[id].state;
      if (!fresh(id, s)) continue;
      if (s === "listening") return s;
      if (s === "processing" || s === "responding") best = s;
    }
    return best;
  }

  function update() {
    var hass = hassObj();
    if (!hass || !hass.states) return;
    var states = hass.states;
    var sensor = findSensor(states);
    var sat = satelliteState(states, onlySatellite);
    var attrs = sensor ? sensor.attributes : {};
    var sensorState = sensor ? sensor.state : "idle";
    var fromWanted = !onlySatellite || attrs.satellite === onlySatellite;
    var turnKey = String(attrs.turn || "") + "|" + (attrs.started || "");
    var live = fromWanted && (sensorState === "thinking" || sensorState === "answering");

    if (sat === "listening") {
      if (view.phase !== "listening") {
        dismissed = null;
        // A follow-up (the mic reopening right after Igor's question) keeps the
        // exchange in view; a new request starts clean.
        if (view.phase !== "done") clearTalk();
        view.phase = "listening";
        show();
        veil.dataset.phase = "listening";
        setLabel("Je vous écoute…", false);
      }
      return;
    }
    // Igor heard its name (igor-ear, no wake word): shown at once, before
    // the words reach Igor a few seconds later.
    var heardFresh = attrs.started && Date.now() - Date.parse(attrs.started) < 120000;
    if (fromWanted && sensorState === "heard" && heardFresh) {
      if (dismissed === turnKey) return;
      var waiting = attrs.status === "listening";
      var phase = waiting ? "listening" : "transcribing";
      if (view.phase !== phase || view.turnKey !== turnKey) {
        // Igor asked a question and listens for the answer: the exchange
        // stays in view, as with a satellite's own follow-up.
        if (view.turnKey !== turnKey) { dismissed = null; if (!(waiting && view.phase === "done")) clearTalk(); }
        view.turnKey = turnKey;
        view.phase = phase;
        show();
        veil.dataset.phase = waiting ? "listening" : "transcribing";
        setLabel(waiting ? "Je vous écoute…" : "Je vous ai entendu…", false);
      }
      return;
    }
    if (dismissed && dismissed === turnKey && !live) return;
    if (live) {
      if (dismissed === turnKey) return;
      if (view.turnKey !== turnKey) {
        view.turnKey = turnKey;
        view.kind = kindOf(attrs.question);
        view.start = attrs.started ? Date.parse(attrs.started) || Date.now() : Date.now();
        view.queue = PHRASES[view.kind].slice(0, 1).concat(shuffled(PHRASES[view.kind].slice(1)));
        view.seen = {}; view.thinking = false; view.hint = ""; view.phrase = "";
        clearTalk();
        nextPhrase();
      }
      show();
      setBubble("q", attrs.question || "");
      if (attrs.status && attrs.status !== view.hint) {
        view.hint = attrs.status;
        if (/^Réflexion/.test(attrs.status)) { view.thinking = true; view.queue = shuffled(PHRASES.thinking); }
        else view.queue.unshift(attrs.status);
        nextPhrase();
      }
      if (sensorState === "answering" && attrs.answer) {
        view.phase = "answering";
        veil.dataset.phase = "answering";
        setBubble("a", attrs.answer);
        setLabel("", false);
      } else {
        view.phase = "thinking";
        veil.dataset.phase = "thinking";
        if (Date.now() - view.shown >= 5000) nextPhrase();
        else if ((Date.now() - view.start >= 30000 && !view.seen.long) || (Date.now() - view.start >= 60000 && !view.seen.veryLong)) nextPhrase();
        setLabel(view.phrase, true);
      }
      return;
    }
    // The answer is complete. Also for a reply quick enough to go from
    // "thinking" to "done" between two looks, while still waiting on screen.
    var fresh = attrs.started && Date.now() - Date.parse(attrs.started) < 60000;
    if (fromWanted && (sensorState === "done" || sensorState === "error") && view.doneKey !== turnKey &&
        (view.turnKey === turnKey ? (view.phase === "thinking" || view.phase === "answering") : (fresh && (view.phase === "transcribing" || view.phase === "thinking")))) {
      view.doneKey = turnKey;
      view.turnKey = turnKey;
      view.phase = "done";
      veil.dataset.phase = sensorState === "error" ? "error" : "done";
      setBubble("q", attrs.question || "");
      setBubble("a", attrs.answer || (sensorState === "error" ? "Je n'ai pas pu répondre." : ""));
      setChips(attrs.actions || []);
      setLabel("", false);
    }
    if (sat === "processing" && view.phase !== "thinking" && view.phase !== "answering" && view.phase !== "done") {
      // Transcribing: Igor has not got the words yet.
      view.phase = "transcribing";
      show();
      veil.dataset.phase = "transcribing";
      setLabel("Un instant…", false);
      return;
    }
    if (view.phase === "done") {
      // Gone a few seconds after the satellite stops talking.
      if (sat !== "responding") hideSoon(6000);
      else if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    } else if (view.phase && !sat) {
      // Woken but nothing asked (a false wake word), or the satellite gave up.
      hideSoon(4000);
    }
  }

  function start() {
    setInterval(function () {
      try { update(); } catch (e) { /* the display must never break the page */ }
    }, 250);
  }
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start);
})();
