-- Spec 013 (data-model.md): a venue's address as four parts and whether the address service
-- verified it. No backfill and no parse: existing venues keep their one-line address, get NULL
-- parts, and are not verified (the column default). This migration makes no network call.
ALTER TABLE "Location"
  ADD COLUMN "street" VARCHAR(200),
  ADD COLUMN "city"   VARCHAR(100),
  ADD COLUMN "state"  VARCHAR(2),
  ADD COLUMN "zip"    VARCHAR(5),
  ADD COLUMN "addressVerified" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Location" ADD CONSTRAINT "location_address_parts_all_or_none"
  CHECK (("street" IS NULL AND "city" IS NULL AND "state" IS NULL AND "zip" IS NULL)
      OR ("street" IS NOT NULL AND "city" IS NOT NULL AND "state" IS NOT NULL AND "zip" IS NOT NULL));

ALTER TABLE "Location" ADD CONSTRAINT "location_address_parts_format"
  CHECK (("state" IS NULL OR "state" ~ '^[A-Z]{2}$')
     AND ("zip" IS NULL OR "zip" ~ '^[0-9]{5}$'));

ALTER TABLE "Location" ADD CONSTRAINT "location_address_matches_parts"
  CHECK ("street" IS NULL
      OR "address" = "street" || ', ' || "city" || ', ' || "state" || ' ' || "zip");

ALTER TABLE "Location" ADD CONSTRAINT "location_verified_has_parts"
  CHECK (NOT "addressVerified" OR "street" IS NOT NULL);
