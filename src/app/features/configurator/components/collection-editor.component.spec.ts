import { render, screen } from '@testing-library/angular';
import userEvent from '@testing-library/user-event';

import { CollectionEditEvent, CollectionEditorComponent } from './collection-editor.component';

describe('CollectionEditorComponent', () => {
  const categories = [
    { id: 'media', name: 'Media' },
    { id: 'tools', name: 'Tools' },
  ];

  it('provides labeled category add, remove, and move controls with intentional focus after removal', async () => {
    const user = userEvent.setup();
    const removed = vi.fn((index: number) => {
      view.fixture.componentRef.setInput(
        'items',
        categories.filter((_, itemIndex) => itemIndex !== index),
      );
      view.fixture.detectChanges();
    });
    const moved = vi.fn();
    const view = await render(CollectionEditorComponent, {
      inputs: { collection: 'categories', items: categories },
      on: { removeItem: removed, moveItem: moved },
    });

    expect(screen.getByRole('button', { name: 'Add category' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Category icon for Media')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Move Media down' }));
    expect(moved).toHaveBeenCalledWith({ from: 0, to: 1 });

    await user.click(screen.getByRole('button', { name: 'Remove Media' }));
    expect(removed).toHaveBeenCalledWith(0);
    expect(screen.getByRole('button', { name: 'Remove Tools' })).toHaveFocus();
  });

  it('focuses the new item name field after Add', async () => {
    const user = userEvent.setup();
    const added = vi.fn(() => {
      view.fixture.componentRef.setInput('items', [
        ...categories,
        { id: 'category-3', name: 'New category' },
      ]);
      view.fixture.detectChanges();
    });
    const view = await render(CollectionEditorComponent, {
      inputs: { collection: 'categories', items: categories },
      on: { addItem: added },
    });

    await user.click(screen.getByRole('button', { name: 'Add category' }));

    expect(added).toHaveBeenCalled();
    expect(screen.getByLabelText('Category name for New category')).toHaveFocus();
  });

  it('edits an application IconConfig with labeled type and value controls', async () => {
    const user = userEvent.setup();
    const edited = vi.fn();
    const view = await render(CollectionEditorComponent, {
      inputs: {
        collection: 'applications',
        items: [
          {
            id: 'media',
            name: 'Media',
            icon: { type: 'name', value: 'folder' },
          },
        ],
      },
      on: { editItem: edited },
    });

    expect(screen.getByRole('group', { name: 'Icon for Media' })).toBeInTheDocument();
    const type = screen.getByLabelText('Icon type for Media');
    const field = screen.getByLabelText('Icon name for Media');
    expect(field).toHaveValue('folder');
    expect(field).toHaveAttribute('aria-describedby', 'application-icon-name-help-0');
    expect(screen.getByText('Enter the registered icon name.')).toHaveAttribute(
      'id',
      'application-icon-name-help-0',
    );

    await user.selectOptions(type, 'url');
    view.fixture.componentRef.setInput('items', [
      { id: 'media', name: 'Media', icon: { type: 'url', value: 'folder' } },
    ]);
    view.fixture.detectChanges();
    await user.clear(screen.getByLabelText('Icon URL for Media'));
    await user.type(
      screen.getByLabelText('Icon URL for Media'),
      'https://icons.example.test/media.svg',
    );

    expect(edited).toHaveBeenLastCalledWith({
      index: 0,
      field: 'icon',
      value: { type: 'url', value: 'https://icons.example.test/media.svg' },
    });
  });

  it.each([
    [
      'applications',
      [{ id: 'plex', name: 'Plex', category: 'media' }],
      'Application category for Plex',
    ],
    ['bookmarks', [{ id: 'docs', name: 'Docs' }], 'Bookmark name for Docs'],
  ] as const)(
    'edits %s fields through accessible controls',
    async (collection, items, fieldLabel) => {
      const user = userEvent.setup();
      const edited = vi.fn();
      await render(CollectionEditorComponent, {
        inputs: { collection, items, categoryOptions: categories },
        on: { editItem: edited },
      });

      const field = screen.getByLabelText(fieldLabel);
      await user.click(field);
      if (collection === 'applications') {
        await user.selectOptions(field, 'tools');
      } else {
        await user.keyboard('{Control>}a{/Control}Updated');
      }

      expect(edited).toHaveBeenCalledWith(
        expect.objectContaining({
          index: 0,
          field: collection === 'applications' ? 'category' : 'name',
        }),
      );
    },
  );

  it.each([
    ['categories', 'No categories yet. Add a category to begin editing this collection.'],
    ['bookmarks', 'No bookmarks yet. Add a bookmark to begin editing this collection.'],
  ] as const)(
    'explains how to start an empty %s collection',
    async (collection, expectedMessage) => {
      await render(CollectionEditorComponent, {
        inputs: { collection, items: [] },
      });

      expect(screen.getByRole('status')).toHaveTextContent(expectedMessage);
    },
  );

  it.each([
    ['categories', [{ id: 'media', name: 'Media' }], 'Category ID for Media'],
    ['applications', [{ id: 'plex', name: 'Plex', category: 'media' }], 'Application ID for Plex'],
    ['bookmarks', [{ id: 'docs', name: 'Docs' }], 'Bookmark ID for Docs'],
  ] as const)('preserves keyboard focus while editing %s IDs', async (collection, items, label) => {
    const user = userEvent.setup();
    const edited = vi.fn((event: CollectionEditEvent) => {
      if (event.field !== 'id') return;

      view.fixture.componentRef.setInput(
        'items',
        items.map((item, itemIndex) =>
          itemIndex === event.index ? { ...item, id: event.value } : item,
        ),
      );
      view.fixture.detectChanges();
    });
    const view = await render(CollectionEditorComponent, {
      inputs: { collection, items },
      on: { editItem: edited },
    });

    const field = screen.getByLabelText(label);
    await user.click(field);
    await user.type(field, '-updated');

    expect(screen.getByLabelText(/ID for/)).toHaveValue(`${items[0].id}-updated`);
    expect(screen.getByLabelText(/ID for/)).toHaveFocus();
  });

  it('selects an application category from the current draft categories', async () => {
    const user = userEvent.setup();
    const edited = vi.fn();
    await render(CollectionEditorComponent, {
      inputs: {
        collection: 'applications',
        items: [{ id: 'plex', name: 'Plex', category: 'media' }],
        categoryOptions: categories,
      },
      on: { editItem: edited },
    });

    const category = screen.getByLabelText('Application category for Plex');
    expect(category).toHaveValue('media');
    expect(screen.getByRole('option', { name: 'Media' })).toHaveValue('media');
    expect(screen.queryByRole('textbox', { name: 'Application category for Plex' })).toBeNull();

    await user.selectOptions(category, 'tools');
    expect(edited).toHaveBeenLastCalledWith({ index: 0, field: 'category', value: 'tools' });
  });

  it('edits schema-backed application fields through accessible controls', async () => {
    const user = userEvent.setup();
    const edited = vi.fn();
    await render(CollectionEditorComponent, {
      inputs: {
        collection: 'applications',
        categoryOptions: categories,
        items: [
          {
            id: 'plex',
            name: 'Plex',
            description: 'Media server',
            url: 'https://plex.example.test',
            category: 'media',
            openNewTab: true,
            tags: ['media'],
            favorite: false,
            icon: { type: 'name', value: 'plex' },
          },
        ],
      },
      on: { editItem: edited },
    });

    await user.clear(screen.getByLabelText('Application URL for Plex'));
    await user.type(screen.getByLabelText('Application URL for Plex'), 'https://new.example.test');
    await user.clear(screen.getByLabelText('Application description for Plex'));
    await user.type(screen.getByLabelText('Application description for Plex'), 'Updated media');
    await user.clear(screen.getByLabelText('Application tags for Plex'));
    await user.type(screen.getByLabelText('Application tags for Plex'), 'media, streaming');
    await user.click(screen.getByLabelText('Open Plex in a new tab'));
    await user.click(screen.getByLabelText('Mark Plex as favorite'));
    await user.click(screen.getByLabelText('Enable health checks for Plex'));

    expect(edited).toHaveBeenCalledWith({
      index: 0,
      field: 'url',
      value: 'https://new.example.test',
    });
    expect(edited).toHaveBeenCalledWith({ index: 0, field: 'description', value: 'Updated media' });
    expect(edited).toHaveBeenCalledWith({ index: 0, field: 'tags', value: ['media', 'streaming'] });
    expect(edited).toHaveBeenCalledWith({ index: 0, field: 'openNewTab', value: false });
    expect(edited).toHaveBeenCalledWith({ index: 0, field: 'favorite', value: true });
    expect(edited).toHaveBeenCalledWith({ index: 0, field: 'healthCheck', value: true });
  });

  it('reflects an enabled healthCheck as a checked toggle', async () => {
    await render(CollectionEditorComponent, {
      inputs: {
        collection: 'applications',
        items: [{ id: 'plex', name: 'Plex', healthCheck: true }],
      },
    });

    expect(screen.getByLabelText('Enable health checks for Plex')).toBeChecked();
  });

  it('does not expose the healthCheck toggle for bookmarks', async () => {
    await render(CollectionEditorComponent, {
      inputs: {
        collection: 'bookmarks',
        items: [{ id: 'docs', name: 'Docs' }],
      },
    });

    expect(screen.queryByLabelText('Enable health checks for Docs')).toBeNull();
  });

  it('exposes an accessible bookmark URL field that emits typed draft edits', async () => {
    const user = userEvent.setup();
    const edited = vi.fn();
    await render(CollectionEditorComponent, {
      inputs: {
        collection: 'bookmarks',
        items: [{ id: 'docs', name: 'Docs', url: 'https://docs.example.test' }],
      },
      on: { editItem: edited },
    });

    const url = screen.getByLabelText('Bookmark URL for Docs');
    expect(url).toHaveValue('https://docs.example.test');
    expect(url).toHaveAttribute('type', 'url');

    await user.clear(url);
    await user.type(url, 'https://handbook.example.test');

    expect(edited).toHaveBeenLastCalledWith({
      index: 0,
      field: 'url',
      value: 'https://handbook.example.test',
    });
  });

  it('edits schema-backed bookmark icon, tags, description, and tab behavior', async () => {
    const user = userEvent.setup();
    const edited = vi.fn();
    await render(CollectionEditorComponent, {
      inputs: {
        collection: 'bookmarks',
        items: [
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
      },
      on: { editItem: edited },
    });

    await user.type(screen.getByLabelText('Bookmark description for Docs'), 'Handbook');
    await user.type(screen.getByLabelText('Bookmark tags for Docs'), 'docs, team');
    await user.selectOptions(screen.getByLabelText('Icon type for Docs'), 'name');
    await user.clear(screen.getByLabelText('Icon initials for Docs'));
    await user.type(screen.getByLabelText('Icon initials for Docs'), 'book');
    await user.click(screen.getByLabelText('Open Docs in a new tab'));

    expect(edited).toHaveBeenCalledWith({ index: 0, field: 'description', value: 'Handbook' });
    expect(edited).toHaveBeenCalledWith({ index: 0, field: 'tags', value: ['docs', 'team'] });
    expect(edited).toHaveBeenCalledWith({
      index: 0,
      field: 'icon',
      value: { type: 'name', value: 'DO' },
    });
    expect(edited).toHaveBeenCalledWith({
      index: 0,
      field: 'icon',
      value: { type: 'initials', value: 'book' },
    });
    expect(edited).toHaveBeenCalledWith({ index: 0, field: 'openNewTab', value: false });
  });

  it('safely disables application category selection when the draft has no categories', async () => {
    await render(CollectionEditorComponent, {
      inputs: {
        collection: 'applications',
        items: [{ id: 'plex', name: 'Plex', category: '' }],
        categoryOptions: [],
      },
    });

    expect(screen.getByLabelText('Application category for Plex')).toBeDisabled();
    expect(screen.getByLabelText('Application category for Plex')).toHaveValue('');
    expect(screen.getByRole('option', { name: 'No categories available' })).toBeInTheDocument();
  });

  it('renders move controls as icon-only buttons with accessible names and visible tooltips', async () => {
    await render(CollectionEditorComponent, {
      inputs: { collection: 'categories', items: categories },
    });

    const moveUp = screen.getByRole('button', { name: 'Move Tools up' });
    const moveDown = screen.getByRole('button', { name: 'Move Media down' });
    expect(moveUp).toHaveAttribute('title', 'Move Tools up');
    expect(moveDown).toHaveAttribute('title', 'Move Media down');
    expect(moveUp).toHaveTextContent('');
    expect(moveDown).toHaveTextContent('');
  });
});
