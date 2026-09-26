import React, {useCallback, useMemo, useState} from 'react';
import {Box, Text, useInput, useWindowSize} from 'ink';
import {Alert} from '@inkjs/ui';
import type {WorkflowManifest} from '../../workflows/manifest.js';
import type {WorkflowParameterDefinition} from '../../workflows/parameter-definitions.js';
import {sanitizeTerminalText} from '../sanitize.js';
import {AccessionField} from '../components/accession-field.js';
import {
  IsolatesField,
  readCatalogedIsolates,
  useIsolateChoices,
  type IsolateCatalogReader,
} from '../components/isolates-field.js';
import {PathField} from '../components/path-field.js';
import {TextField} from '../components/text-field.js';
import {
  WorkflowExecutionScreen,
  type WorkflowProgressStage,
  type WorkflowRun,
  type WorkflowRunExecutor,
  type WorkflowRunMode,
  type RunFollowUp,
} from './workflow-execution.js';
import {mutedColor} from '../theme.js';
import {useHomeSuspension} from '../home-navigation.js';
import {EditPage, Page} from '../components/page.js';
import {ParameterList, parameterLabelWidth} from '../components/parameter-list.js';
import {NcbiCacheDecisionPage, type NcbiCacheEntry, type NcbiCacheModes} from './ncbi-cache-decision.js';

// Chrome this screen renders around the windowed field list: the page title and description,
// margins, the continue button, and the shortcut line. Space consumed by an outer wrapper (such as
// the welcome screen's header/footer) is not visible here and is not reserved.
const reservedChromeLines = 12;
// The continue button's row ID; parameter IDs cannot contain '#', so it never collides with one.
const continueButtonId = '#continue';
const minimumVisibleLines = 5;
const scrollLookbackLines = 3;

type FormRow =
  | {kind: 'section'; key: string; section: string; lines: number}
  | {kind: 'field'; key: string; definition: WorkflowParameterDefinition; lines: number};

function definitionLineCount(definition: WorkflowParameterDefinition): number {
  if (definition.kind === 'choice') {
    return 1 + (definition.options?.length ?? 0);
  }
  // An accession or isolates field always shows its validity or catalog line.
  return 1 + (definition.preview || definition.kind === 'accession' || definition.kind === 'isolates' ? 1 : 0);
}

export type WorkflowFormValues = Record<string, string>;

export type PreviousWorkflowRun = {label: string; values: WorkflowFormValues};

/** A review section beyond the form's own fields, such as the resolved inputs in detail. */
export type ReviewSection = {id: string; title: string; rows: readonly {label: string; value: string}[]};

