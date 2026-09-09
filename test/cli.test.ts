import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from '@cantoo/pdf-lib';
import { main } from '../src/cli.ts';
import { makeLabelPdf } from './fixtures.ts';

/** Run main() capturing stdout/stderr, restoring the real streams afterwards. */
async function runMain(argv: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = '';
  let stderr = '';
  const origOut = process.stdout.write.bind(process.stdout);
  const origErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: unknown) => {
    stdout += String(chunk);
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: unknown) => {
    stderr += String(chunk);
    return true;
  }) as typeof process.stderr.write;
  try {
    const code = await main(argv);
    return { code, stdout, stderr };
  } finally {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  }
}

test('--list-sheets exits 0 and lists ll04', async () => {
  const { code, stdout } = await runMain(['--list-sheets']);
  assert.equal(code, 0);
  assert.match(stdout, /ll04/);
});

test('conversion writes a PDF with the right page count and prints the 100% reminder', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'labelslot-cli-'));
  const inPath = join(dir, 'in.pdf');
  const outPath = join(dir, 'out.pdf');
  await writeFile(inPath, await makeLabelPdf());

  const { code, stdout } = await runMain(['--sheet', 'll04', '--pos', '2', inPath, '-o', outPath]);
  assert.equal(code, 0);
  assert.match(stdout, /100%/);

  const outBytes = await readFile(outPath);
  const doc = await PDFDocument.load(outBytes);
  assert.equal(doc.getPages().length, 1);
});

test('calibrate writes a one-page PDF', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'labelslot-cli-'));
  const outPath = join(dir, 'cal.pdf');

  const { code } = await runMain(['calibrate', '--sheet', 'll04', '-o', outPath]);
  assert.equal(code, 0);

  const outBytes = await readFile(outPath);
  const doc = await PDFDocument.load(outBytes);
  assert.equal(doc.getPages().length, 1);
});

test('missing -o exits 1', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'labelslot-cli-'));
  const inPath = join(dir, 'in.pdf');
  await writeFile(inPath, await makeLabelPdf());

  const { code, stderr } = await runMain(['--sheet', 'll04', inPath]);
  assert.equal(code, 1);
  assert.match(stderr, /output/i);
});

test('unknown sheet exits 1 with the known ids in stderr', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'labelslot-cli-'));
  const inPath = join(dir, 'in.pdf');
  const outPath = join(dir, 'out.pdf');
  await writeFile(inPath, await makeLabelPdf());

  const { code, stderr } = await runMain(['--sheet', 'nope', inPath, '-o', outPath]);
  assert.equal(code, 1);
  assert.match(stderr, /ll04/);
});

test('output path equal to input exits 1 and leaves the input untouched', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'labelslot-cli-'));
  const inPath = join(dir, 'in.pdf');
  const original = await makeLabelPdf();
  await writeFile(inPath, original);

  const { code, stderr } = await runMain(['--sheet', 'll04', inPath, '-o', inPath]);
  assert.equal(code, 1);
  assert.ok(stderr.length > 0);

  const stillThere = await readFile(inPath);
  assert.deepEqual(new Uint8Array(stillThere), new Uint8Array(original));
});
