import { computed, inject, Injectable, signal } from '@angular/core';

import {
  Bookmark,
  Category,
  DashboardConfig,
  DashboardConfigSchema,
  DEFAULT_DASHBOARD_CONFIG,
  DashboardMetadata,
  DashboardSettings,
  SelfhostedApp,
} from '../../core/models/dashboard.models';
import { NotificationService } from '../../core/services/notification.service';
import { ParseError } from '../../core/services/yaml-parser.service';
import { YamlCodecService } from '../../core/services/yaml-codec.service';
import { YamlLoaderService } from '../../core/services/yaml-loader.service';

export interface ConfiguratorDraft {
  readonly metadata: DashboardMetadata;
  readonly categories: readonly Category[];
  readonly applications: readonly SelfhostedApp[];
  readonly bookmarks: readonly Bookmark[];
  readonly settings: DashboardSettings;
}

const COMBINING_MARKS_PATTERN = /[\u0300-\u036f]/g;
const UNSUPPORTED_ID_CHARACTERS_PATTERN = /[^a-z0-9\s-]/g;
const ID_SEPARATORS_PATTERN = /[\s-]+/g;

export function normalizeNameToId(name: string): string {
  return name
    .normalize('NFD')
    .replace(COMBINING_MARKS_PATTERN, '')
    .toLowerCase()
    .replace(UNSUPPORTED_ID_CHARACTERS_PATTERN, '')
    .trim()
    .replace(ID_SEPARATORS_PATTERN, '-');
}

function cloneConfig(config: ConfiguratorDraft): ConfiguratorDraft {
  return {
    metadata: { ...config.metadata },
    categories: config.categories.map((category) => ({ ...category })),
    applications: config.applications.map((application) => ({
      ...application,
      icon: { ...application.icon },
      tags: [...application.tags],
    })),
    bookmarks: config.bookmarks.map((bookmark) => ({
      ...bookmark,
      icon: { ...bookmark.icon },
      tags: [...bookmark.tags],
    })),
    settings: { ...config.settings, searchEngines: [...config.settings.searchEngines] },
  };
}

/**
 * A loaded config whose background image exactly matches DashboardSettingsSchema's default was
 * never actually overridden — it just came back defaulted because the source YAML omitted the
 * key (see DashboardSettingsSchema). Blanking it here keeps the field's meaning in the editor
 * consistent with createEmptyDraft() below: blank means "no override, use the built-in default".
 */
function blankDefaultBackgroundImages(config: DashboardConfig): DashboardConfig {
  const defaults = DEFAULT_DASHBOARD_CONFIG.settings;
  return {
    ...config,
    settings: {
      ...config.settings,
      lightBackgroundImage:
        config.settings.lightBackgroundImage === defaults.lightBackgroundImage
          ? ''
          : config.settings.lightBackgroundImage,
      darkBackgroundImage:
        config.settings.darkBackgroundImage === defaults.darkBackgroundImage
          ? ''
          : config.settings.darkBackgroundImage,
    },
  };
}

function createEmptyDraft(): ConfiguratorDraft {
  const draft = cloneConfig(DEFAULT_DASHBOARD_CONFIG);
  return {
    ...draft,
    categories: [],
    applications: [],
    bookmarks: [],
    settings: { ...draft.settings, lightBackgroundImage: '', darkBackgroundImage: '' },
  };
}

function toParseErrors(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
): ParseError[] {
  return issues.map((issue) => ({
    path: issue.path.map(String),
    message: issue.message,
  }));
}

/** Holds the browser-only configuration draft until it passes the shared schema boundary. */
@Injectable()
export class ConfiguratorStore {
  private readonly yamlLoader = inject(YamlLoaderService);
  private readonly yamlCodec = inject(YamlCodecService);
  private readonly notifications = inject(NotificationService);
  private readonly draftState = signal<ConfiguratorDraft>(createEmptyDraft());
  private readonly dirtyState = signal(false);
  private readonly validationErrorState = signal<readonly ParseError[]>([]);

  readonly draft = this.draftState.asReadonly();
  readonly isDirty = this.dirtyState.asReadonly();
  readonly validationErrors = this.validationErrorState.asReadonly();
  readonly canLoadMountedConfig = computed(
    () => this.yamlLoader.mountedConfigResult()?.status === 'valid',
  );

  startEmpty(): void {
    this.draftState.set(createEmptyDraft());
    this.validationErrorState.set([]);
    this.dirtyState.set(false);
    this.notifications.success('Started a new empty configuration draft.');
  }

  loadMountedConfig(): void {
    const mountedConfig = this.yamlLoader.mountedConfigResult();
    if (mountedConfig?.status !== 'valid') return;

    this.draftState.set(cloneConfig(blankDefaultBackgroundImages(mountedConfig.config)));
    this.validationErrorState.set([]);
    this.dirtyState.set(false);
    this.notifications.success('Loaded the mounted dashboard YAML.');
  }

  importLocalYaml(content: string): void {
    const result = this.yamlCodec.parse(content);
    if (!result.success) {
      this.validationErrorState.set(result.errors);
      this.notifications.error('The imported YAML file is invalid. Fix the errors below.');
      return;
    }

    this.draftState.set(cloneConfig(blankDefaultBackgroundImages(result.config)));
    this.validationErrorState.set([]);
    this.dirtyState.set(true);
    this.notifications.success('Imported the local YAML file into the draft.');
  }

