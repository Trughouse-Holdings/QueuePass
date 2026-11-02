import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { decode } from 'fast-png';
import { SOURCE } from '../src/stone-lines/cli';

/**
 * Spec 021 (research R2, R3, R9; data-model.md): the `queuepass` Keycloak login theme ships in the
 * repository with the parent, stylesheets, class mappings, and per-app text the sign-in screens
 * need. Reads the files only: needs no Keycloak, so it runs in CI.
 */
// Vitest runs each workspace from its own folder (scripts/seed/).
const THEME = resolve(process.cwd(), '../../keycloak/themes/queuepass/login');

/** `key=value` lines of a Java properties file, comments and blank lines skipped. */
function properties(path: string): Record<string, string> {
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '' && !line.startsWith('#') && !line.startsWith('!'))
      .map((line) => {
        const eq = line.indexOf('=');
        return [line.slice(0, eq).trim(), line.slice(eq + 1).trim()];
      }),
  );
}

describe('theme.properties (research R2)', () => {
  const props = () => properties(resolve(THEME, 'theme.properties'));

  it.each([
    ['parent', 'base'],
    ['import', 'common/keycloak'],
    ['styles', 'css/theme.css css/login.css'],
    ['locales', 'en'],
    ['kcFormGroupClass', 'field'],
    ['kcButtonClass', 'btn'],
    ['kcButtonPrimaryClass', 'btn--primary'],
    ['kcButtonBlockClass', ''],
    ['kcAlertClass', 'banner'],
    ['kcAlertTitleClass', 'banner__body'],
    ['kcInputErrorMessageClass', 'qp-field-error'],
    ['kcFormPasswordVisibilityButtonClass', 'btn btn--ghost qp-reveal'],
    ['kcFormPasswordVisibilityIconShow', 'qp-reveal--show'],
    ['kcFormPasswordVisibilityIconHide', 'qp-reveal--hide'],
  ])('sets %s to "%s"', (key, value) => {
    expect(props()[key], key).toBe(value);
  });

  it('loads no PatternFly stylesheet', () => {
    const p = props();
    expect(p['stylesCommon'] ?? '').toBe('');
    expect(Object.values(p).join(' ')).not.toMatch(/patternfly/i);
  });
});

describe('messages_en.properties (research R3, R9; data-model.md)', () => {
  const messages = () => properties(resolve(THEME, 'messages/messages_en.properties'));

  it('words the heading and tab title as "Sign in to {0}"', () => {
    expect(messages()['qpSignInTo']).toBe('Sign in to {0}');
  });

  it('has exactly one audience line per QueuePass app, word for word', () => {
    const audience = Object.fromEntries(
      Object.entries(messages()).filter(([key]) => key.startsWith('qpAudience.')),
    );
    expect(audience).toEqual({
      'qpAudience.admin-app': 'For administrators managing venues, events, and sales.',
      'qpAudience.customer-app': 'For customers buying and viewing tickets.',
      'qpAudience.booth-app': 'For gate agents checking tickets in at the door.',
    });
  });
});

describe('template.ftl (research R3, R9)', () => {
  const path = resolve(THEME, 'template.ftl');

  it('exists', () => {
    expect(existsSync(path)).toBe(true);
  });

  it.each([
    ['the client name, through advancedMsg', 'advancedMsg(client.name)'],
    ['the per-app body class', 'qp-app--'],
    ['an announced error banner', 'role="alert"'],
    ['announced notices', 'role="status"'],
    ['the audience line message', 'qpAudience.'],
    ['the heading message', 'qpSignInTo'],
  ])('holds %s', (_, text) => {
    expect(existsSync(path) ? readFileSync(path, 'utf8') : '').toContain(text);
  });
});

