import { TestBed } from '@angular/core/testing';

import { DEFAULT_DASHBOARD_CONFIG } from '../models/dashboard.models';

import { YamlCodecService } from './yaml-codec.service';

describe('YamlCodecService', () => {
  let service: YamlCodecService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [YamlCodecService] });
    service = TestBed.inject(YamlCodecService);
  });

  it('parses structurally and semantically valid YAML through the shared schema', () => {
    const result = service.parse(
      `metadata:\n  title: Test\n  description: Test\ncategories:\n  - id: media\n    name: Media\napplications:\n  - id: plex\n    name: Plex\n    description: Media server\n    url: https://plex.example.test\n    icon:\n      type: name\n      value: plex\n    category: media\nbookmarks: []\nsettings: {}`,
    );

    expect(result.success).toBe(true);
    if (result.success) expect(result.config.applications[0].favorite).toBe(false);
  });

  it('round-trips an application healthCheck flag through serialize and parse', () => {
    const content = service.serialize({
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
          healthCheck: true,
        },
      ],
    });

    expect(content).toContain('healthCheck: true');

    const result = service.parse(content);
    expect(result.success).toBe(true);
    if (result.success) expect(result.config.applications[0].healthCheck).toBe(true);
  });

  it('returns actionable paths for YAML that violates semantic validation', () => {
    const result = service.parse(
      `metadata: { title: Test, description: Test }\ncategories: [{ id: apps, name: Apps }]\napplications: [{ id: plex, name: Plex, description: Media, url: https://plex.example.test, icon: { type: name, value: plex }, category: apps }]\nbookmarks: []\nsettings: {}`,
    );

    expect(result).toEqual(expect.objectContaining({ success: false }));
    if (!result.success)
      expect(result.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: ['categories', '0', 'id'] })]),
      );
  });

  it('serializes a valid configuration in a deterministic dashboard field order', () => {
    const content = service.serialize({
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
    });

    expect(content).toContain(
      'metadata:\n  title: Mando\n  description: My Selfhosted Applications\ncategories:',
    );
    expect(content).toContain('applications:\n  - id: plex');
    expect(content).toContain('categories:\n  - id: media\n    name: Media');
    expect(content).not.toContain('icon: /assets/icons/media.svg');
    expect(content).toContain('bookmarks: []\nsettings:');
    expect(content.endsWith('\n')).toBe(true);
  });

  it('omits blank background image overrides so the built-in default applies on load', () => {
    const content = service.serialize({
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
      settings: {
        ...DEFAULT_DASHBOARD_CONFIG.settings,
        lightBackgroundImage: '',
        darkBackgroundImage: '   ',
      },
    });

    expect(content).not.toContain('lightBackgroundImage');
    expect(content).not.toContain('darkBackgroundImage');
  });

  it('keeps a custom background image override in the serialized settings', () => {
    const content = service.serialize({
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
      settings: {
        ...DEFAULT_DASHBOARD_CONFIG.settings,
        lightBackgroundImage: 'custom-light.jpg',
        darkBackgroundImage: '',
      },
    });

    expect(content).toContain('lightBackgroundImage: custom-light.jpg');
    expect(content).not.toContain('darkBackgroundImage');
  });

  it('serializes an application URL IconConfig without flattening its type or value', () => {
    const content = service.serialize({
      ...DEFAULT_DASHBOARD_CONFIG,
      categories: [{ id: 'media', name: 'Media' }],
      applications: [
        {
          id: 'plex',
          name: 'Plex',
          description: 'Media server',
          url: 'https://plex.example.test',
          icon: { type: 'url', value: 'https://icons.example.test/plex.svg' },
          category: 'media',
          openNewTab: true,
          tags: [],
          favorite: false,
          healthCheck: false,
        },
      ],
    });

    expect(content).toContain(
      'icon:\n      type: url\n      value: https://icons.example.test/plex.svg',
    );
  });
});
