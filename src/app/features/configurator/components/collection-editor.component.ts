import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  input,
  output,
  viewChildren,
} from '@angular/core';
import { NgIcon, provideIcons } from '@ng-icons/core';
import { heroArrowDown, heroArrowUp, heroPlus } from '@ng-icons/heroicons/outline';

import { IconConfig } from '../../../core/models/dashboard.models';

type CollectionName = 'categories' | 'applications' | 'bookmarks';
type EditableItem = {
  id: string;
  name: string;
  icon?: string | IconConfig;
  category?: string;
  description?: string;
  url?: string;
  openNewTab?: boolean;
  tags?: readonly string[];
  favorite?: boolean;
  healthCheck?: boolean;
};
type EditableField =
  | 'id'
  | 'name'
  | 'category'
  | 'description'
  | 'url'
  | 'openNewTab'
  | 'tags'
  | 'favorite'
  | 'healthCheck';
type TextField = Extract<EditableField, 'id' | 'name' | 'category' | 'description' | 'url'>;
type BooleanField = Extract<EditableField, 'openNewTab' | 'favorite' | 'healthCheck'>;
type ArrayField = Extract<EditableField, 'tags'>;
type IconField = 'iconType' | 'iconValue';

export type CollectionEditEvent =
  | { readonly index: number; readonly field: TextField; readonly value: string }
  | { readonly index: number; readonly field: BooleanField; readonly value: boolean }
  | { readonly index: number; readonly field: ArrayField; readonly value: string[] }
  | { readonly index: number; readonly field: 'icon'; readonly value: IconConfig };

