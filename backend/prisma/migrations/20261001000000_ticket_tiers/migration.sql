-- Spec 004: ticket tiers. See specs/004-admin-tiers-search/data-model.md.

-- CreateTable
CREATE TABLE "TicketTier" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "quantity" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "TicketTier_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TicketTier_eventId_idx" ON "TicketTier"("eventId");

-- AddForeignKey: a tier means nothing without its event, so deleting the event deletes its
-- tiers (research R1). Orders (spec 005) reference events with RESTRICT, which still protects
-- an event that has sold tickets.
ALTER TABLE "TicketTier" ADD CONSTRAINT "TicketTier_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Field rules (FR-001). They duplicate request validation on purpose: validation produces
-- readable errors, the constraints guarantee no client can write invalid rows.
ALTER TABLE "TicketTier"
    ADD CONSTRAINT "ticket_tier_price_non_negative" CHECK ("price" >= 0);
ALTER TABLE "TicketTier"
    ADD CONSTRAINT "ticket_tier_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "TicketTier"
    ADD CONSTRAINT "ticket_tier_name_length"
    CHECK (length(btrim("name")) BETWEEN 1 AND 100);

-- FR-002: names are unique within an event, ignoring case. Prisma's schema language cannot
-- express an index on lower(name), so it lives here. The service checks first only so the
-- refusal can name the tier; this index is the guarantee under concurrency (research R3).
CREATE UNIQUE INDEX "ticket_tier_event_name_unique"
    ON "TicketTier" ("eventId", lower("name"));

-- The cross-row rule SUM(quantity) <= Event.totalTicketCapacity cannot be a CHECK constraint.
-- The Backend enforces it with SELECT ... FOR UPDATE on the event row (research R2).
