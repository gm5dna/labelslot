# labelslot specification

labelslot takes a shipping-label PDF (eBay, Royal Mail Click & Drop and similar emit an A4 page with the label drawn top-left, one label per page) and re-outputs it either onto a chosen position of an A4 sheet of self-adhesive labels, so the unused labels on a part-used sheet are not wasted, or onto a 4 × 6 in thermal label.

This file is the contract. Subagents start with no other context; anything they must not get wrong is here.

## Non-negotiable

1. **The output is never scaled and never rasterised.** The 2D datamatrix and the postage barcode must remain the original vector objects at their original size. The source page is embedded as a form XObject whose content stream is the source content stream verbatim, with `/Matrix [1 0 0 1 0 0]`, and drawn with a pure translation `1 0 0 1 tx ty cm`. Rasterising a page to *measure* or *preview* it is fine; the raster is discarded. Nothing rasterised ever reaches the output file.
2. **The only rotation allowed is an exact 90 degrees for a single-label target, done by setting the page's `/Rotate` attribute, never by transforming the content stream.** Arbitrary rotation is forbidden.
3. **Centre the measured bbox in the target label.** Do not infer which position the input occupied and do not preserve its inset. `--align top-left` is the only alternative.
4. **A measured bbox larger than the target label is a detection failure, not a large label.** Report it as such, with the measured size and the label size. A bbox covering half the page or more gets `INTEGRATED_MESSAGE` from `src/pipeline.ts`, verbatim.
5. **Never silently produce a label that straddles a cut line.** If the bbox does not fit, fail. `--allow-scale` may shrink to fit but must print the scale factor and warn that shrinking the datamatrix can push its module size below what a 203 dpi print head resolves, producing a label that looks fine and will not scan.
6. **Measure every page independently.** Do not assume page 2 is laid out like page 1.
7. **All processing is local.** Nothing is uploaded anywhere. Label PDFs contain a customer's name and address. Never commit a real label; tests use `test/fixtures.ts`.
8. **Output prints correctly only at 100% / "Actual size".** Sheet output: say so in the CLI output, the UI and the README. Thermal output: the driver's "scale to fit media" must be off.

## Coordinates

- All geometry is in **millimetres, origin top-left of the page, y downwards**. That is how sheets are specified and how people reason about them.
- PDF points and the bottom-left origin appear in exactly one place: `geometry.pdfTranslation()`. Everything in `src/geometry.ts` is pure and unit tested. Add to it rather than doing arithmetic elsewhere.
- A `Box` for a page's MediaBox carries the MediaBox origin in `x`/`y` (usually 0/0, but not always; a fixture covers the offset case). Measured bboxes are relative to that origin.
- Sheet positions are 1-based, left-to-right, top-to-bottom.

## Modules and ownership

| File | Role | I/O allowed |
|---|---|---|
| `src/geometry.ts` | Pure maths: `labelBox`, `classify`, `place`, `pdfTranslation` | none |
| `src/sheets.ts` | Bundled `sheets.json`, validation, lookup by id or alias | none (browser-safe) |
| `src/measure.ts` | pdf.js raster → bbox in mm. Takes a `createCanvas` (DOM or `@napi-rs/canvas`) | none (browser-safe) |
| `src/transform.ts` | pdf-lib: output page creation, XObject placement, calibration page | none (browser-safe) |
| `src/pipeline.ts` | bytes in → bytes out. measure → classify → place → placePage per page | none (browser-safe) |
| `src/cli.ts` | argument parsing (`node:util` `parseArgs`), files, messages, exit codes | the only module that may import `node:*` |
| `sheets.json` | Sheet definitions (data, not code) | |
| `test/fixtures.ts` | Synthetic label generator with variants | owned by the integrator; do not edit in a slice |

Stubs throw `not implemented`. Implement the signature as given; if the signature must change, say so in your report rather than changing callers you do not own.

Do not edit `package.json` dependencies, `test/fixtures.ts` or `CHANGELOG.md` in a slice unless the task says so. Dependencies are pinned: `@cantoo/pdf-lib` (transform), `pdfjs-dist` (render), `@napi-rs/canvas` (Node canvas for the CLI), `typescript` (lint), `esbuild` (web bundle). Do not add any. Node's standard library covers arg parsing, tests and assertions.

