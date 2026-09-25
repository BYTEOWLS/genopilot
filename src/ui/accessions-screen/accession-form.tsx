import React, {useState} from 'react';
import {Box, Text, useInput} from 'ink';
import {isVersionedAssemblyAccession} from '../../accessions/accession.js';
import type {ScannedCopy} from '../../accessions/cache-discovery.js';
import {
  AccessionCatalogValidationError,
  recordedCacheState,
  validateAccessionCatalog,
  withAccession,
  type AccessionCatalog,
  type AccessionEntry,
} from '../../accessions/catalog.js';
import type {AssemblyMetadataFetcher, MetadataFetchResult} from '../../accessions/ncbi-metadata.js';
import {TextField} from '../components/text-field.js';
import {EditPage} from '../components/page.js';
import {useHomeSuspension} from '../home-navigation.js';
import {sanitizeTerminalText} from '../sanitize.js';
import {mutedColor} from '../theme.js';
import {metadataProvenance, metadataRows} from './metadata-summary.js';
import {ParameterList} from '../components/parameter-list.js';
import {formatLocalDateTime} from '../utils.js';

type DetailRow = 'name' | 'description' | 'save';

const detailRows: readonly DetailRow[] = ['name', 'description', 'save'];

/** The researcher-editable part of an entry; NCBI facts and cached copies are never edited here. */
export type LocalAccessionFields = Pick<AccessionEntry, 'name' | 'description'>;

export function localFields(name: string, description: string): LocalAccessionFields {
  const trimmedName = name.trim();
  const trimmedDescription = description.trim();
  return {
    ...(trimmedName.length > 0 ? {name: trimmedName} : {}),
    ...(trimmedDescription.length > 0 ? {description: trimmedDescription} : {}),
  };
}

/** Replaces only the local name and description of an existing entry. */
export function withLocalFields(
  catalog: AccessionCatalog,
  accession: string,
  fields: LocalAccessionFields,
): AccessionCatalog {
  return {
    ...catalog,
    accessions: catalog.accessions.map(entry => {
      if (entry.accession !== accession) {
        return entry;
      }
      const {name: _name, description: _description, ...facts} = entry;
      return {...facts, ...fields};
    }),
  };
}

function lookupProblem(result: MetadataFetchResult | undefined): string | undefined {
  return result?.state === 'failed' ? result.message : undefined;
}

/**
 * Adds an accession after looking up its NCBI metadata, or edits an entry's local name and
 * description. Adding never downloads assembly files.
 */
