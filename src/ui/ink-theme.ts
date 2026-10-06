import {defaultTheme, extendTheme, type ComponentTheme} from '@inkjs/ui';
import {infoColor} from './theme.js';

type AlertProps = {variant: 'info' | 'success' | 'error' | 'warning'};
const alert = defaultTheme.components.Alert as ComponentTheme;
const style = (name: string) => alert.styles?.[name] as (props: AlertProps) => Record<string, unknown>;

/** Ink UI's theme with a lighter info alert: its border and icon use `infoColor`. */
export const inkTheme = extendTheme(defaultTheme, {
  components: {
    Alert: {
      styles: {
        container: (props: AlertProps) => ({...style('container')(props), ...(props.variant === 'info' ? {borderColor: infoColor} : {})}),
        icon: (props: AlertProps) => ({...style('icon')(props), ...(props.variant === 'info' ? {color: infoColor} : {})}),
      },
    },
  },
});
