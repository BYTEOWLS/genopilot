import {randomBytes} from 'node:crypto';
import {createServer, type ServerResponse} from 'node:http';
import {readFile} from 'node:fs/promises';
import type {BrowserState, DocumentView} from './contract.js';

const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";

export async function startBrowserServer({assets, onConnection = () => {}}: {
  assets: URL;
  onConnection?: (connected: boolean) => void;
}) {
  // Load the complete page before listening: a broken installation must fail in the CLI, not
  // leave an opened tab blank or mix assets from different builds.
  const pageAssets = new Map(await Promise.all(['index.html', 'page.js', 'page.css'].map(async name => {
    const url = new URL(name, assets);
    try {
      return [name, await readFile(url, 'utf8')] as const;
    } catch (error) {
      throw new Error(`Cannot read browser asset ${url.pathname}. Rebuild with pnpm build in a source checkout, or reinstall the package.`, {cause: error});
    }
  })));
  let state: BrowserState = {navigationAvailable: false};
  let select: ((id: string) => void) | undefined;
  const clients = new Set<ServerResponse>();
  const token = randomBytes(32).toString('hex');
  let origin = '';
  const broadcast = (): void => {
    for (const client of clients) {
      client.write(`data: ${JSON.stringify(state)}\n\n`);
    }
  };
  const server = createServer(async (request, response) => {
    response.setHeader('Content-Security-Policy', csp);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cache-Control', 'no-store');
    const send = (status: number, text: string, type = 'text/plain; charset=utf-8'): void => {
      response.writeHead(status, {'Content-Type': type});
      response.end(text);
    };
    try {
      if (request.headers.host !== new URL(origin).host ||
          (request.headers.origin !== undefined && request.headers.origin !== origin)) {
        send(403, 'Forbidden');
        return;
      }
      const url = new URL(request.url ?? '/', origin);
      const prefix = `/${token}/`;
      if (!url.pathname.startsWith(prefix)) {
        send(403, 'Forbidden');
        return;
      }
      const route = url.pathname.slice(prefix.length);
      if (request.method === 'POST' && route === 'select-item') {
        if (request.headers.origin !== origin || request.headers['content-type'] !== 'application/json') {
          send(403, 'Forbidden');
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of request) {
          size += chunk.length;
          if (size > 4096) {
            send(413, 'Request too large');
            return;
          }
          chunks.push(Buffer.from(chunk));
        }
        let body: unknown;
        try {
          body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          send(400, 'Invalid JSON');
          return;
        }
        if (!body || typeof body !== 'object' || !('viewId' in body) || !('itemId' in body) ||
            body.viewId !== state.view?.id || typeof body.itemId !== 'string' ||
            !state.view?.content.documents.some(document => document.id === body.itemId)) {
          send(400, 'Unknown view or item');
          return;
        }
        if (!select) {
          send(409, 'The CLI document page is not open');
          return;
        }
        select(body.itemId);
        send(202, 'Selection requested');
        return;
      }
      if (request.method !== 'GET') {
        send(405, 'Method not allowed');
        return;
      }
      if (route === 'events') {
        response.writeHead(200, {'Content-Type': 'text/event-stream', Connection: 'keep-alive'});
        clients.add(response);
        onConnection(true);
        response.write(`data: ${JSON.stringify(state)}\n\n`);
        request.on('close', () => {
          clients.delete(response);
          onConnection(clients.size > 0);
        });
      } else if (route === '') {
        send(200, pageAssets.get('index.html')!, 'text/html; charset=utf-8');
      } else if (route === 'page.js' || route === 'page.css') {
        send(200, pageAssets.get(route)!, route.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8');
      } else {
        send(404, 'Not found');
      }
    } catch {
      if (!response.headersSent) {
        send(500, 'Browser request failed');
      } else {
        response.end();
      }
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Browser server has no loopback port');
  }
  origin = `http://127.0.0.1:${address.port}`;
  const heartbeat = setInterval(() => {
    for (const client of clients) {
      client.write(': heartbeat\n\n');
    }
  }, 15000);
  heartbeat.unref();
  let closing: Promise<void> | undefined;
  return {
    url: `${origin}/${token}/`,
    get connected() { return clients.size > 0; },
    show(view: DocumentView, onSelect: (id: string) => void): void {
      state = {view, navigationAvailable: true};
      select = onSelect;
      broadcast();
    },
    detach(): void {
      select = undefined;
      state = {...state, navigationAvailable: false};
      broadcast();
    },
    close(): Promise<void> {
      if (closing) {
        return closing;
      }
      clearInterval(heartbeat);
      for (const client of clients) {
        client.end();
      }
      clients.clear();
      server.closeIdleConnections();
      closing = new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      server.closeAllConnections();
      return closing;
    },
  };
}

export type BrowserServer = Awaited<ReturnType<typeof startBrowserServer>>;
