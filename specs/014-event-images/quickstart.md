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

Three real pictures of your own: a JPG photo taken with a phone with location turned on (so it
has GPS and camera metadata, and ideally taken holding the phone upright), a PNG (a screenshot
works), and a WebP (any picture saved from a web page as `.webp`; or the 1-pixel one below). Then
make the files for the refusals, in a scratch folder:

```bash
mkdir -p qp-images && cd qp-images
echo "not a picture" > fake.jpg                                   # text named .jpg
node -e "require('fs').writeFileSync('tiny.webp', Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64'))"
node -e "require('fs').writeFileSync('anim.gif', Buffer.from('R0lGODlhAQABAAAAACw=', 'base64'))"
node -e "
const z = require('zlib'), f = require('fs');
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4);
  crc.writeUInt32BE(z.crc32(td)); return Buffer.concat([len, td, crc]); };
const png = (w, h, total) => { const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const head = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', ihdr),
    chunk('IDAT', z.deflateSync(Buffer.from([0, 200, 30, 30])))]);
  const end = chunk('IEND', Buffer.alloc(0));
  const pad = total ? chunk('prVt', Buffer.alloc(total - head.length - end.length - 12)) : Buffer.alloc(0);
  return Buffer.concat([head, pad, end]); };
f.writeFileSync('five-mb.png', png(1, 1, 5242880));     // exactly 5 MB, accepted
f.writeFileSync('too-big.png', png(1, 1, 5242881));     // 1 byte over, refused
f.writeFileSync('huge.png', png(20000, 20000));         // tiny file, 400 megapixels, refused
"
```

`five-mb.png` and `too-big.png` are a 1-pixel PNG padded with a private chunk to exactly 5,242,880
and 5,242,881 bytes. `huge.png` is a few dozen bytes whose header declares 20,000 × 20,000 pixels.

## S1: Schedule an event with three images (US1)

As `admin1`, open **Events → Schedule event**, fill in an event "Images Night" at any venue a week
ahead, and in **Images** choose the JPG, PNG, and WebP at once. **Expect**: three previews in that
order, "Cover" on the first, and the hint naming the limits. Save. **Expect**: the event page shows
the JPG across the full width of the page above the title, "1 of 3", and arrows.

## S2: Refusals (US1)

Edit "Images Night" and choose `anim.gif`, then `fake.jpg`, then `too-big.png`, then `huge.png`.
**Expect**: each is refused in the form, naming the file and the reason (type, type, size, pixels),
and nothing is sent (the Network panel shows no `POST …/images`). Then send them straight to the
API:

```bash
EVENT=…   # the event's id, from its page address
for f in fake.jpg anim.gif too-big.png huge.png five-mb.png; do
  curl -s -o /dev/null -w "$f %{http_code}\n" -X POST http://localhost:3000/events/$EVENT/images \
    -H "Authorization: Bearer $TOKEN" -F "file=@$f;type=image/jpeg"
done
```

