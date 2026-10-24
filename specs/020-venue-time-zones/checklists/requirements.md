# Specification Quality Checklist: Venue Time Zones

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-10-24
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- The spec names the eight US zones by their standard (IANA) names, "EDT"-style abbreviations,
  and America/New_York for existing venues. These are Mahdi's product decisions and the user-visible
  result (Clarifications), not implementation choices. How the zone is found from the address,
  where it is stored, and how times travel through the API are left to the plan.
- Four decisions are Mahdi's (2026-10-24): the zone is worked out from the address; existing
  venues get Eastern; events keep local times on a zone change, refused when tickets are sold and
  re-checked against the 60-minute rule; a skipped time is refused and a repeated time is asked
  about. Decided in this spec and marked so in Clarifications: the state rule for addresses saved
  anyway (research R3) and the admin correction (R4). Proposed here and confirmed by Mahdi
  (2026-10-24): "sold tickets" meaning any order in any state (R8), the `geo-tz` dependency (R1),
  filter days meaning days at the venue with `fromDate`/`toDate` (R15), and times that belong to
  no event shown in the viewer's zone, labelled (R12). No open question remains.
- The DST examples use 2027 dates (spring forward Mar 14, fall back Nov 7), so they stay in the
  future while the feature is built and tested.
- SC-002 names four device zones; the plan makes them a repeatable test run (research R20).
