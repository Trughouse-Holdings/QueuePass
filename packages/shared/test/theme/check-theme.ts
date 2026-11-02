/**
 * Spec 012 (FR-005; research R6): the no-drift checker. Reads plain CSS and the inline `style`
 * objects of screen code, and reports each place an app defines its own look:
 *
 * - C1 a custom property is defined (apps define no theme values);
 * - C2 a color is written out (hex or a color function anywhere; a named color in a color,
 *   background, border, outline, shadow, filter, fill, or stroke property);
 * - C3 a typeface is written out (`font-family` other than a typeface token, `font` other than
 *   inherit);
 * - C4 a corner rounding or shadow has a part that is not 0 (rounding), none (shadow), or one of
 *   the theme's radius or shadow tokens;
 * - C5 padding, margin, a gap, or scroll spacing has a part that is not 0, auto, or one of the
 *   theme's spacing steps;
 * - C6 the faintest gray is used for text;
 * - inline: a `style={{ ... }}` entry that would break any rule above (a number counts as
 *   pixels), or sets a typeface at all.
 *
 * Issue #37 (research R13) added:
 *
 * - C2 also reports a CSS system color (`Canvas`, `CanvasText`, `ButtonFace`, ...) as a named
 *   color (not inside `url()` or a quoted string);
 * - inline also follows a `style` value that is not an object written in place: each branch of a
 *   condition (`c ? {...} : undefined`, `c && {...}`), and a `const` (plain or spread) to the
 *   object it holds, when it is the file's only binding of that name and nothing writes to it.
 *   Any other value (a `let`, a prop, a call) is reported, since it can't be judged. Comments
 *   are not judged;
 * - attr: an SVG color attribute (`fill`, `stroke`, `color`, `stopColor`, `floodColor`,
 *   `lightingColor`, or their hyphenated names) on an element (not a component) is other than
 *   `currentColor`, `none`, `transparent`, `inherit`, or a `url(#...)` paint reference; a spread
 *   of attributes onto an SVG element is reported too;
 * - C7: an app rule whose subject is a class the theme styles (a shared control such as `.btn` or
 *   `.card`) sets a color, typeface, rounding, shadow, or padding: apps place shared controls,
 *   they don't restyle them, even with theme tokens (Constitution VII). Element subjects the
 *   theme styles (`button`, `.topbar button`) are not checked.
 *
 * Declarations are read at any depth, including beside a nested rule, each with the selector of
 * the rule it is in.
 *
 * Spec 021 (research R4): the sign-in look's stylesheet is scanned with `signInAccents`, which
 * allows one thing more: inside a rule whose selector is exactly one `.qp-app--<clientId>` class,
 * the six accent roles may point, with `var()`, at one app's token of the same role
 * (`--accent-hover: var(--accent-booth-hover)`), the same app for every role in the rule, and only
 * when the theme's token blocks define all six of that app's tokens (review round 1, finding 2).
 * Anything else there is still reported.
 */
import ts from 'typescript';

export interface Violation {
  path: string;
  line: number;
  rule: 'C1' | 'C2' | 'C3' | 'C4' | 'C5' | 'C6' | 'C7' | 'inline' | 'attr';
  text: string;
}

interface Declaration {
  line: number;
  prop: string;
  value: string;
  /** The selector (or at-rule prelude) of the innermost enclosing block; '' at the top. */
  selector?: string;
  /** Which block that is: each `{` opens a new one, so two rules with one selector differ. */
  block?: number;
  /**
   * The innermost style rule's selector with nesting resolved (`&` replaced by, or a descendant
   * of, the enclosing rule's selector); '' outside any style rule. At-rule preludes are skipped.
   */
  rule?: string;
}

export interface CssOptions {
  /** Spec 021: allow the per-app accent mapping of the sign-in look (keycloak/themes). */
  signInAccents?: { tokens: ReadonlySet<string> };
}

