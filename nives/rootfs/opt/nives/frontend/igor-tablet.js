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
    ".veil { position: fixed; inset: 0; z-index: 2147483000; display: flex; flex-direction: column; box-sizing: border-box; background: #0d1014; color: #d5dbe1;",
    "  font-family: " + MONO + "; opacity: 0; transition: opacity 0.25s ease; pointer-events: none; }",
    ".veil.on { opacity: 1; pointer-events: auto; }",
    ".bar { display: flex; justify-content: space-between; align-items: center; padding: 14px 4vw; border-bottom: 1px solid #1d242c; font-size: clamp(13px, 1.6vw, 17px); color: #6b7682; flex: none; }",
    ".id { display: flex; align-items: center; gap: 10px; color: #d5dbe1; }",
    ".lens { width: 14px; height: 14px; border-radius: 50%; background: radial-gradient(circle, #e1f5fe 0, #4fc3f7 30%, #0277bd 65%, #0d1014 100%); box-shadow: 0 0 0 1.5px #3b4a56; }",
    ".state { display: flex; align-items: center; gap: 8px; font-variant-numeric: tabular-nums; }",
    ".dot { width: 9px; height: 9px; border-radius: 50%; background: #39424c; }",
    ".veil[data-phase=listening] .dot { background: #6cc4f5; }",
    ".veil[data-phase=transcribing] .dot, .veil[data-phase=thinking] .dot { background: #d9a441; }",
    ".veil[data-phase=answering] .dot, .veil[data-phase=done] .dot { background: #5cc28f; }",
    ".veil[data-phase=error] .dot { background: #e0675f; }",
    ".log { flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 12px; padding: 3vh 4vw 4vh; overflow: hidden; width: 100%; max-width: 1100px; margin: 0 auto; box-sizing: border-box; }",
    ".say { display: grid; grid-template-columns: 4.5rem 1fr; gap: 14px; font-size: clamp(18px, 2.6vw, 30px); line-height: 1.32; margin-top: 10px; }",
    ".say .w { color: #6b7682; font-size: 14px; text-align: right; padding-top: 0.7em; }",
    ".say.q { color: #eef2f6; }",
    ".say.a { color: #6cc4f5; }",
    ".veil[data-phase=error] .say.a { color: #e0675f; }",
    ".say .t { overflow-wrap: anywhere; max-height: 40vh; overflow: hidden; }",
    ".tr { display: grid; grid-template-columns: 6ch 15ch minmax(0, 1fr) auto; gap: 18px; font-size: clamp(12px, 1.5vw, 16px); color: #6b7682; }",
    ".tr .ms { text-align: right; color: #39424c; font-variant-numeric: tabular-nums; }",
    ".tr .d { color: #aeb7c0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
    ".tr .local { color: #5cc28f; } .tr .online { color: #d9a441; } .tr .none { color: #39424c; }",
    ".done { padding-left: calc(6ch + 14px); font-size: clamp(14px, 1.9vw, 20px); color: #5cc28f; }",
    ".done span + span::before { content: ' · '; color: #39424c; }",
    ".cur { display: inline-block; width: 0.55em; height: 1.05em; background: #6cc4f5; vertical-align: -0.15em; margin-left: 3px; animation: blink 1s steps(1) infinite; }",
    ".hint { position: absolute; right: 4vw; bottom: 1.5vh; font-size: 12px; color: #39424c; }",
    ".x { background: none; border: 1px solid #1d242c; color: #8b96a3; font: inherit; font-size: 13px; padding: 4px 10px; border-radius: 4px; cursor: pointer; margin-left: 14px; }",
    ".x:focus-visible { outline: 2px solid #6cc4f5; outline-offset: 2px; }",
    ".hist { flex: 1; overflow-y: auto; padding: 2vh 4vw 4vh; display: none; flex-direction: column; gap: 6px; -webkit-overflow-scrolling: touch; }",
    ".veil[data-mode=history] .hist { display: flex; }",
    ".veil[data-mode=history] .log, .veil[data-mode=history] .hint { display: none; }",
    ".day { margin: 22px 0 4px; color: #39424c; font-size: clamp(12px, 1.4vw, 15px); border-bottom: 1px solid #1d242c; padding-bottom: 4px; }",
    ".entry { padding: 6px 0 12px; border-bottom: 1px solid #141a20; }",
    ".entry .say { font-size: clamp(17px, 2.3vw, 26px); margin-top: 6px; }",
    ".when { color: #39424c; font-size: 0.55em; text-align: right; padding-top: 0.55em; }",
    ".empty { color: #6b7682; margin: auto; font-size: clamp(14px, 1.8vw, 18px); }",
    // one exchange: time | words, answer, what was done, where the seconds went | route and total
    ".ex { display: grid; grid-template-columns: 6ch minmax(0, 1fr) auto; gap: 6px 18px; padding: 14px 0; border-top: 1px solid #1d242c; cursor: pointer; }",
    ".ex .time { color: #6b7682; font-variant-numeric: tabular-nums; padding-top: 3px; font-size: clamp(12px, 1.4vw, 15px); }",
    ".ex .said { font-size: clamp(15px, 1.9vw, 19px); line-height: 1.4; color: #eef2f6; min-width: 0; overflow-wrap: anywhere; }",
    ".ex .said.long { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }",
    ".ex.open .said.long { display: block; }",
    ".side { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }",
    ".route { font-size: 11px; border-radius: 99px; padding: 2px 10px; border: 1px solid; white-space: nowrap; }",
    ".route.local { color: #5cc28f; border-color: rgba(92,194,143,0.4); } .route.online { color: #d9a441; border-color: rgba(217,164,65,0.4); } .route.fail { color: #e0675f; border-color: rgba(224,103,95,0.4); }",
    ".total { font-size: 18px; font-variant-numeric: tabular-nums; } .total small { color: #6b7682; font-size: 11px; }",
    ".exb { grid-column: 2; display: grid; gap: 8px; min-width: 0; }",
    ".ans { color: #6cc4f5; line-height: 1.45; border-left: 2px solid #6cc4f5; padding-left: 10px; font-size: clamp(14px, 1.7vw, 17px); overflow-wrap: anywhere; }",
    ".chips { display: flex; flex-wrap: wrap; gap: 6px; }",
    ".chip { font-size: clamp(12px, 1.4vw, 14px); padding: 3px 10px; border-radius: 4px; background: rgba(92,194,143,0.1); color: #5cc28f; }",
    ".chip.fail { background: rgba(224,103,95,0.12); color: #e0675f; }",
    ".tb { display: grid; gap: 6px; }",
    ".tbar { display: flex; height: 6px; border-radius: 3px; overflow: hidden; gap: 2px; max-width: 520px; }",
    ".legend { display: flex; gap: 14px; flex-wrap: wrap; font-size: clamp(11px, 1.3vw, 13px); color: #6b7682; }",
    ".legend span::before { content: ''; display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 5px; background: var(--c); }",
    ".steps { display: none; } .ex.open .steps { display: block; }",
    ".more { color: #39424c; font-size: 11px; }",
    ".stats { display: grid; grid-template-columns: repeat(4, 1fr); border-bottom: 1px solid #1d242c; }",
    ".stats div { padding: 10px 0; } .stats b { display: block; font-size: clamp(16px, 2.2vw, 22px); font-weight: 500; font-variant-numeric: tabular-nums; }",
    ".stats span { color: #6b7682; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; }",
    ".filters { display: flex; gap: 6px; margin: 10px 0 2px; flex-wrap: wrap; }",
    ".fb { background: none; border: 1px solid #1d242c; border-radius: 99px; padding: 3px 11px; color: #6b7682; font: inherit; font-size: 12px; cursor: pointer; } .fb.sel { border-color: #6cc4f5; color: #6cc4f5; }",
    // the live turn, the same way
    ".log .tb, .log .chips, .log .ear { padding-left: calc(4.5rem + 14px); }",
    ".log .ear { color: #5cc28f; font-size: clamp(12px, 1.4vw, 15px); }",
    ".log .ear::before { content: '● '; }",
    ".log .say.a .t { border-left: 2px solid #6cc4f5; padding-left: 12px; }",
    "@keyframes blink { 50% { opacity: 0; } }",
    "@media (prefers-reduced-motion: reduce) { .cur { animation: none; } .veil { transition: none; } }"
  ].join("\n");

  function elapsed(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    if (s < 60) return s + " s";
    var r = s % 60;
    return Math.floor(s / 60) + " min " + (r < 10 ? "0" : "") + r + " s";
  }
  function seconds(ms) { return (ms / 1000).toFixed(1).replace(".", ",") + " s"; }

  var host, veil, stateEl, closeEl, logEl, histEl, earEl, qEl, traceEl, doneEl, aEl;
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
    el("span", "lens", id);
    el("span", "", id).textContent = "igor · journal";
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
  var STEP = { local: ["modèle local", "#5cc28f"], ha: ["home assistant", "#2f8fc4"], mistral: ["mistral", "#d9a441"],
    destinataire: ["destinataire", "#c98a3a"], oreille: ["oreille", "#6cc4f5"] };
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
    if (veil && veil.dataset.mode === "history") {
      // A new request takes the screen back from the history.
      var heardNow = fromWanted && sensorState === "heard" && attrs.started && Date.now() - Date.parse(attrs.started) < 15000;
      if (sat !== "listening" && !live && !heardNow) return;
      veil.dataset.mode = "";
      closeEl.hidden = true;
    }

    if (sat === "listening") {
      if (view.phase !== "listening") {
        dismissed = null;
        // A follow-up (the mic reopening right after Igor's question) keeps the
        // exchange in view; a new request starts clean.
        if (view.phase !== "done") clearTalk();
        view.phase = "listening";
        show();
        veil.dataset.phase = "listening";
        setState("écoute", false);
      }
      return;
    }
    // Igor heard its name (igor-ear, no wake word): shown at once, before
    // the words reach Igor a few seconds later.
    var heardAge = attrs.started ? Date.now() - Date.parse(attrs.started) : Infinity;
    var heardFresh = heardAge < 120000;
    if (fromWanted && sensorState === "heard" && heardFresh) {
      if (dismissed === turnKey) return;
      // The name heard, then nothing reached Igor (a sentence not for it, a
      // satellite busy, the words lost): say so and leave, rather than hold
      // an empty « transcription » on screen for two minutes.
      var waitingNow = attrs.status === "listening";
      if (heardAge > (waitingNow ? 30000 : 15000)) {
        if (view.turnKey === turnKey && view.phase !== "gone") {
          view.phase = "gone";
          setSay("q", "rien reçu", false);
          setState("sans suite", false);
          hideSoon(3000);
          dismissed = turnKey;
        }
        return;
      }
      var waiting = attrs.status === "listening";
      var phase = waiting ? "listening" : "transcribing";
      if (view.phase !== phase || view.turnKey !== turnKey) {
        // Igor asked a question and listens for the answer: the exchange
        // stays in view, as with a satellite's own follow-up.
        if (view.turnKey !== turnKey) { dismissed = null; if (!(waiting && view.phase === "done")) clearTalk(); }
        view.turnKey = turnKey;
        view.phase = phase;
        show();
        setEar();
        // Your words are on their way: a blinking cursor holds their place.
        if (!qEl) setSay("q", "…", true);
        veil.dataset.phase = phase;
        setState(waiting ? "écoute" : "transcription", false);
      }
      return;
    }
    if (dismissed && dismissed === turnKey && !live) return;
    if (live) {
      if (dismissed === turnKey) return;
      if (view.turnKey !== turnKey) {
        view.turnKey = turnKey;
        view.start = attrs.started ? Date.parse(attrs.started) || Date.now() : Date.now();
        clearTalk();
      }
      show();
      setSay("q", attrs.question || "");
      if (sensorState === "answering" && attrs.answer) {
        view.phase = "answering";
        veil.dataset.phase = "answering";
        setSay("a", attrs.answer, true);
        setState("réponse", false);
      } else {
        view.phase = "thinking";
        veil.dataset.phase = "thinking";
        // A heads-up from the server ("Réflexion…", a long lookup), else the plain step.
        setState(attrs.status ? String(attrs.status).replace(/…$/, "").toLowerCase() : "traitement", true);
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
      setSay("q", attrs.question || "");
      setTrace(attrs.trace || []);
      setDone(attrs.actions || []);
      setSay("a", attrs.answer || (sensorState === "error" ? "Je n'ai pas pu répondre." : ""), false);
      setState(sensorState === "error" ? "erreur" : "terminé", false);
    }
    if (sat === "processing" && view.phase !== "thinking" && view.phase !== "answering" && view.phase !== "done") {
      // Transcribing: Igor has not got the words yet.
      view.phase = "transcribing";
      show();
      veil.dataset.phase = "transcribing";
      setState("transcription", false);
      return;
    }
    if (view.phase === "done") {
      // Gone a few seconds after the satellite stops talking.
      if (sat !== "responding") hideSoon(8000);
      else if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    } else if (view.phase && !sat) {
      // Woken but nothing asked (a false wake word), or the satellite gave up.
      hideSoon(4000);
    }
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
