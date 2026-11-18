import test from "node:test";
import assert from "node:assert/strict";
import { buildClusters, funderFromTransaction, summarize } from "../lib/holders.js";
import { renderHtml } from "../lib/render.js";

const holder = (owner, pct, extra = {}) => ({ rank: 0, owner, account: owner + "acct", pct, amount: 0, insider: false, label: null, kind: null, funder: null, funderNote: null, ...extra });

test("wallets sharing a funder form one group", () => {
  const holders = [holder("A", 5, { funder: "F" }), holder("B", 3, { funder: "F" }), holder("C", 2, { funder: "G" })];
  const { links, clusters } = buildClusters(holders);
  assert.equal(clusters.length, 1);
  assert.deepEqual(clusters[0].wallets.sort(), ["A", "B"]);
  assert.equal(clusters[0].pct, 8);
  assert.equal(links.length, 1);
  assert.equal(holders[2].cluster, 0);
});

test("a holder that funded another holder is linked to it", () => {
  const holders = [holder("A", 5), holder("B", 3, { funder: "A" })];
  const { clusters, links } = buildClusters(holders);
  assert.equal(clusters.length, 1);
  assert.equal(links[0].why, "funded by this holder");
});

test("links through a high-activity funder are ignored", () => {
  const holders = [holder("A", 5, { funder: "CEX" }), holder("B", 3, { funder: "CEX" })];
  const { clusters, links } = buildClusters(holders, new Set(["CEX"]));
  assert.equal(clusters.length, 0);
  assert.equal(links.length, 0);
});

test("groups merge transitively and are ordered by share", () => {
  const holders = [
    holder("A", 1, { funder: "F1" }), holder("B", 1, { funder: "F1" }),
    holder("C", 9, { funder: "F2" }), holder("D", 9, { funder: "F2" }), holder("E", 1, { funder: "C" }),
  ];
  const { clusters } = buildClusters(holders);
  assert.equal(clusters.length, 2);
  assert.equal(clusters[0].pct, 19);
  assert.equal(clusters[0].id, 1);
});

test("funder is read from the system transfer into the wallet", () => {
  const tx = {
    transaction: { message: { accountKeys: [{ pubkey: "PAYER" }], instructions: [{ program: "system", programId: "11111111111111111111111111111111", parsed: { type: "transfer", info: { source: "SRC", destination: "ME", lamports: 1 } } }] } },
    meta: { innerInstructions: [] },
  };
  assert.equal(funderFromTransaction(tx, "ME"), "SRC");
  assert.equal(funderFromTransaction({ transaction: { message: { accountKeys: ["PAYER"], instructions: [] } }, meta: {} }, "ME"), "PAYER");
  assert.equal(funderFromTransaction(null, "ME"), null);
});

test("summary excludes pools from wallet concentration", () => {
  const holders = [holder("POOL", 40, { kind: "AMM", label: "Pool" }), holder("A", 6), holder("B", 4)];
  const s = summarize(holders, []);
  assert.equal(s.top10Pct, 10);
  assert.equal(s.poolPct, 40);
  assert.equal(s.largestWalletPct, 6);
});

test("page embeds data without letting a token name break out of the script tag", () => {
  const html = renderHtml({ mint: "M", name: "</script><script>alert(1)</script>", symbol: "X", totalHolders: 1, holders: [], links: [], clusters: [], summary: summarize([], []) });
  assert.ok(!html.includes("</script><script>alert(1)"));
  assert.ok(html.includes("\\u003c/script>"));
});

test("high-activity funders can be grouped on request and are reported otherwise", async () => {
  const { sharedBusyFunders } = await import("../lib/holders.js");
  const make = () => [holder("A", 5, { funder: "CEX" }), holder("B", 3, { funder: "CEX" }), holder("C", 1, { funder: "X" })];
  assert.equal(buildClusters(make(), new Set(["CEX"]), { includeBusy: true }).clusters.length, 1);
  assert.deepEqual(sharedBusyFunders(make(), new Set(["CEX"])), [{ funder: "CEX", wallets: 2, pct: 8 }]);
});
