// Which truedone surfaces are released (WEB-12): the one place a release flips. Every page that names a surface still
// false here says "Not released yet" with a link to follow the first release, and home's "What works today" lists it
// as coming with that release. /why is static and says the same in one line, which release-state.test.mjs ties to
// these values.
export const RELEASED = { cli: false, action: false, app: false, plugin: false };
export const FOLLOW = 'https://github.com/Truedone/truedone';
export const SURFACES = { cli: 'the command line (npx truedone)', action: 'the GitHub Action', app: 'the GitHub App', plugin: 'the Claude Code plugin' };
