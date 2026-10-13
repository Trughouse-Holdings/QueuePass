# Contract Changes: Event Images

The single contract is [`contracts/openapi.yaml`](../../../contracts/openapi.yaml) (Constitution I).
This feature moves it from **1.7.0 to 1.8.0** in the spec and plan PR, with
`packages/shared/src/api-schema.ts` regenerated (`npm run generate:api`) and
`node scripts/check-contract-drift.mjs` passing. `013`'s implementation (PR #34) edits only 1.7.0
descriptions, so 1.8.0 is free; whichever merges second rebases and regenerates (research R8).

| Where | Change |
|---|---|
| `info.description` | new paragraph, **Planned operations**: what `x-planned` means, and that 014's image operations carry it until implemented (research R8). |
| `tags` | adds `images`. |
| `POST /events/{id}/images` | new, `uploadEventImage`, `queuepass-admin`, `x-planned: '014'`. `multipart/form-data` with one `file` (`EventImageUpload`). `201 EventImage`; `400 ImageRejected` (`VALIDATION_FAILED`, `IMAGE_DIMENSIONS_TOO_LARGE`), `401`, `403`, `404`, `409` (`EVENT_CANCELLED`, `IMAGE_LIMIT_REACHED`), `413 ImageTooLarge`, `415 ImageTypeNotAllowed`. The description gives the three signatures, the header fields the size in pixels is read from, the metadata removed before storing (a JPEG keeps its orientation), and the refusal order. |
| `PUT /events/{id}/images/order` | new, `reorderEventImages`, `queuepass-admin`, `x-planned: '014'`. Body `EventImageOrder`. `200` the images in order; `400`, `401`, `403`, `404`, `409` (`EVENT_CANCELLED`, `IMAGES_CHANGED`). |
| `GET /events/{id}/images/{imageId}` | new, `getEventImage`, any signed-in (`[]`), `x-planned: '014'`. `200` with `image/jpeg`, `image/png`, or `image/webp` bytes and `Cache-Control` / `X-Content-Type-Options` headers; `400`, `401`, `404`. |
| `DELETE /events/{id}/images/{imageId}` | new, `deleteEventImage`, `queuepass-admin`, `x-planned: '014'`. `204`; `400`, `401`, `403`, `404`, `409` (`EVENT_CANCELLED`). |
| `Event` | adds `images` (array of `EventImage`, at most 5, in order). Always sent once implemented; **not** in `required` (research R8). Every operation returning an `Event` gains it through the schema. |
| `EventImage` | new schema: `id`, `position` (1–5), `contentType` (enum of three), `byteSize` (1–5,242,880, the stored size after metadata removal); `additionalProperties: false`. |
| `EventImageUpload` | new schema: the multipart body, one required `file`. |
| `EventImageOrder` | new schema: `imageIds`, unique UUIDs, at most 5. |
| `ImageRejected` | new response for the upload's `400`: `VALIDATION_FAILED` (parts, event id) and `IMAGE_DIMENSIONS_TOO_LARGE` (`details.width`, `height`, `maxSide`, `maxPixels`). |
| `ImageTooLarge` | new response: `413 IMAGE_TOO_LARGE`, `details.maxBytes`. |
| `ImageTypeNotAllowed` | new response: `415 IMAGE_TYPE_NOT_ALLOWED`, `details.allowed`. |
| `Conflict` | new examples `imageLimitReached` and `imagesChanged`. |
| `ErrorEnvelope.code` | adds `IMAGE_LIMIT_REACHED`, `IMAGE_TOO_LARGE`, `IMAGE_TYPE_NOT_ALLOWED`, `IMAGES_CHANGED`, `IMAGE_DIMENSIONS_TOO_LARGE`, after the address codes. |
| `deleteEvent` | description: the event's images are deleted with it (a cascade, research R7). |

Unchanged: every other operation's request, roles, and errors. `cancelEvent`'s description already
says a cancelled event refuses changes.

Also in this PR, so `main` stays green before the implementation (research R8):

- `packages/shared/src/errors.ts`: the five codes added to `ERROR_CODES`.
- `backend/test/contract/route-coverage.e2e-spec.ts` and `expect-to-match-contract.ts`: an
  `x-planned` operation is skipped only while no route serves it.

Example upload:

```bash
curl -s -X POST http://localhost:3000/events/$EVENT/images \
  -H "Authorization: Bearer $TOKEN" -F "file=@stage.jpg"
```

→ `201`

```json
{
  "id": "2b1e0c3d-4f5a-4b6c-8d7e-9f0a1b2c3d4e",
  "position": 1,
  "contentType": "image/jpeg",
  "byteSize": 482113
}
```

An event with images, as every event response returns it:

```json
{
  "id": "…",
  "name": "Season Opener",
  "…": "…",
  "images": [
    { "id": "2b1e…", "position": 1, "contentType": "image/jpeg", "byteSize": 482113 },
    { "id": "5e6f…", "position": 2, "contentType": "image/webp", "byteSize": 120544 }
  ]
}
```

Example refusals:

```json
{
  "error": {
    "code": "IMAGE_TYPE_NOT_ALLOWED",
    "message": "This file is not a JPG, PNG, or WebP picture.",
    "details": { "allowed": ["image/jpeg", "image/png", "image/webp"] }
  }
}
```

```json
{
  "error": {
    "code": "IMAGE_DIMENSIONS_TOO_LARGE",
    "message": "This picture is 20000 × 20000 pixels. A picture can be at most 16,384 pixels on each side and 40 megapixels in all.",
    "details": { "width": 20000, "height": 20000, "maxSide": 16384, "maxPixels": 40000000 }
  }
}
```

```json
{
  "error": {
    "code": "IMAGE_TOO_LARGE",
    "message": "An image can be at most 5 MB.",
    "details": { "maxBytes": 5242880 }
  }
}
```

```json
{
  "error": {
    "code": "IMAGE_LIMIT_REACHED",
    "message": "Season Opener already has 5 images, the most an event can have. Remove one to add another.",
    "details": { "limit": 5, "count": 5 }
  }
}
```

```json
{
  "error": {
    "code": "IMAGES_CHANGED",
    "message": "The images of Season Opener changed since you loaded them. Check them and try again.",
    "details": { "imageIds": ["2b1e…", "5e6f…"] }
  }
}
```

Reorder:

```bash
curl -s -X PUT http://localhost:3000/events/$EVENT/images/order \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"imageIds":["5e6f…","2b1e…"]}'
```

→ `200` with both images, `5e6f…` at position 1.
