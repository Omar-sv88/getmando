import {
  DashboardConfig,
  DashboardConfigSchema,
  DEFAULT_DASHBOARD_CONFIG,
} from './dashboard.models';

const validConfig = (): DashboardConfig => ({
  ...DEFAULT_DASHBOARD_CONFIG,
  categories: [{ id: 'media', name: 'Media' }],
  bookmarks: [],
  applications: [
    {
      id: 'plex',
      name: 'Plex',
      description: 'Media server',
      url: 'https://plex.example.test',
      icon: { type: 'name' as const, value: 'plex' },
      category: 'media',
      openNewTab: true,
      tags: [],
      favorite: false,
      healthCheck: false,
    },
  ],
});

describe('DashboardConfigSchema semantic validation', () => {
  it('accepts configurations with permitted unique IDs and existing categories', () => {
    expect(DashboardConfigSchema.safeParse(validConfig()).success).toBe(true);
  });

  it.each([
    [
      'category',
      (config: ReturnType<typeof validConfig>) => {
        config.categories.push({ id: 'media', name: 'More media' });
      },
      ['categories', 1, 'id'],
    ],
    [
      'application',
      (config: ReturnType<typeof validConfig>) => {
        config.applications.push({ ...config.applications[0], id: 'plex', name: 'Plex duplicate' });
      },
      ['applications', 1, 'id'],
    ],
    [
      'bookmark',
      (config: ReturnType<typeof validConfig>) => {
        config.bookmarks.push({
          id: 'plex',
          name: 'Docs',
          description: '',
          url: 'https://docs.example.test',
          icon: { type: 'url', value: 'https://docs.example.test/icon.svg' },
          openNewTab: true,
          tags: [],
        });
      },
      ['bookmarks', 0, 'id'],
    ],
  ])('rejects duplicate %s IDs with the affected item path', (_kind, arrange, expectedPath) => {
    const config = validConfig();
    arrange(config);

    const result = DashboardConfigSchema.safeParse(config);

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: expectedPath })]),
      );
  });

  it('rejects applications assigned to a nonexistent category', () => {
    const config = validConfig();
    config.applications[0].category = 'missing';

    const result = DashboardConfigSchema.safeParse(config);

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: ['applications', 0, 'category'] }),
        ]),
      );
  });

  it.each(['apps', 'bookmarks', 'favorites'])(
    'rejects the reserved virtual category ID %s',
    (id) => {
      const config = validConfig();
      config.categories[0].id = id;

      const result = DashboardConfigSchema.safeParse(config);

      expect(result.success).toBe(false);
      if (!result.success)
        expect(result.error.issues).toEqual(
          expect.arrayContaining([expect.objectContaining({ path: ['categories', 0, 'id'] })]),
        );
    },
  );

  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
  ])('rejects application URLs using the %s scheme', (url) => {
    const config = validConfig();
    config.applications[0].url = url;

    const result = DashboardConfigSchema.safeParse(config);

    expect(result.success).toBe(false);
  });

  it('rejects bookmark URLs using the javascript: scheme', () => {
    const config = validConfig();
    config.bookmarks = [
      {
        id: 'docs',
        name: 'Docs',
        description: '',
        url: 'javascript:alert(document.cookie)',
        icon: { type: 'name', value: 'docs' },
        openNewTab: true,
        tags: [],
      },
    ];

    const result = DashboardConfigSchema.safeParse(config);

    expect(result.success).toBe(false);
  });

  it('rejects icon URLs using the javascript: scheme', () => {
    const config = validConfig();
    config.applications[0].icon = { type: 'url', value: 'javascript:alert(1)' };

    const result = DashboardConfigSchema.safeParse(config);

    expect(result.success).toBe(false);
  });

  it('defaults healthCheck to false when absent from an application', () => {
    const { healthCheck: _omitted, ...application } = validConfig().applications[0];

    const result = DashboardConfigSchema.safeParse({
      ...validConfig(),
      applications: [application],
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.applications[0].healthCheck).toBe(false);
  });

  it('round-trips an application with healthCheck: true', () => {
    const config = validConfig();
    config.applications[0].healthCheck = true;

    const result = DashboardConfigSchema.safeParse(config);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.applications[0].healthCheck).toBe(true);
  });

  it('rejects a non-boolean healthCheck value', () => {
    const config = validConfig();
    const application = {
      ...config.applications[0],
      healthCheck: 'yes',
    } as unknown as (typeof config.applications)[number];

    const result = DashboardConfigSchema.safeParse({ ...config, applications: [application] });

    expect(result.success).toBe(false);
  });

  it('accepts http/https URLs for applications, bookmarks, and URL icons', () => {
    const config = validConfig();
    config.applications[0].icon = { type: 'url', value: 'https://example.test/icon.png' };
    config.bookmarks = [
      {
        id: 'docs',
        name: 'Docs',
        description: '',
        url: 'https://docs.example.test',
        icon: { type: 'url', value: 'http://docs.example.test/icon.svg' },
        openNewTab: true,
        tags: [],
      },
    ];

    expect(DashboardConfigSchema.safeParse(config).success).toBe(true);
  });
});
