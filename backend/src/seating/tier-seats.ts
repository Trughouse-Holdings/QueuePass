import type { Prisma } from '@prisma/client';

/**
 * Spec 007 FR-006 (research R11): on a seated event, each tier's quantity is the seats in the
 * sections mapped to it, stored so every spec 004–006 rule that reads it keeps working. Call it
 * inside a transaction that holds the event's lock, after any change to mappings or the layout.
 */
export async function recalcSeatedTiers(
  tx: Prisma.TransactionClient,
  eventId: string,
): Promise<void> {
  const tiers = await tx.ticketTier.findMany({
    where: { eventId },
    include: { sections: { include: { section: true } } },
  });
  for (const tier of tiers) {
    const quantity = tier.sections.reduce((n, m) => n + m.section.rows * m.section.seatsPerRow, 0);
    if (quantity !== tier.quantity) {
      await tx.ticketTier.update({ where: { id: tier.id }, data: { quantity } });
    }
  }
}
