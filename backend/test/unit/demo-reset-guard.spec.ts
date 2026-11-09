import { NestFactory } from '@nestjs/core';
import { checkResetAllowed, main, ResetRefused } from '../../src/scripts/demo-reset';

/**
 * Spec 029 FR-009, FR-011, SC-004 (research R7, tasks T003): the reset's guard, checked before
 * anything is connected to. A pure function of the environment, so no database is needed.
 */
describe('checkResetAllowed (spec 029)', () => {
  const SECRET = 's3cr3t-pa55';
  const url = (host: string, rest = '/queuepass?schema=public') =>
    `postgresql://queuepass:${SECRET}@${host}:5432${rest}`;
  const env = (over: Record<string, string | undefined>) => ({
    QUEUEPASS_ALLOW_RESET: '1',
    DATABASE_URL: url('localhost'),
    ...over,
  });

  /** The refusal's message, failing the test if the guard accepts. */
  const refusal = (e: Record<string, string | undefined>, inContainer = false): string => {
    try {
      checkResetAllowed(e, { inContainer });
    } catch (err) {
      expect(err).toBeInstanceOf(ResetRefused);
      const message = (err as Error).message;
      expect(message).not.toContain(SECRET);
      return message;
    }
    throw new Error('the guard accepted it');
  };

  describe('the permission', () => {
    it.each([
      ['absent', undefined],
      ['empty', ''],
      ['0', '0'],
      ['true', 'true'],
      ['a leading space', ' 1'],
      ['yes', 'yes'],
    ])('refuses when QUEUEPASS_ALLOW_RESET is %s, naming QUEUEPASS_ALLOW_RESET=1', (_, value) => {
      const message = refusal(env({ QUEUEPASS_ALLOW_RESET: value }));
      expect(message).toMatch(/^Refused: /);
      expect(message).toContain('QUEUEPASS_ALLOW_RESET=1');
    });
  });

  describe('the host', () => {
    it.each([
      ['localhost', 'localhost'],
      ['LOCALHOST', 'localhost'],
      ['127.0.0.1', '127.0.0.1'],
      ['[::1]', '::1'],
    ])('accepts %s and returns host, port, and database, no password', (host, expected) => {
      const target = checkResetAllowed(env({ DATABASE_URL: url(host) }), { inContainer: false });
      expect(target).toEqual({ host: expected, port: 5432, database: 'queuepass' });
      expect(JSON.stringify(target)).not.toContain(SECRET);
    });

    it('accepts database inside a container', () => {
      expect(
        checkResetAllowed(env({ DATABASE_URL: url('database') }), { inContainer: true }),
      ).toEqual({ host: 'database', port: 5432, database: 'queuepass' });
    });

    it('defaults the port to 5432 and reads the database from the path', () => {
      expect(
        checkResetAllowed(env({ DATABASE_URL: `postgres://u:${SECRET}@localhost/other` }), {
          inContainer: false,
        }),
      ).toEqual({ host: 'localhost', port: 5432, database: 'other' });
    });

    it('refuses database outside a container, naming it', () => {
      const message = refusal(env({ DATABASE_URL: url('database') }), false);
      expect(message).toMatch(/^Refused: /);
      expect(message).toContain('database');
      expect(message).toContain('not local');
    });

    it.each(['db.example.com', '10.0.0.5', '127.0.0.2', 'localhost.example.com'])(
      'refuses %s, naming the host and never the password',
      (host) => {
        const message = refusal(env({ DATABASE_URL: url(host) }));
        expect(message).toContain(host);
        expect(message).toContain('not local');
      },
    );

    it.each([
      'host=/var/run/postgresql',
      'HOST=db.example.com',
      'h%6Fst=db.example.com',
      'hostaddr=10.0.0.5',
    ])('refuses a query with %s', (query) => {
      const message = refusal(env({ DATABASE_URL: url('localhost', `/queuepass?${query}`) }));
      expect(message).toContain('not local');
    });

    it('refuses a mysql: URL', () => {
      expect(refusal(env({ DATABASE_URL: `mysql://root:${SECRET}@localhost:3306/q` }))).toContain(
        'not local',
      );
    });

    it('refuses a missing DATABASE_URL, saying it is missing', () => {
      expect(refusal(env({ DATABASE_URL: undefined }))).toMatch(
        /DATABASE_URL is (missing|not set)/,
      );
    });

    it('refuses an unparseable DATABASE_URL, never echoing it', () => {
      const message = refusal(env({ DATABASE_URL: `not a url ${SECRET}` }));
      expect(message).toMatch(/^Refused: /);
    });

    it('checks the permission before the host', () => {
      expect(
        refusal(env({ QUEUEPASS_ALLOW_RESET: undefined, DATABASE_URL: url('db.example.com') })),
      ).toContain('QUEUEPASS_ALLOW_RESET=1');
    });
  });

  describe('main()', () => {
    const saved = { ...process.env };
    afterEach(() => {
      process.env = { ...saved };
      process.exitCode = undefined;
      jest.restoreAllMocks();
    });

    it('when refused, sets a failure exit code and never creates the application context', async () => {
      const create = jest.spyOn(NestFactory, 'createApplicationContext');
      const errors: string[] = [];
      jest.spyOn(console, 'error').mockImplementation((m: unknown) => void errors.push(String(m)));
      delete process.env.QUEUEPASS_ALLOW_RESET;
      process.env.DATABASE_URL = url('localhost');
      await main();
      expect(process.exitCode).toBe(1);
      expect(create).not.toHaveBeenCalled();
      expect(errors.join('\n')).toContain('QUEUEPASS_ALLOW_RESET=1');
    });

    it('with a remote host, refuses the same way', async () => {
      const create = jest.spyOn(NestFactory, 'createApplicationContext');
      jest.spyOn(console, 'error').mockImplementation(() => undefined);
      process.env.QUEUEPASS_ALLOW_RESET = '1';
      process.env.DATABASE_URL = url('db.example.com');
      await main();
      expect(process.exitCode).toBe(1);
      expect(create).not.toHaveBeenCalled();
    });
  });
});
