-- Spec 038 (#165): seat maps. Layouts with price levels, rows and seats; an event's layout, level
-- prices and off-sale seats; tickets and holds on the seat itself (data-model.md; research R1, R7,
-- R10, R12). Written by hand: it carries every venue, seated event, ticket and hold of `007` and
-- `015` over (research R16, steps 1 to 6; FR-031, FR-032, SC-006). The whole file runs in one
-- transaction, so it applies completely or not at all.

-- ===========================================================================================
-- Step 1. The new tables, enums and columns, without the rules the carry-over must fill first.
-- ===========================================================================================

CREATE TYPE "LayoutSource" AS ENUM ('FILE', 'LINES');
CREATE TYPE "FloorKind" AS ENUM ('COURT', 'END_STAGE', 'CENTER_STAGE', 'RING', 'NONE');

-- One seating configuration of a venue (FR-001).
CREATE TABLE "Layout" (
    "id" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "source" "LayoutSource" NOT NULL,
    "floorKind" "FloorKind" NOT NULL,
    "floorOutline" JSONB,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "seatCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "Layout_pkey" PRIMARY KEY ("id")
);

-- A group of seats of similar desirability (FR-003).
CREATE TABLE "PriceLevel" (
    "id" UUID NOT NULL,
    "layoutId" UUID NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "rank" INTEGER NOT NULL,
    "color" VARCHAR(10) NOT NULL,

    CONSTRAINT "PriceLevel_pkey" PRIMARY KEY ("id")
);

-- A row of a section; number 1 is the front (FR-002).
CREATE TABLE "SeatRow" (
    "id" UUID NOT NULL,
    "sectionId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "label" VARCHAR(5) NOT NULL,
    "levelId" UUID,

    CONSTRAINT "SeatRow_pkey" PRIMARY KEY ("id")
);

-- One seat, with its place in map units and an optional level of its own (research R1).
CREATE TABLE "Seat" (
    "id" UUID NOT NULL,
    "rowId" UUID NOT NULL,
    "sectionId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "label" VARCHAR(5) NOT NULL,
    "x" REAL NOT NULL,
    "y" REAL NOT NULL,
    "levelId" UUID,
    "accessible" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Seat_pkey" PRIMARY KEY ("id")
);

-- An event's price for one level (FR-011).
CREATE TABLE "EventLevelPrice" (
    "eventId" UUID NOT NULL,
    "levelId" UUID NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "EventLevelPrice_pkey" PRIMARY KEY ("eventId", "levelId")
);

-- A seat one event does not sell (FR-013).
CREATE TABLE "EventOffSaleSeat" (
    "eventId" UUID NOT NULL,
    "seatId" UUID NOT NULL,

    CONSTRAINT "EventOffSaleSeat_pkey" PRIMARY KEY ("eventId", "seatId")
);

-- Sections move from the venue to a layout (FR-002); filled below, then made NOT NULL.
ALTER TABLE "Section"
    ADD COLUMN "layoutId" UUID,
    ADD COLUMN "levelId" UUID,
    ADD COLUMN "outline" JSONB,
    ADD COLUMN "labelX" REAL,
    ADD COLUMN "labelY" REAL;

-- An event's layout (NULL is general admission) and its seat-change sequence number (R12).
ALTER TABLE "Event"
    ADD COLUMN "layoutId" UUID,
    ADD COLUMN "seatSeq" BIGINT NOT NULL DEFAULT 0;

-- A ticket's seat, its labels, its level's name and its price, as sold (FR-026, R10).
ALTER TABLE "Ticket"
    ADD COLUMN "seatId" UUID,
    ADD COLUMN "seatRowLabel" VARCHAR(5),
    ADD COLUMN "seatLabel" VARCHAR(5),
    ADD COLUMN "levelName" VARCHAR(50),
    ADD COLUMN "price" DECIMAL(10,2);

-- A hold's seat (FR-025, R10).
ALTER TABLE "SeatHold" ADD COLUMN "seatId" UUID;

-- ===========================================================================================
-- Step 2. Each venue with sections gets one layout "Standard", made from lines with no floor;
-- each section keeps its id, gets a level of its own named after it (rank by position, colors in
-- the theme's order, repeating after 12), and a rectangle on the R6 grid; rows 1…n labelled
-- '1'…'n' and seats 1…m labelled '1'…'m' are placed as R6 places them
-- (backend/src/layouts/layout-lines.ts does the same arithmetic): ceil(√n) columns, every cell as
-- large as the largest section plus 8 units, a section seatsPerRow × 2 + 4 units wide and
-- rows × 2 + 4 high at its cell's top left, seat (r, m) at (x + 2m + 1, y + 2r + 1).
-- ===========================================================================================

CREATE TEMPORARY TABLE "carry_grid" AS
WITH placed AS (
    SELECT s."id", s."locationId", s."name", s."rows", s."seatsPerRow",
           (row_number() OVER (PARTITION BY s."locationId" ORDER BY s."position") - 1)::int AS i,
           count(*) OVER (PARTITION BY s."locationId")::int AS n,
           max(s."seatsPerRow" * 2 + 4) OVER (PARTITION BY s."locationId") AS cell_w,
           max(s."rows" * 2 + 4) OVER (PARTITION BY s."locationId") AS cell_h
    FROM "Section" s
), columned AS (
    SELECT p.*, ceil(sqrt(p.n::float8))::int AS columns FROM placed p
)
SELECT c."id", c."locationId", c."name", c."rows", c."seatsPerRow", c.i, c.n, c.columns,
       c.cell_w, c.cell_h,
       (c.i % c.columns) * (c.cell_w + 8) AS x,
       (c.i / c.columns) * (c.cell_h + 8) AS y,
       c."seatsPerRow" * 2 + 4 AS w,
       c."rows" * 2 + 4 AS h
FROM columned c;

INSERT INTO "Layout" ("id", "locationId", "name", "source", "floorKind", "floorOutline", "width",
                      "height", "seatCount", "updatedAt")
SELECT gen_random_uuid(), g."locationId", 'Standard', 'LINES', 'NONE', NULL,
       least(min(g.n), min(g.columns)) * (min(g.cell_w) + 8) - 8,
       ceil(min(g.n)::numeric / min(g.columns))::int * (min(g.cell_h) + 8) - 8,
       sum(g."rows" * g."seatsPerRow"),
       CURRENT_TIMESTAMP
FROM "carry_grid" g
GROUP BY g."locationId";

UPDATE "Section" s
SET "layoutId" = l."id",
    "outline" = jsonb_build_array(
        jsonb_build_array(g.x, g.y),
        jsonb_build_array(g.x + g.w, g.y),
        jsonb_build_array(g.x + g.w, g.y + g.h),
        jsonb_build_array(g.x, g.y + g.h)),
    "labelX" = g.x + g.w / 2.0,
    "labelY" = g.y + g.h / 2.0
FROM "carry_grid" g JOIN "Layout" l ON l."locationId" = g."locationId"
WHERE s."id" = g."id";

-- One level per section, named after it; rank = its place in position order (position + 1 for
-- 007's positions 0, 1, 2, …). A venue may have had up to 50 sections, so up to 50 levels (R16).
INSERT INTO "PriceLevel" ("id", "layoutId", "name", "rank", "color")
SELECT gen_random_uuid(), s."layoutId", s."name", g.i + 1,
       (ARRAY['violet', 'blue', 'cyan', 'teal', 'green', 'lime', 'yellow', 'orange', 'red',
              'pink', 'purple', 'brown'])[(g.i % 12) + 1]
FROM "Section" s JOIN "carry_grid" g ON g."id" = s."id";

UPDATE "Section" s
SET "levelId" = pl."id"
FROM "PriceLevel" pl
WHERE pl."layoutId" = s."layoutId" AND pl."name" = s."name";

INSERT INTO "SeatRow" ("id", "sectionId", "number", "label")
SELECT gen_random_uuid(), g."id", r, r::text
FROM "carry_grid" g CROSS JOIN LATERAL generate_series(1, g."rows") AS r;

INSERT INTO "Seat" ("id", "rowId", "sectionId", "number", "label", "x", "y")
SELECT gen_random_uuid(), sr."id", g."id", m, m::text, g.x + 2 * m + 1, g.y + 2 * sr."number" + 1
FROM "carry_grid" g
JOIN "SeatRow" sr ON sr."sectionId" = g."id"
CROSS JOIN LATERAL generate_series(1, g."seatsPerRow") AS m;

DROP TABLE "carry_grid";

-- ===========================================================================================
-- Step 3. Seated events. Two kinds become general admission, keeping their ticket types: an event
-- with types and no section mapped (nothing was sellable), and an event, of any status, whose
-- venue has no sections (007's remove only checked scheduled events, review B4a). Every other
-- seated event uses its venue's Standard layout: a mapped section's level at its type's price;
-- every level at the base price on an event without types; an unmapped section's seats off sale
-- on an event with types (they were not sellable).
-- ===========================================================================================

UPDATE "Event" e
SET "reservedSeating" = false
WHERE e."reservedSeating"
  AND (NOT EXISTS (SELECT 1 FROM "Layout" l WHERE l."locationId" = e."locationId")
       OR (EXISTS (SELECT 1 FROM "TicketTier" t WHERE t."eventId" = e."id")
           AND NOT EXISTS (SELECT 1 FROM "SectionTier" st WHERE st."eventId" = e."id")));

UPDATE "Event" e
SET "layoutId" = l."id"
FROM "Layout" l
WHERE e."reservedSeating" AND l."locationId" = e."locationId";

-- A mapped section's level at its ticket type's price.
INSERT INTO "EventLevelPrice" ("eventId", "levelId", "price")
SELECT st."eventId", s."levelId", t."price"
FROM "SectionTier" st
JOIN "Event" e ON e."id" = st."eventId"
JOIN "Section" s ON s."id" = st."sectionId"
JOIN "TicketTier" t ON t."id" = st."tierId"
WHERE e."layoutId" IS NOT NULL;

-- Without types, every level at the event's base price.
INSERT INTO "EventLevelPrice" ("eventId", "levelId", "price")
SELECT e."id", pl."id", e."basePrice"
FROM "Event" e
JOIN "PriceLevel" pl ON pl."layoutId" = e."layoutId"
WHERE e."layoutId" IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM "TicketTier" t WHERE t."eventId" = e."id");

-- With types, an unmapped section's seats off sale.
INSERT INTO "EventOffSaleSeat" ("eventId", "seatId")
SELECT e."id", seat."id"
FROM "Event" e
JOIN "Section" s ON s."layoutId" = e."layoutId"
JOIN "Seat" seat ON seat."sectionId" = s."id"
WHERE e."layoutId" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "TicketTier" t WHERE t."eventId" = e."id")
  AND NOT EXISTS (
      SELECT 1 FROM "SectionTier" st WHERE st."eventId" = e."id" AND st."sectionId" = s."id");

-- ===========================================================================================
-- Step 4. Tickets and holds get their seat, by their event's layout, their section's name, the
-- row's number and the seat's number; labels are the numbers (007 labelled seats by number). Every
-- ticket's price is its order's unit price; a seated ticket's level is its ticket type's name,
-- else its section's. Then the seated events' orders, tickets and reservations drop their type,
-- and their types and every section mapping go.
-- ===========================================================================================

UPDATE "Ticket" t
SET "price" = o."unitPrice"
FROM "Order" o
WHERE o."id" = t."orderId";

UPDATE "Ticket" t
SET "seatRowLabel" = t."seatRow"::text,
    "seatLabel" = t."seatNumber"::text,
    "levelName" = COALESCE(
        (SELECT tt."name" FROM "TicketTier" tt WHERE tt."id" = t."tierId"), t."seatSection")
WHERE t."seatSection" IS NOT NULL;

UPDATE "Ticket" t
SET "seatId" = seat."id"
FROM "Event" e, "Section" s, "SeatRow" sr, "Seat" seat
WHERE e."id" = t."eventId" AND e."layoutId" IS NOT NULL
  AND s."layoutId" = e."layoutId" AND lower(s."name") = lower(t."seatSection")
  AND sr."sectionId" = s."id" AND sr."number" = t."seatRow"
  AND seat."rowId" = sr."id" AND seat."number" = t."seatNumber";

UPDATE "SeatHold" h
SET "seatId" = seat."id"
FROM "Event" e, "Section" s, "SeatRow" sr, "Seat" seat
WHERE e."id" = h."eventId" AND e."layoutId" IS NOT NULL
  AND s."layoutId" = e."layoutId" AND lower(s."name") = lower(h."seatSection")
  AND sr."sectionId" = s."id" AND sr."number" = h."seatRow"
  AND seat."rowId" = sr."id" AND seat."number" = h."seatNumber";

UPDATE "Order" o SET "tierId" = NULL
FROM "Event" e WHERE e."id" = o."eventId" AND e."layoutId" IS NOT NULL AND o."tierId" IS NOT NULL;
UPDATE "Ticket" t SET "tierId" = NULL
FROM "Event" e WHERE e."id" = t."eventId" AND e."layoutId" IS NOT NULL AND t."tierId" IS NOT NULL;
UPDATE "SeatReservation" r SET "tierId" = NULL
FROM "Event" e WHERE e."id" = r."eventId" AND e."layoutId" IS NOT NULL AND r."tierId" IS NOT NULL;
DELETE FROM "TicketTier" t
USING "Event" e WHERE e."id" = t."eventId" AND e."layoutId" IS NOT NULL;

-- ===========================================================================================
-- Step 5. A seated event's capacity is its seats on sale, its per-customer limit no higher, and its
-- base price the lowest price of a level with seats on sale (R9).
-- ===========================================================================================

WITH on_sale AS (
    SELECT e."id" AS "eventId",
           count(seat."id") FILTER (WHERE o."seatId" IS NULL)::int AS seats,
           min(p."price") FILTER (WHERE o."seatId" IS NULL) AS lowest
    FROM "Event" e
    JOIN "Section" s ON s."layoutId" = e."layoutId"
    JOIN "Seat" seat ON seat."sectionId" = s."id"
    LEFT JOIN "EventOffSaleSeat" o ON o."eventId" = e."id" AND o."seatId" = seat."id"
    LEFT JOIN "EventLevelPrice" p ON p."eventId" = e."id" AND p."levelId" = s."levelId"
    WHERE e."layoutId" IS NOT NULL
    GROUP BY e."id"
)
UPDATE "Event" e
SET "totalTicketCapacity" = os.seats,
    -- LEAST ignores NULL, so "no limit" stays NULL explicitly.
    "maxTicketsPerCustomer" = CASE WHEN e."maxTicketsPerCustomer" IS NULL THEN NULL
                                   ELSE least(e."maxTicketsPerCustomer", os.seats) END,
    "basePrice" = os.lowest
FROM on_sale os
WHERE os."eventId" = e."id";

-- ===========================================================================================
-- Step 6. The drops, then every rule of data-model.md.
-- ===========================================================================================

DROP TABLE "SectionTier";

DROP INDEX "section_name_unique_per_venue";
DROP INDEX "Section_locationId_position_key";
DROP INDEX "Section_locationId_idx";
ALTER TABLE "Section" DROP CONSTRAINT "Section_locationId_fkey";
ALTER TABLE "Section"
    DROP COLUMN "locationId",
    DROP COLUMN "rows",
    DROP COLUMN "seatsPerRow";
ALTER TABLE "Section"
    ALTER COLUMN "layoutId" SET NOT NULL,
    ALTER COLUMN "levelId" SET NOT NULL,
    ALTER COLUMN "outline" SET NOT NULL,
    ALTER COLUMN "labelX" SET NOT NULL,
    ALTER COLUMN "labelY" SET NOT NULL,
    ALTER COLUMN "name" TYPE VARCHAR(50);

-- The label-based indexes go; their seat-based replacements are below (FR-025).
DROP INDEX "ticket_one_valid_per_seat";
DROP INDEX "seat_hold_one_live_per_seat";

ALTER TABLE "Ticket"
    ALTER COLUMN "price" SET NOT NULL,
    ALTER COLUMN "seatSection" TYPE VARCHAR(50);
ALTER TABLE "Order" ALTER COLUMN "unitPrice" DROP NOT NULL;

-- Indexes.
CREATE INDEX "Layout_locationId_idx" ON "Layout"("locationId");
CREATE UNIQUE INDEX "layout_name_unique_per_venue" ON "Layout"("locationId", lower("name"));
CREATE UNIQUE INDEX "price_level_name_unique" ON "PriceLevel"("layoutId", lower("name"));
CREATE UNIQUE INDEX "price_level_rank_unique" ON "PriceLevel"("layoutId", "rank");
CREATE UNIQUE INDEX "price_level_layout_id" ON "PriceLevel"("layoutId", "id");
CREATE UNIQUE INDEX "Section_layoutId_position_key" ON "Section"("layoutId", "position");
CREATE UNIQUE INDEX "section_name_unique_per_layout" ON "Section"("layoutId", lower("name"));
CREATE UNIQUE INDEX "seat_row_number_unique" ON "SeatRow"("sectionId", "number");
CREATE UNIQUE INDEX "seat_row_label_unique" ON "SeatRow"("sectionId", "label");
CREATE UNIQUE INDEX "seat_row_id_section" ON "SeatRow"("id", "sectionId");
CREATE INDEX "SeatRow_levelId_idx" ON "SeatRow"("levelId");
CREATE UNIQUE INDEX "seat_number_unique" ON "Seat"("rowId", "number");
CREATE UNIQUE INDEX "seat_label_unique" ON "Seat"("rowId", "label");
CREATE INDEX "Seat_sectionId_idx" ON "Seat"("sectionId");
CREATE INDEX "Seat_levelId_idx" ON "Seat"("levelId");
CREATE INDEX "EventLevelPrice_levelId_idx" ON "EventLevelPrice"("levelId");
CREATE INDEX "EventOffSaleSeat_seatId_idx" ON "EventOffSaleSeat"("seatId");
CREATE INDEX "Event_layoutId_idx" ON "Event"("layoutId");
CREATE INDEX "Ticket_seatId_idx" ON "Ticket"("seatId");
CREATE INDEX "SeatHold_seatId_idx" ON "SeatHold"("seatId");

-- FR-025 (Constitution IV): one VALID ticket and one live hold per seat of an event, on the seat
-- itself, whatever any client does. Voided tickets and ended holds aren't indexed.
CREATE UNIQUE INDEX "ticket_one_valid_per_seat"
    ON "Ticket"("eventId", "seatId") WHERE "status" = 'VALID';
CREATE UNIQUE INDEX "seat_hold_one_live_per_seat"
    ON "SeatHold"("eventId", "seatId") WHERE "releasedAt" IS NULL;

-- Foreign keys. A layout goes with its venue (which can't be deleted with events, 002), and its
-- levels, sections, rows and seats with it, in one statement (R7, review M6, corrected after T009):
-- a row's or seat's own level is SET NULL when the level goes (it falls back to its row's or
-- section's, FR-003), and a section's level is NO ACTION DEFERRABLE INITIALLY DEFERRED, checked at
-- commit, after the cascade has removed the section too (NO ACTION checked at once fails before the
-- cascade reaches the rows and seats). A layout an event
-- uses, cancelled included, can't be deleted (RESTRICT, R7). A ticket's or hold's seat is SET NULL,
-- which the CHECKs below refuse for a VALID ticket or a live hold, so a sold or held seat can't be
-- deleted (R10).
ALTER TABLE "Layout" ADD CONSTRAINT "Layout_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PriceLevel" ADD CONSTRAINT "PriceLevel_layoutId_fkey"
    FOREIGN KEY ("layoutId") REFERENCES "Layout"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Section" ADD CONSTRAINT "Section_layoutId_fkey"
    FOREIGN KEY ("layoutId") REFERENCES "Layout"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- A section's level is of its own layout.
ALTER TABLE "Section" ADD CONSTRAINT "Section_layoutId_levelId_fkey"
    FOREIGN KEY ("layoutId", "levelId") REFERENCES "PriceLevel"("layoutId", "id")
    ON DELETE NO ACTION ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "SeatRow" ADD CONSTRAINT "SeatRow_sectionId_fkey"
    FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SeatRow" ADD CONSTRAINT "SeatRow_levelId_fkey"
    FOREIGN KEY ("levelId") REFERENCES "PriceLevel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- A seat's section is its row's.
ALTER TABLE "Seat" ADD CONSTRAINT "seat_row_section"
    FOREIGN KEY ("rowId", "sectionId") REFERENCES "SeatRow"("id", "sectionId")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Seat" ADD CONSTRAINT "Seat_sectionId_fkey"
    FOREIGN KEY ("sectionId") REFERENCES "Section"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Seat" ADD CONSTRAINT "Seat_levelId_fkey"
    FOREIGN KEY ("levelId") REFERENCES "PriceLevel"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EventLevelPrice" ADD CONSTRAINT "EventLevelPrice_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventLevelPrice" ADD CONSTRAINT "EventLevelPrice_levelId_fkey"
    FOREIGN KEY ("levelId") REFERENCES "PriceLevel"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventOffSaleSeat" ADD CONSTRAINT "EventOffSaleSeat_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventOffSaleSeat" ADD CONSTRAINT "EventOffSaleSeat_seatId_fkey"
    FOREIGN KEY ("seatId") REFERENCES "Seat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Event" ADD CONSTRAINT "Event_layoutId_fkey"
    FOREIGN KEY ("layoutId") REFERENCES "Layout"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_seatId_fkey"
    FOREIGN KEY ("seatId") REFERENCES "Seat"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SeatHold" ADD CONSTRAINT "SeatHold_seatId_fkey"
    FOREIGN KEY ("seatId") REFERENCES "Seat"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Field rules. They duplicate request validation on purpose: validation produces readable
-- errors, the constraints guarantee no client can write invalid rows.
ALTER TABLE "Layout" ADD CONSTRAINT "layout_name_valid"
    CHECK (char_length("name") BETWEEN 1 AND 50 AND "name" = btrim("name"));
ALTER TABLE "Layout" ADD CONSTRAINT "layout_floor_outline_matches_kind"
    CHECK (("floorKind" = 'NONE') = ("floorOutline" IS NULL));
ALTER TABLE "Layout" ADD CONSTRAINT "layout_floor_outline_points"
    CHECK ("floorOutline" IS NULL
        OR (jsonb_typeof("floorOutline") = 'array'
            AND jsonb_array_length("floorOutline") BETWEEN 3 AND 64));
ALTER TABLE "Layout" ADD CONSTRAINT "layout_size_range"
    CHECK ("width" BETWEEN 1 AND 5000 AND "height" BETWEEN 1 AND 5000);
-- At least 1; 30,000 is the Backend's limit for a new layout, and a carried-over one keeps every
-- seat its venue had (R16, review B4b).
ALTER TABLE "Layout" ADD CONSTRAINT "layout_seat_count_positive" CHECK ("seatCount" >= 1);

ALTER TABLE "PriceLevel" ADD CONSTRAINT "price_level_name_length"
    CHECK (char_length("name") BETWEEN 1 AND 50);
-- 1 to 12 for an import or section lines (the Backend), up to 50 for a carried-over layout (R16).
ALTER TABLE "PriceLevel" ADD CONSTRAINT "price_level_rank_range" CHECK ("rank" BETWEEN 1 AND 50);
-- The 12 level colors, in the contract's LevelColor order (shared LEVEL_COLORS).
ALTER TABLE "PriceLevel" ADD CONSTRAINT "price_level_color_known"
    CHECK ("color" IN ('violet', 'blue', 'cyan', 'teal', 'green', 'lime', 'yellow', 'orange',
        'red', 'pink', 'purple', 'brown'));

ALTER TABLE "Section" ADD CONSTRAINT "section_outline_points"
    CHECK (jsonb_typeof("outline") = 'array' AND jsonb_array_length("outline") BETWEEN 3 AND 64);

ALTER TABLE "SeatRow" ADD CONSTRAINT "seat_row_number_range" CHECK ("number" BETWEEN 1 AND 100);
ALTER TABLE "SeatRow" ADD CONSTRAINT "seat_row_label_length"
    CHECK (char_length("label") BETWEEN 1 AND 5);
ALTER TABLE "Seat" ADD CONSTRAINT "seat_number_range" CHECK ("number" BETWEEN 1 AND 200);
ALTER TABLE "Seat" ADD CONSTRAINT "seat_label_length" CHECK (char_length("label") BETWEEN 1 AND 5);

ALTER TABLE "EventLevelPrice" ADD CONSTRAINT "event_level_price_non_negative"
    CHECK ("price" >= 0);

ALTER TABLE "Event" ADD CONSTRAINT "event_seat_seq_non_negative" CHECK ("seatSeq" >= 0);
-- An event sells seats exactly when it has a layout.
ALTER TABLE "Event" ADD CONSTRAINT "event_seating_matches_layout"
    CHECK ("reservedSeating" = ("layoutId" IS NOT NULL));

-- A seated ticket's section name, row and seat numbers and both labels are all set or all NULL
-- (the seat id may later be NULL, SET NULL, but never on a VALID ticket: below).
ALTER TABLE "Ticket" DROP CONSTRAINT "ticket_seat_all_or_none";
ALTER TABLE "Ticket" ADD CONSTRAINT "ticket_seat_all_or_none"
    CHECK (
        ("seatSection" IS NULL AND "seatRow" IS NULL AND "seatNumber" IS NULL
            AND "seatRowLabel" IS NULL AND "seatLabel" IS NULL)
        OR ("seatSection" IS NOT NULL AND "seatRow" IS NOT NULL AND "seatNumber" IS NOT NULL
            AND "seatRowLabel" IS NOT NULL AND "seatLabel" IS NOT NULL)
    );
-- A VALID seated ticket keeps its seat, so a sold seat can't be deleted (R10).
ALTER TABLE "Ticket" ADD CONSTRAINT "ticket_valid_has_seat"
    CHECK ("status" <> 'VALID' OR "seatSection" IS NULL OR "seatId" IS NOT NULL);

-- A live hold keeps its seat, so a held seat can't be deleted (R10).
ALTER TABLE "SeatHold" ADD CONSTRAINT "seat_hold_live_has_seat"
    CHECK ("releasedAt" IS NOT NULL OR "seatId" IS NOT NULL);
