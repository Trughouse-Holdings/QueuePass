// Spec 022 (research R10, FR-007, FR-008): every specs/*/quickstart.md ends with an Automation
// table, one row per scenario heading, each Automated (with a browser test's exact title) or
// Manual (with a reason); every test title in e2e/tests has an Automated row in its own feature's
// quickstart, and every Automated row names a test that exists. Run by `npm test`; reads files
// only, so it takes well under a second (FR-015).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

/**
 * A scenario heading: `## S1: …`, `### S1b: …`, `## F1. …`, `## S10 (optional): …`. Research R10's
 * pattern `^#{2,3} ([A-Z]{1,2}\d+)\b` plus an optional lower-case letter, because `012` (S5b) and
 * `013` (S1b, S2b) label sub-scenarios that way (tasks T008, decision recorded there).
 */
const LABEL = /^#{2,3} ([A-Z]{1,2}\d+[a-z]?)\b/;
/** The one row a quickstart with no scenario headings has (tasks T027). */
const NO_SCENARIOS = '—';

/** Scenario labels, in the order their headings appear. */
export function scenarioLabels(markdown) {
  const labels = [];
  for (const line of markdown.split('\n')) {
    const m = LABEL.exec(line);
    if (m) labels.push(m[1]);
  }
  return labels;
}

/** The first argument of every `test('…')` or `test("…")` call: the browser tests' titles. */
export function testTitles(source) {
  const titles = [];
  const call = /(?<![.\w])test\(\s*(['"])((?:\\.|(?!\1)[^\\\n])*)\1/g;
  for (const m of source.matchAll(call)) titles.push(m[2].replace(/\\(.)/g, '$1'));
  return titles;
}

/** The rows of the `## Automation` table, or null when the file has no such section. */
function automationRows(markdown) {
  const lines = markdown.split('\n');
  const start = lines.findIndex((l) => /^## Automation\s*$/.test(l));
  if (start === -1) return null;
  const rows = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,3} /.test(line)) break;
    if (!line.trim().startsWith('|')) continue;
    const cells = line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((c) => c.trim());
    if (cells[0] === 'Scenario' || /^:?-{3,}:?$/.test(cells[0])) continue;
    rows.push({ label: cells[0], mark: cells.slice(1).join('|').trim() });
  }
  return rows;
}

const featureOf = (file) => /(?:^|\/)specs\/(\d{3})-[^/]+\/quickstart\.md$/.exec(file)?.[1] ?? null;

/**
 * The whole check, on in-memory files: `quickstarts` and `specs` are `{ file, text }` with paths
 * relative to the repository root. Returns every problem as `<file>: <problem>`; empty when clean.
 */
export function checkMarks({ quickstarts, specs }) {
  const problems = [];
  const titles = new Map();
  for (const { file, text } of specs) {
    for (const title of testTitles(text)) titles.set(title, file);
  }
  /** feature number → the test titles its quickstart marks Automated. */
  const automated = new Map();

  for (const { file, text } of quickstarts) {
    const say = (problem) => problems.push(`${file}: ${problem}`);
    const labels = scenarioLabels(text);
    const rows = automationRows(text);
    if (rows === null) {
      say('no "## Automation" table at the end (spec 022 research R10)');
      continue;
    }
    const marked = automated.get(featureOf(file)) ?? new Set();
    automated.set(featureOf(file), marked);
    const counts = new Map();
    for (const { label, mark } of rows) {
      counts.set(label, (counts.get(label) ?? 0) + 1);
      if (label === NO_SCENARIOS) {
        if (labels.length > 0)
          say(`row ${NO_SCENARIOS} where the quickstart has scenario headings`);
      } else if (!labels.includes(label)) {
        say(`row ${label} is not a scenario heading in this quickstart`);
      }
      const auto = /^Automated: `([^`]+)`$/.exec(mark);
      const manual = /^Manual:(.*)$/.exec(mark);
      if (auto) {
        marked.add(auto[1]);
        if (!titles.has(auto[1]))
          say(`row ${label} names "${auto[1]}", but there is no such test in e2e/tests`);
      } else if (manual) {
        if (manual[1].trim() === '') say(`row ${label} is Manual with no reason`);
      } else {
        say(`row ${label} must be Automated: \`<test title>\` or Manual: <reason>`);
      }
    }
    for (const [label, n] of counts) {
      if (n > 1) say(`${label} has ${n} rows; each scenario has exactly one`);
    }
    for (const label of labels) {
      if (!counts.has(label)) say(`scenario ${label} has no row in the Automation table`);
    }
    if (labels.length === 0 && !counts.has(NO_SCENARIOS)) {
      say(`no scenario headings, so the table needs one row "| ${NO_SCENARIOS} | Manual: <why> |"`);
    }
  }

  for (const [title, file] of titles) {
    const feature = /^(\d{3}) [A-Z]{1,2}\d+[a-z]?\b[^:]*: ./.exec(title)?.[1];
    if (!feature) {
      problems.push(`${file}: test "${title}" is not named "NNN <label>: <description>" (FR-003)`);
    } else if (!automated.get(feature)?.has(title)) {
      problems.push(
        `${file}: test "${title}" has no Automated row in specs/${feature}-*/quickstart.md`,
      );
    }
  }
  return problems;
}

/** Reads the real files under `root`. */
export function readFiles(root = ROOT) {
  const specsDir = join(root, 'specs');
  const quickstarts = readdirSync(specsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(specsDir, d.name, 'quickstart.md')))
    .map((d) => join(specsDir, d.name, 'quickstart.md'))
    .sort();
  const testsDir = join(root, 'e2e', 'tests');
  const specs = existsSync(testsDir)
    ? readdirSync(testsDir)
        .filter((f) => f.endsWith('.spec.ts'))
        .sort()
        .map((f) => join(testsDir, f))
    : [];
  const read = (path) => ({
    file: relative(root, path).split('\\').join('/'),
    text: readFileSync(path, 'utf8').replace(/\r\n/g, '\n'),
  });
  return { quickstarts: quickstarts.map(read), specs: specs.map(read) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = readFiles();
  const problems = checkMarks(files);
  if (problems.length > 0) {
    for (const p of problems) console.error(p);
    console.error(`[quickstart-marks] ${problems.length} problem(s)`);
    process.exit(1);
  }
  console.log(
    `[quickstart-marks] ${files.quickstarts.length} quickstarts marked; every browser test has its row`,
  );
}
