#!/usr/bin/env node
// Command line entry point. The only module allowed to touch the filesystem or process.
// Usage (see docs/SPEC.md):
//   labelslot --sheet ll04 --pos 2 in.pdf [more.pdf ...] -o out.pdf
//   labelslot --target 6x4 in.pdf -o out.pdf        (--target is a synonym for --sheet)
//   labelslot --list-sheets
//   labelslot calibrate --sheet ll04 -o test.pdf
// Options: --pos N (default 1), --assume-position N, --align centre|top-left, --nudge X,Y (mm),
//          --sheets file.json, --allow-scale, --dpi N, -o/--output FILE, --list-sheets, -h/--help
import { readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createCanvas } from '@napi-rs/canvas';
import type { Align } from './geometry.ts';
import { run, type RunOptions } from './pipeline.ts';
import { BUILTIN_SHEETS, findSheet, validateSheets } from './sheets.ts';
import { calibrationPage } from './transform.ts';
import type { Sheet } from './geometry.ts';

// The usage block shown for --help; mirrors the header comment above.
const USAGE = `labelslot: place a shipping-label PDF onto an A4 label sheet or 4x6 thermal label, unscaled.

Usage:
  labelslot --sheet ll04 --pos 2 in.pdf [more.pdf ...] -o out.pdf
  labelslot --target 6x4 in.pdf -o out.pdf        (--target is a synonym for --sheet)
  labelslot --list-sheets
  labelslot calibrate --sheet ll04 -o test.pdf

Options:
  --sheet, --target ID     Sheet to place onto (required unless --list-sheets)
  --pos N                  Starting position on the sheet, 1-based (default 1)
  --assume-position N      Skip measurement; assume the input occupies position N
  --align centre|top-left  Alignment within the label (default centre)
  --nudge X,Y              Shift the placement by X,Y mm (+x right, +y down)
  --sheets FILE            Use sheet definitions from FILE instead of the bundled list
  --allow-scale            Shrink to fit when the label would otherwise not fit (warns)
  --dpi N                  Measurement resolution in dpi (default 72)
  -o, --output FILE        Output PDF (required for a conversion or calibrate)
  --list-sheets            List known sheets and exit
  -h, --help               Show this help
`;

const USAGE_HINT =
  'Usage: labelslot --sheet ID input.pdf [more.pdf ...] -o out.pdf  (labelslot --help for details)';

const OPTIONS = {
  sheet: { type: 'string' },
  target: { type: 'string' },
  pos: { type: 'string' },
  'assume-position': { type: 'string' },
  align: { type: 'string' },
  nudge: { type: 'string' },
  sheets: { type: 'string' },
  'allow-scale': { type: 'boolean' },
  dpi: { type: 'string' },
  output: { type: 'string', short: 'o' },
  'list-sheets': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const;

function parseNudge(s: string): { x: number; y: number } {
  const parts = s.split(',');
  const [x, y] = parts.map(Number);
  if (parts.length !== 2 || !Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error(`--nudge must be "X,Y" in mm, got "${s}"`);
  }
  return { x, y };
}

function parseAlign(s: string | undefined): Align | undefined {
  if (s === undefined) return undefined;
  if (s !== 'centre' && s !== 'top-left') throw new Error(`--align must be "centre" or "top-left", got "${s}"`);
  return s;
}

async function loadSheets(sheetsFile: string | undefined): Promise<Sheet[]> {
  if (!sheetsFile) return BUILTIN_SHEETS;
  const text = await readFile(resolve(sheetsFile), 'utf8');
  return validateSheets(JSON.parse(text));
}

function listSheetsLine(s: Sheet): string {
  const aliases = s.aliases.length > 0 ? ` [${s.aliases.join(', ')}]` : '';
  return `${s.id}${aliases} ${s.name} ${s.cols}x${s.rows} ${s.label.w}x${s.label.h}mm`;
}

function printPrintingReminder(sheet: Sheet): void {
  if (sheet.cols * sheet.rows > 1) {
    process.stdout.write('Print at 100% / Actual size, not fit to page.\n');
  } else {
    process.stdout.write("Turn off the driver's scale-to-fit-media option; the page is already the media size.\n");
  }
}

/** Returns the process exit code. Writes to stdout/stderr. */
export async function main(argv: string[]): Promise<number> {
  try {
    let isCalibrate = false;
    let rest = argv;
    if (rest[0] === 'calibrate') {
      isCalibrate = true;
      rest = rest.slice(1);
    }

    const { values, positionals } = parseArgs({ args: rest, options: OPTIONS, allowPositionals: true });

    if (values.help) {
      process.stdout.write(USAGE);
      return 0;
    }

    if (values['list-sheets']) {
      const sheets = await loadSheets(values.sheets);
      for (const s of sheets) process.stdout.write(`${listSheetsLine(s)}\n`);
      return 0;
    }

    const sheetId = values.sheet ?? values.target;
    if (!sheetId) throw new Error('One of --sheet/--target is required.');
    const sheets = await loadSheets(values.sheets);
    const sheet = findSheet(sheetId, sheets);

    if (!values.output) throw new Error('-o/--output is required.');
    const outputPath = resolve(values.output);

    if (isCalibrate) {
      const pdf = await calibrationPage(sheet);
      await writeFile(outputPath, pdf);
      printPrintingReminder(sheet);
      return 0;
    }

    if (positionals.length === 0) throw new Error('At least one input PDF is required.');
    const inputPaths = positionals.map((p) => resolve(p));
    if (inputPaths.includes(outputPath)) {
      throw new Error('Output path must not be the same as an input path.');
    }

    const opts: RunOptions = {
      sheet,
      pos: values.pos !== undefined ? Number(values.pos) : undefined,
      align: parseAlign(values.align),
      nudge: values.nudge !== undefined ? parseNudge(values.nudge) : undefined,
      allowScale: !!values['allow-scale'],
      assumePosition: values['assume-position'] !== undefined ? Number(values['assume-position']) : undefined,
      dpi: values.dpi !== undefined ? Number(values.dpi) : undefined,
      createCanvas,
    };

    const inputs = await Promise.all(inputPaths.map((p) => readFile(p)));
    const { pdf, report } = await run(inputs, opts);
    await writeFile(outputPath, pdf);

    for (const r of report) {
      const inputName = basename(inputPaths[r.input]);
      const rotated = r.placement.rotate === 90 ? ' (rotated 90°)' : '';
      process.stdout.write(`${inputName} page ${r.page + 1} → sheet ${r.outputPage + 1} position ${r.position}${rotated}\n`);
    }
    const warnings = new Set<string>();
    for (const r of report) for (const w of r.placement.warnings) warnings.add(w);
    for (const w of warnings) process.stdout.write(`Warning: ${w}\n`);
    printPrintingReminder(sheet);

    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`${message}\n`);
    process.stderr.write(`${USAGE_HINT}\n`);
    return 1;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await main(process.argv.slice(2));
}
