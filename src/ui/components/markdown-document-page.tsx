import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {Alert} from '@inkjs/ui';
import {Box, measureElement, Text, useInput, useWindowSize, type DOMElement} from 'ink';
import type {Document, DocumentsLoader} from '../../docs/documents.js';
import {sanitizeTerminalText} from '../sanitize.js';
import {mutedColor} from '../theme.js';
import {Markdown} from './markdown.js';
import {Page} from './page.js';
import {TabBar} from './tabs.js';
import {useBrowserView} from '../../browser/provider.js';
import {browserViewShortcut} from '../../browser/contract.js';

type LoadState =
  | {state: 'loading'}
  | {state: 'failed'; message: string}
  | {state: 'ready'; documents: Document[]};

/**
 * A full-screen, scrollable page of one or more Markdown documents, shown as tabs named by their
 * titles. Each tab keeps its own scroll position. Esc or `?` closes it.
 */
export function MarkdownDocumentPage({
  title,
  detail,
  load,
  initialDocumentId,
  onClose,
  back = 'Close',
  inputActive,
}: {
  title: string;
  detail?: string;
  load: DocumentsLoader;
  /** The tab to open first; the first document otherwise. */
  initialDocumentId?: string;
  onClose: () => void;
  back?: string;
  inputActive: boolean;
}): React.JSX.Element {
  const {columns, rows} = useWindowSize();
  const browser = useBrowserView();
  const browserOwner = useRef({});
  const contentRef = useRef<DOMElement>(null);
  const [loaded, setLoaded] = useState<LoadState>({state: 'loading'});
  const [activeId, setActiveId] = useState(initialDocumentId);
  const [contentHeight, setContentHeight] = useState(0);
  const [scrollOffsets, setScrollOffsets] = useState<Record<string, number>>({});

  // Loaded once per page, so callers need not keep the loader stable.
  const loadRef = useRef(load);
  useEffect(() => {
    let active = true;
    loadRef.current().then(
      documents => {
        if (active) {
          setLoaded({state: 'ready', documents});
        }
      },
      (error: unknown) => {
        if (active) {
          setLoaded({state: 'failed', message: error instanceof Error ? error.message : String(error)});
        }
      },
    );
    return () => {
      active = false;
    };
  }, []);

  const documents = loaded.state === 'ready' ? loaded.documents : [];
  const document = documents.find(candidate => candidate.id === activeId) ?? documents[0];
  const documentId = document?.id ?? '';
  const tabbed = documents.length > 1;
  const browserRef = useRef(browser);
  browserRef.current = browser;
  useEffect(() => {
    browserRef.current?.update({owner: browserOwner.current, title, documents, selectedId: documentId, select: setActiveId});
  }, [title, loaded, documentId]);
  useEffect(() => {
    const owner = browserOwner.current;
    return () => browserRef.current?.detach(owner);
  }, []);
  // The page title, tab bar, and shortcut line take the remaining rows.
  const browserStatusRows = browser?.status ? Math.ceil(browser.status.length / Math.max(1, columns)) : 0;
  const visibleRows = Math.max(3, rows - (tabbed ? 8 : 6) - browserStatusRows);
  const maximumScrollOffset = Math.max(0, contentHeight - visibleRows);
  const scrollOffset = Math.min(scrollOffsets[documentId] ?? 0, maximumScrollOffset);

  useLayoutEffect(() => {
    if (contentRef.current) {
      setContentHeight(measureElement(contentRef.current).height);
    }
  }, [columns, rows, loaded, documentId]);

  const scrollBy = (delta: number): void => {
    setScrollOffsets(current => ({
      ...current,
      [documentId]: Math.max(0, Math.min(maximumScrollOffset, scrollOffset + delta)),
    }));
  };

  useInput(
    (input, key) => {
      if (input === 'v' && browser && documents.length > 0) {
        browser.show({owner: browserOwner.current, title, documents, selectedId: documentId, select: setActiveId});
      } else if (key.escape || input === '?') {
        onClose();
      } else if (key.upArrow) {
        scrollBy(-1);
      } else if (key.downArrow) {
        scrollBy(1);
      } else if (key.pageUp) {
        scrollBy(-visibleRows);
      } else if (key.pageDown) {
        scrollBy(visibleRows);
      }
    },
    {isActive: inputActive},
  );

  return (
    <Page
      title={title}
      {...(detail ? {detail} : {})}
      header={tabbed ? (
        <TabBar
          tabs={documents.map(candidate => ({id: candidate.id, label: sanitizeTerminalText(candidate.title)}))}
          activeId={documentId}
          onChange={setActiveId}
          inputActive={inputActive}
        />
      ) : undefined}
      shortcuts={[
        browser !== undefined && documents.length > 0 && browserViewShortcut,
        tabbed && 'Tab/←/→ — Switch document',
        maximumScrollOffset > 0 && '↑/↓ — Scroll · PageUp/PageDown (or fn + ↑/↓) — Page',
        `? — ${back}`,
      ]}
      back={back}
    >
      <Box
        height={contentHeight === 0 ? undefined : visibleRows}
        overflow={contentHeight === 0 ? 'visible' : 'hidden'}
        flexDirection="column"
      >
        <Box ref={contentRef} marginTop={-scrollOffset} flexDirection="column" flexShrink={0}>
          {loaded.state === 'loading' ? <Text color={mutedColor}>Loading documentation…</Text> : null}
          {loaded.state === 'failed' ? (
            <Alert variant="error" title="Documentation could not be read.">
              {sanitizeTerminalText(loaded.message)}
            </Alert>
          ) : null}
          {loaded.state === 'ready' && !document?.blocks ? (
            <Text color={mutedColor}>No documentation is available.</Text>
          ) : null}
          {document?.blocks ? <Markdown blocks={document.blocks} /> : null}
        </Box>
      </Box>
    </Page>
  );
}
