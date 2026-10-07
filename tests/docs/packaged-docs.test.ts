import assert from 'node:assert/strict';
import {readdir, readFile} from 'node:fs/promises';
import test from 'node:test';
import {parse} from 'yaml';
import {generalDocumentNames, packagedDocsDirectory, readGeneralDocuments, readWorkflowDocuments} from '../../src/docs/documents.js';
import {parseMarkdown, unsupportedMarkdown} from '../../src/docs/markdown.js';
import {discoverPackagedWorkflows} from '../../src/workflows/discovery.js';

// Generic over whatever is packaged: a new workflow is checked without changing this file.

async function generalDocuments(): Promise<{name: string; source: string}[]> {
  const names = (await readdir(packagedDocsDirectory)).filter(name => name.endsWith('.md'));
  return Promise.all(names.map(async name => ({name, source: await readFile(new URL(name, packagedDocsDirectory), 'utf8')})));
}

test('packaged documents use only the supported Markdown subset', async () => {
  const documents = [
    ...(await generalDocuments()).map(document => ({path: `docs/${document.name}`, source: document.source})),
  ];
  for (const workflow of await discoverPackagedWorkflows()) {
    for (const file of ['README.md', 'results.md', 'development.md']) {
      try {
        documents.push({path: `workflows/${workflow.manifest.id}/${file}`, source: await readFile(new URL(file, workflow.directoryUrl), 'utf8')});
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }
    }
  }
  assert.ok(documents.length > 0);
  for (const document of documents) {
    assert.deepEqual(unsupportedMarkdown(document.source), [], document.path);
  }
});

test('the general documentation never names a workflow', async () => {
  const workflows = await discoverPackagedWorkflows();
  for (const document of await generalDocuments()) {
    for (const workflow of workflows) {
      assert.ok(!document.source.includes(workflow.manifest.id), `docs/${document.name} names ${workflow.manifest.id}`);
      assert.ok(!document.source.includes(workflow.manifest.label), `docs/${document.name} names ${workflow.manifest.label}`);
    }
  }
});

test('the application finds every general document it shows, each with a title', async () => {
  const documents = await readGeneralDocuments(generalDocumentNames);
  for (const document of documents) {
    assert.ok(document.blocks, `docs/${document.id}.md is missing`);
    assert.notEqual(document.title, `${document.id}.md`, `docs/${document.id}.md has no # title`);
  }
});

test('every workflow documents its science, tools, and results', async () => {
  for (const workflow of await discoverPackagedWorkflows()) {
    const [readme, results] = await readWorkflowDocuments(workflow);
    const id = workflow.manifest.id;
    assert.ok(readme?.blocks, `${id} has no README.md`);
    assert.ok(results?.blocks, `${id} has no results.md`);
    assert.notEqual(readme.title, 'README.md', `${id}/README.md has no # title`);
    assert.notEqual(results.title, 'results.md', `${id}/results.md has no # title`);
    assert.ok(
      readme.blocks.some(block => block.kind === 'heading' && block.level === 2 &&
        block.content.some(span => span.text === 'Tools')),
      `${id}/README.md has no ## Tools section`,
    );
  }
});

test('the repository README lists exactly the packaged workflows', async () => {
  const source = await readFile(new URL('../../README.md', import.meta.url), 'utf8');
  const section = /^## Workflows\n([\s\S]*?)(?=^## )/m.exec(source)?.[1] ?? '';
  const linked = [...section.matchAll(/\]\(workflows\/([^/]+)\/README\.md\)/g)].map(match => match[1]).sort();
  const packaged = (await discoverPackagedWorkflows()).map(workflow => workflow.manifest.id).sort();
  assert.deepEqual(linked, packaged);
  assert.ok(parseMarkdown(section).length > 0);
});

type CitationReference = {id: string; text: string; doi?: string; url?: string};
type CitationTool = {name: string; versions: string[]; references: string[]; input_source?: string};

/** The text of a `## <title>` section, up to the next `##` heading. */
function section(source: string, title: string): string {
  return new RegExp(`^## ${title}\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm').exec(source)?.[1] ?? '';
}

test('each workflow lists exactly its machine-readable references and tools in its README', async () => {
  for (const workflow of await discoverPackagedWorkflows()) {
    const id = workflow.manifest.id;
    const readme = await readFile(new URL('README.md', workflow.directoryUrl), 'utf8');
    const citation = JSON.parse(await readFile(new URL('citation/references.json', workflow.directoryUrl), 'utf8')) as
      {references: CitationReference[]; tools: CitationTool[]};
    const listed = [...section(readme, 'References').matchAll(/^\d+\. (.+)$/gm)].map(match => match[1]);
    assert.deepEqual(citation.references.map(reference => reference.text), listed, `${id}: README references`);
    for (const reference of citation.references) {
      assert.ok(reference.doi || reference.url, `${id}: ${reference.id} has neither DOI nor URL`);
      if (reference.doi) {
        assert.ok(reference.text.includes(`https://doi.org/${reference.doi}`), `${id}: ${reference.id} DOI`);
      }
    }
    // Each `## Tools` row names its references by their number in the README list.
    const rows = section(readme, 'Tools').split('\n')
      .filter(line => line.startsWith('| ') && !line.startsWith('| Tool |'))
      .map(line => line.split('|').map(cell => cell.trim()));
    assert.deepEqual(citation.tools.map(tool => tool.name), rows.map(cells => cells[1]), `${id}: tools`);
    for (const [index, tool] of citation.tools.entries()) {
      const numbers = [...(rows[index]?.[4] ?? '').matchAll(/\d+/g)].map(match => Number(match[0]));
      assert.deepEqual(tool.references, numbers.map(number => citation.references[number - 1]?.id), `${id}: ${tool.name}`);
    }
    // The methods template and its wording exist; the workflow tests fill them.
    assert.ok((await readFile(new URL('citation/methods.txt', workflow.directoryUrl), 'utf8')).trim().length > 0);
    assert.equal(typeof JSON.parse(await readFile(new URL('citation/phrases.json', workflow.directoryUrl), 'utf8')), 'object');
  }
});

test('GenoPilot is cited as CITATION.cff describes it', async () => {
  const cff = parse(await readFile(new URL('../../CITATION.cff', import.meta.url), 'utf8')) as
    {title: string; authors: {'family-names': string; 'given-names': string}[]; 'repository-code': string; doi?: string; 'date-released': string};
  const citation = JSON.parse(await readFile(new URL('../../workflows/shared/citation/genopilot.json', import.meta.url), 'utf8')) as
    {title: string; authors: string[]; repository: string; concept_doi: string | null; date_released: string};
  assert.equal(citation.title, cff.title);
  assert.deepEqual(citation.authors, cff.authors.map(author =>
    `${author['family-names']} ${author['given-names'].split(/\s+/).map(name => name[0]).join('')}`));
  assert.equal(citation.repository, cff['repository-code']);
  assert.equal(citation.concept_doi, cff.doi ?? null);
  assert.equal(citation.date_released, String(cff['date-released']));
});
