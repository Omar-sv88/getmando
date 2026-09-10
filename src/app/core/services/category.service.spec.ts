import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { CategoryService } from './category.service';
import { ConfigService } from './config.service';

import {
  APP_CATEGORY,
  BOOKMARKS_CATEGORY,
  FAVORITES_CATEGORY,
  DashboardConfig,
  DEFAULT_DASHBOARD_CONFIG,
} from '../models/dashboard.models';

describe('CategoryService', () => {
  let service: CategoryService;
  let configSubject: ReturnType<typeof signal<DashboardConfig | undefined>>;

  const createConfig = (overrides: Partial<DashboardConfig> = {}): DashboardConfig => ({
    ...DEFAULT_DASHBOARD_CONFIG,
    ...overrides,
  });

  beforeEach(() => {
    configSubject = signal<DashboardConfig | undefined>(createConfig());

    TestBed.configureTestingModule({
      providers: [
        CategoryService,
        {
          provide: ConfigService,
          useValue: {
            config: configSubject.asReadonly(),
          },
        },
      ],
    });

    service = TestBed.inject(CategoryService);
  });

  describe('categories$', () => {
    it('shows exactly one Apps category with the startup defaults', () => {
      expect(service.categories()).toEqual([APP_CATEGORY]);
    });

    it('publishes no categories before config is available', () => {
      configSubject.set(undefined);

      expect(service.categories()).toEqual([]);
    });

    it('publishes bookmarks first when it is the only enabled virtual category', () => {
      configSubject.set(
        createConfig({
          categories: [],
          settings: {
            ...DEFAULT_DASHBOARD_CONFIG.settings,
            showAllCategory: false,
            allowBookmarks: true,
          },
        }),
      );

      expect(service.categories()).toEqual([BOOKMARKS_CATEGORY]);
    });
    it('should prepend FAVORITES_CATEGORY as the first category when at least one app is favorited', async () => {
      configSubject.set(
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
          ],
          settings: {
            ...DEFAULT_DASHBOARD_CONFIG.settings,
            showAllCategory: true,
            allowBookmarks: false,
          },
          categories: [{ id: 'media', name: 'Media' }],
        }),
      );

      const categories = service.categories();
      expect(categories[0]).toEqual(FAVORITES_CATEGORY);
      expect(categories.map((c) => c.id)).toEqual(['favorites', 'apps', 'media']);
    });

    it('should omit FAVORITES_CATEGORY when no apps are favorited', async () => {
      configSubject.set(
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
              favorite: false,
              healthCheck: false,
            },
          ],
          settings: {
            ...DEFAULT_DASHBOARD_CONFIG.settings,
            showAllCategory: true,
            allowBookmarks: false,
          },
          categories: [{ id: 'media', name: 'Media' }],
        }),
      );

      const categories = service.categories();
      expect(categories.some((c) => c.id === FAVORITES_CATEGORY.id)).toBe(false);
      expect(categories.map((c) => c.id)).toEqual(['apps', 'media']);
    });

    it('should place virtual categories first, followed by user categories sorted A-Z', async () => {
      configSubject.set(
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
          ],
          settings: {
            ...DEFAULT_DASHBOARD_CONFIG.settings,
            showAllCategory: true,
            allowBookmarks: true,
          },
          categories: [
            { id: 'media', name: 'Media' },
            { id: 'dev', name: 'Development' },
          ],
        }),
      );

      const categories = service.categories();
      const ids = categories.map((c) => c.id);
      expect(ids[0]).toBe('favorites');
      expect(ids.indexOf('apps')).toBeLessThan(ids.indexOf('media'));
      expect(ids.indexOf('bookmarks')).toBeLessThan(ids.indexOf('media'));
      expect(ids.indexOf('dev')).toBeLessThan(ids.indexOf('media'));
    });
  });

  describe('selectedCategory$ fallback', () => {
    it('publishes direct selections while they remain valid', () => {
      service.setSelectedCategory(APP_CATEGORY.id);

      expect(service.selectedCategory()).toBe(APP_CATEGORY.id);
    });
    it('should auto-select the first visible category when the current selection disappears', async () => {
      configSubject.set(
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
          ],
          settings: {
            ...DEFAULT_DASHBOARD_CONFIG.settings,
            showAllCategory: false,
            allowBookmarks: false,
          },
          categories: [{ id: 'media', name: 'Media' }],
        }),
      );

      service.setSelectedCategory(FAVORITES_CATEGORY.id);

      // Allow any async side effects to propagate
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Remove all favorites so Favorites category disappears
      configSubject.set(
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
              favorite: false,
              healthCheck: false,
            },
          ],
          settings: {
            ...DEFAULT_DASHBOARD_CONFIG.settings,
            showAllCategory: false,
            allowBookmarks: false,
          },
          categories: [{ id: 'media', name: 'Media' }],
        }),
      );

      await new Promise((resolve) => setTimeout(resolve, 0));

      const selectedId = service.selectedCategory();
      expect(selectedId).toBe('media');
    });

    it('should select FAVORITES_CATEGORY as first visible when showAllCategory is false and favorites exist', async () => {
      configSubject.set(
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
          ],
          settings: {
            ...DEFAULT_DASHBOARD_CONFIG.settings,
            showAllCategory: false,
            allowBookmarks: false,
          },
          categories: [{ id: 'media', name: 'Media' }],
        }),
      );

      await new Promise((resolve) => setTimeout(resolve, 0));

      const selectedId = service.selectedCategory();
      expect(selectedId).toBe(FAVORITES_CATEGORY.id);
    });

    it('should select the first user category when showAllCategory is false and no favorites exist', async () => {
      configSubject.set(
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
              favorite: false,
              healthCheck: false,
            },
          ],
          settings: {
            ...DEFAULT_DASHBOARD_CONFIG.settings,
            showAllCategory: false,
            allowBookmarks: false,
          },
          categories: [{ id: 'media', name: 'Media' }],
        }),
      );

      await new Promise((resolve) => setTimeout(resolve, 0));

      const selectedId = service.selectedCategory();
      expect(selectedId).toBe('media');
    });
  });
});
