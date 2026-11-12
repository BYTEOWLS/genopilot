/**
 * The GFF3 find-and-replace: one pass over a GFF3's lines that replaces text in the values of the
 * chosen attributes in column 9 and leaves everything else byte-identical. The preview and the
 * rewrite both run this code, so the preview shows exactly what is written.
 */

/** The attribute choices; `ids` stands for `ID`, `Parent`, and `Derives_from` together. */
export const attributeGroups = ['ids', 'Name', 'locus_tag', 'gene', 'product', 'Note', 'Alias', 'Dbxref'] as const;

export type AttributeGroup = (typeof attributeGroups)[number];

/** The scope a rewrite starts with: IDs and their references, names, and locus tags. */
export const defaultAttributeGroups: readonly AttributeGroup[] = ['ids', 'Name', 'locus_tag'];

/** Every attribute, or the attributes of the chosen groups. */
export type AttributeScope = 'all' | readonly AttributeGroup[];

export type ReplaceOptions = {
  search: string;
  replacement: string;
  regularExpression: boolean;
  attributes: AttributeScope;
};

export type ReplaceStatistics = {
  /** Matches replaced; a zero-width match such as `^` counts once per value. */
  replacements: number;
  /** Changed values per attribute name. */
  changedValues: Record<string, number>;
  ids: {changed: number; matchedUnchanged: number; unmatched: number};
  aliasesAdded: number;
  /** `Parent` and `Derives_from` values that already named no ID in the source. */
  danglingInSource: number;
};

export type ReplaceSample = {before: string; after: string};

export type ReplaceSummary = {
  statistics: ReplaceStatistics;
  /** A few changed values per attribute, for the preview. */
  samples: Record<string, ReplaceSample[]>;
  /** Why nothing may be written; empty when the result is valid. */
  problems: string[];
  /** Problems beyond the listed ones. */
  moreProblems: number;
};

export type IdMappingRow = {oldId: string; newId: string; type: string; seqid: string; start: string};

/** Rejects options that cannot run, before any file is read. */
export class ReplaceOptionsError extends Error {}

const referenceAttributes = new Set(['Parent', 'Derives_from']);
const geneTypes = new Set(['gene', 'pseudogene']);
const samplesPerAttribute = 5;
const listedProblems = 20;

/** The attribute names of the chosen groups, in the order of `attributeGroups`. */
export function attributeNames(groups: readonly AttributeGroup[]): string[] {
  return attributeGroups.filter(group => groups.includes(group))
    .flatMap(group => group === 'ids' ? ['ID', 'Parent', 'Derives_from'] : [group]);
}

function scopedAttributes(scope: AttributeScope): ((name: string) => boolean) {
  if (scope === 'all') {
    return () => true;
  }
  const names = new Set(attributeNames(scope));
  return name => names.has(name);
}

/** A replacement of one decoded value: the new value and the number of matches. */
type Replace = (value: string) => {value: string; matches: number};

/**
 * Compiles the options into a replacement, or throws `ReplaceOptionsError` for an empty search, a
 * regular expression that does not compile, or one that matches the empty string inside a value.
 */
export function compileReplacement(options: Pick<ReplaceOptions, 'search' | 'replacement' | 'regularExpression'>): Replace {
  const {search, replacement} = options;
  if (search.length === 0) {
    throw new ReplaceOptionsError('The search text is empty.');
  }
  if (!options.regularExpression) {
    return value => {
      const parts = value.split(search);
      return {value: parts.join(replacement), matches: parts.length - 1};
    };
  }
  let pattern: RegExp;
  try {
    pattern = new RegExp(search, 'g');
  } catch (error) {
    throw new ReplaceOptionsError(`The regular expression does not compile: ${error instanceof Error ? error.message : String(error)}`);
  }
  // A pattern such as `x*` matches the empty string between any two characters and would insert
  // the replacement everywhere; anchors such as `^`, `$`, and `\b` match only at a word's edges.
  for (const sample of ['ab', 'aa', '11']) {
    if ([...sample.matchAll(pattern)].some(match => match[0].length === 0 && match.index > 0 && match.index < sample.length)) {
      throw new ReplaceOptionsError('The regular expression matches the empty string inside a value, such as x*; anchor it or require at least one character.');
    }
  }
  return value => {
    const matches = [...value.matchAll(pattern)].length;
    return matches === 0 ? {value, matches} : {value: value.replace(pattern, replacement), matches};
  };
}

