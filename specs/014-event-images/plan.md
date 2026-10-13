# Implementation Plan: Event Images

**Branch**: `014-event-images-spec` | **Date**: 2026-10-12 | **Spec**: [spec.md](./spec.md)
| **Issue**: [#26](https://github.com/Trughouse-Holdings/QueuePass/issues/26)

**Input**: Feature specification from `specs/014-event-images/spec.md`

## Summary

- **Storage**: a new `EventImage` table holds each picture's bytes in PostgreSQL (`bytea`) with its
  event, position, detected type, and size. No new service, volume, or variable (research R1).
- **Rules**: positions 1 to 5 (CHECK) and unique per event (a deferrable unique constraint) make
  "at most 5" a database fact; every image write takes the existing event row lock (`lockEvent`),
  so the limit refusal is clear and positions stay 1 to n under concurrency (R2).
- **Type and size**: one file per `multipart/form-data` request, read by NestJS's built-in multer
  with a 5,242,880-byte limit (`413 IMAGE_TOO_LARGE`); the type is the file's signature (JPEG, PNG,
  WebP), never its name or declared type (`415 IMAGE_TYPE_NOT_ALLOWED`); the size in pixels is read
  from the header and capped at 16,384 a side and 40 megapixels (`400 IMAGE_DIMENSIONS_TOO_LARGE`)
  (R3).
- **Metadata**: location, camera, and text metadata are removed before storing (JPEG Exif/XMP/MPF/
  IPTC/comments, PNG `eXIf`/text/`tIME` chunks, WebP `EXIF`/`XMP `), and anything after the end of
  the main picture is dropped; a JPEG keeps only its orientation (R17). Animated PNG and WebP are
  refused (`415`, R3).
- **API** (contract **1.8.0**): `uploadEventImage`, `getEventImage`, `deleteEventImage`,
  `reorderEventImages` (`PUT …/images/order` with every id), five new codes, and `Event.images`
  (metadata only) on every event response (R5, R6). Cancelled events refuse image changes with the
  existing `EVENT_CANCELLED`; deleting an event cascades (R7).
- **Serving under Constitution V**: the image read needs a token like everything else; the apps
  fetch it with the token as a blob and show it from an object URL, through one shared cache, with
  `Cache-Control: private, max-age=31536000, immutable`; CORS preflights cached for 10 minutes
  (`maxAge: 600`) (R4).
- **Admin app**: an Images control in the event form (add, preview, move, remove, "Cover"),
  applied on Save after the event's details, resumable after a refusal. `008`'s create flow is
  unchanged for seating and ticket-type refusals; only when a picture is refused after the event,
  its seating, and its ticket types were all saved does the form become that event's edit form
  with the pending pictures, so saving again never creates the event twice (R9).
- **Both apps**: a shared `ImageGallery` (cards, the event page band, the Admin event page) and
  `ImageViewer` (full screen), rotating every 5 seconds, with a Pause/Play button on every gallery
  that turns on its own (Mahdi, after the PR review), so the galleries meet WCAG 2.2.2; also
  pausing while an arrow is pointed at or has keyboard focus (Mahdi), or the event page's
  full-screen image button has keyboard focus (recommended); no automatic change and no button
  under reduced motion (Mahdi) (R10–R12).
- **Look**: gallery and viewer rules in the shared theme (`012`) with two new tokens, `--scrim` and
  `--scrim-text`; the Admin control's layout in its own stylesheet on theme values (R13).
- **Performance**: lists carry metadata only; cards load images only on or near the screen, the
  shown one and the next, and stop turning and let go of them when they leave, so the Events list
  holds at most 2 images per card in view (R14).
- **Demo data**: generated striped PNGs, no committed pictures (R15).

The contract and regenerated types land in this PR. To keep `main` green before the
implementation, `Event.images` is not in `required`, the four operations are marked `x-planned`
under the strict rule `015` (#38) also uses (a marked operation must be unserved; the
implementation removes each marker in the commit that serves its route), and `ERROR_CODES`
already lists the five codes (R8). `015`'s spec PR (#38) also takes 1.8.0: whichever of #35 and
#38 merges second rebases to **1.9.0** and reruns `npm run generate:api` (R8).