// CSS Color Module Level 4 named colors, without transparent and currentcolor (allowed).
const NAMED_COLORS = new Set(
  (
    'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue ' +
    'blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk ' +
    'crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki ' +
    'darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen ' +
    'darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue ' +
    'dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite ' +
    'gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki ' +
    'lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan ' +
    'lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen ' +
    'lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen ' +
    'magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen ' +
    'mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream ' +
    'mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid ' +
    'palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum ' +
    'powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown ' +
    'seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen ' +
    'steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen ' +
    // Issue #37: CSS system colors (CSS Color 4), current and deprecated, which follow the
    // device's or browser's colors instead of the theme's.
    'accentcolor accentcolortext activetext buttonborder buttonface buttontext canvas canvastext ' +
    'field fieldtext graytext highlight highlighttext linktext mark marktext selecteditem ' +
    'selecteditemtext visitedtext activeborder activecaption appworkspace background ' +
    'buttonhighlight buttonshadow captiontext inactiveborder inactivecaption inactivecaptiontext ' +
    'infobackground infotext menu menutext scrollbar threeddarkshadow threedface threedhighlight ' +
    'threedlightshadow threedshadow window windowframe windowtext'
  ).split(' '),
);

const COLOR_LITERAL = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;

/** Properties whose value is (or carries) a color, where a named color word counts (C2). */
const COLOR_PROPERTY =
  /(^|-)color$|^background|^mask|shadow$|^filter$|^(border|outline|text-decoration|column-rule)(-|$)|^(fill|stroke)$/;
/** Corner rounding and shadows (C4). */
const RADIUS_PROPERTY = /radius$/;
const SHADOW_PROPERTY = /shadow$/;
/** Spacing (C5). */
const SPACING_PROPERTY =
  /^(padding|margin)(-|$)|^(grid-)?(row-|column-)?gap$|^scroll-(margin|padding)(-|$)/;

// Only the tokens theme.css defines (data-model.md; tokens.test.ts checks them there).
const FONT_TOKEN = /^var\(--(font|mono)\)$/;
const RADIUS_TOKEN = /^var\(--radius(-sm|-pill)?\)$/;
const SHADOW_TOKEN = /^var\(--shadow(-lg)?\)$/;
const STEP = /^var\(--space-([1-6]|8)\)$/;
const DROP_SHADOW = /drop-shadow\(((?:[^()]|\([^()]*\))*)\)/g;
const NEGATIVE_STEP = /^calc\(-1 \* var\(--space-([1-6]|8)\)\)$/;

/** Comments replaced by spaces, newlines kept, so indexes and line numbers still match. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
}

const lineAt = (text: string, index: number): number => text.slice(0, index).split('\n').length;

/** `list` split at commas outside parentheses and brackets, each part trimmed. */
function selectorList(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of list) {
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch === ',' && depth === 0) {
      out.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  out.push(current.trim());
  return out.filter((s) => s !== '');
}

/** A nested rule's selector resolved against its parent's (CSS nesting: `&`, or a descendant). */
function nest(parent: string, child: string): string {
  if (parent === '') return child;
  return selectorList(parent)
    .flatMap((p) =>
      selectorList(child).map((c) => (c.includes('&') ? c.replace(/&/g, p) : `${p} ${c}`)),
    )
    .join(', ');
}

/**
 * Every declaration at any depth, with its line. Text that ends at a `{` is a selector or an
 * at-rule prelude and is skipped; text that ends at a `;` or `}` is a declaration if it has a
 * colon.
 */
function declarations(css: string): Declaration[] {
  const text = stripComments(css);
  const out: Declaration[] = [];
  // The selector or at-rule prelude of each open block, innermost last.
  const blocks: { selector: string; block: number; rule: string }[] = [];
  let opened = 0;
  let start = 0;
  let parens = 0;
  // Characters inside a quoted string (with \ escapes) end nothing and open nothing.
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') parens++;
    else if (ch === ')') parens = Math.max(0, parens - 1);
    else if (ch === '{') {
      const selector = text.slice(start, i).replace(/\s+/g, ' ').trim();
      const parent = blocks[blocks.length - 1]?.rule ?? '';
      const rule = selector.startsWith('@') ? parent : nest(parent, selector);
      blocks.push({ selector, block: opened++, rule });
      start = i + 1;
      parens = 0;
    } else if (ch === '}' || (ch === ';' && parens === 0)) {
      parens = 0;
      const part = text.slice(start, i);
      const colon = part.indexOf(':');
      if (colon !== -1 && part.trim() !== '') {
        const lead = part.length - part.trimStart().length;
        out.push({
          line: lineAt(text, start + lead),
          prop: part.slice(0, colon).trim().toLowerCase(),
          value: part
            .slice(colon + 1)
            .replace(/\s+/g, ' ')
            .trim(),
          selector: blocks[blocks.length - 1]?.selector ?? '',
          block: blocks[blocks.length - 1]?.block ?? -1,
          rule: blocks[blocks.length - 1]?.rule ?? '',
        });
      }
      if (ch === '}') blocks.pop();
      start = i + 1;
    }
  }
  return out;
}

