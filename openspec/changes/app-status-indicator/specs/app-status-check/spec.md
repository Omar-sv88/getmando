# App Status Check Specification

## Purpose

Let users see, at a glance, whether an opted-in self-hosted app is reachable, by checking it from the
server (not the viewer's browser) and exposing the cached result over a read-only endpoint the
dashboard polls.

## Requirements

### Requirement: Opt-in per app

The system MUST support a `healthCheck` boolean field on each application, defaulting to `false`.
Only applications with `healthCheck: true` MUST be checked.

#### Scenario: Default parsing
- GIVEN an application without `healthCheck` in YAML
- WHEN the config is parsed
- THEN `healthCheck` equals `false`
- AND the application is never checked

#### Scenario: Opted-in application is checked
- GIVEN an application with `healthCheck: true`
- WHEN a poll cycle runs
- THEN a check request is made to the application's `url`

### Requirement: Reachability check semantics

The system MUST treat any HTTP response, regardless of status code, as `up`. The system MUST treat a
network-level failure (connection refused, reset, DNS failure) or a request whose response headers
do not arrive within the configured timeout — measured as a total deadline, not merely socket
inactivity — as `down`. The system MUST accept self-signed or otherwise invalid TLS
certificates for this check specifically, without weakening TLS verification for any other request in
the process.

#### Scenario: Any status code counts as up
- GIVEN an app that responds with `401`
- WHEN it is checked
- THEN its status is `up`

#### Scenario: Connection failure counts as down
- GIVEN an app whose port refuses connections
- WHEN it is checked
- THEN its status is `down`

#### Scenario: Timeout counts as down
- GIVEN an app that never responds
- WHEN the per-check timeout elapses
- THEN its status is `down`

#### Scenario: A trickling response still times out
- GIVEN an app that keeps the connection active but never completes its response headers
- WHEN the per-check timeout elapses
- THEN its status is `down` (the timeout is a total deadline, not just an idle timeout)

#### Scenario: Self-signed certificate does not count as down
- GIVEN an HTTPS app serving a self-signed certificate
- WHEN it is checked
- THEN its status is `up`

### Requirement: Background polling independent of write access

The system MUST run checks on a recurring interval (`STATUS_CHECK_INTERVAL_MS`, default `60000`)
regardless of whether `CONFIG_WRITE_TOKEN` is configured. The system MUST NOT require a valid write
token to serve status results.

#### Scenario: Status checks run without a write token
- GIVEN the sidecar starts with no `CONFIG_WRITE_TOKEN` set
- WHEN a poll cycle elapses
- THEN opted-in apps are still checked
- AND `GET /api/status` still returns their results

### Requirement: One app's check failure never affects another app or the sidecar itself

A failure while checking one application — including an unexpected exception, not just a network
error already covered by "Reachability check semantics" — MUST NOT prevent other applications from
being checked in the same cycle, and MUST NOT crash or otherwise interrupt the sidecar process.

#### Scenario: One app's check throws unexpectedly
- GIVEN two `healthCheck: true` apps, where checking one raises an unexpected exception
- WHEN a poll cycle runs
- THEN the other app is still checked and its result is cached
- AND the sidecar process keeps running and continues serving `POST /api/config` and `GET /api/status`

### Requirement: Status endpoint

The system MUST expose `GET /api/status`, unauthenticated, returning the current cached results and
the configured check interval. The system MUST NOT include an application's `url` or any other
configuration field in the response. The system MUST drop a cached result once its application is no
longer monitored (`healthCheck` set to `false`, or the application removed), so the response only
ever contains currently-monitored applications.

The system MUST derive the check interval from `STATUS_CHECK_INTERVAL_MS`, falling back to the
default (`60000`) when it is unset or not a finite number, and clamping it into a bounded range — a
minimum floor so a small or zero value cannot produce a sub-second check loop, and a maximum ceiling
within the range the platform's timers support so an oversized value cannot wrap around to one.

The system MUST NOT run poll cycles concurrently: if a cycle is still in progress when the next is
due, that tick is skipped. This keeps a stale cycle from re-caching an application that a later cycle
has already dropped.

#### Scenario: Response shape
- GIVEN at least one `healthCheck: true` app has been checked
- WHEN `GET /api/status` is called
- THEN the response is `200` with `{ intervalMs, apps: { [appId]: { status, checkedAt } } }`
- AND no `url` or other config field appears anywhere in the response

#### Scenario: Response before any check has completed
- GIVEN the sidecar has just started and no poll cycle has completed yet
- WHEN `GET /api/status` is called
- THEN the response is `200` with an empty `apps` object

#### Scenario: A de-monitored app drops out of the response
- GIVEN an app with `healthCheck: true` that has been checked and cached
- WHEN its `healthCheck` is set to `false` (or it is removed) and the next poll cycle runs
- THEN `GET /api/status` no longer includes that app id

#### Scenario: Malformed check interval falls back to the default
- GIVEN `STATUS_CHECK_INTERVAL_MS` is set to a non-numeric value such as `30s`
- WHEN the sidecar starts
- THEN the check interval is the default `60000`, not `NaN` or `0`

### Requirement: Frontend poll cadence tracks the server's interval

The system MUST derive its polling interval from the server's reported `intervalMs` rather than a
hardcoded frontend constant, and MUST perform an initial request before scheduling any recurring poll.

#### Scenario: Frontend adopts the reported interval
- GIVEN `GET /api/status` reports `intervalMs: 30000`
- WHEN the frontend schedules its next poll
- THEN it waits 30000ms (or `MIN_POLL_MS`, whichever is greater) before polling again

### Requirement: Bounded retry on failure

The system MUST retry a failed poll at a flat interval (`RETRY_INTERVAL_MS`) up to a fixed number of
attempts (`MAX_RETRIES`), and MUST stop polling entirely for the rest of that page's lifetime once all
retries are exhausted, rather than retrying indefinitely.

#### Scenario: Recovery within the retry window
- GIVEN a poll fails and a retry is scheduled
- WHEN a subsequent retry within `MAX_RETRIES` succeeds
- THEN normal interval-driven polling resumes
- AND the retry count resets

#### Scenario: Retries exhausted
- GIVEN `MAX_RETRIES` consecutive polls have failed
- WHEN the last retry's delay elapses
- THEN no further request is scheduled
- AND previously known statuses remain displayed unchanged

### Requirement: Frontend polls only while an application is monitored

The frontend MUST NOT poll `GET /api/status` while no application in the loaded configuration has
`healthCheck: true`, and MUST start or stop polling reactively as that set changes, without
requiring a page reload.

#### Scenario: No monitored applications
- GIVEN the loaded configuration has no application with `healthCheck: true`
- WHEN the dashboard is open
- THEN no request to `GET /api/status` is ever made

#### Scenario: Configuration gains a monitored application
- GIVEN no application was monitored and no polling was happening
- WHEN the loaded configuration changes to include one `healthCheck: true` application
- THEN polling starts immediately, without a page reload

#### Scenario: An in-flight poll is cancelled when monitoring stops
- GIVEN a poll request is in flight
- WHEN the configuration changes to have no monitored applications before that request resolves
- THEN the request is cancelled
- AND its response, if any, MUST NOT be used to schedule a further poll

### Requirement: Status badge is accessible

The status badge MUST NOT convey up/down by colour alone (WCAG 1.4.1) and MUST expose the state to
assistive technology. The badge element itself is decorative; the state is carried in the app card's
accessible name and by a non-colour visual cue.

#### Scenario: State is in the accessible name
- GIVEN a monitored app whose last check was `up`
- WHEN a screen reader reads the app card's activator
- THEN the state (`up`/`down`) is part of its accessible name

#### Scenario: Non-colour visual cue
- GIVEN two monitored apps, one `up` and one `down`
- WHEN their badges are rendered
- THEN the badges show a different glyph (e.g. check vs cross), not only a different colour
