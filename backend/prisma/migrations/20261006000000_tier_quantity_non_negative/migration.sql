-- Spec 007 FR-006 (research R11): a seated tier's quantity is the seats in its mapped sections,
-- so a tier with no section has 0. Typed quantities (general admission) are still validated as
-- at least 1 by the Backend.
ALTER TABLE "TicketTier" DROP CONSTRAINT "ticket_tier_quantity_positive";
ALTER TABLE "TicketTier"
    ADD CONSTRAINT "ticket_tier_quantity_non_negative" CHECK ("quantity" >= 0);

-- Data written under the earlier 007 rules held typed numbers in the seated flow. Recalculate
-- them once, so every database starts consistent with FR-006, FR-017, and FR-018.
UPDATE "Location" AS l
SET "seatingCapacity" = s.total
FROM (
    SELECT "locationId", SUM("rows" * "seatsPerRow") AS total FROM "Section" GROUP BY "locationId"
) AS s
WHERE l."id" = s."locationId";

UPDATE "Event" AS e
SET "totalTicketCapacity" = l."seatingCapacity"
FROM "Location" AS l
WHERE e."locationId" = l."id"
  AND e."reservedSeating"
  AND e."status" = 'SCHEDULED'
  AND EXISTS (SELECT 1 FROM "Section" AS s WHERE s."locationId" = l."id");

UPDATE "TicketTier" AS t
SET "quantity" = COALESCE((
    SELECT SUM(s."rows" * s."seatsPerRow")
    FROM "SectionTier" AS m JOIN "Section" AS s ON s."id" = m."sectionId"
    WHERE m."tierId" = t."id"
), 0)
FROM "Event" AS e
WHERE t."eventId" = e."id" AND e."reservedSeating" AND e."status" = 'SCHEDULED';