/** Spec 021 R4: the one rule that maps a sign-in screen's accent roles to its app's tokens. */
const SIGN_IN_RULE = /^\.qp-app--[a-z0-9-]+$/;
/** Each accent role and its app token, `<app>` standing for the app's name. */
const SIGN_IN_ROLES: Record<string, string> = {
  '--accent': '--accent-<app>',
  '--accent-hover': '--accent-<app>-hover',
  '--accent-soft': '--accent-<app>-soft',
  '--accent-text': '--accent-<app>-text',
  '--brand-mark-end': '--brand-mark-end-<app>',
  '--brand-mark-text': '--brand-mark-text-<app>',
};

/** The app a role's `var(--…)` value names, or null when it is not that role's app token. */
function signInApp(d: Declaration): string | null {
  const token = SIGN_IN_ROLES[d.prop];
  const name = /^var\((--[a-z0-9-]+)\)$/.exec(d.value)?.[1];
  if (!token || !name) return null;
  const [before, after] = token.split('<app>') as [string, string];
  if (!name.startsWith(before) || !name.endsWith(after)) return null;
  const app = name.slice(before.length, name.length - after.length);
  return /^[a-z]+$/.test(app) ? app : null;
}

/**
 * The sign-in mappings allowed in `decls`: in a `.qp-app--<clientId>` rule, a role pointed at the
 * app token of the rule's first mapped app, whose six tokens the theme all defines.
 */
function allowedSignInMappings(
  decls: Declaration[],
  tokens: ReadonlySet<string>,
): Set<Declaration> {
  const allowed = new Set<Declaration>();
  const ruleApp = new Map<number, string>();
  for (const d of decls) {
    if (!SIGN_IN_RULE.test(d.selector ?? '')) continue;
    const app = signInApp(d);
    if (app === null) continue;
    const first = ruleApp.get(d.block ?? -1) ?? app;
    ruleApp.set(d.block ?? -1, first);
    const complete = Object.values(SIGN_IN_ROLES).every((t) => tokens.has(t.replace('<app>', app)));
    if (app === first && complete) allowed.add(d);
  }
  return allowed;
}

/** The value split on spaces and commas outside parentheses. */
function parts(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of value) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (depth === 0 && (ch === ' ' || ch === ',')) {
      if (current) out.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current) out.push(current);
  return out.filter((p) => p !== '!important');
}

