import {useEffect, useRef, useState} from 'react';
import type {Document} from '../docs/documents.js';
import type {GenomeView} from './contract.js';
import {useBrowserView} from './provider.js';

/** A run view with the run's citation, which the browser opens from the view's header. */
export function withRunCitation(view: GenomeView, citation: Document | undefined): GenomeView {
  if (!citation || !view.provenance.run) {
    return view;
  }
  return {...view, provenance: {...view.provenance, run: {...view.provenance.run,
    citation: {id: citation.id, title: citation.title, blocks: citation.blocks, links: {}, copyable: true}}}};
}

/**
 * Own checksum preparation and a browser view for the lifetime of its opening CLI context. Views
 * opened from a run carry `citation`, the run's citation, once the run wrote it.
 */
export function useGenomeSession(scope: string, citation?: Document) {
  const browser = useBrowserView();
  const browserRef = useRef(browser);
  browserRef.current = browser;
  const owner = useRef({});
  const citationRef = useRef(citation);
  citationRef.current = citation;
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
        browserRef.current?.show({owner: owner.current, view: withRunCitation(genome, citationRef.current), select});
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
