import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { DashboardConfig, DEFAULT_DASHBOARD_CONFIG } from '../../core/models/dashboard.models';
import { NotificationService } from '../../core/services/notification.service';
import { YamlCodecService } from '../../core/services/yaml-codec.service';
import { MountedConfigResult, YamlLoaderService } from '../../core/services/yaml-loader.service';

import { ConfiguratorStore, normalizeNameToId } from './configurator.store';

const validConfig: DashboardConfig = {
  ...DEFAULT_DASHBOARD_CONFIG,
  categories: [{ id: 'media', name: 'Media' }],
  applications: [
    {
      id: 'plex',
      name: 'Plex',
      description: 'Media server',
      url: 'https://plex.example.test',
      icon: { type: 'name', value: 'plex' },
      category: 'media',
      openNewTab: true,
      tags: [],
      favorite: false,
      healthCheck: false,
    },
  ],
};

describe('ConfiguratorStore', () => {
  let store: ConfiguratorStore;
  let mountedConfigResult: ReturnType<typeof signal<MountedConfigResult | undefined>>;
  let codec: { parse: ReturnType<typeof vi.fn> };
  let notifications: { success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mountedConfigResult = signal<MountedConfigResult | undefined>(undefined);
    codec = { parse: vi.fn() };
    notifications = { success: vi.fn(), error: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        ConfiguratorStore,
        { provide: YamlLoaderService, useValue: { mountedConfigResult } },
        { provide: YamlCodecService, useValue: codec },
        { provide: NotificationService, useValue: notifications },
      ],
    });

    store = TestBed.inject(ConfiguratorStore);
  });

  it('starts with an editable empty draft when mounted YAML is unavailable', () => {
    mountedConfigResult.set({ status: 'unavailable', message: 'Unavailable' });

    expect(store.canLoadMountedConfig()).toBe(false);
    expect(store.draft()).toEqual({
      metadata: DEFAULT_DASHBOARD_CONFIG.metadata,
      categories: [],
      applications: [],
      bookmarks: [],
      settings: {
        ...DEFAULT_DASHBOARD_CONFIG.settings,
        lightBackgroundImage: '',
        darkBackgroundImage: '',
      },
    });
    expect(store.isDirty()).toBe(false);
  });

  it('notifies success when starting a new empty draft', () => {
    store.startEmpty();

    expect(notifications.success).toHaveBeenCalledWith('Started a new empty configuration draft.');
  });

  it('offers and loads only a valid mounted configuration as the initial draft', () => {
    mountedConfigResult.set({ status: 'valid', config: validConfig });

    expect(store.canLoadMountedConfig()).toBe(true);

    store.loadMountedConfig();

    expect(store.draft()).toEqual({
      ...validConfig,
      settings: { ...validConfig.settings, lightBackgroundImage: '', darkBackgroundImage: '' },
    });
    expect(store.isDirty()).toBe(false);
    expect(notifications.success).toHaveBeenCalledWith('Loaded the mounted dashboard YAML.');
  });

  it('keeps a background image that differs from the built-in default when loading', () => {
    const configWithCustomBackground: DashboardConfig = {
      ...validConfig,
      settings: { ...validConfig.settings, lightBackgroundImage: 'custom-light.jpg' },
    };
    mountedConfigResult.set({ status: 'valid', config: configWithCustomBackground });

    store.loadMountedConfig();

    expect(store.draft().settings.lightBackgroundImage).toBe('custom-light.jpg');
    expect(store.draft().settings.darkBackgroundImage).toBe('');
  });

  it('does not notify when loading the mounted config is unavailable', () => {
    mountedConfigResult.set({ status: 'unavailable', message: 'Unavailable' });

    store.loadMountedConfig();

    expect(notifications.success).not.toHaveBeenCalled();
  });

  it('imports valid YAML into the draft and marks it dirty without browser persistence', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    codec.parse.mockReturnValue({ success: true, config: validConfig });

    store.importLocalYaml('metadata: {}');

    expect(codec.parse).toHaveBeenCalledWith('metadata: {}');
    expect(store.draft()).toEqual({
      ...validConfig,
      settings: { ...validConfig.settings, lightBackgroundImage: '', darkBackgroundImage: '' },
    });
    expect(store.isDirty()).toBe(true);
    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(notifications.success).toHaveBeenCalledWith(
      'Imported the local YAML file into the draft.',
    );
  });

  it('keeps the current draft editable and exposes validation errors after an invalid import', () => {
    codec.parse.mockReturnValue({
      success: false,
      errors: [{ path: ['applications', '0', 'category'], message: 'Category does not exist.' }],
    });

    store.importLocalYaml('invalid: yaml');

    expect(store.draft().categories).toEqual([]);
    expect(store.validationErrors()).toEqual([
      { path: ['applications', '0', 'category'], message: 'Category does not exist.' },
    ]);
    expect(store.isDirty()).toBe(false);
    expect(notifications.error).toHaveBeenCalledWith(
      'The imported YAML file is invalid. Fix the errors below.',
    );
  });

  it('validates both an incomplete draft and a semantic-valid draft', () => {
    expect(store.validate()).toBe(false);
    expect(store.validationErrors()).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: ['categories'] })]),
    );

    store.replaceDraft(validConfig);

    expect(store.validate()).toBe(true);
    expect(store.validationErrors()).toEqual([]);
  });

  it('adds and updates an application icon as an IconConfig without losing its value on type changes', () => {
    store.replaceDraft(validConfig);

    store.addApplication();
    store.updateApplication(1, {
      icon: { type: 'url', value: 'https://example.test/icon.png' },
    });

    expect(store.draft().applications[1].icon).toEqual({
      type: 'url',
      value: 'https://example.test/icon.png',
    });
    expect(store.validate()).toBe(true);
  });

  it.each([
    ['Café Déjà Vu!', 'cafe-deja-vu'],
    ['  Home --- Lab  ', 'home-lab'],
    ['Name @ Home__Labs', 'name-homelabs'],
    ['💥', ''],
  ])('normalizes %s into the safe ID %s', (name, expectedId) => {
    expect(normalizeNameToId(name)).toBe(expectedId);
  });

  it('regenerates IDs from category, application, and bookmark names after manual ID edits', () => {
    store.replaceDraft({
      ...validConfig,
      bookmarks: [
        {
          id: 'docs',
          name: 'Docs',
          description: '',
          url: 'https://docs.example.test',
          icon: { type: 'initials', value: 'DO' },
          openNewTab: true,
          tags: [],
        },
      ],
    });

    store.updateCategory(0, { id: 'custom-category' });
    store.updateApplication(0, { id: 'custom-application' });
    store.updateBookmark(0, { id: 'custom-bookmark' });

    expect(store.draft().categories[0].id).toBe('custom-category');
    expect(store.draft().applications[0].id).toBe('custom-application');
    expect(store.draft().bookmarks[0].id).toBe('custom-bookmark');

    store.updateCategory(0, { name: 'Café Media' });
    store.updateApplication(0, { name: 'Plex --- Server' });
    store.updateBookmark(0, { name: '  Team   Docs! ' });

    expect(store.draft().categories[0].id).toBe('cafe-media');
    expect(store.draft().applications[0].id).toBe('plex-server');
    expect(store.draft().bookmarks[0].id).toBe('team-docs');
  });

  it('clears the dirty flag when a save to the server is marked complete', () => {
    store.replaceDraft(validConfig);
    expect(store.isDirty()).toBe(true);

    store.markSaved();

    expect(store.isDirty()).toBe(false);
    expect(store.draft()).toEqual(validConfig);
  });

  it('surfaces server-reported validation errors through the same error summary', () => {
    const errors = [{ path: ['applications', '0', 'category'], message: "Category 'x' missing." }];

    store.reportServerValidationErrors(errors);

    expect(store.validationErrors()).toEqual(errors);
  });

  it('keeps generated ID collisions on the existing schema validation path', () => {
    store.replaceDraft(validConfig);

    store.updateApplication(0, { name: 'Media' });

    expect(store.draft().applications[0].id).toBe('media');
    expect(store.validate()).toBe(false);
    expect(store.validationErrors()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ['applications', '0', 'id'],
          message: "ID 'media' must be unique across the dashboard.",
        }),
      ]),
    );
  });
});
