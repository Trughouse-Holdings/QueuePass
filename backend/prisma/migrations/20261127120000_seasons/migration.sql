-- Spec 041 (data-model.md, research R1, R7): Seasons, their events, prices, passes, and pass holds;
-- an order's pass; a reservation's pass hold. The shared contract for specs 041 and 042.

-- CreateEnum
CREATE TYPE "SeasonStatus" AS ENUM ('DRAFT', 'ON_SALE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Sport" AS ENUM ('BASKETBALL', 'FOOTBALL', 'BASEBALL', 'SOCCER', 'HOCKEY', 'VOLLEYBALL');

-- CreateEnum
CREATE TYPE "SeasonPassStatus" AS ENUM ('ACTIVE', 'REFUNDED');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "seasonPassId" UUID;

-- AlterTable
ALTER TABLE "SeatReservation" ADD COLUMN     "passHoldId" UUID;

-- CreateTable
CREATE TABLE "Season" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "sport" "Sport",
    "team" VARCHAR(100),
    "locationId" UUID NOT NULL,
    "layoutId" UUID,
    "status" "SeasonStatus" NOT NULL DEFAULT 'DRAFT',
    "salesEndAt" TIMESTAMPTZ(6) NOT NULL,
    "singleSalesOpenAt" TIMESTAMPTZ(6),
    "maxPassesPerCustomer" INTEGER,
    "publishedAt" TIMESTAMPTZ(6),
    "cancelledAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Season_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeasonEvent" (
    "eventId" UUID NOT NULL,
    "seasonId" UUID NOT NULL,

    CONSTRAINT "SeasonEvent_pkey" PRIMARY KEY ("eventId")
);

-- CreateTable
CREATE TABLE "SeasonPrice" (
    "id" UUID NOT NULL,
    "seasonId" UUID NOT NULL,
    "levelId" UUID,
    "tierName" VARCHAR(100),
    "price" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "SeasonPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeasonPass" (
    "id" UUID NOT NULL,
    "seasonId" UUID NOT NULL,
    "customerSub" TEXT NOT NULL,
    "customerUsername" TEXT NOT NULL,
    "holderName" VARCHAR(100) NOT NULL,
    "seatId" UUID,
    "seatSection" VARCHAR(50),
    "seatRowLabel" VARCHAR(5),
    "seatLabel" VARCHAR(5),
    "levelId" UUID,
    "tierName" VARCHAR(100),
    "totalPrice" DECIMAL(10,2) NOT NULL,
    "status" "SeasonPassStatus" NOT NULL DEFAULT 'ACTIVE',
    "requestId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "refundedAt" TIMESTAMPTZ(6),

    CONSTRAINT "SeasonPass_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeasonPassHold" (
    "id" UUID NOT NULL,
    "seasonId" UUID NOT NULL,
    "customerSub" TEXT NOT NULL,
    "seatId" UUID,
    "createdAt" TIMESTAMPTZ(6) NOT NULL,
    "expiresAt" TIMESTAMPTZ(6) NOT NULL,
    "endedAt" TIMESTAMPTZ(6),

    CONSTRAINT "SeasonPassHold_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Season_locationId_idx" ON "Season"("locationId");

-- CreateIndex
CREATE INDEX "Season_layoutId_idx" ON "Season"("layoutId");

-- CreateIndex
CREATE INDEX "Season_status_idx" ON "Season"("status");

-- CreateIndex
CREATE INDEX "SeasonEvent_seasonId_idx" ON "SeasonEvent"("seasonId");

-- CreateIndex
CREATE INDEX "SeasonPrice_seasonId_idx" ON "SeasonPrice"("seasonId");

-- CreateIndex
CREATE INDEX "SeasonPrice_levelId_idx" ON "SeasonPrice"("levelId");

-- CreateIndex
CREATE INDEX "SeasonPass_seasonId_idx" ON "SeasonPass"("seasonId");

-- CreateIndex
CREATE INDEX "SeasonPass_seatId_idx" ON "SeasonPass"("seatId");

-- CreateIndex
CREATE INDEX "SeasonPass_levelId_idx" ON "SeasonPass"("levelId");

-- CreateIndex
CREATE INDEX "SeasonPass_customerSub_createdAt_idx" ON "SeasonPass"("customerSub", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SeasonPass_customerSub_requestId_key" ON "SeasonPass"("customerSub", "requestId");

-- CreateIndex
CREATE INDEX "SeasonPassHold_seasonId_idx" ON "SeasonPassHold"("seasonId");

-- CreateIndex
CREATE INDEX "SeasonPassHold_seatId_idx" ON "SeasonPassHold"("seatId");

-- CreateIndex
CREATE INDEX "SeasonPassHold_customerSub_idx" ON "SeasonPassHold"("customerSub");

-- CreateIndex
CREATE INDEX "Order_seasonPassId_idx" ON "Order"("seasonPassId");

-- CreateIndex
CREATE INDEX "SeatReservation_passHoldId_idx" ON "SeatReservation"("passHoldId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_seasonPassId_fkey" FOREIGN KEY ("seasonPassId") REFERENCES "SeasonPass"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeatReservation" ADD CONSTRAINT "SeatReservation_passHoldId_fkey" FOREIGN KEY ("passHoldId") REFERENCES "SeasonPassHold"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Season" ADD CONSTRAINT "Season_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Season" ADD CONSTRAINT "Season_layoutId_fkey" FOREIGN KEY ("layoutId") REFERENCES "Layout"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeasonEvent" ADD CONSTRAINT "SeasonEvent_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeasonEvent" ADD CONSTRAINT "SeasonEvent_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeasonPrice" ADD CONSTRAINT "SeasonPrice_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeasonPrice" ADD CONSTRAINT "SeasonPrice_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "PriceLevel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeasonPass" ADD CONSTRAINT "SeasonPass_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeasonPass" ADD CONSTRAINT "SeasonPass_seatId_fkey" FOREIGN KEY ("seatId") REFERENCES "Seat"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeasonPass" ADD CONSTRAINT "SeasonPass_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "PriceLevel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeasonPassHold" ADD CONSTRAINT "SeasonPassHold_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeasonPassHold" ADD CONSTRAINT "SeasonPassHold_seatId_fkey" FOREIGN KEY ("seatId") REFERENCES "Seat"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Spec 041 FR-002 (data-model.md): Season rules a single row can state.
ALTER TABLE "Season" ADD CONSTRAINT "season_name_length"
    CHECK (char_length(btrim("name")) BETWEEN 1 AND 100 AND "name" = btrim("name"));
ALTER TABLE "Season" ADD CONSTRAINT "season_team_length"
    CHECK ("team" IS NULL OR (char_length(btrim("team")) BETWEEN 1 AND 100 AND "team" = btrim("team")));
ALTER TABLE "Season" ADD CONSTRAINT "season_sport_team_together"
    CHECK (("sport" IS NULL) = ("team" IS NULL));
ALTER TABLE "Season" ADD CONSTRAINT "season_max_passes_range"
    CHECK ("maxPassesPerCustomer" IS NULL OR "maxPassesPerCustomer" BETWEEN 1 AND 10);
ALTER TABLE "Season" ADD CONSTRAINT "season_presale_before_sales_end"
    CHECK ("singleSalesOpenAt" IS NULL OR "singleSalesOpenAt" <= "salesEndAt");
ALTER TABLE "Season" ADD CONSTRAINT "season_published_when_not_draft"
    CHECK (("publishedAt" IS NULL) = ("status" = 'DRAFT'));
ALTER TABLE "Season" ADD CONSTRAINT "season_cancelled_together"
    CHECK (("cancelledAt" IS NOT NULL) = ("status" = 'CANCELLED'));

-- Spec 041 FR-009: one target per price, once per Season, never negative.
ALTER TABLE "SeasonPrice" ADD CONSTRAINT "season_price_one_target"
    CHECK (("levelId" IS NULL) <> ("tierName" IS NULL));
ALTER TABLE "SeasonPrice" ADD CONSTRAINT "season_price_tier_name_length"
    CHECK ("tierName" IS NULL OR (char_length(btrim("tierName")) BETWEEN 1 AND 100 AND "tierName" = btrim("tierName")));
ALTER TABLE "SeasonPrice" ADD CONSTRAINT "season_price_non_negative" CHECK ("price" >= 0);
CREATE UNIQUE INDEX "season_price_level_unique"
    ON "SeasonPrice"("seasonId", "levelId") WHERE "levelId" IS NOT NULL;
CREATE UNIQUE INDEX "season_price_tier_unique"
    ON "SeasonPrice"("seasonId", lower("tierName")) WHERE "tierName" IS NOT NULL;

-- Spec 041 data-model.md (written by spec 042): a pass is for a seat (its labels as sold) or a
-- ticket type name; an active seated pass keeps its seat; the name on tickets as Order's (017).
ALTER TABLE "SeasonPass" ADD CONSTRAINT "season_pass_one_target"
    CHECK ((("seatSection" IS NOT NULL AND "seatRowLabel" IS NOT NULL AND "seatLabel" IS NOT NULL)
            AND "tierName" IS NULL)
        OR ("seatSection" IS NULL AND "seatRowLabel" IS NULL AND "seatLabel" IS NULL
            AND "seatId" IS NULL AND "tierName" IS NOT NULL));
ALTER TABLE "SeasonPass" ADD CONSTRAINT "season_pass_active_has_seat"
    CHECK ("status" <> 'ACTIVE' OR "tierName" IS NOT NULL OR "seatId" IS NOT NULL);
ALTER TABLE "SeasonPass" ADD CONSTRAINT "season_pass_holder_name_length"
    CHECK (char_length("holderName") BETWEEN 1 AND 100 AND "holderName" = btrim("holderName"));
ALTER TABLE "SeasonPass" ADD CONSTRAINT "season_pass_total_non_negative" CHECK ("totalPrice" >= 0);
ALTER TABLE "SeasonPass" ADD CONSTRAINT "season_pass_refunded_together"
    CHECK (("refundedAt" IS NOT NULL) = ("status" = 'REFUNDED'));

-- Spec 041 research R7 (for 042): exactly 5 minutes, and one live pass hold per customer per Season.
ALTER TABLE "SeasonPassHold" ADD CONSTRAINT "season_pass_hold_five_minutes"
    CHECK ("expiresAt" = "createdAt" + interval '5 minutes');
ALTER TABLE "SeasonPassHold" ADD CONSTRAINT "season_pass_hold_ended_after_start"
    CHECK ("endedAt" IS NULL OR "endedAt" >= "createdAt");
ALTER TABLE "SeasonPassHold" ADD CONSTRAINT "season_pass_hold_live_has_seat"
    CHECK ("endedAt" IS NOT NULL OR "seatId" IS NOT NULL);
CREATE UNIQUE INDEX "season_pass_hold_one_live"
    ON "SeasonPassHold"("customerSub", "seasonId") WHERE "endedAt" IS NULL;
CREATE INDEX "season_pass_hold_open_by_expiry"
    ON "SeasonPassHold"("expiresAt") WHERE "endedAt" IS NULL;

-- Spec 041 data-model.md: one order per event per pass.
CREATE UNIQUE INDEX "order_one_per_event_per_pass"
    ON "Order"("seasonPassId", "eventId") WHERE "seasonPassId" IS NOT NULL;

-- Spec 041 research R7: one live reservation per pass hold per event; and spec 015's one live
-- reservation per customer per event becomes one per customer, event and kind (single or pass).
CREATE UNIQUE INDEX "seat_reservation_one_per_pass_hold_event"
    ON "SeatReservation"("passHoldId", "eventId")
    WHERE "passHoldId" IS NOT NULL AND "endedAt" IS NULL;
DROP INDEX "seat_reservation_one_active";
CREATE UNIQUE INDEX "seat_reservation_one_active"
    ON "SeatReservation"("eventId", "customerSub", ("passHoldId" IS NULL)) WHERE "endedAt" IS NULL;
