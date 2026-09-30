import {PassThrough} from 'node:stream';

/**
 * Mouse-wheel scrolling for the whole application. Ink has no mouse support, so the terminal's
 * SGR mouse reports are translated into ↑/↓ before Ink reads its input: every screen that reacts
 * to the arrow keys reacts to the wheel in the same way, and no screen handles the mouse itself.
 */

/** Turns on button reporting (wheel included) in SGR encoding. */
export const enableMouseReporting = '\x1b[?1000h\x1b[?1006h';
export const disableMouseReporting = '\x1b[?1006l\x1b[?1000l';

const arrowUp = '\x1b[A';
const arrowDown = '\x1b[B';
const mouseReport = /\x1b\[<(\d+);\d+;\d+([Mm])/g;
// The start of a report that the next chunk completes. Only `ESC [ <` is held: a lone Esc or
// `ESC [`, which Alt+[ sends, is a key press and passes at once.
const partialReport = /\x1b\[<[\d;]*$/;
// Shift, Alt, and Ctrl add these bits to the button code.
const modifierBits = 4 | 8 | 16;

/**
 * Replaces wheel reports in `chunk` with arrow keys and drops every other mouse report, such as
 * clicks, so no screen receives them as typed text. `pending` is an incomplete report from the
 * previous chunk; the returned `pending` is carried into the next call.
 */
export function translateMouseInput(chunk: string, pending = ''): {output: string; pending: string} {
  let text = pending + chunk;
  const partial = partialReport.exec(text);
  const carried = partial ? partial[0] : '';
  text = text.slice(0, text.length - carried.length);
  const output = text.replace(mouseReport, (_report, code: string, action: string) => {
    const button = Number(code) & ~modifierBits;
    if (action !== 'M') {
      return '';
    }
    if (button === 64) {
      return arrowUp;
    }
    return button === 65 ? arrowDown : '';
  });
  return {output, pending: carried};
}

export type MouseWheelInput = {
  /** The input to give Ink in place of the terminal's stdin. */
  stdin: NodeJS.ReadStream;
  /** Stops mouse reports if they are still on, such as after a crash; safe to call more than once. */
  dispose: () => void;
};

/**
 * Wraps the terminal's stdin for Ink: its data passes through `translateMouseInput`, while raw
 * mode and keeping the process alive stay with the real stdin. Mouse reports follow Ink's raw
 * mode: they start when Ink starts reading keys and stop whenever it stops, including when it
 * unmounts, so the shell never receives them afterwards.
 */
export function createMouseWheelInput(
  source: NodeJS.ReadStream,
  output: {write: (text: string) => unknown},
): MouseWheelInput {
  const translated = new PassThrough({encoding: 'utf8'});
  let pending = '';
  const forward = (chunk: string | Buffer): void => {
    const result = translateMouseInput(chunk.toString(), pending);
    pending = result.pending;
    if (result.output.length > 0) {
      translated.write(result.output);
    }
  };
  let reporting = false;
  const setReporting = (on: boolean): void => {
    if (on === reporting) {
      return;
    }
    reporting = on;
    if (on) {
      source.setEncoding('utf8');
      source.on('data', forward);
      output.write(enableMouseReporting);
    } else {
      output.write(disableMouseReporting);
      source.off('data', forward);
      source.pause();
    }
  };

  // Ink refs the input while it reads keys and unrefs it when it stops; both go to the real stdin.
  const wrapper = Object.assign(translated, {
    isTTY: source.isTTY,
    setRawMode: (mode: boolean) => {
      source.setRawMode(mode);
      setReporting(mode);
      return wrapper;
    },
    ref: () => {
      source.ref();
      return wrapper;
    },
    unref: () => {
      source.unref();
      return wrapper;
    },
  }) as unknown as NodeJS.ReadStream;

  return {stdin: wrapper, dispose: () => setReporting(false)};
}
