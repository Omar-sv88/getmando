import { HttpClient } from '@angular/common/http';
import { DestroyRef, effect, inject, Injectable, signal, Signal } from '@angular/core';
import { Subscription } from 'rxjs';

import { DashboardConfig } from '../models/dashboard.models';

import { ConfigService } from './config.service';

export interface AppStatus {
  status: 'up' | 'down';
  checkedAt: string;
}

interface StatusResponse {
  intervalMs: number;
  apps: Record<string, AppStatus>;
}

const STATUS_URL = '/api/status';
/** Floor applied to a received intervalMs (a sanity clamp, not a startup default). */
const MIN_POLL_MS = 5_000;
/** Flat delay between retries after a failed poll. */
const RETRY_INTERVAL_MS = 15_000;
/** After this many consecutive failed retries, polling stops for the rest of the page load. */
const MAX_RETRIES = 4;

/**
 * Polls the sidecar's `GET /api/status` and exposes the cached results as a signal keyed by app
 * id. Polling runs only while at least one application in the loaded configuration has
 * `healthCheck: true` — there is nothing to fetch otherwise — and starts/stops reactively as the
 * configuration changes.
 *
 * There is no hardcoded poll interval: a bootstrap request learns the sidecar's `intervalMs`
 * before anything recurring is scheduled, and every successful poll reschedules at that cadence.
 * A failed poll retries at a flat `RETRY_INTERVAL_MS` for up to `MAX_RETRIES` attempts — statuses
 * keep their last known values throughout — and once all retries fail, polling stops entirely
 * until the page is reloaded.
 */
@Injectable({ providedIn: 'root' })
export class AppStatusService {
  private readonly http = inject(HttpClient);
  private readonly configService = inject(ConfigService);
  private readonly statusesSignal = signal<Record<string, AppStatus>>({});
  private retries = 0;
  private active = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pollSubscription: Subscription | null = null;

  readonly statuses: Signal<Record<string, AppStatus>> = this.statusesSignal.asReadonly();

  constructor() {
    effect(() => {
      if (this.hasMonitoredApplications()) {
        this.start();
      } else {
        this.stop();
      }
    });
    // Root-scoped, so this normally lives for the whole page — but clean up the timer and any
    // in-flight request if the injector is torn down (SSR, tests).
    inject(DestroyRef).onDestroy(() => this.stop());
  }

  private hasMonitoredApplications(): boolean {
    const config = this.configService.config();
    return applicationsOf(config).some((application) => application.healthCheck);
  }

  private start(): void {
    if (this.active) return;
    this.active = true;
    this.poll();
  }

  private stop(): void {
    this.active = false;
    // Reset the retry counter: a later start() (config regained a monitored app) is a fresh polling
    // session and must get the full retry budget again, not inherit an exhausted count.
    this.retries = 0;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    // Cancels a poll that's still in flight — without this, a stale response arriving after a
    // stop()-then-start() cycle would be mistaken for current and schedule a second, orphaned
    // polling loop alongside the new one.
    this.pollSubscription?.unsubscribe();
    this.pollSubscription = null;
  }

  private poll(): void {
    this.pollSubscription = this.http.get<StatusResponse>(STATUS_URL).subscribe({
      next: (response) => {
        this.statusesSignal.set(response.apps);
        this.retries = 0;
        // Guard against a non-finite intervalMs (a misbehaving endpoint): Math.max(NaN, x) is NaN
        // and setTimeout(fn, NaN) fires almost immediately. The server already clamps its own value.
        const reported = Number.isFinite(response.intervalMs) ? response.intervalMs : MIN_POLL_MS;
        this.scheduleNext(Math.max(reported, MIN_POLL_MS));
      },
      error: () => {
        this.retries += 1;
        if (this.retries <= MAX_RETRIES) {
          this.scheduleNext(RETRY_INTERVAL_MS);
        }
        // Retries exhausted: stop polling for this page load; badges keep their last known value.
      },
    });
  }

  private scheduleNext(delayMs: number): void {
    this.timer = setTimeout(() => this.poll(), delayMs);
  }
}

function applicationsOf(config: DashboardConfig | undefined): DashboardConfig['applications'] {
  return config?.applications ?? [];
}
