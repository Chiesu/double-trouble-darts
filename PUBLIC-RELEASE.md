# Public-release notes

- Proposed GitHub repo: `Chiesu/double-trouble-darts`.
- App name and bundle ID remain unchanged to preserve existing user data.
- GitHub tag `v4.1.0` triggers `.github/workflows/release-macos.yml` to build an app ZIP on a macOS runner.
- GitHub Actions builds an **ad-hoc-signed app, not a notarized app**. Before wider public distribution, configure Developer ID signing and notarization (requires Apple's program and credentials).
- The `Install-or-Update.command` path remains available as an alternative and backs up a local club database before replacing the existing app.
- New standalone `scripts/build-macos.sh` builds without touching data or installed apps.
- The original `TEST-REPORT.md` documents a prior browser test run, **not** a new Mac native test. See `VALIDATION-NOTES.md`: the fresh full-suite attempt timed out after five passing groups.
- Prior generated QA files have been removed from `Tests/Output/`; curated preview images are now in `docs/images/`.