## Technical Context

**Language/Version**: TypeScript 5.7 (strict) on Node.js 22 LTS

**Primary Dependencies**: unchanged. **No new dependencies**: multer ships with
`@nestjs/platform-express`; PNG generation for demo data uses `node:zlib`; the apps use the
existing `openapi-fetch` client (`parseAs: 'blob'`, `FormData` bodies).

**Storage**: PostgreSQL 17. One table with four CHECKs and a deferrable unique constraint in one
migration ([data-model.md](./data-model.md)).

**Testing**: Backend Jest + Supertest + Testcontainers with contract validation, including 10
simultaneous uploads; the contract helper learns non-JSON responses. Shared, Admin, and Customer
Vitest + React Testing Library with fake timers, stubbed `matchMedia`, `IntersectionObserver`, and
object URLs. Browser checks in [quickstart.md](./quickstart.md).

**Target Platform**: the existing Docker Compose stack on one laptop.

**Project Type**: web application (one Backend, three front ends).

**Performance Goals**: event lists add one indexed metadata query and about 100 bytes per image;
an Events list's first view loads at most 2 images per card on or near the screen (SC-006); the
event row lock is held only for an image insert or shift, never during an upload.

**Constraints**: never more than 5 images per event, positions 1 to n, under concurrency
(Constitution IV); no unauthenticated route (Constitution V); bytes never in an event payload;
events without images unchanged; gallery styles only from the shared theme (Constitution VII).

