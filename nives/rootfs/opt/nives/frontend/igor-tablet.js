// Igor on a wall tablet: what the voice satellite hears and answers, full
// screen, in Igor's style.
//
// Home Assistant loads this on every page (frontend.add_extra_js_url); it
// shows nothing by itself until switched on for the device, by opening Home Assistant
// once with ?igor_tablet=1 (any satellite) or ?igor_tablet=assist_satellite.x
// (that one only); ?igor_tablet=0 switches it off. The choice is kept in this
// browser only.
//
// Everything comes from the states this page already has: the satellite's
// own state (listening, processing, responding, idle) and the "Igor Assist"
// sensor the integration fills while Igor answers (question, answer, chips).
// Shown as a plain journal: your words, the local model's steps (from the
// sensor's "trace"), what was done and Igor's answer.
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
  // Off, the page still answers a dashboard card asking for the history (the
  // Igor journal card's "historique"): only the live display stays away.
  var setting = readSetting();
  var onlySatellite = /^assist_satellite\./.test(setting) ? setting : null;

  // ----- the journal: Igor's turn, laid out like a log -----
  // Sober on purpose (the tablet may be old): one solid background, no blur,
  // no glow, nothing animated but a blinking cursor. Your words, what the
  // local model did step by step (each marked "local" or "en ligne", with
  // its time), what was done, and Igor's answer.
  var MONO = "ui-monospace, 'JetBrains Mono', 'SFMono-Regular', Menlo, 'Roboto Mono', 'DejaVu Sans Mono', monospace";
  var CSS = [
    ":host { all: initial; }",
    ".veil { position: fixed; inset: 0; z-index: 2147483000; display: flex; flex-direction: column; box-sizing: border-box; background: #07080a; color: #e9e4da;",
    "  font-family: " + MONO + "; opacity: 0; transition: opacity 0.25s ease; pointer-events: none; }",
    ".veil.on { opacity: 1; pointer-events: auto; }",
    ".bar { display: flex; justify-content: space-between; align-items: center; padding: 14px 4vw; border-bottom: 1px solid #22262c; font-size: clamp(13px, 1.6vw, 17px); color: #878c95; flex: none; }",
    ".id { display: flex; align-items: center; gap: 10px; color: #e9e4da; }",
    ".id svg { width: 22px; height: 22px; display: block; }",
    ".id b { font-family: 'Chakra Petch', " + MONO + "; letter-spacing: 0.22em; font-weight: 600; color: #e9e4da; }",
    ".id small { color: #878c95; letter-spacing: 0.12em; text-transform: uppercase; font-size: 0.8em; }",
    ".state { display: flex; align-items: center; gap: 8px; font-variant-numeric: tabular-nums; }",
    ".dot { width: 9px; height: 9px; border-radius: 50%; background: #3d454e; }",
    ".veil[data-phase=listening] .dot { background: #59d0e0; }",
    ".veil[data-phase=transcribing] .dot, .veil[data-phase=thinking] .dot { background: #e0a33a; }",
    ".veil[data-phase=answering] .dot, .veil[data-phase=done] .dot { background: #5cc28f; }",
    ".veil[data-phase=error] .dot { background: #e5323b; }",
    ".log { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 12px; padding: 3vh 4vw 4vh; overflow: hidden; width: 100%; max-width: 1100px; margin: 0 auto; box-sizing: border-box; }",
    ".say { display: grid; grid-template-columns: 4.5rem 1fr; gap: 14px; font-size: clamp(18px, 2.6vw, 30px); line-height: 1.32; margin-top: 10px; }",
    ".say .w { color: #878c95; font-size: 14px; text-align: right; padding-top: 0.7em; }",
    ".say.q { color: #e9e4da; }",
    ".say.a { color: #59d0e0; }",
    ".veil[data-phase=error] .say.a { color: #e5323b; }",
    ".say .t { overflow-wrap: anywhere; max-height: 40vh; overflow: hidden; }",
    ".tr { display: grid; grid-template-columns: 6ch 15ch minmax(0, 1fr) auto; gap: 18px; font-size: clamp(12px, 1.5vw, 16px); color: #878c95; }",
    ".tr .ms { text-align: right; color: #3d454e; font-variant-numeric: tabular-nums; }",
    ".tr .d { color: #b9b4aa; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
    ".tr .local { color: #5cc28f; } .tr .online { color: #e0a33a; } .tr .none { color: #3d454e; }",
    ".done { padding-left: calc(6ch + 14px); font-size: clamp(14px, 1.9vw, 20px); color: #5cc28f; }",
    ".done span + span::before { content: ' · '; color: #3d454e; }",
    ".cur { display: inline-block; width: 0.55em; height: 1.05em; background: #59d0e0; vertical-align: -0.15em; margin-left: 3px; animation: blink 1s steps(1) infinite; }",
    ".hint { position: absolute; right: 4vw; bottom: 1.5vh; font-size: 12px; color: #3d454e; }",
    ".x { background: none; border: 1px solid #22262c; color: #878c95; font: inherit; font-size: 13px; padding: 4px 10px; border-radius: var(--igor-radius, 3px); cursor: pointer; margin-left: 14px; }",
    ".x:focus-visible { outline: 2px solid #59d0e0; outline-offset: 2px; }",
    ".hist { flex: 1; overflow-y: auto; padding: 2vh 4vw 4vh; display: none; flex-direction: column; gap: 6px; -webkit-overflow-scrolling: touch; }",
    ".veil[data-mode=history] .hist { display: flex; }",
    ".veil[data-mode=history] .log, .veil[data-mode=history] .hint { display: none; }",
    ".day::before { content: ''; display: inline-block; width: 6px; height: 6px; background: #e5323b; margin-right: 8px; vertical-align: 2px; }",
    ".day { margin: 22px 0 4px; color: #878c95; letter-spacing: 0.12em; text-transform: uppercase; font-size: clamp(12px, 1.4vw, 15px); border-bottom: 1px solid #22262c; padding-bottom: 4px; }",
    ".entry { padding: 6px 0 12px; border-bottom: 1px solid #16191d; }",
    ".entry .say { font-size: clamp(17px, 2.3vw, 26px); margin-top: 6px; }",
    ".when { color: #3d454e; font-size: 0.55em; text-align: right; padding-top: 0.55em; }",
    ".empty { color: #878c95; margin: auto; font-size: clamp(14px, 1.8vw, 18px); }",
    // one exchange: time | words, answer, what was done, where the seconds went | route and total
    ".ex { display: grid; grid-template-columns: 6ch minmax(0, 1fr) auto; gap: 6px 18px; padding: 14px 0; border-top: 1px solid #22262c; cursor: pointer; }",
    ".ex .time { color: #878c95; font-variant-numeric: tabular-nums; padding-top: 3px; font-size: clamp(12px, 1.4vw, 15px); }",
    ".ex .said { font-size: clamp(15px, 1.9vw, 19px); line-height: 1.4; color: #e9e4da; min-width: 0; overflow-wrap: anywhere; }",
    ".ex .said.long { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }",
    ".ex.open .said.long { display: block; }",
    ".side { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }",
    ".route { font-size: 11px; border-radius: var(--igor-radius, 3px); padding: 2px 10px; border: 1px solid; white-space: nowrap; }",
    ".route.local { color: #5cc28f; border-color: rgba(92,194,143,0.4); } .route.online { color: #e0a33a; border-color: rgba(224,163,58,0.4); } .route.fail { color: #e5323b; border-color: rgba(229,50,59,0.4); }",
    ".total { font-size: 18px; font-variant-numeric: tabular-nums; } .total small { color: #878c95; font-size: 11px; }",
    ".exb { grid-column: 2; display: grid; gap: 8px; min-width: 0; }",
    ".ans { color: #59d0e0; line-height: 1.45; border-left: 2px solid #59d0e0; padding-left: 10px; font-size: clamp(14px, 1.7vw, 17px); overflow-wrap: anywhere; }",
    ".chips { display: flex; flex-wrap: wrap; gap: 6px; }",
    ".chip { font-size: clamp(12px, 1.4vw, 14px); padding: 3px 10px; border-radius: var(--igor-radius, 3px); background: rgba(92,194,143,0.1); color: #5cc28f; }",
    ".chip.fail { background: rgba(229,50,59,0.12); color: #e5323b; }",
    ".tb { display: grid; gap: 6px; }",
    ".tbar { display: flex; height: 6px; border-radius: var(--igor-radius, 3px); overflow: hidden; gap: 2px; max-width: 520px; }",
    ".legend { display: flex; gap: 14px; flex-wrap: wrap; font-size: clamp(11px, 1.3vw, 13px); color: #878c95; }",
    ".legend span::before { content: ''; display: inline-block; width: 8px; height: 8px; border-radius: var(--igor-radius, 3px); margin-right: 5px; background: var(--c); }",
    ".steps { display: none; } .ex.open .steps { display: block; }",
    ".more { color: #3d454e; font-size: 11px; }",
    ".stats { display: grid; grid-template-columns: repeat(4, 1fr); border-bottom: 1px solid #22262c; }",
    ".stats div { padding: 10px 0; } .stats b { display: block; font-size: clamp(16px, 2.2vw, 22px); font-weight: 500; font-variant-numeric: tabular-nums; }",
    ".stats span { color: #878c95; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; }",
    ".filters { display: flex; gap: 6px; margin: 10px 0 2px; flex-wrap: wrap; }",
    ".fb { background: none; border: 1px solid #22262c; border-radius: var(--igor-radius, 3px); padding: 3px 11px; color: #878c95; font: inherit; font-size: 12px; cursor: pointer; } .fb.sel { border-color: #59d0e0; color: #59d0e0; }",
    // the live turn, the same way
    ".log .tb, .log .chips, .log .ear { padding-left: calc(4.5rem + 14px); }",
    ".log .ear { color: #5cc28f; font-size: clamp(12px, 1.4vw, 15px); }",
    ".log .ear::before { content: '● '; }",
    ".log .say.a .t { border-left: 2px solid #59d0e0; padding-left: 12px; }",
    // ----- the live turn: a sheet over the lower half, the switches dimmed behind -----
    ".dim { position: fixed; inset: 0; z-index: 2147482999; background: rgba(0, 0, 0, 0.62); opacity: 0; transition: opacity 0.25s ease; pointer-events: none; }",
    ".dim.on { opacity: 1; pointer-events: auto; }",
    ".sheet { position: fixed; left: 0; right: 0; bottom: 0; height: 56vh; z-index: 2147483000; box-sizing: border-box; background: #0b0d10; border-top: 1px solid #22262c;",
    "  color: #e9e4da; font-family: " + MONO + "; display: flex; flex-direction: column; gap: 2vh; padding: 2.4vh 4vw 2vh; transform: translateY(102%); transition: transform 0.3s ease; }",
    ".sheet.on { transform: none; }",
    ".sh { display: flex; justify-content: space-between; align-items: center; color: #878c95; font-size: clamp(11px, 1.4vw, 14px); letter-spacing: 0.12em; text-transform: uppercase; flex: none; }",
    ".sh .st { display: flex; align-items: center; gap: 12px; }",
    ".sh svg { width: clamp(26px, 3.6vw, 38px); height: clamp(26px, 3.6vw, 38px); display: block; }",
    ".sh .ring { transform-origin: 128px 96px; }",
    ".sheet[data-p=listening] .ring { stroke: #59d0e0; animation: pulse 1.2s ease-in-out infinite; } .sheet[data-p=listening] .pupil { fill: #59d0e0; }",
    ".sheet[data-p=words] .ring, .sheet[data-p=thinking] .ring { stroke: #e0a33a; } .sheet[data-p=words] .pupil, .sheet[data-p=thinking] .pupil { fill: #e0a33a; }",
    ".sheet[data-p=thinking] .ring { animation: pulse 0.8s ease-in-out infinite; }",
    ".sheet[data-p=answer] .ring { stroke: #e9e4da; } .sheet[data-p=answer] .pupil { fill: #e9e4da; }",
    ".sheet[data-p=nothing] .ring, .sheet[data-p=nothing] .pupil { stroke: #878c95; fill: #878c95; } .sheet[data-p=nothing] .ring { fill: #07080a; }",
    ".sq { font-size: clamp(20px, 3.2vw, 36px); line-height: 1.3; color: #e9e4da; overflow-wrap: anywhere; max-height: 22vh; overflow: hidden; }",
    ".sq.small { font-size: clamp(14px, 1.8vw, 19px); color: #878c95; }",
    ".sheet[data-p=nothing] .sq { color: #878c95; }",
    ".sa { font-size: clamp(18px, 2.7vw, 30px); line-height: 1.35; color: #59d0e0; overflow-wrap: anywhere; max-height: 20vh; overflow: hidden; }",
    ".sheet[data-p=error] .sa { color: #e5323b; }",
    ".ssteps { display: flex; flex-wrap: wrap; gap: 8px; font-size: clamp(11px, 1.3vw, 14px); }",
    ".ssteps span { border: 1px solid #22262c; border-radius: var(--igor-radius, 3px); padding: 2px 10px; color: #878c95; }",
    ".ssteps .local { color: #5cc28f; border-color: rgba(92, 194, 143, 0.4); } .ssteps .online { color: #e0a33a; border-color: rgba(224, 163, 58, 0.4); }",
    ".schips { display: flex; flex-wrap: wrap; gap: 8px; }",
    ".schips span { border: 1px solid #59d0e0; color: #59d0e0; border-radius: var(--igor-radius, 3px); padding: 3px 12px; font-size: clamp(13px, 1.6vw, 17px); }",
    ".schips span.fail { border-color: #e5323b; color: #e5323b; }",
    ".sprog { height: 2px; background: #22262c; flex: none; visibility: hidden; } .sprog i { display: block; height: 100%; background: #878c95; width: 100%; }",
    ".sprog.run { visibility: visible; } .sprog.run i { transition: width 6s linear; width: 0; }",
    ".sf { margin-top: auto; display: flex; justify-content: space-between; color: #3d454e; font-size: clamp(11px, 1.3vw, 13px); flex: none; }",
    ".sf button { background: none; border: 0; color: #878c95; font: inherit; cursor: pointer; padding: 0; }",
    ".scur { display: inline-block; width: 0.5em; height: 1em; background: #59d0e0; vertical-align: -0.12em; animation: blink 1s steps(1) infinite; }",
    "@keyframes pulse { 50% { transform: scale(1.18); } }",
    "@keyframes blink { 50% { opacity: 0; } }",
    "@media (prefers-reduced-motion: reduce) { .cur, .scur, .sh .ring { animation: none !important; } .veil, .sheet, .dim { transition: none; } }"
  ].join("\n");

  function elapsed(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    if (s < 60) return s + " s";
    var r = s % 60;
    return Math.floor(s / 60) + " min " + (r < 10 ? "0" : "") + r + " s";
  }
  function seconds(ms) { return (ms / 1000).toFixed(1).replace(".", ",") + " s"; }

  var host, veil, stateEl, closeEl, logEl, histEl, earEl, qEl, traceEl, doneEl, aEl;
  var dimEl, sheet, sStateEl, sQEl, sStepsEl, sAEl, sChipsEl, sProgEl, sFootEl;
  function el(tag, cls, parent) { var d = document.createElement(tag); if (cls) d.className = cls; if (parent) parent.appendChild(d); return d; }
  function build() {
    host = document.createElement("igor-tablet");
    var root = host.attachShadow({ mode: "open" });
    el("style", "", root).textContent = CSS;
    veil = el("div", "veil", root);
    veil.setAttribute("role", "status");
    veil.setAttribute("aria-live", "polite");
    var bar = el("div", "bar", veil);
    var id = el("span", "id", bar);
    // Igor's eye and name, as on the wall's bar.
    id.insertAdjacentHTML("beforeend", '<svg viewBox="0 0 256 256" aria-hidden="true"><rect x="107" y="20" width="44" height="216" fill="#e9e4da"/><circle cx="128" cy="96" r="48" fill="#07080a" stroke="#e5323b" stroke-width="16"/><circle cx="128" cy="96" r="16" fill="#e5323b"/></svg>');
    el("b", "", id).textContent = "IGOR";
    el("small", "", id).textContent = "journal";
    var st = el("span", "state", bar);
    el("span", "dot", st);
    stateEl = el("span", "", st);
    closeEl = el("button", "x", st);
    closeEl.type = "button";
    closeEl.textContent = "fermer";
    closeEl.hidden = true;
    closeEl.addEventListener("click", function (ev) { ev.stopPropagation(); closeHistory(); });
    logEl = el("div", "log", veil);
    histEl = el("div", "hist", veil);
    el("div", "hint", veil).textContent = "toucher pour fermer";
    veil.addEventListener("click", function () { if (veil.dataset.mode === "history") return; dismissed = view.turnKey; hide(); });
    root.appendChild(veil);
    // The live turn: the sheet over the lower half, its dimmer above the switches.
    dimEl = el("div", "dim", root);
    dimEl.addEventListener("click", function () { closeTurn(); });
    sheet = el("div", "sheet", root);
    sheet.setAttribute("role", "status");
    sheet.setAttribute("aria-live", "polite");
    var sh = el("div", "sh", sheet);
    var sst = el("span", "st", sh);
    sst.innerHTML = '<svg viewBox="0 0 256 256" aria-hidden="true"><rect x="107" y="20" width="44" height="216" fill="#e9e4da"/><circle class="ring" cx="128" cy="96" r="48" fill="#07080a" stroke="#e5323b" stroke-width="16"/><circle class="pupil" cx="128" cy="96" r="16" fill="#e5323b"/></svg>';
    sStateEl = el("span", "", sst);
    el("span", "", sh).textContent = "toucher dehors : fermer";
    sQEl = el("div", "sq", sheet);
    sStepsEl = el("div", "ssteps", sheet);
    sAEl = el("div", "sa", sheet);
    sChipsEl = el("div", "schips", sheet);
    sProgEl = el("div", "sprog", sheet); el("i", "", sProgEl);
    var sf = el("div", "sf", sheet);
    sFootEl = el("span", "", sf);
    var hb = el("button", "", sf); hb.type = "button"; hb.textContent = "historique ›";
    hb.addEventListener("click", function (ev) { ev.stopPropagation(); closeTurn(); openHistory(); });
    // A touch on the sheet keeps it up (the countdown stops).
    sheet.addEventListener("click", function () { T.pinned = true; stopCountdown(); sFootEl.textContent = "gardé ouvert · toucher dehors pour fermer"; });
    document.body.appendChild(host);
  }

  // ----- what is shown -----
  var view = { phase: "", turnKey: "", doneKey: "", start: 0, status: "", heardAt: 0, trace: "", chips: "" };
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

  // The bar's state, with the time since the request when Igor works on it.
  function setState(text, withTime) {
    view.status = text;
    stateEl.textContent = withTime ? text + " · " + elapsed(Date.now() - view.start) : text;
  }

  function slot(current, cls, before) {
    if (current && current.parentNode) return current;
    var d = el("div", cls);
    logEl.insertBefore(d, before && before.parentNode ? before : null);
    return d;
  }
  function trRow(parent, step, detail, where, ms) {
    var r = el("div", "tr", parent);
    el("span", "ms", r).textContent = ms != null ? seconds(ms) : "";
    el("span", where, r).textContent = step;
    var d = el("span", "d", r); d.textContent = detail;
    el("span", where, r).textContent = where === "local" ? "local" : where === "online" ? "en ligne" : "—";
  }
  // The ear heard the name: the first line of the turn's trace.
  function setEar() {
    view.heardAt = Date.now();
    earEl = slot(earEl, "ear", logEl.firstChild);
    earEl.textContent = "oreille · nom entendu";
  }
  function setSay(which, text, typing) {
    var cur = which === "q" ? qEl : aEl;
    if (!text) { if (cur && cur.parentNode) cur.parentNode.removeChild(cur); if (which === "q") qEl = null; else aEl = null; return; }
    if (!cur || !cur.parentNode) {
      cur = el("div", "say " + which);
      el("span", "w", cur).textContent = which === "q" ? "vous" : "igor";
      el("span", "t", cur);
      // Order: your words, the trace, what was done, then Igor's answer.
      if (which === "q") logEl.insertBefore(cur, traceEl && traceEl.parentNode ? traceEl : (doneEl && doneEl.parentNode ? doneEl : (aEl && aEl.parentNode ? aEl : null)));
      else logEl.appendChild(cur);
      if (which === "q") qEl = cur; else aEl = cur;
    }
    var t = cur.lastChild;
    if (t.firstChild && t.firstChild.nodeValue === text && !!t.querySelector(".cur") === !!typing) return;
    t.textContent = text;
    if (typing) el("span", "cur", t);
  }
  // Where the seconds went: one coloured bar, a short legend.
  var STEP = { local: ["modèle local", "#5cc28f"], ha: ["home assistant", "#2f8fc4"], mistral: ["mistral", "#e0a33a"],
    destinataire: ["destinataire", "#c98a3a"], oreille: ["oreille", "#59d0e0"] };
  function timeBar(parent, list) {
    var sums = [], by = {};
    (list || []).forEach(function (s) {
      if (typeof s.ms !== "number" || s.ms <= 0) return;
      if (!by[s.step]) { by[s.step] = { step: s.step, ms: 0 }; sums.push(by[s.step]); }
      by[s.step].ms += s.ms;
    });
    if (!sums.length) return null;
    var box = el("div", "tb", parent), bar = el("div", "tbar", box), leg = el("div", "legend", box);
    sums.forEach(function (x) {
      var k = STEP[x.step] || [x.step, "#6b7682"];
      var seg = el("i", "", bar); seg.style.flex = String(x.ms); seg.style.background = k[1];
      var l = el("span", "", leg); l.style.setProperty("--c", k[1]); l.textContent = k[0] + " " + seconds(x.ms);
    });
    return box;
  }
  // « light.10_45_30_3 · éteint » → « Salon · éteint »; a scene's timestamp → « activée ».
  function niceLabel(text) {
    var hass = hassObj(), states = (hass && hass.states) || {};
    return String(text || "")
      .replace(/\b([a-z_]+\.[a-z0-9_]+)\b/g, function (id) { var st = states[id]; return st && st.attributes && st.attributes.friendly_name ? st.attributes.friendly_name : id; })
      .replace(/\d{4}-\d\d-\d\dT[\d:.]+(Z|[+-]\d\d:\d\d)?/g, "activée")
      .replace(/\bturn[ _]on\b/g, "allumé").replace(/\bturn[ _]off\b/g, "éteint");
  }
  function chipsOf(parent, labels, failed) {
    if (!labels.length && !failed.length) return null;
    var box = el("div", "chips", parent);
    labels.forEach(function (l) { el("span", "chip", box).textContent = niceLabel(l); });
    failed.forEach(function (l) { el("span", "chip fail", box).textContent = niceLabel(l); });
    return box;
  }
  function failedSteps(list) {
    return (list || []).filter(function (s) { return /échec/.test(s.detail || ""); }).map(function (s) { return String(s.detail).replace(/ · échec$/, "") + " · échec"; });
  }
  function setTrace(list) {
    var key = JSON.stringify(list || []);
    if (key === view.trace) return;
    view.trace = key;
    if (traceEl && traceEl.parentNode) traceEl.parentNode.removeChild(traceEl);
    traceEl = null;
    if (!list || !list.length) return;
    traceEl = el("div", "trace");
    timeBar(traceEl, list);
    logEl.insertBefore(traceEl, doneEl && doneEl.parentNode ? doneEl : (aEl && aEl.parentNode ? aEl : null));
  }
  function setDone(list) {
    var key = JSON.stringify(list || []);
    if (key === view.chips) return;
    view.chips = key;
    if (doneEl && doneEl.parentNode) doneEl.parentNode.removeChild(doneEl);
    doneEl = null;
    if (!list || !list.length) return;
    doneEl = el("div", "");
    chipsOf(doneEl, list.map(function (c) { return c.label; }), []);
    logEl.insertBefore(doneEl, aEl && aEl.parentNode ? aEl : null);
  }
  // A new turn starts clean; the ear's line stays when the name was heard just before.
  function clearTalk() {
    setSay("q", ""); setSay("a", ""); setTrace([]); setDone([]);
    if (earEl && Date.now() - view.heardAt > 20000) { earEl.parentNode && earEl.parentNode.removeChild(earEl); earEl = null; }
  }

  // ----- the history: Igor's last exchanges, from the integration -----
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function dayOf(d) {
    var today = new Date(), y = new Date(Date.now() - 86400000);
    if (d.toDateString() === today.toDateString()) return "aujourd'hui";
    if (d.toDateString() === y.toDateString()) return "hier";
    return d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
  }
  function sayRow(parent, cls, who, text) {
    var r = el("div", "say " + cls, parent);
    el("span", "w", r).textContent = who;
    el("span", "t", r).textContent = text;
    return r;
  }
  var histEntries = [], histFilter = "tout";
  function routeOf(e) {
    var t = e.trace || [];
    if (failedSteps(t).length) return ["fail", "échec"];
    if (t.some(function (s) { return s.where === "online" && s.step !== "destinataire" && typeof s.ms === "number"; })) return ["online", "en ligne"];
    return ["local", "local"];
  }
  function totalOf(e) { return (e.trace || []).reduce(function (a, s) { return a + (typeof s.ms === "number" ? s.ms : 0); }, 0); }
  function renderHistory(entries) {
    if (entries) histEntries = entries;
    histEl.innerHTML = "";
    if (!histEntries.length) { el("div", "empty", histEl).textContent = "Aucun échange enregistré pour l'instant."; return; }
    // The day in four figures, then the filters.
    var today = new Date().toDateString(), n = 0, local = 0, lsum = 0, lc = 0, tsum = 0;
    histEntries.forEach(function (e) {
      if (new Date(e.at).toDateString() !== today) return;
      n++; tsum += totalOf(e);
      if (routeOf(e)[0] === "local") local++;
      (e.trace || []).forEach(function (s) { if (s.step === "local" && typeof s.ms === "number") { lsum += s.ms; lc++; } });
    });
    var stats = el("div", "stats", histEl);
    [[String(n), "échanges aujourd'hui"], [String(local), "en local seul"], [lc ? seconds(lsum / lc) : "—", "local moyen"], [n ? seconds(tsum / n) : "—", "réponse moyenne"]]
      .forEach(function (p) { var d = el("div", "", stats); el("b", "", d).textContent = p[0]; el("span", "", d).textContent = p[1]; });
    var fl = el("div", "filters", histEl);
    ["tout", "actions", "réponses", "échecs"].forEach(function (f) {
      var b = el("button", "fb" + (f === histFilter ? " sel" : ""), fl);
      b.type = "button"; b.textContent = f;
      b.addEventListener("click", function (ev) { ev.stopPropagation(); histFilter = f; renderHistory(); });
    });
    var lastDay = "";
    histEntries.slice().reverse().forEach(function (e) {
      var route = routeOf(e);
      if (histFilter === "actions" && !(e.done && e.done.length)) return;
      if (histFilter === "réponses" && !(e.answer && !e.silent)) return;
      if (histFilter === "échecs" && route[0] !== "fail") return;
      var d = new Date(e.at), day = dayOf(d);
      if (day !== lastDay) { el("div", "day", histEl).textContent = day; lastDay = day; }
      var ex = el("div", "ex", histEl);
      el("span", "time", ex).textContent = pad(d.getHours()) + ":" + pad(d.getMinutes());
      var said = el("span", "said" + ((e.words || "").length > 140 ? " long" : ""), ex);
      said.textContent = e.words || "";
      var side = el("span", "side", ex);
      el("span", "route " + route[0], side).textContent = route[1];
      var tot = el("span", "total", side), ms = totalOf(e);
      tot.textContent = ms ? (ms / 1000).toFixed(1).replace(".", ",") + " " : "—";
      if (ms) el("small", "", tot).textContent = "s";
      var body = el("div", "exb", ex);
      if (e.answer && !e.silent) el("div", "ans", body).textContent = e.answer;
      chipsOf(body, e.done || [], failedSteps(e.trace));
      timeBar(body, e.trace);
      var steps = el("div", "steps", body);
      (e.trace || []).forEach(function (s) { trRow(steps, (STEP[s.step] || [s.step])[0], niceLabel(s.detail), s.where || "none", typeof s.ms === "number" ? s.ms : null); });
      el("span", "more", body).textContent = "toucher pour le détail ›";
      ex.addEventListener("click", function (ev) { ev.stopPropagation(); ex.classList.toggle("open"); });
    });
    histEl.scrollTop = 0;
  }
  function openHistory() {
    var hass = hassObj();
    if (!hass) return;
    show();
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    view.phase = "";
    veil.dataset.mode = "history";
    veil.dataset.phase = "done";
    closeEl.hidden = false;
    stateEl.textContent = "historique";
    histEl.innerHTML = "";
    el("div", "empty", histEl).textContent = "Chargement…";
    hass.callWS({ type: "call_service", domain: "nives", service: "journal", service_data: { limit: 100 }, return_response: true })
      .then(function (r) { renderHistory((r && r.response && r.response.entries) || []); })
      .catch(function () { histEl.innerHTML = ""; el("div", "empty", histEl).textContent = "Journal indisponible (mettez à jour l'intégration Igor)."; });
  }
  function closeHistory() {
    if (!veil || veil.dataset.mode !== "history") return;
    veil.dataset.mode = "";
    closeEl.hidden = true;
    hide();
  }

  // ----- reading Home Assistant -----
  function hassObj() {
    var ha = document.querySelector("home-assistant");
    return ha && ha.hass;
  }
  // Igor's voice sensor. With two Igor entries (an old one left behind), each
  // has one: « heard » reaches both, the turn itself only the working one,
  // so follow whichever moved last, not the first found.
  function findSensor(states) {
    var best = null, bestAt = -1;
    for (var id in states) {
      var st = states[id];
      if (id.indexOf("sensor.") !== 0 || !st.attributes || !st.attributes.igor_voice) continue;
      var at = Math.max(Date.parse(st.attributes.started) || 0, Date.parse(st.last_changed) || 0, Date.parse(st.last_updated) || 0);
      if (at > bestAt) { best = st; bestAt = at; }
    }
    return best;
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

  // ----- the live turn: one sequence, each step with a limit -----
  // Igor's turn (its number, from the Igor sensor) is the one reference; the
  // satellite only opens the sheet at once (it listens) and says when Igor
  // has finished speaking. Every step has a limit, so nothing stays on
  // screen: 12 s listening with nothing heard, 20 s for the words to arrive,
  // 45 s of thinking (« Igor met du temps… ») then 90 s, 6 s after the
  // answer was spoken (a touch on the sheet keeps it), 3 s for « nothing
  // heard » or an error.
  var LIMIT = { listening: 12000, words: 20000, slow: 45000, thinking: 90000, done: 6000, brief: 3000 };
  var T = { key: "", phase: "", since: 0, closedKey: "", pinned: false, countdown: null, flashed: "" };
  function stopCountdown() {
    if (T.countdown) { clearTimeout(T.countdown); T.countdown = null; }
    if (sProgEl) sProgEl.classList.remove("run");
  }
  function openSheet() {
    if (!host) build();
    if (veil && veil.dataset.mode === "history") return;
    dimEl.classList.add("on");
    sheet.classList.add("on");
  }
  function closeSheet() {
    stopCountdown();
    if (dimEl) dimEl.classList.remove("on");
    if (sheet) sheet.classList.remove("on");
    T.phase = "";
    T.pinned = false;
  }
  // Closed by hand (or by its limit): this turn stays closed.
  function closeTurn() { T.closedKey = T.key || "closed"; closeSheet(); }
  function enter(phase) {
    if (T.phase === phase) return;
    T.phase = phase;
    T.since = Date.now();
    stopCountdown();
    openSheet();
    sheet.dataset.p = phase;
  }
  function closeIn(ms) {
    if (T.countdown || T.pinned) return;
    sProgEl.classList.remove("run");
    sProgEl.style.setProperty("--d", ms + "ms");
    sProgEl.firstChild.style.transitionDuration = ms + "ms";
    void sProgEl.offsetWidth;
    sProgEl.classList.add("run");
    sFootEl.textContent = "se range dans " + Math.round(ms / 1000) + " s · toucher pour garder";
    T.countdown = setTimeout(function () { T.countdown = null; closeTurn(); }, ms);
  }
  function text(node, value) { if (node.textContent !== value) node.textContent = value; }
  function steps(list) {
    var key = JSON.stringify(list || []);
    if (sStepsEl.dataset.k === key) return;
    sStepsEl.dataset.k = key;
    sStepsEl.innerHTML = "";
    (list || []).forEach(function (st) {
      if (typeof st.ms !== "number" && !st.detail) return;
      var where = st.where === "local" ? "local" : st.where === "online" ? "online" : "";
      var label = (STEP[st.step] || [st.step])[0] + (where ? " · " + (where === "local" ? "local" : "en ligne") : "") + (typeof st.ms === "number" ? " " + seconds(st.ms) : "…");
      el("span", where, sStepsEl).textContent = label;
    });
  }
  function chips(list, failed) {
    var key = JSON.stringify([list, failed]);
    if (sChipsEl.dataset.k === key) return;
    sChipsEl.dataset.k = key;
    sChipsEl.innerHTML = "";
    (list || []).forEach(function (c) { el("span", "", sChipsEl).textContent = niceLabel(c.label || c); });
    (failed || []).forEach(function (c) { el("span", "fail", sChipsEl).textContent = niceLabel(c); });
  }
  // What Igor switched lights up on the dashboard behind (igor-tiles-card).
  function flash(actions, key) {
    if (!actions || !actions.length || T.flashed === key) return;
    T.flashed = key;
    try { window.dispatchEvent(new CustomEvent("igor-acted", { detail: { labels: actions.map(function (c) { return niceLabel(c.label || c); }) } })); } catch (e) { /* nothing behind */ }
  }
  function render(attrs, sensorState) {
    var p = T.phase, q = attrs.question || "";
    if (p === "listening") {
      text(sStateEl, "je vous écoute");
      if (!sQEl.querySelector(".scur")) { sQEl.className = "sq"; sQEl.textContent = ""; el("span", "scur", sQEl); }
      text(sAEl, ""); steps([]); chips([], []);
      text(sFootEl, "");
    } else if (p === "words" || p === "thinking") {
      sQEl.className = "sq";
      if (q) text(sQEl, "« " + q + " »");
      else if (!sQEl.querySelector(".scur")) { sQEl.textContent = ""; el("span", "scur", sQEl); }
      var age = Date.now() - T.since;
      text(sStateEl, p === "words" ? "vos mots" : age > LIMIT.slow ? "Igor met du temps…" : (attrs.status ? String(attrs.status).replace(/…$/, "").toLowerCase() : "réflexion") + " · " + elapsed(age));
      steps(attrs.trace || []);
      text(sAEl, ""); chips([], []);
    } else if (p === "answer" || p === "done") {
      sQEl.className = "sq small";
      text(sQEl, q ? "« " + q + " »" : "");
      text(sStateEl, p === "done" ? "terminé" : "réponse");
      steps(attrs.trace || []);
      text(sAEl, attrs.answer || "");
      chips(attrs.actions || [], failedSteps(attrs.trace));
    } else if (p === "nothing") {
      sQEl.className = "sq";
      text(sStateEl, "sans suite");
      text(sQEl, "Je n'ai rien entendu.");
      text(sAEl, ""); steps([]); chips([], []);
    } else if (p === "error") {
      sQEl.className = "sq small";
      text(sStateEl, "erreur");
      text(sQEl, q ? "« " + q + " »" : "");
      text(sAEl, attrs.answer || "Je n'ai pas pu répondre.");
      steps(attrs.trace || []); chips([], failedSteps(attrs.trace));
    }
  }

  function update() {
    var hass = hassObj();
    if (!hass || !hass.states) return;
    var states = hass.states;
    var sensor = findSensor(states);
    var sat = satelliteState(states, onlySatellite);
    var attrs = sensor ? sensor.attributes : {};
    var sensorState = sensor ? sensor.state : "idle";
    // A tablet tied to one satellite still follows a turn whose satellite is
    // unknown (« None »): the turn number decides, not the device.
    var fromWanted = !onlySatellite || !attrs.satellite || attrs.satellite === onlySatellite;
    var key = String(attrs.turn || "") + "|" + (attrs.started || "");
    var age = attrs.started ? Date.now() - Date.parse(attrs.started) : Infinity;
    var active = fromWanted && age < 120000 && ["heard", "thinking", "answering", "done", "error"].indexOf(sensorState) >= 0;
    var live = active && (sensorState === "thinking" || sensorState === "answering");
    if (veil && veil.dataset.mode === "history") {
      // A new request takes the screen back from the history.
      if (sat !== "listening" && !live && !(active && sensorState === "heard" && age < 15000)) return;
      veil.dataset.mode = "";
      closeEl.hidden = true;
      hide();
    }
    // A new turn of Igor's: adopted, unless closed by hand.
    // A finished turn is adopted only while the sheet waits for it, or when
    // it is brand new (a quick answer between two looks), not on page load.
    if (active && key !== T.key && key !== T.closedKey) {
      var finished = sensorState === "done" || sensorState === "error";
      if (!finished || T.phase || age < 15000) {
        T.key = key; T.pinned = false; T.flashed = "";
        if (T.phase !== "listening" && T.phase !== "words") T.phase = "";
      }
    }
    var mine = active && key === T.key;
    // The satellite listens: the sheet opens at once (a follow-up keeps the
    // exchange: the answer stays until new words come).
    if (sat === "listening" && !(mine && live)) {
      if (T.phase !== "listening") {
        // New words coming: the exchange on screen (or just closed) is over,
        // it must not come back when the satellite stops listening.
        if (T.key) T.closedKey = T.key;
        T.key = ""; T.pinned = false;
        enter("listening"); render(attrs, sensorState);
      }
      if (Date.now() - T.since > LIMIT.listening + 18000) { enter("nothing"); render(attrs, sensorState); closeIn(LIMIT.brief); }
      return;
    }
    if (T.key && T.key === T.closedKey && !(sat === "listening")) return;
    var want = "";
    if (mine) {
      if (sensorState === "heard") want = attrs.question ? "words" : "listening";
      else if (sensorState === "thinking") want = attrs.question ? "thinking" : "words";
      else if (sensorState === "answering") want = "answer";
      else if (sensorState === "done") want = sat === "responding" ? "answer" : "done";
      else if (sensorState === "error") want = "error";
    } else if (sat === "processing" && T.phase) {
      want = "words";
    } else if (sat === "responding" && (T.phase === "answer" || T.phase === "done")) {
      want = "answer";
    }
    if (!want) {
      // Woken, then nothing reached Igor: say so briefly, never stay.
      if (T.phase === "listening" || T.phase === "words") {
        if (Date.now() - T.since > 2500) { enter("nothing"); render(attrs, sensorState); closeIn(LIMIT.brief); }
      } else if (T.phase === "answer") {
        enter("done"); render(attrs, sensorState); closeIn(LIMIT.done);
      }
      return;
    }
    // Limits: nothing stays on screen.
    var held = Date.now() - T.since;
    if (T.phase === want) {
      if (want === "listening" && held > LIMIT.listening) { enter("nothing"); render(attrs, sensorState); closeIn(LIMIT.brief); return; }
      if (want === "words" && held > LIMIT.words) { enter("nothing"); render(attrs, sensorState); closeIn(LIMIT.brief); return; }
      if (want === "thinking" && held > LIMIT.thinking) {
        enter("error"); render({ question: attrs.question, answer: "Igor n'a pas répondu à temps.", trace: attrs.trace }, sensorState); closeIn(LIMIT.brief); return;
      }
      render(attrs, sensorState);
      return;
    }
    if (T.phase === "nothing" || (T.phase === "error" && want !== "error")) return;
    enter(want);
    render(attrs, sensorState);
    if (want === "answer" || want === "done") flash(attrs.actions, key);
    if (want === "done") closeIn(LIMIT.done);
    if (want === "error") closeIn(LIMIT.brief);
  }

  function start() {
    // The history opens from a dashboard: the Igor journal card, or any
    // card whose action is { action: fire-dom-event, igor_journal: true }
    // (it reaches the page as an "ll-custom" event).
    window.addEventListener("ll-custom", function (ev) {
      // Any device, the tablet display switched on or not: the overlay is
      // built the first time it is asked for.
      if (ev && ev.detail && ev.detail.igor_journal) { if (!host) build(); openHistory(); }
    });
    if (!setting) return;
    if (!host) build();
    setInterval(function () {
      try { update(); } catch (e) { /* the display must never break the page */ }
    }, 250);
  }
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start);
})();
