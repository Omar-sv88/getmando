import http from 'node:http';
import https from 'node:https';
import net, { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { checkAppStatus } from './status-checker';

/**
 * Self-signed certificate for CN=status-checker.spec.test — deliberately not trusted by any CA.
 * Verification for the status check is disabled per-request, so this must still report 'up'.
 */
const SELF_SIGNED_CERT = `-----BEGIN CERTIFICATE-----
MIIDJzCCAg+gAwIBAgIUGoVZIQmz1igWE7dqy6gOvdpCrr4wDQYJKoZIhvcNAQEL
BQAwIzEhMB8GA1UEAwwYc3RhdHVzLWNoZWNrZXIuc3BlYy50ZXN0MB4XDTI2MDkw
NTE3NDQxM1oXDTM2MDkwMjE3NDQxM1owIzEhMB8GA1UEAwwYc3RhdHVzLWNoZWNr
ZXIuc3BlYy50ZXN0MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAwQiQ
M+qhAdymjjculInWW9uFZU927HA6ivnfctv2n8lqteKScPNGEaJP/6IhVB62szYD
kHgR2aLgKJg5tGevCxRbygbNWF6mpepoNMZoRcZgAk3cTAN4MW+BQJgcOai2FVL/
60jcRq71s2a0kQ6qxbY+d657kRuKe1UMk6djSNTwE89JQTowLKX40lpO4XTYNz/6
BDdV0K7xl6n7C6JMNCXetiDlhenwxyXF8OWgY1y5Daf0Ordjmt+/77rgK46pL4nP
uR2juQ22TBVABx6n7Mg/axtiO7ScTecM9tJvST/uNrtL/h4AwEPmYMJI/W7qKUC/
ZglyAIVj/6nLmWWrBQIDAQABo1MwUTAdBgNVHQ4EFgQU8n+0Pb1JGF3qczpZygVQ
0AWJ/VcwHwYDVR0jBBgwFoAU8n+0Pb1JGF3qczpZygVQ0AWJ/VcwDwYDVR0TAQH/
BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEAHtnDmKH4q+FjJKiTBS7yJ8nGrXHT
+b/vhtrCkTeF6pz1uPnD0gv2+khxleXBBlcLDy8HphE4KsMy4ojwRYFVJixwxsmF
YN/voSof3uSOmG/m/xubf6Nujn3loNI8Ca0/9N9BAx3FTbh60bOcFQDQbrzHZc1o
sPhSoulhyJvKa9GJ2MqjPWq7x04/TvfbXbdEbz5osc8a0QBfC3OQZdrcfDSGY7B1
d2Cxcr8dMOtJt3wW5XZ57Oozj8h6Es7G12prgB3rp2dcEH5n9sRYJJyQvhi6dIB7
HyFcsyL6x78hWzDWSF4ohDE/ykmfYBlQUoNYOe7BuYodx6gDjAV0J5CbmQ==
-----END CERTIFICATE-----`;

const SELF_SIGNED_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDBCJAz6qEB3KaO
Ny6UidZb24VlT3bscDqK+d9y2/afyWq14pJw80YRok//oiFUHrazNgOQeBHZouAo
mDm0Z68LFFvKBs1YXqal6mg0xmhFxmACTdxMA3gxb4FAmBw5qLYVUv/rSNxGrvWz
ZrSRDqrFtj53rnuRG4p7VQyTp2NI1PATz0lBOjAspfjSWk7hdNg3P/oEN1XQrvGX
qfsLokw0Jd62IOWF6fDHJcXw5aBjXLkNp/Q6t2Oa37/vuuArjqkvic+5HaO5DbZM
FUAHHqfsyD9rG2I7tJxN5wz20m9JP+42u0v+HgDAQ+Zgwkj9buopQL9mCXIAhWP/
qcuZZasFAgMBAAECggEAEy11niLOUjAIwBJNZ2Z2THP3wcPuTbksp8gBYhjmXKOX
HXDgGaahrHjSt9P0ubW/cviHzB+RrmyXFpFhEkJGyrQAFocseX4V0mACcFPR4jS+
LxxrKYYit86bKb6y9yuCw4WWdVqsv7z8HhGzGMI7Rx8+/4bvMdBppq0hbb3wiDir
YWj1X1Cp3fOjpgt9fyS8bRrMFFWhxCmo07rZy6o4AISs0bFhAVsiJdRdf/+1SCX1
lO/8ktec6p5wqjcQ/qmzoS4GKWJRCHRN9nYKCjXF3rQe2w1LpjQckyPDy/tV0/Rc
j9QLA5GLqO3J5tpvCPJ+Ruu7BEQoOTyuxGCZ57p01QKBgQDfzn1vX5t5aavWW+93
m+mEdba+NfzXy8+0qFoJCMv/3OVmb9E28/ZG51EfMWIxCTxzrod0ftkY3EincibI
flI+tDuJXiH/2MugtYlo+4h/bPnalmrrKVE002W9GJ/Ez5n9DAzb7tZ+mzaR/4SB
B7wkahYXleeyQ4gYR4SzKJbaRwKBgQDczOAIqLmtz+6hUKqiApOPwvtn9GDc3MA3
aju3F6LD6t1V7305X5R0ZzjSJBS0SEQjwjm4mDMSPDydFavfJeA0HAMp86LiAfDC
Fe/OYq72+qLi1qY3AMh/7KvlXYExDLC79j8ia/gnz/1LY9zJrL4WVSAe6FhNnyaU
YHN8D0jqUwKBgBIKkDwBJgRUi2CdSqGGtP1Ti+arbXVr3ZN/mrptthwrD2cBjojy
g6DVlsl/7p1rVC8zG4I9k3yYjVbKMewpmrGpT79UEkOQk2GiILCQzkEPZNjFFVtd
mkk63VGwAXkZDx3B8etsxmewVWbRhTntiLIaxyshj2rkXL0wTrcuh3KTAoGBALiE
vfR+jC0kx1coAnDBlm9dkpudLhVkpX2p2Z14sxzm+XEHYq6/oWBloqZ6YJMIkWkQ
twv8pTFoBX+AzND+5g6mGj7EzCnzVS/dBTqEXZMogVbv6pesn+HH9x8GtSA4armp
X7l0YT1kI1kNa0VehrxDB0TNBn5XsfXtZJUYcObhAoGBAIP5eV2rvZy8tIk6qiXq
Tl4xJuyCX/gdGmX/PFxibTV1NQWZZpoLpwjAmOzMXg/wjydOHU8ElO3bm199E43p
ZI/oBTE4g+/tx520wuL+X6Jk0wbLdughgdJOoOSV+KqlgMrmACWTMKsd6R2pZ7qZ
9tCeYFJgpJgdCtTLX1b+JV5M
-----END PRIVATE KEY-----`;

/** Starts a server on an ephemeral port and returns its base URL. */
async function listen(server: http.Server | https.Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { address, port } = server.address() as AddressInfo;
  return `http://${address}:${port}`;
}

