# Changelog

## Unreleased

- Fix (web): used positions were forgotten after the second run on a sheet, so the next run could print over a label already used. Used positions now accumulate across runs on the same sheet.
- Fix (web): a run that would print over a position marked used is blocked with a message naming the position.
- Web: positions are marked used on Download, not on Make PDF, so you can adjust the nudge and rerun. Files stay in the list until the first download, then clear. Changing any setting invalidates the previous result.
- Web: warnings (including the shrink-to-fit warning) always visible; errors no longer hide the 100% printing reminder; GUI wording in place of CLI flags; busy state on Make PDF; remove a single file; duplicate files skipped; saved printer names offered; nudge direction explained; clearer used-position grid; sharper preview on high-DPI screens; better text contrast.
- Calibration page explains the nudge for app users as well as the CLI.
- Pipeline parses each input PDF once for measurement instead of once per page.

## 0.1.1 - 2026-09-12

- Fix: the published CLI did not run (`npx labelslot` failed because Node does not type-strip `.ts` files inside node_modules). The bin is now a bundled `dist/cli.js` built at pack time; CI installs the packed tarball and runs it.

## 0.1.0 - 2026-09-12

- Project scaffold: module boundaries, interface stubs, synthetic fixture generator, CI.
- Geometry module (label positions, fit classification, centred placement, rotation for single-label media, PDF translation) and sheet definitions with vendor-cited margins: ll04 (Avery L7169 / Label Planet LP4/99), lp4-105, l7168, 6x4 thermal.
- Measurement: pdf.js raster at 72 dpi, ink bounds in mm relative to the MediaBox origin; ignores white backgrounds, clip paths and invisible text.
- Transform: source page embedded as a form XObject with an identity matrix and drawn by pure translation; 90 degree page rotation for single-label media; calibration page with crosshairs and mm rules at every label corner. Byte-level no-scaling proof in the test suite.
- README, before-and-after diagram, npm release workflow.
- Pipeline and CLI: `labelslot --sheet ID --pos N in.pdf -o out.pdf`, `--target 6x4`, `--list-sheets`, `calibrate`, `--assume-position`, `--align`, `--nudge`, `--sheets`, `--allow-scale`, `--dpi`; multi-file and multi-page input; fail-fast with the integrated-template and detection-failure messages.
- Web version: visual position grid, drag-and-drop input, preview with label boundaries, used-position memory, nudge profiles per printer name, calibration download. Static page deployed to GitHub Pages; everything runs in the browser.
- Desktop app: the web version wrapped in Tauri; macOS signed and notarised in CI, Windows and Linux unsigned. Release workflow builds dmg, exe, AppImage and deb on a tag, with a manual dry run.
- Web and desktop UI restyled as a dark two-pane instrument panel: toolbars, sheet grid beside the preview, status bar.
