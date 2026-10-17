# Design master schematic

One document per section of [docs/spec.md](../spec.md), the decisions and the requirements list excepted. Each node below is one document; an arrow means the section at its tail supplies something the section at its head uses, as the spec states it.

```mermaid
flowchart LR
  01-core["01 core"]
  02-checks-and-verdicts["02 Checks and verdicts"]
  03-report-configuration-labels-and-limits["03 Report, configuration, labels and limits"]
  04-cli-and-plugin["04 cli and plugin"]
  05-safety-rules["05 Safety rules"]
  06-release-requirements["06 Release requirements"]
  07-ryan-only["07 Ryan only"]
  08-design-verdicts["08 From the design: verdicts"]
  09-design-release-gates["09 From the design: release gates"]
  10-design-threat-model["10 From the design: threat model"]
  02-checks-and-verdicts -->|"analyse runs the static checks; judge applies the red-green outcomes"| 01-core
  03-report-configuration-labels-and-limits -->|"judge takes the reports; the config reader sits in core; limits are an input"| 01-core
  08-design-verdicts -->|"the verdict values of Result"| 01-core
  06-release-requirements -->|"R3: the published release SHAs, D18, are an input"| 01-core
  02-checks-and-verdicts -->|"the verdict each check gives"| 08-design-verdicts
  03-report-configuration-labels-and-limits -->|"limits and partial"| 08-design-verdicts
  01-core -->|"core bundled in the plugin; --json prints truedone.verdict/1"| 04-cli-and-plugin
  08-design-verdicts -->|"the verdicts the hook blocks on or shows; --fail-on"| 04-cli-and-plugin
  05-safety-rules -->|"S1 and S4"| 04-cli-and-plugin
  05-safety-rules -->|"S6: artifacts over 256 KB or with more than one file refused"| 03-report-configuration-labels-and-limits
  06-release-requirements -->|"R5: enabled false per repository"| 03-report-configuration-labels-and-limits
  07-ryan-only -->|"private key into Worker secrets, S5"| 05-safety-rules
  07-ryan-only -->|"privacy note, terms, SECURITY.md contact; first npm publish"| 06-release-requirements
  07-ryan-only -->|"gate 3 and false-Proven reviews; gate 6 check"| 09-design-release-gates
  08-design-verdicts -->|"Tampered and Test changes: review flags reviewed in gate 3"| 09-design-release-gates
  02-checks-and-verdicts -->|"static checks flag runner config and setup files"| 10-design-threat-model
```

## Documents

- [01 core](01-core.md)
- [02 Checks and verdicts](02-checks-and-verdicts.md)
- [03 Report, configuration, labels and limits](03-report-configuration-labels-and-limits.md)
- [04 cli and plugin](04-cli-and-plugin.md)
- [05 Safety rules](05-safety-rules.md)
- [06 Release requirements](06-release-requirements.md)
- [07 Ryan only](07-ryan-only.md)
- [08 From the design: verdicts](08-design-verdicts.md)
- [09 From the design: release gates](09-design-release-gates.md)
- [10 From the design: threat model](10-design-threat-model.md)
