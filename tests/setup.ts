// Tests read rendered frames as plain text. A color-capable terminal running the suite would
// otherwise make Ink emit color codes, so disable them before any test imports Ink.
process.env.FORCE_COLOR = '0';
