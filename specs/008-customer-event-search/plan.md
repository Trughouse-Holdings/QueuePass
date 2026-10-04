# Implementation Plan: Customer Event Search and Usability

**Branch**: `008-customer-event-search` | **Date**: 2026-10-03 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/008-customer-event-search/spec.md`

## Summary

- **Filters** on the Customer Events page (name, venue, dates, hide cancelled), applied through
  `004`'s existing search, held in the page address, with invalid parameters dropped and two
  empty states (research R1).
- **The Admin app's look**, copied into the Customer app's own stylesheet, with contrast checked
  by a test (R2).
- **Event cards** on the Events and venue pages, from the list's own data; tier prices and
  status badges on the event page (R3).
- **Phone width**: one column below 640 pixels, 44-pixel targets, a seat map that scrolls inside
  its own box (R4).
- **Seat states** that differ by glyph, border, and pattern, not color alone; visible focus (R5).

**No contract, Backend, or database change** (spec FR-012).

## Technical Context

**Language/Version**: TypeScript 5.7 (strict) on Node.js 22 LTS

**Primary Dependencies**: unchanged. **No new dependencies** (React Router's `useSearchParams`
for the address; plain CSS).

**Storage**: none changed.

**Testing**: Customer app Vitest + React Testing Library, plus a stylesheet contrast test. Phone
width and grayscale checked in a browser (quickstart E4, E5).

**Constraints**: every `003`, `006`, and `007` behavior unchanged (FR-011); no per-card requests;
WCAG 2.1 AA contrast; no sideways page scrolling at 375 pixels.

**Scale/Scope**: 1 stylesheet, 1 filter bar, 1 card component, 5 pages touched, 0 Backend files.

## Constitution Check

Evaluated against constitution **v2.2.1**.

| Principle | Pre | Post | Evidence |
|---|---|---|---|
| **I. API-Only, Contract First** | PASS | **PASS** | Only existing operations; contract stays 1.5.0. |
| **II. One Repo, One Command** | PASS | **PASS** | No new service, variable, or dependency. |
| **III. Spec-Driven, by PR** | PASS | **PASS** | Spec, plan, implementation PRs in order, stacked on `007`. |
| **IV. Server-Authoritative, DB-Guaranteed** | PASS | **PASS** | No rule moves to the app; "Hide cancelled" only filters what is shown. |
| **V. Sign-In Everywhere** | PASS | **PASS** | No new route or role; the same customer-only app. |
| **VI. Test-First, Real Database** | PASS | **PASS** | UI tests precede each change; no Backend code, so no new database tests are needed. |
| **VII. Function Over Finish** | PASS | **PASS** | Usability with measurable targets (width, target size, contrast, non-color states); the Admin app's existing look is reused, with no new branding or design. Roadmap row widened in constitution 2.2.1. |
| **VIII. Staged Simplicity** | PASS | **PASS** | No shared style package, no design system, no theme switch. |

## Project Structure

```text
specs/008-customer-event-search/
├── spec.md, plan.md, research.md (R1–R6), data-model.md, quickstart.md (E1–E5), tasks.md
├── checklists/requirements.md
└── contracts/README.md

customer-app/src/
├── + styles.css                       # copied Admin tokens and components + Customer rules
├── ~ main.tsx                         # imports styles.css
├── ~ App.tsx                          # top bar and nav links with the Admin classes
├── + filters.ts                       # address <-> filters, validation, query building
├── components/+ EventFilters.tsx, + EventCard.tsx, ~ SeatPicker.tsx, ~ GetTickets.tsx
└── pages/~ EventList.tsx, ~ VenueDetail.tsx, ~ EventDetail.tsx, ~ MyTickets.tsx, ~ VenueList.tsx
customer-app/test/+ filters.test.tsx, + cards.test.tsx, + contrast.test.ts;
                  ~ browse.test.tsx, ~ seats.test.tsx (cards and seat glyphs)
~ README.md
```

## Complexity Tracking

| Item | Why needed | Simpler alternative rejected because |
|---|---|---|
| A copied stylesheet | FR-010 reuses the Admin look without touching the shared surface | A shared style package needs a build change and every member's approval for each tweak. |
| A seat map that scrolls inside its own box | A 200-seat row cannot fit 375 pixels at 44 pixels a seat | Wrapping rows makes a seat map unreadable. |
| A contrast test over the stylesheet | FR-007 must be checked, not eyeballed | Manual checks drift as tokens change. |
