// The plugin's own block limit (PLG-01, PV-P05): at most three blocks in a row with no change since the last one,
// well under Claude Code's override after eight (docs/plugin-hooks.md). A protected value: never raised by a lane.
export const MAX_BLOCKS = 3;
