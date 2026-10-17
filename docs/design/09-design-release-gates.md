# 09 Release gates

Source section: From the design: release gates

There are two sets of gates. The static gates, 1 to 4, need only GitHub API reads over a corpus and a person's review of 200 flags, about two days of work, and must pass before the week-2 public release. The red-green gates, 3 and 4 repeated with execution plus gate 5, must pass before the red-green release. A failed gate stops the release it guards. Each gate names the next plan if it fails, and Ryan decides it in writing.

1. Are PRs without proof common? The share of 2,000 public PRs with an agent signal that change source and no test, from one 60-day window in JavaScript, TypeScript and Python repositories (sample spec: D12). Red-green later, on a sample of 200. Pass: at least 10%. If it fails: stop.
2. Does the label separate AI PRs from human ones? The same measurement on 2,000 PRs with no agent signal from the same repositories, window and mix of open, closed and merged, with PRs opened before 2024 reported beside it. Pass: the agent PRs' share is at least 10 points higher. If it fails: reposition as a general quality check, or stop.
3. Is it quiet and right enough to keep? Ryan, or a person he names who did not build the checks, reviews 200 Tampered and Test-changes flags (at least 50 Tampered) on PRs maintainers merged. With red-green, missed red and false Proven on the 200-PR sample. Pass: false Tampered under 5%, false Test changes: review under 20%, missed red and false Proven each under 5%. If it fails: fix before releasing, and never release at 5% or above.
4. Does it run with no configuration? Static: runner detection across the corpus repositories. With red-green: the share whose changed tests actually ran. Pass: 70% or more with no config line. If it fails: add runners or a one-line config.
5. Do maintainers want it? Ten maintainers of projects that have described AI-PR load get a precomputed truedone.pages.dev page of their own last 20 PRs in week 2, and the app when it is live at the end of week 4. Pass: at least 3 install the app by the end of week 6. If it fails: rethink the app and keep the other rungs.
6. Is the window still open? Ryan checks the GitHub changelog, CodeRabbit and Copilot review before each release. Pass: none ships a red-green or test-tamper check first. If it fails: lead with the plugin, the index and the paid tier.

Gates 1 and 2 also produce the launch post: the measured share of agent PRs that prove nothing, against the human baseline.

## Flow

```mermaid
flowchart TD
  CORP["GitHub API reads over a corpus, and a person's review of 200 flags"] --> SG["static gates 1 to 4"]
  SG --> SP{"all pass?"}
  SP -->|yes| PUB["week-2 public release"]
  SP -->|no| STOP1["that release stops; Ryan decides the next plan in writing"]
  EXE["gates 3 and 4 repeated with execution, plus gate 5"] --> RG["red-green gates"]
  RG --> RP{"all pass?"}
  RP -->|yes| RGR["red-green release"]
  RP -->|no| STOP2["that release stops; Ryan decides the next plan in writing"]
  G6["gate 6: Ryan checks the GitHub changelog, CodeRabbit and Copilot review"] -->|before each release| PUB
  G6 -->|before each release| RGR
  G12["gates 1 and 2"] --> POST["launch post: the measured share of agent PRs that prove nothing, against the human baseline"]
```

## Schematic

```mermaid
flowchart LR
  subgraph STATIC["static gates, before the week-2 public release"]
    direction TB
    G1["1: PRs without proof common? 2,000 agent-signal PRs; pass at least 10%; else stop"]
    G2["2: label separates AI from human PRs? 2,000 no-signal PRs; pass 10 points higher; else reposition or stop"]
    G3["3: quiet and right enough? 200 flags reviewed, at least 50 Tampered; false Tampered under 5%, false Test changes: review under 20%"]
    G4["4: runs with no configuration? runner detection across the corpus; pass 70% or more"]
  end
  subgraph RED["red-green gates, before the red-green release"]
    direction TB
    G3R["3 with execution: missed red and false Proven each under 5% on the 200-PR sample"]
    G4R["4 with execution: share whose changed tests actually ran"]
    G5["5: maintainers want it? ten maintainers; pass at least 3 install by the end of week 6"]
  end
  G6["6: window still open? checked before each release; else lead with the plugin, the index and the paid tier"]
  POST["launch post"]
  G1 --> POST
  G2 --> POST
  G3 -.->|repeated with execution| G3R
  G4 -.->|repeated with execution| G4R
  G6 --> STATIC
  G6 --> RED
```

[Back to the master schematic](00-master.md)
