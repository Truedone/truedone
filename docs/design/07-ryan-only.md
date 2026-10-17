# 07 Ryan only

Source section: Ryan only

These items are Ryan's alone, each with the week it falls in.

- Week 1: register npm `truedone`, the repository mgillr/truedone and the domain; run the EUIPO and USPTO searches in classes 9 and 42, and choose the fallback name if one fails.
- Week 1: the Cloudflare account, the GitHub App registration, the private key into Worker secrets, and the development app.
- Week 1: no credential on the lanes: only the lead runner reaches GitHub, with his login (D25).
- Week 1: confirm or change D1 to D31, then sign and commit the contracts.
- Week 1: `.github/allowed_signers` with his SSH key (D25).
- Weeks 1 and 2: the environments dev, production and release, the Cloudflare token, the mirror token, and the ruleset with the CI gate and merge commits only (D25, D26).
- Weeks 1 and 5: the gate 3 and false-Proven reviews, or naming the reviewer.
- Week 2: the first npm publish by hand, then trusted publishing for every later release.
- Weeks 2 to 6: maintainer outreach, the launch posts and the recording, sent as himself.
- Weeks 2 and 6: the gate 6 check, and the go or stop decision for each release.
- Week 4: the privacy note, the terms and the `SECURITY.md` contact.
- Its own task: the paid pilot, with price, buyer and date.

## Flow

```mermaid
flowchart LR
  W1["week 1"] --> W2["week 2"] --> W4["week 4"] --> W5["week 5"] --> W6["week 6"]
  N["npm name, the repository mgillr/truedone, domain; EUIPO and USPTO searches in classes 9 and 42; fallback name if one fails"] --- W1
  CF["Cloudflare account, GitHub App registration, private key into Worker secrets, development app"] --- W1
  TOK["no credential on the lanes; only the lead runner reaches GitHub, with his login, D25"] --- W1
  CON["confirm or change D1 to D31, then sign and commit the contracts"] --- W1
  MA[".github/allowed_signers with his SSH key, D25"] --- W1
  ENV["environments dev, production, release; Cloudflare and mirror tokens; ruleset with the CI gate and merge commits only, D25 and D26"] --- W1
  ENV --- W2
  REV["gate 3 and false-Proven reviews, or name the reviewer"] --- W1
  REV --- W5
  PUB["first npm publish by hand, then trusted publishing"] --- W2
  OUT["maintainer outreach, launch posts and the recording, sent as himself"] --- W2
  OUT --- W6
  G6["gate 6 check, and the go or stop decision for each release"] --- W2
  G6 --- W6
  POL["privacy note, terms and the SECURITY.md contact"] --- W4
  PIL["paid pilot: price, buyer and date, its own task"]
```

## Schematic

```mermaid
flowchart TB
  RYAN["Ryan"]
  subgraph NAMES["name and registrations"]
    N1["npm truedone, the repository mgillr/truedone, domain"]
    N2["EUIPO and USPTO searches, classes 9 and 42; fallback name"]
  end
  subgraph ACCESS["accounts, keys and tokens"]
    A1["Cloudflare account and token"]
    A2["GitHub App registration and the development app"]
    A3["private key into Worker secrets"]
    A4["no credential on the lanes; only the lead runner reaches GitHub, with his login"]
    A5[".github/allowed_signers with his SSH key"]
    A6["environments dev, production and release; mirror token; ruleset with the CI gate and merge commits only"]
  end
  subgraph DECIDE["decisions and reviews"]
    D1["confirm or change D1 to D31; sign and commit the contracts"]
    D2["gate 3 and false-Proven reviews"]
    D3["gate 6 check; go or stop for each release"]
  end
  subgraph OUTSIDE["publishing, outreach, policy and the pilot"]
    O1["maintainer outreach, launch posts, recording"]
    O2["privacy note, terms, SECURITY.md contact"]
    O3["paid pilot: price, buyer, date"]
    O4["first npm publish by hand"]
  end
  RYAN --> NAMES
  RYAN --> ACCESS
  RYAN --> DECIDE
  RYAN --> OUTSIDE
```

[Back to the master schematic](00-master.md)
