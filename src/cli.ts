#!/usr/bin/env node
// Command line entry point. The only module allowed to touch the filesystem or process.
// Usage (see docs/SPEC.md):
//   labelslot --sheet ll04 --pos 2 in.pdf [more.pdf ...] -o out.pdf
//   labelslot --target 6x4 in.pdf -o out.pdf        (--target is a synonym for --sheet)
//   labelslot --list-sheets
//   labelslot calibrate --sheet ll04 -o test.pdf
// Options: --assume-position N, --align centre|top-left, --nudge X,Y (mm), --sheets file.json,
//          --allow-scale, --dpi N

/** Returns the process exit code. Writes to stdout/stderr. */
export async function main(argv: string[]): Promise<number> {
  throw new Error('not implemented');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await main(process.argv.slice(2));
}
