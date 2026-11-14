-- Spec 039 (data-model.md; research R4, R6, R8, R9): the layout editor. No new tables.

-- R4: a layout drawn in the editor, or a LINES layout saved from it.
ALTER TYPE "LayoutSource" ADD VALUE 'DRAWN';

-- R9: every change to a layout raises its revision by one; a save from the editor must name the
-- revision it read.
ALTER TABLE "Layout" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "Layout" ADD CONSTRAINT "layout_revision_positive" CHECK ("revision" >= 1);

-- R6: the point a section moves and turns about (its label point until it is drawn), how far it is
-- turned (degrees clockwise), and the block generator's values it was made from (R7), if any.
ALTER TABLE "Section" ADD COLUMN "originX" REAL;
ALTER TABLE "Section" ADD COLUMN "originY" REAL;
UPDATE "Section" SET "originX" = "labelX", "originY" = "labelY";
ALTER TABLE "Section" ALTER COLUMN "originX" SET NOT NULL;
ALTER TABLE "Section" ALTER COLUMN "originY" SET NOT NULL;
ALTER TABLE "Section" ADD CONSTRAINT "section_origin_range"
    CHECK ("originX" BETWEEN 0 AND 5000 AND "originY" BETWEEN 0 AND 5000);
ALTER TABLE "Section" ADD COLUMN "angle" REAL NOT NULL DEFAULT 0;
ALTER TABLE "Section" ADD CONSTRAINT "section_angle_range" CHECK ("angle" > -180 AND "angle" <= 180);
ALTER TABLE "Section" ADD COLUMN "generator" JSONB;
ALTER TABLE "Section" ADD CONSTRAINT "section_generator_object"
    CHECK ("generator" IS NULL OR jsonb_typeof("generator") = 'object');

-- R8: the per-row unique keys become constraints of the same names, DEFERRABLE INITIALLY
-- IMMEDIATE: every other write still checks them at once; a drawing save defers them, so one save
-- may swap labels, numbers, ranks and positions, and they are checked at its commit. No ON
-- CONFLICT names any of them.
DROP INDEX "price_level_rank_unique";
ALTER TABLE "PriceLevel" ADD CONSTRAINT "price_level_rank_unique"
    UNIQUE ("layoutId", "rank") DEFERRABLE INITIALLY IMMEDIATE;
DROP INDEX "Section_layoutId_position_key";
ALTER TABLE "Section" ADD CONSTRAINT "Section_layoutId_position_key"
    UNIQUE ("layoutId", "position") DEFERRABLE INITIALLY IMMEDIATE;
DROP INDEX "seat_row_number_unique";
ALTER TABLE "SeatRow" ADD CONSTRAINT "seat_row_number_unique"
    UNIQUE ("sectionId", "number") DEFERRABLE INITIALLY IMMEDIATE;
DROP INDEX "seat_row_label_unique";
ALTER TABLE "SeatRow" ADD CONSTRAINT "seat_row_label_unique"
    UNIQUE ("sectionId", "label") DEFERRABLE INITIALLY IMMEDIATE;
DROP INDEX "seat_number_unique";
ALTER TABLE "Seat" ADD CONSTRAINT "seat_number_unique"
    UNIQUE ("rowId", "number") DEFERRABLE INITIALLY IMMEDIATE;
DROP INDEX "seat_label_unique";
ALTER TABLE "Seat" ADD CONSTRAINT "seat_label_unique"
    UNIQUE ("rowId", "label") DEFERRABLE INITIALLY IMMEDIATE;
