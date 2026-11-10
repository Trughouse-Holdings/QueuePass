# Feature Specification: Purchase Rate Limits

**Feature Branch**: `026-purchase-rate-limits-spec`

**Created**: 2026-11-02

**Status**: Draft

**Issue**: [#56](https://github.com/Trughouse-Holdings/QueuePass/issues/56) (limit how fast and how
often anyone can try to buy tickets). Related, not part of this feature:
[#58](https://github.com/Trughouse-Holdings/QueuePass/issues/58) (only the Customer app may buy).

**Input**: User description: "026" (the roadmap entry reserved for #56 in Constitution 3.6.3). From
the issue: stop any one buyer, person or bot, from grabbing an unfair share of tickets, or overloading
QueuePass, when a popular event goes on sale. Attempts to buy, and to hold seats, are limited in how
fast and how often they can be made; a customer who hits a limit is told plainly, and when they can
try again; ordinary customers never notice; the limits apply however the API is called; QueuePass
stays responsive for everyone else while someone is hitting them.

## Context

Builds on `006` (customers get tickets; one confirmation places at most one order, so the Customer
app may repeat it safely, "Check again"), `015` (seats a customer picks are held for 5 minutes with
**Reserve seats**, more can be added to the hold, and they can be released; a seat released by a
customer can't be held again by that customer for 2 minutes; logging out releases every hold), and
`016` (an event may limit how many tickets each customer holds, across all their orders).

Today:

- Apart from `016`'s per-event ticket limit, nothing limits how quickly or how often anyone can try
  to buy tickets or hold seats. A script with a customer's sign-in can send hundreds of orders or holds
  a second, each one doing the full work of an order, while real customers wait behind it.
- Buying and holding seats both need a signed-in customer account (`006`, `015`).

This feature gives every customer account two **allowances**, one for **buy attempts** and one for
**seat-hold attempts**: at most **10 a minute, and no more than 3 in any 5 seconds**, each. An attempt
over an allowance is refused at once, changes nothing, and says when the account can try again; the
Customer app shows that as a countdown and then lets the customer try again. Customers buying at a
person's pace never reach the limits.

No earlier requirement changes: every rule of `006`, `015`, and `016` still applies to the attempts
that are let through. Constitution 3.6.3 reserves the number; no principle changes.

## Clarifications

### Session 2026-11-02

Mahdi took the decisions marked "decided by Mahdi". Every other question below took the
recommended answer, written unattended and recorded here as **recommended answer, open to review**,
so the team can overturn it in review of the spec PR.

- Q: Limited per what: account, network address, event, or a mix? → A: **Per customer account**
  (buying and holding seats already need sign-in). **No network-address limit** (decided by Mahdi,
  1) (FR-001, FR-005).
- Q: What numbers? → A: Each account at most **10 buy attempts a minute and 10 seat-hold attempts a
  minute**, separate allowances, and **no more than 3 in any 5 seconds** for each (decided by Mahdi,
  2) (FR-002).
  _Amended 2026-11-09 by spec `033` (#135), FR-008, decided by Mahdi on 2026-11-09: seat holds have
  their own allowance, 30 a minute and 10 in any 5 seconds, since each seat click is a hold; buying
  keeps 10 and 3._
- Q: Is anyone exempt (admins, tests)? → A: **No one.** The limits apply to every caller of the API.
  Tests and demos set their own numbers through configuration kept in the repository, rather than
  skipping the check, and nothing has to be set by hand (decided by Mahdi, 3; Constitution II)
  (FR-006, FR-017, FR-018).
- Q: What does a customer over a limit see? → A: **"Too many tries. You can try again in N
  seconds."** The button stays disabled with a **countdown**, then works again. Seats already held
  stay held; nothing they had is lost (decided by Mahdi, 4) (FR-007, FR-011 to FR-014).
- Q: What counts as an attempt? → A: **Every buy or seat-hold request from a signed-in customer that
  gets past sign-in and the role check, whatever its outcome**: placed or held, refused by any
  existing rule (sold out, seat taken, the ticket limit, sales closed, …), malformed, or naming an
  unknown event (recommended answer, open to review). Counting only successes would let a script
  hammer refusals (a sold-out tier, a taken seat) for free, and those still cost QueuePass the work of
  an order. Adding seats to a hold already held is a hold attempt; many seats in one request are one
  attempt (FR-001, FR-003).
- Q: Does an attempt refused for the limit count? → A: **No** (recommended answer, open to review).
  Pressing again early then never makes the wait longer, and the wait the customer is told stays
  exact; a script gets exactly its allowance and no more either way (FR-003, FR-008).
- Q: Does releasing seats count toward the hold allowance? → A: **No; releasing is never limited**
  (decided by Mahdi, 6, confirmed 2026-11-02). It only gives seats back, which is what the limits are for;
  logging out must always release (`015` FR-008); and an ordinary customer pressing **Release** on
  three or four held seats one after another would otherwise meet the 3-in-5-seconds limit. Releases
  still do some work; protecting every operation from floods is not this issue (FR-004).
- Q: Does a repeat of the same confirmation (`006`'s request id, "Check again") count? → A: **Yes,
  like any request** (recommended answer, open to review). A repeat is still a request QueuePass
  must look up; a person presses Check again far less often than the limit; and when it is refused,
  the next press still repeats the same confirmation, so no second order is possible (FR-003,
  FR-014).
- Q: Fixed windows (each clock minute) or rolling ones? → A: **Rolling**: "no more than 3 in any 5
  seconds" and 10 in any 60 seconds, each attempt counting for exactly 5 and 60 seconds from when it
  was handled (recommended answer, open to review). Fixed windows would let an account make 6
  attempts within a moment across a window's edge, against Mahdi's "any 5 seconds", and make the wait
  depend on the clock rather than on the account's own attempts (FR-002).
- Q: One allowance per event, or for all events? → A: **One per account for all events together**
  (recommended answer, open to review): a script spreading attempts over many events loads QueuePass
  just as much (FR-005).
- Q: Where are the counts kept, and what does a Backend restart do? → A: **In the running Backend,
  not with QueuePass's stored data; a restart forgets them**, and every account starts again with its
  whole allowance (decided by Mahdi, 5, confirmed 2026-11-02). Deciding a refusal without touching
  stored data is what keeps QueuePass responsive while an account is far over its allowance (the
  issue's last requirement); QueuePass runs one Backend, as `015`'s live seat map already relies on.
  This is a recorded deviation from Constitution IV, which asks for a database guarantee: Mahdi
  accepted it because the stack runs one Backend; what is given up is that a restart grants every
  account a fresh allowance, and that more than one Backend would multiply it. The plan records it in
  Complexity Tracking (FR-015; Assumptions).
- Q: How does a caller of the API learn the wait? → A: **A refusal with its own code, the wait as a
  whole number of seconds in the error, and the standard "retry after" signal** that HTTP clients
  and scripts understand (recommended answer, open to review). Status, code, and field names are in
  the plan (FR-008).
- Q: How does the Customer app show it? → A: (recommended answer, open to review) The message
  directly above the button it explains, announced once; N counts down each second without being
  announced each time, as `015`'s hold countdown is; only that kind's buttons are disabled (buying:
  Confirm order, Confirm purchase, Check again; holding: Reserve seats), and they stay focusable, as
  `015`'s unavailable seats do, so keyboard focus is never lost; Release, seat picking, and the hold's
  countdown keep working; "1 second", not "1 seconds" (FR-011 to FR-013).
- Q: Is a hold extended while its customer waits out a buy refusal? → A: **No** (recommended answer,
  open to review). The wait is at most 60 seconds, ordinary use never meets it, and extending holds on
  request would give a script a way to keep seats longer (Edge Cases).
- Q: How do tests and demos set their numbers, and which numbers do they use? → A: (recommended
  answer, open to review) **Two settings, attempts per minute and attempts per 5 seconds, one pair for
  both kinds**, with the defaults (10 and 3) in the repository's configuration, so the one-command
  start uses them with nothing set by hand. Backend tests about other features set large numbers in
  the test set-up, so their concurrency tests still send many orders at once; this feature's tests set
  the defaults; the browser-test stack sets the defaults itself, whatever a developer's own
  configuration says, which is the proof that ordinary journeys never meet the limits. A setting that
  is not a whole number of at least 1, or a 5-second number above the minute's, stops the Backend from
  starting; there is no "off" (FR-017, FR-018, SC-004).
- Q: How is it proved that the limits work and ordinary use is unaffected? → A: (recommended answer,
  open to review) Concurrency tests against a real database: many attempts from one account at the
  same moment, exactly 3 handled and the rest refused with nothing recorded; the rolling windows'
  boundaries to the millisecond on a test clock; another account buying while one is far over, with
  the refused attempts counted as doing no database work; and the earlier features' browser tests, plus
  this feature's own, run with the real numbers (SC-001 to SC-006).
- Q: What is logged? → A: **One line each time an account goes over**, with the account, the kind,
  and the wait, not one per refused request, so a flood cannot flood the logs; never a token
  (recommended answer, open to review) (FR-019).
- Q: Is "only the Customer app may buy" (#58) part of this? → A: **No**; it is its own issue. These
  limits apply to every caller of the API, whichever app (recommended answer, open to review).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - No One Account Can Flood Buying or Holding (Priority: P1)

When "Winter Gala" goes on sale, a script signed in as one customer account sends 50 orders in one
second, straight to the API. Three of them are handled like any order; the other 47 are refused at
once, each saying "Too many tries" and how many seconds to wait, and nothing of theirs is recorded.
The script keeps going: over the next minute no more than 10 of its orders are handled in total. The
same account's seat holds have their own allowance of the same size, counted separately.

**Why this priority**: the issue's first requirement, enforced where it cannot be bypassed.

**Independent Test**: from one account, send many buy attempts at once, then at a steady pace for
more than a minute, directly to the API; count which were handled and which refused, and what was
recorded. Repeat for seat holds, then for both kinds mixed.

**Acceptance Scenarios**:

1. **Given** an account that made no attempt in the last minute, **When** it sends 20 buy attempts
   at the same moment, **Then** exactly 3 are handled (each placed or refused by the ordinary rules)
   and 17 are refused as too many tries, with how long to wait, and nothing is recorded for them.
2. **Given** an account that made 3 buy attempts in the last 5 seconds, **When** it tries again 5
   seconds after the first of them, **Then** that attempt is handled.
3. **Given** an account that made 10 buy attempts in the last 60 seconds, spread so no 5 seconds held
   more than 3, **When** it tries again before 60 seconds have passed since the first of them, **Then**
   it is refused, with the seconds left until the first of them is a minute old; at exactly a minute
   it is handled.
4. **Given** an account that has used its whole buy allowance, **When** it tries to hold seats,
   **Then** that hold is handled (the allowances are separate), and the other way round.
5. **Given** two accounts, **When** one has used its allowance, **Then** the other's attempts are
   handled as if the first did not exist.
6. **Given** any customer account, **When** it calls the API directly rather than through the
   Customer app, **Then** the same allowances apply. (A caller without the customer role is refused
   for that, as today, and not counted.)
7. **Given** a refused attempt, **Then** no order, ticket, or hold is created, no seat is released,
   and the account's existing holds keep their seats and their end time.

---

### User Story 2 - A Customer Over a Limit Is Told When to Try Again (Priority: P1)

Alex has two seats held for "Winter Gala" and wants a third. On a busy on-sale every seat Alex picks
is taken by someone else first: each **Reserve seats** is refused as taken, the app drops that seat
from Alex's picks, and Alex quickly picks another and presses again. The fourth press within 5
seconds says "Too many tries. You can try again in 3 seconds." Reserve seats is disabled, and the
message counts down: 2 seconds, 1 second. Then the message goes away and Reserve seats works again.
Alex's two held seats, and the time left to confirm them, never changed, and **Confirm purchase**
worked throughout.

**Why this priority**: the issue's second requirement: told plainly, and told when.

**Independent Test**: in the Customer app, make a hold (or a buy) refused for the limit; read the
message, watch the countdown, check which controls are disabled and that nothing held was lost, and
try again when it ends.

**Acceptance Scenarios**:

1. **Given** a hold attempt refused as too many tries with a wait of N seconds, **When** the
   Customer app shows it, **Then** it says "Too many tries. You can try again in N seconds.", Reserve
   seats is disabled, and every pick, held seat, and entered value is kept.
2. **Given** that message, **When** each second passes, **Then** N goes down by one ("1 second" when
   it is 1); **When** it reaches 0, **Then** the message is removed and Reserve seats can be used.
3. **Given** a buy attempt (Confirm order or Confirm purchase) refused as too many tries, **Then** the
   same happens for the buying buttons, and the hold controls, Release, and seat picking keep working.
4. **Given** a hold's 5-minute countdown (`015`), **When** a refusal for the limit is shown, **Then**
   the hold's countdown carries on unchanged.
5. **Given** the outcome of a confirmation is unknown (`006`: "Check again"), **When** Check again
   is refused as too many tries, **Then** the app still says the outcome is unknown, shows the
   countdown, enables Check again when it ends, and no second order is ever placed.
6. **Given** the countdown is shown, **When** the customer reloads the page, **Then** the buttons are
   enabled again; a press before the wait is over is refused again with the seconds still left.

---

### User Story 3 - Ordinary Customers Never Notice, and Everyone Else Stays Responsive (Priority: P1)

Jordan buys tickets the usual way: chooses a tier, holds some seats, adds one, releases one, confirms,
then buys for a second event. Jordan never sees the limit. Meanwhile, a script on another account is
being refused hundreds of times a second; Jordan's pages and purchase take no longer than usual.

**Why this priority**: the issue's third and fifth requirements; limits that hurt real customers, or
that cost as much as the attempts they refuse, fail the issue.

**Independent Test**: walk the ordinary buying and holding journeys of `006`, `007`, `015`, and `016`
with the limits at their real values and see no refusal for the limit; while another account sends
attempts far over its allowance, buy with a second account and see it succeed, and see that the
refused attempts did no work on stored data.

**Acceptance Scenarios**:

1. **Given** the limits at 10 a minute and 3 in 5 seconds, **When** a customer goes through every
   ordinary buying and seat-holding journey at a person's pace, **Then** no attempt is refused as too
   many tries.
2. **Given** one account sending attempts far over its allowance, **When** another customer buys,
   **Then** the purchase succeeds, and every refused attempt was answered without reading or
   writing stored data.
3. **Given** releasing seats, logging out (which releases every hold), viewing events, availability,
   the live seat map, and My tickets, **Then** none of them is ever refused as too many tries, however
   often they happen.

---

### Edge Cases

- **Exactly at the boundary**: an attempt counts for exactly 60 seconds (and 5 seconds) from when it
  was made, and no longer; an attempt exactly 5 seconds after the first of 3 is handled.
- **Several tabs or devices**: they share the account's allowances. Each tab counts down only for
  refusals it received; another tab finds out when it tries.
- **A hold close to its end**: a buy refused for the limit does not extend the hold; the wait is at
  most 60 seconds, and a hold that runs out meanwhile ends as in `015`. Ordinary use never reaches the
  limit, so this needs a customer far faster than a person.
- **Repeat of a confirmation** (`006` "Check again", or any caller repeating a request id): it counts
  as an attempt, like any other; once handled, it returns the earlier order as today.
- **Malformed attempts** (missing fields, an unknown event, an invalid seat): they count, so a
  script cannot probe for free; the request is then refused for its own reason, as today.
- **Not signed in, or not a customer**: refused for that, as today, before the limit is looked at,
  and not counted.
- **Many seats in one hold**: one attempt, however many seats.
- **Adding seats to a held reservation**: a hold attempt, like the first hold.
- **Releasing seats**: never counted or refused, so a customer can always give seats back, and
  logging out always releases them (`015` FR-007, FR-008).
- **A refused attempt during the wait**: it does not count, so pressing again early never makes the
  wait longer; the wait told is still right.
- **The Backend restarts**: the counts start again from nothing; each account has its whole
  allowance (Assumptions).
- **The Backend's clock is set back** (for example by a time correction): an account is never kept
  waiting longer than 60 seconds, and the wait told never exceeds 60 seconds.
- **The device's clock is wrong**: the countdown measures elapsed time from the Backend's number of
  seconds, not the device's clock.
- **A wait longer than 5 seconds**: after 10 attempts in a minute, the wait can be up to 60 seconds;
  the message says so ("…in 47 seconds.").
- **Both allowances used at once**: each kind's buttons count down on their own.

## Requirements *(mandatory)*

### Functional Requirements

**The allowances (US1)**

- **FR-001**: The Backend MUST limit, for each customer account, attempts to **buy** (place an order)
  and, separately, attempts to **hold seats** (hold seats, including adding seats to a hold already
  held).
- **FR-002**: For each account and each of the two kinds, no more than **10** attempts MAY be
  handled in any 60 seconds and no more than **3** in any 5 seconds. An attempt counts toward each
  window from the moment it is handled until exactly 60 (or 5) seconds later, not including that
  moment.
  _Amended 2026-11-09 by spec `033` (#135), FR-008 (Mahdi's decision, 2026-11-09): for holds, 30 in
  any 60 seconds and 10 in any 5 seconds._
- **FR-003**: Every buy or hold request from a signed-in customer account MUST count as an attempt of
  its kind when it is handled, whatever its outcome: placed or held; refused by any rule of `006`,
  `007`, `015`, or `016`, or of any other feature (for example `025`); refused as malformed or for
  an unknown event; or a repeat of an earlier confirmation that returns the earlier order. A request refused for the limit MUST NOT count. A
  request refused because the caller is not signed in, or is not a customer, is refused as today and
  MUST NOT count.
- **FR-004**: Releasing seats (some, all of an event's, or all on logout), and every request that
  only reads (events, availability, seat maps and their live updates, My tickets), MUST NOT be counted
  or refused for the limits.
- **FR-005**: Each account MUST have one allowance of each kind for all events together, shared by
  all its sessions and devices, and applied however the API is called.
- **FR-006**: The limits MUST apply to every account, role, and caller; none is exempt.

**The refusal (US1, US2)**

- **FR-007**: An attempt over an allowance MUST be refused before anything else about it is checked
  or done: no order, ticket, or hold is created, no seat is released, and the account's existing holds
  keep their seats and end times.
- **FR-008**: The refusal MUST say "Too many tries. You can try again in N seconds." ("1 second" when
  N is 1), where N is the whole number of seconds, rounded up, at least 1 and at most 60, after which an attempt of
  that kind, with no other attempt of that kind between, will not be refused for the limit. It MUST
  carry N as a number, say which allowance (buy or hold), and have its own stable code, distinct from
  every other refusal.
- **FR-009**: Refusals MUST come in this order: not signed in, then not a customer (both as today),
  then the limit, then every existing refusal in its existing order.
- **FR-010**: The limits MUST hold under concurrent requests: of any number of attempts the same
  account makes at the same moment, no more MUST be handled than its allowance has left.

**The Customer app (US2)**

- **FR-011**: When a buy or hold attempt is refused for the limit, the Customer app MUST show FR-008's
  message with N counting down once a second, measured as elapsed time from the Backend's N, and MUST
  disable that kind's buttons until N reaches 0: **Confirm order**, **Confirm purchase**, and **Check
  again** for buying; **Reserve seats** for holding. At 0 it MUST remove the message and enable them.
  _Amended 2026-11-09 by spec `033` (#135), FR-009: a hold refused for the limit shows the countdown
  above the seat map, and open seats do nothing until it ends; Confirm purchase is Buy tickets in
  the cart; there is no Reserve seats._
- **FR-012**: While the countdown runs, the Customer app MUST keep every pick, held seat, and entered
  value; the other kind's buttons, **Release**, **Release seats**, seat picking, and the hold's own
  countdown (`015` FR-005) MUST keep working unchanged.
  _Amended 2026-11-09 by spec `033` (#135), FR-009: there are no picks, Release, or Release seats;
  clicking a held seat to release it keeps working._
- **FR-013**: The message MUST be announced to assistive technology once, when it appears; the
  countdown's changes MUST NOT be announced each second. A button waiting out the limit MUST be
  announced as unavailable and MUST do nothing when pressed, not only look greyed, and MUST stay
  focusable, so focus stays on it when it becomes unavailable and the customer can press it again with
  the keyboard as soon as the wait ends.
- **FR-014**: A **Check again** (`006`) refused for the limit MUST leave the app in its "We couldn't
  confirm whether your order went through" state, with the countdown, and its next press MUST repeat
  the same confirmation, so no second order is ever placed (`006` FR-005).

**Everyone else (US3)**

- **FR-015**: A refusal for the limit MUST be decided without reading or writing stored data, so an
  account far over its allowance takes almost no work from QueuePass; one account's attempts MUST
  never refuse or hold up another account's.
- **FR-016**: Customers going through the ordinary journeys of `006`, `007`, `015`, and `016` at a
  person's pace MUST NOT be refused for the limits.

**Configuration (decided by Mahdi, 3)**

- **FR-017**: The two numbers, attempts per minute and attempts per 5 seconds, MUST be set through
  configuration kept in the repository, one pair for both kinds, defaulting to 10 and 3; the
  one-command start MUST use the defaults with no manual step. Each MUST be a whole number of at least
  1, and attempts per 5 seconds MUST NOT exceed attempts per minute; otherwise the Backend MUST refuse
  to start and say which setting is wrong. No value MUST turn the
  limits off. The window lengths, 60 and 5 seconds, are fixed.
  _Amended 2026-11-09 by spec `033` (#135), FR-008 (Mahdi's decision, 2026-11-09): holds read their
  own pair, `RATE_LIMIT_HOLD_PER_MINUTE` and `RATE_LIMIT_HOLD_PER_5_SECONDS` (defaults 30 and 10),
  with the same checks; this pair is buying's._
- **FR-018**: Automated tests that are not about the limits MAY set larger numbers; this feature's
  tests and every browser test MUST run with the defaults.

**Logging**

- **FR-019**: The Backend MUST log one line each time an account goes over an allowance, with the
  account, the kind, and N, and MUST NOT log a line for each further refusal during that wait, nor
  ever log a token.

**Unchanged**

- **FR-020**: `006`'s one order per confirmation, `007`'s and `015`'s seat rules (5-minute holds, the
  2-minute wait on a released seat, all-or-nothing holds, releases, live updates), `016`'s per-event
  ticket limit, and every other operation MUST be unchanged for the attempts that are handled.

### Key Entities

- **Allowance**: per customer account and kind (buy, hold): the times of the attempts handled in the
  last 60 seconds, at most 10. Not stored with QueuePass's data (Assumptions).
- **Refusal for the limit**: the kind, the wait in whole seconds, and the message.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Of 20 attempts of one kind sent by one account at the same moment, exactly 3 are handled
  and 17 refused, in 100% of runs, for buying and for holding alike; across a minute of attempts at any
  pace, no more than 10 of a kind are handled in any 60 seconds.
- **SC-002**: A refused attempt creates 0 orders, tickets, and holds, releases 0 seats, and leaves its
  account's held seats and their end times unchanged.
- **SC-003**: An attempt made N seconds after a refusal that said N, with none between, is handled in
  100% of runs; one made 1 second before the wait ends is refused.
- **SC-004**: The browser tests of `006`, `007`, `015`, and `016`, and this feature's ordinary journey,
  pass with the default limits with 0 refusals for the limit.
- **SC-005**: While one account sends 200 attempts far over its allowance, another account's purchase
  succeeds, and the refused attempts make 0 database queries.
- **SC-006**: In the Customer app, the message appears with the right N, counts down to 0, and the
  disabled buttons work again within 1 second of the wait ending.

## Assumptions

- **One Backend.** QueuePass runs one Backend (the Compose stack; `015` relies on it for live
  seat-map updates too). The counts live in that Backend while it runs. Running several Backends
  would give each its own counts, and would need shared counts; that is not supported today, as for
  `015`'s live updates, and is not a deferred control here. Keeping the counts in the Backend rather
  than the database is a deviation from Constitution IV that Mahdi accepted (decided by Mahdi, 5).
- **A restart forgets the counts** (decided by Mahdi, 5). After the Backend restarts, every account has its whole
  allowance. A restart cannot be caused by a customer, takes longer than the 5-second window, and
  gives at most one extra minute's allowance, so the limits still do their job.
- **No limit by network address** (decided by Mahdi, 1): every attempt needs a signed-in customer, so
  the account is what is limited. Several accounts run by one person are each limited; buying many
  accounts' worth of tickets is not prevented here.
- **Only the Customer app may buy (#58)** is a separate issue and not part of this feature; these
  limits apply to every caller, whichever app it is.
- The numbers are settings per running system, not per event or per customer (Constitution VIII).
- English only.
- No deferral of a security or correctness control: the limits are enforced in the Backend for every
  caller, before any other work (FR-007, FR-015).
