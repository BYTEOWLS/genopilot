import React, {useState} from 'react';
import {Box, Text, useInput, useWindowSize} from 'ink';
import type {ReferenceConsensusConfiguration} from '../../workflows/reference-consensus/configuration.js';
import {
  CohortDecisionError,
  type CohortDecisionDraft,
  type CohortSettings,
} from '../../workflows/reference-consensus/cohort-decision.js';
import type {ReferenceConsensusResult} from '../../workflows/reference-consensus/results.js';
import {EditPage} from '../components/page.js';
import {ParameterList, type ParameterRow} from '../components/parameter-list.js';
import {Table} from '../components/table.js';
import {useHomeSuspension} from '../home-navigation.js';
import {mutedColor} from '../theme.js';

type SettingRow = 'backbone' | 'method' | 'min-callable' | 'unresolved' | 'reason';
type RowId = `isolate:${string}` | SettingRow | 'save';

const settingRows: readonly SettingRow[] = ['backbone', 'method', 'min-callable', 'unresolved', 'reason'];
const votingMethods: readonly CohortSettings['voting_method'][] = ['strict-majority', 'plurality'];
const unresolvedSnps: readonly CohortSettings['unresolved_snp'][] = ['n', 'iupac'];
// Rows the page needs besides the isolate list: title, description, the list's header and
// markers, the settings, the button, the shortcut line, and room for a few problems.
const reservedLines = 24;

function cycle<T>(values: readonly T[], current: T, offset: 1 | -1): T {
  const index = values.indexOf(current);
  return values[(index + offset + values.length) % values.length] as T;
}

