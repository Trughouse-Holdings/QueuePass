# Research: Event Images

Decisions for [plan.md](./plan.md). Each has a decision, its rationale, and the alternatives
considered. The product decisions are Mahdi's (spec Clarifications, 2026-10-12); these are the
technical ones.

## R1. Image bytes are stored in PostgreSQL

**Decision**: A new table, `EventImage`, holds each picture's bytes in a `bytea` column, next to
its event, position, detected type, and size (data-model.md). Nothing is written to the
filesystem, and no service is added.

**Rationale**:

- Constitution II: the system stays one `docker compose up --build`, with no new service, volume,
  or variable. PostgreSQL already has a mapped volume, so images survive a full stop and restart
  like every other record.
- One store means one backup (`pg_dump` includes the images), one transaction for the limit and
  the order (R2), and a cascade that deletes an event's images with it (R7). No orphan files, no
  file written for a refused request.
- Constitution VI: the image rules are persistence rules, and the existing Testcontainers setup
  tests them against real PostgreSQL with nothing else to mock.
- Size is bounded: at most 5 images × 5 MB = 25 MB per event. PostgreSQL stores large values out
  of line (TOAST), so list queries that do not select the bytes are unaffected (R6).

**Known cost**: Prisma 6's query engine passes a `Bytes` value to and from Node as base64 inside
its JSON protocol. Reading or writing a 5 MB image therefore holds roughly 2 to 3 times that in
memory for the moment of the call (the base64 string, the decoded buffer, and the response), about
15 MB, and each read holds one connection of Prisma's pool for its duration. With images loaded
only for cards on screen, two at a time (R14), that is a few dozen MB at a peak and a short queue
for the pool. The running-system gate measures it with `docker stats` (quickstart S11). If it
proves too much, reading the bytes with a streaming query is the next step; it is not built now
(Constitution VIII).

**Alternatives considered**:

- **A filesystem volume** (`/data/images/<id>`, path in the table): a second volume in
  `docker-compose.yml`, files and rows that can disagree (a crash between the write and the
  insert, a delete that removes the row but not the file), a separate backup, and tests that need a
  temporary directory per run.
- **An object store** (MinIO or S3): a new service with its own health check, credentials (a secret
  to manage), a bucket to create in the seed, and the same two-store consistency problem. It suits
  a production system with a CDN, not a proof of concept on a laptop (Constitution VIII).
- **Large objects** (`lo_*`): separate lifecycle, not deleted by a cascade, and not supported by
  Prisma.

## R2. At most 5, positions 1 to n: CHECKs, a deferrable unique constraint, and the event lock

**Decision**:

- `position` is `1` to `5` (CHECK), and `("eventId", "position")` is unique. Together they make it
  a database fact that an event has at most 5 images, whatever writes them (Constitution IV).
- The unique constraint is `DEFERRABLE INITIALLY IMMEDIATE`, written in the migration SQL. A
  deferrable constraint, even one checked immediately, is checked at the end of each statement
  rather than row by row, so the two writes that shift positions (closing the gap after a delete,
  and a new order) each do it in **one** `UPDATE` and need no `SET CONSTRAINTS … DEFERRED`: a
  swap inside one statement is valid when the statement ends. (A non-deferrable unique index is
  checked row by row and could fail mid-swap.) The plan drops `SET CONSTRAINTS` for that reason.
