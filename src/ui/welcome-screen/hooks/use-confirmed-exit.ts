import {useCallback, useEffect, useRef, useState} from 'react';

/** Models the required two-step Ctrl+C exit behavior and its timeout. */
export function useConfirmedExit({
  confirmationMilliseconds,
  onConfirmed,
}: {
  confirmationMilliseconds: number;
  onConfirmed: () => void;
}): {showConfirmation: boolean; handleCtrlC: () => void} {
  const armed = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [showConfirmation, setShowConfirmation] = useState(false);

  useEffect(() => () => {
    if (timer.current) {
      clearTimeout(timer.current);
    }
  }, []);

  const handleCtrlC = useCallback((): void => {
    if (armed.current) {
      if (timer.current) {
        clearTimeout(timer.current);
      }
      onConfirmed();
      return;
    }
    armed.current = true;
    setShowConfirmation(true);
    timer.current = setTimeout(() => {
      armed.current = false;
      setShowConfirmation(false);
    }, confirmationMilliseconds);
  }, [confirmationMilliseconds, onConfirmed]);

  return {showConfirmation, handleCtrlC};
}
