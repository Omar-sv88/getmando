import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { load } from 'js-yaml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildApp } from './app';
import { CachedAppStatus, StatusPoller } from './status-poller';

const token = 'secret-token';

const validConfig = {
  metadata: { title: 'Mando', description: 'My Selfhosted Applications' },
  categories: [{ id: 'homelab', name: 'Homelab' }],
  applications: [
    {
      id: 'app1',
      name: 'App One',
      description: 'An app',
      url: 'https://example.com',
      icon: { type: 'name', value: 'app' },
      category: 'homelab',
    },
  ],
  bookmarks: [],
  settings: {},
};

describe('GET /api/status', () => {
  let dir: string;
  let targetPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'config-write-api-'));
    targetPath = join(dir, 'dashboard.yaml');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const pollerWith = (intervalMs: number, apps: Record<string, CachedAppStatus>): StatusPoller => ({
    start: vi.fn(),
    stop: vi.fn(),
    getIntervalMs: () => intervalMs,
    getStatuses: () => apps,
  });

  it('returns the cached statuses and the configured interval without any token header', async () => {
    const apps = { app1: { status: 'up' as const, checkedAt: '2026-01-01T00:00:00.000Z' } };
    const app = buildApp({
      configWriteToken: token,
      targetPath,
      statusPoller: pollerWith(30_000, apps),
    });

    const response = await app.inject({ method: 'GET', url: '/api/status' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ intervalMs: 30_000, apps });
  });

  it('exposes only status and checkedAt per app — no url or other config fields', async () => {
    const app = buildApp({
      configWriteToken: token,
      targetPath,
      statusPoller: pollerWith(60_000, { app1: { status: 'down', checkedAt: '2026-01-01T00:00:00.000Z' } }),
    });

    const response = await app.inject({ method: 'GET', url: '/api/status' });

    const body = response.json();
    expect(Object.keys(body.apps.app1).sort()).toEqual(['checkedAt', 'status']);
    expect(response.body).not.toContain('url');
  });

  it('responds 200 with empty apps before any check has completed', async () => {
    const app = buildApp({
      configWriteToken: token,
      targetPath,
      statusPoller: pollerWith(60_000, {}),
    });

    const response = await app.inject({ method: 'GET', url: '/api/status' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ intervalMs: 60_000, apps: {} });
  });

  it('responds 200 with the default interval when no poller is wired up', async () => {
    const app = buildApp({ configWriteToken: token, targetPath });

    const response = await app.inject({ method: 'GET', url: '/api/status' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ intervalMs: 60_000, apps: {} });
  });
});

describe('POST /api/config — token auth', () => {
  let dir: string;
  let targetPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'config-write-api-'));
    targetPath = join(dir, 'dashboard.yaml');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('rejects a request with no token header, without reaching the route handler', async () => {
    const app = buildApp({ configWriteToken: token, targetPath });

    const response = await app.inject({ method: 'POST', url: '/api/config', payload: validConfig });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ status: 'unauthorized' });
  });

  it('rejects a request with an incorrect token', async () => {
    const app = buildApp({ configWriteToken: token, targetPath });

    const response = await app.inject({
      method: 'POST',
      url: '/api/config',
      headers: { 'x-config-token': 'wrong' },
      payload: validConfig,
    });

    expect(response.statusCode).toBe(401);
  });

  it.each([
    ['no token header', undefined],
    ['an empty token header', ''],
    ['any non-empty token header', 'attacker-guess'],
  ])('401s %s when CONFIG_WRITE_TOKEN is unset', async (_label, headerValue) => {
    const app = buildApp({ configWriteToken: '', targetPath });

    const response = await app.inject({
      method: 'POST',
      url: '/api/config',
      ...(headerValue === undefined ? {} : { headers: { 'x-config-token': headerValue } }),
      payload: validConfig,
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ status: 'unauthorized' });
  });

  it('serves GET /api/status without CONFIG_WRITE_TOKEN being set', async () => {
    const app = buildApp({ configWriteToken: '', targetPath });

    const response = await app.inject({ method: 'GET', url: '/api/status' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ intervalMs: 60_000, apps: {} });
  });
});

