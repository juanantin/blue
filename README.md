# The Stonkex Bull — $BLUE

Single-page site for $BLUE: a looping banner, a live dashboard, and an
ecosystem footer. Static HTML/CSS/JS — no build step, no dependencies, no
framework.

Copied from [`juanantin/box`](https://github.com/juanantin/box) and re-pointed.
Where a lesson below is written in $BOX's numbers, those numbers are the
evidence — the behaviour they describe is the platform's, not that token's.

The token is set in `config.js`; [`SETUP.md`](SETUP.md) is the checklist for
pointing the site at a different one, and for the pieces that still need
feeding (the X handle, and the fees/rewards figures).

```
index.html            markup
config.js             ← the only file you need to edit to point it at a token
assets/css/styles.css
assets/js/app.js
images/               branding — the mark, the banner clip and its poster
images/src/           the originals everything above is derived from
data/rewards.json     protocol figures the dashboard reads
scripts/              GitHub Actions indexer
worker/               the same indexer as a Cloudflare Worker (optional)
```

## What's on the page

- **Hero** — the banner clip, looping silently, carrying the wordmark. There is
  no separate top bar, so the page opens on the artwork; the `<h1>` behind it is
  screen-reader only. The poster is the clip's own first frame, so poster →
  playback is seamless. Viewers with `prefers-reduced-motion: reduce` get the
  poster as a still and the video never downloads.
- **Actions** — three buttons under the banner: X, the chart, and a button that
  copies the CA to the clipboard and flashes a `Copied!` confirmation beneath
  itself.
- **Dashboard** — six live cards: total fees collected, total $STONKEX
  distributed (tokens, with the USD figure beneath), number of holders, market
  cap, liquidity and 24h volume. Money carries cents, counts do not. Values blink a
  `…` placeholder until the first load resolves.
- **Token facts** — supply, network and token symbol. Fixed properties, so they
  are written in the markup rather than fetched.
- **Ecosystem** — a panel holding two partner lockups, each one a link whose
  href comes from `config.js`.

## Design

One face — **Inter**, from Google Fonts — across four weights: the design
separates label from figure by weight and colour, so 400 through 700 all have
to be loaded.

The whole page sits on the banner's own near-white. `--page` is sampled from
the clip, which is what lets the hero run flush at the top with no seam;
resample it if you swap the banner. The only accent is `--accent`, the bull's
own blue, and every card icon rides in an `--accent-soft` disc so the six read
as one set. The isometric cubes behind everything are an inline SVG background
tile — drawn rather than shipped, so they stay crisp at any zoom and cost no
request, and they happen to echo the voxel artwork exactly.

Card icons are inline SVG on a shared stroke spec. Base keeps its own blue,
being a network mark rather than part of the set.

Light theme only, by design — the artwork is built for a bright light ground.

## Data sources

Everything configurable lives in `config.js`. Each source fills in the fields it
knows about and they merge in order, so a later source overrides an earlier one.
Whatever no source provides falls back to `stats`, and anything still missing
renders as `—` rather than as a number that isn't real.

| Metric | Source | Status |
|---|---|---|
| Market cap, liquidity, 24h volume | DexScreener | live, no key |
| Holders | Blockscout → GeckoTerminal → … | live, no key |
| Total fees collected | the indexer (see below) | live, scheduled |
| Total rewards distributed | the indexer (see below) | live, scheduled |

### Market data — DexScreener

The configured pool is queried first — `GET /latest/dex/pairs/base/<pool>` —
falling back to the token search, `GET /latest/dex/tokens/<contract>`. Public,
no key, CORS-enabled.

Pool-first matters when a token trades against something other than a usual
quote: the token search can come back empty for a pair like that while the pool
itself resolves fine. **The corollary is a trap** — a stale or wrong pool
address silently reports another token's market cap, liquidity and volume, and
the contract address above it makes no difference. Leave `contracts.pool` null
until you are sure of it.

Of any list of pairs, the deepest-liquidity one on `chain` wins; `marketCap` is
preferred over `fdv`. Override the pool with `sources.dexscreener.pairAddress`.

### Holders

DexScreener does not report holder counts, and no explorer is dependable for a
freshly launched token — for $BOX, GeckoTerminal answered 21 against a project
that had made 365 wallet payments, and Blockscout returned 500s. So the default
provider is **`onchain`**, which does not ask anyone: it folds the token's own
`Transfer` logs into a balance per address in the browser, exactly as the
indexer does, and counts the addresses left holding something, less the pool,
the fee locker and the rewards index.

That scan is budgeted and cached. A load spends at most `maxCallsPerLoad`
requests against the first RPC in `onchain.rpcUrls` that answers, banks its
progress in `localStorage`, and the next load resumes. **The count is published
only once the scan reaches the head** — a partial fold has seen sends whose
matching receives are in unread blocks, so it under-counts, and a dash beats a
wrong number. `holders` from `data/rewards.json` is merged last and wins, so
running the indexer retires the client-side scan without a config change.

The explorer providers below still work and can be chained after it by listing
them in `sources.holders.providers`. They are tried **in order**, and the first
to return a count above zero wins:

| Provider | Key | Notes |
|---|---|---|
| `blockscout` | none | `base.blockscout.com`. Reads `holders_count`, `holders`, then `token_holders_count` on `…/counters` |
| `geckoterminal` | none | Token info route. Only has a count for tokens it has indexed |
| `etherscan` | `etherscanApiKey` | Etherscan V2 multichain. Its `tokenholdercount` action needs a **paid** plan |
| `moralis` | `moralisApiKey` | Free tier is enough |

**A zero is treated as no answer** and falls through to the next provider — a
launched token with liquidity cannot have zero holders, so a zero is an
un-indexed explorer, not data. Providers with no key configured are skipped, so
the two key-free ones run first and the rest only engage once you add a key.

**The dependable answer is the indexer, not any explorer.** It counts holders
from the token's own transfer history — every transfer folded into a running
balance per address, then addresses with a positive balance counted, with the
pool and fee contracts excluded. Once it is running it supplies `holders` and
this chain becomes a fallback. The count is withheld until the backfill
finishes, since a partial scan under-counts.

Run with `?debug=1` to see which provider answered.

### Rewards — feeding fees and distribution

Fees collected and rewards distributed are protocol figures. No explorer knows
them, so they have to be fed in. Three ways, cheapest first.

**1. Edit the committed file.** `sources.rewards.url` already points at
`data/rewards.json`. Put numbers in it, push, done — same origin, no CORS, no
infrastructure:

```json
{ "totalFeesCollected": 1284.37, "totalDistributed": 8412906.5 }
```

Leave `totalDistributedUsd` out and it is derived from the live reward-token
price. Any field left `null` shows as an em dash, so the file is safe to publish
half-filled. Fine for a launch; it is a manual number, so it goes stale between
pushes. Set `sources.rewards.enabled: true` once the file holds real figures.

> **Watch the merge order.** This source is merged **last**, so anything it
> returns overrides DexScreener. Stale figures here will quietly override the
> live market cap, liquidity and volume — which is why it ships disabled.

**2. Let GitHub Actions index it — no accounts, no infrastructure. This is
what $BLUE runs.**
[`.github/workflows/index-rewards.yml`](.github/workflows/index-rewards.yml)
runs [`scripts/index-rewards.mjs`](scripts/index-rewards.mjs), scans Base, and
commits the refreshed `data/rewards.json` — the file the site already reads. It
counts holders too, so that stops depending on explorers.

Fill in `worker/src/config.js` first (`TOKENS`, `CONTRACTS`, `START_BLOCK`,
both decimals) — `scripts/index-rewards.mjs` refuses to scan while that file's
`MISSING` list is non-empty, because a run against an unset index commits nulls
every quarter hour and the page cannot tell that from being broken.

State lives in `data/rewards-state.json`, which is **committed and seeded with
`cursor` = `START_BLOCK`**. That file is the only thing carrying a backfill
between runs — Actions runners are ephemeral — and `loadState()` falls back to
`START_BLOCK` only when it is *absent*, so a templated `cursor: 0` in a present
file is read as gospel and scans Base from genesis.

The schedule runs four times an hour, off the :00/:15/:30/:45 boundary where
GitHub's scheduler is most oversubscribed. Optionally set an `RPC_URL` secret
to a private Base endpoint — the public one works but rate-limits, which only
means the backfill takes longer.

**3. Or run it as a Cloudflare Worker — [`worker/`](worker/).** Same scan logic,
serving over HTTP instead of committing a file. Better if you want sub-minute
freshness or would rather not commit state to the repo.

It scans `eth_getLogs` for reward-token Transfer events, filtered by
counterparty, from `START_BLOCK` forward — so the range is bounded, not all of
chain history. Only the standard Transfer event is used, so none of it needs the
distributor's ABI. Deploy instructions, routes and tests are in
[`worker/README.md`](worker/README.md). Once it is up:

```js
url: ['https://<your-worker>.workers.dev', 'data/rewards.json'],
```

**Verify the streams before you trust them.** Which on-chain flow is "fees
collected" and which is "distributed" differs per platform, and two mistakes are
easy to make: watching a fee locker that every token on the platform shares
(which sums the whole platform, not you), and treating everything leaving the
distributor as "distributed" when part of it is the protocol's cut.
`HOLDER_SHARE` in `worker/src/config.js` carries that split. Compare `/debug`
against whatever panel the platform publishes before going live.

And check the distributor on Basescan first: if it is verified and exposes a
cumulative total as a view function, one `eth_call` replaces the whole log scan.

### Verifying from a sandbox with no network

The changes here are written somewhere with no route to Base, DexScreener or
the deployed site, so nothing can be confirmed locally. Two workflows exist to
ask a machine that does have a route:

| Workflow | Asks |
|---|---|
| [`discover.yml`](.github/workflows/discover.yml) | what the chain and the platform say this token IS — pool, reward token, decimals, launch block, fee routing |
| [`probe.yml`](.github/workflows/probe.yml) | what the PAGE does with that — the committed site in a real browser, as a returning visitor, as a cold phone, and against the deployed URL |

Both run on a push to the paths they watch, because `workflow_dispatch` needs
a permission the automation token does not carry. Their summaries print **last**:
job logs come back as a tail, and the browser passes are thousands of lines of
retry noise.

### Debugging

Append `?debug=1` to the URL. A panel under the dashboard lists every source and
what it returned, and the same detail goes to the console:

```
✓ ok     dexscreener:token:0x…
· empty  holders:blockscout
✓ ok     holders:blockscout:counters
```

Reading it:

- **`Failed to fetch`** — CORS, a blocked host, or the page opened over `file://`.
  Serve it over `http://` (see Running it) rather than double-clicking the file.
- **`HTTP 404`** — wrong address or route.
- **`ok, empty`** — the request worked but that source has nothing for this
  token; the next fallback takes over.

If a card shows `—`, no source produced a number for it. That is the intended
behaviour, not a bug: nothing invented is shown as real.

`refreshSeconds` controls the poll interval (default 60).

## Deploying

**This site deploys to Vercel** — no framework preset, no build command, the
repo root as output. Any static host would work, but two details are not
optional wherever it lands, and both are in `vercel.json`:

- **`index.html` must send `Cache-Control: must-revalidate`.** It carries the
  `?v=` cache-busters below, so a cached shell pins a visitor to an old build:
  the busting scheme only works if the document naming the versions is itself
  fresh. `data/rewards.json` is the same — it is the file the dashboard reads.
- **`vercel.json` takes headers and nothing else.** It rejects unknown
  top-level keys, and a `"//"` comment key once failed every production deploy
  for eighteen hours while the data behind it updated perfectly. Validate the
  key names, not just that the JSON parses.

`index.html` loads `config.js` and `app.js` with a `?v=` cache buster, and
`config.js` carries a matching `version`. **Run `node scripts/stamp.mjs` before
every deploy** — it moves all of them together. Skip it and a CDN keeps serving
the previous JS for hours after the HTML updates, which looks exactly like a
push that never landed.

To check what a browser actually has, load the site with `?debug=1`: the first
line of the panel is the build stamp. If it is not the version you just pushed,
the problem is the deploy or a cache, not the code — hard-refresh, purge the
CDN, and confirm the host is building the right branch.

## Running it

```bash
python3 -m http.server 8000
```

then open <http://localhost:8000>. (Clipboard copy needs `https://` or
`localhost`; the page falls back to `execCommand` elsewhere.)

