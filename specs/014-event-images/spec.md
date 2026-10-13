# Feature Specification: Event Images

**Feature Branch**: `014-event-images-spec`

**Created**: 2026-10-12

**Status**: Draft

**Issue**: [#26](https://github.com/Trughouse-Holdings/QueuePass/issues/26)

**Input**: User description: "Event images, up to 5 per event. Admins upload up to 5 images per
event; customers see them on the event, for example as a rotating gallery."

## Context

Builds on `002` (admins schedule and edit events), `003` (customers see every event), `005` (a
cancelled event is read-only; an event with orders cannot be deleted), `006` and `007` (the
customer's event page is where tickets and seats are chosen), `008` (events shown as cards, phone
layout, keyboard access, AA contrast), and `012` (one shared theme for both apps).

Today an event is text only: a name, a venue, times, and prices. Customers browsing the Events list
see no picture of what they are buying a ticket for.

This feature lets an admin add up to five pictures to an event in the event form, and shows them
to customers as a rotating gallery: across the top of each event card on the Events list, and
across the full width of the app at the top of the event page, with arrows to flip through them
and a full-screen view.

The constitution's roadmap row for `014` ("Admins upload up to 5 images per event; customers see
them on the event, for example as a rotating gallery") already describes this feature, so it is
not amended.

## Clarifications

### Session 2026-10-12

- Q: Where do admins add images? → A: In the Admin app's event form, both when scheduling an event
  and when editing one, an "Images" control lets the admin add pictures, remove them, and change
  their order. The first image is the event's cover (decided by Mahdi, 2026-10-12).
- Q: What images are accepted? → A: Up to 5 per event, JPG, PNG, or WebP only, at most 5 MB each.
  The Backend enforces this, not only the form, and it checks what the file really is from its
  content, not from its name or the type the browser claims (decided by Mahdi, 2026-10-12).
- Q: A phone photo can record where it was taken and with which camera. Is that kept? → A: No.
  The Backend removes location and camera metadata from every picture before storing it (decided
  by Mahdi, 2026-10-12, after review round 1). Only a JPG's orientation is kept, so phone photos
  stay upright (research R17).
- Q: Is there a limit on a picture's width and height? → A: Yes: at most 16,384 pixels on either
  side and 40 megapixels in all, so a small file cannot expand into a picture too large for
  browsers to show (decided in this spec after review round 1, research R3).
- Q: Where do customers see the images on the Events list? → A: Each event card shows that event's
  images as a rotating gallery spanning the full width of the card, before the customer opens the
  event (decided by Mahdi, 2026-10-12).
- Q: And on the event page? → A: At the top of the event page, where tickets and seats are
  chosen, the images are a rotating gallery spanning the full width of the app (decided by Mahdi,
  2026-10-12).
- Q: Can a customer see an image bigger? → A: Yes. Selecting an image on the event page opens it
  truly full screen: it covers the whole window over a dark backdrop, with arrows, a close button,
  and Esc to close (decided by Mahdi, 2026-10-12). On an event card, selecting the image opens
  the event page, as selecting the card's title does today; full screen is offered from the event
  page (confirmed by Mahdi, research R12).
- Q: How do the galleries rotate? → A: Both move to the next image every 5 seconds and start over
  after the last. They do not pause when the pointer is over the image or anywhere else. They pause
  only while the pointer is over one of the arrow buttons or an arrow button has keyboard focus
  (decided by Mahdi, 2026-10-12; "no other pause"), plus, on the event page, while the image
  button that opens full screen has keyboard focus (recommended in this spec for keyboard users,
  research R11). For a customer whose device asks for reduced motion, the galleries do not advance
  on their own; the arrows still work (decided by Mahdi, 2026-10-12).
- Q: Should there be a Pause/Play button, as WCAG 2.2.2 expects? → A: Yes. Each gallery that turns
  on its own has a Pause/Play button. Pause stops the turning until Play is pressed; rotation still
  starts on by default, and the arrow pause and reduced motion stay as above. Mahdi first chose no
  button, then added it after the PR review (decided by Mahdi, 2026-10-13), so the galleries meet
  WCAG 2.2.2 (research R11).
- Q: How can a customer flip through faster? → A: Previous and next arrow buttons on the sides of
  the images, in both galleries and in full screen (decided by Mahdi, 2026-10-12).
- Q: What does an event with no images, or one image, look like? → A: With no images, the card and
  the page look exactly as they do today, with no empty gallery. With one image, it is shown with
  no rotation and no arrows (decided by Mahdi, 2026-10-12).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - An Admin Adds Images to an Event (Priority: P1)

While scheduling an event, or editing one, an admin chooses up to five pictures in the event
form's Images control. Each appears as a small preview in the order chosen, the first marked as
the cover. When the admin saves, the event is saved with its images. A file that is not a JPG,
PNG, or WebP picture, a picture over 5 MB, or a sixth picture is refused, with a message that names
the file and says why. Nothing about the refused file is stored, and everything else the admin
entered stays in the form.

**Why this priority**: Without a way to add images there is nothing for customers to see. The
limits protect every page that shows them.

**Independent Test**: Through the API and the Admin app, add a JPG, a PNG, and a WebP to an event
and confirm each is stored in order. Try a text file renamed `.jpg`, a 5 MB + 1 byte picture, and
a sixth picture, and confirm each is refused with its own reason and nothing is stored.

**Acceptance Scenarios**:

1. **Given** the Schedule event form, **When** an admin fills in the event, chooses three pictures
   (a JPG, a PNG, and a WebP), and saves, **Then** the event is created with the three images in
   that order, and the first is its cover.
2. **Given** the Edit event form of an event with two images, **When** the admin adds one more and
   saves, **Then** the event has three images, the new one last.
3. **Given** the form, **When** the admin chooses a file that is not a picture, or a GIF, HEIC, or
   SVG picture, **Then** the form refuses it before sending, naming the file and saying only JPG,
   PNG, or WebP pictures are accepted.
4. **Given** a text file renamed `poster.jpg`, sent straight to the API with an image type,
   **Then** it is refused because its content is not a JPG, PNG, or WebP picture, and nothing is
   stored.
5. **Given** a picture of exactly 5 MB (5,242,880 bytes), **Then** it is accepted. **Given** one of
   5,242,881 bytes, **Then** it is refused because it is over 5 MB, and nothing is stored.
6. **Given** an event with five images, **When** an admin tries to add another, in the form or
   straight through the API, **Then** it is refused, saying an event can have at most 5 images.
7. **Given** an event with three images, **When** two admins add three images between them at the
   same moment, **Then** exactly two are added, the third is refused for the limit, and the event
   has five images in positions 1 to 5.
8. **Given** the Backend refuses one picture while the admin saves, **Then** the form shows the
   refusal, naming the picture, keeps every value and every picture not yet saved, and saving
   again finishes what is left without adding any picture twice.
9. **Given** the Schedule event form, **When** the event, its seating, and its ticket types are all
   saved but one of its pictures is refused or cannot be sent, **Then** the admin is told the event
   was created and which pictures were not added, and the form becomes the Edit event form of that
   new event, showing everything just saved and keeping the pictures not yet added. Saving again
   adds only those pictures (and any other change made meanwhile) to that event; a second event is
   never created.
13. **Given** the Schedule event form, **When** the event is created but its seating or ticket
    types are refused, **Then** the form behaves exactly as it does today (`008`): it stays on
    Schedule event with every value, including the chosen pictures, and offers "Finish on the
    event page". No picture is sent.
10. **Given** a signed-in user who is not an admin, **When** they try to add an image through the
    API, **Then** it is refused, and nothing is stored.
11. **Given** a picture wider or taller than 16,384 pixels, or of more than 40 megapixels, **Then**
    it is refused, saying it is too large in pixels, and nothing is stored.
12. **Given** a phone photo that records where it was taken and the camera's make, **When** it is
    added, **Then** the stored picture contains neither, and it is shown upright.

---

### User Story 2 - Customers See the Images on the Event Page (Priority: P1)

A customer opens an event that has images. Across the top of the event page, spanning the full width
of the app, the cover is shown first. Every 5 seconds the gallery moves to the next image, and after
the last it starts over. Arrow buttons on the left and right let the customer go back or forward at
any time, and a Pause/Play button stops the turning until they choose Play. Below the gallery, the
event's details and the ticket and seat choices are exactly where they were.

**Why this priority**: This is where a customer decides to get tickets, and it is the main place
customers see the images.

**Independent Test**: Open an event with three images, confirm the cover shows first across the
full width, that the image changes every 5 seconds and wraps around, that the arrows move back and
forward, and that an event with no images looks as it does today.

**Acceptance Scenarios**:

1. **Given** an event with three images, **When** a customer opens its page, **Then** the cover
   is shown across the full width of the app, above the event's name, with "1 of 3".
2. **Given** that page, **When** 5 seconds pass, **Then** image 2 is shown; 5 seconds later image
   3; 5 seconds later image 1 again.
3. **Given** that page, **When** the customer selects the next arrow, **Then** the next image is
   shown at once, and the gallery then waits a full 5 seconds before moving on. The previous arrow
   on image 1 shows image 3.
4. **Given** the pointer is over an arrow button, **Then** the gallery does not move on its own for
   as long as the pointer stays there. When the pointer leaves, it moves on 5 seconds later.
5. **Given** the pointer is over the image itself, or anywhere else on the page, **Then** the
   gallery keeps moving every 5 seconds.
6. **Given** a keyboard user, **When** they Tab to an arrow button, **Then** the gallery stops
   moving on its own while the button has focus, and Enter or Space flips the image. When focus
   leaves the gallery's controls, it moves on 5 seconds later.
7. **Given** the customer's device is set to reduce motion, **Then** the gallery shows the cover
   and does not move on its own, and there is no Pause/Play button (nothing moves); the arrows still
   flip through the images.
12. **Given** a gallery turning on its own, **When** the customer selects "Pause images of Season
    Opener", **Then** it stops on the shown image and stays there, whatever the pointer or focus
    does, until they select "Play images of Season Opener"; then it moves on 5 seconds later. While
    paused, the arrows still flip the image.
13. **Given** the customer paused the gallery and then opens another event or reloads the page,
    **Then** the new gallery turns on its own again.
8. **Given** an event with one image, **Then** it is shown across the top with no arrows, no
   position, no Pause/Play button, and no movement.
9. **Given** an event with no images, **Then** the event page looks exactly as it does today.
10. **Given** a cancelled event, or one whose sales have closed, with images, **Then** its images
    are shown the same way.
11. **Given** a phone-width screen, **Then** the gallery fits the width of the screen with no
    sideways scrolling, and the arrows are still at least 44 by 44 pixels.

---

### User Story 3 - An Admin Removes and Reorders Images (Priority: P2)

An admin edits an event and changes its pictures: removes one, moves one earlier or later, and
chooses which comes first, which is the cover. The changes are made when the admin saves the form,
and Cancel leaves the event's images as they were.

**Why this priority**: Admins will want to fix a wrong picture or change the cover, but adding
images (US1) is useful without it.

**Independent Test**: Edit an event with four images: remove the second, move the last to first,
save, and confirm the event has three images in the new order with the moved image as the cover.

**Acceptance Scenarios**:

1. **Given** the Edit event form of an event with images, **Then** the Images control shows each
   image as a preview, in order, the first marked "Cover", each with Move earlier, Move later, and
   Remove buttons.
2. **Given** that form, **When** the admin removes image 2 and saves, **Then** the event keeps the
   other images in the same order, numbered 1 to 3 with no gap.
3. **Given** that form, **When** the admin moves image 4 to the first place and saves, **Then**
   image 4 is the cover and the others keep their order after it.
4. **Given** that form with changes to the images, **When** the admin selects Cancel, **Then** the
   event's images are unchanged.
5. **Given** an event with five images, **When** the admin removes one and adds another in the
   same edit and saves, **Then** the event has five images, the new one where the admin put it.
6. **Given** another admin added or removed one of the event's images after this form was opened,
   **When** this admin saves a new order, **Then** the order is refused because the images changed,
   nothing is changed, and the form shows the event's current images to try again.
7. **Given** a cancelled event, **Then** its images cannot be added, removed, or reordered, through
   the API or the Admin app, and are still shown.
8. **Given** an event with images and no orders, **When** an admin deletes the event, **Then** its
   images are deleted with it.

---

### User Story 4 - Customers See the Images on Event Cards (Priority: P2)

On the Events list, each event that has images shows them at the top of its card, spanning the
card's full width, rotating every 5 seconds with arrows, the same way as the event page. Selecting
the image opens the event, as selecting its name does. Events without images look as they do
today.

**Why this priority**: It helps customers choose an event before opening it, but the event page
(US2) already shows the images.

**Independent Test**: Open the Events list with one event of three images, one of one image, and
one of none, and confirm each card shows its own images, rotation, and arrows, and that the event
without images looks as it does today.

**Acceptance Scenarios**:

1. **Given** the Events list, **When** an event has three images, **Then** its card shows its
   cover across the full width of the card, above the event's name, with "1 of 3" and previous and
   next arrows.
2. **Given** that card, **Then** it moves to the next image every 5 seconds and wraps around,
   pauses while the pointer is over one of its arrows or one has keyboard focus, and has its own
   Pause/Play button, as on the event page. Pausing one card does not pause the others.
3. **Given** two cards with images, **Then** each rotates on its own; using one card's arrows
   does not change the other.
4. **Given** a card with images, **When** the customer selects the image, **Then** the event page
   opens. Selecting an arrow flips the image and does not open the event.
5. **Given** an event with one image, **Then** its card shows the image with no arrows, no
   Pause/Play button, and no movement. **Given** an event with no images, **Then** its card looks
   exactly as it does today.
6. **Given** a long list of events with images, **Then** the event names, times, and prices appear
   without waiting for any image; images are loaded only for the cards on or near the screen, and
   a card that scrolls away stops turning and lets go of its images.

---

### User Story 5 - A Customer Views an Image Full Screen (Priority: P2)

On the event page, a customer selects the image in the gallery. It opens full screen: the image
covers the whole window, as large as fits without cropping, over a dark backdrop, with previous
and next arrows and a close button. Esc or the close button returns to the event page, where the
gallery shows the last image viewed.

**Why this priority**: A closer look helps, but the galleries already show the images.

**Independent Test**: On an event page with three images, open image 2 full screen, flip to image
3 with the arrow and with the right arrow key, close with Esc, and confirm the gallery shows image
3 and focus is back on the gallery.

**Acceptance Scenarios**:

1. **Given** the event page gallery showing image 2 of 3, **When** the customer selects the image,
   **Then** image 2 is shown full screen over a dark backdrop, covering the whole window, the
   whole image visible, with "2 of 3".
2. **Given** full screen, **When** the customer selects the next arrow, or presses the right arrow
   key, **Then** image 3 is shown; the previous arrow or left arrow key goes back; both wrap around.
3. **Given** full screen, **Then** the image does not change on its own.
4. **Given** full screen, **When** the customer selects the close button or presses Esc, **Then**
   it closes, the gallery shows the image last viewed, and keyboard focus returns to the gallery
   image they opened it from.
5. **Given** full screen and a keyboard user, **When** they press Tab repeatedly, **Then** focus
   moves only among the close button and the arrows, never to the page behind.
6. **Given** an event with one image, **Then** full screen shows it with the close button and no
   arrows.
7. **Given** a phone-width screen, **Then** full screen fills the screen and the close button and
   arrows are at least 44 by 44 pixels.

---

### Edge Cases

- **Type by content**: A JPG renamed `.png`, or sent with the wrong type, is accepted as the JPG it
  is, and served as a JPG. A file whose name or claimed type says JPG but whose content is not a
  picture is refused.
- **Other picture formats**: GIF, SVG, HEIC, AVIF, BMP, and TIFF are refused, even though some
  browsers can show them. SVG in particular can carry scripts.
- **A picture that is damaged after its first bytes**: The Backend checks the file's signature,
  reads its size in pixels from its header, and walks its segments or chunks, but does not decode
  the picture. A file whose segments or chunks run past the end of the file is refused as not a
  picture. A file that is well formed but damaged inside its picture data is stored, and browsers
  show it as an image that could not be loaded, the same as an image that fails to download.
  Removing it fixes it.
- **Animated pictures**: An animated PNG or an animated WebP is refused as not an accepted
  picture, like a GIF. Only still pictures are shown (spec Out of Scope).
- **Data hidden after the picture**: Some phones add a second picture or a short video after the
  main JPG, with its own location. Everything after the end of the main picture is dropped.
- **Several pictures chosen at once**: The admin may choose several files in one go. If that would
  make more than five, the form adds what fits and names the files it left out.
- **An image that cannot be loaded**: If one image fails to download, its place shows "Image
  unavailable" and the gallery keeps working with the others.
- **Slow images**: Until an image arrives, its place is kept with a plain placeholder of the same
  size, so the page does not jump.
- **Session ends**: Images are loaded with the signed-in customer's access, like everything else.
  If the session has ended, the page's other content sends the customer to sign in, as today.
- **Pointer leaves an arrow and returns**: Each time the pointer leaves an arrow, the gallery waits
  a full 5 seconds before moving on.
- **Touch screens**: There is no hover. Tapping an arrow flips the image; the gallery keeps
  rotating. Swiping is not offered.
- **Full screen and rotation**: While full screen is open, the gallery behind it does not move.
- **Event deleted while viewed**: If an event is deleted while a customer is viewing it, images
  already shown stay until the customer leaves the page; images not yet loaded show "Image
  unavailable". The page otherwise behaves as it does today for a deleted event.
- **Image metadata**: Location, camera, and other descriptive metadata are removed before a picture
  is stored. A JPG keeps only its orientation, so a phone photo taken sideways still shows upright.
- **Huge pictures in small files**: A picture of, say, 30,000 × 30,000 pixels can be a small file.
  It is refused by its size in pixels, whatever its size in bytes.
- **Order of an image added in the same save as a reorder**: New images are placed where the admin
  put them in the Images control, not only at the end.

## Requirements *(mandatory)*

### Functional Requirements

**Storing images**

- **FR-001**: An event MUST have from 0 to 5 images, in an order. The first image is the event's
  cover.
- **FR-002**: Only admins MAY add, remove, or reorder an event's images. Any signed-in user who
  may see the event MAY see its images.
- **FR-003**: The Backend MUST accept only JPG, PNG, and WebP pictures, deciding from the file's
  content, not from its name or the type it was sent with. Any other file MUST be refused with the
  standard error shape and its own stable code, and nothing stored. An accepted image is always
  served as the type its content shows.
- **FR-004**: The Backend MUST refuse an image larger than 5 MB (5,242,880 bytes) with its own
  stable code, storing nothing. An image of exactly 5,242,880 bytes is accepted.
- **FR-005**: The Backend MUST refuse an image that would give an event more than 5 images with its
  own stable code, and an event MUST never have more than 5 images, including when images are added
  at the same moment by several requests.
- **FR-006**: An added image MUST go after the event's existing images. One image is added per
  request.
- **FR-007**: Removing an image MUST close the gap: the other images keep their order and are
  numbered 1 to n with no gap.
- **FR-008**: An admin MUST be able to set the order of an event's images by naming every one of
  them in the new order. A new order that does not name exactly the event's current images (because
  another change was made meanwhile) MUST be refused with its own stable code, changing nothing.
