#!/usr/bin/env node
/* ==========================================================================
   discover-token.mjs — everything config.js needs, derived from the contract
   address alone.

   Pointing this site at a token means filling in a pool, a reward token, its
   decimals, and the block the thing launched at. None of that can be looked
   up from a sandbox with no route to Base, and guessing any of it has a
   known cost: a wrong pool reports another token's market cap, and a wrong
   decimals publishes a right answer at the wrong scale.

   So this asks the network and prints the answers, ready to paste:

     TOKEN=0x… node scripts/discover-token.mjs

   Run it from .github/workflows/discover.yml, which has network. Everything
   is best-effort and self-reporting: a section that cannot answer says so
   rather than falling back to a default that reads like a reading.
   ========================================================================== */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* config.js is browser code — a window.SITE_CONFIG assignment — so it is read
   rather than imported, to keep this dependency-free. */
function siteConfig() {
  const src = readFileSync(path.join(ROOT, 'config.js'), 'utf8');
  const window = {};
  new Function('window', src)(window);
  return window.SITE_CONFIG || {};
}

const CFG = siteConfig();
const TOKEN = (process.env.TOKEN || CFG.contractAddress || '').trim();
const CHAIN = CFG.chain || 'base';

/* The same list the page scans with, for the same reason: one public node's
   bad minute should not be the whole answer's bad day. */
const ENDPOINTS = [
  process.env.RPC_URL,
  ...(CFG.sources?.holders?.onchain?.rpcUrls || []),
  'https://mainnet.base.org',
].filter((u, i, a) => u && a.indexOf(u) === i);

/* Capability, not weather: this node will never answer, so the next one is
   tried at once rather than after three polite retries.

   The last two patterns are a node ADVERTISING a hard cap — "You can make
   eth_getLogs requests with up to a 10 block range". Narrowing is the wrong
   answer to that: this scan covers 342,000 blocks, which at ten a request is
   thirty-four thousand requests, and the halving would give up long before
   reaching a window that small anyway. Another endpoint is the answer, and
   there are six more in the list. */
const CANNOT = /not supported|unsupported|method not found|pruned|not available|header not found|missing trie node|HTTP (40[1-5])|unauthorized|forbidden|up to a \d+ block range|block range should work/i;

/* "pruned history unavailable" belongs here, not in the caller's hands: it is
   a statement about THIS NODE's retention, not about the request, so the right
   response is to ask a different node — which is what rotating does. Base's
   public endpoint answers it for any block more than a few weeks old. */
const TRANSIENT = /HTTP (408|429|5\d\d)|fetch failed|ECONN|ETIMEDOUT|socket|healthy|timeout|pruned|not available|header not found|missing trie node/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let rpcCalls = 0;
let endpoint = 0;

async function rpc(method, params = []) {
  let lastErr;
  for (let node = 0; node < ENDPOINTS.length; node++) {
    const url = ENDPOINTS[(endpoint + node) % ENDPOINTS.length];
    for (let attempt = 0; attempt < 3; attempt++) {
      rpcCalls++;
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: rpcCalls, method, params }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = await res.json();
        if (j.error) throw new Error(j.error.message);
        endpoint = (endpoint + node) % ENDPOINTS.length;
        return j.result;
      } catch (err) {
        lastErr = err;
        /* Three kinds of refusal, three responses. A node saying it cannot do
           this AT ALL — no eth_getLogs, no history that old, no access — is
           not worth retrying: move to the next endpoint immediately. A node
           having a bad minute is worth waiting for. Anything else is about
           the REQUEST, and belongs to the caller, which knows how to shrink
           it. Rotating on the first of those is what this run was missing:
           one endpoint answered "The method eth_getLogs is not supported" and
           the whole distributor check was abandoned with six other endpoints
           unused. */
        if (CANNOT.test(err.message || '')) break;
        if (!TRANSIENT.test(err.message || '')) throw err;
        await sleep(400 * Math.pow(3, attempt));
      }
    }
  }
  throw lastErr;
}

