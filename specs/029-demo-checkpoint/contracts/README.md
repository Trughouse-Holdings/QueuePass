# Contracts: Demo Checkpoint

**No API change.** `contracts/openapi.yaml` is not touched: no operation, schema, or error code is
added or changed, and the contract version does not move. No front end changes.

The reset is a command run on the laptop, not an API operation (spec, Out of scope; research R1). Its
interface is the command line:

| Stack | Command | Permission |
| --- | --- | --- |
| Compose (path A) | `docker compose exec -e QUEUEPASS_ALLOW_RESET=1 backend node backend/dist/scripts/demo-reset.js` | `-e QUEUEPASS_ALLOW_RESET=1` on the command |
| Host-run (path B) | `node scripts/run-host.mjs --demo-reset` | given by `--demo-reset` (research R6) |
| Either, inside the Backend's environment | `npm run demo-reset --workspace @queuepass/backend` | `QUEUEPASS_ALLOW_RESET=1` in that environment |

Exit status: `0` when the demo state is loaded; `1` on any refusal (permission, host, migrations,
busy database) or failure, with the reason printed (FR-009, FR-010, FR-013). The output is specified
in research R11.
