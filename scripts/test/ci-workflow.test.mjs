// Spec 011 (research R13): the pull request check's workflow is configuration whose mistakes
// (a wrong trigger, a write permission, a step missing from the local command) fail no other
// test, so its shape is asserted here. Run by the root `npm test` through `node --test`.
// Spec 022 (research R11): a second job, `e2e`, runs the browser tests beside `test`.
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

function steps(workflow, job = 'test') {
  return workflow.jobs[job].steps;
}

const JOBS = ['test', 'e2e'];

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

test('the workflow has only name, on, permissions, concurrency, and jobs: no workflow-wide env or defaults (R13)', () => {
  assert.deepEqual(Object.keys(readWorkflow()), [
    'name',
    'on',
    'permissions',
    'concurrency',
    'jobs',
  ]);
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

test('two jobs, test and e2e, each on ubuntu-24.04 with a 30-minute limit (011 R2, R17, R18; 022 R11)', () => {
  const workflow = readWorkflow();
  assert.deepEqual(Object.keys(workflow.jobs), JOBS);
  for (const name of JOBS) {
    assert.equal(workflow.jobs[name]['runs-on'], 'ubuntu-24.04', `job ${name}`);
    assert.equal(workflow.jobs[name]['timeout-minutes'], 30, `job ${name}`);
  }
});

for (const job of JOBS) {
  test(`${job}: only GitHub's own actions; checkout keeps no credentials; Node from .nvmrc with the npm cache (R2, R3)`, () => {
    const all = steps(readWorkflow(), job);
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

  test(`${job}: every run step is named, and the first one is npm ci (R3, R4)`, () => {
    const runSteps = steps(readWorkflow(), job).filter((step) => step.run !== undefined);
    for (const step of runSteps) {
      assert.ok(step.name, `run step without a name: ${step.run}`);
    }
    assert.equal(runSteps[0]?.run, 'npm ci');
  });
}

test('the test job is exactly checkout, setup-node, then named run steps, none skippable or allowed to fail (FR-004, R3, R4)', () => {
  const job = readWorkflow().jobs.test;
  assert.deepEqual(Object.keys(job).sort(), ['runs-on', 'steps', 'timeout-minutes']);
  const all = job.steps;
  assert.match(all[0]?.uses ?? '', /^actions\/checkout@/);
  assert.match(all[1]?.uses ?? '', /^actions\/setup-node@/);
  for (const [index, step] of all.entries()) {
    const label = step.name ?? step.uses ?? step.run;
    const allowed = index < 2 ? ['name', 'uses', 'with'] : ['name', 'run'];
    for (const key of Object.keys(step)) {
      assert.ok(allowed.includes(key), `step ${index} (${label}) has key ${key}`);
    }
    if (index >= 2) assert.equal(typeof step.run, 'string', `step ${index} (${label}) has no run`);
  }
  const runSteps = all.filter((step) => step.run !== undefined);
  assert.equal(all.length, 2 + runSteps.length);
});

test('the e2e job is checkout, setup-node, npm ci, npm run e2e, then the failure upload; nothing may fail or be skipped (022 R11, FR-009)', () => {
  const job = readWorkflow().jobs.e2e;
  assert.deepEqual(Object.keys(job).sort(), ['runs-on', 'steps', 'timeout-minutes']);
  const all = job.steps;
  assert.equal(all.length, 5);
  assert.match(all[0]?.uses ?? '', /^actions\/checkout@/);
  assert.match(all[1]?.uses ?? '', /^actions\/setup-node@/);
  assert.deepEqual(
    all.filter((step) => step.run !== undefined).map((step) => step.run),
    ['npm ci', 'npm run e2e'],
  );
  for (const [index, step] of all.slice(0, 4).entries()) {
    const label = step.name ?? step.uses ?? step.run;
    const allowed = index < 2 ? ['name', 'uses', 'with'] : ['name', 'run'];
    for (const key of Object.keys(step)) {
      assert.ok(allowed.includes(key), `step ${index} (${label}) has key ${key}`);
    }
  }
  // The one conditional step: a failing run keeps its report, traces, screenshots, and logs.
  const upload = all[4];
  assert.match(upload.uses ?? '', /^actions\/upload-artifact@v\d+$/);
  assert.ok(upload.name, 'the upload step has no name');
  assert.equal(upload.if, 'failure()');
  assert.deepEqual(Object.keys(upload).sort(), ['if', 'name', 'uses', 'with']);
  assert.deepEqual(
    String(upload.with?.path ?? '')
      .split('\n')
      .map((p) => p.trim())
      .filter(Boolean),
    ['e2e/playwright-report', 'e2e/test-results'],
  );
  assert.equal(upload.with?.['retention-days'], 14);
  assert.ok(upload.with?.name, 'the artifact has no name');
});

test('the e2e job uses the same checkout and setup-node versions as test (022 R11)', () => {
  const workflow = readWorkflow();
  const version = (job, action) =>
    steps(workflow, job).find((step) => step.uses?.startsWith(`actions/${action}@`))?.uses;
  for (const action of ['checkout', 'setup-node']) {
    assert.equal(version('e2e', action), version('test', action), action);
  }
});

test('the workflow uses no secret and no token (R15)', () => {
  const text = readWorkflowText();
  assert.ok(!text.includes('secrets.'), 'the workflow references secrets.');
  assert.ok(!text.includes('github.token'), 'the workflow references github.token');
});

function readPackageJson(...segments) {
  return JSON.parse(readFileSync(join(ROOT, ...segments, 'package.json'), 'utf8'));
}

test("the backend's pretest generates the Prisma client, so a fresh clone's npm test works (R5)", () => {
  const backend = readPackageJson('backend');
  assert.match(backend.scripts.pretest ?? '', /prisma generate/);
});

function ciScriptParts() {
  const root = readPackageJson();
  assert.ok(root.scripts.ci, 'the root package.json has no ci script');
  return root.scripts.ci.split(' && ');
}

test("the test job's steps after npm ci are exactly the root ci script's parts, in order (R12)", () => {
  const runs = steps(readWorkflow())
    .filter((step) => step.run !== undefined)
    .map((step) => step.run);
  const afterInstall = runs.slice(runs.indexOf('npm ci') + 1);
  assert.deepEqual(afterInstall, ciScriptParts());
});

test('every part of the ci script names an existing script (R12)', () => {
  const rootScripts = readPackageJson().scripts;
  const backendScripts = readPackageJson('backend').scripts;
  for (const part of ciScriptParts()) {
    if (part === 'npm test') continue;
    if (part === 'npm run prisma:generate --workspace @queuepass/backend') {
      assert.ok(backendScripts['prisma:generate'], 'backend has no prisma:generate script');
      continue;
    }
    const match = /^npm run ([\w:-]+)$/.exec(part);
    assert.ok(match, `ci part is neither npm test nor npm run <name>: ${part}`);
    assert.ok(rootScripts[match[1]], `ci part names a missing root script: ${match[1]}`);
  }
});

test("the root test script first deletes old coverage output, so the report reads only this run's (R11)", () => {
  const rootScripts = readPackageJson().scripts;
  assert.ok(
    rootScripts.test.startsWith('node scripts/coverage-report.mjs --clean && '),
    `the root test script starts with: ${rootScripts.test.slice(0, 50)}`,
  );
});