function hasColor(d: Declaration): boolean {
  if (COLOR_LITERAL.test(d.value)) return true;
  if (!COLOR_PROPERTY.test(d.prop)) return false;
  // Review round 1 (#37), S2: a file name in url() or a quoted string is not a color word.
  return d.value
    .replace(/url\((?:"[^"]*"|'[^']*'|[^)]*)\)/gi, ' ')
    .replace(/"[^"]*"|'[^']*'/g, ' ')
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .some((word) => NAMED_COLORS.has(word));
}

const every = (value: string, ok: (part: string) => boolean): boolean => parts(value).every(ok);

function ruleFor(d: Declaration): Violation['rule'] | null {
  if (d.prop.startsWith('--')) return 'C1';
  if (d.prop === 'color' && /var\(--text-faint\)/.test(d.value)) return 'C6';
  if (hasColor(d)) return 'C2';
  if (d.prop === 'font-family' && !FONT_TOKEN.test(d.value)) return 'C3';
  if (d.prop === 'font' && d.value !== 'inherit') return 'C3';
  if (RADIUS_PROPERTY.test(d.prop) && !every(d.value, (p) => p === '0' || RADIUS_TOKEN.test(p))) {
    return 'C4';
  }
  if (
    SHADOW_PROPERTY.test(d.prop) &&
    !every(d.value, (p) => p === 'none' || SHADOW_TOKEN.test(p))
  ) {
    return 'C4';
  }
  // A drop-shadow filter is a shadow: only a shadow token inside it.
  if (
    d.prop === 'filter' &&
    [...d.value.matchAll(DROP_SHADOW)].some((m) => !SHADOW_TOKEN.test(m[1].trim()))
  ) {
    return 'C4';
  }
  if (
    SPACING_PROPERTY.test(d.prop) &&
    !every(d.value, (p) => p === '0' || p === 'auto' || STEP.test(p) || NEGATIVE_STEP.test(p))
  ) {
    return 'C5';
  }
  return null;
}

/** C1–C6 over an app stylesheet, or over the sign-in look with `signInAccents`. */
export function cssViolations(path: string, css: string, options: CssOptions = {}): Violation[] {
  const decls = declarations(css);
  const allowed = options.signInAccents
    ? allowedSignInMappings(decls, options.signInAccents.tokens)
    : new Set<Declaration>();
  return decls.flatMap((d) => {
    if (allowed.has(d)) return [];
    const rule = ruleFor(d);
    return rule ? [{ path, line: d.line, rule, text: `${d.prop}: ${d.value}` }] : [];
  });
}

/** C2 only: used for the theme itself, outside its token blocks. */
export function colorLiteralViolations(path: string, css: string): Violation[] {
  return declarations(css)
    .filter((d) => !d.prop.startsWith('--') && hasColor(d))
    .map((d) => ({ path, line: d.line, rule: 'C2' as const, text: `${d.prop}: ${d.value}` }));
}

/** The classes of a selector's subject: its last compound, outside :not(), :is(), and the like. */
function subjectClasses(selector: string): string[] {
  let bare = selector.replace(/\[[^\]]*\]/g, '');
  for (let before = ''; before !== bare;) {
    before = bare;
    bare = bare.replace(/\([^()]*\)/g, '');
  }
  const compounds = bare.split(/\s*[>+~]\s*|\s+/).filter((c) => c !== '');
  const subject = compounds[compounds.length - 1] ?? '';
  return [...subject.matchAll(/\.([a-zA-Z0-9_-]+)/g)].map((m) => m[1]!);
}

/**
 * Issue #37 (C7): the classes the theme styles, as the subject of one of its rules: the shared
 * controls and page parts (`btn`, `btn--primary`, `card`, `banner`, ...). A class the theme only
 * names inside `:not()` or as an ancestor is not one.
 */
export function themeClasses(themeCss: string): Set<string> {
  const out = new Set<string>();
  for (const d of declarations(themeCss)) {
    for (const s of selectorList(d.rule ?? '')) for (const c of subjectClasses(s)) out.add(c);
  }
  return out;
}

/**
 * What C7 keeps for the theme: color, typeface, rounding, shadow, and inner spacing. A size,
 * offset, or position in a color property's family (`outline-offset`, `background-size`) is
 * placement, not the look (review round 1, M4).
 */
const PLACEMENT = /-(offset|size|position(-[xy])?|repeat|attachment|origin|clip|blend-mode)$/;
const LOOK_PROPERTY = (prop: string): boolean =>
  (COLOR_PROPERTY.test(prop) && !PLACEMENT.test(prop)) ||
  /^font(-|$)/.test(prop) ||
  RADIUS_PROPERTY.test(prop) ||
  SHADOW_PROPERTY.test(prop) ||
  /^padding(-|$)/.test(prop);

/**
 * C7 over an app stylesheet: a rule whose subject is one of `classes` (from `themeClasses`) sets a
 * look property. Placing a shared control (`grid-column`, `margin`, `width`, ...) is allowed.
 */
export function sharedClassViolations(
  path: string,
  css: string,
  classes: ReadonlySet<string>,
): Violation[] {
  return declarations(css)
    .filter(
      (d) =>
        !d.prop.startsWith('--') &&
        LOOK_PROPERTY(d.prop) &&
        selectorList(d.rule ?? '').some((s) => subjectClasses(s).some((c) => classes.has(c))),
    )
    .map((d) => ({
      path,
      line: d.line,
      rule: 'C7' as const,
      text: `${d.rule} { ${d.prop}: ${d.value} }`,
    }));
}

/** `text` split at top-level commas (outside brackets and quotes), each with its offset. */
function entries(text: string): { at: number; text: string }[] {
  const out: { at: number; text: string }[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i <= text.length; i++) {
    const ch = i < text.length ? text[i] : ',';
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = null;
    } else if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
    } else if (ch === '(' || ch === '[' || ch === '{') {
      depth++;
    } else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
    } else if (ch === ',' && (depth === 0 || i === text.length)) {
      out.push({ at: start, text: text.slice(start, i) });
      start = i + 1;
    }
  }
  return out;
}

