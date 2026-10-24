import { timingSafeEqual } from 'node:crypto';
import { HttpException, HttpStatus } from '@nestjs/common';
import { liveCode, parseLiveCode, windowStatus } from '@queuepass/shared';
import type { Clock } from '../common/clock';
import { conflict } from '../common/conflict';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * A 404 in the standard envelope with its own code (contracts/openapi.yaml `EntryNotFound`): the
 * same answer for a malformed code, an unknown ticket, and a wrong MAC, with no details (FR-011).
 */
const invalid = (): HttpException =>
  new HttpException(
    { error: { code: 'LIVE_CODE_INVALID', message: 'This is not a valid QueuePass code.' } },
    HttpStatus.NOT_FOUND,
  );

/**
 * Spec 018 research R4: the secret an unknown ticket's code is checked with, so a guessed ticket id
 * costs the same HMAC and comparison as a real one and the time taken doesn't tell them apart.
 */
const STAND_IN_SECRET = new Uint8Array(32);

/**
 * Spec 018 research R4: verifies a live code and returns its ticket's id, or throws. In order:
 * parse it, load the ticket's secret (the one `select` that names it besides the entry key), remake
 * the code for the window it names and compare the whole of it in constant time, then check that
 * window on the Backend's clock. The MAC comes before the window, so a forged code is always "not
 * valid", never "expired", and an expired code says nothing about its ticket.
 */
export async function checkLiveCode(
  prisma: PrismaService,
  clock: Clock,
  text: string,
): Promise<string> {
  const parsed = parseLiveCode(text);
  if (!parsed) throw invalid();
  const ticket = await prisma.ticket.findUnique({
    where: { id: parsed.ticketId },
    select: { entrySecret: true },
  });

  // parseLiveCode matched the trimmed, upper-cased text, which is how liveCode writes a code.
  const presented = Buffer.from(text.trim().toUpperCase());
  const expected = Buffer.from(
    await liveCode(ticket?.entrySecret ?? STAND_IN_SECRET, parsed.ticketId, parsed.window),
  );
  const same = expected.length === presented.length && timingSafeEqual(expected, presented);
  // An unknown ticket is refused whatever the comparison says: a code made with the stand-in
  // secret itself must not pass.
  if (!ticket || !same) throw invalid();

  if (windowStatus(parsed.window, clock.now()) !== 'CURRENT') {
    throw conflict('LIVE_CODE_EXPIRED', 'This live code has expired.');
  }
  return parsed.ticketId;
}
