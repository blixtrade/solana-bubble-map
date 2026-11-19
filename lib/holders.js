import { getJson, getTx, rpc } from "./core.js";

const SYSTEM_PROGRAM = "11111111111111111111111111111111";

const PLACEHOLDER_OWNERS = new Set([SYSTEM_PROGRAM]);

/**
 * Top holders, labels and token metadata from the free RugCheck report, then checked
 * against the chain: closed accounts are dropped, and owners and balances are live.
 */
export async function fetchHolders(mint, top = 20) {
  const report = await getJson(`https://api.rugcheck.xyz/v1/tokens/${mint}/report`);
  const known = report.knownAccounts || {};
  let candidates = (report.topHolders || []).slice(0, top + 10);
  if (!candidates.length) throw new Error("No holder data for this mint. Check the address is a Solana token mint.");

  let supply = Number(report.token?.supply) / 10 ** Number(report.token?.decimals ?? 0) || null;
  try {
    const [accounts, supplyInfo] = await Promise.all([
      rpc("getMultipleAccounts", [candidates.map((h) => h.address), { encoding: "jsonParsed" }]),
      rpc("getTokenSupply", [mint]),
    ]);
    supply = Number(supplyInfo?.value?.uiAmountString) || supply;
    candidates = candidates
      .map((h, i) => {
        const info = accounts?.value?.[i]?.data?.parsed?.info;
        if (!info || info.mint !== mint) return null; // closed, or no longer this token
        const amount = Number(info.tokenAmount?.uiAmountString) || 0;
        return { ...h, owner: info.owner, uiAmount: amount, pct: supply ? (amount / supply) * 100 : h.pct };
      })
      .filter((h) => h && h.uiAmount > 0);
  } catch {
    // The RPC is optional: fall back to the report, minus placeholder rows.
    candidates = candidates.filter((h) => !PLACEHOLDER_OWNERS.has(h.owner));
  }
  candidates.sort((a, b) => b.pct - a.pct);

  const holders = candidates.slice(0, top).map((h, i) => {
    const label = known[h.owner] || known[h.address] || null;
    return {
      rank: i + 1,
      owner: h.owner,
      account: h.address,
      pct: Number(h.pct) || 0,
      amount: Number(h.uiAmount) || 0,
      insider: Boolean(h.insider),
      label: label?.name || null,
      kind: label?.type || null, // "AMM", "CREATOR", ...
      funder: null,
      funderNote: null,
    };
  });
  if (!holders.length) throw new Error("No live holder accounts found for this mint.");
  return {
    mint,
    name: report.tokenMeta?.name || "Unknown token",
    symbol: report.tokenMeta?.symbol || "?",
    totalHolders: report.totalHolders ?? null,
    creator: report.creator || null,
    holders,
  };
}

/** Find who sent SOL to `owner` in a parsed transaction, if anyone. */
export function funderFromTransaction(tx, owner) {
  if (!tx) return null;
  const all = [...(tx.transaction?.message?.instructions || [])];
  for (const inner of tx.meta?.innerInstructions || []) all.push(...inner.instructions);
  for (const ix of all) {
    if (ix.programId !== SYSTEM_PROGRAM && ix.program !== "system") continue;
    const info = ix.parsed?.info;
    if (!info) continue;
    const dest = info.destination || info.newAccount;
    if (dest === owner && info.source && info.source !== owner) return info.source;
  }
  const payer = tx.transaction?.message?.accountKeys?.[0];
  const payerKey = typeof payer === "string" ? payer : payer?.pubkey;
  return payerKey && payerKey !== owner ? payerKey : null;
}

const PAGE = 1000;

/** The oldest transaction signature within `pages` pages of history, or null if there is more. */
async function firstSignature(address, pages) {
  let before;
  for (let i = 0; i < pages; i++) {
    const sigs = await rpc("getSignaturesForAddress", [address, before ? { limit: PAGE, before } : { limit: PAGE }]);
    if (!sigs.length) return i === 0 ? { none: true } : { signature: before };
    if (sigs.length < PAGE) return { signature: sigs.at(-1).signature };
    before = sigs.at(-1).signature;
  }
  return null; // history is longer than we are willing to page through
}

/**
 * For each wallet, find its first transaction and record who funded it. Pools and
 * other labelled accounts are skipped. `pages` is how many 1,000-transaction pages
 * of history to read per wallet before giving up on it.
 */
