import {createInterface} from 'node:readline';
import {withGenomeCache, type GenomeCacheRequest} from './cache.js';
import {genomeSources} from './registry.js';
import {providerError, providerSettings} from '../tooling/provider-settings.js';

// Two-message stdin handshake: request, then {copied:true} after verified paths on stdout.
// Python keeps stdin open
// until its staged copies match the digests. EOF/cancellation releases the lease as failure.
const abort = new AbortController();
const cancel = (): void => abort.abort(new Error('Genome resolution cancelled.'));
process.on('SIGTERM', cancel);
process.on('SIGINT', cancel);
// A vanished consumer must reject the write and release the lease, not crash on EPIPE.
process.stdout.on('error', cancel);
let awaitingCopy = false;
let acknowledged = false;
const lines = createInterface({input: process.stdin, crlfDelay: Infinity, signal: abort.signal});
// Observe the line synchronously: EOF can arrive before the async iterator resumes.
lines.on('line', line => {
  if (awaitingCopy && line === '{"copied":true}') {
    acknowledged = true;
  }
});
const disconnected = (): void => {
  if (!acknowledged) {
    cancel();
  }
};
process.stdin.on('end', disconnected);
const iterator = lines[Symbol.asyncIterator]();
let secrets: Record<string, string> = {};
try {
  const first = await iterator.next();
  if (first.done) {
    throw new Error('A genome request is required on stdin.');
  }
  const request = JSON.parse(first.value) as GenomeCacheRequest;
  if (!request || typeof request.root !== 'string' || !Array.isArray(request.kinds)
    || Object.keys(request).some(key => !['reference', 'kinds', 'root', 'mode', 'copy'].includes(key))) {
    throw new Error('Invalid genome request.');
  }
  const reference = genomeSources.validateReference(request.reference);
  secrets = await providerSettings().read(genomeSources.get(reference.source));
  await withGenomeCache(request, {signal: abort.signal, secrets}, async genome => {
    abort.signal.throwIfAborted();
    awaitingCopy = true;
    await new Promise<void>((resolve, reject) => process.stdout.write(`${JSON.stringify({...genome, resolver: {node_version: process.version}})}\n`, error => error ? reject(error) : resolve()));
    const acknowledgment = await iterator.next();
    abort.signal.throwIfAborted();
    if (acknowledgment.done || acknowledgment.value !== '{"copied":true}') {
      throw new Error('The genome consumer did not acknowledge its verified copies.');
    }
  });
} catch (error) {
  process.stderr.write(`${providerError(error, secrets)}\n`);
  process.exitCode = 1;
} finally {
  process.stdin.off('end', disconnected);
  lines.close();
  process.stdin.pause();
  process.off('SIGTERM', cancel);
  process.off('SIGINT', cancel);
}
