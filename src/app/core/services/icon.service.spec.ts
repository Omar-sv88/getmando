import { TestBed } from '@angular/core/testing';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';

import { SelfhostedApp } from '../models/dashboard.models';

import { IconService } from './icon.service';

describe('IconService', () => {
  let service: IconService;
  let bypassSecurityTrustUrl: ReturnType<typeof vi.fn>;

  const app: SelfhostedApp = {
    id: 'home-assistant',
    name: 'Home Assistant',
    description: 'Home automation',
    url: 'https://home.example.com',
    icon: { type: 'name', value: 'Home Assistant' },
    category: 'automation',
    openNewTab: true,
    tags: [],
    favorite: false,
    healthCheck: false,
  };

  const decodeSvg = (url: string): string => decodeURIComponent(url.split(',')[1]);

  beforeEach(() => {
    bypassSecurityTrustUrl = vi.fn();

    TestBed.configureTestingModule({
      providers: [
        IconService,
        {
          provide: DomSanitizer,
          useValue: { bypassSecurityTrustUrl },
        },
      ],
    });

    service = TestBed.inject(IconService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('icon resolution', () => {
    it('returns configured URLs unchanged', () => {
      const url = 'https://cdn.example.com/icon.svg?variant=dark';

      expect(service.getIconUrlFromConfig({ type: 'url', value: url }, app.name)).toBe(url);
    });

    it('resolves names through the dashboard icons CDN with normalized casing and spaces', () => {
      expect(service.getIconUrl(app)).toBe(
        'https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/home-assistant.png',
      );
    });

    it('generates initials from the first and last words when no custom value is supplied', () => {
      const url = service.getIconUrlFromConfig(
        { type: 'initials', value: '' },
        'Home Media Server',
      );

      expect(url).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
      expect(url).not.toContain('<svg');
      expect(decodeSvg(url)).toContain('>\n          HS\n        </text>');
    });

    it('uses up to two uppercase characters for a single-word name', () => {
      const svg = decodeSvg(service.getIconUrlFromConfig({ type: 'initials', value: '' }, 'plex'));

      expect(svg).toContain('>\n          PL\n        </text>');
    });

    it('uses custom initials and URI-encodes them inside the SVG data URL', () => {
      const url = service.getIconUrlFromConfig({ type: 'initials', value: 'A&B' }, 'Automation');

      expect(url).not.toContain('A&B');
      expect(url).toContain('A%26B');
      expect(decodeSvg(url)).toContain('A&B');
    });
  });

  describe('caching', () => {
    it('reuses a resolved icon until the cache is cleared', () => {
      const config = { type: 'initials', value: '' } as const;
      const firstUrl = service.getIconUrlFromConfig(config, 'Alpha');

      expect(service.getIconUrlFromConfig(config, 'Beta')).toBe(firstUrl);

      service.clearCache();

      const refreshedUrl = service.getIconUrlFromConfig(config, 'Beta');
      expect(refreshedUrl).not.toBe(firstUrl);
      expect(decodeSvg(refreshedUrl)).toContain('>\n          BE\n        </text>');
    });
  });

  describe('security and fallbacks', () => {
    it('delegates the resolved URL to Angular sanitization and returns its SafeUrl', () => {
      const safeUrl = { changingThisBreaksApplicationSecurity: 'trusted' } as SafeUrl;
      bypassSecurityTrustUrl.mockReturnValue(safeUrl);
      const urlApp = {
        ...app,
        icon: { type: 'url', value: 'https://cdn.example.com/icon.svg' } as const,
      };

      expect(service.getIconUrlSafe(urlApp)).toBe(safeUrl);
      expect(bypassSecurityTrustUrl).toHaveBeenCalledOnce();
      expect(bypassSecurityTrustUrl).toHaveBeenCalledWith('https://cdn.example.com/icon.svg');
    });

    it('builds a Google favicon URL from a valid hostname', () => {
      expect(service.getGoogleFavicon('https://user:secret@app.example.com:8443/path')).toBe(
        'https://www.google.com/s2/favicons?domain=app.example.com&sz=128',
      );
    });

    it('falls back to an encoded default SVG for invalid URLs', () => {
      const url = service.getGoogleFavicon('not a URL');

      expect(url).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
      expect(decodeSvg(url)).toContain('fill="#6366f1"');
    });
  });

  describe('image loading', () => {
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      src = '';
    }

    const installImageStub = (): FakeImage[] => {
      const images: FakeImage[] = [];
      vi.stubGlobal(
        'Image',
        class extends FakeImage {
          constructor() {
            super();
            images.push(this);
          }
        },
      );
      return images;
    };

    it('resolves after the icon loads', async () => {
      const images = installImageStub();

      const preload = service.preloadIcon('https://cdn.example.com/icon.png');
      expect(images[0].src).toBe('https://cdn.example.com/icon.png');
      images[0].onload?.();

      await expect(preload).resolves.toBeUndefined();
    });

    it('rejects with the failing URL when the icon cannot load', async () => {
      const images = installImageStub();

      const preload = service.preloadIcon('https://cdn.example.com/missing.png');
      images[0].onerror?.();

      await expect(preload).rejects.toThrow(
        'Failed to load icon: https://cdn.example.com/missing.png',
      );
    });

    it('creates an accessible image element after preloading its resolved URL', async () => {
      vi.spyOn(service, 'preloadIcon').mockResolvedValue();

      const element = await service.getIconElement(app);

      expect(service.preloadIcon).toHaveBeenCalledWith(
        'https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/home-assistant.png',
      );
      expect(element).toBeInstanceOf(HTMLImageElement);
      expect(element.src).toBe(
        'https://cdn.jsdelivr.net/gh/walkxcode/dashboard-icons/png/home-assistant.png',
      );
      expect(element.alt).toBe('Home Assistant');
    });
  });
});