const STRING = /^(['"])(.*)\1$/s;
const PLAIN_TEMPLATE = /^`([^$`]*)`$/;
const NUMBER = /^-?\d*\.?\d+$/;

/** A key the theme holds values for: color, typeface, rounding, shadow, or spacing. */
const themed = (prop: string): boolean =>
  prop === 'font' ||
  prop === 'font-family' ||
  [COLOR_PROPERTY, RADIUS_PROPERTY, SHADOW_PROPERTY, SPACING_PROPERTY].some((r) => r.test(prop));

/** The string literals and template text inside an expression. */
const literalsIn = (raw: string): string[] =>
  [...raw.matchAll(/'([^'\\]*)'|"([^"\\]*)"|`([^`]*)`/g)].map((m) =>
    (m[1] ?? m[2] ?? m[3]).replace(/\$\{[^}]*\}/g, ' '),
  );

/**
 * Whether one inline style entry breaks the stylesheet rules. `raw` is undefined for a shorthand
 * entry (`{ color }`), whose value is unknown.
 */
function inlineBreaks(key: string, raw: string | undefined): boolean {
  const prop = key.startsWith('--') ? key : key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
  if (prop.startsWith('--')) return true;
  if (raw === undefined) return themed(prop);
  if (COLOR_LITERAL.test(raw)) return true;
  const text = STRING.exec(raw)?.[2] ?? PLAIN_TEMPLATE.exec(raw)?.[1];
  if (text !== undefined) return ruleFor({ line: 0, prop, value: text.trim() }) !== null;
  if (NUMBER.test(raw)) {
    // React reads a bare number as pixels: only 0 is allowed for rounding, shadows, and spacing.
    const sized = [RADIUS_PROPERTY, SHADOW_PROPERTY, SPACING_PROPERTY].some((r) => r.test(prop));
    return sized && Number(raw) !== 0;
  }
  // Deliberately strict: even a ternary between two theme tokens is rejected here, because an
  // expression can't be proved to hold only theme values. Use a class for a state instead.
  // Any other expression can't be judged: a key the theme holds values for fails, and the
  // literals inside it are judged as stylesheet values.
  if (themed(prop)) return true;
  return literalsIn(raw).some((value) => ruleFor({ line: 0, prop, value: value.trim() }) !== null);
}

/** The violations in one style object's body, which starts at `offset` in `tsx`. */
function styleObject(
  path: string,
  tsx: string,
  body: string,
  offset: number,
  spreadOf: (name: string) => Violation[] | null = () => null,
): Violation[] {
  const out: Violation[] = [];
  for (const entry of entries(body)) {
    const trimmed = entry.text.trim();
    if (trimmed === '') continue;
    const lead = entry.text.length - entry.text.trimStart().length;
    const at = offset + entry.at + lead;
    const report = (text: string): number =>
      out.push({ path, line: lineAt(tsx, at), rule: 'inline', text });
    if (trimmed.startsWith('...')) {
      const spread = trimmed.slice(3).trim();
      // A spread object literal is walked, and a spread const followed like a plain one (review
      // round 1, M5); any other spread can't be judged, so it is reported.
      const followed = /^[A-Za-z_$][\w$]*$/.test(spread) ? spreadOf(spread) : null;
      if (spread.startsWith('{') && spread.endsWith('}')) {
        const inner = entry.text.indexOf('{', entry.text.indexOf('...')) + 1;
        out.push(
          ...styleObject(path, tsx, spread.slice(1, -1), offset + entry.at + inner, spreadOf),
        );
      } else if (followed) {
        out.push(...followed);
      } else {
        report(trimmed.replace(/\s+/g, ' '));
      }
      continue;
    }
    const colon = trimmed.indexOf(':');
    const keyRaw = colon === -1 ? trimmed : trimmed.slice(0, colon).trim();
    const raw =
      colon === -1
        ? undefined
        : trimmed
            .slice(colon + 1)
            .replace(/\s+/g, ' ')
            .trim();
    if (inlineBreaks(keyRaw.replace(STRING, '$2'), raw)) {
      report(raw === undefined ? keyRaw : `${keyRaw}: ${raw}`);
    }
  }
  return out;
}

