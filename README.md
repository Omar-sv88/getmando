<p align="center">
  <img alt="getMando" width="160" src="public/img/mando.png" />
  <br>
  <em>Mando</em>
  <br>
  <em>A simply and beautiful dashboard</em>
</p>

![Version](https://badgen.net/github/release/rackandhost/getmando/stable)
![Angular](https://img.shields.io/badge/Angular-21.1.0-red)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue)
![Github stars](https://badgen.net/github/stars/rackandhost/getmando?icon=github&label=stars)
![Github last-commit](https://img.shields.io/github/last-commit/rackandhost/getmando)
![Github last-commit](https://badgen.net/github/license/rackandhost/getmando)

---

<img alt="Dashboard" width="1024" src="screenshots/dashboard.png" />

<img alt="Dashboard Light" width="1024" src="screenshots/dashboard_light.png" />

<img alt="Visual Configurator" width="1024" src="screenshots/configurator.png" />

## 📖 Overview

**Mando** is a beautiful and simply dashboard (not pretend to add too many features such a widgets, weather, etc...) for your self-hosted applications. Built with modern web technologies, it provides an elegant glassmorphism UI to organize and access all your homelab services from a single place. 

### ✨ Key Features

- **🎨 Inspiring Design** - Minimalist interface with glassmorphism effects
- **⚡ Fast & Lightweight** - Built with Angular 21 and TailwindCSS 4 for optimal performance
- **🔍 Real-time Search** - Instant search through your applications
- **🏷️ Categories** - Organize your apps into customizable categories
- **🔗 Web Search Integration** - Built-in support for Google, DuckDuckGo, Startpage, and YouTube
- **📱 Fully Responsive** - Optimized for mobile, tablet, and desktop
- **♿ Accessible** - WCAG AA compliant with keyboard navigation
- **🐳 Docker Ready** - Easy deployment with pre-built containers
- **🛠️ Visual Configurator** - Build and edit your entire dashboard through accessible forms at `/configure` and save it straight to the server — no YAML required
- **⚙️ Optional YAML** - Manage the same configuration as a declarative `dashboard.yaml` file whenever you prefer

---

## 🚀 Quick Start (Docker)

Mando starts with sensible defaults and a built-in visual editor. You bring up the
container, open `/configure`, build your dashboard through forms, and click **Save** —
there is no configuration file to write by hand.

### Using Docker Compose (Recommended)

1. **Create a `docker-compose.yaml` file:**
```yaml
services:
  dashboard:
    image: ghcr.io/rackandhost/getmando:latest
    container_name: getmando-dashboard
    ports:
      - '8080:80'
    volumes:
      # Persists whatever the visual editor saves. A host directory keeps
      # dashboard.yaml visible and version-controllable; it's created on first run
      # if it doesn't exist. Prefer a Docker-managed named volume? See below.
      - ./config:/app/config:rw
    restart: unless-stopped
    environment:
      - NODE_ENV=production
      # Lets the visual editor's "Save" write to the mounted config — pick your own secret.
      # Leave it unset to run fully read-only (copy/download from the editor still work).
      - CONFIG_WRITE_TOKEN=change-me
    healthcheck:
      test: ['CMD', 'curl', '-f', 'http://localhost/health']
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 5s
    networks:
      - dashboard-network

networks:
  dashboard-network:
    driver: bridge
```

<details>
<summary>Prefer a Docker-managed named volume instead of a host directory?</summary>

```yaml
services:
  dashboard:
    # ...same as above, but swap the config volume for:
    volumes:
      - getmando-config:/app/config

volumes:
  getmando-config:
```

</details>

2. **Start it:** `docker compose up -d`

3. **Open** `http://localhost:8080` — the dashboard loads with default settings.

4. **Build your dashboard.** Go to `http://localhost:8080/configure`, add your
   categories, applications, and bookmarks through the forms, then click **Save**.
   The first save asks once for the `CONFIG_WRITE_TOKEN` value (kept in your browser
   afterwards). The dashboard updates immediately and the config is written to the
   mounted volume as `dashboard.yaml`.

That's the whole setup — no file authored by hand. If you'd rather manage the
configuration as a file (GitOps, bulk edits, migrating an existing dashboard), see the
**Configuration** section below.

### Using Docker CLI

```bash
docker run -d \
  --name getmando-dashboard \
  -p 8080:80 \
  -v $(pwd)/config:/app/config:rw \
  -e CONFIG_WRITE_TOKEN=change-me \
  --restart unless-stopped \
  ghcr.io/rackandhost/getmando:latest
```

Then open `http://localhost:8080/configure` and Save.

> **⚠️ Upgrading from an earlier version?** Earlier setups mounted a read-only
> `dashboard.yaml` and had no `CONFIG_WRITE_TOKEN`. That still works unchanged — the
> dashboard serves your existing file read-only and the editor's "Save" is simply
> disabled (copy and download still work). To edit from the browser, mount the config
> **directory** `:rw` (`./config:/app/config:rw`, keeping your existing
> `./config/dashboard.yaml` in place) and set `CONFIG_WRITE_TOKEN`.

---

## ⚙️ Configuration

Mando's configuration is a single `dashboard.yaml` in the mounted config directory,
written for you by the visual editor at `/configure` — **you normally never touch it**.
Until you save from the editor there's no file at all and the dashboard runs on built-in
defaults. Manage the file directly only if you prefer a file-based workflow.

### Visual editor (recommended)

Open `/configure` (there's a gear icon in the header too). Build metadata, categories,
applications, and bookmarks through typed forms starting from an empty draft, the currently
mounted config, or a local YAML file you import. The editor validates the draft, then lets
you **copy** it to the clipboard, **download** it as `dashboard.yaml`, or **save** it to the
server. Copy and download happen entirely in the browser and never touch the mounted file.

**Save** writes the validated draft to the mounted `dashboard.yaml` over
`POST /api/config`, so the running dashboard reflects it immediately without a manual copy. It
requires the volume to be mounted `:rw` and `CONFIG_WRITE_TOKEN` to be set on the container (see
"Quick Start (Docker)" above); the first save prompts for that same token value, which is
then kept in this browser's `localStorage` for subsequent saves. This is a single shared secret, not
a user account — anyone who knows it (or who already has write access to your deployment) can save
changes, and it's not a substitute for keeping the dashboard off the public internet or behind your
own access control.

Valid configurations must use IDs that are unique across categories, applications, and bookmarks.
Application `category` values must refer to an existing category ID, and category IDs must not be
`apps`, `bookmarks`, or `favorites` because those are reserved virtual categories. Exported YAML is
normalized to the supported schema and field order. Comments, original formatting, and unknown keys
are not preserved, and schema defaults can be written explicitly in the output.

### File-based configuration (advanced)

If you'd rather manage the configuration as a file — GitOps, bulk edits, or migrating an
existing dashboard — author `dashboard.yaml` yourself and mount it into the config
directory. The `/configure` editor's copy and download actions produce a file in exactly
this format, so you can start visually and take over the file later.

**Top-level structure:**

```yaml
metadata:           # Dashboard metadata
categories:         # Your app categories
applications:       # Your self-hosted applications
bookmarks:          # Quick-access bookmarks
settings:           # Dashboard settings
```

A complete, annotated example ships in the repository at
[`config/dashboard.example.yaml`](config/dashboard.example.yaml). Minimal starting point:

```yaml
metadata:
  title: 'My Homelab'
  description: 'All my self-hosted services'

categories:
  - id: 'media'
    name: 'Media'

applications:
  - id: 'jellyfin'
    name: 'Jellyfin'
    description: 'Free software media system'
    url: 'https://jellyfin.example.com'
    icon:
      type: 'name'
      value: 'jellyfin'
    category: 'media'
```

Mount it the same way as the config directory shown in Quick Start above; the running
dashboard picks it up on load. If the file is missing or invalid, Mando falls back to
built-in defaults and shows a notification.

---

### 📋 Configuration Reference

#### `metadata` - Dashboard Information

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `title` | `string` | ✅ Yes | - | Dashboard title displayed in header |
| `description` | `string` | ✅ Yes | - | Short description or tagline |

**Example:**
```yaml
metadata:
  title: 'My Homelab'
  description: 'All my self-hosted services'
```

---

#### `categories` - App Categories

Each category needs:
| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `id` | `string` | ✅ Yes | - | Unique identifier (used by apps) |
| `name` | `string` | ✅ Yes | - | Display name |

Category IDs must be unique across the whole configuration. Do not use `apps`, `bookmarks`, or
`favorites`; the dashboard reserves those IDs for virtual categories.

**Example:**
```yaml
categories:
  - id: 'media'
    name: 'Media'
  - id: 'productivity'
    name: 'Productivity'
  - id: 'home-automation'
    name: 'Home Automation'
  - id: 'networking'
    name: 'Networking'
```

---

#### `applications` - Your Self-Hosted Apps

Each application supports:

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `id` | `string` | ✅ Yes | - | Unique identifier |
| `name` | `string` | ✅ Yes | - | App display name (max 100 chars) |
| `description` | `string` | ✅ Yes | - | Short description (max 255 chars) |
| `url` | `string` (URL) | ✅ Yes | - | Full URL to the application |
| `icon` | `object` | ✅ Yes | - | Icon configuration (see below) |
| `category` | `string` | ✅ Yes | - | Category ID to belong to |
| `openNewTab` | `boolean` | No | `true` | Open in new tab or same window |
| `tags` | `array[string]` | No | `[]` | Searchable tags |
| `favorite` | `boolean` | No | `false` | Mark as favorite and show in Favorites category |
| `healthCheck` | `boolean` | No | `false` | Show a live up/down status badge (see [App Status Indicator](#-app-status-indicator)) |

Application IDs must be unique across the whole configuration, and every `category` value must
match a declared category ID.

**Icon Configuration:**

The `icon` object supports three types:

| Type | Value | Description |
|------|-------|-------------|
| `name` | `{ type: 'name', value: 'plex' }` | Use icon by name (see [haroeris01/walkxcode-dashboard-icons](https://github.com/haroeris01/walkxcode-dashboard-icons/blob/main/ICONS.md)) |
| `url` | `{ type: 'url', value: 'https://...' }` | Use custom URL for icon |
| `initials` | `{ type: 'initials', value: 'AB' }` | Generate icon from initials |

**Example:**
```yaml
applications:
  - id: 'plex'
    name: 'Plex'
    description: 'Media server for movies, TV shows, and music'
    url: 'https://plex.example.com'
    icon:
      type: 'name'
      value: 'plex'
    category: 'media'
    openNewTab: true
    favorite: true
    tags:
      - media
      - streaming

  - id: 'nextcloud'
    name: 'Nextcloud'
    description: 'Productivity platform for file storage and collaboration'
    url: 'https://nextcloud.example.com'
    icon:
      type: 'name'
      value: 'nextcloud'
    category: 'productivity'
    openNewTab: true
    tags:
      - cloud
      - files

  - id: 'custom-app'
    name: 'Custom App'
    description: 'App with custom icon'
    url: 'https://custom.example.com'
    icon:
      type: 'url'
      value: 'https://example.com/icon.png'
    category: 'networking'
    openNewTab: true
    tags:
      - custom
```

---

#### `bookmarks` - Quick Access Bookmarks

Bookmarks work exactly like applications but don't require a category.

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `id` | `string` | ✅ Yes | - | Unique identifier |
| `name` | `string` | ✅ Yes | - | Bookmark name (max 100 chars) |
| `description` | `string` | ✅ Yes | - | Short description (max 255 chars) |
| `url` | `string` (URL) | ✅ Yes | - | Full URL |
| `icon` | `object` | ✅ Yes | - | Icon configuration (same as apps) |
| `openNewTab` | `boolean` | No | `true` | Open in new tab |
| `tags` | `array[string]` | No | `[]` | Searchable tags |

Bookmark IDs must also be unique across categories, applications, and bookmarks.

**Example:**
```yaml
bookmarks:
  - id: 'google'
    name: 'Google'
    description: 'The search engine'
    url: 'https://google.com'
    openNewTab: true
    icon:
      type: 'name'
      value: 'google'
    tags:
      - web
```

---

#### `settings` - Dashboard Settings

| Field                  | Type            | Default          | Options                 | Description                                   |
|------------------------|-----------------|------------------|-------------------------|-----------------------------------------------|
| `theme`                | `string`        | `auto`           | `auto`, `light`, `dark` | Set dark and light mode                       |
| `dateFormat`           | `string`        | `dd-MM-yyyy`     | Any format              | Date format for clock display                 |
| `datePosition`         | `string`        | `top`            | `top`, `bottom`         | Clock date position                           |
| `showSeconds`          | `boolean`       | `false`          | -                       | Show seconds in clock                         |
| `showDate`             | `boolean`       | `false`          | -                       | Show date in clock                            |
| `itemsPerRow`          | `number`        | `4`              | `1-12`                  | Number of apps per row on desktop             |
| `allowBookmarks`       | `boolean`       | `false`          | -                       | Enable bookmarks section                      |
| `showAllCategory`      | `boolean`       | `true`           | -                       | Show "All" category filter                    |
| `showDescriptions`     | `boolean`       | `true`           | -                       | Show app descriptions in cards                |
| `showLabels`           | `boolean`       | `true`           | -                       | Show app tags as labels                       |
| `searchEngines`        | `array[string]` | `[]`             | See below               | Available search engines                      |
| `lightBackgroundImage` | `string`        | `background.jpg` | -                       | Custom image or url as light theme background |
| `darkBackgroundImage`  | `string`        | `background.jpg` | -                       | Custom image or url as dark theme background  |

**Search Engine Options:**
- `google` - Google Search
- `duckduckgo` - DuckDuckGo
- `startpage` - Startpage
- `youtube` - YouTube

**Example:**
```yaml
settings:
  theme: 'auto'
  dateFormat: 'd MMMM yyyy'
  datePosition: 'bottom'
  showSeconds: false
  showDate: true
  itemsPerRow: 5
  allowBookmarks: true
  showAllCategory: true
  showDescriptions: true
  showLabels: true
  lightBackgroundImage: 'my-custom-background.jpg' # Or 'https://domain.tld/my-custom-image.jpg'
  darkBackgroundImage: 'my-custom-background.jpg' # Or 'https://domain.tld/my-custom-image.jpg'
  searchEngines:
    - 'google'
    - 'duckduckgo'
    - 'youtube'
```

---

### 🟢 App Status Indicator

Applications with `healthCheck: true` show a small badge on their card — a green ✓ when the app is
reachable, a red ✕ when it is not (a glyph as well as colour, so the state does not rely on colour
vision). The state is also part of the card's accessible name for screen readers. Checks run
server-side, from the same container as the dashboard (not from each viewer's browser), so the badge
reflects reachability from the dashboard host's network.

Semantics and guarantees:

- **Any HTTP response counts as up** (2xx through 5xx). Many self-hosted apps redirect to a login
  page or return 401/500 while perfectly healthy; only a network-level failure (connection
  refused/reset, DNS failure) or a timeout (5s per check) counts as down.
- **Self-signed/invalid TLS certificates are accepted** for these checks specifically — a status
  dot answers "is something listening", not "does this app have a browser-trusted certificate".
  TLS verification is unchanged for every other request the process makes.
- **Opt-in per app, default off** — apps without `healthCheck: true` are never probed, and they
  show no badge.
- Checks run every `STATUS_CHECK_INTERVAL_MS` (see [Environment Variables](#environment-variables)),
  and the badge is unknown (not shown) until the first check completes. Results are cached in
  memory only — after a container restart every monitored app briefly shows no badge again.
- The dashboard only polls the status endpoint while at least one application has `healthCheck`
  enabled — no app monitored means no periodic requests at all — and it picks up or drops polling
  automatically as the configuration changes.
- The cached results are served by the unauthenticated, read-only `GET /api/status` endpoint,
  which exposes only the status and last-checked timestamp per app id — no URLs or other config
  data.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `production` | Environment mode |
| `CONFIG_WRITE_TOKEN` | *(unset)* | Shared secret required by the configurator's "Save" action. Unset means the dashboard runs read-only; the write endpoint returns 401 for every request. |
| `STATUS_CHECK_INTERVAL_MS` | `60000` | How often (in milliseconds) the sidecar re-checks every `healthCheck: true` application. The dashboard polls `GET /api/status` at this same cadence. |

---

## 🔧 Development

### Prerequisites

- Node.js 22 LTS (recommended; matches the version used in CI)
- npm 11+

GitHub Actions CI runs on Node.js 22 LTS, and using the same version locally is recommended.

### Setup

```bash
# Clone the repository
git clone https://github.com/rackandhost/getmando.git
cd getmando

# Install dependencies
npm install

# Start development server
npm start

# Build for production
npm run build

# Run lint checks
npm run lint

# Check source formatting
npm run format:check

# Run tests
npm test
```

`npm test` includes axe-core accessibility assertions for the rendered `app-finder`, `app-card`, `app-categories`, and `dashboard` states covered by the component specs, so the existing CI test job fails on violations found in those checks. The shared jsdom helper currently disables axe's `color-contrast` rule because that rule needs browser APIs that are not reliably available in this test environment.

`npm install` runs the Husky `prepare` script automatically. The pre-commit hook uses `lint-staged` to lint staged TypeScript and format staged TypeScript, HTML, and SCSS files under `src/`. The formatting scripts and CI check use that same source-only scope.

### Development Server

The dev server runs on `http://localhost:4200` with hot-reload enabled.

### Local Development with the Write API

`npm start` alone serves a read-only dashboard — the configurator's `Save` action needs the
`config-write-api` sidecar, which normally only runs inside the Docker image. To run both locally
without building the image:

```bash
npm run dev
```

This starts the Angular dev server (`:4200`) and the sidecar (`:3000`) together; `proxy.conf.json`
forwards `/api/*` requests from the dev server to the sidecar, and Ctrl+C stops both. It writes to
`public/config/dashboard.yaml` — the same file the dev server already reads — using the default
token `dev-token` (enter that in the configurator's save prompt). Override `CONFIG_WRITE_TOKEN`,
`CONFIG_PATH`, or `SERVER_PORT` as environment variables to change any of that.

### Building for Production

```bash
npm run build
```

Build artifacts are created in the `dist/` directory.

---

## 🐳 Docker Image Details

### Container Features

- ✅ Optimized image size
- ✅ Security headers enabled
- ✅ Gzip compression
- ✅ Long-term caching for static assets
- ✅ Mountable config volume
- ✅ Optional write API for saving the configurator draft directly to the mounted `dashboard.yaml`
- ✅ Health checks

---

## 📊 Performance

| Metric | Value |
|--------|-------|
| Initial Load | <2s |
| Search Latency | <50ms |
| Bundle Size (gzipped) | <500KB |
| Lighthouse Score | >85 |
| WCAG Compliance | AA |

---

## 🗺️ Roadmap

### Current Release (v2.0.0)
- ✅ Core dashboard functionality
- ✅ YAML configuration
- ✅ Search and filtering
- ✅ Search engines
- ✅ Docker deployment
- ✅ Custom background image
- ✅ Dark/light mode
- ✅ Different images for Dark/light mode
- ✅ Favorites support
- ✅ Comprehensive test suite

### Planned Features
- [ ] Add DB feature to allow user be able to choose between .yaml configuration or DB
- [ ] Statistics/analytics when DB feature are available
- [ ] Backup/restore configurations
- [ ] Wiki

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

### Development Guidelines

- Read [ARCHITECTURE.md](ARCHITECTURE.md) for the current system flows, ownership boundaries, and
  change map.
- Follow Angular best practices
- Use TypeScript strict mode
- Write tests for new features
- Do not commit focused tests such as `.only`, `fit`, or `fdescribe`; CI fails fast on them
- Run `npm run lint` before opening a pull request
- Run `npm run format:check` to verify source formatting before opening a pull request
- Ensure accessibility (WCAG AA)
- Keep axe-core component accessibility checks passing; they run as part of `npm test` for the covered component states, with `color-contrast` excluded in jsdom
- Keep components small and focused

---

## 📝 License

This project is licensed under the GNU General Public License v3.0 - see the LICENSE file for details.

---

## 🙏 Acknowledgments

- Built with [Angular](https://angular.dev/)
- Styled with [TailwindCSS](https://tailwindcss.com/)
- Icons from [ng-icons](https://ng-icons.github.io/ng-icons/)
- App Icons from [haroeris01/walkxcode-dashboard-icons](https://github.com/haroeris01/walkxcode-dashboard-icons)

---

## 📮 Support

- 🐛 **Bug Reports:** [GitHub Issues](https://github.com/rackandhost/getmando/issues)
- 💡 **Feature Requests:** [GitHub Discussions](https://github.com/rackandhost/getmando/discussions)

---

## ⭐ Star History

<a href="https://www.star-history.com/?type=date&legend=top-left&repos=rackandhost%2Fgetmando">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=rackandhost/getmando&type=date&theme=dark&legend=top-left&sealed_token=XuQntX5nbzSy--PFt4qUdr0-yhsVXpUhpudaCYzQ0SLlgAWHw2bGfDXc5xHkUs4Z_X_YMontQnBHia5tLKWTkJYo3OUhei4h71DDWHv5smlYewoqKJNYAgjyNxdRJji0VwBgZiH6Cg77_aVappaBnJXNe04xtEOwz6ArhpEgax6vM50ud_sACceuTMkd" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=rackandhost/getmando&type=date&legend=top-left&sealed_token=XuQntX5nbzSy--PFt4qUdr0-yhsVXpUhpudaCYzQ0SLlgAWHw2bGfDXc5xHkUs4Z_X_YMontQnBHia5tLKWTkJYo3OUhei4h71DDWHv5smlYewoqKJNYAgjyNxdRJji0VwBgZiH6Cg77_aVappaBnJXNe04xtEOwz6ArhpEgax6vM50ud_sACceuTMkd" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=rackandhost/getmando&type=date&legend=top-left&sealed_token=XuQntX5nbzSy--PFt4qUdr0-yhsVXpUhpudaCYzQ0SLlgAWHw2bGfDXc5xHkUs4Z_X_YMontQnBHia5tLKWTkJYo3OUhei4h71DDWHv5smlYewoqKJNYAgjyNxdRJji0VwBgZiH6Cg77_aVappaBnJXNe04xtEOwz6ArhpEgax6vM50ud_sACceuTMkd" />
 </picture>
</a>
---

<div align="center">
  Built with ❤️ for the homelab community
</div>
