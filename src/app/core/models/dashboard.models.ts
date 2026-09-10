import { z } from 'zod';

/**
 * Rejects dangerous URL schemes (`javascript:`, `data:`, `vbscript:`, ...) that `z.string().url()`
 * alone accepts. `window.open()` and other imperative navigation calls bypass Angular's template
 * URL sanitizer, so this must be enforced at the schema boundary instead.
 */
const HTTP_URL_MESSAGE = 'URL must use http or https.';

function isHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

const HttpUrlSchema = z.string().url().refine(isHttpUrl, HTTP_URL_MESSAGE);

/**
 * Icon configuration schema
 */
export const IconConfigSchema = z
  .object({
    type: z.enum(['url', 'name', 'initials']),
    value: z.string(),
  })
  .refine((icon) => icon.type !== 'url' || isHttpUrl(icon.value), {
    message: HTTP_URL_MESSAGE,
    path: ['value'],
  });

/**
 * Application schema
 */
export const SelfhostedAppSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100),
  description: z.string().max(255),
  url: HttpUrlSchema,
  icon: IconConfigSchema,
  category: z.string(),
  openNewTab: z.boolean().default(true),
  tags: z.array(z.string()).default([]),
  favorite: z.boolean().default(false),
  healthCheck: z.boolean().default(false),
});

/**
 * Category schema
 */
export const CategorySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(50),
});

/**
 * Bookmark schema
 */
export const BookmarkSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(100),
  description: z.string().max(255),
  url: HttpUrlSchema,
  icon: IconConfigSchema,
  openNewTab: z.boolean().default(true),
  tags: z.array(z.string()).default([]),
});

/**
 * Search Engine schema
 */
export const SearchEngineSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(50),
  searchUrl: HttpUrlSchema,
  icon: z.string().optional(),
});

/**
 * Metadata schema
 */
export const DashboardMetadataSchema = z.object({
  title: z.string().min(1).max(100),
  description: z.string().max(255),
});

/**
 * Settings schema
 */
export const DashboardSettingsSchema = z.object({
  theme: z.enum(['light', 'dark', 'auto']).default('dark'),
  dateFormat: z.string().default('dd-MM-yyyy'),
  datePosition: z.enum(['top', 'bottom']).default('top'),
  showSeconds: z.boolean().default(false),
  showDate: z.boolean().default(false),
  itemsPerRow: z.number().int().min(1).max(10).default(4),
  allowBookmarks: z.boolean().default(false),
  showAllCategory: z.boolean().default(true),
  showDescriptions: z.boolean().default(true),
  showLabels: z.boolean().default(true),
  searchEngines: z
    .array(z.enum(['google', 'duckduckgo', 'startpage', 'youtube'] as const))
    .default([]),
  lightBackgroundImage: z.string().default('background-light.jpg'),
  darkBackgroundImage: z.string().default('background.jpg'),
});

/**
 * Complete Dashboard configuration schema
 */
export const RESERVED_VIRTUAL_CATEGORY_IDS = ['apps', 'bookmarks', 'favorites'] as const;

const RESERVED_VIRTUAL_CATEGORY_ID_SET = new Set<string>(RESERVED_VIRTUAL_CATEGORY_IDS);

type ConfigItemPath = ['categories' | 'applications' | 'bookmarks', number, 'id' | 'category'];

function addSemanticIssue(context: z.RefinementCtx, path: ConfigItemPath, message: string): void {
  context.addIssue({ code: 'custom', path, message });
}

/**
 * Complete Dashboard configuration schema, including cross-collection dashboard semantics.
 */
export const DashboardConfigSchema = z
  .object({
    metadata: DashboardMetadataSchema,
    categories: z.array(CategorySchema).min(1),
    applications: z.array(SelfhostedAppSchema).min(1),
    bookmarks: z.array(BookmarkSchema),
    settings: DashboardSettingsSchema,
  })
  .superRefine((config, context) => {
    const identifiers = new Set<string>();
    const categoryIds = new Set(config.categories.map(({ id }) => id));

    const validateIdentifier = (
      id: string,
      path: ['categories' | 'applications' | 'bookmarks', number, 'id'],
    ): void => {
      if (identifiers.has(id)) {
        addSemanticIssue(context, path, `ID '${id}' must be unique across the dashboard.`);
        return;
      }
      identifiers.add(id);
    };

    config.categories.forEach(({ id }, index) => {
      validateIdentifier(id, ['categories', index, 'id']);
      if (RESERVED_VIRTUAL_CATEGORY_ID_SET.has(id)) {
        addSemanticIssue(context, ['categories', index, 'id'], `Category ID '${id}' is reserved.`);
      }
    });
    config.applications.forEach(({ id, category }, index) => {
      validateIdentifier(id, ['applications', index, 'id']);
      if (!categoryIds.has(category)) {
        addSemanticIssue(
          context,
          ['applications', index, 'category'],
          `Category '${category}' does not exist.`,
        );
      }
    });
    config.bookmarks.forEach(({ id }, index) => {
      validateIdentifier(id, ['bookmarks', index, 'id']);
    });
  });