**Expect**: `fake.jpg 415`, `anim.gif 415`, `too-big.png 413`, `huge.png 400` (`code:
IMAGE_DIMENSIONS_TOO_LARGE`), `five-mb.png 201`. `GET /events/$EVENT` lists four images, the fourth
`image/png` with `byteSize` 5242880 (the declared `image/jpeg` was ignored; a private chunk is not
metadata, so nothing was removed). Add `tiny.webp` the same way (`201`, five images), and the JPG
once more. **Expect**: `409` with `code: IMAGE_LIMIT_REACHED`.

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
- Select **Pause** (bottom left of the image; its accessible name is "Pause images of Images
  Night"). **Expect**: the image stays for a minute, wherever the pointer or focus goes; the button
  now reads "Play images of Images Night" and keeps focus. Select next and previous. **Expect**:
  they still flip, and it stays paused. Select **Play**. **Expect**: the next image about 5 seconds
  later. Pause again and reload the page. **Expect**: it turns again (the pause is not saved).
- Tab to the Pause/Play button and press Enter, then Space. **Expect**: it pauses, then plays; the
  button is at least 44 × 44 pixels with a visible focus ring.

Open an event with no images (for example one of the demo events, S9). **Expect**: the page looks
as before this feature.

## S5: Event cards (US4)

Open **Events**. **Expect**: "Images Night"'s card shows its images across the full width of the
card, above its name, rotating every 5 seconds with arrows and "1 of 3"; cards of events without
images look as before. Select an arrow. **Expect**: the image flips and the event does not open.
Select the image. **Expect**: the event page opens. With two cards with images on screen, select
one card's **Pause**. **Expect**: that card stops; the other keeps turning.

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
reload the event page and the Events list. **Expect**: no automatic changes and no Pause/Play
buttons; the arrows still flip.
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
counts 4 images; on **Events**, the concert rotates through 3 striped pictures, the comedy night
shows 1 with no arrows, and the gala has no gallery.

## S10: The Admin event page and the shared look (FR-019, FR-033)

As `admin1`, open "Images Night"'s event page. **Expect**: the same gallery and full screen as the
customer's. Compare the gallery's arrows, position label, and full-screen backdrop in both apps,
in light and dark mode (the device's setting). **Expect**: identical. `npm test` passed the
theme's no-drift check (`packages/shared/test/theme/drift.test.ts`).

## S11: Load with large images (FR-032, FR-039, research R1, R14)

Schedule 8 or more events, each with five JPG photos of about 5 MB (phone photos at full size).
In one terminal run `docker stats`. As `customer1`, open **Events** with the Network panel open,
scroll to the bottom and back, and leave it rotating for a minute. Also open Chrome's **Task
Manager** (Shift+Esc) and watch the tab's memory footprint, or run
`performance.memory.usedJSHeapSize` in the console now and then. **Expect**:

- the page stays responsive (scrolling, the arrows, and Pause react at once);
- image requests only for cards on or near the screen; a card scrolled away stops turning, and
  when it comes back its images are read again from the browser's cache (the Network panel's Size
  column shows "disk cache" or "memory cache"), so no new image request reaches the Backend after
  the first minute;
- `OPTIONS` preflights about once per 10 minutes per image URL, not before every read
  (`Access-Control-Max-Age: 600`);
- the tab's memory stays within research R14's ceiling (2 images per card in view: about
  12 × 2 × 5 MB = 120 MB of image data at most on a large window, plus the page) and does not grow
  as you scroll the whole list up and down several times;
- the `backend` container's memory rises by no more than a few dozen MB while images load and
  settles back; the `postgres` container stays well within its limit.

Record the peak memory of the tab and both containers in tasks.md (T044).

## S12: Creating an event when an image is refused, and metadata removal (FR-018, FR-035)

The form's preview stops bad files before sending, so make the upload fail another way: in Chrome
DevTools open **Network request blocking**, add the pattern `*/images`, and enable it. Schedule a
new event "Partial Night" with three pictures and save. **Expect**: "Event created. These pictures
were not added: … Save again to add them.", the address is now `/events/<id>/edit`, the heading
reads "Edit event", and the three pictures are still in the Images control. Blocking makes the
upload a network failure, not a Backend refusal; the form treats both the same way, and the Admin
app's tests (T014) check both. Disable the blocking and save. **Expect**: the remaining pictures are
added; the Events list shows exactly one "Partial Night" with three images. Press the browser's
Back button to return to the edit form. **Expect**: no pictures pending; saving changes nothing.

Download the phone photo you added in S1 through the API and inspect it:

```bash
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3000/events/$EVENT/images/$IMG -o stored.jpg
```

Open `stored.jpg`'s **Properties → Details** in Windows (or run `exiftool stored.jpg` if
installed). **Expect**: no GPS position, no camera make or model, no date taken; the photo opens
the right way up. In the Customer app the same photo is shown upright.

## S13: Whole pictures (FR-041, FR-042, issue #73)

Give an event three pictures: a tall phone photo (taller than wide), a square one, and a wide
panorama (at least 3 times as wide as tall). **Expect**, on its card on **Events** and on its event
page in both apps, at desktop width, at about 1,000 pixels (three columns of narrow cards), and at
375 pixels:

- every picture is whole: compared with the original, nothing is missing at any edge and nothing
  is stretched;
- the box takes each picture's shape, with no space around it, and grows or shrinks smoothly with
  the slide as the gallery turns (at once under reduced motion);
- on the event page, the tall photo fits within 70% of the window's height, centered, still
  whole, and on a phone the band does not change height while the page scrolls; on a card it is
  no taller than 4 for every 3 wide (3:4), and the panorama no flatter than 2:1 and never under
  160 pixels tall, both whole and centered, with the arrows, position, and Pause/Play still
  usable and not overlapping;
- resizing the window, each card stays the card's full width (it neither shrinks nor grows on its
  own) and its height follows at once, without a lag;
- on a short window with a single event whose picture is a tall portrait, the Events page settles
  (no scroll bar flickering on and off; research R18);
- the Admin form's previews show each picture whole in its own shape, between 3:4 and 2:1, and
  full screen still does.

Finally, sign in, use, and sign out of each front end (Constitution VI smoke test).

## Automation

Which scenarios a browser test walks on every pull request (spec `022`), and why the rest stay
manual. `npm test` checks this table against `e2e/tests`.

| Scenario | Browser test |
| --- | --- |
| S1 | Manual: outside the main journey the browser tests walk (spec 022 FR-005); walked by hand |
| S2 | Manual: outside the main journey the browser tests walk (spec 022 FR-005); walked by hand |
| S3 | Manual: outside the main journey the browser tests walk (spec 022 FR-005); walked by hand |
| S4 | Manual: outside the main journey the browser tests walk (spec 022 FR-005); walked by hand |
| S5 | Manual: outside the main journey the browser tests walk (spec 022 FR-005); walked by hand |
| S6 | Manual: outside the main journey the browser tests walk (spec 022 FR-005); walked by hand |
| S7 | Manual: reduced motion and phone width, checked by eye |
| S8 | Manual: API rules, covered by Backend tests |
| S9 | Manual: an empty database; every `npm run e2e` loads the demo data |
| S10 | Manual: outside the main journey the browser tests walk (spec 022 FR-005); walked by hand |
| S11 | Manual: a load with large images, timed by a person |
| S12 | Manual: needs a failure forced in developer tools |
| S13 | Manual: whole pictures, checked by eye |
