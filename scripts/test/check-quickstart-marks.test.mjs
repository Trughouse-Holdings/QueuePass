// Spec 022 (research R10, tasks T004): every quickstart ends with an Automation table, one row per
// scenario heading, and its Automated rows name exactly the browser tests that exist (FR-007,
// FR-008). Proved here on small in-memory inputs; the real files are checked by `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkMarks, scenarioLabels, testTitles } from '../check-quickstart-marks.mjs';

const QS = 'specs/015-seat-holds/quickstart.md';
const SPEC = 'e2e/tests/015-seat-holds.spec.ts';

const quickstart = (body, table) =>
  `# Quickstart\n\n${body}\n${table === undefined ? '' : `\n## Automation\n\n| Scenario | Browser test |\n| --- | --- |\n${table}\n`}`;

const BODY = '## S1: Reserve, then confirm (US1)\n\nSteps.\n\n### S2: Live gray-out\n\nMore.\n';
const CLEAN_TABLE =
  '| S1 | Manual: a timing goal measured with a person |\n| S2 | Automated: `015 S2: live gray-out` |';
const CLEAN_SPEC = "test('015 S2: live gray-out', async ({ page }) => {});\n";

const check = (qsText, specText = CLEAN_SPEC) =>
  checkMarks({
    quickstarts: [{ file: QS, text: qsText }],
    specs: [{ file: SPEC, text: specText }],
  });

test('labels come from level-2 and level-3 headings, a letter or two then digits (R10)', () => {
  const text = [
    '## S1: one',
    '### S1b: a sub-scenario',
    '## V3: three',
    '## F1. dotted',
    '## S10 (optional): ten',
    '#### S4: too deep',
    '# S5: too shallow',
    '## Smoke test',
    '## ABC1: three letters',
    'S6: not a heading',
  ].join('\n');
  assert.deepEqual(scenarioLabels(text), ['S1', 'S1b', 'V3', 'F1', 'S10']);
});

test('test titles are the first arguments of test(\'…\') and test("…"), nothing else', () => {
  const src = [
    "test('001 V3: sign in', async () => {});",
    'test("001 V4: wrong role", async () => {});',
    "test.describe('a group', () => {});",
    "await test.step('a step', async () => {});",
    "test(\n  '003 C1: on a new line',\n  async () => {},\n);",
  ].join('\n');
  assert.deepEqual(testTitles(src), [
    '001 V3: sign in',
    '001 V4: wrong role',
    '003 C1: on a new line',
  ]);
});

test('a clean set passes', () => {
  assert.deepEqual(check(quickstart(BODY, CLEAN_TABLE)), []);
});

test('a quickstart without an Automation table fails, naming the file', () => {
  const problems = check(quickstart(BODY), '');
  assert.equal(problems.length, 1);
  assert.match(problems[0], new RegExp(`^${QS}: .*Automation`));
});

test('a label with no row fails', () => {
  const problems = check(quickstart(BODY, '| S2 | Automated: `015 S2: live gray-out` |'));
  assert.deepEqual(problems.length, 1);
  assert.match(problems[0], /^specs\/015-seat-holds\/quickstart\.md: .*S1.*no row/);
});

test('a row whose label is not a heading fails', () => {
  const problems = check(quickstart(BODY, `${CLEAN_TABLE}\n| S9 | Manual: a stack restart |`));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /S9.*not a scenario heading/);
});

test('a label with two rows fails', () => {
  const problems = check(quickstart(BODY, `${CLEAN_TABLE}\n| S1 | Manual: printing |`));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /S1.*2 rows/);
});

test('an Automated row naming no test fails', () => {
  const problems = check(
    quickstart(
      BODY,
      '| S1 | Automated: `015 S1: reserve, then confirm` |\n| S2 | Automated: `015 S2: live gray-out` |',
    ),
  );
  assert.equal(problems.length, 1);
  assert.match(
    problems[0],
    /^specs\/015-seat-holds\/quickstart\.md: .*015 S1: reserve, then confirm.*no such test/,
  );
});

test('a test title with no Automated row fails, naming the test file', () => {
  const problems = check(
    quickstart(BODY, '| S1 | Manual: printing |\n| S2 | Manual: a stack restart |'),
  );
  assert.equal(problems.length, 1);
  assert.match(
    problems[0],
    /^e2e\/tests\/015-seat-holds\.spec\.ts: .*015 S2: live gray-out.*no Automated row/,
  );
});

