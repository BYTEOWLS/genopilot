import React from 'react';
import type {BrowserView} from '../contract.js';

export function Provenance({view, title = view.title}: {view: BrowserView; title?: string}): React.JSX.Element {
  return <footer className="provenance">{view.provenance.application.name} {view.provenance.application.version} · {title}{view.provenance.run ? <div>Run: {view.provenance.run.name ?? view.provenance.run.id} · {view.provenance.run.id} · {view.provenance.run.workflow.id}@{view.provenance.run.workflow.version}</div> : null}<ul>{view.provenance.sources.map((source, index) => <li key={index}>{source.label} · {source.path}{source.sha256 ? <><br />SHA-256: {source.sha256}</> : null}</li>)}</ul></footer>;
}