- The Prisma model also declares it, `@@unique([eventId, position], map:
  "event_image_position_unique")`, so the schema documents it and Prisma names it in errors.
  Prisma cannot express `DEFERRABLE`, but `prisma migrate diff` between the migrations and the
  schema is empty with this pair (checked by Nate on PR #35), so no drift appears.
- Every image write (add, delete, reorder) runs in one transaction that first takes the event's
  row lock with the existing `lockEvent(tx, eventId)` (`backend/src/common/event-lock.ts`), then
  reads the event's images and decides:
  - **add**: refuse a cancelled event (`409 EVENT_CANCELLED`) or one with 5 images (`409
    IMAGE_LIMIT_REACHED`), else insert at `count + 1`;
  - **delete**: delete the row, then `position = position - 1` for the images after it;
  - **reorder**: refuse unless the ids sent are exactly the event's images (`409
    IMAGES_CHANGED`), then set each image's position from its place in the list.
- The bytes are read and checked (R3) before the transaction, so the lock is held only for the
  insert, not while the upload arrives over the network.

**Rationale**: The limit is a rule that must hold under concurrency (spec FR-005, FR-009), so an
application-only count-then-insert would race. The event row lock serializes image writes for one
event, as it already serializes tiers, orders, and cancellation, which also gives contiguous
positions and a clear refusal that names the limit. The CHECK and unique constraint are the
backstop: even a write that skipped the lock could not store a sixth image or a repeated position.
Contiguity (no gaps) cannot be expressed as a simple constraint, so it is held by the lock and the
two shifting writes, and tested under concurrency (R16).

Image writes for an event wait for that event's orders and the reverse, for the few milliseconds
of an insert. Orders for other events never wait.

**Why `INITIALLY IMMEDIATE`**: a deferred violation would surface only at `COMMIT`, far from the
statement that caused it. Checked at the end of each statement, a collision fails where it
happens. Under the lock no collision is expected; if one ever happens (a
write that skipped the lock), the exception filter maps a unique violation naming
`event_image_position_unique` (Prisma `P2002`, or SQLSTATE `23505` from a raw statement) to
`409 IMAGES_CHANGED`, instead of today's fallback for `P2002`, `TIER_NAME_TAKEN`. It reads only
Prisma's errors and their structured fields: a `P2002`'s `meta.target` (or model and fields), a
raw statement's `P2010` with `meta.code` `23505` and a `meta.message` naming the constraint or its
key `("eventId", "position")`. An error Prisma did not throw is never mapped by its text.

**Alternatives considered**: A count CHECK through a trigger (more SQL, and the lock is needed for
the message anyway). Locking the event's image rows (`SELECT … FOR UPDATE` on `EventImage`): it
cannot lock rows that do not exist yet, so two first uploads could both see 0. A per-event
advisory lock (a second locking scheme beside `lockEvent`). Positions with gaps (sort by a
sparse number): the API and the Admin app would have to renumber anyway to show "1 of 3".
Shifting through temporary out-of-range positions (needs the CHECK to allow them).

## R3. The type and size in pixels come from the file's content; bytes are limited while reading

**Decision**:

- **One file per request**, in a `multipart/form-data` body with one part named `file` and nothing
  else, read by NestJS's `FileInterceptor('file', …)` (multer, already a dependency of
  `@nestjs/platform-express`) into memory with limits `{ fileSize: 5_242_880, files: 1, fields: 0,
  parts: 1 }`. A local type `UploadedImage { buffer: Buffer; size: number }` is used instead of
  adding `@types/multer`.
- **Size**: multer stops reading at 5,242,880 bytes and NestJS raises `413`. An exception filter
  on the upload route only (`ImageTooLargeFilter`, `@UseFilters` on `uploadEventImage`) answers it
  with `IMAGE_TOO_LARGE` ("An image can be at most 5 MB.", `details.maxBytes`). The service also
  checks `size <= 5_242_880` and throws the same envelope, and the database CHECKs it
  (data-model.md). The global filter does not map `413` to `IMAGE_TOO_LARGE`: a body too large
  for any other operation is a generic `413` (`VALIDATION_FAILED`, "The request body is too
  large."), so no other refusal can claim to be about an image.
- **Type**: `sniffImageType(bytes)` reads the file's signature and returns `image/jpeg`,
  `image/png`, `image/webp`, or `null`:
  - JPEG: `FF D8 FF`;
  - PNG: `89 50 4E 47 0D 0A 1A 0A`;
  - WebP: `52 49 46 46` (`RIFF`), any 4 bytes, `57 45 42 50` (`WEBP`);
  - anything else, or fewer than 12 bytes: `null` → `415 IMAGE_TYPE_NOT_ALLOWED`.

  The part's `Content-Type` and file name are ignored. The stored `contentType` is the detected
  one, and `getEventImage` serves that type (spec edge case "Type by content").
- **Size in pixels** (spec FR-036): `readImageHeader(bytes)` returns `{ contentType, width, height
  }` or `null`, reading only headers:
  - PNG: the `IHDR` chunk, which must come first (width at byte 16, height at 20, big-endian);
  - WebP: the first chunk after `WEBP`: `VP8X` (24-bit width − 1 and height − 1 at bytes 24
    and 27), `VP8L` (14-bit width − 1 and height − 1 after the `0x2F` signature byte at 20), or
    `VP8 ` (14-bit width and height at bytes 26 and 28, after the `9D 01 2A` start code);
  - JPEG: walk the segments from `SOI` to the first start-of-frame marker (`SOF0`–`SOF15`
    except `DHT` `C4`, `JPG` `C8`, and `DAC` `CC`), whose height and width are at bytes 3
    and 5 of the segment.

  It also reports `animated`: a PNG with an `acTL` chunk before its first `IDAT` (APNG), or a
  WebP whose `VP8X` header has the animation flag (`0x02`) or that contains an `ANIM` or `ANMF`
  chunk. An animated picture is `415 IMAGE_TYPE_NOT_ALLOWED` (spec FR-037), the same answer as a
  GIF: the spec puts animated images out of scope, and a moving picture inside a gallery would add
  motion that reduced motion (R11) cannot stop.

  A picture wider or taller than 16,384 pixels, or of more than 40,000,000 pixels, is refused with
  a new code, `400 IMAGE_DIMENSIONS_TOO_LARGE` (`details.width`, `height`, `maxSide`,
  `maxPixels`). A file whose header is cut short, or that gives no size or a zero size, is
  `415 IMAGE_TYPE_NOT_ALLOWED`: it is not a picture we can read.
- **Missing or extra parts**: no `file` part, a non-multipart body, a second file, or any other
  field → `400 VALIDATION_FAILED`, naming the rule.
- `sniffImageType`, `readImageHeader`, the limits, and the type list live in
  `packages/shared/src/event-image.ts`, so the Admin app's preview (R9) and the Backend use the
  same rule.
- **Then metadata is removed** (R17), and the stored bytes are what remains. It runs before the
  pixel limits, so a file that cannot be walked is `415` before it is `400`, the contract's order.

**Rationale**: Spec FR-003 and FR-004 (Mahdi: check the real type, not the extension or the
declared type). A signature check is exact for these three formats and needs no decoder. SVG is
excluded by construction: it is text and can carry scripts. Limits applied while reading mean an
oversized upload is cut off at 5 MB, not buffered whole. One file per request keeps every refusal
about one named file (FR-017) and the limit check simple.

**Why a pixel limit**: a few kilobytes of PNG can declare 30,000 × 30,000 pixels, which every
browser would try to decode into about 3.6 GB. 16,384 pixels a side is a safety bound we chose: it
is a common GPU texture and canvas size limit, not a limit on what browsers can decode, and well
above any photo an event needs. 40 megapixels (about 160 MB decoded) is more than any phone camera
in common use, so no real photo is refused. A separate code, rather than reusing one: the remedy
differs (make the picture smaller, not choose another format or a smaller file); `413` would say
the request body is too large, which it is not; `400` because the content is unacceptable as sent,
and clients branch on `code`.

**Known limit**: the check reads the signature and headers, not the whole file. A file that starts
like a picture but is damaged later is stored, and the browser shows it as an image that could not
load (spec edge case). Decoding every upload would need an image library (R14).

**Alternatives considered**: NestJS's `FileTypeValidator` (uses the `file-type` package, answers
`400` with its own message, and its accepted types are configured by MIME pattern, not signature
list). The `file-type` package directly (ESM-only, recognizes over a hundred formats we refuse; a
new dependency for 15 lines). Trusting the part's `Content-Type` (what Mahdi ruled out). Several
files per request (one refusal would refuse or half-apply the rest). `400` for both refusals (the
HTTP statuses `413` and `415` say exactly these two things; clients branch on `code` either way).

## R4. Serving images: an authenticated read the apps fetch as a blob

**Decision**: `GET /events/{id}/images/{imageId}` (`getEventImage`) needs a bearer token like every
other operation, for any signed-in role. A browser cannot send a bearer token for `<img src>`, so
the apps fetch the bytes through their existing API client, with the signed-in user's token, as a
`Blob` (`parseAs: 'blob'`), and show it from an object URL (`URL.createObjectURL`).

- **Shared cache** (`packages/shared/src/web/event-images.ts`): a module-level map from image id
  to `{ url, users }`. `useEventImage(eventId, imageId, enabled)` fetches once per id, counts the
  components using it, and revokes the object URL when the last one lets go. Two cards, or a card
  and the full-screen view, showing the same image fetch it once. A failed load (a network
  failure, a `5xx`) is not kept while the image is held: the next component to acquire it (a slide
  mounting again, the viewer opening) fetches it again, and every holder shows the outcome.
- **Browser cache**: an image's content never changes (a new picture is a new id, R5), so the
  response carries `Cache-Control: private, max-age=31536000, immutable`. After an object URL is
  revoked, fetching the same image again is answered from the browser's own cache. `private` keeps
  shared caches from storing it.
- **Headers**: `Content-Type` is the detected type (R3), `X-Content-Type-Options: nosniff`,
  `Content-Length`.
- A `401` while loading an image shows the image as unavailable; the page's other requests already
  send the user to sign in (spec edge case "Session ends").
- **What a gallery holds**: the event-page gallery and the full-screen viewer hold every image
  they have loaded until they unmount (at most 5 per event, 25 MB), so looping back neither fetches
  again nor flickers. A **card** holds only its shown image and the next one while it is on or near
  the screen, and lets go of both when it leaves (R14). Letting go revokes the object URL when no
  other user holds it. Loading again later is answered from the browser's HTTP cache (`immutable`,
  above), so it costs no network and no Backend work, only a new blob; because the next image is
  always loaded before it is shown, a card never flickers.
- **CORS preflight**: a request with an `Authorization` header from another origin is preceded by
  an `OPTIONS` preflight. `enableCors` in `backend/src/configure-app.ts` sets no `maxAge` today,
  so browsers cache each preflight for only about 5 seconds, and a rotating gallery would send one
  before most image reads. The implementation sets `maxAge: 600` (10 minutes; browsers cap it at
  2 hours or more), and a CORS test asserts `Access-Control-Max-Age: 600`. It changes no allowed
  origin, method, or header.

**Rationale**: Constitution V says the Backend MUST validate the token on every endpoint except
health. Fetching with the token is the only option that keeps that rule unchanged: the token stays
in memory in the existing client, and the object URL is a page-local `blob:` reference, not a
credential. Images are visible to every signed-in user, so caching them privately in the browser
exposes nothing new.

**Alternatives considered**:

- **Short-lived signed URLs** (`?expires=…&sig=HMAC`): the image route would accept requests with
  no token, which Constitution V forbids without an amendment; it also needs a signing secret
  (configuration and rotation) and expiry handling when a card stays open past it.
- **Public image reads** (`@Public()` on the GET): the simplest for `<img src>`, but a second
  unauthenticated endpoint beside health, which needs a constitution amendment. Not proposed:
  nothing in the spec needs images outside a signed-in app.
- **A session cookie for images only**: a second authentication mechanism, and CSRF and cookie
  handling the project has none of.
- **Bytes inline in the event payload (base64)**: every event list would carry up to 25 MB per
  event, and nothing could be loaded lazily.

## R5. The API: four operations and five codes

**Decision** (contract 1.8.0, contracts/README.md):

| Operation | Route | Roles | Success |
|---|---|---|---|
| `uploadEventImage` | `POST /events/{id}/images` (multipart, one `file`) | `queuepass-admin` | `201 EventImage` |
| `getEventImage` | `GET /events/{id}/images/{imageId}` | any signed-in | `200` bytes |
| `deleteEventImage` | `DELETE /events/{id}/images/{imageId}` | `queuepass-admin` | `204` |
| `reorderEventImages` | `PUT /events/{id}/images/order` `{ imageIds }` | `queuepass-admin` | `200 EventImage[]` |

New codes, in the standard envelope:

| Code | Status | When |
|---|---|---|
| `IMAGE_TOO_LARGE` | `413` | over 5,242,880 bytes (`details.maxBytes`) |
| `IMAGE_TYPE_NOT_ALLOWED` | `415` | content is not JPEG, PNG, or WebP (`details.allowed`) |
| `IMAGE_LIMIT_REACHED` | `409` | the event already has 5 (`details.limit`, `details.count`) |
| `IMAGES_CHANGED` | `409` | the new order does not name exactly the current images (`details.imageIds`, the current order) |
| `IMAGE_DIMENSIONS_TOO_LARGE` | `400` | wider or taller than 16,384 pixels, or over 40,000,000 pixels (R3) |

The existing `EVENT_CANCELLED` (409) covers a cancelled event, and `VALIDATION_FAILED` (400) a
malformed body, a repeated id, or more than 5 ids. An image id of another event is `404`.

Refusal order for an upload: `401`/`403` (guards run before the body is read) → `413` while
reading → `400` for the wrong parts (the file interceptor runs before route pipes) → `400` for a
malformed event id (`ParseUUIDPipe`) → `415` → `400 IMAGE_DIMENSIONS_TOO_LARGE` → `404` unknown
event → `409 EVENT_CANCELLED` → `409 IMAGE_LIMIT_REACHED`. The upload's `400` uses a new response,
`ImageRejected`, that lists both `400` codes.

**Rationale**:

- **Upload appends** (FR-006); position is never sent, so a client cannot leave gaps.
- **Reorder sends the whole list** (FR-008): idempotent, one statement, and it detects that
  another admin changed the images in the meantime, because the set no longer matches. Moving one
  image by index would interleave badly with a concurrent move and could not tell.
- **No list endpoint**: the event payload already carries the metadata (R6).
- **`PUT /images/order`** rather than `PUT /images`: a `PUT` on the collection would suggest it
  replaces the images, not their order.
- **No `updatedAt`, no file name**: nothing reads them (Constitution VIII); not storing the file
  name keeps an admin's local naming out of the API.

**Alternatives considered**: A `position` on upload (inserting in the middle shifts others; the
Admin form reorders after uploading, R9). `PATCH /images/{imageId} { position }` (see above).
`422` for the type (no operation uses it; `415` is the HTTP meaning). `400` for the limit (it
depends on stored state, which this contract reports as `409`).

## R6. The event payload carries image metadata, never bytes

**Decision**: Every operation that returns an `Event` (`listEvents`, `getEvent`, `createEvent`,
`updateEvent`, and `cancelEvent`'s `event`) includes `images`: the event's images ordered by
`position`, each `{ id, position, contentType, byteSize }`. `EventsService` uses one include,
`EVENT_INCLUDE = { location: true, images: { select: { id, position, contentType, byteSize },
orderBy: { position: 'asc' } } }`, everywhere it reads an event, so the `bytes` column is never
selected. A new event has `images: []`.

**Rationale**: Spec FR-012. The cards need to know which images to load and how many there are
before loading any (FR-026, FR-032). The metadata is about 100 bytes per image. Prisma loads the
include with one extra query by `eventId IN (…)`, served by the unique index on
`("eventId", "position")`.

**Alternatives considered**: A separate `GET /events/{id}/images` list (one more request per card,
for the same data). Embedding only a count and the cover id (the card still needs the other ids to
rotate).

## R7. Cancelled, deleted, and sales-closed events

**Decision**:

- **Cancelled**: `005` made a cancelled event read-only, so add, delete, and reorder refuse it with
  the existing `409 EVENT_CANCELLED`, checked under the lock. Its images are still listed and
  served, and both apps still show them (spec US2 scenario 10). The Admin app already hides Edit
  for a cancelled event.
- **Deleted**: `EventImage.eventId` is `ON DELETE CASCADE`, so `deleteEvent` deletes the images in
  the same statement. An event with orders still cannot be deleted (`005`), so its images stay.
- **Sales closed** (`006`): no effect; images can still be changed while the event is not
  cancelled, and are shown.

**Rationale**: Spec FR-010 and FR-011 follow the rules events already have. A cascade keeps the
database free of images whose event is gone without application code.

**Alternatives considered**: Allowing image changes on a cancelled event (contradicts `005`'s
read-only rule). `RESTRICT` on delete (every event delete would need to remove images first).

## R8. Contract 1.8.0, keeping `main` green between the two PRs

**Decision**: The contract change and regenerated `packages/shared/src/api-schema.ts` land in this
spec and plan PR, as 1.8.0. Three things would otherwise turn `main` red between the PRs, and each
is avoided in this PR:

1. **New response field**: `Event.images` is documented as always sent but is **not** in
   `required`, because the Backend on `main` does not send it until the implementation merges and
   its tests validate every response against the contract (as `013` research R11 and `016`
   research R9 did).
2. **New operations**: the Backend's route-coverage test
   (`backend/test/contract/route-coverage.e2e-spec.ts`) fails when the contract declares an
   operation no route serves. Checked on 2026-10-12: with the four new operations and the test
   unchanged, both of its tests fail (`unimplemented` lists the four routes). So the four
   operations carry a vendor extension, `x-planned: '014'`, explained in the contract's `info`
   description (feature-neutral wording), and the test follows one strict rule, the same as `015`'s
   spec PR (#38), whose `route-coverage.e2e-spec.ts` and `expect-to-match-contract.ts` this PR
   copies exactly so that whichever of the two merges second has no conflict there:
   - an unmarked operation must be served, with exactly its declared roles;
   - a marked operation must **not** be served: once a route serves it, the test fails
     (`plannedButImplemented`), so its implementation must remove the marker in the same change
     that adds the route.

   Verified on 2026-10-13: the route-coverage and CORS-and-docs suites pass with the change.

   **Quality gate 4** says a failing test is never skipped to unblock a merge. This is not that:
   the test's premise was "every declared operation is served", which Constitution III's two-PR
   order makes untrue for one PR's lifetime. The test now asserts the corrected rule above, which
   is stricter than before in one way (a served route must not stay marked), and it still fails an
   undeclared route or a wrong role. The marker is in the contract, which is shared surface, so
   every team member approves it in this PR.
3. **New error codes**: a unit test (`backend/test/unit/us-states.spec.ts`, from `013`) checks that
   every code in the contract's `ErrorEnvelope` enum is in `ERROR_CODES`
   (`packages/shared/src/errors.ts`). So this PR adds the five codes to `ERROR_CODES` too, after
   `013`'s address codes, as `006`'s plan PR did for its codes. Nothing sends them until the
   implementation merges.

New request shapes are not validated on `main` and no front end calls the new routes yet, so
nothing else changes. `npm run generate:api` was run and `node scripts/check-contract-drift.mjs`
passes.

**Removing the markers**: the implementation removes each `x-planned: '014'` marker in the commit
that serves its route (tasks T016, T032), regenerates `api-schema.ts`, and the route-coverage test
proves it. This is a change to the contract in the implementation PR, but only of the marker the
contract itself says the implementation removes; no request, response, role, or error changes.

**Follow-up**: once the implementation has merged, a small contract PR adds `images` to
`Event.required`, with `api-schema.ts` regenerated. The implementation session opens a GitHub
issue for it as its last task (tasks.md), as `013` did.

**Version and `015`**: `015`'s spec PR (#38) also takes 1.8.0. Whichever of #35 and #38 merges
second rebases onto the other, moves to **1.9.0**, keeps both sets of operations, codes, and
markers, and reruns `npm run generate:api` and the drift check.

**Rationale**: Constitution I (contract first, reviewed before code) and III (`main` green and
demo-ready at every merge). A marker in the contract keeps the operations fully declared and
typed now, rather than holding them back to the implementation PR; failing on a served marked
operation keeps the marker from outliving the implementation.

**Alternatives considered**: Leaving the new paths out until the implementation PR (contract
after code, which Constitution I forbids). Declaring them and letting the route-coverage test fail
until the implementation merges (`main` red). Skipping a marked operation whenever it is unserved
and checking it once served (the first version of this PR: a marker could stay on forever; `015`
chose the strict rule and this PR adopts it). A list of planned operations inside the test file
(the contract would no longer be the one place that says what is planned).

## R9. The Admin form's Images control: changes are made on Save

**Decision**: A new `admin-app/src/components/ImagesField.tsx`, used by `EventForm.tsx` in both
modes, inside a `<fieldset>` with the legend "Images".

- **State**: an ordered list of items, each either `{ kind: 'saved', image: EventImage }` or
  `{ kind: 'new', key, file: File, previewUrl }`, and a list of saved images the admin removed. On
  edit it starts from `event.images ?? []`. A picture uploaded from the form becomes `saved` and
  keeps its `file`: its preview stays the chosen file's object URL, not read back from the Backend
  (no second download of what was just sent, and no placeholder in between).
- **Add**: a file input labeled "Add images", `accept="image/jpeg,image/png,image/webp"`,
  `multiple`. Each chosen file goes through a preview check (FR-016): would it make more than 5, is
  it over 5,242,880 bytes, and does `readImageHeader` of the file's bytes (`await
  file.arrayBuffer()`, at most 5 MB) accept its type and size in pixels. Accepted files are appended
  with an object URL preview; refused ones are named in a note with the reason: "poster.gif: only
  JPG, PNG, or WebP pictures", "banner.png: animated pictures are not accepted" (when
  `readImageHeader` reports `animated`), "photo.jpg: over 5 MB", or "scan.png: over 16,384 pixels
  a side or 40 megapixels". The preview reads headers only; a file that passes it but whose segments
  or chunks run past the end of the file is refused by the Backend at save time (`415
  IMAGE_TYPE_NOT_ALLOWED`, R17) and shown like any other refusal: the form is only a preview
  (FR-016). The input is hidden, and the note says "5 of 5 images. Remove one to
  add another.", when the list is full. The input is reset after each choice so the same file can be
  chosen again.
- **List**: an `<ol>` of thumbnails. Each item shows its preview (`alt="Image 2"`), "Image 2", a
  "Cover" `.pill` on the first, and three buttons: "Move image 2 earlier" (not on the first),
  "Move image 2 later" (not on the last), "Remove image 2". Buttons, not drag-and-drop (spec Out of
  Scope), so it works by keyboard.
- **Hint**: "Up to 5 images. JPG, PNG, or WebP, up to 5 MB each. The first image is the cover."
- **On Save**, after the event's details, seating, and ticket types are saved as today
  (`scheduleEvent` / `saveEvent`), `applyImages(eventId)` runs, stopping at the first refusal:
  1. delete each removed image (`404` counts as done: it is already gone), dropping it from the
     removed list as it succeeds;
  2. upload each `new` item in list order, replacing it with the `saved` image the Backend
     returns;
  3. if the order of the items now differs from the order the Backend holds (the loaded order,
     minus deletions, plus uploads at the end), send `reorderEventImages` with every id in item
     order.

  Because each step updates the state as it succeeds, saving again after a refusal finishes what
  is left and never uploads a picture twice (FR-017).
- **After creating** (review round 1, narrowed after the PR review): the create flow of `008` is
  unchanged up to the pictures: event, then seating, then ticket types. When every step succeeds
  it goes to the event page, as today. If the seating or a ticket type is refused, it behaves
  exactly as today (`EventForm.tsx` `scheduleEvent`, the "Seating setup not finished" banner with
  "Finish on the event page"; `admin-app/test/event-seating-create.test.tsx` stays as it is): it
  stays on Schedule event, no picture is sent, and every value, the chosen pictures included,
  stays in the form (Constitution IV). Only when the event, its seating, and its ticket types are
  all saved and a **picture** step is refused or cannot be sent does it call
  `navigate(`/events/${id}/edit`, { replace: true, state: { pendingImages, notice } })`: the
  address becomes the new event's edit form, and the form initializes its Images control from the
  event's saved images followed by `pendingImages` (the `File`s not yet added, kept in router
  state, which a `File` survives), and shows `notice` as a banner: "Event created. These pictures
  were not added: poster.gif (This file is not a JPG, PNG, or WebP picture.). Save again to add
  them." The heading reads "Edit event". Saving again goes through the edit path (`saveEvent`,
  then `applyImages`), so `createEvent` is never called a second time and saved pictures are not
  uploaded again (FR-017, FR-018). This works whether React keeps or remounts the form, because the
  edit form reads the pending pictures from router state on load. As soon as it has read them into
  its own state, it clears the history entry's state with `navigate(location.pathname, { replace:
  true, state: null })`, so going Back to this entry after a successful save cannot bring the same
  pictures back as pending and upload them again. A network failure during an image step is
  treated like a refusal: the same switch, the same message with "could not be sent" as the
  reason.
- **Refusals**: shown through `ErrorBanner`, with the picture's file name before the Backend's
  message for an upload ("poster.jpg: This file is not a JPG, PNG, or WebP picture."). Every value
  and every unsaved change stays. On `409 IMAGES_CHANGED`, the control reloads the event's images
  (`getEvent`), keeps the admin's pending new pictures after them, and shows the message, so the
  admin checks and saves again (spec US3 scenario 6).
- **Constitution IV**: in the switch to the edit form no entered value is lost: everything except
  the pending pictures is already saved and is loaded back by the edit form, and the pending
  pictures travel in router state.
- **Cancel** leaves the page without calling the API, so nothing changes (FR-015). Object URLs of
  chosen files, sent or not, are revoked when an item is removed and when the form unmounts.
- `admin-app/src/api/images.ts`: `uploadEventImage(eventId, file)` posts a `FormData` with
  `file` through the typed client (`bodySerializer: (body) => body`, so `openapi-fetch` sends the
  `FormData` as is and the browser sets the multipart boundary; a test checks the request's
  `Content-Type` starts with `multipart/form-data; boundary=`), `deleteEventImage`, and
  `reorderEventImages`.

**Rationale**: Spec FR-014 to FR-018 and Constitution IV (keep what the admin entered). A new event
has no id until it is created, so images must wait for it on create; doing the same on edit means
one behavior in both modes, and Cancel means cancel. Upload-then-reorder keeps the API simple
(R5): the form puts new pictures where the admin wants them with one reorder.

**Alternatives considered**: Applying each image change at once on edit (Cancel would not undo it,
and create would still need staging). Uploading before the event exists (orphan images). Several
files in one request (R3).

## R10. What goes in `packages/shared`

**Decision**:

- `packages/shared/src/event-image.ts` (exported from the package root): the `EventImage` type,
  `EVENT_IMAGE_LIMITS = { maxCount: 5, maxBytes: 5_242_880 }`, `IMAGE_CONTENT_TYPES`,
  `IMAGE_PIXEL_LIMITS = { maxSide: 16_384, maxPixels: 40_000_000 }`, `GALLERY_INTERVAL_MS =
  5000`, `sniffImageType(bytes)`, and `readImageHeader(bytes)`. Used by the Backend
  (authoritative) and the Admin app (preview). Metadata removal (R17) is Backend-only, in
  `backend/src/events/image-metadata.ts`. `Event` gains `images?: EventImage[]` (optional,
  as in the contract, R8).
- `packages/shared/src/web/` (exported from `@queuepass/shared/web`):
  - `event-images.ts`: the object URL cache and `useEventImage` (R4);
  - `use-gallery-rotation.ts`: the timer and pause rules (R11);
  - `image-gallery.tsx`: `ImageGallery({ eventId, eventName, images, variant: 'card' | 'page',
    eventHref? })`, which renders nothing for no images (FR-027);
  - `image-viewer.tsx`: the full-screen view (R12);
  - `gallery-parts.tsx`: what both share, so neither imports the other: holding images while
    mounted, the image or its placeholder, the slide (`useSlide`), and the set of images wanted
    so far.
- **Per app**: the Admin app's `ImagesField` and `api/images.ts` (R9), and the places each app puts
  the gallery: the Customer app's `EventCard.tsx` and `pages/EventDetail.tsx`, and the Admin app's
  `pages/EventDetail.tsx` (FR-019).
- **Styles**: the gallery and viewer classes and two tokens go in the shared theme (R13). The
  Images control's layout stays in `admin-app/src/styles.css`, on theme values.

**Rationale**: Constitution VII: both apps show the same gallery, so one component guarantees they
match, as `013`'s shared `AddressLink` does. Both apps already provide `useAuth().api` from the
shared `AuthProvider`, so the hook needs no app-specific client. One limit and one type check for
the Backend and the form means the preview never disagrees with the rule.

**Alternatives considered**: The gallery in the Customer app only (the Admin event page would need
a copy, FR-019). The type check only in the Backend (the preview would guess from the file name,
which is what Mahdi ruled out).

## R11. Rotation and pausing

**Decision**: `useGalleryRotation({ count, paused })` keeps the shown index, and each gallery that
turns on its own has a Pause/Play button (Mahdi, 2026-10-13, after the PR review).

- **Timer**: with 2 or more images, a `setTimeout` of 5,000 ms shows the next image (the first
  after the last). Every change, automatic or by an arrow, schedules a fresh 5,000 ms, so an arrow
  press or a resume always gives a full 5 seconds (spec US2 scenario 3).
- **Pause/Play button** (FR-038):
  - **Where**: one per gallery that turns on its own: each card gallery and the event page
    gallery, in both apps. Not in the full-screen viewer, which never changes on its own (R12).
    Not shown with one image, nor under reduced motion, where nothing moves, so a button would
    control nothing.
  - **State**: `stopped`, per gallery instance, in memory. It starts `false` (turning), since
    rotation is on by default. Pause sets it, Play clears it. It is not saved: a new page, a
    reload, or a card scrolled away and remounted starts turning again (spec Assumptions). One
    card's button never affects another card.
  - **While stopped**: no timer, whatever the pointer or focus does; the arrows still flip (each
    press shows the image at once and starts no timer). Play schedules the next change 5 seconds
    later.
  - **Name, not `aria-pressed`**: the button's accessible name says what it will do: "Pause
    images of Season Opener" while turning, "Play images of Season Opener" while stopped, with a
    matching visible glyph (two bars / a triangle). The WAI-ARIA Authoring Practices carousel
    pattern swaps the label this way; `aria-pressed` on a button named "Pause" would be read as
    "Pause, pressed" while playing is what is stopped, which is confusing. Focus stays on the
    button when its name changes.
  - **Look**: the same 44 × 44 pixel, theme-colored round button as the arrows (R13), at the bottom
    left of the image (the position label is at the bottom right).
  - **Its own focus does not pause**: keyboard focus on the Pause/Play button is not one of the
    temporary pauses below, so pressing Play while the button has focus visibly resumes the
    gallery.
- **Temporary pauses** (Mahdi, 2026-10-12): while not stopped, the timer is also cleared while
  - the pointer is over a previous or next arrow (`pointerenter` / `pointerleave` on each arrow),
  - or an arrow, or on the event page the image button that opens full screen, has **keyboard**
    focus. Keyboard focus is focus not caused by a pointer: the gallery records a `pointerdown`
    inside it and ignores the focus that follows, so a mouse click on an arrow does not keep the
    gallery paused after the pointer leaves (browsers focus a clicked button). The press ends at
    the next `click`, `pointercancel`, or `keydown` anywhere in the document, through one set of
    capture listeners shared by every gallery on the page (not three per gallery);
  - or the full-screen view is open (R12);
  - or, for a card, it is not on or near the screen (R14).

  Nothing else pauses it: not the pointer over the image, the card, or the page. When a temporary
  pause ends, the next image comes 5 seconds later.
- **Arrow hover and focus (Mahdi), plus image-button focus (recommended for keyboard users)**:
  Mahdi named the arrows. On the event page the image itself is a control (it opens full screen),
  so this spec adds that keyboard focus on it also pauses, so what Enter opens cannot change while
  a keyboard user is on it. On a card the image is not a tab stop (R12), so only the arrows are.
- **Reduced motion** (decided by Mahdi, 2026-10-12): when
  `matchMedia('(prefers-reduced-motion: reduce)')` matches, no timer runs at all and there is no
  Pause/Play button; the arrows still flip. The hook listens for changes to the setting; if it
  turns off, the gallery starts turning and the button appears.
- **Slide between images** (decided by Mahdi, 2026-10-19, replacing "no animation"; spec FR-040):
  the gallery keeps the outgoing image for the length of one slide and shows both in a clipped
  track: the outgoing image moves from 0 to −100% and the incoming one from 100% to 0 for the next
  image, mirrored for the previous arrow, over 400 ms with `ease-in-out`, as CSS `transform`
  animations (theme keyframes, so it costs no layout and stays on the compositor). The direction
  comes from the action, not the index, so wrapping from the last image to the first still slides
  left. The outgoing image is `aria-hidden` and not a control; the live region and names follow the
  incoming image only. A new change during a slide drops the outgoing image and slides from the
  current one. A card keeps the outgoing image's object URL until the slide ends, then lets it go,
  so a card holds at most 3 images for 0.4 seconds and 2 otherwise (R14). Under reduced motion no
  slide classes are set and `@media (prefers-reduced-motion: reduce)` also turns the keyframes
  off, so the image simply changes.
- **Announcements**: the slide area has `aria-live="off"` while it turns on its own, and
  `aria-live="polite"` while stopped, temporarily paused, or under reduced motion, so an arrow
  press is announced and automatic changes are not (the WAI-ARIA carousel pattern). On a card the
  image sits inside the hidden link (R12), so the card's position text ("2 of 3") is the part
  announced: it is inside the same live region, with the same `off`/`polite` rule, so an arrow
  press or Play on a card is announced too (decided 2026-10-19, found while building T036).

**WCAG 2.2.2 (Pause, Stop, Hide, Level A)**: the galleries are auto-updating content that starts on
its own, runs alongside other content, and goes on longer than 5 seconds, so 2.2.2 applies. It
asks for "a mechanism for the user to pause, stop, or hide" it. The Pause/Play button is that
mechanism, on every gallery that changes on its own, and the pause lasts until the user chooses
Play. The galleries therefore meet 2.2.2. The arrow pauses and reduced motion remain as extra
comfort, not as the mechanism.

**Alternatives considered**: Pausing on hover over the whole gallery (Mahdi ruled it out). No
Pause/Play button (the first version of this spec, by Mahdi's earlier decision; it did not meet
2.2.2). One button for all cards on the list (pausing one event's pictures should not stop
another's, and each card's button sits on its own gallery). Remembering a pause across pages or
visits (needs storage and a preference no one asked for; Constitution VIII). A button in the
full-screen view (it does not change on its own). `aria-pressed` (above). Stopping after one full
cycle (not what Mahdi asked). `setInterval` (an arrow press would not restart the full 5
seconds). No animation (the first decision; Mahdi found the sudden swap jarring and chose a slide on
2026-10-19). A fade (Mahdi asked for a slide). A JavaScript-driven animation (CSS transforms are
smoother and need no library).

## R12. Full screen, and what selecting a card's image does

**Decision**:

- **Event page** (both apps): the shown image is inside a `<button>` named "View Season Opener,
  image 2 of 3, full screen". Selecting it opens `ImageViewer` at that image.
- **Event card**: the image is inside a link to the event page, the same destination as the card's
  title, with `tabIndex={-1}` and `aria-hidden="true"`: a larger target for pointer users, with no
  second tab stop or duplicate announcement for keyboard and screen reader users, who use the title
  link. The arrows and the Pause/Play button are buttons outside the link, so flipping or pausing
  never opens the event. On the event page they are likewise outside the full-screen image button.
  No full screen from a card (confirmed by Mahdi).
- **Labels, in every variant**: each gallery is a `role="group"` with
  `aria-roledescription="carousel"` and `aria-label` "Images of Season Opener", and its arrows are
  named "Previous image of Season Opener" and "Next image of Season Opener", so on a list of cards
  every arrow says which event it belongs to.
- **`ImageViewer`**: rendered with `createPortal` into `document.body`, so no card or page
  container can clip it.
  - A `div` with `role="dialog"`, `aria-modal="true"`, and `aria-label` "Season Opener, image 2 of
    3", fixed over the whole window on the `--scrim` backdrop (R13), above the top bar.
  - The image with `object-fit: contain` in the space left by the controls, so the whole picture
    is visible as large as fits (FR-029).
  - A "Close full screen" button (an "×" with that accessible name) in the top corner; with 2 or
    more images, "Previous image" and "Next image" buttons on the sides and the position ("2 of 3")
    in `--scrim-text`.
  - Keys: Esc closes; Left and Right arrow keys flip, wrapping around. No automatic change.
  - Focus: moves to the close button on open; Tab and Shift+Tab cycle among the viewer's controls
    only; on close, focus returns to the button that opened it, and the gallery shows the last
    image viewed (FR-030).
  - While open, the app root (`#root`, which the portal is outside of) gets the `inert`
    attribute, so nothing behind can be focused, clicked, or read by a screen reader; the page
    behind does not scroll (a class on `<body>` sets `overflow: hidden`); and the gallery's
    rotation is paused (R11). The Tab trap stays as well, because jsdom does not implement
    `inert`.
  - It loads the shown image and its neighbors through `useEventImage` (R4), so flipping is quick.

**Rationale**: Spec FR-020 and FR-029/FR-030. On a card, the whole card already leads to the
event; making the image do the same is what customers expect, and full screen belongs where the
customer is looking at one event. A custom dialog behaves the same in every browser and in jsdom,
so focus trapping and return are tested directly (R16).

**Alternatives considered**:

- **The browser Fullscreen API** (`element.requestFullscreen()`): hides the browser's toolbars, but
  iPhone Safari does not support it for elements other than video, it needs a user gesture each
  time, and Esc leaves browser full screen without telling the page, so two states can disagree.
  Mahdi described an overlay covering the viewport, which this is.
- **The native `<dialog>` with `showModal()`**: gives a top layer and Esc for free, but jsdom does
  not implement `showModal`, and returning focus on close differs between browsers, which FR-030
  requires.
- **Full screen from the card too**: a second meaning for selecting the image, and the card's main
  action is opening the event.

## R13. Layout, and fitting the shared theme (`012`)

**Decision**: The gallery and viewer are shared controls used by both apps (R10), so their rules go
in the shared theme, `packages/shared/src/web/theme.css` (`012` research R2: a control both apps
use belongs to the theme). `012` is on `main` with that file and the no-drift check (`012`
research R6).

- **Classes**: `.page-band`, `.gallery`, `.gallery--card`, `.gallery--page`, `.gallery__open` (the
  event page's image button), `.gallery__image`, `.gallery__placeholder`, `.gallery__arrow`,
  `.gallery__arrow--prev`, `.gallery__arrow--next`, `.gallery__count`, `.gallery__toggle`
  (Pause/Play), `.gallery__frame` (one image in the slide track) and the four slide classes
  `.gallery__slide--{out,in}-{left,right}` with their `gallery-*` keyframes (R11, FR-040); `.viewer`, `.viewer__image`, `.viewer__close`, `.viewer__arrow` (with `--prev` and
  `--next`), `.viewer__count`; and `.viewer-open` on `<body>`.
- **Card**: `.gallery--card` is 4:3 (`aspect-ratio`; Mahdi, 2026-10-19: the gallery takes most of
  the card), flush with the top and sides of the card,
  above the title. The Customer app's `.event-card` gives the gallery negative margins equal to
  its own padding (`calc(-1 * var(--space-N))`, which `012`'s rule C5 allows) and rounds its top
  corners with the card.
- **Event page**: the event pages wrap the gallery in `<div className="page-band">`. `.page-band`
  spans the full width of the app window, edge to edge, above the page title: `width: 100vw` with
  `margin-inline: calc(50% - 50vw)`. Because `100vw` includes the vertical scroll bar on Windows,
  sideways scrolling is prevented only where a band is shown: `.app:has(.page-band) { overflow-x:
  clip }`. The shared theme sets no `overflow` on `.app` otherwise, so no other page changes.
  The band's height is `clamp(200px, 40vw, 480px)`.
- **Vertical placement**: in `theme.css` on `main`, `.main` has `padding: 32px 24px 64px`, and
  `22px 16px 48px` inside the 640-pixel breakpoint, as literal values (`012` kept the theme's own
  lengths). The band sits exactly flush under the sticky top bar by cancelling that top padding
  with the same literals: `margin-top: -32px`, and `-22px` inside the same breakpoint, with
  `margin-bottom: 24px` before the title. A comment on both `.main` rules points at the band, and
  a theme test (T024) asserts the band's negative top margin equals `.main`'s top padding at both
  widths, so the two cannot drift apart. This is the smaller change: tokenizing `.main`'s padding
  first would move every page of both apps by 2 pixels at phone width (22 → 24) for one band.
- **Images**: `object-fit: cover` in both galleries (the area is filled, edges may be cropped);
  `contain` in the viewer (the whole picture).
- **Arrows, Pause/Play, and position**: over the image; arrows vertically centered on each side, at
  least 44 × 44 pixels, with an opaque `--surface` background, `--text` glyph, `--border-strong`
  border, and `--radius-pill`, so they read the same on any picture. The position ("2 of 5") is a
  small label in the same colors at the bottom right corner; the Pause/Play button, styled like the
  arrows, at the bottom left. Text, not dots: it says the position without relying on color or tiny
  targets (Constitution VII, `008` FR-006).
- **Placeholder**: `--surface-alt` with `--text-muted` "Image unavailable" when loading failed;
  the same box with no text while loading.
- **Two new tokens**, in both the light and dark sets with the same values (like
  `--brand-mark-end`): `--scrim: rgb(0 0 0 / 92%)`, in the theme's `rgb(… / %)` style (the
  full-screen backdrop) and
  `--scrim-text: #ffffff` (the position label on it). `012`'s contrast test gains the pair
  `--scrim-text` on `--scrim` composited over white (about 18:1).
- **Admin Images control**: its layout is Admin-only, so it stays in `admin-app/src/styles.css`
  (`.image-list`, `.image-item`, `.image-item__thumb`), with spacing on `var(--space-N)` and no
  color written out. It reuses `.btn`, `.pill`, `.note`, and `.field__hint`.
- **No inline styles** that set a color, font, or shadow anywhere (`012`'s inline rule).

**Rationale**: Constitution VII: one shared look, and app styles only on theme values. A scrim
must be dark in both light and dark mode, and no existing token is (in dark mode `--bg` is dark
but `--text` is light, and vice versa), so it needs its own token. Reusing `--surface` for the
controls makes them readable on any picture without a new color.

**Alternatives considered**: Gallery rules in each app's stylesheet (two copies to drift, which
`012` exists to prevent). `overflow-x: clip` on `.app` for every page (changes every page of both
apps for one band). Rendering the page band outside `<main>` (every page would need a slot
in the app shell for one page's band). A backdrop in `--bg` (white in light mode; Mahdi asked for
dark).

## R14. Performance: load only what is on screen

**Decision**:

- **Lists carry metadata only** (R6).
- **Cards**: each card gallery watches itself with `IntersectionObserver` (`rootMargin: '200px'`),
  through one observer shared by every card on the page, which tells each card about its own
  element only.
  While it is on or near the screen it turns, and holds the shown image and the next one (so the
  next change is instant), letting go of an image once it is neither. When it leaves that zone it
  **stops turning, stops fetching, and lets go of both images at once**; when it comes back it
  loads them again from the browser's HTTP cache and turns again from the image it was on. When
  `IntersectionObserver` is not available (jsdom), the gallery counts as on screen.
- **Why let go at once, not after a delay**: the bound is simplest to state and test, and loading
  again costs only a cache read (R4). A delay would only save that cache read for a card scrolled
  away and straight back.
- **Memory ceiling** (spec FR-039): on the Events list the page holds at most 2 images per card on
  or near the screen. With every picture at the 5 MB limit and, say, 12 cards in that zone on a
  large desktop window (three columns of four), that is 12 × 2 × 5 MB = 120 MB of image data at
  most, whatever the length of the list; with typical 1 MB photos, about 24 MB. The event page and
  viewer hold at most one event's 5 images, 25 MB. Decoded pictures are the browser's own cache
  and it frees them as needed. The running-system gate measures the tab (quickstart S11).
- **Event page and full screen**: load the shown image and the next one at once (the page band
  is at the top); full screen also loads the previous one.
- **Text first**: no card or page waits for an image; images fill their placeholder when they
  arrive (FR-031, FR-032).
- **Caching** (R4): images held as above, the browser's own cache after that; preflights cached
  for 10 minutes (R4).
- **Backend cost** (R1): about 15 MB of transient memory and one pool connection per 5 MB image
  read; the running-system gate checks a list of 8 or more events with five 5 MB images each
  (quickstart S11).
- **No smaller copies**: images are served as uploaded. On a first view of a list, at most about
  two images per visible card are loaded (SC-006). The Admin hint (R9) does not set a size beyond
  5 MB; pictures of about 1 MB load well.

**Rationale**: Spec FR-032 and SC-006. Without lazy loading, a list of 20 events with 5 images
each could fetch 100 pictures up to 5 MB on open.

**Alternatives considered**: Making smaller copies on upload (needs an image library such as
`sharp`, which brings native binaries into the Backend image, and a second set of rows;
Constitution VIII until pages are shown to be slow). `loading="lazy"` on `<img>` (works only for
`src` URLs the browser fetches itself; ours are fetched by script). Loading all of an event's
images at once on a card (four of five would usually never be seen).

## R15. Demo data: pictures generated at run time

**Decision**: `backend/src/scripts/demo-images.ts` exports `demoPng(width, height, colors)`, which
writes a small PNG with `node:zlib` (`deflateSync`, and `crc32`, available since Node 22.2): broad
diagonal bands in two colors, 960 × 540 pixels, a few kilobytes each. `demo-data.ts` adds, through
`EventImagesService.add` so every rule applies:

- the concert: 3 images (three color pairs), so it rotates;
- the comedy night: 1 image (no arrows);
- the gala: none (looks as before).

`DemoSummary` gains `images: 4` (3 + 1 + 0). No picture file is committed.

**Rationale**: Spec FR-034. Generated pictures keep the repository small, carry no copyright, show
each gallery case on demo day, and go through the same type check as uploads (they are real PNGs).

**Alternatives considered**: Committed sample photos (repository size and copyright). Downloading
images at run time (needs the internet, and an outside source). Solid single colors (rotation is
harder to see).

## R16. Tests

**Decision** (tasks.md has the full list), tests first in every phase:

- **Shared** (Vitest): `sniffImageType` for each accepted signature and for GIF, SVG text,
  `RIFF…WAVE`, PDF, empty, 11 bytes, and `FF D8` only; `readImageHeader` for each format and WebP
  variant, both sides of 16,384 pixels a side and 40,000,000 pixels, and truncated headers; the
  image cache (one fetch for two users, revoke on last release, `Authorization` sent, failure
  state); the rotation hook with fake timers (5,000 ms steps, wrap, restart after an arrow, pause
  and resume, reduced motion, fewer than 2 images); the gallery (nothing for 0 images, no arrows for
  1, accessible names, position text, alternative text, the Pause/Play button (pause stops, play
  resumes after 5 s, arrows work while paused, hidden with one image and under reduced motion),
  arrow hover pauses, image hover does not, keyboard focus on an arrow pauses, pointer-caused focus
  does not, lazy loading with a stubbed `IntersectionObserver`, card link); the viewer (opens on the
  image, Esc and close, arrows and keys, focus moves in, Tab trapped, focus returned, no automatic
  change, the gallery shows the last image viewed).
- **Backend** (Jest, Supertest, Testcontainers): storage CHECKs and the unique constraint on real
  PostgreSQL; upload of each type with the contract check; detected type over the declared one; a
  renamed text file `415`; exactly 5,242,880 bytes `201` and 5,242,881 `413`; 16,384 × 2,441 pixels
  `201` and 16,385 × 1 `400 IMAGE_DIMENSIONS_TOO_LARGE`; metadata removed from a JPEG with Exif GPS,
  camera make, and XMP (orientation kept), a PNG with `eXIf` and text chunks, and a WebP with `EXIF`
  and `XMP ` chunks (VP8X flags cleared, RIFF size right); data after a JPEG's `EOI`, after a PNG's
  `IEND`, and past a WebP's `RIFF` length dropped; animated PNG and WebP `415`; missing, extra, and
  second parts `400`; unknown event `404`; cancelled `409`; sixth `409 IMAGE_LIMIT_REACHED`; bytes
  read back byte for byte with `Content-Type`, `Cache-Control`, and `nosniff`; another event's image
  `404`; delete closes the gap; reorder, stale reorder `409 IMAGES_CHANGED`, malformed `400`;
  `images` in every event response in order and never `bytes`; event delete cascades; authorization
  (missing, expired, wrongly signed, wrong audience, wrong role) on all four routes;
  **concurrency**: 10 simultaneous uploads to an event with 3 images give exactly two `201`, eight
  `409`, and positions 1 to 5; a mix of simultaneous adds, deletes, and reorders gives no `5xx` and
  contiguous positions; uploads during orders for the same event both succeed. Supertest sends files
  with `.attach('file', buffer, { filename, contentType })`; small valid images are base64 constants
  in `backend/test/setup/images.ts`.
- **Admin app**: the Images control on create and edit (requests, order of calls, multipart body,
  previews and refusals naming files, retry continues, `IMAGES_CHANGED` reload, the switch to the
  edit form after a refused image on create with no second `POST /events`, Cancel makes no call)
  and the gallery on the event page.
- **Customer app**: cards and the event page with 0, 1, and 3 images; an event card without images
  renders exactly as before.
- **Test environment**: each front-end `test/setup.ts` stubs `URL.createObjectURL` and
  `revokeObjectURL`, `matchMedia`, and `IntersectionObserver` (none exist in jsdom). The `stubApi`
  helpers of both apps record a non-JSON request body (a `FormData`) instead of parsing it as JSON,
  and can answer with a `Blob`.
- **Running system**: [quickstart.md](./quickstart.md).

**Rationale**: Constitution VI: every persistence path, rule, and authorization rule tested first,
boundaries on both sides, concurrency with genuinely simultaneous requests. Fake timers make the
5-second rule exact and fast.

## R17. Metadata is removed before storing; a JPEG keeps its orientation

**Decision** (Mahdi, 2026-10-12, after review round 1): `stripImageMetadata(bytes, contentType)`
in `backend/src/events/image-metadata.ts` runs after the type and byte-size checks (R3), before the
pixel limits (the contract's refusal order), and before the transaction. It copies the file, leaving out metadata, and never touches the picture data:

- **JPEG**: walks the markers from `SOI`. Before each marker code, any run of `0xFF` fill bytes is
  skipped. Standalone markers, which have no length (`RST0`–`RST7` `D0`–`D7`, `TEM` `01`), are
  copied as two bytes; every other marker before `SOS` has a two-byte length and is copied or
  dropped whole. It drops every `APP1` whose payload starts with `Exif\0\0` or an XMP namespace
  (`http://ns.adobe.com/xap/1.0/\0`, and extended XMP `http://ns.adobe.com/xmp/extension/\0`),
  every `APP2` starting `MPF\0` (multi-picture data, which points at secondary pictures), every
  `APP13` (`Photoshop 3.0`, which carries IPTC captions and places), and every `COM` comment.
  From `SOS` it copies the scan data, where a `0xFF` is always followed by `00` (byte stuffing),
  `D0`–`D7` (restart markers), or a marker that ends the scan; it continues through any further
  segments and scans of a progressive picture, and **stops after the first `EOI` (`FF D9`)**.
  Anything after it, such as the secondary pictures that `MPF` describes or a motion photo's
  video, each with its own Exif and GPS, is dropped.
- **PNG**: drops the `eXIf`, `tEXt`, `iTXt`, `zTXt`, and `tIME` chunks; every other chunk is
  copied with its own CRC; **stops after `IEND`**, dropping anything after it.
- **WebP**: copies only the chunks within the `RIFF` length the header declares, dropping any
  bytes past it; drops the `EXIF` and `XMP ` chunks, clears the EXIF (`0x08`) and XMP (`0x04`)
  flags in a `VP8X` header, and rewrites the `RIFF` size (chunks keep their even padding).
- **Orientation**: when a JPEG's Exif `IFD0` has an Orientation tag (`0x0112`) of 2 to 8, a new
  minimal Exif `APP1` with only that tag (a 32-byte payload: `Exif\0\0`, a big-endian TIFF
  header, one IFD entry, no next IFD) is written right after `SOI`, or after a `JFIF` `APP0`
  when there is one. Orientation 1, or none, writes nothing. An `IFD0` offset below 8 overlaps the
  TIFF header and is read as no orientation. An Exif segment that gives an orientation is then at
  least 32 bytes (one whole entry, no next-IFD offset); the new one is never longer than the one it
  replaces, so it is cut to that length, keeping the whole entry, and the file never grows (review
  rounds 1 and 2).
- A structure that cannot be walked (a segment or chunk length past the end of the file) is
  `415 IMAGE_TYPE_NOT_ALLOWED`, as an unreadable header is (R3). The Admin form's preview reads
  headers only, so such a file passes it and is refused here, at save time (R9, FR-016).
- `byteSize` is the stored size. The 5 MB limit applies to the file as sent, so what is stored is
  never larger.

**Orientation, the known cost**: Removing Exif removes the tag that tells browsers which way up a
photo is. Phones commonly store a portrait photo as landscape pixels with Orientation 6, so
removing everything would show many phone photos sideways, a visible defect admins could not fix
in the form. Keeping that one number reveals nothing about where, when, or with what camera the
photo was taken, so it is kept for JPEG. PNG and WebP orientation (rare, and not applied by every
browser) is not kept.

**Rationale**: Spec FR-035. A phone photo's Exif can hold GPS coordinates, the time, and the
camera's make, model, and serial number; customers should not be able to read where an admin's
photo was taken. Removing segments and chunks is a byte-level copy with no decoder, so it adds no
dependency and costs no quality.

**Alternatives considered**: Telling the admin and storing as uploaded (the first plan; Mahdi chose
removal). Re-encoding every upload with an image library (a native dependency and a loss of
quality, R14). Removing everything including orientation (sideways phone photos). Keeping the whole
`IFD0` (it holds the camera make and model).
