import { randomInt } from 'node:crypto';

/** No I, O, 0, or 1: nothing a person could misread at the gate (spec 005 research R3). */
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** 12 symbols from 32: 60 random bits. Uniqueness is guaranteed by the `Ticket_code_key` index. */
export function ticketCode(): string {
  let code = '';
  for (let i = 0; i < 12; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}