- **FR-009**: Images MUST be numbered 1 to n with no gap and no repeat after any combination of
  adds, removes, and reorders, including at the same moment.
- **FR-010**: A cancelled event's images MUST NOT be added, removed, or reordered; the refusal is
  the one a cancelled event already gives for any change (`005`). They are still shown.
- **FR-011**: Deleting an event MUST delete its images. (An event with orders still cannot be
  deleted, `005`.)
- **FR-012**: Wherever the API returns an event, it MUST list the event's images in order, each
  with an identifier, its position, its type, and its size, and never the image content itself.
- **FR-013**: An image's content MUST be available only to a signed-in user with a valid access
  token, like every other API response (Constitution V). There is no public link to an image.

**Admin app**

- **FR-014**: The Admin app's Schedule event and Edit event forms MUST have an Images control that
  lets the admin add pictures (choosing one or several files at once), see a preview of each in
  order with the first marked "Cover", move each earlier or later, and remove each.
- **FR-015**: Image changes in the form MUST take effect when the form is saved, together with the
  event's other changes; Cancel MUST leave the event's images unchanged.
- **FR-016**: The Images control MUST show the limits (up to 5; JPG, PNG, or WebP; up to 5 MB each)
  and MUST refuse a file over a limit before sending, naming the file and the limit, as a
  convenience only. The Backend decides (FR-003 to FR-005).
