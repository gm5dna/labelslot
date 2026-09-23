import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import { PDFDocument } from '@cantoo/pdf-lib';
import { run, LabelslotError, INTEGRATED_MESSAGE } from '../src/pipeline.ts';
import { labelBox, mm, type Box } from '../src/geometry.ts';
import { findSheet } from '../src/sheets.ts';
import { measure } from '../src/measure.ts';
import { makeLabelPdf } from './fixtures.ts';

const ll04 = findSheet('ll04');
const sixByFour = findSheet('6x4');

/** Grow a Box by `mm` on every side. */
function grow(box: Box, mmAmount: number): Box {
  return { x: box.x - mmAmount, y: box.y - mmAmount, w: box.w + 2 * mmAmount, h: box.h + 2 * mmAmount };
}

function within(bbox: Box, container: Box, msg: string): void {
  assert.ok(bbox.x >= container.x, `${msg}: left ${bbox.x} < ${container.x}`);
  assert.ok(bbox.y >= container.y, `${msg}: top ${bbox.y} < ${container.y}`);
  assert.ok(bbox.x + bbox.w <= container.x + container.w, `${msg}: right ${bbox.x + bbox.w} > ${container.x + container.w}`);
  assert.ok(bbox.y + bbox.h <= container.y + container.h, `${msg}: bottom ${bbox.y + bbox.h} > ${container.y + container.h}`);
}

test('plain fixture, ll04 pos 2: one output page, ink lands within the label + 1mm', async () => {
  const pdf = await makeLabelPdf();
  const { pdf: outPdf, report } = await run([pdf], { sheet: ll04, pos: 2, createCanvas });

  const outDoc = await PDFDocument.load(outPdf);
  assert.equal(outDoc.getPages().length, 1);

  const remeasured = await measure(outPdf, 0, { createCanvas });
  assert.ok(remeasured.bbox);
  within(remeasured.bbox, grow(labelBox(ll04, 2), 1), 'plain fixture bbox');

  assert.equal(report.length, 1);
  assert.equal(report[0].position, 2);
  assert.equal(report[0].outputPage, 0);
});

test('pages: 5 fixture, ll04 pos 3: spills to a second output page at positions 3,4 then 1,2,3', async () => {
  const pdf = await makeLabelPdf({ pages: 5 });
  const { pdf: outPdf, report } = await run([pdf], { sheet: ll04, pos: 3, createCanvas });

  const outDoc = await PDFDocument.load(outPdf);
  assert.equal(outDoc.getPages().length, 2);

  assert.deepEqual(report.map((r) => r.outputPage), [0, 0, 1, 1, 1]);
  assert.deepEqual(report.map((r) => r.position), [3, 4, 1, 2, 3]);
});

test('two inputs on 6x4: one page per label, a landscape label rotates and is centred', async () => {
  const pdfA = await makeLabelPdf({ pages: 1 });
  // Landscape: too wide for the portrait label but fits once turned 90 degrees.
  const pdfB = await makeLabelPdf({ pages: 2, label: { x: 15, y: 16, w: 125.2, h: 80.2 } });
  const { pdf: outPdf, report } = await run([pdfA, pdfB], { sheet: sixByFour, createCanvas });

  const outDoc = await PDFDocument.load(outPdf);
  const pages = outDoc.getPages();
  assert.equal(pages.length, 3);
  assert.equal(report.length, 3);

  assert.equal(report[0].placement.rotate, 0);
  assert.equal(report[1].placement.rotate, 90);

  for (let i = 0; i < 3; i++) {
    const size = pages[i].getSize();
    const rotated = report[i].placement.rotate === 90;
    const [expectW, expectH] = rotated ? [432, 288] : [288, 432];
    assert.ok(Math.abs(size.width - expectW) < 1e-6, `page ${i} width`);
    assert.ok(Math.abs(size.height - expectH) < 1e-6, `page ${i} height`);

    const remeasured = await measure(outPdf, i, { createCanvas });
    assert.ok(remeasured.bbox);
    const pageMm = { w: mm(size.width), h: mm(size.height) };
    const centreX = remeasured.bbox.x + remeasured.bbox.w / 2;
    const centreY = remeasured.bbox.y + remeasured.bbox.h / 2;
    assert.ok(Math.abs(centreX - pageMm.w / 2) < 1, `page ${i} not centred horizontally: ${centreX} vs ${pageMm.w / 2}`);
    assert.ok(Math.abs(centreY - pageMm.h / 2) < 1, `page ${i} not centred vertically: ${centreY} vs ${pageMm.h / 2}`);
  }
});

