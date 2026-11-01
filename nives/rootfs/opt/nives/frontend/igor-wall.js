// Igor's wall dashboard: cards for a tablet screen filled to the bottom, in
// the style of the Igor Journal theme. Home Assistant loads this on every
// page (frontend.add_extra_js_url) next to igor-tablet.js.
//
//   custom:igor-wall          the whole screen: a status bar on top (one
//                             line that scrolls through the machines) and
//                             columns of cards that reach the bottom
//   custom:igor-journal-card  Igor's last exchanges, "historique" opens all
//   custom:igor-docker-card   the containers of a Portainer endpoint
//   custom:igor-net-card      a router's traffic over the last hour
//   custom:igor-energy-card   power now and hour by hour today
//   custom:igor-camera-card   a camera's picture, refreshed every few seconds
//
// And the "Igor Journal (tablette)" theme: its --igor-hide-header variable
// hides Home Assistant's top bar on the device that uses it. The bar comes
// back while editing the dashboard (?edit=1) or with ?barre in the address.
//
// Written plainly for old tablets: no animation but the status bar's one
// transform, no timer faster than a second, history read once a minute.
(function () {
  "use strict";
  if (window.__igorWall) return;
  window.__igorWall = true;

  var MONO = "ui-monospace, 'JetBrains Mono', 'SFMono-Regular', Menlo, 'Roboto Mono', 'DejaVu Sans Mono', monospace";
  // Colours follow the theme, with the Igor Journal values when it is not set.
  var BASE = [
    ":host { display: block; --fg: var(--primary-text-color, #d5dbe1); --dim: var(--secondary-text-color, #6b7682); --faint: var(--disabled-text-color, #3d464f);",
    "  --line: var(--divider-color, #1d242c); --card: var(--ha-card-background, var(--card-background-color, #12171c)); --bg: var(--primary-background-color, #0d1014);",
    "  --acc: var(--primary-color, #6cc4f5); --ok: var(--rgb-green-color, 92, 194, 143); --okc: rgb(var(--ok)); --wait: #d9a441; --bad: #e0675f; --track: var(--outline-color, #1f262e);",
    "  font-family: " + MONO + "; }",
    "ha-card { height: 100%; box-sizing: border-box; padding: 8px 10px; display: flex; flex-direction: column; overflow: hidden; color: var(--fg); font-size: 12px; line-height: 1.35; }",
    ".sub { color: var(--dim); font-size: 11px; }",
    ".top { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; color: var(--fg); padding-bottom: 5px; border-bottom: 1px solid var(--line); margin-bottom: 4px; flex: none; }",
    ".top .t { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
    ".bar { height: 4px; border-radius: 2px; background: var(--track); overflow: hidden; }",
    ".bar i { display: block; height: 100%; background: var(--acc); }",
    ".num { font-variant-numeric: tabular-nums; }",
    ".okc { color: var(--okc); } .warn { color: var(--wait); } .bad { color: var(--bad); }",
    ".axis { display: flex; justify-content: space-between; color: var(--dim); font-size: 10px; margin-top: 3px; flex: none; }",
    "svg.chart { flex: 1; min-height: 30px; width: 100%; display: block; margin-top: 6px; }",
    ".link { color: var(--acc); cursor: pointer; background: none; border: 0; font: inherit; padding: 0; }",
    ".link:focus-visible { outline: 2px solid var(--acc); outline-offset: 2px; }",
    "[hidden] { display: none !important; }"
  ].join("\n");

  // ----- small helpers -----
  function el(tag, cls, parent, text) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    if (text != null) d.textContent = text;
    if (parent) parent.appendChild(d);
    return d;
  }
  function num(state) {
    if (!state) return null;
    var v = parseFloat(state.state);
    return isNaN(v) ? null : v;
  }
  function fr(v, digits) {
    if (v == null) return "—";
    var d = digits == null ? (Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 0 : 1) : digits;
    return v.toFixed(d).replace(".", ",").replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function hhmm(d) { return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  function since(iso) {
    var t = Date.parse(iso);
    if (isNaN(t)) return "";
    var s = (Date.now() - t) / 1000;
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + " min";
    if (s < 86400) return Math.round(s / 3600) + " h";
    return Math.round(s / 86400) + " j";
  }
  function moreInfo(node, entityId) {
    node.dispatchEvent(new CustomEvent("hass-more-info", { detail: { entityId: entityId }, bubbles: true, composed: true }));
  }
  // Re-render only when one of `ids` changed (state objects are replaced on change).
  function changed(prev, hass, ids) {
    if (!prev) return true;
    for (var i = 0; i < ids.length; i++) if (prev.states[ids[i]] !== hass.states[ids[i]]) return true;
    return false;
  }
  function areaPath(values, max, h) {
    if (!values.length) return "";
    var d = "";
    values.forEach(function (v, i) {
      var x = values.length === 1 ? 100 : (i / (values.length - 1)) * 100;
      var y = h - 2 - (Math.max(0, v) / (max || 1)) * (h - 6);
      d += (i ? " L" : "M") + x.toFixed(2) + " " + y.toFixed(2);
    });
    return d;
  }
  function igorSensor(hass) {
    for (var id in hass.states) {
      if (id.indexOf("sensor.") === 0 && hass.states[id].attributes && hass.states[id].attributes.igor_voice) return hass.states[id];
    }
    return null;
  }

  class IgorCard extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: "open" });
      this._hass = null;
    }
    getCardSize() { return 4; }
    getGridOptions() { return { columns: 12, rows: 4 }; }
    set hass(hass) {
      var prev = this._hass;
      this._hass = hass;
      if (!this._built) { this._built = true; this.build(); }
      this.update(hass, prev);
    }
    get hass() { return this._hass; }
    build() {}
    update() {}
    style(extra) { el("style", "", this.shadowRoot, BASE + "\n" + (extra || "")); }
  }

  // ===== the status bar: every machine on one scrolling line =====
  //   bar:
  //     speed: 60              # seconds for one turn; 0: pages, no animation
  //     groups:
  //       - name: pve
  //         kind: hôte
  //         status: binary_sensor.node_pve_status
  //         items:
  //           - { entity: sensor.node_pve_cpu_used, label: cpu }
  //           - { entity: sensor.disk_..._temperature, label: ssd, warn: 50, bad: 60 }
  //           - { entity: sensor.local_containers_running, of: sensor.local_container_count, label: conteneurs }
  //           - { entity: sensor.wan_in, label: "↓", scale: 0.008, unit: "Mb/s" }
  //           - { entity: sensor.gateway_wan_status, label: wan, good: [online] }
  var IGOR_WORDS = { idle: "prêt", done: "prêt", heard: "entendu", thinking: "réflexion", answering: "réponse", error: "erreur" };
  function itemValue(hass, it) {
    var st = hass.states[it.entity];
    if (!st || st.state === "unavailable" || st.state === "unknown") return { text: "—", level: "off" };
    if (it.of) {
      var a = num(st), b = num(hass.states[it.of]);
      if (a == null || b == null) return { text: st.state, level: "" };
      return { text: Math.round(a) + "/" + Math.round(b), level: a < b ? (a === 0 ? "bad" : "warn") : "ok", pct: b ? (100 * a) / b : 0 };
    }
    var v = num(st);
    if (v == null || (it.good && it.good.length)) {
      var good = (it.good || ["on", "online", "up", "running", "ok", "healthy", "true"]).map(function (g) { return String(g).toLowerCase(); });
      var s = String(st.state);
      return { text: s, level: good.indexOf(s.toLowerCase()) >= 0 ? "ok" : "warn" };
    }
    var unit = it.unit != null ? it.unit : (st.attributes.unit_of_measurement || "");
    if (it.scale) v = v * it.scale;
    var text, pct = null;
    if (unit === "%") { var r = v < 10 ? Math.round(v * 10) / 10 : Math.round(v); text = fr(r, r % 1 ? 1 : 0) + " %"; pct = v; }
    else if (unit === "°C" || unit === "°") text = Math.round(v) + "°";
    else text = fr(v, it.digits) + (unit ? " " + unit : "");
    var warn = it.warn != null ? it.warn : unit === "%" ? 80 : unit === "°C" ? 65 : null;
    var bad = it.bad != null ? it.bad : unit === "%" ? 95 : unit === "°C" ? 80 : null;
    var level = bad != null && v >= bad ? "bad" : warn != null && v >= warn ? "warn" : "";
    return { text: text, level: level, pct: pct };
  }
  var BAR_CSS = [
    ".ticker { height: 30px; flex: none; display: flex; align-items: center; border-bottom: 1px solid var(--line); background: var(--bg); font-size: 12px; color: var(--dim);",
    "  font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; cursor: pointer; }",
    ".fix { flex: none; display: flex; align-items: center; gap: 8px; padding: 0 12px; height: 100%; color: var(--fg); background: var(--bg); position: relative; z-index: 1; }",
    ".fix.left { border-right: 1px solid var(--line); }",
    ".fix.right { border-left: 1px solid var(--line); }",
    ".lens { width: 12px; height: 12px; border-radius: 50%; background: radial-gradient(circle, #e1f5fe 0, #4fc3f7 30%, #0277bd 65%, #0d1014 100%); box-shadow: 0 0 0 1.5px #3b4a56; flex: none; }",
    ".lane { flex: 1; overflow: hidden; height: 100%; display: flex; align-items: center; position: relative; }",
    ".run { display: flex; will-change: transform; }",
    ".run.roll { animation: roll var(--speed, 60s) linear infinite; }",
    ".seg { display: flex; gap: 8px; align-items: center; padding: 0 14px; border-right: 1px solid var(--line); }",
    ".seg[hidden] { display: none; }",
    ".kind { color: var(--faint); font-size: 10px; letter-spacing: 0.1em; text-transform: uppercase; }",
    ".h { color: var(--fg); }",
    ".h.bad { color: var(--bad); }",
    ".ok { color: var(--okc); } .warn { color: var(--wait); } .bad { color: var(--bad); } .off { color: var(--faint); }",
    "@keyframes roll { from { transform: translateX(0); } to { transform: translateX(-50%); } }",
    "@media (prefers-reduced-motion: reduce) { .run.roll { animation: none; } }",
    // the detail, over the whole wall
    ".detail { position: fixed; inset: 0; z-index: 2147482990; background: var(--bg); color: var(--fg); display: none; flex-direction: column; padding: 18px 22px; box-sizing: border-box; overflow-y: auto; font-size: 13px; }",
    ".detail.on { display: flex; }",
    ".dhead { display: flex; justify-content: space-between; align-items: center; padding-bottom: 10px; border-bottom: 1px solid var(--line); margin-bottom: 8px; color: var(--dim); }",
    ".dhead b { color: var(--fg); font-weight: 500; }",
    ".dbtns { display: flex; gap: 8px; }",
    ".close.link { color: var(--acc); border-color: var(--acc); }",
    ".close { background: none; border: 1px solid var(--line); color: var(--dim); font: inherit; padding: 4px 12px; border-radius: 4px; cursor: pointer; }",
    ".dwrap { display: grid; grid-template-columns: minmax(0, 1.6fr) minmax(220px, 1fr); gap: 28px; align-items: start; }",
    ".dwrap.solo { grid-template-columns: 1fr; }",
    "table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; font-size: inherit; }",
    "th { text-align: left; font-weight: 400; color: var(--faint); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; padding: 0 12px 6px 0; }",
    "td { padding: 6px 12px 6px 0; border-top: 1px dashed var(--line); white-space: nowrap; vertical-align: middle; }",
    "td.n small { color: var(--dim); font-size: 11px; margin-left: 6px; }",
    "tr.child td.n::before { content: '├ '; color: var(--faint); }",
    "tr.child.last td.n::before { content: '└ '; }",
    "tr.root td.n { color: var(--acc); }",
    "td.t { color: var(--dim); white-space: normal; }",
    ".st { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--faint); margin-right: 7px; vertical-align: 1px; }",
    ".st.ok { background: var(--okc); } .st.bad { background: var(--bad); }",
    ".cellb { display: inline-grid; grid-template-columns: 70px 5ch; gap: 8px; align-items: center; }",
    ".cellb .v { text-align: right; }",
    ".cellb .bar i { background: var(--acc); } .cellb .bar.warn i { background: var(--wait); } .cellb .bar.bad i { background: var(--bad); }",
    ".dside h5 { margin: 0 0 6px; font-size: 10px; font-weight: 500; letter-spacing: 0.14em; text-transform: uppercase; color: var(--faint); }",
    ".dside h5:not(:first-child) { margin-top: 18px; }",
    ".kv { display: grid; grid-template-columns: 1fr auto; gap: 5px 14px; font-variant-numeric: tabular-nums; }",
    ".kv .l { color: var(--dim); }",
    ".kv .v { text-align: right; }",
    "@media (max-width: 900px) { .dwrap { grid-template-columns: 1fr; } }"
  ].join("\n");

  class IgorBar {
    constructor(host, config) {
      this.config = config || {};
      this.groups = this.config.groups || [];
      this.root = el("div", "ticker", host);
      var left = el("span", "fix left", this.root);
      el("span", "lens", left);
      this.igorEl = el("span", "", left, "igor");
      var lane = el("div", "lane", this.root);
      this.lane = lane;
      this.run = el("div", "run", lane);
      var speed = this.config.speed == null ? 60 : Number(this.config.speed);
      this.paged = !(speed > 0);
      this.cells = [];
      var copies = this.paged ? 1 : 2;
      this.segs = [];
      for (var c = 0; c < copies; c++) this.buildCopy(c);
      if (!this.paged) {
        this.run.classList.add("roll");
        this.run.style.setProperty("--speed", speed + "s");
      }
      this.clockEl = el("span", "fix right", this.root);
      this.detail = el("div", "detail", host);
      this.root.addEventListener("click", () => this.openDetail());
      this.detail.addEventListener("click", () => this.closeDetail());
      this.page = 0;
      this.lastText = 0;
      if (this.paged) this.pager = setInterval(() => this.nextPage(), 8000);
      this.tick = setInterval(() => this.clock(), 15000);
      this.clock();
    }
    buildCopy(copy) {
      this.groups.forEach((g, gi) => {
        var seg = el("span", "seg", this.run);
        if (g.kind) el("span", "kind", seg, g.kind);
        var name = el("span", "h", seg, g.name || "");
        var cells = [];
        (g.items || []).forEach((it) => {
          var s = el("span", "", seg);
          cells.push({ it: it, el: s });
        });
        this.cells.push({ g: g, name: name, cells: cells });
        if (copy === 0) this.segs.push(seg);
      });
    }
    clock() {
      var d = new Date();
      this.clockEl.textContent = d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" }) + " · " + hhmm(d);
    }
    set hass(hass) {
      this._hass = hass;
      var igor = igorSensor(hass);
      this.igorEl.textContent = "igor · " + (igor ? (IGOR_WORDS[igor.state] || igor.state) : "—");
      // The figures: at most every 5 s, the old tablet has better to do.
      var now = Date.now();
      if (now - this.lastText < 5000 && this.lastText) return;
      this.lastText = now;
      this.cells.forEach((c) => {
        var down = c.g.status && hass.states[c.g.status] && ["off", "stopped", "unavailable"].indexOf(hass.states[c.g.status].state) >= 0;
        c.name.className = "h" + (down ? " bad" : "");
        c.cells.forEach((x) => {
          var v = itemValue(hass, x.it);
          var label = x.it.label != null ? x.it.label : "";
          var text = (label ? label + " " : "") + v.text;
          if (x.el.textContent !== text) x.el.textContent = text;
          var cls = v.level === "ok" && x.it.of == null && x.it.good == null ? "" : v.level;
          if (x.el.className !== cls) x.el.className = cls;
        });
      });
      if (this.detail.classList.contains("on")) this.renderDetail();
      if (this.paged && !this.pagedOnce) { this.pagedOnce = true; this.nextPage(true); }
    }
    // Pages: as many machines as the line holds, the next ones 8 s later.
    nextPage(first) {
      if (!this.segs.length) return;
      var width = this.lane.clientWidth;
      if (!first) this.page = this.nextStart || 0;
      var start = this.page >= this.segs.length ? 0 : this.page;
      this.segs.forEach((s) => { s.hidden = true; });
      var used = 0, i = start;
      do {
        var s = this.segs[i];
        s.hidden = false;
        used += s.offsetWidth;
        if (used > width && i !== start) { s.hidden = true; break; }
        i = (i + 1) % this.segs.length;
      } while (i !== start);
      this.nextStart = i;
    }
    openDetail() { this.detail.classList.add("on"); this.renderDetail(); clearTimeout(this.autoClose); this.autoClose = setTimeout(() => this.closeDetail(), 120000); }
    closeDetail() { this.detail.classList.remove("on"); clearTimeout(this.autoClose); }
    renderDetail() {
      var hass = this._hass;
      if (!hass) return;
      var d = this.detail;
      d.innerHTML = "";
      var head = el("div", "dhead", d);
      el("b", "", head, "machines");
      var hb = el("span", "dbtns", head);
      (this.config.links || []).forEach(function (l) {
        var a = el("button", "close link", hb, (l.name || l.navigate) + " ›");
        a.type = "button";
        a.addEventListener("click", function (ev) { ev.stopPropagation(); navigate(String(l.navigate)); });
      });
      var close = el("button", "close", hb, "fermer");
      close.type = "button";
      // A table of the machines (one line each, the same columns), and on the
      // right the groups marked `side: true` (a router, the disks) as lists.
      var main = this.groups.filter(function (g) { return !g.side; });
      var side = this.groups.filter(function (g) { return g.side; });
      var wrap = el("div", "dwrap" + (side.length ? "" : " solo"), d);
      var left = el("div", "", wrap);
      var table = el("table", "", left);
      var hr = el("tr", "", table);
      ["machine", "processeur", "mémoire", "stockage · temp.", "en plus"].forEach(function (t) { el("th", "", hr, t); });
      var isChild = function (g) { return g ? (g.child != null ? g.child : /^(vm|ct|lxc)/i.test(g.kind || "")) : false; };
      var STORE = /pool|disk|disque|ssd|lvm|stock|temp|°/i;
      var cell = function (td, it) {
        if (!it) return;
        var v = itemValue(hass, it);
        if (v.pct == null) { el("span", "v " + v.level, td, v.text); return; }
        var box = el("span", "cellb", td);
        var b = el("span", "bar " + v.level, box);
        el("i", "", b).style.width = Math.max(0, Math.min(100, v.pct)) + "%";
        el("span", "v " + (v.level === "ok" ? "" : v.level), box, v.text);
      };
      main.forEach((g, i) => {
        var child = isChild(g), nextChild = isChild(main[i + 1]);
        var tr = el("tr", child ? "child" + (nextChild ? "" : " last") : (nextChild ? "root" : ""), table);
        var down = g.status && hass.states[g.status] && ["off", "stopped", "unavailable"].indexOf(hass.states[g.status].state) >= 0;
        var nm = el("td", "n", tr);
        el("span", "st" + (g.status ? (down ? " bad" : " ok") : ""), nm);
        nm.appendChild(document.createTextNode(g.name || ""));
        if (g.kind) el("small", "", nm, g.kind);
        var items = (g.detail || g.items || []).slice();
        var take = function (label) { var k = items.findIndex(function (it) { return (it.label || "").toLowerCase() === label; }); return k >= 0 ? items.splice(k, 1)[0] : null; };
        cell(el("td", "", tr), take("cpu"));
        cell(el("td", "", tr), take("ram"));
        var store = [], extra = [];
        items.forEach(function (it) {
          var v = itemValue(hass, it);
          var text = (it.label ? it.label + " " : "") + v.text;
          var unit = (hass.states[it.entity] || { attributes: {} }).attributes.unit_of_measurement;
          (STORE.test(it.label || "") || unit === "°C" ? store : extra).push([text, v.level]);
        });
        [store, extra].forEach(function (list) {
          var td = el("td", "t", tr);
          list.forEach(function (x, k) { if (k) td.appendChild(document.createTextNode(" · ")); el("span", x[1] === "ok" ? "" : x[1], td, x[0]); });
        });
      });
      if (side.length) {
        var right = el("div", "dside", wrap);
        side.forEach(function (g) {
          el("h5", "", right, (g.name || "") + (g.kind ? " · " + g.kind : ""));
          var kv = el("div", "kv", right);
          (g.detail || g.items || []).forEach(function (it) {
            var v = itemValue(hass, it);
            el("span", "l", kv, it.label || "");
            el("span", "v " + (v.level === "ok" && it.of == null && it.good == null ? "" : v.level), kv, v.text);
          });
        });
      }
    }
    destroy() { clearInterval(this.pager); clearInterval(this.tick); clearTimeout(this.autoClose); }
  }

  // ===== igor-wall: the whole screen =====
  //   type: custom:igor-wall
  //   bar: { ... }                       # the status bar, above
  //   columns:
  //     - width: 1                       # share of the width (default 1)
  //       cards:
  //         - heading: météo             # a small title
  //         - <any card>
  //         - grow: true                 # takes the height left
  //           card: <any card>
  var WALL_CSS = [
    ":host { display: block; background: var(--bg); }",
    ".wall { display: flex; flex-direction: column; box-sizing: border-box; overflow: hidden; }",
    ".cols { flex: 1; min-height: 0; display: grid; gap: 10px; padding: 10px; box-sizing: border-box; }",
    ".col { display: flex; flex-direction: column; gap: 6px; min-height: 0; min-width: 0; }",
    ".hd { font-size: 10.5px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--faint); padding: 4px 2px 0; flex: none; }",
    ".hd:first-child { padding-top: 0; }",
    ".slot { flex: none; min-width: 0; }",
    ".slot.grow { flex: 1 1 0; min-height: 60px; display: flex; flex-direction: column; }",
    ".slot.grow > * { flex: 1; min-height: 0; height: 100%; }",
    ".stack .cols { grid-template-columns: 1fr !important; }",
    ".stack .wall, .wall.stack { height: auto !important; }",
    ".stack .slot.grow { flex: none; min-height: 260px; }",
    ".err { color: var(--bad); font-size: 12px; padding: 8px; }"
  ].join("\n");

  class IgorWall extends HTMLElement {
    constructor() { super(); this.attachShadow({ mode: "open" }); this.children_ = []; }
    setConfig(config) {
      if (!config || !Array.isArray(config.columns) || !config.columns.length) throw new Error("igor-wall: columns est requis (une liste de colonnes)");
      this.config = config;
      if (this._built) this.render();
    }
    getCardSize() { return 12; }
    connectedCallback() {
      try {
        if (!this.config || this.config.home !== false) window.localStorage.setItem("igor-wall-home", window.location.pathname);
        if (this.config && this.config.return_after != null) window.localStorage.setItem("igor-wall-return", String(this.config.return_after));
      } catch (e) { /* no storage: no way back by itself */ }
      if (!this._resize) {
        this._resize = () => this.fit();
        window.addEventListener("resize", this._resize);
      }
      if (!this._built) { this._built = true; this.render(); }
      setTimeout(() => this.fit(), 50);
    }
    disconnectedCallback() {
      if (this._resize) { window.removeEventListener("resize", this._resize); this._resize = null; }
    }
    set hass(hass) {
      this._hass = hass;
      if (this.bar) this.bar.hass = hass;
      this.children_.forEach((c) => { c.hass = hass; });
    }
    async render() {
      var root = this.shadowRoot;
      root.innerHTML = "";
      if (this.bar) { this.bar.destroy(); this.bar = null; }
      this.children_ = [];
      el("style", "", root, BASE + "\n" + BAR_CSS + "\n" + WALL_CSS);
      var wall = el("div", "wall", root);
      this.wall = wall;
      if (this.config.bar && (this.config.bar.groups || []).length) this.bar = new IgorBar(wall, this.config.bar);
      var cols = el("div", "cols", wall);
      cols.style.gridTemplateColumns = this.config.columns.map(function (c) { return (Number(c.width) || 1) + "fr"; }).join(" ");
      var helpers = window.loadCardHelpers ? await window.loadCardHelpers() : null;
      this.config.columns.forEach((c) => {
        var col = el("div", "col", cols);
        (c.cards || []).forEach((item) => {
          if (item && item.heading != null && !item.type) { el("div", "hd", col, item.heading); return; }
          var grow = !!(item && item.grow && item.card);
          var cfg = grow ? item.card : item;
          var slot = el("div", "slot" + (grow ? " grow" : ""), col);
          var card;
          try {
            card = helpers ? helpers.createCardElement(cfg) : document.createElement("hui-error-card");
          } catch (e) {
            el("div", "err", slot, String(e && e.message || e));
            return;
          }
          slot.appendChild(card);
          if (this._hass) card.hass = this._hass;
          this.children_.push(card);
        });
      });
      if (this._hass) this.hass = this._hass;
      this.fit();
    }
    // Exactly the screen's height below where the wall starts; stacked on a phone.
    fit() {
      if (!this.wall) return;
      var narrow = window.innerWidth < (this.config.stack_below || 760);
      this.wall.classList.toggle("stack", narrow);
      if (narrow) { this.wall.style.height = "auto"; return; }
      var top = this.getBoundingClientRect().top + (window.scrollY || 0);
      this.wall.style.height = Math.max(320, window.innerHeight - Math.max(0, top)) + "px";
    }
  }

  // ===== the journal card =====
  //   type: custom:igor-journal-card
  //   limit: 20          # exchanges read (the card shows those that fit)
  class IgorJournalCard extends IgorCard {
    setConfig(config) { this.config = config || {}; }
    build() {
      this.style([
        ".list { flex: 1; min-height: 0; overflow: hidden; }",
        ".e { display: grid; grid-template-columns: 5ch 1fr; gap: 8px; padding: 5px 0; border-bottom: 1px dashed var(--line); }",
        ".e:last-child { border-bottom: 0; }",
        ".h { color: var(--faint); }",
        ".q { color: var(--fg); }",
        ".q::before { content: '› '; color: var(--dim); }",
        ".a { color: var(--acc); }",
        ".m { color: var(--dim); font-size: 11px; }",
        ".m .okc + span::before, .m span + span::before { content: ' · '; color: var(--faint); }",
        ".stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; text-align: center; padding-top: 6px; border-top: 1px solid var(--line); margin-top: 6px; flex: none; }",
        ".stats b { display: block; color: var(--fg); font-weight: 500; font-size: 14px; }",
        ".stats span { color: var(--dim); font-size: 10px; }",
        ".empty { color: var(--dim); padding: 10px 0; }"
      ].join("\n"));
      var card = el("ha-card", "", this.shadowRoot);
      var top = el("div", "top", card);
      el("span", "t sub", top, (this.config.title || "journal").toUpperCase()).style.letterSpacing = "0.12em";
      var link = el("button", "link", top, "historique ›");
      link.type = "button";
      link.addEventListener("click", function () {
        window.dispatchEvent(new CustomEvent("ll-custom", { detail: { igor_journal: true } }));
      });
      this.list = el("div", "list", card);
      this.stats = el("div", "stats", card);
      this.timer = null;
      this.turn = "";
    }
    connectedCallback() { if (!this.timer && this._built) this.load(); }
    disconnectedCallback() { clearInterval(this.timer); this.timer = null; }
    update(hass) {
      // Read again when Igor finishes a turn, and every two minutes.
      var igor = igorSensor(hass);
      var turn = igor ? igor.state + "|" + (igor.attributes.turn || "") : "";
      if (turn !== this.turn && (!igor || igor.state === "done" || igor.state === "error" || !this.turn)) { this.turn = turn; this.load(); }
      else this.turn = turn;
      if (!this.timer) this.timer = setInterval(() => this.load(), 120000);
    }
    load() {
      var hass = this._hass;
      if (!hass || this.loading) return;
      this.loading = true;
      var limit = Math.max(1, Math.min(200, Number(this.config.limit) || 30));
      hass.callWS({ type: "call_service", domain: "nives", service: "journal", service_data: { limit: limit }, return_response: true })
        .then((r) => { this.render((r && r.response && r.response.entries) || []); })
        .catch(() => { this.list.innerHTML = ""; el("div", "empty", this.list, "Journal indisponible (intégration Igor à jour ?)"); })
        .then(() => { this.loading = false; });
    }
    render(entries) {
      this.list.innerHTML = "";
      if (!entries.length) el("div", "empty", this.list, "Aucun échange pour l'instant.");
      entries.slice().reverse().forEach((e) => {
        var row = el("div", "e", this.list);
        el("span", "h", row, hhmm(new Date(e.at)));
        var body = el("span", "", row);
        el("div", "q", body, e.words || "");
        if (e.answer && !e.silent) el("div", "a", body, e.answer);
        var meta = el("div", "m", body);
        (e.done || []).forEach(function (d) { el("span", "okc", meta, d); });
        (e.trace || []).forEach(function (s) {
          if (typeof s.ms !== "number") return;
          if (s.step === "local") el("span", "", meta, "local " + fr(s.ms / 1000, 1) + " s");
          else if (s.where === "online" && s.step === "mistral") el("span", "", meta, "en ligne " + fr(s.ms / 1000, 1) + " s");
        });
      });
      // Today: exchanges, those done without going online, the local model's mean time.
      var today = new Date().toDateString(), n = 0, localOnly = 0, sum = 0, count = 0;
      entries.forEach(function (e) {
        if (new Date(e.at).toDateString() !== today) return;
        n++;
        var online = false;
        (e.trace || []).forEach(function (s) {
          if (s.where === "online") online = true;
          if (s.step === "local" && typeof s.ms === "number") { sum += s.ms; count++; }
        });
        if (!online) localOnly++;
      });
      this.stats.innerHTML = "";
      [[String(n), "aujourd'hui"], [String(localOnly), "en local seul"], [count ? fr(sum / count / 1000, 1) + " s" : "—", "local moyen"]].forEach((p) => {
        var s = el("span", "", this.stats);
        el("b", "num", s, p[0]);
        s.appendChild(document.createTextNode(p[1]));
      });
    }
  }

  // ===== the Docker card (Portainer) =====
  //   type: custom:igor-docker-card
  //   title: vm-docker
  //   exclude: [portainer]          # container names left out (optional)
  // Containers are found by the Portainer integration's own entities, one
  // device per container.
  var DOCKER_KINDS = [
    ["cpu", /(cpu_usage_total|utilisation_totale_du_processeur)(_\d+)?$/],
    ["memp", /(memory_usage_percentage|pourcentage_d_utilisation_de_la_memoire)(_\d+)?$/],
    ["mem", /(memory_usage|utilisation_de_la_memoire)(_\d+)?$/],
    ["state", /(_state|_etat)(_\d+)?$/],
    ["image", /_image(_\d+)?$/],
    ["started", /_started(_\d+)?$/],
    ["health", /(_health|_sante)(_\d+)?$/]
  ];
  var DOCKER_KEYS = { cpu_usage_total: "cpu", memory_usage_percentage: "memp", memory_usage: "mem", state: "state", image: "image", started: "started", health: "health" };
  // A container's buttons (Portainer), in English or French entity ids.
  var DOCKER_BUTTONS = [
    ["pause", /_(pause_container|mettre_le_conteneur_en_pause)(_\d+)?$/],
    ["resume", /_(resume_container|reprendre_le_conteneur)(_\d+)?$/],
    ["restart", /_(restart_container|redemarrer_le_conteneur)(_\d+)?$/],
    ["recreate", /_(recreate_container|recreer_le_conteneur)(_\d+)?$/],
    ["kill", /_(kill_container|forcer_l_arret_du_conteneur)(_\d+)?$/],
    ["start", /_(start_container|demarrer_le_conteneur)(_\d+)?$/],
    ["stop", /_(stop_container|arreter_le_conteneur)(_\d+)?$/],
    ["prune_images", /_prune_unused_images$/],
    ["prune_volumes", /_prune_unused_volumes$/]
  ];
  // The endpoint (Portainer's "local"): its totals and clean-up buttons.
  function dockerEndpoint(hass, platform) {
    var reg = hass.entities || {}, out = {}, dev = null;
    Object.keys(reg).forEach(function (id) {
      var e = reg[id];
      if (e && e.platform === platform && /^sensor\..*_containers_running$/.test(id)) dev = e.device_id;
    });
    if (!dev) return null;
    var KEYS = [["running", /_containers_running$/], ["stopped", /_containers_stopped$/], ["containers", /_container_disk_usage_total_size$/],
      ["images", /_image_disk_usage_total_size$/], ["volumes", /_volume_disk_usage_total_size$/], ["prune_images", /^button\..*_prune_unused_images$/], ["prune_volumes", /^button\..*_prune_unused_volumes$/]];
    Object.keys(reg).forEach(function (id) {
      if (!reg[id] || reg[id].device_id !== dev) return;
      KEYS.forEach(function (k) { if (!out[k[0]] && k[1].test(id)) out[k[0]] = id; });
    });
    return out;
  }
  function dockerContainers(hass, platform) {
    var byDevice = {};
    var reg = hass.entities || {};
    Object.keys(reg).forEach(function (id) {
      var e = reg[id];
      if (!e || e.platform !== platform || !e.device_id) return;
      if (id.indexOf("sensor.") !== 0) {
        var other = null;
        if (id.indexOf("update.") === 0) other = "update";
        else if (id.indexOf("button.") === 0) for (var b = 0; b < DOCKER_BUTTONS.length && !other; b++) if (DOCKER_BUTTONS[b][1].test(id)) other = DOCKER_BUTTONS[b][0];
        if (other) { var ob = byDevice[e.device_id] || (byDevice[e.device_id] = {}); if (!ob[other]) ob[other] = id; }
        return;
      }
      var kind = e.translation_key && DOCKER_KEYS[e.translation_key];
      if (!kind) for (var i = 0; i < DOCKER_KINDS.length && !kind; i++) if (DOCKER_KINDS[i][1].test(id)) kind = DOCKER_KINDS[i][0];
      if (!kind) return;
      var box = byDevice[e.device_id] || (byDevice[e.device_id] = {});
      if (!box[kind]) box[kind] = id;
    });
    var out = [];
    Object.keys(byDevice).forEach(function (dev) {
      var box = byDevice[dev];
      if (!box.cpu || !box.state) return;
      var d = (hass.devices || {})[dev] || {};
      box.name = d.name_by_user || d.name || box.cpu.replace(/^sensor\./, "");
      out.push(box);
    });
    out.sort(function (a, b) { return a.name.localeCompare(b.name); });
    return out;
  }
  class IgorDockerCard extends IgorCard {
    setConfig(config) { this.config = config || {}; }
    build() {
      this.style([
        ".list { flex: 1; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }",
        ".ct { display: grid; grid-template-columns: 8px minmax(0, 1fr) 7ch 40px 6ch; gap: 6px; align-items: center; padding: 2px 0; cursor: pointer; }",
        ".hid { color: var(--faint); font-size: 10.5px; margin-top: auto; padding-top: 4px; flex: none; }",
        ".dot { width: 7px; height: 7px; border-radius: 50%; background: var(--okc); }",
        ".dot.off { background: var(--bad); }",
        ".nm { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
        ".cp { color: var(--dim); font-size: 11px; text-align: right; font-variant-numeric: tabular-nums; }",
        ".info { grid-column: 2 / -1; color: var(--faint); font-size: 10.5px; margin-top: -3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
        ".empty { color: var(--dim); padding: 10px 0; }"
      ].join("\n"));
      var card = el("ha-card", "", this.shadowRoot);
      var top = el("div", "top", card);
      el("span", "t", top, this.config.title || "docker");
      this.sum = el("span", "sub num", top);
      this.list = el("div", "list", card);
      this.hidEl = el("div", "hid", card);
    }
    update(hass, prev) {
      if (!this.found || (prev && prev.entities !== hass.entities)) {
        var ex = (this.config.exclude || []).map(String);
        this.found = dockerContainers(hass, this.config.platform || "portainer").filter(function (c) { return ex.indexOf(c.name) < 0; });
        this.ids = [];
        this.found.forEach((c) => { ["cpu", "memp", "mem", "state", "image", "started", "health"].forEach((k) => { if (c[k]) this.ids.push(c[k]); }); });
        prev = null;
      }
      var now = Date.now();
      if (prev && now - (this.drawn || 0) < 10000) return;
      if (!changed(prev, hass, this.ids)) return;
      this.drawn = now;
      this.list.innerHTML = "";
      // A container removed from Docker leaves its entities behind, unavailable:
      // left out (show_unavailable: true keeps them).
      var shown = this.config.show_unavailable ? this.found : this.found.filter(function (c) {
        var st = hass.states[c.state];
        return st && ["unavailable", "unknown"].indexOf(String(st.state).toLowerCase()) < 0;
      });
      var hidden = this.found.length - shown.length;
      this.hidEl.textContent = hidden ? hidden + (hidden > 1 ? " anciens conteneurs masqués" : " ancien conteneur masqué") : "";
      if (!shown.length) { el("div", "empty", this.list, "Aucun conteneur Portainer trouvé."); this.sum.textContent = ""; return; }
      var STATES = { exited: "arrêté", paused: "en pause", restarting: "redémarre", created: "créé", dead: "mort" };
      var running = 0, cpu = 0;
      shown.forEach((c) => {
        var st = hass.states[c.state];
        var up = st && String(st.state).toLowerCase() === "running";
        if (up) running++;
        var cv = num(hass.states[c.cpu]);
        if (cv != null) cpu += cv;
        var row = el("div", "ct", this.list);
        row.addEventListener("click", () => moreInfo(this, c.state));
        el("span", "dot" + (up ? "" : " off"), row);
        el("span", "nm", row, c.name);
        el("span", "cp", row, up ? fr(cv, 1) + " %" : (st ? STATES[String(st.state).toLowerCase()] || st.state : "—")).classList.toggle("bad", !up);
        var mp = num(hass.states[c.memp]);
        var b = el("div", "bar", row);
        el("i", "", b).style.width = Math.max(0, Math.min(100, mp || 0)) + "%";
        var mem = hass.states[c.mem], mv = num(mem);
        var mu = mem ? (mem.attributes.unit_of_measurement || "") : "";
        el("span", "cp", row, mv == null ? "" : fr(mv, mv < 10 ? 1 : 0) + " " + mu.replace(/iB$|B$/, ""));
        var info = [];
        var img = hass.states[c.image];
        if (img && img.state && img.state !== "unknown") info.push(String(img.state).split("/").pop());
        var started = hass.states[c.started];
        if (up && started && started.state) { var s = since(started.state); if (s) info.push("depuis " + s); }
        var health = hass.states[c.health];
        if (health && health.state && ["unknown", "unavailable", "none", ""].indexOf(String(health.state).toLowerCase()) < 0) info.push(health.state);
        if (info.length) el("span", "info", row, info.join(" · "));
      });
      this.sum.textContent = running + "/" + shown.length + " · cpu " + fr(cpu, 1) + " %";
      this.sum.classList.toggle("warn", running < shown.length);
    }
  }

  // ===== history over the last hours, for the charts =====
  function loadHistory(hass, ids, hours) {
    var start = new Date(Date.now() - hours * 3600000).toISOString();
    var path = "history/period/" + encodeURIComponent(start) + "?filter_entity_id=" + ids.join(",") + "&minimal_response&no_attributes";
    return hass.callApi("GET", path).then(function (data) {
      var out = {};
      (data || []).forEach(function (series) {
        if (!series || !series.length) return;
        var id = series[0].entity_id;
        out[id] = series.map(function (p) { return { t: Date.parse(p.last_changed || p.lu * 1000), v: parseFloat(p.state || p.s) }; })
          .filter(function (p) { return !isNaN(p.v) && !isNaN(p.t); });
      });
      return out;
    });
  }
  // Points spread on `n` even steps between start and now (last value held).
  function resample(points, hours, n) {
    var out = [], start = Date.now() - hours * 3600000, step = (hours * 3600000) / (n - 1), j = 0, last = points.length ? points[0].v : 0;
    for (var i = 0; i < n; i++) {
      var t = start + i * step;
      while (j < points.length && points[j].t <= t) { last = points[j].v; j++; }
      out.push(last);
    }
    return out;
  }

  // ===== the network card (a router's WAN) =====
  //   type: custom:igor-net-card
  //   title: opnsense · wan
  //   down: sensor.opnsense_..._interface_wan_inbytes_kilobytes_per_second
  //   up: sensor.opnsense_..._interface_wan_outbytes_kilobytes_per_second
  //   scale: 0.008                  # kB/s -> Mb/s (default)
  //   unit: Mb/s
  //   hours: 1
  //   status: { entity: sensor.opnsense_..._gateway_wan_dhcp_status, good: [online] }
  //   extras: [ { entity: sensor.opnsense_..._dhcp_leases_all, label: dhcp } ]
  //   gateways: auto                # the router's gateways as chips (OPNsense names)
  //   interfaces: auto              # its interfaces, the busiest first, under the chart
  //   exclude: [loopback, wan]      # interfaces left out of the list
  // With OPNsense's integration, "auto" finds the sensors named like `down`:
  // <prefix>_interface_<name>_inbytes_… and <prefix>_gateway_<name>_status.
  var GW_WORDS = { online: "en ligne", offline: "hors ligne", down: "hors ligne", none: "en attente", pending: "en attente", unknown: "—", unavailable: "—" };
  function routerParts(hass, down) {
    var m = /^(sensor\.[a-z0-9_]*?_)interface_[a-z0-9_]+?_inbytes/.exec(down || "");
    if (!m) return { prefix: "", interfaces: [], gateways: [] };
    var prefix = m[1], ifs = [], gws = [];
    Object.keys(hass.states).forEach(function (id) {
      if (id.indexOf(prefix) !== 0) return;
      var rest = id.slice(prefix.length), x;
      if ((x = /^interface_(.+)_inbytes_kilobytes_per_second$/.exec(rest))) {
        ifs.push({ name: x[1], down: id, up: prefix + "interface_" + x[1] + "_outbytes_kilobytes_per_second" });
      } else if ((x = /^gateway_(.+)_status$/.exec(rest))) {
        gws.push({ name: x[1].replace(/_(dhcp|dhcp6|pppoe|static|gw|gateway)$/, ""), entity: id });
      }
    });
    return { prefix: prefix, interfaces: ifs, gateways: gws };
  }
  class IgorNetCard extends IgorCard {
    setConfig(config) {
      if (!config || !config.down) throw new Error("igor-net-card: down est requis");
      this.config = config;
    }
    build() {
      this.style([
        ".row { display: flex; gap: 12px; align-items: baseline; white-space: nowrap; overflow: hidden; flex: none; }",
        ".down { color: var(--okc); } .up { color: var(--acc); }",
        ".row .x { color: var(--dim); font-size: 11px; }",
        ".gw { display: flex; gap: 6px; flex-wrap: wrap; margin: 2px 0 5px; flex: none; }",
        ".gw span { border: 1px solid var(--line); border-radius: 10px; padding: 0 8px; font-size: 11px; color: var(--dim); }",
        ".gw span.on { border-color: rgba(var(--ok), 0.45); color: var(--okc); }",
        ".gw span.bad { border-color: var(--bad); color: var(--bad); }",
        ".ifs { flex: none; overflow: hidden; }",
        ".ifs.fill { flex: 1 1 0; min-height: 0; }",
        ".if { display: grid; grid-template-columns: minmax(0, 1fr) 6ch 6ch 50px; gap: 6px; align-items: center; padding: 1px 0; font-variant-numeric: tabular-nums; }",
        ".if .v { text-align: right; color: var(--dim); font-size: 11px; }",
        ".if.h { color: var(--faint); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; border-bottom: 1px solid var(--line); padding-bottom: 3px; margin: 6px 0 2px; }",
        ".if.h .v { color: var(--faint); font-size: 10px; text-transform: none; letter-spacing: 0; }",
        ".if .bar i { background: rgb(var(--ok)); }",
        "svg.chart.fixed { flex: none; height: 70px; }"
      ].join("\n"));
      var card = el("ha-card", "", this.shadowRoot);
      var top = el("div", "top", card);
      el("span", "t", top, this.config.title || "réseau");
      this.statusEl = el("span", "sub", top);
      this.gwEl = el("div", "gw", card);
      this.row = el("div", "row num", card);
      this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      this.svg.setAttribute("class", "chart");
      this.svg.setAttribute("viewBox", "0 0 100 100");
      this.svg.setAttribute("preserveAspectRatio", "none");
      card.appendChild(this.svg);
      var h = Number(this.config.hours) || 1;
      var axis = el("div", "axis", card);
      el("span", "", axis, h === 1 ? "-1 h" : "-" + h + " h");
      el("span", "", axis, h === 1 ? "-30 min" : "-" + fr(h / 2, h % 2 ? 1 : 0) + " h");
      el("span", "", axis, "maintenant");
      this.ifsEl = el("div", "ifs", card);
      this.series = {};
    }
    connectedCallback() { if (this._built && !this.timer) this.update(this._hass, null); }
    disconnectedCallback() { clearInterval(this.timer); this.timer = null; }
    ids() { return [this.config.down, this.config.up].filter(Boolean); }
    update(hass, prev) {
      if (!hass) return;
      var c = this.config, scale = c.scale != null ? Number(c.scale) : 0.008, unit = c.unit || "Mb/s";
      var watched = this.ids().concat((c.extras || []).map(function (x) { return x.entity; }));
      if (c.status) watched.push(c.status.entity || c.status);
      if (changed(prev, hass, watched)) {
        this.row.innerHTML = "";
        var dn = num(hass.states[c.down]), up = c.up ? num(hass.states[c.up]) : null;
        el("span", "down", this.row, "↓ " + fr(dn == null ? null : dn * scale, 1));
        if (c.up) el("span", "up", this.row, "↑ " + fr(up == null ? null : up * scale, 1) + " " + unit);
        (c.extras || []).forEach(function (x) {
          var v = itemValue(hass, x);
          el("span", "x " + (v.level === "ok" ? "" : v.level), this.row, (x.label ? x.label + " " : "") + v.text);
        }, this);
        if (c.status) {
          var sv = itemValue(hass, typeof c.status === "string" ? { entity: c.status } : c.status);
          this.statusEl.textContent = (c.status.label || "passerelle") + " " + sv.text;
          this.statusEl.className = "sub " + (sv.level === "ok" ? "okc" : sv.level);
        }
      }
      // The chart takes the height left, unless the list of interfaces does.
      var grow = !!(this.parentElement && this.parentElement.classList.contains("grow"));
      var withList = c.interfaces != null && c.interfaces !== false;
      this.svg.classList.toggle("fixed", !grow || withList);
      this.ifsEl.classList.toggle("fill", withList);
      var now = Date.now();
      if ((c.gateways || withList) && (!prev || now - (this.routerDrawn || 0) > 10000)) {
        this.routerDrawn = now;
        this.drawRouter(hass);
      }
      if (!this.timer) {
        this.fetch();
        this.timer = setInterval(() => this.fetch(), 60000);
      }
    }
    drawRouter(hass) {
      var c = this.config, scale = c.scale != null ? Number(c.scale) : 0.008;
      var parts = routerParts(hass, c.down);
      this.gwEl.innerHTML = "";
      if (c.gateways) {
        var primary = c.status ? (c.status.entity || c.status) : "";
        parts.gateways.forEach((g) => {
          var st = hass.states[g.entity], v = st ? String(st.state).toLowerCase() : "unavailable";
          var on = v === "online", bad = !on && (g.entity === primary || v === "offline" || v === "down");
          el("span", on ? "on" : bad ? "bad" : "", this.gwEl, (on ? "● " : "○ ") + g.name + " " + (GW_WORDS[v] || v));
        });
      }
      this.ifsEl.innerHTML = "";
      if (c.interfaces == null || c.interfaces === false) return;
      var ex = (c.exclude || ["loopback", "wan"]).map(function (x) { return String(x).toLowerCase(); });
      var rows = parts.interfaces.filter(function (f) { return ex.indexOf(f.name.toLowerCase()) < 0; }).map(function (f) {
        var d = num(hass.states[f.down]) || 0, u = num(hass.states[f.up]) || 0;
        return { name: f.name.replace(/_/g, " "), d: d * scale, u: u * scale };
      });
      rows.sort(function (a, b) { return (b.d + b.u) - (a.d + a.u); });
      var max = Math.max.apply(null, rows.map(function (r) { return r.d + r.u; }).concat([0.001]));
      var h = el("div", "if h", this.ifsEl);
      el("span", "", h, "interfaces");
      el("span", "v", h, "↓ Mb/s");
      el("span", "v", h, "↑ Mb/s");
      el("span", "", h);
      rows.forEach((r) => {
        var line = el("div", "if", this.ifsEl);
        el("span", "", line, r.name);
        el("span", "v", line, fr(r.d, 1));
        el("span", "v", line, fr(r.u, 1));
        var b = el("div", "bar", line);
        el("i", "", b).style.width = Math.round(((r.d + r.u) / max) * 100) + "%";
      });
    }
    fetch() {
      var hass = this._hass;
      if (!hass) return;
      var hours = Number(this.config.hours) || 1;
      loadHistory(hass, this.ids(), hours).then((data) => { this.series = data; this.draw(); }).catch(function () { /* the figures above still show */ });
    }
    draw() {
      var c = this.config, hours = Number(c.hours) || 1, n = 60;
      var dn = resample(this.series[c.down] || [], hours, n), up = c.up ? resample(this.series[c.up] || [], hours, n) : [];
      var max = Math.max.apply(null, dn.concat(up).concat([1]));
      var html = "";
      [[dn, "rgb(var(--ok))"], [up, "var(--acc)"]].forEach(function (p) {
        if (!p[0].length) return;
        var d = areaPath(p[0], max * 1.1, 100);
        html += '<path d="' + d + ' L100 100 L0 100 Z" fill="' + p[1] + '" fill-opacity="0.12"/>' +
          '<path d="' + d + '" fill="none" stroke="' + p[1] + '" stroke-width="1.4" vector-effect="non-scaling-stroke"/>';
      });
      this.svg.innerHTML = html;
    }
  }

  // ===== the energy card =====
  //   type: custom:igor-energy-card
  //   entity: sensor.power_now          # a power sensor in W (state_class measurement)
  //   title: énergie
  class IgorEnergyCard extends IgorCard {
    setConfig(config) {
      if (!config || !config.entity) throw new Error("igor-energy-card: entity est requis");
      this.config = config;
    }
    build() {
      this.style([
        ".now { display: flex; justify-content: space-between; align-items: baseline; flex: none; }",
        ".big { font-size: 22px; color: var(--fg); font-weight: 500; }",
        "rect.now { fill: rgb(var(--ok)); } rect { fill: rgba(var(--ok), 0.35); }"
      ].join("\n"));
      var card = el("ha-card", "", this.shadowRoot);
      card.addEventListener("click", () => moreInfo(this, this.config.entity));
      var now = el("div", "now", card);
      this.big = el("span", "big num", now);
      this.day = el("span", "sub num", now);
      this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      this.svg.setAttribute("class", "chart");
      this.svg.setAttribute("viewBox", "0 0 100 100");
      this.svg.setAttribute("preserveAspectRatio", "none");
      card.appendChild(this.svg);
      var axis = el("div", "axis", card);
      ["0h", "6h", "12h", "18h", "23h"].forEach(function (t) { el("span", "", axis, t); });
    }
    connectedCallback() { if (this._built && !this.timer) this.update(this._hass, null); }
    disconnectedCallback() { clearInterval(this.timer); this.timer = null; }
    update(hass, prev) {
      if (!hass) return;
      var grow = !!(this.parentElement && this.parentElement.classList.contains("grow"));
      this.svg.style.flex = grow ? "" : "none";
      this.svg.style.height = grow ? "" : (Number(this.config.chart_height) || 64) + "px";
      if (changed(prev, hass, [this.config.entity])) {
        var st = hass.states[this.config.entity], v = num(st);
        this.big.textContent = v == null ? "—" : fr(v, 0) + " " + ((st && st.attributes.unit_of_measurement) || "W");
      }
      if (!this.timer) { this.fetch(); this.timer = setInterval(() => this.fetch(), 300000); }
    }
    fetch() {
      var hass = this._hass;
      if (!hass) return;
      var midnight = new Date(); midnight.setHours(0, 0, 0, 0);
      hass.callWS({ type: "recorder/statistics_during_period", start_time: midnight.toISOString(), period: "hour", statistic_ids: [this.config.entity], types: ["mean"] })
        .then((r) => {
          var rows = (r && r[this.config.entity]) || [];
          var hours = [];
          for (var i = 0; i < 24; i++) hours.push(null);
          var wh = 0;
          rows.forEach(function (p) {
            var t = new Date(typeof p.start === "number" ? p.start : Date.parse(p.start));
            if (p.mean == null) return;
            hours[t.getHours()] = p.mean;
            wh += p.mean;
          });
          var unit = ((hass.states[this.config.entity] || {}).attributes || {}).unit_of_measurement || "W";
          var kwh = unit === "kW" ? wh : wh / 1000;
          this.day.textContent = "aujourd'hui " + fr(kwh, 1) + " kWh";
          var max = Math.max.apply(null, hours.map(function (h) { return h || 0; }).concat([1]));
          var cur = new Date().getHours(), html = "", w = 100 / 24;
          hours.forEach(function (h, i) {
            if (h == null) return;
            var y = (h / max) * 94;
            html += '<rect class="' + (i === cur - 1 ? "now" : "") + '" x="' + (i * w + 0.5).toFixed(2) + '" y="' + (100 - y).toFixed(2) + '" width="' + (w - 1).toFixed(2) + '" height="' + y.toFixed(2) + '" rx="0.5"/>';
          });
          this.svg.innerHTML = html;
        })
        .catch(() => { this.day.textContent = "pas de statistiques"; });
    }
  }

  // ===== the camera card =====
  //   type: custom:igor-camera-card
  //   entity: camera.salon
  //   title: caméra · salon
  //   interval: 10                     # seconds between pictures
  class IgorCameraCard extends IgorCard {
    setConfig(config) {
      if (!config || !config.entity) throw new Error("igor-camera-card: entity est requis");
      this.config = config;
    }
    build() {
      this.style([
        "ha-card { padding: 0; position: relative; background: #0a0c0e; cursor: pointer; min-height: 80px; }",
        "img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }",
        ".lbl { position: absolute; left: 8px; right: 8px; bottom: 6px; display: flex; justify-content: space-between; color: #e6ebf0; font-size: 11px; text-shadow: 0 1px 2px #000; }",
        ".off { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: var(--dim); }"
      ].join("\n"));
      var card = el("ha-card", "", this.shadowRoot);
      card.addEventListener("click", () => moreInfo(this, this.config.entity));
      this.img = el("img", "", card);
      this.img.alt = "";
      this.off = el("div", "off", card, "caméra indisponible");
      var lbl = el("div", "lbl", card);
      el("span", "", lbl, this.config.title || "caméra");
      this.when = el("span", "num", lbl);
    }
    connectedCallback() { if (this._built && !this.timer) this.update(this._hass, null); }
    disconnectedCallback() { clearInterval(this.timer); this.timer = null; }
    update(hass) {
      if (!hass) return;
      if (!this.timer) {
        this.refresh();
        this.timer = setInterval(() => this.refresh(), Math.max(2, Number(this.config.interval) || 10) * 1000);
      }
    }
    refresh() {
      var st = this._hass && this._hass.states[this.config.entity];
      var pic = st && st.attributes.entity_picture;
      var ok = st && pic && st.state !== "unavailable";
      this.off.hidden = !!ok;
      this.img.hidden = !ok;
      if (!ok) return;
      this.img.src = pic + (pic.indexOf("?") >= 0 ? "&" : "?") + "_t=" + Date.now();
      this.when.textContent = hhmm(new Date());
    }
  }

  // ===== small cards in the theme's style =====
  function icon(parent, name, cls) {
    var i = document.createElement("ha-icon");
    i.setAttribute("icon", name);
    if (cls) i.className = cls;
    parent.appendChild(i);
    return i;
  }
  var CARD_CSS = [
    ".tile { display: grid; grid-template-columns: 28px minmax(0, 1fr) auto; gap: 9px; align-items: center; }",
    ".ic { width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; background: color-mix(in srgb, var(--k, var(--dim)) 16%, transparent); color: var(--k, var(--dim)); --mdc-icon-size: 17px; }",
    ".k-ok { --k: rgb(var(--ok)); } .k-acc { --k: var(--acc); } .k-wait { --k: var(--wait); } .k-bad { --k: var(--bad); }",
    ".pn { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
    ".sn { color: var(--dim); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
    ".pill { font-size: 10.5px; border: 1px solid var(--line); color: var(--dim); border-radius: 10px; padding: 1px 8px; cursor: pointer; background: none; font-family: inherit; }",
    ".pill.on { border-color: rgba(var(--ok), 0.45); color: var(--okc); }",
    ".pill:focus-visible { outline: 2px solid var(--acc); outline-offset: 2px; }"
  ].join("\n");
  function longPress(node, onTap, onHold) {
    var timer = null, held = false;
    node.addEventListener("pointerdown", function () { held = false; timer = setTimeout(function () { held = true; if (onHold) onHold(); }, 600); });
    ["pointerup", "pointerleave", "pointercancel"].forEach(function (e) { node.addEventListener(e, function () { clearTimeout(timer); }); });
    node.addEventListener("click", function () { if (!held && onTap) onTap(); });
  }
  function navigate(path) {
    window.history.pushState(null, "", path);
    window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
  }
  function service(hass, name, data, target) {
    var parts = String(name || "").split(".");
    if (parts.length !== 2) return Promise.reject(new Error("service " + name));
    return hass.callService(parts[0], parts[1], data || {}, target);
  }

  // ----- igor-assist-card: Igor himself -----
  //   type: custom:igor-assist-card
  //   satellite: assist_satellite.living_room   # tap: talk to Igor
  //   assist: input_boolean.assist              # hold, or the pill: Igor on or off
  //   start_message: Je vous écoute...
  class IgorAssistCard extends IgorCard {
    setConfig(config) { this.config = config || {}; }
    getCardSize() { return 1; }
    build() {
      this.style(CARD_CSS + "\nha-card { border-color: #24394a; cursor: pointer; }\n.lens { width: 28px; height: 28px; border-radius: 50%; background: radial-gradient(circle, #e1f5fe 0, #4fc3f7 30%, #0277bd 65%, #0d1014 100%); box-shadow: 0 0 0 2px #2b3a46; }\n.lens.off { filter: grayscale(1) brightness(0.6); }\n.pn { font-size: 14px; }");
      var card = el("ha-card", "", this.shadowRoot);
      var t = el("div", "tile", card);
      this.lens = el("span", "lens", t);
      var mid = el("span", "", t);
      el("div", "pn", mid, this.config.name || "Igor");
      this.sub = el("div", "sn", mid);
      this.pill = el("button", "pill", t, "assist");
      this.pill.type = "button";
      this.pill.addEventListener("click", (ev) => { ev.stopPropagation(); this.toggle(); });
      longPress(card, () => this.talk(), () => this.toggle());
    }
    talk() {
      var c = this.config;
      if (!c.satellite || !this._hass) return;
      this._hass.callService("assist_satellite", "start_conversation", { preannounce: false, start_message: c.start_message || "Je vous écoute..." }, { entity_id: c.satellite });
    }
    toggle() { if (this.config.assist && this._hass) this._hass.callService("homeassistant", "toggle", {}, { entity_id: this.config.assist }); }
    update(hass) {
      var c = this.config, igor = igorSensor(hass), sat = c.satellite && hass.states[c.satellite] ? hass.states[c.satellite].state : "";
      var on = !c.assist || !hass.states[c.assist] || hass.states[c.assist].state !== "off";
      var s = igor ? igor.state : "idle", text;
      if (!on) text = "désactivé";
      else if (s === "heard") text = igor.attributes.status === "listening" ? "je vous écoute…" : "entendu";
      else if (s === "thinking" || sat === "processing") text = "réflexion…";
      else if (s === "answering" || sat === "responding") text = "réponse…";
      else if (sat === "listening") text = "je vous écoute…";
      else if (s === "error") text = "erreur";
      else text = c.idle_text || "prêt · oreille ouverte";
      if (this.sub.textContent !== text) this.sub.textContent = text;
      this.lens.classList.toggle("off", !on);
      this.pill.classList.toggle("on", on);
    }
  }

  // ----- igor-buttons-card: a row of small buttons -----
  //   type: custom:igor-buttons-card
  //   buttons:
  //     - { icon: mdi:monitor, name: PC, service: nives.screen, data: { action: pc } }
  //     - { icon: mdi:cog, name: Réglages, navigate: /config }    # a page of Home Assistant
  //     - { icon: mdi:menu, name: Menu, menu: true }               # Home Assistant's sidebar
  class IgorButtonsCard extends IgorCard {
    setConfig(config) {
      if (!config || !Array.isArray(config.buttons) || !config.buttons.length) throw new Error("igor-buttons-card: buttons est requis");
      this.config = config;
    }
    getCardSize() { return 1; }
    build() {
      this.style(".row { display: grid; gap: 5px; }\nbutton { background: var(--card); border: 1px solid var(--line); border-radius: var(--ha-card-border-radius, 6px); color: var(--dim); font-family: inherit; font-size: 10.5px; padding: 6px 2px 5px; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 2px; --mdc-icon-size: 18px; min-width: 0; }\nbutton ha-icon { color: var(--fg); }\nbutton span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }\nbutton.done { border-color: var(--acc); }\nbutton:focus-visible { outline: 2px solid var(--acc); outline-offset: 2px; }\n:host { display: block; }");
      var row = el("div", "row", this.shadowRoot);
      row.style.gridTemplateColumns = "repeat(" + (Number(this.config.columns) || this.config.buttons.length) + ", minmax(0, 1fr))";
      this.config.buttons.forEach((b) => {
        var btn = el("button", "", row);
        btn.type = "button";
        icon(btn, b.icon || "mdi:gesture-tap");
        el("span", "", btn, b.name || "");
        btn.addEventListener("click", () => {
          if (b.navigate) { navigate(String(b.navigate)); return; }
          if (b.menu) { this.dispatchEvent(new CustomEvent("hass-toggle-menu", { bubbles: true, composed: true })); return; }
          if (!this._hass) return;
          service(this._hass, b.service, b.data, b.target).then(() => {
            btn.classList.add("done");
            setTimeout(() => btn.classList.remove("done"), 800);
          }).catch((e) => { btn.title = String(e && e.message || e); });
        });
      });
    }
  }

  // ----- igor-weather-card -----
  //   type: custom:igor-weather-card
  //   entity: weather.home
  //   hours: 6          # hours shown
  //   days: 5           # days shown, as temperature bars
  var WEATHER = {
    "clear-night": ["mdi:weather-night", "nuit claire"], cloudy: ["mdi:weather-cloudy", "nuageux"], exceptional: ["mdi:alert-circle-outline", "exceptionnel"],
    fog: ["mdi:weather-fog", "brouillard"], hail: ["mdi:weather-hail", "grêle"], lightning: ["mdi:weather-lightning", "orage"],
    "lightning-rainy": ["mdi:weather-lightning-rainy", "orage et pluie"], partlycloudy: ["mdi:weather-partly-cloudy", "éclaircies"],
    pouring: ["mdi:weather-pouring", "averses"], rainy: ["mdi:weather-rainy", "pluie"], snowy: ["mdi:weather-snowy", "neige"],
    "snowy-rainy": ["mdi:weather-snowy-rainy", "neige et pluie"], sunny: ["mdi:weather-sunny", "ensoleillé"], windy: ["mdi:weather-windy", "venteux"],
    "windy-variant": ["mdi:weather-windy-variant", "venteux"]
  };
  class IgorWeatherCard extends IgorCard {
    setConfig(config) {
      if (!config || !config.entity) throw new Error("igor-weather-card: entity est requis");
      this.config = config;
    }
    build() {
      this.style([
        ".now { display: grid; grid-template-columns: auto 1fr auto; gap: 10px; align-items: center; padding-bottom: 6px; border-bottom: 1px solid var(--line); --mdc-icon-size: 34px; }",
        ".now ha-icon { color: var(--wait); }",
        ".big { font-size: 24px; font-weight: 500; color: var(--fg); }",
        ".clock { text-align: right; }",
        ".hours { display: grid; text-align: center; color: var(--dim); font-size: 10.5px; padding: 6px 0; border-bottom: 1px solid var(--line); --mdc-icon-size: 17px; }",
        ".hours ha-icon { color: var(--wait); display: block; margin: 2px auto; }",
        ".hours b { display: block; color: var(--fg); font-weight: 500; font-size: 12px; }",
        ".day { display: grid; grid-template-columns: 4.5ch 18px 3.5ch 1fr 3.5ch; gap: 6px; align-items: center; margin-top: 5px; font-variant-numeric: tabular-nums; --mdc-icon-size: 16px; }",
        ".day ha-icon { color: var(--wait); }",
        ".lo { text-align: right; color: var(--dim); }",
        ".rng { height: 5px; border-radius: 3px; background: var(--track); position: relative; }",
        ".rng i { position: absolute; top: 0; bottom: 0; border-radius: 3px; background: linear-gradient(90deg, #6cc4f5, #5cc28f 55%, #d9a441); }",
        ".rng b { position: absolute; top: -3px; width: 10px; height: 10px; border-radius: 50%; background: var(--fg); border: 2px solid var(--card); margin-left: -5px; box-sizing: border-box; }"
      ].join("\n"));
      var card = el("ha-card", "", this.shadowRoot);
      card.addEventListener("click", () => moreInfo(this, this.config.entity));
      var now = el("div", "now", card);
      this.icon = icon(now, "mdi:weather-partly-cloudy");
      var mid = el("div", "", now);
      this.temp = el("div", "big num", mid);
      this.cond = el("div", "sub", mid);
      var clock = el("div", "clock", now);
      this.time = el("div", "big num", clock);
      this.date = el("div", "sub", clock);
      this.hoursEl = el("div", "hours", card);
      this.daysEl = el("div", "", card);
      this.hourly = [];
      this.daily = [];
      this.tick = setInterval(() => this.clock(), 15000);
      this.clock();
    }
    clock() {
      var d = new Date();
      this.time.textContent = hhmm(d);
      this.date.textContent = d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
    }
    subscribe(hass) {
      if (this.subs || !hass.connection) return;
      this.subs = [];
      ["hourly", "daily"].forEach((type) => {
        hass.connection.subscribeMessage((msg) => { this[type] = (msg && msg.forecast) || []; this.draw(); },
          { type: "weather/subscribe_forecast", forecast_type: type, entity_id: this.config.entity })
          .then((unsub) => { this.subs.push(unsub); })
          .catch(() => { /* this kind of forecast is not offered */ });
      });
    }
    disconnectedCallback() { (this.subs || []).forEach(function (u) { try { u(); } catch (e) { /* gone */ } }); this.subs = null; }
    connectedCallback() { if (this._built && this._hass) this.subscribe(this._hass); }
    update(hass, prev) {
      this.subscribe(hass);
      if (changed(prev, hass, [this.config.entity])) this.draw();
    }
    draw() {
      var hass = this._hass;
      if (!hass) return;
      var st = hass.states[this.config.entity] || { state: "unavailable", attributes: {} };
      var ok = ["unavailable", "unknown"].indexOf(st.state) < 0;
      var first = this.hourly[0] || {};
      // The current state unavailable: the forecast's first hour stands in.
      var cond = ok ? st.state : first.condition;
      var temp = ok && st.attributes.temperature != null ? st.attributes.temperature : first.temperature;
      var w = WEATHER[cond] || ["mdi:weather-partly-cloudy", cond || "—"];
      this.icon.setAttribute("icon", w[0]);
      this.temp.textContent = temp == null ? "—" : Math.round(temp) + "°";
      var wind = ok ? st.attributes.wind_speed : first.wind_speed;
      this.cond.textContent = w[1] + (wind != null ? " · " + Math.round(wind) + " " + (st.attributes.wind_speed_unit || "km/h") : "");
      var nh = Number(this.config.hours) || 6;
      var hours = this.hourly.filter(function (h) { return Date.parse(h.datetime) > Date.now() - 1800000; }).slice(0, nh);
      this.hoursEl.innerHTML = "";
      this.hoursEl.style.gridTemplateColumns = "repeat(" + Math.max(1, hours.length) + ", 1fr)";
      this.hoursEl.hidden = !hours.length;
      hours.forEach((h) => {
        var cell = el("span", "", this.hoursEl, new Date(h.datetime).getHours() + "h");
        icon(cell, (WEATHER[h.condition] || ["mdi:weather-partly-cloudy"])[0]);
        el("b", "", cell, h.temperature == null ? "—" : Math.round(h.temperature) + "°");
      });
      var days = this.daily.slice(0, Number(this.config.days) || 5);
      this.daysEl.innerHTML = "";
      if (!days.length) return;
      var lo = Math.min.apply(null, days.map(function (d) { return d.templow != null ? d.templow : d.temperature; }));
      var hi = Math.max.apply(null, days.map(function (d) { return d.temperature; }));
      var span = Math.max(1, hi - lo);
      days.forEach((d, i) => {
        var row = el("div", "day", this.daysEl);
        el("span", "", row, i === 0 ? "auj." : new Date(d.datetime).toLocaleDateString("fr-FR", { weekday: "short" }));
        icon(row, (WEATHER[d.condition] || ["mdi:weather-partly-cloudy"])[0]);
        var dl = d.templow != null ? d.templow : d.temperature;
        el("span", "lo", row, Math.round(dl) + "°");
        var r = el("span", "rng", row), bar = el("i", "", r);
        bar.style.left = ((dl - lo) / span) * 100 + "%";
        bar.style.right = (100 - ((d.temperature - lo) / span) * 100) + "%";
        if (i === 0 && temp != null) el("b", "", r).style.left = Math.max(0, Math.min(100, ((temp - lo) / span) * 100)) + "%";
        el("span", "", row, Math.round(d.temperature) + "°");
      });
    }
  }

  // ----- igor-alarm-card: an alarm clock (Alarm Clocks integration) -----
  //   type: custom:igor-alarm-card
  //   device_id: 2b31…                 # the alarm clock, as in alarm-clocks-card
  //   title: Réveil
  // Tap: the integration's full card in a window; the pill: on or off.
  var DAYS = [["monday", "lun"], ["tuesday", "mar"], ["wednesday", "mer"], ["thursday", "jeu"], ["friday", "ven"], ["saturday", "sam"], ["sunday", "dim"]];
  function alarmEntities(hass, deviceId) {
    var out = { days: {} }, reg = hass.entities || {};
    Object.keys(reg).forEach(function (id) {
      if (!reg[id] || reg[id].device_id !== deviceId) return;
      if (/^switch\..*_enabled$/.test(id)) out.enabled = id;
      else if (/^sensor\..*_next_alarm$/.test(id)) out.next = id;
      else if (/^sensor\..*_state$/.test(id)) out.state = id;
      else if (/^time\..*_alarm_time$/.test(id)) out.time = id;
      else if (/^button\..*_snooze$/.test(id)) out.snooze = id;
      else if (/^button\..*_dismiss$/.test(id)) out.dismiss = id;
      else DAYS.forEach(function (d) { if (id === id.replace(/_[a-z]+$/, "") + "_" + d[0] && /^switch\./.test(id)) out.days[d[0]] = id; });
    });
    return out;
  }
  class IgorAlarmCard extends IgorCard {
    setConfig(config) {
      if (!config || !config.device_id) throw new Error("igor-alarm-card: device_id est requis");
      this.config = config;
    }
    getCardSize() { return 1; }
    build() {
      this.style(CARD_CSS + "\nha-card { cursor: pointer; }\n.acts { display: flex; gap: 6px; margin-top: 6px; }\n.acts button { flex: 1; background: none; border: 1px solid var(--line); border-radius: 4px; color: var(--fg); font-family: inherit; font-size: 11px; padding: 4px; cursor: pointer; }\n.acts[hidden] { display: none; }\n.pop { position: fixed; inset: 0; z-index: 2147482995; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; }\n.pop[hidden] { display: none; }\n.box { width: min(520px, 92vw); max-height: 90vh; overflow: auto; background: var(--bg); border: 1px solid var(--line); border-radius: 8px; padding: 10px; }\n.box .close { display: block; margin: 8px 0 0 auto; background: none; border: 1px solid var(--line); color: var(--dim); font-family: inherit; padding: 4px 12px; border-radius: 4px; cursor: pointer; }");
      var card = el("ha-card", "", this.shadowRoot);
      var t = el("div", "tile k-ok", card);
      this.ic = el("span", "ic", t);
      icon(this.ic, "mdi:alarm");
      var mid = el("span", "", t);
      this.main = el("div", "pn", mid);
      this.sub = el("div", "sn", mid);
      this.pill = el("button", "pill", t);
      this.pill.type = "button";
      this.pill.addEventListener("click", (ev) => { ev.stopPropagation(); if (this.ids.enabled) this._hass.callService("switch", "toggle", {}, { entity_id: this.ids.enabled }); });
      this.acts = el("div", "acts", card);
      this.acts.hidden = true;
      [["snooze", "Répéter"], ["dismiss", "Arrêter"]].forEach((a) => {
        var b = el("button", "", this.acts, a[1]);
        b.type = "button";
        b.addEventListener("click", (ev) => { ev.stopPropagation(); if (this.ids[a[0]]) this._hass.callService("button", "press", {}, { entity_id: this.ids[a[0]] }); });
      });
      card.addEventListener("click", () => this.open());
      this.pop = el("div", "pop", this.shadowRoot);
      this.pop.hidden = true;
      this.pop.addEventListener("click", (ev) => { if (ev.target === this.pop) this.pop.hidden = true; });
      this.tick = setInterval(() => { if (this._hass) this.update(this._hass, null); }, 30000);
    }
    async open() {
      if (!this.full && window.loadCardHelpers) {
        var helpers = await window.loadCardHelpers();
        var box = el("div", "box", this.pop);
        this.full = helpers.createCardElement(Object.assign({ type: "custom:alarm-clocks-card", devices: [{ device_id: this.config.device_id, expanded: true }],
          show_settings: false, show_days: true, show_next_alarm: true, expandable: false }, this.config.full || {}));
        box.appendChild(this.full);
        var close = el("button", "close", box, "fermer");
        close.type = "button";
        close.addEventListener("click", () => { this.pop.hidden = true; });
      }
      if (this.full) this.full.hass = this._hass;
      this.pop.hidden = false;
    }
    update(hass, prev) {
      if (!this.ids || (prev && prev.entities !== hass.entities)) this.ids = alarmEntities(hass, this.config.device_id);
      if (this.full && !this.pop.hidden) this.full.hass = hass;
      var ids = this.ids, s = function (id) { return id && hass.states[id] ? hass.states[id].state : ""; };
      var on = s(ids.enabled) === "on", state = s(ids.state);
      var time = s(ids.time).slice(0, 5);
      this.main.textContent = (this.config.title || "Réveil") + (time ? " · " + time : "");
      var days = DAYS.filter(function (d) { return s(ids.days[d[0]]) === "on"; }).map(function (d) { return d[1]; });
      var parts = [days.length ? days.join(" ") : "une seule fois"];
      var next = Date.parse(s(ids.next));
      if (on && !isNaN(next) && next > Date.now()) {
        var m = Math.round((next - Date.now()) / 60000);
        parts.push("dans " + (m >= 60 ? Math.floor(m / 60) + " h " + pad(m % 60) : m + " min"));
      }
      var ringing = state === "ringing" || state === "snoozed";
      if (ringing) parts = [state === "ringing" ? "sonne" : "en répétition"];
      this.sub.textContent = parts.join(" · ");
      this.pill.textContent = on ? "activé" : "désactivé";
      this.pill.classList.toggle("on", on);
      this.ic.parentElement.className = "tile " + (ringing ? "k-wait" : on ? "k-ok" : "");
      this.acts.hidden = !ringing;
    }
  }

  // ----- igor-mini-card: a sensor, its 24 hours in one line -----
  //   type: custom:igor-mini-card
  //   entity: sensor.temperature
  //   name: température
  class IgorMiniCard extends IgorCard {
    setConfig(config) {
      if (!config || !config.entity) throw new Error("igor-mini-card: entity est requis");
      this.config = config;
    }
    getCardSize() { return 1; }
    build() {
      this.style(".mini { display: grid; grid-template-columns: minmax(0, 1fr) 54px; gap: 6px; align-items: center; cursor: pointer; }\n.v { font-size: 15px; color: var(--fg); }\nsvg { width: 54px; height: 20px; display: block; }");
      var card = el("ha-card", "", this.shadowRoot);
      var m = el("div", "mini", card);
      m.addEventListener("click", () => moreInfo(this, this.config.entity));
      var left = el("span", "", m);
      el("div", "sub", left, this.config.name || "");
      this.v = el("div", "v num", left);
      this.range = el("div", "sub num", left);
      this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      this.svg.setAttribute("viewBox", "0 0 54 20");
      m.appendChild(this.svg);
    }
    connectedCallback() { if (this._built && !this.timer && this._hass) this.update(this._hass, null); }
    disconnectedCallback() { clearInterval(this.timer); this.timer = null; }
    update(hass, prev) {
      var st = hass.states[this.config.entity];
      if (changed(prev, hass, [this.config.entity])) {
        var v = num(st), unit = st ? st.attributes.unit_of_measurement || "" : "";
        this.v.textContent = v == null ? "—" : fr(v, 1) + (unit === "°C" ? "°" : " " + unit);
      }
      if (!this.timer) { this.fetch(); this.timer = setInterval(() => this.fetch(), 600000); }
    }
    fetch() {
      var hass = this._hass, id = this.config.entity;
      if (!hass) return;
      loadHistory(hass, [id], 24).then((data) => {
        var pts = resample(data[id] || [], 24, 30);
        if (!pts.length) return;
        var mn = Math.min.apply(null, pts), mx = Math.max.apply(null, pts), d = "";
        pts.forEach(function (v, i) { d += (i ? " L" : "M") + ((i / (pts.length - 1)) * 54).toFixed(1) + " " + (18 - ((v - mn) / (mx - mn || 1)) * 16).toFixed(1); });
        this.svg.innerHTML = '<path d="' + d + '" fill="none" stroke="' + (this.config.color || "rgb(var(--ok))") + '" stroke-width="1.3"/>';
        this.range.textContent = fr(mn, 1) + "–" + fr(mx, 1) + " · 24 h";
      }).catch(function () { /* the value still shows */ });
    }
  }


  // ===== press a button, a second time for what cuts =====
  // A dangerous action turns red at the first press and acts at the second,
  // within 4 seconds.
  function actionButton(parent, iconName, title, onPress, danger) {
    var b = el("button", "act" + (danger ? " danger" : ""), parent);
    b.type = "button";
    b.title = title;
    icon(b, iconName);
    var armed = null;
    b.addEventListener("click", function (ev) {
      ev.stopPropagation();
      if (danger && !armed) {
        b.classList.add("armed");
        b.title = title + " : appuyer encore pour confirmer";
        armed = setTimeout(function () { armed = null; b.classList.remove("armed"); b.title = title; }, 4000);
        return;
      }
      clearTimeout(armed);
      armed = null;
      b.classList.remove("armed");
      b.title = title;
      onPress();
    });
    return b;
  }
  var ACT_CSS = [
    ".act { width: 26px; height: 24px; border: 1px solid var(--line); border-radius: 4px; background: none; color: var(--dim); display: inline-grid; place-items: center; cursor: pointer; padding: 0; --mdc-icon-size: 15px; }",
    ".act:hover { color: var(--fg); }",
    ".act.danger { color: var(--bad); border-color: rgba(224, 103, 95, 0.35); }",
    ".act.armed { background: rgba(224, 103, 95, 0.22); color: #ffb3b3; border-color: var(--bad); }",
    ".act:focus-visible { outline: 2px solid var(--acc); outline-offset: 2px; }",
    ".acts { display: flex; gap: 4px; justify-content: flex-end; }"
  ].join("\n");
  function press(hass, id) { if (id) hass.callService("button", "press", {}, { entity_id: id }); }
  function sizeText(st) {
    var v = num(st);
    if (v == null) return "—";
    var u = (st.attributes.unit_of_measurement || "").replace(/iB$|B$/, "");
    return fr(v, v < 10 ? 1 : 0) + " " + u;
  }

  // ----- igor-docker-manage-card: Portainer's containers, with their buttons -----
  //   type: custom:igor-docker-manage-card
  //   title: docker · vm-docker
  class IgorDockerManageCard extends IgorCard {
    setConfig(config) { this.config = config || {}; }
    build() {
      this.style(ACT_CSS + "\n" + [
        ".sum { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; text-align: center; padding: 3px 0 7px; border-bottom: 1px solid var(--line); flex: none; }",
        ".sum b { display: block; font-weight: 500; font-size: 15px; color: var(--fg); }",
        ".sum span { font-size: 10.5px; color: var(--dim); }",
        ".tools { display: flex; gap: 6px; padding: 7px 0; border-bottom: 1px solid var(--line); flex: none; }",
        ".tool { border: 1px solid var(--line); border-radius: 4px; background: none; color: var(--dim); font-family: inherit; font-size: 11px; padding: 3px 9px; cursor: pointer; display: flex; gap: 5px; align-items: center; --mdc-icon-size: 14px; }",
        ".tool.armed { background: rgba(224, 103, 95, 0.22); color: #ffb3b3; border-color: var(--bad); }",
        ".list { flex: 1; min-height: 0; overflow-y: auto; }",
        ".ct { display: grid; grid-template-columns: minmax(0, 1fr) 10ch 6ch 6ch auto; gap: 10px; align-items: center; padding: 6px 0; border-bottom: 1px dashed var(--line); font-variant-numeric: tabular-nums; }",
        ".ct .n { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
        ".ct .n .i { display: block; color: var(--dim); font-size: 10.5px; margin-left: 14px; overflow: hidden; text-overflow: ellipsis; }",
        ".ct .v { text-align: right; color: var(--dim); font-size: 11px; white-space: nowrap; }",
        ".dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--okc); margin-right: 7px; vertical-align: 1px; }",
        ".dot.off { background: var(--bad); } .dot.pause { background: var(--wait); }",
        ".badge { font-size: 9.5px; border: 1px solid rgba(217, 164, 65, 0.5); color: var(--wait); border-radius: 9px; padding: 0 6px; margin-left: 6px; cursor: pointer; background: none; font-family: inherit; }",
        ".hid { color: var(--faint); font-size: 10.5px; padding-top: 5px; flex: none; }"
      ].join("\n"));
      var card = el("ha-card", "", this.shadowRoot);
      var top = el("div", "top", card);
      el("span", "t", top, this.config.title || "docker");
      el("span", "sub", top, "portainer");
      this.sumEl = el("div", "sum", card);
      this.toolsEl = el("div", "tools", card);
      this.list = el("div", "list", card);
      this.hidEl = el("div", "hid", card);
    }
    update(hass, prev) {
      var platform = this.config.platform || "portainer";
      if (!this.found || (prev && prev.entities !== hass.entities)) {
        this.found = dockerContainers(hass, platform);
        this.endpoint = dockerEndpoint(hass, platform);
        this.toolsBuilt = false;
        prev = null;
      }
      var now = Date.now();
      if (prev && now - (this.drawn || 0) < 5000) return;
      this.drawn = now;
      var ep = this.endpoint || {};
      this.sumEl.innerHTML = "";
      [["running", "en marche", "okc"], ["stopped", "arrêtés", "bad"], ["containers", "conteneurs"], ["images", "images"], ["volumes", "volumes"]].forEach((k) => {
        var span = el("span", "", this.sumEl), st = hass.states[ep[k[0]]];
        var val = k[0] === "running" || k[0] === "stopped" ? (num(st) == null ? "—" : String(Math.round(num(st)))) : sizeText(st);
        el("b", "num " + (k[2] && num(st) ? k[2] : ""), span, val);
        span.appendChild(document.createTextNode(k[1]));
      });
      if (!this.toolsBuilt) {
        this.toolsBuilt = true;
        this.toolsEl.innerHTML = "";
        [["prune_images", "nettoyer les images"], ["prune_volumes", "nettoyer les volumes"]].forEach((t) => {
          if (!ep[t[0]]) return;
          var b = el("button", "tool", this.toolsEl);
          b.type = "button";
          icon(b, "mdi:broom");
          el("span", "", b, t[1]);
          var armed = null;
          b.addEventListener("click", () => {
            if (!armed) { b.classList.add("armed"); armed = setTimeout(() => { armed = null; b.classList.remove("armed"); }, 4000); return; }
            clearTimeout(armed); armed = null; b.classList.remove("armed");
            press(this._hass, ep[t[0]]);
          });
        });
        this.toolsEl.hidden = !this.toolsEl.children.length;
      }
      var shown = this.found.filter(function (c) { var st = hass.states[c.state]; return st && ["unavailable", "unknown"].indexOf(String(st.state).toLowerCase()) < 0; });
      var hidden = this.found.length - shown.length;
      this.hidEl.textContent = hidden ? hidden + (hidden > 1 ? " anciens conteneurs masqués" : " ancien conteneur masqué") : "";
      var WORDS = { running: "en marche", exited: "arrêté", paused: "en pause", restarting: "redémarre", created: "créé", dead: "mort" };
      this.list.innerHTML = "";
      shown.forEach((c) => {
        var st = String((hass.states[c.state] || {}).state || "").toLowerCase();
        var up = st === "running", paused = st === "paused";
        var row = el("div", "ct", this.list);
        var n = el("span", "n", row);
        el("span", "dot" + (up ? "" : paused ? " pause" : " off"), n);
        n.appendChild(document.createTextNode(c.name));
        var upd = hass.states[c.update];
        if (upd && upd.state === "on") {
          var badge = el("button", "badge", n, "maj");
          badge.type = "button";
          badge.addEventListener("click", (ev) => { ev.stopPropagation(); moreInfo(this, c.update); });
        }
        var info = [], img = hass.states[c.image], started = hass.states[c.started], health = hass.states[c.health];
        if (img && img.state && img.state !== "unknown") info.push(String(img.state).split("/").pop());
        if (up && started && started.state) { var sn = since(started.state); if (sn) info.push("depuis " + sn); }
        if (health && ["unknown", "unavailable", "none", ""].indexOf(String(health.state).toLowerCase()) < 0) info.push(health.state);
        el("span", "i", n, info.join(" · "));
        el("span", "v " + (up ? "" : "bad"), row, WORDS[st] || st);
        el("span", "v", row, up ? fr(num(hass.states[c.cpu]), 1) + " %" : "—");
        el("span", "v", row, sizeText(hass.states[c.mem]));
        var acts = el("span", "acts", row), h = this._hass;
        if (paused && c.resume) actionButton(acts, "mdi:play", "reprendre", function () { press(h, c.resume); });
        else if (!up && c.start) actionButton(acts, "mdi:play", "démarrer", function () { press(h, c.start); });
        if (up && c.pause) actionButton(acts, "mdi:pause", "mettre en pause", function () { press(h, c.pause); });
        if (c.restart) actionButton(acts, "mdi:restart", up ? "redémarrer" : "démarrer", function () { press(h, c.restart); });
        if (c.recreate) actionButton(acts, "mdi:autorenew", "recréer", function () { press(h, c.recreate); }, true);
        if (up && (c.stop || c.kill)) actionButton(acts, "mdi:stop-circle-outline", c.stop ? "arrêter" : "forcer l'arrêt", function () { press(h, c.stop || c.kill); }, true);
        row.addEventListener("click", () => moreInfo(this, c.state));
      });
    }
  }

  // ----- igor-proxmox-card: the Proxmox VE integration's machines -----
  //   type: custom:igor-proxmox-card
  //   title: proxmox
  // Everything is found from the integration's devices: the node, each VM and
  // container (state, uptime, processor, memory used of total, disk), then the
  // storages, ZFS pools and disks (temperature, wear).
  var PVE = [
    ["cpu", /^sensor\..*_(cpu_used|cpu_utilise)$/], ["memp", /^sensor\..*_(memory_used_percentage|memoire_utilisee_en_pourcentage)$/],
    ["mem", /^sensor\..*_(memory_used|memoire_utilisee)$/], ["free", /^sensor\..*_(memory_free|memoire_libre)$/],
    ["disk", /^sensor\..*_(disk_used_percentage|disque_utilise_en_pourcentage)$/], ["boot", /^sensor\..*_(last_boot|dernier_demarrage)$/],
    ["status", /^binary_sensor\..*_(status|etat)$/], ["io", /^sensor\..*_io_delay$/],
    ["used", /^sensor\..*_used_percentage$/], ["health", /^sensor\..*_health$/],
    ["temp", /^sensor\..*_temperature(_\d+)?$/], ["wear", /^sensor\..*_wearout(_\d+)?$/],
    ["vms", /^sensor\..*_virtual_machines_running$/], ["failed", /^sensor\..*_(failed_tasks|taches_echouees)$/]
  ];
  function proxmoxParts(hass, platform) {
    var reg = hass.entities || {}, devs = {};
    Object.keys(reg).forEach(function (id) {
      var e = reg[id];
      if (!e || e.platform !== platform || !e.device_id) return;
      var box = devs[e.device_id] || (devs[e.device_id] = {});
      for (var i = 0; i < PVE.length; i++) if (PVE[i][1].test(id)) { if (!box[PVE[i][0]]) box[PVE[i][0]] = id; break; }
    });
    var out = { node: null, guests: [], storages: [], pools: [], disks: [] };
    Object.keys(devs).forEach(function (dev) {
      var d = (hass.devices || {})[dev] || {}, name = d.name || "", box = devs[dev], m;
      box.label = d.name_by_user || name;
      if ((m = /^Node (.+)$/.exec(name))) { box.label = d.name_by_user || m[1]; out.node = box; }
      else if ((m = /^(QEMU|LXC) (.+) \((\d+)\)$/.exec(name))) { box.label = d.name_by_user || m[2].toLowerCase(); box.vmid = Number(m[3]); box.kind = m[1] === "LXC" ? "ct" : "vm"; out.guests.push(box); }
      else if ((m = /^Storage (.+)$/.exec(name))) { box.label = d.name_by_user || m[1].split("/").pop(); out.storages.push(box); }
      else if ((m = /^ZFS .*?(?:Pool )?(\S+)$/.exec(name)) && /^ZFS/.test(name)) { box.label = d.name_by_user || m[1]; out.pools.push(box); }
      else if ((m = /^Disk [^:]+: (.+)$/.exec(name))) { box.label = d.name_by_user || m[1]; out.disks.push(box); }
    });
    out.guests.sort(function (a, b) { return a.vmid - b.vmid; });
    return out;
  }
  class IgorProxmoxCard extends IgorCard {
    setConfig(config) { this.config = config || {}; }
    build() {
      this.style([
        ".rows { flex: none; }",
        ".vm { display: grid; grid-template-columns: minmax(9rem, 1.2fr) 1fr 1fr 6.5rem; gap: 14px; align-items: center; padding: 6px 0; border-bottom: 1px dashed var(--line); cursor: pointer; font-variant-numeric: tabular-nums; }",
        ".vm .n { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
        ".vm .n small { color: var(--dim); font-size: 10.5px; margin-left: 5px; }",
        ".vm .n .s { display: block; color: var(--dim); font-size: 10.5px; margin-left: 14px; }",
        ".vm.child .n::before { content: '├ '; color: var(--faint); }",
        ".vm.child.last .n::before { content: '└ '; }",
        ".vm.root .n { color: var(--acc); }",
        ".vm.down { opacity: 0.55; }",
        ".dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--faint); margin-right: 7px; vertical-align: 1px; }",
        ".dot.ok { background: var(--okc); } .dot.bad { background: var(--bad); }",
        ".cell { display: grid; grid-template-columns: auto 1fr; gap: 3px 8px; align-items: center; }",
        ".cell .l { color: var(--dim); font-size: 10.5px; } .cell .v { text-align: right; }",
        ".cell .bar { grid-column: 1 / -1; } .cell .bar.warn i { background: var(--wait); } .cell .bar.bad i { background: var(--bad); }",
        ".x { color: var(--dim); font-size: 11px; text-align: right; }",
        ".hd { font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--faint); padding: 10px 0 4px; flex: none; }",
        ".disks { display: grid; grid-template-columns: repeat(auto-fit, minmax(110px, 1fr)); gap: 12px; flex: none; }",
        ".foot { color: var(--dim); font-size: 11px; padding-top: 7px; flex: none; }"
      ].join("\n"));
      var card = el("ha-card", "", this.shadowRoot);
      var top = el("div", "top", card);
      el("span", "t", top, this.config.title || "proxmox");
      this.sumEl = el("span", "sub", top);
      this.rows = el("div", "rows", card);
      this.spacer = el("div", "", card);
      this.spacer.style.flex = "1 1 0";
      this.store = el("div", "", card);
    }
    update(hass, prev) {
      var platform = this.config.platform || "proxmoxve";
      if (!this.parts || (prev && prev.entities !== hass.entities)) { this.parts = proxmoxParts(hass, platform); prev = null; }
      var now = Date.now();
      if (prev && now - (this.drawn || 0) < 5000) return;
      this.drawn = now;
      var P = this.parts, S = function (id) { return id ? hass.states[id] : null; };
      var pct = function (parent, label, id, text) {
        var st = S(id), v = num(st), c = el("span", "cell", parent);
        el("span", "l", c, label);
        el("span", "v", c, text != null ? text : v == null ? "—" : fr(v < 10 ? Math.round(v * 10) / 10 : Math.round(v), v < 10 && v % 1 ? 1 : 0) + " %");
        var lvl = v >= 95 ? "bad" : v >= 80 ? "warn" : "";
        var b = el("span", "bar " + lvl, c);
        el("i", "", b).style.width = Math.max(0, Math.min(100, v || 0)) + "%";
      };
      var memText = function (box) {
        var u = num(S(box.mem)), f = num(S(box.free));
        if (u == null) return null;
        if (f == null) return fr(u, 1) + " G";
        return fr(u, 1) + "/" + fr(u + f, u + f < 10 ? 1 : 0) + " G";
      };
      this.rows.innerHTML = "";
      var all = (P.node ? [P.node] : []).concat(P.guests);
      all.forEach((box, i) => {
        var isNode = box === P.node, st = S(box.status);
        var up = !st || st.state === "on" || st.state === "running" || st.state === "online";
        var row = el("div", "vm " + (isNode ? "root" : "child" + (i === all.length - 1 ? " last" : "")) + (up ? "" : " down"), this.rows);
        row.addEventListener("click", () => moreInfo(this, box.cpu || box.status));
        var n = el("span", "n", row);
        el("span", "dot " + (st ? (up ? "ok" : "bad") : ""), n);
        n.appendChild(document.createTextNode(box.label));
        el("small", "", n, isNode ? "hôte" : (box.kind === "ct" ? "ct " : "") + box.vmid);
        var boot = S(box.boot), sn = boot ? since(boot.state) : "";
        el("span", "s", n, !up ? "arrêtée" : sn ? (isNode ? "démarré il y a " : "il y a ") + sn : "");
        pct(row, "cpu", box.cpu);
        pct(row, "ram", box.memp, memText(box) || undefined);
        var extra = isNode ? (box.io ? "io " + fr(num(S(box.io)), 1) + " %" : "") : (box.disk ? "disque " + Math.round(num(S(box.disk)) || 0) + " %" : "");
        el("span", "x", row, extra);
      });
      if (P.node) {
        var parts = [];
        if (P.node.vms) parts.push((num(S(P.node.vms)) || 0) + " vm");
        var failed = num(S(P.node.failed));
        if (failed) parts.push(failed + " tâche" + (failed > 1 ? "s" : "") + " échouée" + (failed > 1 ? "s" : ""));
        this.sumEl.textContent = parts.join(" · ");
        this.sumEl.className = "sub " + (failed ? "warn" : "");
      }
      this.store.innerHTML = "";
      if (P.storages.length) {
        el("div", "hd", this.store, "stockage");
        var grid = el("div", "disks", this.store);
        P.storages.forEach(function (b) { pct(grid, b.label, b.disk || b.used); });
      }
      var foot = [];
      P.pools.forEach(function (b) { var h = S(b.health); if (h) foot.push(b.label + " " + (String(h.state).toUpperCase() === "ONLINE" ? "en ligne" : h.state)); });
      P.disks.forEach(function (b) {
        var t = num(S(b.temp)), w = num(S(b.wear));
        if (t == null && w == null) return;
        foot.push(b.label.replace(/^Samsung SSD /, "").replace(/ \d+GB$/, "") + (t != null ? " " + Math.round(t) + "°" : "") + (w != null ? " (usure " + Math.round(w) + " %)" : ""));
      });
      if (foot.length) el("div", "foot", this.store, foot.join(" · "));
    }
  }

  // ----- igor-history-card: a few sensors over the last hours -----
  //   type: custom:igor-history-card
  //   title: pve · 24 h
  //   hours: 24
  //   entities: [ { entity: sensor.cpu, name: cpu, color: "#6cc4f5" }, … ]
  class IgorHistoryCard extends IgorCard {
    setConfig(config) {
      if (!config || !Array.isArray(config.entities) || !config.entities.length) throw new Error("igor-history-card: entities est requis");
      this.config = config;
    }
    build() {
      this.style(".leg { display: flex; gap: 10px; font-size: 11px; flex: none; }\nsvg.chart { min-height: 50px; }");
      var card = el("ha-card", "", this.shadowRoot);
      var top = el("div", "top", card);
      el("span", "t", top, this.config.title || "");
      this.leg = el("span", "leg", top);
      this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      this.svg.setAttribute("class", "chart");
      this.svg.setAttribute("viewBox", "0 0 100 100");
      this.svg.setAttribute("preserveAspectRatio", "none");
      card.appendChild(this.svg);
      var h = Number(this.config.hours) || 24, axis = el("div", "axis", card);
      el("span", "", axis, "-" + h + " h");
      el("span", "", axis, "-" + fr(h / 2, h % 2 ? 1 : 0) + " h");
      el("span", "", axis, "maintenant");
      var COLORS = ["#6cc4f5", "#d9a441", "#5cc28f", "#e0675f"];
      this.series = this.config.entities.map(function (e, i) { return Object.assign({ color: COLORS[i % COLORS.length] }, typeof e === "string" ? { entity: e } : e); });
    }
    connectedCallback() { if (this._built && !this.timer && this._hass) this.update(this._hass, null); }
    disconnectedCallback() { clearInterval(this.timer); this.timer = null; }
    update(hass, prev) {
      // A fixed height, unless it is the card that takes the height left.
      var grow = !!(this.parentElement && this.parentElement.classList.contains("grow"));
      this.svg.style.flex = grow ? "" : "none";
      this.svg.style.height = grow ? "" : (Number(this.config.chart_height) || 110) + "px";
      if (changed(prev, hass, this.series.map(function (s) { return s.entity; }))) {
        this.leg.innerHTML = "";
        this.series.forEach((s) => {
          var st = hass.states[s.entity], v = num(st), u = st ? st.attributes.unit_of_measurement || "" : "";
          var span = el("span", "", this.leg, (s.name || "") + " " + (v == null ? "—" : fr(v, v < 10 ? 1 : 0) + (u === "%" ? " %" : u ? " " + u : "")));
          span.style.color = s.color;
        });
      }
      if (!this.timer) { this.fetch(); this.timer = setInterval(() => this.fetch(), 300000); }
    }
    fetch() {
      var hass = this._hass, hours = Number(this.config.hours) || 24;
      if (!hass) return;
      loadHistory(hass, this.series.map(function (s) { return s.entity; }), hours).then((data) => {
        var allPct = this.series.every(function (s) { var st = hass.states[s.entity]; return st && st.attributes.unit_of_measurement === "%"; });
        var lines = this.series.map(function (s) { return resample(data[s.entity] || [], hours, 96); });
        var max = allPct ? 100 : Math.max.apply(null, [].concat.apply([1], lines)) * 1.1;
        var html = "";
        lines.forEach((pts, i) => {
          var c = this.series[i].color, d = areaPath(pts, max, 100);
          if (!d) return;
          html += '<path d="' + d + ' L100 100 L0 100 Z" fill="' + c + '" fill-opacity="0.10"/><path d="' + d + '" fill="none" stroke="' + c + '" stroke-width="1.3" vector-effect="non-scaling-stroke"/>';
        });
        this.svg.innerHTML = html;
      }).catch(function () { /* the legend still shows */ });
    }
  }

  function define(name, cls, label, description) {
    if (!customElements.get(name)) customElements.define(name, cls);
    window.customCards = window.customCards || [];
    window.customCards.push({ type: name, name: label, description: description });
  }
  define("igor-wall", IgorWall, "Igor · mur", "Tout l'écran : barre d'état des machines et colonnes de cartes jusqu'en bas.");
  define("igor-journal-card", IgorJournalCard, "Igor · journal", "Les derniers échanges avec Igor.");
  define("igor-docker-card", IgorDockerCard, "Igor · Docker", "Les conteneurs de Portainer.");
  define("igor-net-card", IgorNetCard, "Igor · réseau", "Le débit d'un routeur sur la dernière heure.");
  define("igor-energy-card", IgorEnergyCard, "Igor · énergie", "La puissance, heure par heure aujourd'hui.");
  define("igor-camera-card", IgorCameraCard, "Igor · caméra", "L'image d'une caméra, rafraîchie toutes les quelques secondes.");
  define("igor-assist-card", IgorAssistCard, "Igor · Igor", "Igor : son état, parler (appui), l'activer ou non (appui long).");
  define("igor-buttons-card", IgorButtonsCard, "Igor · boutons", "Une rangée de petits boutons qui appellent un service.");
  define("igor-weather-card", IgorWeatherCard, "Igor · météo", "Maintenant, heure par heure, et les jours en barres de températures.");
  define("igor-alarm-card", IgorAlarmCard, "Igor · réveil", "Un réveil (intégration Alarm Clocks) en une ligne.");
  define("igor-docker-manage-card", IgorDockerManageCard, "Igor · Docker (gestion)", "Les conteneurs de Portainer, leurs totaux et leurs boutons.");
  define("igor-proxmox-card", IgorProxmoxCard, "Igor · Proxmox", "L'hôte Proxmox, ses machines et son stockage.");
  define("igor-history-card", IgorHistoryCard, "Igor · courbes", "Quelques capteurs sur les dernières heures.");
  define("igor-mini-card", IgorMiniCard, "Igor · capteur", "Un capteur et ses 24 heures sur une ligne.");

  // ===== no top bar with the "Igor Journal (tablette)" theme =====
  var NOHEAD_CSS = ":host { --header-height: 0px !important; } .header { display: none !important; } #view { padding-top: env(safe-area-inset-top, 0px) !important; min-height: 100vh !important; }";
  function lovelaceRoot() {
    try {
      var ha = document.querySelector("home-assistant");
      var main = ha && ha.shadowRoot && ha.shadowRoot.querySelector("home-assistant-main");
      var panel = main && main.shadowRoot && main.shadowRoot.querySelector("ha-panel-lovelace");
      return panel && panel.shadowRoot && panel.shadowRoot.querySelector("hui-root");
    } catch (e) { return null; }
  }
  function wantsNoHeader(root) {
    var v = getComputedStyle(document.documentElement).getPropertyValue("--igor-hide-header").trim().replace(/["']/g, "");
    if (v !== "1" && v !== "true") return false;
    var q = window.location.search || "";
    if (/[?&](barre|edit)(=|&|$)/.test(q)) return false;
    return !(root && root.lovelace && root.lovelace.editMode);
  }
  setInterval(function () {
    var root = lovelaceRoot();
    if (!root || !root.shadowRoot) return;
    var style = root.shadowRoot.getElementById("igor-nohead");
    var want = wantsNoHeader(root);
    if (want && !style) {
      style = document.createElement("style");
      style.id = "igor-nohead";
      style.textContent = NOHEAD_CSS;
      root.shadowRoot.appendChild(style);
      window.dispatchEvent(new Event("resize"));
    } else if (!want && style) {
      style.remove();
      window.dispatchEvent(new Event("resize"));
    }
    // A wide screen keeps Home Assistant's sidebar docked on the left: on
    // the kiosk it goes too (this device only; the menu brings it back).
    var ha = document.querySelector("home-assistant");
    if (want && ha && ha.hass && ha.hass.dockedSidebar && ha.hass.dockedSidebar !== "always_hidden" && !sidebarDone) {
      sidebarDone = true;
      ha.dispatchEvent(new CustomEvent("hass-dock-sidebar", { detail: { dock: "always_hidden" } }));
    }
  }, 1000);
  var sidebarDone = false;

  // ===== back to the wall =====
  // With the tablet theme, the page that shows an igor-wall is the screen's
  // home: after `return_after` minutes untouched on another page (settings,
  // history…), the screen goes back to it.
  var lastTouch = Date.now();
  ["pointerdown", "keydown", "wheel"].forEach(function (e) { window.addEventListener(e, function () { lastTouch = Date.now(); }, true); });
  setInterval(function () {
    var v = getComputedStyle(document.documentElement).getPropertyValue("--igor-hide-header").trim().replace(/["']/g, "");
    if (v !== "1" && v !== "true") return;
    var home = null, after = 5;
    try { home = window.localStorage.getItem("igor-wall-home"); after = Number(window.localStorage.getItem("igor-wall-return")) || 5; } catch (e) { return; }
    if (!home || window.location.pathname === home || /[?&]edit=/.test(window.location.search)) return;
    if (Date.now() - lastTouch > after * 60000) { lastTouch = Date.now(); navigate(home); }
  }, 15000);

  // ===== the theme asked for in the address =====
  // ?igor_theme=Igor%20Journal%20(tablette) picks that theme for this device
  // (a kiosk without a keyboard): Home Assistant keeps the choice.
  (function () {
    var wanted = null;
    try { wanted = new URLSearchParams(window.location.search).get("igor_theme"); } catch (e) { wanted = null; }
    if (!wanted) return;
    var tries = 0;
    var t = setInterval(function () {
      var ha = document.querySelector("home-assistant");
      tries++;
      if (ha && ha.hass && ha.hass.themes && ha.hass.themes.themes) {
        clearInterval(t);
        if (!ha.hass.themes.themes[wanted]) return;
        var sel = ha.hass.selectedTheme || {};
        if (sel.theme !== wanted) ha.dispatchEvent(new CustomEvent("settheme", { detail: { theme: wanted, dark: true } }));
      } else if (tries > 60) {
        clearInterval(t);
      }
    }, 1000);
  })();
})();
