import React, {useEffect, useRef, useState} from 'react';
import {ActionIcon, Button, Text} from '@mantine/core';
import type {ReadColorRow} from './alignment-details.js';

export type FeatureDetails = {trackId?: string; title: string; kind?: string; rows: (ReadColorRow & {featureBlock?: number})[]};
const annotationLabels: Record<string, string> = {
  type: 'GFF feature type', source: 'Annotation source', score: 'Recorded feature score',
  phase: 'CDS phase', location: 'Genomic location', id: 'Feature ID', parent: 'Parent feature ID',
  gbkey: 'GenBank feature key', gene: 'Gene symbol', gene_id: 'Gene ID',
  gene_biotype: 'Gene biotype', transcript_biotype: 'Transcript biotype',
  transcript_id: 'Transcript ID', protein_id: 'Protein ID', product: 'Gene/protein product',
  dbxref: 'Database cross-references', db_xref: 'Database cross-references',
  note: 'Annotation notes', alias: 'Alternative names', gene_synonym: 'Gene synonyms',
  locus_tag: 'Locus tag', exception: 'Annotation exception', transl_table: 'Genetic code table',
};
const featureNames: Record<string, string> = {
  gene: 'Gene', mrna: 'Transcript (mRNA)', transcript: 'Transcript', exon: 'Exon',
  cds: 'Coding sequence (CDS)', five_prime_utr: '5′ untranslated region (UTR)',
  three_prime_utr: '3′ untranslated region (UTR)',
};
function fieldKey(label: string): string {
  return label.trim().replace(/:$/, '').toLowerCase();
}

function annotationSections(details: FeatureDetails): {title: string; rows: ReadColorRow[]}[] {
  const groups = new Map<number, FeatureDetails['rows']>();
  const coordinates: ReadColorRow[] = [];
  for (const row of details.rows) {
    if (fieldKey(row.label) === 'clicked position') {
      coordinates.push(row);
      continue;
    }
    const block = row.featureBlock ?? 0;
    const rows = groups.get(block) ?? [];
    rows.push(row);
    groups.set(block, rows);
  }
  const result = coordinates.length ? [{title: 'Clicked position', rows: coordinates}] : [];
  for (const [index, rows] of [...groups.values()].entries()) {
    const type = rows.find(row => fieldKey(row.label) === 'type')?.value;
    const name = rows.find(row => fieldKey(row.label) === 'name')?.value;
    const heading = type ? featureNames[type.toLowerCase()] ?? `Feature (${type})` : 'Annotation feature';
    result.push({
      title: `${index + 1}. ${heading}${name ? ` — ${name}` : ''}`,
      rows: rows.map(row => {
        const label = annotationLabels[fieldKey(row.label)];
        return {...row, label: label ? `${label} [${row.label.replace(/:$/, '')}]` : row.label};
      }),
    });
  }
  return result;
}
const fields: Record<string, [string, string?]> = {
  'read name': ['Identity and coordinates'], 'alignment start': ['Identity and coordinates'],
  'genomic location': ['Identity and coordinates'], 'clicked position': ['Identity and coordinates'], chromosome: ['Identity and coordinates'],
  chr: ['Identity and coordinates', 'Chromosome / contig'], pos: ['Identity and coordinates', 'Position'],
  loc: ['Identity and coordinates', 'Location'], id: ['Identity and coordinates'], name: ['Identity and coordinates'],
  start: ['Identity and coordinates'], end: ['Identity and coordinates'], strand: ['Identity and coordinates'],
  'read strand': ['Alignment and quality'], cigar: ['Alignment and quality', 'CIGAR — Alignment operations'],
  'mapping quality': ['Alignment and quality', 'MAPQ — Mapping quality'], secondary: ['Alignment and quality'],
  supplementary: ['Alignment and quality'], duplicate: ['Alignment and quality'], 'failed qc': ['Alignment and quality'],
  'first in pair': ['Pairing'], 'mate is mapped': ['Pairing'], 'pair orientation': ['Pairing'],
  'mate chromosome': ['Pairing'], 'mate start': ['Pairing'], 'mate strand': ['Pairing'],
  'insert size': ['Pairing', 'TLEN — Template length (bp)'],
  'read base': ['Clicked base or variant'], 'base quality': ['Clicked base or variant', 'Base quality (Phred)'],
  insertion: ['Clicked base or variant'], location: ['Identity and coordinates'],
  ref: ['Clicked base or variant', 'REF — Reference allele'], alt: ['Clicked base or variant', 'ALT — Alternate allele'],
  qual: ['Clicked base or variant', 'QUAL — Variant quality (Phred)'], filter: ['Clicked base or variant', 'FILTER — Recorded filters'],
  type: ['Clicked base or variant'], 'total count': ['Coverage', 'Read depth (reads)'],
  'whole-read color': ['Color explanation'], 'why this color': ['Color explanation'],
  interpretation: ['Color explanation'], 'read fading': ['Color explanation'],
};
const order = ['Identity and coordinates', 'Alignment and quality', 'Pairing', 'Clicked base or variant', 'Coverage', 'Color explanation', 'Additional recorded attributes'];
const readFields = new Set(['read name', 'alignment start', 'genomic location', 'read strand', 'cigar', 'mapping quality', 'secondary', 'supplementary', 'duplicate', 'failed qc', 'first in pair', 'mate is mapped', 'pair orientation', 'mate chromosome', 'mate start', 'mate strand', 'insert size', 'read base', 'base quality', 'insertion', 'location', 'whole-read color', 'why this color', 'interpretation', 'read fading']);
const variantFields = new Set(['chr', 'pos', 'loc', 'id', 'ref', 'alt', 'qual', 'filter', 'type']);
const annotationFields = new Set(['name', 'chromosome', 'chr', 'start', 'end', 'strand', 'id']);
function sections(details: FeatureDetails): {title: string; rows: ReadColorRow[]}[] {
  if (details.kind === 'Annotation') {
    return annotationSections(details);
  }
  const groups = new Map<string, ReadColorRow[]>();
  for (const row of details.rows) {
    const key = row.label.trim().replace(/:$/, '').toLowerCase();
    // Recognize only fields of this object type; an annotation attribute named
    // QUAL, for example, is not automatically VCF variant quality.
    const known = key === 'clicked position' || (details.kind === 'Read' ? readFields.has(key) : details.kind === 'Variant' ? variantFields.has(key) : details.kind === 'Annotation' ? annotationFields.has(key) : details.kind === 'Coverage position' && key === 'total count');
    const [group, name] = (known ? fields[key] : undefined) ?? [details.kind === 'Coverage position' && ['a', 'c', 'g', 't', 'n', 'del', 'ins'].includes(key) ? 'Coverage' : 'Additional recorded attributes'];
    const rows = groups.get(group) ?? [];
    rows.push({...row, label: name ? `${name} [${row.label}]` : row.label});
    groups.set(group, rows);
  }
  return order.flatMap(title => groups.has(title) ? [{title, rows: groups.get(title)!}] : []);
}

