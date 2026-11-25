// The worker thread a preview or rewrite runs in, so a slow pattern never blocks the interface
// and cancelling terminates it. It runs one pass and posts its result or its error.
import {parentPort, workerData} from 'node:worker_threads';
import {ReplaceOptionsError} from './core.js';
import {runPass, type PassRequest} from './pass.js';

runPass(workerData as PassRequest).then(
  result => parentPort?.postMessage({ok: true, result}),
  error => parentPort?.postMessage({
    ok: false,
    message: error instanceof Error ? error.message : String(error),
    invalidOptions: error instanceof ReplaceOptionsError,
  }),
);
