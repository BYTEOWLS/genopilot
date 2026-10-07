import React, {useEffect, useState} from 'react';
import {Alert, Badge, Button, Group, Modal, NavLink, Stack, Text, Title} from '@mantine/core';
import {inlineText} from '../../docs/markdown.js';
import type {BrowserState, GenomeView} from '../contract.js';
import {GenomePanel, type GenomeLibraryLoader} from './genome.js';
import {DocumentBody, headingAnchors} from './document.js';
import {ThemeControl} from './theme-control.js';
import {Provenance} from './provenance.js';

export function BrowserApp({loadGenomeLibrary}: {loadGenomeLibrary?: GenomeLibraryLoader} = {}): React.JSX.Element {
  const [state, setState] = useState<BrowserState>();
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string>();
  const [sidebar, setSidebar] = useState(true);
  const [citationOpen, setCitationOpen] = useState(false);
  const [localId, setLocalId] = useState<string>();
  const [anchor, setAnchor] = useState<{viewId?: string; documentId: string; id: string}>();
  useEffect(() => {
    const events = new EventSource('events');
    events.onmessage = event => {
      try {
        setState(JSON.parse(event.data) as BrowserState);
        setLocalId(undefined);
        setConnected(true);
        setError(undefined);
      } catch {
        setError('The CLI sent an unreadable view.');
      }
    };
    events.onerror = () => setConnected(false);
    return () => events.close();
  }, []);
  const view = state?.view;
  const content = view?.content;
  const citation = view?.provenance.run?.citation;
  const documents = content?.kind === 'document' ? content.documents : [];
  const openId = localId ?? (content?.kind === 'document' ? content.openId : undefined);
  const openDocument = documents.find(candidate => candidate.id === openId) ?? documents[0];
  const genome = content?.kind === 'genome' ? view as GenomeView : undefined;
  const entries = genome?.items?.entries ?? documents;
  const selectedId = genome?.selectedItemId ?? openDocument?.id;
  const selectedIndex = entries.findIndex(candidate => candidate.id === selectedId);
  useEffect(() => {
    if (view) {
      document.title = `${view.provenance.application.name} · ${openDocument?.title ?? view.title}`;
    }
  }, [view?.provenance.application.name, view?.title, openDocument?.title]);
  const select = (id: string, heading?: string): void => {
    // Each click is a new scroll request, even when its target is unchanged.
    setAnchor(heading ? {viewId: view?.id, documentId: id, id: heading} : undefined);
    if (!connected || !state?.navigationAvailable) {
      if (genome) {
        return;
      }
      setLocalId(id);
      return;
    }
    void fetch('select-item', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({viewId: view?.id, itemId: id})})
      .then(async response => {
        if (!response.ok) {
          throw new Error(await response.text());
        }
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)));
  };
  const move = (offset: number): void => {
    const next = entries[selectedIndex + offset];
    if (next) {
      select(next.id);
    }
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      // Portalled menus/dialogs still reach this window listener. Never let their
      // keystrokes change the CLI's selected item underneath an overlay.
      if (event.defaultPrevented || document.querySelector('[role="dialog"], [role="menu"]')) {
        return;
      }
      if (event.target instanceof HTMLElement && (event.target.closest('input, textarea, select, [contenteditable="true"]') || event.ctrlKey || event.metaKey || event.altKey)) {
        return;
      }
      if (event.key === 'n' || event.key === 'p') {
        event.preventDefault();
        move(event.key === 'n' ? 1 : -1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  useEffect(() => {
    if (!anchor) {
      return;
    }
    if (anchor.viewId !== view?.id) {
      setAnchor(undefined);
    } else if (anchor.documentId === openDocument?.id) {
      document.getElementById(anchor.id)?.scrollIntoView();
      setAnchor(undefined);
    }
  }, [anchor, openDocument, view?.id]);
  const anchors = headingAnchors(openDocument?.blocks ?? []);
  return <div className="browser-frame">
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="frame-header">
      <div className="view-title"><Text size="xs" c="dimmed">{view?.provenance.application.name ?? 'Documentation'}</Text><Title order={1} size="h3">{view?.title ?? 'Browser view'}</Title></div>
      <Group gap="sm" wrap="wrap">
        <Badge variant="light" color={connected ? 'teal' : 'gray'} role="status">{connected ? 'Connected' : state ? 'CLI disconnected' : 'Waiting for CLI'}</Badge>
        {content?.kind === 'document' ? <Button variant="default" onClick={() => setSidebar(current => !current)} aria-expanded={sidebar} aria-controls="contents">Contents</Button> : null}
        {citation ? <Button variant="default" onClick={() => setCitationOpen(true)} aria-haspopup="dialog">Cite this run</Button> : null}
        <ThemeControl />
      </Group>
    </header>
    {/* A run view's citation, with copy buttons for the whole citation and each of its parts. */}
    <Modal opened={citationOpen && citation !== undefined} onClose={() => setCitationOpen(false)} title={citation?.title} size="xl">
      {citation ? <DocumentBody document={citation} select={() => {}} /> : null}
    </Modal>
    {error ? <Alert color="red" role="alert" className="notice">{error}</Alert> : null}
    {state && content?.kind === 'document' && !state.navigationAvailable ? <Alert color="gray" className="notice">The CLI document page is not open. Navigation here no longer changes the CLI.</Alert> : null}
    <div className={content?.kind === 'genome' ? 'workspace genome-workspace' : sidebar && content?.kind === 'document' ? 'workspace with-sidebar' : 'workspace'}>
      {sidebar && content?.kind === 'document' ? <nav id="contents" aria-label="Contents" className="contents">
        <Text size="xs" fw={600} c="dimmed" tt="uppercase" mb="sm">Documents</Text>
        <Stack gap={4}>{documents.map(candidate => <NavLink key={candidate.id} active={candidate.id === openDocument?.id} label={candidate.title} aria-current={candidate.id === openDocument?.id ? 'page' : undefined} onClick={() => select(candidate.id)} />)}</Stack>
        <Text size="xs" fw={600} c="dimmed" tt="uppercase" mt="xl" mb="sm">On this page</Text>
        {(openDocument?.blocks ?? []).map((block, index) => block.kind === 'heading' && block.level > 1 ? <a className="outline-link" key={index} href={`#${anchors.get(index)}`}>{inlineText(block.content)}</a> : null)}
      </nav> : null}
      <main id="main" className={content?.kind === 'genome' ? 'genome-main' : 'document-area'} tabIndex={-1}>
        {documents.length > 1 ? <Group gap="sm" className="document-navigation" mb="xl"><Button variant="default" disabled={selectedIndex <= 0} onClick={() => move(-1)}>Previous</Button><Text size="sm" c="dimmed">{selectedIndex + 1} of {documents.length}</Text><Button variant="default" disabled={selectedIndex >= documents.length - 1} onClick={() => move(1)}>Next</Button><Text size="xs" c="dimmed">p / n</Text></Group> : null}
        {genome ? <>
          {genome.items ? <Group gap="sm" className="genome-item-navigation">
            <Button variant="default" disabled={!connected || !state?.navigationAvailable || selectedIndex <= 0} onClick={() => move(-1)}>Previous</Button>
            <label htmlFor="genome-item">{genome.items.name}</label>
            <select id="genome-item" value={selectedId ?? ''} disabled={!connected || !state?.navigationAvailable} onChange={event => select(event.currentTarget.value)}>
              {genome.items.entries.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
            <Text size="sm">{selectedIndex + 1} of {entries.length}</Text>
            <Button variant="default" disabled={!connected || !state?.navigationAvailable || selectedIndex >= entries.length - 1} onClick={() => move(1)}>Next</Button>
            <Text size="xs" c="dimmed">p / n</Text>
            {!state?.navigationAvailable ? <Text size="sm">The CLI review is no longer open. Locus navigation is disabled.</Text> : null}
          </Group> : null}
          <GenomePanel key={genome.id} view={genome} load={loadGenomeLibrary} select={connected && state?.navigationAvailable ? select : undefined} />
        </> : openDocument ? <DocumentBody document={openDocument} select={select} /> : <Text role="status">{state ? 'No view is open. Press v on a CLI page that offers a browser view.' : 'Connecting to the CLI…'}</Text>}
        {view && content?.kind !== 'genome' ? <Provenance view={view} title={openDocument?.title ?? view.title} /> : null}
      </main>
    </div>
  </div>;
}
