import {sanitizeTerminalText} from "./sanitize.js";

/**
 * Formats a timestamp in the environment's locale and timezone.
 *
 * Both are resolved by `Intl` from the host environment (`LC_ALL`/`LANG` and
 * `TZ` on POSIX). Returns the input unchanged when it is not a valid date.
 *
 * @param value timestamp string parsable by `Date`
 */
export function formatLocalDateTime(value: string): string {
    const date = new Date(sanitizeTerminalText(value));
    if (Number.isNaN(date.valueOf())) {
        return value;
    }
    return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'medium',
    }).format(date);
}
