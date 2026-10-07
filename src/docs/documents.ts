import {readFile} from 'node:fs/promises';
import {basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {packagedUrl} from '../package-root.js';
import {discoverPackagedWorkflows, type DiscoveredWorkflow} from '../workflows/discovery.js';
import {documentTitle, parseMarkdown, type Block} from './markdown.js';

/** The packaged general documentation, resolved next to the installed application. */
export const packagedDocsDirectory = packagedUrl('docs/');

/** A document to show: its blocks, or none when the file does not exist. */
export type Document = {
  /** Stable identifier: the file name without `.md`, such as `help` or `results`. */
  id: string;
  /** The first `#` heading, or the file name when there is none. */
  title: string;
  blocks?: Block[];
  /** Server-side location for resolving links; never sent to the browser. */
  sourceUrl?: string;
};

/** Loads the documents one page shows as tabs, in tab order. */
export type DocumentsLoader = () => Promise<Document[]>;

export type ReadText = (url: URL) => Promise<string>;

const readText: ReadText = url => readFile(url, 'utf8');

/** Reads one Markdown file; a missing file gives a document without blocks. */
export async function readDocument(url: URL, read: ReadText = readText): Promise<Document> {
  const fileName = basename(fileURLToPath(url));
  const id = fileName.replace(/\.md$/, '');
  let source: string;
  try {
    source = await read(url);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {id, title: fileName, sourceUrl: url.href};
    }
    throw error;
  }
  const blocks = parseMarkdown(source);
  return {id, title: documentTitle(blocks) ?? fileName, blocks, sourceUrl: url.href};
}

/** The general documents in `docs/` the application shows, in tab order. */
export const generalDocumentNames = ['help', 'import-review', 'run-results', 'browser-view', 'genome-view'] as const;

/** General documents in `docs/`, by file name without `.md`. */
export function readGeneralDocuments(
  names: readonly string[],
  read: ReadText = readText,
  directory: URL = packagedDocsDirectory,
): Promise<Document[]> {
  return Promise.all(names.map(name => readDocument(new URL(`${name}.md`, directory), read)));
}

/** The files every workflow may contribute, next to its manifest. */
export const workflowDocumentFiles = ['README.md', 'results.md'] as const;

export type WorkflowDocumentFile = (typeof workflowDocumentFiles)[number];

/** A workflow's documents, found by convention in its directory. */
export function readWorkflowDocuments(
  workflow: Pick<DiscoveredWorkflow, 'directoryUrl'>,
  files: readonly WorkflowDocumentFile[] = workflowDocumentFiles,
  read: ReadText = readText,
): Promise<Document[]> {
  return Promise.all(files.map(file => readDocument(new URL(file, workflow.directoryUrl), read)));
}

/**
 * A workflow's documents by its stable ID, for screens that know only the manifest. An unknown
 * workflow yields the same missing documents a workflow without them would.
 */
export async function readWorkflowDocumentsById(
  workflowId: string,
  files: readonly WorkflowDocumentFile[] = workflowDocumentFiles,
  discover: () => Promise<DiscoveredWorkflow[]> = discoverPackagedWorkflows,
  read: ReadText = readText,
): Promise<Document[]> {
  const workflow = (await discover()).find(candidate => candidate.manifest.id === workflowId);
  if (!workflow) {
    return files.map(file => ({id: file.replace(/\.md$/, ''), title: file}));
  }
  return readWorkflowDocuments(workflow, files, read);
}
