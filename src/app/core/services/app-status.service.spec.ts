import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DashboardConfig, DEFAULT_DASHBOARD_CONFIG } from '../models/dashboard.models';

import { ConfigService } from './config.service';
import { AppStatus, AppStatusService } from './app-status.service';

const STATUS_URL = '/api/status';

const upResponse = {
  intervalMs: 30_000,
  apps: { plex: { status: 'up' as const, checkedAt: '2026-01-01T00:00:00.000Z' } },
};

const configWith = (healthCheck: boolean): DashboardConfig => ({
  ...DEFAULT_DASHBOARD_CONFIG,
  applications: [
    {
      id: 'plex',
      name: 'Plex',
      description: '',
      url: 'https://plex.example.test',
      icon: { type: 'name', value: 'plex' },
      category: 'apps',
      openNewTab: true,
      tags: [],
      favorite: false,
      healthCheck,
    },
  ],
});

describe('AppStatusService', () => {
  let httpMock: HttpTestingController;
  let statuses: () => Record<string, AppStatus>;
  const configState = signal<DashboardConfig | undefined>(configWith(true));

  beforeEach(() => {
    vi.useFakeTimers();
    configState.set(configWith(true));
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ConfigService, useValue: { config: configState } },
      ],
    });
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    TestBed.resetTestingModule();
    vi.useRealTimers();
  });

  function createService(): void {
    const service = TestBed.inject(AppStatusService);
    TestBed.flushEffects();
    statuses = service.statuses;
  }

  function expectStatusRequest(): void {
    httpMock.expectOne(STATUS_URL);
  }

  it('makes one bootstrap request immediately on construction', () => {
    createService();

    expectStatusRequest();
    httpMock.verify();
  });

  it('makes no request at all while no application has healthCheck enabled', async () => {
    configState.set(configWith(false));

    createService();

    httpMock.verify();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    httpMock.verify();
    expect(statuses()).toEqual({});
  });

  it('makes no request while the configuration has not loaded yet', () => {
    configState.set(undefined);

    createService();

    httpMock.verify();
  });

  it('starts polling once the configuration gains a monitored application', async () => {
    configState.set(configWith(false));
    createService();

    configState.set(configWith(true));
    TestBed.flushEffects();

    httpMock.expectOne(STATUS_URL).flush(upResponse);
    expect(statuses()).toEqual(upResponse.apps);
  });

  it('stops polling once no application is monitored anymore, freezing last known statuses', async () => {
    createService();
    httpMock.expectOne(STATUS_URL).flush(upResponse);

    configState.set(configWith(false));
    TestBed.flushEffects();

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    httpMock.verify();
    expect(statuses()).toEqual(upResponse.apps);
  });

  it('cancels an in-flight poll on stop, so a stale response cannot start a second polling loop', async () => {
    createService();
    const staleRequest = httpMock.expectOne(STATUS_URL);

    // Stop while staleRequest is still in flight: it must be cancelled, not just ignored.
    configState.set(configWith(false));
    TestBed.flushEffects();
    expect(staleRequest.cancelled).toBe(true);

    // Start again before the stale request would have resolved.
    configState.set(configWith(true));
    TestBed.flushEffects();
    httpMock.expectOne(STATUS_URL).flush(upResponse);

    // If the stale response's handler had still run (the bug), it would have scheduled its own
    // extra timer alongside this one, and advancing time would surface two requests instead of one.
    await vi.advanceTimersByTimeAsync(29_999);
    httpMock.verify();
    await vi.advanceTimersByTimeAsync(1);
    httpMock.expectOne(STATUS_URL).flush(upResponse);
    httpMock.verify();
  });

  it('does not start a second polling loop when the config re-emits while still monitored', async () => {
    createService();
    httpMock.expectOne(STATUS_URL).flush(upResponse);

    // A fresh config object that still has a monitored app must not kick off a parallel poll.
    configState.set(configWith(true));
    TestBed.flushEffects();
    httpMock.verify();

    await vi.advanceTimersByTimeAsync(30_000);
    httpMock.expectOne(STATUS_URL).flush(upResponse);
  });

  it('stops polling when its injector is destroyed', async () => {
    createService();
    httpMock.expectOne(STATUS_URL).flush(upResponse); // schedules the next poll for 30s later
    const controller = httpMock;

    TestBed.resetTestingModule(); // fires DestroyRef.onDestroy

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    controller.verify(); // no further poll was fired after teardown
  });

  it('stores the response apps in the signal and reschedules at the reported intervalMs', async () => {
    createService();

    httpMock.expectOne(STATUS_URL).flush(upResponse);

    expect(statuses()).toEqual(upResponse.apps);

    await vi.advanceTimersByTimeAsync(29_999);
    httpMock.verify();

    await vi.advanceTimersByTimeAsync(1);
    expectStatusRequest();
  });

  it('floors a too-small reported interval at MIN_POLL_MS (5s)', async () => {
    createService();

    httpMock.expectOne(STATUS_URL).flush({ intervalMs: 1_000, apps: {} });

    await vi.advanceTimersByTimeAsync(4_999);
    httpMock.verify();

    await vi.advanceTimersByTimeAsync(1);
    expectStatusRequest();
  });

  it('falls back to MIN_POLL_MS when the server reports a non-finite intervalMs', async () => {
    createService();

    httpMock.expectOne(STATUS_URL).flush({ intervalMs: null as unknown as number, apps: {} });

    // A NaN would have fired setTimeout almost immediately; MIN_POLL_MS (5s) must be used instead.
    await vi.advanceTimersByTimeAsync(4_999);
    httpMock.verify();

    await vi.advanceTimersByTimeAsync(1);
    expectStatusRequest();
  });

  it('retries a failed poll after RETRY_INTERVAL_MS (15s), keeping the last known statuses', async () => {
    createService();
    httpMock.expectOne(STATUS_URL).flush(upResponse);

    await vi.advanceTimersByTimeAsync(30_000);
    httpMock.expectOne(STATUS_URL).flush({}, { status: 503, statusText: 'Service Unavailable' });

    expect(statuses()).toEqual(upResponse.apps);

    await vi.advanceTimersByTimeAsync(14_999);
    httpMock.verify();

    await vi.advanceTimersByTimeAsync(1);
    expectStatusRequest();
  });

  it('resumes interval-driven polling after a retry succeeds', async () => {
    createService();
    httpMock.expectOne(STATUS_URL).flush(upResponse);

    await vi.advanceTimersByTimeAsync(30_000);
    httpMock.expectOne(STATUS_URL).flush({}, { status: 503, statusText: 'Service Unavailable' });

    await vi.advanceTimersByTimeAsync(15_000);
    httpMock.expectOne(STATUS_URL).flush({ ...upResponse, intervalMs: 60_000 });

    await vi.advanceTimersByTimeAsync(59_999);
    httpMock.verify();

    await vi.advanceTimersByTimeAsync(1);
    expectStatusRequest();
  });

  it('stops polling for the rest of the page load after MAX_RETRIES consecutive failures', async () => {
    createService();

    // The bootstrap request plus MAX_RETRIES (4) retries all fail.
    httpMock.expectOne(STATUS_URL).error(new ProgressEvent('network error'));
    for (let attempt = 0; attempt < 4; attempt++) {
      await vi.advanceTimersByTimeAsync(15_000);
      httpMock.expectOne(STATUS_URL).error(new ProgressEvent('network error'));
    }

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    httpMock.verify();
    expect(statuses()).toEqual({});
  });

  it('restores the full retry budget when monitoring stops and later restarts', async () => {
    createService();

    // Exhaust every retry: the bootstrap request plus MAX_RETRIES (4) all fail, so polling stops.
    httpMock.expectOne(STATUS_URL).error(new ProgressEvent('network error'));
    for (let attempt = 0; attempt < 4; attempt++) {
      await vi.advanceTimersByTimeAsync(15_000);
      httpMock.expectOne(STATUS_URL).error(new ProgressEvent('network error'));
    }
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    httpMock.verify();

    // Monitoring drops and then comes back — a fresh polling session.
    configState.set(configWith(false));
    TestBed.flushEffects();
    configState.set(configWith(true));
    TestBed.flushEffects();

    // Its first poll fails but must still be retried (budget reset, not inherited as exhausted).
    httpMock.expectOne(STATUS_URL).error(new ProgressEvent('network error'));
    await vi.advanceTimersByTimeAsync(15_000);
    httpMock.expectOne(STATUS_URL).flush(upResponse);
    expect(statuses()).toEqual(upResponse.apps);
  });

  it('can still retry after an earlier recovered failure (retry count resets on success)', async () => {
    createService();
    httpMock.expectOne(STATUS_URL).flush(upResponse);

    await vi.advanceTimersByTimeAsync(30_000);
    httpMock.expectOne(STATUS_URL).error(new ProgressEvent('network error'));

    await vi.advanceTimersByTimeAsync(15_000);
    httpMock.expectOne(STATUS_URL).flush(upResponse);

    await vi.advanceTimersByTimeAsync(30_000);
    httpMock.expectOne(STATUS_URL).error(new ProgressEvent('network error'));

    await vi.advanceTimersByTimeAsync(15_000);
    expectStatusRequest();
  });
});
