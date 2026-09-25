import {isAbsolute, resolve} from 'node:path';
import React, {useEffect, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import type {CacheScan} from '../../accessions/cache-discovery.js';
import type {LoadedAccessionCatalog} from '../../accessions/store.js';
import {PathBrowser, type DirectoryReader} from '../components/path-browser.js';
import {TextField} from '../components/text-field.js';
import {useHomeSuspension} from '../home-navigation.js';
import {expandHomeDirectory} from '../components/path-field.js';
import {sanitizeTerminalText} from '../sanitize.js';
import {mutedColor} from '../theme.js';
import type {AccessionCatalogUpdater} from '../../accessions/registration.js';
import {EditPage, Page} from '../components/page.js';
import type {AccessionsPageFrame} from './screen.js';

type View =
  | {kind: 'list'}
  | {kind: 'browse'}
  | {kind: 'type'; draft: string; buttonSelected: boolean; problems: string[]};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The output roots discovery scans. `<cwd>/runs` is always scanned and not stored; the others are
 * added here or by a successful run. Forgetting a root never deletes anything.
 */
export function RootsTab({
  page,
  notice,
  loaded,
  scan,
  defaultRoot,
  currentDirectory,
  inputActive,
  updateCatalog,
  readDirectory,
  onCatalogChange,
  onLockChange,
  verifying = false,
}: {
  page: AccessionsPageFrame;
  /** While caches are verified, root changes wait; each one starts a new scan. */
  verifying?: boolean;
  notice?: React.ReactNode;
  loaded: LoadedAccessionCatalog;
  scan: CacheScan;
  defaultRoot: string;
  currentDirectory: string;
  inputActive: boolean;
  updateCatalog: AccessionCatalogUpdater;
  readDirectory?: DirectoryReader;
  /** Called with the saved catalog; the caller rescans so copies follow the changed roots. */
  onCatalogChange: (loaded: LoadedAccessionCatalog) => void;
  onLockChange: (locked: boolean) => void;
}): React.JSX.Element {
  const storedRoots = loaded.catalog.output_roots;
  const rows = [defaultRoot, ...storedRoots.filter(root => resolve(root) !== defaultRoot)];
  const [view, setView] = useState<View>({kind: 'list'});
  const [selected, setSelected] = useState(defaultRoot);
  const [message, setMessage] = useState<{text: string; error: boolean}>();
  const [busy, setBusy] = useState(false);
  const locked = view.kind !== 'list' || busy;
  useEffect(() => onLockChange(locked), [locked, onLockChange]);
  useHomeSuspension(busy ? 'busy' : view.kind === 'type' && !view.buttonSelected ? 'typing' : undefined);

  const save = (describe: string, mutate: (roots: string[]) => string[]): void => {
    setBusy(true);
    updateCatalog(loaded.revision, latest => ({...latest, output_roots: mutate(latest.output_roots)}))
      .then(next => {
        onCatalogChange(next);
        setMessage({text: describe, error: false});
      })
      .catch(error => setMessage({text: errorMessage(error), error: true}))
      .finally(() => {
        setBusy(false);
        setView({kind: 'list'});
      });
  };

  const addRoot = (path: string): void => {
    const expanded = expandHomeDirectory(path.trim());
    const root = resolve(expanded);
    const problem = !isAbsolute(expanded)
      ? 'Output root: must be an absolute path'
      : rows.some(existing => resolve(existing) === root)
        ? `Output root: ${root} is already scanned`
        : undefined;
    if (problem) {
      // A typed path stays in its form to be corrected; a browsed one returns to the list.
      if (view.kind === 'type') {
        setView({...view, problems: [problem]});
      } else {
        setMessage({text: problem, error: true});
        setView({kind: 'list'});
      }
      return;
    }
    setSelected(root);
    save(`Added ${root}.`, roots => [...roots, root]);
  };

  useInput(
    (input, key) => {
      if (busy) {
        return;
      }
      if (view.kind === 'type') {
        if (key.escape) {
          setView({kind: 'list'});
        } else if (key.tab || key.upArrow || key.downArrow) {
          setView({...view, buttonSelected: !view.buttonSelected});
        } else if (key.return && view.buttonSelected) {
          // Enter acts only on the button; Tab and the arrows move between field and button.
          addRoot(view.draft);
        }
        return;
      }
      if (view.kind !== 'list') {
        return;
      }
      if (verifying && (input === 'a' || input === 't' || input === 'd')) {
        setMessage({text: 'Wait until the caches are verified; a scan still running could undo this.', error: true});
        return;
      }
      if (key.upArrow || key.downArrow) {
        const index = Math.max(0, rows.indexOf(selected));
        const offset = key.upArrow ? -1 : 1;
        setSelected(rows[(index + offset + rows.length) % rows.length] ?? defaultRoot);
        setMessage(undefined);
      } else if (input === 'a') {
        setMessage(undefined);
        setView({kind: 'browse'});
      } else if (input === 't') {
        setMessage(undefined);
        setView({kind: 'type', draft: '', buttonSelected: false, problems: []});
      } else if (input === 'd') {
        if (selected === defaultRoot) {
          setMessage({text: 'The current directory\'s runs folder is always scanned.', error: true});
          return;
        }
        const root = selected;
        setSelected(defaultRoot);
        save(`Forgot ${root}. Its files were not changed.`, roots => roots.filter(candidate => candidate !== root));
      }
    },
    {isActive: inputActive},
  );

  if (view.kind === 'browse') {
    return (
      <PathBrowser
        selectFolder
        initialDirectory={currentDirectory}
        onSelect={addRoot}
        onCancel={() => setView({kind: 'list'})}
        inputActive={inputActive}
        readDirectory={readDirectory}
      />
    );
  }

  if (view.kind === 'type') {
    return (
      <EditPage
        title="Add output root"
        description="Discovery will read the ncbi-accessions-cache folder directly inside this folder."
        shortcuts={['Tab/↑/↓ — Field', view.buttonSelected && 'Enter — Add']}
        back="Cancel"
        saveLabel="Add output root"
        saveSelected={view.buttonSelected}
        saving={busy}
        problems={view.problems}
      >
        <TextField
          label="Output root"
          required
          selected={!view.buttonSelected}
          inputActive={inputActive && !busy}
          defaultValue={view.draft}
          displayValue={view.draft}
          placeholder="Type or paste an absolute path"
          onChange={draft => setView(current => current.kind === 'type' ? {...current, draft} : current)}
        />
      </EditPage>
    );
  }

  const copiesUnder = (root: string): number =>
    scan.copies.filter(copy => copy.root === resolve(root)).length;
  const problemFor = (root: string): string | undefined =>
    scan.rootProblems.find(problem => problem.root === resolve(root))?.message;

  return (
    <Page
      {...page}
      description={
        'Discovery reads only the ncbi-accessions-cache folder directly inside these output roots. ' +
        'A successful run that downloads an accession adds its output root here.'
      }
      shortcuts={['↑/↓ — Select', 'a — Add by browsing', 't — Add by typing', 'd — Forget', 'Tab/←/→ — Tab']}
    >
      {notice}
      <Box flexDirection="column">
        {rows.map(root => {
          const isSelected = root === selected;
          const problem = problemFor(root);
          const count = copiesUnder(root);
          return (
            <Text key={root} color={isSelected ? 'cyan' : undefined} wrap="truncate">
              {isSelected ? '› ' : '  '}
              {sanitizeTerminalText(root)}
              <Text color={problem ? 'red' : mutedColor}>
                {root === defaultRoot ? ' · current directory, always scanned' : ''}
                {problem
                  ? ` · cannot be read: ${sanitizeTerminalText(problem)}`
                  : ` · ${String(count)} cache ${count === 1 ? 'directory' : 'directories'}`}
              </Text>
            </Text>
          );
        })}
      </Box>
      {busy ? <Text>Saving…</Text> : null}
      {message ? (
        <Box marginTop={1}>
          <Text color={message.error ? 'red' : undefined} wrap="wrap">
            {message.error ? 'Error: ' : ''}{sanitizeTerminalText(message.text)}
          </Text>
        </Box>
      ) : null}
    </Page>
  );
}
