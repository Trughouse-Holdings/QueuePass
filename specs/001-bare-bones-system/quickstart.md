# Quickstart: Validating the Bare-Bones QueuePass System

This is the running-system gate (Constitution VI and workflow gate 5). Run it from a fresh clone
before the `001` implementation PR is merged. Each step names the requirement it proves.

## Prerequisites

- Docker Desktop running, Node.js 22, and a desktop browser.
- Nothing else on ports 3000, 5173–5175, 8080, 9000, or 5432. In particular, stop the sibling
  project: `cd ../queuepass && docker compose stop`.

## V1: One command brings up everything (US1; FR-001, FR-002, SC-001)

```bash
docker compose down -v          # fresh start: DELETES local data
docker compose up --build -d
docker compose ps
```

**Expect**: `database`, `keycloak`, `backend`, `admin-app`, `customer-app`, and `booth-app` are
`healthy`, and `seed` has `exited (0)`. Time from the command to all-healthy is under 15 minutes.

```bash
curl -s localhost:3000/health                                   # {"status":"ok","database":"up"}
for p in 5173 5174 5175; do curl -s localhost:$p/health; echo; done   # {"status":"ok"} x3
```

## V2: Seed is complete and idempotent (US1; FR-004–FR-007, SC-002)

```bash
docker compose logs seed | tail -5
docker compose run --rm seed
npm test --workspace @queuepass/seed
```

**Expect**: both runs report 235 accounts and 3 clients, with the second run creating nothing.
The seed test **runs** rather than skips (research R15) and passes.

## V3: Sign in, hello, and logout in each front end (US2; FR-009–FR-016, SC-003, SC-004)

For each row, use a **private browser window**, so no earlier session interferes:

| Open | Sign in as | Expect on the hello-world page |
|---|---|---|
| http://localhost:5173 | `admin1` / `test123` | "QueuePass Admin", username `admin1` |
| http://localhost:5174 | `customer1` / `test123` | "QueuePass", username `customer1` |
| http://localhost:5175 | `agent1` / `test123` | "QueuePass Ticket Booth", username `agent1` |

For each app:

1. Opening the app sends you to a page on `localhost:8080`, Keycloak's login page. No app
   content shows first.
2. A wrong password keeps you on the login page with an error.
3. The right password returns you to the hello-world page.
4. Reload the page. You stay signed in, with no login prompt.
5. Click **Log out**. You end on the login page.
6. Press the browser's back button. No signed-in content appears (SC-007).
7. Reopen the app URL. The login page appears again (US2-4).

## V4: Wrong role is refused (US2-6, US2-7; FR-016, SC-005)

In a private window, open http://localhost:5173 and sign in as `customer1`.

**Expect**: "Your account can't use this app", a logout button, and nothing else. Repeat at
5174 as `agent1`, and at 5175 as `admin1`.

## V5: No tokens in browser storage (FR-011, SC-008)

Signed in to any app, open the browser's developer tools, go to Application, then Storage.

**Expect**: nothing in Local Storage or Session Storage contains `access_token`, `id_token`,
`refresh_token`, or a string starting with `eyJ`. Repeat after logout.

## V6: The Backend refuses bad tokens (US3; FR-018–FR-024, SC-006)

The front-end clients refuse password grants by design, so take a real token from a signed-in
app. In developer tools, Network tab, copy the `Authorization` header value of the `/hello/...`
request, then:

```bash
TOKEN='eyJ...'   # paste, without the "Bearer " prefix

curl -si localhost:3000/me | head -1                                        # 401
curl -si -H 'Authorization: Bearer nope' localhost:3000/me | head -1        # 401
curl -s  -H "Authorization: Bearer $TOKEN" localhost:3000/me                # your username and roles
curl -si -H "Authorization: Bearer $TOKEN" localhost:3000/hello/booth | head -1   # 403 unless you are a gate agent
# Broken signature. Flip a character in the MIDDLE of the signature: the last base64url
# character of an RS256 signature carries only 2 bits, so changing it can decode to the same bytes.
BAD=$(node -e 'const [h,p,s]=process.argv[1].split(".");const i=s.length>>1;console.log([h,p,s.slice(0,i)+(s[i]==="A"?"B":"A")+s.slice(i+1)].join("."))' "$TOKEN")
curl -si -H "Authorization: Bearer $BAD" localhost:3000/me | head -1             # 401
sleep 330; curl -si -H "Authorization: Bearer $TOKEN" localhost:3000/me | head -1  # 401 (expired)
```

**Expect**: the error bodies are `ErrorEnvelope`s with code `UNAUTHENTICATED` or `FORBIDDEN`.

CORS (FR-024):

```bash
curl -si -H 'Origin: http://evil.example' localhost:3000/health | grep -i access-control-allow-origin   # nothing
curl -si -H 'Origin: http://localhost:5174' localhost:3000/health | grep -i access-control-allow-origin  # http://localhost:5174
```

## V7: The contract is served and matches (FR-027, FR-031, SC-009)

Open http://localhost:3000/docs. **Expect**: every operation listed in
[contracts/README.md](./contracts/README.md), each showing its lock icon and required roles.

## V8: The full suite passes (FR-030–FR-035, SC-010)

```bash
npm install
npm test
```

**Expect**: the boundary check, contract-drift check, Backend (including every refused-token
case), seed, and all three front ends' tests pass.

## V9: Restart keeps everything (US1-5; FR-003)

```bash
docker compose down        # no -v
docker compose up -d
```

**Expect**: V3 still works for `admin1`, and venues created before the restart are still listed
in the Admin app.

---

## Validation record

**2026-09-28: all of V1–V9 passed** from a fresh start (`docker compose down -v`).

| Step | Result |
|---|---|
| V1 | All six services healthy 80 s after `docker compose up --build`; seed exited 0 |
| V2 | Second seed run created nothing; seed tests (3) ran against Keycloak and passed |
| V3–V5 | 42/42 checks in real Chrome across all three apps: Keycloak login page first, wrong password refused, hello page greets the user via a Bearer token, reload stays signed in, logout reaches the login page, back button shows no signed-in content, reopening asks for login, no tokens in local or session storage |
| V4 | `customer1` at Admin, `agent1` at Customer, and `admin1` at Booth: each refused, with logout offered and no API calls made |
| V6 | With a browser-issued token: no token, garbage, and a mid-signature flip all `401`; a real token past expiry `401`; wrong role `403`; CORS granted only to front-end origins |
| V7 | `/docs` served; `/docs/openapi.yaml` byte-identical to the committed contract |
| V8 | `npm test`: boundary and drift checks, then 163 tests (shared 22, backend 113, admin 19, customer 3, booth 3, seed 3) |
| V9 | A venue created before `docker compose down` / `up` was still listed, and `admin1` still signed in |

The browser checks were driven by Playwright against the installed Chrome, from outside the
repository. Playwright is not part of the project's stack.
