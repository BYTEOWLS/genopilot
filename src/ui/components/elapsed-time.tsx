import React, {useEffect, useState} from 'react';
import {Text} from 'ink';
import {formatDuration} from '../../workflows/run-timing.js';
import {mutedColor} from '../theme.js';

function elapsedSeconds(startedAt: number, at: number): number {
  return Math.max(0, Math.floor((at - startedAt) / 1000));
}

/**
 * The time since `startedAt`, frozen at `endedAt` once given. It owns its tick, so only this line
 * re-renders each second, not the screen around it with its log.
 */
export const ElapsedTime = React.memo(function ElapsedTime({
  startedAt,
  endedAt,
}: {
  /** Epoch milliseconds. */
  startedAt: number;
  endedAt?: number;
}): React.JSX.Element {
  const [seconds, setSeconds] = useState(() => elapsedSeconds(startedAt, endedAt ?? Date.now()));

  useEffect(() => {
    if (endedAt !== undefined) {
      setSeconds(elapsedSeconds(startedAt, endedAt));
      return undefined;
    }
    let timer: NodeJS.Timeout | undefined;
    const tick = () => {
      const elapsedMs = Math.max(0, Date.now() - startedAt);
      // An unchanged value is skipped by React, so only a new second renders.
      setSeconds(Math.floor(elapsedMs / 1000));
      // Waking at the next whole second keeps the display in step without polling faster.
      timer = setTimeout(tick, 1000 - (elapsedMs % 1000));
    };
    tick();
    return () => {
      clearTimeout(timer);
    };
  }, [startedAt, endedAt]);

  return <Text color={mutedColor}>Elapsed {formatDuration(seconds * 1000)}</Text>;
});
