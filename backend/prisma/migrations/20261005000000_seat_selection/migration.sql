-- Spec 007: venue seating layouts, reserved seating per event, and seats on tickets.

-- AlterTable: whether an event sells seats (FR-002). Existing events stay general admission.
ALTER TABLE "Event" ADD COLUMN "reservedSeating" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: the seat a ticket is for, as its label when sold (research R1).
ALTER TABLE "Ticket" ADD COLUMN "seatSection" TEXT;
ALTER TABLE "Ticket" ADD COLUMN "seatRow" INTEGER;
ALTER TABLE "Ticket" ADD COLUMN "seatNumber" INTEGER;

-- CreateTable: a venue's layout is its sections (FR-001).
CREATE TABLE "Section" (
    "id" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "rows" INTEGER NOT NULL,
    "seatsPerRow" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Section_pkey" PRIMARY KEY ("id")
);

-- CreateTable: for one event, which tier each section belongs to (FR-004).
CREATE TABLE "SectionTier" (
    "eventId" UUID NOT NULL,
    "sectionId" UUID NOT NULL,
    "tierId" UUID NOT NULL,

    CONSTRAINT "SectionTier_pkey" PRIMARY KEY ("eventId", "sectionId")
);

-- CreateIndex
CREATE INDEX "Section_locationId_idx" ON "Section"("locationId");
CREATE UNIQUE INDEX "Section_locationId_position_key" ON "Section"("locationId", "position");
CREATE INDEX "SectionTier_tierId_idx" ON "SectionTier"("tierId");

-- Section names are unique per venue ignoring case (research R1). Prisma cannot express an
-- expression index, so it lives here.
CREATE UNIQUE INDEX "section_name_unique_per_venue" ON "Section"("locationId", lower("name"));

-- AddForeignKey: a layout goes with its venue; mappings go with their event, section, or tier.
-- Tickets reference no section, so replacing a layout never touches sold tickets (research R1).
ALTER TABLE "Section" ADD CONSTRAINT "Section_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SectionTier" ADD CONSTRAINT "SectionTier_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SectionTier" ADD CONSTRAINT "SectionTier_sectionId_fkey"
    FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SectionTier" ADD CONSTRAINT "SectionTier_tierId_fkey"
    FOREIGN KEY ("tierId") REFERENCES "TicketTier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Field rules. They duplicate request validation on purpose: validation produces readable
-- errors, the constraints guarantee no client can write invalid rows.
ALTER TABLE "Section"
    ADD CONSTRAINT "section_name_length" CHECK (char_length("name") BETWEEN 1 AND 50);
ALTER TABLE "Section"
    ADD CONSTRAINT "section_rows_range" CHECK ("rows" BETWEEN 1 AND 100);
ALTER TABLE "Section"
    ADD CONSTRAINT "section_seats_per_row_range" CHECK ("seatsPerRow" BETWEEN 1 AND 200);
ALTER TABLE "Section"
    ADD CONSTRAINT "section_position_non_negative" CHECK ("position" >= 0);
ALTER TABLE "Ticket"
    ADD CONSTRAINT "ticket_seat_all_or_none" CHECK (
        ("seatSection" IS NULL AND "seatRow" IS NULL AND "seatNumber" IS NULL)
        OR ("seatSection" IS NOT NULL AND "seatRow" IS NOT NULL AND "seatNumber" IS NOT NULL)
    );
ALTER TABLE "Ticket"
    ADD CONSTRAINT "ticket_seat_positive" CHECK ("seatRow" >= 1 AND "seatNumber" >= 1);

-- FR-009, FR-010: no seat is ever held by two valid tickets for the same event, whatever any
-- client does (Constitution IV). Only VALID rows are indexed, so voiding tickets (cancellation,
-- spec 005) frees their seats with no extra step (research R2).
CREATE UNIQUE INDEX "ticket_one_valid_per_seat"
    ON "Ticket"("eventId", "seatSection", "seatRow", "seatNumber")
    WHERE "status" = 'VALID' AND "seatSection" IS NOT NULL;
