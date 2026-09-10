# Tasks: App Status Indicator

## Review Workload Forecast

| Field                   | Value               |
| ------------------------ | -------------------- |
| Estimated changed lines | 500–700             |
| 400-line budget risk    | Medium-High          |
| Chained PRs recommended | Yes                  |
| Suggested split         | PR 1 → PR 2 → PR 3  |
| Delivery strategy       | ask-on-risk          |
| Chain strategy          | pending              |

Decision needed before apply: No — resolved during design review, see `design.md` § Decisions.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
| ---- | ---- | --------- | --------------------- | ---------------- | ------------------ |
| 1 | Schema field + sidecar checker/poller/route | PR 1 | `npm test` (`server/`) | Local, no container needed — real local `http`/`https` servers spun up in-test | Revert `dashboard.models.ts`'s `healthCheck` field, delete `status-checker.ts`/`status-poller.ts`, remove the `/api/status` route and the `index.ts` startup change |
| 2 | Frontend `AppStatusService` (bootstrap fetch, interval sync, bounded retry) | PR 2 | `ng test` | jsdom + `HttpTestingController`, fake timers | Delete `app-status.service.ts` |
| 3 | UI: `AppCardComponent` badge + configurator `healthCheck` toggle + docs | PR 3 | `ng test` | jsdom integration tests | Revert `app-card` template/component, configurator form field, README section |

## Phase 0: Resolve Open Questions — RESOLVED (design review)

- [x] 0.1 "Up" definition — record in `design.md`.
      → Any HTTP response (2xx–5xx) counts as up; only a network-level failure or timeout counts as
      down. Recorded in `proposal.md` and `design.md` § Technical Approach.
- [x] 0.2 Opt-in scope — per app vs. default-on.
      → Per-app `healthCheck: boolean` (default `false`) on `SelfhostedAppSchema`. Recorded in
      `design.md` § Architecture Decisions.
- [x] 0.3 Coupling to `CONFIG_WRITE_TOKEN`.
      → Decoupled — the poller and `GET /api/status` run regardless of whether the token is
      configured; only `POST /api/config` stays token-gated. Recorded in `design.md` § Architecture
      Decisions and § Migration / Rollout.
- [x] 0.4 Check interval configuration — global vs. per-app.
      → Global `STATUS_CHECK_INTERVAL_MS` env var (default `60000`), no per-app override in v1.
      Recorded in `design.md` § Architecture Decisions.
- [x] 0.5 Self-signed/invalid TLS certificates.
      → Accepted for status checks specifically (`rejectUnauthorized: false` on that one request),
      never process-wide. Recorded in `design.md` § Architecture Decisions and § Threat Matrix.
- [x] 0.6 HEAD vs GET for the check request.
      → GET — HEAD is unreliably implemented across self-hosted apps, and since any status code
      counts as "up" and the body is never read either way, GET's universal correctness wins.
      Recorded in `design.md` § Architecture Decisions.
- [x] 0.7 Frontend poll cadence relative to the sidecar's check interval.
      → The frontend has no separate hardcoded interval; `GET /api/status` returns `intervalMs`, and
      `AppStatusService` reschedules using that value. Recorded in `design.md` (revised during design
      review).
- [x] 0.8 Frontend bootstrap (before any `intervalMs` is known) and failure/retry behavior.
      → One immediate bootstrap request learns `intervalMs` before any recurring timer is scheduled
      (no assumed default). On failure: flat `RETRY_INTERVAL_MS` (15s) retries, up to `MAX_RETRIES`
      (4, ~1 minute total); if all fail, the service stops polling entirely for the rest of that page
      load (no exponential backoff, no infinite retry). Recorded in `design.md` (revised during
      design review).

## Phase 1: Schema Field + Sidecar Checker, Poller, and Route

