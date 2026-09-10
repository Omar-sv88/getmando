import { buildApp } from './app';
import { createStatusPoller, resolveStatusCheckIntervalMs } from './status-poller';

// Empty when unset: buildApp's auth hook then 401s every write request (a token-less sidecar is
// read-only), while status checks and GET /api/status keep working without it.
const configWriteToken = process.env['CONFIG_WRITE_TOKEN'] ?? '';

const targetPath = process.env['CONFIG_PATH'] ?? '/app/config/dashboard.yaml';
const port = Number(process.env['PORT'] ?? 3000);
const host = process.env['HOST'] ?? '0.0.0.0';
const statusCheckIntervalMs = resolveStatusCheckIntervalMs(process.env['STATUS_CHECK_INTERVAL_MS']);

const statusPoller = createStatusPoller({ configPath: targetPath });
statusPoller.start(statusCheckIntervalMs);

const app = buildApp({ configWriteToken, targetPath, statusPoller });

app
  .listen({ port, host })
  .then(() => {
    console.log(
      `config-write-api listening on http://${host}:${port}, writing to ${targetPath}, ` +
        `checking statuses every ${statusCheckIntervalMs}ms`,
    );
  })
  .catch((error: unknown) => {
    console.error('Failed to start config-write-api:', error);
    process.exit(1);
  });
