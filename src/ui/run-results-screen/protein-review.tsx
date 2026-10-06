import React, {useEffect, useState} from 'react';
import {Alert} from '@inkjs/ui';
import {Box, Text} from 'ink';
import type {AnnotationTransferResult} from '../../workflows/annotation-transfer/results.js';
import {
  categoryLabels,
  filteredGenes,
  geneFacts,
  geneLocus,
  identityText,
  proteinCategories,
  proteinFilters,
  readReviewGenes,
  reasonLabels,
  type ProteinFilter,
  type ReviewGene,
} from '../../workflows/annotation-transfer/proteins.js';
import {ParameterList, parameterLabelWidth} from '../components/parameter-list.js';
import {Table} from '../components/table.js';
import {sanitizeTerminalText} from '../sanitize.js';
import {mutedColor} from '../theme.js';
import {selectableTableHeaderLines} from './reference-consensus-results.js';

const filterLabels: Record<ProteinFilter, string> = {all: 'all listed genes', ...reasonLabels};

/** The genes listed for review as the Proteins tab loads them, on demand. */
export type ProteinsState =
  | {state: 'loading'}
  | {state: 'ready'; genes: ReviewGene[]}
  | {state: 'failed'; message: string};

type Key = {upArrow: boolean; downArrow: boolean; return: boolean; escape: boolean};

const columns = ['Reference gene', 'Target position', 'Category', 'Identity', 'Reasons'];

/**
 * Lines of the Proteins tab above its gene table: the summary table (header, rule, three rows), a
 * margin, the counts, and the filter line and the table, each with its margin.
 */
const headerLines = 10;

/** The rated genes in three disjoint groups that add up to all of them: group, genes, share, meaning. */
function summaryTableRows(proteins: NonNullable<AnnotationTransferResult['proteins']>): string[][] {
  const share = (count: number): string => proteins.ratedGenes === 0 ? '—' : `${(count / proteins.ratedGenes * 100).toFixed(1)}%`;
  const {exactMatch, nearMatch, needsReview} = proteins.genesByMatch;
  return [
    ['Exact match', exactMatch.toLocaleString('en-US'), share(exactMatch), 'protein identical to the reference'],
    [`Near match (≥ ${String(proteins.minimumProteinIdentityPercent)}%)`, nearMatch.toLocaleString('en-US'), share(nearMatch), 'changed protein, not listed for review'],
    ['Needs review', needsReview.toLocaleString('en-US'), share(needsReview), 'listed below with their reasons'],
  ];
}

/**
 * The Proteins tab of an annotation-transfer result: the summary step's rating and the genes it
 * listed for review, with their detail. The result screen routes keys here first while the tab
 * is shown, and shows `element` as the tab's content.
 */