- [x] 1.1 Add `healthCheck: z.boolean().default(false)` to `SelfhostedAppSchema` in
      `src/app/core/models/dashboard.models.ts`.
      - Acceptance: an app without `healthCheck` in YAML parses with `healthCheck === false`; an app
        with `healthCheck: true` round-trips through `DashboardConfigSchema.safeParse`.
      - Verify: `ng test` — extend `dashboard.models.spec.ts`.
      - Files: `src/app/core/models/dashboard.models.ts`, `src/app/core/models/dashboard.models.spec.ts`.

- [x] 1.2 RED: write tests for `server/src/status-checker.ts`'s `checkAppStatus(url, timeoutMs)` —
      200/404/500 all resolve `{ status: 'up' }`; connection-refused and DNS-failure errors resolve
      `{ status: 'down' }`; a request to a server that never responds resolves `{ status: 'down' }`
      after `timeoutMs`; a self-signed HTTPS cert still resolves `{ status: 'up' }`.
      - Acceptance: tests exist and fail (no implementation yet).
      - Verify: `npm test` in `server/` shows the new spec failing.
      - Files: `server/src/status-checker.spec.ts`.

- [x] 1.3 GREEN: implement `checkAppStatus` using `node:http`/`node:https` (picked by URL protocol),
      `rejectUnauthorized: false` only on this request's options, destroying the socket as soon as
      the `response` event fires (never reading the body). REFACTOR for clarity without changing
      behavior.
      - Acceptance: all of 1.2's tests pass.
      - Verify: `npm test` in `server/`.
      - Files: `server/src/status-checker.ts`.

- [x] 1.4 RED/GREEN/REFACTOR: `server/src/status-poller.ts` — reads `CONFIG_PATH`, parses it with
      `DashboardConfigSchema`, runs `checkAppStatus` in parallel over every `healthCheck: true` app,
      and updates a shared in-memory cache (`Map<appId, { status, checkedAt }>`). A missing or
      invalid `CONFIG_PATH` leaves the previous cache untouched and logs instead of throwing.
      Exposes `start(intervalMs)` and a way to read the current cache + configured interval.
      - Acceptance: only `healthCheck: true` apps are checked; cache survives a bad read; `start()`
        runs an immediate check before the first interval tick.
      - Verify: `npm test` in `server/` with fake timers and a temp-file `CONFIG_PATH`.
      - Files: `server/src/status-poller.ts`, `server/src/status-poller.spec.ts`.

- [x] 1.5 RED/GREEN/REFACTOR: add `GET /api/status` to `server/src/app.ts`, returning
      `{ intervalMs, apps: <cache> }` as JSON, no auth hook. Response is always `200`, even before
      any check has completed (`apps: {}`) or if `CONFIG_PATH` doesn't exist yet.
      - Acceptance: request against `buildApp()` returns the expected shape with no token header;
        response never includes `url` or other config fields, only `status`/`checkedAt` per app id.
      - Verify: `npm test` in `server/`, extending `app.spec.ts`.
      - Files: `server/src/app.ts`, `server/src/app.spec.ts`.

- [x] 1.6 RED/GREEN/REFACTOR: `server/src/index.ts` — remove the `process.exit(1)` guard on a
      missing `CONFIG_WRITE_TOKEN`; start the poller unconditionally via `STATUS_CHECK_INTERVAL_MS`
      (default `60000`). Confirm `POST /api/config` still 401s every request when the token is unset
      (already true via `buildApp`'s existing auth hook — this task is about not exiting before that
      hook ever runs).
      - Acceptance: sidecar starts and serves `GET /api/status` with `CONFIG_WRITE_TOKEN` unset;
        `POST /api/config` still 401s in that case.
      - Verify: `npm test` in `server/`, extending the token-auth test group in `app.spec.ts`
        (or a small `index`-level test if one is warranted).
      - Files: `server/src/index.ts`.

**Phase 1 exit check**: `npm test` in `server/` green; `npx tsc -p server/tsconfig.json` clean.

## Phase 2: Frontend `AppStatusService`

