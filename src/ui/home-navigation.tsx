import {createContext, useCallback, useContext, useEffect, useState} from 'react';

/**
 * Why the home shortcut is unavailable: `typing` hands the key to a focused text field, and
 * `busy` protects work that must not be abandoned, such as a running workflow.
 */
export type HomeSuspension = 'typing' | 'busy';

export type HomeSuspender = (id: number, suspension: HomeSuspension | undefined) => void;

export const HomeSuspensionContext = createContext<HomeSuspender | undefined>(undefined);

/**
 * Collects the suspensions reported by mounted screens. `busy` wins over `typing`, because the
 * shortcut must stay blocked while work runs even if a field also has focus.
 */
export function useHomeSuspensions(): {suspension: HomeSuspension | undefined; suspend: HomeSuspender} {
  const [suspensions, setSuspensions] = useState<ReadonlyMap<number, HomeSuspension>>(new Map());
  const suspend = useCallback<HomeSuspender>((id, suspension) => {
    setSuspensions(current => {
      if (current.get(id) === suspension) {
        return current;
      }
      const next = new Map(current);
      if (suspension) {
        next.set(id, suspension);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, []);
  const values = [...suspensions.values()];
  const suspension = values.includes('busy') ? 'busy' : values.includes('typing') ? 'typing' : undefined;
  return {suspension, suspend};
}

let nextId = 0;

/**
 * Suspends the home shortcut while the calling component is mounted and `suspension` is set.
 * Without a provider, for example in isolated tests, the call has no effect.
 */
export function useHomeSuspension(suspension: HomeSuspension | undefined): void {
  const suspend = useContext(HomeSuspensionContext);
  const [id] = useState(() => nextId++);
  useEffect(() => {
    if (!suspend || !suspension) {
      return;
    }
    suspend(id, suspension);
    return () => suspend(id, undefined);
  }, [suspend, id, suspension]);
}