@Component({
  selector: 'app-collection-editor',
  imports: [NgIcon],
  templateUrl: 'collection-editor.component.html',
  viewProviders: [provideIcons({ heroArrowDown, heroArrowUp, heroPlus })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
})
export class CollectionEditorComponent {
  readonly collection = input.required<CollectionName>();
  readonly items = input.required<readonly EditableItem[]>();
  readonly categoryOptions = input<readonly Pick<EditableItem, 'id' | 'name'>[]>([]);
  readonly fieldErrorIds = input<Readonly<Record<string, string>>>({});
  readonly fieldErrors = input<Readonly<Record<string, string>>>({});
  readonly addItem = output<void>();
  readonly removeItem = output<number>();
  readonly moveItem = output<{ from: number; to: number }>();
  readonly editItem = output<CollectionEditEvent>();

  private readonly removeButtons = viewChildren<ElementRef<HTMLButtonElement>>('removeButton');
  private readonly nameInputs = viewChildren<ElementRef<HTMLInputElement>>('nameInput');

  protected addLabel(): string {
    return `Add ${this.collectionLabel()}`;
  }

  protected errorId(index: number, field: EditableField | IconField): string | undefined {
    return this.fieldErrorIds()[this.errorKey(index, field)];
  }

  protected errorMessage(index: number, field: EditableField | IconField): string | undefined {
    return this.fieldErrors()[this.errorKey(index, field)];
  }

  protected itemIcon(item: EditableItem): IconConfig {
    return typeof item.icon === 'object' && item.icon !== undefined
      ? item.icon
      : { type: 'initials', value: '' };
  }

  protected fieldId(index: number, field: EditableField | IconField): string {
    return `field-${this.collection()}-${index}-${this.errorFieldName(field)}`;
  }

  protected describedBy(index: number, field: EditableField | IconField): string | undefined {
    const descriptions = [
      ...(field === 'iconValue'
        ? [`${this.collectionLabel()}-icon-${this.iconType(index)}-help-${index}`]
        : []),
      this.errorId(index, field),
    ].filter((id): id is string => Boolean(id));

    return descriptions.length > 0 ? descriptions.join(' ') : undefined;
  }

  protected itemLabel(item: EditableItem): string {
    return item.name || item.id || 'new item';
  }

  protected fieldLabel(item: EditableItem, field: EditableField): string {
    const itemLabel = this.itemLabel(item);
    const collection = this.collectionLabel();
    const capitalized = `${collection[0].toUpperCase()}${collection.slice(1)}`;
    const labels: Record<EditableField, string> = {
      id: `${capitalized} ID for ${itemLabel}`,
      name: `${capitalized} name for ${itemLabel}`,
      category: `Application category for ${itemLabel}`,
      description: `${capitalized} description for ${itemLabel}`,
      url: `${capitalized} URL for ${itemLabel}`,
      openNewTab: `Open ${itemLabel} in a new tab`,
      tags: `${capitalized} tags for ${itemLabel}`,
      favorite: `Mark ${itemLabel} as favorite`,
      healthCheck: `Enable health checks for ${itemLabel}`,
    };

    return labels[field];
  }

  protected editText(index: number, field: TextField, event: Event): void {
    this.editItem.emit({
      index,
      field,
      value: (event.target as HTMLInputElement | HTMLSelectElement).value,
    });
  }

  protected editBoolean(index: number, field: BooleanField, event: Event): void {
    this.editItem.emit({ index, field, value: (event.target as HTMLInputElement).checked });
  }

  protected editTags(index: number, event: Event): void {
    const value = (event.target as HTMLInputElement).value
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
    this.editItem.emit({ index, field: 'tags', value });
  }

  protected iconType(index: number): IconConfig['type'] {
    return this.itemIcon(this.items()[index]).type;
  }

  protected iconValue(index: number): string {
    return this.itemIcon(this.items()[index]).value;
  }

  protected iconValueLabel(index: number): string {
    const itemLabel = this.itemLabel(this.items()[index]);
    const type = this.iconType(index);
    return `Icon ${type === 'url' ? 'URL' : type} for ${itemLabel}`;
  }

  protected iconHelp(index: number): string {
    switch (this.iconType(index)) {
      case 'url':
        return `Enter the absolute URL for the ${this.collectionLabel()} icon.`;
      case 'name':
        return 'Enter the registered icon name.';
      case 'initials':
        return `Enter the initials displayed for the ${this.collectionLabel()}.`;
    }
  }

  protected updateIconType(index: number, event: Event): void {
    const type = (event.target as HTMLSelectElement).value;
    if (!this.isIconType(type)) return;

    this.editItem.emit({
      index,
      field: 'icon',
      value: { ...this.itemIcon(this.items()[index]), type },
    });
  }

  protected updateIconValue(index: number, event: Event): void {
    this.editItem.emit({
      index,
      field: 'icon',
      value: {
        ...this.itemIcon(this.items()[index]),
        value: (event.target as HTMLInputElement).value,
      },
    });
  }

  protected add(): void {
    this.addItem.emit();
    queueMicrotask(() => {
      const nameInputs = this.nameInputs();
      nameInputs[nameInputs.length - 1]?.nativeElement.focus();
    });
  }

  protected remove(index: number): void {
    this.removeItem.emit(index);
    queueMicrotask(() => {
      const survivor = this.removeButtons()[Math.min(index, this.removeButtons().length - 1)];
      survivor?.nativeElement.focus();
    });
  }

  protected move(from: number, to: number): void {
    this.moveItem.emit({ from, to });
  }

  protected collectionLabel(): string {
    return this.collection() === 'categories' ? 'category' : this.collection().slice(0, -1);
  }

  protected supportsIcon(): boolean {
    return this.collection() === 'applications' || this.collection() === 'bookmarks';
  }

  private errorKey(index: number, field: EditableField | IconField): string {
    return `${index}-${this.errorFieldName(field)}`;
  }

  private errorFieldName(field: EditableField | IconField): string {
    if (field === 'iconType') return 'icon-type';
    if (field === 'iconValue') return 'icon-value';
    return field;
  }

  private isIconType(value: string): value is IconConfig['type'] {
    return value === 'url' || value === 'name' || value === 'initials';
  }
}
