---
description: "Task list for Event Images"
---

# Tasks: Event Images

**Input**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md),
[data-model.md](./data-model.md), [contracts/README.md](./contracts/README.md) →
[`contracts/openapi.yaml`](../../contracts/openapi.yaml) (1.8.0, already applied),
[quickstart.md](./quickstart.md)

**Issue**: [#26](https://github.com/Trughouse-Holdings/QueuePass/issues/26). The implementation PR
says `fixes #26`.

**Tests**: **REQUIRED and written first** (Constitution VI). In each phase, write the test tasks
and confirm they **fail** before the implementation tasks below them.

## Ground rules

- **Fresh session** (Constitution III): implement on branch `014-event-images-impl`, cut from
  `main` after the spec and plan PR merges, in a Claude session that starts from these files only.
  A gap in the spec or plan is fixed there, not worked around in code.
- **Do not change the contract** (1.8.0, or 1.9.0 if `015`'s spec PR #38 merged first; types
  regenerated, the five codes already in `ERROR_CODES`), with one exception: **remove each
  `x-planned: '014'` marker in the commit that serves its route** (T016 for upload and read, T032
  for delete and reorder) and regenerate `api-schema.ts`. The route-coverage test fails while a
  served operation is still marked (`plannedButImplemented`) or an unmarked one is unserved
  (research R8). Raise any other gap.
- **`012` and `013` are on `main`**: the shared `theme.css` and its no-drift check exist, and
  `ERROR_CODES` lists the address codes before the image codes (the contract's order).
- **Always send `images`** on every `Event` response, `[]` when there are none, ordered by
  `position`, metadata only. It is optional in the contract only so the plan PR could merge with
  `main` green (research R8).
- **Positions are 1 to n**, 1 is the cover. Every image write runs in one transaction that starts
  with `lockEvent(tx, eventId)`; read and sniff the upload **before** the transaction (research R2).
- **Type by signature only** (`sniffImageType` / `readImageHeader` from `packages/shared`); ignore
  the file name and the part's `Content-Type`; store and serve the detected type; refuse more than
  16,384 pixels a side or 40,000,000 pixels (research R3).
- **Metadata out before storing** (`stripImageMetadata`, research R17): JPEG Exif/XMP `APP1` and
  `APP13`, PNG `eXIf`/`tEXt`/`iTXt`/`zTXt`, WebP `EXIF`/`XMP `; a JPEG keeps only its
  orientation, in a minimal Exif segment.
- **Never select `bytes`** except in `getEventImage` (research R6).
- **No `<img src>` to the API**: images are fetched with the token through `useEventImage` and
  shown from object URLs (research R4).
- **Rotation**: 5,000 ms, restarted by every change; a Pause/Play button per gallery that turns on
  its own (stopped until Play; per gallery, not saved; none under reduced motion or with one
  image; none in the viewer); also paused while an arrow is under the pointer, while an arrow or
  the event page's full-screen image button has keyboard (not pointer-caused) focus, while the
  viewer is open, or while a card is off screen; no timer under reduced motion; no animation
  (research R11; settled decisions).
- **No new dependencies.** No color, font, or off-step spacing written in an app stylesheet, and no
  inline style setting a color, font, or shadow (`012` drift check).
- **Nothing else changes**: every existing test keeps its meaning; events without images render
  exactly as before.

## Phase 1: Setup

- [x] T001 Cut `014-event-images-impl` from an up-to-date `main`, run `npm install` and `npm test`
  from the repository root, and confirm the suite is green before any change (baseline).

---

## Phase 2: Foundational (blocks every story)

**Purpose**: shared types and the type check, storage, event responses carrying `images`, and the
test helpers every story uses.

- [x] T002 [P] **Test first.** Create `packages/shared/test/event-image.test.ts`: `sniffImageType`
  returns `image/jpeg` for `FF D8 FF E0 …`, `image/png` for the 8-byte PNG signature plus 4 bytes,
  `image/webp` for `RIFF` + 4 bytes + `WEBP`; `null` for `GIF89a…`, `<svg …`, `RIFF…WAVE`,
  `%PDF-1.7`, an empty array, the PNG signature cut to 11 bytes (and accepted at 12, both sides),
  and `FF D8` alone. `readImageHeader` returns type, width, and height for a PNG, a JPEG (with an
  Exif `APP1` before its `SOF0`, and a progressive `SOF2`), and WebP `VP8 `, `VP8L`, and `VP8X`
  files, with `animated: false`; `animated: true` for a PNG with `acTL` before `IDAT` and for a WebP
  with the `VP8X` animation flag or an `ANIM` chunk; `null` for a PNG whose first chunk is not
  `IHDR`, a JPEG with no `SOFn`, a truncated segment, and a zero width. `IMAGE_PIXEL_LIMITS` is `{
  maxSide: 16384, maxPixels: 40000000 }`. `EVENT_IMAGE_LIMITS` is `{ maxCount: 5, maxBytes: 5242880
  }`; `IMAGE_CONTENT_TYPES` is `['image/jpeg', 'image/png', 'image/webp']`, the contract's
  `EventImage.contentType` enum (the Backend's contract checks in T011 catch a mismatch);
  `GALLERY_INTERVAL_MS` is 5000.
- [x] T003 Create `packages/shared/src/event-image.ts` (data-model.md: `ImageContentType`,
  `IMAGE_CONTENT_TYPES`, `EventImage`, `EVENT_IMAGE_LIMITS`, `IMAGE_PIXEL_LIMITS`,
  `GALLERY_INTERVAL_MS`, `sniffImageType`, `readImageHeader`), add `images?: EventImage[]` to
  `Event` in `packages/shared/src/event.ts`, and export from `packages/shared/src/index.ts`. Run
  T002 until it passes.
- [x] T004 [P] In `backend/test/contract/expect-to-match-contract.ts`, handle a declared response
  whose `content` has no `application/json`: assert the response's `Content-Type` (without
  parameters) is one of the declared media types, and skip schema validation (research R8). Add a
  unit test, `backend/test/unit/expect-to-match-contract.spec.ts`, with fake responses for
  `getEventImage`: `image/png` passes, `application/json` fails with a message naming the declared
  types. Confirm it fails before the change.
- [x] T005 [P] Test environment for the front ends: in `packages/shared/test/setup.ts`,
  `admin-app/test/setup.ts`, and `customer-app/test/setup.ts`, stub `URL.createObjectURL` (returns
  `blob:test/<n>`) and `URL.revokeObjectURL` (records calls), `window.matchMedia` (no match by
  default, settable per test), and `IntersectionObserver` (absent by default, so galleries count
  as on screen; a helper installs a controllable one). In `admin-app/test/helpers/api-stub.ts` and
  `customer-app/test/helpers.tsx`, record a non-JSON request body as `{ formData: FormData }`
  (from `req.clone().formData()`) instead of `JSON.parse`, record the request's `content-type`,
  and add `blob(bytes, type)` to answer with an image. Run both apps' suites: unchanged results.
- [x] T006 **Test first.** Create `backend/test/integration/event-images.storage.e2e-spec.ts`
  (direct writes with `ctx.prisma` and `$executeRaw`), and confirm it fails before T007:
  - a row with position 1, `image/png`, `byteSize` equal to the bytes' length is accepted;
  - position 0 and position 6 are refused (`event_image_position_range`);
  - `image/gif` is refused (`event_image_content_type`);
  - `byteSize` 5242881, 0, or different from `octet_length(bytes)` is refused
    (`event_image_byte_size`);
  - two rows of one event at position 2 are refused at once (`event_image_position_unique`,
    immediate); the same event can hold positions 1 to 5 and not a sixth row at any position;
  - swapping two positions in one `UPDATE`, with no `SET CONSTRAINTS`, succeeds (the deferrable
    constraint is checked at the end of the statement), and shifting 2..5 down by one after
    deleting 1 in one `UPDATE` succeeds; the same swap as two separate `UPDATE`s fails at the
    first;
  - deleting the event deletes its rows (cascade).
- [x] T007 Add `model EventImage` (data-model.md, including `@@unique([eventId, position], map:
  "event_image_position_unique")`) and `images EventImage[]` on `Event` to
  `backend/prisma/schema.prisma` (comment: spec 014; `DEFERRABLE` and the CHECKs live in the
  migration SQL, never `db push`). Create
  `backend/prisma/migrations/20261012000000_event_images/migration.sql` exactly as in
  data-model.md. Apply with `prisma migrate deploy`, and confirm `prisma migrate diff
  --from-migrations backend/prisma/migrations --to-schema-datamodel backend/prisma/schema.prisma
  --shadow-database-url …` reports no difference (research R2). Run T006 until it passes.
- [x] T008 [P] Create `backend/test/setup/images.ts`: base64 constants for a small valid JPEG, PNG,
  and WebP (the WebP may be the 1-pixel one in quickstart.md), `padded(signature, totalBytes)` for
  size boundaries, and `upload(ctx, eventId, bytes, { filename, contentType, token })` using
  Supertest's `.attach('file', …)` through the contract-checking client.
- [x] T009 **Test first.** Extend `backend/test/integration/events.crud.e2e-spec.ts`: a new event
  has `images: []` in the `createEvent`, `getEvent`, `listEvents`, `updateEvent`, and
  `cancelEvent` responses; with two rows inserted by `ctx.prisma` at positions 2 and 1, every one
  of those responses lists them by position with exactly `id`, `position`, `contentType`,
  `byteSize`, and no response anywhere contains a `bytes` key.
- [x] T010 In `backend/src/events/events.service.ts`, define `EVENT_INCLUDE` (data-model.md) and use
  it in every read and write that returns an event (create, findAll, findOne, update, cancel), so
  `toResponse` passes `images` through. Run T009 and the whole Backend suite until green.

**Checkpoint**: images can be stored with every database rule in force, and every event response
carries `images`.

---

## Phase 3: User Story 1 - An Admin Adds Images to an Event (Priority: P1) 🎯 MVP

**Goal**: FR-001 to FR-006, FR-013 to FR-018, FR-035 to FR-037, SC-001 to SC-003.

**Independent Test**: images of each accepted type are added in order through the API and the
Admin form; wrong types, oversized files, and a sixth image are refused with nothing stored, also
under simultaneous uploads.

### Tests for User Story 1 (write first, confirm they fail)

- [x] T011 [P] [US1] Create `backend/test/integration/event-images.e2e-spec.ts` (upload and read):
  - a JPEG, a PNG, and a WebP → each `201` matching the contract, positions 1, 2, 3, the detected
    `contentType`, `byteSize` equal to the file's length; `getEvent` lists them in that order;
  - PNG bytes sent as `photo.jpg` with `contentType: 'image/jpeg'` → stored and returned as
    `image/png`; `getEventImage` answers `Content-Type: image/png`;
  - text bytes named `poster.jpg` sent as `image/jpeg` → `415 IMAGE_TYPE_NOT_ALLOWED` with
    `details.allowed`, and no row; a GIF → `415`;
  - `padded(PNG, 5242880)` → `201`; `padded(PNG, 5242881)` → `413 IMAGE_TOO_LARGE` with
    `details.maxBytes`, matching the contract, and no row (both sides);
  - no `file` part, a JSON body, two `file` parts, and a `file` plus another field → each
    `400 VALIDATION_FAILED`, no row;
  - an unknown event → `404`; a malformed event id → `400`;
  - an animated PNG (`acTL`) and an animated WebP (`VP8X` flag `0x02` with `ANIM`/`ANMF`) → `415
    IMAGE_TYPE_NOT_ALLOWED`, no row (FR-037);
  - a PNG of 16,384 × 2,441 pixels → `201`; 16,385 × 1 and 7,000 × 7,000 (49 megapixels) →
    `400 IMAGE_DIMENSIONS_TOO_LARGE` with `details` and no row (both sides of each limit); a PNG
    whose `IHDR` is cut short → `415`;
  - metadata removal (FR-035): a JPEG with an Exif `APP1` holding GPS, camera make, and
    Orientation 6, plus an XMP `APP1` and an `APP13` → stored without the GPS bytes, the make
    string, the XMP packet, or `APP13`, with a minimal Exif segment whose only tag is Orientation
    6, and the scan data after `SOS` byte for byte the same; `byteSize` is the stored length; a
    JPEG with Orientation 1 gets no Exif segment; a PNG with `eXIf`, `tEXt`, `iTXt`, and `zTXt`
    → none of them stored, other chunks unchanged; a WebP (VP8X) with `EXIF` and `XMP ` chunks →
    neither stored, both VP8X flags cleared, and the `RIFF` size equal to the file length − 8;
  - a cancelled event → `409 EVENT_CANCELLED`, no row;
  - with 5 images, a sixth → `409 IMAGE_LIMIT_REACHED` with `details.limit: 5`, `details.count:
    5`, and the message naming the event; still 5 rows;
  - `getEventImage` returns the uploaded bytes exactly, with the stored `Content-Type`,
    `Cache-Control: private, max-age=31536000, immutable`, and `X-Content-Type-Options: nosniff`,
    matching the contract (T004); the image of another event under this event's path → `404`; an
    unknown image id → `404`.
  Also create `backend/test/unit/image-metadata.spec.ts` for `stripImageMetadata` on hand-built
  files: each case above, a JPEG with a `JFIF` `APP0` (the orientation segment goes after it),
  little-endian and big-endian Exif, extended XMP, an `APP2` `MPF` segment and a `COM` segment
  (both dropped), runs of `0xFF` fill bytes before a marker and a standalone `TEM` marker before
  `SOS` (walked correctly, picture unchanged), restart markers and stuffed `FF 00` bytes inside the
  scan (copied unchanged), a second JPEG with its own Exif GPS appended after the first `EOI`
  (dropped: the output ends at the first `EOI`), a PNG `tIME` chunk and bytes after `IEND`
  (dropped), a WebP with bytes past its declared `RIFF` length (dropped, size rewritten), and a
  segment or chunk length past the end of the file → the `415` envelope.
- [x] T012 [P] [US1] Create `backend/test/integration/event-images.concurrency.e2e-spec.ts`: an
  event with 3 images and 10 simultaneous uploads → exactly two `201` and eight `409
  IMAGE_LIMIT_REACHED`, no `5xx`, and positions exactly `{1, 2, 3, 4, 5}`; an event with 0 images
  and 10 simultaneous uploads → five `201`, five `409`, positions 1 to 5; 5 simultaneous uploads
  while 5 orders are placed for the same event → every request succeeds (no deadlock, no transaction
  timeout).
- [x] T013 [P] [US1] Create `backend/test/integration/event-images.authz.e2e-spec.ts`, following
  `venues-events.authz.e2e-spec.ts`: on `uploadEventImage`, `deleteEventImage`,
  `reorderEventImages`, and `getEventImage`, a missing, expired, wrongly signed, and
  wrong-audience token → `401`; for the three writes, `customer1` and `agent1` → `403` and nothing
  changed; for `getEventImage`, `customer1` and `agent1` → `200`. Extend
  `backend/test/integration/cors-docs.e2e-spec.ts`: a preflight from an allowed origin answers
  `Access-Control-Max-Age: 600` (research R4); a disallowed origin still gets no CORS headers.
- [ ] T014 [P] [US1] Create `admin-app/test/images-field.test.tsx` with `stubApi` (create and edit):
  - the Schedule event and Edit event forms have an "Images" group with an "Add images" file input
    (`accept="image/jpeg,image/png,image/webp"`, `multiple`) and the hint from research R9
    (limits and cover, and no text about metadata);
  - choosing a PNG, a JPEG, and a WebP (`File`s with real signatures) shows three previews in order
    (`img` with `alt` "Image 1" … and a `blob:` source), "Cover" on the first;
  - a GIF, a text file named `.jpg`, a 5,242,881-byte PNG, a PNG whose header says 20,000 × 20,000
    pixels, an animated PNG (`acTL`), and a sixth file are refused before sending, each named with
    its reason in the note (the animated one as "{file name}: animated pictures are not accepted");
    a PNG with a valid header whose later chunk runs past the end passes the preview, and the
    Backend's `415` on save is shown as "{file name}: {message}"; nothing is sent; a 5,242,880-byte
    PNG is accepted (both sides); with 5 items the input is replaced by "5 of 5 images. Remove one
    to add another.";
  - saving a new event sends `POST /events`, then (after any seating and ticket types, as today)
    one `POST /events/{id}/images` per picture in list order, each `multipart/form-data;
    boundary=…` with one `file` part, and no `PUT …/images/order`;
  - editing an event with two images and adding one sends one upload and no reorder;
  - a `415` on the second of three uploads shows "{file name}: {message}", keeps every field and
    the third picture, and the first stays saved: saving again uploads only the second and third;
  - a `413` and a `409 IMAGE_LIMIT_REACHED` show their messages the same way;
  - **create path** (FR-017, FR-018): on scheduling with three pictures, a `415` on the second
    upload after `POST /events`, the seating, and the ticket types all succeeded → the location
    becomes `/events/{id}/edit` (router state carries the pending pictures), the heading reads "Edit
    event", the banner says "Event created. These pictures were not added: …", and the second and
    third pictures are pending in the Images control after the first, which is saved. Saving again
    sends `PATCH /events/{id}` and the two uploads, and **no second `POST /events`** (assert the
    count of `POST /events` stays 1), then navigates to the event page. The same holds if the form
    is unmounted and mounted again at `/events/{id}/edit` with that router state. After the edit
    form reads the pending pictures, the history entry's state is `null`; saving, going Back to the
    edit form, and saving again sends **no second upload** of those pictures. A network failure on
    an upload (the stub answers `'network-error'`) switches to the edit form the same way;
  - **`008` unchanged**: on scheduling with pictures chosen, a refused ticket-type step (`POST
    …/tiers` → `409`) behaves exactly as today: the location stays `/events/new`, the "Seating
    setup not finished" banner with "Finish on the event page" shows, no image request is sent,
    and every field and the chosen pictures are still in the form. The same for a refused
    `PUT …/seating`. `admin-app/test/event-seating-create.test.tsx` is not changed and still
    passes;
  - Cancel after choosing pictures sends no image request.

### Implementation for User Story 1

- [x] T015 [US1] **Test first.** Create `backend/test/unit/prisma-exception.filter.spec.ts`: a
  `P2002` whose `meta.target` names `event_image_position_unique`, and a raw-query error whose
  message carries `23505` and that constraint's name, are each answered `409 IMAGES_CHANGED`; a
  tier-name `P2002` is still `TIER_NAME_TAKEN`; a `413` `HttpException` is `IMAGE_TOO_LARGE`. Then,
  in `backend/src/common/filters/prisma-exception.filter.ts`, map a `413` to `IMAGE_TOO_LARGE` with
  "An image can be at most 5 MB." and `details.maxBytes: 5242880`, and the position violation to
  `409 IMAGES_CHANGED` (research R2, R3). Envelopes thrown by services already pass through (the
  codes are in `ERROR_CODES`).
- [x] T016 [US1] Create `backend/src/events/event-images.service.ts` (`add`, `read`) and
  `backend/src/events/event-images.controller.ts` (`POST /events/:id/images` with
  `@Roles('queuepass-admin')`, `FileInterceptor('file', { storage: memoryStorage(), limits: {
  fileSize: 5_242_880, files: 1, fields: 0, parts: 1 } })`, `@HttpCode(201)`; `GET
  /events/:id/images/:imageId` with no role, returning a `StreamableFile` with the research R4
  headers), and register them in `backend/src/events/events.module.ts`. Create
  `backend/src/events/image-metadata.ts` (`stripImageMetadata`, research R17). `add`: refuse a
  missing file (`400`), `readImageHeader` (`415`), the pixel limits (`400
  IMAGE_DIMENSIONS_TOO_LARGE`), strip metadata (`415` if it cannot be walked), then one transaction:
  `lockEvent` → cancelled (`409 EVENT_CANCELLED`) → count → `409 IMAGE_LIMIT_REACHED` → insert at
  `count + 1` (data-model.md). Use a local `UploadedImage { buffer: Buffer; size: number }` type,
  not `@types/multer`. In `backend/src/configure-app.ts`, add `maxAge: 600` to `enableCors`
  (research R4). In the same commit, remove `x-planned: '014'` from `uploadEventImage` and
  `getEventImage` in `contracts/openapi.yaml` and run `npm run generate:api`. Run T011–T013
  (upload and read parts) and the route-coverage test until they pass.
- [ ] T017 [US1] Create `admin-app/src/api/images.ts` (`uploadEventImage`, `deleteEventImage`,
  `reorderEventImages`, research R9) and `admin-app/src/components/ImagesField.tsx` with adding,
  previews, the preview checks (using `readImageHeader` on `await file.arrayBuffer()`,
  `EVENT_IMAGE_LIMITS`, and `IMAGE_PIXEL_LIMITS`), the hint, and object URL clean-up; layout classes
  in `admin-app/src/styles.css` on theme values (research R13).
- [ ] T018 [US1] In `admin-app/src/pages/EventForm.tsx`, hold the Images state, load it from
  `event.images ?? []` on edit, and after the existing create or edit steps run `applyImages`
  (uploads in this story; deletes and reorder come in US3), updating state as each step succeeds and
  stopping at the first refusal, with the file name before the Backend's message. On create, leave
  `scheduleEvent`'s seating and ticket-type handling as it is (`008`); only after the event, its
  seating, and its ticket types all succeeded and a picture step is refused or fails,
  `navigate(`/events/${id}/edit`, { replace: true, state: { pendingImages, notice } })`; on edit,
  initialize the Images control from the event's images followed by `location.state?.pendingImages`,
  show `notice`, and then clear the entry with `navigate(location.pathname, { replace: true, state:
  null })` (research R9). Run T014 until it passes, then the Admin app suite.

**Checkpoint**: admins add images through the form and the API, and the Backend's rules hold under
concurrency.

---

## Phase 4: User Story 2 - Customers See the Images on the Event Page (Priority: P1)

**Goal**: FR-019, FR-021 to FR-028, FR-031, FR-033, FR-038, SC-004, SC-007.

**Independent Test**: on an event page with three images, the cover is shown across the full app
width and changes every 5 seconds with the documented pauses; one image has no controls; no images
looks as before.

### Tests for User Story 2 (write first, confirm they fail)

- [ ] T019 [P] [US2] Create `packages/shared/test/web/event-images.test.tsx`: two components using
  the same image id cause one `GET /events/{id}/images/{imageId}` with the user's `Authorization`
  header; both receive the same `blob:` URL; it is revoked only after both unmount; a later use
  fetches again; a `404` or network failure gives the failed state and does not throw; `enabled:
  false` fetches nothing. A gallery of 3 images that loops twice (fake timers) makes exactly 3
  image requests and revokes nothing until it unmounts (research R4: kept while mounted).
- [ ] T020 [P] [US2] Create `packages/shared/test/web/use-gallery-rotation.test.ts` with fake
  timers: with 3 images the index goes 0 → 1 at 5,000 ms (not at 4,999), → 2, → 0; `next()` at
  3,000 ms shows the next at once and the following change comes 5,000 ms after the press; `prev()`
  from 0 gives 2; `paused: true` stops changes for 20 s, and after it turns false the next change is
  5,000 ms later; with `matchMedia('(prefers-reduced-motion: reduce)')` matching, nothing changes
  over 20 s but `next()` works, and turning the preference off starts the timer; with 0 or 1 image
  no timer is set; with `stopped: true` nothing changes over 20 s whatever `paused` does, `next()`
  and `prev()` still change the index at once without starting a timer, and when `stopped` turns
  false the next change is 5,000 ms later.
- [ ] T021 [P] [US2] Create `packages/shared/test/web/image-gallery.test.tsx` (variant `page`):
  - 0 images → renders nothing; 1 image → the image, no arrows, no position, no Pause/Play button,
    no timer;
  - 3 images → a `role="group"` with `aria-roledescription="carousel"` named "Images of Season
    Opener" inside a `.page-band` wrapper (placed by the page), the image with `alt` "Season Opener,
    image 1 of 3", "1 of 3", and buttons "Previous image of Season Opener" and "Next image of Season
    Opener" with class `gallery__arrow`; the image is inside a button named "View Season Opener,
    image 1 of 3, full screen";
  - after 5 s, image 2 and "2 of 3";
  - **Pause/Play** (FR-038): a button with class `gallery__toggle` named "Pause images of Season
    Opener"; selecting it → no change for 30 s (fake timers), its name becomes "Play images of
    Season Opener", and it keeps focus; "Next image of Season Opener" while paused shows image 2 at
    once and still nothing changes on its own; pointer leaving an arrow or focus leaving the
    gallery does not resume it; selecting Play → the next image 5 s later, name back to "Pause …";
    keyboard focus on the Pause/Play button alone does not pause; with reduced motion matching, no
    Pause/Play button; unmounting and mounting again starts turning (not saved);
  - `pointerEnter` on the image, then 15 s → it changed three times; `pointerEnter` on the next
    arrow, 15 s → no change; `pointerLeave`, 5 s → changed;
  - keyboard focus (`userEvent.tab()`) on an arrow → no change for 15 s; focus leaves the gallery →
    a change 5 s later; a click on an arrow (pointer down, then focus) followed by `pointerLeave`
    → it changes 5 s later (pointer-caused focus does not pause);
  - keyboard focus on the full-screen image button also pauses (research R11, recommended for
    keyboard users); pointer hover over that button does not;
  - the slide area has `aria-live="off"` while rotating and `"polite"` while paused;
  - a failed image shows "Image unavailable" and the gallery keeps rotating;
  - no element has an inline `style` setting a color.
- [ ] T022 [P] [US2] Create `customer-app/test/event-images.test.tsx` (event page): an event with 3
  images shows the gallery above the `h1`; with no `images` key and with `images: []`, the page's
  markup is the same as before this feature (no `.gallery`); a cancelled event with images shows
  them. Add `images` to the event factory in `customer-app/test/helpers.tsx` (default `[]`).
- [ ] T023 [P] [US2] Create `admin-app/test/event-images.detail.test.tsx`: the Admin event page
  shows the gallery for an event with images (FR-019), and nothing for one without.
- [ ] T024 [P] [US2] Extend `packages/shared/test/theme/tokens.test.ts` and `contrast.test.ts`
  (from `012`): `--scrim` and `--scrim-text` exist in the light and dark sets with the same values;
  `--scrim-text` on `--scrim` composited over white and over black is at least 4.5:1. Also assert
  the theme sets no `overflow` on `.app` except under `.app:has(.page-band)`; `--scrim` is
  written in the theme's `rgb(… / %)` style; and `.page-band`'s negative `margin-top` equals
  `.main`'s top padding, both outside and inside the 640-pixel breakpoint (`-32px` / `32px`,
  `-22px` / `22px` today), so the band stays flush under the top bar if either changes.

### Implementation for User Story 2

- [ ] T025 [US2] Create `packages/shared/src/web/event-images.ts` (the cache and `useEventImage`,
  research R4) using `useAuth().api.GET('/events/{id}/images/{imageId}', { …, parseAs: 'blob' })`.
  Run T019 until it passes.
- [ ] T026 [US2] Create `packages/shared/src/web/use-gallery-rotation.ts` (research R11). Run T020
  until it passes.
- [ ] T027 [US2] Create `packages/shared/src/web/image-gallery.tsx` (`ImageGallery`, research
  R10–R13: the page variant, arrows, Pause/Play button, position, placeholder, pause rules, live
  region; the
  full-screen button calls an `onOpen` that US5 connects) and export it and the hook from
  `packages/shared/src/web/index.ts`. Add the gallery classes and the two tokens to
  `packages/shared/src/web/theme.css` (research R13): `.page-band` (full width, flush under the top
  bar with `margin-top: -32px`, and `-22px` in the 640-pixel breakpoint, matching `.main`'s
  literal top padding, with a comment on both rules), `.gallery__toggle`, and
  `.app:has(.page-band) { overflow-x: clip }`, with no other `overflow` on `.app`. Run T021 and T024
  until they pass, and the shared suite, including the drift check.
- [ ] T028 [US2] Place `ImageGallery variant="page"`, inside `<div className="page-band">` and only
  when the event has images, at the top of `customer-app/src/pages/EventDetail.tsx` (above the `h1`)
  and `admin-app/src/pages/EventDetail.tsx` (above the page head). Run T022 and T023 until they
  pass, then both apps' suites.

**Checkpoint**: customers and admins see an event's images on its page, rotating as Mahdi decided.

---

## Phase 5: User Story 3 - An Admin Removes and Reorders Images (Priority: P2)

**Goal**: FR-007 to FR-011, FR-014, FR-015, FR-017.

**Independent Test**: removing and reordering through the form and the API keeps positions 1 to n;
a stale order is refused; a cancelled event refuses changes; deleting an event removes its images.

### Tests for User Story 3 (write first, confirm they fail)

- [ ] T029 [P] [US3] Create `backend/test/integration/event-images.order.e2e-spec.ts`:
  - delete image 2 of 4 → `204`; the event lists 3 images, positions 1 to 3, in the old order;
    `getEventImage` of the deleted id → `404`; deleting it again → `404`;
  - reorder 4 images to `[d, a, b, c]` → `200`, matching the contract, positions follow the list;
  - a reorder missing one id, with an extra id, or with another event's image → `409
    IMAGES_CHANGED` with `details.imageIds` the current order, nothing changed;
  - a repeated id, a non-UUID, more than 5 ids, or a missing `imageIds` → `400`;
  - `imageIds: []` on an event with no images → `200 []`;
  - a cancelled event → delete and reorder `409 EVENT_CANCELLED`, nothing changed; its images are
    still listed and served;
  - deleting an event with 3 images and no orders → `204`, and `EventImage` has no row for it.
- [ ] T030 [P] [US3] Extend `backend/test/integration/event-images.concurrency.e2e-spec.ts`: 20
  simultaneous requests on one event mixing uploads, deletes of existing images, and reorders (each
  reorder built from the order read before sending) → no `5xx` (assert first), each refusal is
  `404`, `409 IMAGE_LIMIT_REACHED`, or `409 IMAGES_CHANGED`, and afterwards positions are exactly 1
  to n with n ≤ 5.
- [ ] T031 [P] [US3] Extend `admin-app/test/images-field.test.tsx`:
  - on edit, each preview has "Move image N earlier" (not on the first), "Move image N later" (not
    on the last), and "Remove image N"; moving and removing update the order and the "Cover" mark;
  - saving with image 2 removed and image 4 moved first sends `DELETE` for image 2, then `PUT
    …/images/order` with the remaining ids in the new order; with no image change, no image
    request;
  - removing one of five and adding one in the same edit sends the delete, the upload, then a
    reorder only if the new picture is not last;
  - a `409 IMAGES_CHANGED` reloads the event's images (`GET /events/{id}`), keeps the pending new
    pictures after them, and shows the message; saving again sends the reorder for the reloaded
    list;
  - a `404` on a delete counts as done;
  - Cancel after moves and removals sends no request.

### Implementation for User Story 3

- [ ] T032 [US3] In `backend/src/events/event-images.service.ts` and the controller, add `remove`
  (`DELETE /events/:id/images/:imageId`, `204`) and `reorder` (`PUT /events/:id/images/order`,
  `backend/src/events/dto/reorder-event-images.dto.ts`: `imageIds` UUIDs, unique, at most 5), each
  in one transaction with `lockEvent` and the single-statement shifts in data-model.md (no `SET
  CONSTRAINTS`). In the same commit, remove `x-planned: '014'` from `deleteEventImage` and
  `reorderEventImages` and run `npm run generate:api`. Run T029, T030, and the route-coverage test
  until they pass.
- [ ] T033 [US3] In `ImagesField.tsx` and `EventForm.tsx`, add Move earlier, Move later, Remove,
  the removed list, and the full `applyImages` order (deletes, uploads, reorder when needed), and
  the `IMAGES_CHANGED` reload (research R9). Run T031 until it passes, then the Admin app suite.

**Checkpoint**: admins manage images fully; positions hold under any mix of concurrent changes.

---

## Phase 6: User Story 4 - Customers See the Images on Event Cards (Priority: P2)

**Goal**: FR-020, FR-022 to FR-028, FR-031, FR-032, FR-038, FR-039, SC-006, SC-007.

**Independent Test**: each card rotates its own images, its image opens the event, its arrows do
not, and only cards on or near the screen load images.

### Tests for User Story 4 (write first, confirm they fail)

- [ ] T034 [P] [US4] Extend `packages/shared/test/web/image-gallery.test.tsx` (variant `card`): the
  gallery is a `role="group"` named "Images of Season Opener" and its arrows are "Previous image of
  Season Opener" and "Next image of Season Opener", so two cards' arrows have different names; the
  image is a link to the event's path with `tabindex="-1"` and `aria-hidden="true"`, and has no
  full-screen button; the arrows and the Pause/Play button are not inside the link; selecting an
  arrow does not navigate; each card gallery has its own Pause/Play button named for its event, and
  pausing one card leaves the other turning; with a controllable `IntersectionObserver`, nothing is
  fetched while off screen, and on entering only the shown and next images are fetched; after a
  change, the image after next is fetched and the one before is let go (its object URL revoked when
  no one else holds it); when the card leaves the screen it stops changing (fake timers, 20 s) and
  both held images are let go at once; when it comes back it fetches them again (answered by the
  stub, as the HTTP cache would) and turns again from the same image; at no time does a card hold
  more than 2 images (count `createObjectURL` minus `revokeObjectURL` per card).
- [ ] T035 [P] [US4] Extend `customer-app/test/event-images.test.tsx` (Events list): a card with 3
  images shows its gallery above the title; two cards rotate independently (an arrow on one does
  not change the other); a card without images renders the same markup as before; the card's name,
  times, and price render while every image request is still pending.

### Implementation for User Story 4

- [ ] T036 [US4] In `image-gallery.tsx`, add the `card` variant (research R12) and on-screen
  loading with `IntersectionObserver` (`rootMargin: '200px'`): hold only the shown and next image,
  and off screen stop turning and let go of both (research R14, FR-039). Place it at the top of
  `customer-app/src/components/EventCard.tsx` with `eventHref={`/events/${e.id}`}`, and add the
  card margins in `customer-app/src/styles.css` on theme steps (research R13). Run T034 and T035
  until they pass, then the Customer app suite.

**Checkpoint**: the Events list shows each event's images on its card.

---

## Phase 7: User Story 5 - A Customer Views an Image Full Screen (Priority: P2)

**Goal**: FR-029, FR-030, SC-005.

**Independent Test**: full screen opens on the selected image, flips by buttons and keys, never
changes on its own, traps focus, and closes with Esc or the button, returning focus.

### Tests for User Story 5 (write first, confirm they fail)

- [ ] T037 [P] [US5] Create `packages/shared/test/web/image-viewer.test.tsx`:
  - opening from the gallery showing image 2 of 3 renders, in `document.body`, a `role="dialog"`
    with `aria-modal="true"` named "Season Opener, image 2 of 3", the image, "2 of 3", "Previous
    image", "Next image", and "Close full screen"; `body` has `viewer-open`; the app root
    (`#root`) has the `inert` attribute, removed again on close;
  - focus is on "Close full screen"; Tab and Shift+Tab cycle among the three buttons only;
  - Right arrow key and "Next image" go to 3, then 1; Left arrow key and "Previous image" go back;
  - with fake timers, nothing changes over 20 s, and the gallery behind does not change either;
  - Esc closes; the gallery shows the image last viewed; focus is back on the gallery's
    full-screen button; `viewer-open` is removed. The close button does the same;
  - with one image: no arrows and no position;
  - it requests the shown image and its neighbors.

### Implementation for User Story 5

- [ ] T038 [US5] Create `packages/shared/src/web/image-viewer.tsx` (research R12, with `inert` on
  `#root` while open), add the viewer classes to `theme.css`, connect it to `ImageGallery`'s
  `onOpen` and pause rule, and export it. Run T037 and T021 until they pass, then the shared suite
  and both apps' suites.

**Checkpoint**: every story works on its own and together.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T039 **Test first.** Extend `backend/test/integration/demo-data.e2e-spec.ts`: after the run,
  the summary has `images: 6`; the concert has 3 images, the comedy night 1, and the gala none;
  each is a valid PNG by `sniffImageType` and under 100 KB; a second run creates nothing. Add a unit
  test, `backend/test/unit/demo-images.spec.ts`: `demoPng` output starts with the PNG signature,
  has `IHDR` with the requested width and height, and its chunks' CRCs check. Confirm both fail
  before T040.
- [ ] T040 Create `backend/src/scripts/demo-images.ts` (`demoPng`, research R15) and, in
  `backend/src/scripts/demo-data.ts`, add the images through `EventImagesService.add` and count them
  in `DemoSummary`. Run T039 until it passes.
- [ ] T041 [P] Update `README.md`: add the `014` row to the Status table, mention event images in
  "Today" (admins add up to 5; customers see a rotating gallery on cards and the event page, and
  full screen), note that images are stored in PostgreSQL, and keep the reserved-features line
  accurate.
- [ ] T042 Run `npm run lint` and `npm test` from the repository root; everything passes,
  including `check-contract-drift` and the theme's drift check. Also run `npm run build` in
  `admin-app` and `customer-app` (their `tsc --noEmit`). Check explicitly that no
  `x-planned: '014'` marker is left in `contracts/openapi.yaml` and that the route-coverage test
  passes (every 014 operation served, none still marked).
- [ ] T043 Report coverage for the files this feature changed (`npx jest --coverage` in `backend`;
  the front ends' and `packages/shared` coverage if a provider is installed) in the PR description.
  The 80% floor is not yet blocking (Constitution VI deferral until `010` and `011`).
- [ ] T044 Running-system gate: `docker compose up --build`, walk quickstart.md S1–S12 in the
  browser, and sign in, use, and sign out of each front end. Record the results in this file,
  including S11's peak memory of the `backend` and `postgres` containers and of the browser
  tab.
- [ ] T045 Independent review (Constitution III): a separate Claude session reviews the branch
  against spec.md and plan.md; fix the findings; repeat until only minor findings remain (2–3
  rounds). Record the number of rounds and any open finding in the PR description.
- [ ] T046 Open the implementation PR against `main` with `fixes #26` in its description. It
  touches the shared surface (`packages/shared/`, `backend/prisma/`), so every team member approves
  it. The product decisions, including the Pause/Play button that makes the galleries meet WCAG
  2.2.2, were settled in the spec and plan PR.
- [ ] T047 After the implementation PR merges, open a follow-up GitHub issue to tighten the
  contract (research R8 Follow-up): add `images` to `Event.required` and regenerate
  `api-schema.ts`. Link it from the PR.

---

## Dependencies & Execution Order

- **Phase 1 → Phase 2** before any story.
- **US1 (Phase 3)** is the MVP and comes first: without stored images no gallery has anything to
  show. **US2 (Phase 4)** needs `getEventImage` from T016.
- **US3 (Phase 5)** builds on US1's service and form.
- **US4 (Phase 6)** and **US5 (Phase 7)** build on US2's gallery and can run in parallel with each
  other and with US3.
- **Phase 8** after every story; T039–T040 need T016's `add`.

## Parallel Opportunities

- Phase 2: T002, T004, T005, T008 in parallel; T003 after T002; T006 → T007; T009 → T010.
- US1: T011, T012, T013, T014 in parallel; T015 and T016 before the Admin tasks' API calls work
  end to end, but T017–T018 run against stubs alongside them.
- US2: T019–T024 in parallel; T025 → T026 → T027 → T028.
- US3, US4, US5 test tasks in parallel once US2 is done.
- Polish: T041 alongside T039–T040.

## Implementation Strategy

1. **MVP**: Phases 1–3. Admins add images; the Backend enforces type, size, and count.
2. **Seen**: Phase 4 shows them on the event page in both apps.
3. **Managed**: Phase 5 adds remove and reorder.
4. **Browsed**: Phase 6 puts them on the Events list cards.
5. **Up close**: Phase 7 adds full screen.
6. **Ship**: Phase 8, with the independent review before the PR.
