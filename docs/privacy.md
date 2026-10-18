# Privacy

This note covers each part of truedone: the site at truedone.pages.dev, its token exchange, the GitHub App, the action,
and the CLI and plugin from npm.

## What we read

- **The site.** Your browser reads the pull request you open, its file list, and the changed test, workflow and
  runner-config files at base and head, straight from api.github.com and raw.githubusercontent.com. If you sign in,
  your browser sends your GitHub token with the api.github.com requests and with no other request.
- **The token exchange.** When you sign in, it reads the one-time code GitHub gives your browser. It trades that code
  for your token with GitHub and returns the token to your browser.
- **The GitHub App.** On the repositories where it is installed, it reads each pull request's title, body and author,
  its changed files and the contents the checks need, the repository's `.github/truedone.yml`, and the report the
  truedone action uploads. Its permissions are: contents and metadata read, actions read, checks write, and pull
  requests write for the label and the comment. It never runs the pull request's code.
- **The action.** It runs in your workflow, on your runner. It reads the checkout and runs the pull request's changed
  tests there.
- **The CLI and the plugin.** They run on your machine. They read your local repository, or a pull request you name,
  from api.github.com. They send nothing to truedone.

## What we store

- **The site** stores nothing on a server. During your visit, your browser's session storage holds the sign-in state
  and, once you sign in, your token. The site sets no cookies and has no analytics.
- **The token exchange** stores nothing. It has no storage and writes no log line.
- **The GitHub App** keeps one setting per installation, the switch that turns its posting off. Its log lines hold the
  installation id, the repository id, the pull request number, the verdict and timings, and never diff content, file
  contents or pull request text. A delivery waiting in its queue holds only identifiers: the installation, repository
  and pull request numbers, the commit shas, the event's action, and the repository's owner and name. In your
  repository it writes one check run per head commit and at most one `truedone:*` label per pull request. It writes a
  comment only when the repository sets `comments: on`.
- **The action** uploads one report per job to your workflow run.
- **The CLI and the plugin** store nothing outside your machine. During a red-green run they keep a restore record
  in `.git/truedone-restore`, and they delete it once your files are back as they were.

## How long

- The site's session storage lasts until you close the tab.
- The app's setting lasts while the app is installed, and it is deleted within 24 hours of an uninstall. Labels
  already set stay after uninstall, as do check runs and comments, since they belong to your repository.
- A delivery waits in the app's queue only until it is handled. One that keeps failing goes to a dead-letter queue,
  where it is logged by its identifiers and dropped.
- The app's log lines are not stored. They can be read only live, while I watch the Worker's log stream, and neither
  truedone nor Cloudflare keeps a copy. Cloudflare keeps its own counts and timings of the Worker's requests.
- An action report lasts as long as your repository keeps workflow artifacts.

## Who to ask

Contact: data@optitransfer.ch

Approved by Ryan Gillespie on 2026-10-18
