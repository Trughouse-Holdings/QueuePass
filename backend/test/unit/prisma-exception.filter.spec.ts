import { ArgumentsHost, HttpException, PayloadTooLargeException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AllExceptionsFilter } from '../../src/common/filters/prisma-exception.filter';

/**
 * Spec 014 research R2, R3: the IMAGE_TOO_LARGE envelope passes through with its `413`, any other
 * `413` is generic, and a violation of `event_image_position_unique` is `409 IMAGES_CHANGED`, not
 * the older `P2002` fallback.
 */
function run(exception: unknown): { status: number; body: unknown } {
  const out = { status: 0, body: undefined as unknown };
  const response = {
    status(code: number) {
      out.status = code;
      return response;
    },
    json(body: unknown) {
      out.body = body;
      return response;
    },
    setHeader() {
      return response;
    },
  };
  const host = {
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost;
  new AllExceptionsFilter().catch(exception, host);
  return out;
}

const known = (code: string, meta: Record<string, unknown>, message = 'failed') =>
  new Prisma.PrismaClientKnownRequestError(message, { code, clientVersion: '6', meta });

const imagesChanged = {
  status: 409,
  body: {
    error: {
      code: 'IMAGES_CHANGED',
      message: "The event's images changed since you loaded them. Check them and try again.",
    },
  },
};

describe('AllExceptionsFilter, spec 014', () => {
  it('maps a P2002 whose target names event_image_position_unique to IMAGES_CHANGED', () => {
    expect(run(known('P2002', { target: 'event_image_position_unique' }))).toEqual(imagesChanged);
  });

  it('maps a P2002 on EventImage (eventId, position), as Prisma 6 reports it, to IMAGES_CHANGED', () => {
    expect(
      run(known('P2002', { modelName: 'EventImage', target: ['eventId', 'position'] })),
    ).toEqual(imagesChanged);
  });

  it('maps a raw-query 23505 naming the constraint to IMAGES_CHANGED', () => {
    const message =
      'Raw query failed. Code: `23505`. Message: `duplicate key value violates unique constraint "event_image_position_unique"`';
    expect(run(known('P2010', { code: '23505', message }, message))).toEqual(imagesChanged);
    expect(
      run(new Prisma.PrismaClientUnknownRequestError(message, { clientVersion: '6' })),
    ).toEqual(imagesChanged);
  });

  it('maps a raw-query 23505 on the key ("eventId", "position"), as Prisma 6 reports it', () => {
    const message =
      'Raw query failed. Code: `23505`. Message: `Key ("eventId", "position")=(0f8f7a8e-5a39-4c1e-9b7e-2d3c4b5a6f70, 2) already exists.`';
    expect(run(known('P2010', { code: '23505', message }, message))).toEqual(imagesChanged);
  });

  it('still maps a tier-name P2002 to TIER_NAME_TAKEN', () => {
    expect(run(known('P2002', { modelName: 'TicketTier', target: ['eventId', 'name'] }))).toEqual({
      status: 409,
      body: {
        error: {
          code: 'TIER_NAME_TAKEN',
          message: 'Another tier of this event already has that name. Choose a different name.',
        },
      },
    });
  });

  it('passes an IMAGE_TOO_LARGE envelope through with its 413', () => {
    const body = {
      error: {
        code: 'IMAGE_TOO_LARGE',
        message: 'An image can be at most 5 MB.',
        details: { maxBytes: 5242880 },
      },
    };
    expect(run(new HttpException(body, 413))).toEqual({ status: 413, body });
  });

  // Review of PR #63: only the image upload says "image"; any other 413 is a generic refusal.
  it('answers any other 413 with a generic envelope, not IMAGE_TOO_LARGE', () => {
    const generic = {
      status: 413,
      body: { error: { code: 'VALIDATION_FAILED', message: 'The request body is too large.' } },
    };
    expect(run(new PayloadTooLargeException('File too large'))).toEqual(generic);
    expect(run(new HttpException('too big', 413))).toEqual(generic);
  });

  // Review of PR #63: the raw-statement fallback reads Prisma's structured fields only.
  it('does not map an Error that Prisma did not throw to IMAGES_CHANGED, whatever its text', () => {
    const text =
      'Code: `23505` duplicate key "event_image_position_unique" Key ("eventId", "position")';
    expect(run(new Error(text)).status).toBe(500);
    const withMeta = Object.assign(new Error('failed'), { meta: { code: '23505', message: text } });
    expect(run(withMeta).status).toBe(500);
  });

  it('does not map a P2010 whose SQLSTATE is not 23505, though its message quotes the constraint', () => {
    const message = 'value "23505 event_image_position_unique" violates check constraint "x"';
    expect(
      run(known('P2010', { code: '23514', message }, `Raw query failed. ${message}`)).status,
    ).toBe(500);
  });
});