The worker's tests need no network:

```bash
cd worker && npm test
```

## Notes

- `favicon.ico`, `images/apple-touch-icon.png` and the two `icon-*.png`
  manifest icons are all generated from `images/src/bull_mark.png`, **cropped
  to the bull's head** and padded back to a square. The full artwork is a bull
  in a field of floating cubes, which at 16px is a smudge; the head with its
  white horns still reads. The apple-touch one is flattened onto white, because iOS
  renders a transparent home-screen icon as black. Bump the `?v=` on the icon
  links when the mark changes, so browsers drop the cached one.
- `favicon.ico` sits at the repo root because browsers request `/favicon.ico` on
  their own, whatever the `<link>` tags say.
- The hero clip is `images/blue_banner.mp4`, 960×304 and audio-stripped — the
  track is dead weight on a muted, looping video, and dropping it with a CRF
  re-encode took the file from 3.3 MB to 0.9 MB. Its ratio is encoded twice:
  the `width`/`height` on the `<video>` and the hero's `aspect-ratio` in the
  stylesheet. Change both if your banner has a different shape, or
  `object-fit: cover` will crop it silently.
- `images/src/` keeps the delivered originals and the commands that derive
  every served file from them, so the poster can be re-cut without going back
  to whoever made the clip.
- The three action buttons stay on one line down to 320px, shedding padding and
  type size as they go; below 620px the cards drop to one per row and the hero
  runs edge to edge, overscanning the banner's own margins by 3% a side so it
  reads as large as the screen allows.
