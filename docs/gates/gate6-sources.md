# Gate 6 sources

The watch list Ryan checks before each release (docs/spec.md, release gate 6): does any of these ship a red-green or
test-tamper check first? `node tools/gate6.mjs <release>` reads the feeds below. Each source was found and opened on
2026-10-18; where its name is ambiguous or it has no changelog of its own, the note says so, for Ryan to correct.

| Source | Feeds | Note |
|---|---|---|
| GitHub changelog | https://github.blog/changelog/feed/ | The GitHub Changelog, RSS. Its items carry labels such as copilot. |
| Copilot code review | no public changelog found | Its changes appear in the GitHub changelog under the copilot label, so the row above covers it. |
| CodeRabbit | https://docs.coderabbit.ai/changelog/rss.xml | The changelog at https://docs.coderabbit.ai/changelog, RSS. |
| Test Ratchet | https://github.com/motchalini-llc/test-ratchet/releases.atom https://github.com/motchalini-llc/test-ratchet/commits.atom | https://github.com/motchalini-llc/test-ratchet, a GitHub Action that blocks a rise in skipped tests and bans focused tests. |
| Skylos | https://github.com/duriantaco/skylos/releases.atom | https://github.com/duriantaco/skylos. Its skylos done gate reruns failing tests on the merge base. |
| tamperguard | https://github.com/fernforge/tamperguard/releases.atom https://github.com/fernforge/tamperguard/commits.atom | https://github.com/fernforge/tamperguard, a diff-level linter for test tampering. Other repositories share the name and are unrelated. |
| checkwash | https://github.com/taipei49314/checkwash/releases.atom https://github.com/taipei49314/checkwash/commits.atom | https://github.com/taipei49314/checkwash, which flags weakened tests and CI checks in a diff. Release notes are in its docs/releases/. |
| donegate | https://github.com/Tetusa1/DoneGate/commits.atom https://github.com/intrepideai/donegate/commits.atom https://github.com/enached134-ctrl/donegate/commits.atom | Ambiguous: three repositories use the name, and none of them is a test-tamper check. Ryan keeps the one the list means. |
| GitHub guidance on a test that fails on the pre-change behaviour | https://github.blog/feed/ | No single page found; the GitHub Blog, RSS, together with the changelog in the first row. |
