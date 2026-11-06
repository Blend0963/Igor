// Igor's wall dashboard: cards for a tablet screen filled to the bottom, in
// the style of the Igor Journal theme. Home Assistant loads this on every
// page (frontend.add_extra_js_url) next to igor-tablet.js.
//
//   custom:igor-wall          the whole screen: a status bar on top (one
//                             line that scrolls through the machines) and
//                             columns of cards that reach the bottom
//   custom:igor-journal-card  Igor's last exchanges, "historique" opens all
//   custom:igor-notifications-card  Home Assistant's notifications, waiting and sent
//   custom:igor-bank-card     a bank integration's accounts, month, categories, budgets, operations
//   custom:igor-docker-card   the containers of a Portainer endpoint
//   custom:igor-net-card      a router's traffic over the last hour
//   custom:igor-energy-card   power now and hour by hour today
//   custom:igor-camera-card   a camera's picture, refreshed every few seconds
//   custom:igor-news-card     the newest headlines of an RSS or Atom feed
//   custom:igor-dns-card      AdGuard Home's DNS queries, live (administrators)
//   custom:igor-map-card      where those queries' answers point to, on a world map
//   custom:igor-wifi-card     who is on which Wi-Fi (OpenWrt access points)
//   custom:igor-netmap-card   the network by VLAN around OPNsense, to look after it
//   custom:igor-talkers-card  the busiest devices through the router
//   custom:igor-wifi-scan-card  the Wi-Fi networks around (OpenWrt scan)
//
// And the "Igor Journal (tablette)" theme: its --igor-hide-header variable
// hides Home Assistant's top bar on the device that uses it, on the pages
// that show an igor-wall only (other dashboards keep their tabs). The bar
// comes back while editing the dashboard (?edit=1) or with ?barre in the address.
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
    ":host { display: block; --igor-radius: var(--ha-card-border-radius, 3px); --fg: var(--primary-text-color, #d5dbe1); --dim: var(--secondary-text-color, #6b7682); --faint: var(--disabled-text-color, #3d464f);",
    "  --line: var(--divider-color, #1d242c); --card: var(--ha-card-background, var(--card-background-color, #12171c)); --bg: var(--primary-background-color, #0d1014);",
    "  --acc: var(--primary-color, #6cc4f5); --ok: var(--rgb-green-color, 92, 194, 143); --okc: rgb(var(--ok)); --wait: #d9a441; --bad: #e0675f; --track: var(--outline-color, #1f262e);",
    "  font-family: " + MONO + "; }",
    "ha-card { height: 100%; box-sizing: border-box; padding: 8px 10px; display: flex; flex-direction: column; overflow: hidden; color: var(--fg); font-size: 12px; line-height: 1.35; }",
    ".sub { color: var(--dim); font-size: 11px; }",
    ".top { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; color: var(--fg); padding-bottom: 5px; border-bottom: 1px solid var(--line); margin-bottom: 4px; flex: none; }",
    ".top .t { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
    ".bar { height: 4px; border-radius: var(--igor-radius, 3px); background: var(--track); overflow: hidden; }",
    ".bar i { display: block; height: 100%; background: var(--acc); }",
    ".num { font-variant-numeric: tabular-nums; }",
    ".okc { color: var(--okc); } .warn { color: var(--wait); } .bad { color: var(--bad); }",
    ".axis { display: flex; justify-content: space-between; color: var(--dim); font-size: 10px; margin-top: 3px; flex: none; }",
    "svg.chart { flex: 1; min-height: 30px; width: 100%; display: block; margin-top: 6px; }",
    ".link { color: var(--acc); cursor: pointer; background: none; border: 0; font: inherit; padding: 0; }",
    ".link:focus-visible { outline: 2px solid var(--acc); outline-offset: 2px; }",
    "[hidden] { display: none !important; }",
    // A list longer than its card scrolls (never a line cut in half), with a thin bar.
    "::-webkit-scrollbar { width: 4px; height: 4px; } ::-webkit-scrollbar-thumb { background: var(--line); } ::-webkit-scrollbar-track { background: transparent; }",
    "* { scrollbar-color: var(--line) transparent; }"
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
  // With two Igor entries (an old one left behind), the one that moved last.
  function igorSensor(hass) {
    var best = null, bestAt = -1;
    for (var id in hass.states) {
      var st = hass.states[id];
      if (id.indexOf("sensor.") !== 0 || !st.attributes || !st.attributes.igor_voice) continue;
      var at = Math.max(Date.parse(st.attributes.started) || 0, Date.parse(st.last_changed) || 0, Date.parse(st.last_updated) || 0);
      if (at > bestAt) { best = st; bestAt = at; }
    }
    return best;
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
    // Back on the page (another tab, then this one again): a card that emptied
    // itself when it left is drawn again at once, not at the next change in
    // the house (an empty « Commandes » page until a light moved).
    connectedCallback() {
      if (!this._built && this._hass) { this._built = true; this.build(); this.update(this._hass, null); }
    }
    build() {}
    update() {}
    style(extra) { el("style", "", this.shadowRoot, scaled(BASE + "\n" + (extra || ""))); }
  }

  // ===== the status bar: every machine on one scrolling line =====
  //   bar:
  //     speed: 60              # seconds for one turn; 0: pages, no animation;
  //                            # auto: still while it fits, else one turn then a pause
  //     pause: 10              # with speed: auto, seconds at rest between two turns
  //     tap: /igor-wall/homelab  # a tap on the bar opens that page (else: the machines' detail)
  //     notifications: notifs  # the bell (Home Assistant's notifications waiting) opens that page of this dashboard (or /a/page); false: no bell
  //     size: big              # taller, larger letters: read from afar (a small wall tablet)
  //     edit: false            # no pencil (administrators: it puts the dashboard in edit mode)
  //     groups:                # an item: entity, label, unit, digits, warn/bad (from), below (red under)
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
    // `below: 0`: red under that value (an account overdrawn).
    if (it.below != null && v < Number(it.below)) level = "bad";
    return { text: text, level: level, pct: pct };
  }
  // Every size of text follows --igor-text (1 by default): a wall with
  // `text: big` (a car's head unit read from the driver's seat) has all its
  // letters larger, and its thin figures less thin (--igor-light).
  function scaled(css) {
    return String(css)
      .replace(/font-size:\s*(\d+(?:\.\d+)?)px/g, "font-size: calc($1px * var(--igor-text, 1))")
      .replace(/font-weight:\s*300\b/g, "font-weight: var(--igor-light, 300)");
  }
  var BAR_CSS = [
    ".ticker { height: 30px; flex: none; display: flex; align-items: center; border-bottom: 1px solid var(--line); background: var(--bg); font-size: 12px; color: var(--dim);",
    "  font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; cursor: pointer; }",
    ".fix { flex: none; display: flex; align-items: center; gap: 8px; padding: 0 12px; height: 100%; color: var(--fg); background: var(--bg); position: relative; z-index: 1; }",
    ".fix.left { border-right: 1px solid var(--line); }",
    ".fix.right { border-left: 1px solid var(--line); }",
    ".fix.bell { padding: 0 10px; gap: 4px; color: var(--wait); cursor: pointer; --mdc-icon-size: 16px; font-size: 11px; } .fix.bell[hidden] { display: none; }",
    ".fix.bell .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--igor-signal, #e5323b); box-shadow: 0 0 6px var(--igor-signal, #e5323b); display: inline-block; } .fix.bell .dot[hidden] { display: none; }",
    ".fix.pen { padding: 0 10px; color: var(--dim); cursor: pointer; --mdc-icon-size: 17px; } .fix.pen:hover { color: var(--fg); } .fix.pen[hidden] { display: none; }",
    ".ticker.big { height: 48px; font-size: 16px; } .ticker.big .brand { font-size: 18px; } .ticker.big .eye { width: 28px; height: 28px; }",
    ".ticker.big .state { font-size: 14px; } .ticker.big .tabs a { font-size: 12.5px; padding: 0 12px; letter-spacing: 0.1em; } .ticker.big .kind { font-size: 12px; }",
    // On a wide screen the tabs take at most half the bar (scrolling if there
    // are more): the machines' line keeps its room.
    "@media (min-width: 761px) { .tabs { flex: 0 1 auto; min-width: 0; max-width: 48%; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; } .tabs::-webkit-scrollbar { display: none; } .tabs a { flex: none; } }",
    ".ticker.big ~ .pop { top: 54px; }",
    ".ticker.big .fix { gap: 10px; padding: 0 16px; } .ticker.big .fix.right { font-size: 18px; } .ticker.big .fix.pen, .ticker.big .fix.bell { --mdc-icon-size: 22px; }",
    ".lens { width: 12px; height: 12px; border-radius: 50%; background: radial-gradient(circle, #e1f5fe 0, #4fc3f7 30%, #0277bd 65%, #0d1014 100%); box-shadow: 0 0 0 1.5px #3b4a56; flex: none; }",
    ".eye { width: 18px; height: 18px; flex: none; display: block; }",
    ".brand { font-family: 'Chakra Petch', " + MONO + "; letter-spacing: 0.22em; font-weight: 600; color: var(--fg); }",
    ".state { color: var(--dim); font-size: 11px; }",
    ".tabs { flex: none; display: flex; align-items: stretch; height: 100%; border-right: 1px solid var(--line); }",
    ".tabs a { display: flex; align-items: center; padding: 0 11px; color: var(--dim); font-size: 10.5px; letter-spacing: 0.14em; text-transform: uppercase; text-decoration: none; border-bottom: 2px solid transparent; cursor: pointer; }",
    ".tabs a:hover { color: var(--fg); }",
    ".tabs a.on { color: var(--fg); border-bottom-color: var(--igor-signal, #e5323b); }",
    "@media (max-width: 1100px) { .tabs:not(.keep) { display: none; } }",
    // `tabs: true`: the tabs keep their room whatever the width (an unfolded
    // phone, a small laptop): they scroll sideways when they don't fit, the
    // machines' line takes what is left, the clock always shows.
    ".tabs.keep { flex: 0 1 auto; min-width: 0; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; } .tabs.keep::-webkit-scrollbar { display: none; } .tabs.keep a { flex: none; }",
    // A phone: the pages' tabs take the bar and scroll sideways; the
    // machines' line gives them the room.
    "@media (max-width: 760px) { .tabs.keep { flex: 1 1 auto; min-width: 0; overflow-x: auto; scrollbar-width: none; border-right: 0; }",
    "  .tabs.keep::-webkit-scrollbar { display: none; } .tabs.keep a { flex: none; padding: 0 12px; } .tabs.keep ~ .lane { display: none; }",
    "  .tabs.keep ~ .fix.right { font-size: 11px; padding: 0 10px; } .fix.left .state { display: none; } .fix.left { padding: 0 10px; } }",
    ".lane { flex: 1 1 0; min-width: 0; overflow: hidden; height: 100%; display: flex; align-items: center; position: relative; }",
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
    // the clock's and Igor's panels, under the bar
    ".pop { position: fixed; top: 36px; z-index: 2147482991; width: min(440px, calc(100vw - 24px)); background: var(--bg); color: var(--fg); border: 1px solid var(--line); border-radius: var(--igor-radius, 3px); padding: 14px 16px; box-sizing: border-box; display: none; flex-direction: column; gap: 12px; font-size: 13px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }",
    ".pop.on { display: flex; } .pop.l { left: 12px; } .pop.r { right: 12px; }",
    ".pop h4 { margin: 0; font-size: 15px; font-weight: 500; display: flex; justify-content: space-between; align-items: center; gap: 10px; }",
    ".pop .kv { grid-template-columns: 1fr auto; }",
    ".pop .sub { color: var(--faint); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; }",
    ".pop .btns { display: flex; flex-wrap: wrap; gap: 8px; }",
    ".pop .btns button { background: none; border: 1px solid var(--line); color: var(--fg); font: inherit; padding: 6px 12px; border-radius: var(--igor-radius, 3px); cursor: pointer; }",
    ".pop .btns button.on { border-color: var(--acc); color: var(--acc); }",
    ".pop .last div { padding: 3px 0; color: var(--dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
    ".dhead { display: flex; justify-content: space-between; align-items: center; padding-bottom: 10px; border-bottom: 1px solid var(--line); margin-bottom: 8px; color: var(--dim); }",
    ".dhead b { color: var(--fg); font-weight: 500; }",
    ".dbtns { display: flex; gap: 8px; }",
    ".close.link { color: var(--acc); border-color: var(--acc); }",
    ".close { background: none; border: 1px solid var(--line); color: var(--dim); font: inherit; padding: 4px 12px; border-radius: var(--igor-radius, 3px); cursor: pointer; }",
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
      // size: big: a bar read from across the room (a small tablet on a wall).
      // Without `size`, a tablet (?igor_tablet, or a « tablette » theme) gets it.
      var big = this.config.size === "big";
      if (this.config.size == null) {
        try { big = !!window.localStorage.getItem("igor-tablet"); } catch (e) { big = false; }
        var tv = getComputedStyle(document.documentElement).getPropertyValue("--igor-bar-size").trim().replace(/["']/g, "");
        if (tv === "big") big = true;
      }
      this.root = el("div", "ticker" + (big ? " big" : ""), host);
      var left = el("span", "fix left", this.root);
      // The eye: a monolith pierced by a red eye, Igor's logo.
      left.insertAdjacentHTML("beforeend", '<svg class="eye" viewBox="0 0 256 256" aria-hidden="true"><rect x="107" y="20" width="44" height="216" fill="#e9e4da"/><circle cx="128" cy="96" r="48" fill="#07080a" stroke="#e5323b" stroke-width="16"/><circle cx="128" cy="96" r="16" fill="#e5323b"/></svg>');
      el("span", "brand", left, "IGOR");
      // `name: 407`: what this screen is, after IGOR.
      if (this.config.name) el("span", "state", left, String(this.config.name));
      this.igorEl = el("span", "state", left, "");
      // The dashboard's pages, the one shown in red (`tabs: false`: none).
      // `tabs: true`: kept on a narrow screen too (a car's head unit).
      this.tabsEl = this.config.tabs === false ? null : el("span", "tabs" + (this.config.tabs === true ? " keep" : ""), this.root);
      if (this.tabsEl) this.tabsEl.addEventListener("click", (ev) => ev.stopPropagation());
      var lane = el("div", "lane", this.root);
      this.lane = lane;
      this.run = el("div", "run", lane);
      var speed = this.config.speed == null ? 60 : Number(this.config.speed);
      // speed: auto: the line stays still while it fits; longer, it goes round
      // once, stops back at its start, waits `pause` seconds, and again.
      this.auto = String(this.config.speed) === "auto";
      this.paged = !this.auto && !(speed > 0);
      this.cells = [];
      var copies = this.paged ? 1 : 2;
      this.segs = [];
      for (var c = 0; c < copies; c++) this.buildCopy(c);
      if (this.auto) {
        this.copy2 = Array.prototype.slice.call(this.run.children, this.segs.length);
        // The turn's end only puts the line back; the next turn is timed by
        // autoTurn itself (an animation ends unseen while its page is away).
        this.run.addEventListener("animationend", () => { this.run.style.animation = "none"; });
        this.autoTimer = setTimeout(() => this.autoTurn(), 3000);
      } else if (!this.paged) {
        this.run.classList.add("roll");
        this.run.style.setProperty("--speed", speed + "s");
      }
      // A bell with Home Assistant's notifications waiting, when there are
      // some: a touch opens `notifications: /a-page`, else Home Assistant's
      // own list (`notifications: false`: no bell).
      if (this.config.notifications !== false) {
        this.bellEl = el("span", "fix right bell", this.root);
        this.bellEl.setAttribute("role", "button");
        this.bellEl.hidden = true;
        icon(this.bellEl, "mdi:bell-ring");
        this.bellN = el("b", "", this.bellEl, "");
        // A red dot: something was sent since this screen last showed the list.
        this.bellDot = el("i", "dot", this.bellEl);
        this.bellDot.hidden = true;
        this.bellEl.addEventListener("click", (ev) => {
          ev.stopPropagation();
          var to = this.config.notifications;
          // `notifications: notifs`: a page of this dashboard.
          if (typeof to === "string") navigate(to.charAt(0) === "/" ? to : "/" + window.location.pathname.split("/")[1] + "/" + to);
          else this.root.dispatchEvent(new CustomEvent("hass-show-notifications", { bubbles: true, composed: true }));
        });
      }
      // A pencil, administrators only: the dashboard in edit mode (`edit: false`: none).
      if (this.config.edit !== false) {
        this.editEl = el("span", "fix right pen", this.root);
        this.editEl.title = "Modifier le tableau de bord";
        this.editEl.setAttribute("role", "button");
        this.editEl.hidden = true;
        icon(this.editEl, "mdi:pencil");
        this.editEl.addEventListener("click", (ev) => { ev.stopPropagation(); editDashboard(this.root, this._hass); });
      }
      this.clockEl = el("span", "fix right", this.root);
      this.detail = el("div", "detail", host);
      this.pop = el("div", "pop", host);
      this.host = host;
      // The machines' detail closes with its « fermer » only; the clock and
      // « igor » open their own panels.
      // `tap: /a-page` opens that page (the homelab) instead of the detail.
      this.root.addEventListener("click", () => {
        var tap = this.config.tap ? String(this.config.tap) : "";
        // `tap: maison`: a page of this dashboard; `tap: /a/page` anywhere.
        if (tap) navigate(tap.charAt(0) === "/" ? tap : "/" + window.location.pathname.split("/")[1] + "/" + tap);
        else this.openDetail();
      });
      left.addEventListener("click", (ev) => { ev.stopPropagation(); this.togglePop("igor"); });
      this.clockEl.addEventListener("click", (ev) => { ev.stopPropagation(); this.togglePop("time"); });
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
    renderTabs() {
      if (!this.tabsEl) return;
      var root = lovelaceRoot();
      var views = root && root.lovelace && root.lovelace.config && root.lovelace.config.views;
      var parts = window.location.pathname.split("/");
      var key = parts[1] + "|" + parts[2] + "|" + (views ? views.length : 0);
      if (key === this.tabsKey) return;
      this.tabsKey = key;
      this.tabsEl.innerHTML = "";
      (views || []).forEach((v, i) => {
        if (v.subview || v.visible === false) return;
        var seg = String(v.path || i);
        var a = el("a", decodeURIComponent(parts[2] || "") === seg ? "on" : "", this.tabsEl, v.title || seg);
        a.addEventListener("click", () => { navigate("/" + parts[1] + "/" + seg); });
      });
      this.tabInSight();
    }
    // The open page's tab in sight when the tabs scroll (a phone, folded or not).
    tabInSight() {
      if (!this.tabsEl) return;
      requestAnimationFrame(() => {
        var t = this.tabsEl, on = t.querySelector("a.on");
        if (!on || t.scrollWidth <= t.clientWidth) return;
        var box = t.getBoundingClientRect(), r = on.getBoundingClientRect();
        t.scrollLeft = Math.max(0, t.scrollLeft + (r.left - box.left) - (box.width - r.width) / 2);
      });
    }
    clock() {
      var d = new Date();
      // A phone: the time alone, the tabs need the room.
      var narrow = window.innerWidth < (this.config.tabs === true ? 1100 : 760);
      this.clockEl.textContent = narrow ? hhmm(d) : d.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" }) + " · " + hhmm(d);
    }
    set hass(hass) {
      this._hass = hass;
      if (this.editEl) this.editEl.hidden = !isAdmin(hass);
      if (this.bellEl && !this.unbell && hass.connection) {
        this.waitingN = 0;
        this.unbell = watchPersistent(hass, (list) => { this.waitingN = list.length; this.showBell(); });
        // What was sent (administrators): the newest one now, then each one
        // as it goes out (the integration's nives_notification event).
        if (isAdmin(hass)) {
          newestSent(hass).then((at) => { this.sentAt = at; this.showBell(); });
          var stopped = false, unsub = null;
          try {
            hass.connection.subscribeEvents((ev) => { this.sentAt = (ev && ev.data && ev.data.at) || new Date().toISOString(); this.showBell(); }, "nives_notification")
              .then((u) => { if (stopped) u(); else unsub = u; }).catch(() => {});
          } catch (e) { /* an old Home Assistant: the dot on the next load only */ }
          this.onSeen = () => this.showBell();
          window.addEventListener("igor-notifications-seen", this.onSeen);
          var stopWatch = this.unbell;
          this.unbell = () => { stopWatch(); stopped = true; if (unsub) unsub(); window.removeEventListener("igor-notifications-seen", this.onSeen); };
        }
      }
      var igor = igorSensor(hass);
      this.igorEl.textContent = igor ? (IGOR_WORDS[igor.state] || igor.state) : "";
      this.renderTabs();
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
      if (this.pop.classList.contains("on") && now - (this.lastPop || 0) > 15000) { this.lastPop = now; this.renderPop(false); }
      if (this.paged && !this.pagedOnce) { this.pagedOnce = true; this.nextPage(true); }
    }
    // Pages: as many machines as the line holds, the next ones 8 s later.
    // One turn if the line is longer than its lane (at about 40 px a second).
    autoTurn() {
      clearTimeout(this.autoTimer);
      if (this.dead) return;
      // Another page shows (Home Assistant keeps this one aside): the turns
      // go on as soon as it is back, never stop for good.
      if (!this.root.isConnected || !this.lane.clientWidth) { this.autoTimer = setTimeout(() => this.autoTurn(), 2000); return; }
      var wide = this.segs.reduce((w, sg) => w + sg.offsetWidth, 0);
      var over = wide > this.lane.clientWidth + 2;
      this.copy2.forEach((sg) => { sg.hidden = !over; });
      var still = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (!over || still) { this.autoTimer = setTimeout(() => this.autoTurn(), 5000); return; }
      this.run.style.animation = "none";
      void this.run.offsetWidth;
      var secs = Math.max(6, wide / 40);
      this.run.style.animation = "roll " + secs.toFixed(1) + "s linear 1";
      this.autoTimer = setTimeout(() => { this.run.style.animation = "none"; this.autoTurn(); }, (secs + (Number(this.config.pause) || 10)) * 1000);
    }
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
    togglePop(kind) {
      if (this.pop.classList.contains("on") && this.popKind === kind) { this.closePop(); return; }
      this.popKind = kind;
      this.pop.className = "pop on " + (kind === "igor" ? "l" : "r");
      this.renderPop(true);
      clearTimeout(this.popClose);
      this.popClose = setTimeout(() => this.closePop(), 90000);
    }
    closePop() { this.pop.classList.remove("on"); clearTimeout(this.popClose); this.popKind = null; }
    renderPop(fresh) {
      var hass = this._hass, p = this.pop;
      if (!hass) return;
      p.innerHTML = "";
      var h = el("h4", "", p);
      var close = el("button", "close", null, "fermer");
      close.type = "button";
      close.addEventListener("click", (ev) => { ev.stopPropagation(); this.closePop(); });
      var btn = function (box, label, fn, on) {
        var b = el("button", on ? "on" : "", box, label);
        b.type = "button";
        b.addEventListener("click", function (ev) { ev.stopPropagation(); fn(); });
        return b;
      };
      var kv = function (rows) {
        var k = el("div", "kv", p);
        rows.forEach(function (r) { if (r && r[1] !== "" && r[1] != null) { el("span", "l", k, r[0]); el("span", "v", k, String(r[1])); } });
      };
      var c = (this.config.panels || {});
      if (this.popKind === "time") {
        var d = new Date();
        el("span", "", h, d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" }) + " · " + hhmm(d));
        h.appendChild(close);
        var sun = hass.states["sun.sun"], at = function (v) { var x = v ? new Date(v) : null; return x && !isNaN(x) ? hhmm(x) : ""; };
        var t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
        t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
        var week = Math.ceil(((t - new Date(Date.UTC(t.getUTCFullYear(), 0, 1))) / 86400000 + 1) / 7);
        kv([
          ["lever", sun ? at(sun.attributes.next_rising) : ""],
          ["coucher", sun ? at(sun.attributes.next_setting) : ""],
          ["semaine", String(week)]
        ].concat((c.time && c.time.entities || []).map(function (e) { return hass.states[e.entity] ? [e.name || e.entity, stateText(hass, e.entity)] : null; })));
        var timer = c.time && c.time.timer && hass.states[c.time.timer];
        if (timer) {
          el("div", "sub", p, "minuteur" + (timer.state === "active" && timer.attributes.finishes_at ? " · fin à " + at(timer.attributes.finishes_at) : timer.state === "paused" ? " · en pause" : ""));
          var tb = el("div", "btns", p), tid = c.time.timer;
          [5, 10, 20, 60].forEach(function (m) {
            btn(tb, m < 60 ? m + " min" : "1 h", function () { hass.callService("timer", "start", { duration: m === 60 ? "01:00:00" : "00:" + pad(m) + ":00" }, { entity_id: tid }); });
          });
          if (timer.state !== "idle") btn(tb, "arrêter", function () { hass.callService("timer", "cancel", {}, { entity_id: tid }); });
        }
        if (c.time && c.time.screen) {
          el("div", "sub", p, "écran");
          var sb = el("div", "btns", p);
          btn(sb, "mettre en veille", function () { hass.callService("nives", "screen", { action: "off" }); });
          btn(sb, "écran du PC", function () { hass.callService("nives", "screen", { action: "pc" }); });
        }
      } else {
        var igor = igorSensor(hass), ic = c.igor || {};
        el("span", "", h, "igor · " + (igor ? (IGOR_WORDS[igor.state] || igor.state) : "—"));
        h.appendChild(close);
        var rows = [];
        if (ic.satellite && hass.states[ic.satellite]) rows.push(["satellite", stateText(hass, ic.satellite)]);
        if (ic.assist && hass.states[ic.assist]) rows.push(["écoute", hass.states[ic.assist].state === "off" ? "coupée" : "ouverte"]);
        Object.keys(hass.states).filter(function (id) { return /^sensor\.igor_ear_gpu_(busy|load|temp)/.test(id); }).slice(0, 3).forEach(function (id) {
          rows.push([(hass.states[id].attributes.friendly_name || id).replace(/^igor ear gpu /i, "radeon "), stateText(hass, id)]);
        });
        kv(rows);
        this.stats = el("div", "kv", p);
        el("div", "sub", p, "dernières discussions");
        this.lastBox = el("div", "last", p);
        var b = el("div", "btns", p);
        btn(b, "ouvrir les discussions", function () { window.dispatchEvent(new CustomEvent("ll-custom", { detail: { igor_journal: true } })); });
        if (ic.satellite) btn(b, "parler", function () { talkToIgor(hass, ic.satellite, ic.start_message); });
        if (ic.assist && hass.states[ic.assist]) btn(b, hass.states[ic.assist].state === "off" ? "rouvrir l'écoute" : "couper l'écoute", function () { hass.callService("homeassistant", "toggle", {}, { entity_id: ic.assist }); }, hass.states[ic.assist].state !== "off");
        if (fresh || !this.journal) this.loadJournal(); else this.fillJournal();
      }
    }
    loadJournal() {
      var hass = this._hass;
      hass.callWS({ type: "call_service", domain: "nives", service: "journal", service_data: { limit: 50 }, return_response: true })
        .then((r) => { this.journal = (r && r.response && r.response.entries) || []; this.fillJournal(); })
        .catch(() => { this.journal = []; this.fillJournal(); });
    }
    fillJournal() {
      if (!this.lastBox || !this.journal) return;
      var today = new Date().toDateString(), n = 0, local = 0;
      this.journal.forEach(function (e) {
        if (new Date(e.at).toDateString() !== today) return;
        n++;
        if (!(e.trace || []).some(function (s) { return s.where === "online"; })) local++;
      });
      this.stats.innerHTML = "";
      [["aujourd'hui", n + " échanges"], ["en local seul", String(local)]].forEach((r) => { el("span", "l", this.stats, r[0]); el("span", "v", this.stats, r[1]); });
      this.lastBox.innerHTML = "";
      this.journal.slice(-4).reverse().forEach((e) => { el("div", "", this.lastBox, hhmm(new Date(e.at)) + " · « " + (e.words || "") + " »"); });
      if (!this.journal.length) el("div", "", this.lastBox, "aucune pour l'instant");
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
      close.addEventListener("click", (ev) => { ev.stopPropagation(); this.closeDetail(); });
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
    showBell() {
      if (!this.bellEl) return;
      var n = this.waitingN || 0;
      var fresh = !!this.sentAt && this.sentAt > seenSent();
      this.bellEl.hidden = !n && !fresh;
      this.bellN.textContent = n ? (n > 9 ? "9+" : String(n)) : "";
      this.bellDot.hidden = !fresh;
      this.tabInSight();
      this.bellEl.title = (n ? n + " à traiter" : "") + (n && fresh ? " · " : "") + (fresh ? "nouvelle notification" : "");
    }
    destroy() { this.dead = true; if (this.unbell) { this.unbell(); this.unbell = null; } clearInterval(this.pager); clearInterval(this.tick); clearTimeout(this.autoClose); clearTimeout(this.autoTimer); }
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
    ".hd::before { content: ''; display: inline-block; width: 5px; height: 5px; background: var(--igor-signal, #e5323b); margin-right: 7px; vertical-align: 1px; }",
    ".hd:first-child { padding-top: 0; }",
    ".slot { flex: none; min-width: 0; }",
    ".slot.grow { flex: 1 1 0; min-height: 60px; display: flex; flex-direction: column; }",
    ".slot.grow > * { flex: 1; min-height: 0; height: 100%; }",
    ".stack .cols { grid-template-columns: 1fr !important; }",
    ".stack .wall, .wall.stack { height: auto !important; }",
    ".stack .slot.grow { flex: none; min-height: 260px; }",
    // Stacked (a phone), the bar stays on top while the page scrolls.
    ".wall.stack { overflow: visible; } .wall.stack > .ticker { position: sticky; top: 0; z-index: 3; }",
    ".err { color: var(--bad); font-size: 12px; padding: 8px; }",
    ".band { flex: none; padding: 0 10px; }",
    ".band.above { padding-top: 10px; } .band.above:empty, .band.below:empty { display: none; }",
    ".band.below { padding-bottom: 10px; }"
  ].join("\n");

  // The opening: Igor's eye opens over the page the first time a wall shows
  // after the app starts (once per session; a touch skips it; `intro: false`
  // on the wall: never). Home Assistant's own logo comes before; this follows.
  var INTRO_CSS = [
    ".igor-intro { position: fixed; inset: 0; z-index: 2147483000; background: #07080a; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4vh; transition: opacity .6s ease; cursor: pointer; }",
    ".igor-intro.out { opacity: 0; pointer-events: none; }",
    ".igor-intro svg { width: min(24vw, 34vh); height: auto; overflow: visible; }",
    ".igor-intro .pillar { transform-origin: 128px 236px; transform: scaleY(0); animation: igor-in-grow .5s cubic-bezier(.2,.8,.2,1) .2s forwards; }",
    ".igor-intro .ring { stroke-dasharray: 302; stroke-dashoffset: 302; animation: igor-in-draw .6s ease-out .55s forwards; }",
    ".igor-intro .pupil { transform-origin: 128px 96px; transform: scale(0); animation: igor-in-pop .35s cubic-bezier(.3,1.6,.5,1) 1.05s forwards, igor-in-beat 1.2s ease-in-out 1.4s 2; }",
    ".igor-intro .word { color: #e9e4da; font: 500 clamp(18px, 4vh, 34px)/1 'JetBrains Mono', ui-monospace, monospace; letter-spacing: 1.4em; padding-left: 0.5em; opacity: 0; animation: igor-in-track .7s ease-out 1.15s forwards; }",
    // What IGOR stands for, typed under the name, initials in red.
    ".igor-intro .acr { margin-top: -2vh; min-height: 1.4em; color: #878c95; font: 400 min(clamp(9px, 1.6vh, 13px), 2.7vw)/1.4 'JetBrains Mono', ui-monospace, monospace; letter-spacing: .18em; white-space: nowrap; max-width: 94vw; overflow: hidden; }",
    ".igor-intro .acr i { font-style: normal; color: #e5323b; }",
    ".igor-intro .acr.typing::after { content: '\\25AE'; color: #e5323b; animation: igor-in-caret .5s steps(1) infinite; }",
    "@keyframes igor-in-caret { 50% { opacity: 0; } }",
    "@keyframes igor-in-grow { to { transform: scaleY(1); } }",
    "@keyframes igor-in-draw { to { stroke-dashoffset: 0; } }",
    "@keyframes igor-in-pop { to { transform: scale(1); } }",
    "@keyframes igor-in-beat { 50% { transform: scale(1.35); filter: drop-shadow(0 0 10px #e5323b); } }",
    "@keyframes igor-in-track { to { opacity: 1; letter-spacing: 0.5em; } }",
    "@media (prefers-reduced-motion: reduce) { .igor-intro * { animation-duration: .01s !important; animation-delay: 0s !important; } }"
  ].join("\n");
  function igorIntro() {
    try {
      if (window.sessionStorage.getItem("igor-intro")) return;
      window.sessionStorage.setItem("igor-intro", "1");
    } catch (e) { return; }  // no storage: no way to show it only once
    if (document.querySelector(".igor-intro")) return;
    var st = document.createElement("style");
    st.textContent = INTRO_CSS;
    document.head.appendChild(st);
    var o = document.createElement("div");
    o.className = "igor-intro";
    o.innerHTML = '<svg viewBox="0 0 256 256" aria-hidden="true"><rect class="pillar" x="107" y="20" width="44" height="216" fill="#e9e4da"/>' +
      '<circle class="ring" cx="128" cy="96" r="48" fill="#07080a" stroke="#e5323b" stroke-width="16"/><circle class="pupil" cx="128" cy="96" r="16" fill="#e5323b"/></svg>' +
      '<div class="word">IGOR</div><div class="acr"></div>';
    // « Intelligent Governance & Operations Relay », typed once the name is in.
    var acr = o.querySelector(".acr"), text = "INTELLIGENT GOVERNANCE & OPERATIONS RELAY", initials = [0, 12, 25, 36], n = 0, typer = null;
    setTimeout(function () {
      acr.classList.add("typing");
      typer = setInterval(function () {
        n++;
        acr.innerHTML = "";
        for (var k = 0; k < n; k++) {
          if (initials.indexOf(k) >= 0) { var b = document.createElement("i"); b.textContent = text[k]; acr.appendChild(b); }
          else acr.appendChild(document.createTextNode(text[k]));
        }
        if (n >= text.length) { clearInterval(typer); setTimeout(function () { acr.classList.remove("typing"); }, 500); }
      }, 24);
    }, 1750);
    var done = false;
    var end = function () {
      if (done) return;
      done = true;
      o.classList.add("out");
      clearInterval(typer);
      setTimeout(function () { o.remove(); st.remove(); }, 700);
    };
    o.addEventListener("pointerdown", end);
    document.body.appendChild(o);
    setTimeout(end, 3600);
  }

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
        // `maintenance: input_boolean.x`: this screen locks while it is on.
        if (this.config && typeof this.config.maintenance === "string") window.localStorage.setItem("igor-maintenance", this.config.maintenance);
        else if (this.config && this.config.maintenance === false) window.localStorage.removeItem("igor-maintenance");
        if (!this.config || this.config.home !== false) window.localStorage.setItem("igor-wall-home", window.location.pathname);
        if (this.config && this.config.return_after != null) window.localStorage.setItem("igor-wall-return", String(this.config.return_after));
      } catch (e) { /* no storage: no way back by itself */ }
      if (!this._resize) {
        this._resize = () => this.fit();
        window.addEventListener("resize", this._resize);
      }
      if (this.config && this.config.intro !== false) igorIntro();
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
      el("style", "", root, scaled(BASE + "\n" + BAR_CSS + "\n" + WALL_CSS));
      // `text: big` (or a factor, 1.3): every letter of the wall larger.
      var tx = this.config.text, f = tx === "big" ? 1.3 : tx === "huge" ? 1.45 : Number(tx) || 1;
      this.style.setProperty("--igor-text", String(f));
      this.style.setProperty("--igor-light", f > 1 ? "400" : "300");
      var wall = el("div", "wall", root);
      this.wall = wall;
      if (this.config.bar) this.bar = new IgorBar(wall, this.config.bar);
      var helpers = window.loadCardHelpers ? await window.loadCardHelpers() : null;
      // `above:` and `below:` cards across the whole width, around the columns.
      var band = (list, cls) => {
        if (!Array.isArray(list) || !list.length) return;
        var b = el("div", "band " + cls, wall);
        list.forEach((cfg) => {
          var card;
          try { card = helpers ? helpers.createCardElement(cfg) : document.createElement("hui-error-card"); }
          catch (e) { el("div", "err", b, String(e && e.message || e)); return; }
          b.appendChild(card);
          if (this._hass) card.hass = this._hass;
          this.children_.push(card);
        });
      };
      band(this.config.above, "above");
      var cols = el("div", "cols", wall);
      cols.style.gridTemplateColumns = this.config.columns.map(function (c) { return (Number(c.width) || 1) + "fr"; }).join(" ");
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
      band(this.config.below, "below");
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
        ".list { flex: 1; min-height: 0; overflow-x: hidden; overflow-y: auto; scrollbar-width: thin; }",
        ".e { display: grid; grid-template-columns: 5ch minmax(0, 1fr) auto; gap: 4px 10px; padding: 7px 0; border-bottom: 1px solid var(--line); }",
        ".e > .b { grid-column: 2 / 4; display: grid; gap: 4px; min-width: 0; }",
        ".q { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }",
        ".a { border-left: 2px solid var(--acc); padding-left: 8px; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }",
        ".r { font-size: 10px; border-radius: var(--igor-radius, 3px); padding: 1px 8px; border: 1px solid; white-space: nowrap; align-self: start; }",
        ".r.local { color: var(--okc); border-color: rgba(92,194,143,0.4); } .r.online { color: var(--wait); border-color: rgba(217,164,65,0.4); } .r.fail { color: var(--bad); border-color: rgba(224,103,95,0.4); }",
        ".chips { display: flex; flex-wrap: wrap; gap: 4px; }",
        ".chip { font-size: 11px; padding: 1px 7px; border-radius: var(--igor-radius, 3px); background: rgba(92,194,143,0.1); color: var(--okc); }",
        ".chip.fail { background: rgba(224,103,95,0.12); color: var(--bad); }",
        ".e:last-child { border-bottom: 0; }",
        ".h { color: var(--faint); }",
        ".q { color: var(--fg); }",

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
      var states = (this._hass && this._hass.states) || {};
      var nice = function (t) {
        return String(t || "")
          .replace(/\b([a-z_]+\.[a-z0-9_]+)\b/g, function (id) { var st = states[id]; return st && st.attributes && st.attributes.friendly_name ? st.attributes.friendly_name : id; })
          .replace(/\d{4}-\d\d-\d\dT[\d:.]+(Z|[+-]\d\d:\d\d)?/g, "activée")
          .replace(/\bturn[ _]on\b/g, "allumé").replace(/\bturn[ _]off\b/g, "éteint");
      };
      entries.slice().reverse().forEach((e) => {
        var t = e.trace || [];
        var failed = t.filter(function (s) { return /échec/.test(s.detail || ""); });
        var online = t.some(function (s) { return s.where === "online" && s.step !== "destinataire" && typeof s.ms === "number"; });
        var total = t.reduce(function (a, s) { return a + (typeof s.ms === "number" ? s.ms : 0); }, 0);
        var row = el("div", "e", this.list);
        el("span", "h", row, hhmm(new Date(e.at)));
        el("span", "q", row, e.words || "");
        el("span", "r " + (failed.length ? "fail" : online ? "online" : "local"), row,
          (failed.length ? "échec" : online ? "en ligne" : "local") + (total ? " · " + fr(total / 1000, 1) + " s" : ""));
        var b = el("div", "b", row);
        if (e.answer && !e.silent) el("div", "a", b, e.answer);
        if ((e.done && e.done.length) || failed.length) {
          var ch = el("div", "chips", b);
          (e.done || []).forEach(function (d) { el("span", "chip", ch, nice(d)); });
          failed.forEach(function (s) { el("span", "chip fail", ch, nice(String(s.detail).replace(/ · échec$/, "")) + " · échec"); });
        }
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
        ".list { flex: 1; min-height: 0; overflow-x: hidden; overflow-y: auto; scrollbar-width: thin; display: flex; flex-direction: column; }",
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
        ".gw span { border: 1px solid var(--line); border-radius: var(--igor-radius, 3px); padding: 0 8px; font-size: 11px; color: var(--dim); }",
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
    ".pill { font-size: 10.5px; border: 1px solid var(--line); color: var(--dim); border-radius: var(--igor-radius, 3px); padding: 1px 8px; cursor: pointer; background: none; font-family: inherit; }",
    ".pill.on { border-color: rgba(var(--ok), 0.45); color: var(--okc); }",
    ".pill:focus-visible { outline: 2px solid var(--acc); outline-offset: 2px; }"
  ].join("\n");
  function longPress(node, onTap, onHold) {
    var timer = null, held = false;
    node.addEventListener("pointerdown", function () { held = false; timer = setTimeout(function () { held = true; if (onHold) onHold(); }, 600); });
    ["pointerup", "pointerleave", "pointercancel"].forEach(function (e) { node.addEventListener(e, function () { clearTimeout(timer); }); });
    node.addEventListener("click", function () { if (!held && onTap) onTap(); });
  }
  // Home Assistant has no « stop » for a satellite: switching it off for a
  // moment (its « satellite enabled » switch, or « mute » on and off) ends
  // the conversation under way. The switch is found on the satellite's device.
  function cancelSatellite(hass, satellite, sw) {
    if (!sw) {
      var dev = hass.entities && hass.entities[satellite] && hass.entities[satellite].device_id;
      Object.keys(hass.entities || {}).some(function (id) {
        if (id.indexOf("switch.") !== 0 || !dev || hass.entities[id].device_id !== dev) return false;
        if (/satellite_enabled|mute/.test(id)) { sw = id; return true; }
        return false;
      });
    }
    if (!sw || !hass.states[sw]) return false;
    var mute = /mute/.test(sw);
    hass.callService("switch", mute ? "turn_on" : "turn_off", {}, { entity_id: sw });
    setTimeout(function () { hass.callService("switch", mute ? "turn_off" : "turn_on", {}, { entity_id: sw }); }, 1200);
    return true;
  }
  function navigate(path) {
    window.history.pushState(null, "", path);
    window.dispatchEvent(new CustomEvent("location-changed", { detail: { replace: false } }));
  }
  // The dashboard in edit mode, its top bar back (the wall's kiosk gives it
  // way while editing): Home Assistant's « Terminé » and its raw editor.
  // Administrators only; a YAML dashboard is edited in its file.
  function isAdmin(hass) { return !!(hass && hass.user && hass.user.is_admin); }
  function editDashboard(node, hass) {
    var say = function (msg) { node.dispatchEvent(new CustomEvent("hass-notification", { bubbles: true, composed: true, detail: { message: msg } })); };
    if (!isAdmin(hass)) { say("Seul un administrateur peut modifier ce tableau de bord."); return; }
    var root = lovelaceRoot();
    var ll = root && root.lovelace;
    if (ll && ll.mode === "yaml") { say("Ce tableau de bord est en YAML : modifie son fichier."); return; }
    if (ll && typeof ll.setEditMode === "function") { ll.setEditMode(true); window.scrollTo(0, 0); return; }
    window.location.assign(window.location.pathname + "?edit=1");
  }
  // Another dashboard by its name in the sidebar (« Ma banque ») or its
  // address: the address is looked up, so a button keeps working whatever
  // the dashboard's address is.
  function openDashboard(node, hass, name, view) {
    var want = String(name || "").trim().toLowerCase().replace(/^\//, "");
    var go = function (path) { navigate("/" + path + (view ? "/" + String(view).replace(/^\//, "") : "")); };
    if (!hass || !want) return;
    hass.callWS({ type: "lovelace/dashboards/list" }).then(function (list) {
      var d = (list || []).find(function (x) { return String(x.title || "").toLowerCase() === want || String(x.url_path || "").toLowerCase() === want; });
      if (d) go(d.url_path);
      else node.dispatchEvent(new CustomEvent("hass-notification", { bubbles: true, composed: true, detail: { message: "Tableau de bord introuvable : " + name } }));
    }).catch(function () { go(want); });
  }
  function service(hass, name, data, target) {
    // vacuum.start_pause is gone from Home Assistant: start, or pause if cleaning.
    if (name === "vacuum.start_pause" && target && typeof target.entity_id === "string") return vacuumTap(hass, target.entity_id);
    var parts = String(name || "").split(".");
    if (parts.length !== 2) return Promise.reject(new Error("service " + name));
    return hass.callService(parts[0], parts[1], data || {}, target);
  }

  // ----- igor-assist-card: Igor himself -----
  //   type: custom:igor-assist-card
  //   satellite: assist_satellite.living_room   # tap: talk to Igor
  //   assist: input_boolean.assist              # hold, or the pill: Igor on or off
  //   start_message: Je vous écoute...
  // « Parler »: the ear in the room (igor-ear) says « Je vous écoute » and
  // takes the next sentence with its own microphone, the one that hears the
  // room; without it (no igor-ear seen this last 3 minutes, an older Igor),
  // the satellite listens itself.
  function talkToIgor(hass, satellite, message) {
    var ear = hass.states["sensor.igor_ear"];
    var fresh = ear && ear.state === "on" && Date.now() - Date.parse(ear.last_updated) < 180000 &&
      (!ear.attributes.satellite || !satellite || ear.attributes.satellite === satellite);
    if (fresh && hass.services && hass.services.nives && hass.services.nives.listen) {
      return hass.callService("nives", "listen", Object.assign({ message: message || "Je vous écoute" }, satellite ? { satellite: satellite } : {}));
    }
    return hass.callService("assist_satellite", "start_conversation", { preannounce: false, start_message: message || "Je vous écoute..." }, { entity_id: satellite });
  }
  class IgorAssistCard extends IgorCard {
    setConfig(config) { this.config = config || {}; }
    getCardSize() { return 1; }
    build() {
      this.style(CARD_CSS + "\nha-card { border-color: #24394a; cursor: pointer; }\n.lens { width: 28px; height: 28px; display: block; }\n.lens svg { width: 100%; height: 100%; display: block; overflow: visible; }\n.lens .ring { transform-origin: 128px 96px; transition: stroke 0.3s; }\n.lens.off { filter: grayscale(1) brightness(0.55); }\n.lens.lis .ring { stroke: #59d0e0; animation: igor-eye 1.2s ease-in-out infinite; }\n.lens.lis .pupil { fill: #59d0e0; }\n.lens.think .ring { stroke: #e0a33a; animation: igor-eye 0.7s ease-in-out infinite; }\n.lens.think .pupil { fill: #e0a33a; }\n.lens.say .pupil { fill: #e9e4da; }\n@keyframes igor-eye { 50% { transform: scale(1.18); } }\n@media (prefers-reduced-motion: reduce) { .lens .ring { animation: none !important; } }\n.pn { font-size: 14px; }\nha-card.bigc { padding: 14px 16px; }\n.bigc .tile { grid-template-columns: 46px minmax(0, 1fr) auto auto; gap: 14px; }\n.bigc .lens { width: 46px; height: 46px; }\n.bigc .pn { font-size: 18px; }\n.mic { width: 50px; height: 50px; border-radius: 50%; border: 1px solid #24394a; background: none; color: var(--acc); display: grid; place-items: center; cursor: pointer; --mdc-icon-size: 26px; }");
      var card = el("ha-card", "", this.shadowRoot);
      var t = el("div", "tile", card);
      // Igor's eye: red at rest, cyan while it listens, amber while it thinks.
      this.lens = el("span", "lens", t);
      this.lens.innerHTML = '<svg viewBox="0 0 256 256" aria-hidden="true"><rect x="107" y="20" width="44" height="216" fill="#e9e4da"/><circle class="ring" cx="128" cy="96" r="48" fill="#07080a" stroke="#e5323b" stroke-width="16"/><circle class="pupil" cx="128" cy="96" r="16" fill="#e5323b"/></svg>';
      var mid = el("span", "", t);
      el("div", "pn", mid, this.config.name || "Igor");
      this.sub = el("div", "sn", mid);
      this.pill = el("button", "pill", t, "assist");
      this.pill.type = "button";
      this.pill.addEventListener("click", (ev) => { ev.stopPropagation(); this.toggle(); });
      longPress(card, () => this.talk(), () => this.toggle());
      if (this.config.size === "big") {
        // The tablet: a large eye and a microphone button to talk.
        card.classList.add("bigc");
        var mic = el("button", "mic", t);
        mic.type = "button";
        icon(mic, "mdi:microphone");
        mic.addEventListener("click", (ev) => { ev.stopPropagation(); this.talk(); });
      }
    }
    talk() {
      var c = this.config;
      if (!c.satellite || !this._hass) return;
      // A second press while Igor listens, thinks or answers cancels it.
      var sat = this._hass.states[c.satellite], igor = igorSensor(this._hass);
      var busy = (sat && ["listening", "processing", "responding"].indexOf(sat.state) >= 0) ||
        (igor && ["heard", "thinking", "answering"].indexOf(igor.state) >= 0);
      if (busy) { cancelSatellite(this._hass, c.satellite, c.cancel_switch); return; }
      talkToIgor(this._hass, c.satellite, c.start_message);
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
      this.lens.classList.toggle("lis", on && (sat === "listening" || (s === "heard" && igor.attributes.status === "listening")));
      this.lens.classList.toggle("think", on && (s === "thinking" || sat === "processing"));
      this.lens.classList.toggle("say", on && (s === "answering" || sat === "responding"));
      this.pill.classList.toggle("on", on);
    }
  }

  // ----- igor-buttons-card: a row of small buttons (size: big for a phone) -----
  //   type: custom:igor-buttons-card
  //   buttons:
  //     - { icon: mdi:monitor, name: PC, service: nives.screen, data: { action: pc } }
  //     - { icon: mdi:cog, name: Réglages, navigate: /config }    # a page of Home Assistant
  //     - { icon: mdi:menu, name: Menu, menu: true }               # Home Assistant's sidebar
  //     - { icon: mdi:bow-tie, name: Igor, journal: true }         # Igor's conversations, over the page
  //     - { icon: mdi:pencil, name: Modifier, edit: true }          # this dashboard in edit mode (administrators)
  //     - { icon: mdi:bank, name: Ma banque, dashboard: Ma banque }  # another dashboard by its sidebar name (view: its page)
  //     - icon: mdi:gas-station                  # a few numbers asked first, then the action
  //       name: Plein fait
  //       form:
  //         title: Plein
  //         total: €                             # « total » = the fields multiplied, in that unit
  //         fields:
  //           - { entity: input_number.fuel_litres, name: Litres, unit: L }
  //           - { entity: input_number.fuel_price, name: Prix du litre, unit: €/L }
  //       service: script.fuel_done              # or tap_action
  class IgorButtonsCard extends IgorCard {
    setConfig(config) {
      if (!config || !Array.isArray(config.buttons) || !config.buttons.length) throw new Error("igor-buttons-card: buttons est requis");
      this.config = config;
    }
    getCardSize() { return 1; }
    update(hass) {
      var admin = isAdmin(hass);
      this.shadowRoot.querySelectorAll("button[data-edit]").forEach(function (b) { b.hidden = !admin; });
    }
    build() {
      // size: big: buttons to touch on a phone, like the giant tiles (a large
      // icon, the name under it), three a row unless `columns` says.
      var big = this.config.size === "big";
      this.style(".row { display: grid; gap: 5px; }\nbutton { background: var(--card); border: 1px solid var(--line); border-radius: var(--igor-radius, 3px); color: var(--dim); font-family: inherit; font-size: 10.5px; padding: 6px 2px 5px; cursor: pointer; display: flex; flex-direction: column; align-items: center; gap: 2px; --mdc-icon-size: 18px; min-width: 0; }\nbutton ha-icon { color: var(--fg); }\nbutton span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }\nbutton.done { border-color: var(--acc); }\nbutton:focus-visible { outline: 2px solid var(--acc); outline-offset: 2px; }\n:host { display: block; }" + (big ? "\n" + "button.big { min-height: 92px; justify-content: center; gap: 10px; padding: 12px 4px; --mdc-icon-size: 34px; font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; border-radius: var(--igor-radius, 3px); }\nbutton.big span { white-space: normal; overflow-wrap: break-word; hyphens: auto; line-height: 1.2; text-align: center; }\nbutton.big:active { transform: scale(0.98); }\n.row.big { gap: 10px; }" : "") + "\n.eye { width: 22px; height: 22px; display: block; }\nbutton.big .eye { width: 34px; height: 34px; }\nbutton small { color: var(--faint); font-size: 10px; letter-spacing: 0.04em; text-transform: none; }\n.row.tall, .row.tall button { height: 100%; }\nbutton.big.hero .eye { width: 64px; height: 64px; }\nbutton.big.wide { flex-direction: row; justify-content: flex-start; min-height: 64px; padding: 10px 20px; gap: 16px; text-align: left; }\nbutton.big.wide span { text-align: left; font-size: 13px; color: var(--fg); white-space: nowrap; flex: none; }\nbutton.big.wide small { flex: 1; min-width: 0; text-align: right; font-size: 11px; }\nbutton.colored { border-color: var(--bc); } button.colored ha-icon, button.colored span { color: var(--bc); }\nbutton.big.hero span { font-size: 15px; letter-spacing: 0.14em; color: var(--fg); }");
      var row = el("div", "row" + (big ? " big" : "") + (this.config.fill ? " tall" : ""), this.shadowRoot);
      if (this.config.fill) row.style.gridAutoRows = "1fr";
      var cols = Number(this.config.columns) || (big ? Math.min(3, this.config.buttons.length) : this.config.buttons.length);
      row.style.gridTemplateColumns = "repeat(" + cols + ", minmax(0, 1fr))";
      this.config.buttons.forEach((b) => {
        // A lone big button (not `fill`) lies flat: a band across the screen.
        var wide = big && cols === 1 && !b.hero && !this.config.fill;
        var btn = el("button", (big ? "big" : "") + (b.hero ? " hero" : "") + (wide ? " wide" : "") + (b.color ? " colored" : ""), row);
        if (b.color) btn.style.setProperty("--bc", String(b.color));
        btn.type = "button";
        // eye: true: Igor's eye instead of an icon.
        if (b.eye) { var ey = el("span", "eye", btn); ey.innerHTML = EYE; }
        else icon(btn, b.icon || "mdi:gesture-tap");
        el("span", "", btn, b.name || "");
        if (b.secondary) el("small", "", btn, b.secondary);
        if (b.edit) { btn.dataset.edit = "1"; btn.hidden = !isAdmin(this._hass); }
        btn.addEventListener("click", () => {
          // form: the numbers asked first (each saved in its input_number), then the action.
          if (b.form && !btn._formOk) { this.openForm(b, btn); return; }
          btn._formOk = false;
          // tap_action: any Home Assistant action (url: app://…, assist…).
          if (b.tap_action) { haAction(this, b.form ? Object.assign({}, b.tap_action, { confirmation: undefined }) : b.tap_action); return; }
          if (b.edit) { editDashboard(this, this._hass); return; }
          if (b.journal) { window.dispatchEvent(new CustomEvent("ll-custom", { detail: { igor_journal: true } })); return; }
          if (b.dashboard) { openDashboard(this, this._hass, b.dashboard, b.view); return; }
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
    // The form over the page: one line per number, filled with what was entered
    // last time (the entity's value, or this screen's memory when the entity
    // was reset to 0 after use), « Valider » saves them and runs the action.
    openForm(b, btn) {
      var f = b.form || {}, hass = this._hass;
      if (!hass) return;
      if (!this.formCss) {
        this.formCss = true;
        el("style", "", this.shadowRoot, [
          ".fov { position: fixed; inset: 0; z-index: 2147482995; background: rgba(7,8,10,0.82); display: flex; align-items: center; justify-content: center; padding: 16px; box-sizing: border-box; }",
          ".fbox { width: min(460px, 100%); background: var(--bg); border: 1px solid var(--line); border-radius: var(--igor-radius, 3px); padding: 18px; display: grid; gap: 14px; color: var(--fg); box-shadow: 0 10px 40px rgba(0,0,0,0.6); }",
          ".fbox h4 { margin: 0; font-size: 13px; font-weight: 500; letter-spacing: 0.14em; text-transform: uppercase; color: var(--dim); display: flex; align-items: center; gap: 10px; --mdc-icon-size: 22px; } .fbox h4 ha-icon { color: var(--acc); }",
          ".fl { display: grid; gap: 6px; } .fl span { color: var(--dim); font-size: 12px; letter-spacing: 0.06em; }",
          ".fin { display: flex; align-items: center; border: 1px solid var(--line); border-radius: var(--igor-radius, 3px); background: var(--card); } .fin:focus-within { border-color: var(--acc); }",
          ".fin input { flex: 1; min-width: 0; background: none; border: 0; color: var(--fg); font: inherit; font-size: 26px; padding: 12px 14px; font-variant-numeric: tabular-nums; outline: none; }",
          ".fin u { text-decoration: none; color: var(--dim); padding: 0 14px; font-size: 15px; }",
          ".ftot { color: var(--dim); font-size: 14px; } .ftot b { color: var(--fg); font-size: 20px; font-weight: 500; margin-left: 6px; }",
          ".ferr { color: var(--bad); font-size: 13px; min-height: 1em; }",
          ".fbtns { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }",
          ".fbtns button { min-height: 56px; border-radius: var(--igor-radius, 3px); border: 1px solid var(--line); background: var(--card); color: var(--fg); font: inherit; font-size: 14px; letter-spacing: 0.08em; text-transform: uppercase; cursor: pointer; display: flex; align-items: center; justify-content: center; gap: 10px; --mdc-icon-size: 22px; }",
          ".fbtns button.ok { border-color: var(--acc); color: var(--acc); }"
        ].join("\n"));
      }
      var ov = el("div", "fov", this.shadowRoot);
      var box = el("div", "fbox", ov);
      var h = el("h4", "", box); icon(h, b.icon || "mdi:form-textbox"); el("span", "", h, f.title || b.name || "");
      var mem = function (id) { try { return window.localStorage.getItem("igor-form:" + id); } catch (e) { return null; } };
      var inputs = (f.fields || []).map((fd) => {
        var st = fd.entity && hass.states[fd.entity], a = (st && st.attributes) || {};
        var cur = st ? parseFloat(st.state) : NaN;
        var start = !isNaN(cur) && cur > 0 ? cur : parseFloat(mem(fd.entity));
        var lab = el("label", "fl", box);
        el("span", "", lab, fd.name || a.friendly_name || fd.entity);
        var wrap = el("div", "fin", lab);
        var inp = el("input", "", wrap);
        inp.type = "text"; inp.inputMode = "decimal"; inp.autocomplete = "off";
        inp.value = isNaN(start) ? "" : String(start).replace(".", ",");
        el("u", "", wrap, fd.unit || a.unit_of_measurement || "");
        return { fd: fd, inp: inp, min: a.min != null ? Number(a.min) : null, max: a.max != null ? Number(a.max) : null };
      });
      var num = (x) => parseFloat(String(x.inp.value).replace(/\s/g, "").replace(",", "."));
      var tot = f.total ? el("div", "ftot", box) : null;
      var showTot = () => {
        if (!tot) return;
        var v = inputs.reduce((acc, x) => acc * num(x), 1);
        tot.innerHTML = ""; tot.appendChild(document.createTextNode("total"));
        el("b", "", tot, isNaN(v) ? "—" : fr(v, 2) + " " + (f.total === true ? "" : f.total));
      };
      inputs.forEach((x) => x.inp.addEventListener("input", showTot));
      showTot();
      var err = el("div", "ferr", box);
      var bt = el("div", "fbtns", box);
      var no = el("button", "", bt); no.type = "button"; icon(no, "mdi:close"); el("span", "", no, "Annuler");
      var ok = el("button", "ok", bt); ok.type = "button"; icon(ok, "mdi:check"); el("span", "", ok, "Valider");
      var close = () => ov.remove();
      no.addEventListener("click", close);
      ov.addEventListener("click", (ev) => { if (ev.target === ov) close(); });
      ok.addEventListener("click", async () => {
        for (var i = 0; i < inputs.length; i++) {
          var x = inputs[i], v = num(x);
          if (isNaN(v) || v <= 0 || (x.min != null && v < x.min) || (x.max != null && v > x.max)) {
            err.textContent = (x.fd.name || "valeur") + " : un nombre" + (x.max != null ? " entre " + fr(Math.max(x.min || 0, 0), 2) + " et " + fr(x.max, 2) : "") + ".";
            x.inp.focus();
            return;
          }
        }
        ok.disabled = true;
        try {
          for (var j = 0; j < inputs.length; j++) {
            var y = inputs[j], val = num(y);
            try { window.localStorage.setItem("igor-form:" + y.fd.entity, String(val)); } catch (e) { /* no storage */ }
            var dom = String(y.fd.entity).split(".")[0];
            await hass.callService(dom === "input_text" ? "input_text" : dom === "number" ? "number" : "input_number", "set_value", { entity_id: y.fd.entity, value: dom === "input_text" ? String(val) : val });
          }
        } catch (e) { err.textContent = "Enregistrement impossible : " + (e && e.message || e); ok.disabled = false; return; }
        close();
        btn._formOk = true;
        btn.click();
      });
      setTimeout(() => { if (inputs[0]) { inputs[0].inp.focus(); inputs[0].inp.select(); } }, 50);
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
        ".rng { height: 5px; border-radius: var(--igor-radius, 3px); background: var(--track); position: relative; }",
        ".rng i { position: absolute; top: 0; bottom: 0; border-radius: var(--igor-radius, 3px); background: linear-gradient(90deg, #6cc4f5, #5cc28f 55%, #d9a441); }",
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
      if (this.config.clock === false) clock.hidden = true;
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
    // The forecasts by the service, when the subscription brings none (some
    // frontends and integrations), then every 30 minutes.
    poll() {
      var hass = this._hass, id = this.config.entity;
      if (!hass) return;
      ["hourly", "daily"].forEach((type) => {
        if (this.gotSub && this.gotSub[type]) return;
        hass.callWS({ type: "call_service", domain: "weather", service: "get_forecasts", service_data: { type: type }, target: { entity_id: id }, return_response: true })
          .then((r) => {
            var f = r && r.response && r.response[id] && r.response[id].forecast;
            if (f && f.length) { this[type] = f; this.draw(); }
          }).catch(function () { /* that kind of forecast is not offered */ });
      });
    }
    subscribe(hass) {
      if (!this.pollTimer) {
        this.pollTimer = setTimeout(() => this.poll(), 5000);
        this.pollEvery = setInterval(() => this.poll(), 1800000);
      }
      if (this.subs || !hass.connection) return;
      this.subs = [];
      this.gotSub = this.gotSub || {};
      ["hourly", "daily"].forEach((type) => {
        hass.connection.subscribeMessage((msg) => {
          var f = (msg && msg.forecast) || [];
          if (f.length) { this.gotSub[type] = true; this[type] = f; this.draw(); }
        },
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
  // The alarm clock in front of everything (Alarm Clocks' own card: its time,
  // its days, on or off), with « Répéter » / « Arrêter » while it rings.
  // One window for the page, in the document itself (never cut by a card).
  var ALARM_CSS = [
    ".igor-alarm-pop { position: fixed; inset: 0; z-index: 2147482995; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; }",
    ".igor-alarm-pop[hidden] { display: none; }",
    ".igor-alarm-pop .box { width: min(560px, 94vw); max-height: 92vh; overflow: auto; background: #0d1014; border: 1px solid rgba(233,228,218,0.14); border-radius: var(--igor-radius, 3px); padding: 12px; box-sizing: border-box; }",
    ".igor-alarm-pop .ring { display: flex; gap: 10px; margin-bottom: 10px; } .igor-alarm-pop .ring[hidden] { display: none; }",
    ".igor-alarm-pop button { flex: 1; background: none; border: 1px solid rgba(233,228,218,0.18); border-radius: var(--igor-radius, 3px); color: #e9e4da; font: 13px/1 'JetBrains Mono', monospace; letter-spacing: 0.08em; text-transform: uppercase; padding: 14px; cursor: pointer; }",
    ".igor-alarm-pop .ring button { border-color: rgba(217,164,65,0.6); color: #d9a441; font-size: 15px; padding: 18px; }",
    ".igor-alarm-pop .close { display: block; flex: none; margin: 10px 0 0 auto; padding: 8px 18px; color: #8a929b; }"
  ].join("\n");
  var alarmPop = null;
  async function alarmWindow(node, deviceId, extra) {
    var hass = node._hass || node.hass;
    if (!hass) return;
    if (!alarmPop) {
      var st = document.createElement("style");
      st.textContent = ALARM_CSS;
      document.head.appendChild(st);
      var pop = document.createElement("div");
      pop.className = "igor-alarm-pop";
      pop.hidden = true;
      var box = el("div", "box", pop);
      var ring = el("div", "ring", box);
      var slot = el("div", "", box);
      var close = el("button", "close", box, "fermer");
      close.type = "button";
      alarmPop = { pop: pop, ring: ring, slot: slot, cards: {}, device: null, node: null, timer: null };
      var shut = function () { pop.hidden = true; clearInterval(alarmPop.timer); alarmPop.timer = null; };
      close.addEventListener("click", shut);
      pop.addEventListener("click", function (ev) { if (ev.target === pop) shut(); });
      [["snooze", "Répéter"], ["dismiss", "Arrêter"]].forEach(function (a) {
        var b = el("button", "", ring, a[1]);
        b.type = "button";
        b.addEventListener("click", function () {
          var h = alarmPop.node && (alarmPop.node._hass || alarmPop.node.hass), ids = h && alarmEntities(h, alarmPop.device);
          if (ids && ids[a[0]]) h.callService("button", "press", {}, { entity_id: ids[a[0]] });
          if (a[0] === "dismiss") shut();
        });
      });
      document.body.appendChild(pop);
    }
    var A = alarmPop;
    A.device = deviceId; A.node = node;
    var card = A.cards[deviceId];
    if (!card && window.loadCardHelpers) {
      var helpers = await window.loadCardHelpers();
      card = A.cards[deviceId] = helpers.createCardElement(Object.assign({ type: "custom:alarm-clocks-card", devices: [{ device_id: deviceId, expanded: true }],
        show_settings: false, show_days: true, show_next_alarm: true, expandable: false }, extra || {}));
    }
    A.slot.innerHTML = "";
    if (card) A.slot.appendChild(card);
    else el("div", "", A.slot, "La carte de l'intégration Alarm Clocks n'est pas chargée.");
    var refresh = function () {
      var h = A.node && (A.node._hass || A.node.hass);
      if (!h) return;
      if (card) card.hass = h;
      var ids = alarmEntities(h, A.device), s = ids.state && h.states[ids.state];
      A.ring.hidden = !(s && (s.state === "ringing" || s.state === "snoozed"));
    };
    refresh();
    clearInterval(A.timer);
    A.timer = setInterval(refresh, 1000);
    A.pop.hidden = false;
  }
  class IgorAlarmCard extends IgorCard {
    setConfig(config) {
      if (!config || !config.device_id) throw new Error("igor-alarm-card: device_id est requis");
      this.config = config;
    }
    getCardSize() { return 1; }
    build() {
      this.style(CARD_CSS + "\nha-card { cursor: pointer; }\n.acts { display: flex; gap: 6px; margin-top: 6px; }\n.acts button { flex: 1; background: none; border: 1px solid var(--line); border-radius: var(--igor-radius, 3px); color: var(--fg); font-family: inherit; font-size: 11px; padding: 4px; cursor: pointer; }\n.acts[hidden] { display: none; }\n.pop { position: fixed; inset: 0; z-index: 2147482995; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; }\n.pop[hidden] { display: none; }\n.box { width: min(520px, 92vw); max-height: 90vh; overflow: auto; background: var(--bg); border: 1px solid var(--line); border-radius: var(--igor-radius, 3px); padding: 10px; }\n.box .close { display: block; margin: 8px 0 0 auto; background: none; border: 1px solid var(--line); color: var(--dim); font-family: inherit; padding: 4px 12px; border-radius: var(--igor-radius, 3px); cursor: pointer; }");
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
      this.tick = setInterval(() => { if (this._hass) this.update(this._hass, null); }, 30000);
    }
    open() { alarmWindow(this, this.config.device_id, this.config.full); }
    update(hass, prev) {
      if (!this.ids || (prev && prev.entities !== hass.entities)) this.ids = alarmEntities(hass, this.config.device_id);
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

  // What a tile shows of its entity, whatever it is: lit or not, its kind
  // (its colour), its motion, and a word on what it does. Every state a thing
  // can be in shows: a projector on its menu, a speaker playing, a fan
  // turning, a shutter going up, a thermostat heating, a door open, a scene
  // just set, a script running, a thing gone (unavailable).
  var MEDIA_WORDS = { on: "allumé", idle: "prêt", paused: "en pause", buffering: "chargement…", playing: "en lecture", standby: "veille" };
  var SENSOR_ON = { door: "ouverte", window: "ouverte", opening: "ouvert", garage_door: "ouverte", motion: "mouvement", occupancy: "occupé",
    presence: "présent", plug: "branché", power: "sous tension", running: "en marche", light: "lumière", sound: "son", connectivity: "connecté",
    lock: "déverrouillé", moving: "en mouvement", update: "mise à jour", battery_charging: "en charge" };
  // A vacuum's many words (Dreame: sweeping, mopping…) in four.
  function vacKind(s) {
    s = String(s || "");
    if (s === "error" || /error|stuck|fault/.test(s)) return "error";
    if (/return/.test(s)) return "returning";
    if (/pause/.test(s)) return "paused";
    if (/clean|sweep|mop|vacuum|zone|segment|room|spot|working|auto/.test(s)) return "cleaning";
    return "";
  }
  // A media player often says « off » while its device is on (a Cast
  // speaker, a Shield's Cast entity when nothing is cast): its device's
  // other entities tell (an Android TV remote, its other media player), or
  // `power:` on the tile names one.
  var MEDIA_ON = function (s) { return ["off", "standby", "unknown", "unavailable", ""].indexOf(String(s || "")) < 0; };
  function mediaPower(hass, t) {
    var ids = [].concat(t.power || []), reg = hass.entities || {}, me = reg[t.entity], obj = String(t.entity).split(".")[1] || "";
    if (!t.power) {
      var dev = me && me.device_id;
      var words = obj.split("_").filter(function (w) { return w.length >= 4 && ["salon", "chambre", "cuisine", "media", "player", "enceinte", "android"].indexOf(w) < 0; });
      Object.keys(hass.states).forEach(function (id) {
        if (id === t.entity) return;
        var d = domainOf(id);
        if (d !== "remote" && d !== "media_player") return;
        var r = reg[id];
        if ((dev && r && r.device_id === dev) || (d === "remote" && words.some(function (w) { return id.indexOf(w) >= 0; }))) ids.push(id);
      });
    }
    for (var i = 0; i < ids.length; i++) {
      var o = hass.states[ids[i]];
      if (o && MEDIA_ON(o.state)) return o;
    }
    return null;
  }
  var OFF_ICONS = { "mdi:fan": "mdi:fan-off", "mdi:projector": "mdi:projector-off", "mdi:speaker": "mdi:speaker-off", "mdi:television-play": "mdi:television-off",
    "mdi:television": "mdi:television-off", "mdi:lightbulb": "mdi:lightbulb-off", "mdi:ceiling-light": "mdi:ceiling-light-outline", "mdi:robot-vacuum": "mdi:robot-vacuum-off" };
  var ON_ICONS = { "mdi:speaker": "mdi:speaker-play", "mdi:robot-vacuum": "mdi:robot-vacuum" };
  var VAC_WORDS = { sweeping: "aspire", mopping: "lave", sweeping_and_mopping: "aspire et lave", cleaning: "nettoie", charging: "en charge",
    charging_completed: "chargé", washing: "lave la serpillière", drying: "sèche", idle: "à l'arrêt", building: "cartographie", zoned_cleaning: "nettoie une zone",
    segment_cleaning: "nettoie une pièce", room_cleaning: "nettoie une pièce", spot_cleaning: "nettoie un point", paused: "en pause", returning: "rentre…", docked: "à la base" };
  function prettyState(hass, id) {
    var st = hass.states[id];
    if (st && domainOf(id) === "vacuum" && VAC_WORDS[st.state]) return VAC_WORDS[st.state] + (st.attributes.battery_level != null ? " · " + st.attributes.battery_level + " %" : "");
    if (st && !STATE_WORDS[st.state] && hass.formatEntityState) { try { return hass.formatEntityState(st); } catch (e) { /* the raw word */ } }
    return stateText(hass, id);
  }
  var PROBLEMS = ["problem", "safety", "smoke", "gas", "carbon_monoxide", "moisture", "tamper", "heat", "cold", "battery", "vibration"];
  function tileLive(hass, t, st, ctx) {
    var d = domainOf(t.entity), s = st ? st.state : "", a = (st && st.attributes) || {};
    var out = { on: false, kind: "switch", motion: "", text: "", gone: !st || s === "unavailable", alarm: false };
    if (out.gone) { out.text = st ? "indisponible" : "introuvable"; return out; }
    // A tile that calls a service on its entity (a shutter's « Ouvrir »,
    // a vacuum's « Base »): lit in its state, moving while it gets there.
    if (t.service) {
      out.kind = d === "cover" ? "cover" : d === "vacuum" ? "vac" : "switch";
      var sv = t.service.split(".")[1] || "";
      var moving = s === "opening" || s === "closing";
      var vk = d === "vacuum" ? vacKind(s) : "";
      var busy = (sv === "open_cover" && s === "opening") || (sv === "close_cover" && s === "closing") || (sv === "stop_cover" && moving)
        || (sv === "return_to_base" && vk === "returning") || (sv === "start_pause" && (vk === "cleaning" || vk === "paused"));
      out.on = busy || Boolean(t.lit && (s === t.lit || (d === "vacuum" && t.lit === "cleaning" && vk === "cleaning")));
      if (busy) out.motion = s === "opening" ? "up" : s === "closing" ? "down" : vk === "returning" ? "rock" : vk === "cleaning" ? "spin" : "pulse";
      if (sv === "start_pause") { out.vac = vk; out.alarm = vk === "error"; }
      out.text = busy ? (s === "opening" ? "s'ouvre…" : s === "closing" ? "se ferme…" : vk === "returning" ? "rentre…" : vk === "paused" ? "en pause" : vk === "cleaning" ? prettyState(hass, t.entity) : "")
        : out.on ? prettyState(hass, t.entity) : "";
      // A vacuum always says where it is (« à la base · 100 % », « aspire »…).
      if (d === "vacuum" && sv !== "return_to_base") { out.always = true; if (!out.text) out.text = sv === "return_to_base" || !t.lit ? "" : prettyState(hass, t.entity); if (vk === "error") out.text = "bloqué · " + prettyState(hass, t.entity); }
      if (sv === "stop_cover" && moving) out.text = "toucher pour arrêter";
      return out;
    }
    if (d === "light") {
      out.kind = "light"; out.on = s === "on";
      out.rgb = out.on ? lightRgb(st) : null;
      out.text = out.on ? (a.brightness != null ? Math.round(a.brightness / 2.55) + " %" : "allumée") : "";
    } else if (d === "media_player") {
      out.kind = "media"; out.on = MEDIA_ON(s); out.always = true;
      var pw = out.on ? null : mediaPower(hass, t);
      if (pw) { out.on = true; s = pw.state === "on" || pw.state === "idle" || domainOf(pw.entity_id) === "remote" ? "on" : pw.state; a = Object.assign({}, pw.attributes, a.source ? { source: a.source } : {}); }
      out.motion = s === "playing" ? "beat" : s === "buffering" ? "pulse" : out.on ? "glow" : "";
      var what = a.media_title ? a.media_title + (a.media_artist ? " · " + a.media_artist : "") : "";
      out.text = !out.on ? "" : s === "playing" ? (what || a.app_name || a.source || "en lecture")
        : s === "paused" ? "en pause" + (what ? " · " + what : "")
        : a.app_name || a.current_activity || a.source || MEDIA_WORDS[s] || s;
      if (out.on && a.volume_level != null && a.is_volume_muted) out.text += " · muet";
      if (!out.on) out.text = s === "standby" ? "en veille" : "éteint";
    } else if (d === "fan") {
      out.kind = "fan"; out.on = s === "on"; out.always = true;
      var pct = a.percentage != null ? Number(a.percentage) : 50;
      out.motion = out.on ? "spin" : "";
      out.spin = out.on ? Math.max(0.5, 2.6 - (pct || 50) / 50) : 0;
      out.text = out.on ? (a.percentage != null ? "vitesse " + pct + " %" : "en marche") + (a.oscillating ? " · oscille" : "") + (a.preset_mode ? " · " + a.preset_mode : "") : "arrêté";
    } else if (d === "cover") {
      out.kind = "cover"; out.on = s === "open" || s === "opening" || s === "closing";
      out.motion = s === "opening" ? "up" : s === "closing" ? "down" : "";
      out.text = s === "opening" ? "s'ouvre…" : s === "closing" ? "se ferme…" : s === "open" ? (a.current_position != null && a.current_position < 100 ? "ouvert à " + a.current_position + " %" : "ouvert") : "";
    } else if (d === "vacuum") {
      var vk2 = vacKind(s);
      out.kind = "vac"; out.vac = vk2; out.on = vk2 === "cleaning" || vk2 === "returning" || vk2 === "paused"; out.always = true;
      out.alarm = vk2 === "error"; out.motion = { cleaning: "spin", returning: "rock", paused: "breathe" }[vk2] || "";
      out.text = prettyState(hass, t.entity);
    } else if (d === "climate" || d === "water_heater") {
      var mode = d === "climate" ? s : a.operation_mode || s;
      out.on = mode && mode !== "off";
      out.kind = "climate";
      var act = a.hvac_action || "";
      out.rgb = !out.on ? null : /cool/.test(act || mode) ? [108, 196, 245] : /heat/.test(act || mode) ? [232, 128, 64] : /dry|fan/.test(act || mode) ? [89, 208, 224] : [92, 194, 143];
      out.motion = /heating|cooling|drying|fan/.test(act) ? "breathe" : out.on ? "glow" : "";
      var target = a.temperature != null ? String(a.temperature).replace(".", ",") + " °" : "";
      out.text = out.on ? ({ heating: "chauffe", cooling: "refroidit", idle: "en attente", drying: "déshumidifie", fan: "ventile" }[act] || stateText(hass, t.entity)) + (target ? " · " + target : "") : "";
    } else if (d === "lock") {
      out.kind = "switch"; out.on = s === "unlocked" || s === "open" || s === "opening" || s === "unlocking";
      out.alarm = s === "jammed";
      out.motion = /ing$/.test(s) ? "pulse" : out.on ? "glow" : "";
      out.text = { unlocked: "déverrouillée", open: "ouverte", opening: "s'ouvre…", unlocking: "se déverrouille…", locking: "se verrouille…", jammed: "bloquée" }[s] || "";
    } else if (d === "binary_sensor") {
      var dc = String(a.device_class || "");
      if (PROBLEMS.indexOf(dc) >= 0) { out.alarm = s === "on"; out.text = out.alarm ? "alerte" : ""; }
      else if (dc && s === "on") { out.on = true; out.kind = "sensor"; out.motion = /motion|occupancy|presence|sound|moving/.test(dc) ? "pulse" : "glow"; out.text = SENSOR_ON[dc] || "actif"; }
      // Without a kind (a train line's sensor): its news is not a colour.
    } else if (d === "scene") {
      // One ambiance at a time: the scene set last, unless « Tout éteindre »
      // (a reset scene, never shown) or a mode (Cinéma) came after it, or
      // every light of the card is off since.
      out.kind = "scene";
      out.on = Boolean(ctx && ctx.applied === t.entity && !isResetScene(t));
      out.motion = "";
      out.text = out.on ? "appliquée" : "";
    } else if (d === "script") {
      out.kind = "scene"; out.on = s === "on"; out.motion = out.on ? "spin" : ""; out.text = out.on ? "en cours…" : "";
    } else if (d === "alarm_control_panel") {
      out.kind = "switch"; out.on = s !== "disarmed";
      out.alarm = s === "triggered"; out.motion = s === "arming" || s === "pending" ? "pulse" : out.on ? "glow" : "";
      out.text = stateText(hass, t.entity);
    } else if (d === "timer") {
      out.on = s === "active" || s === "paused"; out.motion = s === "active" ? "pulse" : ""; out.text = out.on ? stateText(hass, t.entity) : "";
    } else if (d === "person" || d === "device_tracker") {
      out.kind = "sensor"; out.on = s === "home"; out.text = stateText(hass, t.entity);
    } else {
      // switch, input_boolean, automation, siren, humidifier, remote…
      out.on = ["on", "open", "home", "active"].indexOf(s) >= 0;
      out.motion = out.on ? "glow" : "";
      out.text = out.on ? (d === "remote" ? a.current_activity || "allumée" : "activé") : "";
    }
    if (t.invert) { out.on = !out.on; out.motion = ""; }
    return out;
  }
  // « Tout éteindre »: a scene that turns things off is no ambiance.
  function isResetScene(t) {
    return t.reset === true || (t.reset !== false && (/(eteindre|eteint|_off$|^scene\.off|tout_eteindre|all_off)/.test(String(t.entity)) || t.icon === "mdi:power"));
  }
  function isMode(t) {
    return t.ambiance === true || (t.ambiance !== false && domainOf(t.entity) === "input_boolean" && /^input_boolean\.mode_/.test(String(t.entity)));
  }
  // Which scene of the card is the ambiance now (or none).
  function appliedScene(hass, tiles) {
    var best = null, bestAt = 0, resetAt = 0, lightsOn = false, hasLights = false;
    tiles.forEach(function (t) {
      if (t.service || !t.entity) return;
      var st = hass.states[t.entity], d = domainOf(t.entity);
      if (!st) return;
      if (d === "light") { hasLights = true; if (st.state === "on") lightsOn = true; }
      var at = d === "scene" ? Date.parse(st.state) : NaN;
      if (d === "scene" && !isNaN(at)) {
        if (isResetScene(t)) resetAt = Math.max(resetAt, at);
        else if (at > bestAt) { bestAt = at; best = t.entity; }
      }
      if (isMode(t) && st.state === "on") resetAt = Math.max(resetAt, Date.parse(st.last_changed) || 0);
    });
    if (!best || bestAt <= resetAt) return null;
    if (hasLights && !lightsOn) return null;
    return best;
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
    ".act { width: 26px; height: 24px; border: 1px solid var(--line); border-radius: var(--igor-radius, 3px); background: none; color: var(--dim); display: inline-grid; place-items: center; cursor: pointer; padding: 0; --mdc-icon-size: 15px; }",
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
        ".tool { border: 1px solid var(--line); border-radius: var(--igor-radius, 3px); background: none; color: var(--dim); font-family: inherit; font-size: 11px; padding: 3px 9px; cursor: pointer; display: flex; gap: 5px; align-items: center; --mdc-icon-size: 14px; }",
        ".tool.armed { background: rgba(224, 103, 95, 0.22); color: #ffb3b3; border-color: var(--bad); }",
        ".list { flex: 1; min-height: 0; overflow-y: auto; }",
        ".ct { display: grid; grid-template-columns: minmax(0, 1fr) 10ch 6ch 6ch auto; gap: 10px; align-items: center; padding: 6px 0; border-bottom: 1px dashed var(--line); font-variant-numeric: tabular-nums; }",
        ".ct .n { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
        ".ct .n .i { display: block; color: var(--dim); font-size: 10.5px; margin-left: 14px; overflow: hidden; text-overflow: ellipsis; }",
        ".ct .v { text-align: right; color: var(--dim); font-size: 11px; white-space: nowrap; }",
        ".dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--okc); margin-right: 7px; vertical-align: 1px; }",
        ".dot.off { background: var(--bad); } .dot.pause { background: var(--wait); }",
        ".badge { font-size: 9.5px; border: 1px solid rgba(217, 164, 65, 0.5); color: var(--wait); border-radius: var(--igor-radius, 3px); padding: 0 6px; margin-left: 6px; cursor: pointer; background: none; font-family: inherit; }",
        ".hid { color: var(--faint); font-size: 10.5px; padding-top: 5px; flex: none; }",
        ".i2 { display: none; }",
        "@media (max-width: 600px) { .ct { grid-template-columns: minmax(0, 1fr) auto; } .ct .v { display: none; } .ct .n .i2 { display: block; color: var(--dim); font-size: 10.5px; margin-left: 14px; } .sum b { font-size: 13px; } }"
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
        el("span", "i2" + (up ? "" : " bad"), n, up ? fr(num(hass.states[c.cpu]), 1) + " % · " + sizeText(hass.states[c.mem]) : WORDS[st] || st);
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
        ".foot { color: var(--dim); font-size: 11px; padding-top: 7px; flex: none; }",
        "@media (max-width: 600px) { .vm { grid-template-columns: minmax(0, 1fr) 54px 74px; gap: 10px; } .vm .x { display: none; } .vm .cell .l { display: none; } .vm .cell .v { font-size: 11px; white-space: nowrap; } }"
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

  // ===== cards for the tablet and the phone =====
  var STATE_WORDS = {
    on: "allumé", off: "éteint", open: "ouvert", closed: "fermé", opening: "s'ouvre", closing: "se ferme",
    playing: "en lecture", paused: "en pause", idle: "en veille", standby: "en veille", buffering: "chargement",
    docked: "à la base", cleaning: "nettoie", returning: "retour à la base", error: "erreur",
    home: "présent", not_home: "absent", unavailable: "indisponible", unknown: "—", armed_away: "armée", disarmed: "désarmée"
  };
  function domainOf(id) { return String(id || "").split(".")[0]; }
  function stateText(hass, id) {
    var st = hass.states[id];
    if (!st) return "—";
    var d = domainOf(id), s = st.state, a = st.attributes || {};
    if (d === "scene" || d === "script") return d === "scene" ? "scène" : "script";
    if (d === "light" && s === "on" && a.brightness != null) return Math.round(a.brightness / 2.55) + " %";
    if (d === "fan" && s === "on" && a.percentage != null) return a.percentage + " %";
    if (d === "cover" && a.current_position != null && s !== "closed") return (STATE_WORDS[s] || s) + " · " + a.current_position + " %";
    if (d === "vacuum" && a.battery_level != null) return (STATE_WORDS[s] || s) + " · " + a.battery_level + " %";
    if (d === "media_player" && s === "playing" && (a.media_title || a.media_artist)) return a.media_title || a.media_artist;
    if (/^\d{4}-\d\d-\d\d[T ]\d/.test(s)) { var t = new Date(s.replace(" ", "T")); if (!isNaN(t)) return hhmm(t); }
    var v = num(st);
    if (v != null && a.unit_of_measurement) return fr(v, v < 10 ? 1 : 0) + " " + a.unit_of_measurement;
    return STATE_WORDS[s] || s;
  }
  // The colour a lit bulb gives: rgb_color, else hs_color, else its white's
  // temperature (kelvin), else a warm white.
  function kelvinRgb(k) {
    var t = Math.max(1000, Math.min(40000, k)) / 100, r, g, b;
    r = t <= 66 ? 255 : 329.7 * Math.pow(t - 60, -0.1332);
    g = t <= 66 ? 99.47 * Math.log(t) - 161.12 : 288.12 * Math.pow(t - 60, -0.0755);
    b = t >= 66 ? 255 : t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04;
    return [r, g, b].map(function (v) { return Math.round(Math.max(0, Math.min(255, v))); });
  }
  function lightRgb(st) {
    var a = (st && st.attributes) || {};
    if (Array.isArray(a.rgb_color) && a.rgb_color.length === 3) return a.rgb_color;
    if (Array.isArray(a.hs_color) && a.hs_color.length === 2) {
      var h = a.hs_color[0] / 60, sat = a.hs_color[1] / 100, c = sat, x = c * (1 - Math.abs((h % 2) - 1));
      var p = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
      return p.map(function (v) { return Math.round((v + 1 - c) * 255); });
    }
    if (a.color_temp_kelvin) return kelvinRgb(a.color_temp_kelvin);
    if (a.color_temp) return kelvinRgb(1000000 / a.color_temp);
    return [255, 197, 120];
  }
  function isOn(hass, id) {
    var st = hass.states[id];
    return !!st && ["on", "open", "playing", "cleaning", "home", "opening"].indexOf(st.state) >= 0;
  }
  function tap(node, hass, id, how) {
    var d = domainOf(id);
    how = how || (d === "scene" ? "scene" : d === "script" ? "script" :
      ["light", "switch", "fan", "input_boolean", "cover"].indexOf(d) >= 0 ? "toggle" : d === "media_player" ? "play_pause" : d === "vacuum" ? "vacuum" : "more-info");
    if (how === "scene") return hass.callService("scene", "turn_on", {}, { entity_id: id });
    if (how === "script") return hass.callService("script", "turn_on", {}, { entity_id: id });
    if (how === "toggle") return hass.callService("homeassistant", "toggle", {}, { entity_id: id });
    if (how === "play_pause") return hass.callService("media_player", "media_play_pause", {}, { entity_id: id });
    if (how === "vacuum") return vacuumTap(hass, id);
    moreInfo(node, id);
  }
  // A robot vacuum: start it, or pause it while it cleans (Home Assistant
  // dropped vacuum.start_pause; start and pause remain).
  function vacuumTap(hass, id) {
    var st = hass.states[id];
    return hass.callService("vacuum", st && st.state === "cleaning" ? "pause" : "start", {}, { entity_id: id });
  }

  // ----- igor-tiles-card: big buttons, for a finger from afar -----
  //   type: custom:igor-tiles-card
  //   columns: 2
  //   tiles:
  //     - { entity: scene.tamisee, name: Tamisée, icon: mdi:brightness-6 }
  //     - { entity: light.salon, name: Salon }            # tap: on/off, hold: details; lit in the light's colour
  //     - { entity: switch.camera_privacy_mode, name: Caméra, icon: mdi:cctv, icon_off: mdi:cctv-off,
  //         invert: true, text: { "off": active, "on": privée } }   # lit while the switch is off
  //     - { entity: sensor.next_train, name: Ligne J, secondary: [sensor.train_1, sensor.train_2], tap: more-info }
  // size: small gives one line per tile (icon, name, state) instead of a square.
  // size: giant: a wall switch: a big icon, the name under it, no state text,
  // the tiles filling the card's height (a tablet made of buttons); labels:
  // false leaves the name out too; states: true shows the state under it.
  // A tile with `service: cover.open_cover` (and `data`) calls it on its
  // entity instead of switching it; `lit: open` lights it in that state.
  // A tile with `alarm: <device_id>` is an alarm clock (Alarm Clocks
  // integration): its time always shown, lit while on; a tap opens the
  // alarm clock in front (its time, its days, on or off; « Répéter » and
  // « Arrêter » while it rings).
  class IgorTilesCard extends IgorCard {
    setConfig(config) {
      if (!config || !Array.isArray(config.tiles) || !config.tiles.length) throw new Error("igor-tiles-card: tiles est requis");
      this.config = config;
    }
    getCardSize() { return 3; }
    build() {
      var small = this.config.size === "small";
      var giant = this.config.size === "giant";
      this.style([
        ":host { display: block; height: 100%; }",
        ".grid { display: grid; gap: 10px; height: 100%; grid-auto-rows: " + (small ? "auto" : "1fr") + "; }",
        "button { background: var(--card); border: 1px solid var(--line); border-radius: var(--igor-radius, 3px); color: var(--fg); font-family: inherit; text-align: left; cursor: pointer; min-width: 0; min-height: " + (small ? "0" : "86px") + "; }",
        "button.big { padding: 12px 14px; display: grid; grid-template-columns: 26px minmax(0, 1fr); grid-template-rows: auto auto; column-gap: 12px; align-content: center; --mdc-icon-size: 22px; }",
        "button.big ha-icon { grid-row: 1 / 3; align-self: center; }",
        "button.small { padding: 10px 12px; display: grid; grid-template-columns: 20px max-content minmax(0, 1fr); gap: 10px; align-items: center; --mdc-icon-size: 18px; }",
        "button ha-icon { color: var(--dim); }",
        "button.on { border-color: var(--tile-on-border, rgba(217, 164, 65, 0.4)); background: var(--tile-on-bg, var(--card)); } button.on ha-icon { color: var(--tile-on, var(--wait)); }",
        "button.scene ha-icon { color: var(--acc); }",
        // The name always whole: on two lines rather than cut.
        ".n { font-size: 14px; line-height: 1.2; overflow-wrap: break-word; min-width: 0; }",
        ".s { font-size: 11.5px; color: var(--dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }",
        "button.small .s { text-align: right; }",
        "button.done { border-color: var(--acc); }",
        "button:focus-visible { outline: 2px solid var(--acc); outline-offset: 2px; }",
        "button.giant { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px; text-align: center; min-height: 110px; padding: 10px; --mdc-icon-size: 46px; border-radius: var(--igor-radius, 3px); transition: background 0.2s, border-color 0.2s; }",
        "button.giant .n { font-size: 13px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--dim); }",
        "button.giant.on .n { color: var(--fg); }",
        "button.giant .s { display: none; }",
        "button.giant.alarm .s { display: block; font-size: 15px; margin-top: -6px; color: var(--fg); font-variant-numeric: tabular-nums; }",
        "button.giant.alarm.ring { border-color: var(--wait); background: rgba(217, 164, 65, 0.18); animation: igor-ring 1s ease-in-out infinite; }",
        "@keyframes igor-ring { 50% { background: rgba(217, 164, 65, 0.05); } }",
        ".grid.states button.giant .s { display: block; font-size: 11px; margin-top: -8px; }",
        "button.giant.act ha-icon { color: var(--fg); }",
        // Off is off: a faint icon, no colour; on: the bulb's colour, lit.
        "button.giant:not(.on):not(.act):not(.alarm):not(.scene) ha-icon { color: var(--faint); }",
        // Alive: the line of what it does, its colour and its motion, when on.
        "button.giant.on .s { display: block; font-size: 11px; color: var(--fg); opacity: 0.8; margin-top: -6px; max-width: 92%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; letter-spacing: 0.02em; text-transform: none; }",
        "button.alarm-on { border-color: var(--bad); background: rgba(224, 103, 95, 0.14); } button.alarm-on ha-icon { color: var(--bad); }",
        "button.on.k-media { --tile-on: #b48ce0; --tile-on-border: rgba(180, 140, 224, 0.65); --tile-on-bg: rgba(180, 140, 224, 0.16); }",
        "button.on.k-fan { --tile-on: #59d0e0; --tile-on-border: rgba(89, 208, 224, 0.6); --tile-on-bg: rgba(89, 208, 224, 0.14); }",
        "button.on.k-switch { --tile-on: #e0a33a; --tile-on-border: rgba(224, 163, 58, 0.65); --tile-on-bg: rgba(224, 163, 58, 0.16); }",
        "button.on.k-cover, button.on.k-vac { --tile-on: #5cc28f; --tile-on-border: rgba(92, 194, 143, 0.6); --tile-on-bg: rgba(92, 194, 143, 0.14); }",
        "button.on.k-sensor { --tile-on: #6cc4f5; --tile-on-border: rgba(108, 196, 245, 0.6); --tile-on-bg: rgba(108, 196, 245, 0.14); }",
        "button.on.k-scene { --tile-on: var(--acc); --tile-on-border: var(--acc); --tile-on-bg: rgba(108, 196, 245, 0.16); }",
        // Its motion, while it does something.
        "button.m-spin ha-icon { animation: igor-vac-spin var(--spin, 1.6s) linear infinite; }",
        "button.m-beat ha-icon { animation: igor-live 1.6s ease-in-out infinite; }",
        "button.m-glow ha-icon { animation: igor-glow 3s ease-in-out infinite; }",
        "button.m-breathe ha-icon { animation: igor-glow 1.6s ease-in-out infinite, igor-vac-breathe 1.6s ease-in-out infinite; }",
        "button.m-pulse ha-icon { animation: igor-live 0.9s ease-in-out infinite; }",
        "button.m-rock ha-icon { animation: igor-vac-rock 0.9s ease-in-out infinite; }",
        "button.m-up ha-icon { animation: igor-up 1.2s ease-in-out infinite; } button.m-down ha-icon { animation: igor-down 1.2s ease-in-out infinite; }",
        "@keyframes igor-up { 0% { transform: translateY(6px); opacity: 0.5; } 100% { transform: translateY(-6px); opacity: 1; } }",
        "@keyframes igor-down { 0% { transform: translateY(-6px); opacity: 0.5; } 100% { transform: translateY(6px); opacity: 1; } }",
        "@keyframes igor-live { 50% { transform: scale(1.12); } }",
        "@keyframes igor-glow { 50% { filter: drop-shadow(0 0 6px var(--tile-on, #e0a33a)); } }",
        "button.giant.on { box-shadow: 0 0 18px var(--tile-on-bg, rgba(217, 164, 65, 0.25)); }",
        // On: a small light in the corner, breathing in the tile's colour.
        "button { position: relative; }",
        "button.giant.on::after, button.giant.alarm-on::after, button.big.on::after, button.big.alarm-on::after { content: ''; position: absolute; top: 9px; right: 9px; width: 8px; height: 8px; border-radius: 50%; background: var(--tile-on, var(--wait)); box-shadow: 0 0 8px var(--tile-on, var(--wait)); animation: igor-vac-breathe 2.4s ease-in-out infinite; }",
        "button.alarm-on::after { background: var(--bad); box-shadow: 0 0 8px var(--bad); }",
        "button.giant.always .s { display: block; font-size: 11px; margin-top: -6px; max-width: 92%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-transform: none; }",
        "button.giant.alarm-on .s, button.giant.gone .s { display: block; font-size: 11px; margin-top: -6px; }",
        "button.giant.alarm-on .s { color: var(--bad); }",
        // Gone (unavailable): faded, dashed, says so.
        "button.gone { opacity: 0.45; border-style: dashed; }",
        "button.giant:active { transform: scale(0.98); }",
        // Igor just acted on it (the tablet's voice display says so): a cyan flash.
        "button.flash { border-color: #59d0e0 !important; box-shadow: 0 0 0 2px rgba(89, 208, 224, 0.45); background: rgba(89, 208, 224, 0.14) !important; }",
        "button.flash ha-icon { color: #59d0e0 !important; }",
        // A robot vacuum's tile moves with it: turning while it cleans,
        // rocking on its way home, breathing in pause, red when stuck.
        "button.vac-cleaning ha-icon { animation: igor-vac-spin 2.4s linear infinite; }",
        "button.vac-returning ha-icon { animation: igor-vac-rock 0.9s ease-in-out infinite; }",
        "button.vac-paused ha-icon { animation: igor-vac-breathe 1.6s ease-in-out infinite; }",
        "button.vac-error ha-icon { color: var(--bad) !important; }",
        "@keyframes igor-vac-spin { to { transform: rotate(360deg); } }",
        "@keyframes igor-vac-rock { 50% { transform: translateX(6px); } }",
        "@keyframes igor-vac-breathe { 50% { opacity: 0.35; } }",
        "@media (prefers-reduced-motion: reduce) { button[class*=vac-] ha-icon, button[class*=m-] ha-icon, button.on ha-icon, button.on::after { animation: none !important; } }"
      ].join("\n"));
      var grid = el("div", "grid" + (giant && this.config.states ? " states" : ""), this.shadowRoot);
      var cols = Number(this.config.columns) || (small ? 1 : 2);
      grid.style.gridTemplateColumns = "repeat(" + cols + ", minmax(0, 1fr))";
      // A last row short of tiles: its last tile widens to the end, no hole.
      var rest = this.config.tiles.length % cols;
      this.tiles = this.config.tiles.map((t, i) => {
        var b = el("button", (small ? "small" : giant ? "giant" + (t.service ? " act" : "") : "big") + (t.alarm ? " alarm" : ""), grid);
        b.type = "button";
        if (rest && i === this.config.tiles.length - 1) b.style.gridColumn = "span " + (cols - rest + 1);
        var ic = icon(b, t.icon || (t.alarm ? "mdi:alarm" : "mdi:help-circle-outline"));
        var mid = small ? el("span", "", b) : b;
        if (!(giant && this.config.labels === false)) el("span", "n", mid, t.name || t.entity);
        var sub = el("span", "s", small ? b : b);
        if (small) b.appendChild(sub);
        var held = false, timer = null;
        b.addEventListener("pointerdown", () => { held = false; timer = setTimeout(() => { held = true; if (t.alarm) alarmWindow(this, t.alarm, t.full); else moreInfo(this, t.entity); }, 600); });
        ["pointerup", "pointerleave", "pointercancel"].forEach((e) => b.addEventListener(e, () => clearTimeout(timer)));
        b.addEventListener("click", () => {
          if (held || !this._hass) return;
          if (t.alarm) { alarmWindow(this, t.alarm, t.full); return; }
          var r = t.service === "vacuum.start_pause" ? vacuumTap(this._hass, t.entity)
            : t.service ? service(this._hass, t.service, t.data, t.target || { entity_id: t.entity }) : tap(this, this._hass, t.entity, t.tap);
          if (r && r.then) r.then(() => { b.classList.add("done"); setTimeout(() => b.classList.remove("done"), 700); });
        });
        return { t: t, b: b, ic: ic, sub: sub };
      });
      // « Cuisine · éteinte » from Igor: the tile named so flashes.
      this._acted = (ev) => {
        var labels = (ev.detail && ev.detail.labels) || [];
        var heads = labels.map((l) => String(l).split(" · ")[0].trim().toLowerCase());
        this.tiles.forEach((x) => {
          var st = this._hass && this._hass.states[x.t.entity];
          var names = [String(x.t.name || "").toLowerCase(), st && st.attributes.friendly_name ? String(st.attributes.friendly_name).toLowerCase() : ""];
          if (!heads.some((h) => h && names.indexOf(h) >= 0)) return;
          x.b.classList.add("flash");
          setTimeout(() => x.b.classList.remove("flash"), 2500);
        });
      };
      window.addEventListener("igor-acted", this._acted);
      // Some screens (a kiosk tablet) stop handing the cards Home Assistant's
      // updates while the page stays open: the tiles read the live state
      // themselves every 2 seconds, so a light switched off shows off.
      clearInterval(this._live);
      this._live = setInterval(() => {
        var ha = document.querySelector("home-assistant"), live = ha && ha.hass;
        if (live && live !== this._hass && live.states) this.hass = live;
        else if (this._hass) this.update(this._hass, this._hass);
      }, 2000);
    }
    disconnectedCallback() {
      clearInterval(this._live);
      this._live = null;
      if (this._acted) window.removeEventListener("igor-acted", this._acted);
      this._acted = null;
      this._built = false;
      this.shadowRoot.innerHTML = "";
    }
    // The alarm clock's entities, found from its device (as igor-alarm-card).
    alarmIds(t) {
      var hass = this._hass;
      if (!hass) return {};
      if (!t._ids || t._reg !== hass.entities) { t._ids = alarmEntities(hass, t.alarm); t._reg = hass.entities; }
      return t._ids;
    }
    update(hass, prev) {
      var ctx = { applied: appliedScene(hass, this.config.tiles) };
      this.tiles.forEach((x) => {
        if (x.t.alarm) {
          var a = this.alarmIds(x.t), s = (id) => (id && hass.states[id] ? hass.states[id].state : "");
          var on = s(a.enabled) === "on", state = s(a.state), ringing = state === "ringing" || state === "snoozed";
          var time = s(a.time).slice(0, 5);
          x.sub.textContent = ringing ? (state === "ringing" ? "sonne · toucher" : "répétition") : (time || "—") + (on ? "" : " · coupé");
          x.b.classList.toggle("on", on);
          x.b.classList.toggle("ring", ringing);
          return;
        }
        // Every tile, every time (a few dozen: cheap): a tile is never left on
        // an old state because the page passed an unchanged-looking update.
        var st = hass.states[x.t.entity];
        if (!x.t.icon && st && st.attributes.icon) x.ic.setAttribute("icon", st.attributes.icon);
        var text = x.t.secondary ? x.t.secondary.map(function (id) { return stateText(hass, id); }).join(" · ") : stateText(hass, x.t.entity);
        if (x.t.secondary && x.t.show_state) text = stateText(hass, x.t.entity) + " · " + text;
        var live = tileLive(hass, x.t, st, ctx);
        if (x.t.text && st && x.t.text[st.state] != null) live.text = String(x.t.text[st.state]);
        else if (x.t.secondary || !live.text) live.text = live.on || live.gone ? live.text || text : text;
        x.sub.textContent = live.text;
        // Its icon says it too: a fan, a projector, a speaker crossed out when off.
        var offIcon = x.t.icon_off || (x.t.icon_off !== false && !x.t.service && OFF_ICONS[x.t.icon]);
        if (offIcon) x.ic.setAttribute("icon", live.on ? (ON_ICONS[x.t.icon] && live.motion === "beat" ? ON_ICONS[x.t.icon] : x.t.icon || "mdi:help-circle-outline") : offIcon);
        x.b.classList.toggle("always", Boolean(live.always));
        var d = domainOf(x.t.entity);
        x.b.classList.toggle("scene", !x.t.service && (d === "scene" || d === "script"));
        x.b.classList.toggle("on", live.on);
        x.b.classList.toggle("alarm-on", live.alarm);
        x.b.classList.toggle("gone", live.gone);
        if (x.kind !== live.kind) { if (x.kind) x.b.classList.remove("k-" + x.kind); x.b.classList.add("k-" + live.kind); x.kind = live.kind; }
        if (x.motion !== live.motion) { if (x.motion) x.b.classList.remove("m-" + x.motion); if (live.motion) x.b.classList.add("m-" + live.motion); x.motion = live.motion; }
        // A vacuum's own classes (its tile moves with it).
        ["cleaning", "returning", "paused", "error"].forEach((k) => x.b.classList.toggle("vac-" + k, live.vac === k));
        // A fan turns at its own speed.
        x.b.style.setProperty("--spin", live.spin ? live.spin + "s" : "");
        // A light lit takes its bulb's colour (its colour, or its white's
        // warmth); a thermostat its mode's; off, the tile is plainly off.
        var rgb = live.rgb;
        x.b.style.setProperty("--tile-on", rgb ? "rgb(" + rgb.join(",") + ")" : "");
        x.b.style.setProperty("--tile-on-border", rgb ? "rgba(" + rgb.join(",") + ",0.7)" : "");
        x.b.style.setProperty("--tile-on-bg", rgb ? "rgba(" + rgb.join(",") + ",0.18)" : "");
      });
    }
  }

  // ----- igor-control-card: one thing and its buttons (a cover, a vacuum…) -----
  //   type: custom:igor-control-card
  //   entity: cover.volet
  //   name: Volet
  //   icon: mdi:window-shutter
  //   buttons:
  //     - { icon: mdi:arrow-up, service: cover.open_cover }
  //     - { icon: mdi:stop, service: cover.stop_cover }
  //     - { icon: mdi:arrow-down, service: cover.close_cover }
  // Each button acts on the card's entity unless it names its own target.
  class IgorControlCard extends IgorCard {
    setConfig(config) {
      if (!config || !config.entity) throw new Error("igor-control-card: entity est requis");
      this.config = config;
    }
    getCardSize() { return 1; }
    build() {
      this.style(CARD_CSS + [
        "", "ha-card { justify-content: center; }",
        ".ctl { display: grid; grid-template-columns: 24px minmax(0, 1fr) auto; gap: 12px; align-items: center; --mdc-icon-size: 20px; }",
        ".ctl > ha-icon { color: var(--acc); cursor: pointer; }",
        ".n { font-size: 14px; } .s { color: var(--dim); font-size: 11.5px; }",
        ".bs { display: flex; gap: 8px; }",
        ".bs button { width: 48px; height: 42px; border: 1px solid var(--line); border-radius: var(--igor-radius, 3px); background: none; color: var(--fg); display: grid; place-items: center; cursor: pointer; --mdc-icon-size: 20px; }",
        ".bs button.done { border-color: var(--acc); }"
      ].join("\n"));
      var card = el("ha-card", "", this.shadowRoot);
      var c = el("div", "ctl", card);
      var ic = icon(c, this.config.icon || "mdi:gesture-tap");
      ic.addEventListener("click", () => moreInfo(this, this.config.entity));
      var mid = el("span", "", c);
      el("div", "n", mid, this.config.name || this.config.entity);
      this.sub = el("div", "s", mid);
      var bs = el("span", "bs", c);
      (this.config.buttons || []).forEach((b) => {
        var btn = el("button", "", bs);
        btn.type = "button";
        icon(btn, b.icon || "mdi:gesture-tap");
        btn.addEventListener("click", () => {
          if (!this._hass) return;
          service(this._hass, b.service, b.data, b.target || { entity_id: this.config.entity }).then(() => {
            btn.classList.add("done");
            setTimeout(() => btn.classList.remove("done"), 700);
          });
        });
      });
    }
    update(hass, prev) {
      if (changed(prev, hass, [this.config.entity])) this.sub.textContent = stateText(hass, this.config.entity);
    }
  }

  // ----- igor-clock-card: the time, large -----
  //   type: custom:igor-clock-card
  class IgorClockCard extends IgorCard {
    setConfig(config) { this.config = config || {}; }
    getCardSize() { return 2; }
    build() {
      this.style(".t { font-size: " + (Number(this.config.size) || 64) + "px; font-weight: 500; line-height: 1; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }\n.d { color: var(--dim); font-size: 14px; margin-top: 6px; }\nha-card { justify-content: center; padding: 14px 16px; }");
      var card = el("ha-card", "", this.shadowRoot);
      this.t = el("div", "t", card);
      this.d = el("div", "d", card);
      this.tick = setInterval(() => this.clock(), 10000);
      this.clock();
    }
    clock() {
      var d = new Date();
      this.t.textContent = hhmm(d);
      this.d.textContent = d.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
    }
  }

  // ----- igor-music-card: what plays, and how to change it -----
  //   type: custom:igor-music-card
  //   players: [media_player.salon, media_player.cuisine]   # the first is shown first
  //   favorites:                                            # one tap plays it
  //     - { name: Radio, media_id: "FIP", media_type: radio, icon: mdi:radio }
  //   config_entry_id: …   # Music Assistant's, for the search (found by itself for an admin)
  // Works with any media player; with Music Assistant it also searches, plays
  // favourites and shows what comes next.
  class IgorMusicCard extends IgorCard {
    setConfig(config) {
      if (!config || !Array.isArray(config.players) || !config.players.length) throw new Error("igor-music-card: players est requis");
      this.config = config;
      this.player = config.players[0];
    }
    getCardSize() { return 5; }
    build() {
      this.style([
        ".np { display: grid; grid-template-columns: 76px minmax(0, 1fr); gap: 12px; align-items: center; }",
        ".art { width: 76px; height: 76px; border-radius: var(--igor-radius, 3px); background: var(--track) center / cover no-repeat; }",
        ".ti { font-size: 15px; color: var(--fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
        ".ar { color: var(--dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
        ".pg { height: 3px; background: var(--track); margin-top: 8px; } .pg i { display: block; height: 100%; width: 0; background: var(--acc); }",
        ".ctl { display: flex; gap: 6px; margin-top: 8px; align-items: center; flex-wrap: wrap; }",
        "button.b { background: none; border: 1px solid var(--line); color: var(--fg); font: inherit; border-radius: var(--igor-radius, 3px); padding: 4px 8px; cursor: pointer; --mdc-icon-size: 18px; display: inline-flex; align-items: center; gap: 4px; }",
        "button.b.on { border-color: var(--acc); color: var(--acc); }",
        "input.vol { flex: 1; min-width: 80px; accent-color: var(--acc); }",
        ".sec { color: var(--dim); font-size: 10.5px; letter-spacing: 0.1em; text-transform: uppercase; margin-top: 10px; }",
        ".row { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 5px; }",
        ".next { color: var(--dim); margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
        "input.q { width: 100%; box-sizing: border-box; background: var(--bg); border: 1px solid var(--line); color: var(--fg); font: inherit; padding: 5px 8px; margin-top: 5px; border-radius: var(--igor-radius, 3px); }",
        ".res div { padding: 5px 0; border-bottom: 1px dashed var(--line); cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
        ".res div span { color: var(--dim); }"
      ].join("\n"));
      var card = el("ha-card", "", this.shadowRoot);
      var top = el("div", "top", card);
      el("span", "t", top, this.config.title || "musique");
      this.who = el("span", "sub", top);
      var np = el("div", "np", card);
      this.art = el("div", "art", np);
      var mid = el("div", "", np);
      this.ti = el("div", "ti", mid); this.ar = el("div", "ar", mid);
      this.pg = el("i", "", el("div", "pg", mid));
      var ctl = el("div", "ctl", card);
      var b = (ic, fn) => { var x = el("button", "b", ctl); x.type = "button"; icon(x, ic); x.addEventListener("click", fn); return x; };
      b("mdi:skip-previous", () => this.svc("media_player", "media_previous_track"));
      this.pp = b("mdi:play-pause", () => this.svc("media_player", "media_play_pause"));
      b("mdi:skip-next", () => this.svc("media_player", "media_next_track"));
      this.sh = b("mdi:shuffle", () => { var st = this._hass.states[this.player]; this.svc("media_player", "shuffle_set", { shuffle: !(st && st.attributes.shuffle) }); });
      this.vol = el("input", "vol", ctl); this.vol.type = "range"; this.vol.min = 0; this.vol.max = 100;
      this.vol.addEventListener("change", () => this.svc("media_player", "volume_set", { volume_level: Number(this.vol.value) / 100 }));
      if (this.config.players.length > 1) {
        el("div", "sec", card, "enceintes");
        this.pl = el("div", "row", card);
      }
      this.nextEl = el("div", "next", card);
      if ((this.config.favorites || []).length) {
        el("div", "sec", card, "raccourcis");
        var fav = el("div", "row", card);
        this.config.favorites.forEach((f) => {
          var x = el("button", "b", fav); x.type = "button";
          if (f.icon) icon(x, f.icon);
          el("span", "", x, f.name || f.media_id);
          x.addEventListener("click", () => this.play(f.media_id, f.media_type));
        });
      }
      if (this.config.search !== false) {
        el("div", "sec", card, "chercher");
        this.q = el("input", "q", card); this.q.placeholder = "artiste, album, titre, radio…";
        this.q.addEventListener("keydown", (ev) => { if (ev.key === "Enter") this.search(this.q.value); });
        this.res = el("div", "res", card);
      }
      this.tick = setInterval(() => this.progress(), 1000);
    }
    svc(domain, service, data) { return this._hass.callService(domain, service, data || {}, { entity_id: this.player }); }
    play(id, type) {
      var data = { media_id: id };
      if (type) data.media_type = type;
      return this._hass.callService("music_assistant", "play_media", data, { entity_id: this.player })
        .catch(() => this._hass.callService("media_player", "play_media", { media_content_id: id, media_content_type: type || "music" }, { entity_id: this.player }));
    }
    async entryId() {
      if (this.config.config_entry_id) return this.config.config_entry_id;
      if (this._entry !== undefined) return this._entry;
      try {
        var r = await this._hass.callWS({ type: "config_entries/get", domain: "music_assistant" });
        this._entry = (r && r[0] && r[0].entry_id) || null;
      } catch (e) { this._entry = null; }
      return this._entry;
    }
    async search(text) {
      text = String(text || "").trim();
      this.res.innerHTML = "";
      if (!text) return;
      var entry = await this.entryId();
      if (!entry) { el("div", "", this.res, "Recherche indisponible (Music Assistant, config_entry_id)"); return; }
      try {
        var r = await this._hass.callWS({ type: "call_service", domain: "music_assistant", service: "search",
          service_data: { config_entry_id: entry, name: text, limit: 4 }, return_response: true });
        var resp = (r && r.response) || {}, n = 0;
        [["artists", "artiste"], ["albums", "album"], ["tracks", "titre"], ["playlists", "liste"], ["radio", "radio"]].forEach((k) => {
          (resp[k[0]] || []).forEach((it) => {
            n++;
            var d = el("div", "", this.res);
            d.textContent = (it.name || "") + " ";
            var who = it.artists && it.artists[0] ? " · " + it.artists[0].name : "";
            el("span", "", d, k[1] + who);
            d.addEventListener("click", () => this.play(it.uri || it.name, it.media_type));
          });
        });
        if (!n) el("div", "", this.res, "Rien trouvé.");
      } catch (e) { el("div", "", this.res, "Recherche impossible."); }
    }
    loadNext() {
      var hass = this._hass;
      hass.callWS({ type: "call_service", domain: "music_assistant", service: "get_queue", target: { entity_id: this.player }, return_response: true })
        .then((r) => {
          var q = r && r.response && r.response[this.player];
          var nx = q && q.next_item;
          var name = nx && (nx.name || (nx.media_item && nx.media_item.name));
          this.nextEl.textContent = name ? "à suivre · " + name : "";
        }).catch(() => { this.nextEl.textContent = ""; });
    }
    progress() {
      var st = this._hass && this._hass.states[this.player];
      if (!st) return;
      var a = st.attributes, pos = a.media_position, dur = a.media_duration;
      if (pos == null || !dur) { this.pg.style.width = "0"; return; }
      if (st.state === "playing" && a.media_position_updated_at) pos += (Date.now() - Date.parse(a.media_position_updated_at)) / 1000;
      this.pg.style.width = Math.min(100, (pos / dur) * 100) + "%";
    }
    update(hass, prev) {
      var ids = this.config.players;
      if (!changed(prev, hass, ids)) return;
      var st = hass.states[this.player] || { state: "unavailable", attributes: {} }, a = st.attributes;
      this.who.textContent = (a.friendly_name || this.player) + " · " + stateText(hass, this.player);
      this.ti.textContent = a.media_title || (st.state === "playing" ? "lecture" : "rien en cours");
      this.ar.textContent = [a.media_artist, a.media_album_name].filter(Boolean).join(" · ");
      this.art.style.backgroundImage = a.entity_picture ? "url(\"" + a.entity_picture + "\")" : "";
      this.sh.classList.toggle("on", !!a.shuffle);
      if (a.volume_level != null && this.shadowRoot.activeElement !== this.vol) this.vol.value = Math.round(a.volume_level * 100);
      if (this.pl) {
        this.pl.innerHTML = "";
        ids.forEach((id) => {
          var x = el("button", "b" + (id === this.player ? " on" : ""), this.pl, (hass.states[id] && hass.states[id].attributes.friendly_name) || id);
          x.type = "button";
          x.addEventListener("click", () => { this.player = id; this.update(hass, null); });
        });
      }
      var key = a.media_title + "|" + this.player;
      if (key !== this.lastKey) { this.lastKey = key; this.loadNext(); }
      this.progress();
    }
    disconnectedCallback() { clearInterval(this.tick); }
  }

  // ----- igor-facts-card: a few states, one line each -----
  //   type: custom:igor-facts-card
  //   title: maison
  //   rows:
  //     - { entity: binary_sensor.portes, name: portes et fenêtres, ok: ["off"], text: { "off": fermées, "on": ouvertes } }
  //     - { entity: sensor.ping_latence, name: latence, warn: 50, bad: 150 }
  //     - { entity: sensor.x, name: …, attribute: last_backup }
  //     - { name: lumières allumées, count: [light.a, light.b] }   # « 1 / 2 »
  //     - { entity: sensor.vidange_km, name: vidange, remaining: km, below_warn: 1000, below_bad: 0, zero: à renseigner, more: input_number.vidange }
  //       # remaining: « dans 800 km » or « dépassé de 200 km »; below_*: amber or red under;
  //       # zero: the text for 0 (not set yet); more: the entity a tap opens
  // A row whose entity does not exist is left out: the card shows only what
  // this house has (nothing at all: the card says so).
  class IgorFactsCard extends IgorCard {
    setConfig(config) {
      if (!config || !Array.isArray(config.rows) || !config.rows.length) throw new Error("igor-facts-card: rows est requis");
      this.config = config;
    }
    getCardSize() { return 3; }
    build() {
      this.style([
        ".rows { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 5px 14px; font-variant-numeric: tabular-nums; }",
        ".rows .l { color: var(--dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
        ".rows .v { text-align: right; white-space: nowrap; }",
        ".rows .v.warn { color: var(--wait); } .rows .v.bad { color: var(--bad); } .rows .v.ok { color: var(--okc); }",
        ".rows .l.tap, .rows .v.tap { cursor: pointer; }",
        // size: big: read from further away (a car's screen).
        ".big .rows { font-size: 15px; gap: 10px 14px; } .big .top { font-size: 13px; }",
        ".empty { color: var(--dim); }"
      ].join("\n"));
      var card = el("ha-card", this.config.size === "big" ? "big" : "", this.shadowRoot);
      var top = el("div", "top", card);
      el("span", "t", top, this.config.title || "");
      this.rows = el("div", "rows", card);
      this.sig = "";
    }
    update(hass) {
      // A row may count instead: { name, count: [ids] } → « 2 / 5 » lit.
      var shown = this.config.rows.filter(function (r) {
        if (r && Array.isArray(r.count)) return r.count.some(function (id) { return hass.states[id]; });
        return r && r.entity && hass.states[r.entity];
      });
      var vals = shown.map(function (r) {
        if (Array.isArray(r.count)) {
          var there = r.count.filter(function (id) { return hass.states[id]; });
          var on = there.filter(function (id) { return isOn(hass, id); }).length;
          return [Object.assign({ entity: there[0] }, r), on + " / " + there.length, on ? "warn" : ""];
        }
        var st = hass.states[r.entity];
        var raw = r.attribute ? st.attributes[r.attribute] : st.state;
        var text = r.text && r.text[String(raw)] != null ? String(r.text[String(raw)]) : r.attribute ? (raw == null ? "—" : /^\d{4}-\d\d-\d\d[T ]\d/.test(String(raw)) ? hhmm(new Date(raw)) : String(raw)) : stateText(hass, r.entity);
        var n = parseFloat(raw), level = "";
        if (r.remaining && !isNaN(n)) text = n < 0 ? "dépassé de " + fr(-n, 0) + " " + r.remaining : "dans " + fr(n, 0) + " " + r.remaining;
        if (r.zero != null && !isNaN(n) && n === 0) return [r, String(r.zero), ""];
        if (r.ok) level = r.ok.map(String).indexOf(String(raw)) >= 0 ? "ok" : "warn";
        if (!isNaN(n) && r.bad != null && n >= r.bad) level = "bad";
        else if (!isNaN(n) && r.warn != null && n >= r.warn) level = "warn";
        if (!isNaN(n) && r.below_bad != null && n < r.below_bad) level = "bad";
        else if (!isNaN(n) && r.below_warn != null && n < r.below_warn) level = "warn";
        return [r, text, level];
      });
      var sig = JSON.stringify(vals.map(function (v) { return [v[0].name || v[0].entity, v[1], v[2]]; }));
      if (sig === this.sig) return;
      this.sig = sig;
      this.rows.innerHTML = "";
      if (!vals.length) { el("span", "empty", this.rows, "Aucune de ces entités ici."); return; }
      vals.forEach((v) => {
        var l = el("span", "l tap", this.rows, v[0].name || (hass.states[v[0].entity].attributes.friendly_name || v[0].entity));
        l.addEventListener("click", () => moreInfo(this, v[0].more || v[0].entity));
        var vv = el("span", "v" + (v[2] ? " " + v[2] : "") + (v[0].more ? " tap" : ""), this.rows, v[1]);
        if (v[0].more) vv.addEventListener("click", () => moreInfo(this, v[0].more));
      });
    }
  }

  // ----- igor-news-card: the newest headlines of a feed -----
  //   type: custom:igor-news-card
  //   url: https://example.org/rss.xml   # an RSS or Atom feed, or the AFP's
  //        dispatches: https://www.mediapart.fr/journal/fil-dactualites
  //   title: dépêches
  //   limit: 15
  // Read by Home Assistant (nives.news, kept ten minutes), refreshed here
  // every ten minutes. A tap opens the article on a PC (not on a kiosk).
  class IgorNewsCard extends IgorCard {
    setConfig(config) {
      if (!config || !/^https?:\/\//.test(String(config.url || ""))) throw new Error("igor-news-card: url (http ou https) est requis");
      this.config = config;
    }
    build() {
      this.style([
        ".list { flex: 1; min-height: 0; overflow-x: hidden; overflow-y: auto; scrollbar-width: thin; }",
        ".n { display: grid; grid-template-columns: 5ch minmax(0, 1fr); gap: 8px; padding: 6px 0; border-bottom: 1px dashed var(--line); line-height: 1.35; }",
        ".n:last-child { border-bottom: 0; }",
        ".n .h { color: var(--faint); font-variant-numeric: tabular-nums; }",
        ".n.old { color: var(--dim); }",
        ".n.link { cursor: pointer; }",
        ".src { color: var(--dim); font-size: 11px; }",
        ".empty { color: var(--dim); padding: 8px 0; }"
      ].join("\n"));
      var card = el("ha-card", "", this.shadowRoot);
      var top = el("div", "top", card);
      el("span", "t sub", top, (this.config.title || "dépêches").toUpperCase()).style.letterSpacing = "0.12em";
      this.src = el("span", "src", top);
      this.list = el("div", "list", card);
      this.timer = setInterval(() => this.load(), 600000);
      this.load();
    }
    load() {
      var hass = this._hass;
      if (!hass || this.loading) return;
      this.loading = true;
      var limit = Math.max(1, Math.min(50, Number(this.config.limit) || 15));
      hass.callWS({ type: "call_service", domain: "nives", service: "news", service_data: { url: String(this.config.url), limit: limit }, return_response: true })
        .then((r) => { this.render((r && r.response) || {}); })
        .catch(() => { this.render({ error: "service" }); })
        .then(() => {
          this.loading = false;
          // Nothing yet (Home Assistant just started, the site busy): again
          // in 30 s rather than at the next ten-minute round.
          clearTimeout(this.retry);
          if (!this.ok) this.retry = setTimeout(() => this.load(), 30000);
        });
    }
    render(feed) {
      this.ok = !!(feed.items && feed.items.length);
      // An error after a good list: keep the list on screen.
      if (!this.ok && this.list.childElementCount && this.shown) return;
      this.shown = this.ok;
      this.list.innerHTML = "";
      this.src.textContent = feed.source || "";
      var items = feed.items || [];
      if (!items.length) {
        el("div", "empty", this.list, feed.error ? "Flux indisponible (" + feed.error + ")" : "Aucune dépêche.");
        return;
      }
      var today = new Date().toDateString();
      var kiosk = (getComputedStyle(document.documentElement).getPropertyValue("--igor-hide-header").trim().replace(/["']/g, "") || "") !== "";
      items.forEach(function (it) {
        var d = it.at ? new Date(it.at) : null;
        var same = d && d.toDateString() === today;
        var row = el("div", "n" + (same ? "" : " old"), this.list);
        el("span", "h", row, !d || isNaN(d) ? "" : same ? hhmm(d) : pad(d.getDate()) + "/" + pad(d.getMonth() + 1));
        el("span", "", row, it.title || "");
        if (it.link && !kiosk) {
          row.classList.add("link");
          row.addEventListener("click", function () { window.open(it.link, "_blank", "noopener"); });
        }
      }, this);
    }
    disconnectedCallback() { clearTimeout(this.retry); if (this.timer) { clearInterval(this.timer); this.timer = null; this._built = false; this.shadowRoot.innerHTML = ""; } }
  }

  // ----- igor-dns-card: AdGuard Home's DNS queries, live -----
  //   type: custom:igor-dns-card
  //   title: dns · en direct
  //   interval: 2          # seconds between two reads (2 to 30)
  //   rows: 60             # lines kept on screen
  //   names: { 192.168.1.20: nas }   # names for addresses AdGuard does not know
  //   hide: [local, in-addr.arpa]      # domains not shown (and their subdomains)
  //   more: /igor-wall/dns             # a « tout le journal » button to that page
  //   blocked: true                    # start on the blocked queries only
  // Read by Home Assistant (nives.dns_log, through the AdGuard integration),
  // for administrators only: it is the house's browsing history. Nothing is
  // kept; reading stops while the page is hidden or paused.
  class IgorDnsCard extends IgorCard {
    setConfig(config) {
      this.config = config || {};
      this.names = this.config.names && typeof this.config.names === "object" ? this.config.names : {};
      this.hide = (Array.isArray(this.config.hide) ? this.config.hide : []).map((d) => String(d).toLowerCase().replace(/^\.+/, ""));
    }
    getCardSize() { return 8; }
    build() {
      this.style([
        ".ctl { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin: 2px 0 6px; flex: none; }",
        "button.b { background: none; border: 1px solid var(--line); color: var(--fg); font: inherit; border-radius: var(--igor-radius, 3px); padding: 3px 8px; cursor: pointer; }",
        "button.b.on { border-color: var(--acc); color: var(--acc); }",
        "input.q { flex: 1; min-width: 90px; background: var(--bg); border: 1px solid var(--line); color: var(--fg); font: inherit; padding: 3px 7px; border-radius: var(--igor-radius, 3px); }",
        ".who { display: flex; gap: 5px; flex-wrap: wrap; margin-bottom: 6px; flex: none; }",
        ".who button { background: none; border: 1px solid var(--line); color: var(--dim); font: inherit; font-size: 11px; border-radius: var(--igor-radius, 3px); padding: 1px 8px; cursor: pointer; }",
        ".who button.on { color: var(--acc); border-color: var(--acc); }",
        ".list { flex: 1; min-height: 0; overflow-y: auto; }",
        ".r { display: grid; grid-template-columns: 8ch minmax(6ch, 13ch) minmax(0, 1fr) auto; gap: 8px; padding: 3px 0; border-bottom: 1px dashed var(--line); align-items: baseline; }",
        ".r .h, .r .ms { color: var(--faint); font-variant-numeric: tabular-nums; }",
        ".r .c { color: var(--dim); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
        ".r .d { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
        ".r.blocked .d { color: var(--bad); text-decoration: line-through; }",
        ".r.rewritten .d { color: var(--acc); }",
        ".r .w { grid-column: 2 / -1; color: var(--dim); font-size: 10.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
        ".empty { color: var(--dim); padding: 8px 0; }"
      ].join("\n"));
      var card = el("ha-card", "", this.shadowRoot);
      var top = el("div", "top", card);
      el("span", "t sub", top, (this.config.title || "dns · en direct").toUpperCase()).style.letterSpacing = "0.12em";
      this.sum = el("span", "sub num", top);
      var ctl = el("div", "ctl", card);
      var btn = (text, fn) => { var x = el("button", "b", ctl, text); x.type = "button"; x.addEventListener("click", fn); return x; };
      this.blockedOnly = !!this.config.blocked; this.paused = false; this.client = "";
      this.bBlocked = btn("bloquées", () => { this.blockedOnly = !this.blockedOnly; this.bBlocked.classList.toggle("on", this.blockedOnly); this.lines = []; this.load(); });
      this.bBlocked.classList.toggle("on", this.blockedOnly);
      this.bPause = btn("pause", () => { this.paused = !this.paused; this.bPause.classList.toggle("on", this.paused); this.bPause.textContent = this.paused ? "reprendre" : "pause"; if (!this.paused) this.load(); });
      this.q = el("input", "q", ctl); this.q.placeholder = "domaine ou appareil…";
      // `more: /a-page`: a button to the full log (a page of its own).
      if (this.config.more) btn("tout le journal ›", () => navigate(String(this.config.more)));
      this.q.addEventListener("input", () => this.draw());
      this.who = el("div", "who", card);
      this.list = el("div", "list", card);
      this.lines = [];
      var every = Math.max(2, Math.min(30, Number(this.config.interval) || 2));
      this.timer = setInterval(() => this.load(), every * 1000);
      this.load();
    }
    load() {
      var hass = this._hass;
      if (!hass || this.loading || this.paused || document.hidden) return;
      this.loading = true;
      hass.callWS({ type: "call_service", domain: "nives", service: "dns_log", service_data: { limit: 200, blocked_only: this.blockedOnly }, return_response: true })
        .then((r) => {
          var resp = (r && r.response) || {};
          this.error = resp.error || "";
          this.merge(resp.entries || []);
        })
        .catch((err) => {
          var code = err && (err.code || "");
          this.error = code === "unauthorized" ? "réservé aux administrateurs" : "service indisponible (Igor 0.27 ou plus)";
        })
        .then(() => { this.loading = false; this.draw(); });
    }
    merge(entries) {
      var seen = {};
      this.lines.forEach((l) => { seen[l.key] = true; });
      var fresh = [];
      entries.forEach((e) => {
        e.key = e.time + "|" + e.client + "|" + e.domain + "|" + e.type;
        if (!seen[e.key]) { seen[e.key] = true; fresh.push(e); }
      });
      var keep = Math.max(5, Math.min(300, Number(this.config.rows) || 60)) * 3;
      this.lines = fresh.concat(this.lines).sort((a, b) => (a.time < b.time ? 1 : a.time > b.time ? -1 : 0)).slice(0, keep);
    }
    label(e) { return this.names[e.client] || e.name || e.client; }
    isHidden(domain) {
      var d = domain.toLowerCase();
      return this.hide.some((h) => d === h || d.endsWith("." + h));
    }
    draw() {
      var q = (this.q.value || "").trim().toLowerCase();
      var all = this.lines.filter((e) => !this.isHidden(e.domain));
      // The last minute: how many queries, how many blocked.
      var now = Date.now(), minute = all.filter((e) => now - Date.parse(e.time) < 60000);
      var blocked = minute.filter((e) => e.status === "blocked").length;
      this.sum.textContent = minute.length ? minute.length + " req/min · " + Math.round((100 * blocked) / minute.length) + " % bloquées" : "";
      // The chattiest devices, a tap filters on one.
      var count = {};
      all.forEach((e) => { var k = this.label(e); count[k] = (count[k] || 0) + 1; });
      var top = Object.keys(count).sort((a, b) => count[b] - count[a]).slice(0, 8);
      if (this.client && top.indexOf(this.client) < 0) top.push(this.client);
      this.who.innerHTML = "";
      top.forEach((k) => {
        var x = el("button", k === this.client ? "on" : "", this.who, k + " " + count[k]);
        x.type = "button";
        x.addEventListener("click", () => { this.client = this.client === k ? "" : k; this.draw(); });
      });
      var rows = all.filter((e) => (!this.client || this.label(e) === this.client) &&
        (!q || e.domain.toLowerCase().indexOf(q) >= 0 || this.label(e).toLowerCase().indexOf(q) >= 0));
      rows = rows.slice(0, Math.max(5, Math.min(300, Number(this.config.rows) || 60)));
      this.list.innerHTML = "";
      if (!rows.length) {
        el("div", "empty", this.list, this.error ? "AdGuard : " + this.error : this.paused ? "En pause." : "Aucune requête.");
        return;
      }
      rows.forEach((e) => {
        var r = el("div", "r " + e.status, this.list);
        var d = new Date(e.time);
        el("span", "h", r, isNaN(d) ? "" : hhmm(d) + ":" + pad(d.getSeconds()));
        el("span", "c", r, this.label(e)).title = e.client;
        var dom = el("span", "d", r, e.domain);
        dom.title = e.type + (e.answer && e.answer.length ? " → " + e.answer.join(", ") : "") + (e.upstream ? " · " + e.upstream : "");
        el("span", "ms", r, e.cached ? "cache" : e.ms != null ? fr(e.ms, e.ms < 10 ? 1 : 0) + " ms" : "");
        if (e.status === "blocked" || e.status === "rewritten" || e.status === "allowed") {
          el("span", "w", r, (e.why || e.status) + (e.rule ? " · " + e.rule : ""));
        }
      });
    }
    disconnectedCallback() { if (this.timer) { clearInterval(this.timer); this.timer = null; this._built = false; this.shadowRoot.innerHTML = ""; } }
  }

  // ----- igor-map-card: where the house's connections go -----
  //   type: custom:igor-map-card
  //   title: le monde · 15 min
  //   minutes: 15          # how far back (1 to 120)
  //   interval: 30         # seconds between two reads
  //   names: { 192.168.1.20: nas }
  //   animate: true        # the arcs' flowing dashes (false on an old tablet)
  // Each DNS answer of the window placed by country (nives.dns_map, DB-IP's
  // free databases, administrators only): an arc from home per country, its
  // width by the number of answers; a tap on a country or its line shows its
  // devices, domains and operators. Big networks answer from nearby servers:
  // much stays in France even for a foreign service.
  var FRONTEND_BASE = "/nives_static";
  var WORLD = null;
  function world() {
    if (!WORLD) {
      WORLD = fetch(FRONTEND_BASE + "/igor-world.json")
        .then((r) => (r.ok ? r.json() : null)).catch(() => null);
    }
    return WORLD;
  }
  var SVGNS = "http://www.w3.org/2000/svg";
  function svgEl(tag, attrs, parent) {
    var n = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(n);
    return n;
  }
  var REGION = null;
  function countryName(cc) {
    try { REGION = REGION || new Intl.DisplayNames(["fr"], { type: "region" }); return REGION.of(cc) || cc; } catch (e) { return cc; }
  }
  class IgorMapCard extends IgorCard {
    setConfig(config) {
      this.config = config || {};
      this.names = this.config.names && typeof this.config.names === "object" ? this.config.names : {};
    }
    getCardSize() { return 8; }
    build() {
      this.style([
        ".wrap { position: relative; flex: none; }",
        ".wrap.bigw { flex: 1; min-height: 160px; }",
        ".wrap.bigw svg.map { position: absolute; inset: 0; height: 100%; }",
        ".grid.over { position: absolute; left: 6px; right: 6px; bottom: 6px; margin: 0; display: flex; justify-content: space-between; align-items: flex-end; gap: 10px; pointer-events: none; }",
        ".grid.over > div { pointer-events: auto; width: 270px; max-height: 60%; overflow-y: auto; background: rgba(7, 8, 10, 0.86); border: 1px solid var(--line); padding: 6px 9px; }",
        ".grid.over > div:empty { display: none; }",
        "svg.map { width: 100%; display: block; }",
        ".land { fill: var(--track); stroke: var(--line); stroke-width: 1; vector-effect: non-scaling-stroke; }",
        "svg.map { touch-action: none; cursor: grab; }",
        ".zoom { position: absolute; top: 6px; right: 6px; display: flex; gap: 4px; z-index: 1; }",
        ".zoom button { background: rgba(7, 8, 10, 0.86); border: 1px solid var(--line); color: var(--fg); font: inherit; font-size: 11px; border-radius: var(--igor-radius, 3px); padding: 2px 8px; cursor: pointer; }",
        ".zoom button.on { border-color: var(--acc); color: var(--acc); }",
        ".arc { fill: none; stroke: var(--acc); stroke-linecap: round; opacity: 0.75; vector-effect: non-scaling-stroke; }",
        ".arc.flow { stroke-dasharray: 4 7; vector-effect: non-scaling-stroke; animation: igor-flow 1.6s linear infinite; }",
        "@keyframes igor-flow { to { stroke-dashoffset: -11; } }",
        ".dot { fill: var(--acc); cursor: pointer; }",
        ".dot.sel { fill: var(--wait); }",
        ".arc.sel { stroke: var(--wait); opacity: 1; }",
        ".dot.sel { stroke: none; }",
        ".home { fill: var(--fg); }",
        ".home-ring { fill: none; stroke: var(--fg); stroke-width: 0.3; opacity: 0.5; }",
        ".grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; flex: 1; min-height: 0; margin-top: 6px; }",
        ".list { overflow-y: auto; min-height: 0; }",
        ".c { display: grid; grid-template-columns: minmax(0, 1fr) 5ch; gap: 6px; padding: 3px 0; border-bottom: 1px dashed var(--line); cursor: pointer; }",
        ".c.sel { color: var(--wait); }",
        ".c .n { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
        ".c .k { text-align: right; color: var(--dim); font-variant-numeric: tabular-nums; }",
        ".c .bar { grid-column: 1 / -1; height: 2px; }",
        ".det { overflow-y: auto; min-height: 0; color: var(--fg); }",
        ".det .h { color: var(--dim); font-size: 10.5px; letter-spacing: 0.1em; text-transform: uppercase; margin-top: 6px; }",
        ".det .v { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
        ".foot { color: var(--faint); font-size: 10px; margin-top: 4px; flex: none; display: flex; justify-content: space-between; gap: 8px; }",
        ".empty { color: var(--dim); padding: 8px 0; }"
      ].join("\n"));
      var card = el("ha-card", "", this.shadowRoot);
      var top = el("div", "top", card);
      this.minutes = Math.max(1, Math.min(120, Number(this.config.minutes) || 15));
      el("span", "t sub", top, (this.config.title || ("le monde · " + this.minutes + " min")).toUpperCase()).style.letterSpacing = "0.12em";
      this.sum = el("span", "sub num", top);
      this.big = !!this.config.big;
      var wrap = el("div", "wrap" + (this.big ? " bigw" : ""), card);
      this.svg = svgEl("svg", { class: "map", viewBox: "0 0 360 150", preserveAspectRatio: "xMidYMid meet" }, wrap);
      // Zoom: the wheel, a drag to move, « − + », Europe and the world.
      this.vb = { x: 0, y: 0, w: 360, h: 150 };
      var zc = el("div", "zoom", wrap);
      var zb = (t, fn) => { var b = el("button", "", zc, t); b.type = "button"; b.addEventListener("click", (ev) => { ev.stopPropagation(); fn(); }); return b; };
      zb("−", () => this.zoomBy(1.5));
      zb("+", () => this.zoomBy(1 / 1.5));
      zb("Europe", () => this.setVB({ x: 166, y: 16, w: 58, h: 42 }));
      zb("monde", () => this.setVB({ x: 0, y: 0, w: 360, h: 150 }));
      this.svg.addEventListener("wheel", (ev) => {
        ev.preventDefault();
        var p = this.toMap(ev.clientX, ev.clientY);
        this.zoomBy(Math.exp(ev.deltaY * 0.0015), p);
      }, { passive: false });
      this.svg.addEventListener("pointerdown", (ev) => {
        this.pan = { x: ev.clientX, y: ev.clientY, vb: Object.assign({}, this.vb), moved: false };
      });
      this.svg.addEventListener("pointermove", (ev) => {
        var g = this.pan;
        if (!g) return;
        var dx = ev.clientX - g.x, dy = ev.clientY - g.y;
        if (!g.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
        if (!g.moved) { g.moved = true; try { this.svg.setPointerCapture(ev.pointerId); } catch (e) { /* fine */ } }
        var r = this.svg.getBoundingClientRect();
        var scale = Math.max(g.vb.w / r.width, g.vb.h / r.height);
        this.setVB({ x: g.vb.x - dx * scale, y: g.vb.y - dy * scale, w: g.vb.w, h: g.vb.h }, true);
      });
      var endPan = (ev) => {
        var g = this.pan; this.pan = null;
        // A drag must not count as a tap on a country.
        if (g && g.moved) { this.justPanned = true; setTimeout(() => { this.justPanned = false; }, 50); }
      };
      this.svg.addEventListener("pointerup", endPan);
      this.svg.addEventListener("pointercancel", endPan);
      this.landG = svgEl("g", {}, this.svg);
      this.arcG = svgEl("g", {}, this.svg);
      this.dotG = svgEl("g", {}, this.svg);
      // Big (the middle of a page): the list and the detail float on the map.
      var grid = el("div", "grid" + (this.big ? " over" : ""), this.big ? wrap : card);
      this.list = el("div", "list", grid);
      this.det = el("div", "det", grid);
      var foot = el("div", "foot", card);
      this.note = el("span", "", foot);
      el("span", "", foot, "IP Geolocation by DB-IP · Natural Earth");
      this.sel = "";
      world().then((w) => { this.w = w; if (w) svgEl("path", { class: "land", d: w.land }, this.landG); this.draw(); });
      var every = Math.max(10, Math.min(600, Number(this.config.interval) || 30));
      this.timer = setInterval(() => this.load(), every * 1000);
      this.load();
    }
    toMap(cx, cy) {
      var r = this.svg.getBoundingClientRect(), v = this.vb;
      var scale = Math.max(v.w / r.width, v.h / r.height);
      var ox = (r.width * scale - v.w) / 2, oy = (r.height * scale - v.h) / 2;
      return { x: v.x - ox + (cx - r.left) * scale, y: v.y - oy + (cy - r.top) * scale };
    }
    zoomBy(f, at) {
      var v = this.vb, c = at || { x: v.x + v.w / 2, y: v.y + v.h / 2 };
      var w = Math.max(12, Math.min(360, v.w * f)), k = w / v.w;
      this.setVB({ x: c.x - (c.x - v.x) * k, y: c.y - (c.y - v.y) * k, w: w, h: v.h * k });
    }
    setVB(v, quick) {
      v.w = Math.min(360, v.w); v.h = Math.min(150, v.h);
      v.x = Math.max(-v.w * 0.3, Math.min(360 - v.w * 0.7, v.x));
      v.y = Math.max(-v.h * 0.3, Math.min(150 - v.h * 0.7, v.y));
      this.vb = v;
      this.svg.setAttribute("viewBox", [v.x, v.y, v.w, v.h].map((n) => n.toFixed(2)).join(" "));
      if (!quick || !this.rafZoom) this.rafZoom = requestAnimationFrame(() => { this.rafZoom = 0; this.draw(); });
    }
    load() {
      var hass = this._hass;
      if (!hass || this.loading || document.hidden) return;
      this.loading = true;
      hass.callWS({ type: "call_service", domain: "nives", service: "dns_map", service_data: { minutes: this.minutes }, return_response: true })
        .then((r) => { this.data = (r && r.response) || {}; })
        .catch((err) => { this.data = { status: "error", error: err && err.code === "unauthorized" ? "réservé aux administrateurs" : "service indisponible (Igor 0.28 ou plus)" }; })
        .then(() => { this.loading = false; this.draw(); });
    }
    home() {
      // Home: Home Assistant's location, else its country, else Paris.
      var cfg = (this._hass && this._hass.config) || {};
      if (typeof cfg.latitude === "number" && typeof cfg.longitude === "number" && (cfg.latitude || cfg.longitude)) {
        return [cfg.longitude + 180, 90 - Math.max(-60, cfg.latitude)];
      }
      var c = this.w && this.w.c && this.w.c[(this.data && this.data.home) || ""];
      return c || [182.35, 41.15];
    }
    who(name) { return this.names[name] || name; }
    draw() {
      var d = this.data || {};
      var rows = (d.countries || []).filter((c) => this.w && this.w.c && this.w.c[c.cc]);
      this.arcG.innerHTML = ""; this.dotG.innerHTML = "";
      var h = this.home();
      var max = rows.reduce((m, c) => Math.max(m, c.count), 1);
      var flow = this.config.animate !== false;
      rows.slice().reverse().forEach((c) => {
        var p = this.w.c[c.cc];
        var dx = p[0] - h[0], dy = p[1] - h[1], dist = Math.sqrt(dx * dx + dy * dy);
        var zs = this.vb ? this.vb.w / 360 : 1;
        // Arcs in screen pixels (non-scaling strokes): as wide at any zoom.
        var wgt = 1 + 3.2 * Math.sqrt(c.count / max);
        var sel = c.cc === this.sel ? " sel" : "";
        if (dist > 1.5) {
          // A curve bowed upwards, more for the far ones.
          var mx = (h[0] + p[0]) / 2, my = (h[1] + p[1]) / 2 - Math.min(30, dist * 0.35);
          if (dist < 1.5 * zs) { mx = (h[0] + p[0]) / 2; }
          svgEl("path", { class: "arc" + (flow ? " flow" : "") + sel, d: "M" + h[0] + " " + h[1] + " Q" + mx + " " + my + " " + p[0] + " " + p[1], "stroke-width": wgt.toFixed(2) }, this.arcG);
        }
        var dot = svgEl("circle", { class: "dot" + sel, cx: p[0], cy: p[1], r: ((0.8 + 2.2 * Math.sqrt(c.count / max)) * Math.max(zs, 0.15)).toFixed(3) }, this.dotG);
        svgEl("title", {}, dot).textContent = countryName(c.cc) + " · " + c.count;
        dot.addEventListener("click", () => { if (this.justPanned) return; this.sel = this.sel === c.cc ? "" : c.cc; this.draw(); });
      });
      var hz = this.vb ? Math.max(this.vb.w / 360, 0.15) : 1;
      var ring = svgEl("circle", { class: "home-ring", cx: h[0], cy: h[1], r: (2.4 * hz).toFixed(3) }, this.dotG);
      ring.style.strokeWidth = (0.3 * hz).toFixed(3);
      svgEl("circle", { class: "home", cx: h[0], cy: h[1], r: (0.9 * hz).toFixed(3) }, this.dotG);
      // The summary and the list.
      var tot = d.located || 0;
      this.sum.textContent = d.status === "ok" ? rows.length + " pays · " + tot + " réponses" + (d.blocked ? " · " + d.blocked + " bloquées" : "") : "";
      this.note.textContent = d.status === "ok" ? (d.total ? Math.round((100 * tot) / d.total) + " % des requêtes situées" : "") : "";
      this.list.innerHTML = "";
      if (d.status !== "ok" || !rows.length) {
        var msg = !d.status ? "Lecture…" : d.status === "downloading" ? "Téléchargement des bases d'adresses (une fois par mois)…"
          : d.status === "ok" ? "Aucune réponse située sur la période." : "Indisponible : " + (d.error || d.status);
        el("div", "empty", this.list, msg);
        this.det.innerHTML = "";
        return;
      }
      rows.slice(0, this.big ? 8 : rows.length).forEach((c) => {
        var r = el("div", "c" + (c.cc === this.sel ? " sel" : ""), this.list);
        el("span", "n", r, countryName(c.cc) + (c.orgs && c.orgs.length ? " · " + c.orgs[0] : ""));
        el("span", "k", r, String(c.count));
        var b = el("div", "bar", r); el("i", "", b).style.width = Math.round((100 * c.count) / max) + "%";
        r.addEventListener("click", () => { this.sel = this.sel === c.cc ? "" : c.cc; this.draw(); });
      });
      // The detail of the chosen country (else the first).
      var cur = rows.find((c) => c.cc === this.sel) || rows[0];
      this.det.innerHTML = "";
      if (this.big && !this.sel) return;
      el("div", "", this.det, countryName(cur.cc) + " · " + cur.count + " réponses");
      var part = (title, items) => {
        if (!items.length) return;
        el("div", "h", this.det, title);
        items.forEach((t) => { el("div", "v", this.det, t); });
      };
      part("appareils", Object.keys(cur.devices || {}).map((k) => this.who(k) + " · " + cur.devices[k]));
      part("opérateurs", cur.orgs || []);
      part("domaines", cur.domains || []);
      var bb = d.blocked_by || {};
      if (!this.sel && Object.keys(bb).length) part("bloquées par appareil", Object.keys(bb).map((k) => this.who(k) + " · " + bb[k]));
    }
    disconnectedCallback() { if (this.timer) { clearInterval(this.timer); this.timer = null; this._built = false; this.shadowRoot.innerHTML = ""; } }
  }

  // ----- igor-wifi-card: who is on which Wi-Fi -----
  //   type: custom:igor-wifi-card
  //   title: wi-fi
  //   interval: 15                       # seconds between two reads
  //   names: { "AA:BB:CC:DD:EE:FF": tablette }
  //   ssids: [Maison, Objets]            # only these networks (else all)
  //   more: /igor-wall/wifi              # a « voisins › » link to that page
  // Read from the OpenWrt access points of the `nives:` block (nives.wifi_clients,
  // administrators only): per network its band, channel and devices, each
  // with its signal, its link rates and how long it has been connected.
  function duration(s) {
    if (s == null) return "";
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + " min";
    if (s < 86400) return Math.round(s / 3600) + " h";
    return Math.round(s / 86400) + " j";
  }
  class IgorWifiCard extends IgorCard {
    setConfig(config) {
      this.config = config || {};
      this.names = {};
      var n = this.config.names && typeof this.config.names === "object" ? this.config.names : {};
      Object.keys(n).forEach((k) => { this.names[String(k).toUpperCase()] = n[k]; });
      this.ssids = Array.isArray(this.config.ssids) ? this.config.ssids.map(String) : null;
    }
    getCardSize() { return 6; }
    build() {
      this.style([
        ".list { flex: 1; min-height: 0; overflow-y: auto; }",
        ".net { display: flex; justify-content: space-between; gap: 8px; margin-top: 8px; padding-bottom: 3px; border-bottom: 1px solid var(--line); }",
        ".net:first-child { margin-top: 0; }",
        ".net .s { color: var(--fg); letter-spacing: 0.06em; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
        ".net .i { color: var(--dim); font-size: 11px; white-space: nowrap; }",
        // Room for « ↓1201 ↑1201 Mb/s » and « 23 h 59 » at 11px, apart.
        ".d { display: grid; grid-template-columns: minmax(0, 1fr) 26px 11em 5.5em; column-gap: 12px; align-items: center; padding: 3px 0; border-bottom: 1px dashed var(--line); }",
        ".d .n { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
        ".d .n small { color: var(--faint); margin-left: 6px; }",
        ".d .r, .d .t { color: var(--dim); font-size: 11px; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
        "@media (max-width: 600px) { .d { grid-template-columns: minmax(0, 1fr) 26px auto; } .d .r { display: none; } }",
        ".sig { display: flex; gap: 2px; align-items: flex-end; height: 12px; }",
        ".sig i { width: 4px; background: var(--track); }",
        ".sig.ok i.on { background: var(--okc); } .sig.warn i.on { background: var(--wait); } .sig.bad i.on { background: var(--bad); }",
        ".ap { color: var(--dim); font-size: 10.5px; letter-spacing: 0.12em; text-transform: uppercase; margin: 10px 0 2px; }",
        ".empty { color: var(--dim); padding: 6px 0; }"
      ].join("\n"));
      var card = el("ha-card", "", this.shadowRoot);
      var top = el("div", "top", card);
      el("span", "t sub", top, (this.config.title || "wi-fi").toUpperCase()).style.letterSpacing = "0.12em";
      this.sum = el("span", "sub num", top);
      // `more: /a-page`: a link to another page (the neighbours' networks).
      if (this.config.more) {
        var mo = el("button", "link", top, this.config.more_label || "voisins ›");
        mo.type = "button";
        mo.addEventListener("click", () => navigate(String(this.config.more)));
      }
      this.list = el("div", "list", card);
      var every = Math.max(5, Math.min(300, Number(this.config.interval) || 15));
      this.timer = setInterval(() => this.load(), every * 1000);
      this.load();
    }
    load() {
      var hass = this._hass;
      if (!hass || this.loading || document.hidden) return;
      this.loading = true;
      hass.callWS({ type: "call_service", domain: "nives", service: "wifi_clients", service_data: {}, return_response: true })
        .then((r) => { this.data = (r && r.response) || {}; })
        .catch((err) => { this.data = { error: err && err.code === "unauthorized" ? "réservé aux administrateurs" : "service indisponible (Igor 0.29 ou plus)" }; })
        .then(() => { this.loading = false; this.draw(); });
    }
    draw() {
      var d = this.data || {};
      var aps = d.aps || [];
      this.list.innerHTML = "";
      var total = 0;
      if (!aps.length) {
        el("div", "empty", this.list, d.error ? "Indisponible : " + d.error : "Lecture…");
        this.sum.textContent = "";
        return;
      }
      aps.forEach((ap) => {
        if (aps.length > 1) el("div", "ap", this.list, ap.name);
        if (ap.error) { el("div", "empty", this.list, "Injoignable : " + ap.error); return; }
        (ap.radios || []).filter((x) => !this.ssids || this.ssids.indexOf(x.ssid) >= 0).forEach((x) => {
          var head = el("div", "net", this.list);
          el("span", "s", head, x.ssid);
          el("span", "i", head, [x.band, x.channel ? "canal " + x.channel : "", x.clients.length + " appareil" + (x.clients.length > 1 ? "s" : "")].filter(Boolean).join(" · "));
          total += x.clients.length;
          if (!x.clients.length) { el("div", "empty", this.list, "Personne."); return; }
          x.clients.forEach((c) => {
            var row = el("div", "d", this.list);
            var n = el("span", "n", row, this.names[c.mac] || c.name || c.mac);
            if (c.ip) el("small", "", n, c.ip);
            n.title = c.mac + (c.ip ? " · " + c.ip : "");
            var lvl = c.signal == null ? 0 : c.signal >= -55 ? 4 : c.signal >= -65 ? 3 : c.signal >= -72 ? 2 : 1;
            var sig = el("span", "sig " + (lvl >= 3 ? "ok" : lvl === 2 ? "warn" : "bad"), row);
            sig.title = c.signal == null ? "" : c.signal + " dBm";
            for (var i = 1; i <= 4; i++) { var b = el("i", i <= lvl ? "on" : "", sig); b.style.height = 3 * i + "px"; }
            el("span", "r", row, c.rx != null || c.tx != null ? "↓" + fr(c.rx, 0) + " ↑" + fr(c.tx, 0) + " Mb/s" : "");
            el("span", "t", row, duration(c.connected));
          });
        });
      });
      this.sum.textContent = total + " appareil" + (total > 1 ? "s" : "");
    }
    disconnectedCallback() { if (this.timer) { clearInterval(this.timer); this.timer = null; this._built = false; this.shadowRoot.innerHTML = ""; } }
  }

  // ----- igor-netmap-card: the network by VLAN, to look after it -----
  //   type: custom:igor-netmap-card
  //   title: schéma · en direct
  //   interval: 10          # seconds between two reads
  //   names: { 192.168.1.20: nas }
  //   animate: true         # dots running along the flows (false: still)
  //   key: mur              # where the layout is remembered (else the page)
  // Read from OPNsense (nives.net_map, administrators only). OPNsense on top,
  // each network (VLAN) a block linked to it with its gateway and devices,
  // the internet's operators on the right. Flows go from one network to the
  // other through OPNsense, their width by traffic.
  // Toolbar: layout (Par VLAN, Arbre, Libre), zoom, the networks shown, the
  // internet and the traffic on or off, a search, « réinitialiser ».
  // A device or a whole block moves with the finger or the mouse (the layout
  // becomes « Libre » and is remembered on this screen); the wheel zooms, a
  // drag on the background pans. A tap on OPNsense gives the traffic network
  // by network and what to check; on a block, its gateway, devices and
  // flows; on a device, its address, Wi-Fi and connections.
  // Only what crosses the router is seen: two devices of the same network
  // talk out of its sight.
  var NET_COLORS = ["#59d0e0", "#5cc28f", "#e0a33a", "#b48ce0", "#e08aa8", "#8fb8f0", "#d0d070", "#f0906a"];
  function human(b) {
    if (!b) return "0 o";
    var u = ["o", "ko", "Mo", "Go", "To"], i = 0;
    while (b >= 1000 && i < u.length - 1) { b /= 1000; i++; }
    return fr(b, b < 10 && i ? 1 : 0) + " " + u[i];
  }
  function prefs(key, val) {
    try {
      if (val === undefined) return JSON.parse(window.localStorage.getItem(key) || "null");
      window.localStorage.setItem(key, JSON.stringify(val));
    } catch (e) { return null; }
    return null;
  }
  class IgorNetmapCard extends IgorCard {
    setConfig(config) {
      this.config = config || {};
      this.names = this.config.names && typeof this.config.names === "object" ? this.config.names : {};
    }
    getCardSize() { return 12; }
    build() {
      this.key = "igor-netmap:" + (this.config.key || window.location.pathname);
      var saved = prefs(this.key) || {};
      this.mode = saved.mode || "vlan";
      this.pos = saved.pos || {};
      this.off = saved.hidden || {};
      // On a phone the internet starts hidden (the world map shows it).
      this.showNet = saved.net === undefined ? window.innerWidth >= 600 : saved.net !== false;
      this.showFlow = saved.flow !== false;
      this.showBlocked = saved.blocked !== false;
      this.matrix = false;
      this.view = { k: 1, x: 0, y: 0 };
      this.sel = "";
      this.q = "";
      this.W = 900; this.H = 560;
      this.style([
        ".tool { display: flex; gap: 5px; flex-wrap: wrap; align-items: center; margin: 2px 0 6px; flex: none; }",
        ".tool .sp { width: 10px; }",
        ".tool button { background: none; border: 1px solid var(--line); color: var(--fg); font: inherit; font-size: 11px; border-radius: var(--igor-radius, 3px); padding: 2px 8px; cursor: pointer; }",
        ".tool button.on { border-color: var(--acc); color: var(--acc); }",
        ".tool button.chip { border-radius: var(--igor-radius, 3px); }",
        ".tool button.chip.off { opacity: 0.35; }",
        ".tool input { width: 120px; background: var(--bg); border: 1px solid var(--line); color: var(--fg); font: inherit; font-size: 11px; padding: 2px 7px; border-radius: var(--igor-radius, 3px); }",
        ".body { flex: 1; min-height: 0; display: flex; gap: 10px; }",
        ".stage { flex: 1; min-width: 0; min-height: max(300px, 55vh); position: relative; border: 1px solid var(--line); background: var(--bg); touch-action: none; }",
        "svg.net { position: absolute; inset: 0; width: 100%; height: 100%; display: block; cursor: grab; user-select: none; }",
        ".side { width: 270px; flex: none; overflow-y: auto; min-height: 0; }",
        "@media (max-width: 900px) { .body { flex-direction: column; } .side { width: auto; max-height: 40vh; } }",
        // A phone: one toolbar row that scrolls, the map at most of the
        // screen, the detail under it, the card scrolling.
        "@media (max-width: 600px) { ha-card { overflow-y: auto; } .tool { flex-wrap: nowrap; overflow-x: auto; padding-bottom: 4px; scrollbar-width: none; } .tool > * { flex: none; }"
        + " .body { flex: none; } .stage { flex: none; height: 64vh; min-height: 320px; } .side { max-height: none; overflow: visible; } }",
        "text { font-family: " + MONO + "; font-size: 10.5px; fill: var(--dim); pointer-events: none; }",
        "text.hl { fill: var(--fg); }",
        ".blk rect.b { stroke-width: 1; }",
        ".blk .bh { cursor: move; }",
        ".topo { stroke: var(--line); fill: none; stroke-width: 1.2; }",
        ".topo.wan { stroke: var(--faint); stroke-dasharray: 3 3; }",
        ".flow { fill: none; stroke-linecap: round; stroke-linejoin: round; opacity: 0.45; }",
        ".flow.dim, .pkt.dim, .nd.dim { opacity: 0.12; }",
        ".refused { fill: none; stroke: #e5323b; stroke-dasharray: 5 5; stroke-linecap: round; opacity: 0.85; }",
        ".refused.dim { opacity: 0.12; }",
        ".badge { fill: #e5323b; font-size: 10px; }",
        ".mat { position: absolute; inset: 0; overflow: auto; background: var(--bg); padding: 10px; box-sizing: border-box; }",
        ".mat table { border-collapse: collapse; font-size: 11px; }",
        ".mat th { color: var(--dim); font-weight: 400; padding: 4px 6px; white-space: nowrap; text-align: left; }",
        ".mat th.v { writing-mode: vertical-rl; transform: rotate(180deg); text-align: left; height: 90px; }",
        ".mat td { border: 1px solid var(--line); padding: 4px 6px; min-width: 64px; vertical-align: top; cursor: pointer; }",
        ".mat td.self { background: #0e1013; cursor: default; }",
        ".mat td.sel { outline: 2px solid var(--igor-signal, #e5323b); }",
        ".mat .ok { color: #5cc28f; display: block; } .mat .ko { color: #e5323b; display: block; } .mat .sv { color: var(--dim); display: block; font-size: 10px; max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }",
        ".mat .hint { color: var(--dim); margin-top: 8px; }",
        ".rule { display: grid; grid-template-columns: 6ch minmax(0, 1fr); gap: 6px; padding: 2px 0; border-bottom: 1px dashed var(--line); }",
        ".rule .act { color: #5cc28f; } .rule .act.block, .rule .act.reject { color: #e5323b; } .rule.off { opacity: 0.45; }",
        ".flow.sel { opacity: 1; }",
        ".nd { cursor: pointer; }",
        ".nd circle.r { fill: var(--bg); stroke: var(--fg); stroke-width: 2; }",
        ".nd circle.n { fill: var(--bg); stroke: var(--dim); stroke-width: 1.2; stroke-dasharray: 2 2; }",
        ".nd.sel circle { stroke: var(--igor-signal, #e5323b); stroke-width: 2.5; }",
        ".nd.hit circle { stroke: var(--wait); stroke-width: 2.5; }",
        ".h { color: var(--dim); font-size: 10.5px; letter-spacing: 0.12em; text-transform: uppercase; margin: 8px 0 3px; }",
        ".h:first-child { margin-top: 0; }",
        ".v { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
        ".big { color: var(--fg); font-size: 13px; margin-bottom: 2px; }",
        ".p { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px; padding: 2px 0; border-bottom: 1px dashed var(--line); cursor: default; }",
        ".p.link { cursor: pointer; }",
        ".p span:last-child { color: var(--dim); font-variant-numeric: tabular-nums; white-space: nowrap; }",
        ".dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; vertical-align: 0; }",
        ".warn { color: var(--wait); }",
        ".empty { color: var(--dim); padding: 8px 0; }"
      ].join("\n"));
      var card = el("ha-card", "", this.shadowRoot);
      var top = el("div", "top", card);
      el("span", "t sub", top, (this.config.title || "schéma · en direct").toUpperCase()).style.letterSpacing = "0.12em";
      this.sum = el("span", "sub num", top);
      var tool = el("div", "tool no-swipe", card);
      var btn = (text, fn, cls) => { var b = el("button", cls || "", tool, text); b.type = "button"; b.addEventListener("click", fn); return b; };
      this.modeBtns = {};
      [["vlan", "Par VLAN"], ["tree", "Arbre"], ["free", "Libre"]].forEach((m) => {
        this.modeBtns[m[0]] = btn(m[1], () => this.setMode(m[0]));
      });
      el("span", "sp", tool);
      btn("−", () => this.zoom(1 / 1.25));
      btn("+", () => this.zoom(1.25));
      btn("ajuster", () => this.fit());
      el("span", "sp", tool);
      this.chips = el("span", "", tool);
      this.chips.style.display = "contents";
      el("span", "sp", tool);
      this.netBtn = btn("internet", () => { this.showNet = !this.showNet; this.save(); this.relayout(); });
      this.flowBtn = btn("trafic", () => { this.showFlow = !this.showFlow; this.save(); this.draw(); });
      this.blockBtn = btn("refusé", () => { this.showBlocked = !this.showBlocked; this.save(); this.draw(); });
      this.matBtn = btn("matrice", () => { this.matrix = !this.matrix; this.draw(); });
      this.search = el("input", "", tool);
      this.search.placeholder = "⌕ appareil…";
      this.search.addEventListener("input", () => { this.q = this.search.value.trim().toLowerCase(); this.draw(); });
      this.search.addEventListener("keydown", (ev) => { if (ev.key === "Enter") this.findFirst(); });
      btn("réinitialiser", () => { this.pos = {}; this.off = {}; this.mode = "vlan"; this.save(); this.relayout(true); });
      var body = el("div", "body", card);
      this.stage = el("div", "stage no-swipe", body);
      this.svg = svgEl("svg", { class: "net" }, this.stage);
      this.vp = svgEl("g", {}, this.svg);
      this.side = el("div", "side", body);
      this.bindPointer();
      if (window.ResizeObserver) {
        this.ro = new ResizeObserver(() => {
          var r = this.stage.getBoundingClientRect();
          if (r.width < 50 || r.height < 50) return;
          if (Math.abs(r.width - this.W) < 2 && Math.abs(r.height - this.H) < 2) return;
          this.W = r.width; this.H = r.height;
          this.svg.setAttribute("viewBox", "0 0 " + this.W + " " + this.H);
          this.relayout(true);
        });
        this.ro.observe(this.stage);
      }
      this.pkts = [];
      var every = Math.max(5, Math.min(300, Number(this.config.interval) || 10));
      this.timer = setInterval(() => this.load(), every * 1000);
      this.load();
      if (this.config.animate !== false) {
        var step = (t) => { this.frame = requestAnimationFrame(step); this.move(t); };
        this.frame = requestAnimationFrame(step);
      }
    }
    save() { prefs(this.key, { mode: this.mode, pos: this.pos, hidden: this.off, net: this.showNet, flow: this.showFlow, blocked: this.showBlocked }); }
    load() {
      var hass = this._hass;
      if (!hass || this.loading || document.hidden || this.dragging) return;
      this.loading = true;
      hass.callWS({ type: "call_service", domain: "nives", service: "net_map", service_data: {}, return_response: true })
        .then((r) => { this.data = (r && r.response) || {}; })
        .catch((err) => { this.data = { error: err && err.code === "unauthorized" ? "réservé aux administrateurs" : "service indisponible (Igor 0.31 ou plus)" }; })
        .then(() => { this.loading = false; var first = !this.laid; this.relayout(first); });
    }
    label(n) {
      if (!n) return "";
      return this.names[n.ip] || this.names[n.mac] || n.name || n.id;
    }
    // ----- the model: networks, devices, operators -----
    model() {
      var d = this.data || {};
      var nodes = d.nodes || [];
      var byId = {};
      nodes.forEach((n) => { byId[n.id] = n; });
      var gw = {};
      (d.vlans || []).forEach((v) => { gw[v.name] = v.gateway; });
      var vlans = [];
      var add = (v) => { if (vlans.indexOf(v) < 0) vlans.push(v); };
      (d.vlans || []).forEach((v) => add(v.name));
      nodes.forEach((n) => { if (n.kind === "device") add(n.vlan || "autre"); });
      vlans.sort();
      var color = {};
      vlans.forEach((v, i) => { color[v] = NET_COLORS[i % NET_COLORS.length]; });
      var devs = {};
      vlans.forEach((v) => { devs[v] = []; });
      nodes.forEach((n) => { if (n.kind === "device") devs[n.vlan || "autre"].push(n); });
      vlans.forEach((v) => devs[v].sort((a, b) => this.label(a).localeCompare(this.label(b))));
      var remotes = nodes.filter((n) => n.kind === "remote");
      return { d: d, byId: byId, gw: gw, vlans: vlans, color: color, devs: devs, remotes: remotes, edges: d.edges || [] };
    }
    vlanOf(id) {
      var n = this.M.byId[id];
      if (!n) return "";
      if (n.kind === "device") return n.vlan || "autre";
      if (n.kind === "remote") return "internet";
      return "router";
    }
    shown(id) {
      var n = this.M.byId[id];
      if (!n) return false;
      if (n.kind === "device") return !this.off[n.vlan || "autre"];
      if (n.kind === "remote") return this.showNet;
      return true;
    }
    // ----- layouts -----
    relayout(fit) {
      if (!this.data) return;
      this.M = this.model();
      this.renderChips();
      if (this.data.error) { this.draw(); return; }
      this.layout();
      this.laid = true;
      if (fit) this.fit(true);
      this.draw();
    }
    layout() {
      var M = this.M, H = this.H, m = 16;
      var P = {}, B = {}, hubs = {};
      var net = this.showNet && M.remotes.length;
      // A narrow screen with the internet: laid out wider, then fitted, so
      // the blocks keep room for their names.
      var W = net && this.W < 640 ? 640 : this.W;
      var rw = net ? 190 : 0;
      var AW = W - 2 * m - (net ? rw + 14 : 0);
      var vis = M.vlans.filter((v) => !this.off[v]);
      if (net) {
        // The internet on the right: a trunk going down, operators beside it.
        var tx = W - m - rw + 12;
        P["net:hub"] = { x: tx, y: 44 };
        M.remotes.forEach((r, i) => { P[r.id] = { x: tx + 24, y: 92 + i * 26 }; });
      }
      if (this.mode === "tree") {
        // A tree read left to right: OPNsense, its networks, their devices.
        // The network's name above its hub, its gateway under it; a bus at
        // `treeBus` takes each device's flow between the rows, never across
        // a name.
        P.router = { x: m + 26, y: 44 };
        var colw = 175, x0 = m + 270, per = Math.max(1, Math.floor((m + AW - x0) / colw)), y = 112;
        this.treeBus = m + 250;
        vis.forEach((v) => {
          var list = M.devs[v];
          hubs[v] = { x: m + 70, y: y };
          list.forEach((dv, j) => { P[dv.id] = { x: x0 + (j % per) * colw, y: y + Math.floor(j / per) * 26 }; });
          y += Math.max(1, Math.ceil(list.length / per)) * 26 + 34;
        });
      } else {
        P.router = { x: m + AW / 2, y: 44 };
        var gap = 14, minw = 230;
        var cols = Math.max(1, Math.min(vis.length || 1, Math.floor((AW + gap) / (minw + gap))));
        var bw = (AW - (cols - 1) * gap) / cols;
        var yy = 96, rowH = 0;
        vis.forEach((v, i) => {
          var c = i % cols;
          if (c === 0 && i) { yy += rowH + gap; rowH = 0; }
          var list = M.devs[v];
          var inner = list.length > 8 && bw >= 400 ? 2 : 1;
          var rows = Math.max(1, Math.ceil(list.length / inner));
          var bh = 34 + rows * 24 + 6;
          var bx = m + c * (bw + gap);
          B[v] = { x: bx, y: yy, w: bw, h: bh };
          rowH = Math.max(rowH, bh);
          list.forEach((dv, j) => {
            P[dv.id] = { x: bx + 24 + (j % inner) * (bw / inner), y: yy + 34 + Math.floor(j / inner) * 24 + 10 };
          });
        });
      }
      if (this.mode === "free") {
        // Saved positions win; blocks follow their devices.
        Object.keys(P).forEach((id) => { if (this.pos[id]) P[id] = { x: this.pos[id][0], y: this.pos[id][1] }; });
        vis.forEach((v) => {
          var list = M.devs[v].filter((dv) => P[dv.id]);
          if (!list.length) { if (B[v] && this.pos["vlan:" + v]) { B[v].x = this.pos["vlan:" + v][0]; B[v].y = this.pos["vlan:" + v][1]; } return; }
          var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
          list.forEach((dv) => { var p = P[dv.id]; x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); });
          B[v] = { x: x0 - 24, y: y0 - 44, w: Math.max(230, x1 - x0 + 190), h: y1 - y0 + 60 };
        });
      }
      this.busY = 74;
      this.P = P; this.B = B; this.hubs = hubs;
    }
    // Where a network meets OPNsense: its block's top left corner, or its hub.
    vlanAnchor(v) {
      if (this.mode === "tree") return this.hubs[v] || null;
      var b = this.B[v];
      return b ? { x: b.x - 6, y: b.y + 13 } : null;
    }
    setMode(m) {
      if (m === "free" && this.mode !== "free") this.freeze();
      this.mode = m;
      this.save();
      this.relayout(true);
    }
    // Into « Libre » keeping what is on screen.
    freeze() {
      var P = this.P || {};
      Object.keys(P).forEach((id) => { this.pos[id] = [Math.round(P[id].x), Math.round(P[id].y)]; });
      this.mode = "free";
    }
    // ----- view: zoom and pan -----
    apply() { this.vp.setAttribute("transform", "translate(" + this.view.x.toFixed(1) + " " + this.view.y.toFixed(1) + ") scale(" + this.view.k.toFixed(3) + ")"); }
    zoom(f, cx, cy) {
      var v = this.view;
      cx = cx == null ? this.W / 2 : cx; cy = cy == null ? this.H / 2 : cy;
      var k = Math.max(0.25, Math.min(4, v.k * f));
      f = k / v.k;
      v.x = cx - (cx - v.x) * f; v.y = cy - (cy - v.y) * f; v.k = k;
      this.apply();
    }
    fit(onlyIfNeeded) {
      var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      var grow = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
      Object.keys(this.P || {}).forEach((id) => { var p = this.P[id]; grow(p.x - 20, p.y - 20); grow(p.x + 160, p.y + 20); });
      Object.keys(this.B || {}).forEach((v) => { var b = this.B[v]; grow(b.x, b.y); grow(b.x + b.w, b.y + b.h); });
      if (!isFinite(x0)) { this.view = { k: 1, x: 0, y: 0 }; this.apply(); return; }
      var k = Math.min(1.6, (this.W - 16) / (x1 - x0), (this.H - 16) / (y1 - y0));
      if (onlyIfNeeded && k >= 1 && x0 >= 0 && y0 >= 0 && x1 <= this.W && y1 <= this.H) { this.view = { k: 1, x: 0, y: 0 }; this.apply(); return; }
      this.view = { k: k, x: (this.W - (x1 - x0) * k) / 2 - x0 * k, y: 8 - y0 * k };
      this.apply();
    }
    // ----- the pointer: select, move, pan, zoom -----
    bindPointer() {
      var svg = this.svg;
      svg.addEventListener("wheel", (ev) => {
        ev.preventDefault();
        var r = svg.getBoundingClientRect();
        this.zoom(Math.exp(-ev.deltaY * 0.0015), ev.clientX - r.left, ev.clientY - r.top);
      }, { passive: false });
      // Two fingers zoom around their middle; one finger moves or pans.
      var fingers = {};
      var pinch = () => {
        var ids = Object.keys(fingers);
        if (ids.length < 2) return null;
        var a = fingers[ids[0]], b = fingers[ids[1]];
        return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      };
      svg.addEventListener("pointerdown", (ev) => {
        fingers[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
        if (Object.keys(fingers).length >= 2) {
          this.drag = null;
          this.pinch = pinch();
          this.dragging = true;
          svg.setPointerCapture(ev.pointerId);
          return;
        }
        var t = ev.target.closest ? ev.target.closest("[data-id],[data-vlan]") : null;
        this.drag = { x: ev.clientX, y: ev.clientY, id: t && t.getAttribute("data-id"), vlan: t && t.getAttribute("data-vlan"), moved: false };
        svg.setPointerCapture(ev.pointerId);
      });
      svg.addEventListener("pointermove", (ev) => {
        if (fingers[ev.pointerId]) fingers[ev.pointerId] = { x: ev.clientX, y: ev.clientY };
        if (this.pinch) {
          var now = pinch();
          if (!now) return;
          var r = svg.getBoundingClientRect();
          this.view.x += now.x - this.pinch.x; this.view.y += now.y - this.pinch.y;
          this.zoom(now.d / this.pinch.d, now.x - r.left, now.y - r.top);
          this.pinch = now;
          return;
        }
        var g = this.drag;
        if (!g) return;
        var dx = ev.clientX - g.x, dy = ev.clientY - g.y;
        if (!g.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
        g.moved = true;
        this.dragging = true;
        g.x = ev.clientX; g.y = ev.clientY;
        if (!g.id && !g.vlan) { this.view.x += dx; this.view.y += dy; this.apply(); return; }
        if (this.mode !== "free") { this.freeze(); this.layout(); this.renderModes(); }
        var wx = dx / this.view.k, wy = dy / this.view.k;
        var movePos = (id) => {
          var p = this.pos[id] || (this.P[id] ? [this.P[id].x, this.P[id].y] : null);
          if (p) this.pos[id] = [p[0] + wx, p[1] + wy];
        };
        if (g.vlan) {
          (this.M.devs[g.vlan] || []).forEach((dv) => movePos(dv.id));
          var b = this.B[g.vlan];
          if (b) this.pos["vlan:" + g.vlan] = [b.x + wx, b.y + wy];
        } else movePos(g.id === "net:hub" ? "net:hub" : g.id);
        if (!this.rafDraw) this.rafDraw = requestAnimationFrame(() => { this.rafDraw = 0; this.layout(); this.draw(); });
      });
      var end = (ev) => {
        delete fingers[ev.pointerId];
        if (this.pinch) {
          if (Object.keys(fingers).length < 2) { this.pinch = null; this.dragging = false; this.drag = null; }
          return;
        }
        var g = this.drag;
        this.drag = null;
        this.dragging = false;
        if (!g) return;
        if (g.moved) { this.save(); return; }
        var target = g.vlan ? "vlan:" + g.vlan : g.id || "";
        this.sel = this.sel === target ? "" : target;
        this.draw();
        // On a phone the detail is under the map: bring it into sight.
        if (this.sel && this.W < 600 && this.side.scrollIntoView) this.side.scrollIntoView({ behavior: "smooth", block: "nearest" });
      };
      svg.addEventListener("pointerup", end);
      svg.addEventListener("pointercancel", end);
    }
    findFirst() {
      if (!this.q || !this.M) return;
      var hit = Object.values(this.M.byId).find((n) => n.kind !== "router" && this.label(n).toLowerCase().indexOf(this.q) >= 0 || (n.ip || "").indexOf(this.q) >= 0);
      if (!hit || !this.P[hit.id]) return;
      this.sel = hit.id;
      var p = this.P[hit.id];
      this.view.x = this.W / 2 - p.x * this.view.k; this.view.y = this.H / 2 - p.y * this.view.k;
      this.apply();
      this.draw();
    }
    // ----- toolbar -----
    renderModes() {
      Object.keys(this.modeBtns).forEach((k) => this.modeBtns[k].classList.toggle("on", this.mode === k));
      this.netBtn.classList.toggle("on", this.showNet);
      this.flowBtn.classList.toggle("on", this.showFlow);
      this.blockBtn.classList.toggle("on", this.showBlocked);
      this.matBtn.classList.toggle("on", this.matrix);
    }
    renderChips() {
      this.chips.innerHTML = "";
      (this.M.vlans || []).forEach((v) => {
        var b = el("button", "chip" + (this.off[v] ? " off" : ""), this.chips, v || "?");
        b.type = "button";
        b.style.color = this.M.color[v]; b.style.borderColor = this.M.color[v];
        b.addEventListener("click", () => { if (this.off[v]) delete this.off[v]; else this.off[v] = 1; this.save(); this.relayout(); });
      });
      this.renderModes();
    }
    // ----- drawing -----
    flowPath(e) {
      var P = this.P, a = P[e.a], b = P[e.b];
      if (!a || !b) return "";
      var va = this.vlanOf(e.a), vb = this.vlanOf(e.b);
      var f = (p) => p.x.toFixed(1) + " " + p.y.toFixed(1);
      if (va === vb && va !== "internet" && va !== "router") {
        var mx = (a.x + b.x) / 2 + 30, my = (a.y + b.y) / 2;
        return "M" + f(a) + " Q" + mx.toFixed(1) + " " + my.toFixed(1) + " " + f(b);
      }
      var R = P.router, hub = P["net:hub"];
      var leg = (p, v) => {
        // From a device to its network's edge, along it to OPNsense.
        if (v === "router") return [p];
        if (v === "internet") return hub ? [p, { x: hub.x, y: p.y }, hub] : [p];
        var an = this.vlanAnchor(v);
        if (!an) return [p];
        // In a tree, between the rows (not through the names), then down the trunk.
        if (this.mode === "tree") {
          var bus = this.treeBus;
          return [p, { x: p.x - 13, y: p.y }, { x: p.x - 13, y: p.y - 13 }, { x: bus, y: p.y - 13 }, { x: bus, y: an.y }, { x: an.x + 12, y: an.y }];
        }
        // Up into the gap above the row, along it to the block's edge (never
        // across a name), then up to the bus under OPNsense.
        return [p, { x: p.x - 13, y: p.y }, { x: p.x - 13, y: p.y - 12 }, { x: an.x, y: p.y - 12 }, { x: an.x, y: this.busY }];
      };
      var A = leg(a, va), Bp = leg(b, vb).reverse();
      // OPNsense: reached straight down from it in a tree, by the top otherwise.
      var mid = this.mode === "tree" ? [{ x: R.x, y: A[A.length - 1].y }, R, { x: R.x, y: Bp[0].y }]
        : [{ x: R.x, y: A[A.length - 1].y }, R, { x: R.x, y: Bp[0].y }];
      var pts = A.concat(mid).concat(Bp);
      var d = "M" + f(pts[0]);
      for (var i = 1; i < pts.length; i++) d += " L" + f(pts[i]);
      return d;
    }
    draw() {
      this.renderModes();
      var M = this.M;
      this.vp.innerHTML = "";
      this.side.innerHTML = "";
      this.pkts = [];
      var d = (M && M.d) || this.data || {};
      if (!M || d.error || !(d.nodes || []).length) {
        this.sum.textContent = "";
        el("div", "empty", this.side, d.error ? "Indisponible : " + d.error : "Lecture…");
        return;
      }
      var gBlk = svgEl("g", {}, this.vp), gTopo = svgEl("g", {}, this.vp), gFlow = svgEl("g", {}, this.vp),
        gPkt = svgEl("g", {}, this.vp), gNode = svgEl("g", {}, this.vp);
      var P = this.P, sel = this.sel, selV = sel.indexOf("vlan:") === 0 ? sel.slice(5) : "";
      var pair = sel.indexOf("pair:") === 0 ? sel.slice(5).split("→") : null;
      var involved = (e) => !sel || e.a === sel || e.b === sel || (selV && (this.vlanOf(e.a) === selV || this.vlanOf(e.b) === selV)) ||
        (pair && this.vlanOf(e.a) === pair[0] && this.vlanOf(e.b) === pair[1]) ||
        (sel === "router") || (sel === "net:hub" && (this.vlanOf(e.a) === "internet" || this.vlanOf(e.b) === "internet"));
      var vis = M.vlans.filter((v) => !this.off[v]);
      // Blocks (or hubs) and their links to OPNsense.
      vis.forEach((v) => {
        var c = M.color[v];
        var an = this.vlanAnchor(v);
        if (an) svgEl("path", { class: "topo", d: this.mode === "tree"
          ? "M" + P.router.x + " " + P.router.y + " L" + P.router.x + " " + an.y.toFixed(1) + " L" + (an.x - 11).toFixed(1) + " " + an.y.toFixed(1)
          : "M" + P.router.x + " " + P.router.y + " L" + P.router.x + " " + this.busY + " L" + an.x.toFixed(1) + " " + this.busY + " L" + an.x.toFixed(1) + " " + an.y.toFixed(1) + " L" + (an.x + 6).toFixed(1) + " " + an.y.toFixed(1) }, gTopo);
        if (this.mode === "tree") {
          var h = this.hubs[v];
          if (!h) return;
          var g = svgEl("g", { class: "nd blk" + (selV === v ? " sel" : ""), "data-vlan": v, transform: "translate(" + h.x.toFixed(1) + " " + h.y.toFixed(1) + ")" }, gNode);
          svgEl("circle", { r: 11, fill: c + "33", stroke: c, "stroke-width": 2 }, g);
          var t = svgEl("text", { x: 16, y: -9, class: "hl" }, g); t.textContent = v; t.style.fill = c;
          var t2 = svgEl("text", { x: 16, y: 19 }, g); t2.textContent = (M.gw[v] || "") + " · " + M.devs[v].length;
          var bus = this.treeBus;
          M.devs[v].forEach((dv) => {
            var p = P[dv.id];
            if (p) svgEl("path", { class: "topo", d: "M" + (h.x + 12).toFixed(1) + " " + h.y.toFixed(1) + " L" + bus + " " + h.y.toFixed(1) +
              " L" + bus + " " + (p.y - 13).toFixed(1) + " L" + (p.x - 13).toFixed(1) + " " + (p.y - 13).toFixed(1) + " L" + (p.x - 13).toFixed(1) + " " + p.y.toFixed(1) + " L" + (p.x - 7).toFixed(1) + " " + p.y.toFixed(1) }, gTopo);
          });
          return;
        }
        var b = this.B[v];
        if (!b) return;
        var bg = svgEl("g", { class: "blk" }, gBlk);
        svgEl("rect", { class: "b", x: b.x, y: b.y, width: b.w, height: b.h, fill: c + "14", stroke: selV === v ? "var(--igor-signal, #e5323b)" : c }, bg);
        var hr = svgEl("rect", { class: "bh", "data-vlan": v, x: b.x, y: b.y, width: b.w, height: 26, fill: c + "22" }, bg);
        hr.style.cursor = "move";
        var ht = svgEl("text", { x: b.x + 18, y: b.y + 17 }, bg); ht.textContent = v.toUpperCase(); ht.style.fill = c; ht.style.letterSpacing = "0.08em";
        // The gateway only where it fits beside the name (else in the detail).
        var right = (M.gw[v] ? M.gw[v] + " · " : "") + M.devs[v].length;
        if (18 + v.length * 7.2 + 14 + right.length * 6.4 + 8 > b.w) right = String(M.devs[v].length);
        var hr2 = svgEl("text", { x: b.x + b.w - 8, y: b.y + 17, "text-anchor": "end" }, bg); hr2.textContent = right;
      });
      if (this.showNet && P["net:hub"]) {
        svgEl("path", { class: "topo wan", d: "M" + P.router.x + " " + P.router.y + " L" + P["net:hub"].x + " " + P["net:hub"].y }, gTopo);
        M.remotes.forEach((r) => { var p = P[r.id]; if (p) svgEl("path", { class: "topo", d: "M" + P["net:hub"].x + " " + (P["net:hub"].y + 12) + " L" + P["net:hub"].x + " " + p.y + " L" + (p.x - 6) + " " + p.y }, gTopo); });
      }
      // Flows, through OPNsense.
      var edges = M.edges.filter((e) => this.shown(e.a) && this.shown(e.b) && P[e.a] && P[e.b]);
      var maxB = edges.reduce((mx, e) => Math.max(mx, e.bytes), 1);
      var flow = this.config.animate !== false;
      if (this.showFlow) {
        edges.forEach((e) => {
          var dp = this.flowPath(e);
          if (!dp) return;
          var on = involved(e);
          var va = this.vlanOf(e.a);
          var col = M.color[va] || "var(--acc)";
          var w = 0.8 + 2.4 * Math.sqrt(Math.log(1 + e.bytes) / Math.log(1 + maxB));
          var path = svgEl("path", { class: "flow" + (on ? (sel ? " sel" : "") : " dim"), d: dp, stroke: col, "stroke-width": w.toFixed(2) }, gFlow);
          if (flow && this.pkts.length < 140 && on) {
            var n = e.bytes > maxB / 4 ? 3 : e.bytes > maxB / 50 ? 2 : 1;
            var len = path.getTotalLength ? path.getTotalLength() : 0;
            for (var i = 0; i < n && len; i++) {
              var dot = svgEl("circle", { class: "pkt", r: (1.4 + w / 3).toFixed(1), fill: col }, gPkt);
              this.pkts.push({ el: dot, path: path, len: len, off: i / n, speed: 60 + 50 * Math.random() });
            }
          }
        });
      }
      // What the firewall refused: red dashes, the same way through OPNsense.
      var refused = (d.blocked || []).filter((e) => this.shown(e.a) && this.shown(e.b) && P[e.a] && P[e.b]);
      if (this.showBlocked) {
        refused.forEach((e) => {
          var dp = this.flowPath(e);
          if (!dp) return;
          var on = involved(e);
          svgEl("path", { class: "refused" + (on ? "" : " dim"), d: dp, "stroke-width": (1 + Math.min(2.5, Math.log10(1 + e.count))).toFixed(2) }, gFlow);
        });
      }
      // Each block's refused count, in its header.
      if (this.mode !== "tree") {
        var nb = {};
        refused.forEach((e) => { [e.a, e.b].forEach((id) => { var v = this.vlanOf(id); if (this.B[v]) nb[v] = (nb[v] || 0) + e.count; }); });
        Object.keys(nb).forEach((v) => {
          var b = this.B[v];
          var t = svgEl("text", { class: "badge", x: b.x + b.w - 8, y: b.y + b.h - 6, "text-anchor": "end" }, gBlk);
          t.textContent = "refusé ×" + nb[v];
        });
      }
      // Nodes.
      var q = this.q;
      var node = (id, cls, draw) => {
        var p = P[id];
        if (!p) return;
        var n = M.byId[id] || {};
        var hit = q && id !== "router" && (this.label(n).toLowerCase().indexOf(q) >= 0 || (n.ip || "").indexOf(q) >= 0);
        var dim = sel && sel !== id && !(selV && this.vlanOf(id) === selV) && sel !== "router" && !(pair && pair.indexOf(this.vlanOf(id)) >= 0) &&
          !M.edges.some((e) => (e.a === sel && e.b === id) || (e.b === sel && e.a === id));
        var g = svgEl("g", { class: "nd " + cls + (sel === id ? " sel" : "") + (hit ? " hit" : "") + (dim ? " dim" : ""), "data-id": id, transform: "translate(" + p.x.toFixed(1) + " " + p.y.toFixed(1) + ")" }, gNode);
        draw(g, n);
      };
      node("router", "router", (g) => {
        svgEl("circle", { class: "r", r: 17 }, g);
        g.insertAdjacentHTML("beforeend", '<g transform="translate(-6 -9) scale(0.047)"><rect x="107" y="20" width="44" height="216" fill="#e9e4da"/><circle cx="128" cy="96" r="48" fill="#07080a" stroke="#e5323b" stroke-width="16"/><circle cx="128" cy="96" r="16" fill="#e5323b"/></g>');
        var t = svgEl("text", { x: 22, y: -8, class: "hl" }, g); t.textContent = "OPNsense";
      });
      if (this.showNet && P["net:hub"]) {
        node("net:hub", "hub", (g) => { svgEl("circle", { class: "n", r: 12 }, g); var t = svgEl("text", { x: 18, y: 4, class: "hl" }, g); t.textContent = "internet"; });
        M.remotes.forEach((r) => node(r.id, "remote", (g, n) => {
          svgEl("circle", { class: "n", r: 5 }, g);
          var t = svgEl("text", { x: 10, y: 4 }, g); t.textContent = (n.name || "").slice(0, 20) + (n.cc ? " · " + n.cc : "");
        }));
      }
      vis.forEach((v) => M.devs[v].forEach((dv) => node(dv.id, "device", (g, n) => {
        svgEl("circle", { r: 6, fill: M.color[v], stroke: "var(--bg)", "stroke-width": 1.5 }, g);
        // A VPN peer: a ring, dashed and lit while it is connected, and where it is outside.
        if (n.vpn) svgEl("circle", { r: 10, fill: "none", stroke: n.vpn.online ? "var(--okc)" : "var(--faint)", "stroke-width": 1.5, "stroke-dasharray": "3 2" }, g);
        var t = svgEl("text", { x: n.vpn ? 14 : 11, y: 4 }, g);
        var name = this.label(n);
        t.textContent = (name.length > 24 ? name.slice(0, 23) + "…" : name) + (n.vpn ? (n.vpn.online ? " ↗ " + (n.vpn.cc || "dehors") : " · hors ligne") : "");
        if (name === n.ip || (n.vpn && !n.vpn.online)) t.style.fill = "var(--faint)";
      })));
      // The networks against each other: what passes, what is refused.
      if (this.matEl) { this.matEl.remove(); this.matEl = null; }
      if (this.matrix) this.drawMatrix(edges, d.blocked || []);
      // The summary and the side.
      var nd = vis.reduce((s, v) => s + M.devs[v].length, 0);
      this.sum.textContent = nd + " appareils · " + vis.length + " réseaux · " + (d.states || 0) + " connexions";
      this.detail(edges);
    }
    pairs(edges, refused) {
      var P = {};
      var get = (a, b) => { var k = a + "→" + b; return P[k] || (P[k] = { a: a, b: b, bytes: 0, ports: {}, refused: 0, rules: {}, flows: [], ko: [] }); };
      edges.forEach((e) => {
        var va = this.vlanOf(e.a), vb = this.vlanOf(e.b);
        if (va === vb) return;
        var x = get(va, vb); x.bytes += e.bytes; (e.ports || []).forEach((p) => { x.ports[p] = 1; }); x.flows.push(e);
      });
      refused.forEach((e) => {
        var va = this.vlanOf(e.a), vb = this.vlanOf(e.b);
        var x = get(va || "?", vb || "?"); x.refused += e.count; (e.rules || []).forEach((r) => { x.rules[r] = 1; }); x.ko.push(e);
      });
      return P;
    }
    drawMatrix(edges, refused) {
      var M = this.M, P = this.pairs(edges, refused);
      var names = M.vlans.filter((v) => !this.off[v]).concat(["router", "internet"]);
      var label = (v) => (v === "router" ? "OPNsense" : v);
      var box = el("div", "mat", this.stage);
      this.matEl = box;
      var t = el("table", "", box), hr = el("tr", "", t);
      el("th", "", hr, "de ↓ · vers →");
      names.forEach((v) => { var th = el("th", "v", hr, label(v)); th.style.color = M.color[v] || ""; });
      names.forEach((a) => {
        var tr = el("tr", "", t);
        var th = el("th", "", tr, label(a)); th.style.color = M.color[a] || "";
        names.forEach((b) => {
          var td = el("td", a === b ? "self" : "", tr);
          if (a === b) return;
          var x = P[a + "→" + b];
          if (this.sel === "pair:" + a + "→" + b) td.classList.add("sel");
          if (x && x.bytes) { el("span", "ok", td, human(x.bytes)); el("span", "sv", td, Object.keys(x.ports).slice(0, 3).join(", ")); }
          if (x && x.refused) el("span", "ko", td, "refusé ×" + x.refused);
          td.addEventListener("click", () => { this.sel = "pair:" + a + "→" + b; this.draw(); });
        });
      });
      el("div", "hint", box, "vert : ce qui passe (volume, services) · rouge : ce que le pare-feu a refusé · un appui : le détail");
    }
    rulesFor(v) {
      var key = String(v || "").toLowerCase();
      return (this.M.d.rules || []).filter((r) => [r.iface, r.src, r.dst, r.descr].some((x) => String(x || "").toLowerCase().indexOf(key) >= 0));
    }
    ruleRows(parent, list) {
      list.slice(0, 20).forEach((r) => {
        var row = el("div", "rule" + (r.enabled ? "" : " off"), parent);
        el("span", "act " + r.action, row, r.action === "pass" ? "passe" : r.action === "block" ? "bloque" : r.action);
        el("span", "v", row, (r.descr ? r.descr + " · " : "") + r.src + " → " + r.dst + (r.port ? ":" + r.port : "") + (r.proto && r.proto !== "any" ? " " + r.proto : ""));
      });
    }
    // Traffic per network: what leaves it and what comes in, to anywhere else.
    perVlan(edges) {
      var t = {};
      var get = (v) => t[v] || (t[v] = { out: 0, inn: 0, n: 0 });
      edges.forEach((e) => {
        var va = this.vlanOf(e.a), vb = this.vlanOf(e.b);
        if (va === vb) return;
        get(va).out += e.bytes; get(vb).inn += e.bytes;
      });
      return t;
    }
    row(parent, left, right, onClick) {
      var r = el("div", "p" + (onClick ? " link" : ""), parent);
      var l = el("span", "v", r);
      if (left instanceof Node) l.appendChild(left); else l.textContent = left;
      el("span", "", r, right);
      if (onClick) r.addEventListener("click", onClick);
      return r;
    }
    detail(edges) {
      var M = this.M, s = this.side, sel = this.sel;
      var go = (id) => () => { this.sel = id; this.draw(); };
      var dotted = (v, text) => { var f = document.createDocumentFragment(); var dt = el("span", "dot", f); dt.style.background = M.color[v] || "var(--faint)"; f.appendChild(document.createTextNode(text)); return f; };
      var refused = M.d.blocked || [];
      var koRow = (e) => this.row(s, this.label(M.byId[e.a] || { id: e.a }) + " → " + this.label(M.byId[e.b] || { id: e.b }) + (e.ports.length ? " · " + e.ports.join(", ") : "") + (e.rules && e.rules.length ? " · " + e.rules[0] : ""), "×" + e.count);
      if (sel.indexOf("pair:") === 0) {
        var ab = sel.slice(5).split("→"), lab = (v) => (v === "router" ? "OPNsense" : v);
        el("div", "big", s, lab(ab[0]) + " → " + lab(ab[1]));
        var x = this.pairs(edges, refused)[ab[0] + "→" + ab[1]];
        el("div", "h", s, "ce qui passe");
        if (!x || !x.flows.length) el("div", "sub", s, "rien vu passer");
        (x ? x.flows : []).sort((p, q) => q.bytes - p.bytes).slice(0, 15).forEach((e) => this.row(s, this.label(M.byId[e.a]) + " → " + this.label(M.byId[e.b]) + (e.ports.length ? " · " + e.ports.join(", ") : ""), human(e.bytes)));
        el("div", "h", s, "refusé par le pare-feu");
        if (!x || !x.ko.length) el("div", "sub", s, "rien de refusé");
        (x ? x.ko : []).forEach(koRow);
        var rl = this.rulesFor(ab[0]).concat(this.rulesFor(ab[1]).filter((r) => this.rulesFor(ab[0]).indexOf(r) < 0));
        if (rl.length) { el("div", "h", s, "règles concernées"); this.ruleRows(s, rl); }
        return;
      }
      if (!sel || sel === "router") {
        el("div", "big", s, "OPNsense");
        el("div", "h", s, "par réseau · trafic vers les autres");
        var t = this.perVlan(edges);
        M.vlans.forEach((v) => {
          var x = t[v] || { out: 0, inn: 0 };
          this.row(s, dotted(v, v + (M.gw[v] ? "  " + M.gw[v] : "") + " · " + M.devs[v].length), "↑" + human(x.out) + " ↓" + human(x.inn), go("vlan:" + v));
        });
        if (t.internet) this.row(s, "internet", "↑" + human(t.internet.out) + " ↓" + human(t.internet.inn), go("net:hub"));
        // Network to network, with their services.
        var pairs = {};
        edges.forEach((e) => {
          var va = this.vlanOf(e.a), vb = this.vlanOf(e.b);
          if (va === vb) return;
          var k = va + " → " + vb;
          var p = pairs[k] || (pairs[k] = { bytes: 0, ports: {} });
          p.bytes += e.bytes;
          (e.ports || []).forEach((x) => { p.ports[x] = 1; });
        });
        var keys = Object.keys(pairs).sort((a, b) => pairs[b].bytes - pairs[a].bytes).slice(0, 14);
        if (keys.length) el("div", "h", s, "entre réseaux");
        keys.forEach((k) => this.row(s, k.replace("router", "OPNsense") + " · " + Object.keys(pairs[k].ports).slice(0, 3).join(", "), human(pairs[k].bytes)));
        if (refused.length) {
          el("div", "h", s, "refusé par le pare-feu (journal)");
          refused.slice(0, 12).forEach(koRow);
        }
        if ((M.d.rules || []).length) el("div", "sub", s, (M.d.rules || []).length + " règles lues · « matrice » pour les croiser");
        var unnamed = Object.values(M.byId).filter((n) => n.kind === "device" && this.label(n) === n.ip);
        var notes = (M.d.notes || []).slice();
        if (unnamed.length) notes.push(unnamed.length + " appareil" + (unnamed.length > 1 ? "s" : "") + " sans nom (names: dans le bloc nives:)");
        if (notes.length) { el("div", "h", s, "à vérifier"); notes.forEach((n) => el("div", "warn", s, n)); }
        return;
      }
      if (sel.indexOf("vlan:") === 0) {
        var v = sel.slice(5);
        el("div", "big", s, v);
        el("div", "v sub", s, (M.gw[v] ? "passerelle " + M.gw[v] + " · " : "") + M.devs[v].length + " appareils");
        var per = {};
        edges.forEach((e) => { [e.a, e.b].forEach((id) => { if (this.vlanOf(id) === v) per[id] = (per[id] || 0) + e.bytes; }); });
        el("div", "h", s, "appareils");
        M.devs[v].slice().sort((a, b) => (per[b.id] || 0) - (per[a.id] || 0)).forEach((dv) => this.row(s, this.label(dv) + (dv.ip && this.label(dv) !== dv.ip ? "  " + dv.ip : ""), human(per[dv.id] || 0), go(dv.id)));
        var out = edges.filter((e) => this.vlanOf(e.a) === v && this.vlanOf(e.b) !== v).sort((a, b) => b.bytes - a.bytes).slice(0, 12);
        if (out.length) el("div", "h", s, "vers les autres réseaux");
        out.forEach((e) => this.row(s, this.label(M.byId[e.a]) + " → " + this.label(M.byId[e.b]) + (e.ports.length ? " · " + e.ports.join(", ") : ""), human(e.bytes)));
        var ko = refused.filter((e) => this.vlanOf(e.a) === v || this.vlanOf(e.b) === v);
        if (ko.length) { el("div", "h", s, "refusé par le pare-feu"); ko.slice(0, 12).forEach(koRow); }
        var rl2 = this.rulesFor(v);
        if (rl2.length) { el("div", "h", s, "règles"); this.ruleRows(s, rl2); }
        return;
      }
      var n = M.byId[sel];
      if (sel === "net:hub") {
        el("div", "big", s, "internet");
        var tot = {};
        edges.forEach((e) => { [e.a, e.b].forEach((id) => { if (this.vlanOf(id) === "internet") tot[id] = (tot[id] || 0) + e.bytes; }); });
        el("div", "h", s, "opérateurs");
        Object.keys(tot).sort((a, b) => tot[b] - tot[a]).forEach((id) => this.row(s, this.label(M.byId[id]), human(tot[id]), go(id)));
        return;
      }
      if (!n) { this.sel = ""; return this.detail(edges); }
      el("div", "big", s, this.label(n));
      var info = [];
      if (n.ip) info.push(n.ip);
      if (n.mac) info.push(n.mac);
      if (n.kind === "device") info.push("réseau " + (n.vlan || "?"));
      if (n.net && n.net !== n.vlan) info.push("wi-fi " + n.net + (n.signal != null ? " · " + n.signal + " dBm" : ""));
      if (n.vendor) info.push(n.vendor);
      if (n.cc) info.push(countryName(n.cc));
      if (n.vpn) {
        var vp = n.vpn, ago = vp.handshake_s;
        info.push(vp.online ? "connecté au VPN, hors de la maison" : "VPN : pas connecté" + (ago != null ? " (dernier contact il y a " + (ago < 3600 ? Math.round(ago / 60) + " min" : ago < 86400 ? Math.round(ago / 3600) + " h" : Math.round(ago / 86400) + " j") + ")" : ""));
        if (vp.endpoint) info.push("depuis " + vp.endpoint + (vp.cc ? " · " + countryName(vp.cc) : "") + (vp.org ? " · " + vp.org : "") + (vp.where === "local" ? " (adresse privée : le réseau local ou un partage de connexion)" : ""));
        if (vp.rx || vp.tx) info.push("reçu " + human(vp.rx) + " · envoyé " + human(vp.tx));
      }
      info.forEach((x) => el("div", "v sub", s, x));
      var mine = edges.filter((e) => e.a === n.id || e.b === n.id).sort((a, b) => b.bytes - a.bytes);
      el("div", "h", s, "connexions");
      if (!mine.length) el("div", "sub", s, "aucune à travers le routeur");
      var myko = refused.filter((e) => e.a === n.id || e.b === n.id);
      if (myko.length) { el("div", "h", s, "refusé par le pare-feu"); myko.forEach(koRow); el("div", "h", s, "connexions"); }
      mine.forEach((e) => {
        var other = e.a === n.id ? e.b : e.a;
        this.row(s, (e.a === n.id ? "→ " : "← ") + this.label(M.byId[other]) + (e.ports.length ? " · " + e.ports.join(", ") : ""), human(e.bytes), go(other));
      });
    }
    move(t) {
      if (!this.pkts.length) return;
      var s = t / 1000;
      this.pkts.forEach((p) => {
        var f = ((p.off * p.len + s * p.speed) % p.len);
        var pt = p.path.getPointAtLength(f);
        p.el.setAttribute("cx", pt.x.toFixed(1)); p.el.setAttribute("cy", pt.y.toFixed(1));
      });
    }
    disconnectedCallback() {
      if (this.frame) cancelAnimationFrame(this.frame);
      this.frame = null;
      if (this.ro) { this.ro.disconnect(); this.ro = null; }
      if (this.timer) { clearInterval(this.timer); this.timer = null; this._built = false; this.shadowRoot.innerHTML = ""; }
    }
  }

  // ----- igor-talkers-card: the busiest devices, from the network map -----
  //   type: custom:igor-talkers-card
  //   title: les plus actifs
  //   limit: 8
  //   more: /igor-wall/schema     # a « schéma › » link
  //   by: vlan                    # per network instead: ↑ out, ↓ in, devices
  // The same reading as the network map (nives.net_map, administrators
  // only): each device's traffic through the router, its network's colour.
  class IgorTalkersCard extends IgorCard {
    setConfig(config) {
      this.config = config || {};
      this.names = this.config.names && typeof this.config.names === "object" ? this.config.names : {};
    }
    build() {
      this.style([
        ".list { flex: 1; min-height: 0; overflow-y: auto; }",
        ".r { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; padding: 3px 0; border-bottom: 1px dashed var(--line); }",
        ".r .n { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
        ".r .b { color: var(--dim); font-variant-numeric: tabular-nums; }",
        ".r .bar { grid-column: 1 / -1; height: 2px; }",
        ".dot { display: inline-block; width: 7px; height: 7px; border-radius: 50%; margin-right: 6px; }",
        ".empty { color: var(--dim); padding: 6px 0; }"
      ].join("\n"));
      var card = el("ha-card", "", this.shadowRoot);
      var top = el("div", "top", card);
      el("span", "t sub", top, (this.config.title || "les plus actifs").toUpperCase()).style.letterSpacing = "0.12em";
      if (this.config.more) {
        var mo = el("button", "link", top, "schéma ›"); mo.type = "button";
        mo.addEventListener("click", () => navigate(String(this.config.more)));
      }
      this.list = el("div", "list", card);
      this.timer = setInterval(() => this.load(), 20000);
      this.load();
    }
    load() {
      var hass = this._hass;
      if (!hass || this.loading || document.hidden) return;
      this.loading = true;
      hass.callWS({ type: "call_service", domain: "nives", service: "net_map", service_data: {}, return_response: true })
        .then((r) => this.draw((r && r.response) || {}))
        .catch((err) => this.draw({ error: err && err.code === "unauthorized" ? "réservé aux administrateurs" : "service indisponible" }))
        .then(() => { this.loading = false; });
    }
    draw(d) {
      this.list.innerHTML = "";
      if (d.error || !(d.nodes || []).length) { el("div", "empty", this.list, d.error ? "Indisponible : " + d.error : "Lecture…"); return; }
      var byId = {}, vl = [];
      d.nodes.forEach((n) => { byId[n.id] = n; if (n.kind === "device" && vl.indexOf(n.vlan || "autre") < 0) vl.push(n.vlan || "autre"); });
      (d.vlans || []).forEach((v) => { if (vl.indexOf(v.name) < 0) vl.push(v.name); });
      vl.sort();
      if (this.config.by === "vlan") {
        // Per network: what leaves it and what comes in, from anywhere else.
        var vOf = (id) => { var n = byId[id]; return !n ? "" : n.kind === "device" ? n.vlan || "autre" : n.kind === "remote" ? "internet" : "OPNsense"; };
        var t = {}, cnt = {};
        d.nodes.forEach((n) => { if (n.kind === "device") cnt[n.vlan || "autre"] = (cnt[n.vlan || "autre"] || 0) + 1; });
        (d.edges || []).forEach((e) => {
          var va = vOf(e.a), vb = vOf(e.b);
          if (va === vb) return;
          (t[va] = t[va] || { o: 0, i: 0 }).o += e.bytes;
          (t[vb] = t[vb] || { o: 0, i: 0 }).i += e.bytes;
        });
        var gw = {};
        (d.vlans || []).forEach((v) => { gw[v.name] = v.gateway; });
        var maxv = Math.max.apply(null, vl.map((v) => (t[v] ? t[v].o + t[v].i : 0)).concat([1]));
        vl.forEach((v, i) => {
          var x = t[v] || { o: 0, i: 0 }, r = el("div", "r", this.list);
          var nm = el("span", "n", r);
          var dot = el("span", "dot", nm); dot.style.background = NET_COLORS[i % NET_COLORS.length];
          nm.appendChild(document.createTextNode(v + (gw[v] ? "  " + gw[v] : "") + " · " + (cnt[v] || 0)));
          el("span", "b", r, "↑" + human(x.o) + " ↓" + human(x.i));
          var bar = el("div", "bar", r); el("i", "", bar).style.width = Math.round((100 * (x.o + x.i)) / maxv) + "%";
        });
        return;
      }
      var tot = {};
      (d.edges || []).forEach((e) => { [e.a, e.b].forEach((id) => { if (byId[id] && byId[id].kind === "device") tot[id] = (tot[id] || 0) + e.bytes; }); });
      var ids = Object.keys(tot).sort((a, b) => tot[b] - tot[a]).slice(0, Math.max(3, Number(this.config.limit) || 8));
      var max = ids.length ? tot[ids[0]] : 1;
      ids.forEach((id) => {
        var n = byId[id], r = el("div", "r", this.list);
        var nm = el("span", "n", r);
        var dot = el("span", "dot", nm); dot.style.background = NET_COLORS[vl.indexOf(n.vlan || "autre") % NET_COLORS.length];
        nm.appendChild(document.createTextNode(this.names[n.ip] || n.name || n.ip));
        el("span", "b", r, human(tot[id]));
        var bar = el("div", "bar", r); el("i", "", bar).style.width = Math.round((100 * tot[id]) / max) + "%";
      });
    }
    disconnectedCallback() { if (this.timer) { clearInterval(this.timer); this.timer = null; this._built = false; this.shadowRoot.innerHTML = ""; } }
  }

  // ----- igor-wifi-scan-card: the Wi-Fi networks around -----
  //   type: custom:igor-wifi-scan-card
  //   title: wi-fi voisins
  // Heard by the OpenWrt access points when « scanner » is pressed
  // (nives.wifi_scan, administrators only; a radio may pause a second or
  // two). The channels in use per band, to choose a quiet one, then each
  // network: name, band and channel, signal, security.
  class IgorWifiScanCard extends IgorCard {
    setConfig(config) { this.config = config || {}; }
    getCardSize() { return 8; }
    build() {
      this.style([
        ".ctl { display: flex; gap: 8px; align-items: center; margin: 2px 0 8px; flex: none; color: var(--dim); font-size: 11px; }",
        "button.b { background: none; border: 1px solid var(--acc); color: var(--acc); font: inherit; border-radius: var(--igor-radius, 3px); padding: 3px 10px; cursor: pointer; }",
        "button.b[disabled] { opacity: 0.5; cursor: wait; }",
        ".chan { display: flex; gap: 14px; flex-wrap: wrap; flex: none; margin-bottom: 8px; }",
        ".band { flex: 1; min-width: 240px; }",
        ".band .h, .h { color: var(--dim); font-size: 10.5px; letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 3px; }",
        ".cols { display: flex; align-items: flex-end; gap: 3px; height: 46px; border-bottom: 1px solid var(--line); }",
        ".cols div { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; height: 100%; font-size: 9px; color: var(--faint); }",
        ".cols span { line-height: 1.5; margin-top: 2px; }",
        ".cols i { display: block; width: 100%; background: var(--acc); opacity: 0.7; min-height: 1px; }",
        ".cols div.mine i { background: var(--wait); opacity: 1; }",
        ".list { flex: 1; min-height: 0; overflow-y: auto; }",
        // Widths in em of the row's own size: « 5 GHz · canal 149 » and
        // « WPA2 entreprise » fit, with room between the columns.
        ".r { display: grid; grid-template-columns: minmax(0, 1fr) 11em 26px 9em; column-gap: 14px; align-items: center; padding: 4px 0; border-bottom: 1px dashed var(--line); }",
        ".r .n { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
        ".r .n small { color: var(--faint); margin-left: 6px; }",
        ".r .c, .r .s { color: var(--dim); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
        // A phone: the name on its own line, the rest under it.
        "@media (max-width: 600px) { .r { grid-template-columns: 11em 26px minmax(0, 1fr); row-gap: 2px; } .r .n { grid-column: 1 / -1; } .r .n small { display: block; margin-left: 0; } .r .s { text-align: right; } }",
        ".r .s.open { color: var(--bad); }",
        ".sig { display: flex; gap: 2px; align-items: flex-end; height: 12px; }",
        ".sig i { width: 4px; background: var(--track); }",
        ".sig.ok i.on { background: var(--okc); } .sig.warn i.on { background: var(--wait); } .sig.bad i.on { background: var(--bad); }",
        ".empty { color: var(--dim); padding: 6px 0; }"
      ].join("\n"));
      var card = el("ha-card", "", this.shadowRoot);
      var top = el("div", "top", card);
      el("span", "t sub", top, (this.config.title || "wi-fi voisins").toUpperCase()).style.letterSpacing = "0.12em";
      this.sum = el("span", "sub num", top);
      var ctl = el("div", "ctl", card);
      this.go = el("button", "b", ctl, "scanner"); this.go.type = "button";
      this.go.addEventListener("click", () => this.scan());
      this.when = el("span", "", ctl, "le Wi-Fi de la maison peut se couper une ou deux secondes");
      this.chan = el("div", "chan", card);
      this.list = el("div", "list", card);
      el("div", "empty", this.list, "Appuyez sur « scanner ».");
    }
    scan() {
      var hass = this._hass;
      if (!hass || this.busy) return;
      this.busy = true; this.go.disabled = true; this.go.textContent = "écoute…";
      hass.callWS({ type: "call_service", domain: "nives", service: "wifi_scan", service_data: {}, return_response: true })
        .then((r) => this.draw((r && r.response) || {}))
        .catch((err) => this.draw({ error: err && err.code === "unauthorized" ? "réservé aux administrateurs" : "service indisponible (Igor 0.31 ou plus)" }))
        .then(() => { this.busy = false; this.go.disabled = false; this.go.textContent = "scanner"; this.when.textContent = "dernier scan " + hhmm(new Date()); });
    }
    draw(d) {
      this.list.innerHTML = ""; this.chan.innerHTML = "";
      var nets = [], errs = [];
      (d.aps || []).forEach((ap) => { (ap.networks || []).forEach((n) => nets.push(n)); if (ap.error) errs.push(ap.name + " : " + ap.error); });
      if (d.error) errs.push(d.error);
      this.sum.textContent = nets.length ? nets.length + " réseaux" : "";
      errs.forEach((e) => el("div", "empty", this.list, "Indisponible : " + e));
      if (!nets.length) { if (!errs.length) el("div", "empty", this.list, "Aucun réseau entendu."); return; }
      // Channels in use, per band.
      [["2,4 GHz", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]], ["5 GHz", null]].forEach((b) => {
        var here = nets.filter((n) => n.band === b[0] && n.channel);
        if (!here.length) return;
        var chans = b[1] || Array.from(new Set(here.map((n) => n.channel))).sort((x, y) => x - y);
        var count = {}; here.forEach((n) => { count[n.channel] = (count[n.channel] || 0) + 1; });
        var max = Math.max.apply(null, chans.map((c) => count[c] || 0).concat([1]));
        var box = el("div", "band", this.chan);
        el("div", "h", box, b[0] + " · réseaux par canal");
        var cols = el("div", "cols", box);
        chans.forEach((c) => {
          var col = el("div", "", cols);
          var bar = el("i", "", col); bar.style.height = Math.round((100 * (count[c] || 0)) / max) + "%";
          el("span", "", col, String(c));
          col.title = "canal " + c + " · " + (count[c] || 0);
        });
      });
      nets.forEach((n) => {
        var r = el("div", "r", this.list);
        var nm = el("span", "n", r, n.ssid || "‹ caché ›");
        el("small", "", nm, n.bssid);
        el("span", "c", r, [n.band, n.channel ? "canal " + n.channel : ""].filter(Boolean).join(" · "));
        var lvl = n.signal == null ? 0 : n.signal >= -55 ? 4 : n.signal >= -65 ? 3 : n.signal >= -75 ? 2 : 1;
        var sig = el("span", "sig " + (lvl >= 3 ? "ok" : lvl === 2 ? "warn" : "bad"), r);
        sig.title = n.signal == null ? "" : n.signal + " dBm";
        for (var i = 1; i <= 4; i++) { var b2 = el("i", i <= lvl ? "on" : "", sig); b2.style.height = 3 * i + "px"; }
        el("span", "s" + (n.security === "ouvert" ? " open" : ""), r, n.security);
      });
    }
  }

  // Home Assistant's own actions from a card (an app to open with url:
  // app://…, the voice assistant with assist, any perform-action).
  function haAction(node, action) {
    node.dispatchEvent(new CustomEvent("hass-action", { bubbles: true, composed: true, detail: { config: { tap_action: action }, action: "tap" } }));
  }
  var EYE = '<svg viewBox="0 0 256 256" aria-hidden="true" style="width:100%;height:100%;display:block"><rect x="107" y="20" width="44" height="216" fill="#e9e4da"/><circle cx="128" cy="96" r="48" fill="#07080a" stroke="#e5323b" stroke-width="16"/><circle cx="128" cy="96" r="16" fill="#e5323b"/></svg>';

  // ----- igor-car-card: the car while it drives -----
  //   type: custom:igor-car-card
  //   speed: sensor.car_speed            # km/h, in large
  //   rpm: sensor.car_rpm                # a segmented bar: amber from rpm_warn, red from rpm_bad
  //   rpm_max: 5000
  //   rpm_warn: 3500
  //   rpm_bad: 4300
  //   coolant: sensor.car_coolant        # °C: blue under 60, amber from 100, red from 110
  //   battery: sensor.car_battery        # V: red under 11.8, amber under 12.4, red over 15
  //   online: binary_sensor.car_online   # off: « hors ligne », the figures greyed
  //   trip: { entity: sensor.car_trip, attribute: trajet }   # its distance_km and eco_score
  //   active: binary_sensor.trip_running # the trip line only while driving (else the last trip)
  //   consumption: sensor.car_l_100km
  //   weather: weather.car_place          # outside, as in a car: the weather where the car is,
  //   outside: sensor.car_outside_temp    # its temperature (else the weather's), the next hours
  class IgorCarCard extends IgorCard {
    setConfig(config) {
      if (!config || !config.speed) throw new Error("igor-car-card: speed est requis");
      this.config = config;
    }
    getCardSize() { return 6; }
    build() {
      this.style([
        ".h { color: var(--dim); font-size: 10.5px; letter-spacing: 0.16em; text-transform: uppercase; display: flex; align-items: center; gap: 7px; flex: none; }",
        ".h::before { content: ''; width: 6px; height: 6px; background: var(--igor-signal, #e5323b); }",
        ".h .off { margin-left: auto; color: var(--faint); letter-spacing: 0.1em; }",
        ".sp { font-size: clamp(48px, 9vh, 92px); line-height: 1; font-weight: 300; letter-spacing: -0.02em; margin: 10px 0 0; font-variant-numeric: tabular-nums; flex: none; }",
        ".sp small { font-size: 15px; color: var(--dim); margin-left: 6px; letter-spacing: 0.06em; font-weight: 400; }",
        ".seg { display: flex; gap: 2px; margin: 14px 0 5px; height: 16px; flex: none; }",
        ".seg i { flex: 1; background: var(--track); }",
        ".seg i.on { background: var(--acc); } .seg i.y { background: var(--wait); } .seg i.r { background: var(--bad); }",
        ".seg i.ys { background: rgba(217, 164, 65, 0.22); } .seg i.rs { background: rgba(224, 103, 95, 0.22); }",
        ".row { display: flex; justify-content: space-between; color: var(--dim); font-size: 11.5px; flex: none; }",
        ".row b { color: var(--fg); font-weight: 400; font-variant-numeric: tabular-nums; }",
        ".mini { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px; flex: none; }",
        ".mini div { border-top: 1px solid var(--line); padding-top: 6px; color: var(--dim); font-size: 11px; }",
        ".mini b { display: block; font-size: 22px; font-weight: 400; margin-top: 2px; font-variant-numeric: tabular-nums; color: var(--fg); }",
        ".mini b.cold, .trip b.cold { color: var(--acc); } .mini b.okc, .trip b.okc { color: var(--okc); } .mini b.warn, .trip b.warn { color: var(--wait); } .mini b.bad, .trip b.bad { color: var(--bad); }",
        ".wx { margin-top: 12px; border-top: 1px solid var(--line); padding-top: 8px; display: grid; grid-template-columns: auto 1fr auto; gap: 4px 12px; align-items: center; flex: none; --mdc-icon-size: 38px; cursor: pointer; }",
        ".wx[hidden] { display: none; }",
        ".wx > ha-icon { color: var(--wait); grid-column: 1; grid-row: 1 / 3; }",
        ".wx .t { grid-column: 2; grid-row: 1; font-size: 30px; font-weight: 300; line-height: 1; font-variant-numeric: tabular-nums; }",
        ".wx .c { grid-column: 2; grid-row: 2; color: var(--dim); font-size: 12px; }",
        ".wx .mm { grid-column: 3; grid-row: 1 / 3; display: grid; grid-template-columns: auto 3.2ch; column-gap: 8px; align-items: baseline; color: var(--dim); font-size: 12px; line-height: 1.5; font-variant-numeric: tabular-nums; }",
        ".wx .mm div { display: contents; } .wx .mm b { text-align: right; }",
        ".wx .mm b { color: var(--fg); font-weight: 400; }",
        ".wx .hrs { grid-column: 1 / -1; grid-row: 3; display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; text-align: center; margin-top: 4px; color: var(--dim); font-size: 11px; --mdc-icon-size: 20px; }",
        ".wx .hrs ha-icon { display: block; margin: 3px auto; color: var(--wait); }",
        ".wx .hrs b { color: var(--fg); font-weight: 400; font-size: 13px; }",
        ".wx .hrs .rain { color: #6cc4f5; font-size: 10px; display: block; }",
        ".trip { margin-top: auto; border-top: 1px dashed var(--line); padding-top: 8px; display: grid; grid-template-columns: repeat(3, 1fr); text-align: center; flex: none; }",
        ".trip b { display: block; font-size: 18px; font-weight: 400; font-variant-numeric: tabular-nums; }",
        ".trip span { color: var(--dim); font-size: 10px; }",
        ".trip .t { grid-column: 1 / -1; color: var(--faint); font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; margin-bottom: 4px; }",
        "ha-card.off .sp, ha-card.off .mini b, ha-card.off .row b { color: var(--faint); }"
      ].join("\n"));
      var card = el("ha-card", "", this.shadowRoot);
      this.card = card;
      var h = el("div", "h", card, "vitesse");
      this.offEl = el("span", "off", h, "");
      this.sp = el("div", "sp", card);
      this.seg = el("div", "seg", card);
      this.segs = [];
      for (var i = 0; i < 20; i++) this.segs.push(el("i", "", this.seg));
      var r = el("div", "row", card);
      el("span", "", r, "régime");
      this.rpmEl = el("b", "", r);
      var mini = el("div", "mini", card);
      var m1 = el("div", "", mini, "moteur"); this.coolEl = el("b", "", m1);
      var m2 = el("div", "", mini, "batterie"); this.battEl = el("b", "", m2);
      // Outside: the weather where the car is.
      this.wx = el("div", "wx", card);
      this.wx.hidden = true;
      this.wxIcon = icon(this.wx, "mdi:weather-partly-cloudy");
      this.wxT = el("div", "t", this.wx);
      this.wxMM = el("div", "mm", this.wx);
      this.wxC = el("div", "c", this.wx);
      this.wxH = el("div", "hrs", this.wx);
      this.wx.addEventListener("click", () => { if (this.config.weather) moreInfo(this, this.config.weather); });
      this.tripEl = el("div", "trip", card);
    }
    subscribeWeather(hass) {
      if (!this.config.weather || this.wxSubs || !hass.connection) return;
      this.wxSubs = [];
      this.forecast = this.forecast || {};
      ["hourly", "daily"].forEach((type) => {
        hass.connection.subscribeMessage((msg) => { this.forecast[type] = (msg && msg.forecast) || []; this.drawWeather(); },
          { type: "weather/subscribe_forecast", forecast_type: type, entity_id: this.config.weather })
          .then((u) => { if (this.wxSubs) this.wxSubs.push(u); else u(); })
          .catch(() => { /* not offered */ });
      });
    }
    disconnectedCallback() { (this.wxSubs || []).forEach(function (u) { try { u(); } catch (e) { /* gone */ } }); this.wxSubs = null; }
    connectedCallback() { super.connectedCallback(); if (this._built && this._hass) this.subscribeWeather(this._hass); }
    drawWeather() {
      var hass = this._hass, c = this.config;
      if (!hass || !c.weather) return;
      var st = hass.states[c.weather], hourly = (this.forecast && this.forecast.hourly) || [], daily = (this.forecast && this.forecast.daily) || [];
      var ok = st && ["unavailable", "unknown"].indexOf(st.state) < 0;
      var first = hourly[0] || {};
      var cond = ok ? st.state : first.condition;
      if (!cond && !hourly.length) { this.wx.hidden = true; return; }
      this.wx.hidden = false;
      var w = WEATHER[cond] || ["mdi:weather-partly-cloudy", cond || "—"];
      this.wxIcon.setAttribute("icon", w[0]);
      var out = c.outside ? num(hass.states[c.outside]) : null;
      var temp = out != null ? out : ok && st.attributes.temperature != null ? st.attributes.temperature : first.temperature;
      this.wxT.textContent = temp == null ? "—" : fr(Number(temp), Math.abs(temp) < 10 && out != null ? 1 : 0) + "°";
      this.wxC.textContent = w[1];
      var today = daily[0];
      this.wxMM.innerHTML = "";
      if (today && today.temperature != null) {
        el("div", "", this.wxMM).append("max ", Object.assign(document.createElement("b"), { textContent: Math.round(today.temperature) + "°" }));
        if (today.templow != null) el("div", "", this.wxMM).append("min ", Object.assign(document.createElement("b"), { textContent: Math.round(today.templow) + "°" }));
      }
      var hrs = hourly.filter(function (h) { return Date.parse(h.datetime) > Date.now() - 1800000; }).slice(1, 5);
      this.wxH.innerHTML = "";
      this.wxH.hidden = !hrs.length;
      hrs.forEach((h) => {
        var cell = el("span", "", this.wxH, new Date(h.datetime).getHours() + " h");
        icon(cell, (WEATHER[h.condition] || ["mdi:weather-partly-cloudy"])[0]);
        el("b", "", cell, h.temperature == null ? "—" : Math.round(h.temperature) + "°");
        var p = Number(h.precipitation_probability);
        if (isFinite(p) && p >= 30) el("span", "rain", cell, p + " %");
      });
    }
    update(hass) {
      var c = this.config, S = (id) => (id ? hass.states[id] : null);
      this.subscribeWeather(hass);
      this.drawWeather();
      var on = !c.online || (S(c.online) && S(c.online).state === "on");
      this.card.classList.toggle("off", !on);
      this.offEl.textContent = on ? "" : "hors ligne";
      var v = on ? num(S(c.speed)) : null;
      this.sp.innerHTML = "";
      this.sp.appendChild(document.createTextNode(v == null ? "—" : String(Math.round(v))));
      el("small", "", this.sp, "km/h");
      var rpm = on ? num(S(c.rpm)) : null;
      var max = Number(c.rpm_max) || 5000, warn = Number(c.rpm_warn) || max * 0.7, bad = Number(c.rpm_bad) || max * 0.86;
      var lit = rpm == null ? 0 : Math.round((Math.min(rpm, max) / max) * this.segs.length);
      this.segs.forEach((sg, i) => {
        var at = ((i + 1) / this.segs.length) * max;
        var zone = at > bad ? "r" : at > warn ? "y" : "on";
        sg.className = i < lit ? zone : zone === "on" ? "" : zone + "s";
      });
      this.rpmEl.textContent = rpm == null ? "—" : fr(Math.round(rpm), 0) + " tr/min";
      var t = on ? num(S(c.coolant)) : null;
      this.coolEl.textContent = t == null ? "—" : Math.round(t) + "°";
      this.coolEl.className = t == null ? "" : t >= 110 ? "bad" : t >= 100 ? "warn" : t < 60 ? "cold" : "okc";
      var b = on ? num(S(c.battery)) : null;
      this.battEl.textContent = b == null ? "—" : fr(b, 1) + " V";
      this.battEl.className = b == null ? "" : b < 11.8 || b > 15 ? "bad" : b < 12.4 ? "warn" : "okc";
      // The trip: distance, consumption, eco score.
      var tr = c.trip ? (typeof c.trip === "string" ? { entity: c.trip } : c.trip) : null;
      var st = tr && S(tr.entity), data = st ? (tr.attribute ? st.attributes[tr.attribute] : st.attributes) : null;
      this.tripEl.innerHTML = "";
      if (!data || typeof data !== "object") { this.tripEl.hidden = true; return; }
      this.tripEl.hidden = false;
      var running = c.active && S(c.active) && S(c.active).state === "on";
      el("span", "t", this.tripEl, running ? "trajet en cours" : "dernier trajet");
      var cons = num(S(c.consumption));
      var eco = Number(data.eco_score);
      [[data.distance_km != null ? fr(Number(data.distance_km), 1) : "—", "km", ""],
       [cons != null ? fr(cons, 1) : "—", "L/100", cons == null ? "" : cons < 6 ? "okc" : cons < 9 ? "warn" : "bad"],
       [isFinite(eco) ? String(Math.round(eco)) : "—", "éco", !isFinite(eco) ? "" : eco >= 80 ? "okc" : eco >= 60 ? "warn" : "bad"]].forEach((x) => {
        var d = el("div", "", this.tripEl);
        el("b", x[2], d, x[0]);
        el("span", "", d, x[1]);
      });
    }
  }

  // ----- igor-trips-card: a car's log, readable at a glance -----
  //   type: custom:igor-trips-card
  //   history: sensor.car_trip_history        # attribute `trajets`: the trips, oldest first
  //   current: { entity: sensor.car_trip, attribute: trajet }   # the running or last trip
  //   active: binary_sensor.trip_running
  //   records: sensor.car_records             # optional: 0-100, 80-120, top speed, longest, best eco
  //   correction: input_text.car_fuel_factor  # optional: litres × this factor
  //   price: input_number.fuel_price          # optional: € per litre for the running trip
  //   rows: 6
  // The trip on top in large figures, the last ones in clean rows (empty ones
  // left out), the records at the bottom.
  class IgorTripsCard extends IgorCard {
    setConfig(config) {
      if (!config || !config.history) throw new Error("igor-trips-card: history est requis");
      this.config = config;
    }
    getCardSize() { return 6; }
    build() {
      this.style(CARD_CSS + "\n" + [
        "ha-card { display: flex; flex-direction: column; height: 100%; box-sizing: border-box; }",
        ".h { color: var(--dim); font-size: 10.5px; letter-spacing: 0.16em; text-transform: uppercase; display: flex; align-items: center; gap: 7px; }",
        ".h::before { content: ''; width: 6px; height: 6px; background: var(--igor-signal, #e5323b); }",
        ".top { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; text-align: center; padding: 10px 0 12px; border-bottom: 1px solid var(--line); }",
        ".top b { display: block; font-size: 21px; font-weight: 300; font-variant-numeric: tabular-nums; color: var(--fg); }",
        ".top span { color: var(--dim); font-size: 11px; }",
        ".rows { margin-top: 6px; }",
        ".r { display: grid; grid-template-columns: minmax(max-content, 1.6fr) 1fr 0.9fr 1fr 1fr 0.8fr; gap: 6px; align-items: baseline; padding: 7px 0; border-bottom: 1px dashed var(--line); font-variant-numeric: tabular-nums; font-size: 14px; }",
        ".r > * { text-align: right; white-space: nowrap; } .r > :first-child { text-align: left; color: var(--dim); font-size: 12.5px; }",
        ".r.hd { color: var(--faint); font-size: 10.5px; letter-spacing: 0.12em; text-transform: uppercase; padding: 4px 0; border-bottom: 1px solid var(--line); }",
        ".r.hd > :first-child { color: var(--faint); font-size: 10.5px; }",
        ".okc { color: var(--okc); } .warn { color: var(--wait); } .bad { color: var(--bad); }",
        ".none { color: var(--dim); padding: 14px 0; }",
        ".rec { margin-top: auto; padding-top: 10px; border-top: 1px solid var(--line); display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; text-align: center; }",
        ".rec[hidden] { display: none; }",
        ".rec b { display: block; font-size: 15px; font-weight: 400; font-variant-numeric: tabular-nums; }",
        ".rec span { color: var(--faint); font-size: 10px; letter-spacing: 0.06em; white-space: nowrap; }",
        ".rec > div { min-width: 0; }", ".rec span.t { grid-column: 1 / -1; }"
      ].join("\n"));
      var card = el("ha-card", "", this.shadowRoot);
      var h = el("div", "h", card);
      this.titleEl = el("span", "", h, "dernier trajet");
      this.top = el("div", "top", card);
      this.rows = el("div", "rows", card);
      this.rec = el("div", "rec", card);
    }
    update(hass, prev) {
      var c = this.config, S = (id) => (id ? hass.states[id] : null);
      if (prev && !changed(prev, hass, [c.history, c.current && (c.current.entity || c.current), c.active, c.records, c.correction, c.price])) return;
      var factor = c.correction ? (num(S(c.correction)) || 1) : 1;
      var price = c.price ? num(S(c.price)) : null;
      var ecoCls = function (e) { return !isFinite(e) ? "" : e >= 80 ? "okc" : e >= 60 ? "warn" : "bad"; };
      var l100Cls = function (v) { return v == null ? "" : v < 6 ? "okc" : v < 9 ? "warn" : "bad"; };
      var fmt = function (v, d) { return v == null || !isFinite(v) ? "—" : fr(v, d); };
      // The trip on top
      var cur = c.current ? (typeof c.current === "string" ? { entity: c.current } : c.current) : null;
      var st = cur && S(cur.entity), t = st ? (cur.attribute ? st.attributes[cur.attribute] : st.attributes) : null;
      var running = c.active && S(c.active) && S(c.active).state === "on";
      this.titleEl.textContent = running ? "trajet en cours" : "dernier trajet";
      this.top.innerHTML = "";
      if (t && typeof t === "object") {
        var litres = Number(t.fuel_l) * factor;
        var l100 = Number(t.l100) > 0 ? Number(t.l100) * factor : null;
        var cost = t.cout != null ? Number(t.cout) : price && litres > 0 ? litres * price : null;
        var mins = t.duree_min != null ? Number(t.duree_min) : t.debut ? (Date.now() - Date.parse(t.debut)) / 60000 : null;
        [[fmt(Number(t.distance_km), 1), "km", ""], [mins == null || !isFinite(mins) ? "—" : String(Math.round(mins)), "min", ""],
         [fmt(l100, 1), "L/100", l100Cls(l100)], [cost == null || !isFinite(cost) ? "—" : fr(cost, 2), "€", ""],
         [isFinite(Number(t.eco_score)) ? String(Math.round(t.eco_score)) : "—", "éco", ecoCls(Number(t.eco_score))]].forEach((x) => {
          var d = el("div", "", this.top); el("b", x[2], d, x[0]); el("span", "", d, x[1]);
        });
      } else this.top.hidden = true;
      // The last trips, newest first; an empty one (no start, nothing driven) is left out.
      var hs = S(c.history), list = hs && Array.isArray(hs.attributes.trajets) ? hs.attributes.trajets.slice() : [];
      list = list.filter(function (x) { return x && typeof x === "object" && x.debut && Number(x.distance_km) > 0.05; }).reverse().slice(0, Number(c.rows) || 6);
      this.rows.innerHTML = "";
      if (!list.length) { el("div", "none", this.rows, "Aucun trajet enregistré pour l'instant."); }
      else {
        var hd = el("div", "r hd", this.rows);
        ["quand", "km", "min", "L/100", "€", "éco"].forEach(function (x) { el("span", "", hd, x); });
        list.forEach((x) => {
          var r = el("div", "r", this.rows), at = new Date(x.debut);
          var day = isNaN(at) ? "—" : (at.toDateString() === new Date().toDateString() ? "" : pad(at.getDate()) + "/" + pad(at.getMonth() + 1) + " ") + hhmm(at);
          var l = Number(x.l100) > 0 ? Number(x.l100) : null;
          el("span", "", r, day);
          el("span", "", r, fmt(Number(x.distance_km), 1));
          el("span", "", r, x.duree_min != null ? String(Math.round(Number(x.duree_min))) : "—");
          el("span", l100Cls(l), r, fmt(l, 1));
          el("span", "", r, x.cout != null && isFinite(Number(x.cout)) ? fr(Number(x.cout), 2) : "—");
          el("span", ecoCls(Number(x.eco_score)), r, isFinite(Number(x.eco_score)) && x.eco_score != null ? String(Math.round(x.eco_score)) : "—");
        });
      }
      // The records
      var rs = c.records && S(c.records), a = rs ? rs.attributes : null;
      this.rec.hidden = !a;
      this.rec.innerHTML = "";
      if (a) {
        [[a.zero_cent ? fr(Number(a.zero_cent), 1) : "—", "0-100 s"], [a.quatre_vingt_cent_vingt ? fr(Number(a.quatre_vingt_cent_vingt), 1) : "—", "80-120 s"],
         [a.vitesse_max ? String(Math.round(a.vitesse_max)) : "—", "km/h max"], [a.plus_long_trajet ? fr(Number(a.plus_long_trajet), 1) : "—", "km max"],
         [a.meilleur_score_eco ? String(a.meilleur_score_eco) : "—", "éco max"]].forEach((x) => {
          var d = el("div", "", this.rec); el("b", "", d, x[0]); el("span", "", d, x[1]);
        });
      }
    }
  }

  // ----- igor-carmedia-card: the music of a car's head unit -----
  //   type: custom:igor-carmedia-card
  //   session: sensor.mycar_media_session      # the companion app's media session sensor
  //   fallback: sensor.car_music               # a sensor whose state is the title (attribute artiste)
  //   notify: notify.mobile_app_mycar          # sends command_media to the head unit
  //   package: deezer.android.app              # the player app
  //   title: musique · deezer
  // Previous, play or pause, next as three large buttons; a tap on the title
  // opens the app.
  class IgorCarMediaCard extends IgorCard {
    setConfig(config) {
      if (!config || !config.session) throw new Error("igor-carmedia-card: session est requis");
      this.config = config;
    }
    getCardSize() { return 3; }
    build() {
      this.style([
        ".h { color: var(--dim); font-size: 10.5px; letter-spacing: 0.16em; text-transform: uppercase; display: flex; align-items: center; gap: 7px; flex: none; }",
        ".h::before { content: ''; width: 6px; height: 6px; background: var(--igor-signal, #e5323b); }",
        ".ti { font-size: 15px; margin-top: 8px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer; flex: none; }",
        ".ar { color: var(--dim); font-size: 11.5px; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: none; }",
        ".ctl { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: auto; padding-top: 10px; flex: none; }",
        ".ctl button { height: 54px; background: none; border: 1px solid var(--line); border-radius: var(--igor-radius, 3px); color: var(--fg); cursor: pointer; --mdc-icon-size: 28px; display: grid; place-items: center; }",
        ".ctl button.p { border-color: #b48ce0; color: #b48ce0; }",
        ".ctl button:active { transform: scale(0.97); }"
      ].join("\n"));
      var card = el("ha-card", "", this.shadowRoot);
      el("div", "h", card, this.config.title || "musique");
      this.ti = el("div", "ti", card, "");
      this.ar = el("div", "ar", card, "");
      var pkg = this.config.package || "deezer.android.app";
      this.ti.addEventListener("click", () => haAction(this, { action: "url", url_path: "app://" + pkg }));
      var ctl = el("div", "ctl", card);
      this.playBtn = null;
      [["previous", "mdi:skip-previous"], ["play_pause", "mdi:play"], ["next", "mdi:skip-next"]].forEach((x) => {
        var b = el("button", x[0] === "play_pause" ? "p" : "", ctl);
        b.type = "button";
        var ic = icon(b, x[1]);
        if (x[0] === "play_pause") this.playIcon = ic;
        b.addEventListener("click", () => {
          if (!this._hass || !this.config.notify) return;
          service(this._hass, this.config.notify, { message: "command_media", data: { media_command: x[0], media_package_name: pkg } }).catch(() => {});
        });
      });
    }
    update(hass) {
      var s = hass.states[this.config.session], title = "", artist = "";
      // The session sensor holds media_title and media_artist, suffixed per player.
      Object.keys((s && s.attributes) || {}).forEach((k) => {
        var v = s.attributes[k];
        if (!v) return;
        if (!title && k.indexOf("media_title") === 0) title = String(v);
        if (!artist && k.indexOf("media_artist") === 0) artist = String(v);
      });
      // The title read in the player's notification (`fallback`) changes with
      // each track; the session sensor, on a head unit, is sent rarely and can
      // keep an old title: the one that changed last wins.
      var f = this.config.fallback && hass.states[this.config.fallback];
      var fOk = f && ["unknown", "unavailable", "Inconnu", ""].indexOf(f.state) < 0;
      var when = (x) => (x ? Date.parse(x.last_updated || x.last_changed) || 0 : 0);
      if (fOk && (!title || when(f) >= when(s))) { title = f.state; artist = (f.attributes && f.attributes.artiste) || ""; }
      var playing = s && s.state === "Playing";
      this.ti.textContent = title || "Rien en lecture";
      this.ar.textContent = (artist ? artist + " · " : "") + (playing ? "en lecture" : "en pause");
      if (this.playIcon) this.playIcon.setAttribute("icon", playing ? "mdi:pause" : "mdi:play");
    }
  }

  // ----- igor-gps-card: the car on its map, as a navigator shows it -----
  //   type: custom:igor-gps-card
  //   entity: device_tracker.car            # the position (companion app), or a sensor with location: [lat, lon]
  //   speed_entity: sensor.car_speed        # km/h from the car (OBD), better than the GPS's
  //   speed_limit_entity: sensor.speed_limit  # the limit sign, top right
  //   show_speed: true                      # false: no speed box on the map
  //   zoom: 16
  //   pitch: 45                             # 0: seen from above
  //   heading_up: true                      # the map turns with the road
  //   follow_pause: 15                      # seconds before following again after a finger
  //   snap: 20                              # metres within which the arrow sits on the nearest road; 0: off
  //   theme: sombre                         # sombre, clair, or auto (light by day, dark at night)
  //   hide_attribution: false
  //   style: <a MapLibre style URL>         # another base map
  //   destination: input_text.car_destination  # « lat,lon;Nom »: guidance there (set it from a phone, or the card's flag)
  //   favorites:                            # the flag's quick places
  //     - { name: Maison, zone: zone.home }
  //     - { name: Travail, location: [48.85, 2.35] }
  //   voice: true                           # instructions spoken (the browser's voice), false: silent; the 🔊 button mutes
  //   speed_limits: true                    # the limit sign from OpenStreetMap when speed_limit_entity says nothing (false: off)
  //   auto_zoom: true                       # farther out the faster, closer before a turn (false: the zoom stays)
  //   overpass: https://overpass-api.de/api/interpreter
  //   router: https://router.project-osrm.org  # OSRM (the route); self-hosted possible
  //   geocoder: https://nominatim.openstreetmap.org  # the address search
  // Taken from obd2mqtt's voiture-gps-card (MapLibre, heading up, smooth
  // movement, trail, limit sign), in Igor's look, with two changes: the arrow
  // sits on the nearest road drawn on the map (a GPS a few metres off no
  // longer drives through houses; farther than `snap`, a car park, it keeps
  // the real position), and between two fixes it goes on along that road for
  // at most 4 seconds instead of 8 straight ahead.
  var GPS_MAPLIBRE = "https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl";
  var GPS_DARK = "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";
  var GPS_DAY = "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json";
  var GPS_R = 6378137, GPS_PREDICT_S = 4, GPS_MOVING = 0.8, GPS_TRAIL = 600;
  function gpsMapLibre() {
    if (window.maplibregl) return Promise.resolve(window.maplibregl);
    if (!window.__igorMapLibre) {
      window.__igorMapLibre = new Promise(function (resolve, reject) {
        var sc = document.createElement("script");
        sc.src = GPS_MAPLIBRE + ".js";
        sc.onload = function () { resolve(window.maplibregl); };
        sc.onerror = function () { window.__igorMapLibre = null; reject(new Error("Carte indisponible (pas d'internet ?)")); };
        document.head.appendChild(sc);
      });
    }
    return window.__igorMapLibre;
  }
  var gpsRad = function (d) { return (d * Math.PI) / 180; }, gpsDeg = function (r) { return (r * 180) / Math.PI; };
  function gpsProject(p, brg, dist) {
    var b = gpsRad(brg);
    return [p[0] + gpsDeg((dist * Math.sin(b)) / (GPS_R * Math.cos(gpsRad(p[1])))), p[1] + gpsDeg((dist * Math.cos(b)) / GPS_R)];
  }
  function gpsDist(a, b) {
    var x = gpsRad(b[0] - a[0]) * Math.cos(gpsRad((a[1] + b[1]) / 2)), y = gpsRad(b[1] - a[1]);
    return Math.hypot(x, y) * GPS_R;
  }
  function gpsBearing(a, b) {
    var y = Math.sin(gpsRad(b[0] - a[0])) * Math.cos(gpsRad(b[1]));
    var x = Math.cos(gpsRad(a[1])) * Math.sin(gpsRad(b[1])) - Math.sin(gpsRad(a[1])) * Math.cos(gpsRad(b[1])) * Math.cos(gpsRad(b[0] - a[0]));
    return (gpsDeg(Math.atan2(y, x)) + 360) % 360;
  }
  // How far `to` lies ahead of `from` along a heading (metres; negative: behind).
  function gpsAhead(from, to, heading) {
    var d = gpsDist(from, to);
    if (d < 0.01) return 0;
    var diff = gpsRad(gpsBearing(from, to) - heading);
    return d * Math.cos(diff);
  }
  function gpsTurn(a, b) { return Math.abs(((b - a + 540) % 360) - 180); }
  function gpsLerpAngle(a, b, t) { var d = ((b - a + 540) % 360) - 180; return (a + d * t + 360) % 360; }
  // The nearest point to p on a set of lines ([[lon, lat], …] each), in
  // metres on a local flat projection: { point, dist, bearing } of the
  // segment, or null without lines.
  function gpsOnLine(p, line) {
    var kx = Math.cos(gpsRad(p[1])) * GPS_R * Math.PI / 180, ky = GPS_R * Math.PI / 180;
    var best = null;
    for (var i = 1; i < line.length; i++) {
      var ax = (line[i - 1][0] - p[0]) * kx, ay = (line[i - 1][1] - p[1]) * ky;
      var bx = (line[i][0] - p[0]) * kx, by = (line[i][1] - p[1]) * ky;
      var dx = bx - ax, dy = by - ay, len = dx * dx + dy * dy;
      var t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
      var qx = ax + t * dx, qy = ay + t * dy, d = Math.hypot(qx, qy);
      if (!best || d < best.dist) {
        best = { dist: d, point: [p[0] + qx / kx, p[1] + qy / ky], bearing: (gpsDeg(Math.atan2(dx, dy)) + 360) % 360, line: line, seg: i, t: t };
      }
    }
    return best;
  }
  function gpsNearest(p, lines) {
    var best = null;
    lines.forEach(function (line) {
      var b = gpsOnLine(p, line);
      if (b && (!best || b.dist < best.dist)) best = b;
    });
    return best;
  }
  // From a to b along a road line: the line's own vertices between the two,
  // so the trail bends with the road; null when a is not on that line or the
  // way round is much longer than the gap (another branch of the road).
  function gpsAlongLine(line, a, b) {
    var pa = gpsOnLine(a, line), pb = gpsOnLine(b, line);
    if (!pa || !pb || pa.dist > 4 || pb.dist > 4) return null;
    var out = [], i;
    if (pa.seg < pb.seg || (pa.seg === pb.seg && pa.t <= pb.t)) { for (i = pa.seg; i < pb.seg; i++) out.push(line[i]); }
    else { for (i = pa.seg - 1; i >= pb.seg; i--) out.push(line[i]); }
    var len = 0, prev = a;
    out.concat([b]).forEach(function (q) { len += gpsDist(prev, q); prev = q; });
    return len <= Math.max(3 * gpsDist(a, b), gpsDist(a, b) + 60) ? out : null;
  }
  // The road's direction closest to where the car heads (a road goes both ways).
  function gpsAlong(roadBearing, heading) {
    var back = (roadBearing + 180) % 360;
    var d1 = Math.abs(((roadBearing - heading + 540) % 360) - 180), d2 = Math.abs(((back - heading + 540) % 360) - 180);
    return d1 <= d2 ? roadBearing : back;
  }
  // The shortest way from a to b on a set of road lines (as drawn on the map,
  // cut at tiles and crossings): a small graph of their points, the pieces
  // joined where one ends on another (within 3 m), a and b set on their
  // nearest segments, then Dijkstra. The points of the way, or null when
  // there is none or it is much longer than the gap (not the same road).
  function gpsRoadPath(lines, a, b) {
    var nodes = [], key = {}, adj = [];
    var node = function (q) {
      var k = q[0].toFixed(6) + "," + q[1].toFixed(6);
      if (key[k] == null) { key[k] = nodes.length; nodes.push(q); adj.push([]); }
      return key[k];
    };
    var edge = function (i, j) {
      if (i === j) return;
      var d = gpsDist(nodes[i], nodes[j]);
      adj[i].push([j, d]); adj[j].push([i, d]);
    };
    var segs = [];
    lines.forEach(function (l) {
      for (var i = 1; i < l.length; i++) { var u = node(l[i - 1]), v = node(l[i]); edge(u, v); segs.push([u, v]); }
    });
    // A point onto its nearest segment, joined to both ends of it.
    var attach = function (q, within, skip) {
      var best = null;
      segs.forEach(function (sg) {
        if (skip != null && (sg[0] === skip || sg[1] === skip)) return;
        var o = gpsOnLine(q, [nodes[sg[0]], nodes[sg[1]]]);
        if (o && o.dist <= within && (!best || o.dist < best.o.dist)) best = { o: o, sg: sg };
      });
      if (!best) return null;
      var m = node(best.o.point);
      edge(m, best.sg[0]); edge(m, best.sg[1]);
      return m;
    };
    // Ends of pieces resting on another piece (tile cuts, T crossings).
    lines.forEach(function (l) {
      [l[0], l[l.length - 1]].forEach(function (end) { var e = node(end); var m = attach(end, 3, e); if (m != null) edge(e, m); });
    });
    var ia = attach(a, 30), ib = attach(b, 30);
    if (ia == null || ib == null) return null;
    var dist = new Array(nodes.length).fill(Infinity), prev = new Array(nodes.length).fill(-1), done = new Array(nodes.length).fill(false);
    dist[ia] = 0;
    for (;;) {
      var u = -1, du = Infinity;
      for (var i = 0; i < nodes.length; i++) if (!done[i] && dist[i] < du) { du = dist[i]; u = i; }
      if (u < 0 || u === ib) break;
      done[u] = true;
      adj[u].forEach(function (e) { if (du + e[1] < dist[e[0]]) { dist[e[0]] = du + e[1]; prev[e[0]] = u; } });
    }
    var gap = gpsDist(a, b);
    if (!isFinite(dist[ib]) || dist[ib] > Math.max(2.5 * gap, gap + 80)) return null;
    var out = [];
    for (var at = ib; at >= 0; at = prev[at]) out.unshift(nodes[at]);
    return out;
  }
  window.__igorGpsMath = { roadPath: gpsRoadPath, nearest: gpsNearest, along: gpsAlong, alongLine: gpsAlongLine, project: gpsProject, dist: gpsDist };
  var GPS_ARROW = '<svg viewBox="0 0 40 40" width="46" height="46"><circle cx="20" cy="20" r="18" fill="rgba(89,208,224,0.18)"/>' +
    '<path d="M20 4 L32 33 L20 26 L8 33 Z" fill="#59d0e0" stroke="#07080a" stroke-width="2.5" stroke-linejoin="round"/></svg>';
  // The French speed limit sign (B14): kept as the real thing, readable at a glance.
  var GPS_SIGN = '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="49.5" fill="#fff" stroke="rgba(0,0,0,0.35)" stroke-width="1"/>' +
    '<circle cx="50" cy="50" r="42.5" fill="none" stroke="#c8102e" stroke-width="11"/>' +
    '<text x="50" y="53" text-anchor="middle" dominant-baseline="middle" fill="#1a1a1a" font-family="\'Barlow Condensed\', \'Roboto Condensed\', \'Arial Narrow\', sans-serif" font-weight="700" font-size="44" letter-spacing="-1"></text></svg>';
  // ----- guidance: OSRM's route, its steps in French -----
  var GPS_SIDE = { left: "à gauche", right: "à droite", "slight left": "légèrement à gauche", "slight right": "légèrement à droite",
    "sharp left": "franchement à gauche", "sharp right": "franchement à droite", straight: "tout droit", uturn: "demi-tour" };
  var GPS_ICON = { left: "mdi:arrow-left-top", right: "mdi:arrow-right-top", "slight left": "mdi:arrow-top-left", "slight right": "mdi:arrow-top-right",
    "sharp left": "mdi:arrow-left-bottom", "sharp right": "mdi:arrow-right-bottom", straight: "mdi:arrow-up", uturn: "mdi:arrow-u-left-top" };
  function gpsStep(st) {
    var m = st.maneuver || {}, type = m.type || "", mod = m.modifier || "straight", side = GPS_SIDE[mod] || "";
    var road = st.name || st.ref || "";
    var on = road ? " sur " + road : "";
    var text, ic = GPS_ICON[mod] || "mdi:arrow-up";
    if (type === "depart") { text = "Partez" + (road ? " par " + road : ""); ic = "mdi:navigation-variant"; }
    else if (type === "arrive") { text = "Arrivée à destination" + (mod === "left" ? ", sur la gauche" : mod === "right" ? ", sur la droite" : ""); ic = "mdi:flag-checkered"; }
    else if (type === "roundabout" || type === "rotary" || type === "roundabout turn") {
      var n = m.exit || 1;
      text = "Au rond-point, prenez la " + (n === 1 ? "1re" : n + "e") + " sortie" + on; ic = "mdi:rotate-left";
    } else if (type === "exit roundabout" || type === "exit rotary") { text = "Sortez du rond-point" + on; ic = "mdi:rotate-left"; }
    else if (mod === "uturn") { text = "Faites demi-tour" + on; }
    else if (type === "merge") { text = "Insérez-vous" + (side && mod !== "straight" ? " " + side : "") + on; ic = "mdi:call-merge"; }
    else if (type === "on ramp") { text = "Prenez la bretelle" + (mod !== "straight" ? " " + side : "") + on; }
    else if (type === "off ramp") { text = "Prenez la sortie" + (mod !== "straight" ? " " + side : "") + (st.exits ? " " + st.exits : "") + (st.destinations ? " vers " + st.destinations : on); }
    else if (type === "fork") { text = "Restez " + (/left/.test(mod) ? "à gauche" : /right/.test(mod) ? "à droite" : "tout droit") + on; ic = "mdi:call-split"; }
    else if (type === "continue" || type === "new name" || mod === "straight") { text = "Continuez" + (mod === "straight" ? " tout droit" : " " + side) + on; }
    else { text = "Tournez " + side + on; }
    return { text: text, icon: ic, road: road, loc: m.location };
  }
  function gpsMetres(m) {
    if (m >= 1000) return (m >= 10000 ? Math.round(m / 1000) : (Math.round(m / 100) / 10).toString().replace(".", ",")) + " km";
    return (m >= 100 ? Math.round(m / 50) * 50 : Math.max(10, Math.round(m / 10) * 10)) + " m";
  }
  // « 48.85,2.35;Maison » (or « 48.85,2.35 ») → { lat, lon, name }.
  function gpsParseDest(v) {
    var s = String(v || "").trim(), m = s.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)(?:\s*;\s*(.*))?$/);
    if (!m) return null;
    var lat = Number(m[1]), lon = Number(m[2]);
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return { lat: lat, lon: lon, name: (m[3] || "").trim() || "destination" };
  }
  // An OpenStreetMap way's limit (km/h) in the car's direction, or null.
  var GPS_ZONES = { "FR:urban": 50, "FR:rural": 80, "FR:motorway": 130, "FR:zone30": 30, "FR:zone20": 20, "FR:walk": 20, "FR:living_street": 20, "FR:trunk": 110, "FR:expressway": 110 };
  function gpsLimitValue(v) {
    var s = String(v || "").trim();
    if (!s || s === "none" || s === "signals" || s === "variable") return null;
    if (GPS_ZONES[s] != null) return GPS_ZONES[s];
    var m = s.match(/^(\d+)\s*(mph)?/);
    if (!m) { var z = s.match(/^[A-Z]{2}:(?:zone)?(\d+)$/); return z ? Number(z[1]) : null; }
    return m[2] ? Math.round(Number(m[1]) * 1.609) : Number(m[1]);
  }
  function gpsWayLimit(tags, forward) {
    var t = tags || {};
    var dir = forward ? t["maxspeed:forward"] : t["maxspeed:backward"];
    var v = gpsLimitValue(dir) || gpsLimitValue(t.maxspeed) || gpsLimitValue(t["zone:maxspeed"]) || gpsLimitValue(t["maxspeed:type"]) || gpsLimitValue(t["source:maxspeed"]);
    if (v) return v;
    // Without a sign in the map: only what the road's kind says for sure.
    if (t.highway === "motorway") return 130;
    if (t.highway === "living_street") return 20;
    return null;
  }
  window.__igorGpsNav = { step: gpsStep, metres: gpsMetres, parse: gpsParseDest, limit: gpsWayLimit };

  class IgorGpsCard extends HTMLElement {
    setConfig(config) {
      if (!config || !config.entity) throw new Error("igor-gps-card: entity est requis (le device_tracker de l'autoradio)");
      this.config = Object.assign({ zoom: 16, pitch: 45, heading_up: true, follow_pause: 15, theme: "sombre", snap: 50 }, config);
      this.headingUp = this.config.heading_up !== false;
    }
    getCardSize() { return 6; }
    getGridOptions() { return { columns: 12, rows: 4, min_rows: 3 }; }
    set hass(hass) {
      this._hass = hass;
      if (!this.root) this.build();
      this.read();
    }
    connectedCallback() { if (this.map && !this.raf) this.raf = requestAnimationFrame(() => this.tick()); }
    disconnectedCallback() { cancelAnimationFrame(this.raf); this.raf = null; }
    build() {
      this.root = this.attachShadow({ mode: "open" });
      this.root.innerHTML = scaled(
        '<link rel="stylesheet" href="' + GPS_MAPLIBRE + '.css"><style>' +
        ":host { display: block; height: 100%; }" +
        "ha-card { display: block; position: relative; height: 100%; min-height: 240px; overflow: hidden; background: #07080a; border-radius: var(--igor-radius, 3px); }" +
        "#map { position: absolute; inset: 0; }" +
        ".msg { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; padding: 16px; text-align: center; color: #878c95; font-family: " + MONO + "; font-size: 13px; }" +
        ".msg[hidden] { display: none; }" +
        ".btns { position: absolute; top: 10px; left: 10px; display: flex; flex-direction: column; gap: 8px; z-index: 2; }" +
        ".btns button { width: 44px; height: 44px; border-radius: var(--igor-radius, 3px); border: 1px solid #22262c; cursor: pointer; background: rgba(7,8,10,0.85); color: #e9e4da; display: grid; place-items: center; --mdc-icon-size: 22px; }" +
        ".btns button[hidden] { display: none; }" +
        ".hud { position: absolute; z-index: 2; pointer-events: none; }" +
        ".hud.sp { left: 12px; bottom: 12px; } .hud.lim { right: 12px; top: 12px; }" +
        ".speed { min-width: 78px; height: 70px; padding: 0 12px; box-sizing: border-box; border-radius: var(--igor-radius, 3px); background: rgba(7,8,10,0.86); border: 1px solid #22262c; color: #e9e4da;" +
        " display: flex; flex-direction: column; align-items: center; justify-content: center; font-family: 'Chakra Petch', " + MONO + "; line-height: 0.95; }" +
        ".speed b { font-size: 38px; font-weight: 500; font-variant-numeric: tabular-nums; } .speed span { font-size: 11px; color: #878c95; letter-spacing: 0.12em; margin-top: 2px; }" +
        ".speed.over { color: #e5323b; border-color: #e5323b; } .speed[hidden] { display: none; }" +
        ".sign { width: 76px; height: 76px; filter: drop-shadow(0 4px 10px rgba(0,0,0,0.5)); } .sign svg { width: 100%; height: 100%; display: block; } .sign[hidden] { display: none; }" +
        ".sign.over { animation: igor-over 1s ease-in-out infinite; } @keyframes igor-over { 50% { transform: scale(1.07); } }" +
        ".snap { position: absolute; right: 12px; bottom: 12px; z-index: 2; font-family: " + MONO + "; font-size: 10px; color: #3d454e; letter-spacing: 0.1em; text-transform: uppercase; }" +
        ".noattr .maplibregl-ctrl-attrib, .noattr .maplibregl-ctrl-bottom-right { display: none !important; }" +
        "@media (prefers-reduced-motion: reduce) { .sign.over { animation: none; } }" +
        // guidance: the next turn on top, the rest of the way at the bottom, the destination panel
        ".nav { position: absolute; z-index: 2; top: 10px; left: 64px; right: 100px; display: flex; gap: 12px; align-items: center; padding: 10px 14px; border-radius: var(--igor-radius, 3px); background: rgba(7,8,10,0.92); border: 1px solid #22262c; border-left: 4px solid #59d0e0; color: #e9e4da; font-family: " + MONO + "; --mdc-icon-size: 44px; }" +
        ".nav[hidden], .eta[hidden], .panel[hidden] { display: none; }" +
        ".nav ha-icon { color: #59d0e0; flex: none; } .nav .d { font-family: 'Chakra Petch', " + MONO + "; font-size: 30px; font-weight: 500; line-height: 1; } .nav .t { font-size: 14px; color: #c9ccd1; margin-top: 4px; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }" +
        ".nav.arrived { border-left-color: #5cc28f; } .nav.arrived ha-icon { color: #5cc28f; } .nav.wait { border-left-color: #d9a441; }" +
        ".eta { position: absolute; z-index: 2; bottom: 12px; left: 12px; right: 12px; display: flex; gap: 14px; align-items: baseline; justify-content: space-around; padding: 8px 12px; border-radius: var(--igor-radius, 3px); background: rgba(7,8,10,0.88); border: 1px solid #22262c; color: #e9e4da; font-family: " + MONO + "; font-size: 15px; pointer-events: none; }" +
        ".withspeed .eta { left: 104px; } .withattr .eta { right: 52px; }" +
        ".eta { align-items: center; justify-content: flex-start; gap: 18px; }" +
        // Each figure on one line with its unit; the arrival takes what is left.
        ".eta b { font-family: 'Chakra Petch', " + MONO + "; font-size: 22px; font-weight: 500; white-space: nowrap; flex: none; }" +
        ".eta b small { font-size: 13px; font-weight: 400; color: #878c95; margin-left: 3px; }" +
        ".eta span { flex: 1; min-width: 0; color: #878c95; font-size: 12px; line-height: 1.35; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; border-left: 1px solid #22262c; padding-left: 14px; }" +
        ".eta span i { font-style: normal; color: #e9e4da; font-size: 15px; display: block; }" +
        ".panel { position: absolute; inset: 0; z-index: 4; background: rgba(7,8,10,0.96); color: #e9e4da; font-family: " + MONO + "; display: flex; flex-direction: column; gap: 10px; padding: 14px; box-sizing: border-box; overflow-y: auto; }" +
        ".panel .ph { display: flex; justify-content: space-between; align-items: center; color: #878c95; letter-spacing: 0.14em; text-transform: uppercase; font-size: 12px; }" +
        ".panel form { display: flex; gap: 8px; } .panel input { flex: 1; min-width: 0; font: inherit; font-size: 17px; padding: 12px; border-radius: var(--igor-radius, 3px); border: 1px solid #22262c; background: #0d1014; color: #e9e4da; }" +
        ".panel button { font: inherit; font-size: 15px; padding: 12px 16px; border-radius: var(--igor-radius, 3px); border: 1px solid #22262c; background: #12171c; color: #e9e4da; cursor: pointer; text-align: left;" +
        " display: flex; align-items: center; gap: 12px; --mdc-icon-size: 24px; min-height: 52px; } .panel button ha-icon { color: #59d0e0; flex: none; } .panel button > div { min-width: 0; }" +
        ".panel button[hidden] { display: none; }" +
        ".panel button.ic { width: 48px; height: 48px; min-height: 0; padding: 0; justify-content: center; } .panel button.ic ha-icon { color: #e9e4da; }" +
        ".panel button.go ha-icon, .panel button.stop ha-icon { color: inherit; } .panel button.go, .panel button.stop { justify-content: center; }" +
        ".panel button.go { background: #59d0e0; color: #07080a; border-color: #59d0e0; text-align: center; } .panel button.stop { border-color: #e5323b; color: #e5323b; text-align: center; }" +
        ".panel .list { display: grid; gap: 8px; } .panel .list small { display: block; color: #878c95; font-size: 12px; margin-top: 3px; } .panel .note { color: #878c95; font-size: 13px; }" +
        '</style><ha-card id="card"><div id="map"></div><div class="msg" id="msg">Chargement de la carte…</div>' +
        '<div class="btns"><button id="recenter" title="Recentrer" hidden><ha-icon icon="mdi:crosshairs-gps"></ha-icon></button>' +
        '<button id="orient" title="Orientation"><ha-icon icon="mdi:navigation-variant"></ha-icon></button>' +
        '<button id="dest" title="Destination"><ha-icon icon="mdi:flag-checkered"></ha-icon></button>' +
        '<button id="voice" title="Voix du guidage"><ha-icon icon="mdi:volume-high"></ha-icon></button></div>' +
        '<div class="nav" id="nav" hidden><ha-icon id="navIcon" icon="mdi:arrow-up"></ha-icon><div><div class="d" id="navD"></div><div class="t" id="navT"></div></div></div>' +
        '<div class="eta" id="eta" hidden></div>' +
        '<div class="panel" id="panel" hidden><div class="ph"><span>destination</span><button id="pclose" class="ic" title="Fermer"><ha-icon icon="mdi:close"></ha-icon></button></div>' +
        '<form id="pform"><input id="pq" type="text" enterkeyhint="search" placeholder="Adresse, ville, lieu…" autocomplete="off"><button class="go" type="submit"><ha-icon icon="mdi:magnify"></ha-icon><span>Chercher</span></button></form>' +
        '<div class="list" id="plist"></div><div class="list" id="pfav"></div><button class="stop" id="pstop" hidden><ha-icon icon="mdi:close-octagon-outline"></ha-icon><span>Arrêter le guidage</span></button></div>' +
        '<div class="hud sp"><div class="speed" id="speed"><b>0</b><span>KM/H</span></div></div>' +
        '<div class="hud lim"><div class="sign" id="limit" hidden>' + GPS_SIGN + "</div></div>" +
        '<div class="snap" id="snapEl"></div></ha-card>');
      var $ = (id) => this.root.getElementById(id);
      this.$ = $;
      $("card").classList.toggle("noattr", !!this.config.hide_attribution);
      $("card").classList.toggle("withspeed", this.config.show_speed !== false);
      $("card").classList.toggle("withattr", !this.config.hide_attribution);
      $("dest").addEventListener("click", () => this.openPanel());
      // The voice, on or off by a touch, kept by this screen.
      try { this.muted = window.localStorage.getItem("igor-gps-voice") === "off"; } catch (e) { this.muted = false; }
      var showVoice = () => {
        $("voice").hidden = this.config.voice === false;
        $("voice").firstElementChild.setAttribute("icon", this.muted ? "mdi:volume-off" : "mdi:volume-high");
        $("voice").title = this.muted ? "Voix coupée" : "Voix du guidage";
      };
      showVoice();
      $("voice").addEventListener("click", () => {
        this.muted = !this.muted;
        try { window.localStorage.setItem("igor-gps-voice", this.muted ? "off" : "on"); } catch (e) { /* no storage */ }
        if (this.muted && window.speechSynthesis) window.speechSynthesis.cancel();
        showVoice();
      });
      $("pclose").addEventListener("click", () => { $("panel").hidden = true; });
      $("pstop").addEventListener("click", () => { this.setDestination(null, true); $("panel").hidden = true; });
      $("pform").addEventListener("submit", (ev) => { ev.preventDefault(); this.search($("pq").value); });
      $("recenter").addEventListener("click", () => this.setFollow(true));
      $("orient").addEventListener("click", () => {
        this.headingUp = !this.headingUp;
        $("orient").firstElementChild.setAttribute("icon", this.headingUp ? "mdi:navigation-variant" : "mdi:compass-outline");
        if (!this.headingUp && this.map) this.map.easeTo({ bearing: 0 });
        this.setFollow(true);
      });
      this.follow = true;
      this.trail = [];
      this.heading = 0;
      this.shown = 0;
    }
    setFollow(on) {
      this.follow = on;
      clearTimeout(this.resume);
      this.$("recenter").hidden = on;
      if (!on && this.config.follow_pause > 0) this.resume = setTimeout(() => this.setFollow(true), this.config.follow_pause * 1000);
    }
    styleUrl() {
      if (this.config.style) return this.config.style;
      if (this.config.theme === "clair") return GPS_DAY;
      if (this.config.theme === "auto") {
        var sun = this._hass && this._hass.states["sun.sun"];
        return sun && sun.state === "above_horizon" ? GPS_DAY : GPS_DARK;
      }
      return GPS_DARK;
    }
    message(text) { this.$("msg").textContent = text; this.$("msg").hidden = !text; }
    read() {
      var st = this._hass.states[this.config.entity];
      if (!st) { this.message("Entité introuvable : " + this.config.entity); return; }
      var a = st.attributes, n = (v) => (v === undefined || v === null || v === "" ? undefined : Number(v));
      var course = n(a.course != null ? a.course : a.direction != null ? a.direction : a.bearing != null ? a.bearing : a.heading);
      var speed = n(a.speed != null ? a.speed : a.velocity);
      var lat = a.latitude, lon = a.longitude;
      if (typeof lat !== "number" && Array.isArray(a.location)) { lat = Number(a.location[0]); lon = Number(a.location[1]); }
      lat = typeof lat === "string" ? parseFloat(lat) : lat;
      lon = typeof lon === "string" ? parseFloat(lon) : lon;
      if (typeof lat !== "number" || typeof lon !== "number" || isNaN(lat) || isNaN(lon)) {
        this.message("Pas de position dans " + this.config.entity + " (état : " + st.state + ")");
        return;
      }
      var p = [lon, lat];
      // How far the GPS may be off (metres), as the companion app says.
      this.accuracy = Number(a.gps_accuracy != null ? a.gps_accuracy : a.accuracy) || 0;
      if (!this.fix || this.fix.updated !== st.last_updated) this.onFix(p, course, speed, st.last_updated);
      this.overlays();
      // A destination set elsewhere (the phone, Igor): guidance there.
      var de = this.config.destination && this._hass.states[this.config.destination];
      if (de && de.state !== this.destState) {
        this.destState = de.state;
        var dd = gpsParseDest(de.state);
        if (!dd && this.dest) this.setDestination(null, false);
        else if (dd && (!this.dest || gpsDist([dd.lon, dd.lat], [this.dest.lon, this.dest.lat]) > 5)) this.setDestination(dd, false);
      }
      if (!this.loading) this.init(p);
      else if (this.map && this.styleNow !== this.styleUrl()) {
        this.styleNow = this.styleUrl();
        this.map.setStyle(this.styleNow, { diff: false });
      }
    }
    onFix(p, course, gpsSpeed, updated) {
      var prev = this.fix && this.fix.point;
      var cand = null;
      if (typeof course === "number" && course > 0 && (gpsSpeed || 0) > GPS_MOVING) cand = course;
      else if (prev && gpsDist(prev, p) > 8) cand = gpsBearing(prev, p);
      // A car does not turn back on its road while it drives: a heading
      // reversed by one doubtful fix is ignored; three in a row (a real
      // U-turn) are believed. Stopped, the heading stays as it was.
      var rolling = this.speedMps() > 1.5;
      if (cand != null && rolling) {
        if (gpsTurn(this.heading, cand) > 110) {
          this.reverseVotes = (this.reverseVotes || 0) + 1;
          if (this.reverseVotes >= 3) { this.heading = cand; this.reverseVotes = 0; }
        } else { this.heading = cand; this.reverseVotes = 0; }
      } else if (cand != null && !this.fix) this.heading = cand;
      this.fix = { point: p, time: performance.now(), gpsSpeed: isFinite(gpsSpeed) ? gpsSpeed : 0, updated: updated };
    }
    // The trail is drawn on the roads only: each point the arrow takes on a
    // road, joined to the last one along that road's own shape; off the road
    // (snap on) nothing is drawn, and a gap that cannot be followed on the
    // road starts a new piece instead of a line across the houses.
    addTrail(p, onRoad) {
      var snapOn = (Number(this.config.snap) || 0) > 0;
      if (snapOn && !onRoad) { this.cut = true; return; }
      var piece = this.trail[this.trail.length - 1], last = piece && piece[piece.length - 1];
      if (last && !this.cut && gpsDist(last, p) < 5) return;
      // Driving, the trail does not come back on itself either.
      if (last && !this.cut && this.speedMps() > 1.5 && gpsAhead(last, p, this.heading) < -2) return;
      var path = null;
      if (last && onRoad && gpsDist(last, p) > 8) {
        var way = gpsRoadPath(this.roadLines(last, p, 40), last, p);
        if (way) path = way.slice(1, -1);
      }
      // A cut while off the road joins back along the road when it can.
      if (piece && this.cut && last && onRoad && gpsDist(last, p) < 400) {
        var back = gpsRoadPath(this.roadLines(last, p, 40), last, p);
        if (back) { path = back.slice(1, -1); this.cut = false; }
      }
      if (!piece || this.cut || (!path && gpsDist(last, p) > 25)) { this.trail.push([p]); this.cut = false; }
      else piece.push.apply(piece, (path || []).concat([p]));
      var n = this.trail.reduce(function (a, x) { return a + x.length; }, 0);
      while (n > GPS_TRAIL && this.trail.length) { n -= this.trail[0].length; this.trail.shift(); }
      var src = this.map && this.map.getSource("trail");
      if (src) src.setData(this.trailData());
    }
    speedMps() {
      var e = this.config.speed_entity && this._hass.states[this.config.speed_entity];
      var kmh = e ? parseFloat(e.state) : NaN;
      if (!isNaN(kmh)) return kmh / 3.6;
      return this.fix ? this.fix.gpsSpeed : 0;
    }
    overlays() {
      var kmh = Math.round(this.speedMps() * 3.6);
      var le = this.config.speed_limit_entity && this._hass.states[this.config.speed_limit_entity];
      var limit = le ? parseFloat(le.state) : NaN;
      // The entity says nothing (no sensor, unknown): the limit read here from OpenStreetMap.
      if (isNaN(limit) && this.config.speed_limits !== false && this.osmLimit) limit = this.osmLimit;
      var over = !isNaN(limit) && kmh > limit + 3;
      var sp = this.$("speed");
      sp.hidden = this.config.show_speed === false;
      sp.firstElementChild.textContent = kmh;
      sp.classList.toggle("over", over);
      var sign = this.$("limit");
      sign.hidden = isNaN(limit);
      if (!isNaN(limit)) {
        var t = sign.querySelector("text"), dg = String(Math.round(limit));
        if (t.textContent !== dg) { t.textContent = dg; t.setAttribute("font-size", dg.length > 2 ? "39" : "46"); }
        sign.classList.toggle("over", over);
      }
    }
    trailData() { return { type: "Feature", geometry: { type: "MultiLineString", coordinates: this.trail.filter(function (x) { return x.length > 1; }) } }; }
    async init(p) {
      this.loading = true;
      var ml;
      try { ml = await gpsMapLibre(); } catch (e) { this.message(e.message); this.loading = false; return; }
      var map = new ml.Map({
        container: this.$("map"), style: (this.styleNow = this.styleUrl()), center: p, zoom: this.config.zoom, pitch: this.config.pitch,
        bearing: this.headingUp ? this.heading : 0, attributionControl: this.config.hide_attribution ? false : { compact: true }
      });
      this.map = map;
      var arrow = document.createElement("div");
      arrow.innerHTML = GPS_ARROW;
      this.marker = new ml.Marker({ element: arrow, rotationAlignment: "map", pitchAlignment: "map" }).setLngLat(p).addTo(map);
      ["dragstart", "zoomstart", "rotatestart", "pitchstart"].forEach((ev) => map.on(ev, (e) => { if (e.originalEvent) this.setFollow(false); }));
      map.on("style.load", () => {
        // The roads of whatever base map: line layers of OpenMapTiles' « transportation ».
        this.roads = (map.getStyle().layers || []).filter((l) => l.type === "line" && /transportation|road/i.test(String(l["source-layer"] || ""))).map((l) => l.id);
        if (!map.getSource("route")) {
          map.addSource("route", { type: "geojson", data: this.routeData() });
          map.addLayer({ id: "route-case", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": "#07080a", "line-width": 11, "line-opacity": 0.8 } });
          map.addLayer({ id: "route", type: "line", source: "route", layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": "#3b8cff", "line-width": 7 } });
        }
        if (!map.getSource("trail")) {
          map.addSource("trail", { type: "geojson", data: this.trailData() });
          map.addLayer({ id: "trail", type: "line", source: "trail", layout: { "line-cap": "round", "line-join": "round" },
            paint: { "line-color": "#59d0e0", "line-width": 5, "line-opacity": 0.55 } });
        }
        this.message("");
      });
      map.on("error", (e) => console.warn("igor-gps-card:", e && e.error));
      new ResizeObserver(() => map.resize()).observe(this.$("map"));
      this.pos = p;
      this.shown = this.heading;
      if (!this.raf) this.raf = requestAnimationFrame(() => this.tick());
    }
    // The road lines drawn between two points (and a margin around them).
    roadLines(a, b, margin) {
      var map = this.map;
      if (!map || !this.roads || !this.roads.length) return [];
      var pa = map.project(a), pb = b ? map.project(b) : pa, m = margin || 60;
      var feats;
      try {
        feats = map.queryRenderedFeatures([[Math.min(pa.x, pb.x) - m, Math.min(pa.y, pb.y) - m], [Math.max(pa.x, pb.x) + m, Math.max(pa.y, pb.y) + m]], { layers: this.roads });
      } catch (e) { return []; }
      var lines = [];
      feats.forEach((f) => {
        var g = f.geometry, cls = String((f.properties && (f.properties.class || f.properties.subclass)) || "");
        // Only where a car drives: no railway, path, footway, cycleway, ferry.
        if (!g || /rail|transit|path|footway|pedestrian|cycle|bicycle|bridleway|steps|track|ferry|cable|aerial|pier/.test(cls)) return;
        if (/rail|path|ferry|aeroway|pier|transit|cable/.test(String(f.layer && f.layer.id || ""))) return;
        if (g.type === "LineString") lines.push(g.coordinates);
        else if (g.type === "MultiLineString") g.coordinates.forEach((l) => lines.push(l));
      });
      return lines;
    }
    // The nearest road drawn around a point, within `snap` metres (null otherwise).
    road(p, within, heading, now) {
      var map = this.map;
      if (!map || !this.roads || !this.roads.length || !(within > 0)) return null;
      // The search square: `within` metres around p, in pixels at this zoom.
      var mpp = 40075016 * Math.cos(gpsRad(p[1])) / (512 * Math.pow(2, map.getZoom()));
      var lines = this.roadLines(p, null, Math.min(600, within / mpp + 10));
      // Moving, a road that goes the car's way wins over a nearer one across
      // it (a crossing street, a parallel lane of the other direction is fine).
      var best = null;
      var bestStay = null;
      lines.forEach((l) => {
        var b = gpsOnLine(p, l);
        if (!b || b.dist > within) return;
        var off = heading == null ? 0 : Math.abs(((gpsAlong(b.bearing, heading) - heading + 540) % 360) - 180);
        // Staying on the road already taken wins over a slightly nearer one
        // (a noisy fix should not jump to a side street).
        var stay = this.lastRoad && gpsOnLine(this.lastRoad, l);
        b.stay = !!(stay && stay.dist <= 4);
        b.score = b.dist + (off > 50 ? 1000 : off * 0.15) + (this.lastRoad && !b.stay ? 10 : 0);
        if (!best || b.score < best.score) best = b;
        if (b.stay && b.score < 1000 && (!bestStay || b.score < bestStay.score)) bestStay = b;
      });
      // Parallel roads going the same way (a GPS that wanders between them):
      // the road taken is kept until the other one has been clearly nearer for
      // 3 seconds. A real turn changes the heading and switches at once.
      if (best && bestStay && best !== bestStay && best.score < 1000) {
        if (best.dist + 6 < bestStay.dist) {
          this.switchAt = this.switchAt || now || performance.now();
          if ((now || performance.now()) - this.switchAt < 3000) return bestStay;
        } else { this.switchAt = 0; return bestStay; }
      }
      this.switchAt = 0;
      return best && best.score < 1000 ? best : best && heading == null ? best : null;
    }
    tick() {
      this.raf = requestAnimationFrame(() => this.tick());
      if (!this.map || !this.fix) return;
      var now = performance.now(), speed = this.speedMps(), moving = speed > GPS_MOVING;
      // Between two fixes: on along the heading, 4 s at most.
      var elapsed = Math.min((now - this.fix.time) / 1000, GPS_PREDICT_S);
      var target = moving ? gpsProject(this.fix.point, this.heading, speed * elapsed) : this.fix.point;
      // Onto the road, a few times a second, moving or stopped, as a
      // navigator does: within `snap` metres, or what the GPS says it may be
      // off by when that is more (at most 150 m).
      var snapM = Number(this.config.snap) || 0;
      if (snapM > 0) snapM = Math.max(snapM, Math.min(this.accuracy || 0, 150));
      if (snapM > 0 && (!this.snapAt || now - this.snapAt > 200)) {
        this.snapAt = now;
        // Guided: the car is on its route as long as it is near enough (a GPS
        // off by a few tens of metres, a parallel street), never on another road.
        this.snapped = this.routeSnap(target, moving) || this.road(target, snapM, moving ? this.heading : null, now);
        if (this.snapped) this.lastRoad = this.snapped.point;
        this.$("snapEl").textContent = this.snapped ? "sur la route" : "";
      }
      // Driving, the arrow never goes back along its road: a target behind
      // it (a late or noisy fix) holds it where it is.
      if (moving && gpsAhead(this.pos, target, this.heading) < -0.5) target = this.pos;
      var s = this.snapped;
      if (s && moving && gpsAhead(this.pos, s.point, this.heading) < -0.5) s = null;
      if (s && gpsDist(s.point, target) <= (s.lock || snapM) * 1.5) {
        target = s.point;
        if (moving) this.heading = gpsLerpAngle(this.heading, gpsAlong(s.bearing, this.heading), 0.2);
      }
      // A leap (a late fix): the arrow drives there along the roads, not across.
      var before = this.pos;
      var jump = gpsDist(this.pos, target);
      // On the route, the arrow follows the route itself, never the streets beside it.
      if (s && s.onRoute) this.way = null;
      if (s && !s.onRoute && !this.way && jump > 25 && jump < 400) {
        var way = gpsRoadPath(this.roadLines(this.pos, target, 40), this.pos, target);
        // Not a way that starts by turning back (a car does not).
        var backwards = moving && way && way.length > 1 && gpsDist(way[0], way[1]) > 1 && gpsTurn(this.heading, gpsBearing(way[0], way[1])) > 110;
        if (way && way.length > 2 && !backwards) { this.way = way.slice(1); this.wayFrom = now; this.wayLen = jump; }
      }
      if (this.way && this.way.length) {
        // About a second for the whole way, at least the car's speed.
        var step = Math.max(this.wayLen * 0.06, speed * 0.016 * 1.2), left = step;
        while (left > 0 && this.way.length) {
          var nx = this.way[0], d = gpsDist(this.pos, nx);
          if (d <= left) { this.pos = nx; this.way.shift(); left -= d; }
          else { var f = left / d; this.pos = [this.pos[0] + (nx[0] - this.pos[0]) * f, this.pos[1] + (nx[1] - this.pos[1]) * f]; left = 0; }
        }
        if (!this.way.length || now - this.wayFrom > 2500) this.way = null;
      } else {
        var k = jump > 400 ? 1 : 0.15;
        this.pos = [this.pos[0] + (target[0] - this.pos[0]) * k, this.pos[1] + (target[1] - this.pos[1]) * k];
      }
      // Last guard: driving, not a step back (a big jump, a real relocation, still goes).
      if (moving && jump <= 400 && gpsAhead(before, this.pos, this.heading) < -0.2) this.pos = before;
      this.shown = gpsLerpAngle(this.shown, this.heading, 0.1);
      this.marker.setLngLat(this.pos).setRotation(this.shown);
      if (!this.trailAt || now - this.trailAt > 500) {
        this.trailAt = now;
        // On the road only once the arrow has reached it (not while gliding across).
        var on = s && gpsDist(this.pos, s.point) < 3 ? s : null;
        this.addTrail(on ? s.point : this.pos, on);
      }
      if (this.route && (!this.navAt || now - this.navAt > 1000)) { this.navAt = now; this.navTick(now, moving); }
      if (this.config.speed_limits !== false && (!this.limitAt || now - this.limitAt > 1000)) { this.limitAt = now; this.limitTick(now, moving); }
      if (this.follow) {
        var h = this.$("map").clientHeight;
        var view = { center: this.pos, bearing: this.headingUp ? this.shown : 0, padding: { top: this.headingUp ? h * 0.35 : 0, bottom: 0, left: 0, right: 0 } };
        // As a navigator: farther out the faster (more road ahead), closer
        // before a turn, back out after it; eased, never a jump.
        if (this.config.auto_zoom !== false) {
          var base = Number(this.config.zoom) || 16, kmh = speed * 3.6;
          var tz = base - Math.max(0, Math.min(2.2, (kmh - 40) / 40));
          if (this.route && this.nextDist != null && this.nextDist < 250) tz = Math.max(tz, base + 0.6);
          this.zoomNow = this.zoomNow == null ? tz : this.zoomNow + (tz - this.zoomNow) * 0.02;
          view.zoom = this.zoomNow;
        }
        this.map.jumpTo(view);
      }
    }
  }

  Object.assign(IgorGpsCard.prototype, {
    // On the route: its nearest point around where the car was last on it,
    // within what the GPS may be off (45 to 120 m), going the route's way.
    routeSnap(p, moving) {
      var R = this.route;
      if (!R || !p) return null;
      var lock = Math.max(45, Math.min((this.accuracy || 0) * 2, 120));
      var best = null, from = Math.max(1, (this.seg || 1) - 20), to = Math.min(R.coords.length, (this.seg || 1) + 300);
      for (var i = from; i < to; i++) {
        var o = gpsOnLine(p, [R.coords[i - 1], R.coords[i]]);
        if (o && (!best || o.dist < best.dist)) { best = o; best.i = i; }
      }
      if (!best || best.dist > lock) return null;
      // Driving against the route's way (a U-turn made): not on it any more.
      if (moving && Math.abs(((best.bearing - this.heading + 540) % 360) - 180) > 100) return null;
      best.lock = lock;
      best.onRoute = true;
      return best;
    },
    // The limit of the road the car is on: OpenStreetMap's ways around (Overpass),
    // asked again only when the car leaves the ways already known, at most every 8 s,
    // and only while it drives (a free service, not asked for a parked car).
    limitTick(now, moving) {
      var p = this.pos;
      if (!p) return;
      var le = this.config.speed_limit_entity && this._hass.states[this.config.speed_limit_entity];
      if (le && !isNaN(parseFloat(le.state))) return;
      var ways = this.limitWays || [], best = null;
      ways.forEach((w) => {
        var o = gpsOnLine(p, w.geom);
        if (!o) return;
        var along = gpsAlong(o.bearing, this.heading), off = Math.abs(((along - this.heading + 540) % 360) - 180);
        o.score = o.dist + (moving && off > 50 ? 40 : 0);
        o.w = w;
        if (!best || o.score < best.score) best = o;
      });
      if (best && best.dist < 25) {
        // Forward when the car goes the way the way is drawn.
        var fwd = Math.abs(((best.bearing - this.heading + 540) % 360) - 180) < 90;
        var v = gpsWayLimit(best.w.tags, fwd);
        if (v !== this.osmLimit) { this.osmLimit = v; this.overlays(); }
        return;
      }
      if (!moving || this.limitBusy || (this.limitAsked && now - this.limitAsked < 8000)) return;
      this.limitAsked = now;
      this.limitBusy = true;
      var q = '[out:json][timeout:8];way(around:60,' + p[1].toFixed(6) + ',' + p[0].toFixed(6) + ')[highway~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|road)(_link)?$"];out tags geom;';
      fetch(String(this.config.overpass || "https://overpass-api.de/api/interpreter"), { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "Content-Type": "application/x-www-form-urlencoded" } })
        .then((r) => r.json())
        .then((j) => {
          this.limitWays = (j.elements || []).filter((e) => e.type === "way" && Array.isArray(e.geometry) && e.geometry.length > 1)
            .map((e) => ({ tags: e.tags || {}, geom: e.geometry.map((g) => [g.lon, g.lat]) }));
          if (!this.limitWays.length) { this.osmLimit = null; this.overlays(); }
        })
        .catch(() => { /* no answer: the sign stays as it was */ })
        .then(() => { this.limitBusy = false; });
    },
    routeData() {
      return { type: "Feature", geometry: { type: "LineString", coordinates: this.route ? this.route.coords : [] } };
    },
    openPanel() {
      var $ = this.$;
      $("panel").hidden = false;
      $("pstop").hidden = !this.dest;
      $("plist").innerHTML = "";
      var fav = $("pfav");
      fav.innerHTML = "";
      var favs = this.config.favorites || [{ name: "Maison", zone: "zone.home" }];
      favs.forEach((f) => {
        var at = null;
        var ent = f.zone || f.entity;
        var st = ent && this._hass.states[ent];
        if (st && st.attributes.latitude != null) at = { lat: Number(st.attributes.latitude), lon: Number(st.attributes.longitude) };
        else if (Array.isArray(f.location)) at = { lat: Number(f.location[0]), lon: Number(f.location[1]) };
        if (!at) return;
        var b = document.createElement("button");
        b.type = "button";
        var fi = document.createElement("ha-icon"); fi.setAttribute("icon", f.icon || (ent === "zone.home" ? "mdi:home" : "mdi:star-outline")); b.appendChild(fi);
        var fl = document.createElement("span"); fl.textContent = f.name || ent; b.appendChild(fl);
        b.addEventListener("click", () => { this.setDestination({ lat: at.lat, lon: at.lon, name: f.name || ent }, true); $("panel").hidden = true; });
        fav.appendChild(b);
      });
      setTimeout(() => $("pq").focus(), 50);
    },
    // OpenStreetMap's search (Nominatim): on « Chercher » only, never as one types.
    async search(q) {
      var list = this.$("plist");
      q = String(q || "").trim();
      list.innerHTML = "";
      if (!q) return;
      var note = document.createElement("div"); note.className = "note"; note.textContent = "Recherche…"; list.appendChild(note);
      var here = this.pos || (this.fix && this.fix.point);
      var url = String(this.config.geocoder || "https://nominatim.openstreetmap.org").replace(/\/$/, "") + "/search?format=jsonv2&limit=6&accept-language=fr&q=" + encodeURIComponent(q) +
        (here ? "&viewbox=" + [here[0] - 1, here[1] + 1, here[0] + 1, here[1] - 1].map((x) => x.toFixed(4)).join(",") : "");
      var rows;
      try { rows = await (await fetch(url, { headers: { Accept: "application/json" } })).json(); }
      catch (e) { note.textContent = "Recherche impossible (pas d'internet ?)"; return; }
      list.innerHTML = "";
      if (!Array.isArray(rows) || !rows.length) { note.textContent = "Rien trouvé."; list.appendChild(note); return; }
      rows.forEach((r) => {
        var lat = Number(r.lat), lon = Number(r.lon);
        if (isNaN(lat) || isNaN(lon)) return;
        var b = document.createElement("button");
        b.type = "button";
        var parts = String(r.display_name || "").split(", ");
        var ri = document.createElement("ha-icon"); ri.setAttribute("icon", "mdi:map-marker-outline"); b.appendChild(ri);
        var rt = document.createElement("div"); rt.textContent = r.name || parts[0]; b.appendChild(rt);
        var sm = document.createElement("small");
        sm.textContent = parts.slice(r.name ? 0 : 1, 4).join(", ") + (here ? " · " + gpsMetres(gpsDist(here, [lon, lat])) : "");
        rt.appendChild(sm);
        b.addEventListener("click", () => { this.setDestination({ lat: lat, lon: lon, name: r.name || parts[0] }, true); this.$("panel").hidden = true; });
        list.appendChild(b);
      });
    },
    setDestination(d, write) {
      this.dest = d;
      this.route = null;
      this.spoken = {};
      this.offCount = 0;
      if (write && this.config.destination && this._hass) {
        var v = d ? d.lat.toFixed(6) + "," + d.lon.toFixed(6) + ";" + String(d.name || "").slice(0, 60) : "";
        this.destState = v;
        this._hass.callService("input_text", "set_value", { entity_id: this.config.destination, value: v }).catch(() => {});
      }
      if (this.destMarker) { this.destMarker.remove(); this.destMarker = null; }
      var src = this.map && this.map.getSource("route");
      if (src) src.setData(this.routeData());
      this.$("nav").hidden = !d;
      this.$("eta").hidden = true;
      if (!d) return;
      this.banner("mdi:map-search", "", "Calcul de l'itinéraire vers " + d.name + "…", "wait");
      if (this.map && window.maplibregl) {
        var flag = document.createElement("div");
        flag.innerHTML = '<svg viewBox="0 0 24 24" width="34" height="34"><path d="M5 21V4h11l-1.5 3.5L16 11H7v10z" fill="#e5323b" stroke="#07080a" stroke-width="1.2"/></svg>';
        this.destMarker = new window.maplibregl.Marker({ element: flag, anchor: "bottom-left" }).setLngLat([d.lon, d.lat]).addTo(this.map);
      }
      this.routeTo();
    },
    async routeTo() {
      var d = this.dest, from = this.pos || (this.fix && this.fix.point);
      if (!d) return;
      if (!from) { setTimeout(() => this.routeTo(), 2000); return; }
      this.routeAt = performance.now();
      var url = String(this.config.router || "https://router.project-osrm.org").replace(/\/$/, "") + "/route/v1/driving/" +
        from[0].toFixed(6) + "," + from[1].toFixed(6) + ";" + d.lon.toFixed(6) + "," + d.lat.toFixed(6) +
        "?overview=full&geometries=geojson&steps=true" + (this.speedMps() > 2 ? "&bearings=" + Math.round(this.heading) + ",60;" : "");
      var body;
      try { body = await (await fetch(url)).json(); }
      catch (e) { this.banner("mdi:wifi-off", "", "Itinéraire indisponible (pas d'internet ?)", "wait"); return; }
      if (this.dest !== d) return;
      var r = body && body.routes && body.routes[0];
      if (!r || !r.geometry) { this.banner("mdi:map-marker-question", "", "Pas d'itinéraire vers " + d.name, "wait"); return; }
      var coords = r.geometry.coordinates, cum = [0];
      for (var i = 1; i < coords.length; i++) cum.push(cum[i - 1] + gpsDist(coords[i - 1], coords[i]));
      var steps = [];
      (r.legs || []).forEach((leg) => (leg.steps || []).forEach((st) => {
        var s = gpsStep(st);
        if (!s.loc) return;
        // Where the step's turn lies along the route.
        var o = gpsOnLine(s.loc, coords);
        s.at = o ? cum[o.seg - 1] + gpsDist(coords[o.seg - 1], o.point) : 0;
        steps.push(s);
      }));
      this.route = { coords: coords, cum: cum, steps: steps, total: cum[cum.length - 1], duration: r.duration || 0 };
      this.seg = 1;
      var src = this.map && this.map.getSource("route");
      if (src) src.setData(this.routeData());
      this.navTick(performance.now(), false);
    },
    banner(icon, dist, text, cls) {
      var $ = this.$;
      $("nav").hidden = false;
      $("nav").className = "nav" + (cls ? " " + cls : "");
      $("navIcon").setAttribute("icon", icon);
      $("navD").textContent = dist;
      $("navT").textContent = text;
    },
    say(text) {
      if (this.config.voice === false || this.muted || !window.speechSynthesis) return;
      try {
        var u = new SpeechSynthesisUtterance(text);
        u.lang = "fr-FR";
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(u);
      } catch (e) { /* no voice on this screen */ }
    },
    navTick(now, moving) {
      var R = this.route, p = this.pos;
      if (!R || !p) return;
      // Where the car is along the route: the nearest segment, near the last one first.
      var best = null, from = Math.max(1, (this.seg || 1) - 10), to = Math.min(R.coords.length, (this.seg || 1) + 400);
      for (var pass = 0; pass < 2 && (!best || best.dist > 60); pass++) {
        var a = pass ? 1 : from, b = pass ? R.coords.length : to;
        for (var i = a; i < b; i++) {
          var o = gpsOnLine(p, [R.coords[i - 1], R.coords[i]]);
          if (o && (!best || o.dist < best.dist)) { best = o; best.i = i; }
        }
      }
      if (!best) return;
      this.seg = best.i;
      var along = R.cum[best.i - 1] + gpsDist(R.coords[best.i - 1], best.point);
      var left = Math.max(0, R.total - along);
      // Off the route for a few seconds, driving: a new one from here.
      // Off the route only after 5 seconds farther than the GPS may be off,
      // driving: a parallel street seen for a moment is not a new route.
      var off = Math.max(45, Math.min((this.accuracy || 0) * 2, 120));
      this.offCount = best.dist > off && moving ? (this.offCount || 0) + 1 : 0;
      if (this.offCount >= 5 && now - (this.routeAt || 0) > 8000) {
        this.offCount = 0;
        this.banner("mdi:routes", "", "Nouvel itinéraire…", "wait");
        this.say("Nouvel itinéraire");
        this.routeTo();
        return;
      }
      var d = this.dest;
      if (left < 30 || (d && gpsDist(p, [d.lon, d.lat]) < 30)) {
        if (!this.arrived) {
          this.arrived = true;
          this.banner("mdi:flag-checkered", "", "Vous êtes arrivé" + (d && d.name !== "destination" ? " : " + d.name : ""), "arrived");
          this.$("eta").hidden = true;
          this.say("Vous êtes arrivé");
          setTimeout(() => { if (this.arrived) { this.arrived = false; this.setDestination(null, true); } }, 15000);
        }
        return;
      }
      this.arrived = false;
      var next = null;
      for (var k = 0; k < R.steps.length; k++) { if (R.steps[k].at > along + 8) { next = R.steps[k]; break; } }
      this.nextDist = next ? next.at - along : null;
      if (next) {
        var dn = next.at - along;
        this.banner(next.icon, gpsMetres(dn), next.text, "");
        // Spoken at 1 km on fast roads, 400 m, 100 m, and at the turn.
        var key = next.at.toFixed(0), sp = this.spoken[key] || 0;
        var stage = dn < 40 ? 3 : dn < 130 ? 2 : dn < 450 ? 1 : 0;
        if (stage > sp) {
          this.spoken[key] = stage;
          this.say(stage === 3 ? next.text : "Dans " + gpsMetres(dn).replace(" m", " mètres").replace(" km", " kilomètres") + ", " + next.text.charAt(0).toLowerCase() + next.text.slice(1));
        }
      }
      // The rest of the way: kilometres, minutes, arrival time.
      var secs = R.total ? R.duration * (left / R.total) : 0;
      var eta = new Date(Date.now() + secs * 1000);
      var e = this.$("eta");
      e.hidden = false;
      e.innerHTML = "";
      // « 450 m · 1 min », each with its unit, never split; then the arrival.
      var fig = function (v, unit) {
        var b = document.createElement("b"); b.textContent = v;
        var u = document.createElement("small"); u.textContent = unit; b.appendChild(u); e.appendChild(b);
      };
      var dist = gpsMetres(left).split(" ");
      fig(dist[0], dist[1] || "");
      if (secs >= 3600) fig(Math.floor(secs / 3600) + " h " + String(Math.round((secs % 3600) / 60)).padStart(2, "0"), "");
      else fig(String(Math.max(1, Math.round(secs / 60))), "min");
      var sp2 = document.createElement("span");
      var at = document.createElement("i"); at.textContent = "arrivée " + hhmm(eta); sp2.appendChild(at);
      if (d && d.name !== "destination") sp2.appendChild(document.createTextNode(d.name));
      e.appendChild(sp2);
    }
  });

  // ----- igor-security-card: the alarm, the camera, its positions -----
  //   type: custom:igor-security-card
  //   alarm: input_boolean.alarm            # or an alarm_control_panel
  //   active: binary_sensor.alarm_triggered # optional: « INTRUSION »
  //   privacy: switch.camera_privacy_mode   # optional: the camera on or private
  //   camera: camera.living_room            # optional: its saved positions found on its device
  //   presets: select.camera_ptz_preset     # optional: those positions, named
  // Arming is one tap. Disarming asks for the disarm code on a keypad and goes
  // through nives.disarm (five wrong codes, ten minutes), never a plain switch.
  class IgorSecurityCard extends IgorCard {
    setConfig(config) {
      if (!config || !config.alarm) throw new Error("igor-security-card: alarm est requis");
      this.config = config;
    }
    getCardSize() { return 6; }
    build() {
      this.style([
        ".st { text-align: center; padding: 10px 0 12px; border-bottom: 1px solid var(--line); flex: none; }",
        ".st b { display: block; font-family: 'Chakra Petch', " + MONO + "; font-size: 26px; letter-spacing: 0.24em; font-weight: 600; }",
        ".st span { color: var(--dim); font-size: 11.5px; }",
        ".st.armed b { color: var(--wait); } .st.off b { color: var(--okc); } .st.alert b { color: var(--bad); animation: igor-alert 1s steps(2) infinite; }",
        "@keyframes igor-alert { 50% { opacity: 0.35; } } @media (prefers-reduced-motion: reduce) { .st.alert b { animation: none; } }",
        ".row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 12px; flex: none; }",
        ".big { min-height: 84px; background: var(--card); border: 1px solid var(--line); border-radius: var(--igor-radius, 3px); color: var(--fg); font-family: inherit; font-size: 13px; letter-spacing: 0.1em;",
        "  text-transform: uppercase; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; cursor: pointer; --mdc-icon-size: 32px; }",
        ".big[disabled] { opacity: 0.35; cursor: default; } .big:active:not([disabled]) { transform: scale(0.98); }",
        ".big.arm { border-color: var(--wait); color: var(--wait); } .big.disarm { border-color: var(--okc); color: var(--okc); }",
        ".big.cam.on { border-color: var(--acc); color: var(--acc); } .big.cam.off { color: var(--dim); }",
        ".h { color: var(--dim); font-size: 10.5px; letter-spacing: 0.14em; text-transform: uppercase; margin: 14px 0 6px; display: flex; align-items: center; gap: 7px; flex: none; }",
        ".h::before { content: ''; width: 6px; height: 6px; background: var(--igor-signal, #e5323b); }",
        ".pre { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 8px; flex: none; }",
        ".pre button { min-height: 52px; background: var(--card); border: 1px solid var(--line); border-radius: var(--igor-radius, 3px); color: var(--fg); font: inherit; font-size: 12px; cursor: pointer; padding: 6px; }",
        ".pre button.sel { border-color: var(--acc); color: var(--acc); }",
        ".pad { position: fixed; inset: 0; z-index: 2147482990; background: rgba(0,0,0,0.78); display: flex; align-items: center; justify-content: center; }",
        ".pad[hidden] { display: none; }",
        ".box { background: #07080a; border: 1px solid var(--line); border-radius: var(--igor-radius, 3px); padding: 18px; display: flex; flex-direction: column; align-items: center; gap: 12px; min-width: 260px; }",
        ".box .t { letter-spacing: 0.2em; font-size: 13px; color: var(--dim); }",
        ".box .c { font-size: 26px; letter-spacing: 0.5em; color: var(--acc); min-height: 1.3em; min-width: 7em; text-align: center; border-bottom: 1px solid var(--line); }",
        ".box .m { min-height: 1.3em; font-size: 12px; color: var(--bad); } .box .m.ok { color: var(--okc); }",
        ".keys { display: grid; grid-template-columns: repeat(3, 72px); gap: 8px; }",
        ".keys button { height: 58px; background: var(--card); border: 1px solid var(--line); border-radius: var(--igor-radius, 3px); color: var(--fg); font: inherit; font-size: 22px; cursor: pointer; display: grid; place-items: center; --mdc-icon-size: 24px; }",
        ".keys .ok { border-color: var(--okc); color: var(--okc); font-size: 16px; }",
        ".x { background: none; border: 1px solid var(--line); color: var(--dim); font: inherit; padding: 6px 16px; border-radius: var(--igor-radius, 3px); cursor: pointer; }"
      ].join("\n"));
      var card = el("ha-card", "", this.shadowRoot);
      var top = el("div", "top", card);
      el("span", "t", top, this.config.title || "sécurité");
      this.stEl = el("div", "st", card);
      this.stB = el("b", "", this.stEl);
      this.stS = el("span", "", this.stEl);
      var row = el("div", "row", card);
      var mk = (cls, ic, label, fn) => { var b = el("button", "big " + cls, row); b.type = "button"; icon(b, ic); el("span", "", b, label); b.addEventListener("click", fn); return b; };
      this.armB = mk("arm", "mdi:shield-lock", "armer", () => this.arm());
      this.disB = mk("disarm", "mdi:shield-off", "désarmer", () => this.openPad());
      if (this.config.privacy) {
        var row2 = el("div", "row", card);
        row2.style.gridTemplateColumns = "1fr";
        this.camB = el("button", "big cam", row2);
        this.camB.type = "button";
        this.camIc = icon(this.camB, "mdi:cctv");
        this.camL = el("span", "", this.camB, "caméra");
        this.camB.addEventListener("click", () => {
          if (this._hass) this._hass.callService("switch", "toggle", {}, { entity_id: this.config.privacy });
        });
      }
      this.preH = el("div", "h", card, "positions de la caméra");
      this.pre = el("div", "pre", card);
      this.preH.hidden = this.pre.hidden = true;
      // The keypad, over the page.
      this.pad = el("div", "pad", this.shadowRoot);
      this.pad.hidden = true;
      var box = el("div", "box", this.pad);
      el("div", "t", box, "CODE DE DÉSARMEMENT");
      this.codeEl = el("div", "c", box);
      this.msgEl = el("div", "m", box);
      var keys = el("div", "keys", box);
      this.code = "";
      ["1", "2", "3", "4", "5", "6", "7", "8", "9", "del", "0", "OK"].forEach((k) => {
        var b = el("button", k === "OK" ? "ok" : "", keys, k === "del" ? null : k);
        if (k === "del") { icon(b, "mdi:backspace-outline"); b.title = "Effacer"; b.setAttribute("aria-label", "Effacer"); }
        b.type = "button";
        b.addEventListener("click", () => this.key(k));
      });
      var x = el("button", "x", box, "annuler");
      x.type = "button";
      x.addEventListener("click", () => this.closePad());
      this.pad.addEventListener("click", (ev) => { if (ev.target === this.pad) this.closePad(); });
    }
    isOn(st) { return !!st && st.state !== "off" && st.state !== "disarmed" && st.state !== "unavailable" && st.state !== "unknown"; }
    arm() {
      var a = this.config.alarm, h = this._hass;
      if (!h) return;
      if (/^alarm_control_panel\./.test(a)) h.callService("alarm_control_panel", "alarm_arm_away", {}, { entity_id: a });
      else h.callService("homeassistant", "turn_on", {}, { entity_id: a });
    }
    openPad() { this.code = ""; this.msgEl.textContent = ""; this.msgEl.className = "m"; this.codeEl.textContent = ""; this.pad.hidden = false; }
    closePad() { this.pad.hidden = true; this.code = ""; }
    key(k) {
      if (k === "del") this.code = this.code.slice(0, -1);
      else if (k === "OK") return this.send();
      else if (this.code.length < 12) this.code += k;
      this.msgEl.textContent = "";
      this.codeEl.textContent = this.code.replace(/./g, "•");
    }
    send() {
      var c = this.code;
      this.code = "";
      this.codeEl.textContent = "";
      if (!c || !this._hass) return;
      this.msgEl.className = "m";
      this.msgEl.textContent = "…";
      this._hass.callWS({ type: "call_service", domain: "nives", service: "disarm", service_data: { code: c }, return_response: true })
        .then((r) => {
          var res = (r && r.response) || {};
          this.msgEl.className = "m" + (res.ok ? " ok" : "");
          this.msgEl.textContent = res.message || (res.ok ? "Alarme désarmée." : "Refusé.");
          if (res.ok) setTimeout(() => this.closePad(), 1200);
        })
        .catch(() => { this.msgEl.textContent = "Indisponible (mettez à jour Igor)."; });
    }
    // The camera's saved positions: the configured select, or the one with
    // « preset » in its name on the camera's device.
    presetEntity(hass) {
      if (this.config.presets) return this.config.presets;
      if (!this.config.camera || !hass.entities) return null;
      var reg = hass.entities[this.config.camera], dev = reg && reg.device_id;
      if (!dev) return null;
      var found = null;
      Object.keys(hass.entities).forEach((id) => { if (!found && /^select\./.test(id) && /preset/i.test(id) && hass.entities[id].device_id === dev) found = id; });
      return found;
    }
    update(hass) {
      var a = hass.states[this.config.alarm], act = this.config.active && hass.states[this.config.active];
      var on = this.isOn(a), alert = (act && act.state === "on") || (a && a.state === "triggered");
      this.stEl.className = "st " + (alert ? "alert" : on ? "armed" : "off");
      this.stB.textContent = alert ? "INTRUSION" : on ? "ARMÉE" : "DÉSARMÉE";
      this.stS.textContent = !a ? "alarme introuvable : " + this.config.alarm : alert ? "désarmer avec le code" : on ? "désarmer : le code" : "prête à être armée";
      this.armB.disabled = on;
      this.disB.disabled = !on && !alert;
      if (this.camB) {
        var p = hass.states[this.config.privacy], priv = p && p.state === "on";
        this.camB.className = "big cam " + (priv ? "off" : "on");
        this.camIc.setAttribute("icon", priv ? "mdi:cctv-off" : "mdi:cctv");
        this.camL.textContent = priv ? "caméra privée · toucher pour activer" : "caméra active · toucher pour la couper";
      }
      var pe = this.presetEntity(hass), ps = pe && hass.states[pe];
      var opts = ps && Array.isArray(ps.attributes.options) ? ps.attributes.options : [];
      this.preH.hidden = this.pre.hidden = !opts.length;
      var sig = pe + "|" + opts.join("|") + "|" + (ps ? ps.state : "");
      if (sig === this.preSig) return;
      this.preSig = sig;
      this.pre.innerHTML = "";
      opts.forEach((o) => {
        var b = el("button", o === ps.state ? "sel" : "", this.pre, o);
        b.type = "button";
        b.addEventListener("click", () => hass.callService("select", "select_option", { option: o }, { entity_id: pe }));
      });
    }
  }

  // ----- igor-alerts-card: what is wrong, first -----
  //   type: custom:igor-alerts-card
  //   gateway: sensor.opnsense_…_gateway_wan_dhcp_status   # the internet
  //   memory_warn: 90       # % of a machine's memory
  //   temp_warn: 55         # °C of a disk
  // Found by itself: Proxmox machines stopped or short of memory, disks too
  // hot, containers stopped (a « relancer » button) and images to update.
  class IgorAlertsCard extends IgorCard {
    setConfig(config) { this.config = config || {}; }
    build() {
      this.style([
        ".sum { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; text-align: center; padding: 4px 0 8px; border-bottom: 1px solid var(--line); flex: none; }",
        ".sum b { display: block; font-size: 19px; font-weight: 500; }",
        ".sum span { color: var(--dim); font-size: 10.5px; }",
        ".al { display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; gap: 10px; align-items: start; padding: 8px 0; border-bottom: 1px dashed var(--line); --mdc-icon-size: 18px; }",
        ".al:last-child { border-bottom: 0; }",
        ".al .t div { color: var(--dim); font-size: 11px; }",
        ".al.warn ha-icon { color: var(--wait); } .al.bad ha-icon { color: var(--bad); }",
        ".chip { font-size: 10.5px; border: 1px solid var(--line); border-radius: var(--igor-radius, 3px); padding: 2px 9px; color: var(--dim); background: none; font-family: inherit; cursor: pointer; white-space: nowrap; }",
        ".ok { color: var(--okc); padding: 10px 0; }"
      ].join("\n"));
      var card = el("ha-card", "", this.shadowRoot);
      var top = el("div", "top", card);
      el("span", "t", top, this.config.title || "ce qui ne va pas");
      this.count = el("span", "sub", top);
      this.sum = el("div", "sum", card);
      this.list = el("div", "", card);
    }
    update(hass, prev) {
      var now = Date.now();
      if (prev && now - (this.drawn || 0) < 10000) return;
      this.drawn = now;
      var c = this.config, alerts = [], memWarn = Number(c.memory_warn) || 90, tempWarn = Number(c.temp_warn) || 55;
      var S = function (id) { return id ? hass.states[id] : null; };
      var P = proxmoxParts(hass, c.proxmox || "proxmoxve");
      var machines = (P.node ? [P.node] : []).concat(P.guests), up = 0;
      machines.forEach(function (m) {
        var st = S(m.status), running = !st || ["on", "running", "online"].indexOf(st.state) >= 0;
        if (running) up++;
        else alerts.push(["bad", "mdi:server-off", m.label + " arrêtée", "", m.status, "voir"]);
        var mp = num(S(m.memp));
        if (running && mp != null && mp >= memWarn) alerts.push(["warn", "mdi:memory", m.label + " · mémoire " + Math.round(mp) + " %", m === P.node ? "l'hôte manque de mémoire" : "", m.memp, "voir"]);
      });
      P.disks.forEach(function (d) {
        var t = num(S(d.temp));
        if (t != null && t >= tempWarn) alerts.push(["warn", "mdi:thermometer-alert", d.label + " · " + Math.round(t) + "°", "disque chaud", d.temp, "voir"]);
      });
      var cts = dockerContainers(hass, c.docker || "portainer").filter(function (x) { var st = S(x.state); return st && ["unavailable", "unknown"].indexOf(String(st.state).toLowerCase()) < 0; });
      var running = 0, updates = [];
      cts.forEach(function (x) {
        var st = String(S(x.state).state).toLowerCase();
        if (st === "running") running++;
        else alerts.push(["bad", "mdi:package-variant-closed-remove", x.name + " · " + (st === "exited" ? "arrêté" : st), "", x.restart ? { press: x.restart } : x.state, x.restart ? "relancer" : "voir"]);
        if (S(x.update) && S(x.update).state === "on") updates.push(x);
      });
      if (updates.length) alerts.push(["warn", "mdi:update", updates.length + (updates.length > 1 ? " images à mettre à jour" : " image à mettre à jour"), updates.map(function (x) { return x.name; }).join(", "), updates[0].update, "voir"]);
      var gw = c.gateway ? S(c.gateway) : null, net = gw ? String(gw.state).toLowerCase() : "";
      if (gw && net !== "online") alerts.push(["bad", "mdi:web-off", "internet · " + (GW_WORDS[net] || net), "passerelle principale", c.gateway, "voir"]);
      this.count.textContent = alerts.length ? String(alerts.length) : "";
      this.sum.innerHTML = "";
      [[up + "/" + machines.length, "machines", up < machines.length], [running + "/" + cts.length, "conteneurs", running < cts.length], [gw ? (net === "online" ? "ok" : "coupé") : "—", "internet", gw && net !== "online"]].forEach((x) => {
        var s = el("span", "", this.sum);
        el("b", x[2] ? "warn" : "okc", s, x[0]);
        s.appendChild(document.createTextNode(x[1]));
      });
      this.list.innerHTML = "";
      if (!alerts.length) { el("div", "ok", this.list, "Tout va bien."); return; }
      alerts.forEach((a) => {
        var row = el("div", "al " + a[0], this.list);
        icon(row, a[1]);
        var t = el("span", "t", row, a[2]);
        if (a[3]) el("div", "", t, a[3]);
        var b = el("button", "chip", row, a[5]);
        b.type = "button";
        b.addEventListener("click", () => {
          if (a[4] && a[4].press) { press(this._hass, a[4].press); b.textContent = "envoyé"; }
          else if (a[4]) moreInfo(this, a[4]);
        });
      });
    }
  }

  // ----- Home Assistant's notifications: those waiting and those sent -----
  // The ones waiting (persistent_notification, the bell of the sidebar),
  // live; `cb(list)` with the newest first. Returns a function that stops.
  function watchPersistent(hass, cb) {
    var current = {}, stop = null, done = false;
    var emit = function () {
      cb(Object.keys(current).map(function (k) { return current[k]; })
        .sort(function (a, b) { return Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0); }));
    };
    try {
      hass.connection.subscribeMessage(function (m) {
        if (!m) return;
        if (m.type === "current") current = {};
        var n = m.notifications || {};
        Object.keys(n).forEach(function (k) {
          if (m.type === "removed") delete current[k]; else current[k] = n[k];
        });
        emit();
      }, { type: "persistent_notification/subscribe" }).then(function (u) { if (done) u(); else stop = u; }).catch(function () { cb([]); });
    } catch (e) { cb([]); }
    return function () { done = true; if (stop) { try { stop(); } catch (e) { /* gone */ } stop = null; } };
  }
  // The newest sent notification this screen has shown (kept by the browser).
  function seenSent() {
    try { return window.localStorage.getItem("igor-notifications-seen") || ""; } catch (e) { return ""; }
  }
  function markSent(at) {
    if (!at || at <= seenSent()) return;
    try { window.localStorage.setItem("igor-notifications-seen", at); } catch (e) { /* no storage */ }
    window.dispatchEvent(new Event("igor-notifications-seen"));
  }
  function newestSent(hass) {
    return hass.callWS({ type: "call_service", domain: "nives", service: "notifications", service_data: { limit: 1 }, return_response: true })
      .then(function (r) { var e = r && r.response && r.response.entries; return e && e[0] ? e[0].at : ""; })
      .catch(function () { return ""; });
  }
  function whenText(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return "";
    return d.toDateString() === new Date().toDateString() ? hhmm(d) : pad(d.getDate()) + "/" + pad(d.getMonth() + 1) + " " + hhmm(d);
  }
  // Home Assistant's notifications are Markdown (titles, bold, links, pictures,
  // often a picture written into the text): shown as such, built as nodes,
  // never as HTML. A picture is kept only from a web address or as image data.
  var MD_IMG = /^(data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+\/=]+|https?:\/\/\S+)$/;
  function mdInline(parent, text) {
    String(text || "").split(/(\*\*[^*]+\*\*|\[[^\]]*\]\([^)\s]+\)|https?:\/\/[^\s<>")]+)/).forEach(function (part) {
      if (!part) return;
      var b = part.match(/^\*\*([^*]+)\*\*$/), l = part.match(/^\[([^\]]*)\]\(([^)\s]+)\)$/);
      if (b) el("strong", "", parent, b[1]);
      else if (l || /^https?:\/\//.test(part)) {
        var href = l ? l[2] : part, label = l ? (l[1] || l[2]) : part;
        if (/^https?:\/\//.test(href)) {
          var a = el("a", "", parent, label.length > 48 ? label.slice(0, 45) + "…" : label);
          a.href = href; a.target = "_blank"; a.rel = "noopener noreferrer";
        } else if (/^\//.test(href)) {
          var n = el("a", "", parent, label);
          n.href = href;
          n.addEventListener("click", function (ev) { ev.preventDefault(); navigate(href); });
        } else parent.appendChild(document.createTextNode(label));
      } else parent.appendChild(document.createTextNode(part));
    });
  }
  function markdown(parent, text) {
    // A picture's data wrapped over several lines is one address again.
    var src = String(text || "").replace(/!\[([^\]]*)\]\(\s*([^)]*?)\s*\)/g, function (m, alt, url) {
      return "\n![" + alt + "](" + url.replace(/\s+/g, "") + ")\n";
    });
    var para = null;
    src.split(/\r?\n/).forEach(function (line) {
      var t = line.trim();
      if (!t) { para = null; return; }
      var img = t.match(/^!\[([^\]]*)\]\(([^)]+)\)$/), h = t.match(/^#{1,6}\s+(.*)$/), li = t.match(/^[-*]\s+(.*)$/);
      if (img) {
        para = null;
        if (MD_IMG.test(img[2])) { var im = el("img", "pic", parent); im.src = img[2]; im.alt = img[1] || ""; im.loading = "lazy"; }
        return;
      }
      if (h) { para = null; mdInline(el("div", "mh", parent), h[1]); return; }
      if (li) { para = null; var d = el("div", "li", parent); mdInline(d, li[1]); return; }
      if (para) para.appendChild(document.createElement("br"));
      else para = el("div", "p", parent);
      mdInline(para, t);
    });
  }
  function channelName(e) {
    if (e.channel === "telegram" || e.service.indexOf("telegram_bot.") === 0) return "telegram";
    if (/mobile_app_/.test(e.target || "")) return "téléphone";
    if (e.service === "notify.persistent_notification") return "ha";
    return String(e.target || e.service).replace(/^notify\./, "");
  }

  //   type: custom:igor-notifications-card
  //   title: notifications
  //   limit: 30             # sent notifications read (the newest)
  //   waiting: true         # Home Assistant's notifications to deal with, on top
  //   sent: true            # what Home Assistant sent (notify, Telegram), administrators only
  class IgorNotificationsCard extends IgorCard {
    setConfig(config) { this.config = config || {}; }
    getCardSize() { return 6; }
    build() {
      this.style([
        ".list { flex: 1; min-height: 0; overflow-y: auto; }",
        ".sec { color: var(--faint); font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; padding: 8px 0 3px; display: flex; justify-content: space-between; }",
        ".n { display: grid; grid-template-columns: 6ch minmax(0, 1fr) auto; gap: 2px 10px; padding: 7px 0; border-bottom: 1px solid var(--line); align-items: start; }",
        ".n .h { color: var(--faint); font-variant-numeric: tabular-nums; }",
        ".n .b { min-width: 0; display: grid; gap: 2px; }",
        ".n b { color: var(--fg); font-weight: 500; overflow-wrap: anywhere; }",
        ".n .m { color: var(--dim); overflow-wrap: anywhere; max-height: 15em; overflow: hidden; display: grid; gap: 4px; }",
        ".n .m .mh { color: var(--fg); font-weight: 500; } .n .m strong { color: var(--fg); font-weight: 500; } .n .m .li::before { content: '· '; color: var(--faint); }",
        ".n .m .pic { max-width: min(100%, 320px); max-height: 7em; border-radius: var(--igor-radius, 3px); border: 1px solid var(--line); background: var(--bg); object-fit: contain; }",
        ".n.open .m .pic { max-height: 260px; }",
        ".n.open .m { max-height: none; }",
        ".n .m a, .n .map { color: var(--acc); text-decoration: none; }",
        ".n .map { font-size: 11px; cursor: pointer; display: inline-flex; align-items: center; gap: 4px; --mdc-icon-size: 14px; }",
        ".n.wait { border-left: 2px solid var(--igor-signal, #e5323b); padding-left: 8px; }",
        ".chip { font-size: 10px; border-radius: var(--igor-radius, 3px); padding: 1px 8px; border: 1px solid var(--line); color: var(--dim); white-space: nowrap; }",
        ".x { background: none; border: 1px solid var(--line); color: var(--dim); border-radius: var(--igor-radius, 3px); width: 30px; height: 30px; padding: 0; display: grid; place-items: center; cursor: pointer; --mdc-icon-size: 16px; }",
        ".x:hover { color: var(--fg); border-color: var(--acc); }",
        ".empty { color: var(--dim); padding: 8px 0; }"
      ].join("\n"));
      var card = el("ha-card", "", this.shadowRoot);
      var top = el("div", "top", card);
      el("span", "t sub", top, (this.config.title || "notifications").toUpperCase()).style.letterSpacing = "0.12em";
      this.countEl = el("span", "sub", top, "");
      this.list = el("div", "list", card);
      this.waiting = [];
      this.sent = null;
      this.error = "";
    }
    connectedCallback() {
      if (this._built && this._hass) this.start(this._hass);
    }
    disconnectedCallback() {
      clearInterval(this.timer); this.timer = null;
      if (this.unwatch) { this.unwatch(); this.unwatch = null; }
    }
    update(hass) {
      if (!this.timer && this.isConnected) this.start(hass);
    }
    start(hass) {
      if (this.config.waiting !== false && !this.unwatch) {
        this.unwatch = watchPersistent(hass, (list) => { this.waiting = list; this.render(); });
      }
      if (this.config.sent !== false) {
        this.load();
        clearInterval(this.timer);
        this.timer = setInterval(() => this.load(), 30000);
      } else if (!this.timer) this.timer = -1;
    }
    load() {
      var hass = this._hass;
      if (!hass || this.loading) return;
      if (!(hass.user && hass.user.is_admin)) { this.error = "envoyées : réservé aux administrateurs"; this.render(); return; }
      this.loading = true;
      var limit = Math.max(1, Math.min(200, Number(this.config.limit) || 30));
      hass.callWS({ type: "call_service", domain: "nives", service: "notifications", service_data: { limit: limit }, return_response: true })
        .then((r) => { this.sent = (r && r.response && r.response.entries) || []; this.error = ""; })
        .catch(() => { this.error = "historique indisponible (intégration Igor à jour ?)"; })
        .then(() => { this.loading = false; this.render(); });
    }
    row(cls, when, title, message, right) {
      var n = el("div", "n " + cls, this.list);
      el("span", "h", n, when);
      var b = el("div", "b", n);
      if (title) el("b", "", b, title);
      if (message) markdown(el("div", "m", b), message);
      n.addEventListener("click", (ev) => { if (ev.target.tagName !== "A" && ev.target.tagName !== "BUTTON") n.classList.toggle("open"); });
      if (right) n.appendChild(right);
      return b;
    }
    render() {
      this.list.innerHTML = "";
      var w = this.waiting || [];
      this.countEl.textContent = w.length ? w.length + " à traiter" : "";
      if (this.config.waiting !== false && w.length) {
        el("div", "sec", this.list, "à traiter");
        w.forEach((p) => {
          var x = el("button", "x", null);
          icon(x, "mdi:close");
          x.type = "button"; x.title = "Effacer"; x.setAttribute("aria-label", "Effacer");
          x.addEventListener("click", () => {
            this._hass.callService("persistent_notification", "dismiss", { notification_id: p.notification_id });
          });
          this.row("wait", whenText(p.created_at), p.title || "", p.message || "", x);
        });
      }
      if (this.config.sent === false) {
        if (!w.length) el("div", "empty", this.list, "Rien à traiter.");
        return;
      }
      el("div", "sec", this.list, "envoyées");
      if (this.error) { el("div", "empty", this.list, this.error); return; }
      if (this.sent == null) { el("div", "empty", this.list, "…"); return; }
      if (!this.sent.length) { el("div", "empty", this.list, "Aucune notification envoyée pour l'instant."); return; }
      if (this.isConnected && this.sent[0].at) markSent(this.sent[0].at);
      this.sent.forEach((e) => {
        var b = this.row("", whenText(e.at), e.title, e.message, el("span", "chip", null, channelName(e)));
        if (e.latitude != null && e.longitude != null) {
          var a = el("a", "map", b);
          icon(a, "mdi:map-marker-outline");
          a.appendChild(document.createTextNode("voir sur la carte"));
          a.href = "https://www.google.com/maps/search/?api=1&query=" + e.latitude + "," + e.longitude;
          a.target = "_blank"; a.rel = "noopener noreferrer";
        }
      });
    }
  }

  // ----- igor-bank-card: money, in Igor's style (a bank integration's sensors) -----
  //   type: custom:igor-bank-card
  //   show: overview        # total, accounts, the month (spent, income, saved, budget)
  //         categories      # spending by category, against its budget or last month
  //         operations      # a list of operations from an attribute, by day
  //         selected        # one operation in detail
  //         budgets         # what is left of the month's budgets
  //         accounts        # each account's spending by category
  //   (each mode's keys are in DOCS.md; every sensor is optional)
  function money(v, d) {
    if (v == null || isNaN(v)) return "—";
    return fr(Number(v), d == null ? 2 : d) + " €";
  }
  function signed(v, d) { return (v > 0 ? "+" : "") + money(v, d); }
  function numOf(hass, id, attr) {
    var st = id && hass.states[id];
    if (!st) return null;
    var v = parseFloat(attr ? st.attributes[attr] : st.state);
    return isNaN(v) ? null : v;
  }
  function dayText(iso) {
    var s = String(iso || "");
    return /^\d{4}-\d\d-\d\d/.test(s) ? s.slice(8, 10) + "/" + s.slice(5, 7) + "/" + s.slice(0, 4) : s;
  }
  class IgorBankCard extends IgorCard {
    setConfig(config) {
      var show = (config && config.show) || "overview";
      if (["overview", "categories", "operations", "selected", "budgets", "accounts"].indexOf(show) < 0) throw new Error("igor-bank-card: show inconnu (" + show + ")");
      this.config = Object.assign({}, config, { show: show });
    }
    getCardSize() { return 5; }
    ids() {
      var c = this.config, out = [c.total, c.spent, c.income, c.budgets, c.entity, c.filter];
      (c.accounts || []).forEach(function (a) { out.push(a.balance, a.transactions); });
      (c.categories || []).forEach(function (a) { out.push(a.entity, a.budget); });
      return out.filter(Boolean);
    }
    build() {
      this.style([
        ".body { flex: 1; min-height: 0; overflow-y: auto; display: grid; gap: 10px; align-content: start; padding-top: 4px; }",
        ".hero { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; flex-wrap: wrap; }",
        ".hero b { font-size: clamp(26px, 5vw, 38px); font-weight: 300; letter-spacing: -0.01em; color: var(--fg); font-variant-numeric: tabular-nums; }",
        ".hero b.neg, .neg { color: var(--bad) !important; } .pos { color: var(--okc); }",
        ".lbl { color: var(--faint); font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; }",
        ".grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(105px, 1fr)); gap: 8px; }",
        ".tile { border: 1px solid var(--line); border-radius: var(--igor-radius, 3px); padding: 9px 11px; display: grid; gap: 3px; min-width: 0; cursor: pointer; background: var(--bg); }",
        ".tile .v { font-size: 18px; color: var(--fg); font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
        ".tile .s { color: var(--dim); font-size: 11px; }",
        ".tile.nav { place-items: center; text-align: center; --mdc-icon-size: 26px; color: var(--dim); letter-spacing: 0.1em; text-transform: uppercase; font-size: 10.5px; gap: 6px; }",
        ".tile.nav ha-icon { color: var(--fg); }",
        ".row { display: grid; grid-template-columns: 22px minmax(0, 1fr) auto; gap: 3px 10px; align-items: center; padding: 6px 0; border-bottom: 1px dashed var(--line); --mdc-icon-size: 18px; }",
        ".row.tap { cursor: pointer; } .row.tap:hover .n { color: var(--acc); }",
        ".row ha-icon { color: var(--dim); }",
        ".row .n { color: var(--fg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
        ".row .a { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; color: var(--fg); }",
        ".row .d { grid-column: 2 / 4; color: var(--dim); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }",
        ".row .bar { grid-column: 2 / 4; }",
        ".bar i.warn { background: var(--wait); } .bar i.bad { background: var(--bad); } .bar i.ok { background: var(--okc); }",
        ".day { color: var(--faint); font-size: 10px; letter-spacing: 0.14em; padding: 8px 0 0; }",
        ".sum { color: var(--dim); font-size: 11.5px; }",
        ".big { text-align: center; display: grid; gap: 4px; padding: 6px 0; }",
        ".big b { font-size: clamp(30px, 6vw, 44px); font-weight: 300; }",
        ".kv { display: grid; grid-template-columns: 1fr auto; gap: 5px 14px; font-variant-numeric: tabular-nums; } .kv .l { color: var(--dim); } .kv .v { text-align: right; }",
        "pre { white-space: pre-wrap; overflow-wrap: anywhere; background: var(--bg); border: 1px solid var(--line); border-radius: var(--igor-radius, 3px); padding: 8px; margin: 0; font: inherit; color: var(--dim); }",
        ".more { color: var(--acc); cursor: pointer; background: none; border: 0; font: inherit; padding: 4px 0; justify-self: start; }",
        ".empty { color: var(--dim); }",
        "h5 { margin: 6px 0 2px; font-size: 12px; font-weight: 500; color: var(--fg); display: flex; justify-content: space-between; } h5 span { color: var(--dim); font-weight: 400; }"
      ].join("\n"));
      var card = el("ha-card", "", this.shadowRoot);
      var top = el("div", "top", card);
      var defaults = { overview: "comptes", categories: "dépenses par catégorie", operations: "opérations", selected: "opération", budgets: "budgets du mois", accounts: "par compte" };
      el("span", "t sub", top, String(this.config.title || defaults[this.config.show]).toUpperCase()).style.letterSpacing = "0.12em";
      this.side = el("span", "sub", top, "");
      this.body = el("div", "body", card);
    }
    update(hass, prev) {
      if (!changed(prev, hass, this.ids())) return;
      this.body.innerHTML = "";
      this.side.textContent = "";
      try { this["show_" + this.config.show](hass); }
      catch (e) { el("div", "empty", this.body, "Données indisponibles."); }
    }
    go(path) {
      if (!path) return;
      navigate(path.charAt(0) === "/" ? path : "/" + window.location.pathname.split("/")[1] + "/" + path);
    }
    tile(parent, label, value, sub, cls, onTap) {
      var t = el("div", "tile", parent);
      el("span", "lbl", t, label);
      el("span", "v " + (cls || ""), t, value);
      if (sub) el("span", "s", t, sub);
      if (onTap) t.addEventListener("click", onTap);
      return t;
    }
    bar(parent, pct, level) {
      var b = el("div", "bar", parent);
      var i = el("i", level || "", b);
      i.style.width = Math.max(0, Math.min(100, pct || 0)) + "%";
      return b;
    }
    show_overview(hass) {
      var c = this.config, b = this.body;
      if (c.total) {
        var t = numOf(hass, c.total), over = numOf(hass, c.total, "overdrawn_accounts") || 0;
        var hero = el("div", "hero", b);
        var big = el("b", t != null && t < 0 ? "neg" : "", hero, money(t));
        big.style.cursor = "pointer";
        big.addEventListener("click", () => moreInfo(this, c.total));
        el("span", "sub", hero, "solde total · " + (t != null && t < 0 ? "à découvert" : "créditeur") + (over ? " · " + over + " compte" + (over > 1 ? "s" : "") + " à découvert" : ""));
      }
      if ((c.accounts || []).length) {
        var g = el("div", "grid", b);
        c.accounts.forEach((a) => {
          var v = numOf(hass, a.balance), spent = numOf(hass, a.transactions, "month_spent");
          this.tile(g, a.name || a.balance, money(v), spent != null ? fr(spent, 0) + " € dépensés ce mois" : "", v != null && v < 0 ? "neg" : "", () => moreInfo(this, a.balance));
        });
      }
      var spent = numOf(hass, c.spent), income = numOf(hass, c.income), prevM = numOf(hass, c.spent, "previous_month");
      if (spent != null || income != null) {
        el("div", "lbl", b, "ce mois-ci");
        var m = el("div", "grid", b);
        var vs = spent != null && prevM ? Math.round(((spent - prevM) / prevM) * 100) : null;
        if (spent != null) this.tile(m, "dépenses", money(spent, 0), vs != null ? (vs > 0 ? "+" : "") + vs + " % vs mois dernier" : "", "", () => moreInfo(this, c.spent));
        if (income != null) this.tile(m, "revenus", money(income, 0), "", "pos", () => moreInfo(this, c.income));
        if (spent != null && income != null) this.tile(m, "épargne", signed(income - spent, 0), "revenus − dépenses", income - spent >= 0 ? "pos" : "neg");
      }
      if (c.budgets && hass.states[c.budgets]) {
        var tb = numOf(hass, c.budgets, "total_budget") || 0, ts = numOf(hass, c.budgets, "total_spent_budgeted") || 0, n = numOf(hass, c.budgets) || 0;
        var r = el("div", "row" + (c.budgets_page ? " tap" : ""), b);
        icon(r, "mdi:target");
        el("span", "n", r, !tb ? "Aucun budget" : tb - ts >= 0 ? "Il reste " + money(tb - ts, 0) : "Budget dépassé de " + money(ts - tb, 0));
        el("span", "a", r, tb ? fr(ts, 0) + " / " + fr(tb, 0) + " €" : "");
        if (tb) this.bar(r, (ts / tb) * 100, ts > tb ? "bad" : n ? "warn" : "ok");
        if (n) el("span", "d", r, n + " catégorie" + (n > 1 ? "s" : "") + " dépassée" + (n > 1 ? "s" : ""));
        if (c.budgets_page) r.addEventListener("click", () => this.go(c.budgets_page));
      }
      if ((c.links || []).length) {
        var l = el("div", "grid", b);
        c.links.forEach((k) => {
          var t2 = el("div", "tile nav", l);
          icon(t2, k.icon || "mdi:arrow-right");
          el("span", "", t2, k.name || "");
          t2.addEventListener("click", () => { if (k.dashboard) openDashboard(this, this._hass, k.dashboard, k.view); else this.go(k.navigate); });
        });
      }
    }
    show_categories(hass) {
      var c = this.config;
      var rows = (c.categories || []).map(function (k) {
        return { k: k, v: numOf(hass, k.entity) || 0, budget: numOf(hass, k.entity, "budget"), prev: numOf(hass, k.entity, "previous_month") };
      }).filter(function (r) { return hass.states[r.k.entity]; });
      if (c.hide_zero !== false) rows = rows.filter(function (r) { return r.v > 0 || r.budget; });
      rows.sort(function (a, b) { return b.v - a.v; });
      var total = rows.reduce(function (a, r) { return a + r.v; }, 0);
      this.side.textContent = money(total, 0);
      if (!rows.length) { el("div", "empty", this.body, "Aucune dépense ce mois-ci."); return; }
      var top = rows[0].v || 1;
      rows.forEach((r) => {
        var row = el("div", "row tap", this.body);
        icon(row, r.k.icon || "mdi:tag");
        el("span", "n", row, r.k.name || r.k.entity);
        el("span", "a" + (r.budget && r.v > r.budget ? " neg" : ""), row, money(r.v, 0) + (r.budget ? " / " + fr(r.budget, 0) + " €" : ""));
        var pct = r.budget ? (r.v / r.budget) * 100 : (r.v / top) * 100;
        this.bar(row, pct, r.budget ? (r.v > r.budget ? "bad" : pct >= 80 ? "warn" : "ok") : "");
        el("span", "d", row, (total ? Math.round((r.v / total) * 100) + " % des dépenses" : "") + (r.prev ? " · " + fr(r.prev, 0) + " € le mois dernier" : ""));
        row.addEventListener("click", () => {
          // The operations of this category: the integration's filter, then its page.
          if (c.filter && this._hass) {
            this._hass.callService("select", "select_option", { entity_id: c.filter, option: r.k.option || r.k.name });
            this.go(c.operations || "operations");
          } else moreInfo(this, r.k.entity);
        });
      });
    }
    show_operations(hass) {
      var c = this.config, st = hass.states[c.entity];
      if (!st) { el("div", "empty", this.body, "Capteur introuvable."); return; }
      var a = st.attributes;
      var ops = a[c.attribute || (a.operations ? "operations" : "recent_transactions")] || [];
      var limit = Number(c.limit) || 50;
      if (a.total != null && (a.filter || a.period)) {
        this.side.textContent = a.total + " opération" + (a.total > 1 ? "s" : "");
        el("div", "sum", this.body, [a.filter, a.period].filter(Boolean).join(" · ") + (a.sum_out != null ? " · sorties " + money(Number(a.sum_out)) + " · entrées " + money(Number(a.sum_in)) : ""));
      }
      if (!ops.length) { el("div", "empty", this.body, "Aucune opération."); return; }
      var day = null;
      ops.slice(0, limit).forEach((t) => {
        if (c.by_day !== false && t.date !== day) { day = t.date; el("div", "day", this.body, dayText(day)); }
        var row = el("div", "row", this.body);
        icon(row, t.icon || "mdi:receipt");
        el("span", "n", row, String(t.merchant || t.label || "").trim());
        var amt = Number(t.amount);
        el("span", "a " + (amt > 0 ? "pos" : ""), row, signed(amt));
        el("span", "d", row, [c.by_day === false && t.date ? dayText(t.date).slice(0, 5) : "", t.category_name, t.account, t.pending ? "en attente" : ""].filter(Boolean).join(" · "));
      });
      if (c.more) {
        var m = el("button", "more", this.body, "toutes les opérations ›");
        m.type = "button";
        m.addEventListener("click", () => this.go(c.more));
      }
    }
    show_selected(hass) {
      var st = hass.states[this.config.entity];
      var a = st && st.attributes;
      if (!a || a.amount == null) { el("div", "empty", this.body, "Aucune opération pour ce filtre."); return; }
      var d = a.detail || {};
      var big = el("div", "big", this.body);
      var amt = Number(a.amount);
      el("b", amt > 0 ? "pos" : "", big, signed(amt));
      el("span", "", big, st.state);
      el("span", "sub", big, [a.category_name, a.account].filter(Boolean).join(" · "));
      var kv = el("div", "kv", this.body);
      [["date d'achat", dayText(a.date)], ["comptabilisée le", dayText(d.booking_date)], ["statut", a.pending ? "en attente" : "comptabilisée"], ["position", a.position != null ? a.position + " / " + a.total : ""]]
        .forEach(function (p) { if (!p[1]) return; el("span", "l", kv, p[0]); el("span", "v", kv, p[1]); });
      if (a.label) { el("div", "lbl", this.body, "libellé exact"); el("pre", "", this.body, String(a.label)); }
    }
    show_budgets(hass) {
      var c = this.config, st = c.entity && hass.states[c.entity];
      // With `categories` (name, entity: what was spent, budget: its number
      // entity, icon): every category, with or without a budget, a touch sets it.
      var rows = (c.categories || []).filter((k) => hass.states[k.entity] || hass.states[k.budget]).map((k) => {
        var spent = numOf(hass, k.entity) || 0;
        var budget = numOf(hass, k.budget);
        if (budget == null) budget = numOf(hass, k.entity, "budget");
        budget = budget || 0;
        return { k: k, category: k.name, spent: spent, budget: budget, used_pct: budget ? (spent / budget) * 100 : 0, over: budget > 0 && spent > budget };
      });
      if (!rows.length) rows = ((st && st.attributes.budgets) || []).map(function (r) { return { category: r.category, spent: r.spent, budget: r.budget, used_pct: r.used_pct, over: r.over }; });
      var set = rows.filter(function (r) { return r.budget > 0; });
      var tb = set.reduce(function (a, r) { return a + r.budget; }, 0), ts = set.reduce(function (a, r) { return a + r.spent; }, 0), left = tb - ts;
      if (st && !c.categories) { tb = numOf(hass, c.entity, "total_budget") || tb; ts = numOf(hass, c.entity, "total_spent_budgeted") || ts; left = tb - ts; }
      var now = new Date(), days = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate() + 1;
      if (tb > 0) {
        var big = el("div", "big", this.body);
        el("span", "lbl", big, left >= 0 ? "il te reste" : "budget dépassé de");
        el("b", left < 0 ? "neg" : "", big, money(Math.abs(left), 0));
        el("span", "sub", big, fr(ts, 0) + " € dépensés sur " + fr(tb, 0) + " €" + (left > 0 ? " · " + fr(left / days, 0) + " €/jour jusqu'à la fin du mois" : ""));
        this.bar(this.body, (ts / tb) * 100, ts > tb ? "bad" : ts / tb >= 0.8 ? "warn" : "ok");
      } else {
        el("div", "empty", this.body, "Aucun budget pour l'instant : touche une catégorie pour lui en donner un.");
      }
      this.side.textContent = set.length ? set.length + " budget" + (set.length > 1 ? "s" : "") : "";
      // Budgets first (the most used on top), then the categories without one.
      rows.sort(function (a, b) { return (b.budget > 0) - (a.budget > 0) || (b.used_pct || 0) - (a.used_pct || 0) || b.spent - a.spent; });
      rows.forEach((r) => {
        var row = el("div", "row" + (r.k && r.k.budget ? " tap" : ""), this.body);
        icon(row, r.over ? "mdi:alert-circle" : (r.k && r.k.icon) || "mdi:target");
        el("span", "n", row, r.category);
        if (r.budget > 0) {
          var l = r.budget - r.spent;
          el("span", "a" + (l < 0 ? " neg" : ""), row, l >= 0 ? "reste " + money(l, 0) : "dépassé de " + money(-l, 0));
          this.bar(row, r.used_pct, r.over ? "bad" : r.used_pct >= 80 ? "warn" : "ok");
          el("span", "d", row, fr(r.spent, 0) + " € sur " + fr(r.budget, 0) + " €" + (r.k && r.k.budget ? " · toucher pour changer" : ""));
        } else {
          el("span", "a", row, money(r.spent, 0));
          el("span", "d", row, "pas de budget" + (r.k && r.k.budget ? " · toucher pour en fixer un" : ""));
        }
        if (r.k && r.k.budget) row.addEventListener("click", () => moreInfo(this, r.k.budget));
      });
    }
    show_accounts(hass) {
      (this.config.accounts || []).forEach((acc) => {
        var st = hass.states[acc.transactions];
        if (!st) return;
        var spent = Number(st.attributes.month_spent) || 0, got = Number(st.attributes.month_received) || 0;
        var h = el("h5", "", this.body, acc.name || acc.transactions);
        el("span", "", h, fr(spent, 0) + " € dépensés · " + fr(got, 0) + " € reçus");
        var cats = st.attributes.by_category || {};
        Object.keys(cats).sort(function (a, b) { return cats[b] - cats[a]; }).forEach((k) => {
          var row = el("div", "row", this.body);
          icon(row, "mdi:tag-outline");
          el("span", "n", row, k);
          el("span", "a", row, money(cats[k], 0));
          this.bar(row, spent ? (cats[k] / spent) * 100 : 0, "");
        });
      });
    }
  }

  function define(name, cls, label, description) {
    if (!customElements.get(name)) customElements.define(name, cls);
    window.customCards = window.customCards || [];
    window.customCards.push({ type: name, name: label, description: description });
  }
  define("igor-wall", IgorWall, "Igor · mur", "Tout l'écran : barre d'état des machines et colonnes de cartes jusqu'en bas.");
  define("igor-journal-card", IgorJournalCard, "Igor · journal", "Les derniers échanges avec Igor.");
  define("igor-bank-card", IgorBankCard, "Igor · banque", "Les comptes, le mois, les dépenses par catégorie, les budgets et les opérations d'une intégration bancaire.");
  define("igor-notifications-card", IgorNotificationsCard, "Igor · notifications", "Les notifications de Home Assistant : celles à traiter, et celles envoyées (téléphone, Telegram).");
  define("igor-docker-card", IgorDockerCard, "Igor · Docker", "Les conteneurs de Portainer.");
  define("igor-net-card", IgorNetCard, "Igor · réseau", "Le débit d'un routeur sur la dernière heure.");
  define("igor-energy-card", IgorEnergyCard, "Igor · énergie", "La puissance, heure par heure aujourd'hui.");
  define("igor-camera-card", IgorCameraCard, "Igor · caméra", "L'image d'une caméra, rafraîchie toutes les quelques secondes.");
  define("igor-assist-card", IgorAssistCard, "Igor · Igor", "Igor : son état, parler (appui), l'activer ou non (appui long).");
  define("igor-buttons-card", IgorButtonsCard, "Igor · boutons", "Une rangée de boutons qui appellent un service ou ouvrent une page (size: big pour un téléphone).");
  define("igor-weather-card", IgorWeatherCard, "Igor · météo", "Maintenant, heure par heure, et les jours en barres de températures.");
  define("igor-trips-card", IgorTripsCard, "Igor · trajets", "Le carnet d'une voiture : le trajet en grand, les derniers trajets, les records.");
  define("igor-alarm-card", IgorAlarmCard, "Igor · réveil", "Un réveil (intégration Alarm Clocks) en une ligne.");
  define("igor-docker-manage-card", IgorDockerManageCard, "Igor · Docker (gestion)", "Les conteneurs de Portainer, leurs totaux et leurs boutons.");
  define("igor-proxmox-card", IgorProxmoxCard, "Igor · Proxmox", "L'hôte Proxmox, ses machines et son stockage.");
  define("igor-history-card", IgorHistoryCard, "Igor · courbes", "Quelques capteurs sur les dernières heures.");
  define("igor-tiles-card", IgorTilesCard, "Igor · tuiles", "De gros boutons : scènes, lumières, médias… (appui : action, appui long : détails).");
  define("igor-control-card", IgorControlCard, "Igor · commande", "Un appareil et ses boutons (volet, aspirateur…).");
  define("igor-clock-card", IgorClockCard, "Igor · horloge", "L'heure en grand et la date.");
  define("igor-alerts-card", IgorAlertsCard, "Igor · alertes", "Ce qui ne va pas : machines, disques, conteneurs, mises à jour, internet.");
  define("igor-music-card", IgorMusicCard, "Igor · musique", "Ce qui joue, les commandes, les enceintes, la recherche et les raccourcis (Music Assistant).");
  define("igor-facts-card", IgorFactsCard, "Igor · faits", "Quelques états, une ligne chacun ; une entité absente est ignorée.");
  define("igor-dns-card", IgorDnsCard, "Igor · DNS en direct", "Les requêtes DNS d'AdGuard Home en direct, par appareil (administrateurs).");
  define("igor-map-card", IgorMapCard, "Igor · le monde", "Où vont les connexions de la maison, par pays et opérateur (administrateurs).");
  define("igor-wifi-card", IgorWifiCard, "Igor · Wi-Fi", "Qui est connecté à quel Wi-Fi (OpenWrt), avec le signal et le débit (administrateurs).");
  define("igor-netmap-card", IgorNetmapCard, "Igor · schéma réseau", "Le réseau par VLAN autour d'OPNsense, pilotable : dispositions, déplacement, zoom, filtres (administrateurs).");
  define("igor-talkers-card", IgorTalkersCard, "Igor · les plus actifs", "Les appareils qui échangent le plus à travers le routeur (administrateurs).");
  define("igor-wifi-scan-card", IgorWifiScanCard, "Igor · Wi-Fi voisins", "Les réseaux Wi-Fi alentour et les canaux occupés, entendus par OpenWrt (administrateurs).");
  define("igor-news-card", IgorNewsCard, "Igor · dépêches", "Les derniers titres d'un flux RSS ou Atom (dépêches, actualités).");
  define("igor-mini-card", IgorMiniCard, "Igor · capteur", "Un capteur et ses 24 heures sur une ligne.");
  define("igor-car-card", IgorCarCard, "Igor · voiture", "La voiture qui roule : vitesse, régime, température, batterie, trajet.");
  define("igor-security-card", IgorSecurityCard, "Igor · sécurité", "L'alarme (armer, désarmer avec le code), la caméra active ou privée, ses positions enregistrées.");
  define("igor-gps-card", IgorGpsCard, "Igor · GPS", "La voiture sur sa carte, orientée comme la route, collée à la route la plus proche.");
  define("igor-carmedia-card", IgorCarMediaCard, "Igor · musique de la voiture", "Le titre en cours sur l'autoradio et trois gros boutons.");

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
  // Only a page that shows an igor-wall loses the bar: another dashboard
  // (one with several tabs, say) keeps its tabs on the same device.
  function currentView(root) {
    var cfg = root && root.lovelace && root.lovelace.config;
    if (!cfg || !Array.isArray(cfg.views)) return undefined;
    var seg = decodeURIComponent((window.location.pathname.split("/")[2] || ""));
    for (var i = 0; i < cfg.views.length; i++) {
      if (cfg.views[i] && String(cfg.views[i].path || "") === seg) return cfg.views[i];
    }
    return cfg.views[/^\d+$/.test(seg) ? Number(seg) : 0] || null;
  }
  // A wall with `kiosk: true` (a car's head unit): no top bar on its pages,
  // whatever the device's theme.
  function viewKiosk(root) {
    var view = currentView(root);
    if (!view) return false;
    try { return /"type":"custom:igor-wall"[^]*?"kiosk":true|"kiosk":true[^]*?"type":"custom:igor-wall"/.test(JSON.stringify(view)); } catch (e) { return false; }
  }
  function viewHasWall(root) {
    var cfg = root && root.lovelace && root.lovelace.config;
    if (!cfg || !Array.isArray(cfg.views)) return true;
    var seg = decodeURIComponent((window.location.pathname.split("/")[2] || ""));
    var view = null;
    for (var i = 0; i < cfg.views.length; i++) {
      if (cfg.views[i] && String(cfg.views[i].path || "") === seg) { view = cfg.views[i]; break; }
    }
    if (!view) view = cfg.views[/^\d+$/.test(seg) ? Number(seg) : 0];
    if (!view) return false;
    try { return JSON.stringify(view).indexOf("custom:igor-wall") >= 0; } catch (e) { return false; }
  }
  function wantsNoHeader(root) {
    var v = getComputedStyle(document.documentElement).getPropertyValue("--igor-hide-header").trim().replace(/["']/g, "");
    var q = window.location.search || "";
    if (/[?&](barre|edit)(=|&|$)/.test(q)) return false;
    if (root && root.lovelace && root.lovelace.editMode) return false;
    if (v === "1" || v === "true") return viewHasWall(root);
    return viewKiosk(root);
  }
  function wantsNoMenu(root) {
    var v = getComputedStyle(document.documentElement).getPropertyValue("--igor-hide-menu").trim().replace(/["']/g, "");
    if (v !== "1" && v !== "true") return false;
    if (/[?&](menu|edit)(=|&|$)/.test(window.location.search || "")) return false;
    return !(root && root.lovelace && root.lovelace.editMode);
  }
  function wantsLogo(root) {
    var v = getComputedStyle(document.documentElement).getPropertyValue("--igor-header-logo").trim().replace(/["']/g, "");
    if (v !== "1" && v !== "true") return false;
    return !(root && root.lovelace && root.lovelace.editMode);
  }
  var EYE_SVG = '<svg viewBox="0 0 256 256" aria-hidden="true" style="width:100%;height:100%;display:block"><rect x="107" y="20" width="44" height="216" fill="#e9e4da"/><circle cx="128" cy="96" r="48" fill="#07080a" stroke="#e5323b" stroke-width="16"/><circle cx="128" cy="96" r="16" fill="#e5323b"/></svg>';
  function headerLogo(root, on) {
    var sr = root.shadowRoot;
    var logo = sr.getElementById("igor-logo"), pad = sr.getElementById("igor-logo-pad");
    var bar = on ? sr.querySelector(".toolbar") : null;
    var r = bar ? bar.getBoundingClientRect() : null;
    if (!r || r.height < 20) {
      if (logo) logo.remove();
      if (pad) pad.remove();
      return;
    }
    // At the bar's left edge; the « ☰ » button, when there is one, and the
    // tabs move right by the same room.
    var left = r.left + 12;
    if (!logo) {
      logo = document.createElement("div");
      logo.id = "igor-logo";
      logo.innerHTML = EYE_SVG;
      logo.style.cssText = "position:fixed;z-index:5;width:22px;height:22px;pointer-events:none;";
      sr.appendChild(logo);
    }
    logo.style.left = Math.round(left) + "px";
    logo.style.top = Math.round(r.top + (r.height - 22) / 2) + "px";
    var css = ".toolbar { padding-left: 44px !important; }";
    if (!pad) { pad = document.createElement("style"); pad.id = "igor-logo-pad"; sr.appendChild(pad); }
    if (pad.textContent !== css) pad.textContent = css;
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
    // The « ☰ » button gone from the dashboards (theme igor-hide-menu), tabs kept.
    var noMenu = wantsNoMenu(root);
    var mstyle = root.shadowRoot.getElementById("igor-nomenu");
    if (noMenu && !mstyle) {
      mstyle = document.createElement("style");
      mstyle.id = "igor-nomenu";
      mstyle.textContent = "ha-menu-button { display: none !important; }";
      root.shadowRoot.appendChild(mstyle);
    } else if (!noMenu && mstyle) {
      mstyle.remove();
    }
    // Igor's eye at the left of Home Assistant's top bar (theme
    // igor-header-logo), as on the wall: drawn over the bar, the bar's
    // content moved aside to make room.
    headerLogo(root, !want && wantsLogo(root));
    // A wide screen keeps Home Assistant's sidebar docked on the left: on
    // the kiosk, or without the menu button, it goes too (this device only;
    // a wall's « Menu » button still opens it).
    want = want || noMenu;
    var ha = document.querySelector("home-assistant");
    if (want && ha && ha.hass && ha.hass.dockedSidebar && ha.hass.dockedSidebar !== "always_hidden" && !sidebarDone) {
      sidebarDone = true;
      ha.dispatchEvent(new CustomEvent("hass-dock-sidebar", { detail: { dock: "always_hidden" } }));
    }
  }, 1000);
  var sidebarDone = false;


  // ===== maintenance: a screen lent to someone (the car at the garage) =====
  // A wall with `maintenance: input_boolean.x` makes this device remember that
  // switch. While it is on, every page of Home Assistant on this device lies
  // under a full-screen lock: nothing to read, nothing to touch, only a keypad
  // for the disarm code (nives.unlock_screen, the alarm's lockout) — or the
  // switch turned off from another device (the owner's phone). The last state
  // is kept here, so the lock is up at once, even before Home Assistant answers.
  (function () {
    var lockEl = null, codeEl, msgEl, code = "";
    function ls(k, v) {
      try {
        if (v === undefined) return window.localStorage.getItem(k);
        window.localStorage.setItem(k, v);
      } catch (e) { /* no storage: the switch alone decides */ }
      return null;
    }
    function hassNow() { var ha = document.querySelector("home-assistant"); return ha && ha.hass; }
    function show() {
      if (lockEl) return;
      lockEl = document.createElement("div");
      lockEl.style.cssText = "position:fixed;inset:0;z-index:2147483647;";
      var root = lockEl.attachShadow({ mode: "open" });
      root.innerHTML = "<style>" +
        ".l{position:absolute;inset:0;background:#07080a;color:#e9e4da;font-family:" + MONO + ";display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2.4vh;user-select:none;-webkit-user-select:none}" +
        ".l svg{width:min(14vh,90px);height:min(14vh,90px)}" +
        ".t{font-family:'Chakra Petch'," + MONO + ";letter-spacing:.3em;font-size:clamp(20px,4vh,34px);font-weight:600}" +
        ".s{color:#878c95;font-size:clamp(12px,2vh,16px);letter-spacing:.1em}" +
        ".c{height:2.4em;font-size:clamp(18px,3.4vh,28px);letter-spacing:.5em;color:#59d0e0;min-width:8em;text-align:center;border-bottom:1px solid #22262c}" +
        ".m{min-height:1.4em;color:#e5323b;font-size:clamp(12px,2vh,15px)}.m.ok{color:#5cc28f}" +
        ".k{display:grid;grid-template-columns:repeat(3,minmax(64px,11vh));gap:1.2vh}" +
        ".k button{height:min(9vh,64px);background:#111417;border:1px solid #22262c;border-radius:var(--igor-radius,3px);color:#e9e4da;font:inherit;font-size:clamp(18px,3vh,26px);cursor:pointer;display:grid;place-items:center;--mdc-icon-size:26px}" +
        ".k button:active{background:#1b1f24}.k .ok{border-color:#59d0e0;color:#59d0e0}" +
        "</style><div class=l>" + EYE.replace('style="width:100%;height:100%;display:block"', "") +
        "<div class=t>MAINTENANCE</div><div class=s>écran verrouillé · code pour déverrouiller</div>" +
        "<div class=c></div><div class=m></div><div class=k></div></div>";
      codeEl = root.querySelector(".c");
      msgEl = root.querySelector(".m");
      var pad = root.querySelector(".k");
      ["1", "2", "3", "4", "5", "6", "7", "8", "9", "del", "0", "OK"].forEach(function (k) {
        var b = document.createElement("button");
        b.type = "button";
        if (k === "del") {
          var ic = document.createElement("ha-icon");
          ic.setAttribute("icon", "mdi:backspace-outline");
          b.appendChild(ic);
          b.title = "Effacer";
          b.setAttribute("aria-label", "Effacer");
        } else b.textContent = k;
        if (k === "OK") b.className = "ok";
        b.addEventListener("click", function () { press(k); });
        pad.appendChild(b);
      });
      document.body.appendChild(lockEl);
      draw();
    }
    function draw() { if (codeEl) codeEl.textContent = code.replace(/./g, "•"); }
    function hide() { if (lockEl) { lockEl.remove(); lockEl = null; code = ""; } }
    function press(k) {
      if (k === "del") code = code.slice(0, -1);
      else if (k === "OK") { submit(); return; }
      else if (code.length < 12) code += k;
      msgEl.textContent = "";
      draw();
    }
    function submit() {
      var hass = hassNow(), ent = ls("igor-maintenance");
      if (!hass || !ent || !code) return;
      var c = code;
      code = "";
      draw();
      msgEl.className = "m";
      msgEl.textContent = "…";
      hass.callWS({ type: "call_service", domain: "nives", service: "unlock_screen", service_data: { code: c, entity_id: ent }, return_response: true })
        .then(function (r) {
          var res = (r && r.response) || {};
          msgEl.className = "m" + (res.ok ? " ok" : "");
          msgEl.textContent = res.message || (res.ok ? "Déverrouillé." : "Refusé.");
        })
        .catch(function () { msgEl.className = "m"; msgEl.textContent = "Indisponible (mettez à jour Igor)."; });
    }
    // The keyboard reaches the keypad only; nothing goes to the page below.
    window.addEventListener("keydown", function (ev) {
      if (!lockEl) return;
      ev.stopPropagation();
      ev.preventDefault();
      if (/^[0-9]$/.test(ev.key)) press(ev.key);
      else if (ev.key === "Backspace") press("del");
      else if (ev.key === "Enter") press("OK");
    }, true);
    setInterval(function () {
      var ent = ls("igor-maintenance");
      if (!ent) { hide(); return; }
      var hass = hassNow(), st = hass && hass.states && hass.states[ent];
      var on = st ? st.state === "on" : ls("igor-maintenance-on") === "1";
      ls("igor-maintenance-on", on ? "1" : "0");
      if (on) show(); else hide();
    }, 700);
  })();

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

  // ===== a finger swipe between a dashboard's tabs =====
  // Theme igor-swipe: a clear horizontal swipe goes to the next tab (right
  // to left) or the previous one; not on a slider, a map or while editing.
  (function () {
    var x0 = null, y0 = 0, t0 = 0;
    function on() {
      var v = getComputedStyle(document.documentElement).getPropertyValue("--igor-swipe").trim().replace(/["']/g, "");
      return v === "1" || v === "true";
    }
    function blocked(ev) {
      var path = ev.composedPath ? ev.composedPath() : [];
      return path.some(function (n) {
        var t = n && n.tagName;
        return t === "INPUT" || t === "HA-SLIDER" || t === "HA-CONTROL-SLIDER" || t === "HA-MAP" || t === "TEXTAREA" ||
          (n && n.classList && n.classList.contains && n.classList.contains("no-swipe"));
      });
    }
    window.addEventListener("touchstart", function (ev) {
      x0 = null;
      if (!on() || ev.touches.length !== 1 || blocked(ev)) return;
      x0 = ev.touches[0].clientX; y0 = ev.touches[0].clientY; t0 = Date.now();
    }, { passive: true, capture: true });
    window.addEventListener("touchend", function (ev) {
      if (x0 === null) return;
      var t = ev.changedTouches[0], dx = t.clientX - x0, dy = t.clientY - y0;
      x0 = null;
      if (Date.now() - t0 > 600 || Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 2) return;
      var root = lovelaceRoot(), cfg = root && root.lovelace && root.lovelace.config;
      if (!cfg || !Array.isArray(cfg.views) || cfg.views.length < 2 || root.lovelace.editMode) return;
      var parts = window.location.pathname.split("/"), seg = decodeURIComponent(parts[2] || "");
      // The tabs only: a subview (a page reached by a button) is left out.
      var tabs = [];
      cfg.views.forEach(function (v, k) { if (!v.subview && v.visible !== false) tabs.push(String(v.path || k)); });
      var i = tabs.indexOf(seg);
      if (i < 0) return;
      var j = i + (dx < 0 ? 1 : -1);
      if (j < 0 || j >= tabs.length) return;
      navigate("/" + parts[1] + "/" + tabs[j] + window.location.search);
    }, { passive: true, capture: true });
  })();

  // ===== a page drawn before this script arrived =====
  // Home Assistant loads this script alongside the dashboard: on a slow
  // tablet it may draw the page first, find no igor card yet and show
  // « Erreur de configuration » (no detail for a non-admin), which stays.
  // Once here, the cards are defined: ask those error cards to rebuild, and
  // if one is still there a few seconds later, reload the page (at most once
  // a minute, so a real configuration error never loops).
  function igorErrorCards() {
    var found = [], root = lovelaceRoot(), pageHasIgor = false;
    try { pageHasIgor = /custom:igor-/.test(JSON.stringify(root && root.lovelace && root.lovelace.config)); } catch (e) { pageHasIgor = false; }
    (function walk(node, depth) {
      if (!node || depth > 400) return;
      if (node.tagName === "HUI-ERROR-CARD" || node.tagName === "HUI-WARNING") {
        var c = node._config || node.config || {};
        var orig = c.origConfig || c.config || {};
        if (pageHasIgor || /igor/.test(JSON.stringify(orig || {})) || /igor/i.test(String(c.error || ""))) found.push(node);
      }
      if (node.shadowRoot) walk(node.shadowRoot, depth + 1);
      for (var ch = node.firstElementChild; ch; ch = ch.nextElementSibling) walk(ch, depth + 1);
    })(document.querySelector("home-assistant"), 0);
    return found;
  }
  [300, 1000, 2000].forEach(function (ms) {
    setTimeout(function () {
      igorErrorCards().forEach(function (n) { n.dispatchEvent(new Event("ll-rebuild", { bubbles: true, composed: true })); });
    }, ms);
  });
  // The page should show a wall (its view's configuration says so) and none
  // is drawn: broken too, whatever Home Assistant put in its place.
  function wallMissing() {
    var root = lovelaceRoot();
    if (!root || !root.lovelace || !root.lovelace.config || !viewHasWall(root)) return false;
    var seen = false;
    (function walk(node, depth) {
      if (!node || seen || depth > 400) return;
      if (node.tagName === "IGOR-WALL") { seen = true; return; }
      if (node.shadowRoot) walk(node.shadowRoot, depth + 1);
      for (var ch = node.firstElementChild; ch; ch = ch.nextElementSibling) walk(ch, depth + 1);
    })(document.querySelector("home-assistant"), 0);
    return !seen;
  }
  setTimeout(function () {
    if (!igorErrorCards().length && !wallMissing()) return;
    var last = 0;
    try { last = Number(window.sessionStorage.getItem("igor-heal")) || 0; } catch (e) { last = 0; }
    if (Date.now() - last < 30000) return;
    try { window.sessionStorage.setItem("igor-heal", String(Date.now())); } catch (e) { return; }
    window.location.reload();
  }, 3500);

  // ===== a « mur » button on every other page (only when asked) =====
  // Off by default: it floated over the screen. A theme (or a device) that
  // wants it sets igor-back-button: "1"; the wall's tabs and Home
  // Assistant's own back arrow do the job otherwise.
  var backBtn = null;
  setInterval(function () {
    var v = getComputedStyle(document.documentElement).getPropertyValue("--igor-hide-header").trim().replace(/["']/g, "");
    var home = null;
    try { home = window.localStorage.getItem("igor-wall-home"); } catch (e) { home = null; }
    var asked = getComputedStyle(document.documentElement).getPropertyValue("--igor-back-button").trim().replace(/["']/g, "");
    var want = (asked === "1" || asked === "true") && (v === "1" || v === "true") && home && window.location.pathname !== home && !/[?&]edit=/.test(window.location.search);
    if (want && !backBtn) {
      backBtn = document.createElement("button");
      backBtn.type = "button";
      backBtn.textContent = "‹ mur";
      backBtn.setAttribute("aria-label", "Revenir au mur");
      backBtn.style.cssText = "position:fixed;left:calc(12px + env(safe-area-inset-left, 0px));bottom:calc(12px + env(safe-area-inset-bottom, 0px));z-index:2147482980;" +
        "font:500 14px ui-monospace,Menlo,monospace;color:#d5dbe1;background:rgba(13,16,20,0.92);border:1px solid #2b3a46;border-radius:18px;padding:8px 16px;cursor:pointer;";
      backBtn.addEventListener("click", function () {
        var h = null;
        try { h = window.localStorage.getItem("igor-wall-home"); } catch (e) { h = null; }
        if (h) navigate(h);
      });
      document.body.appendChild(backBtn);
    } else if (!want && backBtn) {
      backBtn.remove();
      backBtn = null;
    }
  }, 1000);

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
