import assert from 'node:assert/strict';
import test from 'node:test';
import {defaultTheme} from '@inkjs/ui';
import {inkTheme} from '../../src/ui/ink-theme.js';
import {infoColor} from '../../src/ui/theme.js';

type Style = (props: {variant: string}) => Record<string, unknown>;
const styles = (theme: typeof defaultTheme) => theme.components.Alert!.styles as Record<string, Style>;

test('info alerts use the lighter info colour and the other variants keep Ink UI defaults', () => {
  assert.equal(styles(inkTheme).container!({variant: 'info'}).borderColor, infoColor);
  assert.equal(styles(inkTheme).icon!({variant: 'info'}).color, infoColor);
  for (const variant of ['success', 'error', 'warning']) {
    assert.deepEqual(styles(inkTheme).container!({variant}), styles(defaultTheme).container!({variant}));
    assert.deepEqual(styles(inkTheme).icon!({variant}), styles(defaultTheme).icon!({variant}));
  }
  assert.equal(styles(inkTheme).container!({variant: 'info'}).borderStyle, 'round', 'the rest of the style is kept');
});