test('integrated fixture: LabelslotError containing INTEGRATED_MESSAGE', async () => {
  const pdf = await makeLabelPdf({ integrated: true });
  await assert.rejects(
    async () => run([pdf], { sheet: ll04, createCanvas }),
    (err: unknown) => {
      assert.ok(err instanceof LabelslotError);
      assert.ok((err as Error).message.includes(INTEGRATED_MESSAGE));
      return true;
    },
  );
});

test('rotate: 90 fixture: LabelslotError mentioning rotation', async () => {
  const pdf = await makeLabelPdf({ rotate: 90 });
  await assert.rejects(async () => run([pdf], { sheet: ll04, createCanvas }), /rotation/i);
});

test('assumePosition skips measurement (createCanvas throws if called) and still lands within the label + 1mm', async () => {
  const pdf = await makeLabelPdf();
  const throwingCreateCanvas = () => {
    throw new Error('createCanvas must not be called when assumePosition is set');
  };
  const { pdf: outPdf } = await run([pdf], {
    sheet: ll04,
    pos: 2,
    assumePosition: 1,
    createCanvas: throwingCreateCanvas,
  });

  const remeasured = await measure(outPdf, 0, { createCanvas });
  assert.ok(remeasured.bbox);
  within(remeasured.bbox, grow(labelBox(ll04, 2), 1), 'assumePosition bbox');
});

test('relocated-label fixture lands within labelBox(ll04, 1) + 1mm', async () => {
  const label: Box = { x: 110, y: 130, w: 80.2, h: 125.2 };
  const pdf = await makeLabelPdf({ label });
  const { pdf: outPdf } = await run([pdf], { sheet: ll04, pos: 1, createCanvas });

  const remeasured = await measure(outPdf, 0, { createCanvas });
  assert.ok(remeasured.bbox);
  within(remeasured.bbox, grow(labelBox(ll04, 1), 1), 'relocated-label bbox');
});

test('too-large: oversized label on ll04 rejects as a detection failure, not a large label', async () => {
  const pdf = await makeLabelPdf({ label: { x: 10, y: 10, w: 110, h: 150 } });
  const { bbox } = await measure(pdf, 0, { createCanvas });
  assert.ok(bbox);

  await assert.rejects(
    async () => run([pdf], { sheet: ll04, createCanvas }),
    (err: unknown) => {
      assert.ok(err instanceof LabelslotError);
      const msg = (err as Error).message;
      assert.match(msg, /detection failed/);
      assert.ok(msg.includes(`${bbox.w.toFixed(1)}x${bbox.h.toFixed(1)}mm`), `message missing measured size: ${msg}`);
      assert.ok(msg.includes('99.1x139mm'), `message missing label size: ${msg}`);
      return true;
    },
  );
});

test('too-large with --allow-scale: succeeds, shrinks, and warns about 203 dpi scanning', async () => {
  const pdf = await makeLabelPdf({ label: { x: 10, y: 10, w: 110, h: 150 } });
  const { report } = await run([pdf], { sheet: ll04, allowScale: true, createCanvas });

  assert.equal(report.length, 1);
  assert.ok(report[0].placement.scale < 1, `expected scale < 1, got ${report[0].placement.scale}`);
  assert.ok(
    report[0].placement.warnings.some((w) => /203 dpi/.test(w)),
    `expected a 203 dpi warning, got ${JSON.stringify(report[0].placement.warnings)}`,
  );
});

test('a Buffer input is left untouched by run(), and the same Uint8Array can be run() twice', async () => {
  const bytes = await makeLabelPdf();
  const buf = Buffer.from(bytes);
  const { report: report1 } = await run([buf], { sheet: ll04, pos: 2, createCanvas });
  assert.equal(report1.length, 1);
  // pdf.js transfers/detaches the array it's handed, truncating it to length 0; the pipeline's
  // `new Uint8Array(bytes)` copy (mirroring measure.ts) must leave the caller's buffer intact.
  assert.equal(buf.length, bytes.length);

  // A second run() on the same (uncopied, un-detached) input must also succeed.
  const { report: report2 } = await run([bytes], { sheet: ll04, pos: 3, createCanvas });
  assert.equal(report2.length, 1);
  assert.equal(report2[0].position, 3);
});

test('CropBox differing from MediaBox rejects', async () => {
  const bytes = await makeLabelPdf();
  const doc = await PDFDocument.load(bytes);
  doc.getPages()[0].setCropBox(10, 10, 400, 600);
  const modified = await doc.save();

  await assert.rejects(async () => run([modified], { sheet: ll04, createCanvas }), /CropBox/);
});
