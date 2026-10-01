# Security Policy

## Supported versions

CladeForge is at v0.1.0 and pre-1.0. Fixes land on the default branch and are picked up by
whatever release is current at the time; there is no long-term-support branch.

| Version | Supported |
|---------|-----------|
| 0.1.x   | Yes       |
| < 0.1.0 | No        |

## Reporting a vulnerability

**Do not open a public issue for a security problem.** A public issue is visible immediately and
cannot be retracted.

Report it privately through GitHub's vulnerability reporting on this repository
(<https://github.com/ZengZichao/CladeForge/security/advisories/new>). If that form is
unavailable, email the maintainer directly at the address in
[`CITATION.cff`](./CITATION.cff).

Please include:

- what the problem is, and which file or feature it lives in;
- steps to reproduce, ideally with a minimal `.cladeforge.json`;
- the CladeForge version and your OS.

You can expect an acknowledgement within a week. Fixes land on the default branch after the test
suite passes, and are credited in the release notes unless you would rather stay anonymous.

## Scope

In scope:

- the path allow-list in `src-tauri/src/lib.rs` — it is the boundary between a tree file you
  opened and every other file on the machine, and it is the part of this codebase with the most
  security weight;
- the Tauri capability set (`src-tauri/capabilities/default.json`) and the CSP in
  `src-tauri/tauri.conf.json` — anything that widens what the webview may reach;
- the dependency tree. Automated dependency updates are in place, but a fix that only exists in
  a newer major version is not something Dependabot will propose, so a vulnerable pinned
  version can persist. Reporting it is useful even if `npm audit` already knows.

Out of scope:

- findings that require an attacker to already control the machine;
- reports generated only by a scanner, with no reachable path in this application.

## Known limitations

Pre-built release artifacts are **unsigned**. There is no notarization, no code signing on
Windows, and no published checksum. A macOS user has to clear Gatekeeper on first launch. This
is a real gap; treat a downloaded binary as unverified and prefer building from source if that
matters to you.