/** Sizes stay in this mounted view; no source files or saved configuration change. */
export function FeatureDetailsPanel({details, close, help}: {details?: FeatureDetails; close: () => void; help?: () => void}): React.JSX.Element | null {
  const panel = useRef<HTMLElement>(null);
  const drag = useRef<{x: number; y: number; width: number; height: number; stacked: boolean} | undefined>(undefined);
  const [width, setWidth] = useState(35);
  const [height, setHeight] = useState(320);
  const [stacked, setStacked] = useState(() => window.matchMedia('(max-width: 1100px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 1100px)');
    const update = (): void => setStacked(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  const resize = (x: number, y: number): void => {
    const start = drag.current;
    const parentWidth = panel.current?.parentElement?.clientWidth;
    if (!start || !parentWidth) {
      return;
    }
    if (start.stacked) {
      setHeight(Math.max(160, Math.min(window.innerHeight * 0.65, start.height + y - start.y)));
    } else {
      setWidth(Math.max(25, Math.min(60, start.width + (start.x - x) / parentWidth * 100)));
    }
  };
  if (!details) {
    return null;
  }
  return <aside ref={panel} className="genome-details" data-panel="feature-details" aria-live="polite"
    style={{'--details-width': `${width}%`, '--details-height': `${height}px`} as React.CSSProperties}>
    <div className="genome-details-header">
      <div><Text size="sm" c="dimmed">{details.kind ?? 'Track information'}</Text><Text fw={600}>{details.title}</Text></div>
      <ActionIcon data-control="close-feature-details" type="button" variant="subtle" aria-label="Close details" onClick={close}>×</ActionIcon>
    </div>
    <div className="genome-details-content">
      {sections(details).map(section => <section key={section.title}>
        <Text component="h3" size="xl" fw={700}>{section.title}</Text>
        <dl>{section.rows.map((row, index) => <React.Fragment key={index}><dt>{row.label}</dt><dd>{row.color ? <span className="genome-color-swatch" aria-hidden="true" style={{backgroundColor: row.color}} /> : null}{row.value}</dd></React.Fragment>)}</dl>
      </section>)}
      {help ? <Button type="button" variant="subtle" mt="md" onClick={help}>How to read click details</Button> : null}
    </div>
    <div className="genome-details-resize" role="separator" tabIndex={0} aria-label="Resize details panel"
      aria-orientation={stacked ? 'horizontal' : 'vertical'}
      aria-valuemin={stacked ? 160 : 25} aria-valuemax={stacked ? Math.max(160, Math.round(window.innerHeight * 0.65)) : 60} aria-valuenow={Math.round(stacked ? height : width)}
      aria-valuetext={stacked ? `${Math.round(height)} pixels high` : `${Math.round(width)} percent wide`}
      onPointerDown={event => {
        if (event.button !== 0) {
          return;
        }
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = {x: event.clientX, y: event.clientY, width, height, stacked};
      }} onPointerMove={event => resize(event.clientX, event.clientY)}
      onPointerUp={event => { drag.current = undefined; event.currentTarget.releasePointerCapture(event.pointerId); }}
      onPointerCancel={() => { drag.current = undefined; }}
      onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
          return;
        }
        event.preventDefault();
        if (stacked) {
          setHeight(current => Math.max(160, Math.min(window.innerHeight * 0.65, event.key === 'Home' ? 160 : event.key === 'End' ? window.innerHeight * 0.65 : current + (event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 24 : -24))));
        } else {
          setWidth(current => Math.max(25, Math.min(60, event.key === 'Home' ? 25 : event.key === 'End' ? 60 : current + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? 2 : -2))));
        }
      }} />
  </aside>;
}
