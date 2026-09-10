import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

export interface StatusCheckResult {
  status: 'up' | 'down';
}

/**
 * Checks whether anything at `url` answers with an HTTP response. Any status code (2xx–5xx)
 * counts as up — many self-hosted apps redirect to a login or return 401/500 while healthy;
 * only a network-level failure (refused/reset/DNS) or a timeout counts as down.
 *
 * `timeoutMs` is enforced two ways: the socket's own inactivity timeout, and an overall deadline —
 * a server that drips bytes without ever completing its response headers keeps the socket "active",
 * so only the deadline bounds that case.
 *
 * TLS verification is disabled for this one request only: a status dot answers "is something
 * listening", not "does this app have a browser-trusted certificate".
 *
 * This promise never rejects — a background poller must never crash on one bad app — so any
 * synchronous failure (e.g. constructing the request from a malformed URL) resolves 'down' too,
 * the same as a network-level failure.
 */
export function checkAppStatus(url: string, timeoutMs: number): Promise<StatusCheckResult> {
  return new Promise((resolve) => {
    let settled = false;
    let deadline: NodeJS.Timeout | undefined;
    const finish = (result: StatusCheckResult): void => {
      if (settled) return;
      settled = true;
      if (deadline !== undefined) clearTimeout(deadline);
      resolve(result);
    };

    try {
      const transport = new URL(url).protocol === 'https:' ? httpsRequest : httpRequest;

      const request = transport(
        url,
        { timeout: timeoutMs, rejectUnauthorized: false },
        (response) => {
          // Headers arrived — the app is up. The body is never read; destroy the socket at once.
          // A socket error raised while tearing the response down would otherwise be an unhandled
          // 'error' event (no listener) and crash the process — swallow it, the app already answered.
          response.on('error', () => {});
          response.destroy();
          finish({ status: 'up' });
        },
      );

      deadline = setTimeout(() => {
        request.destroy();
        finish({ status: 'down' });
      }, timeoutMs);

      request.on('timeout', () => {
        request.destroy();
        finish({ status: 'down' });
      });

      request.on('error', () => {
        finish({ status: 'down' });
      });

      request.end();
    } catch {
      finish({ status: 'down' });
    }
  });
}
