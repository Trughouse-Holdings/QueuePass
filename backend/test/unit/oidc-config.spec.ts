import { oidcConfig } from '../../src/auth/jwks.provider';

/**
 * Spec 028 (research R8, data-model.md): the Backend's token configuration is two bases and the
 * audience; it refuses to start without any of them (as spec 001 FR-019 did for the old three),
 * naming every one missing.
 */
describe('oidcConfig', () => {
  const KEYS = ['OIDC_ISSUER_BASE', 'OIDC_JWKS_BASE', 'OIDC_AUDIENCE'] as const;
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of [...KEYS, 'OIDC_ISSUER', 'OIDC_JWKS_URL']) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  const setAll = (): void => {
    process.env.OIDC_ISSUER_BASE = 'http://localhost:8080/realms';
    process.env.OIDC_JWKS_BASE = 'http://keycloak:8080/realms';
    process.env.OIDC_AUDIENCE = 'queuepass-api';
  };

  it('reads the two bases and the audience', () => {
    setAll();
    expect(oidcConfig()).toEqual({
      issuerBase: 'http://localhost:8080/realms',
      jwksBase: 'http://keycloak:8080/realms',
      audience: 'queuepass-api',
    });
  });

  it('tolerates trailing slashes on the bases', () => {
    setAll();
    process.env.OIDC_ISSUER_BASE = 'http://localhost:8080/realms/';
    process.env.OIDC_JWKS_BASE = 'http://keycloak:8080/realms//';
    expect(oidcConfig()).toMatchObject({
      issuerBase: 'http://localhost:8080/realms',
      jwksBase: 'http://keycloak:8080/realms',
    });
  });

  it.each(KEYS)('refuses to start without %s, naming it', (key) => {
    setAll();
    delete process.env[key];
    expect(() => oidcConfig()).toThrow(`Token validation is not configured: set ${key}.`);
  });

  it('names every setting missing; the old single-realm settings do not count', () => {
    process.env.OIDC_ISSUER = 'http://localhost:8080/realms/queuepass';
    process.env.OIDC_JWKS_URL =
      'http://keycloak:8080/realms/queuepass/protocol/openid-connect/certs';
    expect(() => oidcConfig()).toThrow(
      'Token validation is not configured: set OIDC_ISSUER_BASE, OIDC_JWKS_BASE, OIDC_AUDIENCE.',
    );
  });

  it('treats an empty value as missing', () => {
    setAll();
    process.env.OIDC_JWKS_BASE = '';
    expect(() => oidcConfig()).toThrow('Token validation is not configured: set OIDC_JWKS_BASE.');
  });
});
