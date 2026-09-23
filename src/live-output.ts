export type LiveOutputStream = 'stdout' | 'stderr';

export const maximumLiveLogLineCharacters = 4096;
export const truncatedLiveLogMarker = '… [truncated]';

type BufferedLine = {text: string; truncated: boolean};

/** Preserves lines across process chunks while bounding every terminal-rendered line. */
export class LiveOutputBuffer {
  private readonly lines: Record<LiveOutputStream, BufferedLine> = {
    stdout: {text: '', truncated: false},
    stderr: {text: '', truncated: false},
  };

  constructor(private readonly emit: (lines: readonly string[]) => void) {}

  private appendFragment(stream: LiveOutputStream, fragment: string): void {
    const line = this.lines[stream];
    if (line.truncated) {
      return;
    }
    const available =
      maximumLiveLogLineCharacters - truncatedLiveLogMarker.length - line.text.length;
    if (fragment.length > available) {
      line.text += `${fragment.slice(0, Math.max(0, available))}${truncatedLiveLogMarker}`;
      line.truncated = true;
    } else {
      line.text += fragment;
    }
  }

  private takeLine(stream: LiveOutputStream): string {
    const text = this.lines[stream].text;
    this.lines[stream] = {text: '', truncated: false};
    return text;
  }

  append(stream: LiveOutputStream, chunk: string): void {
    const parts = chunk.split(/\r\n|\r|\n/);
    const remainder = parts.pop() ?? '';
    const completeLines: string[] = [];
    for (const part of parts) {
      this.appendFragment(stream, part);
      const line = this.takeLine(stream);
      if (line.length > 0) {
        completeLines.push(line);
      }
    }
    this.appendFragment(stream, remainder);
    if (completeLines.length > 0) {
      this.emit(completeLines);
    }
  }

  flush(): void {
    const remaining = (['stdout', 'stderr'] as const)
      .map(stream => this.takeLine(stream))
      .filter(line => line.length > 0);
    if (remaining.length > 0) {
      this.emit(remaining);
    }
  }
}
