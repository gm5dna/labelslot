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

/** Union of labelBox(sheet, pos) for pos in [from, to] inclusive. */
function unionOfPositions(sheet: ReturnType<typeof findSheet>, from: number, to: number): Box {
  let box = labelBox(sheet, from);
  for (let p = from + 1; p <= to; p++) {
    const b = labelBox(sheet, p);
    const x2 = Math.max(box.x + box.w, b.x + b.w);
    const y2 = Math.max(box.y + box.h, b.y + b.h);
    box = { x: Math.min(box.x, b.x), y: Math.min(box.y, b.y), w: 0, h: 0 };
    box.w = x2 - box.x;
    box.h = y2 - box.y;
  }
  return box;
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

  const remeasured = await measure(outPdf, 1, { createCanvas });
  assert.ok(remeasured.bbox);
  within(remeasured.bbox, grow(unionOfPositions(ll04, 1, 3), 1), 'page 1 union bbox');
});

test('two inputs on 6x4: three output pages, each centred within 1mm of the page centre', async () => {
  const pdfA = await makeLabelPdf({ pages: 1 });
  const pdfB = await makeLabelPdf({ pages: 2 });
  const { pdf: outPdf, report } = await run([pdfA, pdfB], { sheet: sixByFour, createCanvas });

  const outDoc = await PDFDocument.load(outPdf);
  const pages = outDoc.getPages();
  assert.equal(pages.length, 3);
  assert.equal(report.length, 3);

  for (let i = 0; i < 3; i++) {
    const size = pages[i].getSize();
    assert.ok(Math.abs(size.width - 288) < 1e-6, `page ${i} width`);
    assert.ok(Math.abs(size.height - 432) < 1e-6, `page ${i} height`);

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

test('assumePosition skips measurement (createCanvas throws if called) and still lands within the label + 1.5mm', async () => {
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
  within(remeasured.bbox, grow(labelBox(ll04, 2), 1.5), 'assumePosition bbox');
});

test('relocated-label fixture lands within labelBox(ll04, 1) + 1mm', async () => {
  const label: Box = { x: 110, y: 130, w: 80.2, h: 125.2 };
  const pdf = await makeLabelPdf({ label });
  const { pdf: outPdf } = await run([pdf], { sheet: ll04, pos: 1, createCanvas });

  const remeasured = await measure(outPdf, 0, { createCanvas });
  assert.ok(remeasured.bbox);
  within(remeasured.bbox, grow(labelBox(ll04, 1), 1), 'relocated-label bbox');
});