/** Screen code parsed as TSX (TypeScript is already a dev dependency of the repository). */
const parse = (path: string, tsx: string): ts.SourceFile =>
  ts.createSourceFile(path, tsx, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

/** Every JSX attribute in `sf` named one of `names`. */
function jsxAttributes(sf: ts.SourceFile, names: ReadonlySet<string>): ts.JsxAttribute[] {
  const out: ts.JsxAttribute[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxAttribute(node) && names.has(node.name.getText(sf))) out.push(node);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** The identifier an assignment target or update writes through (`s`, `s.a`, `s['a'].b`). */
function rootName(target: ts.Expression): string | undefined {
  let e = target;
  while (
    ts.isPropertyAccessExpression(e) ||
    ts.isElementAccessExpression(e) ||
    ts.isParenthesizedExpression(e) ||
    ts.isNonNullExpression(e)
  ) {
    e = e.expression;
  }
  return ts.isIdentifier(e) ? e.text : undefined;
}

const ASSIGNMENTS = new Set([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
]);

/**
 * The object a style variable holds, when that can be trusted (review round 1, S1): the name is
 * bound once in the file, by a `const` with an initializer, and nothing writes to it or through
 * it (`s = ...`, `s.color = ...`, `s.n++`, `delete s.a`). A `let` or `var`, a parameter, a
 * destructured binding, an import, a function, or a second binding of the name anywhere in the
 * file (which could shadow it) is not trusted, so the style is reported instead.
 */
function trustedConst(sf: ts.SourceFile, name: string): ts.Expression | undefined {
  let bindings = 0;
  let initializer: ts.Expression | undefined;
  let written = false;
  const visit = (node: ts.Node): void => {
    const declared =
      (ts.isVariableDeclaration(node) ||
        ts.isParameter(node) ||
        ts.isBindingElement(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isImportSpecifier(node) ||
        ts.isImportClause(node) ||
        ts.isNamespaceImport(node)) &&
      node.name !== undefined &&
      ts.isIdentifier(node.name) &&
      node.name.text === name;
    if (declared) {
      bindings++;
      if (
        ts.isVariableDeclaration(node) &&
        ts.isVariableDeclarationList(node.parent) &&
        node.parent.flags & ts.NodeFlags.Const
      ) {
        initializer = node.initializer;
      }
    }
    if (
      (ts.isBinaryExpression(node) &&
        ASSIGNMENTS.has(node.operatorToken.kind) &&
        rootName(node.left) === name) ||
      ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) &&
        (node.operator === ts.SyntaxKind.PlusPlusToken ||
          node.operator === ts.SyntaxKind.MinusMinusToken) &&
        rootName(node.operand) === name) ||
      (ts.isDeleteExpression(node) && rootName(node.expression) === name)
    ) {
      written = true;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return bindings === 1 && !written ? initializer : undefined;
}

/**
 * `sf`'s text with every comment blanked (newlines kept, so offsets and lines still match): a
 * comment in a style value is not judged (review round 1, M6).
 */
function withoutComments(sf: ts.SourceFile): string {
  const text = sf.text.split('');
  const blank = (r: ts.CommentRange): void => {
    for (let i = r.pos; i < r.end; i++) if (text[i] !== '\n' && text[i] !== '\r') text[i] = ' ';
  };
  const visit = (node: ts.Node): void => {
    ts.getLeadingCommentRanges(sf.text, node.pos)?.forEach(blank);
    ts.getTrailingCommentRanges(sf.text, node.end)?.forEach(blank);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return text.join('');
}

const lineOf = (sf: ts.SourceFile, node: ts.Node): number =>
  sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

/**
 * The violations in a `style` value: an object written in place is walked; a condition's
 * branches and a variable's object are followed (issue #37); anything else is reported.
 */
function styleValue(
  path: string,
  sf: ts.SourceFile,
  code: string,
  e: ts.Expression,
  seen: ReadonlySet<string>,
): Violation[] {
  const follow = (next: ts.Expression, names = seen): Violation[] =>
    styleValue(path, sf, code, next, names);
  /** The violations in the trusted const `name` holds, or null when it can't be followed. */
  const held = (name: string): Violation[] | null => {
    const value = seen.has(name) ? undefined : trustedConst(sf, name);
    return value ? follow(value, new Set(seen).add(name)) : null;
  };
  if (
    ts.isParenthesizedExpression(e) ||
    ts.isAsExpression(e) ||
    ts.isSatisfiesExpression(e) ||
    ts.isNonNullExpression(e) ||
    ts.isTypeAssertionExpression(e)
  ) {
    return follow(e.expression);
  }
  if (ts.isObjectLiteralExpression(e)) {
    const start = e.getStart(sf) + 1;
    return styleObject(path, code, code.slice(start, e.end - 1), start, held);
  }
  if (ts.isConditionalExpression(e)) return [...follow(e.whenTrue), ...follow(e.whenFalse)];
  if (ts.isBinaryExpression(e)) {
    const op = e.operatorToken.kind;
    // `a && b` is false (no style) or b; `a || b` and `a ?? b` may be either.
    if (op === ts.SyntaxKind.AmpersandAmpersandToken) return follow(e.right);
    if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) {
      return [...follow(e.left), ...follow(e.right)];
    }
  }
  if (e.kind === ts.SyntaxKind.NullKeyword || e.kind === ts.SyntaxKind.FalseKeyword) return [];
  if (ts.isIdentifier(e)) {
    if (e.text === 'undefined') return [];
    const found = held(e.text);
    if (found) return found;
  }
  // A prop, a call, a member: its value can't be judged here.
  return [
    {
      path,
      line: lineOf(sf, e),
      rule: 'inline',
      text: `style: ${e.getText(sf).replace(/\s+/g, ' ')}`,
    },
  ];
}

/**
 * The inline rule over screen code: every `style` value follows the stylesheet rules, whether
 * written in place (`style={{ ... }}`) or reached through a condition or a variable.
 */
export function inlineStyleViolations(path: string, tsx: string): Violation[] {
  const sf = parse(path, tsx);
  const code = withoutComments(sf);
  return jsxAttributes(sf, new Set(['style'])).flatMap((attr) => {
    const init = attr.initializer;
    if (!init || !ts.isJsxExpression(init) || !init.expression) return [];
    return styleValue(path, sf, code, init.expression, new Set());
  });
}

/** SVG presentation attributes that take a color (issue #37), in React's and SVG's spelling. */
const COLOR_ATTRIBUTES = new Set([
  'fill',
  'stroke',
  'color',
  'stopColor',
  'floodColor',
  'lightingColor',
  'stop-color',
  'flood-color',
  'lighting-color',
]);
// Review round 1, M2: no var(); browsers don't resolve it in an SVG attribute, so a theme color
// reaches SVG through CSS (a class), as the Customer QR code does.
const ALLOWED_ATTRIBUTE = /^(currentcolor|none|transparent|inherit|url\(#[^)]*\))$/i;

/** SVG's element names, for the spread check (review round 1, M1). */
const SVG_ELEMENTS = new Set(
  (
    'svg g defs symbol use path rect circle ellipse line polyline polygon text tspan textPath ' +
    'linearGradient radialGradient stop pattern mask clipPath marker image foreignObject filter'
  ).split(' '),
);

const tagOf = (sf: ts.SourceFile, element: ts.Node): string =>
  ts.isJsxOpeningElement(element) || ts.isJsxSelfClosingElement(element)
    ? element.tagName.getText(sf)
    : '';

/**
 * The attr rule over screen code (issue #37): an SVG color attribute on an element (a lower-case
 * tag, not a component's prop) is `currentColor`, `none`, `transparent`, `inherit`, or a paint
 * reference. A value from an expression can't be judged, so it is reported, and so is a spread of
 * attributes onto an SVG element (review round 1, M1).
 */
export function colorAttributeViolations(path: string, tsx: string): Violation[] {
  const sf = parse(path, tsx);
  const spreads: Violation[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxSpreadAttribute(node) && SVG_ELEMENTS.has(tagOf(sf, node.parent.parent))) {
      spreads.push({ path, line: lineOf(sf, node), rule: 'attr', text: node.getText(sf) });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  const attributes = jsxAttributes(sf, COLOR_ATTRIBUTES).flatMap((attr) => {
    if (!/^[a-z]/.test(tagOf(sf, attr.parent.parent))) return [];
    let init: ts.Node | undefined = attr.initializer;
    if (init && ts.isJsxExpression(init)) init = init.expression;
    const value =
      init && (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init))
        ? init.text.trim()
        : undefined;
    if (value !== undefined && ALLOWED_ATTRIBUTE.test(value)) return [];
    return [
      {
        path,
        line: lineOf(sf, attr),
        rule: 'attr' as const,
        text: attr.getText(sf).replace(/\s+/g, ' '),
      },
    ];
  });
  return [...spreads, ...attributes].sort((a, b) => a.line - b.line);
}
