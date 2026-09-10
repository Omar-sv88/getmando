# Proposal: App Status Indicator

## Intent

Show a live up/down indicator (a small green/red dot) on each app card, so users can tell at a
glance which self-hosted services are reachable without running a separate monitoring tool. Checks
run server-side, from the existing `config-write-api` sidecar, rather than from each viewer's
browser — a client-side check would fail against most self-hosted apps due to CORS and
mixed-content restrictions, and would tell you about the viewer's network reachability rather than
the dashboard host's.

## Scope

### In Scope
- Opt-in per app: a new `healthCheck` boolean field (default `false`) on `SelfhostedAppSchema`.
- A background poller in the sidecar that periodically checks the `url` of every app with
  `healthCheck: true` and caches the result in memory (`up` / `down`, last-checked timestamp).
- "Up" means any HTTP response is received (2xx through 5xx) — many self-hosted apps redirect to a
  login page or return 401/403 while perfectly healthy, so only a network-level failure (timeout,
  connection refused/reset, DNS failure) counts as "down".
- A new unauthenticated `GET /api/status` route exposing the cached results as JSON — read-only,
  mirrors the existing public `GET /config/dashboard.yaml`.
- The poller runs independently of `CONFIG_WRITE_TOKEN` — a read-only dashboard (no write token
  configured) still gets status checks; this revises `server/src/index.ts`'s current hard exit when
  the token is unset.
- A single global check interval via an environment variable (e.g. `STATUS_CHECK_INTERVAL_MS`),
  applied to every monitored app — no per-app interval in v1.
- Frontend: `AppCardComponent` renders a small corner badge (green/red) for apps with `healthCheck`
  enabled, driven by a new service that polls `GET /api/status` (at the cadence the endpoint
  reports — see `design.md`).
- The configurator exposes the `healthCheck` toggle when editing an app.

### Out of Scope
- Per-app custom check interval, custom health-check path, or HTTP method override — v1 always
  checks the app's own `url`.
- Uptime history, response-time graphs, or alerting/notifications. The cache is in-memory only and
  resets on sidecar restart; no database is introduced.
- Status for bookmarks — bookmarks are arbitrary external links and are never monitored.
- An explicit toggle for self-signed/invalid TLS certificates — resolved in `design.md`: the
  status-check request always skips verification (`rejectUnauthorized: false`), with no per-app
  toggle, since many homelab apps serve HTTPS with self-signed certs.
- Any change to `POST /api/config`'s existing behavior.

## Capabilities

### New Capabilities
- `app-status-check`: periodically checks reachability of opted-in apps and exposes cached results
  over `GET /api/status`.

### Modified Capabilities
- `config-write-api` sidecar: gains a background poller and a second route; startup no longer
  strictly requires `CONFIG_WRITE_TOKEN` to be useful (status checks work without it).
- `yaml-configurator` / dashboard UI: `AppCardComponent` renders a status dot; the app editor form
  exposes the new `healthCheck` toggle.

## Approach

Extend the existing sidecar process (no new container — consistent with the single-image model
established in `config-write-api`) with an in-memory poller: on startup, and every
`STATUS_CHECK_INTERVAL_MS`, issue a short-timeout HTTP request to the `url` of every application
flagged `healthCheck: true` in the currently loaded config, and store `{ status, checkedAt }` per
app id in memory. `GET /api/status` returns this cache as JSON, unauthenticated, along with the
sidecar's own `intervalMs`. The frontend polls this endpoint at that reported cadence and renders a
small badge on `AppCardComponent` — green for up, red for down, no badge before the first check
completes or when `healthCheck` isn't set.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `src/app/core/models/dashboard.models.ts` | Modified | New `healthCheck` boolean field (default `false`) on `SelfhostedAppSchema` |
| `server/src/` | New | Poller/scheduler, in-memory status cache, `GET /api/status` route |
| `server/src/index.ts` | Modified | Decouple sidecar startup from requiring `CONFIG_WRITE_TOKEN` |
| `src/app/core/services/` | New | Status-polling service exposing a signal keyed by app id |
| `src/app/shared/components/app-card/` | Modified | Status dot rendering |
| `src/app/features/configurator/` | Modified | `healthCheck` toggle in the app editor form |
| `README.md`, `CHANGELOG.md` | Modified | New env var and new YAML field documented |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Polling floods a fragile/embedded device (router, IoT sensor) | Medium | Opt-in per app, default off; short per-request timeout; single low-frequency global interval for v1 |
| Self-signed certs on HTTPS apps make every check fail | High | Resolved (`design.md`): TLS verification is disabled for the status-check request specifically (`rejectUnauthorized: false`), never for any other request |
| Sidecar's network reach differs from the viewer's browser (container can reach an app the viewer can't, or vice versa) | Medium | Document as a known limitation: status reflects reachability from the dashboard host's network, not the viewer's |
| In-memory-only cache means a sidecar restart briefly shows every monitored app as unknown | Low | Accepted per Out of Scope — no persistence in v1 |
| Decoupling from `CONFIG_WRITE_TOKEN` changes existing sidecar startup behavior | Low | Purely additive — read-only deployments gain a capability; nothing currently working stops working |

## Rollback Plan

Remove the poller/scheduler and `GET /api/status` route from the sidecar, revert
`server/src/index.ts`'s startup gating, drop the `healthCheck` schema field, and remove status-dot
rendering from `AppCardComponent` and the configurator's app editor. `DashboardConfigSchema` objects
are non-strict, so existing YAML files with `healthCheck: true` continue to parse (the field is
silently dropped) if this is rolled back — no data migration needed either direction.

## Dependencies

No new frontend dependency. The sidecar uses Node 20's built-in `fetch`/`http`/`https` for checks —
no new npm package required for the HTTP calls; `setInterval` is sufficient for scheduling, so no
new scheduling dependency either.

## Success Criteria

- [ ] An app with `healthCheck: true` shows a green badge when reachable and red when not, with the
      check performed by the sidecar, not the viewer's browser.
- [ ] Apps without `healthCheck` set show no status badge.
- [ ] `GET /api/status` returns results without `CONFIG_WRITE_TOKEN` being configured.
- [ ] A down app (connection refused/timeout/DNS failure) shows red; an app returning any HTTP
      response (even 401/500) shows green.
- [ ] Existing `POST /api/config` behavior is unaffected.
- [ ] Ships in the first release after v2.0.0: on that release,
      `specs/app-status-check/spec.md` is promoted into `openspec/specs/`, the `config-write-api`
      spec is updated for the new route and the decoupled startup, and this change is archived.

## Resolved Questions

Developed in parallel with v2.0.0; all three were settled in design review and are recorded in full
in `design.md` (§ Architecture Decisions, § Decisions).

- Self-signed/invalid TLS certificates: verification is disabled for the status-check request only
  (`rejectUnauthorized: false` on that request, never process-wide).
- HEAD vs GET: GET — HEAD is unreliably implemented across self-hosted apps, and the body is never
  read either way.
- Default `STATUS_CHECK_INTERVAL_MS` is `60000` ms; default per-check timeout is `5000` ms.
