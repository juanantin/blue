#!/usr/bin/env node
/* ==========================================================================
   panel-probe.mjs — what the platform itself publishes for this token.

   The indexer's three totals are only as good as two assumptions nobody can
   check from a chain scan alone:

     · that reward-token inflow to the rewards index is "fees collected", and
       its outflow is what holders are paid from
     · HOLDER_SHARE — the slice of that outflow which actually reaches
       holders, the rest being the protocol's cut

   Both are settings on the platform's own panels, and both are per token, so
   a sibling token's answer is a guess. This loads those panels in a real
   browser and prints their visible text, so the figures the site publishes
   can be reconciled against the figures their source publishes BEFORE either
   is announced.

     node scripts/panel-probe.mjs

   Needs network, so it runs from .github/workflows/probe.yml. Everything is
   best-effort: these are third-party pages that can change shape, and a
   layout this cannot read is a reason to go and look by hand, not a failure
   of the site.
   ========================================================================== */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function siteConfig() {
  const src = readFileSync(path.join(ROOT, 'config.js'), 'utf8');
  const window = {};
  new Function('window', src)(window);
  return window.SITE_CONFIG || {};
}

const CFG = siteConfig();
const published = JSON.parse(readFileSync(path.join(ROOT, 'data/rewards.json'), 'utf8'));
const WAIT = Number(process.env.WAIT_MS || 45000);

const TARGETS = [
  ['stockify (rewards index)', CFG.links?.rewardsBy],
  ['thestonks (launch page)', CFG.links?.launchedIn],
].filter(([, url]) => url);

/* How much of the page to print. Filtering to "interesting" lines was the
   first attempt and it failed at the only job that matters: these panels put
   a label and its figure in separate elements, so a keyword filter kept
   "PAID TO HOLDERS" and dropped the number underneath it. The split was
   readable; the totals, which are the thing being reconciled, were gone.
   Order carries the meaning here, so the text is printed as it stands and the
   reader does the pairing. */
const MAX_LINES = Number(process.env.MAX_LINES || 140);

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });

console.log('=== panel probe =========================================');

for (const [label, url] of TARGETS) {
  console.log(`\n--- ${label} ---\n${url}`);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: WAIT });
    // These are client-rendered apps: the markup arrives long before the
    // figures do, so settle on the network rather than on the document.
    await page.waitForLoadState('networkidle', { timeout: WAIT }).catch(() => {});
    await page.waitForTimeout(6000);

    const text = await page.evaluate(() => document.body.innerText || '');
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
      .map((l) => (l.length > 160 ? l.slice(0, 157) + '…' : l));
    if (!lines.length) {
      console.log('  (the page rendered nothing — check it by hand)');
    } else {
      for (const l of lines.slice(0, MAX_LINES)) console.log('  ' + l);
      if (lines.length > MAX_LINES) console.log(`  … ${lines.length - MAX_LINES} more lines`);
    }
  } catch (e) {
    console.log(`  FAILED ${e.message}`);
  }
}

await browser.close();

/* Printed last, and deliberately side by side: the point is not the numbers
   but the comparison, and a reader should not have to scroll between them. */
console.log('\n--- what this site publishes ----------------------------');
console.log(`  fees collected      ${published.totalFeesTokens} ${CFG.rewardTokenSymbol}` +
            `  ($${published.totalFeesCollected})`);
console.log(`  distributed         ${published.totalDistributed} ${CFG.rewardTokenSymbol}` +
            `  ($${published.totalDistributedUsd})`);
console.log(`  holders             ${published.holders}`);
console.log(`  holderShare applied ${CFG.holderShare}   ← the assumption to check above`);
console.log(`  synced              ${published.meta?.synced}  at ${published.updatedAt}`);
console.log('\nIf the panel\'s split is not ' + CFG.holderShare +
            ', "distributed" is wrong by exactly that ratio.');
console.log('=========================================================');
