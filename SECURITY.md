# Security policy

## Reporting a vulnerability

Please do not report a vulnerability in a public issue, a pull request or a discussion. Send it privately to the
contact below, with what you found, the steps that show it, and what it lets someone do.

Contact: data@optitransfer.ch

## Response time

You get an answer within 7 days that the report arrived and says what happens next. A fix, or the reason there is none,
follows as soon as it is ready, and the report stays private until then.

## What is in scope

A weakness in truedone itself:

- the site at https://truedone.pages.dev and its token exchange at https://truedone-exchange.ledgerguard-global.workers.dev;
- the GitHub App and its Workers;
- the action `mgillr/truedone-action`;
- the `truedone` package on npm, which holds the CLI and the Claude Code plugin.

A pull request that defeats the checks through the test code it controls is not a vulnerability in this sense. As the
threat model in the README says, the pull request side is not a security boundary. Such a case is still useful as an
ordinary issue.

## Supported versions

truedone is pre-release. Until the first release, only the code on `main` is supported.
