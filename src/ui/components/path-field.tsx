import {homedir} from 'node:os';
import {dirname, isAbsolute, join} from 'node:path';
import React from 'react';
import {useInput} from 'ink';
import {PathBrowser, type DirectoryReader} from './path-browser.js';
import {TextField} from './text-field.js';

/** Expands a leading `~` the way a shell would, since researchers often paste home-relative paths. */
export function expandHomeDirectory(path: string, homeDirectory = homedir()): string {
  if (path === '~') {
    return homeDirectory;
  }
  return path.startsWith('~/') ? join(homeDirectory, path.slice(2)) : path;
}

/**
 * A file path that is typed or pasted, or chosen with Enter from the file browser. The browser
 * opens beside the current value, else in `startDirectory`.
 *
 * While `browsing`, the field renders only the browser, so its form shows nothing else and
 * ignores its own keys; the form owns that state so it can do both.
 */
export function PathField({
  label,
  required = false,
  selected,
  inputActive,
  value,
  onChange,
  browsing,
  onBrowsingChange,
  startDirectory,
  placeholder = 'Type or paste a path, or press Enter to browse',
  readDirectory,
}: {
  label: string;
  required?: boolean;
  selected: boolean;
  inputActive: boolean;
  value: string;
  onChange: (value: string) => void;
  browsing: boolean;
  onBrowsingChange: (browsing: boolean) => void;
  startDirectory: string;
  placeholder?: string;
  readDirectory?: DirectoryReader;
}): React.JSX.Element {
  useInput(
    (_input, key) => {
      if (key.return) {
        onBrowsingChange(true);
      }
    },
    {isActive: inputActive && selected && !browsing},
  );

  if (browsing) {
    const current = expandHomeDirectory(value.trim());
    return (
      <PathBrowser
        initialDirectory={isAbsolute(current) ? dirname(current) : startDirectory}
        onSelect={path => {
          onChange(path);
          onBrowsingChange(false);
        }}
        onCancel={() => onBrowsingChange(false)}
        inputActive={inputActive}
        readDirectory={readDirectory}
      />
    );
  }

  return (
    <TextField
      label={label}
      required={required}
      selected={selected}
      inputActive={inputActive}
      defaultValue={value}
      displayValue={value.length > 0 ? value : 'Not set'}
      placeholder={placeholder}
      onChange={onChange}
    />
  );
}
