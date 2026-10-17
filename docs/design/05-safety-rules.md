# 05 Safety rules

Source section: Safety rules

- **S1.** The CLI and plugin never leave the user's files changed. Before the base swap they record the changed files' contents and hashes in `.git/truedone-restore`. Afterwards they restore the files and check every hash. A run that finds the record restores first. If a file changed during the run, they stop and say so.
- **S2.** In CI the action restores the checkout exactly: the same HEAD and the same `git status --porcelain` output as before. Otherwise the step reports Could not run and fails.
- **S3.** truedone's app and website never execute PR code. The gate harness runs sampled PRs on GitHub-hosted runners in truedone's public repository, with `permissions: {}`, no secrets and no cache shared with releases.
- **S4.** When the CLI runs someone else's PR, the PR's code gets the environment minus every variable ending in `_TOKEN`, `_SECRET`, `_KEY` or `_PASSWORD`, and minus `AWS_*`, `AZURE_*`, `GOOGLE_APPLICATION_CREDENTIALS` and `NPM_CONFIG_*`.
- **S5.** The app's private key, webhook secret and OAuth client secret exist only as Cloudflare Worker secrets that Ryan sets, never in the repository or on an agent machine. Lanes test against a separate development app installed only on `mgillr/truedone-sandbox`, with its own key.
- **S6.** Webhooks: the signature is checked in constant time, each delivery id is handled once, and events for removed installations are dropped. Artifacts over 256 KB, or holding more than one file, are refused before unzipping.
- **S7.** PR titles, bodies and paths are shown as text only. truedone.pages.dev uses no `innerHTML` for them and sets a content security policy that allows scripts from itself, and connections only to itself (the precomputed pages), `api.github.com`, raw.githubusercontent.com (D24) and the token exchange https://truedone-exchange.ledgerguard-global.workers.dev (D26, WEB-02). Check summaries and comments escape Markdown and neutralise `@` mentions taken from PR content.
- **S8.** The Worker logs installation id, repository id, PR number, verdict and timings, never diff content, file contents or PR text. The sign-in token stays in the visitor's session storage, requests no scopes, and is sent only to `api.github.com`.

## Flow

```mermaid
flowchart TD
  subgraph LOCAL["S1: CLI and plugin red-green run"]
    direction TB
    L0{"a .git/truedone-restore record exists?"}
    L0 -->|yes| LR["restore first"]
    L0 -->|no| L1["record the changed files' contents and hashes in .git/truedone-restore"]
    LR --> L1
    L1 --> L2["base swap and run"]
    L2 --> L3{"a file changed during the run?"}
    L3 -->|yes| LS["stop and say so"]
    L3 -->|no| L4["restore the files and check every hash"]
  end
  subgraph CI["S2: the action in CI"]
    direction TB
    C1["note HEAD and git status --porcelain"] --> C2["run"]
    C2 --> C3{"same HEAD and same git status --porcelain output as before?"}
    C3 -->|no| C4["the step reports Could not run and fails"]
  end
  subgraph HOOK["S6: a webhook delivery"]
    direction TB
    W1{"signature valid, checked in constant time?"} -->|yes| W2{"delivery id already handled?"}
    W2 -->|no| W3{"installation removed?"}
    W2 -->|yes| W7["not handled again"]
    W3 -->|yes| W4["event dropped"]
    W3 -->|no| W5{"artifact over 256 KB, or more than one file?"}
    W5 -->|yes| W6["refused before unzipping"]
  end
  subgraph ENV["S4: the CLI runs someone else's PR"]
    direction TB
    E1["the user's environment"] --> E2["minus *_TOKEN, *_SECRET, *_KEY, *_PASSWORD, AWS_*, AZURE_*, GOOGLE_APPLICATION_CREDENTIALS, NPM_CONFIG_*"]
    E2 --> E3["the PR's code"]
  end
```

## Schematic

```mermaid
flowchart LR
  CLI["CLI"]
  PLG["plugin"]
  ACT["action in CI"]
  APP["app and its Cloudflare Worker"]
  WEB["truedone.pages.dev website"]
  HAR["gate harness: GitHub-hosted runners in truedone's public repository, permissions: {}, no secrets, no cache shared with releases"]
  SEC["Cloudflare Worker secrets set by Ryan: private key, webhook secret, OAuth client secret"]
  DEV["development app, installed only on mgillr/truedone-sandbox, with its own key"]
  LANES["lanes"]
  GHA["api.github.com"]
  S1["S1: files restored and every hash checked"]
  S2["S2: checkout restored exactly"]
  S3["S3: never execute PR code"]
  S4["S4: credential variables removed"]
  S6["S6: webhook and artifact checks"]
  S7["S7: PR text shown as text only; CSP; Markdown escaped, @ mentions neutralised"]
  S8["S8: logs hold ids, verdict and timings only; sign-in token in session storage, no scopes"]
  CLI --- S1
  PLG --- S1
  CLI --- S4
  ACT --- S2
  APP --- S3
  WEB --- S3
  APP --- S6
  APP --- S7
  WEB --- S7
  APP --- S8
  WEB --- S8
  SEC --> APP
  LANES -->|test against| DEV
  WEB -->|sign-in token sent only here| GHA
  HAR -.->|runs sampled PRs| S3
```

[Back to the master schematic](00-master.md)
