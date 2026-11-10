# Specification Quality Checklist: Hide Past Events

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-11-09
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

- The spec names the event list's `includePast` parameter and `endsAt`, because the issue asks for
  them by name and the parameter is the feature's interface to every client (Constitution I puts it
  in the contract in this PR). How the Backend filters, which clock it reads, and how the apps hold
  the toggle in the address are left to the plan.
- Every open question took a recommended answer, recorded in Clarifications (Session 2026-11-09) as
  open to review: the Backend filter and who may ask for past events, the toggle kept in the address
  rather than the browser, which Admin pages get it, My tickets' Past section without entry codes,
  the ended notice on a past event's page, the Ended label worked out by each app, and the order.
