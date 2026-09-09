Move a shipping label PDF from eBay or Royal Mail Click & Drop to any position on an A4 label sheet, or onto a 4x6 thermal label, without scaling it.

# labelslot

![Before and after](docs/before-after.svg)

Before: the eBay PDF draws the label at position 1 of a 4-per-sheet A4 sheet. After: labelslot moves the same label, unscaled, to position 2, so the rest of a part-used sheet isn't wasted.

## Why this exists

eBay's label flow draws the label top-left of an A4 page with no position setting, so on a 4-per-sheet label sheet positions 2 to 4 are wasted once you've used position 1. Royal Mail Click & Drop does offer custom label positioning for personal customers, so use that if you can. labelslot is for the cases you cannot fix upstream, and for printing the same label onto a 4x6 thermal printer instead of a sheet.

## Install

Needs [Node 24 or later](https://nodejs.org). On macOS, `brew install node` gets you there.

```
npx labelslot --help
```

or install it once:

```
npm install -g labelslot
```

A desktop app and a web version are coming later; for now this is the command-line tool.

### Web version

A web version is available at [https://OWNER.github.io/labelslot/](https://OWNER.github.io/labelslot/). It runs entirely in your browser — your label PDF is never uploaded anywhere — and needs no install. The desktop app is still to come.

## Quick start (60 seconds)

```
labelslot --sheet ll04 --pos 2 label.pdf -o out.pdf
labelslot --target 6x4 label.pdf -o out.pdf
```

The first places `label.pdf`, unscaled, onto position 2 of an `ll04` A4 label sheet. The second places it centred on a 4x6 in thermal label (`--target` is a synonym for `--sheet`).

See the sheets and their ids with:

```
labelslot --list-sheets
```

Pass more than one PDF and they fill consecutive positions in order:

```
labelslot --sheet ll04 --pos 2 jan.pdf feb.pdf mar.pdf -o out.pdf
```

`--pos` is where the first label goes; each label after it fills the next position, and once a sheet is full labelslot starts a new page.

## Supported sheets

| id | label size | per sheet | vendor names |
|---|---|---|---|
| `ll04` | 99.1 x 139 mm | 4 (A4) | Label Planet LP4/99, Avery L7169 |
| `lp4-105` | 105 x 148.5 mm | 4 (A4) | Label Planet LP4/105 |
| `l7168` | 199.6 x 143.5 mm | 2 (A4) | Avery L7168, Label Planet LP2/199 |
| `6x4` | 101.6 x 152.4 mm | 1 (thermal) | 4 x 6 in thermal label |

Use `--sheets file.json` to supply your own sheet definitions instead of these (your file replaces the bundled list); see Contributing below for the shape.

## Calibration

Printers and cutters aren't perfect, so check yours before running real labels:

```
labelslot calibrate --sheet ll04 -o test.pdf
```

Print `test.pdf` at 100%, and measure the offset from the printed crosshair to the actual corner of a label. Pass that back in as `--nudge X,Y` (mm; +x moves right, +y moves down) on future runs. Manufacturers work to a tolerance of a couple of mm, so needing a small nudge per printer is normal, not a bug.

## Printing

**Sheet output must be printed at 100% / "Actual size", not "fit to page"** — some print dialogs default to "fit to page", which rescales the label and defeats the whole point. Thermal output needs the driver's "scale to fit media" option turned off: Zebra, Rollo, Dymo and similar printers expect the page size to match the loaded media exactly, and their scale-to-fit option resizes a page that already matches the label.

## Privacy

Everything runs locally. The label PDF is never uploaded anywhere, and labelslot has no network code, so nothing phones home. The source is open, so you can check both of those claims yourself.

## FAQ

**Why does it say the label is too large / detection failed?**
labelslot measures the ink on the page and compares it to the target label size; if that measurement is wrong (an unusual PDF, a scan, extra marks near the label) it can read as too large even though the printed label would fit. Try `--assume-position N` to skip measurement and use the nominal position of the input instead, or `--dpi N` to change the measurement resolution.

**It says my page is an integrated label and despatch note. What do I do?**

> The drawn content on this page covers half the page or more, so it is almost certainly a Royal Mail Click & Drop integrated label plus despatch note, not a bare label. labelslot cannot place it on a label. In Click & Drop, change your label format from the integrated label to the separate-label (label only) template, download the label again, and retry.

There's no way to split an integrated PDF into a label after the fact; go back to Click & Drop and download the label-only version.

**Can I print an eBay label on the second label of a 4 per sheet A4 sheet?**
Yes: `labelslot --sheet ll04 --pos 2 label.pdf -o out.pdf`.

**Can I print an eBay label on a 4x6 thermal printer?**
Yes: `labelslot --target 6x4 label.pdf -o out.pdf`. Make sure "scale to fit media" is off in the printer driver first.

**Why won't it scale my label to fit?**
Shrinking a label shrinks its barcode and datamatrix module size too, and thermal print heads (typically 203 dpi) can only resolve so fine a module before the barcode stops scanning reliably. `--allow-scale` exists for edge cases, but read the warning it prints: it tells you the scale factor it used, and a label that looks fine on screen can still fail to scan once printed.

**The label prints a few mm off.**
Run `labelslot calibrate --sheet ll04 -o test.pdf`, print it at 100%, measure the offset, and pass it back with `--nudge X,Y`.

**Does it work with Letter-size sheets?**
Not yet. All the seeded sheets are A4; a Letter template needs an accurate vendor-cited source in the same way the A4 ones do. Contributions with a vendor template citation are welcome.

**Does it change the barcode?**
No. The label's content stream is copied byte for byte into the output; nothing is redrawn, rasterised or rescaled. The test suite checks this directly rather than just checking that the label looks right.

## Not affiliated

labelslot is not affiliated with eBay, Royal Mail, Avery or Label Planet.

## Contributing

The easiest useful contribution is a new sheet definition. In `sheets.json`, copy an existing entry and adjust:

- all sizes and margins in mm
- positions are numbered left-to-right, top-to-bottom
- `source` must cite the vendor's own template page (with URL) for the margins and gaps you used

Then run `npm test` and open a PR.

- `npm test` runs the test suite (`node --test`).
- `npm run lint` type-checks the project (`tsc --noEmit`).
- Licensed under the MIT licence (see `LICENSE`).
