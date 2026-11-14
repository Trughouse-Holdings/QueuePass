import type { PrismaService } from '../../src/prisma/prisma.service';

/**
 * Truncates data between tests WITHOUT dropping the schema.
 *
 * Dropping and recreating would take `event_no_overlap` with it, silently disabling the
 * feature's central invariant for every subsequent test. Truncate only.
 *
 * Children before parents: the venue FK is ON DELETE RESTRICT (FR-013).
 */
export async function resetDb(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(
    // Spec 038: layouts, levels, sections, rows and seats; event prices and off-sale seats.
    'TRUNCATE TABLE "SeatHold", "SeatReservation", "Ticket", "Order", "EventOffSaleSeat", ' +
      '"EventLevelPrice", "TicketTier", "Event", "Seat", "SeatRow", "Section", "PriceLevel", ' +
      '"Layout", "Location" RESTART IDENTITY CASCADE',
  );
}