## Sheet geometry (`sheets.json`)

Each entry: `id`, `name`, `aliases`, `page {w,h}`, `cols`, `rows`, `label {w,h}`, `marginLeft`, `marginTop`, `gapX`, `gapY`, `source`. All mm. A user can supply their own file with `--sheets file.json`; it has the same shape and replaces the bundled list.

`source` must cite where the margins and gaps came from (the vendor's template PDF, with URL). Entries marked `TODO slice 1` hold sanity figures derived by dividing the leftover page evenly; the geometry slice replaces them from Avery / Label Planet templates. Manufacturers work to a tolerance of a couple of mm, which is why the nudge exists.

Seeded: `ll04` (A4, 2 × 2, 99.1 × 139 mm; Avery L7169 / Label Planet LP4/99), `lp4-105` (A4, 2 × 2, 105 × 148.5 mm, zero margins), `l7168` (A4, 1 × 2, 199.6 × 143.5 mm), `6x4` (thermal, 101.6 × 152.4 mm, one label per page, `cols × rows = 1`). Letter-size sheets only if accurate vendor numbers are sourced; otherwise leave them out.

A thermal label is a sheet with one position whose label equals the page. There is no separate thermal code path; adding a 4 × 6 landscape or an A6 label is a JSON entry. `--target` is a synonym for `--sheet`.

## Measurement

Render the page with pdf.js at low resolution (default 72 dpi; 0.35 mm per pixel) with rotation 0, and take the bounds of pixels where any RGB channel is below 250. This ignores full-page white rectangles, clip paths, invisible text and empty XObjects, all of which break a content-stream walk. The raster is discarded.

Return the bbox in mm relative to the MediaBox origin, plus the MediaBox itself. `null` bbox for a blank page.

Refuse, with a clear message naming the page: a source page with `/Rotate ≠ 0`, or a CropBox that differs from the MediaBox. eBay and Click & Drop pages have neither; handling them is not worth the risk of a subtle offset. Check these with pdf-lib in the pipeline before measuring.

For reference, a real eBay 2nd Class large-letter label measures 80.2 × 125.2 mm and sits 15.1 mm from the left edge and 16.4 mm from the top of the A4 page. `test/fixtures.ts` reproduces this as `REF_LABEL`. A real eBay "Bulk Labels" PDF (inspected 9 Sep 2026, kept out of the repo) is pdf-lib output: page 595 × 842 pt, MediaBox = CropBox at origin, `/Rotate` absent, one content stream that draws the label as a single Form XObject, no fonts on the page. Measured at 72 dpi it gives `{x: 14.8, y: 16.2, w: 80.8, h: 125.6}`, identical to the plain fixture. Embedding it therefore nests a form inside our form XObject; pdf-lib copies the resources, and that is fine.

`--assume-position N` skips measurement and uses `labelBox(sheet, N)` as the bbox. Document it as the thing to try when detection fails.

## Placement

`geometry.place(bbox, sheet, pos, {align, nudge, allowScale})` returns a `Placement {dx, dy, rotate, scale, warnings}`:

- Target is `labelBox(sheet, pos)`. Centre by default; `top-left` aligns the bbox's top-left with the label's.
- `nudge {x, y}` mm is added last: +x moves right, +y moves down.
- If the bbox fits only when turned and `sheet.cols × sheet.rows === 1`, rotate 90. Then the output page as drawn is `sheet.page` with `w`/`h` swapped and the label box transposed; `dx`/`dy` are computed in that drawn space, and `transform.addOutputPage` sets the MediaBox to the swapped size and `/Rotate 90`. The printed page comes out in the media's orientation with the content turned. The CLI says that it rotated.
- If the bbox does not fit either way: throw `PlacementError` naming the measured size and the label size, unless `allowScale`, in which case `scale = min(label.w / bbox.w, label.h / bbox.h)` (uniform, shrink only), centred, with the warning from Non-negotiable 5.
- Fit tolerance: a bbox up to 1 mm larger than the label in either dimension still counts as fitting (measurement is pixel-quantised and the border line of a label straddles its edge: the reference fixture measures 80.8 × 125.6 mm at 72 dpi for a drawn 80.2 × 125.2); anything beyond is a failure.

`geometry.pdfTranslation(placement, srcMediaBox, drawnPageSize)` gives the points for `cm`:

```
tx = pt(dx) - pt(src.x)
ty = pt(out.h - src.h) - pt(dy) - pt(src.y)
```

`classify(bbox, sheet)`: `integrated` when bbox area ≥ 50% of the page area; `too-large` when it fits the label in neither orientation (with the same 1 mm tolerance); else `ok`.

## Output

- One PDF, pages sized to the sheet's page (A4 for the seeded sheets, regardless of the input's page size). Sheet target: fill positions in order from `--pos`, spilling onto further pages. Single-label target: one page per input page.
- Thermal media box is exactly 288 × 432 pt (or 432 × 288 with `/Rotate 90`). No printer margin, no bleed.
- The pipeline fails fast, writing nothing, on the first page that cannot be placed. Partial sheets are worse than no output.
- `labelslot calibrate --sheet ll04 -o test.pdf`: one page with crosshairs and a mm rule at each label's corners, for finding the nudge once per printer.

