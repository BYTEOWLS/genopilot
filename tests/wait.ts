import assert from 'node:assert/strict';

/**
 * How long a test waits for an expected state. Generous, because a slow or busy machine only
 * makes a test take longer; a passing condition returns at the next poll.
 */
export const WAIT_TIMEOUT_MS = 10_000;

/**
 * Lets React finish the work a render left behind. Ink draws a frame when React commits it, but a
 * newly shown field starts listening for keys in an effect that React's scheduler runs later, in
 * `setImmediate` turns of at least one task each; a key written in between is dropped. A few turns
 * cover the effects and anything they schedule.
 */
export async function effectsSettled(): Promise<void> {
  for (let turn = 0; turn < 3; turn += 1) {
    await new Promise<void>(resolve => setImmediate(resolve));
  }
}

/**
 * Waits until the condition holds, then lets the drawn screen start listening for keys. Tests
 * wait on an observable state rather than sleeping for a fixed time, which a slow machine can
 * overrun.
 */
export async function waitFor(condition: () => boolean, description: string, detail?: () => string): Promise<void> {
  // performance.now(), unlike Date, stays real when a test mocks the clock.
  const timeoutAt = performance.now() + WAIT_TIMEOUT_MS;
  while (!condition()) {
    if (performance.now() >= timeoutAt) {
      assert.fail(`Timed out waiting until ${description}${detail ? `\n${detail()}` : ''}`);
    }
    await new Promise<void>(resolve => setTimeout(resolve, 10));
  }
  await effectsSettled();
}

/**
 * Lets work a key or a resolved test double started reach the screen, then writes the frame Ink
 * holds back: Ink draws at most 30 frames a second, so a fixed sleep can end before it draws.
 * Work that waits on real I/O or timers still needs a `waitFor` on its outcome.
 */
export async function rendered(instance: {waitUntilRenderFlush(): Promise<void>}): Promise<void> {
  await effectsSettled();
  await instance.waitUntilRenderFlush();
}

/** Waits for terminal output that satisfies the predicate and returns it. */
export async function waitForOutput(read: () => string, predicate: (value: string) => boolean): Promise<string> {
  await waitFor(() => predicate(read()), 'the expected terminal output', () => `Received:\n${read()}`);
  return read();
}

const ESCAPE = '\x1b';
// Ink holds a lone Escape this long in case it starts a key sequence (`pendingInputFlushDelay`).
const inkEscapeDelayMilliseconds = 20;

/**
 * Sends one key and returns once Ink has handled it. Ink reads stdin and runs the key handlers
 * synchronously, so an empty input buffer means the key was handled, except a lone Escape, which
 * Ink passes on from a timer. A timer started afterwards with the same delay fires after Ink's, as
 * Node fires timers by deadline. Then whatever the key showed starts listening for keys.
 *
 * Asynchronous work a key starts, such as a save or a load, still needs a `waitFor` on its outcome.
 */
export async function pressKey(input: NodeJS.WritableStream & {readonly readableLength: number}, key: string): Promise<void> {
  input.write(key);
  await waitFor(() => input.readableLength === 0, 'the key is handled');
  if (key === ESCAPE) {
    await new Promise<void>(resolve => setTimeout(resolve, inkEscapeDelayMilliseconds));
    await effectsSettled();
  }
}
