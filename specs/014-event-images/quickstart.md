# Quickstart: Checking Event Images

The running-system gate for `014`. Run after the implementation with every service healthy:

```bash
docker compose up --build -d
npm test                      # full suite, including the theme's no-drift check
```

Use a normal window for the Admin app (http://localhost:5173, `admin1` / `test123`) and a private
window for the Customer app (http://localhost:5174, `customer1` / `test123`). Take tokens as in
`001` quickstart V6 (copy the `Authorization` header of any API request in the Network tab).

## Test files

Three real pictures of your own: a JPG photo, a PNG (a screenshot works), and a WebP (any picture
saved from a web page as `.webp`; or the 1-pixel one below). Then make the files for the refusals,
in a scratch folder:

```bash
mkdir -p qp-images && cd qp-images
echo "not a picture" > fake.jpg                                   # text named .jpg
node -e "require('fs').writeFileSync('tiny.webp', Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64'))"
node -e "require('fs').writeFileSync('anim.gif', Buffer.from('R0lGODlhAQABAAAAACw=', 'base64'))"
node -e "const f=require('fs'),s=Buffer.from('89504e470d0a1a0a','hex'); f.writeFileSync('five-mb.png', Buffer.concat([s, Buffer.alloc(5242880-8)])); f.writeFileSync('too-big.png', Buffer.concat([s, Buffer.alloc(5242881-8)]))"
```

`five-mb.png` is exactly 5,242,880 bytes with a PNG signature and nothing else: the Backend accepts
it, and browsers show it as an image that could not be loaded (spec edge case "A picture that is
damaged after its first bytes").

## S1: Schedule an event with three images (US1)

As `admin1`, open **Events → Schedule event**, fill in an event "Images Night" at any venue a week
ahead, and in **Images** choose the JPG, PNG, and WebP at once. **Expect**: three previews in that
order, "Cover" on the first, and the hint naming the limits and that pictures are shown as
uploaded. Save. **Expect**: the event page shows the JPG across the full width of the page above
the title, "1 of 3", and arrows.

## S2: Refusals (US1)

Edit "Images Night" and choose `anim.gif`, then `fake.jpg`, then `too-big.png`. **Expect**: each is
refused in the form, naming the file and the reason (type, type, size), and nothing is sent (the
Network panel shows no `POST …/images`). Then send them straight to the API:

```bash
EVENT=…   # the event's id, from its page address
for f in fake.jpg anim.gif too-big.png five-mb.png; do
  curl -s -o /dev/null -w "$f %{http_code}\n" -X POST http://localhost:3000/events/$EVENT/images \
    -H "Authorization: Bearer $TOKEN" -F "file=@$f;type=image/jpeg"
done
```

**Expect**: `fake.jpg 415`, `anim.gif 415`, `too-big.png 413`, `five-mb.png 201`. `GET
/events/$EVENT` lists four images, the fourth `image/png` with `byteSize` 5242880 (the declared
`image/jpeg` was ignored). Add `tiny.webp` the same way (`201`, five images), and the JPG once more.
**Expect**: `409` with `code: IMAGE_LIMIT_REACHED`.

## S3: Remove, reorder, and Cancel (US3)

Edit "Images Night". **Expect**: five previews, the add control replaced by "5 of 5 images. Remove
one to add another." Remove image 4 (`five-mb.png`) and image 5, move image 3 (WebP) to first with
**Move image 3 earlier** twice, then select **Cancel**. **Expect**: the event page is unchanged
(five images, JPG first). Edit again, make the same changes, and save. **Expect**: three images,
WebP first and marked as the cover; `GET /events/$EVENT` shows positions 1, 2, 3.

Open the form in two windows as `admin1`. In one, remove an image and save. In the other, move an
image and save. **Expect**: "The images of Images Night changed since you loaded them…", the
current images shown, and nothing changed until saved again.

## S4: The event page gallery (US2)

As `customer1`, open "Images Night". **Expect**: the cover across the full width of the app, no
sideways scroll bar, "1 of 3". Watch for 20 seconds with the pointer away. **Expect**: a new image
every 5 seconds, back to 1 after 3.

- Rest the pointer on the image for 15 seconds. **Expect**: it keeps changing.
- Rest the pointer on the next arrow for 15 seconds. **Expect**: no change. Move it away.
  **Expect**: the next change about 5 seconds later.
- Select next, then previous on image 1. **Expect**: immediate changes; previous on 1 shows 3.
- Press Tab until an arrow has focus. **Expect**: a visible focus ring, no automatic change while
  it has focus, Enter flips. Tab out of the gallery. **Expect**: it moves on 5 seconds later.
- Click an arrow with the mouse and move the pointer off it. **Expect**: it moves on 5 seconds
  later (a mouse click does not count as keyboard focus).

Open an event with no images (for example one of the demo events, S9). **Expect**: the page looks
as before this feature.

## S5: Event cards (US4)

Open **Events**. **Expect**: "Images Night"'s card shows its images across the full width of the
card, above its name, rotating every 5 seconds with arrows and "1 of 3"; cards of events without
images look as before. Select an arrow. **Expect**: the image flips and the event does not open.
Select the image. **Expect**: the event page opens.

Schedule 8 more events with 3 images each (or run S9 first and add images), reload **Events** with
the Network panel open, filtered to `images/`. **Expect**: the cards' text appears before any
image; image requests only for cards on or near the screen, at most 2 per card; scrolling down
loads the next cards' images.

## S6: Full screen (US5)

On "Images Night"'s page, wait for image 2 and select it. **Expect**: image 2 covers the whole
window over a dark backdrop, whole and uncropped, with "2 of 3", arrows, and a close button. It
does not change on its own. Press the Right arrow key, then select the previous arrow. **Expect**:
3, then 2. Press Tab repeatedly. **Expect**: focus cycles among the close button and the two
arrows only. Press Esc. **Expect**: it closes, the gallery shows image 2, and focus is on the
gallery's image. Open it again and close with the close button. **Expect**: the same.

## S7: Reduced motion and phone width (US2, FR-025, FR-028)

In Chrome DevTools, **Rendering → Emulate CSS media feature prefers-reduced-motion: reduce**, and
reload the event page and the Events list. **Expect**: no automatic changes; the arrows still flip.
Turn it off. Then use the device toolbar at 375 pixels wide. **Expect**: no sideways scrolling on
the Events list or the event page; arrows and the full-screen close button at least 44 × 44 pixels
(inspect them).

## S8: Rules on the API (FR-002, FR-010, FR-011, FR-013)

```bash
IMG=…   # an image id from GET /events/$EVENT
curl -si http://localhost:3000/events/$EVENT/images/$IMG | head -1                              # 401
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" http://localhost:3000/events/$EVENT/images/$IMG   # 200 image/…
curl -s -o /dev/null -w "%{http_code}\n" -X DELETE \
  -H "Authorization: Bearer $CUSTOMER_TOKEN" http://localhost:3000/events/$EVENT/images/$IMG   # 403
```

Three uploads at once to an event with 3 images:

```bash
for i in 1 2 3; do curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  http://localhost:3000/events/$EVENT2/images -H "Authorization: Bearer $TOKEN" -F "file=@photo.jpg" & done; wait
```

**Expect**: two `201` and one `409`; the event lists positions 1 to 5.

As `admin1`, cancel "Images Night". **Expect**: customers still see its images; an upload to it is
`409 EVENT_CANCELLED`. Schedule an event with one image and no orders, note its image id, and
delete the event. **Expect**: `GET` of that image is `404`.

## S9: Demo data (FR-034)

On an empty database (`docker compose down -v && docker compose up --build -d`), run
`docker compose exec backend node backend/dist/scripts/demo-data.js`. **Expect**: the summary
counts 6 images; on **Events**, the concert rotates through 3 striped pictures, the comedy night
shows 1 with no arrows, and the gala has no gallery.

## S10: The Admin event page and the shared look (FR-019, FR-033)

As `admin1`, open "Images Night"'s event page. **Expect**: the same gallery and full screen as the
customer's. Compare the gallery's arrows, position label, and full-screen backdrop in both apps,
in light and dark mode (the device's setting). **Expect**: identical. `npm test` passed the
theme's no-drift check (`packages/shared/test/theme/drift.test.ts`).

Finally, sign in, use, and sign out of each front end (Constitution VI smoke test).
