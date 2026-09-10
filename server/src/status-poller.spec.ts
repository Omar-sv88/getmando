import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { dump } from 'js-yaml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DashboardConfig } from '../../src/app/core/models/dashboard.models';

import {
  createStatusPoller,
  DEFAULT_STATUS_CHECK_INTERVAL_MS,
  MAX_STATUS_CHECK_INTERVAL_MS,
  MIN_STATUS_CHECK_INTERVAL_MS,
  resolveStatusCheckIntervalMs,
  StatusCheck,
} from './status-poller';

const configWith = (apps: { id: string; healthCheck: boolean }[]): DashboardConfig => ({
  metadata: { title: 'Mando', description: 'My Selfhosted Applications' },
  categories: [{ id: 'homelab', name: 'Homelab' }],
  applications: apps.map(({ id, healthCheck }) => ({
    id,
    name: `App ${id}`,
    description: '',
    url: `https://${id}.example.test`,
    icon: { type: 'name', value: id },
    category: 'homelab',
    openNewTab: true,
    tags: [],
    favorite: false,
    healthCheck,
  })),
  bookmarks: [],
  settings: {
    theme: 'dark',
    dateFormat: 'dd-MM-yyyy',
    datePosition: 'top',
    showSeconds: false,
    showDate: false,
    itemsPerRow: 4,
    allowBookmarks: false,
    showAllCategory: true,
    showDescriptions: true,
    showLabels: true,
    searchEngines: [],
    lightBackgroundImage: '',
    darkBackgroundImage: '',
  },
});