- [x] 2.1 RED: write tests for `AppStatusService` — bootstrap request on construction (before any
      timer is scheduled) reads `intervalMs` and `apps` into the signal; each successful poll
      reschedules the next one at `max(intervalMs, MIN_POLL_MS)` and resets the retry count.
      - Acceptance: tests exist and fail.
      - Verify: `ng test` shows the new spec failing.
      - Files: `src/app/core/services/app-status.service.spec.ts`.

- [x] 2.2 GREEN: implement `AppStatusService` (`providedIn: 'root'`) per `design.md`'s Interfaces /
      Contracts — `statuses: Signal<Record<string, AppStatus>>`. REFACTOR for clarity.
      - Acceptance: 2.1's tests pass.
      - Verify: `ng test`.
      - Files: `src/app/core/services/app-status.service.ts`.

- [x] 2.3 RED/GREEN/REFACTOR: failure and give-up behavior — a failed poll retries every
      `RETRY_INTERVAL_MS` (15s) up to `MAX_RETRIES` (4) without touching `statuses`; a retry that
      succeeds within the window resumes normal `intervalMs`-driven polling; if all `MAX_RETRIES`
      fail, no further request is scheduled for the rest of that service instance's lifetime.
      - Acceptance: tests cover both the "recovers mid-window" and "exhausts all retries" paths.
      - Verify: `ng test` with `HttpTestingController` + fake timers.
      - Files: `src/app/core/services/app-status.service.ts`, `.spec.ts`.

**Phase 2 exit check**: `ng test` green; no new lint warnings.

## Phase 3: UI — Status Badge and Configurator Toggle

- [x] 3.1 RED/GREEN/REFACTOR: `AppCardComponent` — a `computed` signal reading
      `appStatusService.statuses()[app().id]`, rendered as a small corner badge (green `up` / red
      `down`) only when `app().healthCheck` is true and the id is present in the map; no badge
      otherwise. Follows the existing `iconUrl`/`showDescriptions` computed-signal pattern already in
      this component.
      - Acceptance: no badge for `healthCheck: false` or an unchecked app id; correct color for
        `up`/`down`.
      - Verify: `ng test`, extending `app-card.component.spec.ts`.
      - Files: `src/app/shared/components/app-card/app-card.component.ts`,
        `app-card.component.html`, `app-card.component.spec.ts`.

- [x] 3.2 RED/GREEN/REFACTOR: configurator app editor — a `healthCheck` checkbox alongside the
      existing `openNewTab`/`favorite` toggles, wired through `ConfiguratorStore.updateApplication`.
      - Acceptance: toggling the checkbox updates the draft; the value round-trips through
        save/load/export.
      - Verify: `ng test`, extending the configurator page/store test suites.
      - Files: wherever the per-app editor fields live under
        `src/app/features/configurator/components/`, plus `configurator.store.spec.ts` if the draft
        shape assertions need updating.

- [x] 3.3 Update `README.md`: document the `healthCheck` field, `STATUS_CHECK_INTERVAL_MS` env var,
      the "any HTTP response counts as up" behavior, and the self-signed-cert acceptance. The
      `CHANGELOG.md` entry is still pending — add it when this feature is cut into its release (the
      first after v2.0.0), together with promoting the spec and archiving this change.
      - Acceptance: README accurately describes the new field/env var and its behavior.
      - Verify: manual read-through against `design.md`.
      - Files: `README.md`.

- [x] 3.4 Run the complete `ng test` and `server/` test suites together; `npx tsc -p server/tsconfig.json`.
      - Acceptance: everything green, no regressions in existing suites.
      - Verify: `ng test`, `npm test` (in `server/`), `npx tsc -p server/tsconfig.json`.
      - Files: N/A (verification only).

**Phase 3 exit check**: full regression suite green across both `ng test` and `server/`'s Vitest.

## Phase 4: Code Review Fixes

Findings from a `code-review-and-quality` pass over the full feature branch. See `design.md`'s
"Decisions (resolved)" for the details recorded there.

