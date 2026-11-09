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
