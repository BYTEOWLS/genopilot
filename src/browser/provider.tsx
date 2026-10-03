import React, {createContext, useContext, useEffect, useRef, useState} from 'react';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import type {Document} from '../docs/documents.js';
import {documentView} from './documents.js';
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

const compiledAssets = new URL('./assets/', import.meta.url);
const defaultAssetsDirectory = existsSync(compiledAssets) ? compiledAssets : new URL('../../dist/browser/assets/', import.meta.url);

type Session = {owner: object; title: string; documents: Document[]; selectedId: string; select: (id: string) => void};
type BrowserContextValue = {
  status?: string;
  show: (session: Session) => void;
  update: (session: Session) => void;
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
  const server = useRef<Promise<BrowserServer> | undefined>(undefined);
  const opening = useRef<Promise<void> | undefined>(undefined);
  const current = useRef<Session | undefined>(undefined);
  const disposed = useRef(false);
  const publish = (service: BrowserServer, session: Session): void => {
    service.show(documentView(session.title, session.documents, session.selectedId, application),
      id => {
        if (current.current?.owner === session.owner) {
          current.current.select(id);
          setStatus(`Browser selected a document · ${service.url}`);
        }
      });
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
    setStatus('Browser starting…');
    server.current ??= startBrowserServer({assets: assetsDirectory, onConnection: connected => {
      if (!disposed.current) {
        void server.current?.then(service => {
          if (!disposed.current) {
            setStatus(`Browser ${connected ? 'open at' : 'waiting at'} ${service.url}`);
          }
        }).catch(() => {});
      }
    }});
    void server.current.then(async service => {
      if (disposed.current || current.current?.owner !== session.owner) {
        return;
      }
      publish(service, current.current);
      setStatus(`Browser ${service.connected ? 'open at' : 'waiting at'} ${service.url}`);
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
      server.current = undefined;
      if (!disposed.current) {
        setStatus(`Browser failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  };
  return <BrowserContext.Provider value={{status, show,
    update: session => {
      if (current.current?.owner === session.owner) {
        current.current = session;
        void server.current?.then(service => {
          if (!disposed.current && current.current?.owner === session.owner) {
            publish(service, current.current);
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
