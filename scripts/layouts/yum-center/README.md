# KFC Yum! Center section plan

Spec 038 (research R5, R18; FR-033; tasks T043–T045). `plan.json` is the section plan for the KFC
Yum! Center, 1 Arena Plaza, Louisville, KY. `../generate-yum-center.mjs` turns it into the four
layout files the demo data loads:

| File (`backend/src/scripts/layouts/`) | Layout            | Seats  | Where the total comes from     |
| ------------------------------------- | ----------------- | ------ | ------------------------------ |
| `yum-center-basketball.json`          | Basketball        | 22,090 | The venue's published capacity |
| `yum-center-end-stage.json`           | End-stage concert | 17,500 | The venue's published capacity |
| `yum-center-center-stage.json`        | Center stage      | 19,500 | **Our estimate**               |
| `yum-center-wrestling.json`           | Wrestling (ring)  | 18,000 | **Our estimate**               |

```sh
node scripts/layouts/generate-yum-center.mjs           # rewrite the four files
node scripts/layouts/generate-yum-center.mjs --check   # exit 1 if a committed file is stale
node --test scripts/test/layouts.test.mjs              # the generator's test (also in npm test)
```

Edit `plan.json`, run the generator, and commit the plan and the four files together. The files are
generated, so Prettier skips them (`.prettierignore`); the test fails when they are stale.

## No ticket seller's data

Nothing here comes from Ticketmaster or any other ticket seller's site, map or data (spec D6,
FR-033). Ticketmaster's terms forbid robots and data mining, and its map data is undocumented. The
plan was written by hand from the venue facts below, and everything else is ours.

## What is taken from public venue facts, and what is our estimate

**From the venue's public information** (its published capacities and seating chart facts, as
recorded in research R18):

- Capacities: basketball 22,090; end-stage concert 17,500.
- Section numbers: lower bowl 101–120, terrace 209–212, upper bowl 301–330 (54 sections).
- Row letters: lower rows start at D and run D–Z, then AA–HH where a section goes that deep (rows
  A–C are floor seats that are not part of these layouts); upper rows A–W.
- Seat 1 is on the right as you face the court or the stage.
- End-stage concert: sections 101–103, 119–120, 301–306 and 325–330 are not used; 104 and 118 are
  partly used; floor sections 1–5.

**Our estimate**, a clean geometric approximation and not traced from any chart:

- The bowl's shape and size. Map units are about a foot (`size` 500 × 420, `y` grows downward). The
  floor is a rounded rectangle (a superellipse, exponent 3) 170 × 90 around a 94 × 50 court; the
  lower ring's rows are 2.75 apart, the upper ring's 2.3. Each section is bounded by two lines
  normal to the bowl, so every row is a smooth arc, written as one seat run with a `bend` (R5).
- Where each section sits: positions in "bowl degrees", the share of the ring's length, clockwise
  from the middle of the east end (0) through the south sideline (90), the west end (180) and the
  north sideline (270). Sections are numbered clockwise; 120/101 meet at the west end, 110/111 at
  the east end, 330/301 and 315/316 likewise.
- How deep each section is: the sidelines 104–108 and 113–117 run D–HH (31 rows), the ends and
  corners D–Z (23 rows); the terrace 209–212 sits behind 109–112 with rows A–F (6 rows).
- **Seats per row.** The venue publishes no row counts. The generator gives each row seats in
  proportion to its length less an aisle (3 units a section in the lower ring and terrace, 5 in the
  upper), weighted by the plan's `seatPitch` (1.8 lower and terrace, 2.6 upper), then scales them so
  the bowl holds exactly 22,090, with every seat 1.5 to 3 apart. That gives 10,400 lower, 844
  terrace and 10,846 upper seats, about 1.6 apart below and 2.3 apart above.
- How much of 104 and 118 the end stage leaves: we keep three quarters of each (the part away from
  the stage).
- The floor objects (court, stage, ring and entrance ramp) and every floor section: their places,
  sizes and rows (numbered 1, 2, …, rows 2.75 apart, seats 1.6 to 2.4 apart). The generator fills the
  floor sections with whatever the layout's total needs beyond the bowl seats it keeps: End-stage
  concert 1,504 floor seats, Center stage 1,422, Wrestling 548.
- **Center stage, about 19,500**: the whole bowl but 110–111 and 312–319 at the east end (the sound
  and lighting desk and the spotlight and camera positions), and floor sections 1–4 on the four sides
  of the stage.
- **Wrestling (ring), about 18,000**: the entrance stage and ramp at the west end take 101–103,
  118–120, 301–304 and 327–330; floor sections 1–3 on the ring's other three sides. The demo's WWE
  event puts rows S–W of 305–310 and 320–325 off sale (R18), so the layout keeps those sections
  whole.
- Levels: Basketball's four are R18's (Courtside = rows D–G of 104–108 and 113–117; Lower sideline
  = their other rows and the terrace 209–212; Lower end = 101–103, 109–112, 118–120; Upper =
  301–330). The other three layouts have Floor (1), Lower (2, with the terrace) and Upper (3).
  The colors are ours.

## Choices where the facts did not settle it

- **The stage end's middle.** R18's level table makes the bowl symmetric about the 120/101 and
  110/111 boundaries (sidelines 104–108 and 113–117). The published end-stage cut is symmetric
  about section 101's middle instead (119–120 and 102–103 removed on either side of 101, with 104
  and 118 partial). We keep R18's axis, put the stage in the middle of the west end, and apply the
  published cut as published, so it reaches one section further on the 101–104 side.
- **The terrace** is placed behind 109–112, matching its numbers, at the end opposite the stage.
- **Which lower sections go to HH**: the sidelines. The ends stop at Z, which leaves room for the
  terrace at the east end.

## Plan fields

- `center`, `size`: where the floor's middle sits on the map, and the map's size.
- `bowl`: the floor's half length and half width, the superellipse exponent, how finely it is
  sampled, and `seats`, the whole bowl (Basketball, which has no floor sections).
- `limits`: the gap between section outlines and the allowed seat spacing in the bowl.
- `rings`: `lower`, `terrace`, `upper`; each with its front depth (from the floor's edge), row
  spacing, seat spacing, aisle, the depth at which its bowl degrees are measured, its row labels
  (`"D-Z,AA-HH"`) and its sections (`name`, `from`, `to` in bowl degrees, and `rows` when not the
  ring's).
- `floorSeating`: row spacing, edge, and seat spacing in floor sections.
- `layouts`: each file's name, total, floor object (relative to `center`), levels, `bowlLevels`
  (rules by section ranges, and by rows), the sections it `remove`s, `partial` sections (`keep`
  the part `after` or `before` the share `at` of the section, clockwise), and its `floorSections`
  (`center`, `facing` the stage `N`/`S`/`E`/`W`, `width`, `rows`).

Before writing, the generator checks each file against the contract's `LayoutFile` schema and R5's
other limits, and that every seat, as the Backend expands a run, lies inside its own section and in
no other, and not on the floor object.