/** Canonical settings shape where a blank background image override is omitted, not empty. */
export type CanonicalDashboardSettings = Omit<
  DashboardSettings,
  'lightBackgroundImage' | 'darkBackgroundImage'
> & {
  lightBackgroundImage?: string;
  darkBackgroundImage?: string;
};

/**
 * Omits blank background image overrides (from a cleared configurator field) so the persisted
 * YAML falls back to DashboardSettingsSchema's built-in default on the next load, instead of
 * writing `lightBackgroundImage: ''`/`darkBackgroundImage: ''` verbatim. Used by both the
 * client-side export (YamlCodecService) and the config-write-api sidecar so Save and
 * Copy/Download YAML never disagree on this.
 */
export function omitBlankBackgroundImages(settings: DashboardSettings): CanonicalDashboardSettings {
  const { lightBackgroundImage, darkBackgroundImage, ...rest } = settings;
  return {
    ...rest,
    ...(lightBackgroundImage.trim() ? { lightBackgroundImage } : {}),
    ...(darkBackgroundImage.trim() ? { darkBackgroundImage } : {}),
  };
}

/**
 * Type inference from schemas
 */
export type IconConfig = z.infer<typeof IconConfigSchema>;
export type SelfhostedApp = z.infer<typeof SelfhostedAppSchema>;
export type Bookmark = z.infer<typeof BookmarkSchema>;
export type Category = z.infer<typeof CategorySchema>;
export type SearchEngine = z.infer<typeof SearchEngineSchema>;
export type DashboardMetadata = z.infer<typeof DashboardMetadataSchema>;
export type DashboardSettings = z.infer<typeof DashboardSettingsSchema>;
export type DashboardConfig = z.infer<typeof DashboardConfigSchema>;

/**
 * Default configuration
 */
export const APP_CATEGORY: Category = {
  id: 'apps',
  name: 'Apps',
};

export const BOOKMARKS_CATEGORY: Category = {
  id: 'bookmarks',
  name: 'Bookmarks',
};

export const FAVORITES_CATEGORY: Category = {
  id: 'favorites',
  name: 'Favorites',
};

export const DEFAULT_DASHBOARD_CONFIG: DashboardConfig = {
  metadata: {
    title: 'Mando',
    description: 'My Selfhosted Applications',
  },
  categories: [],
  applications: [],
  bookmarks: [],
  settings: {
    theme: 'dark',
    dateFormat: 'dd-MM-yyyy',
    datePosition: 'top',
    showSeconds: false,
    showDate: false,
    itemsPerRow: 4,
    allowBookmarks: false,
    showAllCategory: true,
    showDescriptions: true,
    showLabels: true,
    searchEngines: [],
    lightBackgroundImage: 'background-light.jpg',
    darkBackgroundImage: 'background.jpg',
  },
};

export const DEFAULT_DASHBOARD_SEARCH_ENGINES: SearchEngine[] = [
  {
    id: 'google',
    name: 'Google',
    searchUrl: 'https://www.google.com/search?q={query}',
    icon: 'simpleGoogle',
  },
  {
    id: 'duckduckgo',
    name: 'DuckDuckGo',
    searchUrl: 'https://duckduckgo.com/?q={query}',
    icon: 'simpleDuckduckgo',
  },
  {
    id: 'startpage',
    name: 'Startpage',
    searchUrl: 'https://www.startpage.com/sp/search?q={query}',
    icon: 'simpleStartpage',
  },
  {
    id: 'youtube',
    name: 'YouTube',
    searchUrl: 'https://www.youtube.com/results?search_query={query}',
    icon: 'simpleYoutube',
  },
];
