/* ==========================================================================
   What the indexer watches — $BLUE on Base.
   --------------------------------------------------------------------------
   ⚠ INCOMPLETE. Everything below marked null is filled in from a run of
   .github/workflows/discover.yml (scripts/discover-token.mjs), which asks the
   network the questions this sandbox cannot:

     TOKENS.KEX        the reward token — the quote side of the deepest pair
     KEX_DECIMALS      READ FROM CHAIN, never assumed. $BOX's reward token has
                       8, and an 18 there published 25.244695737 as 2.5e-9:
                       every digit right, the scale out by ten billion. STR and
                       KEX must not share a constant.
     CONTRACTS.pool    corroborated by DexScreener resolving the same pair from
                       the contract address alone
     CONTRACTS.rewardsIndex
                       NOT derivable on chain — a routing decision. From
                       /api/fee-routing?pairs=<token>:<feeLocker>, or off the
                       platform's own panel.
     START_BLOCK       the token's first block. Left null the scan would start
                       at genesis and never converge.
     HOLDER_SHARE      from $BLUE's own Stockify panel.

   The schedule in .github/workflows/index-rewards.yml stays commented out
   until they are all real, and data/rewards-state.json's cursor is seeded with
   START_BLOCK in the same commit — a present state file with a cursor of 0 is
   read as gospel and scans Base from genesis.

   ⚠ And which on-chain flow is "fees collected" versus "distributed" is not
   self-evident: reconcile against what thestonks.exchange and
   stockify.finance publish for $BLUE before trusting a number — the traps and
   their magnitudes are in worker/README.md.
   ========================================================================== */

export const CHAIN_ID = 8453;                    // Base

export const TOKENS = {
  // The token people buy — $BLUE, The Stonkex Bull
  STR: '0x1d0c1bE75f32C1238Da27dBB59d21c7DF8D311B2',
  // The reward token holders are paid in — the quote side of the pair
  KEX: null,
};

export const CONTRACTS = {
  // The trading pair
  pool: null,
  // Where trading fees accrue. This locker is SHARED BY EVERY COIN on the
  // platform, so no stream may sum it: doing so reports the whole platform's
  // fees as this token's.
  feeLocker: null,
  // The distributor holders are paid from. Per token — which is what makes
  // summing it this token's flows rather than the platform's. Every stream
  // below watches it.
  rewardsIndex: null,
};

// The block $BLUE launched at. Nothing relevant happened before it, so the
// scan starts here rather than at genesis.
export const START_BLOCK = null;

/* Decimals, per token, read from each contract rather than assumed. */
export const STR_DECIMALS = 18;
export const KEX_DECIMALS = null;

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
   ⚠ UNVERIFIED FOR $BLUE. 0.9 is the platform's usual split and what $BOX's
   panel reads ("TO HOLDERS 90% · 10% protocol · 0% creator"), but it is a
   per-token setting: check $BLUE's Stockify panel before publishing a payout.
   Better still, set PROTOCOL_ADDRESS when it turns up — the cut is then
   subtracted exactly and survives the percentage changing. */
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
