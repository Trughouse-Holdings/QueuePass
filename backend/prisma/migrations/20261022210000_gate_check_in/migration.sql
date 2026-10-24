-- Spec 017: names on tickets and gate check-in (data-model.md). Three nullable columns and two
-- CHECKs; existing rows are untouched, their new columns start as NULL.

ALTER TABLE "Order" ADD COLUMN "holderName" TEXT;

-- FR-003 backstop (research R2): the Backend's rules are richer (a letter, no control
-- characters); the database guarantees the length and the trimming.
ALTER TABLE "Order" ADD CONSTRAINT "order_holder_name_valid"
  CHECK ("holderName" IS NULL
    OR (char_length("holderName") BETWEEN 1 AND 100 AND "holderName" = btrim("holderName")));

ALTER TABLE "Ticket" ADD COLUMN "checkedInBySub" TEXT;
ALTER TABLE "Ticket" ADD COLUMN "checkedInByUsername" TEXT;

-- Research R3: an agent only with an entry, and both agent columns together. An entry with no
-- agent stays allowed: demo check-ins made before this feature have none.
ALTER TABLE "Ticket" ADD CONSTRAINT "ticket_entry_agent"
  CHECK (("checkedInBySub" IS NULL AND "checkedInByUsername" IS NULL)
    OR ("checkedInBySub" IS NOT NULL AND "checkedInByUsername" IS NOT NULL
        AND "checkedInAt" IS NOT NULL));
