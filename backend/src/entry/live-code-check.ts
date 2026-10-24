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
 * Spec 018 research R4: verifies a live code and returns its ticket's id, or throws. In order:
 * parse it, load the ticket's secret (the one `select` that names it besides the entry key), check
 * the MAC for the window the code names in constant time, then check that window on the Backend's
 * clock. The MAC comes before the window, so a forged code is always "not valid", never "expired",
 * and an expired code says nothing about its ticket.
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
  if (!ticket) throw invalid();

  const expected = (await liveCode(ticket.entrySecret, parsed.ticketId, parsed.window)).slice(-16);
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(parsed.mac))) throw invalid();

  if (windowStatus(parsed.window, clock.now()) !== 'CURRENT') {
    throw conflict('LIVE_CODE_EXPIRED', 'This live code has expired.');
  }
  return parsed.ticketId;
}
