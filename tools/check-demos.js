#!/usr/bin/env node
/**
 * tools/check-demos.js — Plays every augment demo (augment-demos.js) through
 * the real engine and fails if any step is rejected, any `expect` doesn't
 * hold, or an augment has no demo at all. Run after changing rules or demos:
 *   node tools/check-demos.js
 */

const { AUGMENTS } = require('../data.js');
const { AUGMENT_DEMOS, buildAugmentDemo } = require('../augment-demos.js');

let failed = 0;
for (const aug of AUGMENTS) {
  if (!AUGMENT_DEMOS[aug.id]) {
    console.log(`✗ ${aug.id}: no demo`);
    failed++;
    continue;
  }
  try {
    const frames = buildAugmentDemo(aug.id);
    console.log(`✓ ${aug.id} (${frames.length} frames)`);
  } catch (err) {
    console.log(`✗ ${aug.id}: ${err.message}`);
    failed++;
  }
}

console.log(failed ? `\n${failed} demo(s) failed.` : `\nAll ${AUGMENTS.length} demos match the engine.`);
process.exit(failed ? 1 : 0);
