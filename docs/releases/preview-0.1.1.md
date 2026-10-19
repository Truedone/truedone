# The 0.1.1 preview

Each section is written by `node tools/release-preview.mjs <surface>` from what it measured (D35).

## The command line

Written by `node tools/release-preview.mjs cli`.

```text
$ npm pack packages/cli --json (empty npm config, HOME in a scratch directory)
tarball truedone-0.1.1.tgz, 36603 bytes, integrity sha512-vOiMvE5APxHLNNmzb07SzcNHXfanQw6QlQzAg0mEIAjNDbCWJo/Ki6hORFYjMzlq7/6G4B6Q5es2xtAvh41KDQ==
  package/LICENSE 11358 bytes
  package/package.json 635 bytes
  package/README.md 2262 bytes
  package/truedone.mjs 111494 bytes
tarball check: pass (exactly the four files, version 0.1.1, none over 1048576 bytes, no secret pattern)
$ npm install --global --offline --prefix <scratch> truedone-0.1.1.tgz
$ truedone --version
truedone 0.1.1 (preview)
$ truedone https://github.com/Truedone/truedone-sandbox/pull/31 --json   -> tampered
$ truedone https://github.com/Truedone/truedone/pull/17 --json   -> review
$ truedone https://github.com/Truedone/truedone/pull/47 --json   -> no_evidence
$ truedone https://github.com/Truedone/truedone/pull/54 --json   -> unrun
$ truedone https://github.com/Truedone/truedone/pull/43 --json   -> not_applicable
result: pass
```
