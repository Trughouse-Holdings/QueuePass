import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

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