- [x] 4.1 (Critical) `checkAppStatus` could reject instead of resolving `down` if constructing the
      request threw synchronously (e.g. a malformed URL), and `runCycle`'s `Promise.all` plus the
      un-caught `void runCycle()` call sites meant that rejection became an unhandled promise
      rejection — which crashes the sidecar process by default on Node 15+ (verified empirically:
      reproduced the crash against the pre-fix code, confirmed it's gone after the fix).
      - Acceptance: `checkAppStatus` never rejects; one app's check failing doesn't stop others from
        updating that cycle or escape as an unhandled rejection anywhere in the call chain.
      - Verify: `npm test` in `server/` — new tests in `status-checker.spec.ts` (malformed URL) and
        `status-poller.spec.ts` (a rejecting `check` mock, asserted via a `process.on
        ('unhandledRejection', ...)` spy).
      - Files: `server/src/status-checker.ts`, `server/src/status-checker.spec.ts`,
        `server/src/status-poller.ts`, `server/src/status-poller.spec.ts`.

- [x] 4.2 (Required) `AppStatusService.stop()` didn't cancel an in-flight poll, so a stop-then-start
      sequence while a request was pending could let its stale response schedule a second, orphaned
      polling loop alongside the new one.
      - Acceptance: stopping cancels the in-flight request; its response (if it could still arrive)
        never schedules a further poll.
      - Verify: `ng test` — new test in `app-status.service.spec.ts` asserting
        `TestRequest.cancelled` and that only one polling loop survives a stop/start-while-in-flight
        sequence.
      - Files: `src/app/core/services/app-status.service.ts`,
        `src/app/core/services/app-status.service.spec.ts`.

- [x] 4.3 (Required) `design.md`/`specs/app-status-check/spec.md` didn't document that the frontend
      only polls while ≥1 application is monitored (an enhancement added during implementation,
      correctly documented in README but not in the spec docs).
      - Acceptance: design/spec docs describe the poll-only-when-monitored behavior.
      - Verify: manual read-through.
      - Files: `design.md`, `specs/app-status-check/spec.md`.

- [x] 4.4 (Nit) Redundant static `bg-emerald-500` class on the status badge, alongside the
      `[class.bg-emerald-500]` binding that already fully governs it — confirmed harmless at runtime
      (Angular's class binding wins), but misleading to read. Removed. Strengthened the up/down
      badge tests to assert the *absence* of the other status's class, not just the presence of the
      expected one.
      - Acceptance: template has no redundant static class; tests would catch a regression either way.
      - Verify: `ng test`.
      - Files: `src/app/shared/components/app-card/app-card.component.html`,
        `src/app/shared/components/app-card/app-card.component.spec.ts`.

**Phase 4 exit check**: `ng test` and `server/`'s `npm test` both green; `npx tsc -p
server/tsconfig.json` clean.

## Phase 5: Second Review Pass Fixes

Findings from a second `code-review-and-quality` pass over the merged feature branch.

- [x] 5.1 (Medium) `AppStatusService.stop()` didn't reset the retry counter, so once `MAX_RETRIES`
      was exhausted, a later stop→start driven by the config losing then regaining its last
      monitored app inherited the exhausted count: the first failed poll of that fresh session gave
      up permanently with zero retries. `stop()` now resets `retries` to 0.
      - Acceptance: after exhausting all retries, a monitoring off→on cycle gets the full retry
        budget again.
      - Verify: `ng test` — new test in `app-status.service.spec.ts`.
      - Files: `src/app/core/services/app-status.service.ts`, `.spec.ts`.

- [x] 5.2 (Medium) `server/src/index.ts` fed `STATUS_CHECK_INTERVAL_MS` straight through `Number()`:
      a non-numeric value (`30s`) became `NaN` and an empty value became `0`, either of which turns
      `setInterval` into a request flood against every monitored app. Added
      `resolveStatusCheckIntervalMs()` — falls back to the default for unset/blank/non-finite input
      and clamps up to `MIN_STATUS_CHECK_INTERVAL_MS` (1000ms).
      - Acceptance: a malformed or too-small env value can never produce a sub-second check loop.
      - Verify: `npm test` in `server/` — new `resolveStatusCheckIntervalMs` describe block.
      - Files: `server/src/index.ts`, `server/src/status-poller.ts`, `server/src/status-poller.spec.ts`.

- [x] 5.3 (Low) The poller's in-memory cache was never pruned, so an app switched from
      `healthCheck: true` to `false` (or removed) kept its last status in `GET /api/status`
      indefinitely — contradicting "`healthCheck: false` apps never appear". Each cycle now deletes
      cache entries whose id is not in the current monitored set.
      - Acceptance: a de-monitored app disappears from `GET /api/status` on the next cycle.
      - Verify: `npm test` in `server/` — new test in `status-poller.spec.ts`.
      - Files: `server/src/status-poller.ts`, `server/src/status-poller.spec.ts`,
        `specs/app-status-check/spec.md`.

- [x] 5.4 (Low) `createStatusPoller.start()` set a new `setInterval` without clearing an existing
      one, leaking a timer if called twice. It now clears any existing timer first.
      - Acceptance: calling `start()` twice leaves exactly one interval running.
      - Verify: `npm test` in `server/` — new test in `status-poller.spec.ts`.
      - Files: `server/src/status-poller.ts`, `server/src/status-poller.spec.ts`.

- [x] 5.5 (Nit) `checkAppStatus` attached no `error` listener to the response stream, so a socket
      error raised while tearing the response down would surface as an unhandled `error` event and
      crash the process. Added a no-op `response.on('error', ...)`.
      - Acceptance: a socket dropped right after headers arrive still resolves `up`, no crash.
      - Verify: `npm test` in `server/` — new test in `status-checker.spec.ts`.
      - Files: `server/src/status-checker.ts`, `server/src/status-checker.spec.ts`.

## Phase 6: Third Review Pass Fixes

Findings from a third review pass (two more agents) over the branch.

- [x] 6.1 (Required) `setInterval` fired every `intervalMs` regardless of whether the previous cycle
      had finished. When `intervalMs` is shorter than the per-check timeout, cycles overlapped:
      duplicate concurrent checks against every app, and — worse — a stale cycle could `cache.set` an
      app *after* a newer cycle had pruned it, breaking "`/api/status` only lists monitored apps".
      `runCycle` now guards on a `cycleInProgress` flag and skips the tick if a cycle is still
      running, serializing them.
      - Acceptance: overlapping ticks never raise check concurrency above the monitored-app count; a
        de-monitored app stays pruned across slow overlapping cycles.
      - Verify: `npm test` in `server/` — two new tests in `status-poller.spec.ts`.
      - Files: `server/src/status-poller.ts`, `server/src/status-poller.spec.ts`.

- [x] 6.2 (Required) `resolveStatusCheckIntervalMs` clamped a floor but not a ceiling, so a huge
      finite value (`STATUS_CHECK_INTERVAL_MS=1e100`) reached `setInterval`, where Node coerces any
      delay above 2^31-1 ms back to 1ms — recreating the exact flood the floor prevents. Added
      `MAX_STATUS_CHECK_INTERVAL_MS = 2_147_483_647` and clamp to it.
      - Acceptance: an oversized value resolves to the Node timer maximum, not 1ms.
      - Verify: `npm test` in `server/` — extended the `resolveStatusCheckIntervalMs` block.
      - Files: `server/src/status-poller.ts`, `server/src/status-poller.spec.ts`.

- [x] 6.3 (Minor) `AppStatusService` used `Math.max(response.intervalMs, MIN_POLL_MS)` with no
      finite check — a misbehaving endpoint returning `null`/`NaN` would schedule `setTimeout(fn,
      NaN)` (near-immediate). Added a `Number.isFinite` guard that falls back to `MIN_POLL_MS`.
      - Acceptance: a non-finite reported interval schedules at `MIN_POLL_MS`, not immediately.
      - Verify: `ng test` — new test in `app-status.service.spec.ts`.
      - Files: `src/app/core/services/app-status.service.ts`, `.spec.ts`.

- [x] 6.4 (Minor) `AppStatusService` never released its timer/subscription if its injector was torn
      down (SSR, tests). Added `inject(DestroyRef).onDestroy(() => this.stop())`.
      - Acceptance: destroying the injector stops all polling.
      - Verify: `ng test` — new test in `app-status.service.spec.ts`.
      - Files: `src/app/core/services/app-status.service.ts`, `.spec.ts`.

Not changed (reviewed, no action):
- `statuses` is intentionally not cleared when an app is de-monitored — badges freeze by design and
  `AppCardComponent` hides them anyway once `healthCheck` is `false`.
- `CHANGELOG.md` stays pending until the feature is cut into its release (tasks 3.3); README already
  documents the field, env var, and behavior.

**Phase 5–6 exit check**: `ng test` (305 passing) and `server/`'s `npm test` (48 passing) both green;
`npx tsc -p server/tsconfig.json` clean; `ng lint` clean.

## Phase 7: Fourth Review Pass Fixes

- [x] 7.1 (Required — CI) `npm run format:check` (run in CI, `.github/workflows/test.yml`) failed on
      `app-status.service.spec.ts` — Prettier collapsed a multi-line `.flush(...)` call. Reformatted.
      - Verify: `npm run format:check` clean.
      - Files: `src/app/core/services/app-status.service.spec.ts`.

- [x] 7.2 (Required — a11y) The status badge failed WCAG 1.4.1: the up/down state was conveyed by
      colour alone, and the `<span role="img" aria-label>` was never announced because the parent
      `<button>` carries its own `aria-label` (which becomes the button's whole accessible name).
      Fixed both: the badge is now `aria-hidden` and decorative, with the state folded into the
      button's accessible name via a new `cardLabel` computed (`"Open Plex, currently up"`), and it
      carries a non-colour cue — the badge stays a circle in both states with a check glyph
      (`heroCheckMini`) for `up` and a cross (`heroXMarkMini`) for `down`. (An earlier attempt used a
      circle→diamond shape morph; rejected in review as jarring — a glyph in a constant circle is
      the conventional status-dot pattern.)
      - Acceptance: button name includes the state; up/down render different glyphs; AXE still clean.
      - Verify: `ng test` — updated badge tests in `app-card.component.spec.ts`.
      - Files: `src/app/shared/components/app-card/app-card.component.ts`, `.html`, `.spec.ts`.

- [x] 7.3 (Optional) `checkAppStatus`'s `{ timeout }` is a socket *inactivity* timeout — a server
      that drips bytes without ever completing its response headers keeps the socket active and
      evades it, contradicting the spec's "does not complete within the configured timeout". Added
      an overall deadline (`setTimeout` → `request.destroy()` → resolve `down`) alongside the socket
      timeout, cleared on settle.
      - Acceptance: a trickling server resolves `down` at the deadline, not never.
      - Verify: `npm test` in `server/` — new test in `status-checker.spec.ts` (raw `net` server).
      - Files: `server/src/status-checker.ts`, `server/src/status-checker.spec.ts`.

Not changed (reviewed, no action):
- Nit: once `MAX_RETRIES` is exhausted while apps stay monitored, recovery still needs a page
  reload — unchanged from the original design (Phase 5.1 already handles the de-monitor→re-monitor
  path). A still-monitored config re-emit hitting `start()`'s early-return is the documented,
  intended behavior.

**Phase 7 exit check**: `ng test` (306 passing) and `server/`'s `npm test` (49 passing) both green;
`npx tsc -p server/tsconfig.json` clean; `ng lint` clean; `npm run format:check` clean;
`ng build --configuration production` succeeds (pre-existing bundle-budget warning unchanged).