/** Decodes GFF3 percent-escapes; an escape that is not valid UTF-8 stays as written. */
export function decodeValue(value: string): string {
  return value.replace(/(?:%[0-9A-Fa-f]{2})+/g, escaped => {
    try {
      return decodeURIComponent(escaped);
    } catch {
      return escaped;
    }
  });
}

/** Encodes a value for column 9: `%`, the reserved `,;=&`, and control characters, tab included. */
export function encodeValue(value: string): string {
  return value.replace(/[%,;=&\u0000-\u001f\u007f]/g, character =>
    `%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
}

function isValidId(id: string): boolean {
  return !/[\s\u0000-\u001f\u007f]/.test(id);
}

type IdRecord = {newId: string; type: string; seqid: string; start: string; matched: boolean};

type Reference = {line: number; attribute: string; oldValue: string; newValue: string};

/**
 * Applies the replacement line by line. `line` takes one line without its line ending and returns
 * it rewritten; `finish` checks the whole file and returns the statistics, samples, problems, and
 * the ID mapping.
 */
export class Gff3Replacer {
  private readonly replace: Replace;
  private readonly inScope: (name: string) => boolean;
  private lineNumber = 0;
  private inFasta = false;
  private readonly ids = new Map<string, IdRecord>();
  private readonly references: Reference[] = [];
  private readonly problems: string[] = [];
  private problemCount = 0;
  private readonly statistics: ReplaceStatistics = {
    replacements: 0,
    changedValues: {},
    ids: {changed: 0, matchedUnchanged: 0, unmatched: 0},
    aliasesAdded: 0,
    danglingInSource: 0,
  };
  private readonly samples: Record<string, ReplaceSample[]> = {};

  constructor(options: ReplaceOptions) {
    this.replace = compileReplacement(options);
    this.inScope = scopedAttributes(options.attributes);
  }

  private problem(message: string): void {
    this.problemCount += 1;
    if (this.problems.length < listedProblems) {
      this.problems.push(message);
    }
  }

  /** Rewrites one line, given without its line ending. */
  line(text: string): string {
    this.lineNumber += 1;
    if (this.inFasta) {
      return text;
    }
    if (text.startsWith('##FASTA')) {
      this.inFasta = true;
      return text;
    }
    if (text.startsWith('#') || text.trim().length === 0) {
      return text;
    }
    const columns = text.split('\t');
    if (columns.length !== 9) {
      this.problem(`Line ${String(this.lineNumber)}: expected 9 tab-separated columns, found ${String(columns.length)}.`);
      return text;
    }
    const attributes = columns[8]!;
    if (attributes === '.' || attributes.length === 0) {
      return text;
    }
    const rewritten = this.attributes(attributes, columns[0]!, columns[2]!, columns[3]!);
    return rewritten === attributes ? text : `${columns.slice(0, 8).join('\t')}\t${rewritten}`;
  }

  private attributes(column: string, seqid: string, type: string, start: string): string {
    const pieces = column.split(';');
    let oldId: string | undefined;
    let newId: string | undefined;
    let aliasIndex: number | undefined;
    const rewritten = pieces.map((piece, index) => {
      const separator = piece.indexOf('=');
      if (separator < 0) {
        return piece;
      }
      // Names are matched without surrounding spaces, such as after `; `, and written back as they were.
      const prefix = piece.slice(0, separator + 1);
      const name = prefix.slice(0, -1).trim();
      const rawValues = piece.slice(separator + 1).split(',');
      const searched = this.inScope(name);
      if (name === 'ID' && rawValues.length > 1) {
        this.problem(`Line ${String(this.lineNumber)}: ID has several values.`);
      }
      const values = rawValues.map(raw => {
        const decoded = decodeValue(raw);
        const result = searched ? this.replace(decoded) : {value: decoded, matches: 0};
        if (name === 'ID') {
          oldId = decoded;
          newId = result.value;
          this.recordId(decoded, result.value, result.matches > 0, type, seqid, start);
        } else if (referenceAttributes.has(name)) {
          this.references.push({line: this.lineNumber, attribute: name, oldValue: decoded, newValue: result.value});
        }
        if (result.matches === 0 || result.value === decoded) {
          this.statistics.replacements += result.matches;
          return raw;
        }
        this.statistics.replacements += result.matches;
        this.statistics.changedValues[name] = (this.statistics.changedValues[name] ?? 0) + 1;
        const samples = (this.samples[name] ??= []);
        if (samples.length < samplesPerAttribute) {
          samples.push({before: decoded, after: result.value});
        }
        if (result.value.length === 0) {
          this.problem(`Line ${String(this.lineNumber)}: a ${name} value "${decoded}" becomes empty.`);
        }
        return encodeValue(result.value);
      });
      if (name === 'Alias') {
        aliasIndex = index;
      }
      return `${prefix}${values.join(',')}`;
    });
    // A renamed gene keeps its former ID as an alias, after the aliases it already has.
    if (oldId !== undefined && newId !== undefined && newId !== oldId && geneTypes.has(type)) {
      if (aliasIndex === undefined) {
        let insertAt = rewritten.length;
        while (insertAt > 0 && rewritten[insertAt - 1]!.trim().length === 0) {
          insertAt -= 1;
        }
        rewritten.splice(insertAt, 0, `Alias=${encodeValue(oldId)}`);
        this.statistics.aliasesAdded += 1;
      } else {
        const piece = rewritten[aliasIndex]!;
        const existing = piece.slice(piece.indexOf('=') + 1).split(',').map(decodeValue);
        if (!existing.includes(oldId)) {
          rewritten[aliasIndex] = existing.length === 1 && existing[0] === '' ? `Alias=${encodeValue(oldId)}` : `${piece},${encodeValue(oldId)}`;
          this.statistics.aliasesAdded += 1;
        }
      }
    }
    return rewritten.join(';');
  }

  private recordId(oldId: string, newId: string, matched: boolean, type: string, seqid: string, start: string): void {
    // Lines sharing an ID, such as the parts of a discontinuous CDS, are one feature.
    if (this.ids.has(oldId)) {
      return;
    }
    this.ids.set(oldId, {newId, type, seqid, start, matched});
    if (!matched) {
      this.statistics.ids.unmatched += 1;
    } else if (newId === oldId) {
      this.statistics.ids.matchedUnchanged += 1;
    } else {
      this.statistics.ids.changed += 1;
    }
    // An empty ID is already reported as an empty value.
    if (newId !== oldId && newId.length > 0 && !isValidId(newId)) {
      this.problem(`Line ${String(this.lineNumber)}: the new ID "${newId}" of "${oldId}" contains whitespace or control characters.`);
    }
  }

  /** Checks the whole file: collisions and references that no longer resolve. */
  finish(): ReplaceSummary & {mapping: IdMappingRow[]} {
    const byNewId = new Map<string, string>();
    for (const [oldId, record] of this.ids) {
      const other = byNewId.get(record.newId);
      if (other !== undefined) {
        this.problem(`The IDs "${other}" and "${oldId}" both become "${record.newId}".`);
      } else {
        byNewId.set(record.newId, oldId);
      }
    }
    for (const reference of this.references) {
      const target = this.ids.get(reference.oldValue);
      if (!target) {
        this.statistics.danglingInSource += 1;
      } else if (target.newId !== reference.newValue) {
        this.problem(`Line ${String(reference.line)}: ${reference.attribute} "${reference.oldValue}" becomes "${reference.newValue}", but its ID becomes "${target.newId}".`);
      }
    }
    const mapping = [...this.ids].filter(([oldId, record]) => record.newId !== oldId).map(([oldId, record]) => ({
      oldId, newId: record.newId, type: record.type, seqid: record.seqid, start: record.start,
    }));
    return {
      statistics: this.statistics,
      samples: this.samples,
      problems: [...this.problems],
      moreProblems: this.problemCount - this.problems.length,
      mapping,
    };
  }
}

function tsvField(value: string): string {
  return value.replace(/[\t\r\n]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
}

/** The `id-mapping.tsv` of a rewrite: one row per changed ID, in file order. */
export function idMappingTsv(rows: readonly IdMappingRow[]): string {
  return ['old_id\tnew_id\ttype\tseqid\tstart',
    ...rows.map(row => [row.oldId, row.newId, row.type, row.seqid, row.start].map(tsvField).join('\t'))].join('\n') + '\n';
}
