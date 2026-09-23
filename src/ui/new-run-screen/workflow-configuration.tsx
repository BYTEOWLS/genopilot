import {dirname, isAbsolute} from 'node:path';
import React, {useCallback, useMemo, useRef, useState} from 'react';
import {Box, Newline, Text, useInput, useWindowSize} from 'ink';
import {Alert} from '@inkjs/ui';
import type {WorkflowManifest} from '../../workflows/manifest.js';
import type {WorkflowParameterDefinition} from '../../workflows/parameter-definitions.js';
import {sanitizeTerminalText} from '../sanitize.js';
import {PathBrowser} from './path-browser.js';
import {TextField} from './text-field.js';
import {
  WorkflowExecutionScreen,
  type WorkflowProgressStage,
  type WorkflowRun,
  type WorkflowRunExecutor,
  type WorkflowRunMode,
} from './workflow-execution.js';
import {mutedColor} from '../theme.js';
import {useHomeSuspension} from '../home-navigation.js';

// Chrome this screen renders around the windowed field list: its own title,
// margins, and footer hint text. Space consumed by an outer wrapper (such as
// the welcome screen's header/footer) is not visible here and is not reserved.
const reservedChromeLines = 8;
const minimumVisibleLines = 5;
const scrollLookbackLines = 3;

type FormRow =
  | {kind: 'section'; key: string; section: string; lines: number}
  | {kind: 'field'; key: string; definition: WorkflowParameterDefinition; lines: number};

function definitionLineCount(definition: WorkflowParameterDefinition): number {
  if (definition.kind === 'choice') {
    return 1 + (definition.options?.length ?? 0);
  }
  return 1 + (definition.preview ? 1 : 0);
}

export type WorkflowFormValues = Record<string, string>;

export type PreviousWorkflowRun = {label: string; values: WorkflowFormValues};

export type PreReviewChoice = {
  id: string;
  label: string;
  options: readonly {value: string; label: string}[];
  defaultValue: string;
};

export type PreparedWorkflowRun<T> = {
  payload: T;
  resolvedValues: WorkflowFormValues;
  effectiveOptions: readonly {label: string; value: string}[];
  outputDirectory: string;
  preReviewChoices?: readonly PreReviewChoice[];
  applyPreReviewChoices?: (values: Readonly<Record<string, string>>) => PreparedWorkflowRun<T>;
};

export type WorkflowRunPreparation<T> = (
  values: WorkflowFormValues,
) => Promise<PreparedWorkflowRun<T>>;
export type WorkflowRunSaver<T> = (prepared: T) => Promise<string>;

export type WorkflowRunPreparer<T, R extends WorkflowRun> = (
  mode: WorkflowRunMode,
  prepared: T,
  configurationPath: string,
) => R;

type ScreenState<T> =
  | {state: 'editing'}
  | {state: 'validating'}
  | {state: 'invalid'; messages: string[]}
  | {
      state: 'pre-review-choices';
      prepared: PreparedWorkflowRun<T>;
      selectedIndex: number;
      values: Record<string, string>;
    }
  | {state: 'review'; prepared: PreparedWorkflowRun<T>}
  | {state: 'saving'; prepared: PreparedWorkflowRun<T>}
  | {state: 'execution'; payload: T; configurationPath: string; outputDirectory: string}
  | {state: 'saved'; configurationPath: string};

export function initialWorkflowFormValues(
  definitions: readonly WorkflowParameterDefinition[],
): WorkflowFormValues {
  return Object.fromEntries(definitions.map(definition => [definition.id, definition.default ?? '']));
}

function messageLines(error: unknown): string[] {
  if (
    typeof error === 'object' &&
    error !== null &&
    'issues' in error &&
    Array.isArray(error.issues)
  ) {
    return error.issues.map(issue => {
      if (typeof issue === 'object' && issue !== null && 'path' in issue && 'message' in issue) {
        return `${String(issue.path)}: ${String(issue.message)}`;
      }
      return String(issue);
    });
  }
  return [error instanceof Error ? error.message : String(error)];
}