describe('createStatusPoller', () => {
  let dir: string;
  let configPath: string;
  let check: ReturnType<typeof vi.fn<StatusCheck>>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'status-poller-'));
    configPath = join(dir, 'dashboard.yaml');
    check = vi.fn(async () => ({ status: 'up' as const }));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  async function writeConfig(config: DashboardConfig): Promise<void> {
    await writeFile(configPath, dump(config), 'utf8');
  }

  it('runs an immediate check on start, before the first interval tick', async () => {
    await writeConfig(configWith([{ id: 'app1', healthCheck: true }]));
    const poller = createStatusPoller({ configPath, check });
    const startedAt = Date.now();

    poller.start(2_000);
    await vi.waitFor(() => expect(check).toHaveBeenCalledTimes(1));

    expect(Date.now() - startedAt).toBeLessThan(2_000);
    poller.stop();
  });

  it('only checks applications with healthCheck: true', async () => {
    await writeConfig(
      configWith([
        { id: 'monitored', healthCheck: true },
        { id: 'unmonitored', healthCheck: false },
      ]),
    );
    const poller = createStatusPoller({ configPath, check });
    poller.start(2_000);

    await vi.waitFor(() => expect(check).toHaveBeenCalled());

    expect(check.mock.calls.map(([url]) => url)).toEqual(['https://monitored.example.test']);
    expect(Object.keys(poller.getStatuses())).toEqual(['monitored']);
    poller.stop();
  });

  it('caches status and an ISO checkedAt per app id', async () => {
    await writeConfig(configWith([{ id: 'app1', healthCheck: true }]));
    const poller = createStatusPoller({ configPath, check });
    poller.start(2_000);

    await vi.waitFor(() => expect(Object.keys(poller.getStatuses())).toHaveLength(1));

    const statuses = poller.getStatuses();
    expect(statuses['app1']?.status).toBe('up');
    expect(new Date(statuses['app1']?.checkedAt ?? '').toISOString()).toBe(statuses['app1']?.checkedAt);
    poller.stop();
  });

  it('re-checks on every interval tick', async () => {
    await writeConfig(configWith([{ id: 'app1', healthCheck: true }]));
    const poller = createStatusPoller({ configPath, check });
    poller.start(50);

    await vi.waitFor(() => expect(check.mock.calls.length).toBeGreaterThanOrEqual(2), { timeout: 2_000 });

    poller.stop();
  });

  it('keeps the previous cache when CONFIG_PATH goes missing', async () => {
    await writeConfig(configWith([{ id: 'app1', healthCheck: true }]));
    const poller = createStatusPoller({ configPath, check });
    poller.start(60_000);
    await vi.waitFor(() => expect(Object.keys(poller.getStatuses())).toHaveLength(1));
    poller.stop();
    const cacheAfterFirstCycle = poller.getStatuses();
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    await unlink(configPath);
    poller.start(60_000);
    await vi.waitFor(() =>
      expect(errorLog).toHaveBeenCalledWith(expect.stringContaining(configPath), expect.anything()),
    );

    expect(poller.getStatuses()).toEqual(cacheAfterFirstCycle);
    poller.stop();
  });

  it('keeps the previous cache when CONFIG_PATH holds an invalid config', async () => {
    await writeConfig(configWith([{ id: 'app1', healthCheck: true }]));
    const poller = createStatusPoller({ configPath, check });
    poller.start(60_000);
    await vi.waitFor(() => expect(Object.keys(poller.getStatuses())).toHaveLength(1));
    poller.stop();
    const cacheAfterFirstCycle = poller.getStatuses();
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

    await writeFile(configPath, '{{{ not yaml', 'utf8');
    poller.start(60_000);
    await vi.waitFor(() =>
      expect(errorLog).toHaveBeenCalledWith(expect.stringContaining(configPath), expect.anything()),
    );

    expect(poller.getStatuses()).toEqual(cacheAfterFirstCycle);
    poller.stop();
  });

  it('keeps checking other apps and never crashes the cycle when one check rejects', async () => {
    await writeConfig(
      configWith([
        { id: 'broken', healthCheck: true },
        { id: 'fine', healthCheck: true },
      ]),
    );
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    const flaky: StatusCheck = vi.fn(async (url: string) => {
      if (url.includes('broken')) throw new Error('simulated check failure');
      return { status: 'up' as const };
    });
    const poller = createStatusPoller({ configPath, check: flaky });
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);

    poller.start(2_000);
    await vi.waitFor(() => expect(Object.keys(poller.getStatuses())).toEqual(['fine']));

    poller.stop();
    process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledWith(
      expect.stringContaining('status check threw unexpectedly'),
      expect.any(Error),
    );
  });

  it('forgets cached statuses for apps that are no longer monitored', async () => {
    await writeConfig(
      configWith([
        { id: 'app1', healthCheck: true },
        { id: 'app2', healthCheck: true },
      ]),
    );
    const poller = createStatusPoller({ configPath, check });
    poller.start(60_000);
    await vi.waitFor(() =>
      expect(Object.keys(poller.getStatuses()).sort()).toEqual(['app1', 'app2']),
    );
    poller.stop();

    // app2 loses its healthCheck flag — the next cycle must drop its stale entry.
    await writeConfig(
      configWith([
        { id: 'app1', healthCheck: true },
        { id: 'app2', healthCheck: false },
      ]),
    );
    poller.start(60_000);
    await vi.waitFor(() => expect(Object.keys(poller.getStatuses())).toEqual(['app1']));
    poller.stop();
  });

  it('never overlaps cycles when a check outlasts the interval', async () => {
    await writeConfig(
      configWith([
        { id: 'app1', healthCheck: true },
        { id: 'app2', healthCheck: true },
      ]),
    );
    let inFlight = 0;
    let maxInFlight = 0;
    const slow: StatusCheck = vi.fn(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 100));
      inFlight -= 1;
      return { status: 'up' as const };
    });
    const poller = createStatusPoller({ configPath, check: slow });

    poller.start(20); // far shorter than the 100ms check
    await new Promise((resolve) => setTimeout(resolve, 350));
    poller.stop();

    // Two apps checked in parallel within one cycle is expected; overlapping cycles would push
    // concurrency to 4+ and hammer each app several times over.
    expect(maxInFlight).toBeLessThanOrEqual(2);
  });

  it('keeps a de-monitored app pruned even when slow checks span several interval ticks', async () => {
    await writeConfig(
      configWith([
        { id: 'stays', healthCheck: true },
        { id: 'goes', healthCheck: true },
      ]),
    );
    const check: StatusCheck = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 80));
      return { status: 'up' as const };
    });
    const poller = createStatusPoller({ configPath, check });

    poller.start(20); // shorter than the 80ms check — cycles would overlap without the guard
    await vi.waitFor(() =>
      expect(Object.keys(poller.getStatuses()).sort()).toEqual(['goes', 'stays']),
    );

    // Without serialized cycles, a cycle that started before this rewrite could resolve its 'goes'
    // check after a newer cycle pruned it, re-inserting the stale entry.
    await writeConfig(
      configWith([
        { id: 'stays', healthCheck: true },
        { id: 'goes', healthCheck: false },
      ]),
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    poller.stop();

    expect(Object.keys(poller.getStatuses())).toEqual(['stays']);
  });

  it('does not leave a second interval running when start() is called twice', async () => {
    await writeConfig(configWith([{ id: 'app1', healthCheck: true }]));
    const poller = createStatusPoller({ configPath, check });
    poller.start(50);
    poller.start(50);

    await vi.waitFor(() => expect(check.mock.calls.length).toBeGreaterThanOrEqual(2), {
      timeout: 2_000,
    });
    poller.stop();

    const callsAfterStop = check.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 300)); // 6 ticks of the 50ms interval
    // A leaked second interval would add ~6 more calls; only a single in-flight cycle may still land.
    expect(check.mock.calls.length).toBeLessThanOrEqual(callsAfterStop + 1);
  });

  it('reports the configured interval, defaulting to 60s before start', () => {
    const poller = createStatusPoller({ configPath, check });

    expect(poller.getIntervalMs()).toBe(60_000);

    poller.start(2_000);
    expect(poller.getIntervalMs()).toBe(2_000);
    poller.stop();
  });
});

