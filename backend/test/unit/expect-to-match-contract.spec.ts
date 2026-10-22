import type { Response } from 'supertest';
import { expectToMatchContract } from '../contract/expect-to-match-contract';

/**
 * Spec 014 research R8: a declared response with no `application/json` content (the image bytes
 * of `getEventImage`) is checked by its media type, not by a JSON schema.
 */
const fake = (status: number, contentType: string, body: unknown = Buffer.from([1, 2, 3])) =>
  ({ status, headers: { 'content-type': contentType }, body, text: '' }) as unknown as Response;

describe('expectToMatchContract with non-JSON responses', () => {
  it('accepts an image/png response of getEventImage', () => {
    expect(() => expectToMatchContract(fake(200, 'image/png'), 'getEventImage')).not.toThrow();
  });

  it('ignores parameters of the Content-Type', () => {
    expect(() =>
      expectToMatchContract(fake(200, 'image/jpeg; charset=binary'), 'getEventImage'),
    ).not.toThrow();
  });

  it('refuses a media type the operation does not declare, naming the declared types', () => {
    expect(() =>
      expectToMatchContract(fake(200, 'application/json', { a: 1 }), 'getEventImage'),
    ).toThrow(/image\/jpeg, image\/png, image\/webp/);
  });

  it('still validates JSON error bodies of the same operation', () => {
    expect(() =>
      expectToMatchContract(
        fake(404, 'application/json; charset=utf-8', {
          error: { code: 'NOT_FOUND', message: 'Image not found.' },
        }),
        'getEventImage',
      ),
    ).not.toThrow();
    expect(() =>
      expectToMatchContract(fake(404, 'application/json', { nope: true }), 'getEventImage'),
    ).toThrow(/does not match the contract/);
  });
});
