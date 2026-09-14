# Making this yours

This is the checklist for pointing the site at a **different** token. For
$BLUE itself everything below is already done — read it as the record of what
was set and why, or work down it if you are copying this repo the way it was
copied from [`juanantin/box`](https://github.com/juanantin/box).

After step 1 the page is already correct for your token; everything after that
is branding and live figures.

## 0. Let the network answer first

Most of step 1 is discoverable from the contract address alone, and guessing
any of it has a known cost. **Run the discovery workflow before editing
anything:**

```
.github/workflows/discover.yml  →  scripts/discover-token.mjs
```

Push a change to either path and it runs (`workflow_dispatch` needs a
permission not every token carries). From the contract address it reports:

- every DexScreener pair on Base, deepest first — **the pool**
- the deepest pair's other side — **the reward token**
- `symbol()`, `name()`, `decimals()` and `totalSupply()` for both, read off
  chain and each failure labelled, so a throttled call can never be mistaken
  for a reading
- **the launch block**, from a timestamp search for the pool's `pairCreatedAt`
- the platform's own entry for the token: fee locker, launch block, the
  official image and banner, and `/api/fee-routing`'s **rewards index**
- whether a candidate address really is the distributor — set `CANDIDATES` and
  it reports the reward-token flow in and out of it

It prints a paste-ready block at the end. Read the job log with
`get_job_logs`; the summary is deliberately last, because logs come back as a
tail.

Only two things are not discoverable: **`holderShare`**, which is a per-token
setting on the platform's panel, and artwork.

## 1. Addresses and links

`config.js`
- `contractAddress` — **required.** The token people buy: the CA button copies
  it, the chart button links to it, and DexScreener is searched by it. Nothing
  on the dashboard resolves until it is set.
- `rewardTokenAddress` — the token holders are paid in, used to price
  distributed rewards in USD. Leave `null` if there is no separate one.
- `rewardTokenSymbol` — matched as a **substring** against each token's own
  `symbol()`, because platforms decorate the ticker they wrap: $BOX's reward
  token answers `AMZNc`, not `AMZN`. There is no default — with this null the
  configured address is used instead, never a ticker inherited from whatever
  token this repo was copied from.
- `launchBlock` — the chain scan starts here. **Never leave it null and never
  leave a sibling token's block in it**; both mean scanning blocks that have
  nothing to do with this token.
- `contracts.pool` — the trading pair. **Leave it null unless you are certain.**
  DexScreener is asked about this pool *before* it searches by token address,
  so a wrong pool reports another token's market cap, liquidity and volume no
  matter what `contractAddress` says. Name it once you are sure, because the
  search is a coin flip when a token has a deep pool and a dust one.
- `contracts.feeLocker` — **shared by every token on the platform.** It is
  recorded so it can be excluded from the holder count, never summed.
- `contracts.rewardsIndex` — the per-token distributor, and the only one of
  these that is yours. Not derivable on chain.
- `links.x`, `links.launchedIn`, `links.rewardsBy`.
- `holderShare` — **check the token's own Stockify panel.** It is the one
  multiplier between the measured outflow and the figure on the tile.

## 2. Branding

- `images/src/` holds the originals; everything the page serves is derived
  from them, and [`images/src/README.md`](images/src/README.md) carries the
  commands. Keep that arrangement — it is what makes "re-cut the poster" a
  one-liner rather than a request back to the designer.
- `images/favicon.png` and the icons — generated from the mark, **cropped to
  its most recognisable part and padded back to a square**. A full scene
  shrinks to noise at 16px. The apple-touch icon is flattened onto white,
  because iOS renders a transparent home-screen icon as black. Then run
  `node scripts/stamp.mjs`, which moves every `?v=` so browsers drop the
  cached mark.
- The banner clip and its poster — **the poster must be the clip's own first
  frame**, or the hand-off from poster to playback jumps. Strip the audio
  track; the video is muted and looping, so it is dead weight. If your clip is
  not the current 960×304, update the `width`/`height` on the `<video>` in
  `index.html` **and** the hero's `aspect-ratio` in `assets/css/styles.css`:
  the ratio is encoded twice, and `object-fit: cover` crops silently when they
  disagree.
- `assets/css/styles.css` — `--page` is **sampled from the banner's own
  ground**, which is what lets the clip sit flush at the top with no seam.
  Resample it whenever the clip changes. `--accent` and `--accent-soft` are
  the accent and the icon discs.
- `index.html` — `<title>`, the description and OG/Twitter meta, the card
  labels naming the reward token, the three fixed rows in
  `<section class="facts">`, and **the non-affiliation notice in the footer**,
  which has to name whatever this token's artwork might be mistaken for.
  There is no wordmark to change: the banner carries it, and the `<h1>` behind
  it is screen-reader only.
- `site.webmanifest` — `name`, `short_name` and the two colours.
- The two ecosystem lockups at the bottom of `index.html` — swap them if the
  token launched somewhere else, or delete the whole `<section class="eco">`.

## 3. Live figures

Market cap, liquidity, volume and holders come in on their own once
`contractAddress` is set. Fees collected and rewards distributed do not — they
are protocol figures. See **Rewards** in [`README.md`](README.md).

To index them, fill in `worker/src/config.js`:
- `TOKENS` and `CONTRACTS`
- **`START_BLOCK`** — the block the token was deployed in. Left at `0` the
  scan starts at genesis and will never finish.
- **`STR_DECIMALS` and `KEX_DECIMALS`** — read from each contract, and kept as
  two constants even when they agree. $BOX's reward token returns 8 where the
  token itself is 18; sharing one constant there published 25.244695737 as
  2.5244695737e-9 — every digit right, the scale out by ten billion.
- `STREAMS` and `HOLDER_SHARE` encode one assumption: fees arrive at
  `rewardsIndex` in the reward token, and holders receive `HOLDER_SHARE` of
  what leaves it. Check that against the platform's own published figures
  before trusting a single number on the page.

`MISSING` at the top of that file lists whatever is still null, and
`scripts/index-rewards.mjs` refuses to scan while it is non-empty: a run
against an unset index sums nothing and publishes nulls, which on the page is
indistinguishable from a site that is broken.

Then **seed `data/rewards-state.json` with `cursor` = `START_BLOCK` and commit
it.** Two independent failures hide here, and both look identical to a broken
site:

- `loadState()` falls back to `START_BLOCK` only when that file is **absent**.
  A present file carrying a templated `cursor: 0` is read as gospel, and the
  indexer scans Base from genesis — six hundred runs' worth of work before it
  reaches a block that matters. (There is now a clamp against exactly this,
  but the seed is what makes the first run right.)
- It is the **only** thing carrying the backfill between runs, because Actions
  runners are ephemeral. Gitignore it and every run starts over.

The schedule in [`.github/workflows/index-rewards.yml`](.github/workflows/index-rewards.yml)
**is on** — it runs four times an hour, off the :00/:15/:30/:45 boundary where
GitHub's scheduler is most oversubscribed. Comment it out again if you point
this repo at a token whose addresses are not yet filled in.

## 4. Repo settings

- **Deployment is Vercel, not GitHub Pages.** Import the repo as a Vercel
  project: no framework preset, no build command, output is the repo root —
  it is static HTML with no build step. `vercel.json` carries the cache
  headers and **only** headers: that file rejects unknown top-level keys, and
  a `"//"` comment key once failed every production deploy for eighteen hours
  while the data behind it updated perfectly. Validate the key names, not just
  that the JSON parses.
- Set the **`SITE_URL` repository variable** (Settings ▸ Secrets and variables
  ▸ Actions ▸ Variables) to the deployment's public URL. The probe workflow's
  live-site pass skips itself while it is unset, because there is genuinely
  nothing to probe; once set, it is the only pass that proves what a visitor
  is actually served.
- Add an `RPC_URL` secret if you have a private Base RPC. Without it the
  indexer falls back to the public `mainnet.base.org`, which works but
  rate-limits — the backfill just takes more runs.

## 5. Before you announce it

- Run the probe workflow and read all four passes, the live-site one included.
  **A local pass proves the code is right, never that it is live** — that
  distinction hid a broken deploy for a full day on $BOX.
- Load the site with `?debug=1` and read the source panel: every line should
  be `ok`, and any `—` should be a figure you know is not fed yet. The first
  line is the build stamp; if it is not the version you just pushed, the
  problem is the deploy or a cache, not the code.
- Check the CA button copies the full address, and that the chart button opens
  the right token.
- **Reconcile fees, distribution and holders against the platform's own
  panels** before quoting any of them. Do not publish a number you have not
  cross-checked.
