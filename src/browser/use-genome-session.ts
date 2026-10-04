import {useEffect, useRef, useState} from 'react';
import type {GenomeView} from './contract.js';
import {useBrowserView} from './provider.js';

/** Own checksum preparation and a browser view for the lifetime of its opening CLI context. */
export function useGenomeSession(scope: string) {
  const browser = useBrowserView();
  const browserRef = useRef(browser);
  browserRef.current = browser;
  const owner = useRef({});
  const request = useRef<AbortController | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const currentOwner = owner.current;
    setBusy(false);
    setError(undefined);
    return () => {
      request.current?.abort();
      request.current = undefined;
      browserRef.current?.detach(currentOwner);
    };
  }, [scope]);

  const open = (build: (signal: AbortSignal) => Promise<GenomeView>, select?: (id: string) => void): void => {
    if (!browserRef.current) {
      return;
    }
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError(undefined);
    void Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return build(controller.signal);
    }).then(genome => {
      if (request.current === controller && !controller.signal.aborted) {
        browserRef.current?.show({owner: owner.current, view: genome, select});
      }
    }).catch(cause => {
      if (request.current === controller && !controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    }).finally(() => {
      if (request.current === controller) {
        request.current = undefined;
        setBusy(false);
      }
    });
  };

  const updateSelection = (itemId: string, select: (id: string) => void): void => {
    browserRef.current?.updateGenomeSelection(owner.current, itemId, select);
  };

  return {browser, busy, error, open, updateSelection, clearError: () => setError(undefined)};
}
