import test from "node:test";
import assert from "node:assert/strict";

// Keep the throttled RPC queue out of the way; this test stubs fetch entirely.
process.env.SOLANA_RPC_GAP_MS = "0";

const { traceFunders } = await import("../lib/holders.js");

const FUNDER = "FundEr111111111111111111111111111111111";

const fundingTx = {
  transaction: {
    message: {
      accountKeys: [{ pubkey: FUNDER }],
      instructions: [{
        program: "system",
        programId: "11111111111111111111111111111111",
        parsed: { type: "transfer", info: { source: FUNDER, destination: "W1", lamports: 1 } },
      }],
    },
  },
  meta: { innerInstructions: [] },
};

// pageSizes: how many signatures each successive getSignaturesForAddress page returns.
function stubRpc(pageSizes) {
  let call = 0;
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(options.body);
    let result;
    if (body.method === "getSignaturesForAddress") {
      const n = pageSizes[Math.min(call++, pageSizes.length - 1)];
      result = Array.from({ length: n }, (_, i) => ({ signature: `sig-${call}-${i}` }));
    } else if (body.method === "getTransaction") {
      result = fundingTx;
    } else {
      result = [];
    }
    return { status: 200, text: async () => JSON.stringify({ jsonrpc: "2.0", id: body.id, result }) };
  };
}

test("a wallet with exactly one full page of history is traced", async () => {
  stubRpc([1000, 0]); // first page full, next page empty: history ended at exactly 1000
  const holders = [{ owner: "W1", label: null, funder: null, funderNote: null }];
  await traceFunders(holders, () => {}, { pages: 2 });
  assert.equal(holders[0].funder, FUNDER);
  assert.equal(holders[0].funderNote, null);
});

test("a wallet whose history is longer than the page budget stays too active", async () => {
  stubRpc([1000, 1000]); // both pages full, budget exhausted
  const holders = [{ owner: "W1", label: null, funder: null, funderNote: null }];
  await traceFunders(holders, () => {}, { pages: 2 });
  assert.equal(holders[0].funderNote, "too active to trace");
});
