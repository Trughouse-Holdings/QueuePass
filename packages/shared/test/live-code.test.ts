// @vitest-environment node
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  GRACE_MS,
  LIVE_CODE_PREFIX,
  WINDOW_MS,
  isLiveCodeText,
  keyFromBase64url,
  keyToBase64url,
  liveCode,
  parseLiveCode,
  windowAt,
  windowStartMs,
  windowStatus,
} from '../src/live-code';

/**
 * Spec 018 research R2, R3: the one implementation of live codes, shared by the Backend and the
 * Customer app. The MAC is checked against `node:crypto` and a reference base32 encoder written
 * here, so a mistake in the Web Crypto path can't hide behind itself.
 */

const LIVE = /^QP1:[0-9A-F]{32}:(0|[1-9]\d{0,11}):[A-Z2-7]{16}$/;

/** RFC 4648 base32, upper case, no padding: the reference the module must agree with. */
function base32(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i < bits.length; i += 5)
    out += alphabet[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  return out;
}

function expected(secret: Uint8Array, ticketId: string, window: number): string {
  const hex = ticketId.replace(/-/g, '').toUpperCase();
  const message = `QP1:${hex}:${window}`;
  const mac = createHmac('sha256', secret).update(message).digest().subarray(0, 10);
  return `${message}:${base32(new Uint8Array(mac))}`;
}

const VECTORS = [
  {
    secret: new Uint8Array(32).fill(0x00),
    ticketId: '3b8e5f0a-6c1d-4b7e-9a2f-1d0c3e4b5a69',
    window: 0,
  },
  {
    secret: new Uint8Array(32).fill(0xff),
    ticketId: '00000000-0000-4000-8000-000000000000',
    window: 58773103,
  },
  {
    secret: Uint8Array.from({ length: 32 }, (_, i) => i),
    ticketId: 'ffffffff-ffff-4fff-bfff-ffffffffffff',
    window: 999999999,
  },
];

describe('constants', () => {
  it('are the values of research R2 and R3', () => {
    expect(LIVE_CODE_PREFIX).toBe('QP1:');
    expect(WINDOW_MS).toBe(30_000);
    expect(GRACE_MS).toBe(5_000);
  });
});

describe('windowAt', () => {
  it('is floor(ms / 30000)', () => {
    expect(windowAt(0)).toBe(0);
    expect(windowAt(29_999)).toBe(0);
    expect(windowAt(30_000)).toBe(1);
    expect(windowStartMs(58773103)).toBe(58773103 * 30_000);
  });
});

describe('liveCode', () => {
  it.each(VECTORS)(
    'matches node:crypto for window $window',
    async ({ secret, ticketId, window }) => {
      const code = await liveCode(secret, ticketId, window);
      expect(code).toBe(expected(secret, ticketId, window));
      expect(code).toMatch(LIVE);
    },
  );

  it('is 62 characters for an 8-digit window', async () => {
    const { secret, ticketId } = VECTORS[1];
    expect(await liveCode(secret, ticketId, 58773103)).toHaveLength(62);
  });
});

describe('parseLiveCode', () => {
  it.each(VECTORS)('round-trips window $window', async ({ secret, ticketId, window }) => {
    const code = await liveCode(secret, ticketId, window);
    expect(parseLiveCode(code)).toEqual({ ticketId, window, mac: code.slice(-16) });
    // Lower case and surrounding white space are accepted (it upper-cases first).
    expect(parseLiveCode(`  ${code.toLowerCase()} `)).toEqual({
      ticketId,
      window,
      mac: code.slice(-16),
    });
  });

  it('parses window 0 alone', () => {
    expect(parseLiveCode(`QP1:${'A'.repeat(32)}:0:${'B'.repeat(16)}`)).toEqual({
      ticketId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      window: 0,
      mac: 'B'.repeat(16),
    });
  });

  it('refuses everything else', async () => {
    const { secret, ticketId } = VECTORS[1];
    const good = await liveCode(secret, ticketId, 58773103);
    const [, hex, , mac] = good.split(':');
    const refused = [
      '7KQ2M9XWAB4C',
      good.replace('QP1:', 'QP2:'),
      `QP1:${hex.slice(1)}:58773103:${mac}`,
      `QP1:${hex}A:58773103:${mac}`,
      `QP1:${hex}:58773103:${mac.slice(1)}`,
      `QP1:${hex}:58773103:${mac.slice(0, 15)}1`,
      `QP1:${hex}:58773103:${mac.slice(0, 15)}0`,
      `QP1:${hex}:58773103:${mac.slice(0, 15)}8`,
      `QP1:${hex}:+58773103:${mac}`,
      `QP1:${hex}:-58773103:${mac}`,
      `QP1:${hex}:5877310.3:${mac}`,
      `QP1:${hex}:1234567890123:${mac}`,
      // Window 58773103's genuine MAC behind a leading zero: QueuePass never writes one (FR-011).
      `QP1:${hex}:058773103:${mac}`,
      `${good}A`,
      `${good}:`,
      'QP1:',
      '',
    ];
    for (const text of refused) expect(parseLiveCode(text)).toBeNull();
  });
});

describe('windowStatus', () => {
  const w = 58773103;
  const start = w * 30_000;

  it.each([
    [start - 5001, 'EARLY'],
    [start - 5000, 'CURRENT'],
    [start, 'CURRENT'],
    [start + 34_999, 'CURRENT'],
    [start + 35_000, 'EXPIRED'],
  ] as const)('at %d is %s', (now, status) => {
    expect(windowStatus(w, now)).toBe(status);
  });
});

describe('isLiveCodeText', () => {
  it('is true for anything starting with QP1: after trim and upper-case', () => {
    expect(isLiveCodeText('QP1:')).toBe(true);
    expect(isLiveCodeText('  qp1:xyz')).toBe(true);
    expect(isLiveCodeText('7KQ2M9XWAB4C')).toBe(false);
    expect(isLiveCodeText('QP2:')).toBe(false);
  });
});

describe('keyToBase64url / keyFromBase64url', () => {
  it('round-trip 32 bytes as 43 characters of [A-Za-z0-9_-]', () => {
    for (const { secret } of VECTORS) {
      const text = keyToBase64url(secret);
      expect(text).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(text).toBe(Buffer.from(secret).toString('base64url'));
      expect(keyFromBase64url(text)).toEqual(secret);
    }
  });

  it('refuses any other length or alphabet', () => {
    const good = keyToBase64url(VECTORS[2].secret);
    for (const text of [
      good.slice(1),
      `${good}A`,
      `${good.slice(1)}+`,
      `${good.slice(1)}/`,
      `${good.slice(1)}=`,
    ]) {
      expect(keyFromBase64url(text)).toBeNull();
    }
  });
});
