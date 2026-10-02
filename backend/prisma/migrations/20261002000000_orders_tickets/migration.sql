-- Spec 005: orders, tickets, and event cancellation.
-- See specs/005-admin-orders-reporting/data-model.md.

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('SCHEDULED', 'CANCELLED');
CREATE TYPE "OrderStatus" AS ENUM ('CONFIRMED', 'REFUNDED');
CREATE TYPE "TicketStatus" AS ENUM ('VALID', 'VOID');

-- AlterTable: existing events are scheduled.
ALTER TABLE "Event"
    ADD COLUMN "status" "EventStatus" NOT NULL DEFAULT 'SCHEDULED',
    ADD COLUMN "cancelledAt" TIMESTAMPTZ(6);

ALTER TABLE "Event"
    ADD CONSTRAINT "event_cancelled_at_matches_status"
    CHECK (("status" = 'CANCELLED') = ("cancelledAt" IS NOT NULL));

-- ---------------------------------------------------------------------------
-- The scheduling rule now ignores cancelled events (FR-009): a cancelled event frees its
-- venue's time. Same expression as 20260920000001_scheduling_constraints, plus the WHERE
-- clause. Everything that migration says about why this constraint, not the service's
-- pre-check, is the enforcement still holds.
-- ---------------------------------------------------------------------------
ALTER TABLE "Event" DROP CONSTRAINT "event_no_overlap";
ALTER TABLE "Event"
    ADD CONSTRAINT "event_no_overlap"
    EXCLUDE USING gist (
        "locationId" WITH =,
        queuepass_event_window("startsAt", "endsAt") WITH &&
    ) WHERE ("status" = 'SCHEDULED');

-- CreateTable
CREATE TABLE "Order" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "tierId" UUID,
    "customerSub" TEXT NOT NULL,
    "customerUsername" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "totalPrice" DECIMAL(10,2) NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'CONFIRMED',
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "refundedAt" TIMESTAMPTZ(6),

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Ticket" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "tierId" UUID,
    "code" TEXT NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'VALID',
    "checkedInAt" TIMESTAMPTZ(6),

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Order_eventId_idx" ON "Order"("eventId");
CREATE INDEX "Order_tierId_idx" ON "Order"("tierId");
CREATE UNIQUE INDEX "Ticket_code_key" ON "Ticket"("code");
CREATE INDEX "Ticket_orderId_idx" ON "Ticket"("orderId");
CREATE INDEX "Ticket_eventId_status_idx" ON "Ticket"("eventId", "status");
CREATE INDEX "Ticket_tierId_idx" ON "Ticket"("tierId");

-- AddForeignKey: RESTRICT everywhere, so no client can erase an event or tier that sold
-- tickets (FR-010). The services check first only to name the refusal.
ALTER TABLE "Order" ADD CONSTRAINT "Order_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_tierId_fkey"
    FOREIGN KEY ("tierId") REFERENCES "TicketTier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_orderId_fkey"
    FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_tierId_fkey"
    FOREIGN KEY ("tierId") REFERENCES "TicketTier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Field rules. They duplicate request validation on purpose: validation produces readable
-- errors, the constraints guarantee no client can write invalid rows.
ALTER TABLE "Order"
    ADD CONSTRAINT "order_quantity_range" CHECK ("quantity" BETWEEN 1 AND 10);
ALTER TABLE "Order"
    ADD CONSTRAINT "order_prices_non_negative" CHECK ("unitPrice" >= 0 AND "totalPrice" >= 0);
ALTER TABLE "Order"
    ADD CONSTRAINT "order_total_matches" CHECK ("totalPrice" = "unitPrice" * "quantity");
ALTER TABLE "Order"
    ADD CONSTRAINT "order_refunded_at_matches_status"
    CHECK (("status" = 'REFUNDED') = ("refundedAt" IS NOT NULL));
ALTER TABLE "Ticket"
    ADD CONSTRAINT "ticket_code_format" CHECK ("code" ~ '^[A-Z2-9]{12}$');

-- The cross-row rules (valid tickets <= tier quantity and <= event capacity) cannot be CHECK
-- constraints. The Backend enforces them under the event-row lock (research R2).
