import React, {createContext, useContext, useEffect, useRef, useState} from 'react';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import type {Document} from '../docs/documents.js';
import {documentView} from './documents.js';
import type {GenomeView} from './contract.js';
import {packagedUrl} from '../package-root.js';
import {startBrowserServer, type BrowserServer} from './server.js';

export function openBrowser(url: string): Promise<void> {
  const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
  return new Promise((resolve, reject) => {
    const child = spawn(command, [url], {stdio: 'ignore'});
    child.once('error', reject);
    child.once('exit', code => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Browser opener exited with code ${String(code)}; open the URL manually`));
      }
    });
  });
}

// The built page and IGV; a source checkout serves them after `pnpm build`.
const defaultAssetsDirectory = packagedUrl('dist/browser/assets/');

type DocumentSession = {owner: object; title: string; documents: Document[]; selectedId: string; select: (id: string) => void};
type Session = DocumentSession | {owner: object; view: GenomeView; select?: (id: string) => void};
type BrowserContextValue = {
  application: {name: string; version: string};
  genomeAvailable: boolean;
  /** Browser errors only; successful operations stay silent. */
  status?: string;
  show: (session: Session) => void;
  update: (session: DocumentSession) => void;
  updateGenomeSelection: (owner: object, itemId: string, select: (id: string) => void) => void;
  detach: (owner: object) => void;
};
const BrowserContext = createContext<BrowserContextValue | undefined>(undefined);
export const useBrowserView = () => useContext(BrowserContext);

export function BrowserViewProvider({application, children, open = openBrowser, assetsDirectory = defaultAssetsDirectory}: {
  application: {name: string; version: string};
  children: React.ReactNode;
  open?: (url: string) => Promise<void>;
  assetsDirectory?: URL;
}): React.JSX.Element {
  const [status, setStatus] = useState<string>();
  const genomeAvailable = existsSync(new URL('igv.js', assetsDirectory));
  const server = useRef<Promise<BrowserServer> | undefined>(undefined);
  const opening = useRef<Promise<void> | undefined>(undefined);
  const current = useRef<Session | undefined>(undefined);
  const disposed = useRef(false);
  const selectionCallback = (session: Session): ((id: string) => void) | undefined => session.select ? id => {
    const active = current.current;
    if (active?.owner === session.owner) {
      active.select?.(id);
      setStatus(undefined);
    }
  } : undefined;
  const updateSelection = (service: BrowserServer, session: Session): void => {
    if ('view' in session && session.view.selectedItemId) {
      service.updateGenomeSelection(session.view.id, session.view.selectedItemId, selectionCallback(session));
    }
  };
  const publish = async (service: BrowserServer, session: Session): Promise<void> => {
    const view = 'view' in session ? session.view : documentView(session.title, session.documents, session.selectedId, application);
    await service.show(view, selectionCallback(session));
  };
  useEffect(() => {
    disposed.current = false;
    return () => {
      disposed.current = true;
      current.current = undefined;
      void server.current?.then(service => service.close()).catch(() => {});
    };
  }, []);
  const show = (session: Session): void => {
    current.current = session;
    setStatus(undefined);
    server.current ??= startBrowserServer({assets: assetsDirectory, onConnection: connected => {
      if (connected && !disposed.current) {
        setStatus(undefined);
      }
    }}).catch(error => {
      server.current = undefined;
      throw error;
    });
    void server.current.then(async service => {
      if (disposed.current || current.current?.owner !== session.owner) {
        return;
      }
      await publish(service, current.current);
      if (disposed.current || current.current?.owner !== session.owner) {
        return;
      }
      // Selection may have changed while preparing the reference and evidence.
      updateSelection(service, current.current);
      if (!service.connected && !opening.current) {
        // Keep one launch pending even when v is pressed again before the tab connects.
        const pending = Promise.resolve().then(() => open(service.url));
        opening.current = pending;
        try {
          await pending;
        } catch (error) {
          if (!disposed.current) {
            setStatus(`Browser could not open: ${error instanceof Error ? error.message : String(error)} · ${service.url}`);
          }
        } finally {
          if (opening.current === pending) {
            opening.current = undefined;
          }
        }
      }
    }).catch(error => {
      if (!disposed.current && current.current === session && !(error instanceof Error && error.name === 'AbortError')) {
        setStatus(`Browser failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  };
  return <BrowserContext.Provider value={{application, genomeAvailable, status, show,
    update: session => {
      if (current.current?.owner === session.owner) {
        current.current = session;
        void server.current?.then(async service => {
          if (!disposed.current && current.current?.owner === session.owner) {
            await publish(service, current.current);
          }
        }).catch(() => {});
      }
    },
    updateGenomeSelection: (owner, itemId, select) => {
      const session = current.current;
      if (session?.owner === owner && 'view' in session) {
        current.current = {...session, view: {...session.view, selectedItemId: itemId}, select};
        void server.current?.then(service => {
          if (!disposed.current && current.current?.owner === owner) {
            updateSelection(service, current.current);
          }
        }).catch(() => {});
      }
    },
    detach: owner => {
      if (current.current?.owner === owner) {
        current.current = undefined;
        void server.current?.then(service => service.detach()).catch(() => {});
      }
    },
  }}>{children}</BrowserContext.Provider>;
}