- **FR-017**: A Backend refusal of an image change MUST be shown as an explicit error naming the
  picture and the reason, and the form MUST keep every value and every picture change not yet
  saved, so that saving again completes the rest without repeating what was saved: no picture is
  added twice and no event is created twice (Constitution IV).
- **FR-018**: When a new event, its seating, and its ticket types are all saved but one of its
  pictures is refused or cannot be sent, the Admin app MUST say the event was created and name the
  pictures not added, and the form MUST become the edit form of that new event, showing what was
  saved and keeping the pictures not yet added, so that saving again changes only that event. When
  the seating or ticket types are refused, the form MUST behave as it does today (`008`), keeping
  every value including the chosen pictures, and no picture is sent.
- **FR-019**: The Admin app's event page MUST show the event's images the same way the customer's
  event page does (FR-021 to FR-031), so admins see what customers see.

**Customer app**

- **FR-020**: Each event card on the Events list MUST show the event's images, cover first, at the
  top of the card, spanning the card's full width. Selecting the image MUST open the event page.
- **FR-021**: The event page MUST show the event's images, cover first, at the top of the page,
  spanning the full width of the app.
- **FR-022**: With two or more images, each gallery MUST show the next image every 5 seconds, and
  the first after the last.
- **FR-023**: With two or more images, each gallery MUST have previous and next arrow buttons on
  the left and right sides of the image. They flip to the previous or next image at once, wrap
  around, and restart the 5-second wait.
