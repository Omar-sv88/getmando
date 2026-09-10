import { Component, inject, input, output, ChangeDetectionStrategy, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { heroCheckMini, heroXMarkMini } from '@ng-icons/heroicons/mini';

import { SelfhostedApp } from '../../../core/models/dashboard.models';

import { AppStatusService } from '../../../core/services/app-status.service';
import { IconService } from '../../../core/services/icon.service';
import { SettingsService } from '../../../core/services/settings.service';

@Component({
  selector: 'app-card',
  standalone: true,
  imports: [CommonModule, NgIcon],
  templateUrl: 'app-card.component.html',
  host: {
    class: 'block',
  },
  viewProviders: [provideIcons({ heroCheckMini, heroXMarkMini })],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppCardComponent {
  private readonly settingsService = inject(SettingsService);
  private readonly settings = this.settingsService.settings;
  private readonly appStatusService = inject(AppStatusService);

  // Inputs
  readonly app = input.required<SelfhostedApp>();

  // Outputs
  readonly appClick = output<SelfhostedApp>();

  private readonly iconService = inject(IconService);

  /**
   * Get icon URL as computed signal
   */
  readonly iconUrl = computed(() => this.iconService.getIconUrl(this.app()));

  readonly showDescriptions = computed(() => this.settings().showDescriptions);
  readonly showLabels = computed(() => this.settings().showLabels);

  /**
   * Status badge for monitored apps — undefined while healthCheck is off or no check has run yet.
   */
  readonly status = computed(() =>
    this.app().healthCheck ? this.appStatusService.statuses()[this.app().id] : undefined,
  );

  /**
   * Accessible name for the card button. The status badge is a decorative (`aria-hidden`) visual —
   * an `aria-label` on the button would otherwise suppress it entirely for screen readers — so the
   * up/down state is folded into the button's own name instead.
   */
  readonly cardLabel = computed(() => {
    const status = this.status();
    const base = `Open ${this.app().name}`;
    return status ? `${base}, currently ${status.status}` : base;
  });

  /** Glyph shown inside the status badge — a non-colour cue (WCAG 1.4.1) alongside green/red. */
  readonly statusIcon = computed(() => {
    const status = this.status();
    if (!status) return undefined;
    return status.status === 'up' ? 'heroCheckMini' : 'heroXMarkMini';
  });

  /**
   * Open application
   */
  openApp(): void {
    const app = this.app();
    const target = app.openNewTab ? '_blank' : '_self';

    window.open(app.url, target);
    this.appClick.emit(app);
  }
}
