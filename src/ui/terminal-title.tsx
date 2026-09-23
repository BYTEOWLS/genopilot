import React, {createContext, useContext, useEffect, useRef, useState} from 'react';

export type TerminalTitleStatus = 'running' | 'succeeded' | 'failed';

export const terminalTitleStatusIcons: Record<TerminalTitleStatus, string> = {
  running: '⏳',
  succeeded: '✔',
  failed: '✖',
};

export type TerminalTitleContribution = {label?: string; status?: TerminalTitleStatus};

const separator = ' — ';

/**
 * Builds the title from the application's base title and the contributions of mounted screens,
 * ordered from outermost to innermost. The most specific label comes first so it survives
 * truncated tab titles, and the innermost status decides the icon.
 */
export function formatTerminalTitle(
  baseTitle: string,
  contributions: readonly TerminalTitleContribution[],
): string {
  const labels = contributions
    .map(contribution => contribution.label?.trim())
    .filter((label): label is string => Boolean(label));
  const status = [...contributions].reverse().find(contribution => contribution.status)?.status;
  const title = [...labels.reverse(), baseTitle].join(separator);
  return status ? `${terminalTitleStatusIcons[status]} ${title}` : title;
}

class TitleRegistry {
  private readonly contributions = new Map<number, TerminalTitleContribution>();
  private publishScheduled = false;

  constructor(
    private baseTitle: string,
    private onTitleChange: (title: string) => void,
  ) {}

  configure(baseTitle: string, onTitleChange: (title: string) => void): void {
    this.baseTitle = baseTitle;
    this.onTitleChange = onTitleChange;
    this.publish();
  }

  set(order: number, contribution: TerminalTitleContribution): void {
    this.contributions.set(order, contribution);
    this.publish();
  }

  delete(order: number): void {
    this.contributions.delete(order);
    this.publish();
  }

  // A label change unregisters and re-registers within one commit, so publishing is deferred
  // until the commit settles instead of briefly showing the title without that label.
  private publish(): void {
    if (this.publishScheduled) {
      return;
    }
    this.publishScheduled = true;
    queueMicrotask(() => {
      this.publishScheduled = false;
      this.publishNow();
    });
  }

  private publishNow(): void {
    const ordered = [...this.contributions.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, contribution]) => contribution);
    this.onTitleChange(formatTerminalTitle(this.baseTitle, ordered));
  }
}

const TitleRegistryContext = createContext<TitleRegistry | undefined>(undefined);

/** Publishes the terminal title composed by every `useTerminalTitle` call beneath it. */
export function TerminalTitleProvider({
  baseTitle,
  onTitleChange,
  children,
}: {
  baseTitle: string;
  onTitleChange: (title: string) => void;
  children: React.ReactNode;
}): React.JSX.Element {
  const registry = useRef<TitleRegistry | undefined>(undefined);
  registry.current ??= new TitleRegistry(baseTitle, onTitleChange);
  useEffect(() => {
    registry.current?.configure(baseTitle, onTitleChange);
  }, [baseTitle, onTitleChange]);
  return (
    <TitleRegistryContext.Provider value={registry.current}>{children}</TitleRegistryContext.Provider>
  );
}

// Components render parent-first, so an order taken during the first render places a screen's
// contribution after those of the screens that contain it. Effects run child-first and could not.
let nextOrder = 0;

/**
 * Adds a label and optional status to the terminal title while the calling component is
 * mounted. Without a provider, for example in isolated tests, the call has no effect.
 */
export function useTerminalTitle({label, status}: TerminalTitleContribution): void {
  const registry = useContext(TitleRegistryContext);
  const [order] = useState(() => nextOrder++);
  useEffect(() => {
    if (!registry) {
      return;
    }
    registry.set(order, {label, status});
    return () => registry.delete(order);
  }, [registry, order, label, status]);
}
