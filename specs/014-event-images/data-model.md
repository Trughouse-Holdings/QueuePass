# Data Model: Event Images

One new table, `EventImage`, in one migration:
`backend/prisma/migrations/20261012000000_event_images/`.

## EventImage (new)

| Field | Type | Rule |
|---|---|---|
| `id` | `String @id @default(uuid()) @db.Uuid` | Never reused. The bytes of an id never change (research R4). |
| `eventId` | `String @db.Uuid` | The event. `ON DELETE CASCADE`: deleting the event deletes its images (research R7). |
| `position` | `Int` | 1 to 5; 1 is the cover. Unique per event; 1 to n with no gap (research R2). |
| `contentType` | `String @db.VarChar(10)` | `image/jpeg`, `image/png`, or `image/webp`, detected from the bytes (research R3). |
| `byteSize` | `Int` | 1 to 5,242,880, and equal to the length of `bytes` (the stored size, after metadata removal). |
| `bytes` | `Bytes` (`bytea`) | The picture as uploaded with its metadata removed; a JPEG keeps only its orientation (research R1, R17). Never selected with an event. |
| `createdAt` | `DateTime @default(now()) @db.Timestamptz(6)` | Kept for operators; not in the API. |

`Event` gains the relation `images EventImage[]`. No column of `Event` changes.

The unique constraint on `("eventId", "position")` is written in the migration SQL, not as
`@@unique` in `schema.prisma`, because Prisma cannot declare a deferrable constraint (as with
`event_no_overlap`, the schema file says where it lives). Its index also serves every lookup by
event.

```sql
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
```

- **What the database guarantees**: no event has more than 5 images, no two images of an event
  share a position, every image is one of the three types by its recorded type, and no image is
  over 5 MB or misreports its size. These hold whatever writes the rows (Constitution IV).
- **What the Backend guarantees, under the event lock**: positions are 1 to n with no gap; the
  recorded type is the detected one; a cancelled event's images do not change (research R2, R3,
  R7). Contiguity is tested under concurrency.
- **No backfill**: existing events have no images, which looks as they do today (spec FR-027).

## Writes (research R2)

Every write is one transaction that starts with `lockEvent(tx, eventId)` (`SELECT … FROM "Event"
… FOR UPDATE`, `backend/src/common/event-lock.ts`), after the upload has been read and checked.

```text
add(eventId, file)             -- no lock held for these first steps
  file.size > 5,242,880        → 413 IMAGE_TOO_LARGE        (multer, while reading)
  readImageHeader(file) = null → 415 IMAGE_TYPE_NOT_ALLOWED
  header.animated              → 415 IMAGE_TYPE_NOT_ALLOWED      (APNG acTL, WebP ANIM)
  side > 16,384 or w×h > 40,000,000
                               → 400 IMAGE_DIMENSIONS_TOO_LARGE { width, height, maxSide, maxPixels }
  bytes = stripImageMetadata(file, contentType)   -- 415 if its structure cannot be walked
  lock event                   -- 404 if missing
  status = CANCELLED           → 409 EVENT_CANCELLED
  n = count(images)
  n ≥ 5                        → 409 IMAGE_LIMIT_REACHED { limit: 5, count: n }
  INSERT (position = n + 1, contentType = sniffed, byteSize = length, bytes)

delete(eventId, imageId)
  lock event
  image not of this event      → 404
  status = CANCELLED           → 409 EVENT_CANCELLED
  SET CONSTRAINTS "event_image_position_unique" DEFERRED
  DELETE image; UPDATE position = position - 1 WHERE eventId = … AND position > deleted.position

reorder(eventId, imageIds)     -- body already: uuids, unique, ≤ 5 (400 otherwise)
  lock event
  status = CANCELLED           → 409 EVENT_CANCELLED
  set(imageIds) ≠ set(current) → 409 IMAGES_CHANGED { imageIds: current order }
  SET CONSTRAINTS "event_image_position_unique" DEFERRED
  UPDATE position = 1 + index of id in imageIds   (one statement, CASE on id)
  → the images in their new order
```

## Reads

- **With an event** (research R6), in every `EventsService` read and write that returns an event:

  ```ts
  const EVENT_INCLUDE = {
    location: true,
    images: {
      select: { id: true, position: true, contentType: true, byteSize: true },
      orderBy: { position: 'asc' },
    },
  } satisfies Prisma.EventInclude;
  ```

- **One image's bytes** (`getEventImage`): `findFirst({ where: { id: imageId, eventId }, select: {
  contentType: true, bytes: true } })`, `404` when absent. Prisma 6 returns `Bytes` as a
  `Uint8Array`, sent with NestJS's `StreamableFile` and the headers in research R4.

## Shared types and helpers (`packages/shared/src/event-image.ts`)

- `ImageContentType = 'image/jpeg' | 'image/png' | 'image/webp'`; `IMAGE_CONTENT_TYPES`, in that
  order.
- `EventImage { id: string; position: number; contentType: ImageContentType; byteSize: number }`.
- `EVENT_IMAGE_LIMITS = { maxCount: 5, maxBytes: 5_242_880 } as const`.
- `GALLERY_INTERVAL_MS = 5000`.
- `sniffImageType(bytes: Uint8Array): ImageContentType | null` (research R3): reads at most the
  first 12 bytes.
- `IMAGE_PIXEL_LIMITS = { maxSide: 16_384, maxPixels: 40_000_000 } as const`.
- `readImageHeader(bytes: Uint8Array): { contentType: ImageContentType; width: number; height:
  number; animated: boolean } | null` (research R3): the signature plus the size from the PNG
  `IHDR`, WebP `VP8X` / `VP8L` / `VP8 `, or JPEG `SOFn` header.
- Backend only, `backend/src/events/image-metadata.ts`: `stripImageMetadata(bytes, contentType):
  Uint8Array` (research R17), throwing a `415` envelope for a structure it cannot walk.
- `packages/shared/src/event.ts`: `Event` gains `images?: EventImage[]` (optional until the contract
  follow-up, research R8; clients treat missing as empty).
- `packages/shared/src/errors.ts`: `IMAGE_LIMIT_REACHED`, `IMAGE_TOO_LARGE`,
  `IMAGE_TYPE_NOT_ALLOWED`, `IMAGES_CHANGED`, `IMAGE_DIMENSIONS_TOO_LARGE` added to
  `ERROR_CODES` (in this PR, research R8).
- `packages/shared/src/api-schema.ts`: regenerated from contract 1.8.0 (in this PR).

## Front-end state (not stored)

- **Image cache** (`packages/shared/src/web/event-images.ts`): image id → `{ url: string | null;
  failed: boolean; users: number; promise }`. An entry is made by the first user, and its object
  URL is revoked and the entry dropped when `users` returns to 0 (research R4).
- **Gallery**: the images it has loaded, held until it unmounts (research R4); shown index; paused
  (arrow under the pointer, keyboard focus on a control, or viewer open); reduced motion; on screen
  (cards, research R14).
- **Admin Images control** (research R9): ordered items, `saved` (an `EventImage`) or `new` (a
  `File` and its preview URL), and the saved images removed but not yet deleted.
