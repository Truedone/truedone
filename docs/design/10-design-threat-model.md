# 10 Threat model

Source section: From the design: threat model

The threat model is stated in the README. truedone catches careless agents and lazy shortcuts, which is the flood maintainers describe. Someone who controls a PR also controls the test code that runs in it. The static checks flag changes to runner config and setup files, but nothing on the PR side is a security boundary, and the README says so.

## Flow

```mermaid
flowchart TD
  PR["a PR"] --> SC["static checks"]
  SC --> FL["changes to runner config and setup files are flagged"]
  SC --> CA["careless agents and lazy shortcuts are caught"]
  CTRL["someone who controls the PR"] -->|also controls| TC["the test code that runs in it"]
  PR --> TC
  TC --> NB["nothing on the PR side is a security boundary"]
  NB --> RM["the README says so"]
```

## Schematic

```mermaid
flowchart LR
  subgraph PRSIDE["PR side: not a security boundary"]
    direction TB
    AUTH["whoever controls the PR"]
    TEST["test code"]
    RC["runner config"]
    SF["setup files"]
    AUTH --> TEST
    AUTH --> RC
    AUTH --> SF
  end
  subgraph TRUEDONE["truedone"]
    STAT["static checks"]
  end
  README["README: states the threat model"]
  RC -->|changes flagged| STAT
  SF -->|changes flagged| STAT
  TRUEDONE -.-> README
  PRSIDE -.-> README
```

[Back to the master schematic](00-master.md)