describe('POST /api/config — schema validation and write', () => {
  let dir: string;
  let targetPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'config-write-api-'));
    targetPath = join(dir, 'dashboard.yaml');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('accepts a valid config, writes it as YAML, and reports saved', async () => {
    const app = buildApp({ configWriteToken: token, targetPath });

    const response = await app.inject({
      method: 'POST',
      url: '/api/config',
      headers: { 'x-config-token': token },
      payload: validConfig,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'saved' });

    const written = load(await readFile(targetPath, 'utf8'));
    expect(written).toMatchObject({
      metadata: validConfig.metadata,
      applications: [expect.objectContaining({ id: 'app1', category: 'homelab' })],
    });
  });

  it('omits a blank background image override instead of writing it verbatim', async () => {
    const app = buildApp({ configWriteToken: token, targetPath });
    const configWithBlankBackground = {
      ...validConfig,
      settings: { lightBackgroundImage: '', darkBackgroundImage: '   ' },
    };

    const response = await app.inject({
      method: 'POST',
      url: '/api/config',
      headers: { 'x-config-token': token },
      payload: configWithBlankBackground,
    });

    expect(response.statusCode).toBe(200);
    const written = load(await readFile(targetPath, 'utf8')) as { settings: object };
    expect(written.settings).not.toHaveProperty('lightBackgroundImage');
    expect(written.settings).not.toHaveProperty('darkBackgroundImage');
  });

  it('keeps a non-blank background image override', async () => {
    const app = buildApp({ configWriteToken: token, targetPath });
    const configWithCustomBackground = {
      ...validConfig,
      settings: { lightBackgroundImage: 'custom-light.jpg' },
    };

    await app.inject({
      method: 'POST',
      url: '/api/config',
      headers: { 'x-config-token': token },
      payload: configWithCustomBackground,
    });

    const written = load(await readFile(targetPath, 'utf8')) as {
      settings: { lightBackgroundImage: string };
    };
    expect(written.settings.lightBackgroundImage).toBe('custom-light.jpg');
  });

  it('rejects a semantically invalid config (dangling category reference) and writes nothing', async () => {
    const app = buildApp({ configWriteToken: token, targetPath });
    const invalidConfig = {
      ...validConfig,
      applications: [{ ...validConfig.applications[0], category: 'ghost' }],
    };

    const response = await app.inject({
      method: 'POST',
      url: '/api/config',
      headers: { 'x-config-token': token },
      payload: invalidConfig,
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.status).toBe('invalid');
    expect(body.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ['applications', '0', 'category'],
          message: expect.stringContaining("'ghost' does not exist"),
        }),
      ]),
    );
    await expect(readFile(targetPath, 'utf8')).rejects.toThrow(/ENOENT/);
  });

  it('rejects a structurally invalid config (missing required field) and writes nothing', async () => {
    const app = buildApp({ configWriteToken: token, targetPath });
    const { metadata: _metadata, ...withoutMetadata } = validConfig;

    const response = await app.inject({
      method: 'POST',
      url: '/api/config',
      headers: { 'x-config-token': token },
      payload: withoutMetadata,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().status).toBe('invalid');
    await expect(readFile(targetPath, 'utf8')).rejects.toThrow(/ENOENT/);
  });

  it('leaves an existing file untouched when the new payload is invalid', async () => {
    await writeFile(targetPath, 'metadata:\n  title: Existing\n', 'utf8');
    const app = buildApp({ configWriteToken: token, targetPath });
    const invalidConfig = {
      ...validConfig,
      applications: [{ ...validConfig.applications[0], category: 'ghost' }],
    };

    await app.inject({
      method: 'POST',
      url: '/api/config',
      headers: { 'x-config-token': token },
      payload: invalidConfig,
    });

    await expect(readFile(targetPath, 'utf8')).resolves.toBe('metadata:\n  title: Existing\n');
  });
});

describe('POST /api/config — body size limit and malformed JSON', () => {
  let dir: string;
  let targetPath: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'config-write-api-'));
    targetPath = join(dir, 'dashboard.yaml');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('rejects a body over the configured limit before parsing, and writes nothing', async () => {
    const app = buildApp({ configWriteToken: token, targetPath, bodyLimit: 64 });

    const response = await app.inject({
      method: 'POST',
      url: '/api/config',
      headers: { 'x-config-token': token },
      payload: validConfig,
    });

    expect(response.statusCode).toBe(413);
    expect(response.json()).toEqual({ status: 'error', message: expect.any(String) });
    await expect(readFile(targetPath, 'utf8')).rejects.toThrow(/ENOENT/);
  });

  it('rejects a malformed JSON body with a 400 in the standard error shape', async () => {
    const app = buildApp({ configWriteToken: token, targetPath });

    const response = await app.inject({
      method: 'POST',
      url: '/api/config',
      headers: { 'x-config-token': token, 'content-type': 'application/json' },
      payload: '{ not valid json',
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.status).toBe('invalid');
    expect(body.errors).toEqual([expect.objectContaining({ path: [] })]);
    await expect(readFile(targetPath, 'utf8')).rejects.toThrow(/ENOENT/);
  });
});
