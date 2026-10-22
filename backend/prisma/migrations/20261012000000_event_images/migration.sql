-- Spec 014: event images (data-model.md; research R1, R2).
CREATE TABLE "EventImage" (
    "id"          UUID         NOT NULL,
    "eventId"     UUID         NOT NULL,
    "position"    INTEGER      NOT NULL,
    "contentType" VARCHAR(10)  NOT NULL,
    "byteSize"    INTEGER      NOT NULL,
    "bytes"       BYTEA        NOT NULL,
    "createdAt"   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EventImage_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "EventImage" ADD CONSTRAINT "EventImage_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Spec 014 FR-001, FR-005: positions 1 to 5, one image per position, so at most 5 per event.
ALTER TABLE "EventImage" ADD CONSTRAINT "event_image_position_range"
  CHECK ("position" BETWEEN 1 AND 5);

ALTER TABLE "EventImage" ADD CONSTRAINT "event_image_position_unique"
  UNIQUE ("eventId", "position") DEFERRABLE INITIALLY IMMEDIATE;

-- Spec 014 FR-003, FR-004.
ALTER TABLE "EventImage" ADD CONSTRAINT "event_image_content_type"
  CHECK ("contentType" IN ('image/jpeg', 'image/png', 'image/webp'));

ALTER TABLE "EventImage" ADD CONSTRAINT "event_image_byte_size"
  CHECK ("byteSize" BETWEEN 1 AND 5242880 AND "byteSize" = octet_length("bytes"));