export async function traceFunders(holders, onProgress = () => {}, { pages = 2 } = {}) {
  const wallets = holders.filter((h) => !h.label);
  let done = 0;
  for (const h of wallets) {
    onProgress(++done, wallets.length);
    try {
      const first = await firstSignature(h.owner, pages);
      if (!first) { h.funderNote = "too active to trace"; continue; }
      if (first.none) { h.funderNote = "no history"; continue; }
      const tx = await getTx(first.signature);
      h.funder = funderFromTransaction(tx, h.owner);
      if (!h.funder) h.funderNote = "no funder found";
    } catch (err) {
      h.funderNote = "lookup failed";
    }
  }
  // A funder with a very long history is usually an exchange or a service wallet.
  // Sharing one of those says nothing about two holders, so those links are dropped.
  const funders = [...new Set(holders.map((h) => h.funder).filter(Boolean))];
  const holderOwners = new Set(holders.map((h) => h.owner));
  const busy = new Set();
  for (const f of funders) {
    if (holderOwners.has(f)) continue;
    if (holders.filter((h) => h.funder === f).length < 2) continue;
    try {
      const sigs = await rpc("getSignaturesForAddress", [f, { limit: PAGE }]);
      if (sigs.length >= PAGE) busy.add(f);
    } catch { /* leave as a normal funder */ }
  }
  for (const h of holders) {
    if (h.funder && busy.has(h.funder)) h.funderNote = "funded by a high-activity wallet (likely an exchange)";
  }
  return busy;
}

/**
 * Link holders that share a funder, or where one holder funded another, then
 * group linked holders into clusters. Pure function: no network.
 */
export function buildClusters(holders, busyFunders = new Set(), { includeBusy = false } = {}) {
  if (includeBusy) busyFunders = new Set();
  const index = new Map(holders.map((h, i) => [h.owner, i]));
  const parent = holders.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const links = [];
  const link = (a, b, why) => {
    if (a === b) return;
    links.push({ source: holders[a].owner, target: holders[b].owner, why });
    parent[find(a)] = find(b);
  };

  const byFunder = new Map();
  holders.forEach((h, i) => {
    if (!h.funder || busyFunders.has(h.funder)) return;
    if (index.has(h.funder)) link(i, index.get(h.funder), "funded by this holder");
    if (!byFunder.has(h.funder)) byFunder.set(h.funder, []);
    byFunder.get(h.funder).push(i);
  });
  for (const [, members] of byFunder) {
    for (let i = 1; i < members.length; i++) link(members[i], members[0], "same funder");
  }

  const groups = new Map();
  holders.forEach((h, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(h);
  });
  const clusters = [...groups.values()]
    .filter((g) => g.length > 1)
    .map((g) => ({ wallets: g.map((h) => h.owner), pct: g.reduce((s, h) => s + h.pct, 0) }))
    .sort((a, b) => b.pct - a.pct);
  clusters.forEach((cl, n) => { cl.id = n + 1; });
  const clusterOf = new Map();
  for (const cl of clusters) for (const w of cl.wallets) clusterOf.set(w, cl.id);
  for (const h of holders) h.cluster = clusterOf.get(h.owner) || 0;
  return { links, clusters };
}

/** High-activity funders shared by two or more holders: reported, but not grouped by default. */
export function sharedBusyFunders(holders, busyFunders) {
  return [...busyFunders]
    .map((funder) => {
      const funded = holders.filter((h) => h.funder === funder);
      return { funder, wallets: funded.length, pct: funded.reduce((s, h) => s + h.pct, 0) };
    })
    .filter((f) => f.wallets > 1)
    .sort((a, b) => b.wallets - a.wallets);
}

/** Headline numbers for the terminal summary and the page header. */
export function summarize(holders, clusters) {
  const wallets = holders.filter((h) => h.kind !== "AMM");
  const sum = (list) => list.reduce((s, h) => s + h.pct, 0);
  return {
    top10Pct: sum(wallets.slice(0, 10)),
    largestWalletPct: wallets[0]?.pct || 0,
    poolPct: sum(holders.filter((h) => h.kind === "AMM")),
    insiderCount: holders.filter((h) => h.insider).length,
    clusterCount: clusters.length,
    largestClusterPct: clusters[0]?.pct || 0,
  };
}
