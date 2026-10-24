/**
 * Spec 018 (#41), research R2 and R3: the one implementation of live codes. The Customer app
 * makes them and the Backend checks them with these same functions, so the two agree to the bit.
 * Nothing else writes the format, the window arithmetic, or the grace.
 *
 * A live code is `QP1:<TICKET>:<WINDOW>:<MAC>`: the ticket's UUID as 32 upper-case hex digits, the
 * window number in decimal with no leading zero, and the first 10 bytes of
 * HMAC-SHA256(entrySecret, "QP1:<TICKET>:<WINDOW>") in RFC 4648 base32 without padding.
 *
 * Web Crypto only (`globalThis.crypto.subtle`), no Node-only import: this module runs in browsers.
 */

export const LIVE_CODE_PREFIX = 'QP1:';
/** Every window is 30 seconds, the same for every ticket (FR-002). */
export const WINDOW_MS = 30_000;
/** A code is accepted from 5 seconds before its window until 5 seconds after (FR-008). */
export const GRACE_MS = 5_000;

const MAC_BYTES = 10;
const LIVE_CODE = /^QP1:([0-9A-F]{32}):(0|[1-9]\d{0,11}):([A-Z2-7]{16})$/;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** The window an instant (Unix milliseconds) falls in. */
export function windowAt(ms: number): number {
  return Math.floor(ms / WINDOW_MS);
}

/** When window `w` starts, in Unix milliseconds. */
export function windowStartMs(w: number): number {
  return w * WINDOW_MS;
}

/** The live code of one ticket for one window. */
export async function liveCode(
  secret: Uint8Array,
  ticketId: string,
  window: number,
): Promise<string> {
  const message = `${LIVE_CODE_PREFIX}${ticketId.replace(/-/g, '').toUpperCase()}:${window}`;
  // The copy is a Uint8Array<ArrayBuffer>, which BufferSource accepts; Prisma's Bytes and a
  // plain Uint8Array are Uint8Array<ArrayBufferLike>, which TypeScript 5.9 refuses there.
  const key = await globalThis.crypto.subtle.importKey(
    'raw',
    new Uint8Array(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await globalThis.crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return `${message}:${base32(new Uint8Array(mac, 0, MAC_BYTES))}`;
}

/**
 * The parts of a live code, or `null` for anything not exactly in live-code form. `ticketId` is
 * the UUID in lower case with dashes. Letter case and surrounding white space are ignored.
 */
export function parseLiveCode(
  text: string,
): { ticketId: string; window: number; mac: string } | null {
  const m = LIVE_CODE.exec(text.trim().toUpperCase());
  if (!m) return null;
  const hex = m[1].toLowerCase();
  const ticketId = [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
  return { ticketId, window: Number(m[2]), mac: m[3] };
}

/**
 * Whether window `window` is accepted at `nowMs`: `CURRENT` in
 * `[start − GRACE_MS, start + WINDOW_MS + GRACE_MS)`, `EARLY` before, `EXPIRED` after.
 */
export function windowStatus(window: number, nowMs: number): 'EARLY' | 'CURRENT' | 'EXPIRED' {
  const start = windowStartMs(window);
  if (nowMs < start - GRACE_MS) return 'EARLY';
  if (nowMs >= start + WINDOW_MS + GRACE_MS) return 'EXPIRED';
  return 'CURRENT';
}

/** True when the text claims to be a live code (it starts with `QP1:`), well formed or not. */
export function isLiveCodeText(text: string): boolean {
  return text.trim().toUpperCase().startsWith(LIVE_CODE_PREFIX);
}

/** A 32-byte key as base64url without padding: 43 characters. */
export function keyToBase64url(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    const chars = Math.min(4, Math.ceil(((bytes.length - i) * 8) / 6));
    for (let j = 0; j < chars; j++) out += BASE64URL[(n >> (18 - 6 * j)) & 63];
  }
  return out;
}

/** The 32 bytes of a key in base64url without padding, or `null` for anything else. */
export function keyFromBase64url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]{43}$/.test(text)) return null;
  const bytes = new Uint8Array(32);
  let acc = 0;
  let bits = 0;
  let k = 0;
  for (const c of text) {
    acc = (acc << 6) | BASE64URL.indexOf(c);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[k++] = (acc >> bits) & 0xff;
      acc &= (1 << bits) - 1;
    }
  }
  return bytes;
}

function base32(bytes: Uint8Array): string {
  let out = '';
  let acc = 0;
  let bits = 0;
  for (const b of bytes) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32[(acc >> bits) & 31];
    }
    acc &= (1 << bits) - 1;
  }
  if (bits > 0) out += BASE32[(acc << (5 - bits)) & 31];
  return out;
}