// Review round 1, finding 1 (FR-012, research R2, R9): the one form template overridden. The
// wrong-password text comes with a full page load, where base's aria-live span is not announced,
// so the fields name it with aria-describedby while it is shown.
describe('login.ftl (research R2, R9)', () => {
  const path = resolve(THEME, 'login.ftl');
  const source = () => (existsSync(path) ? readFileSync(path, 'utf8') : '');

  it.each(['username', 'password'])(
    'points #%s at #input-error only while there is an error',
    (id) => {
      const tag = source().match(new RegExp(`<input[^>]*id="${id}"[\\s\\S]*?/>`))?.[0] ?? '';
      expect(tag).toMatch(
        /<#if messagesPerField\.existsError\('username','password'\)> aria-describedby="input-error"<\/#if>/,
      );
    },
  );

  it('keeps the error text where base puts it, in #input-error', () => {
    expect(source()).toContain(
      '<span id="input-error" class="${properties.kcInputErrorMessageClass!}" aria-live="polite">',
    );
  });
});

// Spec 027 research R2–R4, R7, R8 (FR-001–FR-004, FR-009, FR-010, FR-013, SC-004): the stones
// behind every sign-in page, the lines between them in the app's accent, the realm header, and the card.
describe('the sign-in backdrop (spec 027)', () => {
  const ROOT = resolve(process.cwd(), '../..');
  const css = () => readFileSync(resolve(THEME, 'resources/css/login.css'), 'utf8');
  /** template.ftl without its FreeMarker comments. */
  const template = () =>
    readFileSync(resolve(THEME, 'template.ftl'), 'utf8').replace(/<#--[\s\S]*?-->/g, '');
  const KEYCLOAK_BG_SHA256 = SOURCE.sha256;

  /** Every innermost rule as [selector, body, enclosing at-rule preludes], comments removed. */
  function rules(source: string): [string, string, string[]][] {
    const text = source.replace(/\/\*[\s\S]*?\*\//g, '');
    const out: [string, string, string[]][] = [];
    const stack: string[] = [];
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '{') {
        const prelude = text.slice(start, i).trim();
        const close = text.indexOf('}', i);
        const nextOpen = text.indexOf('{', i + 1);
        if (nextOpen === -1 || close < nextOpen) {
          out.push([prelude, text.slice(i + 1, close), [...stack]]);
          i = close;
        } else {
          stack.push(prelude);
        }
        start = i + 1;
      } else if (text[i] === '}') {
        stack.pop();
        start = i + 1;
      }
    }
    return out;
  }
  const bodiesNaming = (selector: string): string =>
    rules(css())
      .filter(([sel]) => sel.split(',').some((s) => s.trim() === selector))
      .map(([, body]) => body)
      .join('\n');

  it("loads Keycloak's own stones image from its theme, and the lines image (R1, R2)", () => {
    expect(css()).toContain('url(../../keycloak/img/keycloak-bg.png)');
    expect(css()).toContain('url(../img/stone-lines.png)');
  });

  it('puts the stones on .qp-stones, fixed to the window, behind the page (R4)', () => {
    const body = bodiesNaming('.qp-stones');
    expect(body).toMatch(/position:\s*fixed/);
    expect(body).toMatch(/inset:\s*0/);
    expect(body).toMatch(
      /url\(\.\.\/\.\.\/keycloak\/img\/keycloak-bg\.png\)\s*center\s*\/\s*cover\s*no-repeat/,
    );
  });

  it('draws the lines in var(--stone-accent) through the lines image, only where masks work (R2, R4)', () => {
    const lines = rules(css()).filter(([sel]) => sel === '.qp-stones::before');
    expect(lines.length).toBeGreaterThan(0);
    for (const [, body, at] of lines) {
      expect(at).toContain('@supports (mask-image: none)');
      expect(body).toMatch(/background:\s*var\(--stone-accent\)/);
      expect(body).toMatch(
        /mask:\s*url\(\.\.\/img\/stone-lines\.png\)\s*center\s*\/\s*cover\s*no-repeat/,
      );
    }
  });

  it("gives every pseudo-element of .qp-stones content: '' so it is drawn", () => {
    const pseudo = rules(css()).filter(([sel]) => /^\.qp-stones::(before|after)$/.test(sel));
    expect(pseudo.length).toBeGreaterThan(0);
    for (const [sel, body] of pseudo) expect(body, sel).toMatch(/content:\s*''/);
  });

  it('shades the form column with --stone-scrim, fading out by 400 px from the center (R5)', () => {
    const body = rules(css())
      .filter(([sel]) => sel === '.qp-stones::after')
      .map(([, b]) => b.replace(/\s+/g, ' '))
      .join('\n');
    expect(body).toContain(
      'linear-gradient( to right, transparent calc(50% - 400px), var(--stone-scrim) calc(50% - 280px), var(--stone-scrim) calc(50% + 280px), transparent calc(50% + 400px) )',
    );
  });

  // T022: Keycloak's logout confirmation has its own submit input (#kc-logout), whose ring the
  // shared input:focus rule removed, as it did #kc-login's: every input in the card gets it.
  it("rings every input in the card, submit inputs included, in the app's --accent (R7, FR-006)", () => {
    const body = bodiesNaming('.qp-card input:focus-visible');
    expect(body).toMatch(/outline:\s*3px solid var\(--accent\)/);
    expect(body).toMatch(/outline-offset:\s*2px/);
  });

  it('hides the whole backdrop in forced colors (R4)', () => {
    const hidden = rules(css()).filter(
      ([sel, body, at]) =>
        sel === '.qp-stones' &&
        at.includes('@media (forced-colors: active)') &&
        /display:\s*none/.test(body),
    );
    expect(hidden).toHaveLength(1);
  });

  // Implementation session 3 (FR-013, R10): the lines pulse, pausable, and nothing else moves.
  describe('the pulse and its pause button (FR-013, R10)', () => {
    const REST = '0.6275';
    const all = () => rules(css());
    const inside = (at: string) => (r: [string, string, string[]]) =>
      r[2].some((a) => a.startsWith(at));

    it('fades the lines from their resting opacity to full strength and back', () => {
      const frames = all().filter(inside('@keyframes qp-lines-pulse'));
      expect(frames.map(([sel, body]) => `${sel}: ${body.trim()}`)).toEqual([
        `from: opacity: ${REST};`,
        'to: opacity: 1;',
      ]);
    });

    it('rests the lines at the dim level, and pulses them only under .qp-animate, 4 s a cycle', () => {
      const lines = all().filter(([sel]) => sel === '.qp-stones::before');
      expect(lines.map(([, body]) => body).join('\n')).toMatch(
        new RegExp(`opacity:\\s*${REST.replace('.', '\\.')}`),
      );
      const pulse = all().filter(
        (r) =>
          r[0] === '.qp-animate .qp-stones::before' && !inside('@media (prefers-reduced-motion')(r),
      );
      expect(pulse).toHaveLength(1);
      expect(pulse[0]![1]).toMatch(/animation:\s*qp-lines-pulse 2s ease-in-out infinite alternate/);
      const paused = all().filter(([sel]) => sel === '.qp-paused .qp-stones::before');
      expect(paused.map(([, b]) => b).join('\n')).toMatch(/animation-play-state:\s*paused/);
    });

    it('moves nothing else: no other animation and no transition on the backdrop', () => {
      const moving = all().filter(
        ([sel, body]) =>
          sel.includes('.qp-stones') &&
          (/transition/.test(body) ||
            (/animation(?!-play-state)/.test(body) &&
              sel !== '.qp-animate .qp-stones::before' &&
              !/animation:\s*none/.test(body))),
      );
      expect(moving.map(([sel]) => sel)).toEqual([]);
    });

    it('stops the pulse and hides the button under reduced motion', () => {
      const reduced = all().filter(inside('@media (prefers-reduced-motion: reduce)'));
      const by = (sel: string) =>
        reduced
          .filter(([s]) => s === sel)
          .map(([, b]) => b)
          .join('\n');
      expect(by('.qp-animate .qp-stones::before')).toMatch(/animation:\s*none/);
      expect(by('.qp-motion')).toMatch(/display:\s*none/);
    });

    it('hides the button with the backdrop in forced colors', () => {
      const forced = all().filter(inside('@media (forced-colors: active)'));
      const sels = forced.filter(([, b]) => /display:\s*none/.test(b)).map(([s]) => s);
      expect(sels.join(',')).toMatch(/\.qp-motion/);
      expect(sels.join(',')).toMatch(/\.qp-stones/);
    });

    it('keeps the panel hidden while it has the hidden attribute', () => {
      expect(bodiesNaming('.qp-motion[hidden]')).toMatch(/display:\s*none/);
    });

    it('puts the button on its own panel, wider than its ring, in the stones colors', () => {
      const panel = bodiesNaming('.qp-motion');
      expect(panel).toMatch(/background:\s*var\(--stone-base\)/);
      expect(panel).toMatch(/padding:\s*var\(--space-2\)/);
      expect(bodiesNaming('.qp-motion__toggle')).toMatch(/color:\s*var\(--stone-text\)/);
      const ring = bodiesNaming('.qp-motion__toggle:focus-visible');
      expect(ring).toMatch(/outline:\s*3px solid var\(--stone-accent\)/);
      expect(ring).toMatch(/outline-offset:\s*2px/);
    });

    it('has the hidden panel and its button after main, last in the Tab order', () => {
      const afterMain = template().split('</main>')[1] ?? '';
      expect(afterMain).toMatch(
        /<div class="qp-motion" hidden>\s*<button type="button" class="qp-motion__toggle" aria-pressed="false">Pause animation<\/button>\s*<\/div>/,
      );
      expect(afterMain).not.toMatch(/<(a|input|select|textarea)\b/);
    });

    it('loads the script from the theme, and remembers the choice only inside try/catch', () => {
      expect(properties(resolve(THEME, 'theme.properties'))['scripts']).toBe('js/motion.js');
      // Code only: the header comment names localStorage too.
      const js = readFileSync(resolve(THEME, 'resources/js/motion.js'), 'utf8').replace(
        /\/\/.*$/gm,
        '',
      );
      expect(js).toContain("'qp-sign-in-motion'");
      const uses = [...js.matchAll(/localStorage/g)].length;
      expect(uses).toBeGreaterThan(0);
      // Every use of localStorage sits in a try block.
      for (const m of js.matchAll(/localStorage/g)) {
        const before = js.slice(0, m.index);
        expect(before.lastIndexOf('try {')).toBeGreaterThan(before.lastIndexOf('}'));
      }
    });
  });

  it('puts the plain stone grey under the stones, for when the image is missing (FR-009)', () => {
    expect(bodiesNaming('body')).toMatch(/background:\s*var\(--stone-base\)/);
  });

  it.each([
    ['.qp-app--customer-app', 'tickets'],
    ['.qp-app--booth-app', 'booth'],
  ])('points the %s lines at its own lighter accent (R6)', (selector, app) => {
    expect(bodiesNaming(selector)).toContain(`--stone-accent: var(--stone-accent-${app});`);
  });

  it('has the backdrop element first in <body>, hidden from assistive technology (R4)', () => {
    const afterBody = template().split(/<body\b[^>]*>/)[1] ?? '';
    expect(afterBody.trimStart()).toMatch(/^<div class="qp-stones" aria-hidden="true"><\/div>/);
  });

  // Implementation session 2 (FR-004, R7): Keycloak's realm header, then its card, in main.
  it('shows the realm header, then the card holding the one <h1>, in main (FR-004)', () => {
    const main =
      template()
        .split(/<main\b[^>]*>/)[1]
        ?.split('</main>')[0] ?? '';
    expect(main.trimStart()).toMatch(
      /^<div class="qp-realm" aria-hidden="true">\$\{qpRealmName\}<\/div>\s*<div class="card card--padded qp-card">/,
    );
    // An empty display name still shows "QueuePass" (review round 1, nit 18).
    expect(template()).toMatch(
      /<#if realm\.displayName\?has_content>\s*<#assign qpRealmName = realm\.displayName>\s*<#else>\s*<#assign qpRealmName = "QueuePass">/,
    );
    const card = main.split('<div class="card card--padded qp-card">')[1] ?? '';
    expect(card).toContain('<h1 class="qp-title">');
    expect(template().match(/<h1\b/g)).toHaveLength(1);
  });

  it("models the card on Keycloak's .card-pf: at most 500 px, a 4 px top edge in the app's accent", () => {
    const body = bodiesNaming('.qp-card');
    expect(body).toMatch(/max-width:\s*500px/);
    expect(body).toMatch(/margin:\s*0 auto/);
    expect(body).toMatch(/border-top:\s*4px solid var\(--accent\)/);
    expect(body).toMatch(/box-shadow:\s*var\(--shadow-lg\)/);
  });

  it("writes the realm header as Keycloak's #kc-header-wrapper, in --stone-text", () => {
    const body = bodiesNaming('.qp-realm');
    expect(body).toMatch(/color:\s*var\(--stone-text\)/);
    expect(body).toMatch(/font-size:\s*29px/);
    expect(body).toMatch(/text-transform:\s*uppercase/);
    expect(body).toMatch(/letter-spacing:\s*3px/);
    expect(body).toMatch(/text-align:\s*center/);
  });

  it('draws no text, edge, or ring in a stones color on the card (R6)', () => {
    expect(css()).not.toMatch(/--stone-text-muted|--stone-danger/);
    // The lines, and the pause button on its own stones-colored panel (R10), are not on the card.
    const ringsOrText = rules(css()).filter(
      ([sel, body]) =>
        !/^\.qp-(stones|motion)/.test(sel) &&
        !sel.startsWith('.qp-animate') &&
        !sel.startsWith('.qp-paused') &&
        /var\(--stone-accent\)/.test(body),
    );
    expect(ringsOrText.map(([sel]) => sel)).toEqual([]);
  });

  describe('stone-lines.png (R2, R3)', () => {
    const png = () => decode(readFileSync(resolve(THEME, 'resources/img/stone-lines.png')));

    it('is 1920×1080 grey and alpha, white wherever it shows, on 2%–15% of pixels', () => {
      const image = png();
      expect([image.width, image.height, image.channels, image.depth]).toEqual([1920, 1080, 2, 8]);
      let shown = 0;
      let notWhite = 0;
      for (let i = 0; i < image.width * image.height; i++) {
        if (image.data[i * 2 + 1]! > 0) {
          shown++;
          if (image.data[i * 2] !== 255) notWhite++;
        }
      }
      expect(notWhite).toBe(0);
      // R10: made at full strength; the page sets the resting level with the layer's opacity.
      let peak = 0;
      for (let i = 0; i < image.width * image.height; i++) {
        peak = Math.max(peak, image.data[i * 2 + 1]!);
      }
      expect(peak).toBe(255);
      const share = shown / (image.width * image.height);
      expect(share).toBeGreaterThanOrEqual(0.02);
      expect(share).toBeLessThanOrEqual(0.15);
    });

    it('names the image it was made from in its one Source chunk', () => {
      const { text } = png();
      expect(Object.keys(text)).toEqual(['Source']);
      expect(text['Source']).toContain(KEYCLOAK_BG_SHA256);
    });
  });

  describe("Keycloak's license (FR-010)", () => {
    const notice = () => readFileSync(resolve(THEME, '../NOTICE'), 'utf8').replace(/\s+/g, ' ');

    it.each([
      ['the derived image', 'stone-lines.png'],
      ['its source', 'keycloak-bg.png'],
      ["the source's SHA-256", KEYCLOAK_BG_SHA256],
      ['the copyright holder', 'Red Hat, Inc.'],
      ['the license', 'Apache License, Version 2.0'],
      ['the change', 'reduced to the edges between the stones'],
    ])('NOTICE names %s', (_, text) => {
      expect(notice()).toContain(text);
    });

    it('ships the Apache License 2.0 beside it', () => {
      const license = readFileSync(resolve(THEME, '../LICENSE-keycloak.txt'), 'utf8');
      expect(license.trimStart()).toMatch(/^Apache License\s+Version 2\.0, January 2004/);
    });
  });

  // Every file the repository tracks, not only keycloak/ (review round 1, 19).
  it("holds no copy of Keycloak's stones image anywhere in the repository (FR-002, SC-004)", () => {
    const files = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
      .split('\0')
      .filter((f) => f !== '')
      .map((f) => resolve(ROOT, f))
      .filter((f) => existsSync(f) && statSync(f).isFile());
    expect(files).toContain(resolve(THEME, 'resources/img/stone-lines.png'));
    for (const f of files) {
      const sha = createHash('sha256').update(readFileSync(f)).digest('hex');
      expect(sha, f).not.toBe(KEYCLOAK_BG_SHA256);
    }
  });
});
