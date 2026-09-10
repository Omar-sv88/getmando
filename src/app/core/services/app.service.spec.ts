import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { AppService } from './app.service';
import { ConfigService } from './config.service';
import { BookmarkService } from './bookmark.service';
import { SearchService } from './search.service';
import { CategoryService } from './category.service';
import { YamlLoaderService } from './yaml-loader.service';

import {
  APP_CATEGORY,
  BOOKMARKS_CATEGORY,
  FAVORITES_CATEGORY,
  DashboardConfig,
  DEFAULT_DASHBOARD_CONFIG,
  SelfhostedApp,
} from '../models/dashboard.models';

describe('AppService', () => {
  let service: AppService;
  let configState: ReturnType<typeof signal<DashboardConfig | undefined>>;
  let searchService: SearchService;
  let categoryService: CategoryService;
  let loadDashboardConfig: ReturnType<typeof vi.fn>;

  const createConfig = (overrides: Partial<DashboardConfig> = {}): DashboardConfig => ({
    ...DEFAULT_DASHBOARD_CONFIG,
    ...overrides,
  });

  beforeEach(() => {
    configState = signal<DashboardConfig | undefined>(createConfig());
    loadDashboardConfig = vi.fn();

    TestBed.configureTestingModule({
      providers: [
        AppService,
        SearchService,
        CategoryService,
        {
          provide: ConfigService,
          useValue: {
            config: configState.asReadonly(),
            fireNewSubject: (config: DashboardConfig) => configState.set(config),
          },
        },
        {
          provide: YamlLoaderService,
          useValue: { loadDashboardConfig },
        },
        {
          provide: BookmarkService,
          useValue: {
            bookmarks: signal([]),
          },
        },
      ],
    });

    service = TestBed.inject(AppService);
    searchService = TestBed.inject(SearchService);
    categoryService = TestBed.inject(CategoryService);
  });

  it('performs no YAML I/O when constructed', () => {
    expect(service).toBeTruthy();
    expect(loadDashboardConfig).not.toHaveBeenCalled();
  });

  describe('apps$', () => {
    it('publishes configured applications without bookmarks when bookmarks are disabled', () => {
      const app = {
        id: 'plex',
        name: 'Plex',
        description: '',
        url: 'https://plex.example.com',
        icon: { type: 'name' as const, value: 'plex' },
        category: 'media',
        openNewTab: true,
        tags: [],
        favorite: false,
        healthCheck: false,
      };
      configState.set(createConfig({ applications: [app] }));

      expect(service.apps()).toEqual([app]);
      expect(service.config).toBe(configState());
    });
    it('should assign favorite: false to bookmarks when allowBookmarks is true', async () => {
      const bookmarkServiceMock = TestBed.inject(BookmarkService);
      (
        bookmarkServiceMock as unknown as { bookmarks: ReturnType<typeof signal<unknown[]>> }
      ).bookmarks.set([
        {
          id: 'google',
          name: 'Google',
          description: 'Search engine',
          url: 'https://google.com',
          icon: { type: 'name', value: 'google' },
          openNewTab: true,
          tags: [],
        },
      ]);

      configState.set(
        createConfig({
          applications: [],
          bookmarks: [
            {
              id: 'google',
              name: 'Google',
              description: 'Search engine',
              url: 'https://google.com',
              icon: { type: 'name', value: 'google' },
              openNewTab: true,
              tags: [],
            },
          ],
          settings: {
            ...DEFAULT_DASHBOARD_CONFIG.settings,
            allowBookmarks: true,
          },
        }),
      );

      const apps = service.apps();
      expect(apps).toHaveLength(1);
      expect(apps[0].favorite).toBe(false);
      expect(apps[0].category).toBe(BOOKMARKS_CATEGORY.id);
    });
  });

  it('delegates search and category setters', () => {
    const searchSpy = vi.spyOn(searchService, 'setSearchQuery');
    const categorySpy = vi.spyOn(categoryService, 'setSelectedCategory');

    service.setSearchQuery('plex');
    service.setSelectedCategory('media');

    expect(searchSpy).toHaveBeenCalledWith('plex');
    expect(categorySpy).toHaveBeenCalledWith('media');
  });

  it('delegates filtering with the current app, query, category, and search state', () => {
    const filterSpy = vi.spyOn(searchService, 'filterApps').mockReturnValue([]);
    searchService.setSearchQuery('plex');
    categoryService.setSelectedCategory('media');

    expect(service.filteredApps()).toEqual([]);
    expect(filterSpy).toHaveBeenCalledWith(service.apps(), 'plex', 'media', true);
  });

  it('finds configured apps by id and returns undefined for missing ids', () => {
    const app = {
      id: 'plex',
      name: 'Plex',
      description: '',
      url: 'https://plex.example.com',
      icon: { type: 'name' as const, value: 'plex' },
      category: 'media',
      openNewTab: true,
      tags: [],
      favorite: false,
      healthCheck: false,
    };
    configState.set(createConfig({ applications: [app] }));

    expect(service.getAppById('plex')).toBe(app);
    expect(service.getAppById('missing')).toBeUndefined();
    expect(service.getAppsByCategory('media')).toEqual([app]);
  });

  describe('getAppsByCategory', () => {
    it('should return only favorite apps when categoryId is FAVORITES_CATEGORY.id', () => {
      configState.set(
        createConfig({
          applications: [
            {
              id: 'plex',
              name: 'Plex',
              description: '',
              url: 'https://plex.example.com',
              icon: { type: 'name', value: 'plex' },
              category: 'media',
              openNewTab: true,
              tags: [],
              favorite: true,
              healthCheck: false,
            },
            {
              id: 'radarr',
              name: 'Radarr',
              description: '',
              url: 'https://radarr.example.com',
              icon: { type: 'name', value: 'radarr' },
              category: 'media',
              openNewTab: true,
              tags: [],
              favorite: false,
              healthCheck: false,
            },
          ],
        }),
      );

      const apps = service.getAppsByCategory(FAVORITES_CATEGORY.id);
      expect(apps).toHaveLength(1);
      expect(apps[0].id).toBe('plex');
    });

    it('should return all apps for APP_CATEGORY regardless of favorite status', () => {
      configState.set(
        createConfig({
          applications: [
            {
              id: 'plex',
              name: 'Plex',
              description: '',
              url: 'https://plex.example.com',
              icon: { type: 'name', value: 'plex' },
              category: 'media',
              openNewTab: true,
              tags: [],
              favorite: true,
              healthCheck: false,
            },
            {
              id: 'radarr',
              name: 'Radarr',
              description: '',
              url: 'https://radarr.example.com',
              icon: { type: 'name', value: 'radarr' },
              category: 'media',
              openNewTab: true,
              tags: [],
              favorite: false,
              healthCheck: false,
            },
          ],
        }),
      );

      const apps = service.getAppsByCategory(APP_CATEGORY.id);
      expect(apps).toHaveLength(2);
    });
  });
});