function share(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/** An issue of a refused decision, named by the field it concerns instead of its YAML path. */
function problemText(issue: {path: string; message: string}): string {
  const fields: [string, string][] = [
    ['$.reason', 'Reason'],
    ['$.consensus.min_callable_isolates', 'Minimum callable isolates'],
    ['$.consensus', 'Cohort settings'],
    ['$.voting_isolates', 'Voting isolates'],
    ['$.excluded_from_voting', 'Voting isolates'],
    ['$.iteration', 'Iteration'],
  ];
  const field = fields.find(([prefix]) => issue.path.startsWith(prefix))?.[1];
  return field ? `${field}: ${issue.message}` : issue.message;
}

/** The voters and settings a new decision starts from: the active cohort's, or the run's own. */
export function initialCohortDraft(
  result: ReferenceConsensusResult,
  configuration: ReferenceConsensusConfiguration,
): {voting: string[]; settings: CohortSettings} {
  const active = result.cohorts.find(cohort => cohort.id === result.activeCohortId);
  if (active?.voters && active.settings) {
    return {voting: active.voters, settings: active.settings};
  }
  // Without an aggregated cohort, every isolate that finished its processing votes; an incomplete
  // isolate can only be excluded, which is what this decision is typically for.
  return {
    voting: result.isolates.filter(isolate => isolate.state === 'completed').map(isolate => isolate.id),
    settings: configuration.consensus,
  };
}

/**
 * The form of a cohort decision: which isolates vote, the cohort settings, and the reason. It is
 * validated only when saved, by the save function, whose problems it shows; lineage and wild-type
 * metadata are shown to inform the decision but never change the selection.
 */
export function CohortReviewScreen({
  result,
  configuration,
  saveDecision,
  onSaved,
  onCancel,
  inputActive,
}: {
  result: ReferenceConsensusResult;
  configuration: ReferenceConsensusConfiguration;
  /** Saves the draft as the next iteration and returns its number. */
  saveDecision: (draft: CohortDecisionDraft) => Promise<number>;
  onSaved: (iteration: number) => void;
  onCancel: () => void;
  inputActive: boolean;
}): React.JSX.Element {
  const {rows: terminalRows} = useWindowSize();
  const [initial] = useState(() => initialCohortDraft(result, configuration));
  const [voting, setVoting] = useState<ReadonlySet<string>>(() => new Set(initial.voting));
  const [settings, setSettings] = useState<CohortSettings>(initial.settings);
  const [minCallable, setMinCallable] = useState(String(initial.settings.min_callable_isolates));
  const [reason, setReason] = useState('');
  const [selected, setSelected] = useState<RowId>(() => result.isolates[0] ? `isolate:${result.isolates[0].id}` : 'reason');
  const [saving, setSaving] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const typing = selected === 'min-callable' || selected === 'reason';
  useHomeSuspension(saving ? 'busy' : typing ? 'typing' : undefined);

  const rowIds: RowId[] = [
    ...result.isolates.map(isolate => `isolate:${isolate.id}` as const),
    ...settingRows,
    'save',
  ];
  const selectedIndex = Math.max(0, rowIds.indexOf(selected));
  const selectedIsolate = selected.startsWith('isolate:') ? selected.slice('isolate:'.length) : undefined;

  const move = (offset: 1 | -1): void => {
    setSelected(rowIds[Math.max(0, Math.min(rowIds.length - 1, selectedIndex + offset))] ?? selected);
  };

  const change = (offset: 1 | -1): void => {
    if (selectedIsolate !== undefined) {
      const isolate = result.isolates.find(candidate => candidate.id === selectedIsolate);
      if (isolate?.state !== 'completed') {
        return;
      }
      const next = new Set(voting);
      if (next.has(selectedIsolate)) {
        next.delete(selectedIsolate);
      } else {
        next.add(selectedIsolate);
      }
      setVoting(next);
    } else if (selected === 'backbone') {
      setSettings({...settings, include_backbone_vote: !settings.include_backbone_vote});
    } else if (selected === 'method') {
      setSettings({...settings, voting_method: cycle(votingMethods, settings.voting_method, offset)});
    } else if (selected === 'unresolved') {
      setSettings({...settings, unresolved_snp: cycle(unresolvedSnps, settings.unresolved_snp, offset)});
    }
  };

  const save = (): void => {
    const trimmed = minCallable.trim();
    const draft: CohortDecisionDraft = {
      voting_isolates: result.isolates.filter(isolate => voting.has(isolate.id)).map(isolate => isolate.id),
      excluded_from_voting: result.isolates.filter(isolate => !voting.has(isolate.id)).map(isolate => isolate.id),
      // A value that is not a whole number is passed on as typed, so validation names it.
      consensus: {...settings, min_callable_isolates: (/^[0-9]+$/.test(trimmed) ? Number(trimmed) : trimmed) as number},
      reason,
    };
    setSaving(true);
    setProblems([]);
    saveDecision(draft).then(
      iteration => {
        setSaving(false);
        onSaved(iteration);
      },
      error => {
        setSaving(false);
        setProblems(error instanceof CohortDecisionError
          ? error.issues.map(problemText)
          : [error instanceof Error ? error.message : String(error)]);
      },
    );
  };

  useInput((input, key) => {
    if (saving) {
      return;
    }
    if (key.escape) {
      onCancel();
    } else if (key.tab) {
      move(key.shift ? -1 : 1);
    } else if (key.upArrow || key.downArrow) {
      move(key.upArrow ? -1 : 1);
    } else if (!typing && (input === ' ' || key.leftArrow || key.rightArrow)) {
      change(key.leftArrow ? -1 : 1);
    } else if (key.return && selected === 'save') {
      save();
    }
    // Text rows handle their own typing through the text field mounted while they are selected.
  }, {isActive: inputActive});

  const isolateWindow = Math.max(3, terminalRows - reservedLines);
  const firstIsolate = Math.max(0, Math.min(
    (selectedIsolate === undefined ? 0 : selectedIndex) - Math.floor(isolateWindow / 2),
    result.isolates.length - isolateWindow,
  ));
  const shownIsolates = result.isolates.slice(firstIsolate, firstIsolate + isolateWindow);
  const isolateRows = shownIsolates.map(isolate => [
    voting.has(isolate.id) ? '[x]' : '[ ]',
    isolate.id,
    isolate.name,
    isolate.wildtype === null ? '—' : isolate.wildtype ? 'yes' : 'no',
    isolate.derivedFrom ?? '—',
    isolate.state,
    isolate.metrics ? isolate.metrics.meanDepth.toFixed(1) : '—',
    isolate.metrics ? share(isolate.metrics.coveredFraction) : '—',
    isolate.metrics ? share(isolate.metrics.callableFraction) : '—',
    isolate.metrics ? String(isolate.metrics.snps) : '—',
    isolate.metrics ? String(isolate.metrics.indels) : '—',
  ]);
  const selectedIsolateRow = selectedIsolate === undefined
    ? undefined
    : shownIsolates.findIndex(isolate => isolate.id === selectedIsolate);

  const settingsList: ParameterRow[] = [
    {id: 'backbone', label: 'Backbone votes', value: settings.include_backbone_vote ? 'yes' : 'no', choice: true},
    {
      id: 'method',
      label: 'Voting method',
      value: settings.voting_method === 'strict-majority' ? 'strict majority' : 'plurality',
      choice: true,
    },
    {
      id: 'min-callable',
      label: 'Minimum callable isolates',
      value: minCallable,
      edit: {defaultValue: minCallable, onChange: setMinCallable},
    },
    {id: 'unresolved', label: 'Unresolved SNPs written as', value: settings.unresolved_snp === 'n' ? 'N' : 'IUPAC code', choice: true},
    {
      id: 'reason',
      label: 'Reason',
      value: reason || 'Required: why this decision is made',
      muted: reason.length === 0,
      edit: {defaultValue: reason, placeholder: 'Why this decision is made', onChange: setReason},
    },
  ];

  return (
    <EditPage
      title="Review cohort"
      detail={`${String(voting.size)} of ${String(result.isolates.length)} isolates vote`}
      description="Choose which isolates vote and how the consensus is chosen. An incomplete isolate can only be excluded. Saving records the decision as a new iteration and prepares its rerun; no isolate is processed again."
      shortcuts={['↑/↓/Tab — Move', 'Space/←/→ — Change', 'Enter — Save']}
      back="Back to results"
      saveLabel="Save decision and prepare rerun"
      saveSelected={selected === 'save'}
      saving={saving}
      savingLabel="Saving the decision…"
      problems={problems}
    >
      <Text bold>Voting isolates</Text>
      <Table
        header={['Votes', 'Isolate', 'Name', 'Wild type', 'Derived from', 'State', 'Depth', 'Covered', 'Callable', 'SNPs', 'Indels']}
        rows={isolateRows}
        selectedRow={selectedIsolateRow === undefined || selectedIsolateRow < 0 ? -1 : selectedIsolateRow}
      />
      {result.isolates.length > shownIsolates.length ? (
        <Text color={mutedColor}>
          {'  '}isolates {String(firstIsolate + 1)}–{String(firstIsolate + shownIsolates.length)} of {String(result.isolates.length)}
        </Text>
      ) : null}
      <Box marginTop={1} flexDirection="column">
        <Text bold>Cohort settings</Text>
        <ParameterList rows={settingsList} selectedId={selected} inputActive={inputActive && !saving} />
      </Box>
    </EditPage>
  );
}
