import {sanitizeTerminalText} from './ui/sanitize.js';

// Operating System Command sequences for the window/tab title (OSC 2) and the xterm title stack
// (CSI 22/23 t), which lets the previous title be restored on exit.
const setTitleSequence = (title: string): string => `\u001b]2;${title}\u0007`;
const pushTitleSequence = '\u001b[22;0t';
const popTitleSequence = '\u001b[23;0t';

export type TerminalTitleWriter = {
  set: (title: string) => void;
  restore: () => void;
};

type TitleStream = {isTTY?: boolean; write: (chunk: string) => unknown};

/**
 * Owns the terminal title for the lifetime of the application. The caller's title is saved on
 * creation and restored once; writes are skipped when the stream is not a terminal.
 */
export function createTerminalTitleWriter(stream: TitleStream): TerminalTitleWriter {
  if (!stream.isTTY) {
    return {set: () => {}, restore: () => {}};
  }
  stream.write(pushTitleSequence);
  let current: string | undefined;
  let restored = false;
  return {
    set: title => {
      const sanitized = sanitizeTerminalText(title);
      if (restored || sanitized === current) {
        return;
      }
      current = sanitized;
      stream.write(setTitleSequence(sanitized));
    },
    restore: () => {
      if (restored) {
        return;
      }
      restored = true;
      // Terminals without a title stack ignore the pop, so clear the title first to hand it back
      // to the terminal's own default instead of leaving the application's title behind.
      stream.write(setTitleSequence(''));
      stream.write(popTitleSequence);
    },
  };
}
