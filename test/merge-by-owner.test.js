import test from "node:test";
import assert from "node:assert/strict";
import { mergeByOwner, summarize } from "../lib/holders.js";

test("two token accounts with the same owner merge into one holder", () => {
  const merged = mergeByOwner([
    { address: "A1", owner: "W", pct: 30, uiAmount: 30, insider: false },
    { address: "A2", owner: "W", pct: 70, uiAmount: 70, insider: true },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].owner, "W");
  assert.equal(merged[0].address, "A1");
  assert.equal(merged[0].pct, 100);
  assert.equal(merged[0].uiAmount, 100);
  assert.equal(merged[0].insider, true);
});

test("distinct owners stay separate", () => {
  const merged = mergeByOwner([
    { address: "A1", owner: "W1", pct: 20, uiAmount: 20, insider: false },
    { address: "A2", owner: "W2", pct: 30, uiAmount: 30, insider: false },
  ]);
  assert.equal(merged.length, 2);
});

test("merged share is what summarize reports as the largest wallet", () => {
  // Same two RugCheck rows for one wallet, plus a smaller unrelated holder.
  const merged = mergeByOwner([
    { address: "A1", owner: "W", pct: 30, uiAmount: 30, insider: false },
    { address: "A2", owner: "W", pct: 70, uiAmount: 70, insider: true },
    { address: "B1", owner: "X", pct: 5, uiAmount: 5, insider: false },
  ]);
  const holders = merged.map((h, i) => ({ ...h, rank: i + 1, account: h.address, amount: h.uiAmount, label: null, kind: null, funder: null, funderNote: null }));
  assert.equal(holders.length, 2);
  assert.equal(holders[0].owner, "W");
  const s = summarize(holders, []);
  assert.equal(s.largestWalletPct, 100);
});

test("mergeByOwner does not mutate its input", () => {
  const rows = [
    { address: "A1", owner: "W", pct: 30, uiAmount: 30, insider: false },
    { address: "A2", owner: "W", pct: 70, uiAmount: 70, insider: true },
  ];
  const before = JSON.stringify(rows);
  mergeByOwner(rows);
  assert.equal(JSON.stringify(rows), before);
});
