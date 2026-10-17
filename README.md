# truedone

Checks whether a pull request's tests prove its change.

truedone judges whether a change's tests went from red to green, from one shared core. The five packages are core, web, cli, app and action.

- packages/core holds the shared checks.
- packages/web holds the browser build.
- packages/cli holds the command line.
- packages/app holds the application.
- packages/action holds the GitHub Action.
