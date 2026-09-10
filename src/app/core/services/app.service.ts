import { computed, Injectable, inject } from '@angular/core';

import { version } from '../../../../package.json';

import {
  DashboardConfig,
  SelfhostedApp,
  APP_CATEGORY,
  BOOKMARKS_CATEGORY,
  FAVORITES_CATEGORY,
} from '../models/dashboard.models';

import { ConfigService } from './config.service';
import { SearchService } from './search.service';
import { CategoryService } from './category.service';
import { BookmarkService } from './bookmark.service';
import { LoggerService } from './logger.service';

/**
 * Service for managing dashboard application state
 * Uses signals for synchronous application state.
 */
@Injectable({ providedIn: 'root' })
export class AppService {
  private configService = inject(ConfigService);
  private searchService = inject(SearchService);
  private categoryService = inject(CategoryService);
  private bookmarkService = inject(BookmarkService);
  private logger = inject(LoggerService);

  appVersion = version;

  /**
   * Observable streams for component consumption
   */
  readonly apps = computed(() => {
    const config = this.configService.config();
    if (!config) return [];
    return [
      ...config.applications,
      ...(config.settings.allowBookmarks
        ? this.bookmarkService.bookmarks().map((bookmark) => ({
            ...bookmark,
            category: BOOKMARKS_CATEGORY.id,
            favorite: false,
            healthCheck: false,
          }))
        : []
      ).sort((a, b) => a.name.localeCompare(b.name)),
    ];
  });

  /**
   * Computed: Filtered apps based on search and category
   */
  readonly filteredApps = computed<SelfhostedApp[] | undefined>(() => {
    if (!this.configService.config()) return undefined;
    return this.searchService.filterApps(
      this.apps(),
      this.searchService.searchQuery(),
      this.categoryService.selectedCategory(),
      this.searchService.haveSearch(),
    );
  });

  /**
   * Current config value (synchronous access)
   */
  get config(): DashboardConfig | undefined {
    return this.configService.config();
  }

  /**
   * Initialize with dashboard configuration
   * @param config - Dashboard configuration
   */
  initializeConfig(config: DashboardConfig): void {
    this.configService.fireNewSubject(config);
    this.logger.info('[AppService] Dashboard config initialized');
  }

  /**
   * Update search query
   * @param query - Search query string
   */
  setSearchQuery(query: string): void {
    this.searchService.setSearchQuery(query);
  }

  /**
   * Update selected category
   * @param categoryId - Category ID
   */
  setSelectedCategory(categoryId: string): void {
    this.categoryService.setSelectedCategory(categoryId);
  }

  /**
   * Get app by ID
   * @param appId - Application ID
   * @returns Application or undefined
   */
  getAppById(appId: string): SelfhostedApp | undefined {
    if (!this.config) return;

    return this.config.applications.find((app) => app.id === appId);
  }

  /**
   * Get apps by category
   * @param categoryId - Category ID
   * @returns Array of applications
   */
  getAppsByCategory(categoryId: string): SelfhostedApp[] {
    if (!this.config) return [];

    if (categoryId === APP_CATEGORY.id) {
      return this.config.applications;
    }

    if (categoryId === FAVORITES_CATEGORY.id) {
      return this.config.applications.filter((app) => app.favorite);
    }

    return this.config.applications.filter((app) => app.category === categoryId);
  }
}
