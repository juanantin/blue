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

const TRANSIENT = /HTTP (408|429|5\d\d)|fetch failed|ECONN|ETIMEDOUT|socket|healthy|timeout/i;
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

/* Binary search rather than an explorer: no key, no rate limit, and it is the
   same answer every explorer would be quoting. ~30 calls for the whole chain.
   Returns the FIRST block at or after `when` (unix seconds). */
async function blockAtTime(when, head) {
  const tsOf = async (n) => {
    const b = await rpc('eth_getBlockByNumber', ['0x' + n.toString(16), false]);
    return parseInt(b.timestamp, 16);
  };
  let lo = 1;
  let hi = head;
  if (await tsOf(hi) < when) return { block: null, note: 'that timestamp is in the future' };
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

  /* 2. what each of the two tokens says about itself ---------------------- */
  const tokenMeta = await meta(TOKEN).catch((e) => ({ failed: e.message }));
  const rewardMeta = reward ? await meta(reward.address).catch((e) => ({ failed: e.message })) : null;

  /* 3. when it started ---------------------------------------------------- */
  const head = parseInt(await rpc('eth_blockNumber'), 16) - 5;
  let pairBlock = { block: null, note: 'no pairCreatedAt' };
  if (top?.pairCreatedAt) pairBlock = await blockAtTime(Math.floor(top.pairCreatedAt / 1000), head);
  const firstXfer = pairBlock.block
    ? await firstTransferBlock(TOKEN, pairBlock.block, head)
    : { block: null, note: 'no pair block to search around' };

  /* 4. what the platform routed ------------------------------------------- */
  const plat = await platform(TOKEN);

  /* -------- the part worth quoting, last: job logs come back as a tail ---- */
  console.log('\n=== SUMMARY =============================================');
  console.log(`head block  ${head}`);

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

  console.log('\n--- platform ---');
  if (plat.coins) console.log('coins entry: ' + JSON.stringify(plat.coins, null, 2));
  else console.log(`coins entry: not found${plat.coinsCount ? ` (searched ${plat.coinsCount})` : ''}`);
  if (plat.feeRouting) console.log('fee-routing: ' + JSON.stringify(plat.feeRouting, null, 2));
  else console.log('fee-routing: no answer');
  for (const e of plat.errors) console.log(`  ! ${e}`);

  console.log('\n--- paste into config.js ---');
  const launch = firstXfer.block ?? pairBlock.block;
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