**Scale/Scope**: 4 new operations; 1 changed schema (`Event`, embedded in 5 operations' responses);
3 new schemas; 3 new responses; 5 new error codes; 1 migration; 2 new theme tokens; 1 CORS setting
(`maxAge`); 0 new environment variables.

## Constitution Check

Evaluated against constitution **v3.0.1**. No amendment: the `014` roadmap row ("Admins upload up
to 5 images per event; customers see them on the event, for example as a rotating gallery")
already describes this feature.

| Principle | Pre | Post | Evidence |
|---|---|---|---|
| **I. API-Only, Contract First** | PASS | **PASS** | Contract 1.8.0 and regenerated types in this PR, before any code; drift check passes. Each new operation declares its request (multipart or JSON), response (JSON or image bytes with headers), roles, and every error. Five new codes in the standard envelope. Apps load images only through the API client. The `x-planned` marker keeps the operations declared and typed now; the route-coverage test still fails any route the contract does not declare, and checks every served route's roles (R8). |
| **II. One Repo, One Command** | PASS | **PASS** | No new service, volume, variable, or dependency. Images live in PostgreSQL's existing mapped volume, so they survive a restart. One migration applied by the existing startup. Seed unchanged; demo data generates its pictures (R1, R15). |
| **Quality gate 4 (never skip a failing test)** | — | **PASS** | The route-coverage change is a correction of the test, not a skip: its premise ("every declared operation is served") cannot hold during Constitution III's two-PR window, so it now asserts the corrected rule, copied exactly from `015`'s spec PR (#38): every unmarked operation is served with exactly its declared roles, and every `x-planned` operation is **not** served (`plannedButImplemented`). It still fails an undeclared route or a wrong role, and it fails if a marker outlives its implementation, which removes each marker in the commit that serves its route (T016, T032). The marker lives in the contract, shared surface, so every team member approves it in this PR (R8). |
| **III. Spec-Driven, Reviewed** | PASS | **PASS** | Issue #26; spec and plan on `014-event-images-spec`, reviewed by a second Claude session before the PR; implementation on `014-event-images-impl` in a fresh session, closing #26. |
| **IV. Server-Authoritative, DB-Guaranteed** | PASS | **PASS** | The Backend decides type (by signature), size, count, and order. The database guarantees at most 5 per event and unique positions (CHECK + unique constraint), and the type list and size (CHECKs); every image write takes the event row lock, so the limit and contiguous positions hold under concurrent requests (tested with 10 at once). The Admin form's checks are a preview; refusals are shown with every value and unsaved picture kept (R2, R3, R9). |
| **V. Sign-In Everywhere** | PASS | **PASS** | Writes are `queuepass-admin`; the image read is any signed-in role, with a token, like the event it belongs to. No public or signed URL (R4). Tokens stay in memory: the apps send them with the existing client and show images from page-local `blob:` URLs. |
| **VI. Test-First, Real Database** | PASS | **PASS** | Tests precede code in `tasks.md`; persistence and constraints tested on real PostgreSQL; boundaries both sides (5,242,880 / 5,242,881 bytes; 5th / 6th image; 11 / 12 signature bytes; 16,384 / 16,385 pixels a side; 40 megapixels); concurrency with genuinely simultaneous uploads; authorization's missing, expired, wrongly signed, wrong-audience, and wrong-role cases on the four routes. The 80% floor is a recorded deferral until `010` and `011`; this feature reports its coverage. |
| **VII. Function Over Finish, One Shared Look** | PASS | **PASS** | The gallery is the feature the roadmap and Mahdi asked for, built from theme classes: no animation, no decoration. Its rules are in the shared theme because both apps use it; two tokens (`--scrim`, `--scrim-text`) are added there, since a full-screen backdrop must be dark in both modes. The Admin control uses theme values only. Usability targets stated and tested: 44-pixel targets, keyboard access, position in words, AA contrast, and a Pause/Play button on every gallery that turns on its own, so the galleries meet WCAG 2.2.2 (R11, R13). |
| **VIII. Staged Simplicity** | PASS | **PASS** | No object store, thumbnails, image library, captions, drag-and-drop, or swipe (spec Out of Scope). The Pause/Play state is per gallery and not saved (no preference storage). No test-only bypass of a control: an `x-planned` operation must be unserved, so the marker cannot hide an undeclared route, a wrong role, or a finished route. No security or correctness control deferred. |
| **Security** | PASS | **PASS** | No secret. Types by signature only (SVG and every other format refused), served with the detected type and `nosniff`; 5 MB cap enforced while reading; a pixel cap stops decompression bombs (R3). Location, camera, and text metadata removed before storing, keeping only a JPEG's orientation (R17). CORS still allows only the three front ends; only the preflight cache time changes (R4). |
| **Shared surface** | — | **Needs every member's approval** | This PR touches `contracts/openapi.yaml` (including the `x-planned` markers), `packages/shared/src/api-schema.ts`, and `packages/shared/src/errors.ts` (plus the Backend's contract tests). The implementation touches `packages/shared/` (new files, the theme), `backend/prisma/`, and nothing else on the shared list. |

## Project Structure

```text
specs/014-event-images/
├── spec.md, plan.md, research.md (R1–R17), data-model.md, quickstart.md (S1–S12), tasks.md
├── checklists/requirements.md
└── contracts/README.md

contracts/~ openapi.yaml                                  # 1.8.0 (this PR)
packages/shared/src/~ api-schema.ts, ~ errors.ts           # this PR (R8)
backend/test/contract/~ route-coverage.e2e-spec.ts, ~ expect-to-match-contract.ts   # this PR (R8)

packages/shared/src/+ event-image.ts, ~ event.ts, ~ index.ts          # implementation PR
packages/shared/src/web/+ event-images.ts, + use-gallery-rotation.ts,
                        + image-gallery.tsx, + image-viewer.tsx, ~ index.ts, ~ theme.css
packages/shared/test/+ event-image.test.ts,
                     web/+ event-images.test.tsx, + use-gallery-rotation.test.ts,
                         + image-gallery.test.tsx, + image-viewer.test.tsx,
                     theme/~ contrast.test.ts, ~ tokens.test.ts
backend/
├── prisma/~ schema.prisma, migrations/+ 20261012000000_event_images/migration.sql
├── src/
│   ├── events/+ event-images.controller.ts, + event-images.service.ts,
│   │         + image-metadata.ts,                       # metadata removal (R17)
│   │         + dto/reorder-event-images.dto.ts, ~ events.module.ts,
│   │         ~ events.service.ts                         # EVENT_INCLUDE (R6)
│   ├── common/filters/~ prisma-exception.filter.ts       # 413 → IMAGE_TOO_LARGE (R3); position unique → IMAGES_CHANGED (R2)
│   ├── ~ configure-app.ts                                # CORS maxAge: 600 (R4)
│   └── scripts/+ demo-images.ts, ~ demo-data.ts          # R15
└── test/
    ├── contract/~ expect-to-match-contract.ts            # non-JSON responses (R8)
    ├── setup/+ images.ts                                 # small valid images, upload helper
    ├── unit/+ expect-to-match-contract.spec.ts, + demo-images.spec.ts, + image-metadata.spec.ts
    └── integration/+ event-images.storage.e2e-spec.ts, + event-images.e2e-spec.ts,
                    + event-images.order.e2e-spec.ts, + event-images.concurrency.e2e-spec.ts,
                    + event-images.authz.e2e-spec.ts; ~ events.crud.e2e-spec.ts,
                    ~ demo-data.e2e-spec.ts, ~ cors-docs.e2e-spec.ts
admin-app/src/api/+ images.ts
admin-app/src/components/+ ImagesField.tsx
admin-app/src/pages/~ EventForm.tsx, ~ EventDetail.tsx
admin-app/src/~ styles.css                                # .image-list (R13)
admin-app/test/+ images-field.test.tsx, + event-images.detail.test.tsx;
              ~ setup.ts, ~ helpers/api-stub.ts
customer-app/src/components/~ EventCard.tsx
customer-app/src/pages/~ EventDetail.tsx
customer-app/src/~ styles.css                             # card gallery margins (R13)
customer-app/test/+ event-images.test.tsx; ~ setup.ts, ~ helpers.tsx
~ README.md
```

**Structure Decision**: the existing monorepo layout. Image routes get their own controller and
service inside `backend/src/events/` (they are sub-resources of an event and use its lock), so
`EventsService` changes only its include. The gallery, viewer, cache, and rotation are shared web
code; each app only places them.

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
|---|---|---|
| `x-planned` on the four operations, and the route-coverage test requiring them to be unserved | Constitution I puts the operations in this PR; Constitution III needs `main` green before the implementation; the unchanged test fails with them declared (checked, R8) | Leaving them out of the contract is contract-after-code; leaving the test failing turns `main` red. The implementation removes each marker with its route (T016, T032), and the test's version is shared with #38. |
| `Event.images` not in `required` | The Backend's tests validate responses, and `main` does not send it yet (R8) | Required would fail every event response test on `main` until the implementation merges. |
| `ERROR_CODES` updated in this PR | A unit test (`us-states.spec.ts`, from `013`) requires every contract code to be in `ERROR_CODES` (R8) | Waiting for the implementation would fail that test on `main`. |
| A deferrable unique constraint written in SQL | Delete and reorder shift positions in one statement, checked at commit (R2) | A plain unique index can fail mid-statement on a swap; Prisma cannot declare deferrable constraints. |
| Images fetched as blobs with a shared object URL cache | `<img src>` cannot carry the bearer token Constitution V requires on every route (R4) | Public or signed image URLs need an unauthenticated route, which the constitution forbids. |
| A custom full-screen dialog | FR-030's focus trap and return must behave the same in every browser and in tests (R12) | `<dialog>.showModal()` is not in jsdom and returns focus differently across browsers; the Fullscreen API does not work for images on iPhone. |
| Metadata removal and header reading written by hand (R3, R17) | Mahdi decided metadata is removed (FR-035); a pixel cap needs each format's size (FR-036) | An image library (`sharp`) re-encodes, loses quality, and brings native binaries; `file-type` and `exif` packages cover only part and add dependencies. Both are byte-level walks of documented structures, unit-tested per format. |
| Two new theme tokens (`--scrim`, `--scrim-text`) | The full-screen backdrop must be dark in light and dark mode (R13) | No existing token is dark in both; writing the color in an app stylesheet fails `012`'s drift check. |
