# Double Trouble 4.1 / QA report

**Date:** 2026-10-13

**Result:** 18/18 integration-test groups passed in Linux Chromium (software WebGL2). No uncaught JavaScript errors. A self-contained HTML build also loaded without errors and started the 3D scene.

## Board and scoring invariants

- The V4 sector ordering and all ring colors remain unchanged: `#e5e1d0`, `#262e28`, `#519e75`, `#ef695c`.
- The V4 scoring radii, player data schema, hit-coordinate system, archive format and native save bridge were not changed.
- V4.1 changes the 3D camera field from 566 to 526 board units, allowing the board to fill more of the central stage; pointer scoring still uses board-plane coordinates.
- The surround is warm sage with a subtler fabric-noise amplitude. The alternate 2D renderer has a matching surround.

## Integration groups

The included `Tests/test_v4.py` was updated to load `soft-sport.css` in addition to the original stylesheets. The complete run passed:

1. 107 scoring classifications covering sectors, bull rings, double/triple bands, misses and invalid coordinates.
2. Autosave, player dart colors, three-dart and outside-miss inputs.
3. Handoff, Undo, round history, and mid-turn/mid-handoff relaunch.
4. Saved dart-color edits and renderer persistence across page navigation.
5. Real 3D flight/impact timing and 180/bull responses.
6. 301 double-out, bust, checkout, archived match and victory Undo.
7. Bull checkout and mid-animation quit/relaunch handling.
8. Single-finish bust in double-out mode.
9. Cricket overflow, marks, closures and bull checkout.
10. Count Up ties, final round and miss coordinates.
11. V3 schema and saved data migration.
12. V4 backups and V2/V3 backup import.
13. No forced truncation of more than 3,000 matches or 100 seasons.
14. Player photo upload, bench and reselection.
15. League, rivalries, winning streaks and achievements.
16. No-scroll viewport bounds at 1440x900, 1280x800, 1024x700, 880x620, 880x590 and 390x844; eight-player layout.
17. WebGL-unavailable 2D fallback retains scoring and turn handling.
18. No uncaught JavaScript exceptions.

## Visual review

Inspected 1440x900, 1280x800, 880x620 and 390x844 screenshots. The target stays centered with left and right current-information rails. The 390px-wide roster was changed to a single-row layout to avoid text/score overlap. Narrow layouts keep page-level scrolling disabled while retaining working handoff controls.

## Native macOS limitation

The macOS Swift source, Info.plist, app icon and installer are included. The native `.app` cannot be compiled or run in this Linux environment. Run `Install-or-Update.command` on the target Mac and verify WebKit rendering, sound, save dialogs and restore. Data is backed up before the app is replaced.
