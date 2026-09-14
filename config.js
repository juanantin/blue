/* ==========================================================================
   SITE CONFIGURATION
   --------------------------------------------------------------------------
   This is the only file you need to edit to point the site at a token.
   Everything marked TODO has to be filled in; the rest has sane defaults.
   ========================================================================== */

window.SITE_CONFIG = {
  /* Build stamp. Shown in the ?debug=1 panel, so you can confirm which version
     a browser actually has rather than guessing at a cache. Bump it together
     with the ?v= on the script tags in index.html whenever you deploy. */
  version: '17',

  /* ---- Token ---------------------------------------------------------- */

  // The token people buy — $BLUE. The CA button copies this, the chart button
  // links to it, and DexScreener is searched by it. Nothing on the dashboard
  // resolves without it.
  contractAddress: '0x1d0c1bE75f32C1238Da27dBB59d21c7DF8D311B2',

  // $STONKEX, the token holders are paid in — the quote side of the pair, and
  // what thestonks.exchange's /api/coins entry for $BLUE names as its quote.
  // Used to price "total distributed" in USD when the rewards source doesn't
  // give a USD figure itself, so the sub-line under that card depends on it.
  // Read off Base, not assumed: symbol() "STONKEX", name() "The Stonks
  // Exchange", decimals() 18 — corroborated by the platform's own
  // quote_decimals. $BOX's reward token returns 8, and inheriting that here
  // would be as wrong as inheriting 18 was there.
  rewardTokenAddress: '0x5ab000ff9B9FfE0349CE5ffA5fD86f217C3680F5',

  // Free, keyless, CORS-enabled. Used as the last price source, because it
  // covers tokens DexScreener has no pair for — an index token among them.
  geckoterminalBase: 'https://api.geckoterminal.com/api/v2',

  chain: 'base',    // DexScreener chain slug
  chainId: 8453,    // EVM chain id

  // The block $BLUE launched at. The chain scan starts here; nothing relevant
  // happened before it. Two independent sources agree on it: the platform's
  // /api/coins block_number, and a timestamp search for the pool's own
  // pairCreatedAt (2026-09-06T20:33:39Z).
  launchBlock: 50968736,

  /* How the reward token is recognised among everything that touches the
     distributor. Matched case-insensitively against each token's own symbol(),
     because raw amounts cannot tell them apart: a distributor sees the trading
     token's large flows beside $AMZN's fractional ones, and picking the larger
     put 7,205,199 on a tile whose true figure was a fraction of one.

     Matched as a substring, because a platform's wrapper often decorates the
     ticker it wraps — $BOX's reward token answers "AMZNc", not "AMZN", and an
     exact comparison would have missed it. Here symbol() reads exactly
     "STONKEX", verified on chain. */
  rewardTokenSymbol: 'STONKEX',

  /* Holders' share of what leaves the rewards index — the rest is the
     protocol's cut, so the outflow is NOT the distributed figure on its own.
     VERIFIED against $BLUE's own Stockify panel ("TO HOLDERS 90% · 10%
     protocol · 0% creator"), whose published totals match this site's to the
     decimal: 83,722.09 STONKEX collected, 75,349.88 paid to holders, which is
     exactly 0.9 of it. The full comparison is in worker/src/config.js. */
  holderShare: 0.9,

  /* Related contracts.
       pool         the trading pair — DexScreener is asked about THIS pool
                    first, and only falls back to searching by token address
       rewardPool   the reward token's own pair, used to price it
       feeLocker    where trading fees accrue
       rewardsIndex the distributor holders are paid from

     All optional. `pool` is read on every load and DexScreener is asked about
     it BEFORE it searches by token address — so a wrong pool here silently
     reports another token's market cap, liquidity and volume. Leave them null
     and the search by contract address is used instead: correct, if slower. */
  contracts: {
    /* The trading pair: BLUE/STONKEX on Uniswap v3. From /api/coins, and
       corroborated by DexScreener, which resolves the same pair from a search
       by contract address alone — and by it being the deepest of the two by
       two orders of magnitude ($16.9k against $67 in the v4 BLUE/USDC pool).
       That depth is why it is named here: DexScreener is asked about THIS
       pool before it searches, so the thin pool would otherwise be a coin
       flip on every load. */
    pool: '0xcb0309312718e7c1a54d4B35Be3726Ee38755B82',
    rewardPool: null,
    /* Where trading fees accrue. SHARED BY EVERY TOKEN on the platform — this
       is byte-for-byte the same locker $BOX uses — so it is never summed:
       doing that reports the whole platform's fees as this token's. */
    feeLocker: '0x71D1D363176723f85d98B8B430DF33cde89f0A7f',
    /* The distributor holders are paid from — per token, and the only one of
       these that is this token's alone. Not derivable on chain: it is a
       routing decision, and /api/fee-routing reports this token's as
       "rewards" with this index. The owner's Stockify panel link names the
       same address. Read by the indexer, not by the page. */
    rewardsIndex: '0x7273A102A1A20dD0eB01C23Ce4b57dAF6160Bf77',
  },

  /* ---- Links ---------------------------------------------------------- */

  links: {
    x: 'https://x.com/BlueBullStonkex',

    // Leave null to auto-build a DexScreener link from the contract address.
    chart: null,

    // The two lockups in the footer panel — both hrefs are written from here.
    launchedIn: 'https://www.thestonks.exchange/token/0x1d0c1bE75f32C1238Da27dBB59d21c7DF8D311B2',
    rewardsBy: 'https://www.stockify.finance/indices/0x7273a102a1a20dd0eb01c23ce4b57daf6160bf77',
  },

  /* ======================================================================
     DATA SOURCES
     Each source fills in the fields it knows about. Later sources win, so
     `rewards` can override anything. Whatever no source provides falls back
     to `stats` below, and anything still missing renders as "—".
     ====================================================================== */

  sources: {

    /* Market cap, liquidity, 24h volume, and the token price.
       Public API, no key, CORS-enabled. */
    dexscreener: {
      enabled: true,
    },

    /* Holder count. DexScreener does not report holders, and no single
       explorer is reliable for a freshly launched token — a zero usually means
       "not indexed yet" rather than "no holders".

       So the providers below are tried IN ORDER and the first one to return a
       count above zero wins. A zero is treated as "no answer" and falls through
       to the next provider: a launched token with liquidity cannot have none.
       Run the page with ?debug=1 to see which provider answered.

         blockscout     — base.blockscout.com. Free, no key. Often has not
                          indexed a token in its first days.
         geckoterminal  — free, no key. Only has a count for tokens it indexes.
         etherscan      — Etherscan V2 multichain. Needs `etherscanApiKey`, and
                          its tokenholdercount action requires a PAID plan.
         moralis        — needs `moralisApiKey`; the free tier is enough.

       Providers without a key are skipped, so the key-free ones are tried first
       and the rest only engage once you fill a key in.

       ▸ The reliable answer is the indexer in worker/: it counts holders from
         the token's own transfer history, so it needs no explorer at all. Once
         it is deployed and synced it supplies `holders` through sources.rewards
         and this whole chain becomes a fallback.

       Set `enabled: false` to stop fetching holders here entirely. */
    holders: {
      enabled: true,

      /* `onchain` ALONE, deliberately. It folds the token's own Transfer logs
         into balances, exactly as the indexer does, so it is right by
         construction rather than by an explorer's luck. The explorer providers
         below still work — add 'blockscout', 'geckoterminal', 'etherscan' or
         'moralis' here to chain them — but on a freshly launched token they
         are worse than nothing: for $BOX, GeckoTerminal answered 21 against a
         project that had made 365 wallet payments, and Blockscout 500s on a
         token that new. If no RPC answers, the tile shows a dash, which beats
         a confident wrong number. */
      providers: ['onchain'],

      onchain: {
        /* Tried in order; the first to answer runs the whole scan, since
           public nodes differ in how wide a getLogs range they allow and
           swapping mid-scan would make the chunk size meaningless. All three
           are public, keyless and CORS-enabled. */
        /* Seven, because a public endpoint's bad minute should not be the
           dashboard's bad day. Observed in a real browser: mainnet.base.org
           answers 500 under a sustained scan and publicnode answers 403 —
           between them they ended a scan that was 94% complete while a third
           URL sat unused. The scan moves down this list on any refusal and
           carries on from the same block. */
        rpcUrls: [
          'https://mainnet.base.org',
          'https://base.drpc.org',
          'https://base-mainnet.public.blastapi.io',
          'https://base.meowrpc.com',
          'https://1rpc.io/base',
          // Last two: observed refusing a browser outright rather than being
          // busy — publicnode with a 403, llamarpc with no CORS header at all.
          // Kept as a final resort, but they should not cost a probe first.
          'https://base-rpc.publicnode.com',
          'https://base.llamarpc.com',
        ],

        // Defaults to CFG.launchBlock; set it here to scan a shorter window.
        startBlock: null,

        chunkSize: 10000,      // halves itself when a window is refused, and
                               // climbs back after a few clean ones
        /* How small a window may get before the scan gives up on the node
           instead. 1,000 was not small enough: one dense stretch of $BOX
           trading refused at every size down to it, on all seven endpoints,
           and the cursor stopped there permanently — the scan never reached
           the head again, so nothing was ever published and the reward tiles
           served whatever the last completed scan had cached. */
        minChunkSize: 200,
        confirmations: 5,      // stay clear of a reorg

        /* A page load spends at most this many requests, banks what it
           scanned in localStorage, and the next load resumes. The count is
           published only once the scan reaches the head: a partial fold has
           seen sends whose receives are in unread blocks, so it under-counts.
           ~200k blocks at 10k a request is ~20, well inside this. */
        maxCallsPerLoad: 200,

        /* The cost of a first scan grows with the token's history — roughly
           43k blocks a day on Base, so ~20 requests a fortnight at the chunk
           size above. Cached per browser, so it is paid once and then only
           the new blocks are read. Each window asks three questions — the
           token's transfers, and the reward token in and out of the rewards
           index — so it spends three of these per window, but they go out
           together and cost one round trip. */

        // Defaults to contracts.pool, feeLocker and rewardsIndex — they hold
        // supply without being holders.
        exclude: null,

        /* Fallbacks for the fee/payout queries, tried only if this node
           refuses eth_getLogs without an `address` — plenty of public ones do.
           The unfiltered query is the better question, because it reports
           whichever token actually moved rather than trusting a guess, so
           these exist purely to survive a node that will not answer it.
           rewardTokenAddress is tried first, then these in order. */
        feeTokenCandidates: [
          // ⚠ $BLUE's own Stockify index address goes here once known. Leaving
          // another token's in would ask a node about the wrong contract.
        ],
      },

      blockscoutBase: 'https://base.blockscout.com',
      geckoterminalBase: 'https://api.geckoterminal.com/api/v2',
      etherscanApiKey: '',
      moralisApiKey: '',
    },

    /* Rewards figures — total fees collected and total rewards distributed.
       These are protocol numbers, so no explorer has them.

       Three ways to feed them, in rising order of effort:
         1. edit data/rewards.json by hand
         2. run the "Index rewards" workflow (scripts/index-rewards.mjs), which
            sums transfers on Base and rewrites that file on a schedule
         3. deploy worker/ (a Cloudflare Worker serving the same shape) and put
            its URL first in `url`, with the committed file as the fallback

       `fields` maps our metric names onto whatever shape the response has.
       Values are dot-paths, so 'data.stats.totalFeesUsd' works; the first path
       that resolves to a number wins, so usually you just add yours to the
       front of a list.

       A remote endpoint must send permissive CORS headers, since the browser
       calls it directly. If it doesn't, proxy it from your own domain.

       NOTE: this source is merged LAST, so anything it returns overrides
       DexScreener. Leaving stale figures in data/rewards.json while this is
       enabled will quietly override the live market cap, liquidity and volume.
    */
    rewards: {
      /* On, but the file is empty: the page reads these off the chain now, and
         this source is the fallback for when no RPC answers plus the channel
         scripts/index-rewards.mjs publishes through. A completed chain scan
         outranks it either way. */
      enabled: true,

      // A string, or an array of them — the first source with a number for a
      // metric wins, so put live endpoints in front of the committed file:
      //   url: ['https://<your-worker>.workers.dev', 'data/rewards.json'],
      url: 'data/rewards.json',

      fields: {
        totalFeesCollected: [
          'totalFeesCollected', 'totalFeesUsd', 'feesCollectedUsd', 'fees.totalUsd',
          'data.totalFeesCollected', 'stats.totalFeesCollected',
        ],
        totalFeesTokens: ['totalFeesTokens', 'feesTokens', 'data.totalFeesTokens'],
        totalDistributed: [
          'totalDistributed', 'totalRewardsDistributed', 'rewardsDistributed',
          'data.totalDistributed', 'stats.totalDistributed',
        ],
        totalDistributedUsd: [
          'totalDistributedUsd', 'totalRewardsDistributedUsd', 'rewardsDistributedUsd',
          'data.totalDistributedUsd', 'stats.totalDistributedUsd',
        ],
        holders: [
          'holders', 'holderCount', 'totalHolders', 'data.holders', 'stats.holders',
        ],
        marketCap: ['marketCap', 'marketCapUsd', 'data.marketCap'],
        liquidity: ['liquidity', 'liquidityUsd', 'data.liquidity'],
        volume24h: ['volume24h', 'volume24hUsd', 'volumeUsd24h', 'data.volume24h'],
      },
    },
  },

  // How often to refresh, in seconds. 0 disables auto-refresh.
  refreshSeconds: 60,

  /* ---- Fallbacks ------------------------------------------------------ */
  // Used only where no source supplies a value. Leave a field null and the
  // tile shows "—" rather than a number that isn't real.

  stats: {
    totalFeesCollected: null,
    totalFeesTokens: null,
    totalDistributed: null,
    totalDistributedUsd: null,
    holders: null,
    marketCap: null,
    liquidity: null,
    volume24h: null,
  },

};
