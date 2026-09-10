import { readFile } from 'node:fs/promises';

import { load } from 'js-yaml';

import { DashboardConfigSchema } from '../../src/app/core/models/dashboard.models';

import { checkAppStatus } from './status-checker';

export const DEFAULT_STATUS_CHECK_INTERVAL_MS = 60_000;
export const DEFAULT_CHECK_TIMEOUT_MS = 5_000;
/** Absolute floor for the poll interval — guards against a misconfigured tiny value (or `0`/`NaN`
 * from a non-numeric env var) turning the check loop into a request flood against monitored apps. */
export const MIN_STATUS_CHECK_INTERVAL_MS = 1_000;
/** Ceiling for the poll interval: Node coerces a `setInterval` delay above 2^31-1 ms back to 1ms,
 * so an oversized value (`STATUS_CHECK_INTERVAL_MS=1e100`) would produce the very flood the floor
 * exists to prevent. Clamp anything larger down into the range Node's timers handle. */
export const MAX_STATUS_CHECK_INTERVAL_MS = 2_147_483_647;

/**
 * Turns a raw `STATUS_CHECK_INTERVAL_MS` env value into a usable interval: the default when unset or
 * non-numeric (`Number('30s')` is `NaN`, `Number('')` is `0`), otherwise clamped into
 * `[MIN_STATUS_CHECK_INTERVAL_MS, MAX_STATUS_CHECK_INTERVAL_MS]`.
 */
export function resolveStatusCheckIntervalMs(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_STATUS_CHECK_INTERVAL_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return DEFAULT_STATUS_CHECK_INTERVAL_MS;
  return Math.min(Math.max(parsed, MIN_STATUS_CHECK_INTERVAL_MS), MAX_STATUS_CHECK_INTERVAL_MS);
}

export interface CachedAppStatus {
  status: 'up' | 'down';
  checkedAt: string;
}

export type StatusCheck = typeof checkAppStatus;

export interface StatusPollerOptions {
  configPath: string;
  check?: StatusCheck;
  checkTimeoutMs?: number;
}

export interface StatusPoller {
  /** Runs one cycle immediately, then re-reads and re-checks every `intervalMs`. */
  start(intervalMs: number): void;
  stop(): void;
  /** Snapshot of the latest results, keyed by app id. */
  getStatuses(): Record<string, CachedAppStatus>;
  getIntervalMs(): number;
}

/**
 * Re-reads `CONFIG_PATH` from disk every cycle (so edits made outside the write API are picked
 * up with no state to keep in sync), checks every `healthCheck: true` application in parallel,
 * and caches `{ status, checkedAt }` per app id in memory. A missing or invalid config file
 * keeps the previous cache and logs — a transient bad read never clears known statuses.
 */
export function createStatusPoller({
  configPath,
  check = checkAppStatus,
  checkTimeoutMs = DEFAULT_CHECK_TIMEOUT_MS,
}: StatusPollerOptions): StatusPoller {
  const cache = new Map<string, CachedAppStatus>();
  let intervalMs = DEFAULT_STATUS_CHECK_INTERVAL_MS;
  let timer: NodeJS.Timeout | undefined;
  let cycleInProgress = false;

  async function runCycle(): Promise<void> {
    // Serialize cycles: if a check outlasts the interval (interval < per-check timeout), the next
    // tick is skipped rather than piling concurrent checks on the same apps — and, crucially, a
    // stale cycle can never resolve after a newer one and re-insert an app the newer cycle pruned.
    if (cycleInProgress) return;
    cycleInProgress = true;
    try {
      await runCycleOnce();
    } finally {
      cycleInProgress = false;
    }
  }

  async function runCycleOnce(): Promise<void> {
    let applications;
    try {
      applications = DashboardConfigSchema.parse(load(await readFile(configPath, 'utf8'))).applications;
    } catch (error) {
      console.error(
        `[status-poller] could not read or parse ${configPath}; keeping previous statuses`,
        error,
      );
      return;
    }

    const monitored = applications.filter((application) => application.healthCheck);

    // Drop cached entries for apps that are no longer monitored (healthCheck turned off, or the app
    // removed) so GET /api/status never reports a stale status for something we've stopped checking.
    const monitoredIds = new Set(monitored.map((application) => application.id));
    for (const id of cache.keys()) {
      if (!monitoredIds.has(id)) cache.delete(id);
    }

    // allSettled, not all: one app's check misbehaving must never stop the others from updating,
    // and must never make this cycle (or the poller) reject.
    const results = await Promise.allSettled(
      monitored.map(async (application) => {
        const { status } = await check(application.url, checkTimeoutMs);
        cache.set(application.id, { status, checkedAt: new Date().toISOString() });
      }),
    );
    for (const result of results) {
      if (result.status === 'rejected') {
        console.error('[status-poller] a status check threw unexpectedly', result.reason);
      }
    }
  }

  /** runCycle() is never awaited by its callers — this guarantees it can never crash the process
   * via an unhandled rejection, even if something above this function's own safeguards fails. */
  function runCycleSafely(): void {
    runCycle().catch((error: unknown) => {
      console.error('[status-poller] a poll cycle failed unexpectedly', error);
    });
  }

  return {
    start(startedIntervalMs: number): void {
      // Clear any existing timer first, so a second start() can never leave an orphaned interval
      // running alongside the new one.
      if (timer !== undefined) clearInterval(timer);
      intervalMs = startedIntervalMs;
      runCycleSafely();
      timer = setInterval(runCycleSafely, intervalMs);
    },

    stop(): void {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    },

    getStatuses(): Record<string, CachedAppStatus> {
      return Object.fromEntries(cache);
    },

    getIntervalMs(): number {
      return intervalMs;
    },
  };
}
