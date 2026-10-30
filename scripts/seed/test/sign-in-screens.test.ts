import { createHash, randomBytes } from 'node:crypto';
import { describe, it, expect, beforeAll } from 'vitest';
import { FRONTEND_CLIENTS } from '../src/provision-clients';

/**
 * Spec 021 research R11 (FR-001, FR-002, FR-005, FR-006, FR-007, FR-008, FR-011, FR-012): the
 * sign-in pages Keycloak renders with the `queuepass` login theme, fetched as a browser would,
 * for each app and for a client with no QueuePass identity.
 *
 * Requires a running Keycloak built from keycloak/Dockerfile and seeded. Skipped with its reason
 * when absent, as seed-idempotence.test.ts (spec 011 research R16): CI has no Keycloak.
 */
const KEYCLOAK = process.env.KEYCLOAK_URL ?? 'http://localhost:8080';
const realm = process.env.KEYCLOAK_REALM ?? 'queuepass';

// Keycloak 26 serves /health/* on the management port (9000), not 8080.
const keycloakUp = async (): Promise<boolean> => {
  try {
    const res = await fetch(
      `${process.env.KEYCLOAK_HEALTH_URL ?? 'http://localhost:9000'}/health/ready`,
    );
    return res.ok;
  } catch {
    return false;
  }
};

const SKIP_REASON = 'Keycloak not reachable; start the stack to run the sign-in screen tests';

/** contracts/README.md: what each app's sign-in page shows. */
const SCREENS: Record<string, { heading: string; audience: string }> = {
  'admin-app': {
    heading: 'Sign in to QueuePass Admin',
    audience: 'For administrators managing venues, events, and sales.',
  },
  'customer-app': {
    heading: 'Sign in to QueuePass Tickets',
    audience: 'For customers buying and viewing tickets.',
  },
  'booth-app': {
    heading: 'Sign in to QueuePass Ticket Booth',
    audience: 'For gate agents checking tickets in at the door.',
  },
};

/** A sign-in page as fetched, with the cookies Keycloak set on the way. */
interface Page {
  status: number;
  html: string;
  cookies: string;
}

const base64url = (b: Buffer): string => b.toString('base64url');

/** GET the authorization endpoint for `clientId` with PKCE S256, as the apps' sign-in does. */
async function authorize(clientId: string, redirectUri: string): Promise<Page> {
  const verifier = base64url(randomBytes(32));
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid',
    state: base64url(randomBytes(12)),
    code_challenge: base64url(createHash('sha256').update(verifier).digest()),
    code_challenge_method: 'S256',
  });
  const res = await fetch(`${KEYCLOAK}/realms/${realm}/protocol/openid-connect/auth?${params}`, {
    redirect: 'manual',
  });
  return { status: res.status, html: await res.text(), cookies: cookiesOf(res) };
}

const cookiesOf = (res: Response): string =>
  res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');

/** The few entities Keycloak's HTML escaping writes. */
const decode = (s: string): string =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

const text = (s: string): string => decode(s.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();

/** What the tests read from a sign-in page. */
function read(html: string) {
  return {
    title: text(html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? ''),
    h1: [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)].map((m) => text(m[1]!)),
    audience: [...html.matchAll(/<p class="qp-audience">([\s\S]*?)<\/p>/g)].map((m) =>
      text(m[1]!),
    ),
    bodyClass: html.match(/<body\b[^>]*class="([^"]*)"/)?.[1] ?? null,
    stylesheets: [...html.matchAll(/<link\b[^>]*href="([^"]+)"[^>]*rel="stylesheet"/g)].map(
      (m) => decode(m[1]!),
    ),
  };
}

describe('the sign-in screens (spec 021)', () => {
  let available = false;
  beforeAll(async () => {
    available = await keycloakUp();
    if (!available) console.warn(`[skip] ${SKIP_REASON}`);
  });

  describe.each(FRONTEND_CLIENTS.map((c) => [c.clientId, c] as const))('%s', (clientId, c) => {
    const redirectUri = `http://localhost:${c.port}/`;
    const want = SCREENS[clientId]!;

    it('names the app in the tab title and the one heading, says who it is for, and sets its accent class (US1)', async ({
      skip,
    }) => {
      skip(!available, SKIP_REASON);
      const page = await authorize(clientId, redirectUri);
      expect(page.status).toBe(200);
      const got = read(page.html);
      expect(got.title).toBe(want.heading);
      expect(got.h1).toEqual([want.heading]);
      expect(got.audience).toEqual([want.audience]);
      expect(got.bodyClass).toBe(`qp-app--${clientId}`);
    });

    it('loads the shared theme and the sign-in layout, and no PatternFly (FR-007)', async ({
      skip,
    }) => {
      skip(!available, SKIP_REASON);
      const { html } = await authorize(clientId, redirectUri);
      const sheets = read(html).stylesheets;
      expect(sheets.map((s) => s.split('/').slice(-2).join('/'))).toEqual([
        'css/theme.css',
        'css/login.css',
      ]);
      expect(sheets.join(' ')).not.toMatch(/patternfly/i);
      for (const sheet of sheets) {
        const res = await fetch(new URL(sheet, KEYCLOAK));
        expect(res.status, sheet).toBe(200);
      }
    });

    it('keeps the form: username or email, password, a labelled show-password button, no registration (FR-011, FR-012)', async ({
      skip,
    }) => {
      skip(!available, SKIP_REASON);
      const { html } = await authorize(clientId, redirectUri);
      expect(html).toMatch(/<label for="username"[^>]*>Username or email<\/label>/);
      expect(html).toMatch(/<input[^>]*id="username"[^>]*autofocus/);
      expect(html).toMatch(/<input[^>]*id="password"[^>]*type="password"/);
      const reveal = html.match(/<button\b[^>]*data-password-toggle[^>]*>/)?.[0] ?? '';
      expect(reveal).toMatch(/aria-label="Show password"/);
      expect(reveal).toMatch(/class="[^"]*\bqp-reveal\b[^"]*"/);
      expect(html).toMatch(/<input[^>]*class="btn btn--primary[^"]*"[^>]*id="kc-login"/);
      expect(html).not.toMatch(/registration/i);
    });
  });
});
