import { readdirSync, readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import {
  colorAttributeViolations,
  cssViolations,
  inlineStyleViolations,
  sharedClassViolations,
  themeClasses,
  type Violation,
} from './check-theme';

/**
 * Issue #37 (spec 012 FR-005; research R13): the drift scan of one app, so each app's own
 * `npm test` runs it over its own files (`<app>/test/theme-drift.test.ts`), and the shared
 * workspace's `drift.test.ts` runs it over every app (research R6).
 */
export interface SourceFile {
  /** Relative to the repository root, with forward slashes. */
  path: string;
  text: string;
}

/** Every file under `dir` (relative to `root`) ending in one of `exts`, sorted. */
export function filesUnder(root: string, dir: string, exts: string[]): SourceFile[] {
  const abs = resolve(root, dir);
  return (readdirSync(abs, { recursive: true }) as string[])
    .filter((f) => exts.some((e) => f.endsWith(e)))
    .map((f) => relative(root, resolve(abs, f)).replace(/\\/g, '/'))
    .sort()
    .map((path) => ({ path, text: readFileSync(resolve(root, path), 'utf8') }));
}

/** Every rule over the given stylesheets (C1–C7) and screen code (inline, attr). */
export function driftOf(
  classes: ReadonlySet<string>,
  stylesheets: SourceFile[],
  screens: SourceFile[],
): Violation[] {
  return [
    ...stylesheets.flatMap((f) => [
      ...cssViolations(f.path, f.text),
      ...sharedClassViolations(f.path, f.text, classes),
    ]),
    ...screens.flatMap((f) => [
      ...inlineStyleViolations(f.path, f.text),
      ...colorAttributeViolations(f.path, f.text),
    ]),
  ];
}

/** The scan of `<app>/src` against the theme at `packages/shared/src/web/theme.css`. */
export function appDrift(
  root: string,
  app: string,
): { stylesheets: string[]; screens: string[]; violations: Violation[] } {
  const theme = readFileSync(resolve(root, 'packages/shared/src/web/theme.css'), 'utf8');
  const stylesheets = filesUnder(root, `${app}/src`, ['.css']);
  const screens = filesUnder(root, `${app}/src`, ['.tsx']);
  return {
    stylesheets: stylesheets.map((f) => f.path),
    screens: screens.map((f) => f.path),
    violations: driftOf(themeClasses(theme), stylesheets, screens),
  };
}
