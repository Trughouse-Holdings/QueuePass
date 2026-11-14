import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { VenueMap, VenueMapSection } from '@queuepass/shared';
import { PrismaService } from '../prisma/prisma.service';
import { countSeatStates, sectionSeatStates } from './seat-levels';

type Tx = Prisma.TransactionClient;
type Point = [number, number];

/** Map units as stored (REAL), to 7 significant digits, as the layout routes give them. */
const real = (v: number): number => Number(v.toPrecision(7));

/**
 * The reads see one snapshot of the database, so the drawing, prices and counts agree; the
 * counts and `seq` also come from one statement (research R12).
 */
const SNAPSHOT = { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead } as const;

/**
 * Spec 038 research R11 (FR-016, FR-028, FR-029): an event's venue map, as every caller sees it.
 * The overview draws sections, not seats, with counts per level and state; seats come one section
 * at a time. Neither names who holds or bought a seat; a customer's own seats come from
 * `listMyReservations`. Reads only: no lock is taken (holds, orders and saves lock the event).
 */
@Injectable()
export class VenueMapService {
  constructor(private readonly prisma: PrismaService) {}

  /** `getVenueMap`; also the first message of `streamSeatMap` (research R12). */
  map(eventId: string): Promise<VenueMap> {
    return this.prisma.$transaction(async (tx) => {
      const layoutId = await seatedLayout(tx, eventId);
      const layout = await tx.layout.findUniqueOrThrow({
        where: { id: layoutId },
        include: {
          levels: { orderBy: { rank: 'asc' } },
          sections: { orderBy: { position: 'asc' } },
        },
      });
      const prices = new Map(
        (await tx.eventLevelPrice.findMany({ where: { eventId } })).map((p) => [
          p.levelId,
          p.price.toFixed(2),
        ]),
      );
      const { seq, counts } = await countSeatStates(tx, eventId);
      // A level's price shows only while it has seats on sale (contract `VenueMap.levels`).
      const onSale = new Set(
        counts.filter((c) => c.open + c.reserved + c.sold > 0).map((c) => c.levelId),
      );
      return {
        eventId,
        seq: Number(seq),
        layoutId: layout.id,
        layoutName: layout.name,
        size: { width: layout.width, height: layout.height },
        floorKind: layout.floorKind,
        floorOutline: (layout.floorOutline as Point[] | null) ?? null,
        levels: layout.levels.map((l) => ({
          levelId: l.id,
          name: l.name,
          rank: l.rank,
          color: l.color as VenueMap['levels'][number]['color'],
          price: onSale.has(l.id) ? (prices.get(l.id) ?? null) : null,
        })),
        sections: layout.sections.map((s) => ({
          sectionId: s.id,
          name: s.name,
          outline: s.outline as Point[],
          labelAt: [real(s.labelX), real(s.labelY)] as Point,
          counts: counts
            .filter((c) => c.sectionId === s.id)
            .map(({ levelId, open, reserved, sold, offSale }) => ({
              levelId,
              open,
              reserved,
              sold,
              offSale,
            })),
        })),
      };
    }, SNAPSHOT);
  }

  /** `getVenueMapSection`: one section of the event's layout, seat by seat. */
  section(eventId: string, sectionId: string): Promise<VenueMapSection> {
    return this.prisma.$transaction(async (tx) => {
      const layoutId = await seatedLayout(tx, eventId);
      const section = await tx.section.findFirst({
        where: { id: sectionId, layoutId },
        select: { name: true },
      });
      if (!section) {
        throw new NotFoundException(`This event's layout has no section with id ${sectionId}.`);
      }
      const { seq, seats } = await sectionSeatStates(tx, eventId, sectionId);
      const rows: VenueMapSection['rows'] = [];
      for (const s of seats) {
        let row = rows[rows.length - 1];
        if (!row || row.number !== s.row) {
          row = { number: s.row, label: s.rowLabel, seats: [] };
          rows.push(row);
        }
        row.seats.push({
          number: s.seat,
          label: s.label,
          at: [real(s.x), real(s.y)],
          levelId: s.levelId,
          state: s.state,
          accessible: s.accessible,
        });
      }
      return { eventId, seq: Number(seq), sectionId, name: section.name, rows };
    }, SNAPSHOT);
  }
}

/** The event's layout, or 404: no event, or a general-admission event (research R11). */
async function seatedLayout(tx: Tx, eventId: string): Promise<string> {
  const event = await tx.event.findUnique({
    where: { id: eventId },
    select: { name: true, layoutId: true },
  });
  if (!event) throw new NotFoundException(`No event exists with id ${eventId}.`);
  if (event.layoutId === null) {
    throw new NotFoundException(
      `${event.name} is general admission: it has no seat map. Its tickets are not for seats.`,
    );
  }
  return event.layoutId;
}
