import {randomBytes} from 'node:crypto';
import {createServer, type ServerResponse} from 'node:http';
import {open, readFile} from 'node:fs/promises';
import type {BrowserState, BrowserView} from './contract.js';
import {FastaIndexes, fileSnapshot, sameFile} from './fasta-index.js';
import {prepareGenome, type BrowserResource} from './genomes.js';

const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";

export function resolveGenomeModule(): URL | undefined {
  try {
    return new URL(import.meta.resolve('igv'));
  } catch {
    return undefined;
  }
}

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
  const indexes = new FastaIndexes();
  let resources = new Map<string, BrowserResource>();
  const fileResponses = new Set<ServerResponse>();
  let preparation: AbortController | undefined;
  let igvModule: Buffer | undefined;
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
    const send = (status: number, text: string | Buffer, type = 'text/plain; charset=utf-8'): void => {
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
            !(state.view?.content.kind === 'document' && state.view.content.documents.some(document => document.id === body.itemId))) {
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
      if ((request.method !== 'GET' && request.method !== 'HEAD') || (request.method === 'HEAD' && !route.startsWith('files/'))) {
        send(405, 'Method not allowed');
        return;
      }
      if (route.startsWith('files/')) {
        const resource = resources.get(route.slice(6));
        if (!resource) {
          send(404, 'Unknown or expired resource');
          return;
        }
        const handle = 'snapshot' in resource ? await open(resource.snapshot.path) : undefined;
        try {
          const details = await handle?.stat();
          if (response.destroyed) {
            return;
          }
          if (resources.get(route.slice(6)) !== resource) {
            send(404, 'Expired resource');
            return;
          }
          if (details && 'snapshot' in resource && (!details.isFile() || details.size !== resource.snapshot.size ||
              details.mtimeMs !== resource.snapshot.mtimeMs || details.ino !== resource.snapshot.ino || details.dev !== resource.snapshot.dev)) {
            send(409, 'The source changed. Reopen the view from the CLI.');
            return;
          }
          const size = 'snapshot' in resource ? resource.snapshot.size : resource.bytes.length;
          let start = 0;
          let end = size - 1;
          let status = 200;
          if (request.headers.range !== undefined) {
            const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
            if (match && (match[1] || match[2])) {
              if (!match[1]) {
                start = Math.max(0, size - Number(match[2]));
              } else {
                start = Number(match[1]);
                end = match[2] ? Math.min(end, Number(match[2])) : end;
              }
            }
            if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
                (match[2] && !Number.isSafeInteger(Number(match[2]))) || (!match[1] && Number(match[2]) === 0) || start > end) {
              response.setHeader('Content-Range', `bytes */${size}`);
              send(416, 'Unsatisfiable range');
              return;
            }
            status = 206;
            response.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
          }
          response.writeHead(status, {'Content-Type': 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Content-Length': Math.max(0, end - start + 1)});
          if (request.method === 'HEAD' || size === 0) {
            response.end();
          } else if ('bytes' in resource) {
            response.end(resource.bytes.subarray(start, end + 1));
          } else if (handle) {
            const stream = handle.createReadStream({start, end, autoClose: false});
            fileResponses.add(response);
            response.once('close', () => {
              fileResponses.delete(response);
              stream.destroy();
            });
            await new Promise<void>((resolve, reject) => {
              stream.once('error', reject);
              response.once('close', resolve);
              stream.pipe(response);
            });
          }
        } finally {
          await handle?.close();
        }
      } else if (route === 'igv.js' && state.view?.content.kind === 'genome' && igvModule) {
        send(200, igvModule, 'text/javascript; charset=utf-8');
      } else if (route === 'events') {
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
        response.destroy();
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
    async show(view: BrowserView, onSelect?: (id: string) => void): Promise<void> {
      if (closing) {
        throw new Error('The browser server is closed.');
      }
      preparation?.abort();
      const controller = new AbortController();
      preparation = controller;
      if (view.content.kind === 'genome' && state.view?.id === view.id && state.view.content.kind === 'genome') {
        const unchanged = await Promise.all([...resources.values()].map(async resource => {
          if ('bytes' in resource) {
            return true;
          }
          try {
            return sameFile(resource.snapshot, await fileSnapshot(resource.snapshot.path));
          } catch {
            return false;
          }
        }));
        controller.signal.throwIfAborted();
        if (unchanged.every(Boolean)) {
          state = {...state, view: {...state.view, title: view.title, provenance: view.provenance}};
          broadcast();
          return;
        }
      }
      let next = view;
      let nextResources = new Map<string, BrowserResource>();
      if (view.content.kind === 'genome') {
        if (!igvModule) {
          try {
            // Development uses the full installed package. Release bundling is a separate task;
            // do not extract or copy IGV's published minified distribution here.
            const module = resolveGenomeModule();
            if (!module) {
              throw new Error('IGV is not installed.');
            }
            igvModule = await readFile(module, {signal: controller.signal});
          } catch (error) {
            controller.signal.throwIfAborted();
            throw new Error('Genome views require the installed IGV development dependency until browser release bundling is implemented.', {cause: error});
          }
        }
        const prepared = await prepareGenome(view as import('./contract.js').GenomeView, indexes, controller.signal);
        next = prepared.view;
        nextResources = prepared.resources;
      }
      controller.signal.throwIfAborted();
      for (const response of fileResponses) {
        response.destroy();
      }
      resources = nextResources;
      state = {view: next, navigationAvailable: onSelect !== undefined};
      select = onSelect;
      broadcast();
    },
    detach(): void {
      preparation?.abort();
      select = undefined;
      state = {...state, navigationAvailable: false};
      broadcast();
    },
    close(): Promise<void> {
      if (closing) {
        return closing;
      }
      preparation?.abort();
      resources.clear();
      indexes.clear();
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