- **FR-024**: Apart from its Pause/Play button (FR-038), a gallery MUST pause its automatic change
  only while the pointer is over one of its arrow buttons, or while an arrow or, on the event page,
  the image that opens full screen has keyboard focus, and MUST resume 5 seconds after that ends.
  Nothing else pauses it: not the pointer over the image, not anything else on the page.
- **FR-025**: When the customer's device asks for reduced motion, the galleries MUST NOT change
  images on their own and show no Pause/Play button; the arrows still work.
- **FR-026**: With two or more images, each gallery MUST show the position of the shown image in
  words, such as "2 of 5".
- **FR-027**: With one image, a gallery MUST show it with no arrows, no position, no Pause/Play
  button, and no automatic change. With no images, there MUST be no gallery: the card and the page
  look as they do today.
- **FR-028**: Every gallery and full-screen control MUST have an accessible name, a target of at
  least 44 by 44 pixels, a visible keyboard focus, and work by keyboard. Each image MUST have a text
  alternative naming the event and the image's position, such as "Season Opener, image 2 of 5".
  On an event card, the image's link duplicates the card's title link, so it is hidden from
  assistive technology and from the Tab order (FR-020); the card's gallery is still labeled
  "Images of {event}" and its arrows name the event.
- **FR-029**: On the event page, selecting the image MUST open it full screen: covering the whole
  window over a dark backdrop, showing the whole image as large as fits, with previous and next
  arrows (with two or more images), the position, and a close button. Esc and the close button
  close it; the left and right arrow keys flip. It MUST NOT change images on its own.
