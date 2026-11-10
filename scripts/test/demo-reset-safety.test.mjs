// Spec 029 FR-003, SC-007 (research R12, tasks T007): nothing that starts the system gives the
// reset's permission or runs it. No Compose file, `.env.example`, or workflow may name either;
// the one place that gives it is scripts/e2e.mjs, for its own throwaway `qpe2e` stack (R13).
// This passes from the start: it guards against a later change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WORKFLOWS = join(ROOT, '.github', 'workflows');

const files = [
  'docker-compose.yml',
  join('e2e', 'stack', 'docker-compose.e2e.yml'),
  '.env.example',
  ...readdirSync(WORKFLOWS).map((f) => join('.github', 'workflows', f)),
];

test('the workflows folder has files to check', () => {
  assert.ok(readdirSync(WORKFLOWS).length > 0);
});

for (const file of files) {
  test(`${file} neither gives QUEUEPASS_ALLOW_RESET nor runs demo-reset`, () => {
    const text = readFileSync(join(ROOT, file), 'utf8');
    assert.equal(text.includes('QUEUEPASS_ALLOW_RESET'), false, `${file} names the permission`);
    assert.equal(text.includes('demo-reset'), false, `${file} runs the reset`);
  });
}

// Code review round 1, n8 (FR-003, R13): the harness gives the permission once, on its exec of the
// reset under its own COMPOSE, the throwaway `qpe2e` project.
test('scripts/e2e.mjs gives the permission only to its reset, under -p qpe2e', async () => {
  const { COMPOSE, PROJECT } = await import('../e2e.mjs');
  assert.equal(PROJECT, 'qpe2e');
  assert.equal(COMPOSE[COMPOSE.indexOf('-p') + 1], PROJECT);
  const text = readFileSync(join(ROOT, 'scripts', 'e2e.mjs'), 'utf8');
  assert.equal(text.split('QUEUEPASS_ALLOW_RESET=1').length - 1, 1, 'one place gives it');
  assert.match(
    text,
    /\[\s*\.\.\.COMPOSE,\s*'exec',\s*'-T',\s*'-e',\s*'QUEUEPASS_ALLOW_RESET=1',\s*'backend',\s*'node',\s*'backend\/dist\/scripts\/demo-reset\.js',?\s*\]/,
  );
});
