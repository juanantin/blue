/* ==========================================================================
   What the indexer watches — $BLUE on Base.
   --------------------------------------------------------------------------
   Every address here was read from the network by .github/workflows/
   discover.yml (scripts/discover-token.mjs) rather than carried over from the
   token this site was copied from. The run's own words are quoted per field.

   ⚠ Which on-chain flow is "fees collected" versus "distributed" is still not
   self-evident: reconcile against what thestonks.exchange and
   stockify.finance publish for $BLUE before trusting a number — the traps and
   their magnitudes are in worker/README.md.
   ========================================================================== */

export const CHAIN_ID = 8453;                    // Base

export const TOKENS = {
  // The token people buy — $BLUE, The Stonkex Bull
  STR: '0x1d0c1bE75f32C1238Da27dBB59d21c7DF8D311B2',
  // The reward token holders are paid in — $STONKEX, the quote side of the
  // pair. symbol() "STONKEX", name() "The Stonks Exchange", read on chain.
  KEX: '0x5ab000ff9B9FfE0349CE5ffA5fD86f217C3680F5',
};

export const CONTRACTS = {
  // The trading pair — BLUE/STONKEX on Uniswap v3, the deeper of the token's
  // two pools by two orders of magnitude.
  pool: '0xcb0309312718e7c1a54d4B35Be3726Ee38755B82',
  // Where trading fees accrue. This locker is SHARED BY EVERY COIN on the
  // platform — it is the same address $BOX uses, which is the proof — so no
  // stream may sum it: doing so reports the whole platform's fees as this
  // token's.
  feeLocker: '0x71D1D363176723f85d98B8B430DF33cde89f0A7f',
  // The distributor holders are paid from, from /api/fee-routing, which
  // reports this token's routing as "rewards". Per token — which is what makes
  // summing it this token's flows rather than the platform's. Every stream
  // below watches it.
  rewardsIndex: '0x7273A102A1A20dD0eB01C23Ce4b57dAF6160Bf77',
};

// The block $BLUE launched at, from /api/coins — and independently from a
// timestamp search for the pool's own pairCreatedAt, which lands on the same
// block. Nothing relevant happened before it, so the scan starts here rather
// than at genesis.
export const START_BLOCK = 50968736;

/* Decimals, per token, READ FROM EACH CONTRACT rather than assumed. Both
   happen to be 18 here — but they are two constants, not one, precisely
   because on $BOX they differed: its reward token's decimals() returns 8, and
   sharing a constant there published 25.244695737 as 2.5244695737e-9, every
   digit right and the scale out by ten billion. A token that is "obviously
   18" is exactly the one nobody checks. */
export const STR_DECIMALS = 18;
export const KEX_DECIMALS = 18;

/* Everything that has to be real before a scan means anything. index-rewards
   and the worker both refuse to run while this list is non-empty, because the
   alternative is a run that sums nothing and publishes nulls on a schedule —
   which looks, on the page, exactly like a site that is broken. */
export const MISSING = Object.entries({
  'TOKENS.KEX': TOKENS.KEX,
  'CONTRACTS.pool': CONTRACTS.pool,
  'CONTRACTS.rewardsIndex': CONTRACTS.rewardsIndex,
  START_BLOCK,
  KEX_DECIMALS,
}).filter(([, v]) => v === null || v === undefined || v === '').map(([k]) => k);

/* The three flows the totals are built from:

     `feesIn`   reward tokens ARRIVING at the distributor — "fees collected"
     `paidOut`  everything LEAVING it: holder payments plus the protocol's cut,
                so it is not the "distributed" figure on its own
     `holders`  every token transfer folded into a running balance per address;
                addresses left holding something are the holder count

   Verify these against the platform's own panel before trusting them. */
export const STREAMS = [
  { id: 'feesIn', kind: 'sum', token: TOKENS.KEX, to: CONTRACTS.rewardsIndex, decimals: KEX_DECIMALS },
  { id: 'paidOut', kind: 'sum', token: TOKENS.KEX, from: CONTRACTS.rewardsIndex, decimals: KEX_DECIMALS },
  { id: 'holders', kind: 'balances', token: TOKENS.STR, decimals: STR_DECIMALS },
];

/* Share of the outflow that reaches holders — the rest is the protocol's cut.
   ⚠ NOT YET VERIFIED FOR $BLUE. 0.9 is the platform's usual split and what
   $BOX's panel reads ("TO HOLDERS 90% · 10% protocol · 0% creator"), but it
   is a per-token setting, and it is the one multiplier standing between the
   measured outflow and the figure on the tile. scripts/panel-probe.mjs reads
   $BLUE's own Stockify panel for it; until that agrees, treat the distributed
   figure as provisional and do not announce it. Better still, set
   PROTOCOL_ADDRESS when it turns up — the cut is then subtracted exactly and
   survives the percentage changing. */
export const HOLDER_SHARE = 0.9;
export const PROTOCOL_ADDRESS = null;

if (PROTOCOL_ADDRESS) {
  STREAMS.push({
    id: 'protocolOut', kind: 'sum', token: TOKENS.KEX,
    from: CONTRACTS.rewardsIndex, to: PROTOCOL_ADDRESS, decimals: KEX_DECIMALS,
  });
}

/** Tokens that actually reached holders. */
export function holderPayout(totals) {
  const paidOut = totals.paidOut ?? 0;
  if (PROTOCOL_ADDRESS) return Math.max(0, paidOut - (totals.protocolOut ?? 0));
  return paidOut * HOLDER_SHARE;
}

/* Addresses that hold supply but are not holders in the sense the tile means:
   the pool itself, the fee locker, the rewards contract. */
export const EXCLUDE_FROM_HOLDERS = [
  CONTRACTS.pool,
  CONTRACTS.feeLocker,
  CONTRACTS.rewardsIndex,
].filter(Boolean).map((a) => a.toLowerCase());

/* Scan pacing. A Worker run is short, so it takes bites and resumes. Raise
   MAX_CHUNKS_PER_RUN to backfill faster; lower CHUNK_SIZE if the RPC complains
   (it halves automatically anyway). */
export const CHUNK_SIZE = 2000;
export const MAX_CHUNKS_PER_RUN = 60;
export const CONFIRMATIONS = 5;

// Price the token totals in USD. Public, no key.
export const DEXSCREENER_PAIR =
  'https://api.dexscreener.com/latest/dex/pairs/base/' + CONTRACTS.pool;
export const DEXSCREENER_KEX_TOKEN =
  'https://api.dexscreener.com/latest/dex/tokens/' + TOKENS.KEX;