export function useProteinReview({result, active, readGenes = readReviewGenes}: {
  result?: AnnotationTransferResult;
  /** Whether the Proteins tab is shown. */
  active: boolean;
  readGenes?: typeof readReviewGenes;
}) {
  const [genes, setGenes] = useState<ProteinsState>();
  const [filter, setFilter] = useState<ProteinFilter>('all');
  const [index, setIndex] = useState(0);
  const [detail, setDetail] = useState(false);
  const table = result?.reports.feature_transfer?.available ? result.reports.feature_transfer.absolutePath : undefined;

  // The table is read once, when the result is shown, so the genome view's Proteins choice has the list too.
  useEffect(() => {
    if (!table || genes?.state === 'ready' || genes?.state === 'failed') {
      return;
    }
    const controller = new AbortController();
    setGenes({state: 'loading'});
    readGenes({path: table, signal: controller.signal}).then(
      value => setGenes({state: 'ready', genes: value}),
      error => {
        if (!controller.signal.aborted) {
          setGenes({state: 'failed', message: error instanceof Error ? error.message : String(error)});
        }
      },
    );
    return () => {
      controller.abort();
      setGenes(current => current?.state === 'loading' ? undefined : current);
    };
  }, [table]);

  const listed = genes?.state === 'ready' ? filteredGenes(genes.genes, filter) : [];
  const selected = listed[Math.min(index, listed.length - 1)];

  /** Selects a listed gene by its reference ID, as the genome view's previous and next do. */
  const select = (referenceId: string): void => {
    const found = listed.findIndex(gene => gene.referenceId === referenceId);
    if (found >= 0) {
      setIndex(found);
    }
  };

  /** Handles a key; false when it is the screen's to handle. */
  const handleInput = (input: string, key: Key): boolean => {
    if (!active) {
      return false;
    }
    if (detail) {
      if (key.escape) {
        setDetail(false);
        return true;
      }
      return key.upArrow || key.downArrow || key.return;
    }
    if (input === 'f' && genes?.state === 'ready') {
      setFilter(proteinFilters[(proteinFilters.indexOf(filter) + 1) % proteinFilters.length]!);
      setIndex(0);
      return true;
    }
    if (listed.length > 0 && (key.upArrow || key.downArrow)) {
      setIndex(Math.max(0, Math.min(listed.length - 1, index + (key.upArrow ? -1 : 1))));
      return true;
    }
    if (listed.length > 0 && key.return) {
      setIndex(Math.min(index, listed.length - 1));
      setDetail(true);
      return true;
    }
    return false;
  };

  const element = (visibleRows: number): React.JSX.Element => {
    if (!result) {
      return <></>;
    }
    const proteins = result.proteins;
    if (!table) {
      return <Alert variant="warning">The per-feature transfer table is missing, so the genes to review cannot be listed.</Alert>;
    }
    if (!genes || genes.state === 'loading') {
      return <Text>Reading the genes to review…</Text>;
    }
    if (genes.state === 'failed') {
      return <Alert variant="warning">The genes to review cannot be read: {sanitizeTerminalText(genes.message)}</Alert>;
    }
    if (detail && selected) {
      const rows = geneFacts(selected);
      return (
        <Box marginTop={1} flexDirection="column">
          <Text bold>Gene</Text>
          <ParameterList rows={rows.map(row => ({...row, value: sanitizeTerminalText(row.value)}))} inputActive={false} labelWidth={parameterLabelWidth(rows)} />
        </Box>
      );
    }
    const categories = proteinCategories.map(category => `${categoryLabels[category]} ${String(proteins.genesByCategory[category])}`);
    const counts = proteinFilters.map(item => `${filterLabels[item]} ${String(item === 'all' ? genes.genes.length : proteins.genesByReviewReason[item])}`);
    const rowsShown = Math.max(1, visibleRows - headerLines - selectableTableHeaderLines - 1);
    const first = Math.max(0, Math.min(index - Math.floor(rowsShown / 2), listed.length - rowsShown));
    const window = listed.slice(first, first + rowsShown);
    return (
      <Box flexDirection="column">
        <Table header={['Summary', 'Genes', 'Share', 'Meaning']} rows={summaryTableRows(proteins)} align={['left', 'right', 'right']} />
        <Box marginTop={1} />
        <Text wrap="truncate">
          {String(proteins.ratedGenes)} coding genes rated · minimum protein identity {String(proteins.minimumProteinIdentityPercent)}%
          <Text color={mutedColor}> ({categories.join(' · ')})</Text>
        </Text>
        <Box marginTop={1}>
          <Text wrap="truncate">
            Showing <Text bold>{filterLabels[filter]}</Text>
            <Text color={mutedColor}> ({counts.join(' · ')})</Text>
          </Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          {listed.length === 0 ? (
            <Text color={mutedColor}>No gene is listed with this reason.</Text>
          ) : (
            <>
              <Table
                header={columns}
                rows={window.map(gene => [
                  sanitizeTerminalText(gene.referenceId),
                  sanitizeTerminalText(geneLocus(gene)),
                  categoryLabels[gene.category],
                  identityText(gene),
                  gene.reasons.map(reason => reasonLabels[reason]).join(', '),
                ])}
                selectedRow={Math.min(index, listed.length - 1) - first}
                align={['left', 'left', 'left', 'right']}
              />
              {listed.length > window.length ? (
                <Text color={mutedColor}>{'  '}genes {String(first + 1)}–{String(first + window.length)} of {String(listed.length)}</Text>
              ) : null}
            </>
          )}
        </Box>
      </Box>
    );
  };

  const ready = active && genes?.state === 'ready';
  const shortcuts = [
    ready && !detail && listed.length > 0 ? '↑/↓ — Select' : '',
    ready && !detail ? 'f — Filter' : '',
    ready && !detail && listed.length > 0 ? 'Enter — Gene details' : '',
  ];
  return {
    handleInput,
    element,
    /** The listed genes in review order, and the selected one, which the genome view follows. */
    listed,
    selected,
    select,
    filter,
    /** Whether the tab shows a list the arrow keys move through, rather than scrolled content. */
    listing: ready && !detail,
    shortcuts,
    back: active && detail ? 'Back to genes' : undefined,
    state: genes,
  };
}

