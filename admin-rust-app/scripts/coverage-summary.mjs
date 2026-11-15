#!/usr/bin/env node
// Spec 037 (research R9): `cargo llvm-cov --json --summary-only` writes coverage/llvm-cov.json;
// scripts/coverage-report.mjs reads every workspace's coverage/coverage-summary.json in istanbul's
// shape. This converts the one into the other: data[0].totals.lines → total.lines.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export function toIstanbulSummary(llvm) {
  const lines = llvm?.data?.[0]?.totals?.lines;
  if (!lines) throw new Error('coverage-summary: llvm-cov.json has no totals');
  return {
    total: {
      lines: { total: lines.count, covered: lines.covered, skipped: 0, pct: lines.percent },
    },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const coverage = join(dirname(fileURLToPath(import.meta.url)), '..', 'coverage');
  const llvm = JSON.parse(readFileSync(join(coverage, 'llvm-cov.json'), 'utf8'));
  const summary = toIstanbulSummary(llvm);
  writeFileSync(join(coverage, 'coverage-summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`[admin-rust-app] core lines ${summary.total.lines.pct.toFixed(2)}%`);
}
