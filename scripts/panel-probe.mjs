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

/* Lines worth quoting: a percentage split, a total, a holder count. Printing
   the whole page would bury them — these pages are mostly chrome. */
const INTERESTING = /(\d+\s*%)|holder|distribut|reward|fee|claim|protocol|creator|total|supply|index/i;

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
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const seen = new Set();
    const keep = lines.filter((l) => l.length < 120 && INTERESTING.test(l) && !seen.has(l) && seen.add(l));
    if (!keep.length) {
      console.log('  (nothing matched — the page may not have rendered; check it by hand)');
      console.log('  first lines seen: ' + JSON.stringify(lines.slice(0, 8)));
    } else {
      for (const l of keep.slice(0, 60)) console.log('  ' + l);
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