## CLI (Release 1)

```
labelslot --sheet ll04 --pos 2 in.pdf [more.pdf ...] -o out.pdf
labelslot --target 6x4 in.pdf -o out.pdf
labelslot --list-sheets
labelslot calibrate --sheet ll04 -o test.pdf
```

Options: `--pos N` (default 1), `--assume-position N`, `--align centre|top-left`, `--nudge X,Y` (mm), `--sheets file.json`, `--allow-scale`, `--dpi N`. Exit 0 on success with a one-line summary per page (input, page, position, rotated or not) and the 100% printing reminder; exit 1 with the message on stderr on any failure. Every page of every input file is a label.

## Tests

- `node --test`, `node:assert`, fixtures from `test/fixtures.ts`. No test framework.
- Golden test: run the pipeline on the fixture, re-measure the output, assert the bbox lies within `labelBox(sheet, pos)`.
- **No-scaling proof** (the test that matters, `test/transform.test.ts`): assert that the form XObject's decoded stream contains the source page's decoded content stream as a contiguous byte sequence (pdf-lib wraps it in `q`/`Q` and nothing else), that its `/Matrix` is identity, and that the output page content draws it with `1 0 0 1 tx ty cm` where `tx`/`ty` equal `pdfTranslation()`. A bbox assertion alone is circular because it trusts the measurement code.
- Measurement tests: fixture variants `whiteBackground`, `clipPath`, `invisibleText` each measure the same bbox as the plain fixture; `integrated` classifies as integrated; `mediaBoxOffset` measures the same bbox relative to the MediaBox origin; `pages: 3` measures each page.
- Geometry: `labelBox` for every seeded sheet and position, `classify` boundaries, `place` centre and top-left and nudge, rotation only for 1 × 1 targets, `PlacementError` on overflow, `pdfTranslation` sign and MediaBox offset.

## Releases

1. CLI on npm, usable the same day.
2. GUI: one HTML UI (`web/`, no framework) bundled by esbuild, shipped as a Tauri desktop app (macOS signed and notarised, Windows and Linux unsigned) and as a static GitHub Pages site. Target picker, visual position grid, drag PDFs in, PDF out, preview with the sheet's label boundaries overlaid, nudge profiles keyed by a user-typed printer name in localStorage, calibration page from the same screen, memory of which positions of the current sheet are used with a reset button. Local state only.

## README

Nobody searches for the name. The first line, before any badge or heading, is one plain sentence containing "shipping label", "PDF", "A4 label sheet", "position" and "4x6 thermal". Sections in order: that sentence; a before-and-after image (`docs/before-after.svg`, drawn, not a screenshot); why this exists in three sentences (eBay's label flow has no position setting; Click & Drop has custom positioning for personal customers, so this is for the cases you cannot fix upstream); install per platform; a 60-second quick start; the supported sheet table with vendor and Avery equivalents; calibration; a prominent note that sheet output must be printed at 100% and thermal output needs "scale to fit media" off; privacy (processed locally, never uploaded); FAQ as the literal questions people ask, including the integrated-template one; not affiliated with eBay or Royal Mail; contributing, focused on adding a sheet definition. Flat, practical tone. No emoji headers, no marketing.
