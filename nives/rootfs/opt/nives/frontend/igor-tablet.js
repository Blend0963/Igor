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
  var BOW = '<svg viewBox="0 0 64 40" aria-hidden="true"><path d="M27 15.5 L8 6 Q5 4.5 5 8 V32 Q5 35.5 8 34 L27 24.5 Z M37 15.5 L56 6 Q59 4.5 59 8 V32 Q59 35.5 56 34 L37 24.5 Z" fill="#fff"/><rect x="26" y="13" width="12" height="14" rx="3.5" fill="#81D4FA"/></svg>';
  var CSS = [
    ":host { all: initial; }",
    ".veil { position: fixed; inset: 0; z-index: 2147483000; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 28px; padding: 6vh 6vw; box-sizing: border-box;",
    "  background: radial-gradient(ellipse at 50% 30%, rgba(3,169,244,0.28), rgba(0,0,0,0) 60%), rgba(6,14,22,0.82); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);",
    "  font-family: var(--paper-font-body1_-_font-family, Roboto, 'Noto Sans', system-ui, sans-serif); color: #fff; opacity: 0; transition: opacity 0.35s ease; pointer-events: none; }",
    ".veil.on { opacity: 1; pointer-events: auto; }",
    ".bow { width: 120px; height: 75px; filter: drop-shadow(0 8px 18px rgba(3,169,244,0.55)); }",
    ".bow svg { width: 100%; height: 100%; }",
    ".veil[data-phase=listening] .bow { animation: flap 1.1s ease-in-out infinite; }",
    ".veil[data-phase=thinking] .bow { animation: flap 0.8s ease-in-out infinite; }",
    ".veil[data-phase=answering] .bow { animation: float 3s ease-in-out infinite; }",
    ".veil[data-phase=done] .bow { animation: adjust 0.9s ease both; }",
    ".rings { position: absolute; width: 120px; height: 120px; border-radius: 50%; border: 2px solid rgba(129,212,250,0.6); opacity: 0; }",
    ".veil[data-phase=listening] .rings { animation: ring 1.8s ease-out infinite; }",
    ".head { position: relative; display: flex; align-items: center; justify-content: center; }",
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
    "@keyframes flap { 0%,100% { transform: scaleX(1); } 50% { transform: scaleX(0.6); } }",
    "@keyframes float { 0%,100% { transform: translateY(0) rotate(0); } 50% { transform: translateY(-6px) rotate(-4deg); } }",
    "@keyframes adjust { 0% { transform: rotate(0); } 25% { transform: rotate(-14deg); } 55% { transform: rotate(9deg); } 80% { transform: rotate(-3deg); } 100% { transform: rotate(0); } }",
    "@keyframes ring { 0% { transform: scale(0.8); opacity: 0.7; } 100% { transform: scale(2.2); opacity: 0; } }",
    "@keyframes msg { from { opacity: 0; transform: translateY(14px) scale(0.98); } to { opacity: 1; transform: none; } }",
    "@keyframes chip { from { opacity: 0; transform: translateY(5px) scale(0.7); } 70% { transform: scale(1.06); } to { opacity: 1; transform: none; } }",
    "@media (prefers-reduced-motion: reduce) { .veil *, .veil { animation: none !important; transition: none !important; } }"
  ].join("\n");

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
    var rings = document.createElement("div");
    rings.className = "rings";
    var bow = document.createElement("div");
    bow.className = "bow";
    bow.innerHTML = BOW;
    head.appendChild(rings);
    head.appendChild(bow);
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
  }
  function hide() {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    if (veil) veil.classList.remove("on");
    view.phase = "";
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
    var heardFresh = attrs.started && Date.now() - Date.parse(attrs.started) < 30000;
    if (fromWanted && sensorState === "heard" && heardFresh) {
      if (dismissed === turnKey) return;
      var waiting = attrs.status === "listening";
      var phase = waiting ? "listening" : "transcribing";
      if (view.phase !== phase || view.turnKey !== turnKey) {
        if (view.turnKey !== turnKey) { dismissed = null; clearTalk(); }
        view.turnKey = turnKey;
        view.phase = phase;
        show();
        veil.dataset.phase = waiting ? "listening" : "thinking";
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
      veil.dataset.phase = "done";
      setBubble("q", attrs.question || "");
      setBubble("a", attrs.answer || (sensorState === "error" ? "Je n'ai pas pu répondre." : ""));
      setChips(attrs.actions || []);
      setLabel("", false);
    }
    if (sat === "processing" && view.phase !== "thinking" && view.phase !== "answering" && view.phase !== "done") {
      // Transcribing: Igor has not got the words yet.
      view.phase = "transcribing";
      show();
      veil.dataset.phase = "thinking";
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
