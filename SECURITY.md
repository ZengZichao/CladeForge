<!-- AI-PROVENANCE: AI-assisted changes to this file are itemised in docs/AI_PROVENANCE.md -->

# Security Policy

## Supported versions

CladeForge is at v0.3.0 and pre-1.0. Fixes land on the default branch and are picked up by
whatever release is current at the time; there is no long-term-support branch.

| Version | Supported |
|---------|-----------|
| 0.3.x   | Yes       |
| < 0.3.0 | No        |

## Reporting a vulnerability

**Do not open a public issue for a security problem.** A public issue is visible immediately and
cannot be retracted.

Report it privately through GitHub's vulnerability reporting on this repository
(<https://github.com/ZengZichao/CladeForge/security/advisories/new>) — the same link the issue
picker offers as its security contact (`.github/ISSUE_TEMPLATE/config.yml`), so the two cannot
drift apart. If that form is unavailable, email the maintainer at the address recorded in
[`CITATION.cff`](./CITATION.cff) (the same address ships in `package.json` and
`src-tauri/Cargo.toml`). A private report stays private while it is open; it is not mirrored into
the public issue tracker, which is why the public form must not be used.

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
- the dependency tree. Regular version updates ignore major versions; security updates are
  enabled and can cross a major when an advisory requires it. A vulnerable pinned version can
  still persist, so reporting it is useful even if `npm audit` already knows.

Out of scope:

- findings that require an attacker to already control the machine;
- reports generated only by a scanner, with no reachable path in this application.

## Known limitations

Pre-built release artifacts are **unsigned**. There is no notarisation, no code signing on
Windows, and no published checksum — `.github/workflows/release.yml` attaches the installers and
nothing else. A macOS user has to clear Gatekeeper on first launch. This
is a real gap; treat a downloaded binary as unverified and prefer building from source if that
matters to you.

**A transitive `glib` unsoundness that this repository cannot patch.** `glib` 0.18.5 is flagged by
RUSTSEC-2024-0429 / GHSA-wrw7-89jp-8q8g (medium): the `Iterator` and `DoubleEndedIterator`
implementations for `VariantStrIter` can hand back a string pointer that is not valid. The advisory
covers `>= 0.15.0, < 0.20.0`, so the only fix is glib 0.20 or later — and no dependency update from
here reaches it. `src-tauri/Cargo.toml` pins `tauri = "2"`, and the newest stable release of Tauri
(2.12.5) still requires `gtk ^0.18` on Unix, which resolves `glib` within 0.18.x; leaving that stack
is upstream's decision, not a version bump. The affected API is also unreachable from CladeForge's
own code: nothing under `src-tauri/src` names `glib`, `Variant` or `VariantStrIter`, and the GTK
stack is present only because Tauri's Linux runtime windows itself with it.

Dependabot alert #36 is therefore dismissed as a **tolerable risk** (`tolerable_risk`) on those two
grounds — no reachable patched range while Tauri pins `gtk ^0.18`, and no application code that calls
the affected iterators — rather than closed quietly. The `not_used` reason was deliberately not
chosen: Tauri's own runtime does use the GTK stack, and whether it reaches `VariantStrIter` has not
been verified, so claiming the dependency is unused would overstate what is known here. Revisit
this — and delete the paragraph — when a Tauri release moves to gtk-rs ≥ 0.20.
