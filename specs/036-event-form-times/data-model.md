# Data Model: Event Form Times

No stored schema change. The event's `doorsOpenAt`, `startsAt`, and `endsAt` instants stay as
`025` / `020` / `002`.

## Form-only state

| Name | Values | Rules |
| --- | --- | --- |
| Doors-open mode | `before` or `at-time` | Not stored. New event: `before`. Edit: `before` if the stored gap is a 15-minute step in `[0, 360]` minutes, else `at-time`. |
| Doors-open length | `0, 15, …, 360` minutes | Used in `before` mode. Default 60. Changing it sets `doorsOpenAt` to the start instant minus this length (elapsed). |
| Starts / Ends / doors local value | `YYYY-MM-DDTHH:mm` or empty | Same as today. Date and time controls split and join this string. An empty date or an empty time means the value is incomplete. |

## Derivations

- **Shown doors time** (in `before` mode): the venue-local time of `startInstant - length`, once
  the start names one moment, including the zone abbreviation.
- **Range**: `doorsOpenProblem(start, doors)` unchanged (`025`).
- **Send**: `doorsOpenAt`, `startsAt`, and `endsAt` as offset date-times in the venue zone (`020`
  FR-018).

## Validation (form preview)

Unchanged rules, new controls: required start and end; doors required once they can be known; end
after start; doors in 0 to 6 elapsed hours; skipped local times refused; repeated local times
chosen. "Before the start" list values cannot fail the range check.
