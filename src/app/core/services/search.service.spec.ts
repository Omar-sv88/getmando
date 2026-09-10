import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { SearchService } from './search.service';
import { ConfigService } from './config.service';

import {
  APP_CATEGORY,
  BOOKMARKS_CATEGORY,
  DashboardConfig,
  DEFAULT_DASHBOARD_CONFIG,
  FAVORITES_CATEGORY,
  SelfhostedApp,
} from '../models/dashboard.models';

describe('SearchService', () => {
  let service: SearchService;
  let configState: ReturnType<typeof signal<DashboardConfig | undefined>>;

  const createApp = (overrides: Partial<SelfhostedApp> = {}): SelfhostedApp => ({
    id: 'test',
    name: 'Test App',
    description: 'A test app',
    url: 'https://test.example.com',
    icon: { type: 'name', value: 'test' },
    category: 'media',
    openNewTab: true,
    tags: [],
    favorite: false,
    healthCheck: false,
    ...overrides,
  });

  beforeEach(() => {
    configState = signal<DashboardConfig | undefined>(undefined);
    TestBed.configureTestingModule({
      providers: [
        SearchService,
        {
          provide: ConfigService,
          useValue: {
            config: configState.asReadonly(),
          },
        },
      ],
    });

    service = TestBed.inject(SearchService);
  });

  it('publishes query state and derives whether a meaningful search exists', () => {
    expect(service.searchQuery()).toBe('');
    expect(service.haveSearch()).toBe(false);

    service.setSearchQuery('  Plex  ');
    expect(service.searchQuery()).toBe('  Plex  ');
    expect(service.haveSearch()).toBe(true);

    service.setSearchQuery('   ');
    expect(service.haveSearch()).toBe(false);
  });

  it('projects configured search engines and preserves unknown entries as undefined', () => {
    expect(service.searchEngines()).toEqual([]);

    configState.set({
      ...DEFAULT_DASHBOARD_CONFIG,
      settings: {
        ...DEFAULT_DASHBOARD_CONFIG.settings,
        searchEngines: ['google', 'youtube'],
      },
    });

    expect(service.searchEngines().map((engine) => engine?.id)).toEqual(['google', 'youtube']);
    expect(service.getSearchEngineById('missing')).toBeUndefined();
  });

  describe('filterApps', () => {
    it('filters app and bookmark categories without search text', () => {
      const apps = [
        createApp({ id: 'app', category: 'media' }),
        createApp({ id: 'bookmark', category: BOOKMARKS_CATEGORY.id }),
      ];

      expect(service.filterApps(apps, '  ', APP_CATEGORY.id).map(({ id }) => id)).toEqual(['app']);
      expect(service.filterApps(apps, '', BOOKMARKS_CATEGORY.id).map(({ id }) => id)).toEqual([
        'bookmark',
      ]);
    });

    it('matches name, description, and tags case-insensitively', () => {
      const apps = [
        createApp({ id: 'name', name: 'PLEX Server' }),
        createApp({ id: 'description', name: 'Other', description: 'Media manager' }),
        createApp({ id: 'tag', name: 'Third', description: '', tags: ['STREAMING'] }),
      ];

      expect(service.filterApps(apps, 'plex', 'media').map(({ id }) => id)).toEqual(['name']);
      expect(service.filterApps(apps, 'MANAGER', 'media').map(({ id }) => id)).toEqual([
        'description',
      ]);
      expect(service.filterApps(apps, 'stream', 'media').map(({ id }) => id)).toEqual(['tag']);
    });
    it('should return only favorited apps when categoryId is FAVORITES_CATEGORY.id', () => {
      const apps: SelfhostedApp[] = [
        createApp({ id: 'plex', name: 'Plex', favorite: true }),
        createApp({ id: 'radarr', name: 'Radarr', favorite: false }),
        createApp({ id: 'sonarr', name: 'Sonarr', favorite: true }),
      ];

      const result = service.filterApps(apps, '', FAVORITES_CATEGORY.id, false);

      expect(result).toHaveLength(2);
      expect(result.map((a) => a.id)).toEqual(['plex', 'sonarr']);
    });

    it('should return empty array when no favorites exist and FAVORITES_CATEGORY is selected', () => {
      const apps: SelfhostedApp[] = [
        createApp({ id: 'radarr', name: 'Radarr', favorite: false }),
        createApp({ id: 'sonarr', name: 'Sonarr', favorite: false }),
      ];

      const result = service.filterApps(apps, '', FAVORITES_CATEGORY.id, false);

      expect(result).toHaveLength(0);
    });

    it('should bypass category filter when searchAll is true, returning matching apps regardless of favorite status', () => {
      const apps: SelfhostedApp[] = [
        createApp({ id: 'plex', name: 'Plex Media', favorite: true }),
        createApp({ id: 'radarr', name: 'Radarr', favorite: false }),
      ];

      const result = service.filterApps(apps, 'Plex', FAVORITES_CATEGORY.id, true);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('plex');
    });

    it('should still include favorited apps in their original category', () => {
      const apps: SelfhostedApp[] = [
        createApp({ id: 'plex', name: 'Plex', category: 'media', favorite: true }),
        createApp({ id: 'radarr', name: 'Radarr', category: 'media', favorite: false }),
      ];

      const result = service.filterApps(apps, '', 'media', false);

      expect(result).toHaveLength(2);
    });

    it('should combine favorites filter with search text', () => {
      const apps: SelfhostedApp[] = [
        createApp({ id: 'plex', name: 'Plex', favorite: true }),
        createApp({ id: 'plex-2', name: 'Plex Two', favorite: true }),
        createApp({ id: 'radarr', name: 'Radarr', favorite: false }),
      ];

      const result = service.filterApps(apps, 'Two', FAVORITES_CATEGORY.id, false);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('plex-2');
    });
  });
});