- **FR-030**: While full screen is open, keyboard focus MUST stay within it. On closing, the
  gallery MUST show the image last viewed, and focus MUST return to the control that opened it.
- **FR-031**: An image that is loading, or that cannot be loaded, MUST keep its place with a plain
  placeholder of the same size; one that cannot be loaded MUST say "Image unavailable". Neither
  stops the gallery or the rest of the page.
- **FR-032**: The Events list MUST show every card's text without waiting for images, and MUST
  load images only for cards on or near the screen, and only the image shown and the next one.

**Both apps**

- **FR-033**: The galleries, full screen, and Images control MUST take their look from the shared
  theme (Constitution VII), and MUST work at phone width without sideways scrolling.
- **FR-034**: The demo data MUST include an event with several images, one with one image, and one
  with none, made without any copyrighted picture.

**Storing images (added after review round 1)**

- **FR-035**: Before storing a picture, the Backend MUST remove its location, camera, and other
  descriptive metadata: in a JPG, its Exif, XMP, Photoshop (IPTC), multi-picture (`MPF`), and
  comment segments; in a PNG, its `eXIf`, `tEXt`, `iTXt`, `zTXt`, and `tIME` chunks; in a WebP,
  its `EXIF` and `XMP ` chunks. It MUST also drop anything after the end of the main picture (after
  a JPG's end marker, after a PNG's `IEND`, or past a WebP's declared length), where phones store
  secondary pictures and videos with their own metadata. A JPG's orientation MUST be kept, so it is
  shown the same way up. The picture itself is not changed. The size limit (FR-004) applies to the
  file as sent.
- **FR-036**: The Backend MUST refuse a picture wider or taller than 16,384 pixels, or of more than
  40,000,000 pixels in all, with its own stable code, storing nothing. A file whose size in pixels
  cannot be read from its header, or whose segments or chunks run past the end of the file, is
  refused as not a JPG, PNG, or WebP picture (FR-003).
- **FR-037**: The Backend MUST refuse an animated PNG or animated WebP as not an accepted picture
  (FR-003), storing nothing.

**Galleries (added after the PR review)**

- **FR-038**: Each gallery that changes images on its own (two or more images, reduced motion not
  asked for) MUST have a Pause/Play button. It starts as Pause, since the gallery turns by default.
  Pause MUST stop the automatic change until Play is pressed, whatever the pointer or focus does;
  Play MUST resume it, with the next image 5 seconds later. The arrows MUST still work while paused.
  Each gallery has its own button and state; a new page starts turning again. The button's
  accessible name says what it will do and for which event ("Pause images of Season Opener",
  "Play images of Season Opener"). The full-screen view does not change on its own, so it has no
  such button.
- **FR-039**: On the Events list, a card that is neither on nor near the screen MUST stop changing
  images and MUST let go of its loaded images, loading them again when it comes back.

### Key Entities

- **Event image**: one picture of one event: its content, its type (JPG, PNG, or WebP), its size in
  bytes, and its position among the event's images. Belongs to exactly one event and goes when the
  event is deleted. Its content never changes; a different picture is a new image.
- **Event**: gains its ordered list of images (0 to 5). The first is its cover.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of stored images are JPG, PNG, or WebP by their content, at most 5 MB, within
  16,384 pixels a side and 40 megapixels, and free of location and camera metadata, and no event
  ever has more than 5 images, including when 10 images are sent for one event at the same moment.
- **SC-002**: 100% of refused images leave nothing stored, and the Admin form keeps every value
  and every unsaved picture; saving again never stores a picture twice or creates the event twice.
- **SC-003**: An admin can schedule an event with three images in one submission of the form.
- **SC-004**: On both galleries, an image stays shown for 5 seconds (within half a second) before
  the next, except while an arrow is pointed at, or an arrow or the event page's full-screen image
  button has keyboard focus, never while paused with the Pause/Play button, and never under reduced
  motion.
- **SC-005**: Every gallery and full-screen action (flip, pause, play, open, close) can be done with
  the keyboard alone, every control is at least 44 by 44 pixels, and closing full screen returns
  focus to where it was opened in 100% of cases.
- **SC-006**: On an Events list of 20 events with 5 images each, the first view loads at most 2
  images per card on or near the screen, and every card's text shows before any image arrives.
- **SC-007**: 100% of events without images look and behave as they did before this feature.

## Assumptions

- The decisions in Clarifications were made by Mahdi, the feature owner, on 2026-10-12, including
  the reduced-motion behavior (FR-025) and, after review round 1, metadata removal; after the PR
  review (2026-10-13) he added the Pause/Play button (FR-038).
- With the Pause/Play button, the galleries meet WCAG 2.2.2 Pause, Stop, Hide (Level A): every
  gallery that changes on its own has a lasting way to pause it (research R11).
- A paused gallery is not remembered: each page, and each card, starts turning again.
- Text alternatives are generated from the event's name and the image's position. Admins do not
  write their own descriptions in this feature.
- Galleries fill their area and may crop the edges of a picture whose shape differs; full screen
  always shows the whole picture.
- Pictures are stored and shown as uploaded except for their metadata: not resized and not
  re-encoded. Location, camera, and text metadata are removed; a JPG keeps only its orientation
  (research R17). Smaller copies for cards are not made; the 5 MB limit and loading only what is on
  screen keep pages usable (research R14).
- 5 MB means 5 × 1024 × 1024 = 5,242,880 bytes.
- An image is something any signed-in user who can see the event may see, so it is not secret
  after it reaches the browser.
- A changed order is refused if any other admin changed the event's images first; admins rarely
  edit the same event's pictures at the same moment, so asking them to look again is enough.

## Out of Scope

- Admin-written descriptions or captions for images.
- Cropping, rotating, resizing, or editing images, and making smaller copies.
- Drag-and-drop reordering (buttons are used).
- Swiping between images on touch screens.
- The browser's own full-screen mode that hides its toolbars (the full-screen view covers the
  window).
- Images for venues, tiers, or orders, and video or animated images (animated PNG and WebP are
  refused, FR-037).
- The Ticket Booth app, which does not show events.
