import type {Dirent} from 'node:fs';
import {readdir} from 'node:fs/promises';
import {basename, dirname, resolve} from 'node:path';
import React, {useEffect, useState} from 'react';
import {Box, Text, useInput} from 'ink';
import {sanitizeTerminalText} from '../sanitize.js';
import {mutedColor} from '../theme.js';

export type DirectoryReader = (path: string) => Promise<Dirent[]>;

const readFilesystemDirectory: DirectoryReader = path => readdir(path, {withFileTypes: true});

function isManagedRunDirectoryEntry(parentDirectory: string, entryName: string): boolean {
  return basename(parentDirectory) === 'runs' && entryName === 'ncbi-accessions-cache';
}

type BrowserState =
  | {state: 'loading'}
  | {state: 'failed'; message: string}
  | {state: 'ready'; entries: Dirent[]};

export function PathBrowser({
  initialDirectory,
  onSelect,
  onCancel,
  inputActive,
  readDirectory = readFilesystemDirectory,
}: {
  initialDirectory: string;
  onSelect: (path: string) => void;
  onCancel: () => void;
  inputActive: boolean;
  readDirectory?: DirectoryReader;
}): React.JSX.Element {
  const [directory, setDirectory] = useState(initialDirectory);
  const [browser, setBrowser] = useState<BrowserState>({state: 'loading'});
  const [selectedIndex, setSelectedIndex] = useState(0);

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
      if (browser.state !== 'ready' || browser.entries.length === 0) {
        return;
      }
      if (key.upArrow) {
        setSelectedIndex(index => (index - 1 + browser.entries.length) % browser.entries.length);
      } else if (key.downArrow) {
        setSelectedIndex(index => (index + 1) % browser.entries.length);
      } else if (key.return || key.rightArrow) {
        const selected = browser.entries[selectedIndex];
        if (!selected) {
          return;
        }
        const selectedPath = resolve(directory, selected.name);
        if (selected.isDirectory()) {
          setDirectory(selectedPath);
        } else if (key.return) {
          onSelect(selectedPath);
        }
      }
    },
    {isActive: inputActive},
  );

  const visibleStart =
    browser.state === 'ready'
      ? Math.max(0, Math.min(selectedIndex - 5, browser.entries.length - 12))
      : 0;
  const visibleEntries =
    browser.state === 'ready' ? browser.entries.slice(visibleStart, visibleStart + 12) : [];

  return (
    <Box flexDirection="column">
      <Text bold>Select a file</Text>
      <Text color={mutedColor} wrap="truncate">{sanitizeTerminalText(directory)}</Text>
      <Box marginTop={1} flexDirection="column">
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
        {browser.state === 'ready'
          ? visibleEntries.map((entry, visibleIndex) => {
              const index = visibleStart + visibleIndex;
              return (
                <Text
                  key={entry.name}
                  color={index === selectedIndex ? 'cyan' : mutedColor}
                >
                  {index === selectedIndex ? '›' : ' '} {sanitizeTerminalText(entry.name)}
                  {entry.isDirectory() ? '/' : ''}
                </Text>
              );
            })
          : null}
        {browser.state === 'ready' && browser.entries.length > 12 ? (
          <Text color={mutedColor}>
            {selectedIndex + 1} of {browser.entries.length}
          </Text>
        ) : null}
      </Box>
      <Box marginTop={1}>
        <Text color={mutedColor}>↑/↓ — Select · → Open — folder · Enter — Choose · ← — Parent · Esc — Cancel</Text>
      </Box>
    </Box>
  );
}
