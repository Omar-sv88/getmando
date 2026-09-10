# Design: App Status Indicator

## Technical Approach

Extend the existing `config-write-api` sidecar — already the single Node process running alongside
nginx in the one published image — with a background poller. On boot, and every
`STATUS_CHECK_INTERVAL_MS`, the sidecar re-reads `CONFIG_PATH` from disk (the same file it already
writes), parses it with `DashboardConfigSchema` (already imported for validation), and issues one
outgoing check per application flagged `healthCheck: true`. Results land in an in-memory
`Map<appId, { status, checkedAt }>` that a new `GET /api/status` route serves as JSON, unauthenticated.
Re-reading the file from disk each cycle — rather than caching the config in memory and updating it
only on `POST /api/config` — means the poller always reflects whatever is actually on disk, including
edits made outside the write API (a mounted-volume edit, a restore from `.bak`), with no state to
keep in sync between the write path and the poller.

The check itself uses `node:http`/`node:https` directly (picked by the app's URL protocol) instead of
`fetch`, for two reasons: it lets a self-signed HTTPS cert be accepted for this request specifically
(`rejectUnauthorized: false` on the request options, not a process-wide TLS setting), and it lets the
socket be destroyed the instant response headers arrive — no need to read or buffer a response body
just to know the app responded. Any status code (2xx–5xx) marks the app "up"; a connection error
(`ECONNREFUSED`, `ECONNRESET`, DNS failure) or a request that doesn't respond within the per-check
timeout marks it "down". A GET request is used rather than HEAD, because many self-hosted apps
implement HEAD incorrectly (405, or a hang) — the same "any status code counts" rule that absorbs a
misbehaving 405 means GET's universal support outweighs the marginal bandwidth HEAD would save,
especially since the body is never read either way.

The frontend adds a small polling service (`AppStatusService`) that exposes the result as a signal
keyed by app id. It has no hardcoded default interval: on startup it makes one immediate `GET
/api/status` request purely to learn the sidecar's configured `intervalMs` before scheduling anything
recurring, then re-schedules every subsequent poll using whatever `intervalMs` the latest response
carried (floored at `MIN_POLL_MS`, a sanity clamp against a misconfigured tiny value — not a fallback
default). Polling faster than the sidecar's own check cadence would just re-fetch an unchanged cache,
so tying the two together removes a number that would otherwise have to be kept in sync by hand in
two places. A failed request (network error, non-2xx, sidecar temporarily down) does not fall back to
hammering at `MIN_POLL_MS` or the last known `intervalMs` — it retries at a flat `RETRY_INTERVAL_MS`
(15s) for up to `MAX_RETRIES` (4) attempts (~1 minute total). If one of those retries succeeds, the
normal `intervalMs`-driven cadence resumes immediately. If all of them fail, the service stops polling
entirely for the rest of that page load — badges stay frozen at their last known value, and recovery
requires reloading the page — rather than polling a dead endpoint indefinitely. `AppCardComponent`
reads `app().healthCheck`; when true, it looks up the app's id in the signal and renders a small
corner badge — green for `up`, red for `down`, no badge while the id is absent (not yet checked, or
`healthCheck` is off).

## Architecture Decisions

| Decision | Options and tradeoff | Choice and rationale |
|---|---|---|
| Where the poller runs | (a) Inside the existing sidecar process vs (b) a new, separate process/container | (a). No new container fits the single-image model already established by `config-write-api`; the sidecar already has the schema, the file path, and a running Node process — adding a `setInterval` loop is the smallest change that gets this behavior. |
| Config source for the poller | (a) Re-read and re-parse `CONFIG_PATH` from disk every cycle vs (b) keep an in-memory copy updated on every successful `POST /api/config` | (a). Re-reading is simpler (no cross-request state to keep consistent), stays correct if the file changes outside the write API, and the file is small enough that re-parsing every interval (default 60s) is negligible cost. |
| HTTP check method | HEAD vs GET | GET. HEAD is cheaper but unreliably implemented across self-hosted apps (405s, or hangs on apps that never coded a HEAD handler); since any status code already counts as "up", GET's universal correctness outweighs the bandwidth HEAD would have saved — and the body is never read regardless of method, so the practical cost difference is small. |
| Check transport | `fetch` (Node 20 global, backed by undici) vs `node:http`/`node:https` directly | `node:http`/`node:https`. Neither offers a first-class, no-extra-dependency way to disable TLS verification per-request the way `https.request({ rejectUnauthorized: false })` does, and the low-level API fires a `response` event as soon as headers arrive, letting the socket be destroyed immediately — `fetch`'s body-as-a-stream model makes "headers only, then abort" more code for the same result. |
| Self-signed / invalid TLS certificates | (a) Reject them (many self-hosted HTTPS apps show red) vs (b) accept them for status checks only | (b), `rejectUnauthorized: false` set only on the outgoing check request's options — never process-wide (`NODE_TLS_REJECT_UNAUTHORIZED` is never touched). A status dot is meant to answer "is something listening and responding", not "does this app have a browser-trusted cert" — the latter is a different, unrelated concern the dashboard doesn't otherwise police. |
| Opt-in scope | (a) Per-app field vs (b) global on/off | (a), per-app `healthCheck: boolean` (default `false`) on `SelfhostedAppSchema`, per the approved proposal — avoids unwanted traffic to apps/devices the operator didn't ask to be probed. |
| Check interval configuration | (a) Global env var vs (b) per-app YAML field | (a), `STATUS_CHECK_INTERVAL_MS` (default `60000`), per the approved proposal. A single timer is simpler than per-app scheduling, and v1 has no evidence yet that different apps need different cadences. |
| `CONFIG_WRITE_TOKEN` requirement | (a) Sidecar still exits if unset (today's behavior) vs (b) sidecar always starts; only the write route stays token-gated | (b), per the approved proposal. `server/src/index.ts` currently calls `process.exit(1)` when the token is missing — status checks have nothing to do with the ability to write, so a read-only deployment (no token, `:ro` mount) should still get status checks. `buildApp`'s existing auth hook already 401s every write request when `configWriteToken` is falsy (`provided !== configWriteToken` is true for any string when the right side is undefined/empty), so removing the startup guard doesn't weaken write auth. |
| Result freshness before the first check completes | (a) Show a third "unknown" badge color vs (b) show no badge at all | (b). A monitored app simply isn't a key in the `/api/status` response yet; the frontend renders nothing until it is, avoiding a third visual state to design and test for what is a few-second startup window. |
| Frontend poll cadence | (a) A separate, hardcoded frontend interval (e.g. 15-30s) vs (b) the frontend polls at whatever cadence the sidecar reports it actually checks at | (b). With the sidecar's default at 60s, a front-end-only 15-30s interval would spend most of its requests re-fetching an unchanged cache for no benefit — polling can never observe fresher data than the sidecar produces. `GET /api/status` reports its own `intervalMs`; the frontend reschedules its next poll using that value, so there is exactly one place (`STATUS_CHECK_INTERVAL_MS`) that defines the cadence instead of two numbers that must be kept in sync by hand. |
| Frontend's very first poll, before any `intervalMs` is known | (a) Assume a hardcoded default (e.g. `MIN_POLL_MS`) until the first response arrives vs (b) make one immediate request specifically to learn `intervalMs`, then schedule the recurring timer from its response | (b). Scheduling a real timer against a guessed default just to replace it moments later is unnecessary — the service always has a live response to key off of once bootstrapped, so there's no "assumed" interval anywhere in the steady state, only a one-time bootstrap fetch. |
| Frontend behavior when a poll request fails | (a) Keep retrying at `MIN_POLL_MS`/`intervalMs` forever vs (b) a bounded flat retry window, then give up for the page's lifetime | (b). A flat `RETRY_INTERVAL_MS` (15s) for `MAX_RETRIES` (4, ~1 minute total) is simpler than exponential backoff and answers the same concern — don't hammer a dead endpoint. Once the window is exhausted, the service stops entirely rather than retrying forever at any cadence: a status dashboard that's been failing for a full minute is treated as "not coming back this session", and badges freeze at their last known value until the page is reloaded. Any successful retry within the window cancels the give-up and resumes normal `intervalMs`-driven polling. |
| Whether the frontend polls at all when nothing is monitored | (a) Always poll `GET /api/status` once the app boots, regardless of config vs (b) poll only while the loaded configuration has ≥1 application with `healthCheck: true`, reactively | (b) (found during implementation, not the original design pass). There's nothing to fetch when no app opts in, so polling unconditionally would just be periodic no-op traffic for the common case of a dashboard that doesn't use this feature. `AppStatusService` watches `ConfigService.config()` via an `effect()` and starts/stops polling as that set changes — including immediately after a configurator save that adds or removes the last monitored app. |

## Data Flow

```text
Sidecar boot (or every STATUS_CHECK_INTERVAL_MS thereafter)
    -> read CONFIG_PATH from disk
    -> DashboardConfigSchema.safeParse
         |-- file missing / invalid --> keep previous cache, log, wait for next cycle
         |-- valid --> for each application with healthCheck === true (in parallel):
                          http(s).request(app.url, { timeout, rejectUnauthorized: false if https })
                            |-- 'response' (any statusCode) --> cache.set(app.id, { status: 'up', checkedAt })
                            |-- 'error' | timeout            --> cache.set(app.id, { status: 'down', checkedAt })
                          destroy the socket immediately, body is never read

GET /api/status  (unauthenticated, polled by the browser)
    -> returns { intervalMs: <the sidecar's own STATUS_CHECK_INTERVAL_MS>, apps: { [appId]: { status, checkedAt } } }

AppStatusService (browser)
    -> on startup: one immediate GET /api/status to learn intervalMs (no assumed default beforehand)
    -> on each successful response:
         signal.set(response.apps)  // Record<string, { status: 'up' | 'down'; checkedAt: string }>
         schedule next poll at max(response.intervalMs, MIN_POLL_MS); reset retry count to 0
    -> on each failed request (network error / non-2xx):
         retryCount++
         |-- retryCount <= MAX_RETRIES (4) --> schedule a retry after RETRY_INTERVAL_MS (15s)
         |-- retryCount >  MAX_RETRIES     --> stop polling for the rest of this page load
         signal is left unchanged either way (stale-but-last-known badges, not cleared to "unknown")
    -> AppCardComponent reads signal()[app().id] when app().healthCheck is true
         |-- absent      --> no badge
         |-- status 'up' --> green badge
         |-- status 'down' --> red badge
```

## File Changes

| File | Action | Description |
|---|---|---|
| `src/app/core/models/dashboard.models.ts` | Modify | Add `healthCheck: z.boolean().default(false)` to `SelfhostedAppSchema` |
| `server/src/status-checker.ts` (new) | Create | Pure-ish check function: given a `SelfhostedApp`, returns `Promise<{ status: 'up' \| 'down' }>` using `node:http`/`node:https` |
| `server/src/status-poller.ts` (new) | Create | Reads `CONFIG_PATH`, runs the checker over every `healthCheck: true` app, updates the in-memory cache; exposes `start(intervalMs)` |
| `server/src/app.ts` | Modify | Add `GET /api/status` route reading from the shared in-memory cache; no auth hook (unauthenticated, unlike `/api/config`) |
| `server/src/index.ts` | Modify | Remove the `process.exit(1)` guard on missing `CONFIG_WRITE_TOKEN`; start the poller unconditionally with `STATUS_CHECK_INTERVAL_MS` (default `60000`) |
| `nginx.conf` | None | `/api/status` already falls under the existing `location /api/ { proxy_pass ...; }` — no change needed |
| `src/app/core/services/app-status.service.ts` (new) | Create | Polls `GET /api/status`; exposes a signal keyed by app id; reschedules its own polling using the response's `intervalMs` |
| `src/app/shared/components/app-card/` | Modify | Render the status badge when `app().healthCheck` is true |
| `src/app/features/configurator/` | Modify | `healthCheck` toggle in the app editor form, alongside the existing `openNewTab`/`favorite` checkboxes |
| `README.md` | Modify | Document `healthCheck` field, `STATUS_CHECK_INTERVAL_MS` env var, and the self-signed-cert / "any response counts as up" behavior |
| `CHANGELOG.md` | Modify | New-feature entry (only once this ships in a release — see proposal's Success Criteria) |

## Interfaces / Contracts

```ts
// GET /api/status  (no auth header required)
// Response: 200, always — even before any check has run, or if CONFIG_PATH doesn't exist yet
{
  intervalMs: number;   // the sidecar's own STATUS_CHECK_INTERVAL_MS, so the frontend can match its
                         // poll cadence to it instead of guessing a separate number
  apps: {
    [appId: string]: {
      status: 'up' | 'down';
      checkedAt: string; // ISO 8601
    };
  };
}
// An app id is present under `apps` only once its first check has completed; healthCheck: false
// apps never appear.
```

```ts
// server/src/status-checker.ts
export interface StatusCheckResult {
  status: 'up' | 'down';
}
export function checkAppStatus(url: string, timeoutMs: number): Promise<StatusCheckResult>;
```

```ts
// src/app/core/services/app-status.service.ts
export interface AppStatus {
  status: 'up' | 'down';
  checkedAt: string;
}
const MIN_POLL_MS = 5_000; // floor applied to a *received* intervalMs, not a startup default
const RETRY_INTERVAL_MS = 15_000; // flat delay between retries after a failed poll
const MAX_RETRIES = 4; // ~1 minute total; after this the service gives up for the page's lifetime

@Injectable({ providedIn: 'root' })
export class AppStatusService {
  readonly statuses: Signal<Record<string, AppStatus>>; // from the last *successful* response's `apps`
  // Internally: makes one bootstrap request on construction to learn `intervalMs` before scheduling
  // anything recurring. Each success reschedules at max(response.intervalMs, MIN_POLL_MS) and resets
  // the retry count to 0; each failure retries after RETRY_INTERVAL_MS, up to MAX_RETRIES, then stops
  // polling entirely (leaving `statuses` at its last known values) until the page is reloaded.
}
```

## Testing Strategy

| Layer | What to test | Approach |
|---|---|---|
| Unit (sidecar) | `checkAppStatus`: 200/404/500 all resolve `up`; connection refused, DNS failure, and timeout resolve `down`; a self-signed HTTPS cert still resolves `up`; a malformed URL resolves `down` instead of rejecting | Spin up local `http.createServer`/`https.createServer` instances (with a generated self-signed cert) on ephemeral ports in the test, point checks at them; use a short timeout to test the timeout path against a server that never responds |
| Unit (sidecar) | Poller: only `healthCheck: true` apps are checked; a missing or invalid `CONFIG_PATH` leaves the previous cache untouched instead of throwing; one app's check throwing/rejecting doesn't stop other apps from being checked or updated that cycle, and never becomes an unhandled rejection | Fake timers + a temp-file `CONFIG_PATH`, mock `checkAppStatus`; for the last case, register a `process.on('unhandledRejection', ...)` spy for the duration of the test and assert it's never called |
| Unit (sidecar) | `GET /api/status` returns the current cache verbatim, with no auth required | `app.inject()` against `buildApp`, as the existing `app.spec.ts` tests already do for `/api/config` |
| Unit (sidecar) | Sidecar starts and serves requests with `CONFIG_WRITE_TOKEN` unset; `/api/config` still 401s every request in that case | Extends the existing token-auth test group |
| Unit (Angular) | `AppStatusService` makes one bootstrap request before scheduling any timer; maps `response.apps` into the signal; reschedules at `response.intervalMs` (floored at `MIN_POLL_MS`) after success | Vitest with `HttpTestingController`, fake timers |
| Unit (Angular) | On a failed poll, `AppStatusService` retries every `RETRY_INTERVAL_MS` (not the last known `intervalMs`), leaves `statuses` unchanged, and resumes normal cadence if a retry within `MAX_RETRIES` succeeds | Vitest with `HttpTestingController` returning one or more errors then a success, fake timers |
| Unit (Angular) | After `MAX_RETRIES` consecutive failures, `AppStatusService` stops scheduling any further request for the rest of the test/page lifetime | Vitest with `HttpTestingController` always erroring; assert no request is made after the last retry's delay elapses |
| Unit (Angular) | Stopping polling (config loses its last monitored app) cancels an in-flight poll rather than letting its response schedule a second, orphaned polling loop once polling restarts | `HttpTestingController`'s `TestRequest.cancelled` flag, asserted after a stop-then-start sequence with a request still pending |
| Unit (Angular) | `AppCardComponent` renders no badge when `healthCheck` is false or the app id is absent from the status map; green/red badge otherwise, and never both classes at once | Component test with a mocked `AppStatusService`; assert the absence of the *other* status's class, not just the presence of the expected one |
| Integration (Angular) | Configurator's `healthCheck` toggle updates the draft and round-trips through save | Extends the existing configurator page/store test suites |

## Threat Matrix

| Boundary | Applicability | Design response | Planned RED tests |
|---|---|---|---|
| Unauthenticated new read endpoint | Applicable — `GET /api/status` has no token | Read-only; exposes only `{status, checkedAt}` per app id, no URLs or other config data — no more sensitive than the already-public `GET /config/dashboard.yaml`, which includes the URLs themselves | Confirm response shape never includes `url` or other config fields |
| SSRF via the check target | N/A | The checked URL always comes from `CONFIG_PATH`, which only changes through the already-authenticated `POST /api/config` (or a direct volume edit by the operator) — never attacker-supplied input at request time | None |
| TLS verification bypass widening scope beyond status checks | Applicable — `rejectUnauthorized: false` is a foot-gun if applied too broadly | Set only in the per-request `https.request()` options object for this one outgoing call; never via `NODE_TLS_REJECT_UNAUTHORIZED` or any process-global setting | Confirm a second, unrelated HTTPS client in the same process (if any exists) is unaffected |
| Resource exhaustion from many/slow monitored apps | Applicable, low severity | Checks run in parallel with an independent per-request timeout each, so one hanging app can't block others or the event loop; default interval (60s) and opt-in-per-app keep concurrent check count bounded to what the operator configured | Simulate several slow/hanging checks concurrently, assert the poll cycle still completes within timeout + a small margin |

## Migration / Rollout

Fully additive, no breaking change: `healthCheck` defaults to `false` on `SelfhostedAppSchema`, so
existing `dashboard.yaml` files parse unchanged and no app gets checked until explicitly opted in.
`STATUS_CHECK_INTERVAL_MS` is optional with a default, so no env var changes are required to upgrade.
The only behavior change to something that already exists is removing the sidecar's
`process.exit(1)` when `CONFIG_WRITE_TOKEN` is unset — today that means the sidecar (and therefore
this new feature) doesn't run at all in a read-only deployment; after this change it runs, `/api/config`
keeps 401-ing every write, and `/api/status` starts working. This feature was built in parallel with
v2.0.0 on `feature/app-status-indicator` and is targeted for the first release after v2.0.0.

## Decisions (resolved — see Resolved Questions in proposal.md)

- **Self-signed / invalid TLS certificates**: accepted for status checks specifically
  (`rejectUnauthorized: false` on that one request), never process-wide. See Architecture Decisions.
- **HEAD vs GET**: GET, for universal correctness across self-hosted apps; the body is never read
  either way, so the bandwidth argument for HEAD doesn't hold up in practice.
- **Default `STATUS_CHECK_INTERVAL_MS`**: `60000` (60s) — frequent enough to feel "live" on a
  dashboard, infrequent enough not to bother most homelab devices. Configurable via env var per the
  proposal.
- **Default per-check timeout**: `5000` (5s) — long enough for a normal LAN round trip plus TLS
  handshake, short enough that one down app doesn't visibly stall the rest of the cycle (checks run
  in parallel regardless, but a very long timeout would still delay that app's own badge for a while).
- **Frontend poll cadence** (revised during design review): the frontend does not hardcode its own
  interval. `GET /api/status` returns `intervalMs` (the sidecar's configured value) alongside `apps`,
  and `AppStatusService` reschedules its next poll using that number (floored at `MIN_POLL_MS = 5000`,
  a sanity clamp on a received value, not a default). Rationale: polling faster than the sidecar's own
  check cadence can never observe fresher data, so a separate frontend-only interval would just waste
  requests re-fetching an unchanged cache.
- **Frontend bootstrap and failure handling** (revised during design review): `AppStatusService` makes
  one immediate request on startup purely to learn `intervalMs` before scheduling any recurring timer
  — there is no assumed default interval at any point. If a poll request fails, the service does not
  keep hitting the endpoint at `MIN_POLL_MS` or the last known `intervalMs`; it retries at a flat
  `RETRY_INTERVAL_MS = 15000` for up to `MAX_RETRIES = 4` attempts (~1 minute total), leaving
  `statuses` at its last known values throughout (no flicker to "unknown" on a transient failure). Any
  retry that succeeds resumes normal `intervalMs`-driven polling immediately. If all `MAX_RETRIES` fail,
  the service stops polling entirely for the rest of that page load — deliberately simpler than
  exponential backoff, and chosen over "keep retrying forever at some cadence" so a status dashboard
  that's been down for a full minute doesn't poll a dead endpoint indefinitely; recovery after that
  point requires a page reload.
- **Poll-only-when-monitored** (found during implementation, not the original design pass):
  `AppStatusService` only polls while the loaded config has ≥1 `healthCheck: true` application,
  starting/stopping reactively via an `effect()` on `ConfigService.config()`. See Architecture
  Decisions.
- **Sidecar resilience hardening** (found during code review, fixed before merge): `checkAppStatus`
  is wrapped in a try/catch so it can never reject (a malformed URL or any other synchronous failure
  in constructing the request now resolves `down`, matching its own documented contract instead of
  crashing the process via an unhandled rejection); `runCycle`'s `Promise.all` was replaced with
  `Promise.allSettled` plus per-result error logging, so one app's check misbehaving can never stop
  siblings from updating or escape as an unhandled rejection; and `start()`/`setInterval` now route
  through a `runCycleSafely()` wrapper that catches and logs instead of leaving `runCycle()`'s
  returned promise unhandled. Verified by reproducing the crash against the pre-fix code (`node
  --unhandled-rejections=throw` — Node's default since v15 — terminates the process on an unhandled
  rejection) and confirming it no longer occurs after the fix.
- **Frontend stale-poll cancellation** (found during code review, fixed before merge):
  `AppStatusService.stop()` now unsubscribes the in-flight poll's `Subscription` in addition to
  clearing the scheduled timer. Previously, a stop-then-start cycle while a request was in flight
  could let that stale response's handler run after polling resumed, scheduling a second, orphaned
  polling loop alongside the new one. Angular's `HttpClient` cancels the underlying request on
  unsubscribe, so the stale response's `next`/`error` handlers now never run at all.
- **Second review pass** (found after merge, see tasks.md § Phase 5):
  - `AppStatusService.stop()` now also resets `retries` to 0 — otherwise, once `MAX_RETRIES` was
    exhausted, a config-driven stop→start (last monitored app removed, then re-added) inherited the
    exhausted count and the new session gave up on its first failed poll with no retries.
  - `server/src/index.ts` no longer passes `STATUS_CHECK_INTERVAL_MS` straight through `Number()`
    (`'30s'` → `NaN`, `''` → `0`, both of which make `setInterval` a request flood). A new
    `resolveStatusCheckIntervalMs()` falls back to the default for unset/blank/non-finite input and
    clamps up to `MIN_STATUS_CHECK_INTERVAL_MS` (1000ms).
  - The poller prunes its in-memory cache each cycle to the current monitored id set, so an app
    de-opted from `healthCheck` stops appearing in `GET /api/status` (it previously lingered).
  - `createStatusPoller.start()` clears any existing interval before creating a new one (was a
    timer leak if called twice), and `checkAppStatus` attaches a no-op `error` listener to the
    response stream so a socket error during teardown can't crash the process.
- **Third review pass** (found after merge, see tasks.md § Phase 6):
  - Poll cycles are now serialized via a `cycleInProgress` flag. `setInterval` previously fired
    regardless of whether the prior cycle had finished, so an `intervalMs` shorter than the
    per-check timeout overlapped cycles — duplicate concurrent checks, and a stale cycle able to
    `cache.set` an app a newer cycle had already pruned. A tick that lands mid-cycle is now skipped.
  - `resolveStatusCheckIntervalMs` also clamps a ceiling (`MAX_STATUS_CHECK_INTERVAL_MS =
    2_147_483_647`): Node coerces a `setInterval` delay above 2^31-1 ms back to 1ms, so a huge
    finite env value would have re-created the flood the floor prevents.
  - `AppStatusService` guards `response.intervalMs` with `Number.isFinite` before `Math.max`
    (a `null`/`NaN` from a misbehaving endpoint would otherwise schedule `setTimeout(fn, NaN)`), and
    registers `DestroyRef.onDestroy(() => this.stop())` to release its timer/subscription if the
    injector is torn down.
- **Fourth review pass** (found after merge, see tasks.md § Phase 7):
  - Status badge accessibility (WCAG 1.4.1): the badge is now `aria-hidden` and decorative. Its
    `role="img"`/`aria-label` was never announced — `AppCardComponent`'s `<button>` has its own
    `aria-label`, which is the button's entire accessible name — so the up/down state is folded into
    that name via a `cardLabel` computed instead. The badge also carries a non-colour cue: it stays
    a circle in both states, with a check glyph (`heroCheckMini`) for `up` and a cross
    (`heroXMarkMini`) for `down` — the shape-morph "circle → diamond" first tried in review read as
    jarring, a glyph inside a constant circle is the conventional status-dot pattern.
  - `checkAppStatus` adds an overall deadline (`setTimeout` → `request.destroy()` → `down`) next to
    the socket inactivity timeout: `{ timeout }` alone only fires on an *idle* socket, so a server
    trickling header bytes forever would otherwise never resolve.
  - `app-status.service.spec.ts` reformatted to satisfy the CI `format:check` gate.
