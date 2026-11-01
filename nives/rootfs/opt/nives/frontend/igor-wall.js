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
    ".close { background: none; border: 1px solid var(--line); color: var(--dim); font: inherit; padding: 4px 12px; border-radius: 4px; cursor: pointer; }",
    ".grp { display: grid; grid-template-columns: 22ch 1fr; gap: 14px; padding: 7px 0; border-bottom: 1px dashed var(--line); align-items: start; }",
    ".grp .nm { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
    ".grp .nm small { color: var(--dim); font-size: 11px; margin-left: 6px; }",
    ".grp.child .nm::before { content: '├ '; color: var(--faint); }",
    ".grp.child.last .nm::before { content: '└ '; }",
    ".grp.root .nm { color: var(--acc); }",
    ".its { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 6px 18px; }",
    ".it { display: grid; grid-template-columns: auto 1fr; gap: 2px 8px; align-items: center; }",
    ".it .l { color: var(--dim); }",
    ".it .v { text-align: right; font-variant-numeric: tabular-nums; }",
    ".it .bar { grid-column: 1 / -1; }",
    ".it .bar i { background: var(--acc); }",
    ".it .bar.warn i { background: var(--wait); } .it .bar.bad i { background: var(--bad); }"
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
      var close = el("button", "close", head, "fermer");
      close.type = "button";
      var groups = this.groups;
      groups.forEach((g, i) => {
        var child = g.child != null ? g.child : /^(vm|ct|lxc)/i.test(g.kind || "");
        var nextChild = groups[i + 1] && (groups[i + 1].child != null ? groups[i + 1].child : /^(vm|ct|lxc)/i.test(groups[i + 1].kind || ""));
        var row = el("div", "grp" + (child ? " child" + (nextChild ? "" : " last") : (groups[i + 1] && nextChild ? " root" : "")), d);
        var nm = el("span", "nm", row, g.name || "");
        if (g.kind) el("small", "", nm, g.kind);
        if (g.status && hass.states[g.status] && ["off", "stopped", "unavailable"].indexOf(hass.states[g.status].state) >= 0) nm.classList.add("bad");
        var its = el("div", "its", row);
        (g.detail || g.items || []).forEach((it) => {
          var v = itemValue(hass, it);
          var box = el("div", "it", its);
          el("span", "l", box, it.label || "");
          el("span", "v " + (v.level === "ok" && it.of == null && it.good == null ? "" : v.level), box, v.text);
          if (v.pct != null) {
            var b = el("div", "bar " + v.level, box);
            el("i", "", b).style.width = Math.max(0, Math.min(100, v.pct)) + "%";
          }
        });
      });
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
  function dockerContainers(hass, platform) {
    var byDevice = {};
    var reg = hass.entities || {};
    Object.keys(reg).forEach(function (id) {
      var e = reg[id];
      if (!e || e.platform !== platform || !e.device_id || id.indexOf("sensor.") !== 0) return;
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
        ".list { flex: 1; min-height: 0; overflow: hidden; display: flex; flex-direction: column; justify-content: space-between; }",
        ".list.tight { justify-content: flex-start; }",
        ".ct { display: grid; grid-template-columns: 8px minmax(0, 1fr) 5.5ch 44px 6ch; gap: 6px; align-items: center; padding: 2px 0; cursor: pointer; }",
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
      if (!this.found.length) { el("div", "empty", this.list, "Aucun conteneur Portainer trouvé."); this.sum.textContent = ""; return; }
      var running = 0, cpu = 0;
      this.found.forEach((c) => {
        var st = hass.states[c.state];
        var up = st && String(st.state).toLowerCase() === "running";
        if (up) running++;
        var cv = num(hass.states[c.cpu]);
        if (cv != null) cpu += cv;
        var row = el("div", "ct", this.list);
        row.addEventListener("click", () => moreInfo(this, c.state));
        el("span", "dot" + (up ? "" : " off"), row);
        el("span", "nm", row, c.name);
        el("span", "cp", row, up ? fr(cv, 1) + " %" : (st ? st.state : "—")).classList.toggle("bad", !up);
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
      this.list.classList.toggle("tight", this.found.length < 5);
      this.sum.textContent = running + "/" + this.found.length + " · cpu " + fr(cpu, 1) + " %";
      this.sum.classList.toggle("warn", running < this.found.length);
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
  class IgorNetCard extends IgorCard {
    setConfig(config) {
      if (!config || !config.down) throw new Error("igor-net-card: down est requis");
      this.config = config;
    }
    build() {
      this.style([
        ".row { display: flex; gap: 12px; align-items: baseline; white-space: nowrap; overflow: hidden; flex: none; }",
        ".down { color: var(--okc); } .up { color: var(--acc); }",
        ".row .x { color: var(--dim); font-size: 11px; }"
      ].join("\n"));
      var card = el("ha-card", "", this.shadowRoot);
      var top = el("div", "top", card);
      el("span", "t", top, this.config.title || "réseau");
      this.statusEl = el("span", "sub", top);
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
      if (!this.timer) {
        this.fetch();
        this.timer = setInterval(() => this.fetch(), 60000);
      }
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
        ".big { font-size: 24px; color: var(--fg); font-weight: 500; }",
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
