import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { renderHtml } from "../lib/render.js";
import { summarize } from "../lib/holders.js";

// Just enough DOM to run the page script and fire pointer events at it.
function fakeElement(tag) {
  const handlers = {};
  return {
    tagName: tag, children: [], style: {}, dataset: {}, attrs: {}, handlers, textContent: "",
    classList: { toggle() {} },
    addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
    fire(type, ev = {}) { for (const fn of handlers[type] || []) fn({ clientX: 0, clientY: 0, pointerId: 1, ...ev }); },
    setAttribute(k, v) { this.attrs[k] = v; },
    appendChild(c) { this.children.push(c); return c; },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 900, height: 640 }),
    setPointerCapture() {},
  };
}

function runPage(data) {
  const html = renderHtml(data);
  const json = /<script id="data" type="application\/json">([\s\S]*?)<\/script>/.exec(html)[1];
  const code = /<script>\n([\s\S]*?)<\/script>/.exec(html)[1];
  const byId = { data: Object.assign(fakeElement("script"), { textContent: json }) };
  for (const id of ["title", "mint", "stats", "map", "tip", "rows"]) byId[id] = fakeElement(id === "map" ? "svg" : "div");
  const opened = [];
  const window = { innerWidth: 1200, innerHeight: 800, addEventListener() {}, open: (url) => opened.push(url) };
  const document = { title: "", getElementById: (id) => byId[id], createElement: fakeElement, createElementNS: (_ns, tag) => fakeElement(tag), createTextNode: (t) => ({ t }) };
  vm.runInNewContext(code, { window, document, requestAnimationFrame() {}, Math, JSON, Number, String, Array });
  const circles = byId.map.children[1].children.filter((el) => el.tagName === "circle");
  return { svg: byId.map, circles, opened };
}

const data = () => {
  const holders = [
    { rank: 1, owner: "Aaaa1111111111111111111111111111111111111111", pct: 30, label: null, kind: null, insider: false, cluster: 0 },
    { rank: 2, owner: "Bbbb2222222222222222222222222222222222222222", pct: 10, label: null, kind: null, insider: false, cluster: 0 },
  ];
  return { mint: "M", name: "T", symbol: "T", totalHolders: 2, holders, links: [], clusters: [], summary: summarize(holders, []) };
};

test("clicking a bubble opens the holder even though the svg captures the pointer", () => {
  // With pointer capture on the svg, browsers deliver pointerup and click to the svg, not the circle.
  const { svg, circles, opened } = runPage(data());
  circles[0].fire("pointerdown", { clientX: 100, clientY: 100 });
  svg.fire("pointermove", { clientX: 101, clientY: 101 }); // hand jitter is still a click
  svg.fire("pointerup");
  svg.fire("click");
  assert.deepEqual(opened, ["https://solscan.io/account/Aaaa1111111111111111111111111111111111111111"]);
});

test("dragging a bubble does not open it", () => {
  const { svg, circles, opened } = runPage(data());
  circles[1].fire("pointerdown", { clientX: 100, clientY: 100 });
  svg.fire("pointermove", { clientX: 160, clientY: 100 });
  svg.fire("pointerup");
  svg.fire("click");
  assert.deepEqual(opened, []);
});
