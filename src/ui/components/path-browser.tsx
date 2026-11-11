import type {Dirent} from 'node:fs';
import {readdir} from 'node:fs/promises';
import {basename, dirname, resolve} from 'node:path';
import React, {useEffect, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import {sanitizeTerminalText} from '../sanitize.js';
import {mutedColor} from '../theme.js';
import {Page} from './page.js';
import {SelectableList} from './selectable-list.js';

/** Lines of the entry list, including its position line. */
const listHeight = 13;

export type DirectoryReader = (path: string) => Promise<Dirent[]>;

const readFilesystemDirectory: DirectoryReader = path => readdir(path, {withFileTypes: true});

function isManagedRunDirectoryEntry(parentDirectory: string, entryName: string): boolean {
  return basename(parentDirectory) === 'runs' && entryName === 'ncbi-accessions-cache';
}

type BrowserState =
  | {state: 'loading'}
  | {state: 'failed'; message: string}
  | {state: 'ready'; entries: Dirent[]};

/**
 * Browses the filesystem to choose a file, or with `selectFolder` a folder: a leading row then
 * chooses the folder being shown, and files are listed for orientation only.
 */
export function PathBrowser({
  initialDirectory,
  onSelect,
  onCancel,
  inputActive,
  readDirectory = readFilesystemDirectory,
  selectFolder = false,
  title,
  intro,
}: {
  initialDirectory: string;
  onSelect: (path: string) => void;
  onCancel: () => void;
  inputActive: boolean;
  readDirectory?: DirectoryReader;
  selectFolder?: boolean;
  /** Replaces the default "Select a file/folder" title. */
  title?: string;
  /** Explains the choice above the shown directory. */
  intro?: string;
}): React.JSX.Element {
  const [directory, setDirectory] = useState(initialDirectory);
  const [browser, setBrowser] = useState<BrowserState>({state: 'loading'});
  const [selectedIndex, setSelectedIndex] = useState(0);
  const leadingRows = selectFolder ? 1 : 0;

  useEffect(() => {
    let active = true;
    setBrowser({state: 'loading'});
    readDirectory(directory).then(
      entries => {
        if (active) {
          setBrowser({
            state: 'ready',
            entries: entries
              .filter(entry =>
                (entry.isDirectory() || entry.isFile()) &&
                !isManagedRunDirectoryEntry(directory, entry.name),
              )
              .sort((left, right) => {
                if (left.isDirectory() !== right.isDirectory()) {
                  return left.isDirectory() ? -1 : 1;
                }
                return left.name.localeCompare(right.name);
              }),
          });
          setSelectedIndex(0);
        }
      },
      error => {
        if (active) {
          setBrowser({
            state: 'failed',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      },
    );
    return () => {
      active = false;
    };
  }, [directory, readDirectory]);

  useInput(
    (input, key) => {
      if (key.escape) {
        onCancel();
        return;
      }
      if (key.leftArrow) {
        setDirectory(current => dirname(current));
        return;
      }
      if (browser.state !== 'ready') {
        return;
      }
      const rowCount = browser.entries.length + leadingRows;
      if (rowCount === 0) {
        return;
      }
      if (key.return || key.rightArrow) {
        if (selectFolder && selectedIndex === 0) {
          if (key.return) {
            onSelect(directory);
          }
          return;
        }
        const selected = browser.entries[selectedIndex - leadingRows];
        if (!selected) {
          return;
        }
        const selectedPath = resolve(directory, selected.name);
        if (selected.isDirectory()) {
          setDirectory(selectedPath);
        } else if (key.return && !selectFolder) {
          onSelect(selectedPath);
        }
      }
    },
    {isActive: inputActive},
  );

  const rowCount = browser.state === 'ready' ? browser.entries.length + leadingRows : 0;

  return (
    <Page
      title={title ?? (selectFolder ? 'Select a folder' : 'Select a file')}
      description={[intro, sanitizeTerminalText(directory)].filter(Boolean).join('\n')}
      shortcuts={selectFolder
        ? ['→/Enter — Open folder', 'Enter on [ Use this folder ] — Choose', '← — Parent']
        : ['→ — Open folder', 'Enter — Choose', '← — Parent']}
      back="Cancel"
    >
      <Box flexDirection="column">
        {browser.state === 'loading' ? <Text>Reading directory…</Text> : null}
        {browser.state === 'failed' ? (
          <Box flexDirection="column">
            <Text color="red">Unable to read this directory.</Text>
            <Text>{sanitizeTerminalText(browser.message)}</Text>
          </Box>
        ) : null}
        {browser.state === 'ready' && browser.entries.length === 0 ? (
          <Text>This directory is empty.</Text>
        ) : null}
        {browser.state === 'ready' ? (
          <SelectableList
            count={rowCount}
            selectedIndex={selectedIndex}
            onSelect={setSelectedIndex}
            active={inputActive}
            height={listHeight}
            noun="entries"
            renderItem={(index, selected) => {
              if (selectFolder && index === 0) {
                return (
                  <Text color={selected ? 'cyan' : undefined} wrap="truncate">
                    {selected ? '›' : ' '} [ Use this folder ]
                  </Text>
                );
              }
              const entry = browser.entries[index - leadingRows]!;
              return (
                <Text color={selected ? 'cyan' : mutedColor} dimColor={selectFolder && !entry.isDirectory()} wrap="truncate">
                  {selected ? '›' : ' '} {sanitizeTerminalText(entry.name)}
                  {entry.isDirectory() ? '/' : ''}
                </Text>
              );
            }}
          />
        ) : null}
      </Box>
    </Page>
  );
}