function matchesCondition(
  condition: {parameter: string; equals: string | string[]} | undefined,
  values: WorkflowFormValues,
): boolean {
  if (!condition) {
    return false;
  }
  const value = values[condition.parameter] ?? '';
  return Array.isArray(condition.equals) ? condition.equals.includes(value) : value === condition.equals;
}

function displayValue(definition: WorkflowParameterDefinition, value: string): string {
  if (definition.kind === 'choice') {
    return definition.options?.find(option => option.value === value)?.label ?? value;
  }
  return value.length === 0 ? definition.placeholder || 'Not set' : value;
}

function WorkflowConfigurationScreen<T, R extends WorkflowRun = WorkflowRun>({
  title,
  currentDirectory,
  parameterDefinitions,
  onBack,
  inputActive,
  prepareRun,
  saveRun,
  prepareSnakemakeRun,
  executeSnakemakeRun,
  previousRuns = [],
  stages = [],
  resultManifest,
}: {
  title: string;
  currentDirectory: string;
  parameterDefinitions: readonly WorkflowParameterDefinition[];
  onBack: () => void;
  inputActive: boolean;
  prepareRun: WorkflowRunPreparation<T>;
  saveRun: WorkflowRunSaver<T>;
  prepareSnakemakeRun?: WorkflowRunPreparer<T, R>;
  executeSnakemakeRun?: WorkflowRunExecutor<R>;
  previousRuns?: readonly PreviousWorkflowRun[];
  stages?: readonly WorkflowProgressStage[];
  resultManifest?: WorkflowManifest;
}): React.JSX.Element {
  const editableDefinitions = useMemo(
    () => parameterDefinitions.filter(definition => !definition.hidden && definition.kind !== 'fixed'),
    [parameterDefinitions],
  );
  const visibleFixedDefinitions = useMemo(
    () => parameterDefinitions.filter(definition => !definition.hidden && definition.kind === 'fixed'),
    [parameterDefinitions],
  );
  const [values, setValues] = useState(() => initialWorkflowFormValues(parameterDefinitions));
  const [selectedId, setSelectedId] = useState(editableDefinitions[0]?.id);
  const [browserId, setBrowserId] = useState<string>();
  const [screen, setScreen] = useState<ScreenState<T>>({state: 'editing'});
  const [previousRunIndex, setPreviousRunIndex] = useState<number>();
  // A file field's TextInput is uncontrolled (@inkjs/ui seeds it once from `defaultValue` at
  // mount and never re-reads that prop), so stepping through run history — which can overwrite
  // the currently selected file field's value without unmounting it — has to force a remount to
  // show the new value. Bumping this generation on every step and folding it into that field's
  // `key` does exactly that, without disturbing the field while the user is simply typing.
  const [runApplyGeneration, setRunApplyGeneration] = useState(0);

  const isVisible = (definition: WorkflowParameterDefinition): boolean =>
    !definition.hidden && (!definition.visible_when || matchesCondition(definition.visible_when, values));
  // A browse-only file field (see 'browse_only_when' on WorkflowParameterDefinition) has no
  // typable value of its own: Enter opens the file chooser directly instead of a TextInput.
  const isBrowseOnly = (definition: WorkflowParameterDefinition): boolean =>
    matchesCondition(definition.browse_only_when, values);
  const visibleEditableDefinitions = editableDefinitions.filter(isVisible);
  const visibleDefinitions = parameterDefinitions.filter(isVisible);
  const sections = [...new Set(visibleDefinitions.map(definition => definition.section))];
  const selectedDefinition = visibleEditableDefinitions.find(definition => definition.id === selectedId);
  const enterOpensFileChooser = selectedDefinition?.kind === 'file' && isBrowseOnly(selectedDefinition);
  const showsForm = screen.state === 'editing' || screen.state === 'validating' || screen.state === 'invalid';
  const typing = showsForm && !browserId && selectedDefinition !== undefined &&
    selectedDefinition.kind !== 'choice' && !enterOpensFileChooser;
  useHomeSuspension(screen.state === 'saving' ? 'busy' : typing ? 'typing' : undefined);

  const {rows: terminalRows} = useWindowSize();
  const formRows: FormRow[] = [];
  for (const section of sections) {
    formRows.push({kind: 'section', key: `section:${section}`, section, lines: 2});
    for (const definition of visibleDefinitions.filter(candidate => candidate.section === section)) {
      formRows.push({
        kind: 'field',
        key: definition.id,
        definition,
        lines: definitionLineCount(definition),
      });
    }
  }
  let cursor = 0;
  const formRowsWithOffsets = formRows.map(row => {
    const start = cursor;
    cursor += row.lines;
    return {...row, start};
  });
  const totalFormLines = cursor;
  const availableFormLines = Math.max(minimumVisibleLines, terminalRows - reservedChromeLines);
  const isFormWindowed = totalFormLines > availableFormLines;
  const selectedFormRow = formRowsWithOffsets.find(
    row => row.kind === 'field' && row.definition.id === selectedId,
  );
  const formScrollTop = selectedFormRow
    ? Math.max(
        0,
        Math.min(
          selectedFormRow.start - scrollLookbackLines,
          Math.max(0, totalFormLines - availableFormLines),
        ),
      )
    : 0;
  const visibleFormRows = isFormWindowed
    ? formRowsWithOffsets.filter(
        row => row.start + row.lines > formScrollTop && row.start < formScrollTop + availableFormLines,
      )
    : formRowsWithOffsets;

  const updateValue = useCallback((id: string, value: string): void => {
    setValues(current => ({...current, [id]: value}));
  }, []);

  // @inkjs/ui's TextInput calls `onChange` from a useEffect that re-fires whenever the
  // *reference* it was given changes, not only when the value does — its own change-tracking
  // never resets once a field has been edited once. A fresh inline arrow per render would
  // therefore re-trigger that effect on every parent re-render, which calls onChange again,
  // which re-renders the parent, forever. Caching one stable callback per field id keeps the
  // reference constant across renders so the effect only fires on an actual keystroke.
  const onChangeCache = useRef(new Map<string, (value: string) => void>());
  const onChangeFor = (id: string): ((value: string) => void) => {
    let cached = onChangeCache.current.get(id);
    if (!cached) {
      cached = value => updateValue(id, value);
      onChangeCache.current.set(id, cached);
    }
    return cached;
  };

  const selectField = (id: string): void => {
    setSelectedId(id);
  };

  const selectAdjacent = (offset: -1 | 1): void => {
    if (visibleEditableDefinitions.length === 0) {
      return;
    }
    const currentIndex = Math.max(
      0,
      visibleEditableDefinitions.findIndex(definition => definition.id === selectedId),
    );
    selectField(
      visibleEditableDefinitions[
        (currentIndex + offset + visibleEditableDefinitions.length) %
          visibleEditableDefinitions.length
      ]?.id,
    );
  };

  // Stepping through run history is a snapshot browser, not a merge: each step fully replaces
  // the form with that run's values (or the defaults, at index undefined) so the fields always
  // reflect exactly one point in history rather than an accumulation of edits and prefills.
  const applyPreviousRun = (index: number | undefined): void => {
    setPreviousRunIndex(index);
    setRunApplyGeneration(generation => generation + 1);
    const nextValues =
      index === undefined
        ? initialWorkflowFormValues(parameterDefinitions)
        : {...values, ...previousRuns[index]?.values};
    setValues(nextValues);
  };

  const beginReview = (): void => {
    const missingRequired = visibleDefinitions.filter(
      definition => definition.required && !(values[definition.id] ?? '').trim(),
    );
    if (missingRequired.length > 0) {
      setScreen({
        state: 'invalid',
        messages: missingRequired.map(definition => `${definition.label}: is required`),
      });
      return;
    }
    setScreen({state: 'validating'});
    prepareRun(values).then(
      prepared => {
        const choices = prepared.preReviewChoices ?? [];
        if (choices.length > 0) {
          setScreen({
            state: 'pre-review-choices',
            prepared,
            selectedIndex: 0,
            values: Object.fromEntries(choices.map(choice => [choice.id, choice.defaultValue])),
          });
        } else {
          setScreen({state: 'review', prepared});
        }
      },
      error => setScreen({state: 'invalid', messages: messageLines(error)}),
    );
  };

  useInput(
    (input, key) => {
      if (browserId) {
        return;
      }
      if (screen.state === 'pre-review-choices') {
        const choices = screen.prepared.preReviewChoices ?? [];
        const selectedChoice = choices[screen.selectedIndex];
        if (key.escape) {
          setScreen({state: 'editing'});
        } else if (key.tab || key.upArrow || key.downArrow) {
          const offset = key.upArrow || (key.tab && key.shift) ? -1 : 1;
          setScreen({
            ...screen,
            selectedIndex:
              (screen.selectedIndex + offset + choices.length) % choices.length,
          });
        } else if (input === ' ' && selectedChoice) {
          const currentIndex = Math.max(
            0,
            selectedChoice.options.findIndex(
              option => option.value === screen.values[selectedChoice.id],
            ),
          );
          const option = selectedChoice.options[(currentIndex + 1) % selectedChoice.options.length];
          if (option) {
            setScreen({
              ...screen,
              values: {...screen.values, [selectedChoice.id]: option.value},
            });
          }
        } else if (key.return) {
          const prepared = screen.prepared.applyPreReviewChoices?.(screen.values);
          if (prepared) {
            setScreen({state: 'review', prepared});
          }
        }
        return;
      }
      if (screen.state === 'review') {
        if (key.escape) {
          setScreen({state: 'editing'});
        } else if (key.return) {
          setScreen({state: 'saving', prepared: screen.prepared});
          const payload = screen.prepared.payload;
          saveRun(payload).then(
            configurationPath => {
              setScreen(
                prepareSnakemakeRun && executeSnakemakeRun
                  ? {
                      state: 'execution',
                      payload,
                      configurationPath,
                      outputDirectory: screen.prepared.outputDirectory,
                    }
                  : {state: 'saved', configurationPath},
              );
            },
            error => setScreen({state: 'invalid', messages: messageLines(error)}),
          );
        }
        return;
      }
      if (screen.state === 'execution') {
        // The execution screen owns its own keys, including the Esc that returns here.
        return;
      }
      if (screen.state === 'saved') {
        if (key.escape) {
          onBack();
        }
        return;
      }
      if (screen.state === 'saving' || screen.state === 'validating') {
        return;
      }
      if (key.escape) {
        onBack();
        return;
      }
      if (screen.state === 'invalid') {
        setScreen({state: 'editing'});
      }
      if (previousRuns.length > 0 && (key.pageUp || key.pageDown)) {
        if (key.pageDown) {
          applyPreviousRun(
            previousRunIndex === undefined
              ? 0
              : Math.min(previousRunIndex + 1, previousRuns.length - 1),
          );
        } else if (previousRunIndex !== undefined) {
          applyPreviousRun(previousRunIndex - 1 < 0 ? undefined : previousRunIndex - 1);
        }
        return;
      }
      if (key.tab) {
        selectAdjacent(key.shift ? -1 : 1);
        return;
      }
      if (selectedDefinition?.kind === 'choice' && (key.upArrow || key.downArrow || input === ' ')) {
        const options = selectedDefinition.options ?? [];
        const currentIndex = Math.max(0, options.findIndex(option => option.value === values[selectedDefinition.id]));
        const offset = key.upArrow ? -1 : 1;
        const option = options[(currentIndex + offset + options.length) % options.length];
        if (option) {
          updateValue(selectedDefinition.id, option.value);
        }
        return;
      }
      if (key.upArrow || key.downArrow) {
        selectAdjacent(key.upArrow ? -1 : 1);
        return;
      }
      if (key.return) {
        if (selectedDefinition?.kind === 'file' && isBrowseOnly(selectedDefinition)) {
          setBrowserId(selectedDefinition.id);
        } else {
          beginReview();
        }
        return;
      }
      // A choice field only responds to arrows/space (handled above). Every other
      // selectable kind (file, text, integer) delegates its own caret, backspace, and
      // paste handling to @inkjs/ui's TextInput, mounted below whenever that field is
      // selected — nothing else to do here.
    },
    {isActive: inputActive},
  );

  if (browserId) {
    const currentValue = values[browserId] ?? '';
    return (
      <PathBrowser
        initialDirectory={isAbsolute(currentValue) ? dirname(currentValue) : currentDirectory}
        onSelect={path => {
          updateValue(browserId, path);
          setBrowserId(undefined);
        }}
        onCancel={() => setBrowserId(undefined)}
        inputActive={inputActive}
      />
    );
  }

  if (screen.state === 'pre-review-choices') {
    const choices = screen.prepared.preReviewChoices ?? [];
    return (
      <Box flexDirection="column">
        <Text bold>NCBI cache entries found</Text>
        <Text>Choose whether to verify and reuse each cache entry or download it again.</Text>
        {choices.map((choice, index) => (
          <Box key={choice.id} marginTop={1} flexDirection="column">
            <Text color={index === screen.selectedIndex ? 'cyan' : undefined}>
              {index === screen.selectedIndex ? '›' : ' '} {sanitizeTerminalText(choice.label)}
            </Text>
            {choice.options.map(option => (
              <Text key={option.value} color={screen.values[choice.id] === option.value ? undefined : mutedColor}>
                {'    '}({screen.values[choice.id] === option.value ? '●' : ' '}){' '}
                {sanitizeTerminalText(option.label)}
              </Text>
            ))}
          </Box>
        ))}
        <Box marginTop={1}>
          <Text color={mutedColor}>Tab/↑/↓ — Entry · Space — Select · Enter — Review · Esc — Back</Text>
        </Box>
      </Box>
    );
  }

  if (screen.state === 'review' || screen.state === 'saving') {
    return (
      <Box flexDirection="column">
        <Text bold>Confirm {sanitizeTerminalText(title.toLowerCase())}</Text>
        {sections.map(section => (
          <Box key={section} marginTop={1} flexDirection="column">
            <Text bold>{sanitizeTerminalText(section)}</Text>
            {visibleDefinitions
              .filter(definition => definition.section === section)
              .map(definition => (
                <Text key={definition.id}>
                  {sanitizeTerminalText(definition.label)}:{' '}
                  {sanitizeTerminalText(
                    screen.prepared.resolvedValues[definition.id] ??
                      displayValue(definition, values[definition.id] ?? ''),
                  )}
                </Text>
              ))}
          </Box>
        ))}
        {screen.prepared.effectiveOptions.length > 0 ? (
          <Box marginTop={1} flexDirection="column">
            <Text bold>Effective options</Text>
            {screen.prepared.effectiveOptions.map(option => (
              <Text key={option.label}>{option.label}: {sanitizeTerminalText(option.value)}</Text>
            ))}
          </Box>
        ) : null}
        <Box marginTop={1} flexDirection="column">
          <Text bold>Output</Text>
          <Text>{sanitizeTerminalText(screen.prepared.outputDirectory)}</Text>
        </Box>
        <Box marginTop={1}>
          <Text color={mutedColor}>{screen.state === 'saving' ? 'Saving configuration…' : 'Enter — Save · Esc — Back'}</Text>
        </Box>
      </Box>
    );
  }

  if (screen.state === 'execution' && prepareSnakemakeRun && executeSnakemakeRun) {
    const {payload, configurationPath, outputDirectory} = screen;
    return (
      <WorkflowExecutionScreen
        configurationPath={configurationPath}
        prepareRun={mode => prepareSnakemakeRun(mode, payload, configurationPath)}
        executeRun={executeSnakemakeRun}
        onBack={onBack}
        inputActive={inputActive}
        stages={stages}
        resultHandoff={resultManifest ? {
          runDirectory: outputDirectory,
          manifest: resultManifest,
        } : undefined}
      />
    );
  }

  if (screen.state === 'saved') {
    return (
      <Box flexDirection="column">
        <Text bold>Configuration saved</Text>
        <Text>{sanitizeTerminalText(screen.configurationPath)}</Text>
        <Alert variant="warning">Execution is not configured for this workflow.</Alert>
        <Text color={mutedColor}>Esc — Back to workflow</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text bold underline>Configure workflow "{sanitizeTerminalText(title)}"</Text>
      {previousRuns.length > 0 ? (
        <Text color={mutedColor}>
          {previousRunIndex === undefined
            ? `${previousRuns.length} previous run${previousRuns.length === 1 ? '' : 's'} found — PageDown (or fn + ↓) to prefill`
            : `Prefilled from ${sanitizeTerminalText(previousRuns[previousRunIndex]?.label ?? '')} (${previousRunIndex + 1}/${previousRuns.length})`}
        </Text>
      ) : null}
      {isFormWindowed && formScrollTop > 0 ? <Text color={mutedColor}>↑ more above</Text> : null}
      {visibleFormRows.map(row => {
        if (row.kind === 'section') {
          return (
            <Box key={row.key} marginTop={1}>
              <Text bold underline>{sanitizeTerminalText(row.section)}</Text>
            </Box>
          );
        }
        const {definition} = row;
        const value = values[definition.id] ?? '';
        const selected = definition.id === selectedId;
        if (definition.kind === 'choice') {
          return (
            <Box key={row.key} flexDirection="column">
              <Text color={selected ? 'cyan' : undefined}>
                {selected ? '›' : ' '} {sanitizeTerminalText(definition.label)}
                {definition.required ? '*' : ''}:
              </Text>
              {definition.options?.map(option => (
                <Text key={option.value} color={value === option.value ? undefined : mutedColor}>
                  {'    '}({value === option.value ? '●' : ' '}){' '}
                  {sanitizeTerminalText(option.label)}
                </Text>
              ))}
            </Box>
          );
        } else if (definition.kind === 'file') {
          const browseOnly = isBrowseOnly(definition);
          // Entering/pasting the path and opening the file chooser are two independent
          // interactions, never both on the same field: a typable field is a plain @inkjs/ui
          // TextInput (caret, backspace, paste — all its own), while a browse-only field (see
          // 'browse_only_when') has no typable value at all — only Enter, handled in useInput
          // above, opens the separate PathBrowser overlay that reports its pick through onChange.
          return (
            <TextField
              key={`${row.key}:${runApplyGeneration}`}
              label={definition.label}
              required={definition.required}
              selected={selected}
              editable={!browseOnly}
              inputActive={inputActive}
              defaultValue={value}
              displayValue={
                browseOnly
                  ? value.length === 0
                    ? 'Press Enter to browse'
                    : selected
                      ? `${value} (Enter to change)`
                      : value
                  : displayValue(definition, value)
              }
              placeholder={definition.placeholder ?? 'Type or paste a path'}
              onChange={onChangeFor(definition.id)}
            />
          );
        }
        return (
          <TextField
            key={`${row.key}:${runApplyGeneration}`}
            label={definition.label}
            required={definition.required}
            selected={selected}
            inputActive={inputActive}
            defaultValue={value}
            displayValue={displayValue(definition, value)}
            placeholder={definition.placeholder}
            preview={definition.preview?.replaceAll('{value}', value || '<value>')}
            onChange={onChangeFor(definition.id)}
          />
        );
      })}
      {isFormWindowed && formScrollTop + availableFormLines < totalFormLines ? (
        <Text color={mutedColor}>↓ more below</Text>
      ) : null}
      {screen.state === 'invalid' ? (
        <Box marginTop={1} flexDirection="column">
          <Alert variant={'error'}><Text color={'red'}>Fix these fields before continuing:</Text>
            {screen.messages.map(message => {
              return <Text key={message}><Newline />• {sanitizeTerminalText(message)}</Text>
            })
            }

          </Alert>
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text color={mutedColor} wrap="wrap">
          Tab — Next field · ↑/↓ — Field or choice · Space — Select choice · * — Required field ·
          Type — Edit · Backspace — Delete · Ctrl+U — Clear ·
          {previousRuns.length > 0
            ? ' PageUp/PageDown (or fn + ↑/↓) — Browse previous runs ·'
            : ''}{' '}
          {enterOpensFileChooser ? 'Enter — Open file chooser' : 'Enter — Review'} · Esc — Back
        </Text>
      </Box>
    </Box>
  );
}

export default WorkflowConfigurationScreen
