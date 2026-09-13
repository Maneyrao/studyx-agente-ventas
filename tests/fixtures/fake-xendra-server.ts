import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface FakeXendraRequest {
  readonly headers: IncomingHttpHeaders;
  readonly body: unknown;
}

export interface FakeXendraServer {
  readonly callUrl: string;
  readonly requests: FakeXendraRequest[];
  close(): Promise<void>;
}

export async function startFakeXendraServer(options: {
  readonly status?: number;
  readonly callId?: string;
  readonly responseDelayMs?: number;
} = {}): Promise<FakeXendraServer> {
  const requests: FakeXendraRequest[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      let body: unknown = null;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
      } catch {
        body = null;
      }
      requests.push({ headers: request.headers, body });
      const finish = () => {
        response.statusCode = options.status ?? 200;
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({
          ok: (options.status ?? 200) === 200,
          call_id: options.callId ?? 'call_fake_xendra',
        }));
      };
      if ((options.responseDelayMs ?? 0) > 0) {
        setTimeout(finish, options.responseDelayMs);
      } else {
        finish();
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  return {
    callUrl: `http://127.0.0.1:${address.port}/api/studyx/llamar`,
    requests,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}
