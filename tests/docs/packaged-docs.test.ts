import assert from 'node:assert/strict';
import {readdir, readFile} from 'node:fs/promises';
import test from 'node:test';
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