describe('resolveStatusCheckIntervalMs', () => {
  it('returns the default when the env var is unset or blank', () => {
    expect(resolveStatusCheckIntervalMs(undefined)).toBe(DEFAULT_STATUS_CHECK_INTERVAL_MS);
    expect(resolveStatusCheckIntervalMs('')).toBe(DEFAULT_STATUS_CHECK_INTERVAL_MS);
    expect(resolveStatusCheckIntervalMs('   ')).toBe(DEFAULT_STATUS_CHECK_INTERVAL_MS);
  });

  it('returns the default for a non-numeric value instead of NaN', () => {
    expect(resolveStatusCheckIntervalMs('30s')).toBe(DEFAULT_STATUS_CHECK_INTERVAL_MS);
    expect(resolveStatusCheckIntervalMs('abc')).toBe(DEFAULT_STATUS_CHECK_INTERVAL_MS);
  });

  it('clamps a value below the floor (including 0 and negatives) up to the minimum', () => {
    expect(resolveStatusCheckIntervalMs('0')).toBe(MIN_STATUS_CHECK_INTERVAL_MS);
    expect(resolveStatusCheckIntervalMs('50')).toBe(MIN_STATUS_CHECK_INTERVAL_MS);
    expect(resolveStatusCheckIntervalMs('-5')).toBe(MIN_STATUS_CHECK_INTERVAL_MS);
  });

  it('clamps an oversized value (which Node would coerce back to 1ms) down to the timer maximum', () => {
    expect(resolveStatusCheckIntervalMs('1e100')).toBe(MAX_STATUS_CHECK_INTERVAL_MS);
    expect(resolveStatusCheckIntervalMs(String(Number.MAX_SAFE_INTEGER))).toBe(
      MAX_STATUS_CHECK_INTERVAL_MS,
    );
  });

  it('passes a valid interval through unchanged', () => {
    expect(resolveStatusCheckIntervalMs('30000')).toBe(30_000);
  });
});
