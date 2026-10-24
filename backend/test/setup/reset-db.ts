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
    'TRUNCATE TABLE "SeatHold", "SeatReservation", "Ticket", "Order", "SectionTier", "Section", "TicketTier", "Event", "Location" RESTART IDENTITY CASCADE',
  );
}