test("a test title is looked for in its own feature's quickstart, by its number (FR-003)", () => {
  const problems = checkMarks({
    quickstarts: [
      { file: QS, text: quickstart(BODY, CLEAN_TABLE) },
      {
        file: 'specs/016-per-user-ticket-limit/quickstart.md',
        text: quickstart('## S2: buy', '| S2 | Manual: printing |'),
      },
    ],
    specs: [{ file: SPEC, text: `${CLEAN_SPEC}test('016 S2: the limit', async () => {});\n` }],
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /016 S2: the limit.*no Automated row/);
});

test('a test title that does not start with a feature number fails (FR-003)', () => {
  const problems = check(
    quickstart(BODY, CLEAN_TABLE),
    `${CLEAN_SPEC}test('smoke', async () => {});\n`,
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0], /smoke.*NNN <label>: /);
});

test('Manual: with an empty reason fails', () => {
  const problems = check(
    quickstart(BODY, '| S1 | Manual: |\n| S2 | Automated: `015 S2: live gray-out` |'),
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0], /S1.*reason/);
});

test('a row that is neither Automated nor Manual fails', () => {
  const problems = check(
    quickstart(BODY, '| S1 | maybe later |\n| S2 | Automated: `015 S2: live gray-out` |'),
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0], /S1.*Automated: `<test title>` or Manual: <reason>/);
});

test('a quickstart with no scenario headings takes one row labelled — (T027)', () => {
  assert.deepEqual(
    check(
      quickstart(
        'Just steps.\n\n1. Do this.\n',
        '| — | Manual: no scenarios, only steps run by hand |',
      ),
      '',
    ),
    [],
  );
  const problems = check(quickstart('Just steps.\n', '| — | Manual: |'), '');
  assert.equal(problems.length, 1);
  assert.match(problems[0], /reason/);
});

test('the — row is refused where the quickstart does have scenario headings', () => {
  const problems = check(quickstart(BODY, `${CLEAN_TABLE}\n| — | Manual: nothing |`));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /—.*has scenario headings/);
});

// Review round 1 (S1): a test that walks only part of its scenario says what is left, and why.
test('an Automated row may carry the rest of the scenario as "; rest Manual: <what and why>"', () => {
  const partly =
    '| S1 | Manual: printing |\n| S2 | Automated: `015 S2: live gray-out`; rest Manual: the Admin seat map, by eye |';
  assert.deepEqual(check(quickstart(BODY, partly)), []);
  const empty =
    '| S1 | Manual: printing |\n| S2 | Automated: `015 S2: live gray-out`; rest Manual: |';
  const problems = check(quickstart(BODY, empty));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /S2.*rest Manual.*no reason/);
  const other = '| S1 | Manual: printing |\n| S2 | Automated: `015 S2: live gray-out`; and more |';
  assert.match(check(quickstart(BODY, other)).join('\n'), /S2.*must be Automated/);
});

// Review round 1 (S3): a title in backticks, or on test.only/test.skip, is still a test.
test('test.only, test.skip, test.fixme, and test.fail titles are titles too', () => {
  const src = [
    "test.only('015 S2: only', async () => {});",
    "test.skip('015 S2: skipped', async () => {});",
    "test.fixme('015 S2: fixme', async () => {});",
    "test.fail('015 S2: fail', async () => {});",
  ].join('\n');
  assert.deepEqual(testTitles(src), [
    '015 S2: only',
    '015 S2: skipped',
    '015 S2: fixme',
    '015 S2: fail',
  ]);
});

test('a title in backticks fails, naming the test file', () => {
  const problems = check(
    quickstart(BODY, CLEAN_TABLE),
    `${CLEAN_SPEC}test(\`015 S2: a template\`, async () => {});\n`,
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^e2e\/tests\/015-seat-holds\.spec\.ts: .*backticks/);
});

test("a row's label must be one of the labels its test is named after", () => {
  const body = `${BODY}\n## S3: A pick taken\n`;
  const table = `${CLEAN_TABLE}\n| S3 | Automated: \`015 S2: live gray-out\` |`;
  const problems = check(quickstart(body, table));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /row S3 names "015 S2: live gray-out", a test of S2/);
  const both = `| S1 | Automated: \`015 S1/S2: both\` |\n| S2 | Automated: \`015 S1/S2: both\` |`;
  assert.deepEqual(check(quickstart(BODY, both), "test('015 S1/S2: both', async () => {});\n"), []);
});
