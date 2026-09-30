/**
 * Colour for secondary text such as hints, metadata, and unselected options.
 *
 * Used instead of Ink's `dimColor`, whose faint rendering is left to the terminal and is often
 * hard to read. Ink downsamples the hex value on terminals without truecolour support.
 */
export const mutedColor = '#999999';

/** Colour of document headings; they are also bold, so they stand out without colour. */
export const headingColor = '#5fafff';

/** Colour of inline code in documents, such as file names and values. */
export const codeColor = '#d7af5f';
