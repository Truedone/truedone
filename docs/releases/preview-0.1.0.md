# The 0.1.0 preview

Each section is written by `node tools/release-preview.mjs <surface>` from what it measured (D35).

## The command line

Written by `node tools/release-preview.mjs cli`.

```text
$ npm pack packages/cli --json (empty npm config, HOME in a scratch directory)
tarball truedone-0.1.0.tgz, 33227 bytes, integrity sha512-2q5ca2ZfLuk69fNGpyBdzH8zGEMEWvyC/w7+E4hZq8JXsadol7r4qI8WZDsxNCXxlJPcNLmSeChxzY2CMUBHAA==
  package/LICENSE 11358 bytes
  package/package.json 351 bytes
  package/README.md 839 bytes
  package/truedone.mjs 102195 bytes
tarball check: pass (exactly the four files, version 0.1.0, none over 1048576 bytes, no secret pattern)
$ npm install --global --offline --prefix <scratch> truedone-0.1.0.tgz
$ truedone --version
truedone 0.1.0 (preview)
$ truedone https://github.com/Truedone/truedone-sandbox/pull/31 --json   -> tampered
$ truedone https://github.com/Truedone/truedone/pull/17 --json   -> review
$ truedone https://github.com/Truedone/truedone/pull/47 --json   -> no_evidence
$ truedone https://github.com/Truedone/truedone/pull/54 --json   -> unrun
$ truedone https://github.com/Truedone/truedone/pull/43 --json   -> not_applicable
result: pass
```
