import assert from 'node:assert/strict';
import test from 'node:test';
import {parseProcessList, sampleTreeMemory, treeMemoryBytes, type ProcessEntry} from '../../src/workflows/memory-sampling.js';

test('parses ps output and skips lines that are not a process', () => {
  assert.deepEqual(parseProcessList('  10     1  2048\n  11    10   512\nnot a process\n\n'), [
    {pid: 10, ppid: 1, rssKilobytes: 2048},
    {pid: 11, ppid: 10, rssKilobytes: 512},
  ]);
});

test('adds the memory of a process and all its descendants, and nothing else', () => {
  const processes: ProcessEntry[] = [
    {pid: 1, ppid: 0, rssKilobytes: 9999},
    {pid: 10, ppid: 1, rssKilobytes: 100},
    {pid: 11, ppid: 10, rssKilobytes: 20},
    {pid: 12, ppid: 11, rssKilobytes: 3},
    {pid: 13, ppid: 1, rssKilobytes: 4000},
  ];
  assert.equal(treeMemoryBytes(processes, 10), 123 * 1024);
  assert.equal(treeMemoryBytes(processes, 99), 0);
});

test('keeps the highest sample until stopped and skips samples that fail', async context => {
  context.mock.timers.enable({apis: ['setInterval']});
  const samples: (ProcessEntry[] | Error)[] = [
    [{pid: 10, ppid: 1, rssKilobytes: 100}],
    new Error('ps failed'),
    [{pid: 10, ppid: 1, rssKilobytes: 100}, {pid: 11, ppid: 10, rssKilobytes: 400}],
    [{pid: 10, ppid: 1, rssKilobytes: 50}],
  ];
  let calls = 0;
  const sampler = sampleTreeMemory(10, {
    intervalMs: 1000,
    readProcesses: async () => {
      const next = samples[calls++];
      if (next instanceof Error) {
        throw next;
      }
      return next ?? [];
    },
  });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  await settle();
  for (let index = 1; index < samples.length; index += 1) {
    context.mock.timers.tick(1000);
    await settle();
  }
  assert.equal(sampler.stop(), 500 * 1024);
  context.mock.timers.tick(5000);
  assert.equal(calls, samples.length);
});

test('has no peak when nothing could be sampled', () => {
  const sampler = sampleTreeMemory(10, {readProcesses: async () => []});
  assert.equal(sampler.stop(), undefined);
});
