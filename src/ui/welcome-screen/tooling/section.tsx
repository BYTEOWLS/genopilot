import React, {useEffect, useState, type ReactNode} from 'react';
import {Box, Text} from 'ink';
import type {ToolCheckResult, ToolingStatus} from '../../../tooling/check.js';
import {toolingPolicy} from '../../../tooling/policy.js';
import {sanitizeTerminalText} from '../../sanitize.js';
import {LiveLog} from '../../live-log.js';
import {mutedColor} from '../../theme.js';

const spinnerIntervalMilliseconds = 80;
const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;

function displayVersion(versionOutput: string): string {
  const match = versionOutput.match(/(?:^|[^\d])v?(\d+\.\d+(?:\.\d+)?)/);
  return match?.[1] ? `v${match[1]}` : sanitizeTerminalText(versionOutput);
}

function ToolAvailability({
  result,
  name,
  purpose,
  targetVersion,
}: {
  result: ToolCheckResult;
  name: string;
  purpose: string;
  targetVersion: string;
}): React.JSX.Element {
  const [spinnerFrame, setSpinnerFrame] = useState(0);

  useEffect(() => {
    if (result.state !== 'installing' && result.state !== 'verifying') {
      return;
    }
    const timer = setInterval(() => {
      setSpinnerFrame(frame => (frame + 1) % spinnerFrames.length);
    }, spinnerIntervalMilliseconds);
    return () => clearInterval(timer);
  }, [result.state]);

  if (result.state === 'installing' || result.state === 'verifying') {
    return (
      <Text color="cyan">
        {spinnerFrames[spinnerFrame]} {name} — {purpose} — {targetVersion} —{' '}
        {result.state === 'installing' ? 'Installing…' : 'Verifying…'}
      </Text>
    );
  }
  if (result.state === 'missing') {
    return <Text color={mutedColor}>○ {name} — {purpose} — {targetVersion} — Not detected</Text>;
  }
  if (result.state === 'failed') {
    return (
      <Text color={mutedColor}>
        ○ {name} — {purpose} — {targetVersion} — Check failed:{' '}
        {sanitizeTerminalText(result.message)}
      </Text>
    );
  }
  if (result.state === 'incompatible') {
    return (
      <Text color={mutedColor}>
        ○ {name} — {purpose} — {displayVersion(result.detected.version)} — Incompatible; target{' '}
        {targetVersion}
      </Text>
    );
  }
  return (
    <Text color="green">
      ✓ {name} — {purpose} — {displayVersion(result.detected.version)} — Available
    </Text>
  );
}

export function ToolingList({
  status,
}: {
  status: Extract<ToolingStatus, {node: ToolCheckResult}>;
}): React.JSX.Element {
  return (
    <Box flexDirection="column">
      <ToolAvailability result={status.node} name="Node" purpose="Runtime" targetVersion={`v${toolingPolicy.node.installationVersion}`} />
      <ToolAvailability result={status.pixi} name="Pixi" purpose="Provisioning" targetVersion={`v${toolingPolicy.pixi.managedVersion}`} />
      <ToolAvailability result={status.conda} name="Conda" purpose="Environments" targetVersion={`v${toolingPolicy.conda.managedVersion}`} />
      <ToolAvailability result={status.snakemake} name="Snakemake" purpose="Workflow" targetVersion={`v${toolingPolicy.snakemake.managedVersion}`} />
    </Box>
  );
}

export function ToolingSection({
  status,
  setupMessage,
  installationLogLines,
  children,
}: {
  status: ToolingStatus;
  setupMessage?: string;
  installationLogLines: readonly string[];
  children?: ReactNode;
}): React.JSX.Element {
  if (status.state === 'checking') {
    return <Text color={mutedColor}>Checking tooling availability…</Text>;
  }
  if (status.state === 'check-failed') {
    return (
      <Box flexDirection="column">
        <Text color="red">Tooling check failed: {sanitizeTerminalText(status.message)}</Text>
        <Text>Press R to check again.</Text>
      </Box>
    );
  }

  if (status.state === 'setup-required') {
    return (
      <Box flexDirection="column">
        <Text bold>Required tooling: Setup required</Text>
        <ToolingList status={status} />
        <Box marginTop={1} flexDirection="column">
          <Text bold>Install missing tooling now? [Y/n]</Text>
          <Text color={mutedColor}>Yes (Y) is the default.</Text>
          {setupMessage ? <Text color="yellow">{sanitizeTerminalText(setupMessage)}</Text> : null}
        </Box>
      </Box>
    );
  }
  if (status.state === 'installing') {
    return (
      <Box flexDirection="column">
        <Text bold>Required tooling: Installing</Text>
        <ToolingList status={status} />
        <LiveLog title="Installation log" lines={installationLogLines} />
        <Text color={mutedColor}>Do not close this terminal.</Text>
      </Box>
    );
  }
  return <>{children}</>;
}
