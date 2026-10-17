# 06 Release requirements

Source section: Release requirements

All eight requirements are met before the app is offered at the end of week 4, and still met at the week-6 proof release.

- **R1.** `LICENSE` (D21), `SECURITY.md` with a contact address, and a privacy note and terms on truedone.dev that say what the app reads and stores, and for how long.
- **R2.** npm releases go through trusted publishing from the release workflow, with provenance. There is no npm token on any machine. The release job needs Ryan's approval.
- **R3.** The action is released by tag and SHA to `mgillr/truedone-action`. The app knows the published release SHAs (D18).
- **R4.** Monitoring and alerts to Ryan: webhook errors, queue age, label latency p50 and p95, and a dead-letter queue.
- **R5.** A switch that stops all posting within one minute without a deploy, and `enabled: false` per repository.
- **R6.** On uninstall, stored data for that installation is deleted within 24 hours. Labels already set stay, and the README says so.
- **R7.** A load test at 1,000 installs' webhook volume before the app is offered, with the measured cost published.
- **R8.** The index has a public corrections log and a contact, and a correction is published within one week.

## Flow

```mermaid
flowchart TD
  R1["R1: LICENSE, SECURITY.md contact, privacy note and terms on truedone.dev"] --> ALL{"R1 to R8 all met?"}
  R2["R2: npm trusted publishing with provenance; release job approved by Ryan"] --> ALL
  R3["R3: action released by tag and SHA to mgillr/truedone-action; the app knows the SHAs"] --> ALL
  R4["R4: monitoring and alerts to Ryan"] --> ALL
  R5["R5: posting switch within one minute; enabled: false per repository"] --> ALL
  R6["R6: uninstall deletes stored data within 24 hours"] --> ALL
  R7["R7: load test at 1,000 installs' webhook volume, cost published"] --> ALL
  R8["R8: index corrections log and contact, a correction within one week"] --> ALL
  ALL -->|yes| OFFER["the app is offered, end of week 4"]
  OFFER --> STILL{"all still met?"}
  STILL -->|yes| W6["week-6 proof release"]
```

## Schematic

```mermaid
flowchart LR
  subgraph POLICY["documents"]
    direction TB
    LIC["LICENSE, D21"]
    SECM["SECURITY.md with a contact address"]
    PRIV["privacy note and terms on truedone.dev: what the app reads and stores, and for how long"]
  end
  subgraph RELEASE["releases"]
    direction TB
    WF["release workflow, release job needs Ryan's approval"]
    NPM["npm, trusted publishing with provenance, no npm token on any machine"]
    ACTR["mgillr/truedone-action, released by tag and SHA"]
    WF --> NPM
  end
  subgraph APPOPS["app operation"]
    direction TB
    APP["app"]
    MON["monitoring and alerts to Ryan: webhook errors, queue age, label latency p50 and p95, dead-letter queue"]
    SW["switch: stops all posting within one minute, no deploy"]
    EN["enabled: false per repository"]
    UNI["uninstall: stored data deleted within 24 hours; labels already set stay"]
    LT["load test at 1,000 installs' webhook volume, measured cost published"]
  end
  subgraph INDEX["index"]
    direction TB
    CL["public corrections log and contact"]
    CW["a correction published within one week"]
    CL --> CW
  end
  README["README"]
  ACTR -->|published release SHAs, D18| APP
  MON --> APP
  SW --> APP
  EN --> APP
  UNI --> APP
  LT -->|before the app is offered| APP
  UNI -.->|says labels stay| README
```

[Back to the master schematic](00-master.md)
