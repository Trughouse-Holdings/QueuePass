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
 * Declarations are read at any depth, including beside a nested rule.
 */
export interface Violation {
  path: string;
  line: number;
  rule: 'C1' | 'C2' | 'C3' | 'C4' | 'C5' | 'C6' | 'inline';
  text: string;
}

interface Declaration {
  line: number;
  prop: string;
  value: string;
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
    'steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen'
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

/**
 * Every declaration at any depth, with its line. Text that ends at a `{` is a selector or an
 * at-rule prelude and is skipped; text that ends at a `;` or `}` is a declaration if it has a
 * colon.
 */
function declarations(css: string): Declaration[] {
  const text = stripComments(css);
  const out: Declaration[] = [];
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
        });
      }
      start = i + 1;
    }
  }
  return out;
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
  return d.value
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

/** C1–C6 over an app stylesheet. */
export function cssViolations(path: string, css: string): Violation[] {
  return declarations(css).flatMap((d) => {
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
function styleObject(path: string, tsx: string, body: string, offset: number): Violation[] {
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
      // A spread object literal is walked; any other spread can't be judged, so it is reported.
      if (spread.startsWith('{') && spread.endsWith('}')) {
        const inner = entry.text.indexOf('{', entry.text.indexOf('...')) + 1;
        out.push(...styleObject(path, tsx, spread.slice(1, -1), offset + entry.at + inner));
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

/** The inline rule over screen code: a `style={{ ... }}` follows the stylesheet rules. */
export function inlineStyleViolations(path: string, tsx: string): Violation[] {
  const out: Violation[] = [];
  for (const m of tsx.matchAll(/style=\{\s*\{/g)) {
    const start = (m.index ?? 0) + m[0].length;
    // The object ends where its braces balance.
    let depth = 1;
    let end = start;
    while (end < tsx.length && depth > 0) {
      if (tsx[end] === '{') depth++;
      if (tsx[end] === '}') depth--;
      end++;
    }
    out.push(...styleObject(path, tsx, tsx.slice(start, end - 1), start));
  }
  return out;
}
