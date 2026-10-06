#!/usr/bin/env node

import {createRequire} from 'node:module';
import React from 'react';
import {render} from 'ink';
import {selfUpdate} from './self-update.js';
import {BrowserViewProvider} from './browser/provider.js';
import {createTerminalTitleWriter} from './terminal-title.js';
import {createMouseWheelInput} from './ui/mouse-wheel.js';
import {TerminalTitleProvider} from './ui/terminal-title.js';
import {WelcomeScreen, type CliMetadata} from './ui/welcome-screen.js';

type PackageJson = {
  name: string;
  label: string;
  version: string;
  description: string;
  author: string | {name: string};
  license: string;
  bin: Record<string, string>;
};

// ESM cannot import JSON portably without import attributes, so create a local
// CommonJS-style require function anchored to this compiled module's location.
const require = createRequire(import.meta.url);
const packageJson = require('../package.json') as PackageJson;
const commandName = Object.keys(packageJson.bin)[0];

if (!commandName) {
  throw new Error('package.json must define a CLI command in "bin".');
}

// Show the command name in `ps` instead of the node/tsx invocation.
process.title = commandName;

// Keep displayed identity in sync with package.json instead of duplicating it.
const metadata: CliMetadata = {
  packageName: packageJson.name,
  label: packageJson.label,
  commandName,
  description: packageJson.description,
  author: typeof packageJson.author === 'string' ? packageJson.author : packageJson.author.name,
  version: packageJson.version,
  license: packageJson.license,
};

/** Runs non-interactive commands before mounting the interactive application. */
async function main(): Promise<void> {
  const arguments_ = process.argv.slice(2);
  if (arguments_[0] === 'update') {
    if (arguments_.length > 1) {
      console.error(`Usage: ${commandName} update`);
      process.exitCode = 2;
      return;
    }
    process.exitCode = await selfUpdate(packageJson.name, packageJson.version, {
      displayName: packageJson.label,
      commandName,
    });
    return;
  }

  /**
   * The alternate screen keeps repeated Ink renders out of terminal history.
   * Ink's built-in Ctrl+C exit is disabled because WelcomeScreen implements the
   * required two-press confirmation itself.
   */
  const terminalTitle = createTerminalTitleWriter(process.stdout);
  // The exit event also fires after an uncaught exception, so the caller's title comes back on
  // every exit path that lets Node shut down.
  process.once('exit', terminalTitle.restore);
  // The wheel scrolls like ↑/↓. Mouse reports follow Ink's key input; the exit event also covers
  // a crash that ends the process before Ink stops reading.
  const mouse = process.stdin.isTTY ? createMouseWheelInput(process.stdin, process.stdout) : undefined;
  if (mouse) {
    process.once('exit', mouse.dispose);
  }
  const instance = render(
    <TerminalTitleProvider baseTitle={packageJson.label} onTitleChange={terminalTitle.set}>
      <BrowserViewProvider application={{name: metadata.label, version: metadata.version}}>
        <WelcomeScreen metadata={metadata} currentDirectory={process.cwd()} mouseReporting={mouse !== undefined} />
      </BrowserViewProvider>
    </TerminalTitleProvider>,
    {
      alternateScreen: true,
      exitOnCtrlC: false,
      ...(mouse ? {stdin: mouse.stdin} : {}),
    },
  );
  await instance.waitUntilExit();
  mouse?.dispose();
  terminalTitle.restore();
}

await main();
