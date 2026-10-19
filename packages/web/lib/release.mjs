// Which truedone surfaces are released (WEB-12): the one place a release flips. Every page that names a surface still
// false here says "Not released yet" with a link to follow the first release, and home's "What works today" lists it
// as coming with that release. /why is static and says the same in one line, which release-state.test.mjs ties to
// these values. REL-P4 (D35): a surface is true here only with a Works row, naming its build and its evidence, in the
// "## Acceptance" table of docs/releases/preview-0.1.0.md, which release-acceptance.test.mjs holds.
export const RELEASED = { cli: true, action: false, app: true, plugin: true };
export const FOLLOW = 'https://github.com/Truedone/truedone';
export const SURFACES = { cli: 'the command line (npx truedone)', action: 'the GitHub Action', app: 'the GitHub App', plugin: 'the Claude Code plugin' };
