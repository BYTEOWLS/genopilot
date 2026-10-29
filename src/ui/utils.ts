import {sanitizeTerminalText} from "./sanitize.js";

/** Formats a date in the host locale, preserving date-only values across timezones. */
export function formatLocalDate(value: string): string {
    const sanitized = sanitizeTerminalText(value);
    const date = new Date(sanitized);
    if (Number.isNaN(date.valueOf())) {
        return value;
    }
    return new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        ...(/^\d{4}-\d{2}-\d{2}$/.test(sanitized) ? {timeZone: 'UTC'} : {}),
    }).format(date);
}

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
