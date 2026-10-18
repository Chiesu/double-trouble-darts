# Validation notes for the prepared GitHub version

- Static syntax check: JavaScript sources via Node --check, Swift parsing via swiftc -frontend -parse, shell syntax checked with Bash compatibility parser.
- Browser integration regression: the first five Playwright groups passed (board scoring, autosave/3D board, relaunch/undo, color editing, animated 3D shot). The long-running suite **timed out before completing all 18 groups** in this environment. Previous `TEST-REPORT.md` documents 18/18 from 2026-10-13 for the original uploaded v4.1 files. Do not claim that the prepared source received a complete fresh suite run.
- macOS native build and code signing cannot be executed in this Linux environment. Verify using your Mac or the GitHub Actions macOS runner before distribution.
