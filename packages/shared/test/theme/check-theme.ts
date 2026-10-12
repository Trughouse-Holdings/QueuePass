/**
 * Spec 012 (FR-005; research R6): the no-drift checker. Reads plain CSS and the inline `style`
 * objects of screen code, and reports each place an app defines its own look:
 *
 * - C1 a custom property is defined (apps define no theme values);
 * - C2 a color is written out (hex, a color function, or a named color in a color property);
 * - C3 a typeface is written out (`font-family` other than a token, `font` other than inherit);
 * - C4 `border-radius` or `box-shadow` has a part that is not 0, none, or a token;
 * - C5 padding, margin, or a gap has a part that is not 0, auto, or a spacing step;
 * - C6 the faintest gray is used for text;
 * - inline: a `style={{ ... }}` sets a color, a typeface, or a shadow.
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
function isColorProperty(prop: string): boolean {
  return (
    [
      'color',
      'background',
      'background-color',
      'fill',
      'stroke',
      'box-shadow',
      'caret-color',
      'accent-color',
    ].includes(prop) || /^(border|outline|text-decoration|column-rule)(-|$)/.test(prop)
  );
}

/** Comments replaced by spaces, newlines kept, so indexes and line numbers still match. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));
}

const lineAt = (text: string, index: number): number => text.slice(0, index).split('\n').length;

/** Every declaration in every innermost `{ ... }` block, with its line. */
function declarations(css: string): Declaration[] {
  const text = stripComments(css);
  const out: Declaration[] = [];
  for (const block of text.matchAll(/\{([^{}]*)\}/g)) {
    let offset = (block.index ?? 0) + 1;
    for (const part of block[1].split(';')) {
      const lead = part.length - part.trimStart().length;
      const colon = part.indexOf(':');
      if (colon !== -1 && part.trim() !== '') {
        out.push({
          line: lineAt(text, offset + lead),
          prop: part.slice(0, colon).trim().toLowerCase(),
          value: part
            .slice(colon + 1)
            .replace(/\s+/g, ' ')
            .trim(),
        });
      }
      offset += part.length + 1;
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

const TOKEN = /^var\(--[a-z0-9-]+\)$/i;
const STEP = /^var\(--space-\d+\)$/;
const NEGATIVE_STEP = /^calc\(-1 \* var\(--space-\d+\)\)$/;

function hasColor(d: Declaration): boolean {
  if (COLOR_LITERAL.test(d.value)) return true;
  if (!isColorProperty(d.prop)) return false;
  return d.value
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .some((word) => NAMED_COLORS.has(word));
}

function ruleFor(d: Declaration): Violation['rule'] | null {
  if (d.prop.startsWith('--')) return 'C1';
  if (d.prop === 'color' && /var\(--text-faint\)/.test(d.value)) return 'C6';
  if (hasColor(d)) return 'C2';
  if (d.prop === 'font-family' && !TOKEN.test(d.value)) return 'C3';
  if (d.prop === 'font' && d.value !== 'inherit') return 'C3';
  if (
    (d.prop === 'border-radius' || d.prop === 'box-shadow') &&
    parts(d.value).some((p) => p !== '0' && p !== 'none' && !TOKEN.test(p))
  ) {
    return 'C4';
  }
  if (
    /^(padding|margin)(-|$)|^(gap|row-gap|column-gap)$/.test(d.prop) &&
    parts(d.value).some((p) => p !== '0' && p !== 'auto' && !STEP.test(p) && !NEGATIVE_STEP.test(p))
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

const INLINE_KEY = /\b(color|background|backgroundColor|border\w*Color|fontFamily|boxShadow)\s*:/g;

/** The inline rule over screen code: no color, typeface, or shadow in a `style={{ ... }}`. */
export function inlineStyleViolations(path: string, tsx: string): Violation[] {
  const out: Violation[] = [];
  for (const m of tsx.matchAll(/style=\{\{/g)) {
    const start = (m.index ?? 0) + m[0].length;
    // The object ends where its braces balance.
    let depth = 1;
    let end = start;
    while (end < tsx.length && depth > 0) {
      if (tsx[end] === '{') depth++;
      if (tsx[end] === '}') depth--;
      end++;
    }
    const body = tsx.slice(start, end - 1);
    for (const key of body.matchAll(INLINE_KEY)) {
      const at = key.index ?? 0;
      const rest = body.slice(at);
      const stop = rest.search(/,|$/);
      out.push({
        path,
        line: lineAt(tsx, start + at),
        rule: 'inline',
        text: rest.slice(0, stop).replace(/\s+/g, ' ').trim(),
      });
    }
  }
  return out;
}
