import { SITE } from "./core.js";

/** Build one self-contained HTML page (no external requests) for the bubble map. */
export function renderHtml(data) {
  // "<" is escaped so token names can never close the script tag.
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bubble map</title>
<style>
  :root { --bg:#0b0d10; --panel:#13161b; --line:#232832; --text:#e8eaee; --dim:#8b93a1; --accent:#c9ced8; }
  * { box-sizing: border-box; }
  html, body { margin:0; height:100%; background:var(--bg); color:var(--text); font:14px/1.45 system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
  header { padding:16px 20px; border-bottom:1px solid var(--line); display:flex; flex-wrap:wrap; gap:8px 28px; align-items:baseline; }
  h1 { font-size:18px; margin:0; font-weight:650; }
  .mint { color:var(--dim); font:12px ui-monospace, SFMono-Regular, Menlo, monospace; word-break:break-all; }
  .stats { display:flex; flex-wrap:wrap; gap:6px 22px; color:var(--dim); }
  .stats b { color:var(--text); font-weight:600; }
  main { display:grid; grid-template-columns:minmax(0,1fr) 340px; height:calc(100% - 118px); min-height:420px; }
  svg { width:100%; height:100%; display:block; touch-action:none; }
  aside { border-left:1px solid var(--line); overflow:auto; background:var(--panel); }
  table { width:100%; border-collapse:collapse; font-size:12.5px; }
  th, td { padding:7px 10px; text-align:left; border-bottom:1px solid var(--line); white-space:nowrap; }
  th { color:var(--dim); font-weight:500; position:sticky; top:0; background:var(--panel); }
  td.num, th.num { text-align:right; font-variant-numeric:tabular-nums; }
  tr.row { cursor:pointer; }
  tr.row:hover, tr.row.on { background:#1b2028; }
  .dot { display:inline-block; width:9px; height:9px; border-radius:50%; margin-right:7px; vertical-align:middle; }
  .tag { color:var(--dim); font-size:11.5px; }
  a { color:var(--accent); }
  #tip { position:fixed; pointer-events:none; background:#000; border:1px solid var(--line); border-radius:8px; padding:9px 11px; font-size:12.5px; max-width:300px; display:none; z-index:5; }
  #tip .a { font-family:ui-monospace, monospace; font-size:11.5px; color:var(--dim); word-break:break-all; }
  footer { padding:9px 20px; border-top:1px solid var(--line); color:var(--dim); font-size:12.5px; display:flex; flex-wrap:wrap; gap:6px 18px; justify-content:space-between; }
  circle { stroke:#0b0d10; stroke-width:1.5; cursor:pointer; }
  circle.on { stroke:#fff; stroke-width:2; }
  line { stroke:#7f8796; stroke-opacity:.55; stroke-width:1.4; }
  text.lbl { fill:#0b0d10; font-size:11px; font-weight:650; text-anchor:middle; pointer-events:none; }
  @media (max-width: 820px) { main { grid-template-columns:1fr; height:auto; } svg { height:62vh; } aside { border-left:0; border-top:1px solid var(--line); } }
</style>
</head>
<body>
<header>
  <div><h1 id="title"></h1><div class="mint" id="mint"></div></div>
  <div class="stats" id="stats"></div>
</header>
<main>
  <svg id="map" role="img" aria-label="Token holder bubble map"></svg>
  <aside><table><thead><tr><th>#</th><th>Holder</th><th class="num">Share</th><th>Group</th></tr></thead><tbody id="rows"></tbody></table></aside>
</main>
<footer>
  <span>Bubble size is share of supply. Lines join wallets that share a funder or funded each other. Colour marks a linked group. A link is a lead, not proof.</span>
  <span>Live holder ledgers and wallet tracking: <a href="${SITE}/?utm_source=github&utm_medium=bubble-map" target="_blank" rel="noopener">blixvip.com</a></span>
</footer>
<div id="tip"></div>
<script id="data" type="application/json">${json}</script>
<script>
(function () {
  var D = JSON.parse(document.getElementById("data").textContent);
  var NS = "http://www.w3.org/2000/svg";
  var COLORS = ["#f2b84b", "#5fd0c5", "#f07c8a", "#9d8cf5", "#7fd36b", "#f29d5b", "#63a9f5", "#e88ad6"];
  var colorOf = function (h) {
    if (h.kind === "AMM") return "#4a5261";
    if (h.cluster) return COLORS[(h.cluster - 1) % COLORS.length];
    return "#c9ced8";
  };
  var shortAddr = function (a) { return a.slice(0, 4) + "…" + a.slice(-4); };
  var fmtPct = function (n) { return n.toFixed(n < 1 ? 2 : 1) + "%"; };

  document.title = D.symbol + " bubble map";
  document.getElementById("title").textContent = D.name + " (" + D.symbol + ") holder bubble map";
  document.getElementById("mint").textContent = D.mint;
  var stats = [
    ["Top 10 wallets", fmtPct(D.summary.top10Pct)],
    ["Largest wallet", fmtPct(D.summary.largestWalletPct)],
    ["In pools", fmtPct(D.summary.poolPct)],
    ["Linked groups", String(D.summary.clusterCount)],
    ["Largest group", D.summary.clusterCount ? fmtPct(D.summary.largestClusterPct) : "none"],
    ["Holders", D.totalHolders == null ? "?" : Number(D.totalHolders).toLocaleString()]
  ];
  var statsEl = document.getElementById("stats");
  stats.forEach(function (s) {
    var span = document.createElement("span");
    span.appendChild(document.createTextNode(s[0] + " "));
    var b = document.createElement("b"); b.textContent = s[1]; span.appendChild(b);
    statsEl.appendChild(span);
  });

  var svg = document.getElementById("map");
  var W = 900, H = 640;
  function size() { var r = svg.getBoundingClientRect(); W = Math.max(320, r.width); H = Math.max(320, r.height); svg.setAttribute("viewBox", "0 0 " + W + " " + H); }
  size();

  // Bubble area is proportional to share of supply, and all bubbles together cover
  // about 40% of the canvas, whatever the distribution looks like.
  var totalPct = D.holders.reduce(function (s, h) { return s + Math.max(h.pct, 0.001); }, 0) || 1;
  function radius(h) { return Math.max(8, Math.sqrt((0.4 * W * H * Math.max(h.pct, 0.001)) / (Math.PI * totalPct))); }
  var nodes = D.holders.map(function (h, i) {
    var angle = (i / D.holders.length) * Math.PI * 2;
    var spread = Math.min(W, H) / 4;
    return { h: h, r: radius(h), x: W / 2 + Math.cos(angle) * spread, y: H / 2 + Math.sin(angle) * spread, vx: 0, vy: 0 };
  });
  var byOwner = {};
  nodes.forEach(function (n) { byOwner[n.h.owner] = n; });
  var links = D.links.map(function (l) { return { a: byOwner[l.source], b: byOwner[l.target], why: l.why }; }).filter(function (l) { return l.a && l.b; });

  var gLinks = document.createElementNS(NS, "g"), gNodes = document.createElementNS(NS, "g");
  svg.appendChild(gLinks); svg.appendChild(gNodes);
  links.forEach(function (l) { l.el = document.createElementNS(NS, "line"); gLinks.appendChild(l.el); });
  var tip = document.getElementById("tip");
  var rowsEl = document.getElementById("rows");

  function describe(h) {
    var lines = [];
    lines.push((h.label || "Wallet") + " · rank " + h.rank + " · " + fmtPct(h.pct));
    if (h.cluster) lines.push("Linked group " + h.cluster);
    if (h.insider) lines.push("Flagged as insider by RugCheck");
    if (h.funder) lines.push("First funded by " + shortAddr(h.funder));
    if (h.funderNote) lines.push(h.funderNote);
    return lines;
  }
  function highlight(owner, on) {
    nodes.forEach(function (n) { if (n.h.owner === owner) n.el.classList.toggle("on", on); });
    Array.prototype.forEach.call(rowsEl.children, function (tr) { if (tr.dataset.owner === owner) tr.classList.toggle("on", on); });
  }
  function showTip(n, ev) {
    tip.textContent = "";
    describe(n.h).forEach(function (t, i) { var d = document.createElement("div"); d.textContent = t; if (i === 0) d.style.fontWeight = "600"; tip.appendChild(d); });
    var a = document.createElement("div"); a.className = "a"; a.textContent = n.h.owner; tip.appendChild(a);
    tip.style.display = "block";
    tip.style.left = Math.min(window.innerWidth - 310, ev.clientX + 14) + "px";
    tip.style.top = Math.min(window.innerHeight - 130, ev.clientY + 14) + "px";
  }
  var open = function (owner) { window.open("https://solscan.io/account/" + owner, "_blank", "noopener"); };

  nodes.forEach(function (n) {
    n.el = document.createElementNS(NS, "circle");
    n.el.setAttribute("r", n.r); n.el.setAttribute("fill", colorOf(n.h));
    n.el.addEventListener("mousemove", function (ev) { showTip(n, ev); highlight(n.h.owner, true); });
    n.el.addEventListener("mouseleave", function () { tip.style.display = "none"; highlight(n.h.owner, false); });
    // The svg captures the pointer for dragging, so the browser sends the click to the svg,
    // not the bubble. A press and release without a drag opens the holder (see pointerup).
    n.el.addEventListener("pointerdown", function (ev) { drag = n; n.moved = false; downAt = { x: ev.clientX, y: ev.clientY }; svg.setPointerCapture(ev.pointerId); });
    gNodes.appendChild(n.el);
    if (n.r > 17) { n.txt = document.createElementNS(NS, "text"); n.txt.setAttribute("class", "lbl"); n.txt.textContent = fmtPct(n.h.pct); gNodes.appendChild(n.txt); }

    var tr = document.createElement("tr"); tr.className = "row"; tr.dataset.owner = n.h.owner;
    var cells = [String(n.h.rank), null, fmtPct(n.h.pct), n.h.kind === "AMM" ? "pool" : n.h.cluster ? "group " + n.h.cluster : ""];
    cells.forEach(function (text, i) {
      var td = document.createElement("td");
      if (i === 1) {
        var dot = document.createElement("span"); dot.className = "dot"; dot.style.background = colorOf(n.h); td.appendChild(dot);
        td.appendChild(document.createTextNode(n.h.label || shortAddr(n.h.owner)));
        if (n.h.insider) { var tag = document.createElement("span"); tag.className = "tag"; tag.textContent = " insider"; td.appendChild(tag); }
      } else { td.textContent = text; if (i === 2) td.className = "num"; if (i === 3) td.className = "tag"; }
      tr.appendChild(td);
    });
    tr.addEventListener("mouseenter", function () { highlight(n.h.owner, true); });
    tr.addEventListener("mouseleave", function () { highlight(n.h.owner, false); });
    tr.addEventListener("click", function () { open(n.h.owner); });
    rowsEl.appendChild(tr);
  });

  var drag = null, downAt = null;
  function toSvg(ev) { var r = svg.getBoundingClientRect(); return { x: (ev.clientX - r.left) * (W / r.width), y: (ev.clientY - r.top) * (H / r.height) }; }
  svg.addEventListener("pointermove", function (ev) {
    if (!drag) return;
    if (!drag.moved && Math.abs(ev.clientX - downAt.x) + Math.abs(ev.clientY - downAt.y) < 5) return; // a click, not a drag
    var p = toSvg(ev); drag.x = p.x; drag.y = p.y; drag.vx = drag.vy = 0; drag.moved = true; heat = Math.max(heat, 0.3); });
  svg.addEventListener("pointerup", function () { if (drag && !drag.moved) open(drag.h.owner); drag = null; });
  svg.addEventListener("pointercancel", function () { drag = null; });
  window.addEventListener("resize", function () {
    size();
    nodes.forEach(function (n) { n.r = radius(n.h); n.el.setAttribute("r", n.r); if (n.txt) n.txt.style.display = n.r > 17 ? "" : "none"; });
    heat = 1;
  });

  // Small force layout: pull to centre, pull linked bubbles together, push overlaps apart.
  var heat = 1;
  function step() {
    var i, j, a, b, dx, dy, dist, min, push;
    for (i = 0; i < nodes.length; i++) {
      a = nodes[i];
      a.vx += (W / 2 - a.x) * 0.004 * heat; a.vy += (H / 2 - a.y) * 0.004 * heat;
    }
    for (i = 0; i < links.length; i++) {
      a = links[i].a; b = links[i].b; dx = b.x - a.x; dy = b.y - a.y; dist = Math.sqrt(dx * dx + dy * dy) || 1;
      var want = a.r + b.r + 26, f = (dist - want) * 0.02 * heat;
      a.vx += (dx / dist) * f; a.vy += (dy / dist) * f; b.vx -= (dx / dist) * f; b.vy -= (dy / dist) * f;
    }
    for (i = 0; i < nodes.length; i++) for (j = i + 1; j < nodes.length; j++) {
      a = nodes[i]; b = nodes[j]; dx = b.x - a.x; dy = b.y - a.y; dist = Math.sqrt(dx * dx + dy * dy) || 0.01; min = a.r + b.r + 8;
      if (dist < min) { push = (min - dist) / 2; dx /= dist; dy /= dist; a.x -= dx * push; a.y -= dy * push; b.x += dx * push; b.y += dy * push; }
    }
    for (i = 0; i < nodes.length; i++) {
      a = nodes[i];
      if (a !== drag) { a.x += a.vx; a.y += a.vy; }
      a.vx *= 0.82; a.vy *= 0.82;
      a.x = Math.max(a.r + 4, Math.min(W - a.r - 4, a.x)); a.y = Math.max(a.r + 4, Math.min(H - a.r - 4, a.y));
      a.el.setAttribute("cx", a.x); a.el.setAttribute("cy", a.y);
      if (a.txt) { a.txt.setAttribute("x", a.x); a.txt.setAttribute("y", a.y + 4); }
    }
    for (i = 0; i < links.length; i++) {
      var l = links[i];
      l.el.setAttribute("x1", l.a.x); l.el.setAttribute("y1", l.a.y); l.el.setAttribute("x2", l.b.x); l.el.setAttribute("y2", l.b.y);
    }
    heat = Math.max(0.02, heat * 0.992);
    requestAnimationFrame(step);
  }
  step();
})();
</script>
</body>
</html>
`;
}