async function getJson(url, label) {
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${label || url}`);
  return res.json();
}

/* ---- what a token says it is ------------------------------------------ */

const printable = (hex) => {
  if (!hex || hex === '0x') return '';
  let out = '';
  for (let i = 2; i < hex.length; i += 2) {
    const c = parseInt(hex.substr(i, 2), 16);
    if (c >= 32 && c < 127) out += String.fromCharCode(c);
  }
  return out.trim();
};

/* Each failure carries its reason. A silent fallback to 18 decimals cannot be
   told from a token that really has 18 — and this output exists to be quoted
   as fact, so a default that reads like a reading is worse than no reading. */
async function meta(token) {
  const ask = (data, decode) => rpc('eth_call', [{ to: token, data }, 'latest'])
    .then(decode, (e) => ({ failed: e.message }));

  const [symbol, name, decimals, supply] = await Promise.all([
    ask('0x95d89b41', printable),
    ask('0x06fdde03', printable),
    ask('0x313ce567', (h) => parseInt(h, 16)),
    ask('0x18160ddd', (h) => BigInt(h)),
  ]);
  const show = (v) => (v && v.failed ? `<unread: ${v.failed}>` : v);
  return {
    symbol: show(symbol),
    name: show(name),
    decimals: Number.isFinite(decimals) ? decimals : null,
    supply: typeof supply === 'bigint' ? supply : null,
  };
}

const asTokens = (v, dp) => {
  if (v === null || dp === null) return null;
  const base = 10n ** BigInt(dp);
  return Number(v / base) + Number(v % base) / Number(base);
};

/* ---- the block a timestamp falls in ----------------------------------- */

/* No key, no explorer, and — deliberately — no search that starts at block 1.
   A textbook binary search over [1, head] probes the middle of the chain
   first, and Base's public nodes answer any block that old with "pruned
   history unavailable": the search died on its very first probe. So this
   walks IN from the head instead, where the blocks still exist, using Base's
   ~2s cadence to convert a time gap into a block gap, and only brackets a
   binary search once it is within sight. Returns the first block at or after
   `when` (unix seconds). */
const BLOCK_SECONDS = 2;

async function blockAtTime(when, head) {
  const tsOf = async (n) => {
    const b = await rpc('eth_getBlockByNumber', ['0x' + Math.max(1, n).toString(16), false]);
    if (!b) throw new Error('no block ' + n);
    return parseInt(b.timestamp, 16);
  };

  const headTs = await tsOf(head);
  if (headTs < when) return { block: null, note: 'that timestamp is in the future' };

  // Step in from the head, correcting the estimate with each real timestamp.
  let guess = head;
  let guessTs = headTs;
  for (let i = 0; i < 12 && Math.abs(guessTs - when) > 120; i++) {
    const next = Math.max(1, Math.min(head, guess - Math.round((guessTs - when) / BLOCK_SECONDS)));
    if (next === guess) break;
    guess = next;
    guessTs = await tsOf(guess);
  }

  /* Bracket whichever side the estimate landed on, widening until it straddles
     the target, then bisect that — a few thousand blocks at most, all of them
     recent enough to still be served. */
  let lo = guess;
  let hi = guess;
  let span = 2048;
  while (lo > 1 && await tsOf(lo) > when) { lo = Math.max(1, lo - span); span *= 2; }
  span = 2048;
  while (hi < head && await tsOf(hi) < when) { hi = Math.min(head, hi + span); span *= 2; }

  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (await tsOf(mid) < when) lo = mid + 1; else hi = mid;
  }
  return { block: lo, ts: await tsOf(lo) };
}

/* ---- the token's own first block -------------------------------------- */

/* The pair's creation time is the launch, but it is DexScreener's word for it.
   The token's own first Transfer is the chain's, and it is what the indexer's
   START_BLOCK actually wants: a cursor before which nothing about this token
   exists. Probed around the pair block rather than searched from genesis. */
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

async function firstTransferBlock(token, around, head) {
  /* Walk backwards in widening windows from the pair block: the deployment is
     minutes before it, never days. Stops at the first window that is empty
     below a window that was not. */
  let span = 5000;
  let end = Math.min(around + 1000, head);
  let best = null;
  for (let i = 0; i < 8; i++) {
    const start = Math.max(1, end - span);
    let logs;
    try {
      logs = await rpc('eth_getLogs', [{
        address: token, topics: [TRANSFER],
        fromBlock: '0x' + start.toString(16), toBlock: '0x' + end.toString(16),
      }]);
    } catch (err) {
      /* Narrow for anything that is not plainly about the node. Base's public
         RPC signals an oversized window as a bare HTTP 500 or 413 — no
         message, nothing matching "range too large" — so gating this on the
         words means never narrowing at all. */
      const aboutTheNode = /HTTP (40[1-5])|fetch failed|ECONN|ETIMEDOUT|unauthorized|forbidden|not supported/i
        .test(err.message || '');
      if (!aboutTheNode && span > 200) { span = Math.floor(span / 2); continue; }
      return { block: null, note: `getLogs failed: ${err.message}` };
    }
    if (logs.length) {
      best = Math.min(...logs.map((l) => parseInt(l.blockNumber, 16)));
      if (best > start) return { block: best };   // the window's own floor is clear
      end = start - 1;                            // it reached the edge — keep going
    } else if (best !== null) {
      return { block: best };
    } else {
      end = start - 1;
    }
    span *= 2;
  }
  return { block: best, note: best === null ? 'no Transfer found near the pair block' : 'earliest seen; window ran out' };
}

/* ---- does this address actually behave like the distributor? ---------- */

/* rewardsIndex cannot be derived, but a CANDIDATE can be tested: the
   distributor is the address the reward token flows into and out of. An
   address with no reward-token flow at all is the wrong one — which is worth
   finding out here rather than from a dashboard that publishes a confident
   zero. Pass candidates in CANDIDATES, comma-separated. */
async function flowsFor(address, rewardToken, from, to) {
  const asTopic = (a) => '0x' + '0'.repeat(24) + String(a).toLowerCase().replace(/^0x/, '');
  const count = async (topics) => {
    let cursor = from;
    let span = 10000;
    let total = 0n;
    let n = 0;
    while (cursor <= to) {
      const end = Math.min(cursor + span - 1, to);
      let logs;
      try {
        logs = await rpc('eth_getLogs', [{
          address: rewardToken, topics,
          fromBlock: '0x' + cursor.toString(16), toBlock: '0x' + end.toString(16),
        }]);
      } catch (err) {
        /* Narrow on anything that is not plainly about the node: Base's public
           RPC signals an oversized window as a bare HTTP 500 or 413, with no
           message to match on. */
        const aboutTheNode = /HTTP (40[1-5])|fetch failed|ECONN|ETIMEDOUT|unauthorized|forbidden|not supported/i
          .test(err.message || '');
        if (!aboutTheNode && span > 200) { span = Math.floor(span / 2); continue; }
        throw err;
      }
      for (const l of logs) { total += (!l.data || l.data === '0x') ? 0n : BigInt(l.data); n++; }
      cursor = end + 1;
    }
    return { total, n };
  };
  const [into, outOf] = await Promise.all([
    count([TRANSFER, null, asTopic(address)]),
    count([TRANSFER, asTopic(address)]),
  ]);
  return { into, outOf };
}

/* ---- the platform's own answers --------------------------------------- */

/* rewardsIndex is not derivable on chain — it is a routing decision the
   platform made — so these two endpoints are the only automatic source for
   it. If they cannot be reached, a human has to read it off the panel. */
async function platform(token) {
  const out = { coins: null, feeRouting: null, errors: [] };

  for (const url of [
    'https://www.thestonks.exchange/api/coins',
    'https://thestonks.exchange/api/coins',
  ]) {
    try {
      const d = await getJson(url, 'coins');
      const list = Array.isArray(d) ? d : (d.coins || d.data || d.items || []);
      const want = token.toLowerCase();
      out.coins = list.find((c) => JSON.stringify(c).toLowerCase().includes(want)) || null;
      out.coinsCount = list.length;
      break;
    } catch (e) { out.errors.push(`${url} → ${e.message}`); }
  }

  const locker = out.coins && (out.coins.feeLocker || out.coins.fee_locker || out.coins.locker);
  const pairsArg = locker ? `${token}:${locker}` : token;
  for (const url of [
    `https://www.thestonks.exchange/api/fee-routing?pairs=${pairsArg}`,
    `https://thestonks.exchange/api/fee-routing?pairs=${pairsArg}`,
  ]) {
    try { out.feeRouting = await getJson(url, 'fee-routing'); break; }
    catch (e) { out.errors.push(`${url} → ${e.message}`); }
  }
  return out;
}

