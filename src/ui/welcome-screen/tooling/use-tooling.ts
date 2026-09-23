import {useCallback, useEffect, useRef, useState} from 'react';
import type {ToolCheckResult, ToolingStatus} from '../../../tooling/check.js';
import {
  ToolingInstallationError,
  type InstallationProgress,
  type InstallationResult,
} from '../../../tooling/installer.js';
import {toolingPolicy} from '../../../tooling/policy.js';
import {sanitizeTerminalText} from '../../sanitize.js';

const maximumRenderedLogLineCharacters = 4096;
const renderedLogTruncationMarker = '… [truncated]';

type ToolingCheck = () => Promise<ToolingStatus>;
type ToolingInstaller = (
  onProgress: (progress: InstallationProgress) => void,
  signal?: AbortSignal,
) => Promise<InstallationResult>;

function progressStatus(
  current: Extract<ToolingStatus, {node: ToolCheckResult}>,
  progress: Extract<InstallationProgress, {type: 'phase'}>,
): ToolingStatus {
  const installing = {state: 'installing'} as const;
  const verifying = {state: 'verifying'} as const;
  const available = (command: string, version: string): ToolCheckResult => ({
    state: 'available',
    detected: {command, version},
  });

  if (progress.phase === 'pixi') {
    return {...current, state: 'installing', pixi: installing};
  }
  if (progress.phase === 'runtime') {
    return {
      ...current,
      state: 'installing',
      pixi: available('pixi', toolingPolicy.pixi.managedVersion),
      conda: installing,
      snakemake: installing,
    };
  }
  if (progress.tools.includes('pixi')) {
    return {...current, state: 'installing', pixi: verifying};
  }
  return {
    ...current,
    state: 'installing',
    pixi: available('pixi', toolingPolicy.pixi.managedVersion),
    conda: progress.tools.includes('conda') ? verifying : current.conda,
    snakemake: progress.tools.includes('snakemake') ? verifying : current.snakemake,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Owns tooling-check and installation behavior independently from its presentation. */
export function useTooling({check, install}: {check: ToolingCheck; install: ToolingInstaller}) {
  const mounted = useRef(true);
  const installationRunning = useRef(false);
  const abortController = useRef<AbortController | undefined>(undefined);
  const afterCancellation = useRef<(() => void) | undefined>(undefined);
  const [status, setStatus] = useState<ToolingStatus>({state: 'checking'});
  const [setupMessage, setSetupMessage] = useState<string>();
  const [checkMessage, setCheckMessage] = useState<string>();
  const [installationLogLines, setInstallationLogLines] = useState<readonly string[]>([]);

  const runCheck = useCallback((reportCompletion: boolean): void => {
    setCheckMessage(undefined);
    setStatus({state: 'checking'});
    void check()
      .then(checked => {
        if (mounted.current) {
          setStatus(checked);
          if (reportCompletion) {
            setCheckMessage(
              checked.state === 'ready'
                ? 'Tooling check complete. All required tools are available.'
                : 'Tooling check complete. Setup is required.',
            );
          }
        }
      })
      .catch((error: unknown) => {
        if (mounted.current) {
          setStatus({state: 'check-failed', message: errorMessage(error)});
        }
      });
  }, [check]);

  useEffect(() => {
    mounted.current = true;
    runCheck(false);
    return () => {
      mounted.current = false;
    };
  }, [runCheck]);

  const startInstallation = useCallback((): void => {
    if (installationRunning.current || status.state !== 'setup-required') {
      return;
    }
    installationRunning.current = true;
    setSetupMessage(undefined);
    setInstallationLogLines([]);
    const originalStatus = status;
    let currentStatus: Extract<ToolingStatus, {node: ToolCheckResult}> = status;
    abortController.current = new AbortController();

    void install(progress => {
      if (progress.type === 'log') {
        const newLines = progress.text
          .split(/\r\n|\r|\n/)
          .map(sanitizeTerminalText)
          .filter(line => line.length > 0)
          .map(line => line.length > maximumRenderedLogLineCharacters
            ? `${line.slice(0, maximumRenderedLogLineCharacters - renderedLogTruncationMarker.length)}${renderedLogTruncationMarker}`
            : line);
        if (mounted.current && newLines.length > 0) {
          setInstallationLogLines(lines => [...lines, ...newLines].slice(-8));
        }
        return;
      }
      currentStatus = progressStatus(currentStatus, progress) as Extract<ToolingStatus, {node: ToolCheckResult}>;
      if (mounted.current) {
        setStatus(currentStatus);
      }
    }, abortController.current.signal)
      .then(async result => {
        const checked = await check();
        if (mounted.current) {
          setStatus(checked);
          setSetupMessage(`Setup log: ${sanitizeTerminalText(result.logPath)}`);
        }
      })
      .catch((error: unknown) => {
        if (mounted.current) {
          setStatus(originalStatus);
          const log = error instanceof ToolingInstallationError
            ? ` Log: ${sanitizeTerminalText(error.logPath)}`
            : '';
          setSetupMessage(`Setup failed: ${sanitizeTerminalText(errorMessage(error))}.${log}`);
        }
      })
      .finally(() => {
        installationRunning.current = false;
        abortController.current = undefined;
        afterCancellation.current?.();
        afterCancellation.current = undefined;
      });
  }, [check, install, status]);

  const cancelInstallationThen = useCallback((callback: () => void): void => {
    if (installationRunning.current) {
      afterCancellation.current = callback;
      abortController.current?.abort();
    } else {
      callback();
    }
  }, []);

  return {
    status,
    setupMessage,
    checkMessage,
    installationLogLines,
    setSetupMessage,
    clearCheckMessage: (): void => setCheckMessage(undefined),
    runCheck,
    startInstallation,
    cancelInstallationThen,
  };
}
