import React, {useEffect, useState} from 'react';
import {Box, Text} from 'ink';
import {listDerivedRewrites, runGff3Sources, type DerivedRewrite, type Gff3Source} from '../../gff3-replace/derived.js';
import type {WorkflowManifest} from '../../workflows/manifest.js';
import {ParameterList, type ParameterRow} from '../components/parameter-list.js';
import {Section} from '../components/section.js';
import {SelectableList} from '../components/selectable-list.js';
import {sanitizeTerminalText} from '../sanitize.js';
import {mutedColor} from '../theme.js';

type Key = {return: boolean; escape: boolean};

/** One rewrite's line: its search and replacement, its counts, and why it is outdated. */
export function rewriteValue(rewrite: DerivedRewrite): string {
  if (!rewrite.record) {
    return `unreadable: ${rewrite.reason ?? ''}`;
  }
  const {search, replacement, regular_expression: regex, statistics} = rewrite.record;
  const change = `${regex ? '/' : '"'}${search}${regex ? '/' : '"'} → "${replacement}"`;
  // The record is read leniently, so a summary is shown only for counts it holds.
  const counts: [unknown, string, string][] = [
    [statistics?.ids?.changed, 'ID changed', 'IDs changed'],
    [statistics?.replacements, 'replacement', 'replacements'],
    [statistics?.aliases_added, 'alias added', 'aliases added'],
  ];
  const summary = counts.flatMap(([value, one, many]) =>
    typeof value === 'number' ? [`${String(value)} ${value === 1 ? one : many}`] : []);
  const line = [change, ...summary].join(' · ');
  return rewrite.state === 'outdated' ? `${line} · outdated: ${rewrite.reason ?? ''}` : line;
}

/**
 * The rewrites in a run's `derived/` as a Derived files section, and `g`, which on a finished run
 * chooses one of its GFF3 files (its `gff3` artifacts and current rewrites) to rewrite. The result
 * screen routes keys here first and shows the open choice below its results.
 */
export function useDerivedRewrites({runDirectory, manifest, finished, inputActive, listRewrites = listDerivedRewrites, pathExists}: {
  runDirectory: string;
  inputActive: boolean;
  manifest: WorkflowManifest;
  finished: boolean;
  /** Changing it reads the rewrites again, such as after returning from a rewrite. */
  listRewrites?: typeof listDerivedRewrites;
  pathExists?: (path: string) => boolean;
}) {
  const [rewrites, setRewrites] = useState<DerivedRewrite[]>();
  const [reload, setReload] = useState(0);
  const [choice, setChoice] = useState<number>();
  const [opened, setOpened] = useState<Gff3Source>();
  useEffect(() => {
    let active = true;
    listRewrites(runDirectory).then(value => {
      if (active) {
        setRewrites(value);
      }
    }, () => {
      if (active) {
        setRewrites([]);
      }
    });
    return () => {
      active = false;
    };
  }, [runDirectory, listRewrites, reload]);

  const sources = finished && rewrites ? runGff3Sources(runDirectory, manifest, rewrites, pathExists) : [];

  /** Handles a key; false when it is the screen's to handle. */
  const handleInput = (input: string, key: Key): boolean => {
    if (choice !== undefined) {
      if (key.escape) {
        setChoice(undefined);
      } else if (key.return) {
        setChoice(undefined);
        setOpened(sources[choice]);
      }
      // While the choice is open it takes every key; its list moves the selection itself.
      return true;
    }
    if (input === 'g' && sources.length > 0) {
      if (sources.length === 1) {
        setOpened(sources[0]);
      } else {
        setChoice(0);
      }
      return true;
    }
    return false;
  };

  const rows: ParameterRow[] = (rewrites ?? []).map(rewrite => ({id: rewrite.name, label: rewrite.name, value: rewriteValue(rewrite),
    muted: rewrite.state !== 'current'}));
  const section = (
    <Section title="Derived files">
      {rewrites === undefined ? <Text color={mutedColor}>Reading…</Text> : rows.length > 0
        ? <ParameterList rows={rows} inputActive={false} />
        : <Text color={mutedColor}>None.{sources.length > 0 ? ' g finds and replaces in one of this run\'s GFF3 files.' : ''}</Text>}
    </Section>
  );
  const choiceElement = choice !== undefined ? (
    <Box flexDirection="column" borderStyle="single" borderLeft={false} borderRight={false}>
      <Text bold>Find and replace in</Text>
      <SelectableList
        count={sources.length}
        selectedIndex={choice}
        onSelect={setChoice}
        active={inputActive}
        height={Math.min(sources.length, 8) + 1}
        noun="files"
        renderItem={(index, selected) => (
          <Text inverse={selected} wrap="truncate">
            {selected ? '› ' : '  '}{sanitizeTerminalText(sources[index]!.label)}
          </Text>
        )}
      />
    </Box>
  ) : null;
  return {
    section,
    handleInput,
    choosing: choice !== undefined,
    /** Changes when the listed rewrites do, so the screen measures its content again. */
    listed: rewrites?.length ?? -1,
    choice: choiceElement,
    choiceRows: choice !== undefined ? Math.min(sources.length, 8) + 4 : 0,
    shortcuts: choice !== undefined ? ['Enter — Choose'] : [sources.length > 0 && 'g — Find and replace in GFF3'],
    back: choice !== undefined ? 'Cancel' : undefined,
    opened,
    close: () => {
      setOpened(undefined);
      setReload(current => current + 1);
    },
  };
}