/* ---- report ------------------------------------------------------------ */

async function main() {
  console.log('=== discover ============================================');
  console.log(`token  ${TOKEN}`);
  if (!/^0x[0-9a-fA-F]{40}$/.test(TOKEN)) {
    console.log('not an address — set TOKEN or config.js contractAddress');
    process.exit(1);
  }

  /* 1. the market, which knows the pool and the pair's other side ---------- */
  let pairs = [];
  try {
    const d = await getJson(`https://api.dexscreener.com/latest/dex/tokens/${TOKEN}`, 'dexscreener');
    pairs = (d?.pairs || []).filter((p) => p.chainId === CHAIN);
  } catch (e) { console.log(`dexscreener: FAILED ${e.message}`); }

  console.log(`\n--- dexscreener: ${pairs.length} pair(s) on ${CHAIN} ---`);
  pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
  for (const p of pairs) {
    console.log(`  ${p.pairAddress}  ${p.dexId} ${JSON.stringify(p.labels || [])}`);
    console.log(`    ${p.baseToken?.symbol} ${p.baseToken?.address}`);
    console.log(`    / ${p.quoteToken?.symbol} ${p.quoteToken?.address}`);
    console.log(`    liq $${p.liquidity?.usd ?? '?'}  mcap ${p.marketCap ?? '?'}  fdv ${p.fdv ?? '?'}  v24h ${p.volume?.h24 ?? '?'}`);
    console.log(`    priceUsd ${p.priceUsd}  priceNative ${p.priceNative}  created ${p.pairCreatedAt ? new Date(p.pairCreatedAt).toISOString() : '?'}`);
  }

  const top = pairs[0] || null;
  const isBase = top && top.baseToken?.address?.toLowerCase() === TOKEN.toLowerCase();
  const reward = top ? (isBase ? top.quoteToken : top.baseToken) : null;

  /* Every stage below is allowed to fail on its own. The summary is the whole
     point of the run, and a thrown error in stage three used to take the two
     stages that had already succeeded down with it. */
  const attempt = (label, fn, fallback) => fn().catch((e) => {
    console.log(`\n${label}: FAILED ${e.message}`);
    return typeof fallback === 'function' ? fallback(e) : fallback;
  });

  /* 2. what each of the two tokens says about itself ---------------------- */
  const tokenMeta = await attempt('token metadata', () => meta(TOKEN), (e) => ({ failed: e.message }));
  const rewardMeta = reward
    ? await attempt('reward metadata', () => meta(reward.address), (e) => ({ failed: e.message }))
    : null;

  /* 3. when it started ---------------------------------------------------- */
  const head = await attempt('head block', async () => parseInt(await rpc('eth_blockNumber'), 16) - 5, null);
  let pairBlock = { block: null, note: 'no pairCreatedAt' };
  if (head && top?.pairCreatedAt) {
    pairBlock = await attempt('pair block', () => blockAtTime(Math.floor(top.pairCreatedAt / 1000), head),
      (e) => ({ block: null, note: e.message }));
  }
  const firstXfer = (head && pairBlock.block)
    ? await attempt('first transfer', () => firstTransferBlock(TOKEN, pairBlock.block, head),
        (e) => ({ block: null, note: e.message }))
    : { block: null, note: 'no pair block to search around' };

  /* 3b. do the candidate distributors hold reward-token flow? -------------- */
  const launchBlock = firstXfer.block ?? pairBlock.block;
  const candidates = (process.env.CANDIDATES || '').split(',').map((a) => a.trim()).filter(Boolean);
  const candidateFlows = [];
  for (const addr of candidates) {
    if (!reward || !launchBlock || !head) { candidateFlows.push([addr, null]); continue; }
    candidateFlows.push([addr, await attempt(`candidate ${addr}`,
      () => flowsFor(addr, reward.address, launchBlock, head), null)]);
  }

  /* 4. what the platform routed ------------------------------------------- */
  const plat = await attempt('platform', () => platform(TOKEN),
    (e) => ({ coins: null, feeRouting: null, errors: [e.message] }));

  /* -------- the part worth quoting, last: job logs come back as a tail ---- */
  console.log('\n=== SUMMARY =============================================');
  console.log(`head block  ${head ?? '?'}`);

  const line = (label, m) => {
    if (!m) { console.log(`${label}  (none)`); return; }
    if (m.failed) { console.log(`${label}  <unread: ${m.failed}>`); return; }
    console.log(`${label}  symbol() "${m.symbol}"  name() "${m.name}"  ` +
                `decimals() ${m.decimals === null ? '<UNREAD — do not assume 18>' : m.decimals}`);
    if (m.supply !== null && m.decimals !== null) {
      console.log(`${' '.repeat(label.length)}  totalSupply ${asTokens(m.supply, m.decimals).toLocaleString('en-US')}`);
    }
  };
  line('token ', tokenMeta);
  console.log(`        ${TOKEN}`);
  line('reward', rewardMeta);
  if (reward) console.log(`        ${reward.address}   (the ${isBase ? 'quote' : 'base'} side of the deepest pair)`);

  console.log(`pool    ${top ? top.pairAddress : '(no pair found)'}`);
  console.log(`pair created  ${top?.pairCreatedAt ? new Date(top.pairCreatedAt).toISOString() : '?'}` +
              `  → block ${pairBlock.block ?? '?'}${pairBlock.note ? ' (' + pairBlock.note + ')' : ''}`);
  console.log(`token's first Transfer  block ${firstXfer.block ?? '?'}` +
              `${firstXfer.note ? ' (' + firstXfer.note + ')' : ''}`);

  if (candidateFlows.length) {
    console.log('\n--- candidate distributors (reward-token flow since launch) ---');
    for (const [addr, f] of candidateFlows) {
      if (!f) { console.log(`${addr}  (not measured)`); continue; }
      const dp = rewardMeta && !rewardMeta.failed && rewardMeta.decimals !== null ? rewardMeta.decimals : null;
      const show = (v) => (dp === null ? `${v} base units (decimals unread)` : asTokens(v, dp));
      console.log(`${addr}`);
      console.log(`    in  ${show(f.into.total)}  (${f.into.n} transfers)`);
      console.log(`    out ${show(f.outOf.total)}  (${f.outOf.n} transfers)`);
      if (!f.into.n && !f.outOf.n) console.log('    → no reward-token flow: this is NOT the distributor');
    }
  }

  console.log('\n--- platform ---');
  if (plat.coins) console.log('coins entry: ' + JSON.stringify(plat.coins, null, 2));
  else console.log(`coins entry: not found${plat.coinsCount ? ` (searched ${plat.coinsCount})` : ''}`);
  if (plat.feeRouting) console.log('fee-routing: ' + JSON.stringify(plat.feeRouting, null, 2));
  else console.log('fee-routing: no answer');
  for (const e of plat.errors) console.log(`  ! ${e}`);

  console.log('\n--- paste into config.js ---');
  const launch = launchBlock;
  console.log(`  contractAddress: '${TOKEN}',`);
  console.log(`  rewardTokenAddress: ${reward ? `'${reward.address}'` : 'null'},`);
  console.log(`  rewardTokenSymbol: ${rewardMeta && !rewardMeta.failed ? `'${rewardMeta.symbol}'` : 'null'},`);
  console.log(`  launchBlock: ${launch ?? 'null'},`);
  console.log(`  contracts.pool: ${top ? `'${top.pairAddress}'` : 'null'},`);
  console.log('  contracts.feeLocker / rewardsIndex: from the platform block above');
  console.log('\n--- and worker/src/config.js ---');
  console.log(`  TOKENS.STR = '${TOKEN}'  (${tokenMeta?.decimals ?? '?'} decimals → STR_DECIMALS)`);
  console.log(`  TOKENS.KEX = ${reward ? `'${reward.address}'` : 'null'}  (${rewardMeta?.decimals ?? '?'} decimals → KEX_DECIMALS)`);
  console.log(`  START_BLOCK = ${launch ?? 'null'}   — and seed data/rewards-state.json cursor to it`);
  console.log(`\n${rpcCalls} RPC calls`);
  console.log('=========================================================');
}

main().catch((e) => { console.error('discover failed:', e.message); process.exit(1); });
