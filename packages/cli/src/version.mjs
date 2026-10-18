// The command line's version (REL-P1, D35): the 0.1.0 preview. tools/bundle.mjs writes the published file's VERSION
// line from packages/cli/package.json, and tools/test/release-preview.test.mjs holds this one to package.json too, so
// the source, the bundle and the package cannot drift apart.
export const VERSION = '0.1.0';
export const VERSION_LINE = `truedone ${VERSION} (preview)`;
