// Spec 011 (research R13): the pull request check's workflow is configuration whose mistakes
// (a wrong trigger, a write permission, a step missing from the local command) fail no other
// test, so its shape is asserted here. Run by the root `npm test` through `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { parse } from 'yaml';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WORKFLOW_PATH = join(ROOT, '.github', 'workflows', 'ci.yml');

function readWorkflowText() {
  return readFileSync(WORKFLOW_PATH, 'utf8');
}

function readWorkflow() {
  return parse(readWorkflowText());
}

function steps(workflow) {
  return workflow.jobs.test.steps;
}

test('the workflow is CI, on every pull request open, update, and reopen and every push to main (R1)', () => {
  const workflow = readWorkflow();
  assert.equal(workflow.name, 'CI');
  assert.deepEqual(Object.keys(workflow.on).sort(), ['pull_request', 'push']);
  assert.deepEqual(workflow.on.pull_request.types, ['opened', 'synchronize', 'reopened']);
  for (const filter of ['paths', 'paths-ignore', 'branches', 'branches-ignore']) {
    assert.equal(workflow.on.pull_request[filter], undefined, `pull_request has ${filter}`);
  }
  assert.deepEqual(workflow.on.push.branches, ['main']);
});

test('the token can only read the repository, and no job widens it (R15)', () => {
  const workflow = readWorkflow();
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  for (const [name, job] of Object.entries(workflow.jobs)) {
    assert.equal(job.permissions, undefined, `job ${name} declares permissions`);
  }
});

test('a newer push to a pull request cancels its older run, never on main (R14)', () => {
  const workflow = readWorkflow();
  assert.equal(
    workflow.concurrency.group,
    '${{ github.workflow }}-${{ github.event.pull_request.number || github.sha }}',
  );
  assert.equal(
    workflow.concurrency['cancel-in-progress'],
    "${{ github.event_name == 'pull_request' }}",
  );
});

test('one job, test, on ubuntu-24.04 with a 30-minute limit (R2, R17, R18)', () => {
  const workflow = readWorkflow();
  assert.deepEqual(Object.keys(workflow.jobs), ['test']);
  assert.equal(workflow.jobs.test['runs-on'], 'ubuntu-24.04');
  assert.equal(workflow.jobs.test['timeout-minutes'], 30);
});

test("only GitHub's own actions; checkout keeps no credentials; Node from .nvmrc with the npm cache (R2, R3)", () => {
  const all = steps(readWorkflow());
  const uses = all.filter((step) => step.uses);
  for (const step of uses) {
    assert.ok(step.uses.startsWith('actions/'), `third-party action: ${step.uses}`);
  }
  const checkout = uses.find((step) => step.uses.startsWith('actions/checkout@'));
  assert.ok(checkout, 'no actions/checkout step');
  assert.equal(checkout.with?.['persist-credentials'], false);
  const setupNode = uses.find((step) => step.uses.startsWith('actions/setup-node@'));
  assert.ok(setupNode, 'no actions/setup-node step');
  assert.equal(setupNode.with?.['node-version-file'], '.nvmrc');
  assert.equal(setupNode.with?.cache, 'npm');
});

test('every run step is named, and the first one is npm ci (R3, R4)', () => {
  const runSteps = steps(readWorkflow()).filter((step) => step.run !== undefined);
  for (const step of runSteps) {
    assert.ok(step.name, `run step without a name: ${step.run}`);
  }
  assert.equal(runSteps[0]?.run, 'npm ci');
});

test('the workflow uses no secret and no token (R15)', () => {
  const text = readWorkflowText();
  assert.ok(!text.includes('secrets.'), 'the workflow references secrets.');
  assert.ok(!text.includes('github.token'), 'the workflow references github.token');
});
