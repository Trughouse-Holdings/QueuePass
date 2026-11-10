import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
} from '@nestjs/common';
import { CHECK_IN_RETENTION_DAYS } from '@queuepass/shared';
import { CLOCK, type Clock } from '../common/clock';
import { LOCKING_TX, lockEvent } from '../common/event-lock';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Spec 032 (data-model.md): how often the retention job runs once started, in milliseconds. A
 * provider, as the hold sweep's interval (spec 015 research R4); `EntryModule` sets 1 hour.
 */
export const CHECK_IN_RETENTION_INTERVAL_MS = Symbol('CHECK_IN_RETENTION_INTERVAL_MS');

const DAY_MS = 86_400_000;

/**
 * Spec 032 research R3, R5: an event is due once `endsAt <= now − CHECK_IN_RETENTION_DAYS × 24 h`.
 * Exact hours, computed here and never with SQL interval arithmetic, which adds calendar days in
 * the session's zone (an hour off across a daylight-saving change; review rounds 1 S3, 2 S1).
 */
export const retentionBound = (now: Date): Date =>
  new Date(now.getTime() - CHECK_IN_RETENTION_DAYS * DAY_MS);

/**
 * Spec 032 US1 (FR-001 to FR-006; research R5): one week after an event ends, removes when each of
 * its tickets was admitted and by which agent, and keeps the event's checked-in count, in one
 * transaction under the event lock. Shaped like `HoldSweeper`, but with **no lifecycle hook that
 * runs it**: the demo data and demo reset commands build the whole application with
 * `createApplicationContext`, which runs every hook, so only `main.ts`, the Backend that serves the
 * API, calls `start()` (FR-006, SC-007; review round 1, M1).
 */
@Injectable()
export class CheckInRetention implements OnModuleDestroy {
  private readonly logger = new Logger(CheckInRetention.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(CHECK_IN_RETENTION_INTERVAL_MS) private readonly intervalMs: number,
  ) {}

  /** One run at once (so a Backend down at the cutoff catches up on start), then every interval. */
  start(): void {
    this.runLogged();
    if (this.intervalMs > 0) this.timer = setInterval(() => this.runLogged(), this.intervalMs);
  }

  onModuleDestroy(): void {
    clearInterval(this.timer);
  }

  /** A failing run is logged and tried again next time; it never stops the Backend (FR-006). */
  private runLogged(): void {
    this.removeDue().catch((err: unknown) =>
      this.logger.error('Check-in retention failed', err instanceof Error ? err.stack : err),
    );
  }

  /** One run: every due event not yet removed, each in its own transaction under its lock. */
  async removeDue(now: Date = new Date(this.clock.now())): Promise<{ eventIds: string[] }> {
    if (this.running) return { eventIds: [] };
    this.running = true;
    try {
      const bound = retentionBound(now);
      const due = await this.prisma.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Event"
        WHERE "checkInDetailsRemovedAt" IS NULL AND "endsAt" <= ${bound}::timestamptz
        ORDER BY "endsAt", "id"`;
      const eventIds: string[] = [];
      for (const { id } of due) {
        // One event failing (a lock timeout, say) never holds up the others.
        try {
          if (await this.removeEvent(id, now)) eventIds.push(id);
        } catch (err) {
          this.logger.error(
            `Check-in retention failed for event ${id}`,
            err instanceof Error ? err.stack : err,
          );
        }
      }
      if (eventIds.length > 0) {
        this.logger.log(
          `Removed check-in details of ${eventIds.length} ${eventIds.length === 1 ? 'event' : 'events'}`,
        );
      }
      return { eventIds };
    } finally {
      this.running = false;
    }
  }

  /**
   * Removes one event's check-in details if it is still due and not yet removed, checked again
   * under its lock, so two runs (or two Backends) remove it once (FR-005). `false` when there was
   * nothing to do: removed meanwhile, its end moved later, or the event deleted.
   */
  async removeEvent(eventId: string, now: Date): Promise<boolean> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await lockEvent(tx, eventId);
        const event = await tx.event.findUniqueOrThrow({
          where: { id: eventId },
          select: { endsAt: true, checkInDetailsRemovedAt: true },
        });
        if (event.checkInDetailsRemovedAt !== null) return false;
        if (event.endsAt.getTime() > retentionBound(now).getTime()) return false;
        // Research R4: the figure the sales report shows today.
        const kept = await tx.ticket.count({
          where: { eventId, status: 'VALID', checkedInAt: { not: null } },
        });
        await tx.$executeRaw`
          UPDATE "Ticket"
          SET "checkedInAt" = NULL, "checkedInBySub" = NULL, "checkedInByUsername" = NULL
          WHERE "eventId" = ${eventId}::uuid
            AND ("checkedInAt" IS NOT NULL OR "checkedInBySub" IS NOT NULL)`;
        await tx.$executeRaw`
          UPDATE "Event" SET "checkInDetailsRemovedAt" = ${now}::timestamptz,
                             "keptCheckedInCount" = ${kept}
          WHERE "id" = ${eventId}::uuid`;
        return true;
      }, LOCKING_TX);
    } catch (err) {
      // Deleted meanwhile: nothing left to remove.
      if (err instanceof NotFoundException) return false;
      throw err;
    }
  }
}