export function AccessionForm({
  catalog,
  editing,
  fetchMetadata,
  onSubmit,
  onCancel,
  inputActive,
  unverifiedCopies = [],
}: {
  catalog: AccessionCatalog;
  /** The entry being edited; undefined when adding one. */
  editing?: AccessionEntry;
  /** Damaged cache directories of the edited accession, as found by the latest scan. */
  unverifiedCopies?: readonly ScannedCopy[];
  fetchMetadata: AssemblyMetadataFetcher;
  /** Receives the entry to save; an edited entry differs only in its name and description. */
  onSubmit: (entry: AccessionEntry) => Promise<void>;
  onCancel: () => void;
  inputActive: boolean;
}): React.JSX.Element {
  const [stage, setStage] = useState<'accession' | 'details'>(editing ? 'details' : 'accession');
  const [accession, setAccession] = useState(editing?.accession ?? '');
  const [lookup, setLookup] = useState<MetadataFetchResult>();
  const [name, setName] = useState(editing?.name ?? '');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [selectedRow, setSelectedRow] = useState<DetailRow>('name');
  // In the lookup step, the accession field or its look-up button.
  const [lookupSelected, setLookupSelected] = useState(false);
  const [busy, setBusy] = useState<'looking-up' | 'saving'>();
  const [problems, setProblems] = useState<string[]>([]);
  const typing = stage === 'accession' ? !lookupSelected : selectedRow !== 'save';
  useHomeSuspension(busy ? 'busy' : typing ? 'typing' : undefined);

  const lookUp = (): void => {
    const candidate = accession.trim().toUpperCase();
    if (!isVersionedAssemblyAccession(candidate)) {
      setProblems(['Accession: must be a versioned NCBI assembly accession, for example GCF_000149205.2']);
      return;
    }
    if (catalog.accessions.some(entry => entry.accession === candidate)) {
      setProblems([`Accession: ${candidate} is already in the catalog`]);
      return;
    }
    setAccession(candidate);
    setProblems([]);
    setBusy('looking-up');
    fetchMetadata(candidate).then(
      result => {
        setBusy(undefined);
        setLookup(result);
        // A lookup that NCBI answered without this accession means the accession is wrong;
        // any other failure only means the facts are not available right now.
        if (result.state === 'failed' && result.kind === 'not-found') {
          setProblems([result.message]);
          return;
        }
        setStage('details');
        setSelectedRow('name');
      },
      error => {
        setBusy(undefined);
        setProblems([error instanceof Error ? error.message : String(error)]);
      },
    );
  };

  const submit = (): void => {
    const fields = localFields(name, description);
    const candidate = editing
      ? withLocalFields(catalog, editing.accession, fields)
      : withAccession(catalog, {
        accession,
        ...fields,
        ncbi: lookup?.state === 'retrieved' ? lookup.metadata : null,
        cached_copies: [],
      });
    const entry = candidate.accessions.find(candidateEntry => candidateEntry.accession === accession);
    if (!entry) {
      return;
    }
    try {
      validateAccessionCatalog(candidate);
    } catch (error) {
      setProblems(error instanceof AccessionCatalogValidationError
        ? error.issues.map(issue => `${issue.path.replace(/^\$\.accessions\[\d+\]\./, '')}: ${issue.message}`)
        : [error instanceof Error ? error.message : String(error)]);
      return;
    }
    setProblems([]);
    setBusy('saving');
    onSubmit(entry).catch(error => {
      setBusy(undefined);
      setProblems([error instanceof Error ? error.message : String(error)]);
    });
  };

  useInput(
    (_input, key) => {
      if (busy) {
        return;
      }
      if (key.escape) {
        onCancel();
        return;
      }
      if (stage === 'accession') {
        if (key.tab || key.upArrow || key.downArrow) {
          setLookupSelected(current => !current);
        } else if (key.return && lookupSelected) {
          lookUp();
        }
        return;
      }
      const index = detailRows.indexOf(selectedRow);
      if (key.tab || key.upArrow || key.downArrow) {
        const offset = key.upArrow || (key.tab && key.shift) ? -1 : 1;
        setSelectedRow(detailRows[(index + offset + detailRows.length) % detailRows.length] ?? 'name');
        return;
      }
      // Enter acts only on the save button; Tab and the arrows move between fields.
      if (key.return && selectedRow === 'save') {
        submit();
      }
    },
    {isActive: inputActive},
  );

  const metadata = editing ? editing.ncbi : lookup?.state === 'retrieved' ? lookup.metadata : null;
  const unavailable = lookupProblem(lookup);

  const pageDescription =
    'Cataloging an accession does not download its assembly; a workflow that needs it downloads it on demand.';

  if (stage === 'accession') {
    return (
      <EditPage
        title="Add accession"
        description={pageDescription}
        shortcuts={['Tab/↑/↓ — Field', lookupSelected && 'Enter — Look up']}
        back="Cancel"
        saveLabel="Look up NCBI metadata"
        saveSelected={lookupSelected}
        saving={busy === 'looking-up'}
        savingLabel="Looking up NCBI metadata…"
        problems={problems}
        problemsTitle="Not looked up:"
      >
        <TextField
          label="Accession"
          required
          selected={!lookupSelected}
          inputActive={inputActive && !busy}
          defaultValue={accession}
          displayValue={accession}
          placeholder="Versioned assembly accession, e.g. GCF_000149205.2"
          onChange={setAccession}
        />
      </EditPage>
    );
  }

  return (
    <EditPage
      title={editing ? `Edit ${editing.accession}` : 'Add accession'}
      description={pageDescription}
      shortcuts={['Tab/↑/↓ — Field', selectedRow === 'save' && 'Enter — Save']}
      back="Cancel"
      saveLabel={editing ? 'Save changes' : 'Add to catalog'}
      saveSelected={selectedRow === 'save'}
      saving={busy === 'saving'}
      problems={problems}
    >
      <ParameterList
        inputActive={inputActive && !busy}
        selectedId={selectedRow}
        rows={[
          {id: 'accession', label: 'Accession', value: accession},
          {
            id: 'name',
            label: 'Name',
            value: name.length > 0 ? name : `not set, shown as ${accession}`,
            muted: name.length === 0,
            edit: {defaultValue: name, onChange: setName},
          },
          {
            id: 'description',
            label: 'Description',
            value: description.length > 0 ? description : 'not set',
            muted: description.length === 0,
            edit: {defaultValue: description, onChange: setDescription},
          },
          ...(metadata ? metadataRows(metadata) : []),
        ]}
      />
      <Box marginTop={1}>
        {metadata ? (
          <Text color={mutedColor} wrap="wrap">{metadataProvenance(metadata)}</Text>
        ) : (
          <Text color="yellow" wrap="wrap">
            NCBI metadata was not retrieved{unavailable ? `: ${sanitizeTerminalText(unavailable)}` : '.'}
            {' '}You can save now and refresh the metadata later.
          </Text>
        )}
      </Box>
      {editing ? (
        <Box marginTop={1} flexDirection="column">
          <Text bold>Local copies</Text>
          {editing.cached_copies.length === 0 && unverifiedCopies.length === 0 ? (
            <Text color={mutedColor} wrap="wrap">
              None. A workflow that needs this accession downloads it.
            </Text>
          ) : null}
          {editing.cached_copies.map(copy => (
            <Text key={copy.path} wrap="wrap">
              ✔ {sanitizeTerminalText(copy.path)}
              <Text color={mutedColor}> · verified since {formatLocalDateTime(copy.verified_at)}</Text>
            </Text>
          ))}
          {unverifiedCopies.map(copy => (
            <Text key={copy.path} color="red" wrap="wrap">
              ✖ {sanitizeTerminalText(copy.path)} · not trusted: {sanitizeTerminalText(copy.problem ?? '')}
            </Text>
          ))}
          {recordedCacheState(editing) === 'conflict' ? (
            <Text color="yellow" wrap="wrap">
              The verified copies hold different files for the same versioned accession. Inspect
              them before a workflow uses this accession; none is preferred automatically.
            </Text>
          ) : null}
        </Box>
      ) : null}
    </EditPage>
  );
}
