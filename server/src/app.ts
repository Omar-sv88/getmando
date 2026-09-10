import Fastify, { FastifyError, FastifyInstance } from 'fastify';
import { dump } from 'js-yaml';

import {
  DashboardConfigSchema,
  omitBlankBackgroundImages,
} from '../../src/app/core/models/dashboard.models';

import { writeConfigAtomically } from './write-config';
import { DEFAULT_STATUS_CHECK_INTERVAL_MS, StatusPoller } from './status-poller';

export interface AppOptions {
  configWriteToken: string;
  targetPath: string;
  /** Max request body size in bytes. Defaults to 256KB — generous for a dashboard config JSON. */
  bodyLimit?: number;
  /** Owns the cached app statuses served by GET /api/status. Optional for tests of other routes. */
  statusPoller?: StatusPoller;
}

const DEFAULT_BODY_LIMIT = 256 * 1024;

/** Mirrors src/app/core/services/yaml-parser.service.ts's ParseError shape (see design.md). */
interface ParseError {
  path: string[];
  message: string;
  code?: string;
}

const CONFIG_TOKEN_HEADER = 'x-config-token';

/** Builds the sidecar's Fastify instance: a single authenticated POST /api/config route. */
export function buildApp({
  configWriteToken,
  targetPath,
  bodyLimit = DEFAULT_BODY_LIMIT,
  statusPoller,
}: AppOptions): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit });

  // Normalizes Fastify's own body-parsing failures (oversized payload, malformed JSON) into the
  // same response shapes the route handler uses, instead of leaking Fastify's default error format.
  app.setErrorHandler((error: FastifyError, _request, reply) => {
    if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') {
      return reply.code(413).send({ status: 'error', message: error.message });
    }
    if (error.statusCode === 400) {
      return reply
        .code(400)
        .send({ status: 'invalid', errors: [{ path: [], message: error.message }] });
    }
    return reply.code(error.statusCode ?? 500).send({ status: 'error', message: error.message });
  });

  // Unauthenticated and read-only: exposes only { status, checkedAt } per app id — no URLs or
  // other config data, mirroring the already-public GET /config/dashboard.yaml.
  app.get('/api/status', async (_request, reply) => {
    return reply.code(200).send({
      intervalMs: statusPoller?.getIntervalMs() ?? DEFAULT_STATUS_CHECK_INTERVAL_MS,
      apps: statusPoller?.getStatuses() ?? {},
    });
  });

  // Route-level onRequest runs before Fastify parses the body, so an unauthorized request never
  // has its payload read, per the "before reading or validating its body" requirement. An unset
  // token can never match a provided header (and vice versa), so a token-less sidecar 401s every
  // write instead of becoming writable.
  app.post('/api/config', {
    onRequest: async (request, reply) => {
      const provided = request.headers[CONFIG_TOKEN_HEADER];
      if (!configWriteToken || provided !== configWriteToken) {
        await reply.code(401).send({ status: 'unauthorized' });
      }
    },
  }, async (request, reply) => {
    const result = DashboardConfigSchema.safeParse(request.body);
    if (!result.success) {
      const errors: ParseError[] = result.error.issues.map((issue) => ({
        path: issue.path.map(String),
        message: issue.message,
        code: issue.code,
      }));
      return reply.code(400).send({ status: 'invalid', errors });
    }

    const canonicalConfig = {
      ...result.data,
      settings: omitBlankBackgroundImages(result.data.settings),
    };
    const yamlContent = dump(canonicalConfig, { lineWidth: -1, noRefs: true, sortKeys: false });

    try {
      await writeConfigAtomically(targetPath, yamlContent);
    } catch (error) {
      return reply.code(500).send({
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    return reply.code(200).send({ status: 'saved' });
  });

  return app;
}