export type PreparedWorkflowRun<T> = {
  payload: T;
  resolvedValues: WorkflowFormValues;
  effectiveOptions: readonly {label: string; value: string}[];
  outputDirectory: string;
  /** Shown after the form's fields, before the effective options. */
  details?: readonly ReviewSection[];
  /** Problems that do not stop the run but that the researcher should see first. */
  warnings?: readonly string[];
  /**
   * Cached NCBI inputs the researcher decides to reuse or download again before the review, and
   * how those decisions are applied; kept together so a decision can never be dropped.
   */
  ncbiCache?: {
    entries: readonly NcbiCacheEntry[];
    apply: (modes: NcbiCacheModes) => PreparedWorkflowRun<T>;
  };
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
  | {state: 'ncbi-cache-decision'; ncbiCache: NonNullable<PreparedWorkflowRun<T>['ncbiCache']>}
  // `scroll` is the first review row shown when the review is taller than the terminal.
  | {state: 'review'; prepared: PreparedWorkflowRun<T>; scroll: number}
  | {state: 'saving'; prepared: PreparedWorkflowRun<T>; scroll: number}
  | {state: 'execution'; payload: T; configurationPath: string; outputDirectory: string}
  | {state: 'saved'; configurationPath: string};

// Rows the review page uses around its windowed content: the title and description, margins,
// the save button, the scroll markers, and the shortcut line.
const reservedReviewChromeLines = 10;

type ReviewItem =
  | {kind: 'heading'; key: string; text: string; color?: string}
  | {kind: 'row'; key: string; label: string; value: string}
  | {kind: 'text'; key: string; text: string; color?: string};

/**
 * Everything the review shows, flattened into rows so a review taller than the terminal can be
 * scrolled: warnings first, so they are seen without scrolling, then the form's fields, the
 * workflow's own details, the effective options, and the run directory.
 */
function reviewItems<T>(
  prepared: PreparedWorkflowRun<T>,
  sections: readonly string[],
  visibleDefinitions: readonly WorkflowParameterDefinition[],
  values: WorkflowFormValues,
): {items: ReviewItem[]; labelWidth: number} {
  const items: ReviewItem[] = [];
  const warnings = prepared.warnings ?? [];
  if (warnings.length > 0) {
    items.push({kind: 'heading', key: 'warnings', text: 'Warnings', color: 'yellow'});
    warnings.forEach((warning, index) =>
      items.push({kind: 'text', key: `warning:${String(index)}`, text: `⚠ ${warning}`, color: 'yellow'}));
  }
  for (const section of sections) {
    items.push({kind: 'heading', key: `section:${section}`, text: section});
    for (const definition of visibleDefinitions.filter(candidate => candidate.section === section)) {
      items.push({
        kind: 'row',
        key: `field:${definition.id}`,
        label: definition.label,
        value: prepared.resolvedValues[definition.id] ?? displayValue(definition, values[definition.id] ?? ''),
      });
    }
  }
  for (const detail of prepared.details ?? []) {
    items.push({kind: 'heading', key: `detail:${detail.id}`, text: detail.title});
    detail.rows.forEach((row, index) =>
      items.push({kind: 'row', key: `detail:${detail.id}:${String(index)}`, label: row.label, value: row.value}));
  }
  if (prepared.effectiveOptions.length > 0) {
    items.push({kind: 'heading', key: 'effective-options', text: 'Effective options'});
    prepared.effectiveOptions.forEach((option, index) =>
      items.push({kind: 'row', key: `option:${String(index)}`, label: option.label, value: option.value}));
  }
  items.push({kind: 'heading', key: 'output', text: 'Output'});
  items.push({kind: 'text', key: 'output-directory', text: prepared.outputDirectory});
  const rows = items.filter((item): item is Extract<ReviewItem, {kind: 'row'}> => item.kind === 'row');
  return {items, labelWidth: rows.length > 0 ? parameterLabelWidth(rows) : 0};
}

function reviewItemLines(item: ReviewItem, first: boolean, valueWidth: number, width: number): number {
  switch (item.kind) {
    case 'heading':
      return first ? 1 : 2;
    case 'row':
      return Math.max(1, Math.ceil(item.value.length / valueWidth));
    case 'text':
      return Math.max(1, Math.ceil(item.text.length / width));
  }
}

/** Which review rows fit from `scroll` on, and how far the review can scroll at all. */
function windowReviewItems(
  items: readonly ReviewItem[],
  scroll: number,
  availableLines: number,
  valueWidth: number,
  width: number,
): {start: number; end: number; windowed: boolean; visibleRows: number; maximumScroll: number} {
  const linesFrom = (start: number): number => items
    .slice(start)
    .reduce((total, item, index) => total + reviewItemLines(item, index === 0, valueWidth, width), 0);
  if (linesFrom(0) <= availableLines) {
    return {start: 0, end: items.length, windowed: false, visibleRows: items.length, maximumScroll: 0};
  }
  let maximumScroll = items.length - 1;
  while (maximumScroll > 0 && linesFrom(maximumScroll - 1) <= availableLines) {
    maximumScroll -= 1;
  }
  const start = Math.min(scroll, maximumScroll);
  let end = start;
  let used = 0;
  while (end < items.length) {
    const lines = reviewItemLines(items[end] as ReviewItem, end === start, valueWidth, width);
    if (end > start && used + lines > availableLines) {
      break;
    }
    used += lines;
    end += 1;
  }
  return {start, end, windowed: true, visibleRows: end - start, maximumScroll};
}

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
  onRunSucceeded,
  executionUnavailableReason,
  loadIsolates = readCatalogedIsolates,
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
  /** Follow-up bookkeeping after a successful execution, or nothing when none is needed. */
  onRunSucceeded?: (payload: T) => RunFollowUp | undefined;
  /** Why only a dry run can be started, while the workflow's execution is not implemented. */
  executionUnavailableReason?: string;
  loadIsolates?: IsolateCatalogReader;
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
  const [selectedId, setSelectedId] = useState<string>(editableDefinitions[0]?.id ?? continueButtonId);
  // The field whose file browser or accession picker is open over the form.
  const [browserId, setBrowserId] = useState<string>();
  const [screen, setScreen] = useState<ScreenState<T>>({state: 'editing'});
  // Opening the isolate picker reloads the catalog, so it lists isolates added meanwhile.
  const [isolatePickerOpenings, setIsolatePickerOpenings] = useState(0);
  const usesIsolates = useMemo(
    () => parameterDefinitions.some(definition => definition.kind === 'isolates'),
    [parameterDefinitions],
  );
  const isolateChoices = useIsolateChoices(loadIsolates, usesIsolates, isolatePickerOpenings);
  const [previousRunIndex, setPreviousRunIndex] = useState<number>();
  // A file field's TextInput is uncontrolled (it is seeded once from `defaultValue` at mount and
  // never re-reads that prop), so stepping through run history — which can overwrite
  // the currently selected file field's value without unmounting it — has to force a remount to
  // show the new value. Bumping this generation on every step and folding it into that field's
  // `key` does exactly that, without disturbing the field while the user is simply typing.
  const [runApplyGeneration, setRunApplyGeneration] = useState(0);

  const isVisible = (definition: WorkflowParameterDefinition): boolean =>
    !definition.hidden && (!definition.visible_when || matchesCondition(definition.visible_when, values));
  const visibleEditableDefinitions = editableDefinitions.filter(isVisible);
  const visibleDefinitions = parameterDefinitions.filter(isVisible);
  const sections = [...new Set(visibleDefinitions.map(definition => definition.section))];
  const selectedDefinition = visibleEditableDefinitions.find(definition => definition.id === selectedId);
  const continueSelected = selectedId === continueButtonId;
  // A file path or accession is typed or pasted, and Enter on it opens the file browser or the
  // accession picker.
  const enterOpensFileChooser = selectedDefinition?.kind === 'file';
  const enterOpensAccessionPicker = selectedDefinition?.kind === 'accession';
  const enterOpensIsolatePicker = selectedDefinition?.kind === 'isolates';
  const showsForm = screen.state === 'editing' || screen.state === 'validating' || screen.state === 'invalid';
  const typing = showsForm && !browserId && selectedDefinition !== undefined &&
    selectedDefinition.kind !== 'choice' && selectedDefinition.kind !== 'isolates';
  useHomeSuspension(screen.state === 'saving' ? 'busy' : typing ? 'typing' : undefined);

  const {rows: terminalRows, columns: terminalColumns} = useWindowSize();
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
  const lastScrollTop = Math.max(0, totalFormLines - availableFormLines);
  // Show a few rows above the selected one, but never cut the selected row off at the bottom.
  const formScrollTop = continueSelected
    ? lastScrollTop
    : selectedFormRow
      ? Math.max(
          0,
          Math.min(
            selectedFormRow.start,
            Math.max(
              Math.min(selectedFormRow.start - scrollLookbackLines, lastScrollTop),
              selectedFormRow.start + selectedFormRow.lines - availableFormLines,
            ),
          ),
        )
      : 0;
  // Only rows that fit completely are drawn, so a tall choice never pushes the page past the
  // terminal; the selected row always is.
  const visibleFormRows = isFormWindowed
    ? formRowsWithOffsets.filter(row =>
        row === selectedFormRow ||
        (row.start >= formScrollTop && row.start + row.lines <= formScrollTop + availableFormLines))
    : formRowsWithOffsets;

  const updateValue = useCallback((id: string, value: string): void => {
    setValues(current => ({...current, [id]: value}));
  }, []);

  const selectField = (id: string): void => {
    setSelectedId(id);
  };

  // Every visible field, then the continue button.
  const selectableIds = [...visibleEditableDefinitions.map(definition => definition.id), continueButtonId];
  const selectAdjacent = (offset: -1 | 1): void => {
    const currentIndex = Math.max(0, selectableIds.indexOf(selectedId ?? ''));
    selectField(selectableIds[(currentIndex + offset + selectableIds.length) % selectableIds.length] ?? continueButtonId);
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
        if (prepared.ncbiCache && prepared.ncbiCache.entries.length > 0) {
          setScreen({state: 'ncbi-cache-decision', ncbiCache: prepared.ncbiCache});
        } else {
          setScreen({state: 'review', prepared, scroll: 0});
        }
      },
      error => setScreen({state: 'invalid', messages: messageLines(error)}),
    );
  };

  const review = screen.state === 'review' || screen.state === 'saving'
    ? reviewItems(screen.prepared, sections, visibleDefinitions, values)
    : {items: [], labelWidth: 0};
  const reviewWindow = windowReviewItems(
    review.items,
    screen.state === 'review' || screen.state === 'saving' ? screen.scroll : 0,
    Math.max(minimumVisibleLines, terminalRows - reservedReviewChromeLines),
    Math.max(1, terminalColumns - review.labelWidth),
    Math.max(1, terminalColumns),
  );

  useInput(
    (input, key) => {
      if (browserId) {
        return;
      }
      if (screen.state === 'ncbi-cache-decision') {
        // The cache decision page owns its own keys, including the Esc that returns here.
        return;
      }
      if (screen.state === 'review') {
        if (key.escape) {
          setScreen({state: 'editing'});
        } else if (key.upArrow || key.downArrow || key.pageUp || key.pageDown) {
          const step = key.pageUp || key.pageDown ? Math.max(1, reviewWindow.visibleRows - 1) : 1;
          const offset = key.upArrow || key.pageUp ? -step : step;
          setScreen({
            ...screen,
            scroll: Math.min(reviewWindow.maximumScroll, Math.max(0, screen.scroll + offset)),
          });
        } else if (key.return) {
          setScreen({state: 'saving', prepared: screen.prepared, scroll: screen.scroll});
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
      // Enter acts only on the continue button (and opens the browser on a path field, which the
      // field handles itself); Tab and the arrows move between fields.
      if (key.return && continueSelected) {
        beginReview();
        return;
      }
      // A choice field only responds to arrows/space (handled above), and an isolates field opens
      // its picker on Enter itself. Every other selectable kind (file, accession, text, integer) delegates its own caret, backspace,
      // and paste handling to TextInput, mounted below whenever that field is
      // selected — nothing else to do here.
    },
    {isActive: inputActive},
  );

  const browsedDefinition = browserId
    ? parameterDefinitions.find(definition => definition.id === browserId)
    : undefined;
  if (browserId && browsedDefinition?.kind === 'isolates') {
    return (
      <IsolatesField
        label={browsedDefinition.label}
        selected
        inputActive={inputActive}
        value={values[browserId] ?? ''}
        onChange={ids => updateValue(browserId, ids)}
        choosing
        onChoosingChange={choose => {
          if (!choose) {
            setBrowserId(undefined);
          }
        }}
        choices={isolateChoices}
      />
    );
  }
  if (browserId && browsedDefinition?.kind === 'accession') {
    return (
      <AccessionField
        label={browsedDefinition.label}
        selected
        inputActive={inputActive}
        value={values[browserId] ?? ''}
        onChange={accession => updateValue(browserId, accession)}
        choosing
        onChoosingChange={choose => {
          if (!choose) {
            setBrowserId(undefined);
          }
        }}
      />
    );
  }
  if (browserId && browsedDefinition) {
    return (
      <PathField
        label={browsedDefinition.label}
        selected
        inputActive={inputActive}
        value={values[browserId] ?? ''}
        onChange={path => updateValue(browserId, path)}
        browsing
        onBrowsingChange={browse => {
          if (!browse) {
            setBrowserId(undefined);
          }
        }}
        startDirectory={currentDirectory}
      />
    );
  }

  if (screen.state === 'ncbi-cache-decision') {
    const {ncbiCache} = screen;
    return (
      <NcbiCacheDecisionPage
        entries={ncbiCache.entries}
        inputActive={inputActive}
        onBack={() => setScreen({state: 'editing'})}
        onContinue={modes => setScreen({state: 'review', prepared: ncbiCache.apply(modes), scroll: 0})}
      />
    );
  }

  if (screen.state === 'review' || screen.state === 'saving') {
    const {items, labelWidth} = review;
    const {start, end} = reviewWindow;
    return (
      <EditPage
        title={`Review workflow "${title}"`}
        description="Check the configuration before it is saved into the run directory."
        shortcuts={[reviewWindow.windowed && '↑/↓ — Scroll', 'Enter — Save and continue']}
        back="Back to form"
        saveLabel="Save and continue"
        saveSelected
        saving={screen.state === 'saving'}
        savingLabel="Saving configuration…"
      >
        {reviewWindow.windowed && start > 0 ? <Text color={mutedColor}>↑ more above</Text> : null}
        {items.slice(start, end).map((item, index) => {
          if (item.kind === 'heading') {
            return (
              <Box key={item.key} marginTop={index === 0 ? 0 : 1}>
                <Text bold color={item.color}>{sanitizeTerminalText(item.text)}</Text>
              </Box>
            );
          }
          if (item.kind === 'text') {
            return <Text key={item.key} color={item.color} wrap="wrap">{sanitizeTerminalText(item.text)}</Text>;
          }
          return (
            <ParameterList
              key={item.key}
              rows={[{id: item.key, label: item.label, value: item.value}]}
              labelWidth={labelWidth}
              inputActive={false}
            />
          );
        })}
        {reviewWindow.windowed && end < items.length ? <Text color={mutedColor}>↓ more below</Text> : null}
      </EditPage>
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
        onSucceeded={onRunSucceeded ? () => onRunSucceeded(payload) : undefined}
        {...(executionUnavailableReason ? {executionUnavailableReason} : {})}
        resultHandoff={resultManifest ? {
          runDirectory: outputDirectory,
          manifest: resultManifest,
        } : undefined}
      />
    );
  }

  if (screen.state === 'saved') {
    return (
      <Page title="Configuration saved" back="Back to workflow">
        <Text>{sanitizeTerminalText(screen.configurationPath)}</Text>
        <Alert variant="warning">Execution is not configured for this workflow.</Alert>
      </Page>
    );
  }

  return (
    <EditPage
      title={`Configure workflow "${title}"`}
      {...(previousRuns.length > 0 ? {
        description: previousRunIndex === undefined
          ? `${previousRuns.length} previous run${previousRuns.length === 1 ? '' : 's'} found — PageDown (or fn + ↓) to prefill`
          : `Prefilled from ${sanitizeTerminalText(previousRuns[previousRunIndex]?.label ?? '')} (${previousRunIndex + 1}/${previousRuns.length})`,
      } : {})}
      shortcuts={[
        'Tab — Next field',
        selectedDefinition?.kind === 'choice' ? 'Space/↑/↓ — Choose' : '↑/↓ — Field',
        '* — Required',
        previousRuns.length > 0 && 'PageUp/PageDown (or fn + ↑/↓) — Previous runs',
        continueSelected
          ? 'Enter — Continue to review'
          : enterOpensFileChooser
            ? 'Enter — Browse for file'
            : enterOpensAccessionPicker
              ? 'Enter — Choose from catalog'
              : enterOpensIsolatePicker && 'Enter — Choose isolates',
      ]}
      saveLabel="Continue to review"
      saveSelected={continueSelected}
      saving={screen.state === 'validating'}
      savingLabel="Checking configuration…"
      problems={screen.state === 'invalid' ? screen.messages : []}
      problemsTitle="Fix these fields before continuing:"
    >
      {isFormWindowed && formScrollTop > 0 ? <Text color={mutedColor}>↑ more above</Text> : null}
      {visibleFormRows.map((row, rowIndex) => {
        if (row.kind === 'section') {
          return (
            <Box key={row.key} marginTop={rowIndex === 0 ? 0 : 1}>
              <Text bold>{sanitizeTerminalText(row.section)}</Text>
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
          return (
            <PathField
              key={`${row.key}:${runApplyGeneration}`}
              label={definition.label}
              required={definition.required}
              selected={selected}
              // While the configuration is checked, Enter must not open the browser over it.
              inputActive={inputActive && screen.state !== 'validating'}
              value={value}
              onChange={value => updateValue(definition.id, value)}
              browsing={false}
              onBrowsingChange={browse => setBrowserId(browse ? definition.id : undefined)}
              startDirectory={currentDirectory}
              {...(definition.placeholder ? {placeholder: definition.placeholder} : {})}
            />
          );
        } else if (definition.kind === 'isolates') {
          return (
            <IsolatesField
              key={`${row.key}:${runApplyGeneration}`}
              label={definition.label}
              required={definition.required}
              selected={selected}
              // While the configuration is checked, Enter must not open the picker over it.
              inputActive={inputActive && screen.state !== 'validating'}
              value={value}
              onChange={value => updateValue(definition.id, value)}
              choosing={false}
              onChoosingChange={choose => {
                if (choose) {
                  setIsolatePickerOpenings(openings => openings + 1);
                }
                setBrowserId(choose ? definition.id : undefined);
              }}
              choices={isolateChoices}
            />
          );
        } else if (definition.kind === 'accession') {
          return (
            <AccessionField
              key={`${row.key}:${runApplyGeneration}`}
              label={definition.label}
              required={definition.required}
              selected={selected}
              // While the configuration is checked, Enter must not open the picker over it.
              inputActive={inputActive && screen.state !== 'validating'}
              value={value}
              onChange={value => updateValue(definition.id, value)}
              choosing={false}
              onChoosingChange={choose => setBrowserId(choose ? definition.id : undefined)}
              {...(definition.placeholder ? {placeholder: definition.placeholder} : {})}
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
            onChange={value => updateValue(definition.id, value)}
          />
        );
      })}
      {isFormWindowed && formScrollTop + availableFormLines < totalFormLines ? (
        <Text color={mutedColor}>↓ more below</Text>
      ) : null}
    </EditPage>
  );
}

export default WorkflowConfigurationScreen
