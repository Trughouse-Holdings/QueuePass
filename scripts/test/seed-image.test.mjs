// Spec 020 (research R1, review round 1 S3): geo-tz (about 72 MB) belongs in the Backend image
// only. The seed image runs `npm ci` in one stage, so it installs only its own workspace (and the
// root), never copies or builds packages/shared (the seed imports nothing from it), and fails
// its build if geo-tz is there anyway. Run by the root `npm test` through `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The Dockerfile's instructions, continuation lines joined, comments dropped. */
function instructions() {
  const text = readFileSync(join(ROOT, 'scripts', 'seed', 'Dockerfile'), 'utf8');
  return text
    .replace(/\\\r?\n/g, ' ')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

const runs = () => instructions().filter((l) => /^RUN\s/i.test(l));

test('npm ci installs only @queuepass/seed and the workspace root', () => {
  const installs = runs().filter((l) => /\bnpm (ci|install|i)\b/.test(l));
  assert.equal(installs.length, 1, installs.join('\n'));
  const words = installs[0].split(/\s+/);
  assert.ok(words.includes('ci'), installs[0]);
  const workspaces = words
    .map((w, i) => (w === '--workspace' || w === '-w' ? words[i + 1] : null))
    .filter(Boolean);
  assert.deepEqual(workspaces, ['@queuepass/seed']);
  assert.ok(words.includes('--include-workspace-root'), installs[0]);
  assert.ok(!words.some((w) => w.startsWith('--workspaces')), installs[0]);
});

test("packages/shared's sources are neither copied nor built", () => {
  for (const line of instructions()) {
    if (/^COPY\s/i.test(line)) {
      const sources = line.split(/\s+/).slice(1, -1);
      for (const source of sources) {
        // Each workspace's package.json is allowed: npm ci checks the lock file against them all.
        if (/package\.json$|package-lock\.json$/.test(source)) continue;
        assert.ok(!source.startsWith('packages/shared'), line);
      }
    }
    assert.ok(!/--workspace @queuepass\/shared/.test(line), line);
  }
});

test('a RUN after npm ci fails the build when node_modules/geo-tz exists', () => {
  const all = runs();
  const install = all.findIndex((l) => /\bnpm ci\b/.test(l));
  const guard = all.findIndex((l) => /test\s+!\s+-e\s+node_modules\/geo-tz\b/.test(l));
  assert.ok(install >= 0, 'no npm ci');
  assert.ok(guard > install, 'no geo-tz guard after npm ci');
});

test('keeps the package.json of every workspace for npm ci (review round 3, q2)', () => {
  const copies = instructions().filter((l) => /^COPY\s/i.test(l));
  for (const ws of ['packages/shared', 'backend', 'admin-app', 'customer-app', 'booth-app']) {
    assert.ok(
      copies.some((l) => l.includes(`${ws}/package.json`)),
      `no COPY ${ws}/package.json`,
    );
  }
});
