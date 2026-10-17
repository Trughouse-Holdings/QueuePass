import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { LOCKING_TX, lockEvent } from '../common/event-lock';
import { PrismaService } from '../prisma/prisma.service';
import { SeatEventsService } from '../seating/seat-events.service';
import { closeRunOut, toChanges } from './holds';

/**
 * Spec 015 research R4: how often the sweep runs, in milliseconds. A provider rather than an
 * environment variable (Constitution II); `createTestApp` sets it to 0, which starts no timer, and
 * tests call `sweepOnce()` themselves.
 */
export const HOLD_SWEEP_INTERVAL_MS = Symbol('HOLD_SWEEP_INTERVAL_MS');

/**
 * Spec 015 research R4 (SC-003): ends run-out reservations on events where nobody else acts, and
 * tells viewers. Rules never depend on it: every locked path closes run-out reservations first
 * (research R3). One indexed query a second when nothing has run out.
 */
@Injectable()
export class HoldSweeper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HoldSweeper.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly seatEvents: SeatEventsService,
    @Inject(HOLD_SWEEP_INTERVAL_MS) private readonly intervalMs: number,
  ) {}

  onModuleInit(): void {
    if (this.intervalMs <= 0) return;
    this.timer = setInterval(() => {
      // A failing sweep is logged and tried again next time; it never crashes the Backend.
      this.sweepOnce().catch((err: unknown) =>
        this.logger.error('Seat hold sweep failed', err instanceof Error ? err.stack : err),
      );
    }, this.intervalMs);
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  /** One pass: each event with a run-out reservation, in its own transaction under its lock. */
  async sweepOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      // seat_reservation_open_by_expiry serves this.
      const due = await this.prisma.$queryRaw<{ eventId: string }[]>`
        SELECT DISTINCT "eventId" FROM "SeatReservation"
        WHERE "endedAt" IS NULL AND "expiresAt" <= now()
        ORDER BY "eventId"`;
      for (const { eventId } of due) await this.sweepEvent(eventId);
    } finally {
      this.running = false;
    }
  }

  private async sweepEvent(eventId: string): Promise<void> {
    try {
      const changes = await this.prisma.$transaction(async (tx) => {
        const event = await lockEvent(tx, eventId);
        const freed = await closeRunOut(tx, eventId);
        return toChanges(tx, event.locationId, freed, 'open');
      }, LOCKING_TX);
      this.seatEvents.publish(eventId, changes);
    } catch (err) {
      // Deleted meanwhile: its reservations went with it.
      if (!(err instanceof NotFoundException)) throw err;
    }
  }
}