  replaceDraft(draft: ConfiguratorDraft): void {
    this.draftState.set(cloneConfig(draft));
    this.validationErrorState.set([]);
    this.dirtyState.set(true);
  }

  updateMetadata(metadata: Partial<DashboardMetadata>): void {
    this.updateDraft((draft) => ({ ...draft, metadata: { ...draft.metadata, ...metadata } }));
  }

  updateSettings(settings: Partial<DashboardSettings>): void {
    this.updateDraft((draft) => ({ ...draft, settings: { ...draft.settings, ...settings } }));
  }

  addCategory(): void {
    this.updateDraft((draft) => ({
      ...draft,
      categories: [
        ...draft.categories,
        { id: `category-${draft.categories.length + 1}`, name: 'New category' },
      ],
    }));
  }

  addApplication(): void {
    this.updateDraft((draft) => ({
      ...draft,
      applications: [
        ...draft.applications,
        {
          id: `application-${draft.applications.length + 1}`,
          name: 'New application',
          description: '',
          url: 'https://example.com',
          icon: { type: 'initials', value: 'NA' },
          category: draft.categories[0]?.id ?? '',
          openNewTab: true,
          tags: [],
          favorite: false,
          healthCheck: false,
        },
      ],
    }));
  }

  addBookmark(): void {
    this.updateDraft((draft) => ({
      ...draft,
      bookmarks: [
        ...draft.bookmarks,
        {
          id: `bookmark-${draft.bookmarks.length + 1}`,
          name: 'New bookmark',
          description: '',
          url: 'https://example.com',
          icon: { type: 'initials', value: 'NB' },
          openNewTab: true,
          tags: [],
        },
      ],
    }));
  }

  updateCategory(index: number, changes: Partial<Category>): void {
    this.updateCollection('categories', index, changes);
  }

  updateApplication(index: number, changes: Partial<SelfhostedApp>): void {
    this.updateCollection('applications', index, changes);
  }

  updateBookmark(index: number, changes: Partial<Bookmark>): void {
    this.updateCollection('bookmarks', index, changes);
  }

  removeCategory(index: number): void {
    this.removeCollectionItem('categories', index);
  }

  removeApplication(index: number): void {
    this.removeCollectionItem('applications', index);
  }

  removeBookmark(index: number): void {
    this.removeCollectionItem('bookmarks', index);
  }

  moveCategory(from: number, to: number): void {
    this.moveCollectionItem('categories', from, to);
  }

  moveApplication(from: number, to: number): void {
    this.moveCollectionItem('applications', from, to);
  }

  moveBookmark(from: number, to: number): void {
    this.moveCollectionItem('bookmarks', from, to);
  }

  validate(): boolean {
    return this.toDashboardConfig() !== undefined;
  }

  /** Marks the current draft as persisted (e.g. after a successful "Save to server"). */
  markSaved(): void {
    this.dirtyState.set(false);
  }

  /** Surfaces a server-side validation rejection through the same error summary as a local one. */
  reportServerValidationErrors(errors: readonly ParseError[]): void {
    this.validationErrorState.set(errors);
  }

  private updateDraft(update: (draft: ConfiguratorDraft) => ConfiguratorDraft): void {
    this.draftState.update((draft) => update(cloneConfig(draft)));
    this.validationErrorState.set([]);
    this.dirtyState.set(true);
  }

  toDashboardConfig(): DashboardConfig | undefined {
    const result = DashboardConfigSchema.safeParse(this.toSchemaInput(this.draftState()));
    if (!result.success) {
      this.validationErrorState.set(toParseErrors(result.error.issues));
      return undefined;
    }

    this.validationErrorState.set([]);
    return result.data;
  }

  private updateCollection<Collection extends 'categories' | 'applications' | 'bookmarks'>(
    collection: Collection,
    index: number,
    changes: Partial<ConfiguratorDraft[Collection][number]>,
  ): void {
    this.updateDraft((draft) => ({
      ...draft,
      [collection]: draft[collection].map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              ...changes,
              ...(typeof changes.name === 'string' ? { id: normalizeNameToId(changes.name) } : {}),
            }
          : item,
      ),
    }));
  }

  private removeCollectionItem<Collection extends 'categories' | 'applications' | 'bookmarks'>(
    collection: Collection,
    index: number,
  ): void {
    this.updateDraft((draft) => ({
      ...draft,
      [collection]: draft[collection].filter((_, itemIndex) => itemIndex !== index),
    }));
  }

  private toSchemaInput(draft: ConfiguratorDraft): unknown {
    return cloneConfig(draft);
  }

  private moveCollectionItem<Collection extends 'categories' | 'applications' | 'bookmarks'>(
    collection: Collection,
    from: number,
    to: number,
  ): void {
    this.updateDraft((draft) => {
      const items = [...draft[collection]];
      if (from < 0 || to < 0 || from >= items.length || to >= items.length) return draft;

      const [item] = items.splice(from, 1);
      items.splice(to, 0, item);
      return { ...draft, [collection]: items };
    });
  }
}