describe('checkAppStatus', () => {
  const servers: (http.Server | https.Server)[] = [];

  afterAll(async () => {
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve) => {
            server.closeAllConnections?.();
            server.close(() => resolve());
          }),
      ),
    );
  });

  it.each([200, 404, 500])('resolves up for an HTTP %s response', async (statusCode) => {
    const server = http.createServer((_request, response) => {
      response.statusCode = statusCode;
      response.end('ignored body');
    });
    servers.push(server);
    const baseUrl = await listen(server);

    await expect(checkAppStatus(`${baseUrl}/`, 2_000)).resolves.toEqual({ status: 'up' });
  });

  it('resolves down for a connection refused error', async () => {
    // Grab an ephemeral port, then close its listener so connections are refused.
    const throwaway = http.createServer();
    const baseUrl = await listen(throwaway);
    await new Promise<void>((resolve) => throwaway.close(() => resolve()));

    await expect(checkAppStatus(`${baseUrl}/`, 2_000)).resolves.toEqual({ status: 'down' });
  });

  it('resolves down for a DNS failure', async () => {
    await expect(
      checkAppStatus('http://status-checker-does-not-exist.invalid/', 2_000),
    ).resolves.toEqual({ status: 'down' });
  });

  it('resolves down instead of rejecting for a malformed URL', async () => {
    await expect(checkAppStatus('not-a-url', 2_000)).resolves.toEqual({ status: 'down' });
  });

  it('resolves down after the timeout when the server never responds', async () => {
    const server = http.createServer(() => {
      // Accept the connection but never respond.
    });
    servers.push(server);
    const baseUrl = await listen(server);

    const startedAt = Date.now();
    await expect(checkAppStatus(`${baseUrl}/`, 250)).resolves.toEqual({ status: 'down' });
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(250);
  });

  it('resolves up without crashing when the socket drops right after the headers arrive', async () => {
    const server = http.createServer((_request, response) => {
      response.writeHead(200);
      response.flushHeaders();
      // Kill the connection mid-response: the client sees headers, then a socket error it must
      // swallow rather than let escape as an unhandled 'error' event.
      response.socket?.destroy();
    });
    servers.push(server);
    const baseUrl = await listen(server);

    await expect(checkAppStatus(`${baseUrl}/`, 2_000)).resolves.toEqual({ status: 'up' });
  });

  it('resolves down at the deadline when the server keeps the socket active but never finishes headers', async () => {
    const server = net.createServer((socket) => {
      socket.write('HTTP/1.1 200 OK\r\n');
      // Drip valid-looking header lines forever: the socket stays "active" so the idle timeout
      // never fires, but the response headers never complete (no final CRLF-CRLF).
      const drip = setInterval(() => socket.write('X-Keep-Alive: 1\r\n'), 40);
      const stop = (): void => clearInterval(drip);
      socket.on('close', stop);
      socket.on('error', stop);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;

    try {
      const startedAt = Date.now();
      await expect(checkAppStatus(`http://127.0.0.1:${port}/`, 250)).resolves.toEqual({
        status: 'down',
      });
      // Well past an instant error-path resolve (~single-digit ms), and bounded — it waited for
      // the deadline rather than hanging on the never-ending header stream.
      const elapsed = Date.now() - startedAt;
      expect(elapsed).toBeGreaterThanOrEqual(200);
      expect(elapsed).toBeLessThan(2_000);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('resolves up for an HTTPS server with a self-signed certificate', async () => {
    const server = https.createServer(
      { key: SELF_SIGNED_KEY, cert: SELF_SIGNED_CERT },
      (_request, response) => {
        response.end('ignored body');
      },
    );
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { address, port } = server.address() as AddressInfo;

    await expect(checkAppStatus(`https://${address}:${port}/`, 2_000)).resolves.toEqual({
      status: 'up',
    });
  });
});
